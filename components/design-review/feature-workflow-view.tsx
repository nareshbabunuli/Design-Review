"use client"

import React, { useState, useMemo, useEffect } from "react"
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
import { buildFigmaWorkflowMap } from "@/lib/ai-automation/full-app-utils"

interface FeatureWorkflowViewProps {
  job: AutomationJob | null
  isRunning: boolean
  targetUrl: string
  activeSubTab?: "map" | "screens" | "plan" | "execution" | "files" | "coverage"
  onSubTabChange?: (tab: "map" | "screens" | "plan" | "execution" | "files" | "coverage") => void
  projectId?: string
  onStartWorkflowTest: (workflowPrompt: string, role?: string, workflowName?: string) => Promise<void>
  onCancelJob?: () => void
  onOpenMapPage?: () => void
  isMapPageActive?: boolean
  testingMode?: "full_app" | "feature_workflow"
  onSelectTestingMode?: (mode: "full_app" | "feature_workflow") => void
  fullPageView?: boolean
}

const EXAMPLE_WORKFLOWS = [
  {
    title: "Registration Flow",
    prompt: "Test the registration flow.",
    icon: "👤",
    desc: "Sign up with valid synthetic details & verify onboarding/dashboard redirect.",
  },
  {
    title: "Create New Task",
    prompt: "I want to test creating a new task.",
    icon: "📝",
    desc: "Open task creation, fill title & description, save, and verify in list.",
  },
  {
    title: "Upload Profile Picture",
    prompt: "Test whether a user can upload a profile picture.",
    icon: "🖼️",
    desc: "Upload synthetic avatar photo and verify preview updates cleanly.",
  },
  {
    title: "Cart & Checkout Process",
    prompt: "Test the checkout process from adding a product to completing payment.",
    icon: "💳",
    desc: "Add product to cart, fill synthetic shipping details, complete checkout.",
  },
  {
    title: "Login & Reset Password",
    prompt: "Test login, forgot password, and resetting the password.",
    icon: "🔑",
    desc: "Check credentials, request reset link, and verify confirmation message.",
  },
  {
    title: "Caregiver Registration",
    prompt: "Test caregiver registration and completing the first activity.",
    icon: "🏥",
    desc: "Complete specialized role onboarding and submit initial activity log.",
  },
]

export default function FeatureWorkflowView({
  job,
  isRunning,
  targetUrl,
  projectId = targetUrl || "default",
  activeSubTab = "plan",
  onSubTabChange,
  onStartWorkflowTest,
  onCancelJob,
  onOpenMapPage,
  isMapPageActive = false,
  testingMode = "feature_workflow",
  onSelectTestingMode,
  fullPageView = true,
}: FeatureWorkflowViewProps) {
  const [workflowInput, setWorkflowInput] = useState("")
  const [selectedRole, setSelectedRole] = useState("Customer")
  const [savedFlows, setSavedFlows] = useState<Array<{ id: string; role: string; name: string; prompt: string }>>([])
  const [savedFlowsLoaded, setSavedFlowsLoaded] = useState(false)
  const savedFlowsKey = `open-design-ai:role-workflows:${projectId}`

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedFlowsKey)
      const parsed = raw ? JSON.parse(raw) : []
      setSavedFlows(Array.isArray(parsed) ? parsed.filter((flow) =>
        flow && typeof flow.id === "string" && typeof flow.role === "string" &&
        typeof flow.name === "string" && typeof flow.prompt === "string"
      ) : [])
    } catch {
      setSavedFlows([])
    } finally {
      setSavedFlowsLoaded(true)
    }
  }, [savedFlowsKey])

  useEffect(() => {
    if (!savedFlowsLoaded) return
    try {
      window.localStorage.setItem(savedFlowsKey, JSON.stringify(savedFlows))
    } catch (error) {
      console.warn("Could not persist saved test workflows in this browser.", error)
    }
  }, [savedFlows, savedFlowsKey, savedFlowsLoaded])
  const [flowName, setFlowName] = useState("Customer journey")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedSpec, setAnalyzedSpec] = useState<FeatureWorkflowSpec | null>(null)
  const [previewPlan, setPreviewPlan] = useState<FullAppTestPlan | null>(null)
  const [selectedScreenshotModal, setSelectedScreenshotModal] = useState<string | null>(null)

  // Determine active plan (from current live job or locally generated preview)
  const activePlan = useMemo(() => {
    if (job?.fullAppTestPlan && job.fullAppTestPlan.screens?.length > 0) {
      return job.fullAppTestPlan
    }
    return previewPlan
  }, [job?.fullAppTestPlan, previewPlan])

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

  // Analyze workflow naturally via API
  const handleAnalyzeWorkflow = async (promptToAnalyze: string) => {
    const text = promptToAnalyze.trim()
    if (!text) return
    setIsAnalyzing(true)
    try {
      const res = await fetch("/api/ai-automation/workflow-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowPrompt: text,
          targetUrl,
        }),
      })
      const data = await res.json()
      if (data.success && data.spec) {
        setAnalyzedSpec(data.spec)
        setPreviewPlan(data.plan)
        if (onSubTabChange) onSubTabChange("plan")
      }
    } catch (err) {
      console.error("Failed to analyze workflow:", err)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Confirm and start execution
  const handleRunTest = async (promptToRun?: string) => {
    const text = (promptToRun || workflowInput || currentSpec?.userGoal || "").trim()
    if (!text) return
    const role = selectedRole === "Custom role" ? "Custom role" : selectedRole
    const name = flowName.trim() || currentSpec?.workflowName || "Workflow test"
    await onStartWorkflowTest(`[User role: ${role}] [Workflow: ${name}] ${text}`, role, name)
  }

  const passedSteps = activePlan?.steps?.filter((s) => s.status === "passed").length || 0
  const totalSteps = activePlan?.steps?.length || 0
  const coveragePct = totalSteps > 0 ? Math.round((passedSteps / totalSteps) * 100) : 0

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 text-slate-100 overflow-hidden">
      {/* 1. TOP HEADER: MODE TOGGLE & STATUS BANNER */}
      <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {/* Mode Switcher Tabs */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => onSelectTestingMode && onSelectTestingMode("feature_workflow")}
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
              onClick={() => onSelectTestingMode && onSelectTestingMode("full_app")}
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

          {/* Workflow Badge if identified */}
          {currentSpec?.workflowName && (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-xs">
              <span className="text-[10px] text-indigo-400 font-semibold uppercase">Workflow:</span>
              <span className="font-bold text-white truncate max-w-[200px]">{currentSpec.workflowName}</span>
            </div>
          )}
        </div>

        {/* Action Button: Run / Stop */}
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
              disabled={isAnalyzing || (!workflowInput.trim() && !currentSpec)}
              onClick={() => handleRunTest()}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-950 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span>{job?.status === "completed" ? "Re-Run Workflow Test" : "Run Workflow Test"}</span>
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

      {/* 3. WORKSPACE SUB-TABS: PLAN, MAP, SCREENS, EXECUTION, EDGE CASES, REPORT */}
      <div className="px-4 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs shrink-0 overflow-x-auto custom-scrollbar">
        <div className="flex gap-1 py-1.5">
          {[
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

      {/* 4. WORKFLOW INPUT & DISCOVERY BAR (Shown when no test running or to re-prompt) */}
      {(!isRunning || !job) && (
        <div className="p-4 bg-slate-900/30 border-b border-slate-800 shrink-0 space-y-3">
          {/* Main Question Heading */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                What workflow or feature would you like to test?
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Describe it naturally. No technical routes, selectors, or button names required. The AI will identify the path, generate pre-flight steps, and verify edge cases.
              </p>
            </div>
            {currentSpec && (
              <button
                type="button"
                onClick={() => {
                  setAnalyzedSpec(null)
                  setPreviewPlan(null)
                  setWorkflowInput("")
                }}
                className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1 transition cursor-pointer self-start"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Test Another Feature</span>
              </button>
            )}
          </div>

          {/* Project-scoped workflow prototype: each role/flow is independently selectable. */}
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[150px] text-[11px] text-slate-400">User role
                <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white">
                  <option>Admin</option><option>Customer</option><option>Student</option><option>Teacher</option><option>Custom role</option>
                </select>
              </label>
              <label className="flex-[2] min-w-[180px] text-[11px] text-slate-400">Workflow name
                <input value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="e.g. Customer checkout" className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
              </label>
              <button type="button" disabled={!workflowInput.trim() || !flowName.trim()} onClick={() => { const prompt = workflowInput.trim(); const name = flowName.trim(); setSavedFlows((flows) => [...flows.filter((f) => f.name !== name || f.role !== selectedRole), { id: crypto.randomUUID(), role: selectedRole, name, prompt }]); }} className="rounded-lg border border-indigo-500/50 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-950 disabled:opacity-40">Save flow</button>
            </div>
            <p className="text-[10px] text-slate-500">A project can contain multiple separate role-based flows. Each run gets its own role/name in the test instruction; use test credentials for that role when starting the run.</p>
            {savedFlows.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{savedFlows.map((flow) => <div key={flow.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-2"><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{flow.name}</div><div className="text-[10px] text-slate-400">{flow.role} · saved for this project in this browser</div><div className="truncate text-[10px] text-slate-500">{flow.prompt}</div></div><button type="button" disabled={isRunning} onClick={() => { setSelectedRole(flow.role); setFlowName(flow.name); setWorkflowInput(flow.prompt); setAnalyzedSpec(null); setPreviewPlan(null); }} className="rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-200 disabled:opacity-40">Load</button><button type="button" onClick={() => setSavedFlows((flows) => flows.filter((f) => f.id !== flow.id))} aria-label={`Remove ${flow.name}`} className="px-1 text-slate-500 hover:text-rose-300">×</button></div>)}</div>}
          </div>

          {/* Workflow Input Form */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={workflowInput}
                onChange={(e) => setWorkflowInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && workflowInput.trim()) {
                    e.preventDefault()
                    handleAnalyzeWorkflow(workflowInput)
                  }
                }}
                placeholder="e.g. Test the registration flow, or I want to test creating a new task..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-inner"
              />
              {isAnalyzing && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-purple-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Understanding...</span>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={!workflowInput.trim() || isAnalyzing}
              onClick={() => handleAnalyzeWorkflow(workflowInput)}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-purple-950 shrink-0"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Understand & Plan</span>
            </button>
          </div>

          {/* 6 Quick Natural Workflow Examples */}
          {!currentSpec && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Click a popular workflow example to test:
              </span>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                {EXAMPLE_WORKFLOWS.map((ex, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setWorkflowInput(ex.prompt)
                      handleAnalyzeWorkflow(ex.prompt)
                    }}
                    className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-indigo-500/60 hover:bg-indigo-950/20 text-left transition cursor-pointer group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200 group-hover:text-white">
                        <span>{ex.icon}</span>
                        <span className="truncate">{ex.title}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 leading-tight line-clamp-2">
                        {ex.desc}
                      </p>
                    </div>
                    <span className="text-[9px] text-indigo-400 font-semibold mt-2 group-hover:underline">
                      Test Workflow →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Understood Workflow Spec Card (When analyzed) */}
          {currentSpec && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-indigo-500/40 shadow-lg space-y-2.5 animate-in fade-in-50 duration-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Workflow: {currentSpec.workflowName}</span>
                      <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                        Targeted Path Identified
                      </span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Goal: <strong className="text-slate-200">{currentSpec.userGoal}</strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRunTest()}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-emerald-950"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Execute Workflow Test</span>
                </button>
              </div>

              {/* Likely Screens Path Progression */}
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] flex flex-wrap items-center gap-2">
                <span className="text-slate-400 font-semibold">Target Path:</span>
                {currentSpec.likelyScreens.map((sc, i) => (
                  <React.Fragment key={i}>
                    <span className="px-2 py-0.5 rounded bg-indigo-950/70 border border-indigo-800 text-indigo-200 font-medium">
                      {sc}
                    </span>
                    {i < currentSpec.likelyScreens.length - 1 && (
                      <ArrowRight className="h-3 w-3 text-slate-600 shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>

              {/* Clarification if Ambiguous */}
              {currentSpec.isAmbiguous && currentSpec.clarificationQuestion && (
                <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-amber-400 shrink-0" />
                  <div>
                    <span className="font-bold">Clarification Needed: </span>
                    <span>{currentSpec.clarificationQuestion}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. MAIN SUBTAB VIEWS */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
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

            {/* Steps List */}
            {activePlan?.steps && activePlan.steps.length > 0 ? (
              <div className="space-y-2">
                {activePlan.steps.map((step) => {
                  const isPassed = step.status === "passed"
                  const isFailed = step.status === "failed"
                  const isRunningStep = step.status === "running"

                  return (
                    <div
                      key={step.id}
                      className={`p-3 rounded-xl border text-xs transition ${
                        isPassed
                          ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-200"
                          : isFailed
                          ? "bg-rose-950/20 border-rose-800/40 text-rose-200"
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
                <h4 className="text-sm font-bold text-slate-300">No Workflow Plan Generated Yet</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Type what workflow or feature you would like to test above or select an example chip to generate the pre-flight test plan.
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
                  isFullStage={true}
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
              <span className="font-mono text-xs text-slate-400">
                {activePlan?.screens?.length || 0} Screens
              </span>
            </div>

            {activePlan?.screens && activePlan.screens.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {activePlan.screens.map((sc) => (
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
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="h-4 w-4 text-indigo-400" />
                Live Execution Trace (Action → Observe → Verify → Record)
              </h3>
              <p className="text-xs text-slate-400">
                Real-time execution log of actions, observations, DOM changes, and screenshot captures.
              </p>
            </div>

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
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Final Workflow Test Report & Edge Cases
              </h3>
              <p className="text-xs text-slate-400">
                Detailed verification results for the workflow, tested edge cases, bugs found, and overall workflow coverage.
              </p>
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
