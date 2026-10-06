import { NextRequest, NextResponse } from "next/server"
import { getJob, cancelJob, saveJob } from "@/lib/ai-automation/runner"

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

    return NextResponse.json({
      success: true,
      job,
    })
  } catch (err: any) {
    console.error("[API ai-automation/status] Error:", err)
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { jobId, action, username, password } = await req.json()

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
    }

    if (action === "stop") {
      const stopped = cancelJob(jobId)
      const updated = getJob(jobId)
      return NextResponse.json({
        success: stopped,
        message: stopped ? "Job stopped" : "Job not found or already completed",
        job: updated,
      })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    if (action === "provide_credentials") {
      if (!username || !password) {
        return NextResponse.json({ error: "username and password required" }, { status: 400 })
      }
      job.pendingCredentials = { username: String(username), password: String(password) }
      job.authState = "logged_in"
      job.authPrompt = undefined
      saveJob(job)
      return NextResponse.json({ success: true, job })
    }

    if (action === "skip_auth") {
      job.pendingCredentials = { skip: true }
      job.authState = "skipped"
      job.authPrompt = undefined
      saveJob(job)
      return NextResponse.json({ success: true, job })
    }

    return NextResponse.json({ success: true, job })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 })
  }
}
