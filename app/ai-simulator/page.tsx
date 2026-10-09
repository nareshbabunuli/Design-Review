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
  CreditCard,
  FileCode,
  Mail,
  Pencil,
  Settings,
  LogOut,
  Plug,
  User,
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
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [isSimulatorFullscreen, setIsSimulatorFullscreen] = useState(false)

  // AI Automation Bot Side Dock visibility: open by default on desktop (lg+), closed on mobile (< 1024px)
  const [isBotPanelOpen, setIsBotPanelOpen] = useState(false)

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setIsBotPanelOpen(true)
    }
  }, [])

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

  // Active Automation Job State
  const [currentJob, setCurrentJob] = useState<AutomationJob | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [botError, setBotError] = useState("")
  const [copiedReport, setCopiedReport] = useState(false)

  // OpenRouter / OmniRouter / Local AI Model Provider State
  const [aiProvider, setAiProvider] = useState<"cloud" | "omnirouter" | "local">("cloud")
  const [localAiBaseUrl, setLocalAiBaseUrl] = useState("http://localhost:11434/v1")
  const [omniRouterBaseUrl, setOmniRouterBaseUrl] = useState("https://api.unorouter.com/v1")
  const [omniRouterKey, setOmniRouterKey] = useState("")
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [selectedAiModel, setSelectedAiModel] = useState("google/gemini-2.0-flash-001")
  const [omniRouterModel, setOmniRouterModel] = useState("deepseek-v4-flash:free")
  const [showAiSettings, setShowAiSettings] = useState(false)

  // Antigravity Browser Control & Action Replay State
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [isPlayingReplay, setIsPlayingReplay] = useState(false)

  // Laya Fast System-1 Reflexes & Journey Role State
  const [journeyRole, setJourneyRole] = useState<"user" | "admin" | "client" | "editor" | "viewer" | "custom">("user")
  const [customJourneyRole, setCustomJourneyRole] = useState("")
  const [enableLaya, setEnableLaya] = useState(false)
  const [layaBaseUrl, setLayaBaseUrl] = useState("http://127.0.0.1:8001")
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
  const [verificationCodeInput, setVerificationCodeInput] = useState("")
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false)
  const [settingsFormValues, setSettingsFormValues] = useState<Record<string, string>>({})
  const [showSettingsSecrets, setShowSettingsSecrets] = useState<Record<string, boolean>>({})
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)

  // Main stage layout mode: "simulator" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  type StageViewMode = "simulator" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  const [stageViewMode, setStageViewMode] = useState<StageViewMode>("simulator")

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
        ["simulator", "map", "screens", "plan", "execution", "files", "coverage"].includes(tabParam)
      ) {
        setStageViewMode(tabParam as StageViewMode)
      }
    }
  }, [])

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
  }, [])

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
      { id: "map", label: "Figma-Style App Map", icon: MapIcon, count: activePlan?.screens.length || 0 },
      { id: "screens", label: "Discovered Screens", icon: Layers, count: activePlan?.screens.length || 0 },
      { id: "plan", label: "Structured Test Plan", icon: ListChecks, count: activePlan?.steps.length || 0 },
      { id: "execution", label: "Live Execution & Evidence", icon: Activity, isLive: currentJob?.status === "running" },
      { id: "files", label: "Test Files Provisioning", icon: FileUp, count: activePlan?.requiredFileTypes.length || 0 },
      {
        id: "coverage",
        label: "Coverage & Issues",
        icon: ShieldAlert,
        count:
          currentJob?.issues && currentJob.issues.length > 0
            ? `${currentJob.issues.length} bugs`
            : `${coveragePct}%`,
      },
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

  // Local Project Route Scanner State
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

  const handleSelectTestingProject = (projectName: string) => {
    setSelectedProjectDir(projectName)
    localStorage.setItem("ai_target_project_dir", projectName)

    const projectInfo = availableProjects.find((p) => p.name === projectName)
    const newPort = projectInfo?.defaultPort || (projectName === "landlord-accounting-portal" ? 3001 : 3000)
    const newUrl = `http://localhost:${newPort}`
    setTargetUrl(newUrl)
    localStorage.setItem("ai_target_app_url", newUrl)
    fetchLocalRoutes(projectName, newUrl)
  }

  useEffect(() => {
    const savedProject = localStorage.getItem("ai_target_project_dir") || "landlord-accounting-portal"
    const savedUrl = localStorage.getItem("ai_target_app_url") || (savedProject === "landlord-accounting-portal" ? "http://localhost:3001" : "http://localhost:3000")
    setSelectedProjectDir(savedProject)
    setTargetUrl(savedUrl)
    fetchLocalRoutes(savedProject, savedUrl)
  }, [])

  // Laya fast health checker (runs only if explicitly enabled)
  useEffect(() => {
    if (!enableLaya) {
      setIsLayaLive(false)
      return
    }
    let active = true
    const checkLaya = async () => {
      try {
        const res = await fetch(`/api/ai-automation/laya-health?baseUrl=${encodeURIComponent(layaBaseUrl)}`, {
          signal: AbortSignal.timeout(2500),
        }).catch(() => null)
        if (!res || !res.ok) {
          if (active) setIsLayaLive(false)
          return
        }
        const data = await res.json().catch(() => null)
        if (active) setIsLayaLive(Boolean(data?.live))
      } catch {
        if (active) setIsLayaLive(false)
      }
    }
    checkLaya()
    const timer = setInterval(checkLaya, 12000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [enableLaya, layaBaseUrl])

  // AI Agent Chat Command Center State
  const [activeDockTab, setActiveDockTab] = useState<"chat" | "config" | "crawl" | "report">("chat")
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
  const handleSendChatCommand = async (cmdText?: string, imageOverride?: string, fromQueue = false) => {
    const textToSend = (cmdText || chatInput).trim()
    const imageToSend = imageOverride || attachedImage
    if ((!textToSend && !imageToSend) || isSendingChat) return

    // Job paused at a login wall: treat the reply as credentials (or "skip")
    if (!fromQueue && currentJob?.authState === "awaiting_credentials" && currentJob.id && textToSend) {
      const skip = /^\s*skip\b/i.test(textToSend)
      const pwMatch = textToSend.match(/(?:password|pass|pwd)\s*[:=]?\s*(\S+)/i)
      const userMatch = textToSend.match(/(?:e-?mail|username|user|login)\s*[:=]?\s*(\S+)/i)
      let username = userMatch?.[1]
      let password = pwMatch?.[1]
      if (!skip && (!username || !password)) {
        const parts = textToSend.split(/[\s,;/|:]+/).filter(Boolean)
        if (parts.length === 2) [username, password] = parts
      }
      const now = Date.now()
      if (!skip && (!username || !password)) {
        setChatHistory((prev) => [
          ...prev,
          { id: `user-${now}`, sender: "user", text: textToSend.replace(/(pass(?:word)?|pwd)\s*[:=]?\s*\S+/i, "$1: ****"), timestamp: new Date().toISOString(), status: "completed" },
          { id: `agent-${now}`, sender: "agent", text: "I couldn't read that. Type it like `email: you@example.com password: yourpass`, or type `skip` to continue without logging in.", timestamp: new Date().toISOString(), status: "completed" },
        ])
        setChatInput("")
        return
      }
      setChatInput("")
      setChatHistory((prev) => [
        ...prev,
        { id: `user-${now}`, sender: "user", text: skip ? "skip" : `email: ${username} password: ****`, timestamp: new Date().toISOString(), status: "completed" },
        { id: `agent-${now}`, sender: "agent", text: skip ? "Skipping login. Mapping only the public screens." : "Got it. Typing those details into the login form and continuing.", timestamp: new Date().toISOString(), status: "completed" },
      ])
      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          skip
            ? { jobId: currentJob.id, action: "skip_auth" }
            : { jobId: currentJob.id, action: "provide_credentials", username, password }
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

    // Job already running: queue the message instead of starting a parallel job
    if (!fromQueue && (currentJob?.status === "running" || currentJob?.status === "queued")) {
      setCommandQueue((q) => [
        ...q,
        { id: `q-${Date.now()}`, text: textToSend, image: imageToSend || undefined },
      ])
      setChatInput("")
      setAttachedImage(null)
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
          targetUrl: targetUrl.trim() || "http://localhost:3001",
          projectId: activeProject.id,
          projectDir: selectedProjectDir,
          credentials:
            username || password
              ? { username: username.trim(), password: password.trim() }
              : undefined,
          openRouterApiKey:
            aiProvider === "cloud"
              ? openRouterKey.trim() || undefined
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
              : "https://openrouter.ai/api/v1",
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
    const savedKey = localStorage.getItem("openrouter_api_key")
    if (savedKey) setOpenRouterKey(savedKey)
    const savedModel = localStorage.getItem("openrouter_selected_model")
    if (savedModel) setSelectedAiModel(savedModel)
    const savedProvider = localStorage.getItem("ai_selected_provider") as "cloud" | "omnirouter" | "local" | null
    if (savedProvider) setAiProvider(savedProvider)
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
    if (savedLayaUrl) setLayaBaseUrl(savedLayaUrl)
  }, [])

  const handleUpdateOpenRouterKey = (key: string) => {
    setOpenRouterKey(key)
    localStorage.setItem("openrouter_api_key", key)
  }

  const handleUpdateAiModel = (model: string) => {
    setSelectedAiModel(model)
    localStorage.setItem("openrouter_selected_model", model)
  }

  const handleUpdateAiProvider = (provider: "cloud" | "omnirouter" | "local") => {
    setAiProvider(provider)
    localStorage.setItem("ai_selected_provider", provider)
    if (provider === "local" && selectedAiModel.includes("google")) {
      setSelectedAiModel("llama3.2-vision")
    } else if (provider === "cloud" && selectedAiModel.includes("llama3.2")) {
      setSelectedAiModel("google/gemini-2.0-flash-001")
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
      if (aiProvider === "cloud") {
        if (!openRouterKey.trim()) {
          setAiConnectionTestResult({ success: false, message: "OpenRouter API Key is missing. Enter your key below." })
          setIsTestingAiConnection(false)
          return
        }
        const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${openRouterKey.trim()}` }
        })
        if (res.ok) {
          const data = await res.json()
          setAiConnectionTestResult({
            success: true,
            message: `Connected to OpenRouter! Rate limit: ${data?.data?.limit || "Standard"}, Key label: ${data?.data?.label || "Active"}`
          })
        } else {
          setAiConnectionTestResult({ success: false, message: `OpenRouter error (${res.status}): Please verify your API key.` })
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

  // Auth session check
  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!mounted) return
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email })
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email })
      } else {
        setUser(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase.auth])

  // Load projects from database (silent refresh prevents tearing down the screen)
  const loadWorkspace = useCallback(async (showFullLoader = false) => {
    if (showFullLoader) setLoading(true)
    try {
      const { data: ps, error: pError } = await supabase
        .from("projects")
        .select("id,title,is_expanded,user_id,figma_url,workflow_order,is_order_locked")
        .order("created_at", { ascending: true })

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
  }, [supabase])

  useEffect(() => {
    loadWorkspace(true)
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
        : undefined

    if (credentialsOverride?.username) {
      setUsername(credentialsOverride.username)
      if (credentialsOverride.password) setPassword(credentialsOverride.password)
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
          dummyTestFiles,
          uploadFilesDir: uploadFilesDir.trim() || undefined,
          postmanCollection: postmanObj,
          allowTestPayments,
          allowActions: effectiveAllowActions,
          role: journeyRole === "custom" ? customJourneyRole.trim() || "custom" : journeyRole,
          layaBaseUrl: enableLaya ? (layaBaseUrl.trim() || "http://127.0.0.1:8001") : undefined,
          credentials: effectiveCreds,
          maxScreens: Math.max(maxScreens, 8),
          checkBackNavigation: checkBackNav,
          checkResponsive,
          openRouterApiKey:
            aiProvider === "cloud"
              ? openRouterKey.trim() || undefined
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
              : "https://openrouter.ai/api/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start Full App Testing.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)
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
          uploadFilesDir: uploadFilesDir.trim() || undefined,
          postmanCollection: postmanObj,
          allowTestPayments,
          allowActions: effectiveAllowActions,
          role: journeyRole === "custom" ? customJourneyRole.trim() || "custom" : journeyRole,
          layaBaseUrl: enableLaya ? (layaBaseUrl.trim() || "http://127.0.0.1:8001") : undefined,
          credentials:
            username || password
              ? {
                  username: username.trim(),
                  password: password.trim(),
                }
              : undefined,
          maxScreens: Math.max(maxScreens, 6),
          checkBackNavigation: checkBackNav,
          checkResponsive,
          openRouterApiKey:
            aiProvider === "cloud"
              ? openRouterKey.trim() || undefined
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
              : "https://openrouter.ai/api/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start Feature / Workflow Testing.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)
      setTestingMode("feature_workflow")
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
                  href="/?view=editor"
                  className="w-full py-2 flex flex-col items-center justify-center relative transition group text-slate-500 hover:text-slate-200 cursor-pointer"
                  title="Design Review Editor"
                >
                  <Pencil className="h-5 w-5 transition group-hover:scale-105" />
                </Link>

                <div className="w-6 h-px bg-slate-800/80 my-0.5" />

                {/* Workspace Stage Switching Tabs */}
                {workspaceTabs.map((tab) => {
                  const Icon = tab.icon
                  const isActive = stageViewMode === tab.id
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

                {/* Toggle AI Bot Cockpit */}
                <button
                  type="button"
                  onClick={() => setIsBotPanelOpen((prev) => !prev)}
                  className={`p-2 rounded-lg transition cursor-pointer relative group ${
                    isBotPanelOpen
                      ? "text-indigo-400 bg-indigo-600/10"
                      : currentJob?.status === "running"
                      ? "text-amber-400 animate-pulse"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                  title={isBotPanelOpen ? "Close AI Testing Bot Dock" : "Open AI Testing Bot Dock"}
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

            {/* 1. CORE WORKSPACE: PHONE SIMULATOR PAGE OR FULL PAGE TABS */}
            <div className="flex-1 h-full w-full flex flex-col overflow-hidden relative">
              {stageViewMode !== "simulator" ? (
                /* FULL PAGE TAB VIEW: FEATURE / WORKFLOW TESTING OR FULL APP TESTING */
                <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-slate-950 relative">
                  {testingMode === "feature_workflow" ? (
                    <FeatureWorkflowView
                      job={currentJob}
                      isRunning={currentJob?.status === "running" || currentJob?.status === "queued" || isSubmitting}
                      targetUrl={targetUrl}
                      activeSubTab={stageViewMode}
                      onSubTabChange={(tab) => handleSelectWorkspaceTab(tab)}
                      onStartWorkflowTest={handleStartWorkflowTesting}
                      onCancelJob={handleStopAutomation}
                      onOpenMapPage={() => handleSelectWorkspaceTab("map")}
                      isMapPageActive={stageViewMode === "map"}
                      testingMode={testingMode}
                      onSelectTestingMode={(m) => setTestingMode(m)}
                      fullPageView={true}
                    />
                  ) : (
                    <FullAppTestingView
                      job={currentJob}
                      isRunning={currentJob?.status === "running" || currentJob?.status === "queued" || isSubmitting}
                      targetUrl={targetUrl}
                      onStartFullAppTest={handleStartFullAppTesting}
                      onCancelJob={handleStopAutomation}
                      onJobUpdate={(updated) => setCurrentJob(updated)}
                      activeSubTab={stageViewMode}
                      onSubTabChange={(tab) => handleSelectWorkspaceTab(tab)}
                      fullPageView={true}
                      hideSubNav={true}
                      onOpenMapPage={() => handleSelectWorkspaceTab("map")}
                      isMapPageActive={stageViewMode === "map"}
                      testingMode={testingMode}
                      onSelectTestingMode={(m) => setTestingMode(m)}
                    />
                  )}
                </div>
              ) : (
                /* PHONE SIMULATOR PAGE */
                <WorkflowSimulator
                    project={mergedSimulatorProject}
                    initialWorkflowId={activeWorkflowId}
                    initialLiveMode={false}
                    initialUrl={targetUrl}
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
                      if (mode === "dashboard") window.location.href = "/"
                      else if (mode === "editor") window.location.href = "/?view=editor"
                      else if (mode === "simulator") window.location.href = "/?view=simulator"
                    }}
                  />
              )}
            </div>

            {/* 2. DOCKED AI AUTOMATION TESTING COCKPIT (Slides out from right) */}
            {isBotPanelOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs lg:hidden"
                  onClick={() => setIsBotPanelOpen(false)}
                />
                <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md lg:static lg:z-20 lg:w-[460px] lg:max-w-none shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col h-full shadow-2xl overflow-hidden animate-in slide-in-from-right-6 duration-200">
                {/* Dock Header */}
                <div className="h-11 px-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-indigo-400" />
                    <span className="text-xs font-bold text-white tracking-tight">AI Testing Bot & Audit</span>
                    {currentJob && (
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase ${
                          currentJob.status === "running"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : currentJob.status === "completed"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {currentJob.status}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsBotPanelOpen(false)}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                    title="Hide AI Bot panel" aria-label="Hide AI Bot panel"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>

                {/* Dock Tab Selector */}
                <div className="grid grid-cols-4 p-1.5 bg-slate-900 border-b border-slate-800 text-[11px] font-semibold shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveDockTab("chat")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 transition cursor-pointer ${
                      activeDockTab === "chat"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDockTab("config")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 transition cursor-pointer ${
                      activeDockTab === "config"
                        ? "bg-purple-600 text-white shadow-sm"
                        : "text-purple-400 hover:text-white hover:bg-purple-950/40"
                    }`}
                  >
                    <Settings className="h-3.5 w-3.5 text-purple-400" />
                    <span>Config</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDockTab("crawl")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 transition cursor-pointer ${
                      activeDockTab === "crawl"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Crawler</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDockTab("report")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1 transition cursor-pointer ${
                      activeDockTab === "report"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Activity className="h-3.5 w-3.5" />
                    <span>Report</span>
                  </button>
                </div>

                {/* TAB 1: CHAT COMMANDS */}
                {activeDockTab === "chat" && (
                  <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
                    {/* Chat Tab Top Bar: Provider badge & Model info + Direct Config Button + Clear Chat */}
                    <div className="px-3 py-1.5 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setActiveDockTab("config")}
                        className="flex items-center gap-1.5 min-w-0 px-2 py-1 rounded-md bg-purple-950/40 hover:bg-purple-900/50 border border-purple-700/50 text-left transition cursor-pointer group"
                        title="Click to configure AI Provider, Model, and API Key"
                      >
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                        <span className="font-semibold text-white truncate text-[10px]">
                          {aiProvider === "omnirouter"
                            ? "OmniRouter"
                            : aiProvider === "local"
                            ? "Local Ollama"
                            : "OpenRouter"}
                        </span>
                        <span className="text-[10px] text-purple-300 font-mono truncate max-w-[120px]">
                          ({aiProvider === "omnirouter" ? omniRouterModel : selectedAiModel.split("/").pop()})
                        </span>
                        <Settings className="h-3 w-3 text-purple-400 opacity-70 group-hover:opacity-100 transition-opacity ml-0.5 shrink-0" />
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setActiveDockTab("config")}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold text-purple-300 hover:text-white bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 transition cursor-pointer"
                        >
                          ⚙ Config
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setChatHistory([
                              {
                                id: `welcome-${Date.now()}`,
                                sender: "agent",
                                text: "Chat history cleared. Send a prompt or run a quick command to start testing.",
                                timestamp: new Date().toISOString(),
                                status: "completed",
                              },
                            ])
                          }}
                          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                          title="Clear chat history"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                      {/* Chat messages stream */}
                      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar text-xs">
                        {chatHistory.map((msg) => {
                          const isUser = msg.sender === "user"
                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                            >
                              <div className="flex items-center gap-1.5 mb-1 px-1">
                                {isUser ? (
                                  <>
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      {msg.timestamp?.slice(11, 19) || ""}
                                    </span>
                                    <span className="text-[10px] font-semibold text-slate-300">You</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] text-white">
                                      <Bot className="h-2.5 w-2.5" />
                                    </div>
                                    <span className="text-[10px] font-semibold text-indigo-400">Testing Bot</span>
                                    <span className="text-[10px] text-slate-500 font-mono">
                                      {msg.timestamp?.slice(11, 19) || ""}
                                    </span>
                                  </>
                                )}
                              </div>

                              <div
                                className={`rounded-xl px-3 py-2 max-w-[92%] leading-relaxed ${
                                  isUser
                                    ? "bg-indigo-600 text-white rounded-tr-none shadow-sm"
                                    : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none space-y-2 shadow-sm"
                                }`}
                              >
                                {msg.imageUrl && (
                                  <div
                                    className="relative group rounded-lg overflow-hidden border border-slate-700 max-w-[260px] cursor-pointer my-1.5"
                                    onClick={() => setImagePreviewModal(msg.imageUrl!)}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={msg.imageUrl}
                                      alt="Screen attachment"
                                      className="w-full h-auto object-cover max-h-36"
                                    />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 text-[11px] text-white transition">
                                      <ZoomIn className="h-3.5 w-3.5" />
                                      <span>View Full Image</span>
                                    </div>
                                  </div>
                                )}

                                {msg.status === "thinking" ? (
                                  <div className="flex items-center gap-2 text-indigo-300 font-medium">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
                                    <span>{msg.text}</span>
                                  </div>
                                ) : (
                                  <p className="whitespace-pre-wrap">{msg.text}</p>
                                )}

                                {/* Thinking Model Card */}
                                {msg.thinkingModel && (
                                  <div className="mt-2 p-2.5 rounded-lg bg-slate-950/80 border border-purple-500/30 text-xs space-y-2">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <div className="flex items-center gap-1.5 text-purple-400 font-semibold">
                                        <Brain className="h-3.5 w-3.5" />
                                        <span>AI Thinking Model</span>
                                      </div>
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 font-mono">
                                        Cognitive Architecture
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-300 leading-snug">
                                      {msg.thinkingModel.screenUnderstanding}
                                    </div>
                                    {msg.thinkingModel.identifiedElements &&
                                      msg.thinkingModel.identifiedElements.length > 0 && (
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-slate-400 font-medium block">
                                            Detected UI Elements:
                                          </span>
                                          <div className="flex flex-wrap gap-1">
                                            {msg.thinkingModel.identifiedElements.map((el, elIdx) => (
                                              <span
                                                key={elIdx}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-slate-900 border border-slate-800 text-slate-300"
                                                title={el.purpose}
                                              >
                                                <span className="text-purple-400 font-bold uppercase">
                                                  {el.type}
                                                </span>
                                                <span>{el.name}</span>
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    {msg.thinkingModel.riskAssessment &&
                                      msg.thinkingModel.riskAssessment.length > 0 && (
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-amber-400 font-medium flex items-center gap-1">
                                            <ShieldAlert className="h-3 w-3" />
                                            <span>QA Risk & Edge Cases:</span>
                                          </span>
                                          <ul className="list-disc list-inside text-[10px] text-slate-400 space-y-0.5">
                                            {msg.thinkingModel.riskAssessment.slice(0, 3).map((r, rIdx) => (
                                              <li key={rIdx}>{r}</li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                  </div>
                                )}

                                {/* Checklist Component */}
                                {msg.checklist && msg.checklist.length > 0 && (
                                  <div className="mt-2 p-2.5 rounded-lg bg-slate-950/90 border border-indigo-500/30 space-y-2">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <div className="flex items-center gap-1.5 text-indigo-400 font-semibold">
                                        <CheckSquare className="h-3.5 w-3.5" />
                                        <span>UI Test Checklist</span>
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-mono">
                                        {msg.checklist.filter((t) => t.status === "passed").length}/
                                        {msg.checklist.length} Passed
                                      </span>
                                    </div>

                                    {/* Progress bar */}
                                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
                                        style={{
                                          width: `${(msg.checklist.filter((t) => t.status === "passed").length / msg.checklist.length) * 100}%`,
                                        }}
                                      />
                                    </div>

                                    {/* Test Items */}
                                    <div className="space-y-1.5 pt-1">
                                      {msg.checklist.map((test, tIdx) => (
                                        <div
                                          key={test.id || tIdx}
                                          className={`p-2 rounded border text-[11px] space-y-1 transition ${
                                            test.status === "passed"
                                              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                                              : test.status === "failed"
                                              ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                                              : test.status === "running"
                                              ? "bg-indigo-950/30 border-indigo-500/50 text-indigo-200 animate-pulse"
                                              : "bg-slate-900 border-slate-800 text-slate-300"
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-1.5">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                              {test.status === "passed" ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                              ) : test.status === "failed" ? (
                                                <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                                              ) : test.status === "running" ? (
                                                <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin shrink-0" />
                                              ) : (
                                                <Clock className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                              )}
                                              <span className="font-semibold truncate">{test.title}</span>
                                            </div>
                                            <span
                                              className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                                                test.status === "passed"
                                                  ? "bg-emerald-500/20 text-emerald-300"
                                                  : test.status === "failed"
                                                  ? "bg-rose-500/20 text-rose-300"
                                                  : test.status === "running"
                                                  ? "bg-indigo-500/20 text-indigo-300"
                                                  : "bg-slate-800 text-slate-400"
                                              }`}
                                            >
                                              {test.status}
                                            </span>
                                          </div>

                                          <div className="text-[10px] text-slate-400 leading-tight">
                                            {test.goal}
                                          </div>

                                          {test.screenshotUrl && (
                                            <div
                                              className="mt-1 inline-block cursor-pointer border border-slate-700 rounded overflow-hidden"
                                              onClick={() => setImagePreviewModal(test.screenshotUrl!)}
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={test.screenshotUrl}
                                                alt={test.title}
                                                className="h-14 w-auto object-cover hover:opacity-80 transition"
                                              />
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* If agent executed actions, show chips */}
                                {msg.actionsExecuted && msg.actionsExecuted.length > 0 && (
                                  <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                                    <span className="text-[10px] text-slate-400 font-semibold block">
                                      Executed Actions:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {msg.actionsExecuted.map((act, idx) => (
                                        <span
                                          key={idx}
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] bg-slate-950 border border-slate-800 font-mono text-slate-300"
                                        >
                                          <span className="uppercase text-indigo-400 font-bold">{act.type}</span>
                                          <span className="text-slate-400 truncate max-w-[130px]">
                                            {act.selector || act.description}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {/* Interactive Verification Prompt Card in Chat */}
                        {currentJob && currentJob.verificationState === "awaiting_verification" && (
                          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/50 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-amber-200 flex items-center gap-1.5">
                                <Mail className="h-3.5 w-3.5 text-amber-400" />
                                Action Required: Confirm Email / Verification
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">Paused</span>
                            </div>
                            <p className="text-[11px] text-slate-300">
                              {currentJob.verificationPrompt || "Please click the confirmation link or enter the verification URL/code below."}
                            </p>
                            <div className="space-y-1.5">
                              <input
                                type="url"
                                value={verificationUrlInput}
                                onChange={(e) => setVerificationUrlInput(e.target.value)}
                                placeholder="Verification / Magic Link URL"
                                className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2 py-1 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                              />
                              <input
                                type="text"
                                value={verificationCodeInput}
                                onChange={(e) => setVerificationCodeInput(e.target.value)}
                                placeholder="OTP / Code (if applicable)"
                                className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2 py-1 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isSubmittingVerification}
                                onClick={() => handleConfirmVerification()}
                                className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                              >
                                {isSubmittingVerification ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                <span>I&apos;ve Completed Verification</span>
                              </button>
                              <button
                                type="button"
                                disabled={isSubmittingVerification}
                                onClick={handleSkipVerification}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                              >
                                Skip
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Interactive Settings Credentials Form in Chat */}
                        {currentJob && currentJob.settingsState === "awaiting_credentials" && (
                          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/50 space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                                <Key className="h-3.5 w-3.5 text-indigo-400" />
                                Action Required: Enter Application Settings Secrets
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">Protected</span>
                            </div>
                            <p className="text-[11px] text-slate-300">
                              {currentJob.settingsPrompt || "Enter credentials to configure application settings. Secrets are redacted and never logged."}
                            </p>
                            <div className="space-y-1.5">
                              {(currentJob.requiredSettingsFields && currentJob.requiredSettingsFields.length > 0
                                ? currentJob.requiredSettingsFields
                                : [{ key: "apiKey", label: "API Key", isSecret: true, placeholder: "sk-..." }]
                              ).map((field) => (
                                <div key={field.key} className="space-y-0.5">
                                  <label className="text-[10px] text-slate-300 block">{field.label}</label>
                                  <input
                                    type={field.isSecret && !showSettingsSecrets[field.key] ? "password" : "text"}
                                    value={settingsFormValues[field.key] || ""}
                                    onChange={(e) => setSettingsFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                    placeholder={field.placeholder || `Enter ${field.label}`}
                                    className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded px-2 py-1 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={isSubmittingSettings}
                                onClick={handleSaveSettingsCredentials}
                                className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                              >
                                {isSubmittingSettings ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                <span>Save &amp; Resume</span>
                              </button>
                              <button
                                type="button"
                                disabled={isSubmittingSettings}
                                onClick={handleSkipSettingsCredentials}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                              >
                                Skip
                              </button>
                            </div>
                          </div>
                        )}

                        <div ref={chatBottomRef} />
                      </div>

                      {/* Quick Prompt Presets - Sleek Collapsible Drawer */}
                      <div className="px-3 py-1.5 border-t border-slate-800/80 bg-slate-950/90 text-xs">
                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setIsQuickActionsOpen((prev) => !prev)}
                            className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer group"
                            title="Toggle Quick Commands & Project Route Chips"
                          >
                            <Wand2 className="h-3 w-3 text-indigo-400 group-hover:rotate-12 transition-transform" />
                            <span>Quick Actions ({6 + discoveredRoutes.length})</span>
                            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isQuickActionsOpen ? "rotate-180" : ""}`} />
                          </button>

                          {/* 2 Primary Fast Action Chips when collapsed */}
                          {!isQuickActionsOpen && (
                            <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  setTestingMode("feature_workflow")
                                  handleSelectWorkspaceTab("plan")
                                }}
                                disabled={isSendingChat || isSubmitting}
                                className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-600/30 border border-purple-500 text-purple-200 hover:bg-purple-600 hover:text-white transition cursor-pointer truncate disabled:opacity-50"
                              >
                                🎯 Feature Test
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartFullAppTesting()}
                                disabled={isSendingChat || isSubmitting}
                                className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-600/30 border border-indigo-500 text-indigo-200 hover:bg-indigo-600 hover:text-white transition cursor-pointer truncate disabled:opacity-50"
                              >
                                🚀 Full App Test
                              </button>
                            </div>
                          )}

                          {chatHistory.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setChatHistory([
                                  {
                                    id: `welcome-${Date.now()}`,
                                    sender: "agent",
                                    text: "Chat cleared. Give a command or select a preset to start browser testing.",
                                    timestamp: new Date().toISOString(),
                                    status: "completed",
                                  },
                                ])
                              }
                              className="text-[9px] text-slate-500 hover:text-rose-400 flex items-center gap-1 transition cursor-pointer shrink-0 ml-auto"
                              title="Clear chat history"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              <span>Clear</span>
                            </button>
                          )}
                        </div>

                        {/* Expanded Drawer: All Chips + Target Project Routes */}
                        {isQuickActionsOpen && (
                          <div className="pt-2 space-y-2 animate-in fade-in-50 duration-150">
                            <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                              {[
                                "🎯 Test creating a new task",
                                "👤 Test the registration flow",
                                "🚀 Full App Testing (Map & Plan First)",
                                "🖼️ Test uploading profile picture",
                                "🔄 Test All Clickable Options",
                                "🧠 Analyze Screen & Build UI Checklist",
                                "Audit viewports (390px, 768px, 1440px)",
                              ].map((chip, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    if (chip.includes("Full App Testing")) {
                                      handleStartFullAppTesting()
                                    } else if (chip.includes("Test creating a new task") || chip.includes("Test the registration flow") || chip.includes("Test uploading profile picture")) {
                                      const prompt = chip.replace(/^[^\s]+\s+/, "")
                                      setWorkflowPromptInput(prompt)
                                      setTestingMode("feature_workflow")
                                      handleStartWorkflowTesting(prompt)
                                    } else {
                                      handleSendChatCommand(chip)
                                    }
                                  }}
                                  disabled={isSendingChat || isSubmitting}
                                  className={`shrink-0 px-2 py-1 rounded-md border text-[10px] transition cursor-pointer disabled:opacity-50 ${
                                    chip.startsWith("🎯") || chip.startsWith("👤") || chip.startsWith("🖼️")
                                      ? "bg-purple-950/50 border-purple-500/60 text-purple-200 font-bold hover:bg-purple-600 hover:text-white"
                                      : chip.includes("Full App")
                                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold hover:bg-indigo-600 hover:text-white"
                                      : "bg-slate-900 border-slate-800 hover:border-indigo-500 hover:bg-indigo-950/30 text-slate-300 hover:text-white"
                                  }`}
                                >
                                  {chip}
                                </button>
                              ))}
                            </div>

                            {/* Project Routes Presets with Target Project Switcher */}
                            <div className="pt-1.5 border-t border-slate-800/60 space-y-1.5">
                              <div className="flex items-center justify-between text-[10px] text-slate-400 gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <Layers className="h-3 w-3 text-indigo-400 shrink-0" />
                                  <span className="font-semibold text-slate-300 shrink-0">Target Project:</span>
                                  <select
                                    value={selectedProjectDir}
                                    onChange={(e) => handleSelectTestingProject(e.target.value)}
                                    className="bg-slate-950 border border-slate-700 hover:border-indigo-500 rounded px-1.5 py-0.5 text-[10px] text-indigo-300 font-mono outline-none cursor-pointer max-w-[170px] truncate"
                                    title="Switch local testing project to load its routes"
                                  >
                                    {availableProjects.map((p) => (
                                      <option key={p.name} value={p.name}>
                                        {p.name} {p.defaultPort ? `(:${p.defaultPort})` : ""}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => fetchLocalRoutes()}
                                  disabled={isScanningRoutes}
                                  className="text-[9px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer shrink-0"
                                  title="Rescan target project routes"
                                >
                                  <RotateCcw className={`h-2.5 w-2.5 ${isScanningRoutes ? "animate-spin" : ""}`} />
                                  <span>Rescan</span>
                                </button>
                              </div>
                              {discoveredRoutes.length > 0 && (
                                <div className="flex gap-1 overflow-x-auto pb-0.5 custom-scrollbar">
                                  {discoveredRoutes.map((r, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setTargetUrl(r.url)
                                        handleSendChatCommand(`Test and inspect route ${r.path}`)
                                      }}
                                      disabled={isSendingChat}
                                      className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 hover:bg-indigo-950/40 text-slate-300 hover:text-white border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer disabled:opacity-50"
                                      title={`Click to test: ${r.path} (${r.url})`}
                                    >
                                      {r.path}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Attached Image Preview */}
                      {attachedImage && (
                        <div className="px-3 pt-2 pb-1 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={attachedImage}
                              alt="Attached"
                              className="h-8 w-8 rounded object-cover border border-slate-700"
                            />
                            <span className="text-[11px] text-slate-300">
                              Screen Image Attached
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachedImage(null)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                            title="Remove attachment"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {/* Chat Input Bar */}
                      <div className="p-2.5 border-t border-slate-800 bg-slate-900/60">
                        {commandQueue.length > 0 && (
                          <div className="mb-2 space-y-1">
                            <div className="text-[10px] text-slate-400 flex items-center gap-1">
                              <Clock className="h-3 w-3 text-amber-400" />
                              <span>Queued ({commandQueue.length}) - runs after current test</span>
                            </div>
                            {commandQueue.map((q, i) => (
                              <div
                                key={q.id}
                                className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-slate-950 border border-amber-500/30 text-[11px] text-slate-300"
                              >
                                <span className="truncate">
                                  {i + 1}. {q.text || "(image)"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setCommandQueue((cq) => cq.filter((x) => x.id !== q.id))}
                                  className="text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                                  title="Remove from queue"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleImageFileChange}
                          accept="image/*"
                          className="hidden"
                        />
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            handleSendChatCommand()
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isSendingChat}
                            className="p-2 rounded-lg bg-slate-950 border border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 transition cursor-pointer shrink-0 disabled:opacity-50"
                            title="Upload Mockup / Screenshot Image"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCaptureCurrentScreen}
                            disabled={isSendingChat}
                            className="p-2 rounded-lg bg-slate-950 border border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 transition cursor-pointer shrink-0 disabled:opacity-50"
                            title="Capture current screen & test"
                          >
                            <ImageIcon className="h-3.5 w-3.5 text-indigo-400" />
                          </button>

                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              placeholder={
                                attachedImage
                                  ? "Add instructions for attached image or hit Send..."
                                  : "Give command (e.g. 'Test signup page')..."
                              }
                              disabled={isSendingChat}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                            />
                            {isSendingChat && (
                              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-indigo-400 animate-spin" />
                            )}
                          </div>
                          <button
                            type="submit"
                            disabled={(!chatInput.trim() && !attachedImage) || isSendingChat}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white p-2 rounded-lg transition shadow-md shadow-indigo-600/20 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            title={currentJob?.status === "running" || currentJob?.status === "queued" ? "Queue message (runs after current test)" : "Send command"}
                          >
                            {currentJob?.status === "running" || currentJob?.status === "queued" ? (
                              <Clock className="h-3.5 w-3.5" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {(currentJob?.status === "running" || currentJob?.status === "queued") && (
                            <button
                              type="button"
                              onClick={() => {
                                setCommandQueue([])
                                handleStopAutomation()
                              }}
                              className="bg-rose-600 hover:bg-rose-500 text-white p-2 rounded-lg transition shadow-md shadow-rose-600/20 cursor-pointer shrink-0"
                              title="Stop test (clears queued messages)"
                            >
                              <Square className="h-3.5 w-3.5 fill-current" />
                            </button>
                          )}
                        </form>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: DEDICATED AI CONFIGURATION PANEL */}
                  {activeDockTab === "config" && (
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-950 text-xs">
                      {/* Header Banner */}
                      <div className="p-3 rounded-xl bg-gradient-to-r from-purple-950/60 via-slate-900 to-indigo-950/50 border border-purple-500/30 shadow-md">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 shrink-0">
                            <Settings className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-xs font-bold text-white">AI Vision & Automation Engine</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                              Configure the AI model and provider driving simulator visual testing, screen reasoning, and crawler audits.
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Provider Selection Cards */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          <span>Select AI Provider</span>
                          <span className="font-mono text-purple-400 lowercase font-normal">
                            current: {aiProvider}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {/* Cloud (OpenRouter) */}
                          <button
                            type="button"
                            onClick={() => handleUpdateAiProvider("cloud")}
                            className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
                              aiProvider === "cloud"
                                ? "bg-purple-950/50 border-purple-500 text-white shadow-md shadow-purple-950/40 ring-1 ring-purple-400/40"
                                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-[11px] text-purple-300">Cloud AI</span>
                              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-purple-900/60 text-purple-200">
                                Top Vision
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
                              OpenRouter (Gemini, Claude, GPT-4o)
                            </div>
                          </button>

                          {/* OmniRouter / UnoRouter */}
                          <button
                            type="button"
                            onClick={() => handleUpdateAiProvider("omnirouter")}
                            className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
                              aiProvider === "omnirouter"
                                ? "bg-indigo-950/50 border-indigo-500 text-white shadow-md shadow-indigo-950/40 ring-1 ring-indigo-400/40"
                                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-[11px] text-indigo-300">Gateway</span>
                              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-indigo-900/60 text-indigo-200">
                                Combo
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
                              OmniRouter / UnoRouter (Local :20128)
                            </div>
                          </button>

                          {/* Local (Ollama) */}
                          <button
                            type="button"
                            onClick={() => handleUpdateAiProvider("local")}
                            className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition cursor-pointer ${
                              aiProvider === "local"
                                ? "bg-emerald-950/50 border-emerald-500 text-white shadow-md shadow-emerald-950/40 ring-1 ring-emerald-400/40"
                                : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-[11px] text-emerald-300">Local AI</span>
                              <span className="text-[8px] font-mono uppercase px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-200">
                                Offline
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1.5 leading-tight">
                              Ollama (Llama 3.2, Qwen-VL)
                            </div>
                          </button>
                        </div>
                      </div>

                      {/* Detailed Provider Form */}
                      {aiProvider === "cloud" && (
                        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-200 text-xs">OpenRouter Cloud Settings</span>
                            <a
                              href="https://openrouter.ai/keys"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 underline underline-offset-2"
                            >
                              <span>Get Free Key</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>

                          {/* API Key */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400 flex items-center justify-between">
                              <span>OpenRouter API Key</span>
                              {openRouterKey.trim() && (
                                <span className="text-emerald-400 text-[9px] flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Key saved
                                </span>
                              )}
                            </label>
                            <input
                              type="password"
                              value={openRouterKey}
                              onChange={(e) => handleUpdateOpenRouterKey(e.target.value)}
                              placeholder="sk-or-v1-..."
                              className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none transition-colors"
                            />
                          </div>

                          {/* Model Dropdown */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400">
                              Selected Model Preset
                            </label>
                            <select
                              value={selectedAiModel}
                              onChange={(e) => handleUpdateAiModel(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500 rounded-lg px-2.5 py-2 text-[11px] text-white cursor-pointer focus:outline-none transition-colors"
                            >
                              <option value="google/gemini-2.0-flash-001">⚡ Gemini 2.0 Flash (Fastest + Vision QA)</option>
                              <option value="anthropic/claude-3.5-sonnet">🧠 Claude 3.5 Sonnet (Deep Reasoning & QA)</option>
                              <option value="openai/gpt-4o-mini">🎯 OpenAI GPT-4o Mini (High Reliability)</option>
                              <option value="deepseek/deepseek-chat">💎 DeepSeek V3 (Low Cost / Strong Code QA)</option>
                              <option value="meta-llama/llama-3.2-11b-vision-instruct:free">🆓 Llama 3.2 11B Vision (Free)</option>
                            </select>
                          </div>

                          {/* Custom Model Input */}
                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-400">
                              Custom Model ID:
                            </label>
                            <input
                              type="text"
                              value={selectedAiModel}
                              onChange={(e) => handleUpdateAiModel(e.target.value)}
                              placeholder="e.g. google/gemini-2.5-pro, mistralai/mistral-large"
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-purple-500 transition-colors"
                            />
                          </div>
                        </div>
                      )}

                      {aiProvider === "omnirouter" && (
                        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-200 text-xs">OmniRouter Gateway Settings</span>
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
                              OpenAI Compatible
                            </span>
                          </div>

                          {/* Presets */}
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                handleUpdateOmniRouterUrl("https://api.unorouter.com/v1")
                                handleUpdateOmniRouterModel("deepseek-v4-flash:free")
                              }}
                              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer text-center ${
                                omniRouterBaseUrl.includes("unorouter")
                                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold"
                                  : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                              }`}
                            >
                              UnoRouter (Free Cloud)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleUpdateOmniRouterUrl("http://localhost:20128/v1")
                                handleUpdateOmniRouterModel("fast")
                              }}
                              className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold border transition cursor-pointer text-center ${
                                omniRouterBaseUrl.includes("20128")
                                  ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold"
                                  : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                              }`}
                            >
                              OmniRoute (Local :20128)
                            </button>
                          </div>

                          {/* Gateway URL */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400">
                              Gateway Base URL
                            </label>
                            <input
                              type="text"
                              value={omniRouterBaseUrl}
                              onChange={(e) => handleUpdateOmniRouterUrl(e.target.value)}
                              placeholder="https://api.unorouter.com/v1"
                              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
                            />
                          </div>

                          {/* Key */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400 flex items-center justify-between">
                              <span>Gateway API Key</span>
                              <span className="text-[9px] text-slate-500">Free key at unorouter.com/token</span>
                            </label>
                            <input
                              type="password"
                              value={omniRouterKey}
                              onChange={(e) => handleUpdateOmniRouterKey(e.target.value)}
                              placeholder="Bearer key or token..."
                              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono placeholder-slate-600 focus:outline-none transition-colors"
                            />
                          </div>

                          {/* Model */}
                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400">
                              Model Identifier
                            </label>
                            <input
                              type="text"
                              value={omniRouterModel}
                              onChange={(e) => handleUpdateOmniRouterModel(e.target.value)}
                              placeholder="fast, ddgw/gpt-5.4-mini, deepseek-v4-flash:free"
                              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
                            />
                            <div className="flex flex-wrap gap-1 pt-1">
                              {["fast", "deepseek-v4-flash:free", "ddgw/gpt-5.4-mini", "ddgw/claude-haiku-4-5"].map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => handleUpdateOmniRouterModel(m)}
                                  className={`px-2 py-0.5 rounded text-[9px] font-mono cursor-pointer transition ${
                                    omniRouterModel === m
                                      ? "bg-indigo-600 text-white font-bold"
                                      : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {aiProvider === "local" && (
                        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-200 text-xs">Ollama Local Settings</span>
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
                              Private & Offline
                            </span>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400">
                              Ollama Server URL
                            </label>
                            <input
                              type="text"
                              value={localAiBaseUrl}
                              onChange={(e) => handleUpdateLocalBaseUrl(e.target.value)}
                              placeholder="http://localhost:11434/v1"
                              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-[11px] text-white font-mono focus:outline-none transition-colors"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-semibold text-slate-400">
                              Local Model
                            </label>
                            <select
                              value={selectedAiModel}
                              onChange={(e) => handleUpdateAiModel(e.target.value)}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-2 text-[11px] text-white cursor-pointer focus:outline-none transition-colors"
                            >
                              <option value="llama3.2-vision">llama3.2-vision (Meta Vision)</option>
                              <option value="qwen2-vl">qwen2-vl (Qwen Vision)</option>
                              <option value="llava">llava (LLaVA)</option>
                              <option value="mistral">mistral (Mistral 7B)</option>
                            </select>
                          </div>
                          <p className="text-[10px] text-slate-500">
                            Ensure Ollama is running locally: <code className="text-emerald-400 font-mono">ollama run llama3.2-vision</code>
                          </p>
                        </div>
                      )}

                      {/* Test Connection Button & Result */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleTestAiConnection}
                            disabled={isTestingAiConnection}
                            className="flex-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 border border-slate-700"
                          >
                            {isTestingAiConnection ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                                <span>Testing Connection...</span>
                              </>
                            ) : (
                              <>
                                <Activity className="h-3.5 w-3.5 text-purple-400" />
                                <span>Test AI Connection</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveDockTab("chat")}
                            className="py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow-sm cursor-pointer shrink-0"
                          >
                            Save & Open Chat →
                          </button>
                        </div>

                        {aiConnectionTestResult && (
                          <div
                            className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 animate-in fade-in-50 duration-150 ${
                              aiConnectionTestResult.success
                                ? "bg-emerald-950/40 border-emerald-500/50 text-emerald-200"
                                : "bg-rose-950/40 border-rose-500/50 text-rose-200"
                            }`}
                          >
                            {aiConnectionTestResult.success ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                            )}
                            <span className="leading-tight">{aiConnectionTestResult.message}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* TAB 3: CRAWLER / TEST MODES */}
                  {activeDockTab === "crawl" && (
                    <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
                      {/* Mode Switcher */}
                      <div className="p-1 rounded-xl bg-slate-900 border border-slate-800 grid grid-cols-2 gap-1 text-[11px] font-bold">
                        <button
                          type="button"
                          onClick={() => setTestingMode("feature_workflow")}
                          className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            testingMode === "feature_workflow"
                              ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          <Sparkles className="h-3 w-3 text-indigo-300" />
                          <span>Feature / Workflow</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTestingMode("full_app")}
                          className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            testingMode === "full_app"
                              ? "bg-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          <Compass className="h-3 w-3 text-indigo-400" />
                          <span>Full App Test</span>
                        </button>
                      </div>

                      {/* Configuration Form */}
                      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
                        {/* If in Feature Workflow Mode: Ask what workflow or feature to test */}
                        {testingMode === "feature_workflow" && (
                          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-2.5">
                            <div>
                              <label className="text-[11px] font-bold text-white flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                                <span>What workflow or feature would you like to test?</span>
                              </label>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                Describe it naturally. The AI will extract the goal, locate relevant screens, and generate a pre-flight test plan.
                              </p>
                            </div>

                            <textarea
                              value={workflowPromptInput}
                              onChange={(e) => setWorkflowPromptInput(e.target.value)}
                              placeholder="e.g. Test creating a new task, or test registration flow..."
                              rows={2}
                              className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-lg p-2 text-xs text-white placeholder-slate-500 resize-none outline-none font-sans"
                            />

                            {/* Quick Presets */}
                            <div className="space-y-1">
                              <span className="text-[10px] text-slate-400 font-semibold block">Quick Examples:</span>
                              <div className="flex flex-wrap gap-1">
                                {[
                                  { label: "📝 Create New Task", prompt: "I want to test creating a new task." },
                                  { label: "👤 Registration Flow", prompt: "Test the registration flow." },
                                  { label: "🖼️ Upload Avatar", prompt: "Test whether a user can upload a profile picture." },
                                  { label: "💳 Checkout Process", prompt: "Test the checkout process from adding a product to completing payment." },
                                  { label: "🔑 Reset Password", prompt: "Test login, forgot password, and resetting the password." },
                                  { label: "🏥 Caregiver", prompt: "Test caregiver registration and completing the first activity." },
                                ].map((item, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setWorkflowPromptInput(item.prompt)}
                                    className="px-2 py-0.5 rounded text-[10px] bg-slate-900 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-500/50 text-slate-300 hover:text-white transition cursor-pointer"
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="pt-1 flex items-center justify-between text-[10px]">
                              <button
                                type="button"
                                onClick={() => handleSelectWorkspaceTab("plan")}
                                className="text-indigo-400 hover:text-indigo-300 underline font-medium cursor-pointer"
                              >
                                View Workflow Plan Workspace →
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                            <span>Target App URL</span>
                            <span className="text-[10px] text-slate-500">
                              {testingMode === "feature_workflow" ? "Entry point for feature" : "Auto-crawls internal pages"}
                            </span>
                          </label>
                          <div className="relative">
                            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                            <input
                              type="url"
                              value={targetUrl}
                              onChange={(e) => {
                                const newUrl = e.target.value
                                setTargetUrl(newUrl)
                                localStorage.setItem("ai_target_app_url", newUrl)
                                fetchLocalRoutes(selectedProjectDir, newUrl)
                              }}
                              placeholder="http://localhost:3001"
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                        </div>

                        {/* Discovered Local Routes Picker from Filesystem */}
                        {discoveredRoutes.length > 0 && (
                          <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="font-semibold text-slate-300 flex items-center gap-1">
                                <Layers className="h-3 w-3 text-indigo-400" />
                                <span>Project Routes ({discoveredRoutes.length})</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => fetchLocalRoutes()}
                                disabled={isScanningRoutes}
                                className="text-[9px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer"
                                title="Rescan local project files"
                              >
                                <RotateCcw className={`h-2.5 w-2.5 ${isScanningRoutes ? "animate-spin" : ""}`} />
                                <span>Rescan</span>
                              </button>
                            </div>

                            <div className="flex flex-wrap gap-1">
                              {discoveredRoutes.map((r, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setTargetUrl(r.url)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                                    targetUrl === r.url
                                      ? "bg-indigo-600 text-white shadow-sm"
                                      : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                                  }`}
                                  title={`Source File: ${r.file}`}
                                >
                                  {r.path}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Crawl limit slider */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400 text-[11px]">Crawl limit:</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="1"
                              max="10"
                              value={maxScreens}
                              onChange={(e) => setMaxScreens(Number(e.target.value))}
                              className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                            />
                            <span className="font-mono text-indigo-400 font-semibold text-[11px] w-12 text-right">
                              {maxScreens} screens
                            </span>
                          </div>
                        </div>

                        {/* Journey Role Selector */}
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                            <span>Journey Role</span>
                            <span className="text-[10px] text-indigo-400 font-mono">Laya System-1</span>
                          </label>
                          <div className="flex flex-wrap gap-1">
                            {(["user", "admin", "client", "editor", "custom"] as const).map((r) => (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setJourneyRole(r)}
                                className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase transition cursor-pointer ${
                                  journeyRole === r
                                    ? "bg-indigo-600 text-white shadow-xs font-semibold"
                                    : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-white"
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                          {journeyRole === "custom" && (
                            <input
                              type="text"
                              value={customJourneyRole}
                              onChange={(e) => setCustomJourneyRole(e.target.value)}
                              placeholder="Custom role (e.g. VIP Member)"
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white placeholder-slate-500 mt-1"
                            />
                          )}
                        </div>

                        {/* Laya Fast Decision Reflexes Card (Optional Toggle) */}
                        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2 text-[11px]">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={enableLaya}
                                onChange={(e) => handleToggleLaya(e.target.checked)}
                                className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 h-3.5 w-3.5 cursor-pointer"
                              />
                              <span className="text-slate-300 font-medium">Use Laya Reflexes</span>
                              <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Optional</span>
                            </label>
                            <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${
                              !enableLaya
                                ? "bg-slate-900 text-slate-500 border border-slate-800"
                                : isLayaLive
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            }`}>
                              {!enableLaya ? "Off (Heuristic)" : isLayaLive ? "Ready (~30ms)" : "Offline"}
                            </span>
                          </div>

                          {enableLaya && (
                            <div className="pt-1.5 border-t border-slate-900 space-y-1">
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>Laya Gateway URL</span>
                                <span className="text-slate-500 font-mono text-[9px]">e.g. port 8001</span>
                              </div>
                              <input
                                type="text"
                                value={layaBaseUrl}
                                onChange={(e) => handleUpdateLayaUrl(e.target.value)}
                                placeholder="http://127.0.0.1:8001"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white font-mono"
                              />
                            </div>
                          )}
                        </div>

                        {/* Credentials Toggle */}
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowCredentials((prev) => !prev)}
                            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-400 transition cursor-pointer"
                          >
                            <Key className="h-3 w-3" />
                            <span>{showCredentials ? "Hide Credentials" : "Add Login Credentials"}</span>
                            <ChevronDown className={`h-3 w-3 transition-transform ${showCredentials ? "rotate-180" : ""}`} />
                          </button>

                          {showCredentials && (
                            <div className="mt-2 p-2.5 rounded-lg bg-slate-950 border border-slate-800 grid grid-cols-2 gap-2 text-xs">
                              <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Email / User"
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white"
                              />
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white"
                              />
                            </div>
                          )}
                        </div>

                        {/* Active AI Model Info Card */}
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                            <span className="text-slate-400">AI Engine:</span>
                            <span className="font-semibold text-white truncate">
                              {aiProvider === "omnirouter"
                                ? `OmniRouter (${omniRouterModel})`
                                : aiProvider === "local"
                                ? `Ollama (${selectedAiModel})`
                                : `OpenRouter (${selectedAiModel.split("/").pop()})`}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveDockTab("config")}
                            className="text-purple-400 hover:text-purple-300 font-semibold underline text-[10px] shrink-0 cursor-pointer"
                          >
                            Configure AI →
                          </button>
                        </div>

                        {/* Pre-Flight Quick Badge Summary */}
                        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800/80 text-[10px] text-slate-400">
                          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar min-w-0">
                            <span className="flex items-center gap-1 font-mono text-amber-300 shrink-0" title="Upload folder for test files">
                              <Folder className="h-2.5 w-2.5" />
                              <span>{uploadFilesDir ? uploadFilesDir.split(/[\/\\]/).pop() || "fixtures" : "auto"}</span>
                            </span>
                            <span className="text-slate-600 shrink-0">•</span>
                            <span className="flex items-center gap-1 font-mono text-indigo-300 shrink-0" title="Postman collection status">
                              <FileCode className="h-2.5 w-2.5" />
                              <span>{postmanFileName ? "Postman ON" : "No Postman"}</span>
                            </span>
                            <span className="text-slate-600 shrink-0">•</span>
                            <span className="flex items-center gap-1 font-mono text-emerald-300 shrink-0" title="Sandbox test card status">
                              <CreditCard className="h-2.5 w-2.5" />
                              <span>{allowTestPayments ? "Cards ON" : "Cards OFF"}</span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openPreFlightModal(testingMode)}
                            className="text-indigo-400 hover:text-indigo-300 font-semibold underline text-[9px] shrink-0 ml-1 cursor-pointer"
                          >
                            Setup →
                          </button>
                        </div>

                        {/* Launch / Stop Button */}
                        <div className="pt-2">
                          {currentJob?.status === "running" ? (
                            <button
                              type="button"
                              onClick={handleStopAutomation}
                              className="w-full flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs py-2 rounded-lg transition shadow-lg shadow-rose-600/20 cursor-pointer"
                            >
                              <Square className="h-3.5 w-3.5 fill-current" />
                              <span>Stop Test</span>
                            </button>
                          ) : testingMode === "feature_workflow" ? (
                            <button
                              type="button"
                              disabled={isSubmitting || !workflowPromptInput.trim()}
                              onClick={() => openPreFlightModal("feature_workflow")}
                              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs py-2.5 rounded-lg transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                            >
                              {isSubmitting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5 text-indigo-200 fill-current" />
                              )}
                              <span>🎯 Configure &amp; Test Workflow</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => openPreFlightModal("full_app")}
                              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 rounded-lg transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                            >
                              {isSubmitting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5 fill-current" />
                              )}
                              <span>🚀 Start Full App Test (Pre-Flight)</span>
                            </button>
                          )}
                        </div>

                        {botError && (
                          <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[11px] flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>{botError}</span>
                          </div>
                        )}
                      </div>

                      {/* Interactive Verification Prompt Card */}
                      {currentJob && currentJob.verificationState === "awaiting_verification" && (
                        <div className="p-3.5 rounded-xl bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-950 border-2 border-amber-500/60 shadow-xl shadow-amber-950/40 text-xs space-y-3 animate-in fade-in duration-300">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="relative flex items-center justify-center p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                <Mail className="h-4 w-4" />
                                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                                </span>
                              </div>
                              <div>
                                <h4 className="font-bold text-amber-200 text-xs flex items-center gap-1.5">
                                  External Verification Required
                                </h4>
                                <span className="text-[10px] text-amber-400/80 font-mono">Testing paused at confirmation step</span>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Action Required
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                            {currentJob.verificationPrompt ||
                              "The application sent a confirmation email or external verification link. Please check your inbox and click the link, or paste the link / code below."}
                          </p>

                          <div className="space-y-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                                Confirmation / Magic Link URL (optional):
                              </label>
                              <input
                                type="url"
                                value={verificationUrlInput}
                                onChange={(e) => setVerificationUrlInput(e.target.value)}
                                placeholder="https://app.example.com/verify?token=..."
                                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-1">
                                OTP / Verification Code (optional):
                              </label>
                              <input
                                type="text"
                                value={verificationCodeInput}
                                onChange={(e) => setVerificationCodeInput(e.target.value)}
                                placeholder="e.g. 482910"
                                className="w-full bg-slate-950 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={isSubmittingVerification}
                              onClick={() => handleConfirmVerification()}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-3 rounded-lg transition shadow-lg shadow-emerald-600/30 cursor-pointer disabled:opacity-50"
                            >
                              {isSubmittingVerification ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              <span>I&apos;ve Completed Verification</span>
                            </button>

                            <button
                              type="button"
                              disabled={isSubmittingVerification}
                              onClick={handleSkipVerification}
                              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Interactive Secure Settings Credentials Form */}
                      {currentJob && currentJob.settingsState === "awaiting_credentials" && (
                        <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-950/60 via-slate-900 to-slate-950 border-2 border-indigo-500/60 shadow-xl shadow-indigo-950/40 text-xs space-y-3 animate-in fade-in duration-300">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                                <Key className="h-4 w-4" />
                              </div>
                              <div>
                                <h4 className="font-bold text-indigo-200 text-xs flex items-center gap-1.5">
                                  Settings Credentials Required
                                </h4>
                                <span className="text-[10px] text-indigo-400/80 font-mono">Protected &amp; Redacted in memory</span>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              Secure Input
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-950/70 p-2.5 rounded-lg border border-slate-800">
                            {currentJob.settingsPrompt ||
                              "The application settings requires API keys or credentials to test integrated features. Values entered here are never written to logs or screenshots."}
                          </p>

                          <div className="space-y-2">
                            {(currentJob.requiredSettingsFields && currentJob.requiredSettingsFields.length > 0
                              ? currentJob.requiredSettingsFields
                              : [{ key: "apiKey", label: "API Key / Secret Token", isSecret: true, placeholder: "sk-..." }]
                            ).map((field) => (
                              <div key={field.key} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <label className="text-[10px] font-semibold text-slate-300 flex items-center gap-1">
                                    <span>{field.label}</span>
                                    {field.isSecret && (
                                      <span className="text-[9px] text-indigo-400 font-mono">(Secret)</span>
                                    )}
                                  </label>
                                  {field.isSecret && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setShowSettingsSecrets((prev) => ({
                                          ...prev,
                                          [field.key]: !prev[field.key],
                                        }))
                                      }
                                      className="text-[10px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                                    >
                                      <Eye className="h-2.5 w-2.5" />
                                      <span>{showSettingsSecrets[field.key] ? "Hide" : "Show"}</span>
                                    </button>
                                  )}
                                </div>
                                <input
                                  type={field.isSecret && !showSettingsSecrets[field.key] ? "password" : "text"}
                                  value={settingsFormValues[field.key] || ""}
                                  onChange={(e) =>
                                    setSettingsFormValues((prev) => ({
                                      ...prev,
                                      [field.key]: e.target.value,
                                    }))
                                  }
                                  placeholder={field.placeholder || `Enter ${field.label}`}
                                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={isSubmittingSettings}
                              onClick={handleSaveSettingsCredentials}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2 px-3 rounded-lg transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                            >
                              {isSubmittingSettings ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              <span>Save &amp; Resume Testing</span>
                            </button>

                            <button
                              type="button"
                              disabled={isSubmittingSettings}
                              onClick={handleSkipSettingsCredentials}
                              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Real-time Progress & Terminal Log */}
                      {currentJob && (
                        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg space-y-0">
                          {/* Step & Progress Header */}
                          <div className="px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-xs bg-slate-950/60">
                            <div className="flex items-center gap-2 min-w-0">
                              <Terminal className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                              <span className="text-[11px] font-medium text-slate-300 truncate">
                                {currentJob.currentStep}
                              </span>
                            </div>
                            <span className="font-mono text-indigo-400 font-bold text-xs shrink-0 ml-2">
                              {currentJob.progress}%
                            </span>
                          </div>

                          {/* Progress bar line */}
                          <div className="w-full bg-slate-800 h-1">
                            <div
                              className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-1 transition-all duration-300"
                              style={{ width: `${currentJob.progress}%` }}
                            />
                          </div>

                          {/* Terminal log stream */}
                          <div
                            ref={terminalRef}
                            className="p-3 font-mono text-[11px] text-slate-300 max-h-36 overflow-y-auto space-y-1 custom-scrollbar bg-slate-950/90"
                          >
                            {currentJob.logs.map((log, i) => (
                              <div key={i} className="flex items-start gap-1.5 leading-relaxed">
                                <span className="text-slate-600 text-[9px] shrink-0">{log.timestamp.slice(11, 19)}</span>
                                <span
                                  className={`shrink-0 font-bold text-[9px] px-1 rounded ${
                                    log.level === "success"
                                      ? "text-emerald-400 bg-emerald-950/40"
                                      : log.level === "warn"
                                      ? "text-amber-400 bg-amber-950/40"
                                      : log.level === "error"
                                      ? "text-rose-400 bg-rose-950/40"
                                      : "text-slate-400 bg-slate-800"
                                  }`}
                                >
                                  {log.level.toUpperCase()}
                                </span>
                                <span
                                  className={
                                    log.level === "success"
                                      ? "text-emerald-300"
                                      : log.level === "error"
                                      ? "text-rose-300 font-semibold"
                                      : log.level === "warn"
                                      ? "text-amber-300"
                                      : "text-slate-300"
                                  }
                                >
                                  {log.message}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Antigravity-Style Live Agent Trajectory Stream */}
                      {currentJob && currentJob.actionHistory && currentJob.actionHistory.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-white flex items-center gap-1.5">
                              <Activity className="h-3.5 w-3.5 text-indigo-400" />
                              <span>Action Trajectory ({currentJob.actionHistory.length})</span>
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  if (activeActionIndex > 0) {
                                    setSelectedActionId(chronologicalActions[activeActionIndex - 1].id)
                                    setIsPlayingReplay(false)
                                  }
                                }}
                                disabled={activeActionIndex <= 0}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                                title="Previous action"
                              >
                                Prev
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsPlayingReplay((prev) => !prev)}
                                disabled={chronologicalActions.length <= 1}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 transition cursor-pointer"
                                title={isPlayingReplay ? "Pause replay" : "Replay actions in simulator frame"}
                              >
                                {isPlayingReplay ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 fill-current" />}
                                <span>{isPlayingReplay ? "Pause" : "Replay"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (activeActionIndex < chronologicalActions.length - 1) {
                                    setSelectedActionId(chronologicalActions[activeActionIndex + 1].id)
                                    setIsPlayingReplay(false)
                                  }
                                }}
                                disabled={activeActionIndex >= chronologicalActions.length - 1}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                                title="Next action"
                              >
                                Next
                              </button>
                              {selectedActionId && currentJob.status === "running" && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedActionId(null)}
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/50 transition cursor-pointer"
                                  title="Return to real-time stream"
                                >
                                  Live
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                            {currentJob.actionHistory.slice(0, 15).map((act, i) => {
                              const isSelected = selectedActionId === act.id
                              return (
                                <div
                                  key={act.id || i}
                                  onClick={() => {
                                    setSelectedActionId(act.id)
                                    setIsPlayingReplay(false)
                                  }}
                                  className={`p-2 rounded-lg border transition cursor-pointer text-xs space-y-1 ${
                                    isSelected
                                      ? "bg-indigo-950/60 border-indigo-500 ring-1 ring-indigo-500"
                                      : "bg-slate-900 border-slate-800 hover:border-slate-700"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span
                                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase font-mono ${
                                          act.type === "click"
                                            ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                                            : act.type === "back"
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                            : act.type === "type"
                                            ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                                            : act.type === "scroll"
                                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                                            : act.type === "assert"
                                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                            : "bg-slate-800 text-slate-300"
                                        }`}
                                      >
                                        {act.type}
                                      </span>
                                      <span className="text-[11px] font-medium text-slate-200 truncate">
                                        {act.description}
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-slate-500 font-mono shrink-0">
                                      {act.timestamp.slice(11, 19)}
                                    </span>
                                  </div>

                                  {act.thought && (
                                    <p className="text-[10px] text-slate-400 italic line-clamp-1 pl-1 border-l border-indigo-500/40">
                                      {act.thought}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* TAB 3: AUDIT REPORT */}
                  {activeDockTab === "report" && (
                    <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
                      {currentJob?.report ? (
                        <div className="space-y-3">
                          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                            <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                Audit Summary
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={handleCopyReport}
                                  className="p-1 rounded text-slate-400 hover:text-white"
                                  title="Copy summary"
                                >
                                  {copiedReport ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={handleDownloadReport}
                                  className="p-1 rounded text-slate-400 hover:text-white"
                                  title="Download JSON Report"
                                >
                                  <Download className="h-3 w-3" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                                <span className="text-[10px] text-slate-400 block font-medium">Back Nav Score</span>
                                <span className="text-xl font-bold text-emerald-400">
                                  {currentJob.report.backNavigationScore}%
                                </span>
                              </div>
                              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                                <span className="text-[10px] text-slate-400 block font-medium">Responsive Score</span>
                                <span className="text-xl font-bold text-indigo-400">
                                  {currentJob.report.responsiveScore}%
                                </span>
                              </div>
                            </div>

                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              {currentJob.report.summary}
                            </p>

                            {currentJob.report.aiExecutiveSummary && (
                              <div className="p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/40 text-[11px] text-purple-200 space-y-1">
                                <span className="font-bold text-purple-300 block flex items-center gap-1">
                                  <Sparkles className="h-3 w-3 text-purple-400" />
                                  <span>AI Executive Review:</span>
                                </span>
                                <p className="leading-relaxed">{currentJob.report.aiExecutiveSummary.executiveSummary}</p>
                              </div>
                            )}

                            {/* Chained Journey Workflow Banner */}
                            {currentJob.chainedWorkflowId && (
                              <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-500/40 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider block">
                                    🏁 Workflow Chain Created
                                  </span>
                                  <p className="text-xs font-semibold text-white truncate">
                                    {currentJob.screens.map((s) => s.pageType ? s.pageType.toUpperCase() : s.title).join(" ➔ ")}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (currentJob.chainedWorkflowId) {
                                      setActiveWorkflowId(currentJob.chainedWorkflowId)
                                    }
                                  }}
                                  className="px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shrink-0 transition shadow-xs cursor-pointer"
                                >
                                  Inspect Chain ➔
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Session Recording */}
                          {currentJob.recordingUrl && (
                            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                                <Video className="h-3.5 w-3.5 text-indigo-400" />
                                Session Recording
                              </span>
                              <video
                                src={currentJob.recordingUrl}
                                controls
                                className="w-full rounded-lg border border-slate-800 bg-black"
                              />
                            </div>
                          )}

                          {/* Autonomous Test Cases */}
                          {currentJob.testCases && currentJob.testCases.length > 0 && (
                            <div className="space-y-2">
                              <span className="font-bold text-white text-xs flex items-center gap-1.5 px-0.5">
                                <ListChecks className="h-3.5 w-3.5 text-emerald-400" />
                                Test Cases (
                                {currentJob.testCases.filter((t) => t.status === "passed").length}/
                                {currentJob.testCases.length} passed)
                              </span>
                              {currentJob.testCases.map((tc) => (
                                <div
                                  key={tc.scenarioId}
                                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-white truncate">{tc.name}</span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                                        tc.status === "passed"
                                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                          : tc.status === "blocked"
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                            : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                      }`}
                                    >
                                      {tc.status}
                                    </span>
                                  </div>
                                  {tc.error && <p className="text-[11px] text-rose-300/90">{tc.error}</p>}
                                  {tc.steps.length > 0 && (
                                    <ul className="text-[11px] text-slate-400 space-y-0.5 list-disc pl-4">
                                      {tc.steps.slice(0, 5).map((st, i) => (
                                        <li key={i} className="leading-snug">
                                          {st}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {tc.screenshots.length > 0 && (
                                    <div className="flex gap-1.5 overflow-x-auto custom-scrollbar">
                                      {tc.screenshots.map((shot, i) => (
                                        <a key={i} href={shot.url} target="_blank" rel="noreferrer" title={shot.label}>
                                          <img
                                            src={shot.url}
                                            alt={shot.label}
                                            className="h-16 w-28 object-cover rounded-md border border-slate-700 hover:border-indigo-500 transition"
                                          />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                  {tc.bugs.length > 0 && (
                                    <div className="space-y-1">
                                      {tc.bugs.map((b, i) => (
                                        <div key={i} className="p-2 rounded-lg bg-rose-950/30 border border-rose-900/50">
                                          <p className="text-[11px] text-rose-200 font-medium">
                                            &#x1F41E; [{b.severity}] {b.description}
                                          </p>
                                          <p className="text-[10px] text-slate-400 mt-0.5">
                                            Repro: {b.repro.join(" \u2192 ")}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Test Flow Graph */}
                          {currentJob.flowGraph && currentJob.flowGraph.nodes.length > 0 && (
                            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                                <GitBranch className="h-3.5 w-3.5 text-indigo-400" />
                                Test Flow ({currentJob.flowGraph.nodes.length} screens)
                              </span>
                              <TestFlowGraph graph={currentJob.flowGraph} />
                            </div>
                          )}

                          {/* Issues Breakdown */}
                          {currentJob.report.issues && currentJob.report.issues.length > 0 ? (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-white flex items-center gap-1.5">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                  <span>Issues Detected ({currentJob.report.issues.length})</span>
                                </span>
                              </div>

                              <div className="space-y-2">
                                {currentJob.report.issues.map((issue) => (
                                  <div
                                    key={issue.id}
                                    className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 text-xs"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                          issue.severity === "high" || issue.severity === "blocker"
                                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                            : issue.severity === "medium"
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                            : "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                                        }`}
                                      >
                                        {issue.severity}
                                      </span>
                                      <span className="text-[10px] text-slate-500 font-mono">
                                        {issue.type} {issue.viewport ? `(${issue.viewport})` : ""}
                                      </span>
                                    </div>

                                    <p className="text-[11px] text-slate-200 font-medium">{issue.description}</p>

                                    {issue.expected && (
                                      <p className="text-[10px] text-slate-400">
                                        <span className="text-slate-500 font-semibold">Expected:</span> {issue.expected}
                                      </p>
                                    )}

                                    {issue.actual && (
                                      <p className="text-[10px] text-rose-400/90">
                                        <span className="text-rose-500 font-semibold">Actual:</span> {issue.actual}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 text-center space-y-1">
                              <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto" />
                              <p className="text-xs font-semibold text-white">No Issues Detected</p>
                              <p className="text-[11px] text-slate-400">All audited views passed navigation and layout checks.</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                            <Activity className="h-6 w-6" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="text-xs font-bold text-white">No Audit Report Generated Yet</h4>
                            <p className="text-[11px] text-slate-400 max-w-[240px] leading-relaxed">
                              Run the autonomous crawler or send chat commands to test UI flows. The bot will automatically inspect responsive viewports, test back buttons, and compile an audit report here.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveDockTab("crawl")}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition cursor-pointer"
                          >
                            Open Crawler
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                </aside>
              </>
            )}
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
              <div className="space-y-1.5">
                {(!activePlan?.steps || activePlan.steps.length === 0) ? (
                  <div className="text-slate-500 text-center py-6">
                    No action steps captured yet. Start a test to record chronological execution steps.
                  </div>
                ) : (
                  activePlan.steps.map((step, idx) => (
                    <div
                      key={step.id || idx}
                      className="flex items-center justify-between text-[11px] p-2 rounded bg-slate-900/70 border border-slate-800/60 hover:border-slate-700 transition"
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <span className="text-slate-500 shrink-0 font-bold">#{step.stepIndex}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase shrink-0 ${
                            step.actionType === "click"
                              ? "bg-amber-950 text-amber-300 border border-amber-800/60"
                              : step.actionType === "fill"
                              ? "bg-indigo-950 text-indigo-300 border border-indigo-800/60"
                              : "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                          }`}
                        >
                          {step.actionType}
                        </span>
                        <span className="text-slate-200 font-medium truncate">{step.targetName}</span>
                        {step.syntheticValue && (
                          <span className="text-slate-400 text-[10px] truncate max-w-[140px] bg-slate-950 px-1 rounded border border-slate-800">
                            &quot;{step.syntheticValue}&quot;
                          </span>
                        )}
                        <span className="text-slate-500 text-[10px] hidden sm:inline truncate">
                          ({step.screenName})
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[10px] font-bold capitalize ${
                            step.status === "passed"
                              ? "text-emerald-400"
                              : step.status === "failed"
                              ? "text-rose-400"
                              : step.status === "running"
                              ? "text-amber-400 animate-pulse"
                              : "text-slate-500"
                          }`}
                        >
                          {step.status}
                        </span>
                        {step.screenshotUrl && (
                          <button
                            type="button"
                            onClick={() => setImagePreviewModal(step.screenshotUrl || null)}
                            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                            title="View screenshot"
                          >
                            <ImageIcon className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
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
            onClick={() => setIsBotPanelOpen((prev) => !prev)}
            className="flex items-center gap-1 text-slate-300 hover:text-white transition cursor-pointer"
            title="Toggle AI Testing Bot Dock"
          >
            <Sparkles className="h-3 w-3 text-indigo-400" />
            <span className="hidden sm:inline">AI Bot Dock</span>
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

