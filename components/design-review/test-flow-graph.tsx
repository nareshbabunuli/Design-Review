"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react"
import type {
  FlowGraph,
  AppScreenNode,
  TestPlanStep,
  AppWorkflowTransition,
  FullAppTestPlan,
} from "@/lib/ai-automation/types"
import {
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  LayoutGrid,
  GripVertical,
  Layers,
  Sparkles,
  ExternalLink,
  Eye,
  MousePointer,
  Compass,
  Columns,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Play,
  Check,
} from "lucide-react"

interface TestFlowGraphProps {
  graph: FlowGraph
  screens?: AppScreenNode[]
  steps?: TestPlanStep[]
  transitions?: AppWorkflowTransition[]
  plan?: FullAppTestPlan
  onSelectScreen?: (screenId: string) => void
  onViewScreenshot?: (url: string) => void
  onOpenMapPage?: () => void
  isBesideScreen?: boolean
  onToggleBesideScreen?: () => void
  isFullStage?: boolean
  onToggleFullStage?: () => void
  onCloseBeside?: () => void
}

interface NodePos {
  x: number
  y: number
}

const CARD_WIDTH = 230
const CARD_HEIGHT = 165

/**
 * Calculates default left-to-right hierarchical tree positions for nodes
 * Root screen (S001) on the left, child screens organized in clean columns
 */
function calculateDefaultLayout(graph: FlowGraph): Record<string, NodePos> {
  const positions: Record<string, NodePos> = {}
  const nodes = graph.nodes
  if (nodes.length === 0) return positions

  // Find root node (default to first or S001)
  const rootId = nodes.find((n) => n.id === "S001")?.id || nodes[0].id

  // Determine levels: root is level 0, targets of root are level 1, etc.
  const levels = new Map<string, number>()
  levels.set(rootId, 0)

  // Outgoing map
  const outgoing = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!outgoing.has(e.from)) outgoing.set(e.from, [])
    outgoing.get(e.from)!.push(e.to)
  }

  // BFS to assign levels
  const queue = [rootId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    const currLevel = levels.get(curr) || 0
    const children = outgoing.get(curr) || []
    for (const child of children) {
      if (!levels.has(child)) {
        levels.set(child, currLevel + 1)
        queue.push(child)
      }
    }
  }

  // Any unreached nodes go to level 1 or 2
  for (const n of nodes) {
    if (!levels.has(n.id)) {
      levels.set(n.id, 1)
    }
  }

  // Group nodes by level
  const byLevel = new Map<number, string[]>()
  for (const [id, lvl] of levels.entries()) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(id)
  }

  const colSpacingX = 360
  const rowSpacingY = 195
  const startX = 60
  const startY = 60

  // Position root node
  positions[rootId] = { x: startX, y: startY + 120 }

  // Position subsequent levels
  const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b)
  for (const lvl of sortedLevels) {
    if (lvl === 0) continue
    const ids = byLevel.get(lvl)!
    // Limit vertical column to at most 4 items before wrapping to next sub-column
    const maxPerCol = 4
    ids.forEach((id, idx) => {
      const colOffset = Math.floor(idx / maxPerCol) * colSpacingX
      const rowIdx = idx % maxPerCol
      const x = startX + lvl * colSpacingX + colOffset
      const y = startY + rowIdx * rowSpacingY
      positions[id] = { x, y }
    })
  }

  return positions
}

/**
 * Calculates a smart cubic Bezier curve between two cards so connecting lines
 * anchor to edges instead of passing underneath cards.
 */
function getSmartBezier(
  fromPos: NodePos,
  toPos: NodePos,
  width: number,
  height: number
): { path: string; midX: number; midY: number } {
  let x1: number
  let y1: number
  let x2: number
  let y2: number
  let cp1x: number
  let cp1y: number
  let cp2x: number
  let cp2y: number

  const dx = toPos.x - fromPos.x
  const dy = toPos.y - fromPos.y

  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal dominant
    if (dx >= 0) {
      // Source is left of Target -> Right anchor to Left anchor
      x1 = fromPos.x + width
      y1 = fromPos.y + height / 2
      x2 = toPos.x
      y2 = toPos.y + height / 2
      const curveOffset = Math.max(60, dx * 0.45)
      cp1x = x1 + curveOffset
      cp1y = y1
      cp2x = x2 - curveOffset
      cp2y = y2
    } else {
      // Source is right of Target -> Left anchor to Right anchor
      x1 = fromPos.x
      y1 = fromPos.y + height / 2
      x2 = toPos.x + width
      y2 = toPos.y + height / 2
      const curveOffset = Math.max(60, Math.abs(dx) * 0.45)
      cp1x = x1 - curveOffset
      cp1y = y1
      cp2x = x2 + curveOffset
      cp2y = y2
    }
  } else {
    // Vertical dominant
    if (dy >= 0) {
      // Source is above Target -> Bottom anchor to Top anchor
      x1 = fromPos.x + width / 2
      y1 = fromPos.y + height
      x2 = toPos.x + width / 2
      y2 = toPos.y
      const curveOffset = Math.max(50, dy * 0.45)
      cp1x = x1
      cp1y = y1 + curveOffset
      cp2x = x2
      cp2y = y2 - curveOffset
    } else {
      // Source is below Target -> Top anchor to Bottom anchor
      x1 = fromPos.x + width / 2
      y1 = fromPos.y
      x2 = toPos.x + width / 2
      y2 = toPos.y + height
      const curveOffset = Math.max(50, Math.abs(dy) * 0.45)
      cp1x = x1
      cp1y = y1 - curveOffset
      cp2x = x2
      cp2y = y2 + curveOffset
    }
  }

  // Midpoint calculation for cubic bezier at t = 0.5
  const t = 0.5
  const midX =
    Math.pow(1 - t, 3) * x1 +
    3 * Math.pow(1 - t, 2) * t * cp1x +
    3 * (1 - t) * Math.pow(t, 2) * cp2x +
    Math.pow(t, 3) * x2
  const midY =
    Math.pow(1 - t, 3) * y1 +
    3 * Math.pow(1 - t, 2) * t * cp1y +
    3 * (1 - t) * Math.pow(t, 2) * cp2y +
    Math.pow(t, 3) * y2

  const path = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`
  return { path, midX, midY }
}

export default function TestFlowGraph({
  graph,
  screens,
  steps,
  transitions,
  plan,
  onSelectScreen,
  onViewScreenshot,
  onOpenMapPage,
  isBesideScreen = false,
  onToggleBesideScreen,
  isFullStage = false,
  onToggleFullStage,
  onCloseBeside,
}: TestFlowGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Full screen toggle state
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ pointerX: 0, pointerY: 0, panX: 0, panY: 0 })

  // Node Positions (movable cards)
  const [nodePositions, setNodePositions] = useState<Record<string, NodePos>>(() =>
    calculateDefaultLayout(graph)
  )

  // Active dragging card
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, nodeX: 0, nodeY: 0 })

  // Card Inspector state ("Big Card & Side Operations")
  const [inspectingNodeId, setInspectingNodeId] = useState<string | null>(null)
  const [inspectorSubTab, setInspectorSubTab] = useState<"operations" | "transitions" | "elements">("operations")
  const [operationFilter, setOperationFilter] = useState<"all" | "passed" | "failed">("all")
  const [evidencePreviewModal, setEvidencePreviewModal] = useState<string | null>(null)

  // Re-initialize layout when graph nodes change
  useEffect(() => {
    setNodePositions((prev) => {
      const def = calculateDefaultLayout(graph)
      // Preserve existing positions if already moved
      const merged = { ...def }
      for (const k of Object.keys(prev)) {
        if (merged[k]) merged[k] = prev[k]
      }
      return merged
    })
  }, [graph.nodes.length, graph.edges.length])

  // Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  // Reset Layout to automatic hierarchical DAG
  const handleResetLayout = () => {
    setNodePositions(calculateDefaultLayout(graph))
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
  }

  // Zoom controls
  const handleZoomIn = () => setZoom((z) => Math.min(2.0, +(z + 0.15).toFixed(2)))
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))
  const handleZoomReset = () => {
    setZoom(1.0)
    setPan({ x: 0, y: 0 })
  }

  // Mouse wheel zoom (Ctrl + wheel or standard wheel)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.1 : -0.1
      setZoom((z) => Math.max(0.4, Math.min(2.0, +(z + delta).toFixed(2))))
    }
  }

  // Canvas Panning Handlers
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    // If clicked directly on canvas background (not a card)
    if (
      (e.target as HTMLElement).classList.contains("canvas-bg") ||
      (e.target as HTMLElement).tagName === "svg" ||
      (e.target as HTMLElement).dataset.canvasSurface
    ) {
      setIsPanning(true)
      panStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
  }

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.pointerX
      const dy = e.clientY - panStartRef.current.pointerY
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      })
    } else if (draggingNodeId) {
      const dx = (e.clientX - dragStartRef.current.pointerX) / zoom
      const dy = (e.clientY - dragStartRef.current.pointerY) / zoom
      setNodePositions((prev) => ({
        ...prev,
        [draggingNodeId]: {
          x: Math.round(dragStartRef.current.nodeX + dx),
          y: Math.round(dragStartRef.current.nodeY + dy),
        },
      }))
    }
  }

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false)
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
    if (draggingNodeId) {
      setDraggingNodeId(null)
    }
  }

  // Card Dragging Handlers
  const handleCardPointerDown = (nodeId: string, e: React.PointerEvent) => {
    e.stopPropagation()
    const pos = nodePositions[nodeId] || { x: 0, y: 0 }
    setDraggingNodeId(nodeId)
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      nodeX: pos.x,
      nodeY: pos.y,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handleCardPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (draggingNodeId) {
      setDraggingNodeId(null)
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  // Compute bounding box of all cards to size SVG canvas
  const canvasBounds = useMemo(() => {
    const vals = Object.values(nodePositions)
    if (vals.length === 0) return { width: 1400, height: 900 }
    const maxX = Math.max(...vals.map((v) => v.x)) + CARD_WIDTH + 200
    const maxY = Math.max(...vals.map((v) => v.y)) + CARD_HEIGHT + 200
    return {
      width: Math.max(1600, maxX),
      height: Math.max(1000, maxY),
    }
  }, [nodePositions])

  // Screen map for element count metadata
  const screensMap = useMemo(() => {
    const m = new Map<string, AppScreenNode>()
    const sourceScreens = screens || plan?.screens
    if (sourceScreens) {
      for (const s of sourceScreens) m.set(s.id, s)
    }
    return m
  }, [screens, plan?.screens])

  // Current inspecting node & screen record
  const inspectingNode = useMemo(() => {
    if (!inspectingNodeId) return null
    return graph.nodes.find((n) => n.id === inspectingNodeId) || null
  }, [graph.nodes, inspectingNodeId])

  const inspectingScreen = useMemo(() => {
    if (!inspectingNodeId) return null
    return screensMap.get(inspectingNodeId) || null
  }, [screensMap, inspectingNodeId])

  // All test steps / operations executed on this screen
  const screenOperations = useMemo(() => {
    if (!inspectingNodeId) return []
    const allSteps = steps || plan?.steps || []
    return allSteps.filter(
      (s) =>
        s.screenId === inspectingNodeId ||
        (inspectingScreen && s.screenName?.toLowerCase() === inspectingScreen.name?.toLowerCase()) ||
        (inspectingNode && s.screenName?.toLowerCase() === inspectingNode.title?.toLowerCase())
    )
  }, [steps, plan?.steps, inspectingNodeId, inspectingScreen, inspectingNode])

  const filteredScreenOperations = useMemo(() => {
    if (operationFilter === "all") return screenOperations
    return screenOperations.filter((op) => op.status === operationFilter)
  }, [screenOperations, operationFilter])

  // Outgoing transitions (side operations that navigate to another screen)
  const outgoingTransitions = useMemo(() => {
    if (!inspectingNodeId) return []
    const allTransitions = transitions || plan?.transitions || []
    const directMatches = allTransitions.filter((t) => t.fromScreenId === inspectingNodeId)
    if (directMatches.length > 0) return directMatches

    // Fallback: derive from graph.edges
    return graph.edges
      .filter((e) => e.from === inspectingNodeId)
      .map((e, idx) => ({
        id: `trans-${e.from}-${e.to}-${idx}`,
        fromScreenId: e.from,
        toScreenId: e.to,
        action: e.label,
        actionType: "click" as const,
      }))
  }, [transitions, plan?.transitions, graph.edges, inspectingNodeId])

  // Incoming transitions
  const incomingTransitions = useMemo(() => {
    if (!inspectingNodeId) return []
    return graph.edges.filter((e) => e.to === inspectingNodeId)
  }, [graph.edges, inspectingNodeId])

  // Index of inspecting node among all nodes
  const inspectingIndex = useMemo(() => {
    if (!inspectingNodeId) return -1
    return graph.nodes.findIndex((n) => n.id === inspectingNodeId)
  }, [graph.nodes, inspectingNodeId])

  // Handle keyboard shortcut Escape to close inspector
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (evidencePreviewModal) {
          setEvidencePreviewModal(null)
        } else if (inspectingNodeId) {
          setInspectingNodeId(null)
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [inspectingNodeId, evidencePreviewModal])

  return (
    <div
      ref={containerRef}
      className={`relative select-none overflow-hidden rounded-xl border border-slate-800 bg-slate-950 transition-all duration-300 ${
        isFullscreen
          ? "fixed inset-0 z-50 flex h-screen w-screen flex-col rounded-none border-none"
          : isBesideScreen || isFullStage
          ? "h-full w-full flex-1 flex flex-col rounded-none border-none"
          : "h-[580px] w-full"
      }`}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handleCanvasPointerMove}
      onPointerUp={handleCanvasPointerUp}
      data-canvas-surface="true"
    >
      {/* 1. FIGMA TOP TOOLBAR */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left Badge & Legend */}
        <div className="flex items-center gap-2 pointer-events-auto bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/80 shadow-lg text-xs">
          <div className="flex items-center gap-1.5 font-bold text-white">
            <Compass className="h-4 w-4 text-indigo-400" />
            <span>Figma-Style Workflow Canvas</span>
          </div>
          <span className="text-slate-500">•</span>
          <span className="text-[11px] text-indigo-300 font-mono">
            {graph.nodes.length} Nodes · {graph.edges.length} Transitions
          </span>
          {isBesideScreen && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold">
              Beside Simulator
            </span>
          )}
          {isFullStage && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold">
              Full Stage Map
            </span>
          )}
          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 font-mono">
            Movable Cards
          </span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-lg border border-slate-700/80 shadow-lg text-xs">
          {/* Beside Screen / Split View Toggle */}
          {onToggleBesideScreen && !isBesideScreen && !isFullStage && (
            <>
              <button
                type="button"
                onClick={onToggleBesideScreen}
                className="p-1.5 rounded transition cursor-pointer flex items-center gap-1 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs"
                title="Open beside phone simulator in main stage"
              >
                <Columns className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open Beside Screen</span>
              </button>
              <div className="w-px h-4 bg-slate-700 mx-0.5" />
            </>
          )}

          {/* Full Stage / Beside View Switcher when in main stage */}
          {onToggleFullStage && (isBesideScreen || isFullStage) && (
            <>
              <button
                type="button"
                onClick={onToggleFullStage}
                className={`p-1.5 rounded transition cursor-pointer flex items-center gap-1 text-[11px] font-semibold ${
                  isFullStage
                    ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/50"
                    : "hover:bg-slate-800 text-slate-300 hover:text-white"
                }`}
                title={isFullStage ? "Split side-by-side with phone simulator" : "Expand map across full stage"}
              >
                <Columns className="h-3.5 w-3.5 text-indigo-400" />
                <span className="hidden sm:inline">{isFullStage ? "Split Beside" : "Full Stage"}</span>
              </button>
              <div className="w-px h-4 bg-slate-700 mx-0.5" />
            </>
          )}

          {/* Zoom Out */}
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="Zoom Out (Ctrl -)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>

          {/* Zoom Level Indicator */}
          <button
            type="button"
            onClick={handleZoomReset}
            className="px-2 py-0.5 rounded hover:bg-slate-800 text-[11px] font-mono font-bold text-slate-200 transition cursor-pointer"
            title="Click to reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>

          {/* Zoom In */}
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
            title="Zoom In (Ctrl +)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Auto Arrange / Reset Layout */}
          <button
            type="button"
            onClick={handleResetLayout}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-indigo-300 transition cursor-pointer flex items-center gap-1 text-[11px]"
            title="Auto-arrange cards in clean tree layout"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Auto-Layout</span>
          </button>

          <div className="w-px h-4 bg-slate-700 mx-0.5" />

          {/* Fullscreen / Full Page Toggle */}
          <button
            type="button"
            onClick={() => {
              if (onOpenMapPage && !isFullStage) {
                // Open cleanly like another page!
                onOpenMapPage()
              } else {
                setIsFullscreen(!isFullscreen)
              }
            }}
            className={`p-1.5 rounded transition cursor-pointer flex items-center gap-1 text-[11px] font-semibold ${
              isFullscreen
                ? "bg-indigo-600 text-white shadow-sm"
                : "hover:bg-slate-800 text-slate-300 hover:text-white"
            }`}
            title={
              !isFullStage && onOpenMapPage
                ? "Open map like another page in full view"
                : isFullscreen
                ? "Exit Fullscreen (Esc)"
                : "Full Screen Canvas"
            }
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>{isFullStage ? "Fullscreen" : "Full Page"}</span>
              </>
            )}
          </button>

          {/* Close Beside / Full Stage button */}
          {(isBesideScreen || isFullStage) && onCloseBeside && (
            <>
              <div className="w-px h-4 bg-slate-700 mx-0.5" />
              <button
                type="button"
                onClick={onCloseBeside}
                className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition cursor-pointer"
                title="Close map view and return to single phone simulator"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. INFINITE DOT GRID CANVAS SURFACE */}
      <div
        className="canvas-bg absolute inset-0 cursor-grab active:cursor-grabbing overflow-hidden"
        style={{
          backgroundImage: "radial-gradient(#334155 1.2px, transparent 1.2px)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* Transformable Canvas Layer */}
        <div
          className="absolute origin-top-left transition-transform duration-75 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: `${canvasBounds.width}px`,
            height: `${canvasBounds.height}px`,
          }}
        >
          {/* SVG LAYER: SMART CURVED BEZIER CONNECTING LINES */}
          <svg
            className="absolute inset-0 pointer-events-none overflow-visible"
            width={canvasBounds.width}
            height={canvasBounds.height}
          >
            <defs>
              <marker
                id="figma-arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="5"
                orient="auto"
              >
                <path d="M0,2 L8,5 L0,8 z" fill="#6366f1" />
              </marker>
              <filter id="glow-indigo" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#6366f1" floodOpacity="0.4" />
              </filter>
            </defs>

            {graph.edges.map((e, idx) => {
              const fromPos = nodePositions[e.from]
              const toPos = nodePositions[e.to]
              if (!fromPos || !toPos || e.from === e.to) return null

              const { path, midX, midY } = getSmartBezier(
                fromPos,
                toPos,
                CARD_WIDTH,
                CARD_HEIGHT
              )

              const labelText = e.label.length > 28 ? e.label.slice(0, 27) + "…" : e.label

              return (
                <g key={`edge-${e.from}-${e.to}-${idx}`}>
                  {/* Subtle Background Glow Line */}
                  <path
                    d={path}
                    fill="none"
                    stroke="#4338ca"
                    strokeOpacity="0.3"
                    strokeWidth="4"
                  />

                  {/* Main Bezier Connecting Line */}
                  <path
                    d={path}
                    fill="none"
                    stroke="#6366f1"
                    strokeOpacity="0.85"
                    strokeWidth="2"
                    markerEnd="url(#figma-arrowhead)"
                  />

                  {/* Midpoint Pill Label with Backdrop so text is never hidden */}
                  <g transform={`translate(${midX}, ${midY})`} className="pointer-events-auto">
                    <rect
                      x={-(labelText.length * 3.3) - 8}
                      y="-11"
                      width={labelText.length * 6.6 + 16}
                      height="20"
                      rx="6"
                      fill="#0f172a"
                      stroke="#4338ca"
                      strokeWidth="1"
                      className="shadow-md"
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      fill="#c7d2fe"
                      fontSize="9.5"
                      fontFamily="ui-monospace, monospace"
                      fontWeight="600"
                    >
                      {labelText}
                    </text>
                  </g>
                </g>
              )
            })}
          </svg>

          {/* HTML LAYER: MOVABLE / DRAGGABLE CARDS */}
          {graph.nodes.map((node, i) => {
            const pos = nodePositions[node.id] || {
              x: 60 + (i % 4) * 320,
              y: 60 + Math.floor(i / 4) * 200,
            }
            const isDragging = draggingNodeId === node.id
            const matchedScreen = screensMap.get(node.id)
            const elementsCount = matchedScreen?.actionableElements?.length ?? 0

            return (
              <div
                key={node.id}
                onPointerDown={(e) => handleCardPointerDown(node.id, e)}
                onPointerUp={handleCardPointerUp}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isDragging) {
                    setInspectingNodeId(node.id)
                    setInspectorSubTab("operations")
                    if (onSelectScreen) {
                      onSelectScreen(node.id)
                    }
                  }
                }}
                className={`absolute select-none rounded-xl border transition-all cursor-grab active:cursor-grabbing flex flex-col justify-between overflow-hidden ${
                  isDragging
                    ? "z-40 border-indigo-400 bg-slate-900 shadow-2xl shadow-indigo-500/30 scale-[1.03]"
                    : inspectingNodeId === node.id
                    ? "z-30 border-indigo-400 bg-slate-900 shadow-2xl shadow-indigo-500/50 ring-2 ring-indigo-500/60"
                    : "z-20 border-slate-700/80 bg-slate-900/95 hover:border-indigo-500/70 hover:shadow-xl shadow-lg"
                }`}
                style={{
                  width: `${CARD_WIDTH}px`,
                  height: `${CARD_HEIGHT}px`,
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  touchAction: "none",
                }}
              >
                {/* 1. Card Header */}
                <div className="px-2.5 py-1.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between gap-1.5 shrink-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {node.id}
                    </span>
                    <span className="text-[11px] font-bold text-white truncate max-w-[120px]">
                      {node.title.replace(/^S\d+\s*/i, "")}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-slate-400">
                    <GripVertical className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                </div>

                {/* 2. Screenshot Thumbnail View */}
                <div className="flex-1 min-h-0 relative bg-slate-950 overflow-hidden group/img">
                  {node.screenshotUrl ? (
                    <img
                      src={node.screenshotUrl}
                      alt={node.title}
                      className="w-full h-full object-cover object-top"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 bg-slate-950/60 p-2">
                      <Layers className="h-6 w-6 mb-1 text-slate-700" />
                      <span className="text-[10px] font-mono text-slate-500">Screen Rendered</span>
                    </div>
                  )}
                </div>

                {/* 3. Card Footer */}
                <div className="px-2.5 py-1.5 bg-slate-950/90 border-t border-slate-800/80 flex items-center justify-between text-[10px] shrink-0">
                  <span className="text-slate-400 font-mono truncate max-w-[130px]">
                    {node.url ? new URL(node.url).pathname || "/" : "/"}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-300 font-semibold border border-indigo-800/40">
                    {elementsCount > 0 ? `${elementsCount} elements` : "View Screen"}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 3. Floating Bottom Instruction Helper */}
      <div className="absolute bottom-3 left-3 z-30 pointer-events-none hidden sm:flex items-center gap-2 bg-slate-900/85 backdrop-blur px-2.5 py-1 rounded-md border border-slate-800 text-[10px] text-slate-400 shadow">
        <MousePointer className="h-3 w-3 text-indigo-400" />
        <span>Click card to inspect operations • Drag cards to reposition • Drag canvas to pan</span>
      </div>

      {/* 4. BIG CARD & SIDE OPERATIONS INSPECTOR MODAL */}
      {inspectingNode && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-150"
          onClick={() => setInspectingNodeId(null)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {inspectingNode.id}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-white truncate">
                    {inspectingScreen?.name || inspectingNode.title.replace(/^S\d+\s*/i, "")}
                  </h3>
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    {inspectingScreen?.url || inspectingNode.url || "/"}
                  </div>
                </div>
              </div>

              {/* Prev / Next Node Switcher & Close */}
              <div className="flex items-center gap-2 shrink-0">
                {graph.nodes.length > 1 && (
                  <div className="flex items-center bg-slate-900 rounded-lg border border-slate-800 p-0.5 text-xs text-slate-300">
                    <button
                      type="button"
                      disabled={inspectingIndex <= 0}
                      onClick={() => {
                        if (inspectingIndex > 0) {
                          setInspectingNodeId(graph.nodes[inspectingIndex - 1].id)
                        }
                      }}
                      className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                      title="Previous Screen"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="px-2 text-[10px] font-mono text-slate-400">
                      {inspectingIndex + 1} / {graph.nodes.length}
                    </span>
                    <button
                      type="button"
                      disabled={inspectingIndex >= graph.nodes.length - 1}
                      onClick={() => {
                        if (inspectingIndex < graph.nodes.length - 1) {
                          setInspectingNodeId(graph.nodes[inspectingIndex + 1].id)
                        }
                      }}
                      className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                      title="Next Screen"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setInspectingNodeId(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Close Inspector (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Body: Two Columns (Left: Big Card, Right: Side Operations) */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              {/* LEFT COLUMN: THE BIG CARD */}
              <div className="lg:col-span-5 p-4 bg-slate-950/60 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between overflow-y-auto custom-scrollbar space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                      Big Screen Card
                    </span>
                    {inspectingNode.screenshotUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          if (onViewScreenshot) {
                            onViewScreenshot(inspectingNode.screenshotUrl!)
                          } else {
                            setEvidencePreviewModal(inspectingNode.screenshotUrl!)
                          }
                        }}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition cursor-pointer"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Enlarge Screenshot</span>
                      </button>
                    )}
                  </div>

                  {/* Big Card Image Frame */}
                  <div className="rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950 shadow-lg relative group aspect-[4/3] flex items-center justify-center">
                    {inspectingNode.screenshotUrl ? (
                      <>
                        <img
                          src={inspectingNode.screenshotUrl}
                          alt={inspectingNode.title}
                          className="w-full h-full object-cover object-top"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (onViewScreenshot) {
                              onViewScreenshot(inspectingNode.screenshotUrl!)
                            } else {
                              setEvidencePreviewModal(inspectingNode.screenshotUrl!)
                            }
                          }}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold cursor-pointer"
                        >
                          <Maximize2 className="h-4 w-4" />
                          <span>View Full Resolution</span>
                        </button>
                      </>
                    ) : (
                      <div className="p-6 text-center text-slate-500 flex flex-col items-center">
                        <Layers className="h-8 w-8 mb-2 text-slate-600" />
                        <span className="text-xs">No screenshot captured</span>
                      </div>
                    )}
                  </div>

                  {/* Quick Screen Stats */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-xs font-bold text-white font-mono">
                        {inspectingScreen?.actionableElements?.length || 0}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Elements</div>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-xs font-bold text-indigo-300 font-mono">
                        {screenOperations.length}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Operations</div>
                    </div>

                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="text-xs font-bold text-emerald-300 font-mono">
                        {outgoingTransitions.length}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Transitions</div>
                    </div>
                  </div>

                  {/* Incoming / Discovery Context */}
                  <div className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] space-y-1">
                    <span className="text-slate-400 font-medium block">Route Path:</span>
                    <div className="font-mono text-slate-300 break-all text-[10px]">
                      {inspectingScreen?.path || inspectingNode.url || "/"}
                    </div>
                    {incomingTransitions.length > 0 && (
                      <div className="pt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                        <span>Reached from</span>
                        <span className="px-1 py-0.2 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 font-mono font-bold">
                          {incomingTransitions[0].from}
                        </span>
                        <span>via &quot;{incomingTransitions[0].label}&quot;</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Left Column Bottom Action */}
                {onSelectScreen && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectScreen(inspectingNode.id)
                      setInspectingNodeId(null)
                    }}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition cursor-pointer"
                  >
                    <Layers className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Open in Discovered Screens Tab</span>
                  </button>
                )}
              </div>

              {/* RIGHT COLUMN: SIDE OPERATIONS IT HAS DONE */}
              <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-900 overflow-hidden">
                {/* Operations Subtab Header */}
                <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs shrink-0 overflow-x-auto custom-scrollbar">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setInspectorSubTab("operations")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                        inspectorSubTab === "operations"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Operations Done ({screenOperations.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectorSubTab("transitions")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                        inspectorSubTab === "transitions"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                      }`}
                    >
                      <Compass className="h-3.5 w-3.5" />
                      <span>Side Navigations ({outgoingTransitions.length})</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInspectorSubTab("elements")}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                        inspectorSubTab === "elements"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Elements ({inspectingScreen?.actionableElements?.length || 0})</span>
                    </button>
                  </div>

                  {/* Operation Status Filter when on operations tab */}
                  {inspectorSubTab === "operations" && screenOperations.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] shrink-0 ml-2">
                      {(["all", "passed", "failed"] as const).map((st) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setOperationFilter(st)}
                          className={`px-2 py-0.5 rounded capitalize transition cursor-pointer ${
                            operationFilter === st
                              ? "bg-slate-800 text-white font-bold border border-slate-700"
                              : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Operations Subtab Content */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar space-y-2.5">
                  {/* TAB 1: OPERATIONS & TESTS DONE */}
                  {inspectorSubTab === "operations" && (
                    <>
                      {filteredScreenOperations.length > 0 ? (
                        filteredScreenOperations.map((op) => {
                          const isPassed = op.status === "passed"
                          const isFailed = op.status === "failed"
                          const isRunning = op.status === "running"

                          return (
                            <div
                              key={op.id}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
                                isPassed
                                  ? "bg-emerald-950/20 border-emerald-800/40"
                                  : isFailed
                                  ? "bg-rose-950/20 border-rose-800/40"
                                  : isRunning
                                  ? "bg-indigo-950/30 border-indigo-500 shadow-md animate-pulse"
                                  : "bg-slate-950/60 border-slate-800"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-slate-500 font-bold text-[11px]">
                                    #{op.stepIndex}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] uppercase ${
                                      op.actionType === "fill"
                                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                        : op.actionType === "click"
                                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                        : op.actionType === "upload"
                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                        : "bg-slate-800 text-slate-300 border border-slate-700"
                                    }`}
                                  >
                                    {op.actionType}
                                  </span>
                                  <span className="font-bold text-white truncate max-w-[240px]">
                                    {op.targetName}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isPassed && (
                                    <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3" /> PASS
                                    </span>
                                  )}
                                  {isFailed && (
                                    <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                                      <XCircle className="h-3 w-3" /> FAIL
                                    </span>
                                  )}
                                  {isRunning && (
                                    <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-indigo-500/30 text-indigo-300 border border-indigo-400 flex items-center gap-1">
                                      <Clock className="h-3 w-3 animate-spin" /> RUNNING
                                    </span>
                                  )}
                                  {op.status === "pending" && (
                                    <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                                      PENDING
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Target Selector */}
                              {op.targetSelector && (
                                <div className="text-[10px] font-mono text-slate-500 truncate">
                                  Selector: {op.targetSelector}
                                </div>
                              )}

                              {/* Synthetic Value */}
                              {op.syntheticValue && (
                                <div className="flex items-center gap-1.5 text-[10px]">
                                  <span className="text-slate-400 font-medium">Input Value:</span>
                                  <code className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono">
                                    {op.syntheticValue}
                                  </code>
                                  <span className="text-[9px] text-emerald-400/80">(Synthetic Faker)</span>
                                </div>
                              )}

                              {/* Expected vs Actual */}
                              <div className="pt-1.5 border-t border-slate-800/60 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px]">
                                <div>
                                  <span className="text-slate-400 font-medium">Expected: </span>
                                  <span className="text-slate-300">{op.expectedResult}</span>
                                </div>
                                {op.actualResult && (
                                  <div>
                                    <span className="text-slate-400 font-medium">Observed: </span>
                                    <span className={isPassed ? "text-emerald-300 font-medium" : "text-rose-300 font-medium"}>
                                      {op.actualResult}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Step Evidence Screenshot */}
                              {op.screenshotUrl && (
                                <div className="pt-1 flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEvidencePreviewModal(op.screenshotUrl!)}
                                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition cursor-pointer"
                                  >
                                    <Eye className="h-3 w-3 text-indigo-400" />
                                    <span>View Evidence Screenshot</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })
                      ) : (
                        <div className="p-8 text-center text-slate-500 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 space-y-1">
                          <Sparkles className="h-6 w-6 text-slate-600 mx-auto mb-1" />
                          <p className="text-xs text-slate-400 font-semibold">
                            No executed test operations recorded for this screen.
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Run Full App Testing to execute structured operations on this screen.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* TAB 2: OUTGOING NAVIGATIONS (WHERE IT GOES NEXT) */}
                  {inspectorSubTab === "transitions" && (
                    <div className="space-y-2">
                      {outgoingTransitions.length > 0 ? (
                        outgoingTransitions.map((t, idx) => {
                          const targetScreen = screensMap.get(t.toScreenId)
                          const targetNode = graph.nodes.find((n) => n.id === t.toScreenId)

                          return (
                            <div
                              key={t.id || idx}
                              className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-indigo-500/50 transition flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0 pr-2">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    Action
                                  </span>
                                  <span className="font-bold text-white truncate">
                                    {t.action}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                  <span>Navigates to:</span>
                                  <span className="font-mono text-indigo-300 font-bold">
                                    {t.toScreenId}
                                  </span>
                                  <span className="truncate">
                                    ({targetScreen?.name || targetNode?.title || "Screen"})
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  setInspectingNodeId(t.toScreenId)
                                  setInspectorSubTab("operations")
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                              >
                                <span>Inspect Screen</span>
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            </div>
                          )
                        })
                      ) : (
                        <div className="p-8 text-center text-slate-500 rounded-xl bg-slate-950/40 border border-dashed border-slate-800">
                          <Compass className="h-6 w-6 text-slate-600 mx-auto mb-1" />
                          <p className="text-xs text-slate-400 font-semibold">
                            No outgoing transitions from this screen.
                          </p>
                          <p className="text-[11px] text-slate-500">
                            This screen is a terminal node or leaf screen in the mapped flow.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: DISCOVERED ACTIONABLE ELEMENTS */}
                  {inspectorSubTab === "elements" && (
                    <div className="space-y-1.5">
                      {inspectingScreen && inspectingScreen.actionableElements.length > 0 ? (
                        inspectingScreen.actionableElements.map((elem) => (
                          <div
                            key={elem.id}
                            className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                                    elem.type === "button"
                                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                      : elem.type === "input"
                                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                      : elem.type === "file_upload"
                                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                      : "bg-slate-800 text-slate-400 border border-slate-700"
                                  }`}
                                >
                                  {elem.type}
                                </span>
                                <span className="font-semibold text-white truncate">{elem.name}</span>
                              </div>
                              {elem.selector && (
                                <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                                  {elem.selector}
                                </div>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                              {elem.isInteractive ? "Interactive" : "Static"}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center text-slate-500 rounded-xl bg-slate-950/40 border border-dashed border-slate-800">
                          <Layers className="h-6 w-6 text-slate-600 mx-auto mb-1" />
                          <p className="text-xs text-slate-400">
                            Actionable elements list will populate after discovery phase runs.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. FULL-RESOLUTION EVIDENCE / SCREENSHOT PREVIEW MODAL */}
      {evidencePreviewModal && (
        <div
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setEvidencePreviewModal(null)}
        >
          <div
            className="max-w-5xl max-h-[92vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 p-2 relative shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-1.5 mb-1 text-xs text-slate-300 border-b border-slate-800">
              <span className="font-semibold">Step Evidence Screenshot</span>
              <button
                type="button"
                onClick={() => setEvidencePreviewModal(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={evidencePreviewModal}
              alt="Evidence Preview"
              className="max-w-full max-h-[84vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  )
}
