import { NextRequest, NextResponse } from "next/server"
import { createAndStartJob } from "@/lib/ai-automation/runner"
import { isFullAppCommand } from "@/lib/ai-automation/full-app-engine"
import { isFeatureWorkflowCommand } from "@/lib/ai-automation/feature-workflow-engine"
import {
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import {
  assertSafeTargetUrlWithDevBypass,
  UrlGuardError,
} from "@/lib/security/url-guard"
import { sanitizeJobForClient } from "@/lib/browser/secure-browser"

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

    const targetProject = (projectId || "").trim()
    if (!targetProject) {
      return NextResponse.json(
        { success: false, error: "projectId is required." },
        { status: 400 }
      )
    }

    const access = await requireProjectAccess(targetProject, "edit")

    const cleanUrl = (targetUrl || "http://localhost:3000").trim()
    let safeUrl: string
    try {
      safeUrl = assertSafeTargetUrlWithDevBypass(cleanUrl)
    } catch (e) {
      if (e instanceof UrlGuardError) {
        return NextResponse.json({ success: false, error: e.message }, { status: 400 })
      }
      throw e
    }

    const cmdText =
      command && command.trim()
        ? command.trim()
        : "Analyze screen image, formulate thinking model, create checklist, and perform UI tests"
    const isFeatureWf = mode === "feature_workflow" || isFeatureWorkflowCommand(cmdText)
    const isFullApp =
      !isFeatureWf && (mode === "full_app" || isFullAppCommand(cmdText))

    const job = await createAndStartJob({
      url: safeUrl,
      projectId: targetProject,
      userInstruction: cmdText,
      workflowPrompt: isFeatureWf ? cmdText : undefined,
      mode: isFeatureWf ? "feature_workflow" : isFullApp ? "full_app" : mode,
      image: image?.trim() || undefined,
      credentials,
      openRouterApiKey:
        process.env.NODE_ENV === "production" ? undefined : openRouterApiKey,
      aiModel,
      aiBaseUrl,
      maxScreens: isFullApp ? 10 : isFeatureWf ? 5 : 3,
      dummyTestFiles,
    })

    ;(job as any).userId = access.user.id

    return NextResponse.json({
      success: true,
      jobId: job.id,
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[AI Chat Route] Error:", err)
    return NextResponse.json(
      { success: false, error: (err as Error)?.message || "Failed to process chat command." },
      { status: 500 }
    )
  }
}
