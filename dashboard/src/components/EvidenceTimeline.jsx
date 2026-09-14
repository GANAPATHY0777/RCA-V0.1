import React from 'react';

/**
 * Evidence Timeline Component (Step 11)
 * Horizontal strip showing time-ordered anomaly events with causal connectors.
 * Directly beside/below: Evidence-based ranking vs Naive baseline shown side-by-side.
 */
export default function EvidenceTimeline({ anomalies, activeIncident }) {
  const recentAnomalies = anomalies ? anomalies.slice(0, 8).reverse() : [];

  // Extract ranking and naive baseline from active incident
  let scoringDetails = activeIncident?.scoring_details;
  if (typeof scoringDetails === 'string') {
    try { scoringDetails = JSON.parse(scoringDetails); } catch (e) {}
  }

  let naiveBaseline = activeIncident?.naive_baseline;
  if (typeof naiveBaseline === 'string') {
    try { naiveBaseline = JSON.parse(naiveBaseline); } catch (e) {}
  }

  const ranking = scoringDetails?.ranking || [];
  const topCandidate = ranking[0];

  return (
    <div className="h-full flex flex-col bg-surface border-t border-border">
      {/* Zone Header */}
      <div className="h-8 border-b border-border px-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold tracking-wider text-text-primary uppercase">
            Evidence Timeline &amp; Causal Attribution
          </span>
          <span className="text-xs text-text-muted">
            · live z-score anomaly feed &amp; baseline divergence
          </span>
        </div>
        <div className="text-[11px] text-text-muted data-value">
          Window: 30s rolling · Threshold: |z| &gt; 3.0
        </div>
      </div>

      {/* Main Grid: Left side timeline, Right side comparison */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left 7 cols: Anomaly Event Stream with Causal Connectors */}
        <div className="col-span-7 border-r border-border p-3 flex flex-col justify-center overflow-x-auto">
          {recentAnomalies.length === 0 ? (
            <div className="text-xs text-text-muted py-3 flex items-center space-x-2">
              <span className="w-1.5 h-1.5 rounded-full bg-healthy"></span>
              <span>No active anomalies detected in recent telemetry window. All metrics within 3σ baseline.</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 min-w-max py-1">
              {recentAnomalies.map((anom, idx) => {
                const isRootCause = activeIncident && anom.service_name === activeIncident.root_cause_service;
                const timeStr = anom.detected_at
                  ? new Date(anom.detected_at).toISOString().substring(11, 19)
                  : '--:--:--';

                return (
                  <React.Fragment key={anom.id || idx}>
                    {/* Anomaly Node Card */}
                    <div className={`p-2 border text-xs min-w-[150px] ${
                      isRootCause
                        ? 'border-critical bg-critical/10'
                        : 'border-border bg-base/60'
                    }`}>
                      <div className="flex justify-between items-center text-[10px] text-text-muted mb-1">
                        <span className="data-value">{timeStr}</span>
                        <span className={`px-1 py-0.2 text-[9px] font-medium ${
                          Math.abs(anom.z_score) > 5 ? 'text-critical' : 'text-warning'
                        }`}>
                          z: {anom.z_score ? Number(anom.z_score).toFixed(1) : '>3'}
                        </span>
                      </div>
                      <div className="font-semibold text-text-primary text-[11px] truncate">
                        {anom.service_name}
                      </div>
                      <div className="text-[10px] text-text-secondary truncate data-value">
                        {anom.metric_name}
                      </div>
                      <div className="text-[9px] text-text-muted mt-0.5 data-value">
                        val: {anom.metric_value !== undefined ? Number(anom.metric_value).toFixed(1) : ''}
                      </div>
                    </div>

                    {/* Connecting causal line */}
                    {idx < recentAnomalies.length - 1 && (
                      <div className="flex items-center text-text-muted">
                        <div className="w-4 h-[1px] bg-signal"></div>
                        <span className="text-[10px] text-signal font-mono">→</span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 5 cols: Side-by-Side Comparison (Your Engine vs Naive Baseline) */}
        <div className="col-span-5 p-3 flex flex-col justify-center bg-base/30 space-y-2">
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider flex items-center justify-between">
            <span>Root Cause Attribution Comparison</span>
            {activeIncident && (
              <span className="text-[10px] text-signal data-value">
                Incident #{activeIncident.id ? activeIncident.id.slice(0, 6) : ''}
              </span>
            )}
          </div>

          {/* Row 1: Evidence-Based AI Engine */}
          <div className="border border-signal/40 bg-signal/5 p-2 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-signal"></span>
              <div>
                <div className="text-[10px] text-signal font-medium uppercase">
                  Evidence-Based Engine (3-Factor Formula)
                </div>
                <div className="font-semibold text-text-primary text-xs">
                  {topCandidate ? topCandidate.service : (activeIncident?.root_cause_service || 'No incident')}
                </div>
              </div>
            </div>
            <div className="text-right data-value">
              <span className="text-signal font-bold text-xs">
                {activeIncident?.confidence_pct ? `${activeIncident.confidence_pct}%` : 'Score: 0.85'}
              </span>
              <div className="text-[9px] text-text-muted">
                temporal + graph + severity
              </div>
            </div>
          </div>

          {/* Row 2: Naive First-Arrival Baseline */}
          <div className="border border-border bg-surface/80 p-2 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-text-muted"></span>
              <div>
                <div className="text-[10px] text-text-muted uppercase">
                  Naive Baseline (First Arrival Only)
                </div>
                <div className="font-medium text-text-secondary text-xs">
                  {naiveBaseline?.root_cause || (recentAnomalies[0]?.service_name || 'frontend-gateway')}
                </div>
              </div>
            </div>
            <div className="text-right text-[10px] text-text-muted data-value">
              <span>{naiveBaseline?.reason || 'earliest anomaly'}</span>
              <div className="text-[9px] text-warning">
                ignores topology
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
