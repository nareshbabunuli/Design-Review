import { NextRequest, NextResponse } from "next/server"
import { getJob } from "@/lib/ai-automation/job-store"
import { generateHTMLReport } from "@/lib/ai-automation/html-report-generator"
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

/**
 * GET /api/ai-automation/html-report?jobId={jobId}
 * 
 * Serves the comprehensive HTML test report directly in the browser.
 * The report includes:
 * - Executive summary
 * - UX audit scores with dimensional breakdown
 * - Test statistics
 * - Issues grouped by severity
 * - Screen documentation with screenshots
 * - Test plan execution details
 * - Workflow reports
 * - Recommendations
 * - Execution logs
 * 
 * Features:
 * - View directly in browser
 * - Print to PDF (Ctrl+P / Cmd+P)
 * - Professional styling
 * - Responsive design
 */
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

    // Generate the HTML report
    const htmlReport = generateHTMLReport(job)

    // Return as HTML with proper content type
    return new NextResponse(htmlReport, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        // Security headers
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    })
  } catch (err: any) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[HTML Report API] Failed to generate HTML report:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to generate HTML report" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ai-automation/html-report
 * Body: { jobId: string }
 * 
 * Alternative POST endpoint for generating HTML reports.
 */
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

    // Generate the HTML report
    const htmlReport = generateHTMLReport(job)

    // Return as HTML with proper content type
    return new NextResponse(htmlReport, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        // Security headers
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    })
  } catch (err: any) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[HTML Report API] Failed to generate HTML report:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to generate HTML report" },
      { status: 500 }
    )
  }
}
