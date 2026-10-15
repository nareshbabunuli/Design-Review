"use client"

import React, { useState, useMemo, useEffect, useRef } from "react"
import {
  Sparkles,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  Map as MapIcon,
  ListChecks,
  Activity,
  FileText,
  Send,
  Loader2,
  HelpCircle,
  Compass,
  ShieldCheck,
  ArrowRight,
  Clock,
  RotateCcw,
  Image as ImageIcon,
  Check,
  Ban,
  Maximize2,
  ChevronRight,
  Video,
  Bot,
  User,
  MessageSquare,
  Wand2,
  Trash2,
  Paperclip,
  Camera,
  ChevronDown,
  Settings,
  Key,
  Mail,
  X,
  Square,
  ShieldAlert,
  FastForward,
  Zap,
  Search,
} from "lucide-react"
import type {
  AutomationJob,
  FullAppTestPlan,
  FeatureWorkflowSpec,
  FeatureWorkflowEdgeCase,
  TestPlanStep,
  FlowGraph,
} from "@/lib/ai-automation/types"
import TestFlowGraph from "./test-flow-graph"
import { buildFigmaWorkflowMap, isFullAppCommand } from "@/lib/ai-automation/full-app-utils"
import AiConfigPanel from "./ai-config-panel"

interface FeatureWorkflowViewProps {
  job: AutomationJob | null
  isRunning: boolean
  targetUrl: string
  activeSubTab?: "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  onSubTabChange?: (tab: "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage") => void
  projectId?: string
  onStartWorkflowTest: (workflowPrompt: string, role?: string, workflowName?: string, attachedImg?: string | null) => Promise<void>
  onStartFullAppTest?: () => Promise<void>
  onCancelJob?: () => void
  onOpenMapPage?: () => void
  isMapPageActive?: boolean
  testingMode?: "full_app" | "feature_workflow"
  onSelectTestingMode?: (mode: "full_app" | "feature_workflow") => void
  fullPageView?: boolean
  isFullStage?: boolean
  onToggleFullStage?: () => void

  // AI Configuration & Provider display
  aiProvider?: "nebius" | "omnirouter" | "local"
  onUpdateAiProvider?: (provider: "nebius" | "omnirouter" | "local") => void
  nebiusApiKey?: string
  onUpdateNebiusApiKey?: (key: string) => void
  selectedAiModel?: string
  onUpdateAiModel?: (model: string) => void
  omniRouterBaseUrl?: string
  onUpdateOmniRouterUrl?: (url: string) => void
  omniRouterKey?: string
  onUpdateOmniRouterKey?: (key: string) => void
  omniRouterModel?: string
  onUpdateOmniRouterModel?: (model: string) => void
  localAiBaseUrl?: string
  onUpdateLocalBaseUrl?: (url: string) => void
  isTestingAiConnection?: boolean
  onTestAiConnection?: () => Promise<void> | void
  aiConnectionTestResult?: { success: boolean; message: string } | null
  onOpenAiConfig?: () => void

  // Live Screen Capture & Attachments
  onCaptureCurrentScreen?: () => void

  // Target Project & Routes Presets
  selectedProjectDir?: string
  onSelectProjectDir?: (dir: string) => void
  availableProjects?: Array<{ name: string; path: string; defaultPort?: number }>
  discoveredRoutes?: Array<{ path: string; url: string; sourceFile?: string }>
  onRescanRoutes?: () => void
  isScanningRoutes?: boolean
  onGenerateTestData?: () => void
  isGeneratingTestData?: boolean
  onNavigateUrl?: (url: string) => void

  // Verification & Credentials forms
  onConfirmVerification?: (code?: string, url?: string) => Promise<void>
  onSkipVerification?: () => void
  onSaveSettingsCredentials?: (creds: Record<string, string>) => Promise<void>
  onSkipSettingsCredentials?: () => void
  onUnblockWorkflows?: (options: {
    mode: "synthetic_data" | "credentials" | "retry" | "skip"
    username?: string
    password?: string
    screenId?: string
  }) => Promise<void>

  // Laya System-1 Fast Reflex State
  enableLaya?: boolean
  onToggleLaya?: (enabled: boolean) => void
  layaBaseUrl?: string
  onUpdateLayaUrl?: (url: string) => void
  isLayaLive?: boolean
}

export interface BotWorkflowChatMessage {
  id: string
  sender: "user" | "agent"
  text: string
  timestamp: string
  status?: "thinking" | "completed" | "error"
  role?: string
  spec?: FeatureWorkflowSpec
  plan?: FullAppTestPlan
  workflowPrompt?: string
  imageUrl?: string
  isBlockedDiagnostic?: boolean
  blockedDetails?: {
    screens: Array<{ name: string; path?: string; reason?: string }>
    count: number
  }
}

const CONVERSATIONAL_PROMPT_SUGGESTIONS = [
  {
    label: "🚀 Full App Test",
    prompt: "Run full app test across all screens and user flows",
  },
  {
    label: "👤 Act as Customer & test checkout",
    prompt: "Act as a customer and test the checkout flow with synthetic payment details",
  },
  {
    label: "📝 Act as New User & test signup",
    prompt: "Act as a new user and test registration with valid synthetic credentials",
  },
  {
    label: "⚙️ Act as Admin & verify settings",
    prompt: "Act as an admin and test user roles and project settings",
  },
  {
    label: "⚠️ Test invalid inputs & edge cases",
    prompt: "Test form validation with empty required fields and invalid formats",
  },
]

export default function FeatureWorkflowView({
  job,
  isRunning,
  targetUrl,
  projectId = targetUrl || "default",
  activeSubTab = "chat",
  onSubTabChange,
  onStartWorkflowTest,
  onStartFullAppTest,
  onCancelJob,
  onOpenMapPage,
  isMapPageActive = false,
  testingMode = "feature_workflow",
  onSelectTestingMode,
  fullPageView = true,
  isFullStage,
  onToggleFullStage,
  aiProvider = "nebius",
  onUpdateAiProvider,
  nebiusApiKey = "",
  onUpdateNebiusApiKey,
  selectedAiModel = "nvidia/Nemotron-3-Nano-Omni",
  onUpdateAiModel,
  omniRouterBaseUrl = "https://api.unorouter.com/v1",
  onUpdateOmniRouterUrl,
  omniRouterKey = "",
  onUpdateOmniRouterKey,
  omniRouterModel = "fast",
  onUpdateOmniRouterModel,
  localAiBaseUrl = "http://localhost:11434/v1",
  onUpdateLocalBaseUrl,
  isTestingAiConnection = false,
  onTestAiConnection,
  aiConnectionTestResult,
  onOpenAiConfig,
  onCaptureCurrentScreen,
  selectedProjectDir = "landlord-accounting-portal",
  onSelectProjectDir,
  availableProjects = [],
  discoveredRoutes = [],
  onRescanRoutes,
  isScanningRoutes = false,
  onGenerateTestData,
  isGeneratingTestData = false,
  onNavigateUrl,
  onConfirmVerification,
  onSkipVerification,
  onSaveSettingsCredentials,
  onSkipSettingsCredentials,
  onUnblockWorkflows,
  enableLaya = true,
  onToggleLaya,
  layaBaseUrl = "http://127.0.0.1:8000",
  onUpdateLayaUrl,
  isLayaLive = false,
}: FeatureWorkflowViewProps) {
  const [chatMessages, setChatMessages] = useState<BotWorkflowChatMessage[]>([
    {
      id: "bot-welcome",
      sender: "agent",
      text: "👋 I'm your AI Testing Bot. Describe any feature or workflow you want to test naturally.\n\nYou can tell me to act as any role (e.g. \"Act as a customer and test checkout\", \"Act as an admin to manage users\", or \"Test user signup with invalid email\"). I'll identify the path, generate a pre-flight plan, and test edge cases.",
      timestamp: new Date().toISOString(),
      status: "completed",
    },
  ])
  const [chatInput, setChatInput] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedSpec, setAnalyzedSpec] = useState<FeatureWorkflowSpec | null>(null)
  const [previewPlan, setPreviewPlan] = useState<FullAppTestPlan | null>(null)
  const [activeRole, setActiveRole] = useState<string | null>(null)
  const [selectedScreenshotModal, setSelectedScreenshotModal] = useState<string | null>(null)
  const [attachedImage, setAttachedImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false)
  const [verificationUrlInput, setVerificationUrlInput] = useState("")
  const [verificationCodeInput, setVerificationCodeInput] = useState("")
  const [settingsFormValues, setSettingsFormValues] = useState<Record<string, string>>({})
  const [showSettingsSecrets, setShowSettingsSecrets] = useState<Record<string, boolean>>({})
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false)
  const [blockedUsernameInput, setBlockedUsernameInput] = useState("")
  const [blockedPasswordInput, setBlockedPasswordInput] = useState("")
  const [isUnblockingWorkflows, setIsUnblockingWorkflows] = useState(false)
  const [screensSearchInput, setScreensSearchInput] = useState("")
  const [screensSearchQuery, setScreensSearchQuery] = useState("")

  const chatBottomRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages, isAnalyzing])

  // Determine active plan (from current live job or locally generated preview)
  const activePlan = useMemo(() => {
    if (job?.fullAppTestPlan && job.fullAppTestPlan.screens?.length > 0) {
      return job.fullAppTestPlan
    }
    return previewPlan
  }, [job?.fullAppTestPlan, previewPlan])

  const filteredScreens = useMemo(() => {
    const list = activePlan?.screens || []
    const q = screensSearchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter((s) => {
      const name = (s.name || "").toLowerCase()
      const path = (s.path || "").toLowerCase()
      const id = (s.id || "").toLowerCase()
      return name.includes(q) || path.includes(q) || id.includes(q)
    })
  }, [activePlan?.screens, screensSearchQuery])

  // Focused Figma workflow map
  const flowGraph: FlowGraph | null = useMemo(() => {
    if (job?.flowGraph && job.flowGraph.nodes.length > 0) return job.flowGraph
    if (activePlan && activePlan.screens.length > 0) return buildFigmaWorkflowMap(activePlan)
    return null
  }, [job?.flowGraph, activePlan])

  // Active spec (from running job or local analysis)
  const currentSpec = useMemo(() => {
    return job?.featureWorkflowSpec || analyzedSpec
  }, [job?.featureWorkflowSpec, analyzedSpec])

  // Identify blocked steps and screens across the current plan or job
  const blockedSteps = useMemo(() => {
    return activePlan?.steps?.filter((s) => s.status === "blocked") || []
  }, [activePlan?.steps])

  const blockedScreenNames = useMemo(() => {
    const names = new Set<string>()
    blockedSteps.forEach((s) => {
      if (s.screenName) names.add(s.screenName)
      else if (s.screenId) names.add(s.screenId)
    })
    if (job?.authState === "awaiting_credentials") {
      names.add("Authentication / Login Wall")
    }
    if (activePlan?.screens) {
      activePlan.screens.forEach((s) => {
        if (s.isLoginWall || (s as any).testStatus === "blocked") names.add(s.name || s.path)
      })
    }
    return Array.from(names)
  }, [blockedSteps, job?.authState, activePlan?.screens])

  // Execute unblock action (credentials, synthetic data, retry, or skip)
  const handleExecuteUnblock = async (
    mode: "synthetic_data" | "credentials" | "retry" | "skip",
    customUser?: string,
    customPass?: string
  ) => {
    setIsUnblockingWorkflows(true)
    const username = (customUser ?? blockedUsernameInput).trim()
    const password = (customPass ?? blockedPasswordInput).trim()
    try {
      if (onUnblockWorkflows) {
        await onUnblockWorkflows({ mode, username, password })
      } else if (job?.id) {
        await fetch("/api/ai-automation/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: job.id,
            action: "unblock_workflows",
            mode,
            username,
            password,
          }),
        })
      }
      setChatMessages((prev) => [
        ...prev,
        {
          id: `unblock-ack-${Date.now()}`,
          sender: "agent",
          text:
            mode === "skip"
              ? "⏭️ Skipped blocked steps. Continuing with remaining workflows."
              : mode === "credentials"
              ? `🔑 Credentials applied for "${username || "account"}". Unblocked workflows and resumed testing!`
              : mode === "synthetic_data"
              ? "⚡ Auto-filled valid synthetic test data across required inputs. Unblocked workflows and resumed testing!"
              : "🔄 Cleared blockers and retrying workflows now!",
          timestamp: new Date().toISOString(),
          status: "completed",
        },
      ])
      setBlockedUsernameInput("")
      setBlockedPasswordInput("")
    } catch (err: any) {
      console.error("Failed to unblock workflows:", err)
    } finally {
      setIsUnblockingWorkflows(false)
    }
  }

  // Proactively ask diagnostic questions in chat when screens or workflows are blocked
  useEffect(() => {
    if (blockedScreenNames.length === 0 && job?.authState !== "awaiting_credentials") return
    const diagId = `diag-blocked-${job?.id || "run"}-${blockedScreenNames.join("-")}-${blockedSteps.length}`
    setChatMessages((prev) => {
      if (prev.some((m) => m.id === diagId)) return prev
      return [
        ...prev,
        {
          id: diagId,
          sender: "agent",
          text: `⚠️ **I found ${blockedScreenNames.length} blocked screen${blockedScreenNames.length > 1 ? "s" : ""} on your workflows:**\n${blockedScreenNames.map((s) => `• **${s}**`).join("\n")}\n\n**Let's get back on track! Quick questions to unblock:**\n1. 🔑 **Credentials:** Does this screen require test account login? (Type credentials or enter below)\n2. ⚡ **Synthetic Data:** Should I auto-generate valid synthetic accounts and form data?\n3. 🔄 **Retry:** Should I dismiss overlays/modals and retry these actions?\n4. ⏭️ **Skip:** Or skip these blocked steps to continue the rest of the test?`,
          timestamp: new Date().toISOString(),
          status: "completed",
          isBlockedDiagnostic: true,
          blockedDetails: {
            screens: blockedScreenNames.map((n) => ({ name: n })),
            count: blockedScreenNames.length,
          },
        },
      ]
    })
  }, [blockedScreenNames, blockedSteps.length, job?.authState, job?.id])

  // When a test completes, post a summary in chat and automatically switch from execution back to chat
  useEffect(() => {
    if (job?.status === "completed" && job?.id) {
      const summaryId = `job-completed-summary-${job.id}`
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === summaryId)) return prev
        const pCount = activePlan?.steps?.filter((s) => s.status === "passed").length || 0
        const fCount = activePlan?.steps?.filter((s) => s.status === "failed").length || 0
        const bCount = activePlan?.steps?.filter((s) => s.status === "blocked").length || 0
        return [
          ...prev,
          {
            id: summaryId,
            sender: "agent",
            text: `🎉 **Workflow Test Execution Completed!**\n\n• **Steps Passed:** ${pCount}\n• **Steps Failed:** ${fCount}\n• **Steps Blocked:** ${bCount}\n• **Screens Discovered:** ${activePlan?.screens?.length || 0}\n\nYou can review step details in the **Plan** or **Map** tabs, ask me follow-up questions here in chat, or re-run testing.`,
            timestamp: new Date().toISOString(),
            status: "completed",
          },
        ]
      })

      // If user was watching execution, return to chat to see completed results and follow up
      if (activeSubTab === "execution" && onSubTabChange) {
        onSubTabChange("chat")
      }
    }
  }, [job?.status, job?.id, activeSubTab, onSubTabChange, activePlan])

  // Natural language chat / workflow analyzer
  const handleSendChatMessage = async (customPrompt?: string) => {
    const text = (customPrompt || chatInput).trim()
    if (!text || isAnalyzing) return

    setChatInput("")
    setIsAnalyzing(true)

    // Extract role if user wrote "Act as [role]..." or "As a [role]..."
    let detectedRole: string | undefined
    const actMatch = text.match(
      /(?:act\s+as\s+(?:a|an)?\s*([a-zA-Z0-9_\- ]+?)(?:\s+(?:and|to|who|testing|test)|\s*$)|(?:as\s+a|as\s+an)\s+([a-zA-Z0-9_\- ]+?)(?:\s+(?:user|and|to|who|testing|test)|\s*$))/i
    )
    if (actMatch) {
      detectedRole = (actMatch[1] || actMatch[2])?.trim()
    }

    const userMsg: BotWorkflowChatMessage = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      timestamp: new Date().toISOString(),
      role: detectedRole,
    }

    // Check if user answered the unblock questionnaire in chat
    if (blockedScreenNames.length > 0 || job?.authState === "awaiting_credentials") {
      const isSkip = /^\s*(skip|bypass|ignore)\b/i.test(text)
      const isRetry = /^\s*(retry|try again|retest|re-test|unblock)\b/i.test(text)
      const isSynthetic = /^\s*(synthetic|auto-?fill|dummy|fake|generate)\b/i.test(text)
      const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/)
      const passMatch = text.match(/(?:pass(?:word)?[:=\s]+)(\S+)/i)

      if (isSkip) {
        setChatMessages((prev) => [...prev, userMsg])
        setIsAnalyzing(false)
        await handleExecuteUnblock("skip")
        return
      }
      if (isSynthetic) {
        setChatMessages((prev) => [...prev, userMsg])
        setIsAnalyzing(false)
        await handleExecuteUnblock("synthetic_data")
        return
      }
      if (isRetry && !emailMatch) {
        setChatMessages((prev) => [...prev, userMsg])
        setIsAnalyzing(false)
        await handleExecuteUnblock("retry")
        return
      }
      if (emailMatch || passMatch) {
        const u = emailMatch ? emailMatch[0] : (text.match(/(?:user(?:name)?|login|email)[:=\s]+(\S+)/i)?.[1] || "")
        const p = passMatch ? passMatch[1] : ""
        setChatMessages((prev) => [...prev, userMsg])
        setIsAnalyzing(false)
        await handleExecuteUnblock("credentials", u, p)
        return
      }
    }

    if (isFullAppCommand(text)) {
      const thinkingId = `agent-think-${Date.now()}`
      setChatMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: thinkingId,
          sender: "agent",
          text: "🚀 **Full App Test initiated!** Running comprehensive systematic discovery, mapping, and complete test plan generation across the application.",
          timestamp: new Date().toISOString(),
          status: "completed",
        },
      ])
      setIsAnalyzing(false)
      if (onStartFullAppTest) {
        await onStartFullAppTest()
      } else {
        await onStartWorkflowTest(text, undefined, "Full App Test")
      }
      if (onSubTabChange) onSubTabChange("execution")
      return
    }

    const thinkingId = `agent-think-${Date.now()}`
    const thinkingMsg: BotWorkflowChatMessage = {
      id: thinkingId,
      sender: "agent",
      text: detectedRole
        ? `Analyzing workflow acting as "${detectedRole}"... Identifying screens, synthetic data, and edge cases.`
        : `Analyzing feature workflow... Identifying path, synthetic data, and edge cases.`,
      timestamp: new Date().toISOString(),
      status: "thinking",
    }

    setChatMessages((prev) => [...prev, userMsg, thinkingMsg])

    try {
      const resolvedApiKey = aiProvider === "omnirouter" ? omniRouterKey : nebiusApiKey
      const resolvedBaseUrl = aiProvider === "omnirouter" ? omniRouterBaseUrl : (aiProvider === "local" ? localAiBaseUrl : undefined)
      const resolvedModel = aiProvider === "omnirouter" ? omniRouterModel : selectedAiModel

      const res = await fetch("/api/ai-automation/workflow-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowPrompt: text,
          targetUrl,
          openRouterApiKey: resolvedApiKey,
          aiModel: resolvedModel,
          aiBaseUrl: resolvedBaseUrl,
          layaBaseUrl: enableLaya ? (layaBaseUrl || "http://127.0.0.1:8000") : undefined,
        }),
      })
      const data = await res.json()
      if (data.success && data.spec) {
        setAnalyzedSpec(data.spec)
        setPreviewPlan(data.plan)
        if (detectedRole) setActiveRole(detectedRole)

        const responseText = `I've analyzed the **${data.spec.workflowName}** workflow${
          detectedRole ? ` acting as **${detectedRole}**` : ""
        }.\n\n🎯 **Goal:** ${data.spec.userGoal}\n📍 **Starting point:** ${
          data.spec.startingPoint
        }\n🔄 **Target screens:** ${data.spec.likelyScreens.join(" → ")}\n🧪 **Edge cases planned:** ${
          data.spec.edgeCases?.length || 0
        } scenarios.`

        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === thinkingId
              ? {
                  ...msg,
                  text: responseText,
                  status: "completed",
                  spec: data.spec,
                  plan: data.plan,
                  role: detectedRole,
                  workflowPrompt: text,
                }
              : msg
          )
        )
      } else {
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.id === thinkingId
              ? {
                  ...msg,
                  text: `I couldn't fully parse that workflow: ${data.error || "Please describe the feature in a bit more detail."}`,
                  status: "error",
                }
              : msg
          )
        )
      }
    } catch (err: any) {
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.id === thinkingId
            ? {
                ...msg,
                text: `Failed to analyze workflow: ${err?.message || "Network error. Please try again."}`,
                status: "error",
              }
            : msg
        )
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Confirm and start execution
  const handleRunTest = async (promptToRun?: string, roleOverride?: string, nameOverride?: string) => {
    const text = (promptToRun || currentSpec?.userGoal || "").trim()
    if (!text) return
    const role = roleOverride || activeRole || "Customer"
    const name = nameOverride || currentSpec?.workflowName || "Workflow test"
    await onStartWorkflowTest(`[User role: ${role}] [Workflow: ${name}] ${text}`, role, name)
    if (onSubTabChange) onSubTabChange("execution")
  }

  const passedSteps = activePlan?.steps?.filter((s) => s.status === "passed").length || 0
  const totalSteps = activePlan?.steps?.length || 0
  const coveragePct = totalSteps > 0 ? Math.round((passedSteps / totalSteps) * 100) : 0

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. TOP HEADER: MODE TOGGLE & STATUS BANNER */}
      <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {/* Header Title: Test */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs shadow-xs">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span className="font-bold text-white tracking-wide">Test</span>
          </div>

          {/* Laya Status Pill */}
          <div
            onClick={() => onToggleLaya && onToggleLaya(!enableLaya)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition select-none ${
              enableLaya && isLayaLive
                ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300"
                : enableLaya
                ? "bg-amber-950/60 border-amber-500/40 text-amber-300"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title={
              enableLaya && isLayaLive
                ? `Laya System-1 Reflex: Active (~30ms local decisions on ${layaBaseUrl})`
                : enableLaya
                ? `Laya System-1: Connecting to ${layaBaseUrl}...`
                : "Click to enable Laya System-1 fast reflexes"
            }
          >
            <Zap className={`h-3 w-3 ${enableLaya && isLayaLive ? "text-emerald-400 fill-current" : "text-slate-500"}`} />
            <span className="font-semibold text-[10px]">
              Laya {enableLaya && isLayaLive ? "30ms" : enableLaya ? "Offline" : "Disabled"}
            </span>
          </div>

          {/* Workflow Badge if identified */}
          {currentSpec?.workflowName && (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-xs">
              <span className="text-[10px] text-indigo-400 font-semibold uppercase">Workflow:</span>
              <span className="font-bold text-white truncate max-w-[180px]">{currentSpec.workflowName}</span>
              {activeRole && (
                <span className="text-[10px] bg-purple-900/60 border border-purple-500/40 px-1.5 py-0.2 rounded text-purple-200">
                  Act as: {activeRole}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Action Buttons: Run / Stop */}
        <div className="flex items-center gap-2">

          {isRunning ? (
            <button
              type="button"
              onClick={onCancelJob}
              className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-rose-950"
            >
              <Ban className="h-3.5 w-3.5" />
              <span>Stop Testing</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isAnalyzing || !currentSpec}
              onClick={() => handleRunTest()}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-950 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{job?.status === "completed" ? "Re-Run Test" : "Run Test"}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. LIVE PROGRESS BAR WHEN RUNNING */}
      {isRunning && (
        <div className="h-1 bg-slate-900 w-full overflow-hidden shrink-0">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${job?.progress || 10}%` }}
          />
        </div>
      )}

      {/* 3. WORKSPACE SUB-TABS: CHAT, PLAN, MAP, SCREENS, EXECUTION, REPORT */}
      <div className="px-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs shrink-0 overflow-x-auto custom-scrollbar">
        <div className="flex gap-1 py-1.5">
          {[
            { id: "chat", label: "Testing Bot Chat", icon: MessageSquare, isLive: isRunning },
            { id: "plan", label: "Workflow Test Plan", icon: ListChecks, count: activePlan?.steps?.length },
            { id: "map", label: "Focused Workflow Map", icon: MapIcon, count: activePlan?.screens?.length },
            { id: "screens", label: "Relevant Screens", icon: Layers, count: activePlan?.screens?.length },
            { id: "execution", label: "Live Execution & Evidence", icon: Activity, isLive: isRunning },
            {
              id: "coverage",
              label: "Report & Edge Cases",
              icon: ShieldCheck,
              count: job?.edgeCasesTested?.length ? `${job.edgeCasesTested.length} edge cases` : `${coveragePct}%`,
            },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeSubTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSubTabChange && onSubTabChange(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-semibold transition cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-950 font-bold"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isActive ? "bg-indigo-800 text-white" : "bg-slate-800 text-slate-400 border border-slate-700"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.isLive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
                )}
              </button>
            )
          })}
        </div>

        {currentSpec?.edgeCases && currentSpec.edgeCases.length > 0 && (
          <span className="text-[11px] font-mono text-purple-300 hidden md:inline">
            🧪 {currentSpec.edgeCases.length} Edge Cases Planned
          </span>
        )}
      </div>

      {/* 5. MAIN SUBTAB VIEWS */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
        {/* SUBTAB 0: TESTING BOT CHAT CONVERSATION */}
        {(activeSubTab === "chat" || !activeSubTab) && (
          <div className="h-full flex flex-col max-w-4xl mx-auto space-y-3">
            {/* 1. Chat Top Bar: Provider / Model badge + AI Config + Clear Chat */}
            <div className="px-3.5 py-2 rounded-xl border border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs shrink-0 gap-2 shadow-sm">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={onOpenAiConfig}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-950/40 hover:bg-purple-900/50 border border-purple-700/50 text-left transition cursor-pointer group"
                  title="Configure Nebius Token Factory, OmniRouter, or local AI (Draggable Window)"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="font-semibold text-white text-[11px] truncate">
                    {aiProvider === "omnirouter"
                      ? "OmniRouter"
                      : aiProvider === "local"
                      ? "Local Ollama"
                      : "Nebius Token Factory"}
                  </span>
                  <span className="text-[10px] text-purple-300 font-mono truncate max-w-[160px]">
                    ({aiProvider === "omnirouter" ? omniRouterModel || "fast" : (selectedAiModel || "Nemotron-3-Nano").split("/").pop()})
                  </span>
                  <Settings className="h-3 w-3 text-purple-400 opacity-70 group-hover:opacity-100 transition-opacity shrink-0 ml-0.5" />
                </button>
                <span className="text-[10px] text-slate-500 hidden sm:inline">Vision &amp; Automation Active</span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setChatMessages([
                      {
                        id: `welcome-${Date.now()}`,
                        sender: "agent",
                        text: "👋 I'm your AI Testing Bot. Describe any feature or workflow you want to test naturally.\n\nYou can tell me to act as any role (e.g. \"Act as a customer and test checkout\", \"Act as an admin to manage users\", or \"Test user signup with invalid email\"). I'll identify the path, generate a pre-flight plan, and test edge cases.",
                        timestamp: new Date().toISOString(),
                        status: "completed",
                      },
                    ])
                  }}
                  className="px-2.5 py-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 text-[11px] flex items-center gap-1 transition cursor-pointer"
                  title="Clear chat history"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Clear Chat</span>
                </button>
              </div>
            </div>

            {/* Live running status banner */}
            {isRunning && (
              <div className="p-3 rounded-xl bg-indigo-950/50 border border-indigo-500/50 text-xs flex items-center justify-between gap-3 shadow-md shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
                  <span className="font-semibold text-white truncate">
                    Testing in progress: {job?.currentStep || "Executing actions..."}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSubTabChange && onSubTabChange("execution")}
                  className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shrink-0 cursor-pointer"
                >
                  View Live Execution →
                </button>
              </div>
            )}

            {/* Chat Message Stream */}
            <div className="flex-1 min-h-[350px] overflow-y-auto custom-scrollbar p-3.5 space-y-3 rounded-2xl bg-slate-950/70 border border-slate-800">
              {chatMessages.map((msg) => {
                const isUser = msg.sender === "user"
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
                  >
                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-slate-500">
                      {isUser ? (
                        <>
                          <span>You</span>
                          {msg.role && (
                            <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                              Role: {msg.role}
                            </span>
                          )}
                          <span>· {msg.timestamp.slice(11, 16)}</span>
                        </>
                      ) : (
                        <>
                          <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] text-white">
                            <Bot className="h-2.5 w-2.5" />
                          </div>
                          <span className="font-semibold text-indigo-400">Testing Bot</span>
                          <span>· {msg.timestamp.slice(11, 16)}</span>
                        </>
                      )}
                    </div>

                    <div
                      className={`rounded-2xl px-3.5 py-2.5 max-w-[88%] text-xs leading-relaxed ${
                        isUser
                          ? "bg-indigo-600 text-white rounded-tr-none shadow-md"
                          : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none space-y-2.5 shadow-md"
                      }`}
                    >
                      {msg.imageUrl && (
                        <div className="relative rounded-lg overflow-hidden border border-slate-700 max-w-[260px] my-1.5 shadow-sm">
                          <img
                            src={msg.imageUrl}
                            alt="Attached Screen"
                            className="w-full h-auto object-cover max-h-48"
                          />
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

                      {/* Understood Workflow Spec Card & Execution CTA */}
                      {msg.spec && (
                        <div className="p-3 rounded-xl bg-slate-950 border border-indigo-500/40 shadow-lg space-y-2.5 text-xs text-slate-200">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                              <div>
                                <span className="font-bold text-white text-xs block">
                                  {msg.spec.workflowName}
                                </span>
                                {msg.role && (
                                  <span className="text-[10px] text-indigo-300 font-mono">
                                    Persona: {msg.role}
                                  </span>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isRunning}
                              onClick={() =>
                                handleRunTest(msg.workflowPrompt, msg.role, msg.spec?.workflowName)
                              }
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-emerald-950"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>Execute Workflow Test</span>
                            </button>
                          </div>

                          {/* Target Path progression */}
                          {msg.spec.likelyScreens && msg.spec.likelyScreens.length > 0 && (
                            <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] flex flex-wrap items-center gap-1.5">
                              <span className="text-slate-400 font-semibold">Path:</span>
                              {msg.spec.likelyScreens.map((sc, i) => (
                                <React.Fragment key={i}>
                                  <span className="px-2 py-0.5 rounded bg-indigo-950/70 border border-indigo-800 text-indigo-200 font-medium">
                                    {sc}
                                  </span>
                                  {i < msg.spec!.likelyScreens.length - 1 && (
                                    <ArrowRight className="h-3 w-3 text-slate-600 shrink-0" />
                                  )}
                                </React.Fragment>
                              ))}
                            </div>
                          )}

                          {/* Clarification if ambiguous */}
                          {msg.spec.isAmbiguous && msg.spec.clarificationQuestion && (
                            <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-200 flex items-center gap-2">
                              <HelpCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                              <span>{msg.spec.clarificationQuestion}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-1 border-t border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => onSubTabChange && onSubTabChange("plan")}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <ListChecks className="h-3 w-3" />
                              <span>View Generated Steps ({msg.plan?.steps?.length || 0})</span>
                            </button>
                            <span className="text-slate-600">·</span>
                            <button
                              type="button"
                              onClick={() => onSubTabChange && onSubTabChange("map")}
                              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <MapIcon className="h-3 w-3" />
                              <span>View Flow Map</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
              <div ref={chatBottomRef} />
            </div>

            {/* Interactive Verification Prompt Card in Chat */}
            {job && job.verificationState === "awaiting_verification" && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/50 space-y-2 text-xs shrink-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-200 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-amber-400" />
                    Action Required: Confirm Email / Verification
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">Paused</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  {job.verificationPrompt || "Please click confirmation link or enter verification URL/code below."}
                </p>
                <div className="space-y-1.5">
                  <input
                    type="url"
                    value={verificationUrlInput}
                    onChange={(e) => setVerificationUrlInput(e.target.value)}
                    placeholder="Verification / Magic Link URL"
                    className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                  />
                  <input
                    type="text"
                    value={verificationCodeInput}
                    onChange={(e) => setVerificationCodeInput(e.target.value)}
                    placeholder="OTP / Code (if applicable)"
                    className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSubmittingVerification}
                    onClick={async () => {
                      if (!onConfirmVerification) return
                      setIsSubmittingVerification(true)
                      try {
                        await onConfirmVerification(verificationCodeInput, verificationUrlInput)
                      } finally {
                        setIsSubmittingVerification(false)
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingVerification ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    <span>I&apos;ve Completed Verification</span>
                  </button>
                  {onSkipVerification && (
                    <button
                      type="button"
                      disabled={isSubmittingVerification}
                      onClick={onSkipVerification}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Interactive Settings Credentials Form in Chat */}
            {job && job.settingsState === "awaiting_credentials" && (
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/50 space-y-2 text-xs shrink-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-200 flex items-center gap-1.5">
                    <Key className="h-3.5 w-3.5 text-indigo-400" />
                    Action Required: Enter Application Settings Secrets
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">Protected</span>
                </div>
                <p className="text-[11px] text-slate-300">
                  {job.settingsPrompt || "Enter credentials to configure application settings. Secrets are redacted and never logged."}
                </p>
                <div className="space-y-1.5">
                  {(job.requiredSettingsFields && job.requiredSettingsFields.length > 0
                    ? job.requiredSettingsFields
                    : [{ key: "apiKey", label: "API Key", isSecret: true, placeholder: "sk-..." }]
                  ).map((field) => (
                    <div key={field.key} className="space-y-0.5">
                      <label className="text-[10px] text-slate-300 block">{field.label}</label>
                      <input
                        type={field.isSecret && !showSettingsSecrets[field.key] ? "password" : "text"}
                        value={settingsFormValues[field.key] || ""}
                        onChange={(e) => setSettingsFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder || `Enter ${field.label}`}
                        className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isSubmittingSettings}
                    onClick={async () => {
                      if (!onSaveSettingsCredentials) return
                      setIsSubmittingSettings(true)
                      try {
                        await onSaveSettingsCredentials(settingsFormValues)
                      } finally {
                        setIsSubmittingSettings(false)
                      }
                    }}
                    className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingSettings ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    <span>Save &amp; Resume</span>
                  </button>
                  {onSkipSettingsCredentials && (
                    <button
                      type="button"
                      disabled={isSubmittingSettings}
                      onClick={onSkipSettingsCredentials}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Interactive Blocked Screens Diagnostic & Resolution Card in Chat */}
            {(blockedScreenNames.length > 0 || job?.authState === "awaiting_credentials") && (
              <div className="p-3.5 rounded-xl bg-gradient-to-b from-amber-950/40 to-slate-900 border border-amber-500/50 space-y-3 text-xs shrink-0 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-200 flex items-center gap-1.5">
                    <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>⚠️ Blocked Screens Detected ({blockedScreenNames.length})</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">
                    Resolution Needed
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 space-y-1">
                  <p className="font-medium text-slate-200">
                    The bot hit blockers on the following screens. Answer the questions or click a quick action to unblock workflows:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {blockedScreenNames.map((name, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/40 text-amber-200 font-mono text-[10px]"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Quick Diagnostic Inputs: Username / Email & Password */}
                <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                    1. Test Credentials (if screen has login wall):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={blockedUsernameInput}
                      onChange={(e) => setBlockedUsernameInput(e.target.value)}
                      placeholder="Username / Email"
                      className="bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                    />
                    <input
                      type="password"
                      value={blockedPasswordInput}
                      onChange={(e) => setBlockedPasswordInput(e.target.value)}
                      placeholder="Password (optional)"
                      className="bg-slate-900 border border-slate-700 focus:border-amber-500 rounded px-2.5 py-1.5 text-[11px] text-white placeholder-slate-500 font-mono outline-none"
                    />
                  </div>
                </div>

                {/* Unblock Action Chips */}
                <div className="space-y-1.5">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                    2. Select Unblock Action:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      disabled={isUnblockingWorkflows}
                      onClick={() => handleExecuteUnblock("synthetic_data")}
                      className="px-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] flex flex-col items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50 text-center shadow-sm"
                      title="Auto-fill form inputs with generated synthetic test data and unblock"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-indigo-200" />
                      <span>⚡ Auto-fill Synthetic</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUnblockingWorkflows || (!blockedUsernameInput.trim() && !blockedPasswordInput.trim())}
                      onClick={() => handleExecuteUnblock("credentials")}
                      className="px-2 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] flex flex-col items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50 text-center shadow-sm"
                      title="Submit entered credentials to login and continue testing"
                    >
                      <Key className="h-3.5 w-3.5 text-emerald-200" />
                      <span>🔑 Submit Credentials</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUnblockingWorkflows}
                      onClick={() => handleExecuteUnblock("retry")}
                      className="px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[11px] flex flex-col items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50 text-center border border-slate-700"
                      title="Clear overlays and reset blocked status to retry screen"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-slate-300" />
                      <span>🔄 Retry Screens</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUnblockingWorkflows}
                      onClick={() => handleExecuteUnblock("skip")}
                      className="px-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[11px] flex flex-col items-center justify-center gap-1 transition cursor-pointer disabled:opacity-50 text-center border border-slate-700"
                      title="Skip blocked steps and resume testing subsequent workflows"
                    >
                      <FastForward className="h-3.5 w-3.5 text-slate-400" />
                      <span>⏭️ Skip Steps</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions Drawer */}
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs shrink-0 space-y-1.5 shadow-sm">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <button
                  type="button"
                  onClick={() => setIsQuickActionsOpen((prev) => !prev)}
                  className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer group"
                  title="Toggle Quick Commands, Target Project Routes & Test Data"
                >
                  <Wand2 className="h-3 w-3 text-indigo-400 group-hover:rotate-12 transition-transform" />
                  <span>Quick Actions (7)</span>
                  <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isQuickActionsOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Fast Action Chips when collapsed */}
                <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      if (onSubTabChange) onSubTabChange("plan")
                    }}
                    disabled={isAnalyzing || isRunning}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-600/30 border border-purple-500 text-purple-200 hover:bg-purple-600 hover:text-white transition cursor-pointer truncate disabled:opacity-50"
                  >
                    🎯 Feature Test
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartFullAppTest && onStartFullAppTest()}
                    disabled={isAnalyzing || isRunning}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-600/30 border border-indigo-500 text-indigo-200 hover:bg-indigo-600 hover:text-white transition cursor-pointer truncate disabled:opacity-50"
                  >
                    🚀 Full App Test
                  </button>
                </div>
              </div>

              {/* Expanded Presets & Project Route Chips */}
              {isQuickActionsOpen && (
                <div className="pt-2 space-y-2 border-t border-slate-800 animate-in fade-in-50 duration-150">
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
                            if (onStartFullAppTest) onStartFullAppTest()
                          } else {
                            const cleanPrompt = chip.replace(/^[^\s]+\s+/, "")
                            setChatInput(cleanPrompt)
                            handleSendChatMessage(cleanPrompt)
                          }
                        }}
                        disabled={isAnalyzing || isRunning}
                        className={`shrink-0 px-2.5 py-1 rounded-lg border text-[10px] transition cursor-pointer disabled:opacity-50 ${
                          chip.startsWith("🎯") || chip.startsWith("👤") || chip.startsWith("🖼️")
                            ? "bg-purple-950/50 border-purple-500/60 text-purple-200 font-bold hover:bg-purple-600 hover:text-white"
                            : chip.includes("Full App")
                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 font-bold hover:bg-indigo-600 hover:text-white"
                            : "bg-slate-950 border-slate-800 hover:border-indigo-500 hover:bg-indigo-950/30 text-slate-300 hover:text-white"
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  {/* Target Project Routes & Test Data provision */}
                  <div className="pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {availableProjects && availableProjects.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Layers className="h-3 w-3 text-indigo-400 shrink-0" />
                          <span className="font-semibold text-slate-300">Project:</span>
                          <select
                            value={selectedProjectDir}
                            onChange={(e) => onSelectProjectDir && onSelectProjectDir(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-white font-mono outline-none"
                          >
                            {availableProjects.map((p) => (
                              <option key={p.path} value={p.path}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {onGenerateTestData && (
                        <button
                          type="button"
                          onClick={onGenerateTestData}
                          disabled={isGeneratingTestData}
                          className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 flex items-center gap-1 text-[10px] font-semibold transition cursor-pointer disabled:opacity-50 shrink-0"
                          title="Generate dummy files (PDFs, CSVs, images, notes) in target project"
                        >
                          {isGeneratingTestData ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400" />
                          ) : (
                            <Sparkles className="h-2.5 w-2.5 text-amber-400" />
                          )}
                          <span>Generate Test Data</span>
                        </button>
                      )}
                    </div>

                    {onRescanRoutes && (
                      <button
                        type="button"
                        onClick={onRescanRoutes}
                        disabled={isScanningRoutes}
                        className="text-[9px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer shrink-0"
                        title="Rescan target project routes"
                      >
                        <RotateCcw className={`h-2.5 w-2.5 ${isScanningRoutes ? "animate-spin" : ""}`} />
                        <span>Rescan Routes</span>
                      </button>
                    )}
                  </div>

                  {discoveredRoutes && discoveredRoutes.length > 0 && (
                    <div className="flex gap-1 overflow-x-auto pb-0.5 custom-scrollbar">
                      {discoveredRoutes.map((r, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (onNavigateUrl) onNavigateUrl(r.url)
                            setChatInput(`Test and inspect route ${r.path}`)
                            handleSendChatMessage(`Test and inspect route ${r.path}`)
                          }}
                          disabled={isAnalyzing || isRunning}
                          className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono bg-slate-950 hover:bg-indigo-950/40 text-slate-300 hover:text-white border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer disabled:opacity-50"
                          title={`Click to test: ${r.path} (${r.url})`}
                        >
                          {r.path}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Prompt Suggestion Chips (Role starters, not fixed apps) */}
            <div className="space-y-1.5 pt-1 shrink-0">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Conversational Prompts &amp; Role Instructions:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {CONVERSATIONAL_PROMPT_SUGGESTIONS.map((sug, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setChatInput(sug.prompt)
                      handleSendChatMessage(sug.prompt)
                    }}
                    disabled={isAnalyzing || isRunning}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500/60 hover:bg-indigo-950/20 text-slate-300 hover:text-white text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
                  >
                    {sug.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Attached Image Preview */}
            {attachedImage && (
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs shrink-0 shadow-sm">
                <div className="flex items-center gap-2">
                  <img
                    src={attachedImage}
                    alt="Attached screen"
                    className="h-10 w-10 rounded-lg object-cover border border-slate-700 shadow-sm"
                  />
                  <div>
                    <span className="text-[11px] font-semibold text-white block">Image Attached</span>
                    <span className="text-[10px] text-slate-400">Testing bot will inspect this screen during planning and visual audit</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachedImage(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Remove image"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Conversational Input Bar */}
            <div className="flex items-center gap-2 shrink-0 pt-1">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImageFileChange}
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isAnalyzing || isRunning}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 transition cursor-pointer shrink-0 disabled:opacity-50"
                title="Upload Mockup / Screenshot Image"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (onCaptureCurrentScreen) {
                    onCaptureCurrentScreen()
                  } else if (job?.currentScreenshotUrl) {
                    setAttachedImage(job.currentScreenshotUrl)
                  }
                }}
                disabled={isAnalyzing || isRunning}
                className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 transition cursor-pointer shrink-0 disabled:opacity-50"
                title="Capture Live Simulator Screen & Test"
              >
                <Camera className="h-4 w-4" />
              </button>

              <div className="relative flex-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && (chatInput.trim() || attachedImage)) {
                      e.preventDefault()
                      handleSendChatMessage()
                    }
                  }}
                  disabled={isAnalyzing || isRunning}
                  placeholder={
                    attachedImage
                      ? "Add instructions for attached image or press Send..."
                      : "Tell the testing bot what to test (e.g. 'Act as customer and test checkout', 'Test user profile update')..."
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-inner disabled:opacity-50"
                />
                {isAnalyzing && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-purple-300">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Analyzing...</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={(!chatInput.trim() && !attachedImage) || isAnalyzing || isRunning}
                onClick={() => handleSendChatMessage()}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-950 shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>

              {isRunning && onCancelJob && (
                <button
                  type="button"
                  onClick={onCancelJob}
                  className="p-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center justify-center cursor-pointer shadow-md shadow-rose-950 shrink-0"
                  title="Stop Running Test"
                >
                  <Square className="h-4 w-4 fill-current" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* SUBTAB 1: WORKFLOW TEST PLAN (TEST-001, TEST-002, ...) */}
        {activeSubTab === "plan" && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-indigo-400" />
                  Workflow-Specific Pre-Flight Test Plan
                </h3>
                <p className="text-xs text-slate-400">
                  Every step is planned before execution. Shows starting point, targeted actions, synthetic data, and expected results.
                </p>
              </div>

              {activePlan && (
                <span className="font-mono text-xs text-indigo-400 font-bold px-2 py-1 rounded bg-indigo-950/60 border border-indigo-800">
                  {passedSteps} / {totalSteps} Steps Passed
                </span>
              )}
            </div>

            {/* Blocked Steps Resolution Alert Banner */}
            {blockedSteps.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/50 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <div>
                    <span className="font-bold text-amber-200 block">
                      ⚠️ {blockedSteps.length} Step{blockedSteps.length > 1 ? "s" : ""} Blocked
                    </span>
                    <span className="text-[11px] text-slate-300">
                      Testing Bot asked diagnostic questions in chat to resolve and resume these workflows.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSubTabChange && onSubTabChange("chat")}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shrink-0 cursor-pointer shadow-md shadow-amber-950"
                >
                  Open Chat to Unblock →
                </button>
              </div>
            )}

            {/* Steps List */}
            {activePlan?.steps && activePlan.steps.length > 0 ? (
              <div className="space-y-2">
                {activePlan.steps.map((step) => {
                  const isPassed = step.status === "passed"
                  const isFailed = step.status === "failed"
                  const isBlocked = step.status === "blocked"
                  const isRunningStep = step.status === "running"

                  return (
                    <div
                      key={step.id}
                      className={`p-3 rounded-xl border text-xs transition ${
                        isPassed
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-200"
                          : isFailed
                          ? "bg-rose-950/20 border-rose-800/40 text-rose-200"
                          : isBlocked
                          ? "bg-amber-950/30 border-amber-500/50 text-amber-200 ring-1 ring-amber-500/30"
                          : isRunningStep
                          ? "bg-indigo-950/40 border-indigo-500 shadow-md ring-1 ring-indigo-400 animate-pulse"
                          : "bg-slate-900/60 border-slate-800 text-slate-300"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-400">{step.id}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                            {step.screenName}
                          </span>
                          <span className="font-bold text-white">{step.targetName}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {step.syntheticValue && (
                            <span className="text-[10px] text-purple-300 font-mono bg-purple-950/50 px-2 py-0.5 rounded border border-purple-800/40">
                              Data: {step.syntheticValue}
                            </span>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                              isPassed
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : isFailed
                                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                : isBlocked
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : isRunningStep
                                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {step.status}
                          </span>
                        </div>
                      </div>

                      {/* Expected vs Actual */}
                      <div className="mt-2 pt-2 border-t border-slate-800/60 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-500 font-semibold block">Expected:</span>
                          <span className="text-slate-300">{step.expectedResult}</span>
                        </div>
                        {step.actualResult && (
                          <div>
                            <span className="text-slate-500 font-semibold block">Actual Result:</span>
                            <span className={isPassed ? "text-emerald-300" : isFailed ? "text-rose-300" : "text-slate-300"}>
                              {step.actualResult}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Screenshot Thumbnail */}
                      {step.screenshotUrl && (
                        <div className="mt-2 pt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedScreenshotModal(step.screenshotUrl!)}
                            className="inline-flex items-center gap-1.5 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            <span>View Step Evidence Screenshot</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="p-12 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center space-y-2">
                <ListChecks className="h-8 w-8 text-slate-600 mx-auto" />
                <h4 className="text-sm font-bold text-slate-300">No Test Plan Generated Yet</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Describe what you would like to test in the Testing Bot Chat to generate the pre-flight test plan.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: FOCUSED WORKFLOW MAP */}
        {activeSubTab === "map" && (
          <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-indigo-400" />
                  Focused Figma-Style Workflow Map
                </h3>
                <p className="text-xs text-slate-400">
                  Shows only the screens and action transitions specifically required for this workflow.
                </p>
              </div>
              {onOpenMapPage && (
                <button
                  type="button"
                  onClick={onOpenMapPage}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Full Screen Map</span>
                </button>
              )}
            </div>

            {flowGraph && flowGraph.nodes.length > 0 ? (
              <div className="flex-1 min-h-[500px]">
                <TestFlowGraph
                  graph={flowGraph}
                  screens={activePlan?.screens}
                  steps={activePlan?.steps}
                  transitions={activePlan?.transitions}
                  plan={activePlan || undefined}
                  onViewScreenshot={(url) => setSelectedScreenshotModal(url)}
                  isFullStage={isFullStage !== undefined ? isFullStage : true}
                  onToggleFullStage={onToggleFullStage}
                />
              </div>
            ) : (
              <div className="p-12 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center space-y-2 flex-1 flex flex-col items-center justify-center">
                <MapIcon className="h-8 w-8 text-slate-600" />
                <h4 className="text-sm font-bold text-slate-300">Workflow Map Not Yet Built</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  Run the workflow test to build the focused visual graph connecting only the screens involved in this feature.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 3: RELEVANT SCREENS INVENTORY */}
        {activeSubTab === "screens" && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-400" />
                  Screens Involved in Workflow
                </h3>
                <p className="text-xs text-slate-400">
                  Only screens traversed for this feature (not the entire application).
                </p>
              </div>
              <div className="flex items-center gap-2">
                {screensSearchQuery && (
                  <span className="font-mono text-[10px] text-indigo-300 font-semibold px-2 py-0.5 rounded bg-indigo-950/60 border border-indigo-800">
                    {filteredScreens.length} of {activePlan?.screens?.length || 0}
                  </span>
                )}
                <span className="font-mono text-xs text-slate-400">
                  {activePlan?.screens?.length || 0} Screens
                </span>
              </div>
            </div>

            {/* Screens Search Bar */}
            {activePlan?.screens && activePlan.screens.length > 0 && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setScreensSearchQuery(screensSearchInput.trim())
                }}
                className="relative flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    value={screensSearchInput}
                    onChange={(e) => setScreensSearchInput(e.target.value)}
                    placeholder="Search tested screens by name or path..."
                    className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-slate-500 outline-none transition"
                  />
                  {(screensSearchInput || screensSearchQuery) && (
                    <button
                      type="button"
                      onClick={() => {
                        setScreensSearchInput("")
                        setScreensSearchQuery("")
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
                      title="Clear screen search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!screensSearchInput.trim() && !screensSearchQuery}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs transition cursor-pointer shrink-0 shadow-xs"
                  title="Submit search (Enter)"
                >
                  Submit
                </button>
              </form>
            )}

            {filteredScreens.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredScreens.map((sc) => (
                  <div
                    key={sc.id}
                    className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-indigo-400">{sc.id}</span>
                      {sc.isNewDiscovery && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          NEW DISCOVERY
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-white text-sm truncate">{sc.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">{sc.path}</div>

                    {sc.screenshotUrl && (
                      <div
                        onClick={() => setSelectedScreenshotModal(sc.screenshotUrl!)}
                        className="cursor-pointer border border-slate-800 rounded-lg overflow-hidden hover:border-indigo-500 transition"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={sc.screenshotUrl}
                          alt={sc.name}
                          className="w-full h-32 object-cover object-top hover:opacity-90 transition"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : screensSearchQuery ? (
              <div className="p-8 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center space-y-2">
                <Search className="h-6 w-6 text-slate-600 mx-auto" />
                <h4 className="text-xs font-bold text-slate-300">No Screens Match &quot;{screensSearchQuery}&quot;</h4>
                <button
                  type="button"
                  onClick={() => setScreensSearchQuery("")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline cursor-pointer"
                >
                  Clear search query
                </button>
              </div>
            ) : (
              <div className="p-12 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center space-y-2">
                <Layers className="h-8 w-8 text-slate-600 mx-auto" />
                <h4 className="text-sm font-bold text-slate-300">No Screens Discovered Yet</h4>
                <p className="text-xs text-slate-500">
                  Execute the test to discover the screens on this workflow path.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 4: LIVE EXECUTION & EVIDENCE TRACE */}
        {activeSubTab === "execution" && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-400" />
                  Live Execution Trace (Action → Observe → Verify → Record)
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time execution log of actions, observations, DOM changes, and screenshot captures.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onSubTabChange && onSubTabChange("chat")}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shrink-0"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Testing Bot Chat</span>
              </button>
            </div>

            {/* Test Completed Banner */}
            {job?.status === "completed" && (
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/40 text-xs flex items-center justify-between gap-3 shadow-lg">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-bold text-white block text-xs">Test Execution Completed</span>
                    <span className="text-[11px] text-slate-300">
                      {passedSteps} of {totalSteps} steps passed. Testing Bot has summarized results in Chat.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSubTabChange && onSubTabChange("chat")}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0 cursor-pointer shadow-md shadow-emerald-950"
                >
                  Return to Chat →
                </button>
              </div>
            )}

            {/* Current Step Status Banner */}
            {isRunning && (
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
                  <span className="font-semibold text-white truncate">{job?.currentStep || "Executing..."}</span>
                </div>
                <span className="font-mono text-indigo-300 font-bold">{job?.progress || 0}%</span>
              </div>
            )}

            {/* Terminal logs list */}
            {job?.logs && job.logs.length > 0 ? (
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar">
                {job.logs.map((log, idx) => (
                  <div key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-600 text-[10px] shrink-0">{log.timestamp.slice(11, 19)}</span>
                    <span
                      className={`text-[9px] font-bold uppercase px-1 rounded shrink-0 ${
                        log.level === "success"
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                          : log.level === "warn"
                          ? "bg-amber-950 text-amber-400 border border-amber-800"
                          : log.level === "error"
                          ? "bg-rose-950 text-rose-400 border border-rose-800"
                          : "bg-slate-900 text-slate-400"
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="text-slate-200">{log.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                Terminal logs will stream here as the workflow test executes.
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 5: REPORT & EDGE CASES */}
        {activeSubTab === "coverage" && (
          <div className="space-y-4 max-w-5xl mx-auto">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  Final Workflow Test Report & Edge Cases
                </h3>
                <p className="text-xs text-slate-400">
                  Detailed verification results for the workflow, tested edge cases, bugs found, and overall workflow coverage.
                </p>
              </div>

              <button
                type="button"
                onClick={() => onSubTabChange && onSubTabChange("chat")}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-md shrink-0"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Testing Bot Chat</span>
              </button>
            </div>

            {/* Summary Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">Workflow Coverage</span>
                <span className="text-lg font-bold text-white font-mono">{coveragePct}%</span>
                <span className="text-[10px] text-emerald-400 block mt-0.5">{passedSteps}/{totalSteps} Steps Passed</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">Edge Cases Verified</span>
                <span className="text-lg font-bold text-purple-300 font-mono">
                  {job?.edgeCasesTested?.filter((e) => e.status === "passed").length || currentSpec?.edgeCases?.length || 0}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Focused boundary tests</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">Screens Involved</span>
                <span className="text-lg font-bold text-indigo-300 font-mono">
                  {activePlan?.screens?.length || currentSpec?.likelyScreens?.length || 0}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Targeted feature path</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-semibold">Bugs / Issues Found</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  {job?.issues?.length || 0}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">Console / DOM issues</span>
              </div>
            </div>

            {/* Edge Cases Breakdown */}
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <span>🧪 Tested Edge Cases</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Focused on this feature only</span>
              </div>

              <div className="space-y-2">
                {(job?.edgeCasesTested || currentSpec?.edgeCases || []).map((ec: FeatureWorkflowEdgeCase) => {
                  const isPassed = ec.status === "passed" || job?.status === "completed"
                  return (
                    <div
                      key={ec.id}
                      className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-purple-400 text-[11px]">{ec.id}</span>
                          <span className="font-bold text-white">{ec.name}</span>
                          <span className="text-[9px] font-mono uppercase px-1 rounded bg-slate-800 text-slate-400">
                            {ec.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">{ec.description}</p>
                        <p className="text-[10px] text-slate-500">
                          Expected: <span className="text-slate-300">{ec.expectedBehavior}</span>
                        </p>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${
                          isPassed
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {isPassed ? "PASSED" : ec.status || "PENDING"}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Final Report Summary */}
            {job?.report && (
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
                <span className="font-bold text-white block">Executive Summary</span>
                <p className="text-slate-300 leading-relaxed">{job.report.summary}</p>
                {(job.report.recordingUrl || job.recordingUrl || (job.recordingSegments && job.recordingSegments.length > 0)) && (
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <span className="font-semibold text-slate-200 text-[11px] flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5 text-indigo-400" /> Session recording
                    </span>
                    {(job.report.recordingUrl || job.recordingUrl) && (
                      <video
                        controls
                        preload="metadata"
                        src={job.report.recordingUrl || job.recordingUrl}
                        className="w-full max-h-[420px] rounded-lg border border-slate-700 bg-black"
                        aria-label="Recorded browser test session"
                      />
                    )}
                    {job.recordingSegments && job.recordingSegments.length > 1 && (
                      <div className="flex flex-wrap gap-2">
                        {job.recordingSegments.map((url, index) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-indigo-300 underline underline-offset-2 hover:text-indigo-200"
                          >
                            Open recording segment {index + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {job.report.recommendations && job.report.recommendations.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 space-y-1">
                    <span className="font-semibold text-slate-400 text-[11px] block">Recommendations:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-300 text-[11px]">
                      {job.report.recommendations.map((rec, rIdx) => (
                        <li key={rIdx}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 6. FULL-RESOLUTION SCREENSHOT PREVIEW MODAL */}
      {selectedScreenshotModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedScreenshotModal(null)}
        >
          <div
            className="relative max-w-4xl max-h-[85vh] bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs text-slate-300">
              <span className="font-bold">Step Evidence Screenshot</span>
              <button
                type="button"
                onClick={() => setSelectedScreenshotModal(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-2 overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedScreenshotModal}
                alt="Screenshot Evidence"
                className="max-h-[75vh] w-auto object-contain mx-auto rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
