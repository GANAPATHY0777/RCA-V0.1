/**
 * Custom metrics collection for each service.
 * Tracks: CPU usage, memory RSS, request latency, error count, request count.
 * Pushes metrics to the analysis engine's telemetry endpoint for the anomaly detector.
 */

const os = require('os');
const { metrics } = require('@opentelemetry/api');

const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';
const analysisEngineUrl = process.env.ANALYSIS_ENGINE_URL || 'http://analysis-engine:3020';

// OTel meter for standard metric export
const meter = metrics.getMeter(serviceName);

// Counters and histograms
const requestCounter = meter.createCounter('http_requests_total', {
  description: 'Total HTTP requests',
});

const errorCounter = meter.createCounter('http_errors_total', {
  description: 'Total HTTP errors',
});

const latencyHistogram = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

// Track last CPU usage for delta calculation
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

function getCpuPercent() {
  const now = Date.now();
  const elapsed = (now - lastCpuTime) * 1000; // to microseconds
  const currentUsage = process.cpuUsage(lastCpuUsage);
  const totalCpu = currentUsage.user + currentUsage.system;
  const cpuPercent = (totalCpu / elapsed) * 100;
  lastCpuUsage = process.cpuUsage();
  lastCpuTime = now;
  return Math.min(cpuPercent, 100);
}

function getMemoryMB() {
  return process.memoryUsage().rss / (1024 * 1024);
}

// Push metrics to analysis engine for anomaly detection
async function pushMetrics() {
  const cpuPercent = getCpuPercent();
  const memoryMB = getMemoryMB();

  const metricsPayload = [
    {
      service_name: serviceName,
      metric_name: 'cpu_percent',
      metric_value: cpuPercent,
      unit: 'percent',
      timestamp: new Date().toISOString(),
    },
    {
      service_name: serviceName,
      metric_name: 'memory_mb',
      metric_value: memoryMB,
      unit: 'megabytes',
      timestamp: new Date().toISOString(),
    },
  ];

  try {
    await fetch(`${analysisEngineUrl}/api/telemetry/metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metricsPayload),
    });
  } catch (err) {
    // Silent fail — telemetry should not crash the service
  }
}

// Start periodic push (every 5 seconds)
const metricsInterval = setInterval(pushMetrics, 5000);

// Express middleware to track request metrics
function requestMetricsMiddleware(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const labels = { method: req.method, path: req.route?.path || req.path, status: res.statusCode.toString() };
    
    requestCounter.add(1, labels);
    latencyHistogram.record(duration, labels);
    
    if (res.statusCode >= 400) {
      errorCounter.add(1, labels);
    }

    // Push request-level metrics
    try {
      fetch(`${analysisEngineUrl}/api/telemetry/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          {
            service_name: serviceName,
            metric_name: 'request_latency_ms',
            metric_value: duration,
            unit: 'ms',
            attributes: labels,
            timestamp: new Date().toISOString(),
          },
          {
            service_name: serviceName,
            metric_name: 'request_count',
            metric_value: 1,
            unit: 'count',
            attributes: labels,
            timestamp: new Date().toISOString(),
          },
          ...(res.statusCode >= 400 ? [{
            service_name: serviceName,
            metric_name: 'error_count',
            metric_value: 1,
            unit: 'count',
            attributes: labels,
            timestamp: new Date().toISOString(),
          }] : []),
        ]),
      }).catch(() => {});
    } catch (err) {
      // Silent fail
    }
  });

  next();
}

// Cleanup
process.once('SIGTERM', () => clearInterval(metricsInterval));
process.once('SIGINT', () => clearInterval(metricsInterval));

module.exports = {
  requestMetricsMiddleware,
  getCpuPercent,
  getMemoryMB,
};
