"use client"

import React, { useState, useMemo } from "react"
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
  activeSubTab?: "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  onSubTabChange?: (tab: "map" | "screens" | "plan" | "execution" | "files" | "coverage") => void
  fullPageView?: boolean
  hideSubNav?: boolean
  onOpenMapPage?: () => void
  isMapPageActive?: boolean
  onOpenBesideScreen?: () => void
  isBesideScreen?: boolean
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
    "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  >("map")
  const activeSubTab = controlledSubTab || internalSubTab

  const handleSubTabChange = (tab: "map" | "screens" | "plan" | "execution" | "files" | "coverage") => {
    setInternalSubTab(tab)
    if (onSubTabChange) onSubTabChange(tab)
  }

  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null)
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)
  const [filterStepStatus, setFilterStepStatus] = useState<string>("all")
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

      {/* Top Mode Switcher Header in Full Page View */}
      {fullPageView && onSelectTestingMode && (
        <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => onSelectTestingMode("feature_workflow")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  testingMode === "feature_workflow"
                    ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-950"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                <span>Feature / Workflow Testing</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTestingMode("full_app")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition cursor-pointer ${
                  testingMode === "full_app"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Compass className="h-3.5 w-3.5 text-indigo-400" />
                <span>Full App Testing</span>
              </button>
            </div>
            <span className="text-[11px] text-slate-400 hidden md:inline">
              Mode: <span className="text-white font-semibold">Full App Systematic Crawl & Inventory</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isRunning && onCancelJob ? (
              <button
                type="button"
                onClick={onCancelJob}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition cursor-pointer"
              >
                <Ban className="h-3.5 w-3.5" />
                <span>Stop Job</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStartFullAppTest(dummyFiles)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Run Full App Test</span>
              </button>
            )}
          </div>
        </div>
      )}

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
              if (authUser.trim() && authPass) sendAuth("provide_credentials")
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
              placeholder="Password"
              autoComplete="new-password"
              className="flex-1 min-w-[140px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={isSubmittingAuth || !authUser.trim() || !authPass}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition shadow-sm"
            >
              {isSubmittingAuth && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isSubmittingAuth ? "Logging in..." : "Log in & continue"}</span>
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
              { id: "map", label: "Figma-Style App Map", icon: MapIcon, count: plan?.screens.length },
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
                  onViewScreenshot={(url) => setScreenshotModal(url)}
                  onOpenMapPage={onOpenMapPage || onOpenBesideScreen}
                  isFullStage={fullPageView}
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
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedScreenId(s.id)}
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
                            <div className="text-[10px] text-slate-500 font-mono truncate">{s.path}</div>
                          </div>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-300 shrink-0 font-mono">
                            {s.actionableElements.length}
                          </span>
                        </button>
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
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedScreen.url}</p>
                        </div>
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
                      </div>

                      {/* Actionable Elements List */}
                      <div>
                        <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                          <span>Actionable Elements ({selectedScreen.actionableElements.length})</span>
                          <span className="text-[10px] text-slate-500 font-normal">Exhaustive DOM discovery</span>
                        </h5>

                        <div className="space-y-1.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
                          {selectedScreen.actionableElements.map((elem) => (
                            <div
                              key={elem.id}
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

              {/* Status Filters */}
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
            </div>

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

                      {/* Synthetic test value note */}
                      {step.syntheticValue && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                          <span className="text-slate-500 font-mono">Input Value:</span>
                          <code className="px-1.5 py-0.2 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-mono">
                            {step.syntheticValue}
                          </code>
                          <span className="text-[9px] text-emerald-400/80">(Synthetic Faker Data)</span>
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

            {/* Reusable Action Queue: stays inside the existing execution view */}
            <ActionLedgerPanel actionLedger={actionLedger} onViewEvidence={setScreenshotModal} autoExpand={isRunning} />

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
            {plan && plan.steps.filter((s) => s.screenshotUrl).length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Captured Step Evidence ({plan.steps.filter((s) => s.screenshotUrl).length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {plan.steps
                    .filter((s) => s.screenshotUrl)
                    .map((step) => (
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
