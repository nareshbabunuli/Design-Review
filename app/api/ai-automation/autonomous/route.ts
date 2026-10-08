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

/**
 * Starts a fully autonomous test run (Stagehand scenario engine).
 * Requires authenticated project member with edit access.
 */
export async function POST(req: NextRequest) {
  try {
    const body: StartAutomationRequest = await req.json()

    if (!body.url || !body.url.trim()) {
      return NextResponse.json({ error: "Missing target URL" }, { status: 400 })
    }
    if (!body.projectId || !body.projectId.trim()) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 })
    }

    const access = await requireProjectAccess(body.projectId.trim(), "edit")

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
        process.env.NODE_ENV === "production" ? undefined : body.openRouterApiKey,
      aiModel: body.aiModel,
      aiBaseUrl: body.aiBaseUrl,
      mode: "autonomous",
      scenarioCount: body.scenarioCount || 15,
    })

    ;(job as any).userId = access.user.id

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      message: "Autonomous test run started in background.",
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[API ai-automation/autonomous] Error:", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
