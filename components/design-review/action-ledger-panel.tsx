"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Layers } from "lucide-react"
import type { ActionLedger, ActionLedgerEntry, ActionLedgerStatus } from "@/lib/ai-automation/types"

type Props = {
  actionLedger?: ActionLedger
}

export default function ActionLedgerPanel({ actionLedger }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<ActionLedgerStatus | "all">("all")

  const visibleEntries = useMemo(() => {
    if (!actionLedger) return []
    const entries = filter === "all"
      ? actionLedger.entries
      : actionLedger.entries.filter((entry) => entry.status === filter)
    return entries.slice().sort((a, b) => {
      const screenCompare = a.screenId.localeCompare(b.screenId)
      return screenCompare !== 0 ? screenCompare : a.name.localeCompare(b.name)
    })
  }, [actionLedger, filter])

  const groupedEntries = useMemo(() => {
    const groups = new Map<string, ActionLedgerEntry[]>()
    for (const entry of visibleEntries) {
      const key = `${entry.screenId} · ${entry.screenPath}`
      const list = groups.get(key) || []
      list.push(entry)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
  }, [visibleEntries])

  if (!actionLedger) return null

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
            <div className="text-xs font-bold text-white">Action Queue</div>
            <div className="text-[10px] text-slate-500 truncate">
              Actions discovered across the app · execution order is handled automatically
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] font-bold text-amber-300">
            {actionLedger.untested} remaining
          </span>
          <span className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-300">
            {actionLedger.tested} tested
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
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ["all", "All"],
              ["untested", "Untested"],
              ["running", "Running"],
              ["passed", "Passed"],
              ["failed", "Failed"],
              ["blocked", "Blocked"],
              ["skipped", "Skipped"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition ${
                  filter === value
                    ? "bg-indigo-600 text-white border-indigo-500"
                    : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {groupedEntries.length === 0 ? (
            <div className="p-4 rounded-lg bg-slate-950/60 border border-dashed border-slate-800 text-center text-[11px] text-slate-500">
              No actions match this filter.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
              {groupedEntries.map(([screen, entries]) => (
                <div key={screen} className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
                  <div className="px-2.5 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-300 truncate">{screen}</span>
                    <span className="text-[9px] text-slate-500 font-mono">{entries.length} actions</span>
                  </div>
                  <div className="divide-y divide-slate-800/70">
                    {entries.map((entry) => {
                      const statusStyle =
                        entry.status === "passed" ? "text-emerald-300" :
                        entry.status === "failed" ? "text-rose-300" :
                        entry.status === "blocked" ? "text-amber-300" :
                        entry.status === "running" ? "text-indigo-300" :
                        entry.status === "skipped" ? "text-slate-500" :
                        "text-slate-300"
                      return (
                        <div key={entry.actionKey} className="px-2.5 py-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className={`text-[11px] font-medium truncate ${statusStyle}`}>{entry.name}</div>
                            <div className="text-[9px] text-slate-600 font-mono truncate">
                              {entry.type}{entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? "" : "s"}` : ""}
                            </div>
                            {entry.error && (
                              <div className="text-[10px] text-rose-300/90 mt-1 break-words">{entry.error}</div>
                            )}
                            {entry.evidence?.observedOutcome && (
                              <div className="text-[10px] text-slate-500 mt-1 break-words">{entry.evidence.observedOutcome}</div>
                            )}
                          </div>
                          <span className={`text-[9px] font-bold uppercase shrink-0 ${statusStyle}`}>{entry.status}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
