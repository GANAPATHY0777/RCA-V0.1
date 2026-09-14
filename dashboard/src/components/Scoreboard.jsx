import React from 'react';

export default function Scoreboard({ stats }) {
  const {
    incidents_diagnosed = 0,
    accuracy_pct = 0,
    avg_time_to_diagnose_seconds = 0,
    avg_time_to_recovery_seconds = 0,
    current_streak = 0,
  } = stats || {};

  return (
    <div
      id="operator-scoreboard"
      className="bg-panel border border-border px-3 py-1.5 rounded flex flex-wrap items-center gap-4 text-xs select-none"
    >
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-signal"></span>
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
          OPERATOR SCOREBOARD
        </span>
      </div>

      <div className="h-3.5 w-px bg-border hidden sm:block" />

      {/* Incidents Diagnosed */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] text-text-secondary uppercase">Diagnosed:</span>
        <span className="data-value text-white font-semibold">
          {incidents_diagnosed}
        </span>
      </div>

      {/* Accuracy % */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] text-text-secondary uppercase">Accuracy:</span>
        <span
          className={`data-value font-semibold ${
            accuracy_pct >= 80
              ? 'text-healthy'
              : accuracy_pct >= 50
              ? 'text-warning'
              : 'text-text-secondary'
          }`}
        >
          {accuracy_pct}%
        </span>
      </div>

      {/* Avg Time to Diagnose */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] text-text-secondary uppercase">Avg Diagnose:</span>
        <span className="data-value text-white font-semibold">
          {avg_time_to_diagnose_seconds > 0 ? `${avg_time_to_diagnose_seconds}s` : '—'}
        </span>
      </div>

      {/* Avg Time to Recovery */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] text-text-secondary uppercase">Avg Recovery:</span>
        <span className="data-value text-white font-semibold">
          {avg_time_to_recovery_seconds > 0 ? `${avg_time_to_recovery_seconds}s` : '—'}
        </span>
      </div>

      {/* Current Streak */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] text-text-secondary uppercase">Streak:</span>
        <span
          className={`data-value font-bold ${
            current_streak > 0 ? 'text-healthy' : 'text-text-secondary'
          }`}
        >
          {current_streak > 0 ? `+${current_streak}` : '0'}
        </span>
      </div>
    </div>
  );
}
