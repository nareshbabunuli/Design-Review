import { NextRequest, NextResponse } from "next/server"
import { createAndStartJob } from "@/lib/ai-automation/runner"
import type { StartAutomationRequest } from "@/lib/ai-automation/types"

export async function POST(req: NextRequest) {
  try {
    const body: StartAutomationRequest = await req.json()

    if (!body.url || !body.url.trim()) {
      return NextResponse.json({ error: "Missing target URL" }, { status: 400 })
    }

    if (!body.projectId || !body.projectId.trim()) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(body.url.trim())
    } catch {
      return NextResponse.json({ error: "Invalid target URL format" }, { status: 400 })
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "URL must start with http:// or https://" }, { status: 400 })
    }

    const job = await createAndStartJob({
      url: body.url.trim(),
      projectId: body.projectId.trim(),
      credentials: body.credentials,
      viewports: body.viewports,
      maxScreens: body.maxScreens || 5,
      checkBackNavigation: body.checkBackNavigation ?? true,
      checkResponsive: body.checkResponsive ?? true,
      openRouterApiKey: body.openRouterApiKey,
      aiModel: body.aiModel,
      aiBaseUrl: body.aiBaseUrl,
    })

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: "AI UI Automation job started in background.",
    })
  } catch (err: any) {
    console.error("[API ai-automation/start] Error:", err)
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 })
  }
}
