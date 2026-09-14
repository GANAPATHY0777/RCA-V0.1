import React, { useState, useEffect } from 'react';
import Scoreboard from './Scoreboard';

/**
 * Status Bar — top control room zone
 * System name · persistent operator scoreboard · overall health state · live UTC clock
 */
export default function StatusBar({ overallHealth, activeIncident, serviceCount, scoreboardStats }) {
  const [utcTime, setUtcTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const iso = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
      setUtcTime(iso);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getHealthBadge = () => {
    if (activeIncident && activeIncident.status !== 'healthy') {
      return {
        dotClass: 'bg-critical',
        textColor: 'text-critical',
        label: `Incident in progress · ${activeIncident.root_cause_service || 'investigating'}`,
      };
    }

    switch (overallHealth) {
      case 'healthy':
        return {
          dotClass: 'bg-healthy',
          textColor: 'text-healthy',
          label: 'All systems operational',
        };
      case 'warning':
      case 'degraded':
        return {
          dotClass: 'bg-warning',
          textColor: 'text-warning',
          label: 'Degraded telemetry detected',
        };
      case 'critical':
        return {
          dotClass: 'bg-critical',
          textColor: 'text-critical',
          label: 'Service disruption detected',
        };
      default:
        return {
          dotClass: 'bg-text-muted',
          textColor: 'text-text-secondary',
          label: 'Connecting to telemetry engine...',
        };
    }
  };

  const badge = getHealthBadge();

  return (
    <header className="h-12 bg-surface border-b border-border px-4 flex items-center justify-between select-none">
      {/* System Identification */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 bg-signal inline-block"></span>
          <h1 className="text-xs font-semibold tracking-wider text-text-primary uppercase">
            Evidence-Based AI Root Cause Analysis
          </h1>
        </div>
        <span className="text-border hidden lg:inline">|</span>
        <span className="text-xs text-text-muted font-sans hidden lg:inline">
          Operator Mode
        </span>
      </div>

      {/* Persistent Operator Scoreboard (Step 5) */}
      <div className="flex-1 max-w-2xl px-4 hidden md:flex justify-center">
        <Scoreboard stats={scoreboardStats} />
      </div>

      {/* System State & Health Indicator */}
      <div className="flex items-center space-x-5">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${badge.dotClass}`}></span>
          <span className={`text-xs font-medium ${badge.textColor}`}>
            {badge.label}
          </span>
          {serviceCount > 0 && (
            <span className="text-xs text-text-muted data-value">
              ({serviceCount} nodes active)
            </span>
          )}
        </div>

        {/* Live Clock */}
        <div className="flex items-center space-x-2 pl-4 border-l border-border">
          <span className="text-xs text-text-muted">UTC</span>
          <span className="text-xs data-value text-text-secondary font-mono tracking-tight">
            {utcTime || '2026-09-14 00:00:00 UTC'}
          </span>
        </div>
      </div>
    </header>
  );
}
