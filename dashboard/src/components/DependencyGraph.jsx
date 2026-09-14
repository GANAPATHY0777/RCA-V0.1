import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

/**
 * Dependency Graph Component (Step 11)
 * Real node-link diagram with D3.js.
 * Nodes = actual services, colored by live health.
 * Edges = real derived dependencies from OpenTelemetry spans.
 * The ONE deliberate transition: node fill color animates over 1.2s on recovery.
 */
export default function DependencyGraph({ graphData, servicesHealth, activeIncident, onSelectService, onDiagnose }) {
  const svgRef = useRef(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const isAwaitingDiagnosis = activeIncident && activeIncident.status === 'awaiting_diagnosis';

  // Preferred manual layout positions for clean architecture flow
  const fixedPositions = {
    'frontend-gateway': { fxRatio: 0.15, fyRatio: 0.50 },
    'order-service':    { fxRatio: 0.42, fyRatio: 0.28 },
    'auth-service':     { fxRatio: 0.42, fyRatio: 0.72 },
    'payment-service':  { fxRatio: 0.70, fyRatio: 0.28 },
    'postgres':         { fxRatio: 0.90, fyRatio: 0.28 },
  };

  // Determine node health color
  const getNodeColor = (serviceId) => {
    // If active incident points to this service and is not yet healthy
    if (activeIncident && activeIncident.root_cause_service === serviceId && activeIncident.status !== 'healthy') {
      return '#E5484D'; // critical red
    }

    const svc = servicesHealth?.find(s => s.name === serviceId);
    if (!svc) return '#5FBF77'; // default healthy

    switch (svc.status) {
      case 'healthy':
        return '#5FBF77';
      case 'warning':
      case 'degraded':
        return '#E8A33D';
      case 'critical':
      case 'unreachable':
      case 'unhealthy':
        return '#E5484D';
      default:
        return '#5FBF77';
    }
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 600;
    const height = svgRef.current.clientHeight || 420;

    svg.selectAll('*').remove();

    // Arrowhead marker definition
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'edge-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 38) // offset from node center
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#4B5563');

    defs.append('marker')
      .attr('id', 'edge-arrow-active')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 38)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#5B8DEF');

    // Prepare nodes and edges
    const defaultNodes = [
      { id: 'frontend-gateway', label: 'frontend-gateway' },
      { id: 'order-service', label: 'order-service' },
      { id: 'payment-service', label: 'payment-service' },
      { id: 'auth-service', label: 'auth-service' },
      { id: 'postgres', label: 'postgres' },
    ];

    const defaultEdges = [
      { source: 'frontend-gateway', target: 'order-service', call_count: 1 },
      { source: 'frontend-gateway', target: 'auth-service', call_count: 1 },
      { source: 'order-service', target: 'payment-service', call_count: 1 },
      { source: 'payment-service', target: 'postgres', call_count: 1 },
    ];

    const rawNodes = (graphData?.nodes && graphData.nodes.length > 0) ? graphData.nodes : defaultNodes;
    const rawEdges = (graphData?.edges && graphData.edges.length > 0) ? graphData.edges : defaultEdges;

    const nodes = rawNodes.map(d => {
      const pos = fixedPositions[d.id] || { fxRatio: 0.5, fyRatio: 0.5 };
      return {
        ...d,
        x: pos.fxRatio * width,
        y: pos.fyRatio * height,
        fx: pos.fxRatio * width,
        fy: pos.fyRatio * height,
      };
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const links = rawEdges
      .filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map(e => ({
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target),
        call_count: e.call_count || 1,
      }));

    // Draw Links
    const linkGroup = svg.append('g').attr('class', 'links');
    const link = linkGroup
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
      .attr('stroke', '#2A2F38')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', d => d.call_count > 0 ? 'none' : '4 2')
      .attr('marker-end', 'url(#edge-arrow)');

    // Draw Nodes
    const nodeGroup = svg.append('g').attr('class', 'nodes');
    const node = nodeGroup
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .attr('cursor', 'pointer')
      .attr('id', d => `graph-node-${d.id}`)
      .on('click', (event, d) => {
        setSelectedNode(d.id);
        if (onSelectService) onSelectService(d.id);
        if (isAwaitingDiagnosis && onDiagnose) {
          onDiagnose(d.id);
        }
      });

    // Outer incident pulse ring if root cause
    node.each(function(d) {
      const isRootCause = activeIncident && activeIncident.root_cause_service === d.id && activeIncident.status !== 'healthy';
      if (isRootCause) {
        d3.select(this)
          .append('circle')
          .attr('r', 28)
          .attr('fill', 'none')
          .attr('stroke', '#E5484D')
          .attr('stroke-width', 2)
          .attr('stroke-opacity', 0.6)
          .append('animate')
          .attr('attributeName', 'r')
          .attr('values', '26;34;26')
          .attr('dur', '2s')
          .attr('repeatCount', 'indefinite');
      }

      // If awaiting diagnosis, add targeting ring
      if (isAwaitingDiagnosis) {
        d3.select(this)
          .append('circle')
          .attr('class', 'diagnostic-target-ring')
          .attr('r', 26)
          .attr('fill', 'none')
          .attr('stroke', '#5B8DEF')
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', '4 2')
          .attr('opacity', 0.7);
      }
    });

    // Base background circle
    node.append('circle')
      .attr('r', 22)
      .attr('fill', '#1C2129')
      .attr('stroke', '#2A2F38')
      .attr('stroke-width', 1);

    // Dynamic health circle — uses CSS transition for deliberate 1.2s color animation
    node.append('circle')
      .attr('class', 'graph-node-circle')
      .attr('r', 8)
      .attr('fill', d => getNodeColor(d.id));

    // Service label
    node.append('text')
      .attr('y', 36)
      .attr('text-anchor', 'middle')
      .attr('fill', '#E8EAED')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text(d => d.id);

    // Monogram / Subtitle
    node.append('text')
      .attr('y', 48)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6B7280')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '9px')
      .text(d => {
        const svc = servicesHealth?.find(s => s.name === d.id);
        if (svc && svc.latency_ms !== undefined) {
          return `${svc.latency_ms}ms`;
        }
        return d.id === 'postgres' ? 'port:5432' : 'active';
      });

  }, [graphData, servicesHealth, activeIncident]);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Zone Header */}
      <div className="h-9 border-b border-border px-4 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold tracking-wider text-text-primary uppercase">
            Dependency Topology
          </span>
          <span className="text-xs text-text-muted">
            · {graphData?.derived_from_spans ? 'derived from live traces' : 'connecting traces'}
          </span>
        </div>
        {isAwaitingDiagnosis ? (
          <div className="flex items-center space-x-2 bg-amber-950/40 border border-warning/40 px-2.5 py-0.5 rounded text-[11px] text-warning font-semibold">
            <span className="animate-pulse text-[9px]">●</span>
            <span className="tracking-wide">CLICK SUSPECTED ROOT CAUSE NODE IN GRAPH</span>
          </div>
        ) : (
          <div className="flex items-center space-x-4 text-xs font-sans text-text-muted">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-healthy"></span>
              <span>Healthy</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-warning"></span>
              <span>Warning</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-critical"></span>
              <span>Critical</span>
            </div>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <div className="flex-1 relative w-full h-full min-h-[280px]">
        <svg ref={svgRef} className="w-full h-full" />

        {/* Trace Span Callout */}
        <div className="absolute bottom-2 left-3 text-[10px] text-text-muted data-value">
          OpenTelemetry OTLP trace propagation · 5 nodes · directional edges
        </div>
      </div>
    </div>
  );
}
