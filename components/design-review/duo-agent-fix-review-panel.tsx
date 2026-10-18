"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, GitBranch, Loader2, Play, RefreshCw, ShieldCheck, Sparkles } from "lucide-react"
import type { AutomationJob, FullAppTestPlan } from "@/lib/ai-automation/types"

type GitLabRepository = {
  id: string
  fullName: string
  defaultBranch: string
  url: string
}
type DuoMessage = { role: string; content: string; status?: string }
type DuoWorkflow = { id: string; status: string; title: string; summary: string; webUrl: string | null; projectId?: string; baseBranch?: string }
type DuoProposal = { id: string; issue: string; summary: string; files: Array<{ path: string; content: string }> }
type DuoReadiness = { ready: boolean; accountName?: string | null; checks: Array<{ id: string; label: string; ok: boolean; detail: string }>; error?: string; note?: string }

function extractProposals(messages: DuoMessage[]): DuoProposal[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "user") continue
    const content = message.content.trim()
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const objectMatch = content.match(/\{[\s\S]*"proposals"\s*:\s*\[[\s\S]*\]\s*\}/)
    for (const candidate of [fenced, objectMatch?.[0], content].filter((value): value is string => Boolean(value))) {
      try {
        const parsed = JSON.parse(candidate)
        if (!Array.isArray(parsed.proposals)) continue
        return parsed.proposals.flatMap((item: any, proposalIndex: number) => {
          if (!item || !Array.isArray(item.files)) return []
          const files = item.files.filter((file: any) => file && typeof file.path === "string" && typeof file.content === "string")
          if (!files.length) return []
          return [{
            id: typeof item.id === "string" ? item.id : `fix-${proposalIndex + 1}`,
            issue: typeof item.issue === "string" ? item.issue : `Proposed fix ${proposalIndex + 1}`,
            summary: typeof item.summary === "string" ? item.summary : "Review the proposed code changes below.",
            files,
          }]
        })
      } catch { /* Try the next possible JSON span. */ }
    }
  }
  return []
}

const activeStatuses = new Set(["created", "running", "paused", "input_required", "plan_approval_required", "tool_call_approval_required"])

export function DuoAgentFixReviewPanel({ job, plan }: { job: AutomationJob | null; plan: FullAppTestPlan | null }) {
  const [repositories, setRepositories] = useState<GitLabRepository[]>([])
  const [selectedProject, setSelectedProject] = useState("")
  const [loadingRepositories, setLoadingRepositories] = useState(false)
  const [connectionError, setConnectionError] = useState("")
  const [goal, setGoal] = useState("Review the completed UI test findings and prepare small, evidence-backed fixes as structured proposals for human review.")
  const [starting, setStarting] = useState(false)
  const [workflow, setWorkflow] = useState<DuoWorkflow | null>(null)
  const [messages, setMessages] = useState<DuoMessage[]>([])
  const [workflowError, setWorkflowError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [applyingProposalIds, setApplyingProposalIds] = useState<string[]>([])
  const [approvedProposalIds, setApprovedProposalIds] = useState<string[]>([])
  const [checkingReadiness, setCheckingReadiness] = useState(false)
  const [readiness, setReadiness] = useState<DuoReadiness | null>(null)

  const proposals = useMemo(() => extractProposals(messages), [messages])

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
      if (data.workflow) setWorkflow(current => current ? { ...current, ...data.workflow } : data.workflow)
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

  const checkReadiness = async () => {
    setCheckingReadiness(true)
    setReadiness(null)
    setConnectionError("")
    try {
      const response = await fetch("/api/integrations/gitlab/duo-flows/readiness", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok && !Array.isArray(data.checks)) throw new Error(data.error || "Could not check GitLab Duo readiness.")
      setReadiness(data)
      if (!data.ready) setConnectionError(data.error || "GitLab Duo is not ready yet. Review the checks below.")
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "Could not check GitLab Duo readiness.")
    } finally {
      setCheckingReadiness(false)
    }
  }

  const startReview = async () => {
    if (!selectedProject || !job || !plan) return
    setStarting(true)
    setWorkflowError("")
    setMessages([{ role: "assistant", content: "Starting GitLab Duo review. The agent is restricted from writing to GitLab or pushing commits." }])
    try {
      const selectedRepository = repositories.find(repository => repository.id === selectedProject)
      if (!selectedRepository?.defaultBranch) throw new Error("The selected GitLab repository has no default branch information.")
      const issueSummary = findings.length
        ? findings.map((item, index) => `${index + 1}. [${item.status}] ${item.screen}: ${item.action} "${item.target}". Expected: ${item.expected}. Actual: ${item.actual || item.error || "No detailed actual result recorded"}.`).join("\n")
        : "No failed or blocked actions were recorded. Review the app map and propose high-confidence UX or accessibility improvements supported by the available evidence."
      const response = await fetch("/api/integrations/gitlab/duo-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProject,
          baseBranch: selectedRepository.defaultBranch,
          appUrl: job.targetUrl,
          goal: `${goal}\n\nTest findings:\n${issueSummary}`,
          findings,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not start GitLab Duo.")
      setWorkflow({ ...data.workflow, projectId: selectedProject, baseBranch: selectedRepository.defaultBranch })
      setApprovedProposalIds([])
      setMessages([{ role: "assistant", content: `Duo session created. Status: ${data.workflow.status}. The agent can prepare candidate changes in its isolated workspace, but cannot write to GitLab or push.` }])
      if (data.workflow?.id) void refreshWorkflow(data.workflow.id)
    } catch (error) {
      setWorkflow(null)
      setWorkflowError(error instanceof Error ? error.message : "Could not start GitLab Duo.")
    } finally {
      setStarting(false)
    }
  }


  const approveProposals = async (selected: DuoProposal[]) => {
    if (!workflow?.projectId || !workflow.baseBranch || !workflow.id || selected.length === 0) return
    const ids = selected.map(proposal => proposal.id)
    setApplyingProposalIds(ids)
    setWorkflowError("")
    setMessages(current => [...current, {
      role: "assistant",
      content: `Approval received for ${selected.length} proposed fix${selected.length === 1 ? "" : "es"}. Preparing a commit on a dedicated feature branch; the default branch will not be changed.`,
    }])
    try {
      const response = await fetch("/api/integrations/gitlab/duo-flows/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: true,
          projectId: workflow.projectId,
          baseBranch: workflow.baseBranch,
          workflowId: workflow.id,
          proposals: selected,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "GitLab could not apply the approved changes.")
      setApprovedProposalIds(current => Array.from(new Set([...current, ...ids])))
      setMessages(current => [...current, {
        role: "assistant",
        content: `Approved changes committed to ${data.branch}. Files changed: ${data.filesChanged}. Commit: ${data.commit?.shortId || data.commit?.id || "created"}. The default branch was not modified. Review the branch and CI results before opening a merge request.`,
      }])
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : "Could not apply the approved fix.")
    } finally {
      setApplyingProposalIds([])
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
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void checkReadiness()} disabled={checkingReadiness || starting} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-950/40 disabled:opacity-50">
            {checkingReadiness ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} {checkingReadiness ? "Checking setup…" : "Check Duo setup"}
          </button>
          <button type="button" onClick={() => void loadRepositories()} disabled={loadingRepositories || starting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-900 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loadingRepositories ? "animate-spin" : ""}`} /> Refresh repos
          </button>
        </div>
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
      {readiness && <div className={`mt-3 rounded-xl border p-3 ${readiness.ready ? "border-emerald-700/40 bg-emerald-950/20" : "border-amber-700/40 bg-amber-950/20"}`} aria-live="polite">
        <div className="flex items-center gap-2 text-xs font-bold">{readiness.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}{readiness.ready ? "GitLab Duo setup looks ready" : "GitLab Duo setup needs attention"}{readiness.accountName ? <span className="font-normal text-slate-400">· @{readiness.accountName}</span> : null}</div>
        <ul className="mt-2 space-y-2">{readiness.checks.map(check => <li key={check.id} className="flex items-start gap-2 text-[11px]"><span className={check.ok ? "text-emerald-300" : "text-amber-300"}>{check.ok ? "✓" : "!"}</span><span><span className="font-semibold text-slate-200">{check.label}:</span> <span className="text-slate-400">{check.detail}</span></span></li>)}</ul>
        {readiness.note && <p className="mt-2 text-[10px] text-slate-500">{readiness.note}</p>}
      </div>}
      {workflowError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-700/40 bg-rose-950/30 p-3 text-xs text-rose-200"><AlertCircle className="h-4 w-4 shrink-0" />{workflowError}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void startReview()} disabled={starting || loadingRepositories || !selectedProject || !goal.trim()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-50">
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {starting ? "Starting Duo review…" : "Prepare fixes with Duo"}
        </button>
        {workflow?.webUrl && <a href={workflow.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900">Open GitLab session <ExternalLink className="h-3 w-3" /></a>}
        {workflow && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-indigo-300" /> {workflow.status}</span>}
      </div>

      {workflow && proposals.length > 0 && (
        <div className="mt-4 space-y-3 rounded-xl border border-emerald-700/40 bg-emerald-950/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-emerald-200">Proposed fixes ready for review</h4>
              <p className="mt-1 text-[10px] text-slate-400">Review the complete proposed file content. Each approval creates a commit on the dedicated fix branch; nothing is committed until you click approve.</p>
            </div>
            <button type="button" onClick={() => void approveProposals(proposals.filter(proposal => !approvedProposalIds.includes(proposal.id)))} disabled={applyingProposalIds.length > 0 || proposals.every(proposal => approvedProposalIds.includes(proposal.id))} className="rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
              {applyingProposalIds.length > 0 ? "Applying…" : "Approve all remaining"}
            </button>
          </div>
          {proposals.map(proposal => {
            const approved = approvedProposalIds.includes(proposal.id)
            const busy = applyingProposalIds.includes(proposal.id)
            return (
              <article key={proposal.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold text-slate-100">{proposal.issue}</h5>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{proposal.summary}</p>
                    <p className="mt-2 text-[10px] text-slate-500">{proposal.files.length} file(s): {proposal.files.map(file => file.path).join(", ")}</p>
                  </div>
                  <button type="button" onClick={() => void approveProposals([proposal])} disabled={approved || applyingProposalIds.length > 0} className={`shrink-0 rounded-lg px-3 py-2 text-[11px] font-bold disabled:opacity-50 ${approved ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-white hover:bg-slate-700"}`}>
                    {busy ? "Applying…" : approved ? "Approved & committed" : "Approve this fix"}
                  </button>
                </div>
                {proposal.files.map(file => (
                  <details key={file.path} className="mt-3 rounded-lg border border-slate-800">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-indigo-200">{file.path} · Review proposed content</summary>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-slate-800 bg-black/30 p-3 text-[10px] leading-relaxed text-slate-300">{file.content}</pre>
                  </details>
                ))}
              </article>
            )
          })}
        </div>
      )}

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
            Human review is required. No changes are applied to the connected repository and no push is performed by this workflow. Review the proposed changes below and explicitly approve each fix or the remaining batch before applying it.
          </p>
        </div>
      )}
    </section>
  )
}
