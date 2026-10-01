"use client"

import React, { useState, useEffect, useCallback } from "react"
import { X, Play, Loader2, CheckCircle2, AlertCircle, Camera } from "lucide-react"
import type { JourneyRole } from "@/lib/journey/types"

const ROLES: { value: JourneyRole; label: string }[] = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "client", label: "Client" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
  { value: "custom", label: "Custom" },
]

interface JourneyCaptureModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  defaultUrl?: string
  defaultWidth?: number
  defaultHeight?: number
  onComplete?: (workflowId: string) => void
}

export function JourneyCaptureModal({
  open,
  onClose,
  projectId,
  defaultUrl = "http://localhost:8081",
  defaultWidth = 1280,
  defaultHeight = 800,
  onComplete,
}: JourneyCaptureModalProps) {
  const [role, setRole] = useState<JourneyRole>("user")
  const [customRole, setCustomRole] = useState("")
  const [startUrl, setStartUrl] = useState(defaultUrl)
  const [urlList, setUrlList] = useState("")
  const [maxSteps, setMaxSteps] = useState(10)
  const [mode, setMode] = useState<"explore" | "list">("explore")
  const [running, setRunning] = useState(false)
  const [journeyId, setJourneyId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [stepCount, setStepCount] = useState(0)
  const [thumbnails, setThumbnails] = useState<{ url: string; title: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [workflowId, setWorkflowId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setStartUrl(defaultUrl)
      setError(null)
      setWorkflowId(null)
      setJourneyId(null)
      setStatus("")
      setStepCount(0)
      setThumbnails([])
      setRunning(false)
    }
  }, [open, defaultUrl])

  useEffect(() => {
    if (!journeyId || !running) return
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/journey/status?id=${journeyId}`)
        if (!res.ok) return
        const data = await res.json()
        setStatus(data.status)
        setStepCount(data.stepCount || 0)
        setThumbnails(
          (data.steps || []).map((s: any) => ({
            url: s.screenshotUrl,
            title: s.title || s.pageType,
          }))
        )
        if (data.status === "completed") {
          setRunning(false)
          setWorkflowId(data.workflowId)
          if (data.workflowId && onComplete) onComplete(data.workflowId)
        } else if (data.status === "failed") {
          setRunning(false)
          setError(data.error || "Journey failed")
        }
      } catch {}
    }, 1500)
    return () => clearInterval(timer)
  }, [journeyId, running, onComplete])

  const handleStart = useCallback(async () => {
    setError(null)
    setRunning(true)
    setWorkflowId(null)
    setThumbnails([])
    setStepCount(0)

    const urls =
      mode === "list"
        ? urlList
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean)
        : undefined

    try {
      const res = await fetch("/api/journey/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          role,
          customRoleLabel: role === "custom" ? customRole : undefined,
          startUrl,
          urls,
          maxSteps,
          width: defaultWidth,
          height: defaultHeight,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to start")
      setJourneyId(data.journeyId)
      setStatus("running")
    } catch (err: any) {
      setRunning(false)
      setError(err?.message || "Failed to start journey")
    }
  }, [projectId, role, customRole, startUrl, urlList, mode, maxSteps, defaultWidth, defaultHeight])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#272b38] dark:bg-[#12151e]">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-[#272b38]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-[#e2e4ea]">
            <Camera className="h-4 w-4 text-indigo-500" />
            Capture Journey
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-[#1c2030] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Workflow role
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={running}
                  onClick={() => setRole(r.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    role === r.value
                      ? "bg-indigo-600 text-white"
                      : "border border-slate-200 text-slate-600 hover:border-indigo-300 dark:border-[#272b38] dark:text-[#8e95a5]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {role === "custom" && (
              <input
                type="text"
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                placeholder="Custom role name"
                disabled={running}
                className="mt-2 w-full rounded-md border border-slate-200 bg-transparent px-2.5 py-1.5 text-sm dark:border-[#272b38]"
              />
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Mode
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => setMode("explore")}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                  mode === "explore"
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300"
                    : "border border-slate-200 text-slate-600 dark:border-[#272b38]"
                }`}
              >
                Explore links
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => setMode("list")}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                  mode === "list"
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300"
                    : "border border-slate-200 text-slate-600 dark:border-[#272b38]"
                }`}
              >
                URL list
              </button>
            </div>
          </div>

          {mode === "explore" ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Start URL
              </label>
              <input
                type="url"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                disabled={running}
                className="w-full rounded-md border border-slate-200 bg-transparent px-2.5 py-1.5 text-sm dark:border-[#272b38]"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
                URLs (one per line)
              </label>
              <textarea
                value={urlList}
                onChange={(e) => setUrlList(e.target.value)}
                disabled={running}
                rows={4}
                placeholder={"http://localhost:8081/login\nhttp://localhost:8081/dashboard\nhttp://localhost:8081/settings"}
                className="w-full rounded-md border border-slate-200 bg-transparent px-2.5 py-1.5 font-mono text-xs dark:border-[#272b38]"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Max steps: {maxSteps}
            </label>
            <input
              type="range"
              min={2}
              max={20}
              value={maxSteps}
              disabled={running}
              onChange={(e) => setMaxSteps(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {(running || workflowId || error) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-[#272b38] dark:bg-[#0d0f16]">
              {running && (
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-[#8e95a5]">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                  Capturing… step {stepCount} · {status}
                </div>
              )}
              {workflowId && (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Workflow created. You can close this and open it in the list.
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}
              {thumbnails.length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                  {thumbnails.map((t, i) => (
                    <div key={i} className="shrink-0">
                      <img
                        src={t.url}
                        alt={t.title}
                        className="h-14 w-20 rounded border border-slate-200 object-cover dark:border-[#272b38]"
                      />
                      <div className="mt-0.5 max-w-[80px] truncate text-[9px] text-slate-400">
                        {i + 1}. {t.title}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-[#272b38]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-[#8e95a5] dark:hover:bg-[#1c2030]"
          >
            {workflowId ? "Close" : "Cancel"}
          </button>
          {!workflowId && (
            <button
              type="button"
              disabled={running || !projectId}
              onClick={handleStart}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {running ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Start capture
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
