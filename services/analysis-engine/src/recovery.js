/**
 * Recovery Execution & Verification (Step 10)
 * 
 * On approval, executes a real container restart via the Docker Engine API.
 * Polls the service health endpoint every 2 seconds for up to 30 seconds.
 * Reports: recovering → healthy  OR  recovering → recovery_failed → triggers re-analysis.
 * 
 * HARD REQUIREMENT: No recovery action executes without prior human approval (Step 9).
 */

const express = require('express');
const Docker = require('dockerode');
const logger = require('../../shared/logger');

// Connect to Docker socket
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const SERVICE_HEALTH_URLS = {
  'frontend-gateway': 'http://frontend-gateway:3000/health',
  'order-service': 'http://order-service:3001/health',
  'payment-service': 'http://payment-service:3002/health',
  'auth-service': 'http://auth-service:3003/health',
};

/**
 * Poll a service's health endpoint.
 * Returns true if healthy, false otherwise.
 */
async function checkServiceHealth(serviceName) {
  const url = SERVICE_HEALTH_URLS[serviceName];
  if (!url) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    return data.status === 'healthy';
  } catch (err) {
    return false;
  }
}

/**
 * Find a Docker container by service name.
 * Searches by container name patterns commonly used by docker-compose.
 */
async function findContainer(serviceName) {
  try {
    const containers = await docker.listContainers({ all: true });
    
    // Try multiple naming patterns
    const patterns = [
      serviceName,
      `v01_mvp-${serviceName}-1`,
      `v01-mvp-${serviceName}-1`,
      `v0.1_mvp-${serviceName}-1`,
      `v01_mvp_${serviceName}_1`,
    ];

    for (const container of containers) {
      const names = container.Names.map(n => n.replace(/^\//, ''));
      for (const pattern of patterns) {
        if (names.some(n => n.includes(pattern))) {
          return docker.getContainer(container.Id);
        }
      }
    }

    logger.error('Container not found', { serviceName, available: containers.map(c => c.Names) });
    return null;
  } catch (err) {
    logger.error('Docker API error', { error: err.message });
    return null;
  }
}

function createRecoveryRouter(pool) {
  const router = express.Router();

  /**
   * POST /api/recovery/execute
   * Execute recovery for an approved incident.
   * Body: { incident_id, container_name, service_name }
   * 
   * This endpoint is called internally ONLY after approval.
   */
  router.post('/execute', async (req, res) => {
    const { incident_id, service_name } = req.body;

    try {
      // SAFETY CHECK: Verify incident is in 'approved' state
      const incidentResult = await pool.query('SELECT * FROM incidents WHERE id = $1', [incident_id]);
      if (incidentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      const incident = incidentResult.rows[0];
      if (incident.status !== 'approved') {
        logger.error('SAFETY: Attempted recovery without approval', { incident_id, status: incident.status });
        return res.status(403).json({
          error: 'Recovery BLOCKED — incident is not in approved state',
          current_status: incident.status,
        });
      }

      // Update status to recovering
      await pool.query(
        "UPDATE incidents SET status = 'recovering', updated_at = NOW() WHERE id = $1",
        [incident_id]
      );

      logger.info('Starting recovery', { incident_id, service_name });

      // First, reset any active faults on the service
      try {
        const faultResetUrl = SERVICE_HEALTH_URLS[service_name]?.replace('/health', '/faults/reset');
        if (faultResetUrl) {
          await fetch(faultResetUrl, { method: 'POST' });
          logger.info('Faults reset before container restart', { service_name });
        }
      } catch (err) {
        logger.warn('Could not reset faults pre-restart', { error: err.message });
      }

      // Find and restart the container
      const container = await findContainer(service_name);

      if (container) {
        logger.info('Restarting container', { service_name });
        await container.restart({ t: 5 }); // 5 second grace period
        logger.info('Container restart initiated', { service_name });
      } else {
        logger.warn('Container not found, attempting fault reset only', { service_name });
      }

      // Poll health endpoint every 2 seconds for up to 30 seconds
      let healthy = false;
      const maxAttempts = 15;
      const pollInterval = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        healthy = await checkServiceHealth(service_name);
        logger.info('Health poll', { service_name, attempt, healthy });

        if (healthy) {
          break;
        }
      }

      if (healthy) {
        // Recovery succeeded
        await pool.query(
          "UPDATE incidents SET status = 'healthy', resolved_at = NOW(), updated_at = NOW() WHERE id = $1",
          [incident_id]
        );
        logger.info('Recovery SUCCEEDED', { incident_id, service_name });
        res.json({
          incident_id,
          status: 'healthy',
          message: `${service_name} restarted and confirmed healthy`,
        });
      } else {
        // Recovery failed
        await pool.query(
          "UPDATE incidents SET status = 'recovery_failed', updated_at = NOW() WHERE id = $1",
          [incident_id]
        );
        logger.error('Recovery FAILED', { incident_id, service_name });
        res.json({
          incident_id,
          status: 'recovery_failed',
          message: `${service_name} did not return to healthy state after restart`,
        });
      }
    } catch (err) {
      logger.error('Recovery execution error', { error: err.message, incident_id });

      await pool.query(
        "UPDATE incidents SET status = 'recovery_failed', updated_at = NOW() WHERE id = $1",
        [incident_id]
      ).catch(() => {});

      res.status(500).json({ error: err.message, incident_id });
    }
  });

  /**
   * GET /api/recovery/status/:incident_id
   * Check current recovery status.
   */
  router.get('/status/:incident_id', async (req, res) => {
    try {
      const result = await pool.query('SELECT id, status, root_cause_service, updated_at, resolved_at FROM incidents WHERE id = $1', [req.params.incident_id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Incident not found' });
      }
      const incident = result.rows[0];

      // Also check current service health
      let currentHealth = null;
      if (incident.root_cause_service) {
        currentHealth = await checkServiceHealth(incident.root_cause_service);
      }

      res.json({
        ...incident,
        current_service_health: currentHealth,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRecoveryRouter };
