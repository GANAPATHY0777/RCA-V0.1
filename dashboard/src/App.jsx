import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import StatusBar from './components/StatusBar';
import Scoreboard from './components/Scoreboard';
import DependencyGraph from './components/DependencyGraph';
import IncidentPanel from './components/IncidentPanel';
import EvidenceTimeline from './components/EvidenceTimeline';
import OperatorControls from './components/OperatorControls';

export default function App() {
  const [overallHealth, setOverallHealth] = useState('healthy');
  const [servicesHealth, setServicesHealth] = useState([
    { name: 'frontend-gateway', status: 'healthy', latency_ms: 22 },
    { name: 'order-service', status: 'healthy', latency_ms: 18 },
    { name: 'payment-service', status: 'healthy', latency_ms: 12 },
    { name: 'auth-service', status: 'healthy', latency_ms: 15 },
    { name: 'postgres', status: 'healthy', latency_ms: 4 },
  ]);
  const [graphData, setGraphData] = useState({
    nodes: [
      { id: 'frontend-gateway', label: 'frontend-gateway' },
      { id: 'order-service', label: 'order-service' },
      { id: 'payment-service', label: 'payment-service' },
      { id: 'auth-service', label: 'auth-service' },
      { id: 'postgres', label: 'postgres' },
    ],
    edges: [
      { source: 'frontend-gateway', target: 'order-service', call_count: 142 },
      { source: 'frontend-gateway', target: 'auth-service', call_count: 89 },
      { source: 'order-service', target: 'payment-service', call_count: 124 },
      { source: 'payment-service', target: 'postgres', call_count: 310 },
    ],
    derived_from_spans: true,
  });

  // Operator Mode State
  const [level, setLevel] = useState(1);
  const [ordersCount, setOrdersCount] = useState(0);
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [activeIncident, setActiveIncident] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [recoveryStatus, setRecoveryStatus] = useState(null);
  const [scoreboardStats, setScoreboardStats] = useState({
    incidents_diagnosed: 0,
    correct_diagnoses: 0,
    accuracy_pct: 0,
    avg_time_to_diagnose_seconds: 0,
    avg_time_to_recovery_seconds: 0,
    current_streak: 0,
  });
  const [isActing, setIsActing] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [backendOnline, setBackendOnline] = useState(false);

  // Hidden storage for offline simulation truth
  const [simulationSecret, setSimulationSecret] = useState({});

  // Core polling function
  const refreshData = useCallback(async () => {
    try {
      // 1. Service Health
      const health = await api.getServicesHealth().catch(() => null);
      if (health) {
        setBackendOnline(true);
        setOverallHealth(health.overall || 'healthy');
        setServicesHealth(health.services || []);
      } else {
        setBackendOnline(false);
      }

      // 2. Dependency Graph
      const graph = await api.getGraph().catch(() => null);
      if (graph && graph.nodes && graph.nodes.length > 0) {
        setGraphData(graph);
      }

      // 3. Scoreboard Stats
      const stats = await api.getScoreboard().catch(() => null);
      if (stats && backendOnline) {
        setScoreboardStats(stats);
      }

      // 4. Active Incidents (All active, for Concurrent Chaos)
      const allIncidents = await api.getActiveIncidentsAll().catch(() => null);
      if (allIncidents && allIncidents.length > 0 && backendOnline) {
        setActiveIncidents(allIncidents);
        // If current active incident is null or no longer exists, select first
        setActiveIncident((prev) => {
          if (!prev) return allIncidents[0];
          const matched = allIncidents.find((i) => i.id === prev.id);
          return matched || allIncidents[0];
        });
      } else if (allIncidents && allIncidents.length === 0 && backendOnline) {
        setActiveIncidents([]);
        setActiveIncident(null);
      }

      // 5. If active incident has an ongoing recovery, poll recovery status
      if (activeIncident && (activeIncident.status === 'approved' || activeIncident.status === 'recovering')) {
        const rec = await api.getRecoveryStatus(activeIncident.id).catch(() => null);
        if (rec) setRecoveryStatus(rec);
      }

      // 6. Recent Anomalies
      const recentAnoms = await api.getRecentAnomalies(10).catch(() => null);
      if (recentAnoms && recentAnoms.length > 0 && backendOnline) {
        setAnomalies(recentAnoms);
      }
    } catch (err) {
      console.error('Data refresh error:', err);
    }
  }, [backendOnline, activeIncident?.id]);

  // Poll on mount and interval
  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 3000);
    return () => clearInterval(interval);
  }, [refreshData]);

  // Handle Difficulty Level Change
  const handleLevelChange = async (newLevel) => {
    setLevel(newLevel);
    if (newLevel === 2 && backendOnline) {
      await api.setAmbiguousMode(60).catch(() => {});
    }
  };

  // Live Load: Spawn Order
  const handleSpawnOrder = async () => {
    setIsActing(true);
    setOrdersCount((prev) => prev + 1);
    try {
      if (backendOnline) {
        await api.spawnOrder();
        await refreshData();
      }
    } catch (err) {
      console.error('Order spawn error:', err);
    } finally {
      setIsActing(false);
    }
  };

  // Operator submits Diagnosis guess by clicking node in DependencyGraph
  const handleDiagnose = async (guessedService, timedOut = false, timeElapsed = null) => {
    if (!activeIncident) return;
    if (activeIncident.status !== 'awaiting_diagnosis') return;

    setIsActing(true);
    try {
      const timeTaken = timeElapsed !== null ? timeElapsed : (level === 1 ? 60 : level === 2 ? 30 : 10);

      if (backendOnline) {
        const result = await api.diagnoseIncident(
          activeIncident.id,
          guessedService,
          'operator',
          timeTaken,
          timedOut
        );
        if (result && result.incident) {
          const updated = {
            ...result.incident,
            diagnosis: result.diagnosis,
          };
          setActiveIncident(updated);
          setActiveIncidents((prev) =>
            prev.map((inc) => (inc.id === updated.id ? updated : inc))
          );
        }
        // Refresh scoreboard
        const stats = await api.getScoreboard().catch(() => null);
        if (stats) setScoreboardStats(stats);
      } else {
        // Interactive simulation reveal
        const secret = simulationSecret[activeIncident.id] || {
          root_cause_service: 'payment-service',
          root_cause_metric: 'db_query_duration_ms',
          confidence_pct: 88,
          confidence_formula: 'clamp((0.845 - 0.520) / 0.845 * 100, 30, 95) = 88%',
          ranking: [
            { rank: 1, service: 'payment-service', metric: 'db_query_duration_ms', z_score: 8.9, total_score: 0.845 },
            { rank: 2, service: 'order-service', metric: 'request_latency_ms', z_score: 6.4, total_score: 0.520 },
            { rank: 3, service: 'frontend-gateway', metric: 'request_latency_ms', z_score: 5.8, total_score: 0.410 },
          ],
          ai_reasoning: {
            root_cause: 'payment-service database query latency spike (z-score: +8.90)',
            reasoning: 'The weighted scoring engine ranked payment-service highest (score: 0.845). While frontend-gateway registered edge latency first, the dependency graph confirms order-service and gateway are downstream victims waiting on payment-service SQL execution.',
            evidence_summary: '• Service: payment-service\n• Metric: db_query_duration_ms = 2012ms\n• Z-score: +8.90 (extreme deviation > 5.0)\n• Graph distance to symptom: 1 hop upstream\n• Engine confidence: 88%',
          },
          naive_baseline: {
            root_cause: 'frontend-gateway',
            reason: 'earliest anomaly detected at edge',
          },
        };

        const actualService = secret.root_cause_service;
        const isCorrect = timedOut ? null : (guessedService === actualService);

        const diagnosisResult = {
          guessed_service: guessedService,
          actual_service: actualService,
          is_correct: isCorrect,
          timed_out: timedOut,
          time_taken_seconds: timeTaken,
        };

        const updated = {
          ...activeIncident,
          status: 'awaiting_approval',
          root_cause_service: actualService,
          root_cause_metric: secret.root_cause_metric,
          confidence_pct: secret.confidence_pct,
          confidence_formula: secret.confidence_formula,
          scoring_details: { ranking: secret.ranking },
          ai_reasoning: secret.ai_reasoning,
          naive_baseline: secret.naive_baseline,
          recommended_action: `Restart ${actualService} container to restore normal baseline`,
          recovery_target_container: `v01_mvp-${actualService}-1`,
          diagnosis: diagnosisResult,
        };

        setActiveIncident(updated);
        setActiveIncidents((prev) =>
          prev.map((inc) => (inc.id === updated.id ? updated : inc))
        );

        // Update local scoreboard stats
        setScoreboardStats((prev) => {
          const newTotal = prev.incidents_diagnosed + 1;
          const newCorrect = prev.correct_diagnoses + (isCorrect ? 1 : 0);
          const newStreak = isCorrect ? prev.current_streak + 1 : 0;
          return {
            ...prev,
            incidents_diagnosed: newTotal,
            correct_diagnoses: newCorrect,
            accuracy_pct: Math.round((newCorrect / newTotal) * 100),
            avg_time_to_diagnose_seconds: isCorrect ? +(timeTaken).toFixed(1) : prev.avg_time_to_diagnose_seconds,
            current_streak: newStreak,
          };
        });
      }
    } finally {
      setIsActing(false);
    }
  };

  // Actions: Approval Gate
  const handleApprove = async (incidentId) => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.approveIncident(incidentId, 'operator');
        await refreshData();
      } else {
        // Interactive simulation mode
        const incService = activeIncident?.root_cause_service || 'payment-service';
        setActiveIncident((prev) => ({ ...prev, status: 'approved' }));
        setRecoveryStatus({ message: `Restarting container v01_mvp-${incService}-1...` });

        setTimeout(() => {
          setRecoveryStatus({ message: 'Container restarted. Confirming health (attempt 1/15)...' });
          setTimeout(() => {
            // Healed with deliberate 1.2s transition
            setActiveIncident((prev) => ({ ...prev, status: 'healthy' }));
            setServicesHealth([
              { name: 'frontend-gateway', status: 'healthy', latency_ms: 22 },
              { name: 'order-service', status: 'healthy', latency_ms: 18 },
              { name: 'payment-service', status: 'healthy', latency_ms: 12 },
              { name: 'auth-service', status: 'healthy', latency_ms: 15 },
              { name: 'postgres', status: 'healthy', latency_ms: 4 },
            ]);
            setOverallHealth('healthy');
            setIsActing(false);

            // Update scoreboard recovery stats
            setScoreboardStats((prev) => ({
              ...prev,
              avg_time_to_recovery_seconds: +(Math.random() * 5 + 8).toFixed(1),
            }));

            setTimeout(() => {
              setActiveIncidents((prev) => prev.filter((i) => i.id !== incidentId));
              setActiveIncident(null);
              setAnomalies([]);
              setRecoveryStatus(null);
            }, 3000);
          }, 2000);
        }, 1500);
      }
    } catch (err) {
      alert(`Approval error: ${err.message}`);
      setIsActing(false);
    }
  };

  const handleReject = async (incidentId, reason) => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.rejectIncident(incidentId, 'operator', reason);
        await refreshData();
      } else {
        setActiveIncident((prev) => ({ ...prev, status: 'rejected' }));
      }
    } catch (err) {
      alert(`Rejection error: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  const handleTriggerAI = async (incidentId) => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.analyzeIncident(incidentId);
        await refreshData();
      }
    } catch (err) {
      alert(`AI analysis error: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  // Trigger Fault A (DB Latency with slider delay)
  const handleTriggerFaultA = async (delayMs = 2000) => {
    setIsActing(true);
    try {
      if (level === 2 && backendOnline) {
        await api.setAmbiguousMode(60).catch(() => {});
      }

      if (backendOnline) {
        await api.triggerDbLatency(delayMs);
        await refreshData();
      } else {
        // Simulation for Fault A: starts in awaiting_diagnosis
        const incId = 'inc-' + Math.floor(Math.random() * 90000 + 10000);
        setOverallHealth('critical');
        setServicesHealth([
          { name: 'frontend-gateway', status: 'warning', latency_ms: delayMs + 80 },
          { name: 'order-service', status: 'warning', latency_ms: delayMs + 50 },
          { name: 'payment-service', status: 'critical', latency_ms: delayMs + 12 },
          { name: 'auth-service', status: 'healthy', latency_ms: 15 },
          { name: 'postgres', status: 'degraded', latency_ms: delayMs + 4 },
        ]);

        const fakeAnoms = [
          {
            id: 'anom-1',
            service_name: 'frontend-gateway',
            metric_name: 'request_latency_ms',
            metric_value: delayMs + 80,
            baseline_mean: 24.1,
            z_score: 5.8,
            detected_at: new Date(Date.now() - 4000).toISOString(),
          },
          {
            id: 'anom-2',
            service_name: 'order-service',
            metric_name: 'request_latency_ms',
            metric_value: delayMs + 50,
            baseline_mean: 18.2,
            z_score: 6.4,
            detected_at: new Date(Date.now() - 3000).toISOString(),
          },
          {
            id: 'anom-3',
            service_name: 'payment-service',
            metric_name: 'db_query_duration_ms',
            metric_value: delayMs + 12,
            baseline_mean: 4.8,
            z_score: 8.9,
            detected_at: new Date(Date.now() - 2000).toISOString(),
          },
        ];
        setAnomalies(fakeAnoms);

        // Store secret answer
        setSimulationSecret((prev) => ({
          ...prev,
          [incId]: {
            root_cause_service: 'payment-service',
            root_cause_metric: 'db_query_duration_ms',
            confidence_pct: 88,
            confidence_formula: 'clamp((0.845 - 0.520) / 0.845 * 100, 30, 95) = 88%',
            ranking: [
              { rank: 1, service: 'payment-service', metric: 'db_query_duration_ms', z_score: 8.9, total_score: 0.845 },
              { rank: 2, service: 'order-service', metric: 'request_latency_ms', z_score: 6.4, total_score: 0.520 },
              { rank: 3, service: 'frontend-gateway', metric: 'request_latency_ms', z_score: 5.8, total_score: 0.410 },
            ],
            ai_reasoning: {
              root_cause: `payment-service database query latency spike (${delayMs}ms)`,
              reasoning: 'The weighted scoring engine ranked payment-service highest (score: 0.845). Downstream services show timeout symptoms due to database latency.',
              evidence_summary: `• Service: payment-service\n• Metric: db_query_duration_ms = ${delayMs}ms\n• Z-score: +8.90\n• Upstream causal path verified`,
            },
            naive_baseline: { root_cause: 'frontend-gateway', reason: 'earliest anomaly at edge' },
          },
        }));

        // Redacted incident for diagnosis
        const newInc = {
          id: incId,
          status: 'awaiting_diagnosis',
          root_cause_service: null, // REDACTED
          confidence_pct: null,     // REDACTED
          ai_reasoning: null,       // REDACTED
        };
        setActiveIncident(newInc);
        setActiveIncidents([newInc]);
      }
    } finally {
      setIsActing(false);
    }
  };

  // Trigger Fault B (Memory Leak with slider rate)
  const handleTriggerFaultB = async (rateMbPerSec = 10) => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.triggerMemoryLeak(rateMbPerSec);
        await refreshData();
      } else {
        const incId = 'inc-' + Math.floor(Math.random() * 90000 + 10000);
        setOverallHealth('critical');
        setServicesHealth([
          { name: 'frontend-gateway', status: 'healthy', latency_ms: 22 },
          { name: 'order-service', status: 'healthy', latency_ms: 18 },
          { name: 'payment-service', status: 'healthy', latency_ms: 12 },
          { name: 'auth-service', status: 'critical', latency_ms: 120 },
          { name: 'postgres', status: 'healthy', latency_ms: 4 },
        ]);

        const fakeAnoms = [
          {
            id: 'anom-b1',
            service_name: 'auth-service',
            metric_name: 'process_memory_rss_mb',
            metric_value: 512.6,
            baseline_mean: 42.1,
            z_score: 9.4,
            detected_at: new Date().toISOString(),
          },
          {
            id: 'anom-b2',
            service_name: 'auth-service',
            metric_name: 'process_cpu_percent',
            metric_value: 88.2,
            baseline_mean: 5.4,
            z_score: 7.1,
            detected_at: new Date().toISOString(),
          },
        ];
        setAnomalies(fakeAnoms);

        setSimulationSecret((prev) => ({
          ...prev,
          [incId]: {
            root_cause_service: 'auth-service',
            root_cause_metric: 'process_memory_rss_mb',
            confidence_pct: 94,
            confidence_formula: 'clamp((0.920 - 0.210) / 0.920 * 100, 30, 95) = 94%',
            ranking: [
              { rank: 1, service: 'auth-service', metric: 'process_memory_rss_mb', z_score: 9.4, total_score: 0.920 },
            ],
            ai_reasoning: {
              root_cause: `auth-service memory allocation runaway (${rateMbPerSec} MB/s)`,
              reasoning: 'The auth-service path operates independently from PostgreSQL and payment flow. Memory consumption escalated rapidly while CPU peaked in a spin loop.',
              evidence_summary: `• Service: auth-service\n• Metric: memory_mb = 512MB\n• Rate: ${rateMbPerSec} MB/s\n• Isolated branch`,
            },
            naive_baseline: { root_cause: 'auth-service', reason: 'earliest anomaly' },
          },
        }));

        const newInc = {
          id: incId,
          status: 'awaiting_diagnosis',
          root_cause_service: null,
          confidence_pct: null,
          ai_reasoning: null,
        };
        setActiveIncident(newInc);
        setActiveIncidents([newInc]);
      }
    } finally {
      setIsActing(false);
    }
  };

  // Trigger Concurrent Chaos (Level 3: Dual Fault)
  const handleTriggerChaos = async (delayMs = 2000, rateMbPerSec = 10) => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.triggerConcurrentChaos(delayMs, rateMbPerSec);
        await refreshData();
      } else {
        // Simulation for Concurrent Chaos: TWO independent incidents created simultaneously!
        const inc1Id = 'inc-' + Math.floor(Math.random() * 90000 + 10000);
        const inc2Id = 'inc-' + Math.floor(Math.random() * 90000 + 10000);

        setOverallHealth('critical');
        setServicesHealth([
          { name: 'frontend-gateway', status: 'warning', latency_ms: delayMs + 80 },
          { name: 'order-service', status: 'warning', latency_ms: delayMs + 50 },
          { name: 'payment-service', status: 'critical', latency_ms: delayMs + 12 },
          { name: 'auth-service', status: 'critical', latency_ms: 130 },
          { name: 'postgres', status: 'degraded', latency_ms: delayMs + 4 },
        ]);

        const fakeAnoms = [
          {
            id: 'anom-c1',
            service_name: 'payment-service',
            metric_name: 'db_query_duration_ms',
            metric_value: delayMs + 12,
            baseline_mean: 4.8,
            z_score: 8.9,
            detected_at: new Date(Date.now() - 2000).toISOString(),
          },
          {
            id: 'anom-c2',
            service_name: 'auth-service',
            metric_name: 'process_memory_rss_mb',
            metric_value: 512.6,
            baseline_mean: 42.1,
            z_score: 9.4,
            detected_at: new Date(Date.now() - 1500).toISOString(),
          },
        ];
        setAnomalies(fakeAnoms);

        setSimulationSecret((prev) => ({
          ...prev,
          [inc1Id]: {
            root_cause_service: 'payment-service',
            root_cause_metric: 'db_query_duration_ms',
            confidence_pct: 88,
            confidence_formula: 'clamp((0.845 - 0.520) / 0.845 * 100, 30, 95) = 88%',
            ranking: [{ rank: 1, service: 'payment-service', metric: 'db_query_duration_ms', z_score: 8.9, total_score: 0.845 }],
            ai_reasoning: {
              root_cause: `payment-service database query latency spike (${delayMs}ms)`,
              reasoning: 'Independent order-flow domain failure caused by database query delay.',
              evidence_summary: `• Service: payment-service\n• Latency: ${delayMs}ms`,
            },
            naive_baseline: { root_cause: 'order-service', reason: 'first edge arrival' },
          },
          [inc2Id]: {
            root_cause_service: 'auth-service',
            root_cause_metric: 'process_memory_rss_mb',
            confidence_pct: 94,
            confidence_formula: 'clamp((0.920 - 0.210) / 0.920 * 100, 30, 95) = 94%',
            ranking: [{ rank: 1, service: 'auth-service', metric: 'process_memory_rss_mb', z_score: 9.4, total_score: 0.920 }],
            ai_reasoning: {
              root_cause: `auth-service memory allocation runaway (${rateMbPerSec} MB/s)`,
              reasoning: 'Independent auth domain failure caused by memory leak.',
              evidence_summary: `• Service: auth-service\n• Rate: ${rateMbPerSec} MB/s`,
            },
            naive_baseline: { root_cause: 'auth-service', reason: 'earliest anomaly' },
          },
        }));

        const inc1 = {
          id: inc1Id,
          status: 'awaiting_diagnosis',
          root_cause_service: null,
          domain: 'order_flow',
        };
        const inc2 = {
          id: inc2Id,
          status: 'awaiting_diagnosis',
          root_cause_service: null,
          domain: 'auth',
        };

        setActiveIncidents([inc1, inc2]);
        setActiveIncident(inc1);
      }
    } finally {
      setIsActing(false);
    }
  };

  // Reset All Faults
  const handleReset = async () => {
    setIsActing(true);
    try {
      if (backendOnline) {
        await api.resetFaults();
        await refreshData();
      } else {
        setOverallHealth('healthy');
        setServicesHealth([
          { name: 'frontend-gateway', status: 'healthy', latency_ms: 22 },
          { name: 'order-service', status: 'healthy', latency_ms: 18 },
          { name: 'payment-service', status: 'healthy', latency_ms: 12 },
          { name: 'auth-service', status: 'healthy', latency_ms: 15 },
          { name: 'postgres', status: 'healthy', latency_ms: 4 },
        ]);
        setActiveIncidents([]);
        setActiveIncident(null);
        setAnomalies([]);
        setRecoveryStatus(null);
      }
    } finally {
      setIsActing(false);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-base text-text-primary overflow-hidden font-sans select-none">
      {/* 1. Header Bar: System Status + Embedded Scoreboard */}
      <StatusBar
        overallHealth={overallHealth}
        activeIncident={activeIncident}
        serviceCount={servicesHealth.length}
        scoreboardStats={scoreboardStats}
      />

      {/* 2. Middle Row: Dependency Graph (60%) + Incident Panel (40%) */}
      <div className="flex-1 min-h-0 grid grid-cols-12 overflow-hidden">
        {/* Left ~60%: Dependency Graph */}
        <div className="col-span-7 h-full overflow-hidden">
          <DependencyGraph
            graphData={graphData}
            servicesHealth={servicesHealth}
            activeIncident={activeIncident}
            onSelectService={setSelectedService}
            onDiagnose={handleDiagnose}
          />
        </div>

        {/* Right ~40%: Incident Panel */}
        <div className="col-span-5 h-full overflow-hidden">
          <IncidentPanel
            incident={activeIncident}
            activeIncidents={activeIncidents}
            onSelectIncident={setActiveIncident}
            recoveryStatus={recoveryStatus}
            level={level}
            onApprove={handleApprove}
            onReject={handleReject}
            onDiagnose={handleDiagnose}
            onTriggerAI={handleTriggerAI}
            isActing={isActing}
          />
        </div>
      </div>

      {/* 3. Evidence Timeline (Full Width Strip) */}
      <div className="h-[135px] flex-shrink-0">
        <EvidenceTimeline
          anomalies={anomalies}
          activeIncident={activeIncident}
        />
      </div>

      {/* 4. Operator Mode Live Controls (Bottom Bar) */}
      <OperatorControls
        level={level}
        onLevelChange={handleLevelChange}
        onSpawnOrder={handleSpawnOrder}
        ordersCount={ordersCount}
        onTriggerFaultA={handleTriggerFaultA}
        onTriggerFaultB={handleTriggerFaultB}
        onTriggerChaos={handleTriggerChaos}
        onResetFaults={handleReset}
        isActing={isActing}
      />
    </div>
  );
}
