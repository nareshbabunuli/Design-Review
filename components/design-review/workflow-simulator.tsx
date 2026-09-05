"use client"

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react"
import {
  Monitor,
  Smartphone,
  Tablet,
  Laptop,
  Camera,
  ZoomIn,
  ZoomOut,
  Layers,
  Columns,
  SplitSquareVertical,
  CheckCircle2,
  X,
  Plus,
  Lock,
  Globe,
  SlidersHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Grid,
  Sparkles,
  Trash2,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  ExternalLink,
  Info,
  FileText,
  AlertCircle,
  Upload,
} from "lucide-react"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import {
  DeviceFrame,
  EXTENDED_DEVICE_PRESETS,
  DevicePresetExtended,
  DeviceFrameType,
  FrameFinish,
  getDeviceFrameMetrics,
} from "./device-frame"
import { ThemeToggle } from "./theme-toggle"
import { CanvasScreencast, CanvasScreencastRef } from "./canvas-screencast"

// ============================================================================
// Types & Constants
// ============================================================================

const DEVICE_CATEGORIES = ["Desktop", "Laptop", "Tablet", "Mobile", "Custom"] as const
type DeviceCategory = (typeof DEVICE_CATEGORIES)[number]

export interface WorkflowSimulatorProps {
  project: Project
  initialWorkflowId?: string | null
  isOwner?: boolean
  canEdit?: boolean
  userRole?: "client" | "freelancer" | "owner" | "developer" | null
  onSelectWorkflow?: (workflowId: string) => void
  onUpdateField?: (
    workflowId: string,
    field: "ourNotes" | "clientMessage" | "clientTaskDone" | "reason" | "figmaUrl" | "designA" | "designB",
    value: string | boolean | null
  ) => void
  onOpenPresentation?: () => void
  theme?: "light" | "dark"
  onToggleTheme?: () => void
}

interface Annotation {
  id: number
  x: number
  y: number
  title: string
  expected: string
  actual: string
  severity: "Low" | "Medium" | "High" | "Blocker"
  resolved: boolean
  author: string
  createdAt: string
}

interface CapturedScreenshot {
  id: string
  timestamp: string
  dimensions: string
  url: string
  mode: string
}

const SEVERITY_STYLES: Record<Annotation["severity"], { badge: string; pin: string }> = {
  Low: { badge: "bg-slate-500/20 text-slate-300 border border-slate-500/30", pin: "bg-slate-400 text-black" },
  Medium: { badge: "bg-amber-500/20 text-amber-400 border border-amber-500/30", pin: "bg-amber-500 text-black" },
  High: { badge: "bg-rose-500/20 text-rose-400 border border-rose-500/30", pin: "bg-rose-500 text-white" },
  Blocker: { badge: "bg-rose-600/30 text-rose-300 border border-rose-500/50", pin: "bg-rose-600 text-white" },
}

// Small helper for consistent text-button styling across the header/toolbar
function ToolbarButton({
  active,
  onClick,
  title,
  children,
  variant = "default",
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
  variant?: "default" | "primary"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
        active
          ? variant === "primary"
            ? "bg-indigo-600 text-white shadow-sm font-semibold"
            : "bg-indigo-50 border border-indigo-200 text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-500/40 dark:text-indigo-300 font-semibold"
          : "text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-[#e2e4ea] hover:bg-slate-200/80 dark:hover:bg-[#202430] border border-transparent"
      }`}
    >
      {children}
    </button>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function WorkflowSimulator({
  project,
  initialWorkflowId,
  isOwner = false,
  canEdit = false,
  userRole = "owner",
  onSelectWorkflow,
  onUpdateField,
  onOpenPresentation,
  theme = "dark",
  onToggleTheme,
}: WorkflowSimulatorProps) {
  const workflows = project.workflows || []

  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(() => {
    if (initialWorkflowId && workflows.some((w) => w.id === initialWorkflowId)) {
      return initialWorkflowId
    }
    return workflows[0]?.id || ""
  })

  useEffect(() => {
    if (initialWorkflowId && workflows.some((w) => w.id === initialWorkflowId)) {
      setActiveWorkflowId(initialWorkflowId)
    }
  }, [initialWorkflowId, workflows])

  const currentWorkflow = useMemo(() => {
    return workflows.find((w) => w.id === activeWorkflowId) || workflows[0]
  }, [workflows, activeWorkflowId])

  const handleSelectWorkflow = useCallback(
    (id: string) => {
      setActiveWorkflowId(id)
      onSelectWorkflow?.(id)
    },
    [onSelectWorkflow]
  )

  const currentWorkflowIndex = useMemo(() => {
    return Math.max(0, workflows.findIndex((w) => w.id === activeWorkflowId))
  }, [workflows, activeWorkflowId])

  const handlePrevWorkflow = useCallback(() => {
    if (currentWorkflowIndex > 0) {
      const prevWf = workflows[currentWorkflowIndex - 1]
      handleSelectWorkflow(prevWf.id)
    }
  }, [currentWorkflowIndex, workflows, handleSelectWorkflow])

  const handleNextWorkflow = useCallback(() => {
    if (currentWorkflowIndex < workflows.length - 1) {
      const nextWf = workflows[currentWorkflowIndex + 1]
      handleSelectWorkflow(nextWf.id)
    }
  }, [currentWorkflowIndex, workflows, handleSelectWorkflow])

  // Screen Info (Notes & Reason) Modal state
  const [showInfoModal, setShowInfoModal] = useState<boolean>(false)
  const [notesDraft, setNotesDraft] = useState<string>("")
  const [reasonDraft, setReasonDraft] = useState<string>("")
  const [isSavedRecently, setIsSavedRecently] = useState<boolean>(false)

  useEffect(() => {
    setNotesDraft(currentWorkflow?.ourNotes || "")
    setReasonDraft(currentWorkflow?.reason || "")
  }, [currentWorkflow?.id, currentWorkflow?.ourNotes, currentWorkflow?.reason])

  // Split layout state
  const [splitRatio, setSplitRatio] = useState<number>(50)
  const [isSwapped, setIsSwapped] = useState<boolean>(false)
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [compareMode, setCompareMode] = useState<"side-by-side" | "overlay" | "difference">("side-by-side")
  const [overlayOpacity, setOverlayOpacity] = useState<number>(50)

  // Viewport / device state
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>("m-iphone-16-pro")
  const [viewportWidth, setViewportWidth] = useState<number>(393)
  const [viewportHeight, setViewportHeight] = useState<number>(852)
  const [isCustomPreset, setIsCustomPreset] = useState<boolean>(false)
  const [showDeviceFrame, setShowDeviceFrame] = useState<boolean>(true)
  const [frameFinish, setFrameFinish] = useState<FrameFinish>("titanium")
  const [showDeviceStatusBar, setShowDeviceStatusBar] = useState<boolean>(true)

  // Live browser navigation
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const defaultUrl = useMemo(() => {
    return "http://localhost:8082"
  }, [])

  const [urlInput, setUrlInput] = useState<string>(defaultUrl)
  const [currentUrl, setCurrentUrl] = useState<string>(defaultUrl)

  // Map local dev URLs to same-origin proxies to completely eliminate cross-origin restrictions
  const resolvedIframeSrc = useMemo(() => {
    if (!currentUrl) return "/expo-app"
    if (currentUrl.includes(":8082") || currentUrl.includes("expo-app")) {
      const path = currentUrl.replace(/^https?:\/\/[^/]+(:8082)?/, "").replace(/^\/expo-app/, "")
      return `/expo-app${path || ""}`
    }
    if (currentUrl.includes(":8081")) {
      const path = currentUrl.replace(/^https?:\/\/[^/]+(:8081)?/, "")
      return `/proxy/8081${path || ""}`
    }
    return currentUrl
  }, [currentUrl])

  const [isLiveIframe, setIsLiveIframe] = useState<boolean>(() => !currentWorkflow?.designB)
  const [simulatorMode, setSimulatorMode] = useState<"canvas" | "iframe">("iframe")
  const canvasScreencastRef = useRef<CanvasScreencastRef>(null)
  const [currentSession, setCurrentSession] = useState<any>(null)
  const [isSessionLoaded, setIsSessionLoaded] = useState<boolean>(false)

  useEffect(() => {
    let isMounted = true
    const supabase = createClient()
    const initSession = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (isMounted) {
          setCurrentSession(data?.session ?? null)
        }
      } catch (err) {
        console.error("[WorkflowSimulator] Error fetching Supabase session:", err)
      } finally {
        if (isMounted) {
          setIsSessionLoaded(true)
        }
      }
    }
    initSession()
    return () => {
      isMounted = false
    }
  }, [])

  const [navHistory, setNavHistory] = useState<string[]>([defaultUrl])
  const [navIndex, setNavIndex] = useState<number>(0)

  // Default to showing saved App Screenshot when designB is already saved
  useEffect(() => {
    if (currentWorkflow?.designB) {
      setIsLiveIframe(false)
    }
  }, [currentWorkflow?.id, currentWorkflow?.designB])

  // Toast queue
  const [toastQueue, setToastQueue] = useState<{ id: number; message: string }[]>([])
  const toastIdRef = useRef(0)
  const triggerToast = useCallback((msg: string) => {
    const id = ++toastIdRef.current
    setToastQueue((q) => [...q, { id, message: msg }])
    setTimeout(() => setToastQueue((q) => q.filter((t) => t.id !== id)), 3200)
  }, [])

  const handleSaveInfo = useCallback(() => {
    if (!currentWorkflow || !onUpdateField) return
    onUpdateField(currentWorkflow.id, "ourNotes", notesDraft)
    onUpdateField(currentWorkflow.id, "reason", reasonDraft)
    setIsSavedRecently(true)
    triggerToast("Notes & reason updated")
    setTimeout(() => setIsSavedRecently(false), 2000)
  }, [currentWorkflow, onUpdateField, notesDraft, reasonDraft, triggerToast])

  // Browser navigation actions
  const navigateTo = useCallback(
    (rawUrl: string) => {
      let target = rawUrl.trim()
      if (!target) return
      if (/^\d+$/.test(target)) {
        target = `http://localhost:${target}`
      } else if (/^:\d+/.test(target)) {
        target = `http://localhost${target}`
      } else if (!/^https?:\/\//i.test(target)) {
        target = `http://${target}`
      }

      // Guard against self-embedding infinite loops (port 3000 is this app)
      if (typeof window !== "undefined" && (target.includes("localhost:3000") || target.includes("127.0.0.1:3000"))) {
        triggerToast("⚠️ Port 3000 is this review tool! Use your target app's port (e.g. :8081).")
        return
      }

      // Friendly note for third-party websites that block iframes
      const isExternal = /^https?:\/\//i.test(target) && !target.includes("localhost") && !target.includes("127.0.0.1")
      if (isExternal) {
        triggerToast("Note: Many external sites block iframe embedding. Use ↗ to open directly.")
      }

      setUrlInput(target)
      setIsLiveIframe(true)

      if (target === currentUrl) {
        // Safe in-place reload via src without touching cross-origin contentWindow
        if (iframeRef.current) {
          iframeRef.current.src = "about:blank"
          setTimeout(() => {
            if (iframeRef.current) iframeRef.current.src = target
          }, 40)
        }
      } else {
        setCurrentUrl(target)
        setNavHistory((prev) => [...prev.slice(0, navIndex + 1), target])
        setNavIndex((prev) => prev + 1)
      }
    },
    [currentUrl, navIndex]
  )

  const handleGoBack = useCallback(() => {
    if (navIndex > 0) {
      const prevUrl = navHistory[navIndex - 1]
      setNavIndex(navIndex - 1)
      setUrlInput(prevUrl)
      setCurrentUrl(prevUrl)
      triggerToast("Back")
    }
  }, [navIndex, navHistory, triggerToast])

  const handleGoForward = useCallback(() => {
    if (navIndex < navHistory.length - 1) {
      const nextUrl = navHistory[navIndex + 1]
      setNavIndex(navIndex + 1)
      setUrlInput(nextUrl)
      setCurrentUrl(nextUrl)
      triggerToast("Forward")
    }
  }, [navIndex, navHistory, triggerToast])

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      const src = currentUrl
      iframeRef.current.src = "about:blank"
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = src
      }, 40)
      triggerToast("Reloaded")
    }
  }, [currentUrl, triggerToast])

  const [showGrid, setShowGrid] = useState<boolean>(true)
  const [showOptions, setShowOptions] = useState<boolean>(false)

  // Screenshots
  const [capturedScreenshots, setCapturedScreenshots] = useState<CapturedScreenshot[]>([])
  const [pendingScreenshot, setPendingScreenshot] = useState<File | null>(null)
  const [pendingScreenshotUrl, setPendingScreenshotUrl] = useState<string | null>(null)
  const [isSavingScreenshot, setIsSavingScreenshot] = useState<boolean>(false)
  // Live frame capture: stores the already-uploaded public URL from the server API
  const [pendingCaptureUrl, setPendingCaptureUrl] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState<boolean>(false)

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null)
  const [isAddingAnnotation, setIsAddingAnnotation] = useState<boolean>(false)
  const [newAnnotationCoords, setNewAnnotationCoords] = useState<{ x: number; y: number } | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState<{
    title: string
    expected: string
    actual: string
    severity: Annotation["severity"]
  }>({ title: "", expected: "", actual: "", severity: "Medium" })

  // Debug mode state
  const [isDebugMode, setIsDebugMode] = useState<boolean>(false)
  const [debugInfo, setDebugInfo] = useState<{
    lastCapture?: string
    lastSave?: string
    errors: string[]
  }>({ errors: [] })

  const openIssueCount = annotations.filter((a) => !a.resolved).length

  // Right rail is a single source of truth: "new" draft or "inspect" existing.
  // This replaces two independently-positioned floating cards that could overlap.
  const railMode: "none" | "new" | "inspect" = newAnnotationCoords
    ? "new"
    : activeAnnotationId
    ? "inspect"
    : "none"

  const currentPreset = useMemo(() => {
    return EXTENDED_DEVICE_PRESETS.find((p) => p.id === selectedPresetId) || null
  }, [selectedPresetId])

  const currentFrameType: DeviceFrameType = useMemo(() => {
    if (isCustomPreset || !showDeviceFrame) return "none"
    return currentPreset?.frameType || "iphone-dynamic-island"
  }, [isCustomPreset, showDeviceFrame, currentPreset])

  const handlePresetSelect = (preset: DevicePresetExtended) => {
    setSelectedPresetId(preset.id)
    setIsCustomPreset(false)
    setViewportWidth(preset.width)
    setViewportHeight(preset.height)
  }

  const handleCustomDimensionChange = (w: string | number, h: string | number) => {
    setIsCustomPreset(true)
    setSelectedPresetId(null)
    setViewportWidth(Math.max(320, Number(w) || 320))
    setViewportHeight(Math.max(480, Number(h) || 480))
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplit || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const relativeX = e.clientX - rect.left
      let ratio = (relativeX / rect.width) * 100
      if (isSwapped) ratio = 100 - ratio
      ratio = Math.min(Math.max(ratio, 20), 80)
      setSplitRatio(ratio)
    }
    const handleMouseUp = () => {
      if (isDraggingSplit) setIsDraggingSplit(false)
    }
    if (isDraggingSplit) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isDraggingSplit, isSwapped])

  // Auto-fit sizing
  const [workspaceSize, setWorkspaceSize] = useState<{ width: number; height: number }>({ width: 1200, height: 700 })
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit")
  const [manualZoom, setManualZoom] = useState<number>(100)

  useEffect(() => {
    if (!containerRef.current) return
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          setWorkspaceSize({ width: rect.width, height: rect.height })
        }
      }
    }
    updateDimensions()
    const ro = new ResizeObserver(updateDimensions)
    ro.observe(containerRef.current)
    window.addEventListener("resize", updateDimensions)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", updateDimensions)
    }
  }, [])

  const autoFitScale = useMemo(() => {
    if (!workspaceSize.width || !workspaceSize.height) return 0.58
    const availH = Math.max(120, workspaceSize.height - 60)
    const metrics = getDeviceFrameMetrics(currentFrameType, viewportWidth, viewportHeight, showDeviceFrame)
    const effectiveW = metrics.totalWidth
    const effectiveH = metrics.totalHeight

    if (compareMode === "side-by-side") {
      const panelAWidth = workspaceSize.width * (splitRatio / 100) - 24
      const panelBWidth = workspaceSize.width * ((100 - splitRatio) / 100) - 24
      const scaleA = Math.min(panelAWidth / viewportWidth, availH / viewportHeight)
      const scaleB = Math.min(panelBWidth / effectiveW, availH / effectiveH)
      return Math.max(0.15, Math.min(1.0, Number(Math.min(scaleA, scaleB).toFixed(2))))
    }
    const availW = workspaceSize.width - 32
    const scale = Math.min(availW / effectiveW, availH / effectiveH)
    return Math.max(0.15, Math.min(1.0, Number(scale.toFixed(2))))
  }, [workspaceSize, splitRatio, viewportWidth, viewportHeight, compareMode, currentFrameType, showDeviceFrame])

  const currentScale = useMemo(() => {
    if (zoomMode === "fit") return autoFitScale
    return Math.max(0.2, manualZoom / 100)
  }, [zoomMode, autoFitScale, manualZoom])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const secondScreenRef = useRef<HTMLDivElement>(null)

  const handleExactScreenshotSelect = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]

    if (!file) return

    if (!file.type.startsWith("image/")) {
      triggerToast("Please choose an image file.")
      event.target.value = ""
      return
    }

    if (pendingScreenshotUrl) {
      URL.revokeObjectURL(pendingScreenshotUrl)
    }

    const localPreviewUrl = URL.createObjectURL(file)

    setPendingScreenshot(file)
    setPendingScreenshotUrl(localPreviewUrl)

    event.target.value = ""
  }

  // Allow pasting screenshots from the OS clipboard (e.g. Snipping Tool)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            if (pendingScreenshotUrl) {
              URL.revokeObjectURL(pendingScreenshotUrl);
            }
            const localPreviewUrl = URL.createObjectURL(file);
            setPendingScreenshot(file);
            setPendingScreenshotUrl(localPreviewUrl);
            triggerToast("Screenshot pasted! Review and save it.");
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [pendingScreenshotUrl, triggerToast]);

  const saveExactScreenshot = async () => {
    console.log("[DEBUG] saveExactScreenshot started", {
      currentWorkflow: currentWorkflow?.id,
      pendingScreenshot: pendingScreenshot?.name,
      pendingScreenshotSize: pendingScreenshot?.size
    })

    // Validate before proceeding
    const validation = validateScreenshotSave(currentWorkflow, pendingScreenshotUrl, "designB")
    if (validation.issues.length > 0) {
      console.error("[DEBUG] Save validation failed:", validation.issues)
      triggerToast(`Cannot save: ${validation.issues.join(", ")}`)
      return
    }

    if (!currentWorkflow || !pendingScreenshot) {
      console.warn("[DEBUG] saveExactScreenshot early return", {
        hasCurrentWorkflow: !!currentWorkflow,
        hasPendingScreenshot: !!pendingScreenshot
      })
      return
    }

    setIsSavingScreenshot(true)

    try {
      const supabase = createClient()
      console.log("[DEBUG] Created Supabase client for exact screenshot upload")

      const extension = pendingScreenshot.name.split(".").pop()?.toLowerCase() || "png"
      const filePath = [
        "workflows",
        currentWorkflow.id,
        `exact-screenshot-${Date.now()}.${extension}`,
      ].join("/")

      console.log("[DEBUG] Uploading to Supabase storage", {
        filePath,
        fileType: pendingScreenshot.type,
        fileSize: pendingScreenshot.size
      })

      const { error: uploadError } = await supabase.storage
        .from("designs")
        .upload(filePath, pendingScreenshot, {
          contentType: pendingScreenshot.type,
          cacheControl: "3600",
          upsert: false,
        })

      if (uploadError) {
        console.error("[DEBUG] Supabase storage upload failed:", uploadError)
        throw uploadError
      }

      console.log("[DEBUG] Supabase storage upload successful")

      const { data } = supabase.storage
        .from("designs")
        .getPublicUrl(filePath)

      const fullPublicUrl = `${data.publicUrl}?v=${Date.now()}`
      console.log("[DEBUG] Generated public URL:", fullPublicUrl)

      console.log("[DEBUG] Calling onUpdateField with designB for exact screenshot", {
        workflowId: currentWorkflow.id,
        field: "designB",
        value: fullPublicUrl
      })

      // Add retry logic for critical operations  
      let retryCount = 0
      const maxRetries = 3
      let lastError: any = null

      while (retryCount < maxRetries) {
        try {
          await onUpdateField?.(
            currentWorkflow.id,
            "designB",
            fullPublicUrl
          )
          console.log("[DEBUG] onUpdateField completed successfully for exact screenshot on attempt", retryCount + 1)
          break // Success - exit retry loop
        } catch (error) {
          lastError = error
          retryCount++
          console.warn(`[DEBUG] onUpdateField attempt ${retryCount} failed:`, error)
          
          if (retryCount < maxRetries) {
            console.log(`[DEBUG] Retrying in ${retryCount * 1000}ms...`)
            await new Promise(resolve => setTimeout(resolve, retryCount * 1000))
          }
        }
      }

      // If all retries failed, throw the last error
      if (retryCount >= maxRetries && lastError) {
        console.error("[DEBUG] All retry attempts failed for exact screenshot")
        throw lastError
      }

      const newCapture: CapturedScreenshot = {
        id: `snap-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        dimensions: `${viewportWidth} × ${viewportHeight}`,
        url: fullPublicUrl,
        mode: compareMode,
      }
      
      console.log("[DEBUG] Adding exact screenshot to capture history", newCapture)
      setCapturedScreenshots((prev) => [newCapture, ...prev])

      setIsLiveIframe(false)
      triggerToast("Exact screenshot saved successfully.")

      if (pendingScreenshotUrl) {
        URL.revokeObjectURL(pendingScreenshotUrl)
      }

      setPendingScreenshot(null)
      setPendingScreenshotUrl(null)
      console.log("[DEBUG] saveExactScreenshot completed successfully")
    } catch (error) {
      console.error("[DEBUG] Exact screenshot save failed:", error)
      console.error("[DEBUG] Exact screenshot error details:", {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "Unknown",
        stack: error instanceof Error ? error.stack : undefined
      })
      triggerToast(`Screenshot upload failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      console.log("[DEBUG] saveExactScreenshot finished, setting isSavingScreenshot to false")
      setIsSavingScreenshot(false)
    }
  }

  // Debug validation helper
  const validateScreenshotSave = (workflow: Workflow | null, url: string | null, field: "designA" | "designB") => {
    const validation = {
      hasWorkflow: !!workflow,
      workflowId: workflow?.id || null,
      hasUrl: !!url,
      urlValid: url ? (url.startsWith("http") || url.startsWith("data:")) : false,
      hasOnUpdateField: !!onUpdateField,
      field,
      issues: [] as string[]
    }

    if (!validation.hasWorkflow) validation.issues.push("No current workflow selected")
    if (!validation.hasUrl) validation.issues.push(`No ${field} URL provided`)
    if (validation.hasUrl && !validation.urlValid) validation.issues.push(`Invalid ${field} URL format`)
    if (!validation.hasOnUpdateField) validation.issues.push("onUpdateField callback not provided")

    console.log(`[DEBUG] Screenshot save validation for ${field}:`, validation)
    return validation
  }

  const cancelExactScreenshot = () => {
    console.log("[DEBUG] cancelExactScreenshot called")
    
    if (pendingScreenshotUrl) {
      URL.revokeObjectURL(pendingScreenshotUrl)
      console.log("[DEBUG] Revoked pending screenshot URL")
    }

    setPendingScreenshot(null)
    setPendingScreenshotUrl(null)
    setPendingCaptureUrl(null)
    
    console.log("[DEBUG] Cleared all pending screenshot state")
    triggerToast("Screenshot upload cancelled")
  }

  const handleCaptureLiveFrame = async () => {
    console.log("[DEBUG] handleCaptureLiveFrame started", {
      currentWorkflow: currentWorkflow?.id,
      isCapturing,
      currentUrl,
      viewportWidth,
      viewportHeight
    })

    if (!currentWorkflow || isCapturing) {
      console.warn("[DEBUG] handleCaptureLiveFrame early return", {
        hasCurrentWorkflow: !!currentWorkflow,
        isCapturing
      })
      return
    }

    setIsCapturing(true)
    triggerToast("Capturing live frame…")

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      // 0. If in Canvas mode, capture directly from the Canvas element (Instant 0ms, zero CORS!)
      if (simulatorMode === "canvas" && canvasScreencastRef.current) {
        const dataUrl = canvasScreencastRef.current.getScreenshot()
        if (dataUrl && dataUrl.length > 1000) {
          console.log("[DEBUG] Instant Canvas screenshot captured!")
          
          try {
            const resBlob = await fetch(dataUrl)
            const blob = await resBlob.blob()
            const fileName = `${currentWorkflow.id}-designB-${Date.now()}.png`
            const filePath = `workflows/${currentWorkflow.id}/${fileName}`

            const { error: uploadError } = await supabase.storage
              .from("designs")
              .upload(filePath, blob, {
                upsert: true,
                contentType: "image/png",
              })

            if (!uploadError) {
              const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
              const finalUrl = `${pubData.publicUrl}?v=${Date.now()}`
              console.log("[DEBUG] Canvas screenshot uploaded:", finalUrl)
              setPendingCaptureUrl(finalUrl)
            } else {
              setPendingCaptureUrl(dataUrl)
            }
          } catch (uploadErr) {
            console.warn("[DEBUG] Upload error, using preview dataUrl:", uploadErr)
            setPendingCaptureUrl(dataUrl)
          }

          triggerToast("Screenshot captured instantly from Canvas! Review and save.")
          return
        }
      }

      // 1. Try Direct Same-Origin Client Capture (Instant, 0-1s, preserves live authenticated screen)
      if (iframeRef.current) {
        try {
          const iframeDoc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document
          if (iframeDoc && iframeDoc.body) {
            console.log("[DEBUG] Same-origin access to iframe body successful! Starting html2canvas capture...")
            const html2canvas = (await import("html2canvas")).default
            const canvas = await html2canvas(iframeDoc.body, {
              useCORS: true,
              allowTaint: true,
              width: viewportWidth,
              height: viewportHeight,
              scale: window.devicePixelRatio || 2,
              logging: false,
            })
            const dataUrl = canvas.toDataURL("image/png")
            if (dataUrl && dataUrl.length > 1000) {
              console.log("[DEBUG] In-screen browser capture succeeded via html2canvas!")
              
              // Upload to Supabase
              const resBlob = await fetch(dataUrl)
              const blob = await resBlob.blob()
              const fileName = `${currentWorkflow.id}-designB-${Date.now()}.png`
              const filePath = `workflows/${currentWorkflow.id}/${fileName}`

              const { error: uploadError } = await supabase.storage
                .from("designs")
                .upload(filePath, blob, {
                  upsert: true,
                  contentType: "image/png",
                })

              if (!uploadError) {
                const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
                const finalUrl = `${pubData.publicUrl}?v=${Date.now()}`
                console.log("[DEBUG] Client captured screenshot uploaded:", finalUrl)
                setPendingCaptureUrl(finalUrl)
                triggerToast("Screenshot captured from live frame! Review and save.")
                return
              } else {
                console.warn("[DEBUG] Upload error from client capture, using preview dataUrl:", uploadError)
                setPendingCaptureUrl(dataUrl)
                triggerToast("Screenshot captured! Review and save.")
                return
              }
            }
          }
        } catch (clientErr: any) {
          console.warn("[DEBUG] Client-side capture fallback triggered:", clientErr?.message)
        }
      }

      // 2. Fallback to server-side headless capture if client-side couldn't run
      console.log("[DEBUG] Running server-side capture fallback...")
      const SCREENSHOT_TOKEN = 'screenshot_bypass_dev_token_12345'
      const captureUrl = currentUrl.includes('?') 
        ? `${currentUrl}&screenshot_token=${SCREENSHOT_TOKEN}`
        : `${currentUrl}?screenshot_token=${SCREENSHOT_TOKEN}`

      console.log("[DEBUG] Making capture API request", {
        originalUrl: currentUrl,
        captureUrl: captureUrl,
        width: viewportWidth,
        height: viewportHeight,
        workflowId: currentWorkflow.id,
      })

      const res = await fetch("/api/capture-screenshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token && {
            Authorization: `Bearer ${session.access_token}`,
          }),
        },
        body: JSON.stringify({
          url: captureUrl,
          width: viewportWidth,
          height: viewportHeight,
          workflowId: currentWorkflow.id,
          accessToken: session?.access_token,
          refreshToken: session?.refresh_token,
          session: session,
          rawStorageKey: Object.keys(window.localStorage).find(k => k.includes('auth-token') || k.includes('supabase')),
        }),
      })

      console.log("[DEBUG] Capture API response", {
        status: res.status,
        statusText: res.statusText,
        ok: res.ok
      })

      const data = await res.json()
      console.log("[DEBUG] Capture API data", data)

      if (!res.ok || !data.publicUrl) {
        const errorMsg = data.error || "Capture failed"
        console.error("[DEBUG] Capture API failed", { data, error: errorMsg })
        throw new Error(errorMsg)
      }

      // Show the captured image in the confirmation modal before saving
      const captureUrlWithCache = `${data.publicUrl}?v=${Date.now()}`
      console.log("[DEBUG] Setting pending capture URL", captureUrlWithCache)
      setPendingCaptureUrl(captureUrlWithCache)
      
      triggerToast("Screenshot captured! Review and save it.")
    } catch (err: any) {
      console.error("[DEBUG] Live frame capture failed:", err)
      console.error("[DEBUG] Error details:", {
        message: err?.message,
        name: err?.name,
        stack: err?.stack
      })
      
      const errorMsg = `Capture failed: ${err?.message || "Unknown error"}`
      setDebugInfo(prev => ({
        ...prev,
        errors: [errorMsg, ...prev.errors.slice(0, 4)]
      }))
      
      triggerToast(errorMsg)
    } finally {
      console.log("[DEBUG] handleCaptureLiveFrame finished, setting isCapturing to false")
      setIsCapturing(false)
    }
  }

  // Save the server-captured screenshot to designB
  const saveCapturedScreenshot = async () => {
    console.log("[DEBUG] saveCapturedScreenshot started", {
      currentWorkflow: currentWorkflow?.id,
      pendingCaptureUrl,
      onUpdateFieldExists: !!onUpdateField
    })

    // Validate before proceeding
    const validation = validateScreenshotSave(currentWorkflow, pendingCaptureUrl, "designB")
    if (validation.issues.length > 0) {
      console.error("[DEBUG] Save validation failed:", validation.issues)
      triggerToast(`Cannot save: ${validation.issues.join(", ")}`)
      return
    }

    if (!currentWorkflow || !pendingCaptureUrl) {
      console.warn("[DEBUG] saveCapturedScreenshot early return", {
        hasCurrentWorkflow: !!currentWorkflow,
        hasPendingCaptureUrl: !!pendingCaptureUrl
      })
      return
    }

    setIsSavingScreenshot(true)

    try {
      console.log("[DEBUG] Calling onUpdateField with designB", {
        workflowId: currentWorkflow.id,
        field: "designB",
        value: pendingCaptureUrl
      })

      // Add retry logic for critical operations
      let retryCount = 0
      const maxRetries = 3
      let lastError: any = null

      while (retryCount < maxRetries) {
        try {
          await onUpdateField?.(
            currentWorkflow.id,
            "designB",
            pendingCaptureUrl
          )
          console.log("[DEBUG] onUpdateField completed successfully on attempt", retryCount + 1)
          break // Success - exit retry loop
        } catch (error) {
          lastError = error
          retryCount++
          console.warn(`[DEBUG] onUpdateField attempt ${retryCount} failed:`, error)
          
          if (retryCount < maxRetries) {
            console.log(`[DEBUG] Retrying in ${retryCount * 1000}ms...`)
            await new Promise(resolve => setTimeout(resolve, retryCount * 1000))
          }
        }
      }

      // If all retries failed, throw the last error
      if (retryCount >= maxRetries && lastError) {
        console.error("[DEBUG] All retry attempts failed")
        throw lastError
      }

      const newCapture: CapturedScreenshot = {
        id: `snap-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        dimensions: `${viewportWidth} × ${viewportHeight}`,
        url: pendingCaptureUrl,
        mode: compareMode,
      }
      
      console.log("[DEBUG] Adding new capture to history", newCapture)
      setCapturedScreenshots((prev) => [newCapture, ...prev])

      setIsLiveIframe(false)
      triggerToast("Live frame screenshot saved successfully.")

      setPendingCaptureUrl(null)
      console.log("[DEBUG] saveCapturedScreenshot completed successfully")
      setDebugInfo(prev => ({
        ...prev,
        lastSave: new Date().toISOString()
      }))
    } catch (error) {
      console.error("[DEBUG] Save captured screenshot failed:", error)
      console.error("[DEBUG] Save error details:", {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : "Unknown",
        stack: error instanceof Error ? error.stack : undefined
      })
      
      const errorMsg = `Screenshot save failed: ${error instanceof Error ? error.message : "Unknown error"}`
      setDebugInfo(prev => ({
        ...prev,
        errors: [errorMsg, ...prev.errors.slice(0, 4)]
      }))
      
      triggerToast(errorMsg)
    } finally {
      console.log("[DEBUG] saveCapturedScreenshot finished, setting isSavingScreenshot to false")
      setIsSavingScreenshot(false)
    }
  }

  const handleBrowserCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingAnnotation) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100)
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100)
    setActiveAnnotationId(null)
    setNewAnnotationCoords({ x, y })
    setAnnotationDraft({ title: "", expected: "", actual: "", severity: "Medium" })
  }

  const handleSaveAnnotation = () => {
    if (!annotationDraft.title.trim() || !newAnnotationCoords) return
    const newId = annotations.length > 0 ? Math.max(...annotations.map((a) => a.id)) + 1 : 1
    const createdItem: Annotation = {
      id: newId,
      x: newAnnotationCoords.x,
      y: newAnnotationCoords.y,
      title: annotationDraft.title,
      expected: annotationDraft.expected || "Matches Figma token specification exactly.",
      actual: annotationDraft.actual || "Differs from design spec.",
      severity: annotationDraft.severity,
      resolved: false,
      author: userRole === "freelancer" ? "Developer" : isOwner ? "Project Owner" : "QA Reviewer",
      createdAt: "Just now",
    }
    setAnnotations((prev) => [...prev, createdItem])
    setActiveAnnotationId(newId)
    setNewAnnotationCoords(null)
    setIsAddingAnnotation(false)
    triggerToast(`Marker #${String(newId).padStart(2, "0")} created`)
  }

  // Global Escape key closes any open rail/modal — keyboard parity for mouse users
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNewAnnotationCoords(null)
        setActiveAnnotationId(null)
        setIsAddingAnnotation(false)
        setShowInfoModal(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 dark:bg-[#0b0c10] text-slate-800 dark:text-[#e2e4ea] select-none font-sans overflow-hidden transition-colors duration-150">
      {/* ================= TOP HEADER: identity + primary mode switch only ================= */}
      <header className="h-14 border-b border-slate-200 dark:border-[#1e222d] bg-white dark:bg-[#111319] px-4 flex items-center justify-between gap-3 z-20 shrink-0 transition-colors">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="text-slate-500 dark:text-[#8e95a5] font-medium shrink-0">Design</span>
          <select
            value={activeWorkflowId}
            onChange={(e) => handleSelectWorkflow(e.target.value)}
            className="bg-slate-50 dark:bg-[#181a22] border border-slate-300 dark:border-[#272b38] rounded-md px-2.5 py-1.5 text-xs text-slate-800 dark:text-[#d1d5db] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 font-medium cursor-pointer max-w-[220px] truncate shadow-xs transition-colors"
          >
            {workflows.map((wf, idx) => (
              <option key={wf.id} value={wf.id}>
                Screen {idx + 1}: {wf.title} {wf.clientTaskDone ? "✓" : ""}
              </option>
            ))}
          </select>

          {/* Info Button */}
          <button
            type="button"
            onClick={() => setShowInfoModal(true)}
            title="Screen Info: Notes & Reason"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-slate-50 hover:bg-slate-100 dark:bg-[#181a22] dark:hover:bg-[#202430] border border-slate-300 dark:border-[#272b38] hover:border-indigo-500/50 text-slate-700 dark:text-[#d1d5db] hover:text-slate-900 dark:hover:text-white font-medium transition-colors cursor-pointer shrink-0 shadow-xs"
          >
            <span>Info</span>
            {(currentWorkflow?.ourNotes || currentWorkflow?.reason) && (
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400" title="Notes or Reason available" />
            )}
          </button>

          {/* Prev / Next Screen navigation arrows */}
          <div className="flex items-center gap-0.5 shrink-0 bg-slate-50 dark:bg-[#181a22] border border-slate-300 dark:border-[#272b38] rounded-md p-0.5 shadow-xs transition-colors">
            <button
              type="button"
              onClick={handlePrevWorkflow}
              disabled={currentWorkflowIndex <= 0}
              title="Previous screen (←)"
              aria-label="Previous screen"
              className="p-1 rounded text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-[#e2e4ea] hover:bg-slate-200/80 dark:hover:bg-[#202430] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleNextWorkflow}
              disabled={currentWorkflowIndex >= workflows.length - 1}
              title="Next screen (→)"
              aria-label="Next screen"
              className="p-1 rounded text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-[#e2e4ea] hover:bg-slate-200/80 dark:hover:bg-[#202430] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center: primary comparison mode */}
        <div className="flex items-center bg-slate-100 dark:bg-[#181a22] p-1 rounded-lg border border-slate-300 dark:border-[#272b38] gap-1 shrink-0 transition-colors" role="tablist" aria-label="Comparison mode">
          <ToolbarButton active={compareMode === "side-by-side"} onClick={() => setCompareMode("side-by-side")} title="Compare designs side by side" variant="primary">
            Side by Side
          </ToolbarButton>
          <ToolbarButton
            active={compareMode === "overlay"}
            onClick={() => {
              setCompareMode("overlay")
              setShowOptions(true)
            }}
            title="Overlay design on top of the live app"
            variant="primary"
          >
            Overlay
          </ToolbarButton>
          <ToolbarButton
            active={compareMode === "difference"}
            onClick={() => {
              setCompareMode("difference")
              setShowOptions(true)
            }}
            title="Highlight pixel differences"
            variant="primary"
          >
            Difference
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Enable Frame toggle with checkbox */}
          <label
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer select-none focus-within:ring-2 focus-within:ring-indigo-400 ${
              showDeviceFrame
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-600/20 dark:border-indigo-500/60 dark:text-indigo-300 ring-1 ring-indigo-500/20"
                : "bg-slate-50 hover:bg-slate-100 dark:bg-[#181a22] dark:hover:bg-[#202430] border-slate-300 dark:border-[#272b38] text-slate-700 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-[#e2e4ea] shadow-xs"
            }`}
            title="Enable or disable phone device frame"
          >
            <input
              type="checkbox"
              checked={showDeviceFrame}
              onChange={(e) => setShowDeviceFrame(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-indigo-600 cursor-pointer border-slate-300 dark:border-[#272b38] bg-white dark:bg-[#0d0e14]"
              aria-label="Toggle enable frame"
            />
            <span>Enable Frame: {showDeviceFrame ? "Yes" : "No"}</span>
          </label>

          {/* Options toggle with checkbox */}
          <label
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer select-none focus-within:ring-2 focus-within:ring-indigo-400 ${
              showOptions
                ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-600/20 dark:border-indigo-500/60 dark:text-indigo-300 ring-1 ring-indigo-500/20"
                : "bg-slate-50 hover:bg-slate-100 dark:bg-[#181a22] dark:hover:bg-[#202430] border-slate-300 dark:border-[#272b38] text-slate-700 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-[#e2e4ea] shadow-xs"
            }`}
            title="Toggle options panel"
          >
            <input
              type="checkbox"
              checked={showOptions}
              onChange={(e) => setShowOptions(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-indigo-600 cursor-pointer border-slate-300 dark:border-[#272b38] bg-white dark:bg-[#0d0e14]"
              aria-label="Toggle options visibility"
            />
            <span className="hidden sm:inline">Options</span>
          </label>

          {/* Capture live frame button */}
          <button
            type="button"
            onClick={handleCaptureLiveFrame}
            disabled={isCapturing || isSavingScreenshot}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Capture a screenshot of the live frame via headless browser"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{isCapturing ? "Capturing…" : "Capture Live Frame"}</span>
          </button>

          {/* Debug Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsDebugMode(!isDebugMode)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition shadow-xs cursor-pointer ${
              isDebugMode 
                ? "bg-orange-600 hover:bg-orange-500 text-white" 
                : "bg-slate-600 hover:bg-slate-500 text-white"
            }`}
            title="Toggle debug mode for detailed logging"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Debug</span>
          </button>

          {/* Upload exact screenshot button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSavingScreenshot}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-1.5 transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Upload exact screenshot image"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Screenshot</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={handleExactScreenshotSelect}
          />
        </div>
      </header>

      {/* ================= OPTIONS PANEL: all secondary controls live here now ================= */}
      {showOptions && (
        <div className="border-b border-slate-200 dark:border-[#1e222d] bg-slate-50 dark:bg-[#14161f] px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs z-20 shrink-0 transition-colors animate-in slide-in-from-top-2 duration-150">
          {/* Device preset */}
          <div className="flex items-center gap-2">
            <span className="text-slate-600 dark:text-[#8e95a5] text-[11px] font-medium">
              Device
            </span>
            <select
              value={isCustomPreset ? "custom" : selectedPresetId || ""}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setIsCustomPreset(true)
                  setSelectedPresetId(null)
                } else {
                  const p = EXTENDED_DEVICE_PRESETS.find((x) => x.id === e.target.value)
                  if (p) handlePresetSelect(p)
                }
              }}
              className="bg-white dark:bg-[#1b1e29] border border-slate-300 dark:border-[#272b38] rounded-md px-2.5 py-1 text-xs text-slate-800 dark:text-[#d1d5db] font-medium cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 max-w-[260px] shadow-xs transition-colors"
            >
              {(
                [
                  "Latest Flagships",
                  "Notch Era",
                  "Old & Classic Phones",
                  "Tablets",
                  "Laptops",
                  "Desktops",
                ] as const
              ).map((group) => (
                <optgroup key={group} label={group}>
                  {EXTENDED_DEVICE_PRESETS.filter((p) => p.group === group).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} ({preset.width} × {preset.height})
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="custom">Custom Dimensions…</option>
            </select>
            {isCustomPreset && (
              <div className="flex items-center gap-1.5 bg-white dark:bg-[#1b1e29] border border-slate-300 dark:border-[#272b38] rounded-md px-2 py-1 shadow-xs transition-colors">
                <label className="text-slate-500 dark:text-[#6b7280] text-[11px]" htmlFor="viewport-w">W</label>
                <input
                  id="viewport-w"
                  type="number"
                  value={viewportWidth}
                  onChange={(e) => handleCustomDimensionChange(e.target.value, viewportHeight)}
                  className="w-14 bg-transparent border-b border-slate-300 dark:border-[#3b4254] text-center font-mono text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
                <span className="text-slate-500 dark:text-[#6b7280] text-[11px]">×</span>
                <label className="text-slate-500 dark:text-[#6b7280] text-[11px]" htmlFor="viewport-h">H</label>
                <input
                  id="viewport-h"
                  type="number"
                  value={viewportHeight}
                  onChange={(e) => handleCustomDimensionChange(viewportWidth, e.target.value)}
                  className="w-14 bg-transparent border-b border-slate-300 dark:border-[#3b4254] text-center font-mono text-[11px] text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          {/* Device Frame & Finish Controls */}
          {showDeviceFrame && currentFrameType !== "none" && (
            <div className="flex items-center gap-1.5 bg-white dark:bg-[#1b1e29] border border-slate-300 dark:border-[#272b38] rounded-md px-2 py-1 shadow-xs transition-colors">
              <span className="text-slate-600 dark:text-[#8e95a5] text-[11px] font-medium">Finish:</span>
              <select
                value={frameFinish}
                onChange={(e) => setFrameFinish(e.target.value as FrameFinish)}
                className="bg-transparent text-xs text-slate-800 dark:text-[#d1d5db] font-medium cursor-pointer focus:outline-none"
                aria-label="Device frame finish"
              >
                <option value="titanium" className="bg-white dark:bg-[#181a20] text-slate-900 dark:text-white">Titanium</option>
                <option value="silver" className="bg-white dark:bg-[#181a20] text-slate-900 dark:text-white">Silver</option>
                <option value="gold" className="bg-white dark:bg-[#181a20] text-slate-900 dark:text-white">Gold</option>
                <option value="midnight" className="bg-white dark:bg-[#181a20] text-slate-900 dark:text-white">Midnight</option>
              </select>
            </div>
          )}

          {/* Zoom */}
          <div className="flex items-center bg-white dark:bg-[#181a22] border border-slate-300 dark:border-[#272b38] rounded-lg p-0.5 shadow-xs transition-colors">
            <button
              type="button"
              onClick={() => {
                setZoomMode("fit")
                triggerToast("Auto-fitted both screens to view")
              }}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                zoomMode === "fit" ? "bg-indigo-600 text-white shadow-xs" : "text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Fit
            </button>
            <div className="h-3 w-[1px] bg-slate-300 dark:bg-[#272b38] mx-0.5" />
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual")
                setManualZoom(Math.max(25, Math.round(currentScale * 100) - 10))
              }}
              className="p-1 text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#202430] transition cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] px-1 text-slate-700 dark:text-[#c5c9d5] min-w-[38px] text-center font-medium">
              {Math.round(currentScale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual")
                setManualZoom(Math.min(200, Math.round(currentScale * 100) + 10))
              }}
              className="p-1 text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#202430] transition cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Split ratio — moved here from header, only relevant in side-by-side */}
          {compareMode === "side-by-side" && (
            <div className="flex items-center gap-1 bg-white dark:bg-[#181a22] p-0.5 rounded border border-slate-300 dark:border-[#272b38] text-[11px] shadow-xs transition-colors">
              {[40, 50, 60].map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setSplitRatio(ratio)}
                  className={`px-2 py-1 rounded transition cursor-pointer ${
                    splitRatio === ratio ? "bg-slate-200 dark:bg-[#2b3040] text-slate-900 dark:text-white font-semibold" : "text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  {ratio}/{100 - ratio}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setIsSwapped(!isSwapped)}
                className={`px-2 py-1 rounded transition flex items-center gap-1 border-l border-slate-300 dark:border-[#272b38] cursor-pointer ${
                  isSwapped ? "text-indigo-600 dark:text-indigo-400 font-semibold" : "text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white"
                }`}
                title="Swap left and right panels"
              >
                <SplitSquareVertical className="w-3 h-3" />
                Swap
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowGrid(!showGrid)}
            aria-pressed={showGrid}
            className={`px-2.5 py-1 rounded border flex items-center gap-1.5 transition text-[11px] font-medium cursor-pointer ${
              showGrid ? "bg-indigo-50 dark:bg-indigo-500/15 border-indigo-300 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300" : "bg-white dark:bg-[#1b1e29] border-slate-300 dark:border-[#272b38] text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white shadow-xs"
            }`}
          >
            Redlines
          </button>

          {compareMode !== "side-by-side" && (
            <div className="flex items-center gap-2 bg-white dark:bg-[#1b1e29] border border-slate-300 dark:border-[#272b38] rounded-md px-2.5 py-1 shadow-xs transition-colors">
              <label htmlFor="blend-slider" className="text-[11px] text-slate-600 dark:text-[#8e95a5]">
                {compareMode === "overlay" ? "Blend" : "Diff"}
              </label>
              <input
                id="blend-slider"
                type="range"
                min="0"
                max="100"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-20 h-1.5 bg-slate-200 dark:bg-[#2a2f3f] rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <span className="font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 min-w-[32px] text-right">{overlayOpacity}%</span>
            </div>
          )}
        </div>
      )}

      {/* ================= MAIN WORKSPACE ================= */}
      <div className="flex-1 flex overflow-hidden">
        <main ref={containerRef} className="flex-1 flex relative overflow-hidden bg-slate-200/80 dark:bg-[#090a0e] transition-colors">
          {compareMode === "side-by-side" && (
            <div className={`flex w-full h-full ${isSwapped ? "flex-row-reverse" : "flex-row"}`}>
              {/* PANEL A: FIGMA SPEC */}
              <section
                style={{ width: `${splitRatio}%` }}
                className="h-full relative flex flex-col border-r border-slate-300 dark:border-[#1e222d] bg-slate-100/70 dark:bg-[#0c0d12] overflow-hidden transition-colors"
              >
                <div className="h-9 border-b border-slate-200 dark:border-[#1e222d] bg-white dark:bg-[#11131a] px-3 flex items-center justify-between text-[11px] text-slate-600 dark:text-[#7e8596] shrink-0 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#a259ff]" />
                    <span className="font-semibold text-slate-900 dark:text-[#c5c9d5]">Figma Spec:</span>
                    <span className="text-slate-600 dark:text-[#8e95a5] truncate max-w-[200px]">{currentWorkflow?.title || "Screen"}</span>
                  </div>
                  <div className="font-mono text-[10px] text-slate-500 dark:text-[#717888]">
                    {viewportWidth}×{viewportHeight}px
                  </div>
                </div>

                <div className={`flex-1 relative p-4 flex items-center justify-center bg-slate-200/50 dark:bg-[#0c0d12] bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#1e2230_1px,transparent_1px)] [background-size:18px_18px] select-none ${zoomMode === "fit" ? "overflow-hidden" : "overflow-auto"}`}>
                  <DeviceFrame
                    frameType="none"
                    finish={frameFinish}
                    width={viewportWidth}
                    height={viewportHeight}
                    scale={currentScale}
                    showFrame={false}
                    showStatusBar={false}
                  >
                    {showGrid && (
                      <div className="absolute inset-0 pointer-events-none z-20 border border-indigo-500/30">
                        <div className="absolute top-4 left-4 text-[9px] font-mono text-indigo-400/80 bg-indigo-950/70 px-1 rounded">padding: 32px</div>
                        <div className="absolute top-0 bottom-0 left-[32px] w-[1px] bg-indigo-500/20 border-r border-dashed border-indigo-500/40" />
                        <div className="absolute top-0 bottom-0 right-[32px] w-[1px] bg-indigo-500/20 border-r border-dashed border-indigo-500/40" />
                      </div>
                    )}
                    {currentWorkflow?.designA ? (
                      <div className="w-full h-full bg-white dark:bg-[#0f1117] flex items-center justify-center overflow-hidden relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={currentWorkflow.designA} alt="Figma spec design" className="w-full h-full object-contain select-none pointer-events-none" />
                      </div>
                    ) : (
                      <FigmaPrototypeMock viewportWidth={viewportWidth} viewportHeight={viewportHeight} title={currentWorkflow?.title || "Platform Health Overview"} />
                    )}
                  </DeviceFrame>
                </div>
              </section>

              <div
                onMouseDown={() => setIsDraggingSplit(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize split panels"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") setSplitRatio((r) => Math.max(20, r - 2))
                  if (e.key === "ArrowRight") setSplitRatio((r) => Math.min(80, r + 2))
                }}
                className="w-2.5 bg-slate-200 dark:bg-[#14161f] hover:bg-indigo-600 focus-visible:bg-indigo-600 transition-colors cursor-col-resize flex items-center justify-center relative z-20 shrink-0 border-x border-slate-300 dark:border-[#1e222e] focus:outline-none"
              >
                <div className="h-8 w-1 bg-slate-400 dark:bg-[#373d50] rounded-full" />
              </div>

              {/* PANEL B: LIVE INTERACTIVE BROWSER */}
              <section style={{ width: `${100 - splitRatio}%` }} className="h-full relative flex flex-col bg-slate-100/70 dark:bg-[#0c0d12] overflow-hidden transition-colors">
                {/* Sleek Browser Toolbar */}
                <div className="h-9 border-b border-slate-200 dark:border-[#1e222d] bg-white dark:bg-[#11131a] px-2.5 flex items-center gap-1.5 shrink-0 z-10 transition-colors">
                  {/* Navigation Buttons */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={handleGoBack}
                      disabled={navIndex === 0}
                      className={`p-1 rounded transition ${
                        navIndex === 0
                          ? "text-slate-300 dark:text-[#3e4452] cursor-not-allowed"
                          : "text-slate-600 dark:text-[#6b7280] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1f2330] cursor-pointer"
                      }`}
                      title="Back"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleGoForward}
                      disabled={navIndex >= navHistory.length - 1}
                      className={`p-1 rounded transition ${
                        navIndex >= navHistory.length - 1
                          ? "text-slate-300 dark:text-[#3e4452] cursor-not-allowed"
                          : "text-slate-600 dark:text-[#6b7280] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#1f2330] cursor-pointer"
                      }`}
                      title="Forward"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      className="p-1 text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#202430] transition cursor-pointer"
                      title="Reload Page"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Address Bar Container */}
                  <div className="flex-1 flex items-center bg-slate-50 dark:bg-[#090a0f] border border-slate-300 dark:border-[#222736] focus-within:border-indigo-500 rounded px-2 py-0.5 text-xs transition shadow-xs">
                    <Lock className="w-3 h-3 text-emerald-500 dark:text-emerald-400 mr-1.5 shrink-0" />
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          e.stopPropagation()
                          navigateTo(urlInput)
                        }
                      }}
                      placeholder="Type port (e.g. 8081) or URL..."
                      className="bg-transparent w-full text-slate-900 dark:text-[#e2e4ea] focus:outline-none font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigateTo(urlInput)
                      }}
                      className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-700/50 rounded transition cursor-pointer"
                    >
                      Go
                    </button>
                  </div>

                  {/* Port Quick Switch */}
                  <div className="hidden xl:flex items-center gap-1 font-mono text-[10px]">
                    {["8082", "8081", "5173", "8080", "3001"].map((port) => (
                      <button
                        key={port}
                        type="button"
                        onClick={() => navigateTo(port)}
                        className={`px-1.5 py-0.5 rounded border transition cursor-pointer ${
                          currentUrl.includes(`:${port}`)
                            ? "bg-indigo-100 dark:bg-indigo-600/30 border-indigo-300 dark:border-indigo-500/50 text-indigo-800 dark:text-indigo-300 font-bold"
                            : "bg-slate-100 dark:bg-[#181a22] border-slate-300 dark:border-[#272b38] text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        :{port}
                      </button>
                    ))}
                  </div>

                  {/* Open in new tab */}
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-slate-600 dark:text-[#6b7280] hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#1f2330] transition cursor-pointer"
                    title="Open live URL in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  {/* Mode Switcher: Iframe (Fast) vs Canvas (CDP) */}
                  {isLiveIframe && (
                    <div className="flex items-center p-0.5 bg-slate-100 dark:bg-[#181a22] border border-slate-300 dark:border-[#272b38] rounded font-mono text-[10px] shrink-0">
                      <button
                        type="button"
                        onClick={() => setSimulatorMode("iframe")}
                        className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                          simulatorMode === "iframe"
                            ? "bg-indigo-600 text-white font-bold shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                        title="Direct Native Iframe (0ms latency, native 60fps scrolling & typing)"
                      >
                        <Globe className="w-2.5 h-2.5" />
                        Iframe (Fast)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSimulatorMode("canvas")}
                        className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                          simulatorMode === "canvas"
                            ? "bg-indigo-600 text-white font-bold shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                        title="Canvas Screencast (Headless Chrome stream via CDP)"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        Canvas
                      </button>
                    </div>
                  )}

                  {/* Live Simulator vs App Screenshot Switch */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsLiveIframe(!isLiveIframe)
                      triggerToast(isLiveIframe ? (currentWorkflow?.designB ? "Showing App Screenshot" : "Showing Dev Sandbox") : "Showing Live Simulator")
                    }}
                    className={`px-2.5 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                      isLiveIframe
                        ? "bg-purple-50 dark:bg-purple-950/50 border-purple-300 dark:border-purple-500/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/60"
                        : "bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-500/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/70"
                    }`}
                    title={isLiveIframe ? "Switch to App Screenshot preview" : "Switch to Live Simulator preview"}
                  >
                    <Globe className="w-3 h-3" />
                    <span>{isLiveIframe ? (simulatorMode === "canvas" ? "Canvas Live" : "Iframe Live") : "App Screenshot"}</span>
                  </button>
                </div>

                <div
                  onClick={handleBrowserCanvasClick}
                  className={`flex-1 p-4 flex items-center justify-center bg-slate-200/50 dark:bg-[#07080b] bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#1e2230_1px,transparent_1px)] [background-size:18px_18px] relative select-none ${zoomMode === "fit" ? "overflow-hidden" : "overflow-auto"} ${isAddingAnnotation ? "cursor-crosshair" : "cursor-default"}`}
                >
                  <DeviceFrame
                    frameType={currentFrameType}
                    finish={frameFinish}
                    width={viewportWidth}
                    height={viewportHeight}
                    scale={currentScale}
                    showFrame={showDeviceFrame}
                    showStatusBar={showDeviceStatusBar}
                    screenRef={secondScreenRef}
                  >
                    {isLiveIframe ? (
                      simulatorMode === "canvas" ? (
                        isSessionLoaded ? (
                          <CanvasScreencast
                            ref={canvasScreencastRef}
                            url={currentUrl}
                            width={viewportWidth}
                            height={viewportHeight}
                            accessToken={currentSession?.access_token}
                            refreshToken={currentSession?.refresh_token}
                          />
                        ) : (
                          <div className="w-full h-full bg-slate-900 flex items-center justify-center text-xs text-slate-400">
                            Connecting...
                          </div>
                        )
                      ) : (
                        <iframe
                          ref={iframeRef}
                          src={resolvedIframeSrc}
                          title="Live preview"
                          className="w-full h-full border-0 bg-white"
                          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; cross-origin-isolated; fullscreen; camera; microphone; geolocation"
                        />
                      )
                    ) : currentWorkflow?.designB ? (
                      <div className="w-full h-full bg-white dark:bg-[#0f1117] flex items-center justify-center relative overflow-hidden select-none">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={currentWorkflow.designB} alt="Saved app screenshot" className="w-full h-full object-contain pointer-events-none" />
                        <AnnotationPins annotations={annotations} activeAnnotationId={activeAnnotationId} setActiveAnnotationId={setActiveAnnotationId} newAnnotationCoords={newAnnotationCoords} />
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-[#7e8596] p-6 text-center">
                        No screenshot saved. Upload the exact reference image.
                      </div>
                    )}
                  </DeviceFrame>
                </div>
              </section>
            </div>
          )}

          {compareMode !== "side-by-side" && (
            <div className={`w-full h-full flex items-center justify-center p-4 bg-slate-200/50 dark:bg-[#090a0e] bg-[radial-gradient(#94a3b8_1px,transparent_1px)] dark:bg-[radial-gradient(#1e2230_1px,transparent_1px)] [background-size:18px_18px] select-none ${zoomMode === "fit" ? "overflow-hidden" : "overflow-auto"}`}>
              <DeviceFrame
                frameType={currentFrameType}
                finish={frameFinish}
                width={viewportWidth}
                height={viewportHeight}
                scale={currentScale}
                showFrame={showDeviceFrame}
                showStatusBar={showDeviceStatusBar}
              >
                <div className="absolute inset-0 z-10 select-none overflow-hidden bg-white dark:bg-[#0f1117] flex items-center justify-center">
                  {currentWorkflow?.designA ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={currentWorkflow.designA} alt="Figma spec" className="w-full h-full object-contain pointer-events-none" />
                  ) : (
                    <FigmaPrototypeMock viewportWidth={viewportWidth} viewportHeight={viewportHeight} title={currentWorkflow?.title || "Platform Health Overview"} />
                  )}
                </div>
                <div
                  style={{
                    opacity: compareMode === "overlay" ? overlayOpacity / 100 : 1,
                    mixBlendMode: compareMode === "difference" ? "difference" : "normal",
                    filter: compareMode === "difference" ? "contrast(250%) invert(1)" : "none",
                  }}
                  className="absolute inset-0 z-20 select-none overflow-hidden bg-white dark:bg-[#0f1117] pointer-events-none transition-opacity duration-75 flex items-center justify-center"
                >
                  {currentWorkflow?.designB ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={currentWorkflow.designB} alt="Saved app screenshot" className="w-full h-full object-contain pointer-events-none" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-[#7e8596] p-6 text-center">
                      No screenshot saved. Upload the exact reference image.
                    </div>
                  )}
                </div>
              </DeviceFrame>
            </div>
          )}
        </main>

        {/* ================= UNIFIED RIGHT RAIL: replaces two overlapping floating cards ================= */}
        {railMode !== "none" && (
          <aside className="w-96 shrink-0 border-l border-slate-200 dark:border-[#1e222d] bg-white dark:bg-[#141620] flex flex-col animate-in slide-in-from-right-4 duration-200 shadow-xl transition-colors" aria-live="polite">
            {railMode === "new" && newAnnotationCoords && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#222736]">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-300 font-mono text-xs font-bold">NEW ISSUE</span>
                    <span className="text-xs text-slate-500 dark:text-[#8e95a5]">X:{newAnnotationCoords.x}% Y:{newAnnotationCoords.y}%</span>
                  </div>
                  <button type="button" onClick={() => setNewAnnotationCoords(null)} aria-label="Cancel new issue" className="text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-[#202434] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-5 space-y-3 overflow-y-auto flex-1">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-[#9ca3af] mb-1" htmlFor="issue-title">Issue summary</label>
                    <input
                      id="issue-title"
                      type="text"
                      placeholder="e.g. Button background token mismatch"
                      value={annotationDraft.title}
                      onChange={(e) => setAnnotationDraft({ ...annotationDraft, title: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-[#0d0e14] border border-slate-300 dark:border-[#2b3042] rounded-lg px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-[#9ca3af] mb-1" htmlFor="issue-expected">Expected (Figma)</label>
                      <textarea
                        id="issue-expected"
                        rows={2}
                        placeholder="#6366F1, 12px 24px pad"
                        value={annotationDraft.expected}
                        onChange={(e) => setAnnotationDraft({ ...annotationDraft, expected: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-[#0d0e14] border border-slate-300 dark:border-[#2b3042] rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 resize-none font-mono text-[10px] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-[#9ca3af] mb-1" htmlFor="issue-actual">Actual (Browser)</label>
                      <textarea
                        id="issue-actual"
                        rows={2}
                        placeholder="#3B82F6, 8px 16px pad"
                        value={annotationDraft.actual}
                        onChange={(e) => setAnnotationDraft({ ...annotationDraft, actual: e.target.value })}
                        className="w-full bg-slate-50 dark:bg-[#0d0e14] border border-slate-300 dark:border-[#2b3042] rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 resize-none font-mono text-[10px] transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="block text-[11px] font-medium text-slate-600 dark:text-[#9ca3af] mb-1">Severity</span>
                    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Severity">
                      {(["Low", "Medium", "High", "Blocker"] as const).map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          role="radio"
                          aria-checked={annotationDraft.severity === sev}
                          onClick={() => setAnnotationDraft({ ...annotationDraft, severity: sev })}
                          className={`py-1 text-[11px] rounded font-medium border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                            annotationDraft.severity === sev
                              ? sev === "Blocker" || sev === "High"
                                ? "bg-rose-500/20 border-rose-500 text-rose-600 dark:text-rose-300 font-bold"
                                : "bg-indigo-500/20 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold"
                              : "bg-slate-50 dark:bg-[#10121a] border-slate-300 dark:border-[#252a3a] text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white"
                          }`}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="px-5 py-4 border-t border-slate-200 dark:border-[#222736] flex justify-end gap-2">
                  <button type="button" onClick={() => setNewAnnotationCoords(null)} className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202434] cursor-pointer">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAnnotation}
                    disabled={!annotationDraft.title.trim()}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition cursor-pointer shadow-sm"
                  >
                    Create Marker
                  </button>
                </div>
              </div>
            )}

            {railMode === "inspect" &&
              (() => {
                const item = annotations.find((a) => a.id === activeAnnotationId)
                if (!item) return null
                const styles = SEVERITY_STYLES[item.severity]
                return (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-[#222736]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/40">
                          #{String(item.id).padStart(2, "0")}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${styles.badge}`}>{item.severity}</span>
                      </div>
                      <button type="button" onClick={() => setActiveAnnotationId(null)} aria-label="Close issue detail" className="text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white p-1 rounded hover:bg-slate-100 dark:hover:bg-[#202434] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-5 space-y-3 overflow-y-auto flex-1">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">{item.title}</h3>
                      <div className="space-y-2 bg-slate-50 dark:bg-[#0c0d14] p-3 rounded-lg border border-slate-200 dark:border-[#202536] font-mono text-[11px] transition-colors">
                        <div>
                          <div className="text-[10px] text-indigo-600 dark:text-indigo-400 uppercase font-bold tracking-wider mb-0.5">Expected (Design)</div>
                          <div className="text-slate-800 dark:text-[#c5c9d5]">{item.expected}</div>
                        </div>
                        <div className="border-t border-slate-200 dark:border-[#1c202e] pt-2">
                          <div className="text-[10px] text-rose-600 dark:text-rose-400 uppercase font-bold tracking-wider mb-0.5">Actual (Code)</div>
                          <div className="text-slate-800 dark:text-[#c5c9d5]">{item.actual}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-[#717888] pt-1">
                        <span>By {item.author}</span>
                        <span>{item.createdAt}</span>
                      </div>
                    </div>

                    <div className="px-5 py-4 border-t border-slate-200 dark:border-[#222736] flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => {
                          setAnnotations(annotations.map((a) => (a.id === item.id ? { ...a, resolved: !a.resolved } : a)))
                          triggerToast(item.resolved ? "Issue reopened" : "Issue marked as resolved")
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                          item.resolved ? "bg-emerald-50 dark:bg-emerald-600/20 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "bg-slate-100 hover:bg-slate-200 dark:bg-[#1e2230] dark:hover:bg-[#282e42] text-slate-800 dark:text-white"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {item.resolved ? "Resolved" : "Mark Resolved"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAnnotations(annotations.filter((a) => a.id !== item.id))
                          setActiveAnnotationId(null)
                          triggerToast("Issue deleted")
                        }}
                        className="text-xs text-slate-500 dark:text-[#8e95a5] hover:text-rose-600 dark:hover:text-rose-400 px-2 py-1 cursor-pointer flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })()}
          </aside>
        )}
      </div>

      {/* ================= CAPTURES DOCK: always visible so the feature is discoverable ================= */}
      <div className="h-20 border-t border-slate-200 dark:border-[#1e222d] bg-white dark:bg-[#11131a] px-4 flex items-center justify-between shrink-0 z-20 transition-colors">
        <span className="text-xs font-semibold text-slate-600 dark:text-[#8e95a5] flex items-center gap-1.5 shrink-0">
          <Camera className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
          Captures ({capturedScreenshots.length})
        </span>
        {capturedScreenshots.length === 0 ? (
          <span className="text-[11px] text-slate-400 dark:text-[#565c6c] italic">Capture a screenshot to save it here for later comparison.</span>
        ) : (
          <div className="flex items-center gap-3 overflow-x-auto py-2">
            {capturedScreenshots.map((snap) => (
              <button
                type="button"
                key={snap.id}
                onClick={() => {
                  if (currentWorkflow) {
                    onUpdateField?.(currentWorkflow.id, "designB", snap.url)
                  }
                  setCompareMode("overlay")
                  triggerToast("Applied capture to App Screenshot & switched to Overlay")
                }}
                className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-[#171922] dark:hover:bg-[#202330] border border-slate-300 dark:border-[#262b3a] hover:border-indigo-500 rounded-lg cursor-pointer transition text-xs group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 shadow-xs"
                title="Apply as App Screenshot & compare in Overlay mode"
              >
                <div className="w-8 h-8 rounded bg-slate-200 dark:bg-[#0b0c10] border border-slate-300 dark:border-[#2b3040] flex items-center justify-center font-mono text-[10px] text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition overflow-hidden shrink-0">
                  {snap.url.startsWith("data:") || snap.url.startsWith("http") ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={snap.url} alt="Snap" className="w-full h-full object-cover" />
                  ) : (
                    "IMG"
                  )}
                </div>
                <div className="text-left">
                  <div className="font-mono text-[11px] text-slate-900 dark:text-white font-medium">{snap.dimensions}</div>
                  <div className="text-[10px] text-slate-500 dark:text-[#6b7280]">{snap.timestamp}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ================= SCREEN INFO MODAL (Notes & Reason) ================= */}
      {showInfoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setShowInfoModal(false)}
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-[#111319] border border-slate-200 dark:border-[#272b38] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 transition-colors"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-modal-title"
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#1e222d] bg-slate-50 dark:bg-[#141620] flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shrink-0">
                  <Info className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="info-modal-title" className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {currentWorkflow?.title ? `Screen Info: ${currentWorkflow.title}` : "Screen Info"}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-[#8e95a5]">
                    Screen {currentWorkflowIndex + 1} of {workflows.length}
                  </p>
                </div>
              </div>

              {/* Prev / Next controls inside modal */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center bg-white dark:bg-[#181a22] border border-slate-300 dark:border-[#272b38] rounded-md p-0.5 shadow-xs transition-colors">
                  <button
                    type="button"
                    onClick={handlePrevWorkflow}
                    disabled={currentWorkflowIndex <= 0}
                    title="Previous screen"
                    className="p-1 rounded text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202430] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] font-mono text-slate-600 dark:text-[#8e95a5] px-1.5">
                    {currentWorkflowIndex + 1}/{workflows.length}
                  </span>
                  <button
                    type="button"
                    onClick={handleNextWorkflow}
                    disabled={currentWorkflowIndex >= workflows.length - 1}
                    title="Next screen"
                    className="p-1 rounded text-slate-500 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#202430] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-[#8e95a5] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#202430] transition cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Section 1: Our Notes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-[#e2e4ea]">
                    <FileText className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                    <span>Our Notes</span>
                  </label>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400/90 font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                    Developer Notes
                  </span>
                </div>

                {canEdit || isOwner ? (
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={() => {
                      if (currentWorkflow && onUpdateField && notesDraft !== (currentWorkflow.ourNotes || "")) {
                        onUpdateField(currentWorkflow.id, "ourNotes", notesDraft)
                      }
                    }}
                    rows={4}
                    placeholder="Developer notes about the design structure, constraints, or UX decisions..."
                    className="w-full bg-slate-50 dark:bg-[#0d0e14] border border-slate-300 dark:border-[#272b38] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 rounded-lg p-3 text-xs text-slate-900 dark:text-[#e2e4ea] placeholder-slate-400 dark:placeholder-[#5a6275] focus:outline-none resize-none leading-relaxed transition"
                  />
                ) : (
                  <div className="w-full min-h-[80px] bg-slate-50 dark:bg-[#0d0e14] border border-slate-200 dark:border-[#272b38] rounded-lg p-3 text-xs text-slate-800 dark:text-[#d1d5db] leading-relaxed whitespace-pre-wrap">
                    {currentWorkflow?.ourNotes || (
                      <span className="text-slate-400 dark:text-[#646c82] italic">No developer notes provided.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Section 2: Reason for Final Changes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-[#e2e4ea]">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    <span>Reason</span>
                  </label>
                  <span className="text-[10px] text-amber-600 dark:text-amber-400/90 font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    Designer Reasoning
                  </span>
                </div>

                {canEdit || isOwner ? (
                  <textarea
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    onBlur={() => {
                      if (currentWorkflow && onUpdateField && reasonDraft !== (currentWorkflow.reason || "")) {
                        onUpdateField(currentWorkflow.id, "reason", reasonDraft)
                      }
                    }}
                    rows={4}
                    placeholder="Explain why changes were made or how feedback was addressed..."
                    className="w-full bg-slate-50 dark:bg-[#0d0e14] border border-slate-300 dark:border-[#272b38] focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 rounded-lg p-3 text-xs text-slate-900 dark:text-[#e2e4ea] placeholder-slate-400 dark:placeholder-[#5a6275] focus:outline-none resize-none leading-relaxed transition"
                  />
                ) : (
                  <div className="w-full min-h-[80px] bg-slate-50 dark:bg-[#0d0e14] border border-slate-200 dark:border-[#272b38] rounded-lg p-3 text-xs text-slate-800 dark:text-[#d1d5db] leading-relaxed whitespace-pre-wrap">
                    {currentWorkflow?.reason || (
                      <span className="text-slate-400 dark:text-[#646c82] italic">No reason provided.</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-[#1e222d] bg-slate-50 dark:bg-[#141620] flex items-center justify-between shrink-0">
              <div className="text-[11px] text-slate-500 dark:text-[#8e95a5]">
                {isSavedRecently && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Changes saved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInfoModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#202430] transition cursor-pointer"
                >
                  Close
                </button>
                {(canEdit || isOwner) && (
                  <button
                    type="button"
                    onClick={handleSaveInfo}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition cursor-pointer flex items-center gap-1.5"
                  >
                    Save Changes
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= CONFIRM SCREENSHOT MODAL (Upload or Capture) ================= */}
      {(pendingScreenshot && pendingScreenshotUrl) || pendingCaptureUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl bg-slate-900 border border-slate-800 p-5 text-white shadow-2xl">
            <h2 className="text-base font-semibold">
              {pendingCaptureUrl ? "Confirm captured screenshot" : "Confirm exact screenshot"}
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              {pendingCaptureUrl
                ? "This screenshot was captured from the live frame. Check it before saving."
                : "Check the image carefully before saving. This file will be uploaded unchanged."
              }
            </p>

            <div className="mt-4 overflow-hidden rounded-lg bg-black border border-slate-800 flex items-center justify-center max-h-[60vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingCaptureUrl || pendingScreenshotUrl!}
                alt="Screenshot preview"
                className="max-h-[60vh] w-full object-contain"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelExactScreenshot}
                disabled={isSavingScreenshot}
                className="rounded-lg px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={pendingCaptureUrl ? saveCapturedScreenshot : saveExactScreenshot}
                disabled={isSavingScreenshot}
                className="rounded-lg bg-lime-500 hover:bg-lime-400 px-4 py-2 text-xs font-bold text-black disabled:opacity-50 transition cursor-pointer flex items-center gap-1.5"
              >
                {isSavingScreenshot ? "Saving…" : "Save this screenshot"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ================= DEBUG PANEL ================= */}
      {isDebugMode && (
        <div className="h-32 border-t border-slate-200 dark:border-[#1e222d] bg-slate-50 dark:bg-[#0c0d12] px-4 py-3 overflow-y-auto shrink-0 z-20 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-[#c5c9d5]">Debug Information</h3>
            <button
              type="button"
              onClick={() => setDebugInfo({ errors: [] })}
              className="text-[10px] px-2 py-1 rounded bg-slate-200 dark:bg-[#1a1c24] text-slate-600 dark:text-[#8e95a5] hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              Clear
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-[11px]">
            <div>
              <div className="font-medium text-slate-600 dark:text-[#8e95a5] mb-1">Current State</div>
              <div className="space-y-1">
                <div>Workflow: <span className="font-mono">{currentWorkflow?.id?.substring(0, 8)}...</span></div>
                <div>Capturing: <span className="font-mono">{isCapturing ? "Yes" : "No"}</span></div>
                <div>Saving: <span className="font-mono">{isSavingScreenshot ? "Yes" : "No"}</span></div>
                <div>Pending Capture: <span className="font-mono">{pendingCaptureUrl ? "Yes" : "No"}</span></div>
                <div>Pending Screenshot: <span className="font-mono">{pendingScreenshot ? "Yes" : "No"}</span></div>
                <div>onUpdateField: <span className="font-mono">{onUpdateField ? "Available" : "Missing"}</span></div>
              </div>
            </div>
            
            <div>
              <div className="font-medium text-slate-600 dark:text-[#8e95a5] mb-1">Recent Activity</div>
              <div className="space-y-1">
                {debugInfo.lastCapture && (
                  <div>Last Capture: <span className="font-mono">{new Date(debugInfo.lastCapture).toLocaleTimeString()}</span></div>
                )}
                {debugInfo.lastSave && (
                  <div>Last Save: <span className="font-mono">{new Date(debugInfo.lastSave).toLocaleTimeString()}</span></div>
                )}
                {debugInfo.errors.length > 0 && (
                  <div>
                    <div className="text-red-600 dark:text-red-400 font-medium">Recent Errors:</div>
                    {debugInfo.errors.map((error, index) => (
                      <div key={index} className="text-red-600 dark:text-red-400 font-mono text-[10px] truncate">
                        {error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TOAST QUEUE: stacked instead of overwritten ================= */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2" aria-live="polite">
        {toastQueue.map((t) => (
          <div key={t.id} className="bg-[#1e2230] border border-indigo-500/40 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-xs font-medium animate-in fade-in slide-in-from-bottom-3 duration-200">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Mock content components
// ============================================================================

function FigmaPrototypeMock({ viewportWidth, viewportHeight, title }: { viewportWidth: number; viewportHeight: number; title: string }) {
  return (
    <div style={{ width: `${viewportWidth}px`, minHeight: `${viewportHeight}px` }} className="bg-[#0f1117] text-white flex flex-col select-none">
      <div className="h-16 border-b border-[#1f2433] px-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold tracking-tight text-base text-white">
            <div className="w-6 h-6 rounded bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-xs">◆</div>
            PulseMetric Pro
          </div>
          <div className="flex items-center gap-4 text-xs text-[#9aa0b2]">
            <span className="text-white font-medium">Dashboard</span>
            <span>Analytics</span>
            <span>Audience</span>
            <span>Integrations</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#1d2230] border border-[#2b3144] flex items-center justify-center text-xs">🔔</div>
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold">JD</div>
        </div>
      </div>
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
            <p className="text-xs text-[#8e95a5] mt-1">Real-time throughput metrics & conversion funnels across active regions.</p>
          </div>
          <button type="button" className="px-6 py-3 rounded-lg bg-[#6366F1] text-white font-semibold text-xs shadow-lg shadow-indigo-600/30 flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" />
            Deploy New Cluster
          </button>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">Active Sessions</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">142,890</div>
            <div className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1 font-medium">↑ +18.4% vs last week</div>
          </div>
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">P99 Response Latency</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">42.8 ms</div>
            <div className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1 font-medium">↓ -4.2ms faster</div>
          </div>
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">Net Error Rate</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">0.003%</div>
            <div className="text-[11px] text-[#8c93a8] mt-2">Target: &lt; 0.05%</div>
          </div>
        </div>
        <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a] space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Throughput Trends (24h)</span>
            <span className="text-[#7c8395] font-mono">Sampling: 1s interval</span>
          </div>
          <div className="h-36 w-full flex items-end gap-1 pt-4 border-b border-[#212638]">
            {[42, 58, 65, 72, 60, 85, 92, 78, 64, 52, 69, 81, 95, 88, 76, 68, 74, 82, 91, 86, 79, 94].map((val, i) => (
              <div key={i} style={{ height: `${val}%` }} className="flex-1 bg-indigo-500/40 rounded-t hover:bg-indigo-400 transition" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function LiveDevSandboxMock({
  annotations,
  activeAnnotationId,
  setActiveAnnotationId,
  newAnnotationCoords,
  title,
}: {
  annotations: Annotation[]
  activeAnnotationId: number | null
  setActiveAnnotationId: (id: number) => void
  newAnnotationCoords: { x: number; y: number } | null
  title: string
}) {
  return (
    <div className="text-white flex flex-col select-none relative min-h-[900px] bg-[#0f1117]">
      <div className="h-16 border-b border-[#1f2433] px-8 flex items-center justify-between bg-[#0f1117]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 font-bold tracking-tight text-base text-white">
            <div className="w-6 h-6 rounded bg-indigo-600 flex items-center justify-center text-xs">◆</div>
            PulseMetric Pro
          </div>
          <div className="flex items-center gap-4 text-xs text-[#9aa0b2]">
            <span className="text-white font-medium">Dashboard</span>
            <span>Analytics</span>
            <span>Audience</span>
            <span>Integrations</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#1d2230] border border-[#2b3144] flex items-center justify-center text-xs">🔔</div>
          <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold">JD</div>
        </div>
      </div>
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
            <p className="text-xs text-[#8e95a5] mt-1">Real-time throughput metrics & conversion funnels across active regions.</p>
          </div>
          <button type="button" className="px-4 py-2 rounded bg-[#3B82F6] text-white font-medium text-xs shadow-md flex items-center gap-2 hover:bg-blue-600 transition">
            <Plus className="w-3.5 h-3.5" />
            Deploy New Cluster
          </button>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">Active Sessions</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">142,890</div>
            <div className="text-[11px] text-gray-400 mt-2 font-mono">+18% vs last week</div>
          </div>
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">P99 Response Latency</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">42.8 ms</div>
            <div className="text-[11px] text-emerald-400 mt-2 flex items-center gap-1 font-medium">↓ -4.2ms faster</div>
          </div>
          <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a]">
            <div className="text-xs font-medium text-[#8c93a8]">Net Error Rate</div>
            <div className="text-2xl font-bold text-white mt-2 font-mono">0.003%</div>
            <div className="text-[11px] text-[#8c93a8] mt-2">Target: &lt; 0.05%</div>
          </div>
        </div>
        <div className="p-5 rounded-xl bg-[#151824] border border-[#23283a] space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Throughput Trends (24h)</span>
            <span className="text-[#7c8395] font-mono">Sampling: 1s interval</span>
          </div>
          <div className="h-36 w-full flex items-end gap-1 pt-4 border-b border-[#212638]">
            {[42, 58, 65, 72, 60, 85, 92, 78, 64, 52, 69, 81, 95, 88, 76, 68, 74, 82, 91, 86, 79, 94].map((val, i) => (
              <div key={i} style={{ height: `${val}%` }} className="flex-1 bg-blue-500/40 rounded-t hover:bg-blue-400 transition" />
            ))}
          </div>
        </div>
      </div>
      <AnnotationPins annotations={annotations} activeAnnotationId={activeAnnotationId} setActiveAnnotationId={setActiveAnnotationId} newAnnotationCoords={newAnnotationCoords} />
    </div>
  )
}

// ============================================================================
// Annotation pins — keyboard accessible, single pulse on creation instead of
// continuous bounce on every unresolved High/Blocker pin.
// ============================================================================

function AnnotationPins({
  annotations,
  activeAnnotationId,
  setActiveAnnotationId,
  newAnnotationCoords,
}: {
  annotations: Annotation[]
  activeAnnotationId: number | null
  setActiveAnnotationId: (id: number) => void
  newAnnotationCoords: { x: number; y: number } | null
}) {
  return (
    <>
      {annotations.map((ann) => {
        const isSelected = activeAnnotationId === ann.id
        const styles = SEVERITY_STYLES[ann.severity]
        return (
          <button
            key={ann.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setActiveAnnotationId(ann.id)
            }}
            style={{ left: `${ann.x}%`, top: `${ann.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-30 cursor-pointer group/pin focus:outline-none"
            aria-label={`Issue ${ann.id}: ${ann.title} (${ann.severity})`}
          >
            <div
              className={`flex items-center justify-center font-mono font-bold text-[11px] px-2 py-1 rounded-full shadow-lg transition-transform hover:scale-110 ${
                ann.resolved ? "bg-emerald-600 text-white" : styles.pin
              } ${isSelected ? "ring-2 ring-white scale-110" : "ring-2 ring-black/20"}`}
            >
              {String(ann.id).padStart(2, "0")}
            </div>
          </button>
        )
      })}
      {newAnnotationCoords && (
        <div style={{ left: `${newAnnotationCoords.x}%`, top: `${newAnnotationCoords.y}%` }} className="absolute -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <div className="w-6 h-6 rounded-full bg-indigo-500 ring-4 ring-indigo-400/50 flex items-center justify-center text-white font-mono text-xs font-bold animate-ping" />
        </div>
      )}
    </>
  )
}

export default WorkflowSimulator
