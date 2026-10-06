import { NextRequest, NextResponse } from "next/server"
import { createAndStartJob } from "@/lib/ai-automation/runner"
import { isFullAppCommand } from "@/lib/ai-automation/full-app-engine"
import { isFeatureWorkflowCommand } from "@/lib/ai-automation/feature-workflow-engine"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      command,
      image,
      targetUrl,
      projectId,
      credentials,
      openRouterApiKey,
      aiModel,
      aiBaseUrl,
      mode,
      dummyTestFiles,
    } = body

    if ((!command || !command.trim()) && !image) {
      return NextResponse.json(
        { success: false, error: "Command instruction or image is required." },
        { status: 400 }
      )
    }

    const cleanUrl = (targetUrl || "http://localhost:3000").trim()
    const targetProject = projectId || "ai-simulator-default"
    const cmdText = (command && command.trim()) ? command.trim() : "Analyze screen image, formulate thinking model, create checklist, and perform UI tests"
    const isFeatureWf = mode === "feature_workflow" || isFeatureWorkflowCommand(cmdText)
    const isFullApp = !isFeatureWf && (mode === "full_app" || isFullAppCommand(cmdText))

    const job = await createAndStartJob({
      url: cleanUrl,
      projectId: targetProject,
      userInstruction: cmdText,
      workflowPrompt: isFeatureWf ? cmdText : undefined,
      mode: isFeatureWf ? "feature_workflow" : isFullApp ? "full_app" : mode,
      image: image?.trim() || undefined,
      credentials,
      openRouterApiKey,
      aiModel,
      aiBaseUrl,
      maxScreens: isFullApp ? 10 : isFeatureWf ? 5 : 3,
      dummyTestFiles,
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
