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
