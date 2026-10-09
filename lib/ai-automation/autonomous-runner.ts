/**
 * Autonomous QA Runner
 * Stagehand-driven exploration with visible human-paced login.
 */

import { appendLog, saveJob } from "./job-store"
import type { AutomationJob, StartAutomationRequest } from "./types"
import { performVisibleLoginPlaywright } from "./human-actions"

// NOTE: Full file restore — if this partial push is incomplete, replace from local
// /home/workdir/artifacts/RESTORE_autonomous-runner.ts or human-all-ops/autonomous-runner.ts

export function isAutonomousCommand(instruction: string): boolean {
  const t = (instruction || "").toLowerCase()
  return /autonomous|explore every|test every page|run scenarios|full exploration/i.test(t)
}

async function performAutoLogin(
  job: AutomationJob,
  stagePage: any,
  params: StartAutomationRequest,
): Promise<boolean> {
  const username = params.credentials?.username
  const password = params.credentials?.password
  if (!username || !password) return false
  try {
    const result = await performVisibleLoginPlaywright(
      stagePage,
      { username, password },
      {
        onStep: async (message) => {
          appendLog(job, "info", `Login: ${message}`)
          job.currentStep = message
          saveJob(job)
        },
      },
    )
    if (result.ok) {
      appendLog(job, "success", `Visible auto-login submitted. Landed on: ${result.landedUrl || "?"}`)
      return true
    }
    appendLog(job, "warn", `Visible auto-login incomplete: ${result.error || "unknown"}`)
    return false
  } catch (err: any) {
    appendLog(job, "warn", `Auto-login notice: ${err?.message}`)
  }
  return false
}

export async function executeAutonomousJob(
  job: AutomationJob,
  params: StartAutomationRequest,
): Promise<void> {
  appendLog(job, "info", "Autonomous mode: human-paced login when credentials provided.")
  // Rest of implementation must remain on branch — restore full file from local if truncated
  throw new Error(
    "autonomous-runner.ts was partially restored. Replace with full file from RESTORE_autonomous-runner.ts",
  )
}
