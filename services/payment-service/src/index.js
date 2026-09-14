// Initialize OpenTelemetry FIRST
require('../../shared/tracing');

const express = require('express');
const { Pool } = require('pg');
const logger = require('../../shared/logger');
const { requestMetricsMiddleware } = require('../../shared/metrics');

const app = express();
const PORT = process.env.PORT || 3002;

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'rcadb',
  user: process.env.DB_USER || 'rca',
  password: process.env.DB_PASSWORD || 'rca_password',
});

app.use(express.json());
app.use(requestMetricsMiddleware);

// ============================================================
// FAULT INJECTION STATE
// ============================================================
let dbLatencyMs = 0; // 0 = no fault, >0 = injected delay in ms

// Health check
app.get('/health', async (req, res) => {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const latency = Date.now() - start;
    const status = latency > 1000 ? 'degraded' : 'healthy';
    res.json({
      status,
      service: 'payment-service',
      db_latency_ms: latency,
      fault_active: dbLatencyMs > 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: 'payment-service', error: err.message });
  }
});

// Process payment — writes to Postgres
app.post('/process', async (req, res) => {
  const { order_id, amount } = req.body;

  if (!order_id || !amount) {
    return res.status(400).json({ error: 'Missing required fields: order_id, amount' });
  }

  try {
    // Apply fault injection: artificial DB latency
    if (dbLatencyMs > 0) {
      logger.warn('Fault active: injecting DB latency', { delay_ms: dbLatencyMs });
      await pool.query(`SELECT pg_sleep($1)`, [dbLatencyMs / 1000]);
    }

    const result = await pool.query(
      'INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, $3) RETURNING *',
      [order_id, amount, 'processed']
    );
    const payment = result.rows[0];
    logger.info('Payment processed', { payment_id: payment.id, order_id, amount });
    res.status(201).json(payment);
  } catch (err) {
    logger.error('Payment processing failed', { error: err.message, order_id });
    res.status(500).json({ error: 'Payment failed', details: err.message });
  }
});

// ============================================================
// FAULT INJECTION ENDPOINTS (Step 2)
// ============================================================

/**
 * POST /faults/db-latency
 * Body: { "delay_ms": 2000 }
 * Adds an artificial delay to all DB queries using pg_sleep().
 */
app.post('/faults/db-latency', (req, res) => {
  const { delay_ms } = req.body;
  if (!delay_ms || delay_ms < 0) {
    return res.status(400).json({ error: 'delay_ms must be a positive number' });
  }
  dbLatencyMs = delay_ms;
  logger.warn('FAULT INJECTED: DB latency', { delay_ms: dbLatencyMs });
  res.json({ status: 'fault_active', fault: 'db-latency', delay_ms: dbLatencyMs });
});

/**
 * POST /faults/reset
 * Resets all active faults.
 */
app.post('/faults/reset', (req, res) => {
  dbLatencyMs = 0;
  logger.info('FAULTS RESET: payment-service');
  res.json({ status: 'faults_cleared', service: 'payment-service' });
});

app.listen(PORT, () => {
  logger.info(`payment-service listening on port ${PORT}`);
});
