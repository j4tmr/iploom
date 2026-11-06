import { useId, useState } from "react";
import {
  layoutRelationshipGraph,
  type GraphLayoutNode,
} from "../core/graph.ts";
import type {
  RelationshipEdge,
  RelationshipGraph,
  UiLocale,
} from "../core/types.ts";
import { relationshipLabels, relationStatusLabels } from "../i18n.ts";

const edgeColors = {
  active: "#5f8b7e",
  hidden: "#b39359",
  broken: "#a85a4f",
} as const;

export function RelationshipCanvas({
  graph,
  locale,
  onNodeClick,
}: {
  graph: RelationshipGraph;
  locale: UiLocale;
  onNodeClick?: (node: GraphLayoutNode) => void;
}) {
  const [hovered, setHovered] = useState<RelationshipEdge | null>(null);
  const arrowId = useId().replaceAll(":", "");
  const width = 860;
  const height = 540;
  const nodes = layoutRelationshipGraph(graph, width, height);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  if (!nodes.length)
    return (
      <div className="graph-empty">
        <span>◌</span>
        <p>{locale === "en" ? "Add characters to grow the map." : "添加人物后，关系图会在这里生长。"}</p>
      </div>
    );

  return (
    <div className="relationship-canvas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={locale === "en" ? "Character relationship graph" : "人物关系图"}
      >
        <defs>
          <marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" /></marker>
          <radialGradient id="graph-glow" cx="50%" cy="45%" r="55%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity=".14" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".16" />
          </filter>
          <pattern id="dot-grid" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--line)" opacity=".52" />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#dot-grid)" rx="22" />
        <rect width={width} height={height} fill="url(#graph-glow)" rx="22" />
        {graph.edges.map((edge) => {
          const source = byId.get(edge.source);
          const target = byId.get(edge.target);
          if (!source || !target) return null;
          const active = hovered?.id === edge.id;
          const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1;
          const dx = (target.x - source.x) / distance, dy = (target.y - source.y) / distance;
          return (
            <g
              key={edge.id}
              className="graph-edge"
              onMouseEnter={() => setHovered(edge)}
              onMouseLeave={() => setHovered(null)}
            >
              <line
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke="transparent"
                strokeWidth="18"
              />
              <line
                x1={source.x + dx * (source.radius + 9)}
                y1={source.y + dy * (source.radius + 9)}
                x2={target.x - dx * (target.radius + 9)}
                y2={target.y - dy * (target.radius + 9)}
                stroke={edgeColors[edge.status]}
                markerEnd={`url(#${arrowId})`}
                markerStart={edge.mutual ? `url(#${arrowId})` : undefined}
                strokeWidth={active ? 3.4 : 1.2 + edge.strength * 0.38}
                strokeDasharray={edge.status === "hidden" ? "7 6" : undefined}
                opacity={edge.status === "broken" ? 0.5 : active ? 1 : 0.74}
              />
              {active ? (
                <g>
                  <rect
                    x={(source.x + target.x) / 2 - 88}
                    y={(source.y + target.y) / 2 - 18}
                    width="176"
                    height="36"
                    rx="18"
                    fill="var(--paper)"
                    stroke="var(--line)"
                  />
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 + 4}
                    textAnchor="middle"
                    className="graph-edge-label"
                  >
                    {relationshipLabels[locale][edge.type]} · {edge.label}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
        {nodes.map((node) => (
          <g
            key={node.id}
            className="graph-node"
            transform={`translate(${node.x} ${node.y})`}
            role={onNodeClick ? "button" : undefined}
            tabIndex={onNodeClick ? 0 : undefined}
            onClick={() => onNodeClick?.(node)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onNodeClick?.(node);
            }}
          >
            <circle r={node.radius + 8} fill="var(--paper)" opacity=".88" />
            <circle
              r={node.radius}
              fill={node.color}
              stroke="var(--paper)"
              strokeWidth="4"
              filter="url(#node-shadow)"
            />
            <text
              y="1"
              textAnchor="middle"
              dominantBaseline="middle"
              className="graph-node-initial"
            >
              {node.label.trim().slice(0, 1).toLocaleUpperCase()}
            </text>
            <text y={node.radius + 22} textAnchor="middle" className="graph-node-label">
              {node.label}
            </text>
            <text y={node.radius + 39} textAnchor="middle" className="graph-node-role">
              {node.secondary.length > 20
                ? `${node.secondary.slice(0, 20)}…`
                : node.secondary}
            </text>
          </g>
        ))}
      </svg>
      <div className="graph-legend">
        <span>
          <i style={{ background: edgeColors.active }} />
          {relationStatusLabels[locale].active}
        </span>
        <span>
          <i className="dash" style={{ background: edgeColors.hidden }} />
          {relationStatusLabels[locale].hidden}
        </span>
        <span>
          <i style={{ background: edgeColors.broken }} />
          {relationStatusLabels[locale].broken}
        </span>
      </div>
    </div>
  );
}
