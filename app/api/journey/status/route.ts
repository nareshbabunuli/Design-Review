import { NextRequest, NextResponse } from "next/server"
import { getJourney } from "../start/route"
import {
  requireUser,
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"

/**
 * GET /api/journey/status?id=<journeyId>
 * Requires authentication + project membership (or job owner).
 */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id query param required" }, { status: 400 })
    }

    const state = getJourney(id)
    if (!state) {
      return NextResponse.json({ error: "Journey not found" }, { status: 404 })
    }

    const user = await requireUser()
    const projectId = (state as any).config?.projectId
    if (projectId) {
      await requireProjectAccess(projectId, "view")
    } else if ((state as any).userId && (state as any).userId !== user.id) {
      throw new AuthError(403, "Not allowed to access this journey")
    }

    return NextResponse.json({
      id: state.id,
      status: state.status,
      currentIndex: state.currentIndex,
      stepCount: state.steps.length,
      steps: state.steps.map((s) => ({
        index: s.index,
        url: s.url,
        title: s.title,
        pageType: s.pageType,
        hasBlockingIssue: s.hasBlockingIssue,
        screenshotUrl: s.screenshotUrl,
      })),
      workflowId: state.workflowId || null,
      error: state.error || null,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt || null,
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
