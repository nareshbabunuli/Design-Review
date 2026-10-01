import { NextRequest, NextResponse } from "next/server"
import { getJourney } from "../start/route"

/**
 * GET /api/journey/status?id=<journeyId>
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 })
  }

  const state = getJourney(id)
  if (!state) {
    return NextResponse.json({ error: "Journey not found" }, { status: 404 })
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
}
