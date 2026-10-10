"use client"

import { useMemo, useState } from "react"
import { Activity, CheckCircle2, Clock3, History, ListTodo, Play, ShieldAlert } from "lucide-react"

export type ActionLedgerItem = {
  id: string
  title: string
  detail?: string
  status: "running" | "queued" | "passed" | "failed" | "skipped"
  category?: string
  timestamp?: string
}

type ActionLedgerProps = {
  live?: ActionLedgerItem[]
  queue?: ActionLedgerItem[]
  history?: ActionLedgerItem[]
  className?: string
}

const statusStyles: Record<ActionLedgerItem["status"], string> = {
  running: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  queued: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  passed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  failed: "bg-rose-500/10 text-rose-300 border-rose-500/20",
  skipped: "bg-slate-500/10 text-slate-300 border-slate-500/20",
}

function LedgerList({ items, emptyLabel }: { items: ActionLedgerItem[]; emptyLabel: string }) {
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-xs text-slate-500">
          {emptyLabel}
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mt-0.5 shrink-0 rounded-lg border border-slate-800 bg-slate-900 p-1.5">
              {item.status === "running" ? <Play className="h-3.5 w-3.5 text-indigo-400" /> :
               item.status === "queued" ? <Clock3 className="h-3.5 w-3.5 text-amber-400" /> :
               item.status === "passed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> :
               <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-xs font-semibold text-slate-100">{item.title}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusStyles[item.status]}`}>
                  {item.status}
                </span>
              </div>
              {item.detail && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{item.detail}</p>}
              {(item.category || item.timestamp) && (
                <div className="mt-1.5 flex gap-3 text-[9px] font-mono text-slate-600">
                  {item.category && <span>{item.category}</span>}
                  {item.timestamp && <span>{item.timestamp}</span>}
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

export function ActionLedger({ live = [], queue = [], history = [], className = "" }: ActionLedgerProps) {
  const [tab, setTab] = useState<"live" | "queue" | "history">("live")
  const counts = useMemo(() => ({ live: live.length, queue: queue.length, history: history.length }), [live, queue, history])

  const tabs = [
    { id: "live" as const, label: "Live", icon: Activity },
    { id: "queue" as const, label: "Queue", icon: ListTodo },
    { id: "history" as const, label: "History", icon: History },
  ]

  return (
    <section className={`rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-bold text-white">Action Ledger</h2>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">Live execution, pending coverage, and completed actions in one place.</p>
        </div>
        <div className="flex rounded-lg border border-slate-800 bg-slate-900/80 p-0.5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition ${tab === id ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-200"}`}>
              <Icon className="h-3 w-3" />
              {label}
              <span className="rounded-full bg-slate-950 px-1.5 py-0.5 text-[9px]">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="p-3">
        {tab === "live" && <LedgerList items={live} emptyLabel="No actions are running right now." />}
        {tab === "queue" && <LedgerList items={queue} emptyLabel="Queue is clear. All discovered flows are covered or waiting for new work." />}
        {tab === "history" && <LedgerList items={history} emptyLabel="Completed actions will appear here." />}
      </div>
    </section>
  )
}

export default ActionLedger
