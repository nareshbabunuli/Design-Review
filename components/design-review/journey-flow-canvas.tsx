"use client"

import React, { useState, useRef, useEffect, useMemo } from "react"
import {
  Play,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Sparkles,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Download,
  X,
  ExternalLink,
  Layers,
  ChevronRight,
  Eye,
  Info,
  Sliders,
  Check,
} from "lucide-react"

export interface FlowScreenItem {
  title: string
  url: string
  path?: string
  screenshotUrl?: string
  lightScreenshotUrl?: string
  screenshots?: Record<string, string>
  pageType?: string
  issuesCount?: number
  issues?: Array<{
    id?: string
    title?: string
    type?: string
    severity: string
    description: string
    recommendation?: string
  }>
  workflowId?: string
  viewport?: { width: number; height: number }
}

interface JourneyFlowCanvasProps {
  screens: FlowScreenItem[]
  role?: string
  targetUrl?: string
  onSelectScreen?: (index: number) => void
  onSwitchToSimulator?: () => void
  theme?: "light" | "dark"
}

export function JourneyFlowCanvas({
  screens = [],
  role = "user",
  targetUrl = "http://localhost:3000",
  onSelectScreen,
  onSwitchToSimulator,
  theme = "dark",
}: JourneyFlowCanvasProps) {
  // Canvas pan & zoom state
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 40, y: 30 })
  const [isPanning, setIsPanning] = useState(false)
  const [startPan, setStartPan] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Selected screen for detailed inspection drawer
  const [selectedScreenIndex, setSelectedScreenIndex] = useState<number | null>(null)
  const [hoveredScreenIndex, setHoveredScreenIndex] = useState<number | null>(null)
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null)
  const [activeLaneFilter, setActiveLaneFilter] = useState<"all" | "dark" | "light">("all")

  // Generate fallback sample screens if none captured yet
  const displayScreens = useMemo(() => {
    if (screens && screens.length > 0) return screens
    return [
      {
        title: "Photo Timeline",
        url: `${targetUrl}/timeline`,
        path: "/timeline",
        screenshotUrl: "",
        pageType: "list",
        issuesCount: 0,
        issues: [],
      },
      {
        title: "Nature Collections",
        url: `${targetUrl}/collections`,
        path: "/collections",
        screenshotUrl: "",
        pageType: "dashboard",
        issuesCount: 1,
        issues: [
          {
            title: "Grid Gap Misalignment",
            severity: "low",
            description: "Image grid gutters vary between 8px and 12px on narrow viewports.",
            recommendation: "Standardize gap: gap-3 in Tailwind.",
          },
        ],
      },
      {
        title: "Global Search",
        url: `${targetUrl}/search`,
        path: "/search",
        screenshotUrl: "",
        pageType: "form",
        issuesCount: 0,
        issues: [],
      },
    ]
  }, [screens, targetUrl])

  // Canvas Geometry Constants (matches Figma prototype flow proportions)
  const CARD_WIDTH = 280
  const CARD_HEIGHT = 480
  const GAP_X = 140
  const START_OFFSET_X = 380
  const ROW_DARK_Y = 120
  const ROW_LIGHT_Y = 720
  const CANVAS_TOTAL_WIDTH = START_OFFSET_X + Math.max(displayScreens.length, 3) * (CARD_WIDTH + GAP_X) + 200
  const CANVAS_TOTAL_HEIGHT = 1380

  // Pan interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".no-pan")) return
    setIsPanning(true)
    setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    setPan({
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y,
    })
  }

  const handleMouseUp = () => setIsPanning(false)

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.05 : 0.05
      setZoom((prev) => Math.min(Math.max(prev + delta, 0.4), 1.5))
    } else {
      setPan((prev) => ({
        x: prev.x - e.deltaX * 0.8,
        y: prev.y - e.deltaY * 0.8,
      }))
    }
  }

  const handleResetZoom = () => {
    setZoom(0.85)
    setPan({ x: 40, y: 30 })
  }

  const handleFitToView = () => {
    if (!canvasRef.current) return
    const containerW = canvasRef.current.clientWidth
    const fitScale = Math.min(Math.max(containerW / (CANVAS_TOTAL_WIDTH * 0.9), 0.45), 1.0)
    setZoom(fitScale)
    setPan({ x: 20, y: 20 })
  }

  // Calculate screen anchor coordinates
  const getScreenCoordinates = (index: number, row: "dark" | "light") => {
    const x = START_OFFSET_X + index * (CARD_WIDTH + GAP_X)
    const y = row === "dark" ? ROW_DARK_Y : ROW_LIGHT_Y
    return {
      x,
      y,
      centerLeft: { x, y: y + CARD_HEIGHT / 2 },
      centerRight: { x: x + CARD_WIDTH, y: y + CARD_HEIGHT / 2 },
      topCenter: { x: x + CARD_WIDTH / 2, y },
      tab1: { x: x + 48, y: y + CARD_HEIGHT - 24 }, // Timeline tab
      tab2: { x: x + 140, y: y + CARD_HEIGHT - 24 }, // Favorites tab
      tab3: { x: x + 232, y: y + CARD_HEIGHT - 24 }, // Search tab
    }
  }

  // Table of Contents Start Coordinates (Unified Stacked Card)
  const startBlockTOC = {
    x: 80,
    y: 280,
    w: 220,
    h: 320,
    darkAnchor: { x: 300, y: 360 },
    lightAnchor: { x: 300, y: 520 },
  }

  // Generate Bezier Curves for Figma Prototype Wires
  const makeBezierCurve = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    curvature: "horizontal" | "loop" | "diagonal" = "horizontal"
  ) => {
    if (curvature === "horizontal") {
      const dx = Math.abs(x2 - x1)
      const cx1 = x1 + Math.max(dx * 0.45, 60)
      const cy1 = y1
      const cx2 = x2 - Math.max(dx * 0.45, 60)
      const cy2 = y2
      return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
    }

    if (curvature === "loop") {
      const midX = (x1 + x2) / 2
      const cx1 = x1 + 60
      const cy1 = y1 + 50
      const cx2 = x2 - 60
      const cy2 = y2 - 50
      return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
    }

    // Default smooth diagonal curve
    const cx1 = x1 + (x2 - x1) * 0.5
    const cy1 = y1
    const cx2 = x1 + (x2 - x1) * 0.5
    const cy2 = y2
    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`
  }

  // Construct Figma Prototype Connection Wire List
  const connectionWires = useMemo(() => {
    const wires: Array<{
      id: string
      path: string
      fromLabel: string
      toLabel: string
      fromX: number
      fromY: number
      toX: number
      toY: number
      row: "dark" | "light"
    }> = []

    const rows: Array<"dark" | "light"> = ["dark", "light"]

    rows.forEach((r) => {
      const startAnchor = r === "dark" ? startBlockTOC.darkAnchor : startBlockTOC.lightAnchor
      const firstScreen = getScreenCoordinates(0, r)

      // 1. Start TOC block -> First Screen
      wires.push({
        id: `start-to-screen0-${r}`,
        path: makeBezierCurve(startAnchor.x, startAnchor.y, firstScreen.centerLeft.x, firstScreen.centerLeft.y, "horizontal"),
        fromLabel: "Start Flow",
        toLabel: displayScreens[0]?.title || "Screen 1",
        fromX: startAnchor.x,
        fromY: startAnchor.y,
        toX: firstScreen.centerLeft.x,
        toY: firstScreen.centerLeft.y,
        row: r,
      })

      // 2. Tab Navigation Interactions between screens
      if (displayScreens.length >= 2) {
        const s0 = getScreenCoordinates(0, r)
        const s1 = getScreenCoordinates(1, r)

        // Screen 0 Favorites tab -> Screen 1
        wires.push({
          id: `s0-tab2-to-s1-${r}`,
          path: makeBezierCurve(s0.tab2.x, s0.tab2.y, s1.centerLeft.x, s1.centerLeft.y + 40, "horizontal"),
          fromLabel: "Favorites Tab",
          toLabel: displayScreens[1]?.title || "Screen 2",
          fromX: s0.tab2.x,
          fromY: s0.tab2.y,
          toX: s1.centerLeft.x,
          toY: s1.centerLeft.y + 40,
          row: r,
        })
      }

      if (displayScreens.length >= 3) {
        const s0 = getScreenCoordinates(0, r)
        const s1 = getScreenCoordinates(1, r)
        const s2 = getScreenCoordinates(2, r)

        // Screen 0 Search tab -> Screen 2
        wires.push({
          id: `s0-tab3-to-s2-${r}`,
          path: makeBezierCurve(s0.tab3.x, s0.tab3.y, s2.centerLeft.x, s2.centerLeft.y + 80, "horizontal"),
          fromLabel: "Search Tab",
          toLabel: displayScreens[2]?.title || "Screen 3",
          fromX: s0.tab3.x,
          fromY: s0.tab3.y,
          toX: s2.centerLeft.x,
          toY: s2.centerLeft.y + 80,
          row: r,
        })

        // Screen 1 Search tab -> Screen 2
        wires.push({
          id: `s1-tab3-to-s2-${r}`,
          path: makeBezierCurve(s1.tab3.x, s1.tab3.y, s2.centerLeft.x, s2.centerLeft.y - 20, "horizontal"),
          fromLabel: "Search Tab",
          toLabel: displayScreens[2]?.title || "Screen 3",
          fromX: s1.tab3.x,
          fromY: s1.tab3.y,
          toX: s2.centerLeft.x,
          toY: s2.centerLeft.y - 20,
          row: r,
        })

        // Screen 2 Timeline tab back to Screen 0
        wires.push({
          id: `s2-tab1-to-s0-${r}`,
          path: makeBezierCurve(s2.tab1.x, s2.tab1.y, s0.centerRight.x, s0.centerRight.y - 40, "loop"),
          fromLabel: "Back to Timeline",
          toLabel: displayScreens[0]?.title || "Screen 1",
          fromX: s2.tab1.x,
          fromY: s2.tab1.y,
          toX: s0.centerRight.x,
          toY: s0.centerRight.y - 40,
          row: r,
        })
      }
    })

    return wires
  }, [displayScreens, activeLaneFilter])

  const selectedScreen = selectedScreenIndex !== null ? displayScreens[selectedScreenIndex] : null

  return (
    <div
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className={`relative w-full h-full select-none overflow-hidden transition-colors ${
        theme === "light" ? "bg-[#eef1f5] text-slate-900" : "bg-[#0b0f19] text-white"
      }`}
      style={{
        cursor: isPanning ? "grabbing" : "grab",
        backgroundImage:
          theme === "light"
            ? "radial-gradient(#c5ccd6 1.2px, transparent 1.2px)"
            : "radial-gradient(#1e293b 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Top Floating Control Bar */}
      <div className="absolute top-4 left-6 z-30 flex items-center gap-2 no-pan">
        <div className={`backdrop-blur-md px-3 py-1.5 rounded-xl shadow-xl flex items-center gap-3 border transition-colors ${
          theme === "light"
            ? "bg-white/95 border-slate-200/90 text-slate-800"
            : "bg-slate-900/90 border-slate-800 text-white"
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse shadow-[0_0_8px_#38bdf8]" />
            <span className="text-xs font-bold tracking-wide uppercase font-mono">
              Figma Prototype Flow Map
            </span>
          </div>

          <div className={`h-4 w-px ${theme === "light" ? "bg-slate-200" : "bg-slate-800"}`} />

          {/* Lane filter tabs */}
          <div className={`flex items-center p-0.5 rounded-lg border text-[10px] font-semibold ${
            theme === "light" ? "bg-slate-100 border-slate-200" : "bg-slate-950 border-slate-800"
          }`}>
            <button
              type="button"
              onClick={() => setActiveLaneFilter("all")}
              className={`px-2 py-0.5 rounded cursor-pointer transition ${
                activeLaneFilter === "all"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
              }`}
            >
              All Lanes
            </button>
            <button
              type="button"
              onClick={() => setActiveLaneFilter("dark")}
              className={`px-2 py-0.5 rounded cursor-pointer transition ${
                activeLaneFilter === "dark"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
              }`}
            >
              Dark Option
            </button>
            <button
              type="button"
              onClick={() => setActiveLaneFilter("light")}
              className={`px-2 py-0.5 rounded cursor-pointer transition ${
                activeLaneFilter === "light"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-white"
              }`}
            >
              Light Option
            </button>
          </div>

          <div className={`h-4 w-px ${theme === "light" ? "bg-slate-200" : "bg-slate-800"}`} />

          {/* Step Count */}
          <span className={`text-[11px] font-mono ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
            {displayScreens.length} Screens Captured
          </span>
        </div>

        {/* Switch back to single-screen simulator */}
        {onSwitchToSimulator && (
          <button
            type="button"
            onClick={onSwitchToSimulator}
            className={`border px-3 py-1.5 rounded-xl shadow-xl flex items-center gap-1.5 text-xs font-semibold transition cursor-pointer backdrop-blur-md ${
              theme === "light"
                ? "bg-white/95 border-slate-200 text-slate-700 hover:text-slate-900 hover:border-indigo-400"
                : "bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:border-indigo-500/50"
            }`}
            title="Switch back to side-by-side comparison"
          >
            <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
            <span>Simulator View</span>
          </button>
        )}
      </div>

      {/* Floating Canvas Zoom Controls */}
      <div className={`absolute bottom-5 right-6 z-30 flex items-center gap-1 backdrop-blur-md p-1 rounded-xl shadow-xl no-pan border ${
        theme === "light" ? "bg-white/95 border-slate-200 text-slate-700" : "bg-slate-900/90 border-slate-800 text-slate-300"
      }`}>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - 0.1, 0.4))}
          className={`p-1.5 rounded-lg transition cursor-pointer ${
            theme === "light" ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100" : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleResetZoom}
          className={`px-2 py-1 rounded-lg text-[11px] font-mono font-semibold transition cursor-pointer ${
            theme === "light" ? "text-slate-700 hover:text-slate-900 hover:bg-slate-100" : "text-slate-300 hover:text-white hover:bg-slate-800"
          }`}
          title="Reset Zoom to 85%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z + 0.1, 1.5))}
          className={`p-1.5 rounded-lg transition cursor-pointer ${
            theme === "light" ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100" : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleFitToView}
          className={`p-1.5 rounded-lg transition cursor-pointer ${
            theme === "light" ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100" : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
          title="Fit Canvas to Viewport"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Transformable Canvas Workspace */}
      <div
        className="absolute top-0 left-0 origin-top-left transition-transform duration-75"
        style={{
          width: `${CANVAS_TOTAL_WIDTH}px`,
          height: `${CANVAS_TOTAL_HEIGHT}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG PROTOTYPE CONNECTION WIRES LAYER */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
          style={{ width: "100%", height: "100%" }}
        >
          <defs>
            {/* Figma Arrowhead Marker */}
            <marker
              id="figma-arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 8 5 L 0 9 z" fill="#38bdf8" />
            </marker>

            {/* Glowing filter for active wires */}
            <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Render all curved wires */}
          {connectionWires
            .filter((w) => activeLaneFilter === "all" || w.row === activeLaneFilter)
            .map((wire) => {
              const isHovered = hoveredWireId === wire.id
              return (
                <g key={wire.id} className="pointer-events-auto">
                  {/* Invisible thicker hit-testing stroke for easy hover */}
                  <path
                    d={wire.path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    onMouseEnter={() => setHoveredWireId(wire.id)}
                    onMouseLeave={() => setHoveredWireId(null)}
                    className="cursor-pointer"
                  />

                  {/* Visual Glowing Wire */}
                  <path
                    d={wire.path}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth={isHovered ? 3.5 : 2}
                    strokeOpacity={isHovered ? 1 : 0.85}
                    markerEnd="url(#figma-arrow)"
                    filter={isHovered ? "url(#wire-glow)" : undefined}
                    className="transition-all duration-150"
                  />

                  {/* Wire Origin Anchor Dot (○) */}
                  <circle
                    cx={wire.fromX}
                    cy={wire.fromY}
                    r={isHovered ? 5.5 : 4}
                    fill="#38bdf8"
                    stroke="#ffffff"
                    strokeWidth={2}
                    className="shadow-sm"
                  />

                  {/* Wire Destination Anchor Dot (○) */}
                  <circle
                    cx={wire.toX}
                    cy={wire.toY}
                    r={isHovered ? 5 : 3.5}
                    fill="#0284c7"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </g>
              )
            })}
        </svg>

        {/* 1. TABLE OF CONTENTS STACKED START CARD (LEFT COLUMN) */}
        <div className="absolute left-[80px] top-[280px] z-20 space-y-2.5 no-pan">
          {/* Header pill matching user reference image */}
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide">
            <span className="w-5 h-5 rounded bg-sky-500 text-white flex items-center justify-center shadow-xs">
              <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
            </span>
            <span className={theme === "light" ? "text-slate-600" : "text-slate-400"}>Table of contents</span>
          </div>

          {/* Unified Stacked Card (Top: Dark Option, Bottom: Light Option) */}
          <div className={`w-[220px] rounded-2xl overflow-hidden shadow-2xl border divide-y ${
            theme === "light"
              ? "border-slate-300 divide-slate-200 shadow-slate-300/50"
              : "border-slate-700/60 divide-slate-700/60"
          }`}>
            {/* Top Half: Dark Option */}
            <div
              className="relative h-[160px] bg-[#232730] flex flex-col justify-center items-center p-4 text-center cursor-pointer hover:bg-[#2b303c] transition group"
              onClick={() => {
                setActiveLaneFilter("dark")
                setSelectedScreenIndex(0)
              }}
            >
              <h3 className="text-base font-bold text-white tracking-tight">Dark option</h3>
              {/* Output Anchor Dot with white center */}
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-md flex items-center justify-center z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
            </div>

            {/* Bottom Half: Light Option */}
            <div
              className="relative h-[160px] bg-white flex flex-col justify-center items-center p-4 text-center cursor-pointer hover:bg-slate-50 transition group"
              onClick={() => {
                setActiveLaneFilter("light")
                setSelectedScreenIndex(0)
              }}
            >
              <h3 className="text-base font-bold text-slate-900 tracking-tight">Light option</h3>
              {/* Output Anchor Dot with white center */}
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-md flex items-center justify-center z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
            </div>
          </div>
        </div>

        {/* 2. LANE 1: DARK OPTION ROW */}
        {(activeLaneFilter === "all" || activeLaneFilter === "dark") && (
          <div className="absolute top-[80px] left-[380px] z-20 no-pan">
            <div className="flex items-center gap-2 mb-4">
              <h2 className={`text-sm font-bold tracking-tight ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                Dark Option
              </h2>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold ${
                theme === "light" ? "bg-slate-200 text-slate-700" : "bg-slate-800 text-slate-300"
              }`}>
                Lane 1 · Captured Flow
              </span>
            </div>

            <div className="flex items-start gap-[140px]">
              {displayScreens.map((screen, idx) => (
                <div key={`dark-screen-${idx}`} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px] px-1">
                    <span className={`font-semibold ${theme === "light" ? "text-slate-600" : "text-slate-300"}`}>Mockup</span>
                    <span className={`font-mono text-[10px] ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>#{idx + 1}</span>
                  </div>

                  {/* Device Mockup Card */}
                  <MockupCard
                    screen={screen}
                    index={idx}
                    variant="dark"
                    isSelected={selectedScreenIndex === idx}
                    isHovered={hoveredScreenIndex === idx}
                    onHover={(hover) => setHoveredScreenIndex(hover ? idx : null)}
                    onClick={() => {
                      setSelectedScreenIndex(idx)
                      onSelectScreen?.(idx)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. LANE 2: LIGHT OPTION ROW */}
        {(activeLaneFilter === "all" || activeLaneFilter === "light") && (
          <div className="absolute top-[680px] left-[380px] z-20 no-pan">
            <div className="flex items-center gap-2 mb-4">
              <h2 className={`text-sm font-bold tracking-tight ${theme === "light" ? "text-slate-900" : "text-slate-100"}`}>
                Light Option
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold bg-sky-100 dark:bg-indigo-950/80 border border-sky-300 dark:border-indigo-800/40 text-sky-800 dark:text-indigo-300">
                Lane 2 · Light Theme Variant
              </span>
            </div>

            <div className="flex items-start gap-[140px]">
              {displayScreens.map((screen, idx) => (
                <div key={`light-screen-${idx}`} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                    <span className="font-semibold text-slate-300">Mockup</span>
                    <span className="font-mono text-[10px]">#{idx + 1}</span>
                  </div>

                  {/* Device Mockup Card */}
                  <MockupCard
                    screen={screen}
                    index={idx}
                    variant="light"
                    isSelected={selectedScreenIndex === idx}
                    isHovered={hoveredScreenIndex === idx}
                    onHover={(hover) => setHoveredScreenIndex(hover ? idx : null)}
                    onClick={() => {
                      setSelectedScreenIndex(idx)
                      onSelectScreen?.(idx)
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 4. DETAIL INSPECTION DRAWER (WHEN A MOCKUP IS CLICKED) */}
      {selectedScreen && (
        <div className={`absolute top-0 right-0 h-full w-[360px] border-l shadow-2xl z-40 p-5 flex flex-col overflow-y-auto no-pan backdrop-blur-xl animate-in slide-in-from-right duration-200 ${
          theme === "light"
            ? "bg-white/98 border-slate-200 text-slate-900"
            : "bg-slate-950/98 border-slate-800 text-white"
        }`}>
          <div className={`flex items-center justify-between pb-4 border-b ${theme === "light" ? "border-slate-200" : "border-slate-800"}`}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 flex items-center justify-center text-xs font-bold font-mono">
                {(selectedScreenIndex ?? 0) + 1}
              </div>
              <h3 className={`text-sm font-bold truncate max-w-[220px] ${theme === "light" ? "text-slate-900" : "text-white"}`}>
                {selectedScreen.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setSelectedScreenIndex(null)}
              className={`p-1 rounded-lg transition cursor-pointer ${theme === "light" ? "text-slate-500 hover:text-slate-900 hover:bg-slate-100" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Screen Thumbnail Preview */}
          <div className={`mt-4 rounded-xl overflow-hidden border aspect-[9/16] max-h-[260px] relative ${
            theme === "light" ? "border-slate-200 bg-slate-100" : "border-slate-800 bg-slate-900"
          }`}>
            {selectedScreen.screenshotUrl ? (
              <img
                src={selectedScreen.screenshotUrl}
                alt={selectedScreen.title}
                className="w-full h-full object-cover object-top"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-500">
                <Smartphone className="w-8 h-8 opacity-40" />
                <span className="text-xs">Live Screen Frame</span>
              </div>
            )}
            <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
              {selectedScreen.path || selectedScreen.url}
            </span>
          </div>

          {/* Status Badges */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-mono">Page Type</span>
              <span className="text-xs font-bold text-indigo-300 uppercase">
                {selectedScreen.pageType || "SCREEN"}
              </span>
            </div>
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-[10px] text-slate-500 block uppercase font-mono">Defects Found</span>
              <span
                className={`text-xs font-bold flex items-center gap-1 ${
                  (selectedScreen.issuesCount ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {(selectedScreen.issuesCount ?? 0) > 0 ? (
                  <>
                    <AlertTriangle className="w-3 h-3" />
                    {selectedScreen.issuesCount} Issues
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Passed Visual QA
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Detected Issues List */}
          {selectedScreen.issues && selectedScreen.issues.length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-xs font-bold text-slate-300">Visual Quality Defects</h4>
              {selectedScreen.issues.map((issue, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-800/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-rose-300">
                      {issue.title || issue.type || "UI Defect"}
                    </span>
                    <span className="text-[9px] font-mono uppercase px-1 rounded bg-rose-500/20 text-rose-400 font-bold">
                      {issue.severity}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{issue.description}</p>
                  {issue.recommendation && (
                    <div className="text-[10px] text-indigo-300 font-mono pt-1">
                      Fix: {issue.recommendation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Open in Live Simulator Button */}
          <div className="mt-auto pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={() => {
                onSelectScreen?.(selectedScreenIndex ?? 0)
                onSwitchToSimulator?.()
              }}
              className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition cursor-pointer"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Inspect in Live Simulator</span>
              <ArrowRight className="w-3.5 h-3.5 ml-auto" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MOCKUP DEVICE CARD COMPONENT (Matches the user reference image mobile frames)
// ============================================================================

interface MockupCardProps {
  screen: FlowScreenItem
  index: number
  variant: "dark" | "light"
  isSelected: boolean
  isHovered: boolean
  onHover: (hover: boolean) => void
  onClick: () => void
}

function MockupCard({
  screen,
  index,
  variant,
  isSelected,
  isHovered,
  onHover,
  onClick,
}: MockupCardProps) {
  const isDark = variant === "dark"
  const imageToDisplay = isDark
    ? screen.screenshotUrl
    : (screen.lightScreenshotUrl || screen.screenshots?.["Mobile_Light"] || screen.screenshotUrl)

  const isLightInversion = !isDark && !screen.lightScreenshotUrl && !screen.screenshots?.["Mobile_Light"] && Boolean(screen.screenshotUrl)

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
      className={`relative w-[280px] h-[480px] rounded-[32px] p-2.5 flex flex-col shadow-2xl transition-all duration-200 cursor-pointer ${
        isDark
          ? "bg-[#181d28] border-2 border-slate-700/80 hover:border-sky-400 hover:shadow-sky-500/10"
          : "bg-white border-2 border-slate-300 hover:border-sky-400 hover:shadow-sky-500/10"
      } ${
        isSelected
          ? "ring-2 ring-sky-400 border-sky-400 shadow-xl shadow-sky-500/20 scale-[1.02]"
          : isHovered
          ? "scale-[1.01]"
          : ""
      }`}
    >
      {/* Target input anchor at center-left */}
      <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-md flex items-center justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
      </div>

      {/* Target input anchor at center-right */}
      <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-md flex items-center justify-center">
        <span className="w-1.5 h-1.5 rounded-full bg-white" />
      </div>

      {/* Screen Frame Inner Canvas */}
      <div
        className={`w-full h-full rounded-[24px] overflow-hidden flex flex-col relative ${
          isDark ? "bg-[#0f131c] text-white" : "bg-[#f8fafc] text-slate-800"
        }`}
      >
        {/* Device Status Bar */}
        <div
          className={`h-5 w-full flex items-center justify-between px-4 text-[9px] font-semibold shrink-0 ${
            isDark ? "text-slate-400" : "text-slate-600"
          }`}
        >
          <span>9:41 AM</span>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span className="text-[8px] font-mono">100%</span>
          </div>
        </div>

        {/* App Header (Logo e.g. "LIKED" + Menu icon) */}
        <div
          className={`h-9 w-full flex items-center justify-between px-3 border-b shrink-0 ${
            isDark
              ? "bg-[#272626] border-neutral-800 text-white"
              : "bg-white border-slate-200 text-slate-800"
          }`}
        >
          <div className="flex items-center gap-1.5 max-w-[200px] truncate">
            <span
              className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${
                isDark ? "bg-neutral-700 text-white" : "bg-teal-500 text-white"
              }`}
            >
              ✦
            </span>
            <span className="text-xs font-bold tracking-wider truncate uppercase">
              {screen.title ? screen.title.slice(0, 16) : "LIKED"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 w-3.5 items-end shrink-0">
            <span className={`w-full h-[1.5px] rounded-full ${isDark ? "bg-white" : "bg-slate-700"}`} />
            <span className={`w-2.5 h-[1.5px] rounded-full ${isDark ? "bg-white" : "bg-slate-700"}`} />
            <span className={`w-full h-[1.5px] rounded-full ${isDark ? "bg-white" : "bg-slate-700"}`} />
          </div>
        </div>

        {/* Screenshot Viewport or Stylized Mockup Preview */}
        <div className="flex-1 w-full overflow-hidden relative">
          {imageToDisplay ? (
            <img
              src={imageToDisplay}
              alt={screen.title}
              className={`w-full h-full object-cover object-top ${
                isLightInversion ? "filter invert-[0.9] hue-rotate-180 brightness-105" : ""
              }`}
            />
          ) : (
            // Stylized mockup cards matching the user reference image
            <div className={`p-2.5 space-y-2 h-full flex flex-col justify-start ${isDark ? "text-slate-300" : "text-slate-700"}`}>
              {index === 0 && (
                <>
                  <div className="flex items-center gap-1.5 text-[9px] opacity-75">
                    <div className="w-4 h-4 rounded-full bg-slate-400" />
                    <span>User timeline</span>
                  </div>
                  <div
                    className={`w-full h-24 rounded-lg overflow-hidden flex items-center justify-center text-[10px] ${
                      isDark
                        ? "bg-amber-700/30 border border-amber-500/30 text-amber-200"
                        : "bg-amber-100 border border-amber-300 text-amber-800"
                    }`}
                  >
                    🌄 Hero Feed Photo
                  </div>
                  <div className="space-y-1">
                    <div className={`h-2 w-3/4 rounded ${isDark ? "bg-slate-700/50" : "bg-slate-300"}`} />
                    <div className={`h-2 w-1/2 rounded ${isDark ? "bg-slate-700/30" : "bg-slate-200"}`} />
                  </div>
                </>
              )}
              {index === 1 && (
                <>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div
                      className={`h-16 rounded flex items-center justify-center text-[9px] ${
                        isDark
                          ? "bg-emerald-900/40 border border-emerald-500/30 text-emerald-300"
                          : "bg-emerald-100 border border-emerald-300 text-emerald-800"
                      }`}
                    >
                      Nature
                    </div>
                    <div
                      className={`h-16 rounded flex items-center justify-center text-[9px] ${
                        isDark
                          ? "bg-blue-900/40 border border-blue-500/30 text-blue-300"
                          : "bg-blue-100 border border-blue-300 text-blue-800"
                      }`}
                    >
                      Cityscapes
                    </div>
                    <div
                      className={`h-16 rounded flex items-center justify-center text-[9px] ${
                        isDark
                          ? "bg-purple-900/40 border border-purple-500/30 text-purple-300"
                          : "bg-purple-100 border border-purple-300 text-purple-800"
                      }`}
                    >
                      Portraits
                    </div>
                    <div
                      className={`h-16 rounded flex items-center justify-center text-[9px] ${
                        isDark
                          ? "bg-rose-900/40 border border-rose-500/30 text-rose-300"
                          : "bg-rose-100 border border-rose-300 text-rose-800"
                      }`}
                    >
                      Studio
                    </div>
                  </div>
                </>
              )}
              {index >= 2 && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-3">
                  <div
                    className={`w-full py-1.5 px-2 rounded-lg text-[10px] text-left ${
                      isDark
                        ? "bg-slate-800/60 border border-slate-700/50 text-slate-400"
                        : "bg-white border border-slate-300 text-slate-600 shadow-xs"
                    }`}
                  >
                    🔍 Search for something
                  </div>
                  <div
                    className={`w-12 h-12 rounded-full border-2 border-dashed flex items-center justify-center mt-2 ${
                      isDark ? "border-slate-600/50 text-slate-500" : "border-slate-300 text-slate-400"
                    }`}
                  >
                    ◎
                  </div>
                  <span className="text-[10px] opacity-75">Search results & filters</span>
                </div>
              )}
            </div>
          )}

          {/* Page Type floating badge */}
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase bg-black/75 text-white backdrop-blur-xs">
            {screen.pageType || "PAGE"}
          </span>
        </div>

        {/* Bottom Tab Bar with Figma Prototype Hotspot Anchor Dots */}
        <div
          className={`h-11 w-full flex items-center justify-around border-t shrink-0 px-2 relative ${
            isDark
              ? "bg-[#272626] border-neutral-800 text-slate-400"
              : "bg-white border-slate-200 text-slate-600"
          }`}
        >
          {/* Tab 1: Timeline */}
          <div className="relative flex flex-col items-center gap-0.5 cursor-pointer group">
            <span className="text-[10px]">⏱</span>
            <span className="text-[8px] font-medium">Timeline</span>
            {/* Blue anchor circle */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-sky-400 border border-white shadow-xs" />
          </div>

          {/* Tab 2: Favorites */}
          <div className="relative flex flex-col items-center gap-0.5 cursor-pointer group">
            <span className="text-[10px] text-teal-400">♥</span>
            <span className="text-[8px] font-medium text-teal-400">Favorites</span>
            {/* Blue anchor circle */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-sky-400 border border-white shadow-xs" />
          </div>

          {/* Tab 3: Search */}
          <div className="relative flex flex-col items-center gap-0.5 cursor-pointer group">
            <span className="text-[10px]">🔍</span>
            <span className="text-[8px] font-medium">Search</span>
            {/* Blue anchor circle */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-sky-400 border border-white shadow-xs" />
          </div>
        </div>
      </div>
    </div>
  )
}
