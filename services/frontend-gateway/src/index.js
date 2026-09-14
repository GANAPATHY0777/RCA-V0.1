// Initialize OpenTelemetry FIRST — before any other imports
require('../../shared/tracing');

const express = require('express');
const cors = require('cors');
const logger = require('../../shared/logger');
const { requestMetricsMiddleware } = require('../../shared/metrics');

const app = express();
const PORT = process.env.PORT || 3000;

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3001';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3003';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3002';

app.use(cors());
app.use(express.json());
app.use(requestMetricsMiddleware);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'frontend-gateway', timestamp: new Date().toISOString() });
});

// Proxy: Create order
app.post('/api/orders', async (req, res) => {
  try {
    const payload = (req.body && req.body.customer_name) ? req.body : {
      customer_name: `operator-${Math.floor(Math.random() * 10000)}`,
      item: 'operator-widget',
      quantity: 1,
      total_amount: +(Math.random() * 50 + 10).toFixed(2),
    };

    const response = await fetch(`${ORDER_SERVICE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error('Failed to proxy order creation', { error: err.message });
    res.status(502).json({ error: 'Order service unavailable', details: err.message });
  }
});

// Proxy: List orders
app.get('/api/orders', async (req, res) => {
  try {
    const response = await fetch(`${ORDER_SERVICE_URL}/orders`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error('Failed to proxy order listing', { error: err.message });
    res.status(502).json({ error: 'Order service unavailable', details: err.message });
  }
});

// Proxy: Auth verify
app.get('/api/auth/verify', async (req, res) => {
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: req.headers.authorization || 'demo-token' }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error('Failed to proxy auth verify', { error: err.message });
    res.status(502).json({ error: 'Auth service unavailable', details: err.message });
  }
});

// Proxy: Fault injection — DB latency
app.post('/api/faults/db-latency', async (req, res) => {
  try {
    const response = await fetch(`${PAYMENT_SERVICE_URL}/faults/db-latency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error('Failed to trigger DB latency fault', { error: err.message });
    res.status(502).json({ error: 'Payment service unavailable' });
  }
});

// Proxy: Fault injection — auth memory leak
app.post('/api/faults/auth-memory-leak', async (req, res) => {
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/faults/auth-memory-leak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    logger.error('Failed to trigger auth memory leak', { error: err.message });
    res.status(502).json({ error: 'Auth service unavailable' });
  }
});

// Proxy: Reset faults on both services
app.post('/api/faults/reset', async (req, res) => {
  const results = {};
  try {
    const paymentReset = await fetch(`${PAYMENT_SERVICE_URL}/faults/reset`, { method: 'POST' });
    results.payment = await paymentReset.json();
  } catch (err) {
    results.payment = { error: err.message };
  }
  try {
    const authReset = await fetch(`${AUTH_SERVICE_URL}/faults/reset`, { method: 'POST' });
    results.auth = await authReset.json();
  } catch (err) {
    results.auth = { error: err.message };
  }
  res.json({ status: 'faults_reset', results });
});

app.listen(PORT, () => {
  logger.info(`frontend-gateway listening on port ${PORT}`);
});
