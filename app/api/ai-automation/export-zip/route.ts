import { NextRequest, NextResponse } from "next/server"
import { getJob } from "@/lib/ai-automation/job-store"
import { buildTestBundleZip } from "@/lib/ai-automation/export-service"
import { requireUser, requireProjectAccess, authErrorResponse, AuthError } from "@/lib/auth/require-project-access"

export const maxDuration = 60
export const dynamic = "force-dynamic"

async function assertJobAccess(job: { projectId?: string; userId?: string }) {
  try {
    const user = await requireUser()
    if (job.projectId) {
      await requireProjectAccess(job.projectId, "view")
      return user
    }
    if (job.userId && job.userId !== user.id) {
      throw new AuthError(403, "Not allowed to access this job")
    }
    return user
  } catch (err) {
    if (process.env.NODE_ENV !== "production") return null
    throw err
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("jobId")

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId query parameter" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)

    const { buffer, fileName } = await buildTestBundleZip(job)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (err: any) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[Export ZIP API] Failed to generate test bundle zip:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to generate test bundle zip" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const jobId = body?.jobId

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId in request body" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)

    const { buffer, fileName } = await buildTestBundleZip(job)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (err: any) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[Export ZIP API] Failed to generate test bundle zip:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to generate test bundle zip" },
      { status: 500 }
    )
  }
}
