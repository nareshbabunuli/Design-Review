import { NextRequest, NextResponse } from "next/server"
import { getJob, cancelJob, saveJob } from "@/lib/ai-automation/runner"
import {
  requireUser,
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import { sanitizeJobForClient } from "@/lib/browser/secure-browser"

async function assertJobAccess(job: { projectId?: string; userId?: string }) {
  const user = await requireUser()
  if (job.projectId) {
    await requireProjectAccess(job.projectId, "view")
    return user
  }
  if (job.userId && job.userId !== user.id) {
    throw new AuthError(403, "Not allowed to access this job")
  }
  return user
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("jobId")

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId parameter" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)

    return NextResponse.json({
      success: true,
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[API ai-automation/status] Error:", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { jobId, action, username, password } = body

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)
    if (job.projectId) {
      await requireProjectAccess(job.projectId, "edit")
    }

    if (action === "pause_recording" || action === "resume_recording") {
      if (job.status !== "running") {
        return NextResponse.json({ error: "Recording can only be controlled while a test is running" }, { status: 409 })
      }
      ;(job as any).recordingControl = action === "pause_recording" ? "paused" : "recording"
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: action === "pause_recording" ? "Recording paused" : "Recording resumed",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "stop") {
      const stopped = cancelJob(jobId)
      const updated = getJob(jobId)
      return NextResponse.json({
        success: stopped,
        message: stopped ? "Job stopped" : "Job not found or already completed",
        job: updated
          ? sanitizeJobForClient(updated as unknown as Record<string, unknown>)
          : null,
      })
    }

    if (action === "provide_credentials") {
      if (!username || !password) {
        return NextResponse.json(
          { error: "username and password required" },
          { status: 400 }
        )
      }
      ;(job as any).pendingCredentials = {
        username: String(username),
        password: String(password),
      }
      ;(job as any).authState = "logged_in"
      ;(job as any).authPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_auth") {
      ;(job as any).pendingCredentials = { skip: true }
      ;(job as any).authState = "skipped"
      ;(job as any).authPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "confirm_verification") {
      const { verificationUrl, verificationCode } = body
      ;(job as any).pendingVerification = {
        completed: true,
        verificationUrl: verificationUrl ? String(verificationUrl) : undefined,
        verificationCode: verificationCode ? String(verificationCode) : undefined,
      }
      ;(job as any).verificationState = "verified"
      ;(job as any).verificationPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "External verification confirmation received. Resuming testing.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_verification") {
      ;(job as any).pendingVerification = { skip: true }
      ;(job as any).verificationState = "skipped"
      ;(job as any).verificationPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "External verification skipped.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "provide_settings_credentials") {
      const { credentials } = body
      if (!credentials || typeof credentials !== "object") {
        return NextResponse.json(
          { error: "credentials object required" },
          { status: 400 }
        )
      }
      ;(job as any).pendingSettingsCredentials = credentials
      ;(job as any).settingsState = "configured"
      ;(job as any).settingsPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "Settings credentials received securely. Resuming testing.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_settings_credentials") {
      ;(job as any).pendingSettingsCredentials = { skip: true }
      ;(job as any).settingsState = "skipped"
      ;(job as any).settingsPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "Settings credentials skipped.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    return NextResponse.json({
      success: true,
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
