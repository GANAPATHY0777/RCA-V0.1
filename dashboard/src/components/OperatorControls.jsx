import React, { useState } from 'react';

export default function OperatorControls({
  level,
  onLevelChange,
  onSpawnOrder,
  ordersCount,
  onTriggerFaultA,
  onTriggerFaultB,
  onTriggerChaos,
  onResetFaults,
  isActing,
}) {
  const [faultADelay, setFaultADelay] = useState(2000);
  const [faultBRate, setFaultBRate] = useState(10);

  const handleTriggerA = () => {
    onTriggerFaultA(faultADelay);
  };

  const handleTriggerB = () => {
    onTriggerFaultB(faultBRate);
  };

  const handleTriggerChaos = () => {
    onTriggerChaos(faultADelay, faultBRate);
  };

  return (
    <div className="bg-panel border-t border-border px-4 py-3 text-xs flex flex-col gap-3">
      {/* Top Bar: Difficulty Level & Order Spawner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2.5">
        {/* Difficulty Level Selector */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] tracking-wider uppercase text-text-secondary font-semibold">
            DIFFICULTY:
          </span>
          <div className="inline-flex rounded border border-border bg-base p-0.5">
            <button
              id="level-1-btn"
              onClick={() => onLevelChange(1)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                level === 1
                  ? 'bg-border text-white shadow-sm'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              L1 · Guided (60s)
            </button>
            <button
              id="level-2-btn"
              onClick={() => onLevelChange(2)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                level === 2
                  ? 'bg-border text-white shadow-sm'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              L2 · Ambiguous (30s)
            </button>
            <button
              id="level-3-btn"
              onClick={() => onLevelChange(3)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                level === 3
                  ? 'bg-red-950/80 border border-critical/40 text-critical font-semibold'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              L3 · Concurrent Chaos (Dual)
            </button>
          </div>
        </div>

        {/* Live Load Creation: Spawn Order */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-base border border-border px-3 py-1 rounded">
            <span className="text-[10px] tracking-wider text-text-secondary uppercase">
              Live Session Orders:
            </span>
            <span className="data-value font-bold text-white text-[12px]">
              {ordersCount}
            </span>
          </div>
          <button
            id="spawn-order-btn"
            onClick={onSpawnOrder}
            disabled={isActing}
            className="px-3 py-1 bg-surface hover:bg-border text-white border border-border rounded font-medium transition-colors flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
          >
            <span className="text-healthy font-bold">+</span>
            <span>Spawn Order</span>
          </button>
        </div>
      </div>

      {/* Bottom Controls: Intensity Sliders & Triggers */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        {/* Fault A Slider */}
        <div className="md:col-span-4 bg-base/60 border border-border/80 p-2 rounded flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary font-medium tracking-wide">
              FAULT A: DB LATENCY
            </span>
            <span className="data-value text-warning text-[11px]">
              {faultADelay} ms
            </span>
          </div>
          <input
            type="range"
            id="fault-a-slider"
            min="500"
            max="5000"
            step="250"
            value={faultADelay}
            onChange={(e) => setFaultADelay(Number(e.target.value))}
            className="w-full accent-warning h-1.5 bg-border rounded-lg cursor-pointer"
          />
          <button
            id="trigger-fault-a-btn"
            onClick={handleTriggerA}
            disabled={isActing || level === 3}
            className={`w-full py-1 text-[11px] rounded font-medium border transition-colors ${
              level === 3
                ? 'opacity-40 border-border text-text-secondary cursor-not-allowed'
                : 'bg-surface hover:bg-border text-warning border-warning/30 hover:border-warning/60'
            }`}
          >
            Trigger Fault A ({faultADelay}ms)
          </button>
        </div>

        {/* Fault B Slider */}
        <div className="md:col-span-4 bg-base/60 border border-border/80 p-2 rounded flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-secondary font-medium tracking-wide">
              FAULT B: MEMORY LEAK
            </span>
            <span className="data-value text-critical text-[11px]">
              {faultBRate} MB/s
            </span>
          </div>
          <input
            type="range"
            id="fault-b-slider"
            min="2"
            max="20"
            step="1"
            value={faultBRate}
            onChange={(e) => setFaultBRate(Number(e.target.value))}
            className="w-full accent-critical h-1.5 bg-border rounded-lg cursor-pointer"
          />
          <button
            id="trigger-fault-b-btn"
            onClick={handleTriggerB}
            disabled={isActing || level === 3}
            className={`w-full py-1 text-[11px] rounded font-medium border transition-colors ${
              level === 3
                ? 'opacity-40 border-border text-text-secondary cursor-not-allowed'
                : 'bg-surface hover:bg-border text-critical border-critical/30 hover:border-critical/60'
            }`}
          >
            Trigger Fault B ({faultBRate}MB/s)
          </button>
        </div>

        {/* Chaos / Reset Actions */}
        <div className="md:col-span-4 flex flex-col gap-1.5">
          <button
            id="trigger-concurrent-chaos-btn"
            onClick={handleTriggerChaos}
            disabled={isActing}
            className={`w-full py-2 px-3 text-[11px] font-bold rounded border transition-all flex items-center justify-center gap-2 ${
              level === 3
                ? 'bg-critical/20 hover:bg-critical/30 border-critical text-critical animate-pulse shadow-sm'
                : 'bg-surface hover:bg-border border-border text-text-secondary hover:text-white'
            }`}
          >
            <span>CONCURRENT CHAOS</span>
            <span className="text-[9px] uppercase tracking-wider py-0.5 px-1 rounded bg-base border border-border">
              Fault A + B
            </span>
          </button>

          <button
            id="reset-faults-btn"
            onClick={onResetFaults}
            disabled={isActing}
            className="w-full py-1 text-[11px] bg-surface hover:bg-border text-text-secondary hover:text-white border border-border rounded font-medium transition-colors"
          >
            Reset All Faults
          </button>
        </div>
      </div>
    </div>
  );
}
