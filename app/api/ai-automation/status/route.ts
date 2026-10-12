import { NextRequest, NextResponse } from "next/server"
import { getJob, cancelJob, saveJob } from "@/lib/ai-automation/runner"
import {
  requireUser,
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import { sanitizeJobForClient } from "@/lib/browser/secure-browser"
import { setJobSecrets, clearJobSecrets } from "@/lib/ai-automation/job-secret-vault"
import { emitSessionEvent } from "@/lib/ai-automation/job-store"
import { assertSafeTargetUrlWithDevBypass, UrlGuardError } from "@/lib/security/url-guard"

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
    if (err instanceof UrlGuardError) return NextResponse.json({ error: err.message }, { status: 400 })
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

    if (action === "navigate_session") {
      if (job.status !== "running" && job.status !== "queued") {
        return NextResponse.json({ error: "Navigation requires an active testing session" }, { status: 409 })
      }
      const requestedUrl = assertSafeTargetUrlWithDevBypass(String(body.url || ""))
      const currentUrl = job.currentUrl || job.targetUrl
      const currentOrigin = new URL(job.targetUrl).origin
      if (new URL(requestedUrl).origin !== currentOrigin) {
        return NextResponse.json({
          error: "Navigation within an active session must stay on the current target origin. Start a separate session to test another application.",
        }, { status: 400 })
      }
      const pendingUrl = job.pendingSessionNavigation?.url
      if (requestedUrl === currentUrl && !pendingUrl) {
        return NextResponse.json({
          success: true,
          unchanged: true,
          job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
        })
      }
      if (requestedUrl === pendingUrl) {
        return NextResponse.json({
          success: true,
          queued: true,
          unchanged: true,
          job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
        })
      }

      job.sessionId ||= job.id
      job.currentUrl = requestedUrl
      job.targetUrl = requestedUrl
      if (job.fullAppTestPlan) job.fullAppTestPlan.targetUrl = requestedUrl
      job.pendingSessionNavigation = {
        requestId: `${job.sessionId}:nav:${Date.now()}`,
        url: requestedUrl,
        requestedAt: new Date().toISOString(),
      }
      emitSessionEvent(job, "navigation_requested", {
        url: requestedUrl,
        message: `Navigation requested: ${requestedUrl}`,
        payload: { requestId: job.pendingSessionNavigation.requestId },
      })
      return NextResponse.json({
        success: true,
        queued: true,
        message: "Navigation queued for the next safe browser action boundary.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "session_input") {
      if (job.status !== "running" && job.status !== "queued") {
        return NextResponse.json({ error: "There is no active testing session to receive input" }, { status: 409 })
      }
      const text = typeof body.text === "string" ? body.text.trim() : ""
      if (!text) return NextResponse.json({ error: "Missing session input" }, { status: 400 })

      // Explicit navigation requests in chat update the same session rather than
      // creating a new automation job. Relative paths resolve against its current URL.
      const navigationMatch = text.match(/\b(?:navigate|go|open|visit)\s+(?:to\s+)?(https?:\/\/[^\s]+|\/[^\s]*)/i)
      if (navigationMatch) {
        const currentUrl = job.currentUrl || job.targetUrl
        const requestedUrl = assertSafeTargetUrlWithDevBypass(new URL(navigationMatch[1], currentUrl).href)
        if (new URL(requestedUrl).origin !== new URL(job.targetUrl).origin) {
          return NextResponse.json({ error: "Session navigation must stay on the current target origin." }, { status: 400 })
        }
        if (requestedUrl !== (job.pendingSessionNavigation?.url || job.currentUrl || job.targetUrl)) {
          job.sessionId ||= job.id
          job.currentUrl = requestedUrl
          job.targetUrl = requestedUrl
          if (job.fullAppTestPlan) job.fullAppTestPlan.targetUrl = requestedUrl
          job.pendingSessionNavigation = {
            requestId: `${job.sessionId}:nav:${Date.now()}`,
            url: requestedUrl,
            requestedAt: new Date().toISOString(),
          }
          emitSessionEvent(job, "navigation_requested", {
            url: requestedUrl,
            message: `Chat requested navigation to ${requestedUrl}`,
            payload: { requestId: job.pendingSessionNavigation.requestId, source: "chat" },
          })
        }
      }

      emitSessionEvent(job, "user_input", {
        message: "User input received by the active testing session.",
        payload: {
          inputId: `${job.sessionId || job.id}:input:${Date.now()}`,
          text: text.replace(/\b(password|pass|pwd|token|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1: ****"),
        },
      })
      return NextResponse.json({
        success: true,
        message: "Input delivered to the active session.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (
      action === "pause_recording" ||
      action === "resume_recording" ||
      action === "stop_recording"
    ) {
      if (job.status !== "running") {
        return NextResponse.json({ error: "Recording can only be controlled while a test is running" }, { status: 409 })
      }
      const currentState = (job as any).recordingControl || "recording"
      if (currentState === "stopped") {
        return NextResponse.json({ error: "Recording has already stopped and cannot be resumed" }, { status: 409 })
      }
      if (action === "pause_recording" && currentState !== "recording") {
        return NextResponse.json({ error: "Recording is not currently running" }, { status: 409 })
      }
      if (action === "resume_recording" && currentState !== "paused") {
        return NextResponse.json({ error: "Recording is not paused" }, { status: 409 })
      }
      const nextState =
        action === "pause_recording"
          ? "paused"
          : action === "resume_recording"
            ? "recording"
            : "stopped"
      ;(job as any).recordingControl = nextState
      saveJob(job)
      return NextResponse.json({
        success: true,
        message:
          nextState === "paused"
            ? "Recording paused"
            : nextState === "recording"
              ? "Recording resumed"
              : "Recording stopped",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "stop") {
      clearJobSecrets(jobId)
      const stopped = cancelJob(jobId)
      const updated = getJob(jobId)
      if (stopped && updated) {
        emitSessionEvent(updated, "session_stopped", {
          message: "Testing session stopped; the active browser and recording are being finalized.",
          payload: { reason: "user_requested" },
        })
      }
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
      setJobSecrets(jobId, {
        credentials: { username: String(username), password: String(password) },
      })
      // Keep a runtime-only copy for legacy runner paths; job-store strips it from disk.
      ;(job as any).pendingCredentials = { username: String(username), password: String(password) }
      ;(job as any).authState = "logged_in"
      ;(job as any).authPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_auth") {
      setJobSecrets(jobId, { credentials: { username: "", password: "" } })
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
      const verification = {
        completed: true,
        verificationUrl: verificationUrl ? String(verificationUrl) : undefined,
        verificationCode: verificationCode ? String(verificationCode) : undefined,
      }
      setJobSecrets(jobId, { verification })
      ;(job as any).pendingVerification = verification
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
      setJobSecrets(jobId, { verification: { skip: true } })
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
      const secretValues: Record<string, string> = {}
      for (const [key, value] of Object.entries(credentials)) {
        if (typeof value === "string") secretValues[key] = value
      }
      setJobSecrets(jobId, { settingsCredentials: secretValues })
      ;(job as any).pendingSettingsCredentials = secretValues
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
      setJobSecrets(jobId, { settingsCredentials: { __skip: "true" } })
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
