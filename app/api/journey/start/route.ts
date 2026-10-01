import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { runJourney } from "@/lib/journey/runner"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import type { JourneyConfig, JourneyState } from "@/lib/journey/types"

/**
 * In-memory journey store for v1.
 * For production, move to Redis / Supabase table.
 */
const journeys = new Map<string, JourneyState>()

export function getJourney(id: string): JourneyState | undefined {
  return journeys.get(id)
}

export function setJourney(state: JourneyState) {
  journeys.set(state.id, state)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const config: JourneyConfig = {
      projectId: body.projectId,
      role: body.role || "user",
      customRoleLabel: body.customRoleLabel,
      startUrl: (body.startUrl || "http://localhost:8081").trim(),
      urls: Array.isArray(body.urls) ? body.urls.filter(Boolean) : undefined,
      maxSteps: body.maxSteps ?? 10,
      width: body.width ?? 1280,
      height: body.height ?? 800,
      cookies: body.cookies,
      credentials: body.credentials,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      layaBaseUrl: body.layaBaseUrl,
      title: body.title,
    }

    if (!config.projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    }
    if (!config.startUrl && (!config.urls || config.urls.length === 0)) {
      return NextResponse.json({ error: "startUrl or urls required" }, { status: 400 })
    }

    const id = randomUUID()
    const state: JourneyState = {
      id,
      status: "running",
      config,
      steps: [],
      currentIndex: 0,
      startedAt: new Date().toISOString(),
    }
    setJourney(state)

    // Fire-and-forget background run (Next.js route stays alive for the process)
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
  } catch (err: any) {
    console.error("[journey/start]", err)
    return NextResponse.json({ error: err?.message || "Failed to start journey" }, { status: 500 })
  }
}
