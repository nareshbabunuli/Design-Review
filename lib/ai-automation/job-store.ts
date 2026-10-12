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

function ensureJobsDir() {
  if (!fs.existsSync(JOBS_DIR)) {
    try {
      fs.mkdirSync(JOBS_DIR, { recursive: true })
    } catch {}
  }
}

export function toPersistedJob(job: AutomationJob): Record<string, unknown> {
  // Never persist interactive credentials, payment data, OTPs, or tokenized
  // verification links. They remain available only in the live process.
  const persisted = JSON.parse(JSON.stringify(job)) as Record<string, unknown>
  delete persisted.pendingCredentials
  delete persisted.pendingSettingsCredentials
  delete persisted.pendingPaymentCredentials
  delete persisted.pendingVerification
  return persisted
}

export function saveJob(job: AutomationJob) {
  jobStore.set(job.id, job)
  try {
    ensureJobsDir()
    const persisted = toPersistedJob(job)
    fs.writeFileSync(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(persisted, null, 2), "utf8")
  } catch (err) {
    console.warn("[AI Runner] Failed to persist job to disk:", err)
  }
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
