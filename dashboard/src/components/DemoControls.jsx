import React, { useState } from 'react';

/**
 * Demo Controls Component (Step 11)
 * Understated bottom bar for triggering and resetting demo fault scenarios.
 */
export default function DemoControls({ onTriggerFaultA, onTriggerFaultB, onReset, isActing }) {
  const [feedback, setFeedback] = useState(null);

  const handleAction = async (actionFn, label) => {
    try {
      setFeedback(`Injecting: ${label}...`);
      await actionFn();
      setFeedback(`Active: ${label}`);
      setTimeout(() => setFeedback(null), 5000);
    } catch (err) {
      setFeedback(`Error: ${err.message}`);
      setTimeout(() => setFeedback(null), 5000);
    }
  };

  return (
    <footer className="h-11 bg-surface border-t border-border px-4 flex items-center justify-between select-none">
      <div className="flex items-center space-x-3">
        <span className="text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Demo Controls
        </span>
        <span className="text-border">|</span>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleAction(onTriggerFaultA, 'Fault A (DB Latency: payment-service)')}
            disabled={isActing}
            className="px-2.5 py-1 bg-base border border-border hover:border-warning text-text-primary text-xs transition-colors disabled:opacity-50"
            title="Inject 2000ms delay into payment-service database queries"
          >
            Trigger Fault A · DB Latency
          </button>

          <button
            onClick={() => handleAction(onTriggerFaultB, 'Fault B (Memory Leak: auth-service)')}
            disabled={isActing}
            className="px-2.5 py-1 bg-base border border-border hover:border-warning text-text-primary text-xs transition-colors disabled:opacity-50"
            title="Simulate buffer growth and CPU spike in auth-service"
          >
            Trigger Fault B · Memory Leak
          </button>

          <button
            onClick={() => handleAction(onReset, 'Reset All Faults')}
            disabled={isActing}
            className="px-2.5 py-1 bg-base border border-border hover:border-healthy text-text-secondary hover:text-healthy text-xs transition-colors disabled:opacity-50"
            title="Clear all injected delays and reset service states"
          >
            Reset Faults
          </button>
        </div>
      </div>

      {/* Operator Feedback Toast */}
      <div className="flex items-center space-x-2">
        {feedback && (
          <span className="text-xs text-signal data-value font-mono">
            {feedback}
          </span>
        )}
        <span className="text-[10px] text-text-muted font-sans">
          Operator Console v0.1
        </span>
      </div>
    </footer>
  );
}
