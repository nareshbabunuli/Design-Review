import { NextRequest, NextResponse } from "next/server"
import { createAndStartJob } from "@/lib/ai-automation/runner"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      command,
      targetUrl,
      projectId,
      credentials,
      openRouterApiKey,
      aiModel,
      aiBaseUrl,
    } = body

    if (!command || !command.trim()) {
      return NextResponse.json(
        { success: false, error: "Command instruction is required." },
        { status: 400 }
      )
    }

    const cleanUrl = (targetUrl || "http://localhost:3000").trim()
    const targetProject = projectId || "ai-simulator-default"

    const job = await createAndStartJob({
      url: cleanUrl,
      projectId: targetProject,
      userInstruction: command.trim(),
      credentials,
      openRouterApiKey,
      aiModel,
      aiBaseUrl,
      maxScreens: 3,
    })

    return NextResponse.json({
      success: true,
      jobId: job.id,
      job,
    })
  } catch (err: any) {
    console.error("[AI Chat Route] Error executing chat command:", err)
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to process chat command." },
      { status: 500 }
    )
  }
}
