"""
Anomaly Detection Engine (Step 4)

Pulls metrics from the analysis engine every 5 seconds.
Runs a rolling z-score over each metric stream per service.

THRESHOLDS (documented):
  - z-score > 3.0  →  WARNING anomaly
  - z-score > 5.0  →  CRITICAL anomaly

These thresholds are based on standard statistical practice:
  - z > 3 means the value is >3 standard deviations from the rolling mean,
    which occurs <0.3% of the time in normal distributions.
  - z > 5 is extreme and almost certainly indicates a real fault.

WINDOW: 30 samples (~150 seconds at 5-second intervals).
  Chosen to balance responsiveness (detect faults within ~30 seconds)
  with stability (avoid false positives from brief spikes).

This engine runs CONTINUOUSLY against LIVE metrics, not precomputed fixtures.
"""

import asyncio
import logging
import json
import time
from collections import defaultdict
from datetime import datetime

import numpy as np
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configuration
ANALYSIS_ENGINE_URL = "http://analysis-engine:3020"
POLL_INTERVAL_SECONDS = 5
Z_SCORE_WINDOW = 30  # Rolling window size (number of samples)
Z_SCORE_THRESHOLD_WARNING = 3.0
Z_SCORE_THRESHOLD_CRITICAL = 5.0

# Metrics to monitor per service
MONITORED_METRICS = [
    "cpu_percent",
    "memory_mb",
    "request_latency_ms",
    "error_count",
]

# Structured JSON logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anomaly-detector")


class MetricBuffer:
    """Rolling buffer for metric values with z-score computation."""

    def __init__(self, window_size: int = Z_SCORE_WINDOW):
        self.window_size = window_size
        self.values: list[float] = []

    def add(self, value: float):
        self.values.append(value)
        if len(self.values) > self.window_size * 2:
            # Keep some extra history but trim periodically
            self.values = self.values[-self.window_size:]

    def compute_z_score(self) -> dict | None:
        """Compute z-score of the latest value against the rolling window."""
        if len(self.values) < 5:
            # Need minimum samples to compute meaningful statistics
            return None

        window = self.values[-self.window_size:] if len(self.values) >= self.window_size else self.values[:]
        latest = self.values[-1]

        mean = float(np.mean(window[:-1]))  # Mean of window excluding latest
        std = float(np.std(window[:-1]))     # Std of window excluding latest

        if std < 0.001:
            # Near-zero std — can't compute meaningful z-score
            # But if the value is significantly different from mean, flag it
            if abs(latest - mean) > 1.0:
                # Use a synthetic z-score based on absolute deviation
                z_score = abs(latest - mean) / max(0.1, mean * 0.01)
                return {
                    "z_score": min(z_score, 20.0),
                    "mean": mean,
                    "std": std,
                    "value": latest,
                }
            return None

        z_score = (latest - mean) / std

        return {
            "z_score": float(z_score),
            "mean": mean,
            "std": std,
            "value": latest,
        }


# Global state
metric_buffers: dict[str, dict[str, MetricBuffer]] = defaultdict(lambda: defaultdict(MetricBuffer))
detection_running = False
detected_anomalies: list[dict] = []
service_threshold_overrides: dict[str, dict] = {}

app = FastAPI(title="Anomaly Detection Engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "anomaly-detector",
        "detection_running": detection_running,
        "buffered_services": list(metric_buffers.keys()),
        "threshold_overrides": service_threshold_overrides,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.post("/thresholds")
async def set_thresholds(body: dict):
    """Set temporary per-service threshold overrides (for Ambiguous mode)."""
    service = body.get("service_name")
    if not service:
        return {"error": "service_name required"}
    duration = body.get("duration_seconds", 60)
    service_threshold_overrides[service] = {
        "warning": float(body.get("warning", 1.5)),
        "critical": float(body.get("critical", 3.0)),
        "expires_at": time.time() + duration,
    }
    logger.info(f"Threshold override set for {service}: warning={service_threshold_overrides[service]['warning']}, duration={duration}s")
    return {"status": "override_set", "service": service, "config": service_threshold_overrides[service]}


@app.post("/thresholds/reset")
async def reset_thresholds():
    """Reset all threshold overrides back to standard."""
    service_threshold_overrides.clear()
    logger.info("All threshold overrides cleared")
    return {"status": "reset"}


@app.get("/anomalies/recent")
async def recent_anomalies():
    """Return recently detected anomalies."""
    return detected_anomalies[-100:]  # Last 100


@app.get("/buffers")
async def get_buffers():
    """Debug endpoint: show current buffer state."""
    result = {}
    for service, metrics in metric_buffers.items():
        result[service] = {}
        for metric, buf in metrics.items():
            result[service][metric] = {
                "count": len(buf.values),
                "latest": buf.values[-1] if buf.values else None,
                "window": buf.values[-10:] if buf.values else [],
            }
    return result


async def fetch_metrics():
    """Pull latest metrics from the analysis engine."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(f"{ANALYSIS_ENGINE_URL}/api/telemetry/metrics/latest")
            if response.status_code == 200:
                return response.json()
            else:
                logger.warning(f"Metrics fetch returned {response.status_code}")
                return {}
        except Exception as e:
            logger.warning(f"Failed to fetch metrics: {e}")
            return {}


async def post_anomaly(anomaly: dict):
    """Send detected anomaly to the analysis engine."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.post(
                f"{ANALYSIS_ENGINE_URL}/api/correlation/anomalies",
                json=anomaly,
            )
            if response.status_code in (200, 201):
                logger.info(f"Anomaly posted: {anomaly['service_name']}/{anomaly['metric_name']} z={anomaly['z_score']:.2f}")
            else:
                logger.warning(f"Anomaly post returned {response.status_code}: {response.text}")
        except Exception as e:
            logger.error(f"Failed to post anomaly: {e}")


async def detection_loop():
    """Main detection loop — runs continuously against live metrics."""
    global detection_running
    detection_running = True

    logger.info("Anomaly detection loop started")
    logger.info(f"Config: window={Z_SCORE_WINDOW}, warning_threshold={Z_SCORE_THRESHOLD_WARNING}, critical_threshold={Z_SCORE_THRESHOLD_CRITICAL}")

    while True:
        try:
            metrics_data = await fetch_metrics()

            for service_name, metrics in metrics_data.items():
                for metric_name, metric_info in metrics.items():
                    if metric_name not in MONITORED_METRICS:
                        continue

                    latest = metric_info.get("latest")
                    if not latest:
                        continue

                    value = latest.get("value", 0)
                    buffer = metric_buffers[service_name][metric_name]
                    buffer.add(value)

                    # Compute z-score
                    result = buffer.compute_z_score()
                    if result is None:
                        continue

                    z = result["z_score"]

                    # Check dynamic or standard thresholds
                    warn_thresh = Z_SCORE_THRESHOLD_WARNING
                    crit_thresh = Z_SCORE_THRESHOLD_CRITICAL

                    if service_name in service_threshold_overrides:
                        override = service_threshold_overrides[service_name]
                        if time.time() <= override.get("expires_at", 0):
                            warn_thresh = override.get("warning", warn_thresh)
                            crit_thresh = override.get("critical", crit_thresh)
                        else:
                            del service_threshold_overrides[service_name]

                    if abs(z) >= warn_thresh:
                        severity = "critical" if abs(z) >= crit_thresh else "warning"

                        anomaly = {
                            "service_name": service_name,
                            "metric_name": metric_name,
                            "metric_value": result["value"],
                            "baseline_mean": result["mean"],
                            "baseline_std": result["std"],
                            "z_score": z,
                            "severity": severity,
                            "timestamp": datetime.utcnow().isoformat(),
                        }

                        detected_anomalies.append(anomaly)
                        # Trim history
                        if len(detected_anomalies) > 500:
                            detected_anomalies.pop(0)

                        logger.warning(
                            json.dumps({
                                "event": "anomaly_detected",
                                "service": service_name,
                                "metric": metric_name,
                                "value": round(result["value"], 2),
                                "mean": round(result["mean"], 2),
                                "std": round(result["std"], 2),
                                "z_score": round(z, 2),
                                "severity": severity,
                            })
                        )

                        # Post to analysis engine
                        await post_anomaly(anomaly)

        except Exception as e:
            logger.error(f"Detection loop error: {e}")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup():
    """Start the detection loop on application startup."""
    asyncio.create_task(detection_loop())
