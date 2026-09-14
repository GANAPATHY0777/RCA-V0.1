// Initialize OpenTelemetry FIRST
require('../../shared/tracing');

const express = require('express');
const logger = require('../../shared/logger');
const { requestMetricsMiddleware } = require('../../shared/metrics');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(requestMetricsMiddleware);

// ============================================================
// FAULT INJECTION STATE
// ============================================================
let memoryLeakActive = false;
let memoryLeakInterval = null;
const leakedBuffers = []; // Intentionally leaked memory

// Health check
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const memoryMB = memUsage.rss / (1024 * 1024);
  const status = memoryMB > 256 ? 'degraded' : 'healthy';

  res.json({
    status,
    service: 'auth-service',
    memory_mb: Math.round(memoryMB * 10) / 10,
    fault_active: memoryLeakActive,
    timestamp: new Date().toISOString(),
  });
});

// Verify token (simple auth logic — not real auth, just real work)
app.post('/verify', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  // Simulate CPU work during memory leak
  if (memoryLeakActive) {
    // Burn some CPU cycles to simulate load
    const start = Date.now();
    while (Date.now() - start < 50) {
      Math.random() * Math.random();
    }
  }

  // Simple token validation (for demo purposes)
  const valid = token.length > 3;
  logger.info('Token verified', { valid, token_length: token.length });

  res.json({
    valid,
    user: valid ? 'demo-user' : null,
    service: 'auth-service',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// FAULT INJECTION ENDPOINTS (Step 2)
// ============================================================

/**
 * POST /faults/auth-memory-leak
 * Body: { "rate_mb_per_sec": 10 }
 * Allocates growing memory buffers and burns CPU over time.
 */
app.post('/faults/auth-memory-leak', (req, res) => {
  const rateMBPerSec = req.body.rate_mb_per_sec || 10;

  if (memoryLeakInterval) {
    clearInterval(memoryLeakInterval);
  }

  memoryLeakActive = true;

  // Allocate memory every 500ms
  const chunkSizeBytes = Math.floor((rateMBPerSec * 1024 * 1024) / 2); // 2 allocations per second
  memoryLeakInterval = setInterval(() => {
    // Allocate memory buffer and keep reference to prevent GC
    const buffer = Buffer.alloc(chunkSizeBytes, 'x');
    leakedBuffers.push(buffer);

    // Also burn CPU
    const start = Date.now();
    while (Date.now() - start < 100) {
      Math.random() * Math.random();
    }

    const memMB = process.memoryUsage().rss / (1024 * 1024);
    logger.warn('Memory leak active', {
      leaked_buffers: leakedBuffers.length,
      memory_mb: Math.round(memMB),
      rate_mb_per_sec: rateMBPerSec,
    });
  }, 500);

  logger.warn('FAULT INJECTED: auth-memory-leak', { rate_mb_per_sec: rateMBPerSec });
  res.json({ status: 'fault_active', fault: 'auth-memory-leak', rate_mb_per_sec: rateMBPerSec });
});

/**
 * POST /faults/reset
 * Resets all active faults, clears leaked memory.
 */
app.post('/faults/reset', (req, res) => {
  memoryLeakActive = false;

  if (memoryLeakInterval) {
    clearInterval(memoryLeakInterval);
    memoryLeakInterval = null;
  }

  // Free leaked buffers
  leakedBuffers.length = 0;

  // Force GC if exposed
  if (global.gc) {
    global.gc();
  }

  logger.info('FAULTS RESET: auth-service');
  res.json({ status: 'faults_cleared', service: 'auth-service' });
});

app.listen(PORT, () => {
  logger.info(`auth-service listening on port ${PORT}`);
});
