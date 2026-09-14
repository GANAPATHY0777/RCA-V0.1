// Initialize OpenTelemetry FIRST
require('../../shared/tracing');

const express = require('express');
const { Pool } = require('pg');
const logger = require('../../shared/logger');
const { requestMetricsMiddleware } = require('../../shared/metrics');

const app = express();
const PORT = process.env.PORT || 3001;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3002';

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'rcadb',
  user: process.env.DB_USER || 'rca',
  password: process.env.DB_PASSWORD || 'rca_password',
});

app.use(express.json());
app.use(requestMetricsMiddleware);

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'order-service', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', service: 'order-service', error: err.message });
  }
});

// Create order — calls payment-service
app.post('/orders', async (req, res) => {
  const { customer_name, item, quantity, total_amount } = req.body;
  
  if (!customer_name || !item || !total_amount) {
    return res.status(400).json({ error: 'Missing required fields: customer_name, item, total_amount' });
  }

  try {
    // 1. Insert order
    const orderResult = await pool.query(
      'INSERT INTO orders (customer_name, item, quantity, total_amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [customer_name, item, quantity || 1, total_amount, 'pending']
    );
    const order = orderResult.rows[0];
    logger.info('Order created', { order_id: order.id, customer: customer_name });

    // 2. Call payment-service to process payment
    const paymentResponse = await fetch(`${PAYMENT_SERVICE_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.id, amount: total_amount }),
    });

    if (!paymentResponse.ok) {
      const paymentError = await paymentResponse.json();
      logger.error('Payment processing failed', { order_id: order.id, error: paymentError });
      await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['payment_failed', order.id]);
      return res.status(502).json({ error: 'Payment processing failed', order, payment_error: paymentError });
    }

    const payment = await paymentResponse.json();

    // 3. Update order status
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', ['completed', order.id]);
    order.status = 'completed';

    logger.info('Order completed', { order_id: order.id, payment_id: payment.id });
    res.status(201).json({ order, payment });
  } catch (err) {
    logger.error('Order creation failed', { error: err.message });
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
});

// List orders
app.get('/orders', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    logger.error('Failed to list orders', { error: err.message });
    res.status(500).json({ error: 'Internal error', details: err.message });
  }
});

app.listen(PORT, () => {
  logger.info(`order-service listening on port ${PORT}`);
});
