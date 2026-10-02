"use client"

import type { FlowGraph } from "@/lib/ai-automation/types"

/**
 * Figma-style node/edge rendering of the autonomous test flow.
 * Nodes are visited screens (thumbnail + title); edges are the
 * navigations the agent performed between them.
 */
export default function TestFlowGraph({ graph }: { graph: FlowGraph }) {
  const perRow = 4
  const nodeW = 190
  const nodeH = 132
  const gapX = 56
  const gapY = 64

  const pos = (i: number) => ({
    x: (i % perRow) * (nodeW + gapX),
    y: Math.floor(i / perRow) * (nodeH + gapY),
  })
  const idToIndex = new Map(graph.nodes.map((n, i) => [n.id, i]))

  const rows = Math.max(1, Math.ceil(graph.nodes.length / perRow))
  const width = perRow * (nodeW + gapX)
  const height = rows * (nodeH + gapY)

  return (
    <div className="overflow-x-auto custom-scrollbar rounded-lg bg-slate-950 border border-slate-800">
      <svg width={width} height={height} className="block min-w-full">
        <defs>
          <marker id="tfg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#6366f1" />
          </marker>
        </defs>

        {graph.edges.map((e, i) => {
          const a = idToIndex.get(e.from)
          const b = idToIndex.get(e.to)
          if (a === undefined || b === undefined || a === b) return null
          const pa = pos(a)
          const pb = pos(b)
          const x1 = pa.x + nodeW / 2
          const y1 = pa.y + nodeH / 2
          const x2 = pb.x + nodeW / 2
          const y2 = pb.y + nodeH / 2
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6366f1" strokeOpacity="0.55" strokeWidth="1.5" markerEnd="url(#tfg-arrow)" />
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 6}
                textAnchor="middle"
                fill="#818cf8"
                fontSize="9"
                fontFamily="ui-monospace, monospace"
              >
                {e.label.length > 26 ? e.label.slice(0, 26) + "…" : e.label}
              </text>
            </g>
          )
        })}

        {graph.nodes.map((n, i) => {
          const p = pos(i)
          return (
            <g key={n.id}>
              <rect
                x={p.x}
                y={p.y}
                width={nodeW}
                height={nodeH}
                rx="10"
                fill="#0f172a"
                stroke="#334155"
                strokeWidth="1.5"
              />
              {n.screenshotUrl ? (
                <image
                  href={n.screenshotUrl}
                  x={p.x + 6}
                  y={p.y + 6}
                  width={nodeW - 12}
                  height={78}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`inset(0 round 6px)`}
                />
              ) : (
                <rect x={p.x + 6} y={p.y + 6} width={nodeW - 12} height={78} rx="6" fill="#1e293b" />
              )}
              <text
                x={p.x + 10}
                y={p.y + 102}
                fill="#f1f5f9"
                fontSize="10.5"
                fontWeight="700"
                fontFamily="ui-sans-serif, system-ui"
              >
                {n.title.length > 28 ? n.title.slice(0, 28) + "…" : n.title}
              </text>
              <text x={p.x + 10} y={p.y + 118} fill="#64748b" fontSize="9" fontFamily="ui-monospace, monospace">
                {(n.url.length > 34 ? "…" + n.url.slice(-33) : n.url)}
              </text>
              <circle cx={p.x + 14} cy={p.y + 14} r="9" fill="#4f46e5" />
              <text x={p.x + 14} y={p.y + 17.5} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700">
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
