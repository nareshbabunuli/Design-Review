"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import Link from "next/link"
import {
  Sparkles,
  Smartphone,
  Columns,
  Play,
  Square,
  Pause,
  RotateCcw,
  Compass,
  Eye,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  Download,
  Key,
  Terminal,
  ChevronDown,
  Globe,
  Loader2,
  Copy,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Layers,
  ChevronRight,
  MessageSquare,
  Send,
  Bot,
  Wand2,
  Video,
  ListChecks,
  GitBranch,
  Image as ImageIcon,
  Paperclip,
  Brain,
  CheckSquare,
  Clock,
  ShieldAlert,
  X,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  ZoomIn,
  ArrowLeft,
  Trash2,
  FileUp,
  FolderKanban,
  Folder,
  FolderCheck,
  CreditCard,
  FileCode,
  Mail,
  Pencil,
  Settings,
  LogOut,
  Plug,
  User,
  Archive,
  FileBarChart,
} from "lucide-react"
import type { Session, AuthChangeEvent } from "@supabase/supabase-js"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import { WorkflowSimulator } from "@/components/design-review/workflow-simulator"
import { ThemeToggle } from "@/components/design-review/theme-toggle"
import { SettingsModal } from "@/components/design-review/settings-modal"
import TestFlowGraph from "@/components/design-review/test-flow-graph"
import FullAppTestingView from "@/components/design-review/full-app-testing-view"
import FeatureWorkflowView from "@/components/design-review/feature-workflow-view"
import AiConfigPanel from "@/components/design-review/ai-config-panel"
import MovableAiConfigModal from "@/components/design-review/movable-ai-config-modal"
import ActionLedger from "@/components/design-review/action-ledger"
import { synthesizeFullAppPlanFromJob, buildFigmaWorkflowMap } from "@/lib/ai-automation/full-app-utils"
import type {
  AutomationJob,
  DiscoveredScreen,
  AutomationIssue,
  AgentChatMessage,
  AIThinkingModel,
  ChecklistTestItem,
} from "@/lib/ai-automation/types"

type ProjectRow = {
  id: string
  title: string
  is_expanded: boolean
  user_id: string
  figma_url?: string | null
  workflow_order?: string[] | null
  is_order_locked?: boolean | null
}

type WorkflowRow = {
  id: string
  project_id: string
  title: string
  design_a: string | null
  design_b: string | null
  figma_url?: string | null
  our_notes: string | null
  client_message: string | null
  client_task_done: boolean | null
  reason: string | null
  is_done: boolean | null
  created_at: string
}

type CommentRow = {
  id: string
  workflow_id: string
  author_id: string
  author_email?: string
  body: string
  reason?: string | null
  created_at: string
}

type RevisionRow = {
  id: string
  project_id: string
  workflow_id: string
  revision_number: number
  author_id: string
  author_email: string
  author_role: string
  reason: string
  design_a?: string | null
  design_b?: string | null
  created_at: string
}

const DEFAULT_AI_PROJECT: Project = {
  id: "ai-simulator-default",
  title: "AI Experience Simulator",
  isExpanded: true,
  userId: "demo",
  figmaUrl: null,
  workflowOrder: ["wf-ai-1", "wf-ai-2", "wf-ai-3"],
  isOrderLocked: false,
  workflows: [
    {
      id: "wf-ai-1",
      projectId: "ai-simulator-default",
      title: "Calendar Event Flow",
      designA: null,
      designB: null,
      figmaUrl: null,
      ourNotes: "Simulated AI action: calendar appointment creation & confirmation prompt.",
      clientMessage: "Review interactive schedule card and layout.",
      clientTaskDone: false,
      reason: "Ensure mobile calendar response adheres to typography standards.",
      isDone: false,
      comments: [],
      revisions: [],
    },
    {
      id: "wf-ai-2",
      projectId: "ai-simulator-default",
      title: "GPS Navigation Preview",
      designA: null,
      designB: null,
      figmaUrl: null,
      ourNotes: "Simulated AI action: destination route calculation with ETA badge.",
      clientMessage: "Check map overlay contrast in dark mode.",
      clientTaskDone: false,
      reason: "Optimize route readability in compact viewport.",
      isDone: false,
      comments: [],
      revisions: [],
    },
    {
      id: "wf-ai-3",
      projectId: "ai-simulator-default",
      title: "Control Center & Flashlight",
      designA: null,
      designB: null,
      figmaUrl: null,
      ourNotes: "Simulated AI action: quick settings toggle and status indicators.",
      clientMessage: "Test responsive quick tiles on mobile frame.",
      clientTaskDone: true,
      reason: "Validate toggle states and animation response.",
      isDone: true,
      comments: [],
      revisions: [],
    },
  ],
}

export default function AISimulatorPage() {
  const supabase = createClient()
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<Project[]>([DEFAULT_AI_PROJECT])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(DEFAULT_AI_PROJECT.id)
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(DEFAULT_AI_PROJECT.workflows[0]?.id || null)
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [isSimulatorFullscreen, setIsSimulatorFullscreen] = useState(false)

  // Dedicated Movable AI Vision & Engine Config modal state
  const [isAiConfigModalOpen, setIsAiConfigModalOpen] = useState(false)

  // Movable split pane width state between Phone Simulator and Stage
  const [splitWidth, setSplitWidth] = useState(500)
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)
  const isDraggingSplitterRef = useRef(false)

  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingSplitterRef.current = true
    setIsDraggingSplitter(true)
    const startX = e.clientX
    const startWidth = splitWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitterRef.current) return
      const delta = moveEvent.clientX - startX
      const minLeft = 300
      const minRight = 360
      const maxLeft = Math.max(minLeft, window.innerWidth - minRight)
      const newWidth = Math.max(minLeft, Math.min(maxLeft, startWidth + delta))
      setSplitWidth(newWidth)
    }

    const onMouseUp = () => {
      isDraggingSplitterRef.current = false
      setIsDraggingSplitter(false)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  // Automation Bot Configuration State
  const [targetUrl, setTargetUrl] = useState("http://localhost:3001")
  const [selectedProjectDir, setSelectedProjectDir] = useState<string>("landlord-accounting-portal")
  const [availableProjects, setAvailableProjects] = useState<Array<{ name: string; path: string; defaultPort?: number }>>([])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showCredentials, setShowCredentials] = useState(false)
  const [maxScreens, setMaxScreens] = useState(5)
  const [checkBackNav, setCheckBackNav] = useState(true)
  const [checkResponsive, setCheckResponsive] = useState(true)
  const [recordVideo, setRecordVideo] = useState(true)

  // Active Automation Job State
  const [currentJob, setCurrentJob] = useState<AutomationJob | null>(null)
  const [isExportingZip, setIsExportingZip] = useState(false)
  const [isResettingData, setIsResettingData] = useState(false)

  const handleExportZip = async () => {
    if (!currentJob?.id || isExportingZip) return
    setIsExportingZip(true)
    try {
      const res = await fetch(`/api/ai-automation/export-zip?jobId=${currentJob.id}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.error || "Failed to generate export zip")
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const disposition = res.headers.get("content-disposition") || ""
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      a.download = filenameMatch?.[1] || `test-bundle-${currentJob.id.slice(0, 8)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(`Export failed: ${err?.message || "Could not generate ZIP bundle"}`)
    } finally {
      setIsExportingZip(false)
    }
  }

  const handleResetData = async () => {
    if (!currentJob?.id || isResettingData) return
    const confirmed = window.confirm(
      "Are you sure you want to reset all discovered screens and test plan data? This will clear the current map and tests so you can start a fresh run."
    )
    if (!confirmed) return

    setIsResettingData(true)
    try {
      const res = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJob.id, action: "reset_test_data" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not reset map data")
      if (data.job) setCurrentJob(data.job)
    } catch (err: any) {
      alert(`Reset failed: ${err?.message || "Could not reset data"}`)
    } finally {
      setIsResettingData(false)
    }
  }

  const lastSessionEventSequenceRef = useRef<Record<string, number>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [botError, setBotError] = useState("")
  const [copiedReport, setCopiedReport] = useState(false)

  // Nebius Token Factory / OmniRouter / Local AI Model Provider State
  const [aiProvider, setAiProvider] = useState<"nebius" | "omnirouter" | "local">("nebius")
  const [localAiBaseUrl, setLocalAiBaseUrl] = useState("http://localhost:11434/v1")
  const [omniRouterBaseUrl, setOmniRouterBaseUrl] = useState("https://api.unorouter.com/v1")
  const [omniRouterKey, setOmniRouterKey] = useState("")
  const [nebiusApiKey, setNebiusApiKey] = useState("")
  const [selectedAiModel, setSelectedAiModel] = useState("nvidia/Nemotron-3-Nano-Omni")
  const [omniRouterModel, setOmniRouterModel] = useState("deepseek-v4-flash:free")
  const [showAiSettings, setShowAiSettings] = useState(false)

  // Antigravity Browser Control & Action Replay State
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [isPlayingReplay, setIsPlayingReplay] = useState(false)

  // Laya Fast System-1 Reflexes & Journey Role State
  const [journeyRole, setJourneyRole] = useState<"user" | "admin" | "client" | "editor" | "viewer" | "custom">("user")
  const [customJourneyRole, setCustomJourneyRole] = useState("")
  const [enableLaya, setEnableLaya] = useState(true)
  const [layaBaseUrl, setLayaBaseUrl] = useState("http://127.0.0.1:8000")
  const [isLayaLive, setIsLayaLive] = useState(false)
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null)

  // Testing mode: Feature / Workflow Testing vs Full App Testing
  const [testingMode, setTestingMode] = useState<"feature_workflow" | "full_app">("feature_workflow")
  const [workflowPromptInput, setWorkflowPromptInput] = useState("")

  // Pre-Flight Continuous Testing Checklist State
  const [showPreFlightModal, setShowPreFlightModal] = useState(false)
  const [uploadFilesDir, setUploadFilesDir] = useState("scripts/fixtures")
  const [postmanCollectionText, setPostmanCollectionText] = useState("")
  const [postmanFileName, setPostmanFileName] = useState("")
  const [allowTestPayments, setAllowTestPayments] = useState(false)
  const [allowDestructiveActions, setAllowDestructiveActions] = useState(false)
  const [pendingLaunchMode, setPendingLaunchMode] = useState<"full_app" | "feature_workflow">("full_app")

  // Verification and Settings interaction state
  const [verificationUrlInput, setVerificationUrlInput] = useState("")
  const [isDummyTestActive, setIsDummyTestActive] = useState(false)

  useEffect(() => {
    const handleStatus = (e: any) => {
      setIsDummyTestActive(Boolean(e.detail?.running))
    }
    window.addEventListener("dummy-test-status", handleStatus)
    return () => window.removeEventListener("dummy-test-status", handleStatus)
  }, [])
  const [verificationCodeInput, setVerificationCodeInput] = useState("")
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false)
  const [settingsFormValues, setSettingsFormValues] = useState<Record<string, string>>({})
  const [showSettingsSecrets, setShowSettingsSecrets] = useState<Record<string, boolean>>({})
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)

  // Main stage layout mode: "simulator" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  type StageViewMode = "simulator" | "map" | "screens" | "plan" | "execution" | "files" | "coverage" | "chat"
  const [stageViewMode, setStageViewMode] = useState<StageViewMode>("simulator")

  // Workspace layout mode: "device" (Phone Simulator) | "split" (Side-by-Side) | "stage" (Map & Plan)
  type WorkspaceLayoutMode = "device" | "split" | "stage"
  const [workspaceLayoutMode, setWorkspaceLayoutMode] = useState<WorkspaceLayoutMode>("split")

  // Sync testing mode when a job is active
  useEffect(() => {
    if (currentJob?.mode === "feature_workflow") {
      setTestingMode("feature_workflow")
    } else if (currentJob?.mode === "full_app") {
      setTestingMode("full_app")
    }
  }, [currentJob?.mode])

  // VS Code Collapsible Bottom Panel State (Terminal, Coverage Breakdown, Action Logs)
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false)
  const [bottomPanelTab, setBottomPanelTab] = useState<"terminal" | "coverage" | "actions">("terminal")

  // Check URL query param on mount: e.g. /ai-simulator?tab=map or ?view=screens opens directly
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      const tabParam = params.get("tab") || params.get("view")
      if (
        tabParam &&
        ["simulator", "map", "screens", "plan", "execution", "files", "coverage", "chat"].includes(tabParam)
      ) {
        setStageViewMode(tabParam as StageViewMode)
        if (tabParam === "simulator") {
          setWorkspaceLayoutMode("device")
        } else {
          setWorkspaceLayoutMode("split")
        }
      }
    }
  }, [])

  // Load project from URL search param if provided (e.g. ?projectId=... or ?project=...)
  useEffect(() => {
    if (typeof window === "undefined" || !supabase) return
    const params = new URLSearchParams(window.location.search)
    const pId = params.get("projectId") || params.get("project") || params.get("id")
    if (!pId || pId === "ai-simulator-default") return

    setActiveProjectId(pId)

    const fetchProject = async () => {
      try {
        const { data: pData } = await supabase
          .from("projects")
          .select("id, title, user_id, figma_url")
          .eq("id", pId)
          .single()

        if (pData) {
          const { data: wData } = await supabase
            .from("workflows")
            .select("id, project_id, title, design_a, design_b, figma_url, our_notes, client_message, client_task_done, reason, is_done")
            .eq("project_id", pId)

          const loadedProject: Project = {
            id: pData.id,
            title: pData.title,
            isExpanded: true,
            userId: pData.user_id,
            figmaUrl: pData.figma_url,
            workflows: (wData || []).map((w: any) => ({
              id: w.id,
              projectId: w.project_id,
              title: w.title,
              designA: w.design_a,
              designB: w.design_b,
              figmaUrl: w.figma_url,
              ourNotes: w.our_notes || "",
              clientMessage: w.client_message || "",
              clientTaskDone: w.client_task_done,
              reason: w.reason || "",
              isDone: w.is_done,
              comments: [],
              revisions: [],
            })),
          }

          setProjects((prev) => {
            const filtered = prev.filter((p) => p.id !== pId)
            return [loadedProject, ...filtered]
          })
          if (loadedProject.workflows.length > 0) {
            setActiveWorkflowId(loadedProject.workflows[0].id)
          }
        }
      } catch (err) {
        console.warn("[AI Simulator] Failed to load project from query param:", err)
      }
    }
    fetchProject()
  }, [supabase])

  // Full App Test Plan & Figma-Style Workflow Map Synthesis
  const activePlan = useMemo(() => {
    return synthesizeFullAppPlanFromJob(currentJob)
  }, [currentJob])

  const activeFlowGraph = useMemo(() => {
    if (!activePlan) return null
    return buildFigmaWorkflowMap(activePlan)
  }, [activePlan])

  const handleSelectWorkspaceTab = useCallback((tabId: StageViewMode) => {
    setStageViewMode(tabId)
    if (tabId === "simulator") {
      setWorkspaceLayoutMode("device")
    } else {
      // Keep stage view
      if (workspaceLayoutMode === "stage") {
        setWorkspaceLayoutMode("stage")
      }
    }
    if (tabId === "map" && !currentJob) {
      setTestingMode("full_app")
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      if (tabId === "simulator") {
        url.searchParams.delete("tab")
        url.searchParams.delete("view")
      } else {
        url.searchParams.set("tab", tabId)
        url.searchParams.delete("view")
      }
      window.history.replaceState(null, "", url.toString())
    }
  }, [workspaceLayoutMode, currentJob])

  const handleOpenMapPage = useCallback(() => {
    handleSelectWorkspaceTab("map")
  }, [handleSelectWorkspaceTab])

  const handleBackToSimulator = useCallback(() => {
    handleSelectWorkspaceTab("simulator")
  }, [handleSelectWorkspaceTab])

  // Workspace tabs matching Full App Testing components
  const workspaceTabs: Array<{
    id: StageViewMode
    label: string
    icon: any
    count?: number | string
    isLive?: boolean
  }> = useMemo(() => {
    const passedCount = activePlan?.steps?.filter((s) => s.status === "passed").length || 0
    const totalSteps = activePlan?.steps?.length || 0
    const coveragePct =
      totalSteps > 0 ? Math.round((passedCount / totalSteps) * 100) : activePlan?.coverage?.percentage || 100

    return [
      { id: "simulator", label: "Simulator", icon: Smartphone },
      { id: "chat", label: "Testing Bot Chat", icon: MessageSquare, isLive: currentJob?.status === "running" },
      { id: "map", label: "Full App Stage & Map", icon: MapIcon, count: activePlan?.screens.length || 0 },
    ]
  }, [activePlan, currentJob])

  const handleSelectScreenFromGraph = useCallback(
    (screenId: string) => {
      if (!activePlan) return
      const screenNode = activePlan.screens.find((s) => s.id === screenId)
      if (!screenNode) return

      if (currentJob?.screens && currentJob.screens.length > 0) {
        const idx = currentJob.screens.findIndex((s) => {
          const sTitle = (s.title || "").toLowerCase()
          const nTitle = screenNode.name.toLowerCase()
          return (
            sTitle.includes(nTitle) ||
            nTitle.includes(sTitle) ||
            (s.path && screenNode.path && s.path === screenNode.path) ||
            (s.url && screenNode.url && s.url === screenNode.url)
          )
        })
        if (idx !== -1) {
          setSelectedStepIndex(idx)
          const targetWfId = currentJob.screens[idx].workflowId || `bot-screen-${idx}`
          setActiveWorkflowId(targetWfId)
        }
      }
    },
    [activePlan, currentJob]
  )

  // Simulator device viewport state
  const [simulatorViewport, setSimulatorViewport] = useState<{ width: number; height: number }>({ width: 393, height: 852 })
  const handleSimulatorViewportChange = useCallback((vp: { width: number; height: number }) => {
    setSimulatorViewport((prev) => {
      if (prev.width === vp.width && prev.height === vp.height) return prev
      return { width: vp.width, height: vp.height }
    })
  }, [])

  // Local Project Route Scanner State
  const actionLedgerLive = activePlan?.steps?.filter((s) => s.status === "running").map((s) => ({ id: s.id, title: s.targetName || "Running action", detail: s.expectedResult, status: "running" as const })) || []
  const actionLedgerQueue = activePlan?.steps?.filter((s) => s.status === "pending").map((s) => ({ id: s.id, title: s.targetName || "Pending action", detail: s.expectedResult, status: "queued" as const })) || []
  const actionLedgerHistory = activePlan?.steps?.filter((s) => ["passed", "failed", "blocked", "skipped_unsafe"].includes(s.status)).slice(-30).reverse().map((s) => ({
    id: s.id,
    title: s.targetName || "Completed action",
    detail: s.actualResult || s.expectedResult,
    status: s.status === "passed" ? "passed" as const : s.status === "failed" ? "failed" as const : s.status === "blocked" ? "blocked" as const : "skipped" as const,
  })) || []

  const [discoveredRoutes, setDiscoveredRoutes] = useState<Array<{ path: string; url: string; file: string; title: string }>>([])
  const [isScanningRoutes, setIsScanningRoutes] = useState(false)

  const fetchLocalRoutes = useCallback(async (dirOverride?: string, urlOverride?: string) => {
    try {
      setIsScanningRoutes(true)
      const dir = dirOverride !== undefined ? dirOverride : selectedProjectDir
      const url = urlOverride !== undefined ? urlOverride : targetUrl
      const params = new URLSearchParams()
      if (url) params.set("baseUrl", url)
      if (dir) params.set("projectDir", dir)
      const res = await fetch(`/api/ai-automation/routes?${params.toString()}`)
      const data = await res.json()
      if (data?.routes) {
        setDiscoveredRoutes(data.routes)
      }
      if (data?.availableProjects) {
        setAvailableProjects(data.availableProjects)
      }
      if (data?.activeProjectDir && !selectedProjectDir) {
        setSelectedProjectDir(data.activeProjectDir)
      }
    } catch {}
    finally {
      setIsScanningRoutes(false)
    }
  }, [selectedProjectDir, targetUrl])

  // Test Data Provisioning & Verification state
  interface TestDataInfo {
    exists: boolean
    filesCount: number
    folderPath: string
    files: Array<{ name: string; size: number; category: string; lastModified?: string }>
    message?: string
  }

  const [testDataStatus, setTestDataStatus] = useState<TestDataInfo | null>(null)
  const [isCheckingTestData, setIsCheckingTestData] = useState<boolean>(false)
  const [isGeneratingTestData, setIsGeneratingTestData] = useState<boolean>(false)
  const [isTestDataModalOpen, setIsTestDataModalOpen] = useState<boolean>(false)

  const fetchTestDataStatus = useCallback(async (projectName?: string) => {
    const proj = projectName || selectedProjectDir
    if (!proj) return
    setIsCheckingTestData(true)
    try {
      const res = await fetch(`/api/ai-automation/test-data?projectDir=${encodeURIComponent(proj)}`)
      const data = await res.json()
      if (data && typeof data.exists === "boolean") {
        setTestDataStatus(data)
      }
    } catch (e) {
      console.error("Failed to check test data status", e)
    } finally {
      setIsCheckingTestData(false)
    }
  }, [selectedProjectDir])

  const handleGenerateTestData = useCallback(async (projectName?: string) => {
    const proj = projectName || selectedProjectDir
    if (!proj) return
    setIsGeneratingTestData(true)
    try {
      const res = await fetch("/api/ai-automation/test-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectDir: proj }),
      })
      const data = await res.json()
      if (data && typeof data.exists === "boolean") {
        setTestDataStatus(data)
        setIsTestDataModalOpen(true)
      }
    } catch (e) {
      console.error("Failed to generate test data", e)
    } finally {
      setIsGeneratingTestData(false)
    }
  }, [selectedProjectDir])

  const handleSelectTestingProject = (projectName: string) => {
    setSelectedProjectDir(projectName)
    localStorage.setItem("ai_target_project_dir", projectName)

    const projectInfo = availableProjects.find((p) => p.name === projectName)
    const newPort = projectInfo?.defaultPort || (projectName === "landlord-accounting-portal" ? 3001 : 3000)
    const newUrl = `http://localhost:${newPort}`
    setTargetUrl(newUrl)
    localStorage.setItem("ai_target_app_url", newUrl)
    fetchLocalRoutes(projectName, newUrl)
    fetchTestDataStatus(projectName)
  }

  useEffect(() => {
    const savedProject = localStorage.getItem("ai_target_project_dir") || "landlord-accounting-portal"
    const savedUrl = localStorage.getItem("ai_target_app_url") || (savedProject === "landlord-accounting-portal" ? "http://localhost:3001" : "http://localhost:3000")
    setSelectedProjectDir(savedProject)
    setTargetUrl(savedUrl)
    fetchLocalRoutes(savedProject, savedUrl)
    fetchTestDataStatus(savedProject)
  }, [])

  const handleSimulatorUrlChange = useCallback((newUrl: string) => {
    const cleanUrl = newUrl.trim()
    if (!cleanUrl) return

    setTargetUrl(cleanUrl)
    localStorage.setItem("ai_target_app_url", cleanUrl)

    // Update only the shared session URL. Discovered screens keep their own routes.
    setCurrentJob((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        currentUrl: cleanUrl,
        targetUrl: cleanUrl,
        fullAppTestPlan: prev.fullAppTestPlan
          ? { ...prev.fullAppTestPlan, targetUrl: cleanUrl }
          : prev.fullAppTestPlan,
      }
    })

    const activeJob = currentJob
    if (activeJob?.id && (activeJob.status === "running" || activeJob.status === "queued")) {
      void fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.id, action: "navigate_session", url: cleanUrl }),
      })
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || "Failed to navigate the active testing session.")
          if (data.job) setCurrentJob(data.job)
        })
        .catch((err) => setBotError(err?.message || "Failed to synchronize session navigation."))
    }
  }, [currentJob?.id, currentJob?.status])

  // Laya fast health checker (runs only if explicitly enabled)
  useEffect(() => {
    if (!enableLaya) {
      setIsLayaLive(false)
      return
    }
    let active = true
    const checkLaya = async () => {
      try {
        const res = await fetch(`/api/ai-automation/laya-health?baseUrl=${encodeURIComponent(layaBaseUrl)}`)
        if (!res || !res.ok) {
          if (active) setIsLayaLive(false)
          return
        }
        const data = await res.json().catch(() => null)
        if (active) setIsLayaLive(Boolean(data?.live))
      } catch (err: any) {
        if (err?.name === "AbortError") return
        if (active) setIsLayaLive(false)
      }
    }
    void checkLaya()
    const intervalTimer = setInterval(() => {
      void checkLaya()
    }, 15000)
    return () => {
      active = false
      clearInterval(intervalTimer)
    }
  }, [enableLaya, layaBaseUrl])

  // AI Agent Chat Command Center State (Focused Chat & AI Config Dock)
  const [activeDockTab, setActiveDockTab] = useState<"chat" | "config">("chat")
  const [isTestingAiConnection, setIsTestingAiConnection] = useState(false)
  const [aiConnectionTestResult, setAiConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<"account" | "integrations">("account")
  const activityProfileRef = useRef<HTMLDivElement>(null)
  const [chatInput, setChatInput] = useState("")
  const [commandQueue, setCommandQueue] = useState<Array<{ id: string; text: string; image?: string }>>([])
  const [attachedImage, setAttachedImage] = useState<string | null>(null)
  const [imagePreviewModal, setImagePreviewModal] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatHistory, setChatHistory] = useState<AgentChatMessage[]>([
    {
      id: "welcome-msg",
      sender: "agent",
      text: "Hello! I am your Vision Testing Bot. Give me a command (e.g. 'Test signup page'), attach an image, or click 'Capture Live Screen' to formulate an AI Thinking Model, generate a UI test checklist, and execute the tests.",
      timestamp: new Date().toISOString(),
      status: "completed",
    },
  ])

  // Sync chat messages from current running job
  useEffect(() => {
    if (!currentJob?.messages || currentJob.messages.length === 0) return

    setChatHistory((prev) => {
      const agentJobMsgs = currentJob.messages!.filter((m) => m.sender === "agent")
      if (agentJobMsgs.length === 0) return prev
      const latestAgentMsg = agentJobMsgs[agentJobMsgs.length - 1]

      // Replace any optimistic pending agent placeholder
      const pendingIdx = prev.findIndex(
        (m) =>
          m.id.startsWith("agent-pending-") ||
          (m.sender === "agent" && m.status === "thinking" && m.id.startsWith("agent-"))
      )
      if (pendingIdx !== -1) {
        const next = [...prev]
        next[pendingIdx] = { ...latestAgentMsg }
        return next
      }

      // Update existing agent message in place if status, text, checklist, or thinkingModel changed
      const existingIdx = prev.findIndex((m) => m.id === latestAgentMsg.id)
      if (existingIdx !== -1) {
        const prevMsg = prev[existingIdx]
        const checklistDirty =
          JSON.stringify(prevMsg.checklist?.map((c) => ({ id: c.id, s: c.status }))) !==
          JSON.stringify(latestAgentMsg.checklist?.map((c) => ({ id: c.id, s: c.status })))
        const thinkingDirty =
          JSON.stringify(prevMsg.thinkingModel) !== JSON.stringify(latestAgentMsg.thinkingModel)

        if (
          prevMsg.text !== latestAgentMsg.text ||
          prevMsg.status !== latestAgentMsg.status ||
          checklistDirty ||
          thinkingDirty
        ) {
          const next = [...prev]
          next[existingIdx] = { ...latestAgentMsg }
          return next
        }
        return prev
      }

      return [...prev, latestAgentMsg]
    })
  }, [currentJob?.messages])

  const terminalRef = useRef<HTMLDivElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [chatHistory.length])

  // Send natural language testing command to browser agent
  const handleSendChatCommand = async (cmdText?: string, imageOverride?: string, fromQueue = false, targetUrlOverride?: string) => {
    const textToSend = (cmdText || chatInput).trim()
    const imageToSend = imageOverride || attachedImage
    if ((!textToSend && !imageToSend) || isSendingChat) return

    // Job paused at a login wall: treat the reply as credentials (or "skip")
    if (!fromQueue && currentJob?.authState === "awaiting_credentials" && currentJob.id && textToSend) {
      const skip = /^\s*skip\b/i.test(textToSend)
      const pwMatch = textToSend.match(/(?:password|pass|pwd)\s*[:=]?\s*(\S+)/i)
      const userMatch = textToSend.match(/(?:e-?mail|username|user|login)\s*[:=]?\s*(\S+)/i)
      const emailOnlyMatch = textToSend.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)

      let username = userMatch?.[1] || (emailOnlyMatch ? emailOnlyMatch[0] : undefined)
      let password = pwMatch?.[1]
      if (!skip && !username && !password) {
        const parts = textToSend.split(/[\s,;/|:]+/).filter(Boolean)
        if (parts.length === 2) [username, password] = parts
        else if (parts.length === 1 && parts[0].includes("@")) username = parts[0]
      }
      const now = Date.now()
      if (!skip && !username) {
        setChatHistory((prev) => [
          ...prev,
          { id: `user-${now}`, sender: "user", text: textToSend.replace(/(pass(?:word)?|pwd)\s*[:=]?\s*\S+/i, "$1: ****"), timestamp: new Date().toISOString(), status: "completed" },
          { id: `agent-${now}`, sender: "agent", text: "Please enter your email (e.g. `you@example.com`) or `email: you@example.com password: yourpass`, or type `skip` to test without logging in.", timestamp: new Date().toISOString(), status: "completed" },
        ])
        setChatInput("")
        return
      }
      setChatInput("")
      const displayLabel = skip
        ? "skip"
        : password
        ? `email: ${username} password: ****`
        : `email: ${username}`
      const botResponse = skip
        ? "Skipping login. Mapping only the public screens."
        : password
        ? "Got credentials. Typing details into the login form and continuing."
        : `Using email: ${username}. Continuing test execution.`

      setChatHistory((prev) => [
        ...prev,
        { id: `user-${now}`, sender: "user", text: displayLabel, timestamp: new Date().toISOString(), status: "completed" },
        { id: `agent-${now}`, sender: "agent", text: botResponse, timestamp: new Date().toISOString(), status: "completed" },
      ])
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          skip
            ? { jobId: currentJob.id, action: "skip_auth" }
            : { jobId: currentJob.id, action: "provide_credentials", username, password: password || "" }
        ),
      }).catch(() => {})
      return
    }

    // Job paused at an external verification wall: treat reply as confirmation / code / url / skip
    if (!fromQueue && currentJob?.verificationState === "awaiting_verification" && currentJob.id && textToSend) {
      const skip = /^\s*skip\b/i.test(textToSend)
      const urlMatch = textToSend.match(/https?:\/\/[^\s]+/i)
      const codeMatch = textToSend.match(/\b\d{4,8}\b/)
      const now = Date.now()

      setChatInput("")
      setChatHistory((prev) => [
        ...prev,
        { id: `user-${now}`, sender: "user", text: textToSend, timestamp: new Date().toISOString(), status: "completed" },
        { id: `agent-${now}`, sender: "agent", text: skip ? "Skipping external verification. Continuing with public exploration." : "Received verification confirmation. Resuming testing from where it left off...", timestamp: new Date().toISOString(), status: "completed" },
      ])

      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          skip
            ? { jobId: currentJob.id, action: "skip_verification" }
            : {
                jobId: currentJob.id,
                action: "confirm_verification",
                verificationUrl: urlMatch?.[0],
                verificationCode: codeMatch?.[0],
              }
        ),
      }).catch(() => {})
      return
    }

    // Job paused at application settings credentials wall: treat 'skip'
    if (!fromQueue && currentJob?.settingsState === "awaiting_credentials" && currentJob.id && textToSend) {
      const skip = /^\s*skip\b/i.test(textToSend)
      if (skip) {
        const now = Date.now()
        setChatInput("")
        setChatHistory((prev) => [
          ...prev,
          { id: `user-${now}`, sender: "user", text: "skip", timestamp: new Date().toISOString(), status: "completed" },
          { id: `agent-${now}`, sender: "agent", text: "Skipping settings credentials configuration.", timestamp: new Date().toISOString(), status: "completed" },
        ])
        await fetch("/api/ai-automation/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: currentJob.id, action: "skip_settings_credentials" }),
        }).catch(() => {})
        return
      }
    }

    // Deliver user input to the active session instead of creating a competing job.
    if (!fromQueue && currentJob?.id && (currentJob.status === "running" || currentJob.status === "queued")) {
      const timestamp = new Date().toISOString()
      const inputId = `user-session-${currentJob.id}-${Date.now()}`
      setChatHistory((prev) => [...prev, {
        id: inputId,
        sender: "user",
        text: textToSend,
        timestamp,
        status: "completed",
        imageUrl: imageToSend || undefined,
      }])
      setChatInput("")
      setAttachedImage(null)
      try {
        const res = await fetch("/api/ai-automation/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: currentJob.id, action: "session_input", text: textToSend }),
        })
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || "The active session could not receive this input.")
        if (data.job) setCurrentJob(data.job)
      } catch (err: any) {
        setBotError(err?.message || "Failed to deliver input to the active session.")
        setChatHistory((prev) => [...prev, {
          id: `agent-session-input-error-${Date.now()}`,
          sender: "agent",
          text: err?.message || "Failed to deliver input to the active session.",
          timestamp: new Date().toISOString(),
          status: "error",
        }])
      }
      return
    }

    setChatInput("")
    setAttachedImage(null)
    setIsSendingChat(true)
    setBotError("")

    const effectiveText =
      textToSend ||
      "Analyze screen image, understand what it should do, write down possible UI tests as a thinking model, make a checklist, and perform the test"

    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: effectiveText,
      timestamp: new Date().toISOString(),
      status: "completed",
      imageUrl: imageToSend || undefined,
    }
    const agentThinkingMsg: AgentChatMessage = {
      id: `agent-pending-${Date.now()}`,
      sender: "agent",
      text: `Processing: "${effectiveText.slice(0, 60)}"... Analyzing visual layout, generating Thinking Model & UI Checklist.`,
      timestamp: new Date().toISOString(),
      status: "thinking",
    }

    setChatHistory((prev) => [...prev, userMsg, agentThinkingMsg])

    try {
      const res = await fetch("/api/ai-automation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: effectiveText,
          image: imageToSend || undefined,
          targetUrl: (targetUrlOverride || targetUrl).trim() || "http://localhost:3001",
          projectId: activeProject.id,
          projectDir: selectedProjectDir,
          credentials:
            username || password
              ? { username: username.trim(), password: password.trim() }
              : undefined,
          aiApiKey:
            aiProvider === "nebius"
              ? nebiusApiKey.trim() || undefined
              : aiProvider === "omnirouter"
              ? omniRouterKey.trim() || undefined
              : undefined,
          aiModel:
            aiProvider === "omnirouter"
              ? omniRouterModel.trim() || "deepseek-v4-flash:free"
              : selectedAiModel,
          aiBaseUrl:
            aiProvider === "local"
              ? localAiBaseUrl.trim()
              : aiProvider === "omnirouter"
              ? omniRouterBaseUrl.trim() || "https://api.unorouter.com/v1"
              : "https://api.tokenfactory.nebius.com/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to execute chat command.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)

      const statusRes = await fetch(`/api/ai-automation/status?jobId=${data.jobId}`)
      const statusData = await statusRes.json()
      if (statusData?.job) {
        setCurrentJob(statusData.job)
      }
    } catch (err: any) {
      setBotError(err?.message || "Failed to process chat command.")
      setChatHistory((prev) =>
        prev.map((m) =>
          m.id === agentThinkingMsg.id
            ? { ...m, text: `⚠️ Execution notice: ${err?.message}`, status: "error" }
            : m
        )
      )
    } finally {
      setIsSendingChat(false)
    }
  }

  // Tell the user in chat when the run is blocked by a login screen
  useEffect(() => {
    if (currentJob?.authState !== "awaiting_credentials" || !currentJob.id) return
    const msgId = `auth-prompt-${currentJob.id}-${currentJob.authPrompt || ""}`
    setChatHistory((prev) =>
      prev.some((m) => m.id === msgId)
        ? prev
        : [
            ...prev,
            {
              id: msgId,
              sender: "agent",
              text:
                "🔒 I hit a login screen and can't go further without a test account. Type the user's details here, like `email: you@example.com password: yourpass`, or enter them in the Full App tab. Type `skip` to continue without logging in.",
              timestamp: new Date().toISOString(),
              status: "completed",
            },
          ]
    )
    setActiveDockTab("chat")
  }, [currentJob?.authState, currentJob?.authPrompt, currentJob?.id])

  // Tell user in chat when external email verification is required
  useEffect(() => {
    if (currentJob?.verificationState !== "awaiting_verification" || !currentJob.id) return
    const msgId = `verification-prompt-${currentJob.id}-${currentJob.verificationPrompt || ""}`
    setChatHistory((prev) =>
      prev.some((m) => m.id === msgId)
        ? prev
        : [
            ...prev,
            {
              id: msgId,
              sender: "agent",
              text:
                "📬 External Verification Required: The application sent an email confirmation or verification link. Please check your email and click the confirmation link, paste the URL below, or enter your OTP code. When ready, click 'I\\'ve Completed Verification' or type 'done'. Type 'skip' to bypass.",
              timestamp: new Date().toISOString(),
              status: "completed",
            },
          ]
    )
    setActiveDockTab("chat")
  }, [currentJob?.verificationState, currentJob?.verificationPrompt, currentJob?.id])

  // Tell user in chat when application settings credentials are required
  useEffect(() => {
    if (currentJob?.settingsState !== "awaiting_credentials" || !currentJob.id) return
    const msgId = `settings-prompt-${currentJob.id}-${currentJob.settingsPrompt || ""}`
    setChatHistory((prev) =>
      prev.some((m) => m.id === msgId)
        ? prev
        : [
            ...prev,
            {
              id: msgId,
              sender: "agent",
              text:
                "🔐 Application Settings Credentials Required: The application requires API keys or configuration secrets to proceed. Please enter them in the secure input card below. Secrets are never logged or stored in reports. Type 'skip' to bypass.",
              timestamp: new Date().toISOString(),
              status: "completed",
            },
          ]
    )
  }, [currentJob?.settingsState, currentJob?.settingsPrompt, currentJob?.id])

  const handleConfirmVerification = async (url?: string, code?: string) => {
    if (!currentJob?.id || isSubmittingVerification) return
    setIsSubmittingVerification(true)
    try {
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: currentJob.id,
          action: "confirm_verification",
          verificationUrl: url || verificationUrlInput.trim() || undefined,
          verificationCode: code || verificationCodeInput.trim() || undefined,
        }),
      })
      setVerificationUrlInput("")
      setVerificationCodeInput("")
    } catch (err) {
      console.error("Failed to confirm verification:", err)
    } finally {
      setIsSubmittingVerification(false)
    }
  }

  const handleSkipVerification = async () => {
    if (!currentJob?.id || isSubmittingVerification) return
    setIsSubmittingVerification(true)
    try {
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: currentJob.id,
          action: "skip_verification",
        }),
      })
      setVerificationUrlInput("")
      setVerificationCodeInput("")
    } catch (err) {
      console.error("Failed to skip verification:", err)
    } finally {
      setIsSubmittingVerification(false)
    }
  }

  const handleSaveSettingsCredentials = async () => {
    if (!currentJob?.id || isSubmittingSettings) return
    setIsSubmittingSettings(true)
    try {
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: currentJob.id,
          action: "provide_settings_credentials",
          credentials: settingsFormValues,
        }),
      })
      setSettingsFormValues({})
    } catch (err) {
      console.error("Failed to save settings credentials:", err)
    } finally {
      setIsSubmittingSettings(false)
    }
  }

  const handleSkipSettingsCredentials = async () => {
    if (!currentJob?.id || isSubmittingSettings) return
    setIsSubmittingSettings(true)
    try {
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: currentJob.id,
          action: "skip_settings_credentials",
        }),
      })
      setSettingsFormValues({})
    } catch (err) {
      console.error("Failed to skip settings credentials:", err)
    } finally {
      setIsSubmittingSettings(false)
    }
  }

  const handleUnblockWorkflows = async (options: {
    mode: "synthetic_data" | "credentials" | "retry" | "skip"
    username?: string
    password?: string
    screenId?: string
  }) => {
    if (!currentJob?.id) return
    try {
      const res = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: currentJob.id,
          action: "unblock_workflows",
          ...options,
        }),
      })
      const data = await res.json()
      if (data.job) {
        setCurrentJob(data.job)
      }
    } catch (err) {
      console.error("Failed to unblock workflows:", err)
    }
  }

  // Drain queued messages one at a time once the running job has finished
  useEffect(() => {
    const st = currentJob?.status
    if (commandQueue.length === 0 || isSendingChat) return
    if (st === "running" || st === "queued") return
    const [next, ...rest] = commandQueue
    setCommandQueue(rest)
    handleSendChatCommand(next.text, next.image, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentJob?.status, commandQueue, isSendingChat])

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAttachedImage(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  const handleCaptureCurrentScreen = async () => {
    if (isSendingChat) return
    handleSendChatCommand(
      "Capture this screen image, understand what it should do, write down possible UI tests as a thinking model, make a checklist, and perform the tests",
      currentJob?.currentScreenshotUrl || undefined
    )
  }

  // Auto-scroll terminal on new logs
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [currentJob?.logs?.length])

  // Load saved AI preferences from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem("nebius_api_key")
    if (savedKey) setNebiusApiKey(savedKey)
    const savedModel = localStorage.getItem("nebius_selected_model")
    if (savedModel) setSelectedAiModel(savedModel)
    const savedProvider = localStorage.getItem("ai_selected_provider") as "nebius" | "omnirouter" | "local" | "cloud" | null
    if (savedProvider) setAiProvider(savedProvider === "cloud" ? "nebius" : savedProvider)
    if (savedProvider === "cloud" && !savedModel?.toLowerCase().includes("nemotron")) setSelectedAiModel("nvidia/Nemotron-3-Nano-Omni")
    const savedBaseUrl = localStorage.getItem("ai_local_base_url")
    if (savedBaseUrl) setLocalAiBaseUrl(savedBaseUrl)
    const savedOmniUrl = localStorage.getItem("omnirouter_base_url")
    if (savedOmniUrl) setOmniRouterBaseUrl(savedOmniUrl)
    const savedOmniKey = localStorage.getItem("omnirouter_api_key")
    if (savedOmniKey) setOmniRouterKey(savedOmniKey)
    const savedOmniModel = localStorage.getItem("omnirouter_model")
    if (savedOmniModel) setOmniRouterModel(savedOmniModel)
    const savedEnableLaya = localStorage.getItem("enable_laya_reflexes")
    if (savedEnableLaya !== null) setEnableLaya(savedEnableLaya === "true")
    const savedLayaUrl = localStorage.getItem("laya_base_url")
    if (savedLayaUrl && !savedLayaUrl.includes("8001") && !savedLayaUrl.includes("8085")) {
      setLayaBaseUrl(savedLayaUrl)
    } else {
      setLayaBaseUrl("http://127.0.0.1:8000")
    }
  }, [])

  const handleUpdateNebiusApiKey = (key: string) => {
    setNebiusApiKey(key)
    localStorage.setItem("nebius_api_key", key)
  }

  const handleUpdateAiModel = (model: string) => {
    setSelectedAiModel(model)
    localStorage.setItem("nebius_selected_model", model)
  }

  const handleUpdateAiProvider = (provider: "nebius" | "omnirouter" | "local") => {
    setAiProvider(provider)
    localStorage.setItem("ai_selected_provider", provider)
    if (provider === "local" && (selectedAiModel.includes("google") || selectedAiModel.toLowerCase().includes("nemotron"))) {
      setSelectedAiModel("llama3.2-vision")
    } else if (provider === "nebius" && !selectedAiModel.toLowerCase().includes("nemotron")) {
      setSelectedAiModel("nvidia/Nemotron-3-Nano-Omni")
    }
  }

  const handleUpdateLocalBaseUrl = (url: string) => {
    setLocalAiBaseUrl(url)
    localStorage.setItem("ai_local_base_url", url)
  }

  const handleUpdateOmniRouterUrl = (url: string) => {
    setOmniRouterBaseUrl(url)
    localStorage.setItem("omnirouter_base_url", url)
  }

  const handleUpdateOmniRouterKey = (key: string) => {
    setOmniRouterKey(key)
    localStorage.setItem("omnirouter_api_key", key)
  }

  const handleUpdateOmniRouterModel = (model: string) => {
    setOmniRouterModel(model)
    localStorage.setItem("omnirouter_model", model)
  }

  const handleToggleLaya = (enabled: boolean) => {
    setEnableLaya(enabled)
    localStorage.setItem("enable_laya_reflexes", String(enabled))
  }

  const handleUpdateLayaUrl = (url: string) => {
    setLayaBaseUrl(url)
    localStorage.setItem("laya_base_url", url)
  }

  // Theme initialization
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null
    if (saved) {
      setTheme(saved)
      document.documentElement.classList.toggle("dark", saved === "dark")
    } else {
      document.documentElement.classList.add("dark")
    }
  }, [])

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("theme", next)
    document.documentElement.classList.toggle("dark", next === "dark")
  }

  // Close profile dropdown on outside click or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (activityProfileRef.current && !activityProfileRef.current.contains(target)) {
        setIsProfileMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsProfileMenuOpen(false)
      }
    }
    if (isProfileMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isProfileMenuOpen])

  // Test live connection to the active AI Provider
  const handleTestAiConnection = async () => {
    setIsTestingAiConnection(true)
    setAiConnectionTestResult(null)
    try {
      if (aiProvider === "nebius") {
        if (!nebiusApiKey.trim()) {
          setAiConnectionTestResult({ success: false, message: "Nebius Token Factory API key is missing. Enter your key below." })
          return
        }
        const res = await fetch("https://api.tokenfactory.nebius.com/v1/models", {
          headers: { Authorization: `Bearer ${nebiusApiKey.trim()}` }
        })
        if (res.ok) {
          const data = await res.json()
          const count = Array.isArray(data?.data) ? data.data.length : undefined
          setAiConnectionTestResult({ success: true, message: `Connected to Nebius Token Factory${count === undefined ? "" : ` — ${count} models available`}.` })
        } else {
          setAiConnectionTestResult({ success: false, message: `Nebius Token Factory returned HTTP ${res.status}. Check the API key and model access.` })
        }
      } else if (aiProvider === "omnirouter") {
        const url = omniRouterBaseUrl.trim().replace(/\/+$/, "")
        const res = await fetch(`${url}/models`, {
          headers: omniRouterKey.trim() ? { Authorization: `Bearer ${omniRouterKey.trim()}` } : {}
        })
        if (res.ok) {
          setAiConnectionTestResult({ success: true, message: `Connected to OmniRouter gateway at ${url}!` })
        } else {
          setAiConnectionTestResult({ success: false, message: `OmniRouter gateway responded with HTTP ${res.status}.` })
        }
      } else {
        const url = localAiBaseUrl.trim().replace(/\/v1\/?$/, "")
        const res = await fetch(`${url}/api/tags`).catch(() => fetch(`${localAiBaseUrl.trim().replace(/\/+$/, "")}/models`))
        if (res.ok) {
          setAiConnectionTestResult({ success: true, message: `Connected to local Ollama at ${localAiBaseUrl}!` })
        } else {
          setAiConnectionTestResult({ success: false, message: `Could not reach Ollama at ${localAiBaseUrl}. Ensure Ollama is running.` })
        }
      }
    } catch (err: any) {
      setAiConnectionTestResult({ success: false, message: `Connection error: ${err.message || "Failed to reach host"}` })
    } finally {
      setIsTestingAiConnection(false)
    }
  }

  // Require a valid Supabase session before rendering the simulator.
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!mounted) return
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email })
        setAuthLoading(false)
      } else {
        setUser(null)
        window.location.replace("/")
      }
    }).catch(() => {
      if (mounted) window.location.replace("/")
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email })
        setAuthLoading(false)
      } else {
        setUser(null)
        window.location.replace("/")
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase.auth])

  // Load projects from database (silent refresh prevents tearing down the screen)
  const loadWorkspace = useCallback(async (showFullLoader = false) => {
    if (showFullLoader && projects.length === 0) setLoading(true)
    try {
      const fetchPromise = supabase
        .from("projects")
        .select("id,title,is_expanded,user_id,figma_url,workflow_order,is_order_locked")
        .order("created_at", { ascending: true })

      const timeoutPromise = new Promise<{ data: null; error: any }>((_, reject) =>
        setTimeout(() => reject(new Error("Supabase timeout")), 3000)
      )

      const { data: ps, error: pError } = (await Promise.race([fetchPromise, timeoutPromise])) as any

      if (pError || !ps || ps.length === 0) {
        setProjects([DEFAULT_AI_PROJECT])
        setActiveProjectId(DEFAULT_AI_PROJECT.id)
        setLoading(false)
        return
      }

      const ids = (ps as ProjectRow[]).map((p) => p.id)
      const [{ data: ws }, { data: cs }, { data: revs }] = await Promise.all([
        supabase
          .from("workflows")
          .select("id,project_id,title,design_a,design_b,figma_url,our_notes,client_message,client_task_done,reason,is_done,created_at")
          .in("project_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .order("created_at", { ascending: true }),
        supabase
          .from("workflow_comments")
          .select("id,workflow_id,author_id,body,reason,created_at"),
        supabase
          .from("workflow_revisions")
          .select("id,project_id,workflow_id,revision_number,author_id,author_email,author_role,reason,design_a,design_b,created_at")
          .in("project_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .order("revision_number", { ascending: false }),
      ])

      const mapped: Project[] = (ps as ProjectRow[]).map((p) => {
        const pWorkflows: Workflow[] = ((ws || []) as WorkflowRow[])
          .filter((w) => w.project_id === p.id)
          .map((w) => ({
            id: w.id,
            projectId: w.project_id,
            title: w.title,
            designA: w.design_a,
            designB: w.design_b,
            figmaUrl: w.figma_url || null,
            ourNotes: w.our_notes || "",
            clientMessage: w.client_message || "",
            clientTaskDone: Boolean(w.client_task_done),
            reason: w.reason || "",
            isDone: Boolean(w.is_done),
            comments: ((cs || []) as CommentRow[])
              .filter((c) => c.workflow_id === w.id)
              .map((c) => ({
                id: c.id,
                workflowId: c.workflow_id,
                authorId: c.author_id,
                authorEmail: c.author_email,
                body: c.body,
                reason: c.reason || undefined,
                createdAt: c.created_at,
              })),
            revisions: ((revs || []) as RevisionRow[])
              .filter((r) => r.workflow_id === w.id)
              .map((r) => ({
                id: r.id,
                workflowId: r.workflow_id,
                revisionNumber: r.revision_number,
                authorId: r.author_id,
                authorEmail: r.author_email,
                authorRole: r.author_role as any,
                reason: r.reason,
                designA: r.design_a,
                designB: r.design_b,
                createdAt: r.created_at,
              })),
          }))

        return {
          id: p.id,
          title: p.title,
          isExpanded: p.is_expanded,
          userId: p.user_id,
          figmaUrl: p.figma_url || null,
          workflowOrder: p.workflow_order || null,
          isOrderLocked: Boolean(p.is_order_locked),
          workflows: pWorkflows,
        }
      })

      setProjects(mapped.length ? mapped : [DEFAULT_AI_PROJECT])
      setActiveProjectId((prev) => (prev && mapped.some((p) => p.id === prev) ? prev : mapped[0]?.id || DEFAULT_AI_PROJECT.id))
    } catch {
      setProjects([DEFAULT_AI_PROJECT])
      setActiveProjectId(DEFAULT_AI_PROJECT.id)
    } finally {
      setLoading(false)
    }
  }, [supabase, projects.length])

  useEffect(() => {
    loadWorkspace(false)
  }, [loadWorkspace])

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === activeProjectId) || projects[0] || DEFAULT_AI_PROJECT
  }, [projects, activeProjectId])

  // Resume previous background job from localStorage if present
  useEffect(() => {
    const savedJobId = localStorage.getItem("ai_automation_last_job_id")
    if (savedJobId) {
      fetch(`/api/ai-automation/status?jobId=${savedJobId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.success && data.job) {
            setCurrentJob(data.job)
          }
        })
        .catch(() => {})
    }
  }, [])

  // Poll job status while running or queued
  useEffect(() => {
    if (!currentJob?.id || (currentJob.status !== "running" && currentJob.status !== "queued")) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai-automation/status?jobId=${currentJob.id}`)
        const data = await res.json()
        if (data?.success && data.job) {
          setCurrentJob(data.job)
          if (data.job.status === "completed" || data.job.status === "failed" || data.job.status === "stopped") {
            clearInterval(interval)
            // Reload project workspace silently in the background without screen flicker
            loadWorkspace(false)
          }
        }
      } catch (err) {
        console.warn("Polling error:", err)
      }
    }, 1500)

    return () => clearInterval(interval)
  }, [currentJob?.id, currentJob?.status, loadWorkspace])

  // The shared session event stream feeds chat progress; sequence IDs prevent
  // duplicate messages when the status poll returns the same event history.
  useEffect(() => {
    const job = currentJob
    if (!job?.sessionEvents?.length) return
    const sessionId = job.sessionId || job.id
    const lastSeen = lastSessionEventSequenceRef.current[sessionId] || 0
    const freshEvents = job.sessionEvents.filter((event) => event.sequence > lastSeen)
    if (freshEvents.length === 0) return
    lastSessionEventSequenceRef.current[sessionId] = Math.max(...freshEvents.map((event) => event.sequence))

    const visibleEvents = freshEvents.filter((event) =>
      ["session_started", "navigation_requested", "navigation_completed", "screen_discovered", "browser_action", "test_result", "progress", "recording", "evidence", "error", "session_stopped"].includes(event.type)
    )
    if (visibleEvents.length === 0) return
    setChatHistory((prev) => {
      const seen = new Set(prev.map((message) => message.id))
      const additions = visibleEvents
        .filter((event) => !seen.has(`session-event-${event.id}`) && event.message)
        .map((event) => ({
          id: `session-event-${event.id}`,
          sender: "agent" as const,
          text: event.message || "",
          timestamp: event.timestamp,
          status: (event.type === "error" ? "error" : "completed") as AgentChatMessage["status"],
        }))
      return additions.length ? [...prev, ...additions] : prev
    })
  }, [currentJob?.id, currentJob?.sessionEvents])

  // Reflect backend browser navigation in the visible simulator as well as the map/chat.
  useEffect(() => {
    const sessionUrl = currentJob?.currentUrl
    if (!sessionUrl || sessionUrl === targetUrl) return
    setTargetUrl(sessionUrl)
    localStorage.setItem("ai_target_app_url", sessionUrl)
  }, [currentJob?.currentUrl, targetUrl])

  // Chronological action history (from first step to latest)
  const chronologicalActions = useMemo(() => {
    if (!currentJob?.actionHistory) return []
    return [...currentJob.actionHistory].reverse()
  }, [currentJob?.actionHistory])

  // Active step (either explicitly selected action or live current action)
  const activeAction = useMemo(() => {
    if (selectedActionId) {
      return currentJob?.actionHistory?.find((a) => a.id === selectedActionId) || currentJob?.currentAction
    }
    return currentJob?.currentAction
  }, [selectedActionId, currentJob?.actionHistory, currentJob?.currentAction])

  const activeActionIndex = useMemo(() => {
    if (!activeAction || chronologicalActions.length === 0) return -1
    return chronologicalActions.findIndex((a) => a.id === activeAction.id)
  }, [activeAction, chronologicalActions])

  // Auto-replay trajectory timer
  useEffect(() => {
    if (!isPlayingReplay || chronologicalActions.length === 0) return

    let nextIdx = activeActionIndex + 1
    if (nextIdx >= chronologicalActions.length) {
      nextIdx = 0
    }

    const timer = setTimeout(() => {
      setSelectedActionId(chronologicalActions[nextIdx].id)
      if (nextIdx === chronologicalActions.length - 1) {
        setIsPlayingReplay(false)
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [isPlayingReplay, activeActionIndex, chronologicalActions])

  // DYNAMIC LIVE LINK: Automatically map live audited screens & active browser feed into simulator
  const mergedSimulatorProject = useMemo(() => {
    const existingIds = new Set(activeProject.workflows.map((w) => w.id))
    const dynamicWorkflows: Workflow[] = []

    // 1. If an action is selected, inject it as the focused screen!
    if (selectedActionId && activeAction?.screenshotUrl) {
      dynamicWorkflows.push({
        id: `action-step-${activeAction.id}`,
        projectId: activeProject.id,
        title: `[Step ${activeActionIndex + 1}/${chronologicalActions.length}] ${activeAction.type.toUpperCase()}: ${activeAction.description}`,
        designA: null,
        designB: activeAction.screenshotUrl,
        figmaUrl: null,
        ourNotes: `[Antigravity Agent Execution]\nType: ${activeAction.type.toUpperCase()}\nThought: ${activeAction.thought || ""}\nObservation: ${activeAction.observation || ""}\nTarget: ${activeAction.target || "Screen"}\nCoordinates: ${activeAction.coordinates ? `x: ${activeAction.coordinates.x}, y: ${activeAction.coordinates.y}` : "N/A"}\nStatus: ${(activeAction.status || "PASSED").toUpperCase()}`,
        clientMessage: activeAction.thought || "Antigravity Browser Agent test step.",
        clientTaskDone: activeAction.status !== "failed",
        reason: activeAction.description,
        isDone: activeAction.status !== "failed",
        comments: [],
        revisions: [],
      })
    }
    // 2. Otherwise if bot captured a screenshot, stream live action feed
    else if (currentJob?.currentScreenshotUrl) {
      dynamicWorkflows.push({
        id: "live-bot-action-feed",
        projectId: activeProject.id,
        title:
          currentJob.status === "running"
            ? `🔴 LIVE: ${currentJob.currentAction?.description || "Agent Browser Control"}`
            : `📸 Latest Capture: ${currentJob.currentAction?.description || "Agent Step"}`,
        designA: null,
        designB: currentJob.currentScreenshotUrl,
        figmaUrl: null,
        ourNotes: `[Live Agent Execution]\nAction: ${currentJob.currentAction?.type.toUpperCase() || "NAVIGATE"}\nThought: ${currentJob.currentAction?.thought || "Testing responsive elements & back navigation"}\nTarget: ${currentJob.currentAction?.target || "Screen"}\nCoordinates: ${currentJob.currentAction?.coordinates ? `x: ${currentJob.currentAction.coordinates.x}, y: ${currentJob.currentAction.coordinates.y}` : "N/A"}`,
        clientMessage: "Google Antigravity-style live browser control stream.",
        clientTaskDone: false,
        reason: currentJob.currentStep,
        isDone: false,
        comments: [],
        revisions: [],
      })
    }

    if (currentJob?.screens) {
      for (let i = 0; i < currentJob.screens.length; i++) {
        const s = currentJob.screens[i]
        const wfId = s.workflowId || `bot-screen-${i}`
        if (!existingIds.has(wfId)) {
          dynamicWorkflows.push({
            id: wfId,
            projectId: activeProject.id,
            title: s.title || `Screen ${i + 1}`,
            designA: null,
            designB: s.screenshotUrl || null,
            figmaUrl: null,
            ourNotes: `[AI UI Automation Test]\nTarget URL: ${s.url}\nBack Navigation: ${s.backNavigationStatus.toUpperCase()}\nResponsive Checks: ${s.responsiveStatus.toUpperCase()}`,
            clientMessage: s.aiAnalysis?.summary || "Screen automatically verified by AI Bot.",
            clientTaskDone: s.issuesCount === 0,
            reason: s.issuesCount > 0 ? `${s.issuesCount} issues flagged` : "All tests passed cleanly",
            isDone: s.issuesCount === 0,
            comments: [],
            revisions: [],
          })
        }
      }
    }

    if (dynamicWorkflows.length === 0) return activeProject

    return {
      ...activeProject,
      workflows: [...dynamicWorkflows, ...activeProject.workflows],
    }
  }, [
    activeProject,
    currentJob?.screens,
    currentJob?.currentScreenshotUrl,
    currentJob?.currentAction,
    currentJob?.status,
    currentJob?.currentStep,
    selectedActionId,
    activeAction,
    activeActionIndex,
    chronologicalActions.length,
  ])

  // Automatically focus selected action step, live feed, or latest screen
  useEffect(() => {
    if (selectedActionId && activeAction) {
      setActiveWorkflowId(`action-step-${activeAction.id}`)
    } else if (currentJob?.status === "running") {
      setActiveWorkflowId("live-bot-action-feed")
    } else if (currentJob?.screens && currentJob.screens.length > 0) {
      const latestScreen = currentJob.screens[currentJob.screens.length - 1]
      const targetId = latestScreen.workflowId || `bot-screen-${currentJob.screens.length - 1}`
      if (
        targetId &&
        (activeWorkflowId === "live-bot-action-feed" ||
          !activeWorkflowId ||
          activeWorkflowId.startsWith("action-step-") ||
          activeWorkflowId.startsWith("wf-ai-"))
      ) {
        setActiveWorkflowId(targetId)
        setSelectedStepIndex(currentJob.screens.length - 1)
      }
    }
  }, [currentJob?.status, currentJob?.currentAction?.id, currentJob?.screens?.length, selectedActionId, activeAction])

  const openPreFlightModal = (mode: "full_app" | "feature_workflow") => {
    setPendingLaunchMode(mode)
    setShowPreFlightModal(true)
  }

  const handleExecutePreFlightLaunch = async () => {
    setShowPreFlightModal(false)
    if (pendingLaunchMode === "feature_workflow") {
      await handleStartWorkflowTesting(workflowPromptInput || "Test the primary user workflow")
    } else {
      await handleStartFullAppTesting()
    }
  }

  // Start Automation Run
  const handleStartAutomation = async () => {
    openPreFlightModal(testingMode)
  }

  // Start Full App Systematic Testing (Discover -> Map -> Plan -> Execute -> Report)
  const handleStartFullAppTesting = async (
    dummyTestFiles?: Record<string, { name: string; url: string; type: string }>,
    credentialsOverride?: { username?: string; password?: string }
  ) => {
    setBotError("")
    if (!targetUrl.trim()) {
      setBotError("Please specify a target URL to test.")
      return
    }

    let savedLocalCreds: { username?: string; password?: string } | undefined
    try {
      const savedStr = typeof window !== "undefined" ? localStorage.getItem("simulator_auth_credentials") : null
      if (savedStr) {
        const parsed = JSON.parse(savedStr)
        if (parsed.username || parsed.password) {
          savedLocalCreds = {
            username: parsed.username?.trim() || "",
            password: parsed.password?.trim() || "",
          }
        }
      }
    } catch {}

    const effectiveCreds =
      credentialsOverride?.username || credentialsOverride?.password
        ? {
            username: credentialsOverride.username?.trim() || "",
            password: credentialsOverride.password?.trim() || "",
          }
        : username || password
        ? {
            username: username.trim(),
            password: password.trim(),
          }
        : savedLocalCreds

    if (credentialsOverride?.username) {
      setUsername(credentialsOverride.username)
      if (credentialsOverride.password) setPassword(credentialsOverride.password)
    } else if (savedLocalCreds?.username && !username) {
      setUsername(savedLocalCreds.username)
      if (savedLocalCreds.password && !password) setPassword(savedLocalCreds.password)
    }

    const postmanObj = postmanCollectionText.trim()
      ? (() => {
          try {
            return JSON.parse(postmanCollectionText)
          } catch {
            return postmanCollectionText.trim()
          }
        })()
      : undefined

    const effectiveAllowActions = allowDestructiveActions
      ? ["delete", "purge", "cancel", "archive", "remove"]
      : undefined

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/ai-automation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl.trim(),
          projectId: activeProject.id,
          projectDir: selectedProjectDir,
          mode: "full_app",
          viewports: [
            {
              name: "Active Simulator Viewport",
              width: simulatorViewport.width,
              height: simulatorViewport.height,
            },
          ],
          dummyTestFiles,
          uploadFilesDir: uploadFilesDir.trim() || undefined,
          postmanCollection: postmanObj,
          allowTestPayments,
          allowActions: effectiveAllowActions,
          recordVideo,
          role: journeyRole === "custom" ? customJourneyRole.trim() || "custom" : journeyRole,
          layaBaseUrl: enableLaya ? (layaBaseUrl.trim() || "http://127.0.0.1:8000") : undefined,
          credentials: effectiveCreds,
          maxScreens: Math.max(maxScreens, 8),
          checkBackNavigation: checkBackNav,
          checkResponsive,
          aiApiKey:
            aiProvider === "nebius"
              ? nebiusApiKey.trim() || undefined
              : aiProvider === "omnirouter"
              ? omniRouterKey.trim() || undefined
              : undefined,
          aiModel:
            aiProvider === "omnirouter"
              ? omniRouterModel.trim() || "deepseek-v4-flash:free"
              : selectedAiModel,
          aiBaseUrl:
            aiProvider === "local"
              ? localAiBaseUrl.trim()
              : aiProvider === "omnirouter"
              ? omniRouterBaseUrl.trim() || "https://api.unorouter.com/v1"
              : "https://api.tokenfactory.nebius.com/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start Full App Testing.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)
      setWorkspaceLayoutMode("stage")
      handleSelectWorkspaceTab("map")

      // Fetch immediately to load initial state
      const statusRes = await fetch(`/api/ai-automation/status?jobId=${data.jobId}`)
      const statusData = await statusRes.json()
      if (statusData?.job) {
        setCurrentJob(statusData.job)
      }
    } catch (err: any) {
      setBotError(err?.message || "Failed to initiate Full App Testing.")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Start Feature / Workflow Testing (Prompt -> Understand -> Targeted Discovery -> Focused Map -> Plan -> Execute -> Edge Cases -> Report)
  const handleStartWorkflowTesting = async (workflowPrompt?: string) => {
    // Saved role workflows pass their role in a tagged prompt. Prefer that role
    // over the global journey selector so the backend job metadata matches the flow.
    const taggedRole = workflowPrompt?.match(/\[User role:\s*([^\]]+)\]/i)?.[1]?.trim()
    const effectiveRole = taggedRole || (journeyRole === "custom" ? customJourneyRole.trim() || "custom" : journeyRole)
    setBotError("")
    if (!targetUrl.trim()) {
      setBotError("Please specify a target URL to test.")
      return
    }
    const promptText = (workflowPrompt || workflowPromptInput).trim()
    if (!promptText) {
      setBotError("Please describe the workflow or feature you would like to test.")
      return
    }

    const postmanObj = postmanCollectionText.trim()
      ? (() => {
          try {
            return JSON.parse(postmanCollectionText)
          } catch {
            return postmanCollectionText.trim()
          }
        })()
      : undefined

    const effectiveAllowActions = allowDestructiveActions
      ? ["delete", "purge", "cancel", "archive", "remove"]
      : undefined

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/ai-automation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl.trim(),
          projectId: activeProject.id,
          projectDir: selectedProjectDir,
          mode: "feature_workflow",
          workflowPrompt: promptText,
          viewports: [
            {
              name: "Active Simulator Viewport",
              width: simulatorViewport.width,
              height: simulatorViewport.height,
            },
          ],
          uploadFilesDir: uploadFilesDir.trim() || undefined,
          postmanCollection: postmanObj,
          allowTestPayments,
          allowActions: effectiveAllowActions,
          recordVideo,
          role: effectiveRole,
          layaBaseUrl: enableLaya ? (layaBaseUrl.trim() || "http://127.0.0.1:8000") : undefined,
          credentials: (() => {
            if (username || password) {
              return { username: username.trim(), password: password.trim() }
            }
            try {
              const savedStr = typeof window !== "undefined" ? localStorage.getItem("simulator_auth_credentials") : null
              if (savedStr) {
                const parsed = JSON.parse(savedStr)
                if (parsed.username || parsed.password) {
                  return { username: parsed.username?.trim() || "", password: parsed.password?.trim() || "" }
                }
              }
            } catch {}
            return undefined
          })(),
          maxScreens: Math.max(maxScreens, 6),
          checkBackNavigation: checkBackNav,
          checkResponsive,
          aiApiKey:
            aiProvider === "nebius"
              ? nebiusApiKey.trim() || undefined
              : aiProvider === "omnirouter"
              ? omniRouterKey.trim() || undefined
              : undefined,
          aiModel:
            aiProvider === "omnirouter"
              ? omniRouterModel.trim() || "deepseek-v4-flash:free"
              : selectedAiModel,
          aiBaseUrl:
            aiProvider === "local"
              ? localAiBaseUrl.trim()
              : aiProvider === "omnirouter"
              ? omniRouterBaseUrl.trim() || "https://api.unorouter.com/v1"
              : "https://api.tokenfactory.nebius.com/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start Feature / Workflow Testing.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)
      setTestingMode("feature_workflow")
      setWorkspaceLayoutMode("stage")
      handleSelectWorkspaceTab("plan")

      // Fetch immediately to load initial state
      const statusRes = await fetch(`/api/ai-automation/status?jobId=${data.jobId}`)
      const statusData = await statusRes.json()
      if (statusData?.job) {
        setCurrentJob(statusData.job)
      }
    } catch (err: any) {
      setBotError(err?.message || "Failed to initiate Feature / Workflow Testing.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRecordingControl = async (
    action: "pause_recording" | "resume_recording" | "stop_recording",
  ) => {
    if (!currentJob?.id) return
    try {
      const res = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJob.id, action }),
      })
      const data = await res.json()
      if (data?.job) setCurrentJob(data.job)
      else if (!res.ok) setBotError(data?.error || "Unable to change recording state")
    } catch (err: any) {
      setBotError(err?.message || "Unable to change recording state")
    }
  }

  // Stop Running Job
  const handleStopAutomation = async () => {
    if (!currentJob?.id) return
    try {
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: currentJob.id, action: "stop" }),
      })
      const res = await fetch(`/api/ai-automation/status?jobId=${currentJob.id}`)
      const data = await res.json()
      if (data?.job) setCurrentJob(data.job)
    } catch {}
  }

  const handleDownloadReport = () => {
    if (!currentJob) return
    const exportData = {
      jobId: currentJob.id,
      targetUrl: currentJob.targetUrl,
      startedAt: currentJob.startedAt,
      finishedAt: currentJob.finishedAt,
      status: currentJob.status,
      report: currentJob.report,
      screens: currentJob.screens,
      issues: currentJob.issues,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ui-automation-audit-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyReport = () => {
    if (!currentJob?.report) return
    const text = [
      `=== AI UI AUTOMATION AUDIT REPORT ===`,
      `Target URL: ${currentJob.targetUrl}`,
      `Total Screens: ${currentJob.report.totalScreensTested}`,
      `Back Navigation Fidelity: ${currentJob.report.backNavigationScore}%`,
      `Responsive Score: ${currentJob.report.responsiveScore}%`,
      `Total Issues Found: ${currentJob.report.totalIssues}`,
      ``,
      `Summary:`,
      currentJob.report.summary,
      ``,
      `Recommendations:`,
      ...currentJob.report.recommendations.map((r, i) => `${i + 1}. ${r}`),
    ].join("\n")

    navigator.clipboard.writeText(text)
    setCopiedReport(true)
    setTimeout(() => setCopiedReport(false), 2000)
  }

  const updateWorkflowField = useCallback(
    async (
      workflowId: string,
      field: "ourNotes" | "clientMessage" | "clientTaskDone" | "reason" | "figmaUrl" | "designA" | "designB",
      value: string | boolean | null
    ) => {
      setProjects((prev) =>
        prev.map((p) => ({
          ...p,
          workflows: p.workflows.map((w) => (w.id === workflowId ? { ...w, [field]: value } : w)),
        }))
      )

      if (user && activeProject.id !== DEFAULT_AI_PROJECT.id) {
        const fieldMap: Record<string, string> = {
          ourNotes: "our_notes",
          clientMessage: "client_message",
          clientTaskDone: "client_task_done",
          reason: "reason",
          figmaUrl: "figma_url",
          designA: "design_a",
          designB: "design_b",
        }
        const col = fieldMap[field] || field
        try {
          await supabase.from("workflows").update({ [col]: value }).eq("id", workflowId)
        } catch (err) {
          console.error("Failed to sync workflow update:", err)
        }
      }
    },
    [user, activeProject.id, supabase]
  )

  const duplicateWorkflow = useCallback(
    async (workflowId: string) => {
      const target = activeProject.workflows.find((w) => w.id === workflowId)
      if (!target) return
      const newId = `wf-copy-${Date.now()}`
      const copy: Workflow = {
        ...target,
        id: newId,
        title: `${target.title} (Copy)`,
        comments: [],
        revisions: [],
      }

      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeProject.id
            ? { ...p, workflows: [...p.workflows, copy] }
            : p
        )
      )
      setActiveWorkflowId(newId)
    },
    [activeProject]
  )

  // Never expose simulator content while authentication is unresolved or absent.
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <div className="h-8 w-8 rounded-full border-2 border-slate-700 border-t-indigo-500 animate-spin" />
          <p className="text-sm">Checking authentication…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-900 text-slate-100">
      {/* Main Workspace: Simulator Frame + Live AI Automation Dock */}
      <main className="flex-1 w-full overflow-hidden flex relative">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-xs font-medium">Loading AI Simulator & Device Frame...</p>
          </div>
        ) : (
          <>
            {/* VS Code Left Activity Bar Rail (48px) */}
            <aside className="w-12 bg-[#090a10] border-r border-slate-800/80 flex flex-col items-center justify-between py-2 shrink-0 z-30 select-none">
              {/* Top: Folder/Dashboard, Editor, Simulator, AI Simulator, Run/Stop Action, Stage Tabs */}
              <div className="flex flex-col items-center gap-1.5 w-full">
                {/* Brand Logo & Back to Dashboard (Folder) */}
                <Link
                  href="/"
                  className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center font-bold text-xs shadow-md transition-all cursor-pointer"
                  title="Dashboard (Folder)"
                >
                  <FolderKanban className="h-4 w-4" />
                </Link>

                <div className="w-6 h-px bg-slate-800/80 my-0.5" />

                {/* Editor View Tab Link */}
                <Link
                  href={activeProjectId && activeProjectId !== "ai-simulator-default" ? `/?project=${activeProjectId}&view=editor` : "/?view=editor"}
                  className="w-full py-2 flex flex-col items-center justify-center relative transition group text-slate-500 hover:text-slate-200 cursor-pointer"
                  title="Design Review Editor"
                >
                  <Pencil className="h-5 w-5 transition group-hover:scale-105" />
                </Link>

                <div className="w-6 h-px bg-slate-800/80 my-0.5" />

                {/* Workspace Stage Switching Tabs */}
                {workspaceTabs.map((tab) => {
                  const Icon = tab.icon
                  const isActive =
                    stageViewMode === tab.id ||
                    (tab.id === "map" && ["map", "screens", "plan", "execution", "files", "coverage"].includes(stageViewMode))
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleSelectWorkspaceTab(tab.id)}
                      className={`w-full py-2 flex flex-col items-center justify-center relative transition group cursor-pointer ${
                        isActive
                          ? "text-white"
                          : "text-slate-500 hover:text-slate-200"
                      }`}
                      title={`${tab.label}${tab.count !== undefined ? ` (${tab.count})` : ""}`}
                    >
                      {/* Active Indicator Bar on Left */}
                      {isActive && (
                        <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-indigo-500 rounded-r" />
                      )}
                      <div className="relative">
                        <Icon className={`h-5 w-5 transition ${isActive ? "text-indigo-400" : "group-hover:scale-105"}`} />
                        {tab.count !== undefined && (
                          <span className="absolute -top-1.5 -right-2.5 px-1 py-0.2 rounded-full text-[8px] font-mono font-bold bg-indigo-600 text-white min-w-[14px] text-center leading-tight">
                            {typeof tab.count === "string" ? tab.count.replace(/[^0-9]/g, "") || tab.count : tab.count}
                          </span>
                        )}
                        {tab.isLive && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-2 ring-slate-950 animate-pulse" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Bottom Activity Icons: Terminal, AI Bot, Theme, Fullscreen, Profile */}
              <div className="flex flex-col items-center gap-2 w-full pt-2 pb-2.5 border-t border-slate-800/60 relative">
                {/* Toggle Bottom Terminal/Panel */}
                <button
                  type="button"
                  onClick={() => setIsBottomPanelOpen((prev) => !prev)}
                  className={`p-2 rounded-lg transition cursor-pointer relative group ${
                    isBottomPanelOpen
                      ? "text-indigo-400 bg-indigo-600/10"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                  title={isBottomPanelOpen ? "Close Terminal / Bottom Panel" : "Open Terminal / Bottom Panel"}
                >
                  <Terminal className="h-5 w-5" />
                </button>

                {/* Open Movable AI Vision & Engine Settings Modal */}
                <button
                  type="button"
                  onClick={() => setIsAiConfigModalOpen((prev) => !prev)}
                  className={`p-2 rounded-lg transition cursor-pointer relative group ${
                    isAiConfigModalOpen
                      ? "text-purple-400 bg-purple-600/10"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                  title="Open AI Vision & Engine Settings (Movable Window)"
                >
                  <Sparkles className="h-5 w-5" />
                </button>

                {/* GitHub Repository Link */}
                <a
                  href="https://github.com/nareshbabunuli/Design-Review"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800/60 transition cursor-pointer"
                  title="GitHub: nareshbabunuli/Design-Review"
                  aria-label="GitHub Repository"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      clipRule="evenodd"
                    />
                  </svg>
                </a>

                {/* Theme Toggle Icon */}
                <div className="scale-85">
                  <ThemeToggle theme={theme} onToggle={toggleTheme} />
                </div>

                {/* Fullscreen Toggle Button */}
                <button
                  type="button"
                  onClick={() => setIsSimulatorFullscreen((prev) => !prev)}
                  className={`p-2 rounded-lg transition cursor-pointer relative group ${
                    isSimulatorFullscreen
                      ? "text-indigo-400 bg-indigo-600/10"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                  title={isSimulatorFullscreen ? "Exit Fullscreen" : "Fullscreen Canvas"}
                >
                  {isSimulatorFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>

                {/* Profile Avatar / Menu Trigger */}
                <div className="relative" ref={activityProfileRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (user) {
                        setIsProfileMenuOpen((prev) => !prev)
                      } else {
                        window.location.href = "/"
                      }
                    }}
                    className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-[10px] font-bold text-white flex items-center justify-center ring-1 ring-slate-700 hover:ring-indigo-400 transition cursor-pointer"
                    title={user ? (user.email || "Profile") : "Sign in / Account"}
                  >
                    {user ? (user.email ? user.email.slice(0, 2).toUpperCase() : "US") : <User className="h-3.5 w-3.5" />}
                  </button>

                  {/* Profile Dropdown Menu in Activity Bar */}
                  {isProfileMenuOpen && user && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      className="fixed left-14 bottom-3 w-60 rounded-xl border border-slate-800 bg-[#0f1118] p-1.5 shadow-2xl z-50 flex flex-col text-xs transition-all animate-in fade-in-50 zoom-in-95 duration-150 origin-bottom-left text-slate-200"
                    >
                      {/* User email info */}
                      <div className="px-3 py-2 border-b border-slate-800 mb-1">
                        <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                          Signed in as
                        </div>
                        <div className="font-semibold text-white truncate mt-0.5" title={user.email || ""}>
                          {user.email}
                        </div>
                      </div>

                      {/* Third-Party Integrations */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false)
                          setSettingsTab("integrations")
                          setIsSettingsOpen(true)
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-left cursor-pointer"
                      >
                        <Plug className="h-4 w-4 text-purple-400" />
                        <span>Third-Party Integrations</span>
                      </button>

                      {/* Account Settings */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsProfileMenuOpen(false)
                          setSettingsTab("account")
                          setIsSettingsOpen(true)
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-left cursor-pointer"
                      >
                        <Settings className="h-4 w-4 text-slate-400" />
                        <span>Account Settings</span>
                      </button>

                      <div className="h-px bg-slate-800 my-1" />

                      {/* Logout */}
                      <button
                        type="button"
                        onClick={async () => {
                          setIsProfileMenuOpen(false)
                          await supabase.auth.signOut()
                          window.location.href = "/"
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-rose-400 hover:bg-rose-950/40 transition-colors text-left font-medium cursor-pointer"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Log out</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* 1. CORE WORKSPACE: PHONE SIMULATOR PAGE OR FULL PAGE TABS OR SIDE-BY-SIDE */}
            <div className="flex-1 h-full w-full flex flex-col overflow-hidden relative">
              {/* Top View Mode Switcher Header */}
              <div className="h-9 px-3 bg-[#0c0e14] border-b border-slate-800 flex items-center justify-between text-xs shrink-0 select-none z-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mr-1">AI Testing</span>
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceLayoutMode("split")
                        if (stageViewMode === "simulator") setStageViewMode("chat")
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                        workspaceLayoutMode === "split"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Split View: Live Phone + AI Section"
                    >
                      <Columns className="h-3 w-3" />
                      <span>Split</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceLayoutMode("stage")
                        if (stageViewMode === "simulator") setStageViewMode("chat")
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                        workspaceLayoutMode === "stage"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Full AI Section (Maximize AI Bot & Testing workspace)"
                    >
                      <Maximize2 className="h-3 w-3" />
                      <span>Full AI Section</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceLayoutMode("device")
                      }}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1 ${
                        workspaceLayoutMode === "device"
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-slate-400 hover:text-white"
                      }`}
                      title="Phone Simulator Only"
                    >
                      <Smartphone className="h-3 w-3" />
                      <span>Phone Only</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAiConfigModalOpen(true)}
                    className="px-2.5 py-1 rounded-md bg-purple-950/50 hover:bg-purple-900/60 border border-purple-700/50 text-purple-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                    title="Configure AI Vision Model, Provider, and API keys (Movable Window)"
                  >
                    <Settings className="h-3.5 w-3.5 text-purple-400" />
                    <span>AI Settings</span>
                    <span className="text-[10px] text-purple-300 font-mono hidden sm:inline">
                      ({aiProvider === "omnirouter" ? omniRouterModel || "fast" : (selectedAiModel || "Nemotron-3-Nano").split("/").pop()})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSettingsTab("account")
                      setIsSettingsOpen(true)
                    }}
                    className="p-1.5 rounded-md hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Open Project & Application Settings"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>

                  {currentJob?.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => window.open(`/api/ai-automation/html-report?jobId=${currentJob.id}`, '_blank')}
                        className="px-2.5 py-1 rounded-md bg-blue-600/30 hover:bg-blue-600 border border-blue-500/50 text-blue-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        title="View comprehensive HTML report in browser (with print-to-PDF)"
                      >
                        <FileBarChart className="h-3 w-3" />
                        <span>View Report</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportZip}
                        disabled={isExportingZip}
                        className="px-2.5 py-1 rounded-md bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/50 text-indigo-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                        title="Download complete test bundle as ZIP (PDF report, HTML, evidence screenshots, and JSON)"
                      >
                        {isExportingZip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                        <span>{isExportingZip ? "Packaging..." : "Save Test ZIP"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResetData}
                        disabled={isResettingData}
                        className="px-2 py-1 rounded-md bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/50 text-slate-400 hover:text-rose-200 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                        title="Reset discovered map screens and test plan data"
                      >
                        {isResettingData ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        <span>Reset Data</span>
                      </button>
                    </>
                  )}

                  {currentJob?.status === "running" && (
                    <>
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        <span>Live Testing In Flight</span>
                      </div>
                      {currentJob.recordingControl === "paused" ? (
                        <button type="button" onClick={() => handleRecordingControl("resume_recording")} className="px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-[10px] font-medium">
                          Resume Recording
                        </button>
                      ) : currentJob.recordingControl !== "stopped" ? (
                        <button type="button" onClick={() => handleRecordingControl("pause_recording")} className="px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[10px] font-medium">
                          Pause Recording
                        </button>
                      ) : null}
                      {currentJob.recordingControl !== "stopped" && (
                        <button type="button" onClick={() => handleRecordingControl("stop_recording")} className="px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-300 text-[10px] font-medium">
                          Stop Recording
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Main Content Workspace Panes */}
              <div className="flex-1 w-full h-full flex overflow-hidden relative">
                {/* 1. Live Device Pane: shown in "device" or "split" mode */}
                {/* 1. Live Device Pane: shown in "device" or "split" mode */}
                {(workspaceLayoutMode === "device" || workspaceLayoutMode === "split") && (
                  <div
                    style={workspaceLayoutMode === "split" ? { width: `${splitWidth}px` } : undefined}
                    className={`${
                      workspaceLayoutMode === "split"
                        ? "shrink-0 border-r border-slate-800 flex flex-col h-full overflow-hidden"
                        : "flex-1 h-full flex flex-col overflow-hidden"
                    } ${isDraggingSplitter ? "pointer-events-none select-none" : ""}`}
                  >
                    <WorkflowSimulator
                      liveOnly={true}
                      project={mergedSimulatorProject}
                      initialWorkflowId={activeWorkflowId}
                      initialLiveMode={true}
                      initialUrl={targetUrl}
                      onUrlChange={handleSimulatorUrlChange}
                      isOwner={true}
                      canEdit={true}
                      userRole="owner"
                      onSelectWorkflow={(id) => setActiveWorkflowId(id)}
                      onDuplicateWorkflow={duplicateWorkflow}
                      onUpdateField={updateWorkflowField}
                      onOpenPresentation={() => {}}
                      theme={theme}
                      onToggleTheme={toggleTheme}
                      isFullscreen={isSimulatorFullscreen}
                      onToggleFullscreen={(val?: boolean) =>
                        setIsSimulatorFullscreen((prev) => (typeof val === "boolean" ? val : !prev))
                      }
                      onNavigateView={(mode) => {
                        const pQuery = activeProjectId && activeProjectId !== "ai-simulator-default" ? `&project=${activeProjectId}` : ""
                        if (mode === "dashboard") window.location.href = "/"
                        else if (mode === "editor") window.location.href = `/?view=editor${pQuery}`
                        else if (mode === "simulator") window.location.href = `/?view=simulator${pQuery}`
                      }}
                      currentAction={currentJob?.currentAction || activeAction}
                      isRunningTest={currentJob?.status === "running"}
                      liveSessionScreenshotUrl={currentJob?.currentScreenshotUrl}
                      onViewportChange={handleSimulatorViewportChange}
                    />
                  </div>
                )}

                {/* Movable Splitter handle between Live Phone and Stage */}
                {workspaceLayoutMode === "split" && (
                  <div
                    onMouseDown={handleSplitterMouseDown}
                    onDoubleClick={() => setSplitWidth(Math.round(window.innerWidth / 2))}
                    className="w-2 hover:w-2.5 bg-slate-900 hover:bg-indigo-600/30 active:bg-indigo-600/50 transition-all cursor-col-resize shrink-0 z-30 flex items-center justify-center group select-none border-x border-slate-800"
                    title="Drag to resize Live Phone vs AI Section (Double-click to reset 50/50)"
                  >
                    <div className="w-0.5 h-8 bg-slate-600 group-hover:bg-indigo-400 group-active:bg-white rounded-full transition-colors" />
                  </div>
                )}

                {/* Fullscreen transparent capture overlay while dragging so iframe doesn't swallow mouse events */}
                {isDraggingSplitter && (
                  <div
                    className="fixed inset-0 z-[9999] cursor-col-resize select-none pointer-events-auto"
                    style={{ userSelect: "none" }}
                  />
                )}

                {/* Stage View Pane (Map / Screens / Plan / Execution) - Full Width */}
                <div className={`flex-1 h-full flex flex-col overflow-hidden bg-slate-950 relative min-w-0 ${isDraggingSplitter ? "pointer-events-none select-none" : ""}`}>
                    {stageViewMode === "chat" || testingMode === "feature_workflow" ? (
                      <FeatureWorkflowView
                        job={currentJob}
                        isRunning={currentJob?.status === "running" || currentJob?.status === "queued" || isSubmitting}
                        targetUrl={targetUrl}
                        activeSubTab={stageViewMode === "simulator" ? "chat" : stageViewMode}
                        onSubTabChange={(tab) => handleSelectWorkspaceTab(tab)}
                        onStartWorkflowTest={handleStartWorkflowTesting}
                        onStartFullAppTest={handleStartFullAppTesting}
                        onCancelJob={handleStopAutomation}
                        onOpenMapPage={() => handleSelectWorkspaceTab("map")}
                        isMapPageActive={stageViewMode === "map"}
                        testingMode={testingMode}
                        onSelectTestingMode={(m) => setTestingMode(m)}
                        fullPageView={true}
                        isFullStage={true}
                        onToggleFullStage={() => {}}
                        aiProvider={aiProvider}
                        onUpdateAiProvider={handleUpdateAiProvider}
                        nebiusApiKey={nebiusApiKey}
                        onUpdateNebiusApiKey={handleUpdateNebiusApiKey}
                        selectedAiModel={selectedAiModel}
                        onUpdateAiModel={handleUpdateAiModel}
                        omniRouterBaseUrl={omniRouterBaseUrl}
                        onUpdateOmniRouterUrl={handleUpdateOmniRouterUrl}
                        omniRouterKey={omniRouterKey}
                        onUpdateOmniRouterKey={handleUpdateOmniRouterKey}
                        omniRouterModel={omniRouterModel}
                        onUpdateOmniRouterModel={handleUpdateOmniRouterModel}
                        localAiBaseUrl={localAiBaseUrl}
                        onUpdateLocalBaseUrl={handleUpdateLocalBaseUrl}
                        isTestingAiConnection={isTestingAiConnection}
                        onTestAiConnection={handleTestAiConnection}
                        aiConnectionTestResult={aiConnectionTestResult}
                        onOpenAiConfig={() => setIsAiConfigModalOpen(true)}
                        onCaptureCurrentScreen={handleCaptureCurrentScreen}
                        selectedProjectDir={selectedProjectDir}
                        onSelectProjectDir={setSelectedProjectDir}
                        availableProjects={availableProjects}
                        discoveredRoutes={discoveredRoutes}
                        onRescanRoutes={fetchLocalRoutes}
                        isScanningRoutes={isScanningRoutes}
                        onGenerateTestData={handleGenerateTestData}
                        isGeneratingTestData={isGeneratingTestData}
                        onNavigateUrl={handleSimulatorUrlChange}
                        onConfirmVerification={handleConfirmVerification}
                        onSkipVerification={handleSkipVerification}
                        onSaveSettingsCredentials={handleSaveSettingsCredentials}
                        onSkipSettingsCredentials={handleSkipSettingsCredentials}
                        onUnblockWorkflows={handleUnblockWorkflows}
                        enableLaya={enableLaya}
                        onToggleLaya={handleToggleLaya}
                        layaBaseUrl={layaBaseUrl}
                        onUpdateLayaUrl={handleUpdateLayaUrl}
                        isLayaLive={isLayaLive}
                      />
                    ) : (
                      <FullAppTestingView
                        job={currentJob}
                        isRunning={currentJob?.status === "running" || currentJob?.status === "queued" || isSubmitting}
                        targetUrl={targetUrl}
                        onStartFullAppTest={handleStartFullAppTesting}
                        onCancelJob={handleStopAutomation}
                        onJobUpdate={(updated) => setCurrentJob(updated)}
                        activeSubTab={stageViewMode === "simulator" ? "map" : stageViewMode}
                        onSubTabChange={(tab) => handleSelectWorkspaceTab(tab)}
                        fullPageView={true}
                        hideSubNav={false}
                        onOpenMapPage={() => handleSelectWorkspaceTab("map")}
                        isMapPageActive={stageViewMode === "map"}
                        testingMode={testingMode}
                        onSelectTestingMode={(m) => setTestingMode(m)}
                        isFullStage={true}
                        isBesideScreen={false}
                        onToggleFullStage={() => {}}
                      />
                    )}
                  </div>
              </div>
            </div>

            {/* Movable Floating AI Configuration Window */}
            <MovableAiConfigModal
              isOpen={isAiConfigModalOpen}
              onClose={() => setIsAiConfigModalOpen(false)}
              aiProvider={aiProvider}
              onUpdateAiProvider={handleUpdateAiProvider}
              nebiusApiKey={nebiusApiKey}
              onUpdateNebiusApiKey={handleUpdateNebiusApiKey}
              selectedAiModel={selectedAiModel}
              onUpdateAiModel={handleUpdateAiModel}
              omniRouterBaseUrl={omniRouterBaseUrl}
              onUpdateOmniRouterUrl={handleUpdateOmniRouterUrl}
              omniRouterKey={omniRouterKey}
              onUpdateOmniRouterKey={handleUpdateOmniRouterKey}
              omniRouterModel={omniRouterModel}
              onUpdateOmniRouterModel={handleUpdateOmniRouterModel}
              localAiBaseUrl={localAiBaseUrl}
              onUpdateLocalBaseUrl={handleUpdateLocalBaseUrl}
              isTestingAiConnection={isTestingAiConnection}
              onTestAiConnection={handleTestAiConnection}
              aiConnectionTestResult={aiConnectionTestResult}
            />
          </>
        )}
      </main>

      {/* VS Code Collapsible Bottom Panel (Drawer above Status Bar) */}
      {isBottomPanelOpen && (
        <div className="h-64 bg-[#0a0c12] border-t border-slate-800 flex flex-col shrink-0 z-20 text-xs font-mono select-none animate-in slide-in-from-bottom-2 duration-150">
          {/* Bottom Panel Header / Tabs */}
          <div className="h-8 px-3 bg-[#0d0f17] border-b border-slate-800/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1">
              {/* Terminal & Logs Tab */}
              <button
                type="button"
                onClick={() => setBottomPanelTab("terminal")}
                className={`px-3 py-1 flex items-center gap-1.5 rounded-t text-xs font-medium transition cursor-pointer ${
                  bottomPanelTab === "terminal"
                    ? "bg-[#0a0c12] text-indigo-400 border-t-2 border-indigo-500 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                <span>Terminal</span>
                {(currentJob?.logs?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
                    {currentJob?.logs?.length}
                  </span>
                )}
              </button>

              {/* Coverage Metrics Tab */}
              <button
                type="button"
                onClick={() => setBottomPanelTab("coverage")}
                className={`px-3 py-1 flex items-center gap-1.5 rounded-t text-xs font-medium transition cursor-pointer ${
                  bottomPanelTab === "coverage"
                    ? "bg-[#0a0c12] text-indigo-400 border-t-2 border-indigo-500 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Coverage</span>
                {activePlan?.coverage && (
                  <span className="px-1.5 py-0.2 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/60 text-[10px]">
                    {activePlan.coverage.percentage}%
                  </span>
                )}
              </button>

              {/* Action Trace Tab */}
              <button
                type="button"
                onClick={() => setBottomPanelTab("actions")}
                className={`px-3 py-1 flex items-center gap-1.5 rounded-t text-xs font-medium transition cursor-pointer ${
                  bottomPanelTab === "actions"
                    ? "bg-[#0a0c12] text-indigo-400 border-t-2 border-indigo-500 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Action Trace</span>
                {(activePlan?.steps?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300">
                    {activePlan?.steps?.length}
                  </span>
                )}
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                Target: {targetUrl || "http://localhost:3001"}
              </span>
              <button
                type="button"
                onClick={() => setIsBottomPanelOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Bottom Panel Content */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
            {bottomPanelTab === "terminal" && (
              <div className="space-y-1 text-slate-300">
                <div className="text-slate-500 text-[11px] pb-1 border-b border-slate-800/60 flex items-center justify-between">
                  <span>antigravity-test-runner v2.4.0 • Target: {targetUrl}</span>
                  <span>PID: {currentJob?.id?.slice(0, 8) || "ready"}</span>
                </div>
                {(!currentJob?.logs || currentJob.logs.length === 0) ? (
                  <div className="pt-2 text-slate-400 space-y-1">
                    <p className="text-emerald-400">$ antigravity init --mode=systematic-full-app</p>
                    <p className="text-slate-400">&gt; Standby for autonomous crawler & live execution events.</p>
                    <p className="text-slate-500">&gt; Phase: {currentJob?.testingPhase ? currentJob.testingPhase.toUpperCase() : "READY"}</p>
                    <p className="text-slate-500">&gt; Click &apos;▶ Run Test&apos; on the top bar or activity bar to start.</p>
                  </div>
                ) : (
                  currentJob.logs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-slate-600 shrink-0">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--:--:--"}
                      </span>
                      <span
                        className={`px-1 rounded text-[10px] shrink-0 font-bold ${
                          log.level === "error"
                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                            : log.level === "warn"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : log.level === "success"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {log.level.toUpperCase()}
                      </span>
                      <span className="text-slate-200 break-all">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {bottomPanelTab === "coverage" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <span className="text-[11px] text-slate-400">Screens Discovered &amp; Tested</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-lg text-white font-sans">
                        {activePlan?.coverage?.screensTested || 0} / {activePlan?.coverage?.totalScreens || activePlan?.screens?.length || 0}
                      </strong>
                      <span className="text-xs text-indigo-400 font-semibold">
                        {activePlan?.coverage ? Math.round((activePlan.coverage.screensTested / (activePlan.coverage.totalScreens || 1)) * 100) : 0}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1 mt-2 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${activePlan?.coverage ? Math.min(100, Math.round((activePlan.coverage.screensTested / (activePlan.coverage.totalScreens || 1)) * 100)) : 0}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <span className="text-[11px] text-slate-400">Actions &amp; Assertions Passed</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-lg text-white font-sans">
                        {activePlan?.steps?.filter((s) => s.status === "passed").length || 0} / {activePlan?.steps?.length || 0}
                      </strong>
                      <span className="text-xs text-emerald-400 font-semibold">
                        {activePlan?.steps && activePlan.steps.length > 0
                          ? Math.round(((activePlan.steps.filter((s) => s.status === "passed").length) / activePlan.steps.length) * 100)
                          : 0}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1 mt-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${
                            activePlan?.steps && activePlan.steps.length > 0
                              ? Math.min(100, Math.round(((activePlan.steps.filter((s) => s.status === "passed").length) / activePlan.steps.length) * 100))
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                    <span className="text-[11px] text-slate-400">Synthetic Form Generation</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-lg text-emerald-400 font-sans">100%</strong>
                      <span className="text-xs text-slate-400">Synthetic Payloads</span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1 mt-2 overflow-hidden">
                      <div className="bg-indigo-500 h-full rounded-full w-full" />
                    </div>
                  </div>
                </div>

                {/* Discovered Screens Quick List */}
                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 mb-1.5 flex items-center justify-between">
                    <span>Discovered Nodes</span>
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspaceTab("screens")}
                      className="text-indigo-400 hover:text-indigo-300 text-[10px] underline"
                    >
                      View Screens Grid →
                    </button>
                  </div>
                  <div className="space-y-1">
                    {activePlan?.screens?.map((screen) => (
                      <div key={screen.id} className="flex items-center justify-between text-[11px] px-2 py-1 bg-slate-950/40 rounded border border-slate-800/40">
                        <div className="flex items-center gap-2">
                          <span className="px-1 py-0.2 bg-slate-800 text-slate-300 rounded text-[9px] font-bold">{screen.id}</span>
                          <span className="text-slate-200 font-medium">{screen.name}</span>
                          <span className="text-slate-500 hidden sm:inline">{screen.path}</span>
                        </div>
                        <span className="text-slate-400 text-[10px]">
                          {screen.actionableElements.length} elements mapped
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {bottomPanelTab === "actions" && (
              <ActionLedger
                live={actionLedgerLive}
                queue={actionLedgerQueue}
                history={actionLedgerHistory}
              />
            )}
          </div>
        </div>
      )}

      {/* VS Code Bottom Status Bar */}
      <footer className="h-6 px-3 bg-[#0d0e15] border-t border-slate-800/80 text-[11px] font-mono flex items-center justify-between shrink-0 select-none z-20 text-slate-400">
        {/* Left: Telemetry & Test Pipeline Metrics */}
        <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar whitespace-nowrap">
          {/* Running / Ready status (clickable to open terminal) */}
          <button
            type="button"
            onClick={() => {
              setIsBottomPanelOpen(true)
              setBottomPanelTab("terminal")
            }}
            className="flex items-center gap-1.5 font-semibold hover:text-white transition cursor-pointer"
            title="Open Terminal & Logs"
          >
            {currentJob?.status === "running" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-300">Running ({currentJob.progress || 0}%)</span>
              </>
            ) : currentJob?.status === "completed" ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-emerald-300">Test Complete</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-indigo-400" />
                <span className="text-slate-300">Ready</span>
              </>
            )}
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          {/* Phase Badge */}
          <button
            type="button"
            onClick={() => {
              setIsBottomPanelOpen(true)
              setBottomPanelTab("terminal")
            }}
            className="text-slate-300 hover:text-white transition cursor-pointer"
            title="Open Pipeline Logs"
          >
            Phase: <strong className="text-indigo-300">{currentJob?.testingPhase ? currentJob.testingPhase.toUpperCase() : "DISCOVER & MAP"}</strong>
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          {/* Screens Mapped (clickable to open coverage) */}
          <button
            type="button"
            onClick={() => {
              setIsBottomPanelOpen(true)
              setBottomPanelTab("coverage")
            }}
            className="hover:text-white transition cursor-pointer"
            title="Open Coverage Details"
          >
            Screens: <strong className="text-slate-200">{activePlan?.screens?.length || 0}</strong>
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          {/* Actions Tested & Coverage */}
          <button
            type="button"
            onClick={() => {
              setIsBottomPanelOpen(true)
              setBottomPanelTab("actions")
            }}
            className="hover:text-white transition cursor-pointer"
            title="Open Action Trace"
          >
            Actions: <strong className="text-slate-200">{activePlan?.steps?.length || 0}</strong>
            {activePlan?.steps && activePlan.steps.length > 0 && (
              <span className="text-indigo-300 ml-1">
                ({Math.round(((activePlan.steps.filter((s) => s.status === "passed").length) / activePlan.steps.length) * 100)}%)
              </span>
            )}
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          {/* Test Results: Pass / Fail */}
          <button
            type="button"
            onClick={() => {
              setIsBottomPanelOpen(true)
              setBottomPanelTab("actions")
            }}
            className="flex items-center gap-2 text-[10px] cursor-pointer"
            title="Open Test Step Results"
          >
            <span className="text-emerald-400 font-bold flex items-center gap-0.5">
              <Check className="h-3 w-3" /> {activePlan?.steps?.filter((s) => s.status === "passed").length || 0}
            </span>
            <span className="text-rose-400 font-bold flex items-center gap-0.5">
              <XCircle className="h-3 w-3" /> {activePlan?.steps?.filter((s) => s.status === "failed").length || 0}
            </span>
            {activePlan?.steps?.some((s) => s.status === "blocked") && (
              <span className="text-amber-400 font-bold flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" /> {activePlan?.steps?.filter((s) => s.status === "blocked").length || 0}
              </span>
            )}
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          {/* Forms */}
          <span className="text-slate-400 hidden md:inline">
            Forms: <strong className="text-slate-200">100% Synthetic</strong>
          </span>
        </div>

        {/* Right: Console Toggle, Target & AI Provider */}
        <div className="flex items-center gap-3 shrink-0 ml-2">
          {/* Toggle Terminal / Console Panel */}
          <button
            type="button"
            onClick={() => setIsBottomPanelOpen((prev) => !prev)}
            className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition cursor-pointer ${
              isBottomPanelOpen
                ? "text-indigo-300 bg-indigo-950/60 border border-indigo-800/60"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
            title="Toggle Console / Bottom Drawer"
          >
            <Terminal className="h-3 w-3" />
            <span className="hidden sm:inline">Console</span>
          </button>

          <div className="w-px h-3.5 bg-slate-800" />

          <span className="text-slate-500 hidden sm:inline truncate max-w-[200px]">
            {targetUrl || "http://localhost:3001"}
          </span>
          <div className="w-px h-3.5 bg-slate-800 hidden sm:block" />
          <button
            type="button"
            onClick={() => setIsAiConfigModalOpen((prev) => !prev)}
            className="flex items-center gap-1 text-slate-300 hover:text-white transition cursor-pointer"
            title="Configure AI Vision & Engine"
          >
            <Sparkles className="h-3 w-3 text-purple-400" />
            <span className="hidden sm:inline">AI Config</span>
          </button>
        </div>
      </footer>

      {/* Pre-Flight Continuous Testing Setup Modal */}
      {showPreFlightModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setShowPreFlightModal(false)}
        >
          <div
            className="relative w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col text-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                  <Play className="h-4 w-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    Pre-Flight Autonomous Testing Setup
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono">
                      {pendingLaunchMode === "feature_workflow" ? "Feature Workflow" : "Full App Crawl"}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Target: <code className="text-indigo-300 font-mono">{targetUrl}</code>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPreFlightModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar text-xs">
              {/* Optional browser session video recording */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-start gap-3">
                <Video className="h-4 w-4 mt-0.5 text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <label htmlFor="record-session-video" className="font-semibold text-slate-100 cursor-pointer">Record test session video</label>
                  <p className="text-[11px] text-slate-400 mt-1">Capture the browser journey with action overlays. The video is attached to the run report when recording and storage are available.</p>
                </div>
                <input
                  id="record-session-video"
                  type="checkbox"
                  checked={recordVideo}
                  onChange={(e) => setRecordVideo(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-indigo-500 cursor-pointer shrink-0"
                />
              </div>

              {/* 1. Upload Folder */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Folder className="h-3.5 w-3.5 text-amber-400" />
                    <span>Upload Test Files Folder</span>
                    <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-amber-400/80 font-mono">Real File Testing</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Folder containing sample images, PDFs, CSVs, or documents to attach to upload inputs.
                </p>
                <input
                  type="text"
                  value={uploadFilesDir}
                  onChange={(e) => setUploadFilesDir(e.target.value)}
                  placeholder="e.g. scripts/fixtures or ./test-assets"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span>💡 Tip:</span>
                  <span>Leave blank to auto-detect from project or use synthetic dummy buffers.</span>
                </div>
              </div>

              {/* 2. Postman Collection */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <FileCode className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Postman API Collection (v2.1)</span>
                    <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-indigo-400/80 font-mono">API Form Mapping</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Supplies realistic API payloads and wire verification for forms and popups.
                </p>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium cursor-pointer transition border border-slate-700">
                    <FileUp className="h-3.5 w-3.5 text-indigo-400" />
                    <span>{postmanFileName ? "Change File..." : "Import Collection (.json)"}</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setPostmanFileName(file.name)
                        const reader = new FileReader()
                        reader.onload = (ev) => {
                          setPostmanCollectionText((ev.target?.result as string) || "")
                        }
                        reader.readAsText(file)
                      }}
                    />
                  </label>
                  {postmanFileName && (
                    <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-mono">
                      <Check className="h-3 w-3" />
                      <span className="truncate max-w-[200px]">{postmanFileName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPostmanFileName("")
                          setPostmanCollectionText("")
                        }}
                        className="text-slate-500 hover:text-rose-400 ml-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 3. Authentication Credentials */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-purple-400" />
                    <span>Test Auth Credentials</span>
                    <span className="text-[10px] font-normal text-slate-400">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-purple-400/80 font-mono">Auth-Wall Crawl</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Email or Username"
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* 4. Safety Guard & Destructive Permissions */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
                <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Safety Guard &amp; Environment Toggles</span>
                </div>

                <div className="space-y-2 pt-1">
                  {/* Payment Checkbox */}
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowTestPayments}
                      onChange={(e) => setAllowTestPayments(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-900 cursor-pointer"
                    />
                    <div>
                      <div className="font-medium text-slate-200 text-xs flex items-center gap-1.5">
                        <CreditCard className="h-3 w-3 text-indigo-400" />
                        <span>Allow Test Payments (Sandbox Defaults)</span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">Optional</span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Enables filling checkout forms with standard sandbox test card (<code className="font-mono text-slate-300">4242 4242...</code>). Leave unchecked if app has no payments.
                      </p>
                    </div>
                  </label>

                  {/* Destructive Actions Checkbox */}
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowDestructiveActions}
                      onChange={(e) => setAllowDestructiveActions(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-900 cursor-pointer"
                    />
                    <div>
                      <div className="font-medium text-slate-200 text-xs">
                        Allow Destructive Actions (Delete, Archive, Purge)
                      </div>
                      <p className="text-[11px] text-slate-400">
                        When disabled, Safety Guard will automatically soft-skip buttons that delete accounts or records.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPreFlightModal(false)}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleExecutePreFlightLaunch()
                  }}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Launch Test Runner</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full-resolution Image Preview Modal */}
      {imagePreviewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setImagePreviewModal(null)}
        >
          <div
            className="relative max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-xs font-semibold text-slate-300">
              <span className="flex items-center gap-1.5 text-indigo-400">
                <ImageIcon className="h-4 w-4" />
                <span>Screen Capture / Attachment Preview</span>
              </span>
              <button
                type="button"
                onClick={() => setImagePreviewModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close preview"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-2 overflow-auto max-h-[82vh] flex items-center justify-center bg-slate-950/50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreviewModal}
                alt="Full resolution preview"
                className="max-h-[80vh] w-auto object-contain rounded-lg border border-slate-800"
              />
            </div>
          </div>
        </div>
      )}

      {/* Test Data Explorer & Verification Modal */}
      {isTestDataModalOpen && testDataStatus && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setIsTestDataModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3.5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <FolderCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-bold text-white">Target Project Test Data</h3>
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Verified
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono truncate max-w-[340px] mt-0.5" title={testDataStatus.folderPath}>
                    {testDataStatus.folderPath}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTestDataModalOpen(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                title="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 space-y-3 flex-1 overflow-y-auto custom-scrollbar text-xs">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold text-white block">
                    {testDataStatus.filesCount} Test Assets Available
                  </span>
                  <p className="text-[10px] text-slate-400 leading-snug mt-0.5">
                    Autonomous AI Bot and testing crawler use these mock files for file upload inputs, form submissions, and identity verification.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleGenerateTestData()}
                  disabled={isGeneratingTestData}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-[10px] font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
                  title="Generate or refresh universal test files (PDFs, CSVs, images, notes)"
                >
                  {isGeneratingTestData ? <Loader2 className="h-3 w-3 animate-spin text-indigo-400" /> : <Sparkles className="h-3 w-3 text-indigo-400" />}
                  <span>{testDataStatus.filesCount === 0 ? "Generate Files" : "Refresh Files"}</span>
                </button>
              </div>

              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Files in Folder:
                </span>
                {testDataStatus.files.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-1">
                    <p className="text-[11px] text-slate-400">No test files detected in this folder yet.</p>
                    <button
                      type="button"
                      onClick={() => handleGenerateTestData()}
                      disabled={isGeneratingTestData}
                      className="px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold"
                    >
                      Generate Universal Test Files Now
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                    {testDataStatus.files.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 hover:border-slate-700 text-[11px] transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase shrink-0 ${
                              file.category === "pdf"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : file.category === "csv"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : file.category === "image"
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                                : file.category === "notes"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                : file.category === "json"
                                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {file.category}
                          </span>
                          <span className="font-mono text-slate-200 truncate" title={file.name}>
                            {file.name}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0 pl-2">
                          {file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <button
                type="button"
                onClick={() => fetchTestDataStatus()}
                disabled={isCheckingTestData}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                title="Rescan folder on disk"
              >
                <RotateCcw className={`h-3 w-3 ${isCheckingTestData ? "animate-spin" : ""}`} />
                <span>Re-verify Folder</span>
              </button>
              <button
                type="button"
                onClick={() => setIsTestDataModalOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings & Third-Party Integrations Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        userEmail={user?.email}
        userId={user?.id}
        initialTab={settingsTab}
        onOpenFigmaImport={() => {
          window.location.href = "/?import=figma"
        }}
      />
    </div>
  )
}