/**
 * Structured JSON logger.
 * Outputs one JSON object per line for easy parsing.
 */

const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';

function formatLog(level, message, extra = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: serviceName,
    message,
    ...extra,
  });
}

const logger = {
  info: (message, extra) => console.log(formatLog('info', message, extra)),
  warn: (message, extra) => console.warn(formatLog('warn', message, extra)),
  error: (message, extra) => console.error(formatLog('error', message, extra)),
  debug: (message, extra) => console.log(formatLog('debug', message, extra)),
};

module.exports = logger;
