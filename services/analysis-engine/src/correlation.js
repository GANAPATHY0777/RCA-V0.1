/**
 * Correlation & Root Cause Ranking Engine (Steps 6 & 7)
 * 
 * SCORING FORMULA:
 *   score(candidate) = w1 * temporal_score + w2 * dependency_score + w3 * severity_score
 * 
 * WEIGHTS (documented rationale):
 *   w1 = 0.35 (temporal): Earlier anomalies are likely causes, but timing alone is unreliable
 *                          in distributed systems due to clock skew and propagation delays.
 *   w2 = 0.40 (dependency): Dependency proximity is the strongest signal — an upstream failure
 *                            is very likely the root cause of downstream symptoms. Given higher
 *                            weight because our dependency graph is derived from real trace data.
 *   w3 = 0.25 (severity): Higher z-scores indicate more extreme deviation, but severity alone
 *                          doesn't determine causation — a downstream service may show extreme
 *                          latency because it's waiting on a failed upstream, not because it's
 *                          the root cause.
 * 
 * CONFIDENCE FORMULA (Step 7):
 *   If only one candidate:
 *     confidence = min(95, 50 + severity_z * 5)
 *   If multiple candidates:
 *     gap = top_score - second_score
 *     relative_gap = gap / top_score
 *     confidence = clamp(relative_gap * 100, 30, 95)
 *   
 *   Floor of 30%: if the engine ran and found anomalies, there's at least some evidence.
 *   Cap of 95%: the system never claims certainty — distributed systems are too complex.
 * 
 * NAIVE BASELINE:
 *   Root cause = whichever anomaly occurred first, regardless of dependency graph.
 *   This is stored alongside the real ranking for side-by-side comparison.
 */

const express = require('express');
const logger = require('../../shared/logger');

const WEIGHTS = {
  w1_temporal: 0.35,
  w2_dependency: 0.40,
  w3_severity: 0.25,
};

/**
 * Compute temporal score: how early this anomaly appeared relative to the latest anomaly.
 * Earlier = higher score (0 to 1).
 */
function computeTemporalScore(candidateTimestamp, allTimestamps) {
  if (allTimestamps.length <= 1) return 1.0;

  const times = allTimestamps.map(t => new Date(t).getTime());
  const candidateTime = new Date(candidateTimestamp).getTime();
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const range = latest - earliest;

  if (range === 0) return 1.0;

  // Earlier anomalies get higher scores
  return 1.0 - ((candidateTime - earliest) / range);
}

/**
 * Compute dependency score: how close the candidate is to the symptom in the dependency graph.
 * Closer upstream = higher score (0 to 1).
 * No path = 0.
 */
function computeDependencyScore(candidateService, symptomService, adjacency) {
  if (candidateService === symptomService) return 0.8; // Same service, likely cause

  // BFS to find shortest path from candidate to symptom (upstream direction)
  const visited = new Set();
  const queue = [{ node: candidateService, depth: 0 }];
  visited.add(candidateService);

  while (queue.length > 0) {
    const { node, depth } = queue.shift();

    const neighbors = adjacency[node] || [];
    for (const neighbor of neighbors) {
      if (neighbor === symptomService) {
        // Found path: score decreases with distance
        return Math.max(0.1, 1.0 - (depth * 0.2));
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, depth: depth + 1 });
      }
    }
  }

  // Also check reverse direction (symptom calls candidate — candidate is downstream)
  const visited2 = new Set();
  const queue2 = [{ node: symptomService, depth: 0 }];
  visited2.add(symptomService);

  while (queue2.length > 0) {
    const { node, depth } = queue2.shift();
    const neighbors = adjacency[node] || [];
    for (const neighbor of neighbors) {
      if (neighbor === candidateService) {
        return Math.max(0.1, 0.8 - (depth * 0.2));
      }
      if (!visited2.has(neighbor)) {
        visited2.add(neighbor);
        queue2.push({ node: neighbor, depth: depth + 1 });
      }
    }
  }

  // No path found — penalize
  return 0.0;
}

/**
 * Compute severity score: normalized z-score magnitude (0 to 1).
 */
function computeSeverityScore(zScore) {
  // z-score of 3 = threshold, 10+ = extreme
  return Math.min(1.0, Math.abs(zScore) / 10.0);
}

/**
 * Compute confidence percentage from scoring results.
 * NEVER hardcoded — always derived from the score gap.
 */
function computeConfidence(rankedCandidates) {
  if (rankedCandidates.length === 0) return 0;

  if (rankedCandidates.length === 1) {
    const severity = rankedCandidates[0].severity_score;
    return Math.min(95, Math.round(50 + severity * 50));
  }

  const topScore = rankedCandidates[0].total_score;
  const secondScore = rankedCandidates[1].total_score;
  const gap = topScore - secondScore;
  const relativeGap = topScore > 0 ? gap / topScore : 0;

  // Convert to percentage, floor at 30, cap at 95
  const confidence = Math.round(Math.max(30, Math.min(95, relativeGap * 100)));
  return confidence;
}

/**
 * Run naive baseline: root cause = earliest anomaly, ignoring the dependency graph.
 */
function runNaiveBaseline(anomalies) {
  if (anomalies.length === 0) return null;

  const sorted = [...anomalies].sort(
    (a, b) => new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()
  );

  return {
    method: 'naive_baseline',
    description: 'Root cause = whichever anomaly occurred first, regardless of dependency graph',
    root_cause: sorted[0].service_name,
    root_cause_metric: sorted[0].metric_name,
    ranking: sorted.map((a, i) => ({
      rank: i + 1,
      service: a.service_name,
      metric: a.metric_name,
      z_score: a.z_score,
      detected_at: a.detected_at,
      reason: i === 0 ? 'Earliest anomaly' : `${Math.round((new Date(a.detected_at) - new Date(sorted[0].detected_at)) / 1000)}s after first anomaly`,
    })),
  };
}

function createCorrelationRouter(pool) {
  const router = express.Router();

  /**
   * POST /api/correlation/analyze
   * Receives anomaly events and runs root cause analysis.
   * Body: { anomalies: [...], symptom_service?: string }
   */
  router.post('/analyze', async (req, res) => {
    try {
      const { anomalies, symptom_service } = req.body;

      if (!anomalies || anomalies.length === 0) {
        return res.status(400).json({ error: 'No anomalies provided' });
      }

      // Get dependency graph adjacency
      let adjacency = {};
      try {
        const graphRes = await fetch('http://localhost:3020/api/graph/adjacency');
        adjacency = await graphRes.json();
      } catch (err) {
        logger.warn('Could not fetch dependency graph, using empty adjacency', { error: err.message });
      }

      // Determine symptom service: the one most likely to be user-facing
      const symptom = symptom_service || anomalies[0]?.service_name || 'frontend-gateway';

      // Score each anomaly as a candidate root cause
      const allTimestamps = anomalies.map(a => a.detected_at);

      const candidates = anomalies.map(anomaly => {
        const temporal = computeTemporalScore(anomaly.detected_at, allTimestamps);
        const dependency = computeDependencyScore(anomaly.service_name, symptom, adjacency);
        const severity = computeSeverityScore(anomaly.z_score);

        const total = WEIGHTS.w1_temporal * temporal
          + WEIGHTS.w2_dependency * dependency
          + WEIGHTS.w3_severity * severity;

        return {
          service: anomaly.service_name,
          metric: anomaly.metric_name,
          z_score: anomaly.z_score,
          metric_value: anomaly.metric_value,
          baseline_mean: anomaly.baseline_mean,
          baseline_std: anomaly.baseline_std,
          detected_at: anomaly.detected_at,
          temporal_score: Math.round(temporal * 1000) / 1000,
          dependency_score: Math.round(dependency * 1000) / 1000,
          severity_score: Math.round(severity * 1000) / 1000,
          total_score: Math.round(total * 1000) / 1000,
          anomaly_id: anomaly.id,
        };
      });

      // Sort by total score descending
      candidates.sort((a, b) => b.total_score - a.total_score);

      // Assign ranks
      candidates.forEach((c, i) => { c.rank = i + 1; });

      // Compute confidence
      const confidence = computeConfidence(candidates);
      const confidenceFormula = candidates.length === 1
        ? `min(95, 50 + ${candidates[0].severity_score.toFixed(3)} * 50) = ${confidence}%`
        : `clamp((${candidates[0].total_score} - ${candidates[1]?.total_score || 0}) / ${candidates[0].total_score} * 100, 30, 95) = ${confidence}%`;

      // Run naive baseline
      const naiveResult = runNaiveBaseline(anomalies);

      const result = {
        method: 'weighted_scoring',
        weights: WEIGHTS,
        weight_rationale: {
          w1_temporal: 'Earlier anomalies are likely causes, but timing alone is unreliable in distributed systems',
          w2_dependency: 'Dependency proximity is the strongest signal — upstream failures cause downstream symptoms',
          w3_severity: 'Higher z-scores indicate extreme deviation, but severity alone does not determine causation',
        },
        symptom_service: symptom,
        root_cause: candidates[0]?.service || null,
        root_cause_metric: candidates[0]?.metric || null,
        confidence_pct: confidence,
        confidence_formula: confidenceFormula,
        ranking: candidates,
        naive_baseline: naiveResult,
        adjacency_used: adjacency,
        analyzed_at: new Date().toISOString(),
      };

      // Create or update incident in database
      const anomalyIds = anomalies.map(a => a.id).filter(Boolean);
      const incidentResult = await pool.query(
        `INSERT INTO incidents (
          status, root_cause_service, root_cause_metric, confidence_pct, confidence_formula,
          scoring_details, naive_baseline, anomaly_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          'analyzing',
          result.root_cause,
          result.root_cause_metric,
          confidence,
          confidenceFormula,
          JSON.stringify({ ranking: candidates, weights: WEIGHTS }),
          JSON.stringify(naiveResult),
          anomalyIds,
        ]
      );

      result.incident_id = incidentResult.rows[0].id;

      logger.info('Root cause analysis complete', {
        incident_id: result.incident_id,
        root_cause: result.root_cause,
        confidence: confidence,
        method: 'weighted_scoring',
      });

      // Auto-trigger AI reasoning to advance incident to awaiting_approval
      fetch(`http://localhost:3020/api/incidents/${result.incident_id}/analyze`, {
        method: 'POST',
      }).catch(err => logger.error('Auto AI reasoning trigger failed', { error: err.message }));

      res.json(result);
    } catch (err) {
      logger.error('Correlation analysis failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/correlation/anomalies
   * Receives anomaly events from the anomaly detector and stores them.
   * Triggers analysis when enough anomalies accumulate.
   */
  router.post('/anomalies', async (req, res) => {
    try {
      const anomaly = req.body;

      // Store in database
      const result = await pool.query(
        `INSERT INTO anomaly_events (service_name, metric_name, metric_value, baseline_mean, baseline_std, z_score, severity) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, detected_at`,
        [anomaly.service_name, anomaly.metric_name, anomaly.metric_value,
         anomaly.baseline_mean, anomaly.baseline_std, anomaly.z_score,
         Math.abs(anomaly.z_score) > 5 ? 'critical' : 'warning']
      );

      const storedAnomaly = { ...anomaly, id: result.rows[0].id, detected_at: result.rows[0].detected_at };

      // Partition into failure domains: 'auth' vs 'order_flow'
      // This allows Concurrent Chaos to produce two genuinely independent incidents
      const isAuthDomain = anomaly.service_name === 'auth-service';
      const domainServices = isAuthDomain 
        ? ['auth-service'] 
        : ['payment-service', 'order-service', 'frontend-gateway', 'postgres'];

      // Check for active incident within this failure domain
      const recentIncident = await pool.query(
        `SELECT id FROM incidents 
         WHERE status NOT IN ('healthy', 'rejected') 
           AND root_cause_service = ANY($1::varchar[])
           AND created_at > NOW() - INTERVAL '60 seconds' 
         LIMIT 1`,
        [domainServices]
      );

      if (recentIncident.rows.length === 0) {
        // Collect recent anomalies (last 30 seconds) for this domain and trigger analysis
        const recentAnomalies = await pool.query(
          `SELECT * FROM anomaly_events 
           WHERE detected_at > NOW() - INTERVAL '30 seconds' 
             AND service_name = ANY($1::varchar[])
           ORDER BY detected_at`,
          [domainServices]
        );

        if (recentAnomalies.rows.length >= 1) {
          // Trigger analysis for this domain
          logger.info('Triggering root cause analysis for domain', { 
            domain: isAuthDomain ? 'auth' : 'order_flow', 
            anomaly_count: recentAnomalies.rows.length 
          });

          try {
            await fetch('http://localhost:3020/api/correlation/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                anomalies: recentAnomalies.rows,
                symptom_service: isAuthDomain ? 'auth-service' : 'frontend-gateway',
              }),
            });
          } catch (err) {
            logger.error('Auto-analysis trigger failed', { error: err.message });
          }
        }
      }

      res.status(201).json(storedAnomaly);
    } catch (err) {
      logger.error('Anomaly storage failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/correlation/anomalies/recent
   * Returns recent anomaly events for the dashboard.
   */
  router.get('/anomalies/recent', async (req, res) => {
    try {
      const minutes = parseInt(req.query.minutes || '10');
      const result = await pool.query(
        `SELECT * FROM anomaly_events WHERE detected_at > NOW() - INTERVAL '${minutes} minutes' ORDER BY detected_at DESC`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createCorrelationRouter, computeTemporalScore, computeDependencyScore, computeSeverityScore, computeConfidence, WEIGHTS };
