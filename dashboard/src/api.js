/**
 * API Client — all communication with the analysis engine and gateway.
 * Uses relative URLs when behind Vite proxy, or env var for direct access.
 */

const API_BASE = import.meta.env.VITE_ANALYSIS_ENGINE_URL || '';
const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_URL || '';

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

export const api = {
  // Service health
  getServicesHealth: () => fetchJSON(`${API_BASE}/api/services/health`),

  // Dependency graph
  getGraph: () => fetchJSON(`${API_BASE}/api/graph`),

  // Incidents
  getIncidents: () => fetchJSON(`${API_BASE}/api/incidents`),
  getActiveIncident: () => fetchJSON(`${API_BASE}/api/incidents/active`),
  getActiveIncidentsAll: () => fetchJSON(`${API_BASE}/api/incidents/active-all`),
  getIncident: (id) => fetchJSON(`${API_BASE}/api/incidents/${id}`),
  analyzeIncident: (id) => fetchJSON(`${API_BASE}/api/incidents/${id}/analyze`, { method: 'POST' }),
  diagnoseIncident: (id, guessedService, operator = 'operator', timeTakenSeconds = 0, timedOut = false) => fetchJSON(`${API_BASE}/api/incidents/${id}/diagnose`, {
    method: 'POST',
    body: JSON.stringify({
      guessed_service: guessedService,
      operator,
      time_taken_seconds: timeTakenSeconds,
      timed_out: timedOut,
    }),
  }),
  approveIncident: (id, user = 'operator') => fetchJSON(`${API_BASE}/api/incidents/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ user }),
  }),
  rejectIncident: (id, user = 'operator', reason = 'Rejected by operator') => fetchJSON(`${API_BASE}/api/incidents/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ user, reason }),
  }),

  // Scoreboard
  getScoreboard: () => fetchJSON(`${API_BASE}/api/scoreboard`),

  // Recovery status
  getRecoveryStatus: (incidentId) => fetchJSON(`${API_BASE}/api/recovery/status/${incidentId}`),

  // Anomalies
  getRecentAnomalies: (minutes = 10) => fetchJSON(`${API_BASE}/api/correlation/anomalies/recent?minutes=${minutes}`),

  // Telemetry
  getMetricsLatest: () => fetchJSON(`${API_BASE}/api/telemetry/metrics/latest`),

  // Order spawning (load creation)
  spawnOrder: (payload) => fetchJSON(`${GATEWAY_BASE}/api/orders`, {
    method: 'POST',
    body: JSON.stringify(payload || {
      customer_name: `operator-${Math.floor(Math.random() * 10000)}`,
      item: 'widget-pro',
      quantity: 1,
      total_amount: 39.99,
    }),
  }),

  // Ambiguous mode (Level 2)
  setAmbiguousMode: (durationSeconds = 60) => fetchJSON(`${API_BASE}/api/thresholds/ambiguous`, {
    method: 'POST',
    body: JSON.stringify({ duration_seconds: durationSeconds }),
  }),

  // Fault injection (via gateway proxy)
  triggerDbLatency: (delayMs = 2000) => fetchJSON(`${GATEWAY_BASE}/api/faults/db-latency`, {
    method: 'POST',
    body: JSON.stringify({ delay_ms: delayMs }),
  }),
  triggerMemoryLeak: (rateMbPerSec = 10) => fetchJSON(`${GATEWAY_BASE}/api/faults/auth-memory-leak`, {
    method: 'POST',
    body: JSON.stringify({ rate_mb_per_sec: rateMbPerSec }),
  }),
  triggerConcurrentChaos: async (delayMs = 2000, rateMbPerSec = 10) => {
    // Fire both back-to-back simultaneously
    const [resA, resB] = await Promise.all([
      fetchJSON(`${GATEWAY_BASE}/api/faults/db-latency`, {
        method: 'POST',
        body: JSON.stringify({ delay_ms: delayMs }),
      }),
      fetchJSON(`${GATEWAY_BASE}/api/faults/auth-memory-leak`, {
        method: 'POST',
        body: JSON.stringify({ rate_mb_per_sec: rateMbPerSec }),
      }),
    ]);
    return { faultA: resA, faultB: resB };
  },
  resetFaults: () => fetchJSON(`${GATEWAY_BASE}/api/faults/reset`, { method: 'POST' }),
};
