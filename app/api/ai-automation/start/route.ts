import { NextRequest, NextResponse } from "next/server"
import { createAndStartJob } from "@/lib/ai-automation/runner"
import type { StartAutomationRequest } from "@/lib/ai-automation/types"
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
    const body: StartAutomationRequest = await req.json()

    if (!body.url || !body.url.trim()) {
      return NextResponse.json({ error: "Missing target URL" }, { status: 400 })
    }
    if (!body.projectId || !body.projectId.trim()) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
    }

    // Auth: only project members with edit access can start jobs
    const access = await requireProjectAccess(body.projectId.trim(), "edit")

    // SSRF guard
    let safeUrl: string
    try {
      safeUrl = assertSafeTargetUrlWithDevBypass(body.url.trim())
    } catch (e) {
      if (e instanceof UrlGuardError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      throw e
    }

    const job = await createAndStartJob({
      url: safeUrl,
      projectId: body.projectId.trim(),
      userInstruction: body.userInstruction,
      role: body.role,
      layaBaseUrl: body.layaBaseUrl,
      credentials: body.credentials,
      viewports: body.viewports,
      maxScreens: Math.min(Math.max(body.maxScreens || 5, 1), 15),
      checkBackNavigation: body.checkBackNavigation ?? true,
      checkResponsive: body.checkResponsive ?? true,
      openRouterApiKey:
        process.env.NODE_ENV === "production"
          ? undefined
          : body.openRouterApiKey,
      aiModel: body.aiModel,
      aiBaseUrl: body.aiBaseUrl,
      mode: body.mode,
      workflowPrompt: body.workflowPrompt,
      scenarioCount: body.scenarioCount,
      dummyTestFiles: body.dummyTestFiles,
      uploadFilesDir: body.uploadFilesDir,
      postmanCollection: body.postmanCollection,
      paymentCredentials: body.paymentCredentials,
      allowTestPayments: body.allowTestPayments,
      allowActions: body.allowActions,
    })

    ;(job as any).userId = access.user.id

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: "AI UI Automation job started in background.",
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[API ai-automation/start] Error:", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
