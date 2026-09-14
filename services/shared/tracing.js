/**
 * OpenTelemetry SDK Initialization — shared across all Node.js services.
 * MUST be required as the very first import in each service's entry point.
 * 
 * Usage: require('../shared/tracing');
 * 
 * Env vars:
 *   OTEL_SERVICE_NAME — name of this service (required)
 *   OTEL_EXPORTER_OTLP_ENDPOINT — OTel collector endpoint (default: http://otel-collector:4318)
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
    }),
    exportIntervalMillis: 5000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
    }),
  ],
});

sdk.start();
console.log(`[OTel] Tracing initialized for service: ${serviceName}`);

process.once('SIGTERM', async () => {
  await sdk.shutdown();
});

process.once('SIGINT', async () => {
  await sdk.shutdown();
});

module.exports = { sdk };
