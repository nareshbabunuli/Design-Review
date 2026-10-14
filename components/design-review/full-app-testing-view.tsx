"use client"

import React, { useState, useMemo, useCallback, useEffect } from "react"
import type {
  AutomationJob,
  FullAppTestPlan,
  AppScreenNode,
  TestPlanStep,
  ActionableElement,
} from "@/lib/ai-automation/types"
import TestFlowGraph from "./test-flow-graph"
import ActionLedgerPanel from "./action-ledger-panel"
import { synthesizeFullAppPlanFromJob, buildFigmaWorkflowMap } from "@/lib/ai-automation/full-app-utils"
import {
  Compass,
  Map as MapIcon,
  Layers,
  ListChecks,
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileUp,
  Sparkles,
  Cpu,
  Eye,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  Maximize2,
  ChevronRight,
  ShieldAlert,
  ExternalLink,
  Check,
  Clock,
  Ban,
  UploadCloud,
  FileSpreadsheet,
  Film,
  PlusCircle,
  HelpCircle,
  Columns,
  Loader2,
  Trash2,
  Archive,
  MessageSquare,
  RotateCcw,
  Edit3,
  KeyRound,
  Search,
  X,
} from "lucide-react"

interface FullAppTestingViewProps {
  job: AutomationJob | null
  isRunning: boolean
  targetUrl: string
  onStartFullAppTest: (
    dummyFiles?: Record<string, { name: string; url: string; type: string }>,
    credentialsOverride?: { username?: string; password?: string }
  ) => Promise<void>
  onCancelJob?: () => void
  onJobUpdate?: (updatedJob: AutomationJob) => void
  activeSubTab?: "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  onSubTabChange?: (tab: "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage") => void
  fullPageView?: boolean
  hideSubNav?: boolean
  onOpenMapPage?: () => void
  isMapPageActive?: boolean
  onOpenBesideScreen?: () => void
  isBesideScreen?: boolean
  isFullStage?: boolean
  onToggleFullStage?: () => void
  testingMode?: "full_app" | "feature_workflow"
  onSelectTestingMode?: (mode: "full_app" | "feature_workflow") => void
}

export default function FullAppTestingView({
  job,
  isRunning,
  targetUrl,
  onStartFullAppTest,
  onCancelJob,
  onJobUpdate,
  activeSubTab: controlledSubTab,
  onSubTabChange,
  fullPageView = false,
  hideSubNav = false,
  onOpenMapPage,
  isMapPageActive = false,
  onOpenBesideScreen,
  isBesideScreen = false,
  isFullStage,
  onToggleFullStage,
  testingMode = "full_app",
  onSelectTestingMode,
}: FullAppTestingViewProps) {
  const plan = useMemo(() => {
    if (job?.fullAppTestPlan && job.fullAppTestPlan.screens?.length > 0) {
      return job.fullAppTestPlan
    }
    return synthesizeFullAppPlanFromJob(job)
  }, [job])

  const flowGraph = useMemo(() => {
    if (job?.flowGraph && job.flowGraph.nodes.length > 0) return job.flowGraph
    if (plan && plan.screens.length > 0) return buildFigmaWorkflowMap(plan)
    return null
  }, [job?.flowGraph, plan])

  const [internalSubTab, setInternalSubTab] = useState<
    "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  >("map")
  const activeSubTab = controlledSubTab || internalSubTab

  const handleSubTabChange = (tab: "chat" | "map" | "screens" | "plan" | "execution" | "files" | "coverage") => {
    setInternalSubTab(tab)
    if (onSubTabChange) onSubTabChange(tab)
  }

  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null)
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)
  const [filterStepStatus, setFilterStepStatus] = useState<string>("all")
  const [planChatInput, setPlanChatInput] = useState("")
  const [planChatBusy, setPlanChatBusy] = useState(false)
  const [planChatMessages, setPlanChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([])
  const [planApprovalBusy, setPlanApprovalBusy] = useState(false)
  const [isExportingZip, setIsExportingZip] = useState(false)
  const [isResettingData, setIsResettingData] = useState(false)

  // Evidence stream screen search state
  const [evidenceSearchInput, setEvidenceSearchInput] = useState("")
  const [evidenceSearchQuery, setEvidenceSearchQuery] = useState("")

  // Step value inline editing
  const [editingStepId, setEditingStepId] = useState<string | null>(null)
  const [editingStepValue, setEditingStepValue] = useState<string>("")
  const [isSavingStepValue, setIsSavingStepValue] = useState(false)

  // Plan credentials quick-bar
  const [planCredUser, setPlanCredUser] = useState("")
  const [planCredPass, setPlanCredPass] = useState("")
  const [isApplyingPlanCreds, setIsApplyingPlanCreds] = useState(false)

  const testedScreensList = useMemo(() => {
    const screenNames = new Set<string>()
    if (plan?.screens) {
      plan.screens.forEach((s) => {
        if (s.name) screenNames.add(s.name)
        else if (s.path) screenNames.add(s.path)
      })
    }
    if (plan?.steps) {
      plan.steps.forEach((s) => {
        if (s.screenName) screenNames.add(s.screenName)
      })
    }
    if (job?.actionLedger?.entries) {
      job.actionLedger.entries.forEach((e) => {
        const name = (e as any).screenName || e.screenPath || e.name || e.screenId
        if (name) screenNames.add(name)
      })
    }
    return Array.from(screenNames)
  }, [plan?.screens, plan?.steps, job?.actionLedger?.entries])

  const filteredEvidenceSteps = useMemo(() => {
    const all = (plan?.steps || []).filter((s) => Boolean(s.screenshotUrl))
    const q = evidenceSearchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter((s) => {
      const sName = (s.screenName || "").toLowerCase()
      const tName = (s.targetName || "").toLowerCase()
      const sId = (s.screenId || s.id || "").toLowerCase()
      const exp = (s.expectedResult || "").toLowerCase()
      const act = (s.actualResult || "").toLowerCase()
      return sName.includes(q) || tName.includes(q) || sId.includes(q) || exp.includes(q) || act.includes(q)
    })
  }, [plan?.steps, evidenceSearchQuery])

  useEffect(() => {
    try {
      const savedStr = typeof window !== "undefined" ? localStorage.getItem("simulator_auth_credentials") : null
      if (savedStr) {
        const parsed = JSON.parse(savedStr)
        if (parsed.username) setPlanCredUser(parsed.username)
        if (parsed.password) setPlanCredPass(parsed.password)
      }
    } catch {}
  }, [])

  const handleSaveStepValue = async (stepId: string) => {
    if (!job?.id) return
    setIsSavingStepValue(true)
    try {
      if (job.fullAppTestPlan?.steps) {
        const target = job.fullAppTestPlan.steps.find((s) => s.id === stepId)
        if (target) {
          target.syntheticValue = editingStepValue
          const isEmail = /e-?mail/i.test(target.targetName) || /e-?mail/i.test(target.targetSelector || "")
          const isPass = /pass/i.test(target.targetName) || /pass/i.test(target.targetSelector || "")
          try {
            const savedStr = localStorage.getItem("simulator_auth_credentials")
            const parsed = savedStr ? JSON.parse(savedStr) : {}
            if (isEmail) parsed.username = editingStepValue
            if (isPass) parsed.password = editingStepValue
            localStorage.setItem("simulator_auth_credentials", JSON.stringify(parsed))
          } catch {}
        }
      }

      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          projectId: job.projectId,
          action: "update_step_value",
          stepId,
          value: editingStepValue,
        }),
      })

      if (onJobUpdate) onJobUpdate({ ...job })
      setEditingStepId(null)
    } catch (e) {
      console.error("Failed to update step value:", e)
    } finally {
      setIsSavingStepValue(false)
    }
  }

  const handleApplyPlanCredentials = async () => {
    if (!job?.id || (!planCredUser.trim() && !planCredPass.trim())) return
    setIsApplyingPlanCreds(true)
    try {
      const u = planCredUser.trim()
      const p = planCredPass.trim()

      try {
        const savedStr = localStorage.getItem("simulator_auth_credentials")
        const parsed = savedStr ? JSON.parse(savedStr) : {}
        if (u) parsed.username = u
        if (p) parsed.password = p
        localStorage.setItem("simulator_auth_credentials", JSON.stringify(parsed))
      } catch {}

      if (job.fullAppTestPlan?.steps) {
        for (const s of job.fullAppTestPlan.steps) {
          if (s.actionType === "fill") {
            const isEmail = /e-?mail/i.test(s.targetName) || /e-?mail/i.test(s.targetSelector || "")
            const isUser = /user|login/i.test(s.targetName) || /user|login/i.test(s.targetSelector || "")
            const isPass = /pass/i.test(s.targetName) || /pass/i.test(s.targetSelector || "")
            if ((isEmail || isUser) && u) s.syntheticValue = u
            if (isPass && p) s.syntheticValue = p
          }
        }
      }

      await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          projectId: job.projectId,
          action: "provide_credentials",
          username: u,
          password: p,
        }),
      })

      if (onJobUpdate) onJobUpdate({ ...job })
    } catch (e) {
      console.error("Failed to apply plan credentials:", e)
    } finally {
      setIsApplyingPlanCreds(false)
    }
  }

  const handleExportZip = async () => {
    if (!job?.id || isExportingZip) return
    setIsExportingZip(true)
    try {
      const res = await fetch(`/api/ai-automation/export-zip?jobId=${job.id}`)
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
      a.download = filenameMatch?.[1] || `test-bundle-${job.id.slice(0, 8)}.zip`
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
    if (!job?.id || isResettingData) return
    const confirmed = window.confirm(
      "Are you sure you want to reset all discovered screens and test plan data? This will clear the current map and tests so you can start a fresh run."
    )
    if (!confirmed) return

    setIsResettingData(true)
    try {
      const res = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "reset_test_data" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not reset map data")
      if (data.job) onJobUpdate?.(data.job)
      window.dispatchEvent(new CustomEvent("ai-simulator-data-reset", { detail: { jobId: job.id } }))
    } catch (err: any) {
      alert(`Reset failed: ${err?.message || "Could not reset data"}`)
    } finally {
      setIsResettingData(false)
    }
  }

  useEffect(() => {
    if (job?.planApprovalState === "awaiting_review" && job.fullAppTestPlan?.screens?.length) {
      setInternalSubTab("plan")
      onSubTabChange?.("plan")
    }
  }, [job?.planApprovalState, job?.fullAppTestPlan?.id, job?.fullAppTestPlan?.steps?.length, onSubTabChange])

  const submitPlanChat = async () => {
    if (!job?.id || !planChatInput.trim() || planChatBusy) return
    const instruction = planChatInput.trim()
    setPlanChatMessages((messages) => [...messages, { role: "user", text: instruction }])
    setPlanChatInput("")
    setPlanChatBusy(true)
    try {
      const response = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "edit_test_plan", instruction }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not update the plan")
      if (data.job) onJobUpdate?.(data.job)
      setPlanChatMessages((messages) => [...messages, { role: "assistant", text: data.message || "Plan updated. Review the changes before approving." }])
    } catch (error) {
      setPlanChatMessages((messages) => [...messages, { role: "assistant", text: error instanceof Error ? error.message : "Could not update the plan." }])
    } finally {
      setPlanChatBusy(false)
    }
  }

  const approveTestPlan = async () => {
    if (!job?.id || planApprovalBusy) return
    setPlanApprovalBusy(true)
    try {
      const response = await fetch("/api/ai-automation/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "approve_test_plan" }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not approve the plan")
      if (data.job) onJobUpdate?.(data.job)
      setPlanChatMessages((messages) => [...messages, { role: "assistant", text: "Plan approved. The current browser session will continue into execution." }])
    } catch (error) {
      setPlanChatMessages((messages) => [...messages, { role: "assistant", text: error instanceof Error ? error.message : "Could not approve the plan." }])
    } finally {
      setPlanApprovalBusy(false)
    }
  }

  const handleDeleteScreen = useCallback(
    (screenId: string) => {
      if (!job) return

      const currentScreens = plan?.screens || []
      const updatedScreens = currentScreens.filter((s) => s.id !== screenId)
      const currentNodes = flowGraph?.nodes || []
      const updatedNodes = currentNodes.filter((n) => n.id !== screenId)
      const currentEdges = flowGraph?.edges || []
      const updatedEdges = currentEdges.filter((e) => e.from !== screenId && e.to !== screenId)
      const currentTransitions = plan?.transitions || []
      const updatedTransitions = currentTransitions.filter(
        (t) => t.fromScreenId !== screenId && t.toScreenId !== screenId
      )
      const currentSteps = plan?.steps || []
      const updatedSteps = currentSteps.filter((s) => s.screenId !== screenId)

      const updatedJob: AutomationJob = {
        ...job,
        flowGraph: {
          nodes: updatedNodes,
          edges: updatedEdges,
        },
        fullAppTestPlan: {
          ...(job.fullAppTestPlan || ({} as any)),
          screens: updatedScreens,
          transitions: updatedTransitions,
          steps: updatedSteps,
        },
      }

      if (selectedScreenId === screenId) {
        setSelectedScreenId(updatedScreens[0]?.id || null)
      }

      onJobUpdate?.(updatedJob)
    },
    [job, plan, flowGraph, selectedScreenId, onJobUpdate]
  )
  // Dummy test files state (user-provided or synthetic defaults)
  const [dummyFiles, setDummyFiles] = useState<
    Record<string, { name: string; url: string; type: string }>
  >({})
  const [isUploadingFile, setIsUploadingFile] = useState(false)

  // Login-wall credential prompt
  const [authUser, setAuthUser] = useState("")
  const [authPass, setAuthPass] = useState("")
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const sendAuth = async (action: "provide_credentials" | "skip_auth") => {
    setAuthError(null)
    setIsSubmittingAuth(true)

    try {
      if (job?.id && job.status === "running") {
        const res = await fetch("/api/ai-automation/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, action, username: authUser, password: authPass }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || "Failed to submit credentials")
        }
        if (data?.job) {
          onJobUpdate?.(data.job)
        }
      } else {
        // Job was stopped or not running: launch testing run with provided credentials
        if (action === "provide_credentials") {
          await onStartFullAppTest(dummyFiles, { username: authUser.trim(), password: authPass.trim() })
        } else {
          await onStartFullAppTest(dummyFiles)
        }
      }
      setAuthPass("")
    } catch (err: any) {
      setAuthError(err?.message || "Failed to submit credentials and continue")
    } finally {
      setIsSubmittingAuth(false)
    }
  }

  // Selected screen node
  const selectedScreen = useMemo(() => {
    if (!plan || !plan.screens.length) return null
    if (selectedScreenId) {
      return plan.screens.find((s) => s.id === selectedScreenId) || plan.screens[0]
    }
    return plan.screens[0]
  }, [plan, selectedScreenId])

  // Filtered steps
  const filteredSteps = useMemo(() => {
    if (!plan || !plan.steps) return []
    if (filterStepStatus === "all") return plan.steps
    return plan.steps.filter((s) => s.status === filterStepStatus)
  }, [plan, filterStepStatus])

  // Coverage statistics
  const coverage = useMemo(() => {
    if (!plan) {
      return {
        screensTested: 0,
        totalScreens: 0,
        actionsTested: 0,
        totalActions: 0,
        formsTested: 0,
        totalForms: 0,
        percentage: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        newDiscoveries: 0,
      }
    }
    const passed = plan.steps.filter((s) => s.status === "passed").length
    const failed = plan.steps.filter((s) => s.status === "failed").length
    const blocked = plan.steps.filter((s) => s.status === "blocked").length
    const newDiscoveries = plan.steps.filter((s) => s.isNewDiscovery).length

    return {
      ...plan.coverage,
      passed,
      failed,
      blocked,
      newDiscoveries,
    }
  }, [plan])

  const actionLedger = job?.actionLedger
  // Handle local dummy file upload
  const handleFileUpload = (type: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingFile(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setDummyFiles((prev) => ({
        ...prev,
        [type]: {
          name: file.name,
          url: dataUrl,
          type: file.type || type,
        },
      }))
      setIsUploadingFile(false)
    }
    reader.onerror = () => setIsUploadingFile(false)
    reader.readAsDataURL(file)
  }

  // Phase calculation
  const currentPhase = job?.testingPhase || (job?.status === "running" ? "discovery" : "ready")

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sleek Progress Line when Running in Full Page View */}
      {fullPageView && isRunning && (
        <div className="h-0.5 bg-slate-900 w-full overflow-hidden shrink-0">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${job?.progress || 0}%` }}
          />
        </div>
      )}

      {/* Top Mode Switcher Header removed to eliminate redundant Run Full App Test & mode banner */}

      {/* 1. Header Banner & Architecture Stepper (shown only when not in full page view) */}
      {!fullPageView && (
        <div className="px-4 py-3 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
                <Compass className="h-5 w-5 animate-spin-slow" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white tracking-tight">Full App Systematic Testing</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 border border-indigo-400/40 text-indigo-300">
                    MAP & PLAN FIRST
                  </span>
                  {coverage.newDiscoveries > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 border border-amber-400/50 text-amber-300 animate-pulse flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      {coverage.newDiscoveries} NEW DISCOVERY
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate max-w-md">
                  Target: <span className="font-mono text-slate-200">{targetUrl || "No target specified"}</span>
                </p>
              </div>
            </div>

            {/* Action Button */}
            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  type="button"
                  onClick={onCancelJob}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm shadow-rose-950"
                >
                  <Ban className="h-3.5 w-3.5" />
                  <span>Stop Testing</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartFullAppTest(dummyFiles)}
                  className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-950/60"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>{plan ? "Re-Run Full App Test" : "Start Full App Testing"}</span>
                </button>
              )}
            </div>
          </div>

          {/* 5-Stage Architecture Pipeline Stepper */}
          <div className="grid grid-cols-5 gap-1.5 text-[10px] font-medium pt-1 border-t border-slate-800/80">
            {[
              { key: "discovery", label: "1. Discover & Map", icon: MapIcon, desc: "Systematic BFS" },
              { key: "planning", label: "2. Build Inventory", icon: Layers, desc: "All elements" },
              { key: "files", label: "3. Test Plan & Files", icon: FileText, desc: "Synthetic plan" },
              { key: "executing", label: "4. Systematic Exec", icon: Play, desc: "Action → Verify" },
              { key: "reporting", label: "5. Final Report", icon: CheckCircle2, desc: "Coverage & Bugs" },
            ].map((step, idx) => {
              const isCurrent =
                currentPhase === step.key ||
                (step.key === "reporting" && job?.status === "completed")
              const isPassed =
                (step.key === "discovery" && ["planning", "files", "executing", "reporting"].includes(currentPhase)) ||
                (step.key === "planning" && ["files", "executing", "reporting"].includes(currentPhase)) ||
                (step.key === "files" && ["executing", "reporting"].includes(currentPhase)) ||
                (step.key === "executing" && ["reporting"].includes(currentPhase)) ||
                job?.status === "completed"

              const Icon = step.icon

              return (
                <div
                  key={step.key}
                  className={`px-2 py-1 rounded-md flex items-center gap-1.5 border transition ${
                    isCurrent
                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-sm"
                      : isPassed
                      ? "bg-emerald-950/30 border-emerald-800/50 text-emerald-300"
                      : "bg-slate-900/60 border-slate-800 text-slate-500"
                  }`}
                >
                  <Icon className={`h-3 w-3 shrink-0 ${isCurrent ? "animate-pulse text-indigo-400" : ""}`} />
                  <div className="min-w-0 truncate">
                    <div className="truncate font-semibold">{step.label}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Live Progress Bar */}
          {isRunning && (
            <div className="mt-2.5 pt-1.5 border-t border-slate-800/60">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-300 font-mono truncate">{job?.currentStep || "Running systematic testing..."}</span>
                <span className="text-indigo-400 font-bold">{job?.progress || 0}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${job?.progress || 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Login wall: ask for credentials */}
      {job?.authState === "awaiting_credentials" && (
        <div className="px-4 py-3 bg-amber-950/40 border-b border-amber-500/40 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              <span>Login required</span>
              {(!job || job.status !== "running") && (
                <span className="text-[10px] text-amber-400/90 font-normal">
                  (Clicking continue will start testing with these credentials)
                </span>
              )}
            </div>
          </div>
          <p className="text-[11px] text-slate-300 mb-2">
            {job.authPrompt || "Login required. Enter test credentials to continue testing the authenticated app, or skip."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (authUser.trim()) sendAuth("provide_credentials")
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="text"
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
              placeholder="Email / username"
              autoComplete="off"
              className="flex-1 min-w-[140px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <input
              type="password"
              value={authPass}
              onChange={(e) => setAuthPass(e.target.value)}
              placeholder="Password (if required)"
              autoComplete="new-password"
              className="flex-1 min-w-[140px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={isSubmittingAuth || !authUser.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition shadow-sm"
            >
              {isSubmittingAuth && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isSubmittingAuth ? "Submitting..." : authPass ? "Log in & continue" : "Use email & continue"}</span>
            </button>
            <button
              type="button"
              disabled={isSubmittingAuth}
              onClick={() => sendAuth("skip_auth")}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-semibold cursor-pointer transition"
            >
              Skip login
            </button>
          </form>
          {authError && (
            <p className="text-[11px] text-rose-400 mt-1.5 font-medium">{authError}</p>
          )}
        </div>
      )}

      {/* 2. Coverage Metrics Bar (shown only when not in full page view) */}
      {plan && !fullPageView && (
        <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs shrink-0">
          <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Screens Mapped</div>
              <div className="text-sm font-bold text-white font-mono">
                {coverage.screensTested} / {coverage.totalScreens}
              </div>
            </div>
            <div className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-[10px] font-bold text-indigo-400">
              {coverage.totalScreens > 0 ? Math.round((coverage.screensTested / coverage.totalScreens) * 100) : 0}%
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Actions Tested</div>
              <div className="text-sm font-bold text-white font-mono">
                {coverage.actionsTested} / {coverage.totalActions}
              </div>
            </div>
            <div className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-[10px] font-bold text-purple-400">
              {coverage.percentage}%
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Test Results</div>
              <div className="flex items-center gap-2 text-xs font-mono font-bold mt-0.5">
                <span className="text-emerald-400 flex items-center gap-0.5">
                  <Check className="h-3 w-3" /> {coverage.passed}
                </span>
                <span className="text-rose-400 flex items-center gap-0.5">
                  <XCircle className="h-3 w-3" /> {coverage.failed}
                </span>
                <span className="text-amber-400 flex items-center gap-0.5">
                  <Ban className="h-3 w-3" /> {coverage.blocked}
                </span>
              </div>
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-400 font-medium">Form Submissions</div>
              <div className="text-sm font-bold text-white font-mono">
                {coverage.formsTested} / {coverage.totalForms} Forms
              </div>
            </div>
            <div className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
              100% Synthetic
            </div>
          </div>
        </div>
      )}

      {/* 3. Sub-Tab Navigation */}
      {!hideSubNav && (
        <div className="px-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between text-xs shrink-0 overflow-x-auto custom-scrollbar">
          <div className="flex gap-1 py-1.5">
            {[
              { id: "chat", label: "Testing Bot Chat", icon: MessageSquare, isLive: job?.status === "running" },
              { id: "map", label: "App Map", icon: MapIcon, count: plan?.screens.length },
              { id: "screens", label: "Discovered Screens", icon: Layers, count: plan?.screens.length },
              { id: "plan", label: "Structured Test Plan", icon: ListChecks, count: plan?.steps.length },
              { id: "execution", label: "Live Execution & Evidence", icon: Play },
              { id: "files", label: "Test Files Provisioning", icon: FileUp, count: plan?.requiredFileTypes.length },
              {
                id: "coverage",
                label: "Coverage & Issues",
                icon: ShieldAlert,
                count: job?.issues && job.issues.length > 0 ? `${job.issues.length} bugs` : `${coverage.percentage}%`,
              },
            ].map((tab) => {
              const Icon = tab.icon
              const isActive = activeSubTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSubTabChange(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 font-semibold transition cursor-pointer whitespace-nowrap ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-950"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        isActive
                          ? "bg-indigo-800 text-white"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {!fullPageView && job?.id && (
            <div className="flex items-center gap-1.5 shrink-0 ml-auto my-1">
              <button
                type="button"
                onClick={handleExportZip}
                disabled={isExportingZip}
                className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/50 text-indigo-200 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                title="Download complete test bundle as ZIP (PDF report, HTML, evidence screenshots, and JSON)"
              >
                {isExportingZip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                <span>{isExportingZip ? "Packaging..." : "Save Test ZIP"}</span>
              </button>
              <button
                type="button"
                onClick={handleResetData}
                disabled={isResettingData}
                className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/50 text-slate-400 hover:text-rose-200 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                title="Reset discovered map screens and test plan data"
              >
                {isResettingData ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                <span>Reset Data</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. Tab Contents */}
      <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${fullPageView && activeSubTab === "map" ? "p-0 flex flex-col" : "p-4"}`}>
        {/* SUBTAB 1: FIGMA-STYLE APPLICATION MAP */}
        {activeSubTab === "map" && (
          <div className={`space-y-4 ${fullPageView ? "flex-1 flex flex-col min-h-0" : ""}`}>
            {!fullPageView && (
              <div className="flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <MapIcon className="h-4 w-4 text-indigo-400" />
                    Visual Application Workflow Map
                  </h3>
                  <p className="text-xs text-slate-400">
                    Node cards represent discovered screens; arrows indicate tested user transitions (e.g. S001 Login → S002 Register).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-400 font-mono">
                    {plan ? `${plan.screens.length} Screens · ${plan.transitions.length} Transitions` : "Mapping Pending"}
                  </div>
                  {(onOpenMapPage || onOpenBesideScreen) && (
                    <button
                      type="button"
                      onClick={onOpenMapPage || onOpenBesideScreen}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/50 shadow-indigo-950/50"
                      title="Open map like another page in full view"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span>Open Full Page Map</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {flowGraph && flowGraph.nodes.length > 0 ? (
              <div className={fullPageView ? "flex-1 min-h-[580px]" : ""}>
                <TestFlowGraph
                  graph={flowGraph}
                  screens={plan?.screens}
                  steps={plan?.steps}
                  transitions={plan?.transitions}
                  plan={plan || undefined}
                  onSelectScreen={(screenId) => {
                    setSelectedScreenId(screenId)
                  }}
                  onDeleteScreen={handleDeleteScreen}
                  onViewScreenshot={(url) => setScreenshotModal(url)}
                  onOpenMapPage={onOpenMapPage || onOpenBesideScreen}
                  isFullStage={isFullStage !== undefined ? isFullStage : fullPageView}
                  isBesideScreen={isBesideScreen}
                  onToggleFullStage={onToggleFullStage}
                />
              </div>
            ) : (
              <div className="p-12 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 flex flex-col items-center justify-center text-center">
                <MapIcon className="h-10 w-10 text-slate-600 mb-3" />
                <h4 className="text-sm font-bold text-slate-300">Application Not Yet Mapped</h4>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Click &quot;Start Full App Testing&quot; above to initiate Phase 1 Discovery. The AI crawler will systematically explore all screens and build this visual workflow map.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: DISCOVERED SCREENS & ACTION INVENTORY */}
        {activeSubTab === "screens" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-indigo-400" />
                  Screen & Actionable Elements Inventory
                </h3>
                <p className="text-xs text-slate-400">
                  Exhaustive catalog of every interactive control, form field, button, and dropdown discovered per screen.
                </p>
              </div>
            </div>

            {plan && plan.screens.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Left Screen Selector Column */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Screens ({plan.screens.length})
                  </div>
                  <div className="space-y-1.5 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
                    {plan.screens.map((s) => {
                      const isSelected = selectedScreen?.id === s.id
                      return (
                        <div
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedScreenId(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              setSelectedScreenId(s.id)
                            }
                          }}
                          className={`w-full p-2.5 rounded-lg border text-left transition cursor-pointer flex items-center justify-between ${
                            isSelected
                              ? "bg-indigo-600/20 border-indigo-500 text-white"
                              : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-indigo-400">{s.id}</span>
                              <span className="text-xs font-semibold truncate">{s.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-500 font-mono truncate">{s.path}</span>
                              {(s.componentLocation || s.sourceFile) && (
                                <span
                                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-950/60 border border-purple-800/40 text-purple-300 truncate shrink-0"
                                  title={`Component Location: ${s.componentLocation || s.sourceFile}`}
                                >
                                  📄 {(s.componentLocation || s.sourceFile)?.split("/").slice(-2).join("/")}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteScreen(s.id)
                              }}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/60 transition cursor-pointer"
                              title={`Delete screen ${s.id}`}
                              aria-label={`Delete screen ${s.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300 font-mono">
                              {s.actionableElements.length}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Right Screen Inventory Column */}
                <div className="md:col-span-2 space-y-3">
                  {selectedScreen ? (
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
                      {/* Screen Header */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded font-mono text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {selectedScreen.id}
                            </span>
                            <h4 className="text-sm font-bold text-white">{selectedScreen.name}</h4>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <p className="text-xs text-slate-400 font-mono">{selectedScreen.url}</p>
                            {(selectedScreen.componentLocation || selectedScreen.sourceFile) && (
                              <span
                                className="px-2 py-0.5 rounded font-mono text-[10px] bg-purple-950/60 text-purple-300 border border-purple-800/40"
                                title="Component source file location"
                              >
                                📄 {selectedScreen.componentLocation || selectedScreen.sourceFile}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedScreen.screenshotUrl && (
                            <button
                              type="button"
                              onClick={() => setScreenshotModal(selectedScreen.screenshotUrl!)}
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1 border border-slate-700 transition cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>View Screen</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteScreen(selectedScreen.id)}
                            className="px-2.5 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-xs font-semibold text-rose-300 flex items-center gap-1 border border-rose-800/60 transition cursor-pointer"
                            title="Delete this screen from test plan"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                            <span>Delete Screen</span>
                          </button>
                        </div>
                      </div>

                      {/* Actionable Elements List */}
                      <div>
                        <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                          <span>Actionable Elements ({selectedScreen.actionableElements.length})</span>
                          <span className="text-[10px] text-slate-500 font-normal">Exhaustive DOM discovery</span>
                        </h5>

                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                          {selectedScreen.actionableElements.map((elem, index) => (
                            <div
                              key={`${elem.id}-${index}`}
                              className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-xs"
                            >
                              <div className="min-w-0 pr-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider font-mono ${
                                      elem.type === "button"
                                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                        : elem.type === "input"
                                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                        : elem.type === "file_upload"
                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                        : elem.type === "select"
                                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                        : elem.type === "checkbox" || elem.type === "toggle"
                                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                        : "bg-slate-800 text-slate-400"
                                    }`}
                                  >
                                    {elem.type}
                                  </span>
                                  <span className="font-semibold text-white truncate">{elem.name}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                                  {elem.selector || "DOM Element"}
                                  {elem.accept && ` · accepts: ${elem.accept}`}
                                </div>
                              </div>

                              <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                                {elem.inputType ? `type="${elem.inputType}"` : elem.isInteractive ? "Interactive" : "Static"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
                      Select a screen on the left to inspect its actionable inventory.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                Discovery phase must run to populate screen action inventories.
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 3: STRUCTURED TEST PLAN */}
        {activeSubTab === "plan" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-indigo-400" />
                  Pre-Flight Test Plan
                </h3>
                <p className="text-xs text-slate-400">
                  Every step is planned before execution starts. Synthetic faker data is injected for safety.
                </p>
              </div>

              {/* Status Filters & Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {plan && (
                  <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                    {["all", "passed", "failed", "blocked", "pending"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setFilterStepStatus(st)}
                        className={`px-2.5 py-1 rounded capitalize font-medium transition cursor-pointer ${
                          filterStepStatus === st
                            ? "bg-indigo-600 text-white font-bold"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}

                {job?.id && (
                  <>
                    <button
                      type="button"
                      onClick={handleExportZip}
                      disabled={isExportingZip}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                      title="Save complete test as ZIP file (PDF report, HTML, evidence screenshots, and JSON)"
                    >
                      {isExportingZip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                      <span>{isExportingZip ? "Generating ZIP..." : "Save Test ZIP"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetData}
                      disabled={isResettingData}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/50 text-slate-300 hover:text-rose-200 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                      title="Reset discovered map screens and test plan data"
                    >
                      {isResettingData ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      <span>Reset Data</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Quick Test Credentials Bar */}
            <div className="rounded-xl border border-indigo-500/30 bg-slate-900/90 p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-amber-400 shrink-0" />
                <div>
                  <span className="text-xs font-bold text-white">Test Login Credentials</span>
                  <p className="text-[10px] text-slate-400">Write test email & password to use on login steps instead of synthetic faker data.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={planCredUser}
                  onChange={(e) => setPlanCredUser(e.target.value)}
                  placeholder="Test email / username"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 w-48"
                />
                <input
                  type="password"
                  value={planCredPass}
                  onChange={(e) => setPlanCredPass(e.target.value)}
                  placeholder="Test password"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 w-36"
                />
                <button
                  type="button"
                  onClick={handleApplyPlanCredentials}
                  disabled={isApplyingPlanCreds || (!planCredUser.trim() && !planCredPass.trim())}
                  className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-50 shadow-xs"
                >
                  {isApplyingPlanCreds ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  <span>Apply to Plan</span>
                </button>
              </div>
            </div>

            {job?.planApprovalState === "awaiting_review" && plan && (
              <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-white">Review and refine plan steps</h4>
                    <p className="text-xs text-slate-300 mt-1">The browser is paused after authenticated discovery. Request supported step changes below, review the updated steps, then approve execution.</p>
                  </div>
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-300">Waiting for approval</span>
                </div>
                {planChatMessages.length > 0 && (
                  <div className="max-h-36 overflow-y-auto space-y-2 rounded-lg bg-slate-950/70 p-2.5" aria-live="polite">
                    {planChatMessages.map((message, index) => (
                      <div key={index} className={message.role === "user" ? "text-right" : "text-left"}>
                        <span className={message.role === "user" ? "inline-block max-w-[90%] rounded-lg bg-indigo-600/30 px-3 py-2 text-xs text-indigo-100" : "inline-block max-w-[90%] rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200"}>{message.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                <form className="flex flex-col sm:flex-row gap-2" onSubmit={(event) => { event.preventDefault(); void submitPlanChat() }}>
                  <input
                    value={planChatInput}
                    onChange={(event) => setPlanChatInput(event.target.value)}
                    placeholder='Try: “add a test for signup validation” or “remove step 3”'
                    aria-label="Chat with the test plan"
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    disabled={planChatBusy}
                  />
                  <button type="submit" disabled={planChatBusy || !planChatInput.trim()} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
                    {planChatBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Apply change
                  </button>
                </form>
                <p className="text-[10px] text-slate-400">Supported edits: add a test, remove a numbered step, rename a step, or change a step’s expected result. Every edit is saved to the plan before approval.</p>
                <div className="flex justify-end border-t border-indigo-500/20 pt-3">
                  <button type="button" onClick={() => void approveTestPlan()} disabled={planApprovalBusy || planChatBusy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer">
                    {planApprovalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    Approve plan &amp; run tests
                  </button>
                </div>
              </div>
            )}

            {filteredSteps.length > 0 ? (
              <div className="space-y-2">
                {filteredSteps.map((step) => {
                  const isPassed = step.status === "passed"
                  const isFailed = step.status === "failed"
                  const isBlocked = step.status === "blocked"
                  const isRunning = step.status === "running"

                  return (
                    <div
                      key={step.id}
                      className={`p-3 rounded-xl border text-xs transition ${
                        isPassed
                          ? "bg-emerald-950/20 border-emerald-800/40"
                          : isFailed
                          ? "bg-rose-950/20 border-rose-800/40"
                          : isBlocked
                          ? "bg-amber-950/20 border-amber-800/40"
                          : isRunning
                          ? "bg-indigo-950/30 border-indigo-500 shadow-md"
                          : "bg-slate-900/60 border-slate-800"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-slate-500 font-bold">#{step.stepIndex}</span>
                          <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {step.screenId}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] uppercase ${
                              step.actionType === "fill"
                                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                : step.actionType === "click"
                                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                                : step.actionType === "upload"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {step.actionType}
                          </span>
                          <span className="font-bold text-white truncate">{step.targetName}</span>

                          {step.isNewDiscovery && (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/20 border border-amber-400/60 text-amber-300 animate-pulse">
                              NEW DISCOVERY
                            </span>
                          )}
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isPassed && (
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                              <Check className="h-3 w-3" /> PASS
                            </span>
                          )}
                          {isFailed && (
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                              <XCircle className="h-3 w-3" /> FAIL
                            </span>
                          )}
                          {isBlocked && (
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                              <Ban className="h-3 w-3" /> BLOCKED
                            </span>
                          )}
                          {isRunning && (
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-indigo-500/30 text-indigo-300 border border-indigo-400 animate-pulse flex items-center gap-1">
                              <Clock className="h-3 w-3" /> RUNNING
                            </span>
                          )}
                          {step.status === "pending" && (
                            <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                              PENDING
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Expected vs Actual */}
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-800/60">
                        <div>
                          <span className="text-slate-400 font-medium">Expected Result: </span>
                          <span className="text-slate-300">{step.expectedResult}</span>
                        </div>
                        {step.actualResult && (
                          <div>
                            <span className="text-slate-400 font-medium">Observed Result: </span>
                            <span className={isPassed ? "text-emerald-300 font-medium" : "text-rose-300 font-medium"}>
                              {step.actualResult}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Synthetic test value note & inline edit */}
                      {step.syntheticValue && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                          <span className="text-slate-500 font-mono">Input Value:</span>
                          {editingStepId === step.id ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type={/pass/i.test(step.targetName) ? "password" : "text"}
                                value={editingStepValue}
                                onChange={(e) => setEditingStepValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveStepValue(step.id)
                                  if (e.key === "Escape") setEditingStepId(null)
                                }}
                                className="px-2 py-0.5 rounded bg-slate-950 border border-indigo-500 text-white font-mono text-xs focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveStepValue(step.id)}
                                disabled={isSavingStepValue}
                                className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold cursor-pointer"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingStepId(null)}
                                className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <code className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono">
                                {step.syntheticValue}
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingStepId(step.id)
                                  setEditingStepValue(step.syntheticValue || "")
                                }}
                                className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-indigo-300 transition cursor-pointer"
                                title="Edit this input value"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              <span className="text-[9px] text-emerald-400/80">
                                {step.syntheticValue.includes("synthetic.test") || step.syntheticValue === "Password123!Safe"
                                  ? "(Synthetic Faker Data)"
                                  : "(Custom Value)"}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Screenshot Evidence Thumbnail */}
                      {step.screenshotUrl && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setScreenshotModal(step.screenshotUrl!)}
                            className="px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold flex items-center gap-1 border border-slate-700 transition cursor-pointer"
                          >
                            <Eye className="h-3 w-3" />
                            <span>View Step Evidence Screenshot</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                No test plan steps match current filter.
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 4: LIVE EXECUTION & EVIDENCE */}
        {activeSubTab === "execution" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Play className="h-4 w-4 text-indigo-400" />
                  Live Testing Protocol & Evidence Stream
                </h3>
                <p className="text-xs text-slate-400">
                  Strict cycle: <span className="font-semibold text-slate-200">Action → Observe → Verify → Record → Continue</span>
                </p>
              </div>
              <div className="text-xs font-mono text-slate-400">
                {plan ? `${coverage.actionsTested} / ${coverage.totalActions} Executed` : "Idle"}
              </div>
            </div>

            {/* Search Tested Screens Bar & Quick Screen Filter Pills */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 shadow-md space-y-2.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setEvidenceSearchQuery(evidenceSearchInput.trim())
                }}
                className="flex items-center gap-2"
              >
                <Search className="h-4 w-4 text-indigo-400 shrink-0" />
                <input
                  type="text"
                  value={evidenceSearchInput}
                  onChange={(e) => setEvidenceSearchInput(e.target.value)}
                  placeholder="Search tested screens (e.g. Settings, Dashboard, Tabs, S001)..."
                  className="w-full bg-transparent border-none text-xs text-white placeholder-slate-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!evidenceSearchInput.trim() && !evidenceSearchQuery}
                  className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-[11px] transition cursor-pointer shrink-0 shadow-xs"
                  title="Submit search (Enter)"
                >
                  Submit
                </button>
                {(evidenceSearchInput || evidenceSearchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setEvidenceSearchInput("")
                      setEvidenceSearchQuery("")
                    }}
                    className="p-1 rounded text-slate-400 hover:text-white transition cursor-pointer"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>

              {testedScreensList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Tested Screens:</span>
                  {testedScreensList.map((sName) => (
                    <button
                      key={sName}
                      type="button"
                      onClick={() => {
                        const next = evidenceSearchQuery.toLowerCase() === sName.toLowerCase() ? "" : sName
                        setEvidenceSearchInput(next)
                        setEvidenceSearchQuery(next)
                      }}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition cursor-pointer ${
                        evidenceSearchQuery.toLowerCase() === sName.toLowerCase()
                          ? "bg-indigo-600 text-white font-bold shadow-xs"
                          : "bg-slate-800/90 hover:bg-slate-700 text-slate-300"
                      }`}
                    >
                      {sName}
                    </button>
                  ))}
                  {evidenceSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setEvidenceSearchInput("")
                        setEvidenceSearchQuery("")
                      }}
                      className="text-[10px] text-indigo-400 hover:underline cursor-pointer ml-1"
                    >
                      Reset filter
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Reusable Action Queue: filtered by screen search query */}
            <ActionLedgerPanel
              actionLedger={actionLedger}
              onViewEvidence={setScreenshotModal}
              autoExpand={isRunning}
              searchQuery={evidenceSearchQuery}
            />

            {/* Current Active Step Banner */}
            {isRunning && job?.currentStep && (
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/60 to-slate-900 border border-indigo-500/50 shadow-lg">
                <div className="flex items-center gap-2 mb-1 text-xs font-bold text-indigo-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>CURRENT STEP IN FLIGHT</span>
                </div>
                <div className="text-sm font-semibold text-white font-mono">{job.currentStep}</div>
              </div>
            )}

            {/* Evidence Gallery */}
            {plan && (plan.steps.filter((s) => s.screenshotUrl).length > 0 || evidenceSearchQuery) ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Captured Step Evidence ({filteredEvidenceSteps.length}
                    {evidenceSearchQuery ? ` of ${plan.steps.filter((s) => s.screenshotUrl).length}` : ""})
                  </h4>
                  {evidenceSearchQuery && (
                    <span className="text-[11px] text-indigo-300 font-mono">
                      Filtered by &quot;{evidenceSearchQuery}&quot;
                    </span>
                  )}
                </div>

                {filteredEvidenceSteps.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredEvidenceSteps.map((step) => (
                      <div
                        key={step.id}
                        onClick={() => setScreenshotModal(step.screenshotUrl!)}
                        className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-indigo-500/60 transition cursor-pointer group"
                      >
                        <div className="aspect-video rounded-lg overflow-hidden bg-slate-950 border border-slate-800/80 relative">
                          <img
                            src={step.screenshotUrl}
                            alt={step.targetName}
                            className="w-full h-full object-cover object-top"
                          />
                          <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase font-mono bg-slate-950/80 text-white border border-slate-700">
                            {step.status}
                          </div>
                        </div>
                        <div className="mt-2 text-xs">
                          <div className="font-bold text-white truncate">{step.targetName}</div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">{step.screenName}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 rounded-xl bg-slate-900/40 border border-dashed border-slate-800 text-center space-y-1.5">
                    <Search className="h-5 w-5 text-slate-500 mx-auto" />
                    <div className="text-xs font-semibold text-slate-300">
                      No captured evidence matching &quot;{evidenceSearchQuery}&quot;
                    </div>
                    <button
                      type="button"
                      onClick={() => setEvidenceSearchQuery("")}
                      className="text-xs text-indigo-400 hover:underline cursor-pointer"
                    >
                      Clear search filter
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-slate-900/30 border border-dashed border-slate-800 text-center text-xs text-slate-500">
                Screenshots and test evidence will stream here as the systematic plan executes.
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 5: TEST FILES PROVISIONING */}
        {activeSubTab === "files" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileUp className="h-4 w-4 text-indigo-400" />
                Dummy Test Files Provisioning
              </h3>
              <p className="text-xs text-slate-400">
                Provide custom dummy test files for application upload controls, or let the systematic engine use built-in synthetic buffers (PNG, PDF, CSV, TXT).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { type: "image", label: "Image (.png, .jpg)", icon: ImageIcon, defaultName: "dummy_test_image.png" },
                { type: "pdf", label: "PDF Document (.pdf)", icon: FileText, defaultName: "dummy_test_doc.pdf" },
                { type: "csv", label: "CSV Dataset (.csv)", icon: FileSpreadsheet, defaultName: "dummy_test_data.csv" },
                { type: "document", label: "Text/Doc (.txt, .docx)", icon: FileText, defaultName: "dummy_sample.txt" },
                { type: "video", label: "Video (.mp4, .webm)", icon: Film, defaultName: "dummy_test_video.mp4" },
              ].map((f) => {
                const provided = dummyFiles[f.type]
                const Icon = f.icon

                return (
                  <div key={f.type} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-indigo-400" />
                        <span className="text-xs font-bold text-white">{f.label}</span>
                      </div>
                      {provided ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Custom File
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                          Synthetic Default
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono truncate">
                      File: {provided ? provided.name : f.defaultName}
                    </div>

                    <label className="w-full py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer">
                      <UploadCloud className="h-3.5 w-3.5" />
                      <span>{provided ? "Change File" : "Upload Custom Dummy"}</span>
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(f.type, e)}
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* SUBTAB 6: COVERAGE & ISSUES */}
        {activeSubTab === "coverage" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-indigo-400" />
                Coverage Analysis & Detected Issues
              </h3>
              <p className="text-xs text-slate-400">
                Comprehensive audit metrics covering discovered routes, actionable controls, form safety, and console JavaScript exceptions.
              </p>
            </div>

            {/* Coverage Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center">
                <div className="text-2xl font-bold font-mono text-indigo-400">{coverage.percentage}%</div>
                <div className="text-xs font-semibold text-white mt-1">Action Coverage</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {coverage.actionsTested} of {coverage.totalActions} planned steps
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center">
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {coverage.totalScreens > 0 ? Math.round((coverage.screensTested / coverage.totalScreens) * 100) : 0}%
                </div>
                <div className="text-xs font-semibold text-white mt-1">Screen Coverage</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {coverage.screensTested} of {coverage.totalScreens} discovered screens
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 text-center">
                <div className="text-2xl font-bold font-mono text-purple-400">
                  {coverage.newDiscoveries}
                </div>
                <div className="text-xs font-semibold text-white mt-1">New Discoveries</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Screens found during execution</div>
              </div>
            </div>

            {/* Issues List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Detected Issues & Exceptions ({job?.issues?.length || 0})
              </h4>
              {job?.issues && job.issues.length > 0 ? (
                job.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="p-3 rounded-xl bg-rose-950/20 border border-rose-800/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-rose-400 uppercase font-mono text-[10px]">
                        {issue.type} · {issue.severity}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">{issue.timestamp}</span>
                    </div>
                    <div className="text-slate-200 font-medium">{issue.description}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">{issue.screenUrl}</div>
                  </div>
                ))
              ) : (
                <div className="p-6 rounded-xl bg-slate-900/30 border border-slate-800 text-center text-xs text-slate-500">
                  No critical exceptions or broken flows detected so far.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Screenshot Preview Modal */}
      {screenshotModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setScreenshotModal(null)}
        >
          <div
            className="max-w-4xl max-h-[90vh] bg-slate-900 rounded-xl overflow-hidden border border-slate-800 p-2 relative shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={screenshotModal} alt="Preview" className="max-w-full max-h-[85vh] object-contain rounded" />
            <button
              type="button"
              onClick={() => setScreenshotModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-950/80 hover:bg-slate-900 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
