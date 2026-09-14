import React, { useState, useEffect, useRef } from 'react';

/**
 * Incident Panel Component with Operator Mode Diagnose Flow (Steps 2, 3, 4)
 * 
 * In awaiting_diagnosis:
 *   - Hides root cause, confidence score, and AI reasoning.
 *   - Instrument-styled countdown/stopwatch in IBM Plex Mono (shifts to amber in final 5s).
 *   - Prompts operator to click a node in DependencyGraph to submit diagnosis.
 * 
 * On reveal (awaiting_approval):
 *   - Displays clear Correct / Incorrect / Timed Out verdict banner first.
 *   - Displays full AI verdict (Signal Blue), ranked candidate scoring table, and naive baseline.
 *   - Gated Approve / Reject recovery buttons appear only after reveal.
 */
export default function IncidentPanel({
  incident,
  activeIncidents = [],
  onSelectIncident,
  recoveryStatus,
  level = 1,
  onApprove,
  onReject,
  onDiagnose,
  onTriggerAI,
  isActing,
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  // Timer state for diagnosis
  const [secondsRemaining, setSecondsRemaining] = useState(level === 1 ? 60 : level === 2 ? 30 : 0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);

  const isAwaitingDiagnosis = incident && incident.status === 'awaiting_diagnosis';
  const isAwaitingApproval = incident && incident.status === 'awaiting_approval';
  const isApproved = incident && (incident.status === 'approved' || incident.status === 'recovering');
  const isResolved = incident && incident.status === 'healthy';
  const isRejected = incident && incident.status === 'rejected';
  const isFailed = incident && incident.status === 'recovery_failed';
  const isAnalyzing = incident && incident.status === 'analyzing';

  // Initialize and run timer when entering awaiting_diagnosis
  useEffect(() => {
    if (!isAwaitingDiagnosis) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const initialSeconds = level === 1 ? 60 : level === 2 ? 30 : 0;
    setSecondsRemaining(initialSeconds);
    setElapsedSeconds(0);

    const startTime = Date.now();

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTime) / 1000);
      setElapsedSeconds(elapsed);

      if (level === 1 || level === 2) {
        const remaining = Math.max(0, initialSeconds - elapsed);
        setSecondsRemaining(remaining);

        if (remaining === 0) {
          clearInterval(timerRef.current);
          // Auto-reveal on timeout
          if (onDiagnose && incident) {
            onDiagnose(null, true, elapsed);
          }
        }
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [incident?.id, isAwaitingDiagnosis, level]);

  // If no active incident
  if (!incident) {
    return (
      <div className="h-full flex flex-col bg-surface border-l border-border p-6 justify-center items-center text-center select-none">
        <div className="w-10 h-10 rounded-full border border-border flex items-center justify-center mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-healthy"></span>
        </div>
        <h2 className="text-sm font-semibold text-text-primary mb-1">
          No Active Incidents
        </h2>
        <p className="text-xs text-text-secondary max-w-xs leading-relaxed">
          Use the Operator Controls below to spawn load, adjust fault sliders, or trigger Chaos.
        </p>
        <div className="mt-6 pt-6 border-t border-border w-full text-left text-xs text-text-muted space-y-1">
          <div className="flex justify-between">
            <span>Operator Mode:</span>
            <span className="text-signal data-value">LEVEL {level} READY</span>
          </div>
          <div className="flex justify-between">
            <span>Correlation Engine:</span>
            <span className="text-healthy data-value">ONLINE</span>
          </div>
          <div className="flex justify-between">
            <span>Diagnose Flow:</span>
            <span className="text-text-primary data-value">GRAPH NODE-CLICK</span>
          </div>
        </div>
      </div>
    );
  }

  // Parse AI reasoning if stored as JSON string
  let aiData = incident.ai_reasoning;
  if (typeof aiData === 'string') {
    try {
      aiData = JSON.parse(aiData);
    } catch (e) {
      aiData = { reasoning: aiData };
    }
  }

  // Parse scoring details and naive baseline
  const scoring = typeof incident.scoring_details === 'string'
    ? JSON.parse(incident.scoring_details || '{}')
    : incident.scoring_details || {};
  const naive = typeof incident.naive_baseline === 'string'
    ? JSON.parse(incident.naive_baseline || '{}')
    : incident.naive_baseline || {};

  const diagnosis = incident.diagnosis;

  // Format timer MM:SS
  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isWarningTime = (level === 1 || level === 2) && secondsRemaining <= 5;

  return (
    <div className={`h-full flex flex-col bg-surface border-l border-border ${isResolved ? 'incident-panel-exit' : ''}`}>
      {/* Incident Switcher Strip (if multiple active incidents in Concurrent Chaos) */}
      {activeIncidents.length > 1 && (
        <div className="bg-base border-b border-border px-3 py-1.5 flex items-center gap-2 overflow-x-auto text-[11px]">
          <span className="text-text-muted uppercase text-[10px] font-semibold tracking-wider">
            Active Incidents:
          </span>
          {activeIncidents.map((inc, idx) => (
            <button
              key={inc.id}
              onClick={() => onSelectIncident && onSelectIncident(inc)}
              className={`px-2 py-0.5 rounded border transition-colors flex items-center gap-1.5 ${
                inc.id === incident.id
                  ? 'bg-panel border-signal text-white font-semibold shadow-sm'
                  : 'bg-base border-border text-text-secondary hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                inc.status === 'awaiting_diagnosis' ? 'bg-warning animate-pulse' :
                inc.status === 'awaiting_approval' ? 'bg-signal' :
                inc.status === 'approved' || inc.status === 'recovering' ? 'bg-signal animate-pulse' :
                'bg-healthy'
              }`} />
              <span>#{inc.id} {inc.root_cause_service ? `(${inc.root_cause_service})` : `(Domain ${idx + 1})`}</span>
            </button>
          ))}
        </div>
      )}

      {/* Panel Header */}
      <div className="h-9 border-b border-border px-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold tracking-wider text-text-primary uppercase">
            Incident Investigation
          </span>
          <span className="text-xs text-text-muted data-value">
            #{incident.id}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className={`text-[11px] px-2 py-0.5 font-medium ${
            isResolved ? 'bg-healthy/20 text-healthy' :
            isAwaitingDiagnosis ? 'bg-warning/20 text-warning font-semibold animate-pulse' :
            isAwaitingApproval ? 'bg-signal/20 text-signal' :
            isApproved ? 'bg-signal/20 text-signal' :
            isFailed ? 'bg-critical/20 text-critical' :
            'bg-text-muted/20 text-text-secondary'
          }`}>
            {isResolved ? 'Resolved' :
             isAwaitingDiagnosis ? 'Awaiting Operator Diagnosis' :
             isAwaitingApproval ? 'Awaiting Operator Approval' :
             isApproved ? 'Recovery in progress' :
             isFailed ? 'Recovery failed' :
             isRejected ? 'Rejected by operator' :
             'Analyzing root cause'}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ============================================================ */}
        {/* STATE 1: AWAITING DIAGNOSIS (HIDDEN REVEAL + COUNTDOWN TIMER) */}
        {/* ============================================================ */}
        {isAwaitingDiagnosis && (
          <div className="space-y-4">
            {/* Instrument-Style Diagnosis Timer Card */}
            <div className="border border-border bg-base p-4 flex flex-col items-center justify-center text-center space-y-2">
              <div className="text-[11px] text-text-muted uppercase tracking-widest font-medium">
                {level === 3 ? 'Time to Diagnose (Untimed Challenge)' : 'Diagnosis Time Remaining'}
              </div>
              <div
                id="diagnosis-timer"
                className={`text-3xl tracking-wider font-bold data-value transition-colors ${
                  isWarningTime ? 'text-warning' : 'text-text-primary'
                }`}
              >
                {level === 3 ? formatTime(elapsedSeconds) : formatTime(secondsRemaining)}
              </div>
              <div className="text-[11px] text-text-secondary max-w-sm">
                Reason from the active telemetry timeline and topology connections. Root cause attribution is withheld until you submit.
              </div>
            </div>

            {/* Instruction Banner */}
            <div className="border border-warning/40 bg-warning/5 p-3 flex items-start gap-2.5 rounded">
              <span className="text-warning font-bold text-sm">▶</span>
              <div className="text-xs text-text-primary space-y-1">
                <div className="font-semibold text-warning uppercase tracking-wide text-[11px]">
                  Action Required: Click Susppected Node
                </div>
                <div className="text-text-secondary text-[11px] leading-relaxed">
                  Click directly on a node in the <strong>Dependency Topology</strong> to submit your root cause guess.
                </div>
              </div>
            </div>

            {/* Manual Skip / Auto-Reveal Option */}
            <div className="text-center pt-2">
              <button
                onClick={() => onDiagnose && onDiagnose(null, true, elapsedSeconds)}
                className="text-[11px] text-text-muted hover:text-text-secondary underline transition-colors"
              >
                Skip diagnosis and reveal AI answer
              </button>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* STATE 2: REVEALED (DIAGNOSIS RESULT + FULL AI VERDICT)        */}
        {/* ============================================================ */}
        {!isAwaitingDiagnosis && (
          <>
            {/* Operator Diagnosis Verdict Banner (Step 3) */}
            {diagnosis && (
              <div
                id="diagnosis-result-banner"
                className={`border p-3 rounded flex items-start gap-3 ${
                  diagnosis.timed_out
                    ? 'border-warning/50 bg-amber-950/20 text-warning'
                    : diagnosis.is_correct
                    ? 'border-healthy/50 bg-green-950/20 text-healthy'
                    : 'border-critical/50 bg-red-950/20 text-critical'
                }`}
              >
                <div className="text-lg font-bold">
                  {diagnosis.timed_out ? '⏱' : diagnosis.is_correct ? '✓' : '✕'}
                </div>
                <div className="text-xs space-y-0.5">
                  <div className="font-bold text-[12px] uppercase tracking-wide">
                    {diagnosis.timed_out
                      ? 'Diagnosis Timed Out'
                      : diagnosis.is_correct
                      ? `Correct — you found it in ${diagnosis.time_taken_seconds || 0}s`
                      : `Not quite — you guessed ${diagnosis.guessed_service}`}
                  </div>
                  <div className="text-text-secondary text-[11px]">
                    {diagnosis.is_correct
                      ? `Identified actual root cause ${diagnosis.actual_service}.`
                      : `Actual root cause is ${diagnosis.actual_service}. See AI evidence breakdown below.`}
                  </div>
                </div>
              </div>
            )}

            {/* Identified Root Cause Service & Confidence Strip */}
            <div className="border border-border p-3 flex items-center justify-between bg-base/30">
              <div>
                <div className="text-[11px] text-text-muted mb-0.5">Identified Root Cause Service</div>
                <div className="text-base font-semibold text-text-primary flex items-center gap-2">
                  <span>{incident.root_cause_service || 'Investigating...'}</span>
                  {diagnosis?.is_correct && (
                    <span className="text-[10px] bg-healthy/20 text-healthy px-1.5 py-0.5 rounded font-medium">
                      Matched Your Guess
                    </span>
                  )}
                </div>
                {incident.root_cause_metric && (
                  <div className="text-xs text-text-secondary data-value mt-0.5">
                    Metric: {incident.root_cause_metric}
                  </div>
                )}
              </div>

              <div className="text-right">
                <div className="text-[11px] text-text-muted mb-0.5">Derived Confidence</div>
                <div className="text-2xl font-bold text-signal data-value tracking-tight">
                  {incident.confidence_pct ? `${incident.confidence_pct}%` : 'N/A'}
                </div>
                {incident.confidence_formula && (
                  <div className="text-[10px] text-text-muted data-value max-w-[160px] truncate" title={incident.confidence_formula}>
                    {incident.confidence_formula}
                  </div>
                )}
              </div>
            </div>

            {/* AI Reasoning Section — Signal Blue Accent */}
            <div className="border-l-2 border-signal bg-base/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="w-1.5 h-1.5 bg-signal"></span>
                  <span className="text-xs font-semibold text-signal uppercase tracking-wider">
                    AI Reasoning Analysis (Claude Sonnet 5)
                  </span>
                </div>
                {isAnalyzing && (
                  <button
                    onClick={() => onTriggerAI && onTriggerAI(incident.id)}
                    disabled={isActing}
                    className="text-[11px] text-signal hover:underline disabled:opacity-50"
                  >
                    Run analysis now
                  </button>
                )}
              </div>

              {aiData ? (
                <div className="space-y-2 text-xs text-text-primary font-sans leading-relaxed">
                  {aiData.root_cause && (
                    <div className="font-medium text-text-primary">
                      {aiData.root_cause}
                    </div>
                  )}
                  {aiData.reasoning && (
                    <p className="text-text-secondary text-xs">
                      {aiData.reasoning}
                    </p>
                  )}
                  {aiData.evidence_summary && (
                    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] text-text-muted whitespace-pre-line data-value">
                      {aiData.evidence_summary}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-text-secondary py-2">
                  Evaluating telemetry signals and assembling causal path evidence...
                </div>
              )}
            </div>

            {/* Candidate Ranking with Mathematical Scores */}
            {scoring.ranking && scoring.ranking.length > 0 && (
              <div className="border border-border p-3 space-y-2">
                <div className="text-[11px] text-text-muted uppercase tracking-wider font-medium flex items-center justify-between">
                  <span>Candidate Scoring Breakdown</span>
                  <span className="text-[10px] text-text-secondary font-mono">
                    w1=0.35, w2=0.40, w3=0.25
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-text-muted font-mono">
                        <th className="py-1 pr-2">Rank</th>
                        <th className="py-1 pr-2">Service</th>
                        <th className="py-1 pr-2">Metric</th>
                        <th className="py-1 pr-2">Z-Score</th>
                        <th className="py-1 pr-2">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-mono">
                      {scoring.ranking.map((c, i) => (
                        <tr key={i} className={i === 0 ? 'text-signal font-semibold' : 'text-text-secondary'}>
                          <td className="py-1 pr-2">#{c.rank || i + 1}</td>
                          <td className="py-1 pr-2">{c.service}</td>
                          <td className="py-1 pr-2 text-[10px]">{c.metric}</td>
                          <td className="py-1 pr-2">{c.z_score?.toFixed(2)}</td>
                          <td className="py-1 pr-2">{c.total_score?.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Naive Baseline Comparison Strip */}
            {naive.root_cause && (
              <div className="border border-border/80 bg-base/30 p-2.5 rounded text-[11px] space-y-1">
                <div className="flex items-center justify-between text-text-muted">
                  <span className="uppercase text-[10px] tracking-wider font-semibold">
                    Naive Baseline (First-Arrival at Edge)
                  </span>
                  <span className="text-warning font-mono">
                    {naive.root_cause}
                  </span>
                </div>
                <p className="text-text-secondary text-[10px] leading-relaxed">
                  Naive timestamp sorting picks <strong>{naive.root_cause}</strong> because it reported first. 
                  The evidence-based engine correctly isolated <strong>{incident.root_cause_service}</strong> via topology traversal.
                </p>
              </div>
            )}

            {/* Recommended Recovery Action */}
            <div className="border border-border p-3 space-y-1.5">
              <div className="text-[11px] text-text-muted uppercase tracking-wider">
                Recommended Action
              </div>
              <div className="text-xs font-medium text-text-primary">
                {incident.recommended_action || (aiData && aiData.recommended_action) || `Restart ${incident.root_cause_service} container to clear fault state`}
              </div>
              <div className="text-[11px] text-text-muted">
                Target Container: <span className="data-value text-text-secondary">{incident.recovery_target_container || `${incident.root_cause_service}`}</span>
              </div>
            </div>

            {/* Live Recovery Progress & Verification */}
            {isApproved && (
              <div className="border border-border p-3 bg-base/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary">Recovery Execution Status</span>
                  <span className="text-signal data-value">Restarting &amp; Polling</span>
                </div>
                <div className="h-1 bg-border overflow-hidden">
                  <div className="h-full bg-signal animate-pulse w-3/4"></div>
                </div>
                <div className="text-[11px] text-text-muted">
                  {recoveryStatus?.message || `Restart initiated. Polling health endpoint every 2s (up to 30s)...`}
                </div>
              </div>
            )}

            {isResolved && (
              <div className="border border-healthy/40 bg-healthy/5 p-3 text-xs text-healthy">
                ✓ Restart verified. {incident.root_cause_service} confirmed healthy on port check.
              </div>
            )}

            {isFailed && (
              <div className="border border-critical/40 bg-critical/5 p-3 text-xs text-critical">
                ✕ Recovery failed to confirm health within 30s. Re-analysis scheduled.
              </div>
            )}
          </>
        )}
      </div>

      {/* ============================================================ */}
      {/* APPROVAL & RECOVERY CONTROLS — STRICTLY GATED BEHIND REVEAL   */}
      {/* ============================================================ */}
      <div className="p-4 border-t border-border bg-surface">
        {isAwaitingDiagnosis && (
          <div className="text-center text-xs text-text-muted py-1 font-mono">
            [RECOVERY LOCKED] SUBMIT DIAGNOSIS TO UNLOCK OPERATOR APPROVAL GATE
          </div>
        )}

        {isAwaitingApproval && !showRejectInput && (
          <div className="space-y-2">
            <div className="text-[11px] text-text-muted text-center mb-1">
              Diagnosis complete. Operator approval required to execute container restart.
            </div>
            <div className="flex space-x-2">
              <button
                id="approve-recovery-btn"
                onClick={() => onApprove(incident.id)}
                disabled={isActing}
                className="flex-1 py-2 bg-healthy hover:bg-healthy/90 text-base font-semibold text-xs transition-colors disabled:opacity-50"
              >
                {isActing ? 'Executing...' : 'Approve Recovery Action'}
              </button>
              <button
                id="reject-recovery-btn"
                onClick={() => setShowRejectInput(true)}
                disabled={isActing}
                className="px-4 py-2 border border-border hover:border-critical text-text-secondary hover:text-critical text-xs transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {showRejectInput && (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full bg-base border border-border px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-critical"
            />
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  onReject(incident.id, rejectReason);
                  setShowRejectInput(false);
                }}
                disabled={isActing}
                className="flex-1 py-1.5 bg-critical text-white text-xs font-medium disabled:opacity-50"
              >
                Confirm Rejection
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                className="px-3 py-1.5 border border-border text-xs text-text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isAwaitingDiagnosis && !isAwaitingApproval && (
          <div className="text-center text-xs text-text-muted py-1">
            {isApproved ? 'Operator approved · Container restart in progress' :
             isResolved ? 'Incident completed and verified' :
             isRejected ? 'Operator rejected action' :
             'Evaluating evidence signals...'}
          </div>
        )}
      </div>
    </div>
  );
}
