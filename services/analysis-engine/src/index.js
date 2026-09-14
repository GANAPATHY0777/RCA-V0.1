// Initialize OpenTelemetry FIRST
require('../../shared/tracing');

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const logger = require('../../shared/logger');
const { requestMetricsMiddleware } = require('../../shared/metrics');

// Sub-modules
const { createTelemetryRouter, telemetryStore } = require('./telemetry');
const { createGraphRouter, graphBuilder } = require('./graph');
const { createCorrelationRouter, correlationEngine } = require('./correlation');
const { createIncidentRouter, computeScoreboardStats } = require('./incidents');
const { createRecoveryRouter } = require('./recovery');

const app = express();
const PORT = process.env.PORT || 3020;

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'rcadb',
  user: process.env.DB_USER || 'rca',
  password: process.env.DB_PASSWORD || 'rca_password',
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS diagnosis_log (
        id SERIAL PRIMARY KEY,
        incident_id INTEGER REFERENCES incidents(id),
        operator VARCHAR(255) NOT NULL,
        guessed_service VARCHAR(255),
        actual_service VARCHAR(255),
        is_correct BOOLEAN,
        timed_out BOOLEAN DEFAULT FALSE,
        time_taken_seconds DOUBLE PRECISION,
        diagnosed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_diagnosis_incident ON diagnosis_log(incident_id);
    `);
    logger.info('Database tables verified/migrated');
  } catch (err) {
    logger.error('DB table migration failed', { error: err.message });
  }
}
initDb();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(requestMetricsMiddleware);

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'analysis-engine', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: 'analysis-engine', error: err.message });
  }
});

// Mount sub-routers
app.use('/api/telemetry', createTelemetryRouter(pool));
app.use('/api/graph', createGraphRouter(pool));
app.use('/api/correlation', createCorrelationRouter(pool));
app.use('/api/incidents', createIncidentRouter(pool));
app.use('/api/recovery', createRecoveryRouter(pool));

// Direct scoreboard endpoint
app.get('/api/scoreboard', async (req, res) => {
  try {
    const stats = await computeScoreboardStats(pool);
    res.json(stats);
  } catch (err) {
    logger.error('Scoreboard endpoint error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Ambiguous mode / threshold helper endpoint (Level 2)
app.post('/api/thresholds/ambiguous', async (req, res) => {
  try {
    const duration = req.body?.duration_seconds || 60;
    // Lower threshold on downstream order-service so both payment-service and order-service alert
    const response = await fetch('http://anomaly-detector:3010/thresholds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_name: 'order-service',
        warning: 1.5,
        critical: 2.5,
        duration_seconds: duration,
      }),
    });
    const data = await response.json();
    res.json({ status: 'ambiguous_thresholds_applied', data });
  } catch (err) {
    logger.warn('Could not set ambiguous thresholds on anomaly-detector', { error: err.message });
    res.json({ status: 'mock_ambiguous_thresholds_applied' });
  }
});

// Service health aggregation endpoint (for dashboard)
app.get('/api/services/health', async (req, res) => {
  const services = [
    { name: 'frontend-gateway', url: 'http://frontend-gateway:3000/health' },
    { name: 'order-service', url: 'http://order-service:3001/health' },
    { name: 'payment-service', url: 'http://payment-service:3002/health' },
    { name: 'auth-service', url: 'http://auth-service:3003/health' },
  ];

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(svc.url, { signal: controller.signal });
        clearTimeout(timeout);
        const data = await response.json();
        return { name: svc.name, ...data };
      } catch (err) {
        return { name: svc.name, status: 'unreachable', error: err.message, timestamp: new Date().toISOString() };
      }
    })
  );

  // Add postgres health
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const latency = Date.now() - start;
    results.push({ name: 'postgres', status: latency > 1000 ? 'degraded' : 'healthy', latency_ms: latency, timestamp: new Date().toISOString() });
  } catch (err) {
    results.push({ name: 'postgres', status: 'unreachable', error: err.message, timestamp: new Date().toISOString() });
  }

  const overallStatus = results.every(r => r.status === 'healthy') ? 'healthy'
    : results.some(r => r.status === 'unreachable') ? 'critical'
    : 'degraded';

  res.json({ overall: overallStatus, services: results });
});

app.listen(PORT, () => {
  logger.info(`analysis-engine listening on port ${PORT}`);
});
