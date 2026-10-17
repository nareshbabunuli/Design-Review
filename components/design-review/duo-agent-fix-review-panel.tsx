"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, GitBranch, Loader2, Play, RefreshCw, Sparkles } from "lucide-react"
import type { AutomationJob, FullAppTestPlan } from "@/lib/ai-automation/types"

type GitLabRepository = {
  id: string
  fullName: string
  defaultBranch: string
  url: string
}
type DuoMessage = { role: string; content: string; status?: string }
type DuoWorkflow = { id: string; status: string; title: string; summary: string; webUrl: string | null }

const activeStatuses = new Set(["created", "running", "paused", "input_required", "plan_approval_required", "tool_call_approval_required"])

export function DuoAgentFixReviewPanel({ job, plan }: { job: AutomationJob | null; plan: FullAppTestPlan | null }) {
  const [repositories, setRepositories] = useState<GitLabRepository[]>([])
  const [selectedProject, setSelectedProject] = useState("")
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  const [connectionError, setConnectionError] = useState("")
  const [goal, setGoal] = useState("Review the completed UI test findings and prepare evidence-backed fixes as unified diffs for human review.")
  const [starting, setStarting] = useState(false)
  const [workflow, setWorkflow] = useState<DuoWorkflow | null>(null)
  const [messages, setMessages] = useState<DuoMessage[]>([])
  const [workflowError, setWorkflowError] = useState("")
  const [refreshing, setRefreshing] = useState(false)

  const findings = useMemo(() => (plan?.steps || [])
    .filter(step => ["failed", "blocked", "suspected_non_functional"].includes(step.status))
    .slice(0, 30)
    .map(step => ({
      id: step.id,
      screen: step.screenName,
      action: step.actionType,
      target: step.targetName,
      url: step.url || job?.targetUrl || "",
      expected: step.expectedResult,
      actual: step.actualResult || "",
      error: step.error || "",
      screenshotUrl: step.screenshotUrl || "",
      status: step.status,
    })), [plan?.steps, job?.targetUrl])

  const loadRepositories = useCallback(async () => {
    setLoadingRepositories(true)
    setConnectionError("")
    try {
      const response = await fetch("/api/integrations/repositories?provider=gitlab", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not load GitLab repositories.")
      const list = Array.isArray(data.repositories) ? data.repositories : []
      setRepositories(list)
      setSelectedProject(current => current || list[0]?.id || "")
      if (list.length === 0) setConnectionError("No GitLab repositories were returned. Connect GitLab in Settings or check the account's repository access.")
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not load GitLab repositories.")
    } finally {
      setLoadingRepositories(false)
    }
  }, [])

  useEffect(() => {
    if (plan?.screens?.length && job?.status === "completed") void loadRepositories()
  }, [plan?.screens?.length, job?.status, loadRepositories])

  const refreshWorkflow = useCallback(async (workflowId: string) => {
    setRefreshing(true)
    try {
      const response = await fetch(`/api/integrations/gitlab/duo-flows?workflowId=${encodeURIComponent(workflowId)}`, { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not refresh the Duo session.")
      if (data.workflow) setWorkflow(data.workflow)
      if (Array.isArray(data.messages)) setMessages(data.messages)
      setWorkflowError("")
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not refresh the Duo session.")
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!workflow?.id || !activeStatuses.has(workflow.status)) return
    const timer = window.setInterval(() => void refreshWorkflow(workflow.id), 5000)
    return () => window.clearInterval(timer)
  }, [workflow?.id, workflow?.status, refreshWorkflow])

  const startReview = async () => {
    if (!selectedProject || !job || !plan) return
    setStarting(true)
    setWorkflowError("")
    setMessages([{ role: "assistant", content: "Starting GitLab Duo review. The agent is restricted from writing to GitLab or pushing commits." }])
    try {
      const issueSummary = findings.length
        ? findings.map((item, index) => `${index + 1}. [${item.status}] ${item.screen}: ${item.action} "${item.target}". Expected: ${item.expected}. Actual: ${item.actual || item.error || "No detailed actual result recorded"}.`).join("\n")
        : "No failed or blocked actions were recorded. Review the app map and propose high-confidence UX or accessibility improvements supported by the available evidence."
      const response = await fetch("/api/integrations/gitlab/duo-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject,
          appUrl: job.targetUrl,
          goal: `${goal}\n\nTest findings:\n${issueSummary}`,
          findings,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not start GitLab Duo.")
      setWorkflow(data.workflow)
      setMessages([{ role: "assistant", content: `Duo session created. Status: ${data.workflow.status}. The agent can prepare candidate changes in its isolated workspace, but cannot write to GitLab or push.` }])
      if (data.workflow?.id) void refreshWorkflow(data.workflow.id)
    } catch (error) {
      setWorkflow(null)
      setWorkflowError(error instanceof Error ? error.message : "Could not start GitLab Duo.")
    } finally {
      setStarting(false)
    }
  }

  if (!job || job.status !== "completed" || !plan?.screens?.length) return null

  return (
    <section className="mx-4 mb-5 rounded-2xl border border-indigo-500/30 bg-slate-950/90 p-4 text-slate-100 shadow-lg" aria-label="GitLab Duo fix review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Sparkles className="h-5 w-5" /></div>
          <div>
            <h3 className="text-sm font-bold">GitLab Duo · Prepare fixes for review</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
              Mapping and testing are complete. Send the findings to Duo for a proposed fix review. The agent has no GitLab-write or git-push privilege; this action does not change your repository.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void loadRepositories()} disabled={loadingRepositories || starting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-900 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${loadingRepositories ? "animate-spin" : ""}`} /> Refresh repos
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="space-y-1.5 text-xs font-semibold text-slate-300">
          GitLab repository
          <select value={selectedProject} onChange={event => setSelectedProject(event.target.value)} disabled={loadingRepositories || repositories.length === 0} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs text-white outline-none focus:border-indigo-400">
            {repositories.length === 0 && <option value="">Connect GitLab in Settings</option>}
            {repositories.map(repo => <option key={repo.id} value={repo.id}>{repo.fullName} · {repo.defaultBranch}</option>)}
          </select>
          <span className="flex items-center gap-1 text-[10px] font-normal text-slate-500"><GitBranch className="h-3 w-3" /> {findings.length} failed or blocked test findings</span>
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-slate-300">
          Agent instructions
          <textarea value={goal} onChange={event => setGoal(event.target.value)} rows={3} maxLength={8000} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-xs font-normal text-white outline-none focus:border-indigo-400" />
        </label>
      </div>

      {connectionError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-200"><AlertCircle className="h-4 w-4 shrink-0" />{connectionError}</div>}
      {workflowError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-700/40 bg-rose-950/30 p-3 text-xs text-rose-200"><AlertCircle className="h-4 w-4 shrink-0" />{workflowError}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void startReview()} disabled={starting || loadingRepositories || !selectedProject || !goal.trim()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-50">
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {starting ? "Starting Duo review…" : "Prepare fixes with Duo"}
        </button>
        {workflow?.webUrl && <a href={workflow.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900">Open GitLab session <ExternalLink className="h-3 w-3" /></a>}
        {workflow && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-indigo-300" /> {workflow.status}</span>}
      </div>

      {workflow && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/70 px-3 py-2">
            <div><p className="text-xs font-semibold">{workflow.title}</p><p className="mt-0.5 text-[10px] text-slate-500">{workflow.summary || `Session #${workflow.id}`}</p></div>
            <button type="button" onClick={() => void refreshWorkflow(workflow.id)} disabled={refreshing} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50" aria-label="Refresh Duo progress"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /></button>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto bg-black/20 p-3">
            {messages.length === 0 ? <p className="text-xs text-slate-500">Waiting for the agent to report progress…</p> : messages.slice(-20).map((message, index) => (
              <div key={`${workflow.id}-${index}`} className={`rounded-xl p-3 text-xs leading-relaxed ${message.role === "user" ? "ml-8 bg-slate-900 text-slate-300" : "mr-3 border border-indigo-500/15 bg-indigo-950/20 text-slate-200"}`}>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{message.role === "user" ? "Request" : "Duo agent"}</p>
                <pre className="whitespace-pre-wrap break-words font-sans">{message.content}</pre>
              </div>
            ))}
          </div>
          <p className="border-t border-slate-800 bg-slate-900/50 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
            Human review is required. No changes are applied to the connected repository and no push is performed by this workflow. Proposed diffs must be reviewed and applied through the explicit approval step.
          </p>
        </div>
      )}
    </section>
  )
}
