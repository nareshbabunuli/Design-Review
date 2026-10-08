import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { runJourney } from "@/lib/journey/runner"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import type { JourneyConfig, JourneyState } from "@/lib/journey/types"
import {
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import {
  assertSafeTargetUrlWithDevBypass,
  UrlGuardError,
} from "@/lib/security/url-guard"

/**
 * In-memory journey store for v1.
 * For production, move to Redis / Supabase table with user_id + RLS.
 */
const journeys = new Map<string, JourneyState & { userId?: string }>()

export function getJourney(id: string) {
  return journeys.get(id)
}

export function setJourney(state: JourneyState & { userId?: string }) {
  journeys.set(state.id, state)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    }

    const access = await requireProjectAccess(body.projectId, "edit")

    const startUrlRaw = (body.startUrl || "http://localhost:8081").trim()
    let startUrl: string
    try {
      startUrl = assertSafeTargetUrlWithDevBypass(startUrlRaw)
    } catch (e) {
      if (e instanceof UrlGuardError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      throw e
    }

    let urls: string[] | undefined
    if (Array.isArray(body.urls)) {
      urls = []
      for (const u of body.urls.filter(Boolean)) {
        try {
          urls.push(assertSafeTargetUrlWithDevBypass(String(u)))
        } catch (e) {
          if (e instanceof UrlGuardError) {
            return NextResponse.json({ error: e.message }, { status: 400 })
          }
          throw e
        }
      }
    }

    const config: JourneyConfig = {
      projectId: body.projectId,
      role: body.role || "user",
      customRoleLabel: body.customRoleLabel,
      startUrl,
      urls,
      maxSteps: Math.min(body.maxSteps ?? 10, 30),
      width: body.width ?? 1280,
      height: body.height ?? 800,
      cookies: body.cookies,
      credentials: body.credentials,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      layaBaseUrl: body.layaBaseUrl,
      title: body.title,
    }

    if (!config.startUrl && (!config.urls || config.urls.length === 0)) {
      return NextResponse.json({ error: "startUrl or urls required" }, { status: 400 })
    }

    const id = randomUUID()
    const state: JourneyState & { userId: string } = {
      id,
      status: "running",
      config,
      steps: [],
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      userId: access.user.id,
    }
    setJourney(state)

    ;(async () => {
      try {
        const steps = await runJourney({
          journeyId: id,
          config,
          onStep: async (step, index) => {
            const current = getJourney(id)
            if (!current || current.status === "cancelled") return
            current.steps = [...current.steps, step]
            current.currentIndex = index
            setJourney(current)
          },
        })

        const current = getJourney(id)
        if (!current || current.status === "cancelled") return

        current.steps = steps
        const { workflowId, title } = await createWorkflowFromJourney(config, steps)
        current.workflowId = workflowId
        current.status = "completed"
        current.finishedAt = new Date().toISOString()
        setJourney(current)
        console.log(`[journey] completed ${id} → workflow ${workflowId} (${title})`)
      } catch (err: any) {
        const current = getJourney(id)
        if (current) {
          current.status = "failed"
          current.error = err?.message || "Journey failed"
          current.finishedAt = new Date().toISOString()
          setJourney(current)
        }
        console.error("[journey] failed:", err)
      }
    })()

    return NextResponse.json({ journeyId: id, status: "running" })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("[journey/start]", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Failed to start journey" },
      { status: 500 }
    )
  }
}
