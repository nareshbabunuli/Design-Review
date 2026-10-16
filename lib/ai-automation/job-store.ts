/**
 * Shared in-memory + on-disk job registry for the AI automation engine.
 * Extracted so both the legacy crawl/chat runner and the autonomous
 * Stagehand runner share one store without a circular import.
 */

import fs from "fs"
import path from "path"
import type { AutomationJob, AutomationLog, SessionEventType } from "./types"

// In-memory job registry across Node process
declare global {
  // eslint-disable-next-line no-var
  var __AI_AUTOMATION_JOBS__: Map<string, AutomationJob> | undefined
}

if (!globalThis.__AI_AUTOMATION_JOBS__) {
  globalThis.__AI_AUTOMATION_JOBS__ = new Map<string, AutomationJob>()
}

const jobStore = globalThis.__AI_AUTOMATION_JOBS__

const JOBS_DIR = path.join(process.cwd(), ".jobs")

const pendingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const FLUSH_DEBOUNCE_MS = 250
const MAX_JOB_LOGS = 1000
let jobsDirEnsured = false

function ensureJobsDir() {
  if (jobsDirEnsured) return
  if (!fs.existsSync(JOBS_DIR)) {
    try {
      fs.mkdirSync(JOBS_DIR, { recursive: true })
    } catch {}
  }
  jobsDirEnsured = true
}

export function toPersistedJob(job: AutomationJob): Record<string, unknown> {
  // Never persist interactive credentials, payment data, OTPs, or tokenized
  // verification links. They remain available only in the live process.
  const {
    pendingCredentials: _c,
    pendingSettingsCredentials: _s,
    pendingPaymentCredentials: _p,
    pendingVerification: _v,
    ...rest
  } = job as Record<string, unknown>
  return rest
}

function flushJobToDiskSync(job: AutomationJob) {
  try {
    ensureJobsDir()
    const persisted = toPersistedJob(job)
    const targetPath = path.join(JOBS_DIR, `${job.id}.json`)
    const tmpPath = `${targetPath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(persisted, null, 2), "utf8")
    fs.renameSync(tmpPath, targetPath)
  } catch (err) {
    console.warn("[AI Runner] Failed to persist job to disk:", err)
  }
}

async function flushJobToDiskAsync(job: AutomationJob) {
  try {
    ensureJobsDir()
    const persisted = toPersistedJob(job)
    const payload = JSON.stringify(persisted, null, 2)
    const targetPath = path.join(JOBS_DIR, `${job.id}.json`)
    const tmpPath = `${targetPath}.tmp`
    await fs.promises.writeFile(tmpPath, payload, "utf8")
    await fs.promises.rename(tmpPath, targetPath)
  } catch (err) {
    console.warn("[AI Runner] Failed to persist job to disk:", err)
  }
}

export function saveJob(job: AutomationJob, options?: { immediate?: boolean }) {
  jobStore.set(job.id, job)

  const isTerminal =
    options?.immediate ||
    job.status === "completed" ||
    job.status === "failed" ||
    job.status === "stopped"

  const existingTimer = pendingFlushTimers.get(job.id)
  if (existingTimer) {
    clearTimeout(existingTimer)
    pendingFlushTimers.delete(job.id)
  }

  if (isTerminal) {
    flushJobToDiskSync(job)
    return
  }

  const timer = setTimeout(() => {
    pendingFlushTimers.delete(job.id)
    const latest = jobStore.get(job.id) || job
    void flushJobToDiskAsync(latest)
  }, FLUSH_DEBOUNCE_MS)

  if (typeof timer.unref === "function") {
    timer.unref()
  }
  pendingFlushTimers.set(job.id, timer)
}

export function getJob(jobId: string): AutomationJob | null {
  if (jobStore.has(jobId)) {
    return jobStore.get(jobId)!
  }
  try {
    ensureJobsDir()
    const filePath = path.join(JOBS_DIR, `${jobId}.json`)
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as AutomationJob
      jobStore.set(jobId, data)
      return data
    }
  } catch {}
  return null
}

import { secretRedactor } from "./secure-credentials-manager"

/**
 * Append a bounded, ordered event to the active job. The job is the durable
 * session envelope, so all consumers observe the same URL, plan and event cursor.
 */
export function emitSessionEvent(
  job: AutomationJob,
  type: SessionEventType,
  details: { url?: string; message?: string; payload?: Record<string, unknown> } = {}
) {
  job.sessionId ||= job.id
  const sequence = (job.sessionEventSequence || 0) + 1
  job.sessionEventSequence = sequence
  const event = {
    id: `${job.sessionId}:${sequence}`,
    sequence,
    sessionId: job.sessionId,
    type,
    timestamp: new Date().toISOString(),
    url: details.url || job.targetUrl,
    message: details.message ? (secretRedactor ? secretRedactor.redact(details.message) : details.message) : undefined,
    payload: details.payload,
  }
  const events = job.sessionEvents || (job.sessionEvents = [])
  events.push(event)
  if (events.length > 500) events.splice(0, events.length - 500)
  saveJob(job)
  return event
}

export function appendLog(job: AutomationJob, level: AutomationLog["level"], message: string) {
  const sanitized = secretRedactor ? secretRedactor.redact(message) : message
  const log: AutomationLog = {
    timestamp: new Date().toISOString(),
    level,
    message: sanitized,
  }
  job.logs.push(log)
  if (job.logs.length > MAX_JOB_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOGS)
  }
  emitSessionEvent(job, level === "error" ? "error" : "progress", {
    message: sanitized,
    payload: { level },
  })
  console.log(`[AI Bot][${job.id.slice(0, 6)}][${level.toUpperCase()}] ${sanitized}`)
}

/** Per-job scratch directory for recordings and artifacts. */
export function jobDir(jobId: string): string {
  const dir = path.join(process.cwd(), ".jobs", jobId)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}
