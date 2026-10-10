"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Layers } from "lucide-react"
import type { ActionLedger, ActionLedgerEntry } from "@/lib/ai-automation/types"

type Props = {
  actionLedger?: ActionLedger
}

type LedgerView = "live" | "queue" | "history"

export default function ActionLedgerPanel({ actionLedger }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [activeView, setActiveView] = useState<LedgerView>("queue")

  const entries = useMemo(() => {
    if (!actionLedger) return []

    if (activeView === "live") {
      return actionLedger.entries.filter((entry) => entry.status === "running")
    }

    if (activeView === "queue") {
      const byKey = new Map(actionLedger.entries.map((entry) => [entry.actionKey, entry]))
      const ordered = actionLedger.untestedQueue
        .map((key) => byKey.get(key))
        .filter((entry): entry is ActionLedgerEntry => Boolean(entry))
      const queuedKeys = new Set(ordered.map((entry) => entry.actionKey))
      // Include any untested entry that has not yet been reflected in the queue.
      for (const entry of actionLedger.entries) {
        if (entry.status === "untested" && !queuedKeys.has(entry.actionKey)) ordered.push(entry)
      }
      return ordered
    }

    return actionLedger.entries
      .filter((entry) => ["passed", "failed", "blocked", "skipped"].includes(entry.status))
      .slice()
      .sort((a, b) => (b.lastTestedAt || "").localeCompare(a.lastTestedAt || ""))
  }, [actionLedger, activeView])

  const counts = useMemo(() => {
    const all = actionLedger?.entries || []
    return {
      live: all.filter((entry) => entry.status === "running").length,
      queue: actionLedger?.untested ?? 0,
      history: all.filter((entry) => ["passed", "failed", "blocked", "skipped"].includes(entry.status)).length,
    }
  }, [actionLedger])

  if (!actionLedger) return null

  const viewLabels: Array<{ id: LedgerView; label: string; count: number }> = [
    { id: "live", label: "Live", count: counts.live },
    { id: "queue", label: "Queue", count: counts.queue },
    { id: "history", label: "History", count: counts.history },
  ]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="w-full px-3.5 py-3 flex items-center justify-between gap-3 hover:bg-slate-900 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="h-4 w-4 text-indigo-400 shrink-0" />
          <div className="text-left min-w-0">
            <div className="text-xs font-bold text-white">Action Ledger</div>
            <div className="text-[10px] text-slate-500 truncate">
              Live execution, pending actions, and verified history in one place
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-300">
            {actionLedger.untested} queued
          </span>
          <span className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
            {actionLedger.tested} completed
          </span>
          {actionLedger.failed > 0 && (
            <span className="px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-[10px] font-bold text-rose-300">
              {actionLedger.failed} failed
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-slate-500 transition ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-3 space-y-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
            {viewLabels.map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id)}
                aria-pressed={activeView === id}
                className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-[10px] font-semibold transition ${
                  activeView === id
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-900"
                }`}
              >
                <span>{label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${activeView === id ? "bg-white/15" : "bg-slate-800"}`}>
                  {count}
                </span>
              </button>
            ))}
          </div>

          {entries.length === 0 ? (
            <div className="p-4 rounded-lg bg-slate-950/60 border border-dashed border-slate-800 text-center text-[11px] text-slate-500">
              {activeView === "live"
                ? "No action is running right now."
                : activeView === "queue"
                  ? "The queue is empty. Every discovered action has been attempted or resolved."
                  : "No completed action history yet."}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto custom-scrollbar">
              {entries.map((entry) => {
                const statusStyle =
                  entry.status === "passed" ? "text-emerald-300" :
                  entry.status === "failed" ? "text-rose-300" :
                  entry.status === "blocked" ? "text-amber-300" :
                  entry.status === "running" ? "text-indigo-300" :
                  entry.status === "skipped" ? "text-slate-500" :
                  "text-slate-300"
                return (
                  <div key={entry.actionKey} className="rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`text-[11px] font-medium break-words ${statusStyle}`}>{entry.name}</div>
                      <div className="text-[9px] text-slate-600 font-mono break-all mt-0.5">
                        {entry.screenId} · {entry.screenPath} · {entry.type}
                        {entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? "" : "s"}` : ""}
                      </div>
                      {entry.error && (
                        <div className="text-[10px] text-rose-300/90 mt-1 break-words">{entry.error}</div>
                      )}
                      {entry.evidence?.observedOutcome && (
                        <div className="text-[10px] text-slate-500 mt-1 break-words">{entry.evidence.observedOutcome}</div>
                      )}
                      {(entry.history?.length || 0) > 1 && (
                        <div className="text-[9px] text-slate-600 mt-1 break-words" aria-label="Recent action attempts">
                          Attempts: {entry.history!.slice(-4).map((attempt) => attempt.status).join(" → ")}
                        </div>
                      )}
                    </div>
                    <span className={`text-[9px] font-bold uppercase shrink-0 ${statusStyle}`}>{entry.status}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
