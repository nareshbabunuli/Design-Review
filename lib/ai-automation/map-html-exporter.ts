import type {
  FlowGraph,
  AppScreenNode,
  TestPlanStep,
  AppWorkflowTransition,
  FullAppTestPlan,
} from "./types"

export interface AppMapExportParams {
  graph?: FlowGraph
  screens?: (AppScreenNode | any)[]
  steps?: TestPlanStep[]
  transitions?: AppWorkflowTransition[]
  plan?: FullAppTestPlan | any
  title?: string
  targetUrl?: string
  timestamp?: string
}

/**
 * Generates a self-contained, interactive HTML document of the visual App Map.
 * Includes interactive pan & zoom, screen nodes, transition curves, search, inspector, and print styles.
 */
export function generateAppMapHtml({
  graph,
  screens = [],
  steps = [],
  transitions = [],
  plan,
  title = "App Workflow & Navigation Map",
  targetUrl = "http://localhost:3000",
  timestamp,
}: AppMapExportParams): string {
  const exportTime = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString()

  // Consolidate screen nodes from plan or graph
  const rawNodes = (plan?.screens?.length ? plan.screens : screens?.length ? screens : graph?.nodes || []) as any[]

  // Format nodes with sanitized metadata
  const allSteps = (steps?.length ? steps : plan?.steps || []) as any[]

  // Format nodes with sanitized metadata and error/blocked detection
  const nodes = rawNodes.map((s: any, idx: number) => {
    const id = s.id || `S${String(idx + 1).padStart(3, "0")}`
    const name = s.name || s.title || `Screen ${idx + 1}`
    const path = s.path || s.route || s.url || "/"
    const screenshotUrl = s.screenshotUrl || s.thumbnailUrl || s.screenshots?.desktop || ""
    const elements = s.actionableElements || []

    // Detect if this screen has any failed or blocked actions in test plan
    const matchingSteps = allSteps.filter(
      (st: any) => st.screenId === id || (st.screenName && st.screenName.toLowerCase() === name.toLowerCase())
    )
    const hasError = matchingSteps.some(
      (st: any) => st.status === "failed" || st.verdict === "failed" || Boolean(st.error)
    )
    const hasBlocked = matchingSteps.some(
      (st: any) => st.status === "blocked" || st.verdict === "blocked" || st.status === "suspected_non_functional"
    )

    let status = (s as any).status || "discovered"
    if (hasError || status === "error" || status === "failed") status = "failed"
    else if (hasBlocked || status === "blocked") status = "blocked"

    const isBlocked = status === "blocked" || status === "failed" || status === "error"
    const errorMessage = matchingSteps.find((st: any) => st.error)?.error || ""

    return {
      id,
      name,
      path,
      screenshotUrl,
      elementsCount: elements.length,
      elements: elements.slice(0, 50).map((el: any) => ({
        type: el.type || el.tagName || "element",
        text: el.text || el.name || el.label || "",
        selector: el.selector || "",
      })),
      status,
      isBlocked,
      errorMessage,
    }
  })

  const blockedScreenIds = new Set(nodes.filter((n) => n.isBlocked).map((n) => n.id))

  // Consolidate transitions/edges
  const rawEdges = (
    transitions && transitions.length > 0
      ? transitions
      : plan?.transitions && plan.transitions.length > 0
        ? plan.transitions
        : graph?.edges && graph.edges.length > 0
          ? graph.edges
          : []
  ) as any[]

  const edges = rawEdges
    .map((e: any) => {
      const from = e.fromScreenId || e.from || e.source || e.fromId
      const to = e.toScreenId || e.to || e.target || e.toId
      const label = e.action || e.label || e.name || "navigates to"
      const actionType = e.actionType || e.type || "navigation"
      const isBlocked =
        actionType === "blocked" ||
        blockedScreenIds.has(from) ||
        blockedScreenIds.has(to) ||
        /blocked|fail|error/i.test(label)
      return { from, to, label, actionType, isBlocked }
    })
    .filter((e) => e.from && e.to)

  const totalScreens = nodes.length
  const totalElements = nodes.reduce((sum, n) => sum + n.elementsCount, 0)
  const totalEdges = edges.length
  const passedCount = steps.filter((s) => s.status === "passed").length
  const totalSteps = steps.length
  const coveragePct = totalSteps > 0 ? Math.round((passedCount / totalSteps) * 100) : 100

  // Serialize safe JSON for client hydration
  const safeJsonData = JSON.stringify({
    title,
    targetUrl,
    exportTime,
    nodes,
    edges,
    coveragePct,
  }).replace(/</g, "\\u003c")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Interactive App Map</title>
  <style>
    :root {
      --bg-color: #090a0f;
      --card-bg: #11131c;
      --card-border: #1f2333;
      --card-hover: #292e42;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --node-width: 260px;
      --node-height: 200px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      overflow: hidden;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      user-select: none;
    }

    /* TOP HEADER BAR */
    header {
      height: 56px;
      background: rgba(13, 15, 23, 0.95);
      border-bottom: 1px solid #1e2230;
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      z-index: 50;
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
      color: #fff;
      letter-spacing: -0.2px;
    }

    .brand-icon {
      width: 24px;
      height: 24px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }

    .target-badge {
      background: #181b28;
      border: 1px solid #282d3f;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #a5b4fc;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .metrics-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11px;
    }

    .metric-chip {
      background: rgba(30, 34, 48, 0.6);
      border: 1px solid #282d3f;
      padding: 3px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--text-muted);
    }

    .metric-chip strong {
      color: #fff;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .search-box {
      background: #151824;
      border: 1px solid #282d3f;
      border-radius: 8px;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .search-box input {
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 11px;
      width: 140px;
    }

    .search-box input::placeholder {
      color: #64748b;
    }

    .btn {
      background: #1e2230;
      border: 1px solid #2d3348;
      color: #e2e8f0;
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .btn:hover {
      background: #2d3348;
      color: #fff;
      border-color: #3e4663;
    }

    .btn-primary {
      background: #4f46e5;
      border-color: #6366f1;
      color: #fff;
    }

    .btn-primary:hover {
      background: #4338ca;
    }

    /* CANVAS WORKSPACE */
    #canvas-container {
      flex: 1;
      position: relative;
      overflow: hidden;
      cursor: grab;
      background-color: var(--bg-color);
      background-image: radial-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px);
      background-size: 24px 24px;
    }

    #canvas-container.grabbing {
      cursor: grabbing;
    }

    #canvas-world {
      position: absolute;
      top: 0;
      left: 0;
      width: 10000px;
      height: 10000px;
      transform-origin: 0 0;
      pointer-events: none;
    }

    #svg-connections {
      position: absolute;
      top: 0;
      left: 0;
      width: 10000px;
      height: 10000px;
      pointer-events: none;
      z-index: 5;
      overflow: visible;
    }

    .conn-glow {
      fill: none;
      stroke-width: 5px;
      stroke-opacity: 0.22;
      pointer-events: none;
    }

    .conn-path {
      fill: none;
      stroke-width: 2px;
      transition: stroke-width 0.15s ease, stroke-opacity 0.15s ease;
      pointer-events: stroke;
      cursor: pointer;
    }

    .conn-path.forward {
      stroke: #6366f1;
      stroke-opacity: 0.85;
    }

    .conn-path.return {
      stroke: #10b981;
      stroke-opacity: 0.9;
      stroke-dasharray: 6 3;
    }

    .conn-path.highlighted {
      stroke: #a855f7 !important;
      stroke-width: 3.5px !important;
      stroke-opacity: 1 !important;
      filter: drop-shadow(0 0 6px #a855f7);
    }

    .edge-pill {
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.15s ease;
    }

    .edge-pill:hover rect {
      fill: #064e3b !important;
      stroke: #10b981 !important;
    }

    .edge-pill:hover text {
      fill: #fff !important;
    }

    .conn-path.blocked {
      stroke: #ef4444 !important;
      stroke-width: 2.5px !important;
      stroke-dasharray: 5 4 !important;
      stroke-opacity: 0.95 !important;
      animation: dashBlocked 20s linear infinite;
    }

    @keyframes dashBlocked {
      to {
        stroke-dashoffset: -500;
      }
    }

    .conn-glow.blocked {
      stroke: #7f1d1d !important;
      stroke-opacity: 0.55 !important;
      stroke-width: 6px !important;
    }

    .edge-pill.blocked rect {
      fill: #450a0a !important;
      stroke: #ef4444 !important;
    }

    .edge-pill.blocked text {
      fill: #fca5a5 !important;
    }

    /* SCREEN CARDS */
    .screen-card {
      position: absolute;
      width: var(--node-width);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      cursor: grab;
      user-select: none;
      touch-action: none;
      pointer-events: auto;
      transition: box-shadow 0.15s ease, border-color 0.15s ease;
      z-index: 10;
    }

    .screen-card:active {
      cursor: grabbing;
    }

    .screen-card:hover {
      border-color: #6366f1;
      box-shadow: 0 16px 32px rgba(99, 102, 241, 0.25);
      z-index: 20;
    }

    .screen-card.is-blocked {
      border: 2px solid #ef4444 !important;
      box-shadow: 0 0 25px rgba(239, 68, 68, 0.4), 0 10px 25px rgba(0, 0, 0, 0.6) !important;
      background: linear-gradient(180deg, rgba(38, 12, 18, 0.95) 0%, rgba(17, 19, 28, 0.98) 100%) !important;
    }

    .screen-card.is-blocked:hover {
      box-shadow: 0 0 35px rgba(239, 68, 68, 0.6), 0 16px 32px rgba(0, 0, 0, 0.8) !important;
      border-color: #f87171 !important;
    }

    .screen-card.active {
      border-color: #a855f7;
      box-shadow: 0 0 0 2px #a855f7, 0 16px 32px rgba(168, 85, 247, 0.3);
      z-index: 30;
    }

    /* EXPANDED CARDS */
    .screen-card.expanded {
      width: 320px !important;
      z-index: 25;
    }

    .screen-card.expanded .card-preview {
      height: 150px !important;
    }

    .screen-card.expanded .card-expanded-content {
      display: block !important;
    }

    .card-expanded-content {
      display: none;
      padding: 0 12px 10px 12px;
      border-top: 1px solid #1a1e2b;
      margin-top: 8px;
    }

    .card-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }

    .card-tag {
      background: #141724;
      border: 1px solid #23283a;
      color: #94a3b8;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .blocked-notice {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      font-size: 10px;
      font-weight: 600;
      padding: 5px 8px;
      border-radius: 6px;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-card-expand {
      background: #181c2a;
      border: 1px solid #282f44;
      color: #94a3b8;
      width: 22px;
      height: 22px;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-card-expand:hover {
      background: #252e47;
      color: #fff;
      border-color: #4f46e5;
    }

    .card-preview {
      height: 120px;
      background: #0d0e14;
      position: relative;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border-bottom: 1px solid #1a1e2b;
    }

    .card-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      transition: transform 0.2s ease;
    }

    .screen-card:hover .card-preview img {
      transform: scale(1.04);
    }

    .card-preview-placeholder {
      font-size: 32px;
      opacity: 0.3;
    }

    .card-id-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 2px 7px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 700;
      color: #cbd5e1;
      font-family: ui-monospace, monospace;
    }

    .card-status-badge {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 2px 7px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-passed { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .status-failed, .status-error { background: rgba(239, 68, 68, 0.25); color: #fca5a5; border: 1px solid #ef4444; font-weight: 800; }
    .status-blocked { background: rgba(239, 68, 68, 0.25); color: #fca5a5; border: 1px solid #ef4444; font-weight: 800; }
    .status-discovered { background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); }

    .card-body {
      padding: 10px 12px;
    }

    .card-title {
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-path {
      font-size: 10px;
      font-family: ui-monospace, monospace;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 2px;
    }

    .card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #1a1e2b;
      font-size: 10px;
      color: #64748b;
    }

    .card-badge {
      background: #181b28;
      padding: 2px 6px;
      border-radius: 4px;
      color: #a5b4fc;
      font-weight: 600;
    }

    /* FLOATING CONTROLS */
    .floating-hud {
      position: absolute;
      bottom: 20px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(17, 19, 28, 0.9);
      border: 1px solid #282d3f;
      padding: 5px;
      border-radius: 10px;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
      z-index: 40;
    }

    .hud-btn {
      width: 30px;
      height: 30px;
      background: transparent;
      border: none;
      color: #cbd5e1;
      font-size: 14px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .hud-btn:hover {
      background: #252a3d;
      color: #fff;
    }

    .zoom-text {
      font-size: 10px;
      font-family: ui-monospace, monospace;
      padding: 0 6px;
      color: #94a3b8;
    }

    /* SCREEN DETAILS MODAL / DRAWER */
    #detail-modal {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 440px;
      max-width: 90vw;
      background: #0f111a;
      border-left: 1px solid #23283a;
      box-shadow: -10px 0 30px rgba(0, 0, 0, 0.6);
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: text;
    }

    #detail-modal.open {
      transform: translateX(0);
    }

    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid #1e2333;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-close {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #1c2130;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 16px;
    }

    .modal-close:hover {
      background: #293046;
      color: #fff;
    }

    .modal-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
    }

    .detail-screenshot {
      width: 100%;
      border-radius: 10px;
      border: 1px solid #23283a;
      margin-bottom: 16px;
      background: #000;
    }

    .detail-elements-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }

    .element-item {
      background: #141724;
      border: 1px solid #1f2537;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11px;
    }

    .element-item strong {
      color: #818cf8;
    }

    .element-selector {
      font-family: ui-monospace, monospace;
      font-size: 10px;
      color: #64748b;
      margin-top: 3px;
      word-break: break-all;
    }

    /* PRINT STYLES */
    @media print {
      body {
        overflow: visible;
        height: auto;
        background: #fff;
        color: #000;
      }
      header, .floating-hud, #detail-modal {
        display: none !important;
      }
      #canvas-container {
        overflow: visible;
        height: auto;
        background: none;
      }
      #canvas-world {
        position: static;
        width: 100%;
        height: auto;
        transform: none !important;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 20px;
      }
      .screen-card {
        position: static;
        width: 100%;
        page-break-inside: avoid;
        box-shadow: none;
        border: 1px solid #ccc;
        background: #fff;
        color: #000;
      }
      .card-preview {
        background: #f1f5f9;
      }
    }
  </style>
</head>
<body>

  <!-- HEADER -->
  <header>
    <div class="header-left">
      <div class="brand-pill">
        <div class="brand-icon">🗺️</div>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="target-badge" title="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</div>
    </div>

    <div class="metrics-bar">
      <div class="metric-chip">Screens: <strong>${totalScreens}</strong></div>
      <div class="metric-chip">Elements: <strong>${totalElements}</strong></div>
      <div class="metric-chip">Transitions: <strong>${totalEdges}</strong></div>
      <div class="metric-chip">Coverage: <strong>${coveragePct}%</strong></div>
    </div>

    <div class="header-actions">
      <div class="search-box">
        <span>🔍</span>
        <input type="text" id="screen-search" placeholder="Search screens / paths..." oninput="handleSearch(this.value)">
      </div>
      <button class="btn" id="btn-toggle-front" onclick="toggleFrontLines()" title="Show or hide front/forward navigation lines">🔵 Front Nav: On</button>
      <button class="btn" id="btn-toggle-back" onclick="toggleBackLines()" title="Show or hide back/return navigation lines">🟢 Back Nav: On</button>
      <button class="btn" id="btn-toggle-expand" onclick="toggleExpandAll()" title="Expand all cards to show full journey and elements">↔ Expand Cards</button>
      <button class="btn" onclick="resetView()" title="Fit all screens in view">⊞ Fit View</button>
      <button class="btn" onclick="window.print()" title="Print or save as PDF">🖨️ Print / PDF</button>
      <button class="btn btn-primary" onclick="exportDataJson()" title="Download raw JSON data">⬇ Export JSON</button>
    </div>
  </header>

  <!-- CANVAS WORKSPACE -->
  <div id="canvas-container">
    <div id="canvas-world">
      <svg id="svg-connections">
        <defs>
          <marker id="figma-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,2 L8,5 L0,8 z" fill="#6366f1" />
          </marker>
          <marker id="figma-arrowhead-return" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,2 L8,5 L0,8 z" fill="#10b981" />
          </marker>
          <marker id="figma-arrowhead-blocked" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,2 L8,5 L0,8 z" fill="#ef4444" />
          </marker>
        </defs>
        <g id="edges-group"></g>
      </svg>
      <div id="nodes-container"></div>
    </div>

    <!-- HUD ZOOM CONTROLS -->
    <div class="floating-hud">
      <button class="hud-btn" onclick="zoomIn()" title="Zoom In">+</button>
      <span class="zoom-text" id="zoom-indicator">100%</span>
      <button class="hud-btn" onclick="zoomOut()" title="Zoom Out">−</button>
      <button class="hud-btn" onclick="resetView()" title="Reset Zoom">⟲</button>
    </div>
  </div>

  <!-- INSPECTOR DRAWER -->
  <div id="detail-modal">
    <div class="modal-header">
      <div>
        <h3 id="modal-title" style="font-size: 14px; font-weight: 700; color: #fff;">Screen Details</h3>
        <p id="modal-path" style="font-size: 11px; font-family: monospace; color: #94a3b8; margin-top: 2px;">/</p>
      </div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <img id="modal-img" class="detail-screenshot" src="" alt="Screen Preview">
      
      <div style="margin-bottom: 16px;">
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px;">Interactive Elements</span>
        <div id="modal-elements" class="detail-elements-list"></div>
      </div>

      <div>
        <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px;">Navigation Transitions</span>
        <div id="modal-transitions" style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px;"></div>
      </div>
    </div>
  </div>

  <script>
    const DATA = ${safeJsonData};

    const container = document.getElementById("canvas-container");
    const world = document.getElementById("canvas-world");
    const svg = document.getElementById("svg-connections");
    const nodesContainer = document.getElementById("nodes-container");
    const zoomText = document.getElementById("zoom-indicator");

    let panX = 60;
    let panY = 60;
    let zoom = 1.0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    let linesVisible = true;
    let allExpanded = false;
    const expandedNodes = new Set();

    // Node Positions map
    const nodePositions = {};

    function getCardDims() {
      const w = allExpanded ? 320 : 260;
      const h = allExpanded ? 240 : 180;
      return { w, h };
    }

    // Smart Bezier Curve Calculation matching live App Map
    function getSmartBezier(fromPos, toPos, width, height) {
      let x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y;
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;

      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
        x1 = fromPos.x + width * 0.75;
        y1 = fromPos.y;
        x2 = fromPos.x + width;
        y2 = fromPos.y + height * 0.25;
        const loopOffset = 50;
        cp1x = x1;
        cp1y = y1 - loopOffset;
        cp2x = x2 + loopOffset;
        cp2y = y2;
        const midX = fromPos.x + width + loopOffset * 0.45;
        const midY = fromPos.y - loopOffset * 0.45;
        return { path: \`M \${x1} \${y1} C \${cp1x} \${cp1y}, \${cp2x} \${cp2y}, \${x2} \${y2}\`, midX, midY };
      }

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx >= 0) {
          x1 = fromPos.x + width;
          y1 = fromPos.y + height / 2;
          x2 = toPos.x;
          y2 = toPos.y + height / 2;
          const curveOffset = Math.max(60, dx * 0.45);
          cp1x = x1 + curveOffset;
          cp1y = y1;
          cp2x = x2 - curveOffset;
          cp2y = y2;
        } else {
          x1 = fromPos.x;
          y1 = fromPos.y + height * 0.75;
          x2 = toPos.x + width;
          y2 = toPos.y + height * 0.75;
          const curveOffset = Math.max(60, Math.abs(dx) * 0.45);
          const arcDroop = 45;
          cp1x = x1 - curveOffset;
          cp1y = y1 + arcDroop;
          cp2x = x2 + curveOffset;
          cp2y = y2 + arcDroop;
        }
      } else {
        if (dy >= 0) {
          x1 = fromPos.x + width / 2;
          y1 = fromPos.y + height;
          x2 = toPos.x + width / 2;
          y2 = toPos.y;
          const curveOffset = Math.max(50, dy * 0.45);
          cp1x = x1;
          cp1y = y1 + curveOffset;
          cp2x = x2;
          cp2y = y2 - curveOffset;
        } else {
          x1 = fromPos.x + width / 2;
          y1 = fromPos.y;
          x2 = toPos.x + width / 2;
          y2 = toPos.y + height;
          const curveOffset = Math.max(50, Math.abs(dy) * 0.45);
          cp1x = x1;
          cp1y = y1 - curveOffset;
          cp2x = x2;
          cp2y = y2 + curveOffset;
        }
      }

      const t = 0.5;
      const midX =
        Math.pow(1 - t, 3) * x1 +
        3 * Math.pow(1 - t, 2) * t * cp1x +
        3 * (1 - t) * Math.pow(t, 2) * cp2x +
        Math.pow(t, 3) * x2;
      const midY =
        Math.pow(1 - t, 3) * y1 +
        3 * Math.pow(1 - t, 2) * t * cp1y +
        3 * (1 - t) * Math.pow(t, 2) * cp2y +
        Math.pow(t, 3) * y2;

      return { path: \`M \${x1} \${y1} C \${cp1x} \${cp1y}, \${cp2x} \${cp2y}, \${x2} \${y2}\`, midX, midY };
    }

    // Hierarchical DAG BFS Layout based on forward navigation edges (ignoring back/return cycles)
    function calculateLayout() {
      const nodes = DATA.nodes;
      if (!nodes.length) return;

      const rootId = nodes.find((n) => n.id === "S001")?.id || nodes[0].id;
      const levels = new Map();
      levels.set(rootId, 0);

      const forwardOutgoing = new Map();
      DATA.edges.forEach((e) => {
        if (e.from === e.to) return;
        const isExplicitReturn = /back|return|cancel|close|previous|undo/i.test(e.label || "");
        if (isExplicitReturn) return;

        if (!forwardOutgoing.has(e.from)) forwardOutgoing.set(e.from, []);
        forwardOutgoing.get(e.from).push(e.to);
      });

      const queue = [rootId];
      const visited = new Set([rootId]);
      while (queue.length > 0) {
        const curr = queue.shift();
        const currLevel = levels.get(curr) || 0;
        const children = forwardOutgoing.get(curr) || [];
        for (const child of children) {
          if (!visited.has(child)) {
            visited.add(child);
            levels.set(child, currLevel + 1);
            queue.push(child);
          }
        }
      }

      let maxAssignedLevel = 0;
      for (const l of levels.values()) {
        if (l > maxAssignedLevel) maxAssignedLevel = l;
      }
      let unreachedCount = 0;
      nodes.forEach((n) => {
        if (!levels.has(n.id)) {
          const targetLvl = Math.max(1, Math.min(maxAssignedLevel, 1 + Math.floor(unreachedCount / 3)));
          levels.set(n.id, targetLvl);
          unreachedCount++;
        }
      });

      const byLevel = new Map();
      for (const [id, lvl] of levels.entries()) {
        if (!byLevel.has(lvl)) byLevel.set(lvl, []);
        byLevel.get(lvl).push(id);
      }

      const colSpacingX = allExpanded ? 480 : 400;
      const rowSpacingY = allExpanded ? 340 : 260;
      const startX = 80;
      const startY = 80;

      const lvl1Ids = byLevel.get(1) || [];
      const rootCenterY = startY + Math.max(0, (Math.min(3, lvl1Ids.length) - 1) * 140);
      nodePositions[rootId] = { x: startX, y: rootCenterY };

      const sortedLevels = Array.from(byLevel.keys()).sort((a, b) => a - b);
      sortedLevels.forEach((lvl) => {
        if (lvl === 0) return;
        const ids = byLevel.get(lvl);
        const maxPerCol = 3;
        ids.forEach((id, idx) => {
          const subCol = Math.floor(idx / maxPerCol);
          const rowIdx = idx % maxPerCol;
          nodePositions[id] = {
            x: startX + lvl * colSpacingX + subCol * (allExpanded ? 350 : 300),
            y: startY + rowIdx * rowSpacingY,
          };
        });
      });
    }

    function renderWorld() {
      world.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoom})\`;
      zoomText.textContent = Math.round(zoom * 100) + "%";
    }

    function toggleLines() {
      linesVisible = !linesVisible;
      const btn = document.getElementById("btn-toggle-lines");
      if (btn) {
        btn.textContent = linesVisible ? "🔗 Lines: On" : "🚫 Lines: Off";
      }
      svg.style.display = linesVisible ? "block" : "none";
    }

    function toggleExpandAll() {
      allExpanded = !allExpanded;
      const btn = document.getElementById("btn-toggle-expand");
      if (btn) {
        btn.textContent = allExpanded ? "⤹ Collapse Cards" : "↔ Expand Cards";
      }
      calculateLayout();
      renderNodes();
      renderConnections();
    }

    function toggleCard(e, nodeId) {
      e.stopPropagation();
      if (expandedNodes.has(nodeId)) {
        expandedNodes.delete(nodeId);
      } else {
        expandedNodes.add(nodeId);
      }
      renderNodes();
      renderConnections();
    }

    // Draggable card logic
    let draggedCardId = null;
    let cardDragStartX = 0;
    let cardDragStartY = 0;
    let cardOrigX = 0;
    let cardOrigY = 0;
    let hasMoved = false;

    function initCardDrag(cardEl, nodeId) {
      cardEl.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button") || e.target.closest(".btn-card-expand")) return;
        draggedCardId = nodeId;
        cardDragStartX = e.clientX;
        cardDragStartY = e.clientY;
        const pos = nodePositions[nodeId] || { x: 0, y: 0 };
        cardOrigX = pos.x;
        cardOrigY = pos.y;
        hasMoved = false;
        cardEl.setPointerCapture(e.pointerId);
        e.stopPropagation();
      });

      cardEl.addEventListener("pointermove", (e) => {
        if (draggedCardId !== nodeId) return;
        const dx = (e.clientX - cardDragStartX) / zoom;
        const dy = (e.clientY - cardDragStartY) / zoom;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          hasMoved = true;
        }
        nodePositions[nodeId] = {
          x: cardOrigX + dx,
          y: cardOrigY + dy,
        };
        cardEl.style.left = nodePositions[nodeId].x + "px";
        cardEl.style.top = nodePositions[nodeId].y + "px";
        renderConnections();
      });

      cardEl.addEventListener("pointerup", (e) => {
        if (draggedCardId === nodeId) {
          try { cardEl.releasePointerCapture(e.pointerId); } catch (_) {}
          draggedCardId = null;
          if (!hasMoved) {
            openScreenModal(nodeId);
          }
        }
      });

      cardEl.addEventListener("pointercancel", (e) => {
        if (draggedCardId === nodeId) {
          try { cardEl.releasePointerCapture(e.pointerId); } catch (_) {}
          draggedCardId = null;
        }
      });
    }

    function renderNodes() {
      nodesContainer.innerHTML = "";
      DATA.nodes.forEach((node) => {
        const pos = nodePositions[node.id] || { x: 100, y: 100 };
        const card = document.createElement("div");
        const isExpanded = allExpanded || expandedNodes.has(node.id) || node.isBlocked;
        card.className = "screen-card" + (node.isBlocked ? " is-blocked" : "") + (isExpanded ? " expanded" : "");
        card.id = "card-" + node.id;
        card.style.left = pos.x + "px";
        card.style.top = pos.y + "px";

        const statusClass = "status-" + (node.status || "discovered");

        const sampleElements = (node.elements || []).slice(0, 4);

        card.innerHTML = \`
          <div class="card-preview">
            <span class="card-id-badge">\${node.id}</span>
            <span class="card-status-badge \${statusClass}">\${node.status}</span>
            \${node.screenshotUrl 
              ? \`<img src="\${node.screenshotUrl}" alt="\${node.name}" loading="lazy">\`
              : \`<div class="card-preview-placeholder">\${node.isBlocked ? '⚠️' : '📱'}</div>\`
            }
          </div>
          <div class="card-body">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
              <div class="card-title" title="\${node.name}">\${node.name}</div>
              <button class="btn-card-expand" onclick="toggleCard(event, '\${node.id}')" title="Expand / Collapse card">\${isExpanded ? '▲' : '▼'}</button>
            </div>
            <div class="card-path" title="\${node.path}">\${node.path}</div>
            
            \${node.isBlocked ? \`
              <div class="blocked-notice">
                <span>⛔</span>
                <span>\${node.errorMessage || 'Execution blocked at this screen'}</span>
              </div>
            \` : ''}

            <div class="card-expanded-content">
              \${sampleElements.length ? \`
                <div style="font-size: 10px; font-weight: 700; color: #64748b; margin-top: 6px; text-transform: uppercase;">Key Elements</div>
                <div class="card-tags">
                  \${sampleElements.map(el => \`<span class="card-tag" title="\${el.text || el.selector}">[\${el.type}] \${el.text || 'el'}</span>\`).join('')}
                </div>
              \` : ''}
            </div>

            <div class="card-meta">
              <span>Elements: <strong style="color: #fff;">\${node.elementsCount}</strong></span>
              <span class="card-badge">Inspect ➔</span>
            </div>
          </div>
        \`;

        initCardDrag(card, node.id);
        nodesContainer.appendChild(card);
      });
    }

    function renderConnections() {
      if (!linesVisible) return;
      const edgesGroup = document.getElementById("edges-group") || svg;
      edgesGroup.innerHTML = "";

      const { w: cardW, h: cardH } = getCardDims();

      DATA.edges.forEach((edge) => {
        const fromPos = nodePositions[edge.from];
        const toPos = nodePositions[edge.to];
        if (!fromPos || !toPos) return;

        const isBlocked = !!edge.isBlocked;
        const isReturn = /back|return|close/i.test(edge.label || "") || fromPos.x > toPos.x;

        if (isReturn && !showBackLines) return;
        if (!isReturn && !showFrontLines) return;

        const { path, midX, midY } = getSmartBezier(fromPos, toPos, cardW, cardH);

        // 1. Glow line
        const glow = document.createElementNS("http://www.w3.org/2000/svg", "path");
        glow.setAttribute("d", path);
        glow.setAttribute("class", "conn-glow" + (isBlocked ? " blocked" : ""));
        glow.setAttribute("stroke", isBlocked ? "#7f1d1d" : (isReturn ? "#064e3b" : "#4338ca"));
        edgesGroup.appendChild(glow);

        // 2. Main path with Arrowhead
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", path);
        p.setAttribute("class", "conn-path " + (isBlocked ? "blocked" : (isReturn ? "return" : "forward")));
        p.setAttribute(
          "marker-end",
          isBlocked 
            ? "url(#figma-arrowhead-blocked)" 
            : (isReturn ? "url(#figma-arrowhead-return)" : "url(#figma-arrowhead)")
        );
        p.setAttribute("data-from", edge.from);
        p.setAttribute("data-to", edge.to);
        p.onclick = (e) => {
          e.stopPropagation();
          panToNode(edge.to);
        };
        edgesGroup.appendChild(p);

        // 3. Action Label Pill at Midpoint
        if (edge.label) {
          const labelText = edge.label.length > 26 ? edge.label.slice(0, 25) + "…" : edge.label;
          const pillWidth = labelText.length * 6.6 + 18;

          const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
          g.setAttribute("class", "edge-pill" + (isBlocked ? " blocked" : ""));
          g.setAttribute("transform", \`translate(\${midX}, \${midY})\`);
          g.onclick = (e) => {
            e.stopPropagation();
            panToNode(edge.to);
          };

          const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          rect.setAttribute("x", -pillWidth / 2);
          rect.setAttribute("y", -10);
          rect.setAttribute("width", pillWidth);
          rect.setAttribute("height", 20);
          rect.setAttribute("rx", 6);
          rect.setAttribute("fill", isBlocked ? "#450a0a" : (isReturn ? "#064e3b" : "#0f172a"));
          rect.setAttribute("stroke", isBlocked ? "#ef4444" : (isReturn ? "#059669" : "#4338ca"));
          rect.setAttribute("stroke-width", "1");
          g.appendChild(rect);

          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", 0);
          text.setAttribute("y", 3.5);
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("fill", isBlocked ? "#fca5a5" : (isReturn ? "#6ee7b7" : "#c7d2fe"));
          text.setAttribute("font-size", "9.5");
          text.setAttribute("font-family", "ui-monospace, monospace");
          text.setAttribute("font-weight", "600");
          text.textContent = labelText;
          g.appendChild(text);

          edgesGroup.appendChild(g);
        }
      });
    }

    // Pan & Zoom controls
    container.addEventListener("mousedown", (e) => {
      if (e.target.closest(".screen-card") || e.target.closest(".floating-hud") || e.target.closest("button")) return;
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      container.classList.add("grabbing");
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      renderWorld();
    });

    window.addEventListener("mouseup", () => {
      isPanning = false;
      container.classList.remove("grabbing");
    });

    container.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = 1.1;
      const oldZoom = zoom;

      if (e.deltaY < 0) {
        zoom = Math.min(2.5, zoom * zoomFactor);
      } else {
        zoom = Math.max(0.2, zoom / zoomFactor);
      }

      // Zoom towards mouse pointer
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      panX = mouseX - (mouseX - panX) * (zoom / oldZoom);
      panY = mouseY - (mouseY - panY) * (zoom / oldZoom);

      renderWorld();
    }, { passive: false });

    function zoomIn() {
      zoom = Math.min(2.5, zoom * 1.2);
      renderWorld();
    }

    function zoomOut() {
      zoom = Math.max(0.2, zoom / 1.2);
      renderWorld();
    }

    function resetView() {
      panX = 60;
      panY = 60;
      zoom = 1.0;
      renderWorld();
    }

    function handleSearch(query) {
      const q = query.toLowerCase().trim();
      DATA.nodes.forEach((node) => {
        const el = document.getElementById("card-" + node.id);
        if (!el) return;
        if (!q || node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)) {
          el.style.opacity = "1";
          el.style.filter = "none";
        } else {
          el.style.opacity = "0.2";
          el.style.filter = "grayscale(100%)";
        }
      });
    }

    // Modal Inspector
    function openScreenModal(nodeId) {
      const node = DATA.nodes.find((n) => n.id === nodeId);
      if (!node) return;

      document.getElementById("modal-title").textContent = node.name;
      document.getElementById("modal-path").textContent = node.path + " (" + node.id + ")";
      const img = document.getElementById("modal-img");
      if (node.screenshotUrl) {
        img.src = node.screenshotUrl;
        img.style.display = "block";
      } else {
        img.style.display = "none";
      }

      const elementsList = document.getElementById("modal-elements");
      elementsList.innerHTML = "";
      if (node.elements && node.elements.length) {
        node.elements.forEach((el) => {
          const item = document.createElement("div");
          item.className = "element-item";
          item.innerHTML = \`
            <div><strong>[\${el.type}]</strong> \${el.text || 'Unnamed'}</div>
            \${el.selector ? \`<div class="element-selector">\${el.selector}</div>\` : ''}
          \`;
          elementsList.appendChild(item);
        });
      } else {
        elementsList.innerHTML = "<p style='color: #64748b; font-size: 11px;'>No interactive elements recorded.</p>";
      }

      const transList = document.getElementById("modal-transitions");
      transList.innerHTML = "";
      const outgoing = DATA.edges.filter((e) => e.from === node.id);
      if (outgoing.length) {
        outgoing.forEach((e) => {
          const target = DATA.nodes.find((n) => n.id === e.to);
          const pill = document.createElement("button");
          pill.className = "btn";
          pill.style.justifyContent = "space-between";
          pill.innerHTML = \`<span>➔ \${target ? target.name : e.to}</span> <span style="font-size: 9px; opacity: 0.6;">\${e.label}</span>\`;
          pill.onclick = () => {
            closeModal();
            panToNode(e.to);
          };
          transList.appendChild(pill);
        });
      } else {
        transList.innerHTML = "<p style='color: #64748b; font-size: 11px;'>No outgoing transitions.</p>";
      }

      document.getElementById("detail-modal").classList.add("open");

      // Highlight connections in SVG
      document.querySelectorAll(".conn-path").forEach((p) => {
        if (p.getAttribute("data-from") === nodeId || p.getAttribute("data-to") === nodeId) {
          p.classList.add("highlighted");
        } else {
          p.classList.remove("highlighted");
        }
      });
    }

    function closeModal() {
      document.getElementById("detail-modal").classList.remove("open");
      document.querySelectorAll(".conn-path").forEach((p) => p.classList.remove("highlighted"));
    }

    function panToNode(nodeId) {
      const pos = nodePositions[nodeId];
      if (!pos) return;
      const { w: cardW, h: cardH } = getCardDims();
      panX = (container.clientWidth / 2) - (pos.x + cardW / 2) * zoom;
      panY = (container.clientHeight / 2) - (pos.y + cardH / 2) * zoom;
      renderWorld();
      setTimeout(() => openScreenModal(nodeId), 200);
    }

    function exportDataJson() {
      const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "app-map-data-" + Date.now() + ".json";
      a.click();
    }

    // Default expand all cards and ensure all lines are visible for smooth visual journey
    allExpanded = true;
    const btn = document.getElementById("btn-toggle-expand");
    if (btn) btn.textContent = "⤹ Collapse Cards";

    // Initialize layout
    calculateLayout();
    renderNodes();
    renderConnections();
    renderWorld();
  </script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
