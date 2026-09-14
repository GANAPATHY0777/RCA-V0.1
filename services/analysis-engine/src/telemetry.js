/**
 * Telemetry Ingestion & Storage (Step 3)
 * 
 * Receives spans and metrics from OTel Collector and individual services.
 * Stores in both Postgres and an in-memory time-series buffer for fast anomaly detection queries.
 */

const express = require('express');
const logger = require('../../shared/logger');

// In-memory time-series store for fast queries
// Structure: { service_name: { metric_name: [{ value, timestamp }] } }
const metricsStore = {};
const spansStore = [];
const MAX_METRICS_WINDOW = 300; // Keep last 300 data points per metric per service (~25 min at 5s interval)
const MAX_SPANS = 10000;

function getMetricsStore() {
  return metricsStore;
}

function getSpansStore() {
  return spansStore;
}

function createTelemetryRouter(pool) {
  const router = express.Router();

  /**
   * POST /api/telemetry/metrics
   * Ingests metric data points from services.
   * Body: [{ service_name, metric_name, metric_value, unit, attributes, timestamp }]
   */
  router.post('/metrics', async (req, res) => {
    const metrics = Array.isArray(req.body) ? req.body : [req.body];

    for (const m of metrics) {
      const { service_name, metric_name, metric_value, unit, attributes, timestamp } = m;

      if (!service_name || !metric_name || metric_value === undefined) continue;

      // Store in memory
      if (!metricsStore[service_name]) metricsStore[service_name] = {};
      if (!metricsStore[service_name][metric_name]) metricsStore[service_name][metric_name] = [];

      const series = metricsStore[service_name][metric_name];
      series.push({
        value: metric_value,
        timestamp: timestamp || new Date().toISOString(),
      });

      // Trim to window
      if (series.length > MAX_METRICS_WINDOW) {
        series.splice(0, series.length - MAX_METRICS_WINDOW);
      }

      // Also persist to Postgres (async, non-blocking)
      pool.query(
        'INSERT INTO telemetry_metrics (service_name, metric_name, metric_value, unit, attributes, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
        [service_name, metric_name, metric_value, unit || null, JSON.stringify(attributes || {}), timestamp || new Date().toISOString()]
      ).catch(err => {
        // Silently fail DB write — in-memory is primary for MVP
      });
    }

    res.status(202).json({ accepted: metrics.length });
  });

  /**
   * POST /api/telemetry/spans
   * Ingests span data from OTel Collector.
   * Body: spans in OTLP JSON format or simplified format
   */
  router.post('/spans', async (req, res) => {
    try {
      let spans = [];

      // Handle OTLP JSON format
      if (req.body.resourceSpans) {
        for (const rs of req.body.resourceSpans) {
          const serviceName = rs.resource?.attributes?.find(a => a.key === 'service.name')?.value?.stringValue || 'unknown';
          for (const ss of (rs.scopeSpans || [])) {
            for (const span of (ss.spans || [])) {
              spans.push({
                trace_id: span.traceId,
                span_id: span.spanId,
                parent_span_id: span.parentSpanId || null,
                service_name: serviceName,
                operation_name: span.name,
                start_time: parseInt(span.startTimeUnixNano) || 0,
                end_time: parseInt(span.endTimeUnixNano) || 0,
                duration_ms: (parseInt(span.endTimeUnixNano) - parseInt(span.startTimeUnixNano)) / 1e6,
                status_code: span.status?.code || 0,
                attributes: span.attributes || {},
              });
            }
          }
        }
      } else if (Array.isArray(req.body)) {
        spans = req.body;
      }

      // Store spans
      for (const span of spans) {
        spansStore.push(span);

        // Persist to Postgres
        pool.query(
          `INSERT INTO telemetry_spans (trace_id, span_id, parent_span_id, service_name, operation_name, start_time, end_time, duration_ms, status_code, attributes) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [span.trace_id, span.span_id, span.parent_span_id, span.service_name, span.operation_name,
           span.start_time, span.end_time, span.duration_ms, span.status_code, JSON.stringify(span.attributes)]
        ).catch(() => {});
      }

      // Trim in-memory spans
      if (spansStore.length > MAX_SPANS) {
        spansStore.splice(0, spansStore.length - MAX_SPANS);
      }

      res.status(202).json({ accepted: spans.length });
    } catch (err) {
      logger.error('Span ingestion error', { error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * GET /api/telemetry/metrics/latest
   * Returns the latest metrics for all services (used by anomaly detector).
   */
  router.get('/metrics/latest', (req, res) => {
    const result = {};
    for (const [service, metrics] of Object.entries(metricsStore)) {
      result[service] = {};
      for (const [metric, series] of Object.entries(metrics)) {
        result[service][metric] = {
          latest: series[series.length - 1],
          count: series.length,
          series: series.slice(-60), // Last 60 data points
        };
      }
    }
    res.json(result);
  });

  /**
   * GET /api/telemetry/metrics/series
   * Returns full metric series for a specific service and metric.
   */
  router.get('/metrics/series', (req, res) => {
    const { service, metric } = req.query;
    if (!service || !metric) {
      return res.status(400).json({ error: 'service and metric query params required' });
    }
    const series = metricsStore[service]?.[metric] || [];
    res.json({ service, metric, series });
  });

  return router;
}

module.exports = { createTelemetryRouter, telemetryStore: { getMetricsStore, getSpansStore } };
