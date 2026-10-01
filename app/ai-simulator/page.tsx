"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import Link from "next/link"
import {
  Sparkles,
  Smartphone,
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
  ArrowLeft,
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
} from "lucide-react"
import type { Session, AuthChangeEvent } from "@supabase/supabase-js"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import { WorkflowSimulator } from "@/components/design-review/workflow-simulator"
import { ThemeToggle } from "@/components/design-review/theme-toggle"
import type { AutomationJob, DiscoveredScreen, AutomationIssue, AgentChatMessage } from "@/lib/ai-automation/types"

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

  // AI Automation Bot Side Dock visibility (open by default so user sees simulator and bot together)
  const [isBotPanelOpen, setIsBotPanelOpen] = useState(true)

  // Automation Bot Configuration State
  const [targetUrl, setTargetUrl] = useState("http://localhost:3000")
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
  const [omniRouterBaseUrl, setOmniRouterBaseUrl] = useState("http://localhost:8000/v1")
  const [omniRouterKey, setOmniRouterKey] = useState("")
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [selectedAiModel, setSelectedAiModel] = useState("google/gemini-2.0-flash-001")
  const [omniRouterModel, setOmniRouterModel] = useState("gpt-4o")
  const [showAiSettings, setShowAiSettings] = useState(false)

  // Antigravity Browser Control & Action Replay State
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null)
  const [isPlayingReplay, setIsPlayingReplay] = useState(false)
  const [isAntigravityHudExpanded, setIsAntigravityHudExpanded] = useState(true)

  // Laya Fast System-1 Reflexes & Journey Role State
  const [journeyRole, setJourneyRole] = useState<"user" | "admin" | "client" | "editor" | "viewer" | "custom">("user")
  const [customJourneyRole, setCustomJourneyRole] = useState("")
  const [layaBaseUrl, setLayaBaseUrl] = useState("http://127.0.0.1:8000")
  const [isLayaLive, setIsLayaLive] = useState(false)
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null)

  // Local Project Route Scanner State
  const [discoveredRoutes, setDiscoveredRoutes] = useState<Array<{ path: string; url: string; file: string; title: string }>>([])
  const [isScanningRoutes, setIsScanningRoutes] = useState(false)

  const fetchLocalRoutes = useCallback(async () => {
    try {
      setIsScanningRoutes(true)
      const res = await fetch("/api/ai-automation/routes")
      const data = await res.json()
      if (data?.routes) {
        setDiscoveredRoutes(data.routes)
      }
    } catch {}
    finally {
      setIsScanningRoutes(false)
    }
  }, [])

  useEffect(() => {
    fetchLocalRoutes()
  }, [fetchLocalRoutes])

  // Laya fast health checker
  useEffect(() => {
    let active = true
    const checkLaya = async () => {
      try {
        const res = await fetch(`${layaBaseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null)
        if (active) setIsLayaLive(Boolean(res?.ok))
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
  }, [layaBaseUrl])

  // AI Agent Chat Command Center State
  const [activeDockTab, setActiveDockTab] = useState<"chat" | "crawl" | "report">("chat")
  const [chatInput, setChatInput] = useState("")
  const [isSendingChat, setIsSendingChat] = useState(false)
  const [chatHistory, setChatHistory] = useState<AgentChatMessage[]>([
    {
      id: "welcome-msg",
      sender: "agent",
      text: "Hello! I am your Antigravity Autonomous Browser Testing Agent. You can give me direct testing commands in natural language, or pick a quick command chip below.",
      timestamp: new Date().toISOString(),
      status: "completed",
    },
  ])

  // Sync chat messages from current running job
  useEffect(() => {
    if (currentJob?.messages && currentJob.messages.length > 0) {
      setChatHistory((prev) => {
        const existingIds = new Set(prev.map((m) => m.id))
        const newMsgs = currentJob.messages!.filter((m) => !existingIds.has(m.id))
        if (newMsgs.length > 0) {
          return [...prev, ...newMsgs]
        }
        return prev
      })
    }
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
  const handleSendChatCommand = async (cmdText?: string) => {
    const textToSend = (cmdText || chatInput).trim()
    if (!textToSend || isSendingChat) return

    setChatInput("")
    setIsSendingChat(true)
    setBotError("")

    const userMsg: AgentChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: textToSend,
      timestamp: new Date().toISOString(),
      status: "completed",
    }
    const agentThinkingMsg: AgentChatMessage = {
      id: `agent-${Date.now()}`,
      sender: "agent",
      text: `Processing command: "${textToSend}"... Preparing Antigravity browser actions.`,
      timestamp: new Date().toISOString(),
      status: "thinking",
    }

    setChatHistory((prev) => [...prev, userMsg, agentThinkingMsg])

    try {
      const res = await fetch("/api/ai-automation/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: textToSend,
          targetUrl: targetUrl.trim() || "http://localhost:3000",
          projectId: activeProject.id,
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
              ? omniRouterModel.trim() || "gpt-4o"
              : selectedAiModel,
          aiBaseUrl:
            aiProvider === "local"
              ? localAiBaseUrl.trim()
              : aiProvider === "omnirouter"
              ? omniRouterBaseUrl.trim() || "http://localhost:8000/v1"
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

  // Load projects from database
  const loadWorkspace = useCallback(async () => {
    setLoading(true)
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
    loadWorkspace()
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

  // Poll job status while running
  useEffect(() => {
    if (!currentJob?.id || currentJob.status !== "running") return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai-automation/status?jobId=${currentJob.id}`)
        const data = await res.json()
        if (data?.success && data.job) {
          setCurrentJob(data.job)
          if (data.job.status === "completed" || data.job.status === "failed" || data.job.status === "stopped") {
            // Reload project workspace to immediately surface newly created workflows!
            loadWorkspace()
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
    // 2. Otherwise if bot is currently running, stream live action feed
    else if (currentJob?.status === "running" && currentJob.currentScreenshotUrl) {
      dynamicWorkflows.push({
        id: "live-bot-action-feed",
        projectId: activeProject.id,
        title: `🔴 LIVE: ${currentJob.currentAction?.description || "Agent Browser Control"}`,
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
      if (targetId && activeWorkflowId === "live-bot-action-feed") {
        setActiveWorkflowId(targetId)
      }
    }
  }, [currentJob?.status, currentJob?.currentAction?.id, currentJob?.screens?.length, selectedActionId, activeAction])

  // Start Automation Run
  const handleStartAutomation = async () => {
    setBotError("")
    if (!targetUrl.trim()) {
      setBotError("Please specify a target URL to test.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/ai-automation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl.trim(),
          projectId: activeProject.id,
          role: journeyRole === "custom" ? customJourneyRole.trim() || "custom" : journeyRole,
          layaBaseUrl: layaBaseUrl.trim() || "http://127.0.0.1:8000",
          credentials:
            username || password
              ? {
                  username: username.trim(),
                  password: password.trim(),
                }
              : undefined,
          maxScreens,
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
              ? omniRouterModel.trim() || "gpt-4o"
              : selectedAiModel,
          aiBaseUrl:
            aiProvider === "local"
              ? localAiBaseUrl.trim()
              : aiProvider === "omnirouter"
              ? omniRouterBaseUrl.trim() || "http://localhost:8000/v1"
              : "https://openrouter.ai/api/v1",
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to start automation run.")
      }

      localStorage.setItem("ai_automation_last_job_id", data.jobId)

      // Fetch immediately to load initial state
      const statusRes = await fetch(`/api/ai-automation/status?jobId=${data.jobId}`)
      const statusData = await statusRes.json()
      if (statusData?.job) {
        setCurrentJob(statusData.job)
      }
    } catch (err: any) {
      setBotError(err?.message || "Failed to initiate AI bot run.")
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
      {/* Top Header */}
      {!isSimulatorFullscreen && (
        <header className="h-12 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between gap-3 shrink-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            {/* Brand Logo & Title */}
            <Link
              href="/"
              className="flex items-center gap-2 group shrink-0"
              title="Return to Dashboard"
            >
              <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-sm shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="font-bold text-sm tracking-tight hidden md:inline text-white">
                Design Workflow Tracker
              </span>
            </Link>

            {/* Navigation View Switcher */}
            <div className="hidden sm:flex items-center bg-slate-900 p-0.5 rounded-xl border border-slate-800 flex-shrink-0">
              <Link
                href="/"
                className="px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all text-slate-400 hover:text-white"
              >
                Dashboard
              </Link>
              <Link
                href="/?view=editor"
                className="px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all text-slate-400 hover:text-white"
              >
                Editor
              </Link>
              <Link
                href="/?view=simulator"
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all text-slate-400 hover:text-white"
              >
                <Smartphone className="h-3.5 w-3.5 hidden sm:block" />
                <span>Simulator</span>
              </Link>
              <div className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold bg-indigo-600 text-white shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI Simulator</span>
              </div>
            </div>

            {/* Target Project Dropdown */}
            {projects.length > 0 && (
              <div className="relative hidden lg:flex items-center">
                <select
                  value={activeProjectId || ""}
                  onChange={(e) => {
                    setActiveProjectId(e.target.value)
                    setActiveWorkflowId(null)
                  }}
                  className="h-7 text-xs font-medium bg-slate-900 border border-slate-700 rounded-lg px-2 text-slate-200 cursor-pointer outline-none max-w-[180px] truncate"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* AI Bot Dock Toggle Button */}
            <button
              type="button"
              onClick={() => setIsBotPanelOpen((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                isBotPanelOpen
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                  : currentJob?.status === "running"
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300 animate-pulse"
                  : "bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
              }`}
              title={isBotPanelOpen ? "Collapse AI Bot Dock" : "Open AI Bot Testing Dock"}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>
                {currentJob?.status === "running"
                  ? `AI Bot Running (${currentJob.progress}%)`
                  : "AI Testing Bot"}
              </span>
              {isBotPanelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5 ml-0.5 text-slate-400" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5 ml-0.5 text-slate-400" />
              )}
            </button>

            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
              title="Return to main workspace"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </header>
      )}

      {/* Main Workspace: Simulator Frame + Live AI Automation Dock */}
      <main className="flex-1 w-full overflow-hidden flex relative">
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-xs font-medium">Loading AI Simulator & Device Frame...</p>
          </div>
        ) : (
          <>
            {/* 1. CORE WORKFLOW SIMULATOR CANVAS */}
            <div className="flex-1 h-full w-full flex flex-col overflow-hidden relative">
              {/* Visible Workflow Journey Sequence Strip (Login ➔ Home Page ➔ Dashboard...) */}
              {currentJob?.screens && currentJob.screens.length > 0 && (
                <div className="bg-slate-950/95 border-b border-slate-800/80 px-4 py-2.5 flex items-center justify-between gap-4 z-20 shrink-0 backdrop-blur-md">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white tracking-tight">
                          Workflow Journey
                        </span>
                        {currentJob.chainedWorkflowId && (
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Saved to Workflows
                          </span>
                        )}
                        {currentJob.role && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-slate-800 text-slate-300 font-mono">
                            {currentJob.role}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        {currentJob.screens.length} step(s) captured · Click any step to inspect
                      </p>
                    </div>
                  </div>

                  {/* Horizontal Scrolling Sequence of Steps */}
                  <div className="flex-1 flex items-center gap-2 overflow-x-auto py-1 custom-scrollbar">
                    {currentJob.screens.map((screen, idx) => {
                      const isSelected = selectedStepIndex === idx
                      const isLast = idx === currentJob.screens.length - 1
                      return (
                        <div key={idx} className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStepIndex(idx)
                              const targetWfId = screen.workflowId || `bot-screen-${idx}`
                              setActiveWorkflowId(targetWfId)
                            }}
                            className={`group flex items-center gap-2.5 p-1.5 pr-3 rounded-xl border transition text-left cursor-pointer ${
                              isSelected
                                ? "bg-indigo-950/60 border-indigo-500/70 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-400"
                                : "bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-850"
                            }`}
                          >
                            {/* Thumbnail */}
                            <div className="w-12 h-9 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 relative shrink-0">
                              {screen.screenshotUrl ? (
                                <img
                                  src={screen.screenshotUrl}
                                  alt={screen.title}
                                  className="w-full h-full object-cover object-top"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-500">
                                  📸
                                </div>
                              )}
                              <span className="absolute top-0.5 left-0.5 px-1 py-0.2 bg-black/75 rounded text-[8px] font-mono font-bold text-white">
                                {idx + 1}
                              </span>
                            </div>

                            {/* Step info */}
                            <div className="min-w-0 max-w-[130px]">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold uppercase font-mono px-1 rounded bg-purple-500/20 text-purple-300">
                                  {screen.pageType || "SCREEN"}
                                </span>
                                {screen.issuesCount > 0 ? (
                                  <span className="text-[9px] font-bold text-rose-400 flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    {screen.issuesCount}
                                  </span>
                                ) : (
                                  <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-0.5">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    Pass
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] font-semibold text-slate-200 truncate mt-0.5">
                                {screen.title}
                              </p>
                              <p className="text-[9px] text-slate-500 truncate font-mono">
                                {screen.path || screen.url}
                              </p>
                            </div>
                          </button>

                          {/* Arrow connector */}
                          {!isLast && (
                            <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <WorkflowSimulator
                project={mergedSimulatorProject}
                initialWorkflowId={activeWorkflowId}
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

              {/* Google Antigravity Browser Testing Cockpit HUD */}
              {currentJob && (currentJob.status === "running" || (currentJob.actionHistory && currentJob.actionHistory.length > 0)) && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-xl w-[94%] sm:w-auto">
                  {isAntigravityHudExpanded ? (
                    <div className="bg-slate-950/95 border border-indigo-500/40 rounded-2xl p-3 shadow-2xl backdrop-blur-xl space-y-2 text-xs text-slate-200 ring-1 ring-purple-500/20">
                      {/* Top Bar: Agent Badge, Action Type, Step Counter, and Minimizer */}
                      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
                          <span className="font-bold text-[11px] tracking-wider text-purple-400 font-mono uppercase">
                            ANTIGRAVITY AGENT
                          </span>
                          {activeAction && (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                                activeAction.type === "click"
                                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                                  : activeAction.type === "back"
                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                  : activeAction.type === "type"
                                  ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                                  : activeAction.type === "scroll"
                                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                                  : activeAction.type === "assert"
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                  : "bg-slate-800 text-slate-300"
                              }`}
                            >
                              {activeAction.type}
                            </span>
                          )}
                          {activeAction?.status && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${
                                activeAction.status === "passed"
                                  ? "text-emerald-400 bg-emerald-950/40"
                                  : activeAction.status === "failed"
                                  ? "text-rose-400 bg-rose-950/40"
                                  : "text-amber-400 bg-amber-950/40"
                              }`}
                            >
                              {activeAction.status}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {chronologicalActions.length > 0 && (
                            <span className="text-[10px] text-slate-400 font-mono">
                              Step {activeActionIndex >= 0 ? activeActionIndex + 1 : 1}/{chronologicalActions.length}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setIsAntigravityHudExpanded(false)}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                            title="Collapse HUD"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Middle: Agent Thought & Target */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-slate-400 font-medium truncate">
                            🎯 <strong className="text-white">{activeAction?.target || currentJob.targetUrl}</strong>
                            {activeAction?.coordinates && (
                              <span className="ml-1.5 text-purple-400 font-mono text-[10px]">
                                ({activeAction.coordinates.x}, {activeAction.coordinates.y})
                              </span>
                            )}
                          </span>
                        </div>
                        {activeAction?.thought && (
                          <div className="text-[11px] text-slate-300 italic bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 leading-relaxed">
                            <span className="text-purple-400 font-semibold not-italic font-mono mr-1.5">🧠 Thought:</span>
                            {activeAction.thought}
                          </div>
                        )}
                        {activeAction?.observation && (
                          <div className="text-[10px] text-emerald-300 font-mono flex items-center gap-1.5">
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                            <span className="truncate">{activeAction.observation}</span>
                          </div>
                        )}
                      </div>

                      {/* Bottom Controls: Step navigation, Play/Pause Replay, and Live Feed */}
                      <div className="flex items-center justify-between pt-1 gap-2 border-t border-slate-800/60">
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
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs transition cursor-pointer"
                            title="Previous step"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsPlayingReplay((prev) => !prev)}
                            disabled={chronologicalActions.length <= 1}
                            className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold text-white flex items-center gap-1 transition cursor-pointer"
                            title={isPlayingReplay ? "Pause replay" : "Play step replay"}
                          >
                            {isPlayingReplay ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
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
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs transition cursor-pointer"
                            title="Next step"
                          >
                            Next
                          </button>
                        </div>

                        {selectedActionId && currentJob.status === "running" && (
                          <button
                            type="button"
                            onClick={() => setSelectedActionId(null)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold hover:bg-emerald-600/30 transition cursor-pointer"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Return to Live Stream</span>
                          </button>
                        )}

                        {!isBotPanelOpen && (
                          <button
                            type="button"
                            onClick={() => setIsBotPanelOpen(true)}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition cursor-pointer"
                          >
                            Open Console →
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => setIsAntigravityHudExpanded(true)}
                      className="bg-slate-950/95 border border-indigo-500/40 rounded-full px-4 py-2 shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs cursor-pointer hover:border-indigo-400 transition"
                    >
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-bold text-white font-mono">ANTIGRAVITY AGENT</span>
                      <span className="text-slate-300 max-w-[200px] truncate">{activeAction?.description || currentJob.currentStep}</span>
                      <span className="font-mono text-indigo-400 font-bold">{currentJob.progress}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. DOCKED AI AUTOMATION TESTING COCKPIT (Slides out from right) */}
            {isBotPanelOpen && (
              <aside className="w-[420px] lg:w-[460px] shrink-0 border-l border-slate-800 bg-slate-950 flex flex-col h-full z-20 shadow-2xl overflow-hidden animate-in slide-in-from-right-6 duration-200">
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
                    title="Close Dock"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </button>
                </div>

                {/* Dock Tab Selector */}
                <div className="grid grid-cols-3 p-1.5 bg-slate-900 border-b border-slate-800 text-[11px] font-semibold shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveDockTab("chat")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                    onClick={() => setActiveDockTab("crawl")}
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                    className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                      {/* Chat Tab Top Bar: Provider badge & Model info */}
                      <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-[11px] shrink-0">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-slate-400 font-medium">Provider:</span>
                          <span className="font-semibold text-white">
                            {aiProvider === "omnirouter"
                              ? "OmniRouter"
                              : aiProvider === "local"
                              ? "Local (Ollama)"
                              : "Cloud (OpenRouter)"}
                          </span>
                          <span className="text-[10px] text-purple-400 font-mono">
                            ({aiProvider === "omnirouter" ? omniRouterModel : selectedAiModel.split("/").pop()})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDockTab("crawl")
                            setShowAiSettings(true)
                          }}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium transition cursor-pointer"
                        >
                          Change
                        </button>
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
                                    <span className="text-[10px] font-semibold text-indigo-400">Antigravity Bot</span>
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
                                {msg.status === "thinking" ? (
                                  <div className="flex items-center gap-2 text-indigo-300 font-medium">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 shrink-0" />
                                    <span>{msg.text}</span>
                                  </div>
                                ) : (
                                  <p className="whitespace-pre-wrap">{msg.text}</p>
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
                                          <span className="text-slate-400 truncate max-w-[130px]">{act.selector || act.description}</span>
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        <div ref={chatBottomRef} />
                      </div>

                      {/* Quick Prompt Presets */}
                      <div className="px-3 pt-2 pb-1.5 border-t border-slate-800/80 bg-slate-950/90">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                          <div className="flex items-center gap-1">
                            <Wand2 className="h-3 w-3 text-indigo-400" />
                            <span>Quick Commands</span>
                          </div>
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
                              className="text-[9px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer"
                            >
                              <RotateCcw className="h-2.5 w-2.5" />
                              <span>Clear</span>
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                          {[
                            "Click theme toggle and verify dark mode",
                            "Test back button navigation",
                            "Audit viewports (390px, 768px, 1440px)",
                            "Scroll to bottom and inspect footer",
                          ].map((chip, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSendChatCommand(chip)}
                              disabled={isSendingChat}
                              className="shrink-0 px-2 py-1 rounded-md bg-slate-900 border border-slate-800 hover:border-indigo-500 hover:bg-indigo-950/30 text-[10px] text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50"
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Chat Input Bar */}
                      <div className="p-3 border-t border-slate-800 bg-slate-900/60">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            handleSendChatCommand()
                          }}
                          className="flex items-center gap-2"
                        >
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              placeholder="Give command (e.g. 'Click login button')..."
                              disabled={isSendingChat}
                              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                            />
                            {isSendingChat && (
                              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-indigo-400 animate-spin" />
                            )}
                          </div>
                          <button
                            type="submit"
                            disabled={!chatInput.trim() || isSendingChat}
                            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white p-2 rounded-lg transition shadow-md shadow-indigo-600/20 cursor-pointer disabled:cursor-not-allowed shrink-0"
                            title="Send command"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: CRAWLER */}
                  {activeDockTab === "crawl" && (
                    <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
                      {/* Configuration Form */}
                      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                            <span>Target App URL</span>
                            <span className="text-[10px] text-slate-500">Auto-crawls internal pages</span>
                          </label>
                          <div className="relative">
                            <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                            <input
                              type="url"
                              value={targetUrl}
                              onChange={(e) => setTargetUrl(e.target.value)}
                              placeholder="http://localhost:3000"
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
                                onClick={fetchLocalRoutes}
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

                        {/* Laya Fast Decision Reflexes Status */}
                        <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${isLayaLive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                            <span className="text-slate-300 font-medium">Laya System-1 Reflexes</span>
                          </div>
                          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded ${
                            isLayaLive
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-slate-800 text-slate-400"
                          }`}>
                            {isLayaLive ? "Ready (~30ms)" : "Offline (DOM Fallback)"}
                          </span>
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

                        {/* AI Provider Settings */}
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowAiSettings((prev) => !prev)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs transition cursor-pointer ${
                              openRouterKey.trim() || aiProvider === "local" || aiProvider === "omnirouter"
                                ? "bg-purple-950/30 border-purple-800/50 text-purple-300"
                                : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                              <span className="font-semibold text-[11px]">
                                AI Vision Provider: {
                                  aiProvider === "omnirouter"
                                    ? "OmniRouter Gateway"
                                    : aiProvider === "local"
                                    ? "Local (Ollama)"
                                    : "Cloud (OpenRouter)"
                                }
                              </span>
                            </div>
                            <ChevronDown className={`h-3 w-3 transition-transform ${showAiSettings ? "rotate-180" : ""}`} />
                          </button>

                          {showAiSettings && (
                            <div className="mt-2 p-3 rounded-lg bg-slate-950 border border-purple-800/40 space-y-2.5 text-xs">
                              <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5 gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAiProvider("cloud")}
                                  className={`flex-1 py-1 rounded text-[10px] font-semibold transition cursor-pointer ${
                                    aiProvider === "cloud"
                                      ? "bg-purple-600 text-white shadow-sm"
                                      : "text-slate-400 hover:text-white"
                                  }`}
                                >
                                  Cloud
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAiProvider("omnirouter")}
                                  className={`flex-1 py-1 rounded text-[10px] font-semibold transition cursor-pointer ${
                                    aiProvider === "omnirouter"
                                      ? "bg-indigo-600 text-white shadow-sm"
                                      : "text-slate-400 hover:text-white"
                                  }`}
                                >
                                  OmniRouter
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateAiProvider("local")}
                                  className={`flex-1 py-1 rounded text-[10px] font-semibold transition cursor-pointer ${
                                    aiProvider === "local"
                                      ? "bg-emerald-600 text-white shadow-sm"
                                      : "text-slate-400 hover:text-white"
                                  }`}
                                >
                                  Ollama
                                </button>
                              </div>

                              {aiProvider === "omnirouter" ? (
                                <div className="space-y-2">
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-slate-400 font-medium flex items-center justify-between">
                                      <span>OmniRouter Gateway URL</span>
                                      <span className="text-emerald-400 text-[9px] font-mono">OpenAI Compatible</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={omniRouterBaseUrl}
                                      onChange={(e) => handleUpdateOmniRouterUrl(e.target.value)}
                                      placeholder="http://localhost:8000/v1"
                                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-white font-mono"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-slate-400 font-medium">
                                      Gateway API Key (Optional)
                                    </label>
                                    <input
                                      type="password"
                                      value={omniRouterKey}
                                      onChange={(e) => handleUpdateOmniRouterKey(e.target.value)}
                                      placeholder="Bearer key or sk-..."
                                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-white font-mono placeholder-slate-600"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] text-slate-400 font-medium">
                                      Model Name
                                    </label>
                                    <input
                                      type="text"
                                      value={omniRouterModel}
                                      onChange={(e) => handleUpdateOmniRouterModel(e.target.value)}
                                      placeholder="gpt-4o, claude-3-5-sonnet, gemini-2.0-flash"
                                      className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-white font-mono"
                                    />
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                      {["gpt-4o", "claude-3-5-sonnet", "gemini-2.0-flash", "deepseek-chat"].map((m) => (
                                        <button
                                          key={m}
                                          type="button"
                                          onClick={() => handleUpdateOmniRouterModel(m)}
                                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition cursor-pointer ${
                                            omniRouterModel === m
                                              ? "bg-indigo-600 text-white"
                                              : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                                          }`}
                                        >
                                          {m}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <p className="text-[10px] text-slate-500 italic">
                                    OmniRouter routes requests across multiple AI providers via a single unified endpoint.
                                  </p>
                                </div>
                              ) : aiProvider === "cloud" ? (
                                <div className="space-y-2">
                                  <input
                                    type="password"
                                    value={openRouterKey}
                                    onChange={(e) => handleUpdateOpenRouterKey(e.target.value)}
                                    placeholder="OpenRouter Key: sk-or-v1-..."
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-white font-mono placeholder-slate-600"
                                  />
                                  <select
                                    value={selectedAiModel}
                                    onChange={(e) => handleUpdateAiModel(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white cursor-pointer"
                                  >
                                    <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash (Fastest)</option>
                                    <option value="openai/gpt-4o-mini">OpenAI GPT-4o Mini</option>
                                    <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet (Deep QA)</option>
                                  </select>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <input
                                    type="text"
                                    value={localAiBaseUrl}
                                    onChange={(e) => handleUpdateLocalBaseUrl(e.target.value)}
                                    placeholder="http://localhost:11434/v1"
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-[11px] text-white font-mono"
                                  />
                                  <select
                                    value={selectedAiModel}
                                    onChange={(e) => handleUpdateAiModel(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[11px] text-white cursor-pointer"
                                  >
                                    <option value="llama3.2-vision">llama3.2-vision (Meta Vision)</option>
                                    <option value="qwen2-vl">qwen2-vl (Qwen Vision)</option>
                                    <option value="llava">llava (LLaVA)</option>
                                  </select>
                                </div>
                              )}
                            </div>
                          )}
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
                              <span>Stop Automation Bot</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={handleStartAutomation}
                              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs py-2 rounded-lg transition shadow-lg shadow-indigo-600/30 cursor-pointer disabled:opacity-50"
                            >
                              {isSubmitting ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5 fill-current" />
                              )}
                              <span>Launch AI Automation Bot</span>
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
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setIsPlayingReplay((prev) => !prev)}
                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 hover:bg-indigo-600/50 flex items-center gap-1 transition cursor-pointer"
                                title={isPlayingReplay ? "Pause replay" : "Replay actions in simulator frame"}
                              >
                                {isPlayingReplay ? <Pause className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5 fill-current" />}
                                <span>{isPlayingReplay ? "Pause" : "Replay"}</span>
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

                      {/* Discovered Screens List */}
                      {currentJob && currentJob.screens.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-white flex items-center gap-1.5">
                              <Layers className="h-3.5 w-3.5 text-indigo-400" />
                              Audited Screens ({currentJob.screens.length})
                            </span>
                            <span className="text-[10px] text-slate-500">Click to preview in device frame</span>
                          </div>

                          <div className="space-y-1.5">
                            {currentJob.screens.map((screen, idx) => (
                              <div
                                key={idx}
                                onClick={() => {
                                  if (screen.workflowId) setActiveWorkflowId(screen.workflowId)
                                }}
                                className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                                  activeWorkflowId === screen.workflowId
                                    ? "bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500"
                                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {screen.screenshotUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={screen.screenshotUrl}
                                      alt={screen.title}
                                      className="w-8 h-10 object-cover object-top rounded border border-slate-700 shrink-0"
                                    />
                                  ) : (
                                    <Smartphone className="w-6 h-6 text-slate-600 shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <span className="text-xs font-semibold text-white block truncate" title={screen.title}>
                                      {screen.title}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono block truncate" title={screen.url}>
                                      {screen.path || screen.url}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {screen.backNavigationStatus === "passed" ? (
                                    <span title="Back navigation verified">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                    </span>
                                  ) : screen.backNavigationStatus === "failed" ? (
                                    <span title="Back navigation failed">
                                      <XCircle className="h-3.5 w-3.5 text-rose-400" />
                                    </span>
                                  ) : null}

                                  {screen.issuesCount > 0 ? (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                      {screen.issuesCount} issue{screen.issuesCount > 1 ? "s" : ""}
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                      Clean
                                    </span>
                                  )}
                                  <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                                </div>
                              </div>
                            ))}
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
            )}
          </>
        )}
      </main>
    </div>
  )
}
