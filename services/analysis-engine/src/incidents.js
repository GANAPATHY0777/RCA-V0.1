/**
 * Incident Management, AI Reasoning (Step 8), and Approval Layer (Step 9)
 * 
 * Every AI-recommended recovery action MUST be stored in a pending-approval state.
 * No recovery action may execute without an explicit Approve call.
 * Every approval/rejection is logged with timestamp and acting user.
 */

const express = require('express');
const logger = require('../../shared/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

/**
 * Call Anthropic Claude API for AI reasoning (Step 8).
 * Assembles structured evidence and gets grounded explanation.
 */
async function getAIReasoning(incident, scoringDetails) {
  const evidence = {
    root_cause_service: incident.root_cause_service,
    root_cause_metric: incident.root_cause_metric,
    confidence_pct: incident.confidence_pct,
    confidence_formula: incident.confidence_formula,
    ranking: scoringDetails.ranking,
    weights: scoringDetails.weights,
    naive_baseline: incident.naive_baseline,
  };

  const systemPrompt = `You are an expert SRE analyzing a microservice incident. You must:
1. State the root cause clearly and concisely
2. Explain your reasoning STRICTLY grounded in the evidence provided — do not invent numbers or facts not present in the payload
3. Recommend a specific investigative or recovery action

Respond in valid JSON with this exact structure:
{
  "root_cause": "brief statement of the root cause",
  "reasoning": "detailed explanation grounded in the evidence — reference specific metric values, z-scores, and dependency paths from the evidence",
  "recommended_action": "specific action to take (e.g., 'Restart payment-service container to clear the DB connection pool affected by latency injection')",
  "evidence_summary": "bullet-point summary of key evidence that supports this conclusion"
}

CRITICAL: Every number you cite must come from the evidence payload. Do not fabricate or estimate any values.`;

  const userMessage = `Analyze this incident and provide your assessment.

Evidence payload:
${JSON.stringify(evidence, null, 2)}`;

  if (!ANTHROPIC_API_KEY) {
    logger.warn('No ANTHROPIC_API_KEY set — using rule-based fallback reasoning');
    return generateFallbackReasoning(incident, scoringDetails);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [
          { role: 'user', content: userMessage },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Anthropic API error', { status: response.status, error: errorText });
      return generateFallbackReasoning(incident, scoringDetails);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { root_cause: text, reasoning: text, recommended_action: 'Investigate manually', evidence_summary: 'See raw response' };
  } catch (err) {
    logger.error('AI reasoning call failed', { error: err.message });
    return generateFallbackReasoning(incident, scoringDetails);
  }
}

/**
 * Rule-based fallback when no API key is available.
 * Still grounded in real evidence — not fabricated.
 */
function generateFallbackReasoning(incident, scoringDetails) {
  const topCandidate = scoringDetails.ranking?.[0];
  if (!topCandidate) {
    return {
      root_cause: 'Unable to determine root cause',
      reasoning: 'No anomaly candidates were scored.',
      recommended_action: 'Investigate service logs manually.',
      evidence_summary: 'No evidence available.',
    };
  }

  const isLatency = topCandidate.metric?.includes('latency');
  const isMemory = topCandidate.metric?.includes('memory');
  const isCPU = topCandidate.metric?.includes('cpu');

  let action = `Restart ${topCandidate.service} to restore normal operation`;
  if (isLatency) {
    action = `Restart ${topCandidate.service} to clear stalled connections causing ${topCandidate.metric_value?.toFixed(0)}ms latency (baseline: ${topCandidate.baseline_mean?.toFixed(0)}ms)`;
  } else if (isMemory) {
    action = `Restart ${topCandidate.service} to reclaim memory (current: ${topCandidate.metric_value?.toFixed(0)}MB, baseline: ${topCandidate.baseline_mean?.toFixed(0)}MB)`;
  } else if (isCPU) {
    action = `Restart ${topCandidate.service} to reset CPU-bound process (current: ${topCandidate.metric_value?.toFixed(1)}%, baseline: ${topCandidate.baseline_mean?.toFixed(1)}%)`;
  }

  return {
    root_cause: `${topCandidate.service} is the most probable root cause based on ${topCandidate.metric} anomaly (z-score: ${topCandidate.z_score?.toFixed(2)})`,
    reasoning: `The weighted scoring engine ranked ${topCandidate.service} highest with a total score of ${topCandidate.total_score?.toFixed(3)}. ` +
      `This was derived from: temporal_score=${topCandidate.temporal_score?.toFixed(3)} (weight 0.35), ` +
      `dependency_score=${topCandidate.dependency_score?.toFixed(3)} (weight 0.40), ` +
      `severity_score=${topCandidate.severity_score?.toFixed(3)} (weight 0.25). ` +
      `The ${topCandidate.metric} metric deviated to ${topCandidate.metric_value?.toFixed(2)} from a baseline mean of ${topCandidate.baseline_mean?.toFixed(2)} ` +
      `(std: ${topCandidate.baseline_std?.toFixed(2)}), yielding a z-score of ${topCandidate.z_score?.toFixed(2)}. ` +
      `Confidence is ${incident.confidence_pct}% (formula: ${incident.confidence_formula}).`,
    recommended_action: action,
    evidence_summary: `• Service: ${topCandidate.service}\n• Metric: ${topCandidate.metric} = ${topCandidate.metric_value?.toFixed(2)} (baseline: ${topCandidate.baseline_mean?.toFixed(2)} ± ${topCandidate.baseline_std?.toFixed(2)})\n• Z-score: ${topCandidate.z_score?.toFixed(2)}\n• Confidence: ${incident.confidence_pct}%\n• Total score: ${topCandidate.total_score?.toFixed(3)}`,
  };
}

// Map service names to Docker container names
function getContainerName(serviceName) {
  const mapping = {
    'frontend-gateway': 'v01_mvp-frontend-gateway-1',
    'order-service': 'v01_mvp-order-service-1',
    'payment-service': 'v01_mvp-payment-service-1',
    'auth-service': 'v01_mvp-auth-service-1',
  };
  // Try common docker-compose naming patterns
  return mapping[serviceName] || `v01_mvp-${serviceName}-1`;
}

/**
 * Strict Zero-Leak Redaction:
 * When an incident is in 'awaiting_diagnosis', redact all root-cause attribution,
 * confidence scores, formulas, and AI reasoning so network inspection cannot leak answers.
 */
function redactIncident(incident) {
  if (!incident) return null;
  if (incident.status === 'awaiting_diagnosis') {
    const {
      root_cause_service,
      root_cause_metric,
      confidence_pct,
      confidence_formula,
      ai_reasoning,
      recommended_action,
      recovery_target_container,
      scoring_details,
      naive_baseline,
      ...safeFields
    } = incident;

    return {
      ...safeFields,
      root_cause_service: null,
      root_cause_metric: null,
      confidence_pct: null,
      confidence_formula: null,
      ai_reasoning: null,
      recommended_action: null,
      recovery_target_container: null,
      naive_baseline: null,
      scoring_details: scoring_details ? {
        weights: scoring_details.weights,
        candidate_count: scoring_details.ranking?.length || 0,
      } : null,
    };
  }
  return incident;
}

function createIncidentRouter(pool) {
  const router = express.Router();

  /**
   * GET /api/incidents
   * List all incidents (redacted if awaiting_diagnosis).
   */
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM incidents ORDER BY created_at DESC LIMIT 50'
      );
      res.json(result.rows.map(redactIncident));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/incidents/active
   * Get the most recent active incident (not resolved).
   */
  router.get('/active', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM incidents WHERE status NOT IN ('healthy', 'rejected') ORDER BY created_at DESC LIMIT 1`
      );
      if (result.rows.length === 0) {
        return res.json(null);
      }

      const incident = result.rows[0];
      const diagResult = await pool.query(
        'SELECT * FROM diagnosis_log WHERE incident_id = $1 ORDER BY diagnosed_at DESC LIMIT 1',
        [incident.id]
      );
      incident.diagnosis = diagResult.rows[0] || null;

      res.json(redactIncident(incident));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/incidents/active-all
   * Get all active incidents (for Concurrent Chaos multi-incident mode).
   */
  router.get('/active-all', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM incidents WHERE status NOT IN ('healthy', 'rejected') ORDER BY created_at DESC LIMIT 10`
      );

      const incidentsWithDiag = await Promise.all(
        result.rows.map(async (incident) => {
          const diagResult = await pool.query(
            'SELECT * FROM diagnosis_log WHERE incident_id = $1 ORDER BY diagnosed_at DESC LIMIT 1',
            [incident.id]
          );
          incident.diagnosis = diagResult.rows[0] || null;
          return redactIncident(incident);
        })
      );

      res.json(incidentsWithDiag);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/incidents/:id
   * Get full incident detail (redacted if awaiting_diagnosis).
   */
  router.get('/:id', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = result.rows[0];

      // Get approval log
      const approvalLog = await pool.query(
        'SELECT * FROM approval_log WHERE incident_id = $1 ORDER BY acted_at',
        [req.params.id]
      );

      // Get diagnosis log
      const diagLog = await pool.query(
        'SELECT * FROM diagnosis_log WHERE incident_id = $1 ORDER BY diagnosed_at DESC LIMIT 1',
        [req.params.id]
      );

      incident.approval_log = approvalLog.rows;
      incident.diagnosis = diagLog.rows[0] || null;

      res.json(redactIncident(incident));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/incidents/:id/analyze
   * Trigger AI reasoning for an incident (Step 8).
   * Moves incident to awaiting_diagnosis (NOT awaiting_approval directly).
   */
  router.post('/:id/analyze', async (req, res) => {
    try {
      const incidentResult = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      if (incidentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incidentResult.rows[0];
      const scoringDetails = incident.scoring_details || {};

      logger.info('Running AI reasoning', { incident_id: incident.id });

      const aiReasoning = await getAIReasoning(incident, scoringDetails);

      // Determine recovery target container
      const containerName = getContainerName(incident.root_cause_service);

      // Update incident with AI reasoning and move to awaiting_diagnosis
      await pool.query(
        `UPDATE incidents SET 
          status = 'awaiting_diagnosis', 
          ai_reasoning = $1, 
          recommended_action = $2,
          recovery_target_container = $3,
          updated_at = NOW()
        WHERE id = $4`,
        [JSON.stringify(aiReasoning), aiReasoning.recommended_action, containerName, incident.id]
      );

      logger.info('AI reasoning complete, awaiting operator diagnosis', {
        incident_id: incident.id,
      });

      res.json({
        incident_id: incident.id,
        status: 'awaiting_diagnosis',
        message: 'Analysis complete. Incident is awaiting operator diagnosis.',
      });
    } catch (err) {
      logger.error('AI analysis failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/incidents/:id/diagnose (Step 2)
   * Receives operator diagnosis guess, records result in diagnosis_log,
   * transitions incident to awaiting_approval, and returns the full reveal.
   * Body: { guessed_service, operator, time_taken_seconds, timed_out }
   */
  router.post('/:id/diagnose', async (req, res) => {
    try {
      const { guessed_service, operator = 'operator', time_taken_seconds, timed_out = false } = req.body;

      const incidentResult = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      if (incidentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incidentResult.rows[0];
      if (incident.status !== 'awaiting_diagnosis') {
        return res.status(409).json({
          error: `Cannot diagnose incident in '${incident.status}' state. Must be 'awaiting_diagnosis'.`,
        });
      }

      const isTimedOut = Boolean(timed_out || guessed_service === 'timeout' || !guessed_service);
      const guess = isTimedOut ? null : guessed_service;
      const actualRootCause = incident.root_cause_service;
      const isCorrect = isTimedOut ? null : (guess === actualRootCause);
      const timeTaken = time_taken_seconds !== undefined ? parseFloat(time_taken_seconds) : null;

      // Store attempt in diagnosis_log
      const diagInsert = await pool.query(
        `INSERT INTO diagnosis_log (
          incident_id, operator, guessed_service, actual_service, is_correct, timed_out, time_taken_seconds
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [incident.id, operator, guess, actualRootCause, isCorrect, isTimedOut, timeTaken]
      );

      // Transition to awaiting_approval
      const updatedIncident = await pool.query(
        "UPDATE incidents SET status = 'awaiting_approval', updated_at = NOW() WHERE id = $1 RETURNING *",
        [incident.id]
      );

      logger.info('Diagnosis submitted', {
        incident_id: incident.id,
        operator,
        guess,
        actual: actualRootCause,
        is_correct: isCorrect,
        timed_out: isTimedOut,
        time_taken: timeTaken,
      });

      // Return FULL REVEAL unredacted
      res.json({
        incident_id: incident.id,
        status: 'awaiting_approval',
        diagnosis: diagInsert.rows[0],
        incident: updatedIncident.rows[0],
      });
    } catch (err) {
      logger.error('Diagnosis processing failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/incidents/scoreboard
   * Returns session-level scoreboard stats.
   */
  router.get('/scoreboard', async (req, res) => {
    try {
      const stats = await computeScoreboardStats(pool);
      res.json(stats);
    } catch (err) {
      logger.error('Scoreboard fetch failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/incidents/:id/approve (Step 9)
   * Approve a recovery action. REQUIRED before any recovery executes.
   * Body: { "user": "operator_name" }
   */
  router.post('/:id/approve', async (req, res) => {
    try {
      const { user } = req.body;
      if (!user) {
        return res.status(400).json({ error: 'user field required for audit trail' });
      }

      const incidentResult = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      if (incidentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incidentResult.rows[0];
      if (incident.status !== 'awaiting_approval') {
        return res.status(409).json({
          error: `Cannot approve incident in '${incident.status}' state. Must be 'awaiting_approval'.`,
        });
      }

      // Log approval
      await pool.query(
        'INSERT INTO approval_log (incident_id, action, acting_user) VALUES ($1, $2, $3)',
        [incident.id, 'approve', user]
      );

      // Update incident status
      await pool.query(
        "UPDATE incidents SET status = 'approved', updated_at = NOW() WHERE id = $1",
        [incident.id]
      );

      logger.info('Recovery APPROVED', { incident_id: incident.id, user, action: incident.recommended_action });

      // Trigger recovery execution asynchronously
      try {
        fetch('http://localhost:3020/api/recovery/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            incident_id: incident.id,
            container_name: incident.recovery_target_container,
            service_name: incident.root_cause_service,
          }),
        }).catch(err => logger.error('Recovery trigger failed', { error: err.message }));
      } catch (err) {
        logger.error('Recovery trigger failed', { error: err.message });
      }

      res.json({
        incident_id: incident.id,
        status: 'approved',
        approved_by: user,
        approved_at: new Date().toISOString(),
        message: 'Recovery execution initiated',
      });
    } catch (err) {
      logger.error('Approval failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/incidents/:id/reject (Step 9)
   * Reject a recovery action.
   * Body: { "user": "operator_name", "reason": "..." }
   */
  router.post('/:id/reject', async (req, res) => {
    try {
      const { user, reason } = req.body;
      if (!user) {
        return res.status(400).json({ error: 'user field required for audit trail' });
      }

      const incidentResult = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
      if (incidentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incidentResult.rows[0];
      if (incident.status !== 'awaiting_approval') {
        return res.status(409).json({
          error: `Cannot reject incident in '${incident.status}' state. Must be 'awaiting_approval'.`,
        });
      }

      // Log rejection
      await pool.query(
        'INSERT INTO approval_log (incident_id, action, acting_user, reason) VALUES ($1, $2, $3, $4)',
        [incident.id, 'reject', user, reason || null]
      );

      // Update incident status
      await pool.query(
        "UPDATE incidents SET status = 'rejected', updated_at = NOW() WHERE id = $1",
        [incident.id]
      );

      logger.info('Recovery REJECTED', { incident_id: incident.id, user, reason });

      res.json({
        incident_id: incident.id,
        status: 'rejected',
        rejected_by: user,
        reason: reason || null,
        rejected_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Rejection failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

/**
 * Compute session scoreboard stats from diagnosis_log and incidents.
 */
async function computeScoreboardStats(pool) {
  try {
    const diagRows = await pool.query(
      'SELECT is_correct, timed_out, time_taken_seconds, diagnosed_at FROM diagnosis_log ORDER BY diagnosed_at ASC'
    );

    const total = diagRows.rows.length;
    const correct = diagRows.rows.filter(r => r.is_correct === true);
    const accuracy = total > 0 ? Math.round((correct.length / total) * 100) : 0;

    const correctWithTimes = correct.filter(r => r.time_taken_seconds !== null && r.time_taken_seconds > 0);
    const avgTimeDiagnose = correctWithTimes.length > 0
      ? +(correctWithTimes.reduce((acc, r) => acc + parseFloat(r.time_taken_seconds), 0) / correctWithTimes.length).toFixed(1)
      : 0;

    const recovTimesResult = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (i.resolved_at - a.acted_at)) as recov_seconds
      FROM incidents i
      JOIN approval_log a ON a.incident_id = i.id AND a.action = 'approve'
      WHERE i.status = 'healthy' AND i.resolved_at IS NOT NULL AND a.acted_at IS NOT NULL
    `);
    const recovRows = recovTimesResult.rows.map(r => parseFloat(r.recov_seconds)).filter(s => !isNaN(s) && s > 0);
    const avgTimeRecovery = recovRows.length > 0
      ? +(recovRows.reduce((a, b) => a + b, 0) / recovRows.length).toFixed(1)
      : 0;

    let streak = 0;
    for (let i = diagRows.rows.length - 1; i >= 0; i--) {
      if (diagRows.rows[i].is_correct === true) {
        streak++;
      } else {
        break;
      }
    }

    return {
      incidents_diagnosed: total,
      correct_diagnoses: correct.length,
      accuracy_pct: accuracy,
      avg_time_to_diagnose_seconds: avgTimeDiagnose,
      avg_time_to_recovery_seconds: avgTimeRecovery,
      current_streak: streak,
    };
  } catch (err) {
    logger.error('Scoreboard calculation error', { error: err.message });
    return {
      incidents_diagnosed: 0,
      correct_diagnoses: 0,
      accuracy_pct: 0,
      avg_time_to_diagnose_seconds: 0,
      avg_time_to_recovery_seconds: 0,
      current_streak: 0,
    };
  }
}

module.exports = { createIncidentRouter, computeScoreboardStats };

