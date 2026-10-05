import { NextRequest, NextResponse } from "next/server"
import {
  analyzeFeatureWorkflow,
  buildWorkflowTestPlan,
} from "@/lib/ai-automation/feature-workflow-engine"
import { AppScreenNode } from "@/lib/ai-automation/types"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      workflowPrompt,
      targetUrl = "http://localhost:3000",
      openRouterApiKey,
      aiModel,
      aiBaseUrl,
    } = body

    if (!workflowPrompt || !workflowPrompt.trim()) {
      return NextResponse.json(
        { success: false, error: "Workflow or feature description is required." },
        { status: 400 }
      )
    }

    const cleanUrl = targetUrl.trim()
    const spec = await analyzeFeatureWorkflow(workflowPrompt.trim(), cleanUrl, {
      apiKey: openRouterApiKey,
      baseUrl: aiBaseUrl,
      model: aiModel,
    })

    // Construct preliminary mock nodes from spec's likelyScreens so user sees the plan
    const initialScreens: AppScreenNode[] = spec.likelyScreens.map((sName, idx) => ({
      id: `S${String(idx + 1).padStart(3, "0")}`,
      name: sName,
      url: cleanUrl,
      path: idx === 0 ? "/" : `/${sName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      actionableElements: [],
      forms: [],
      discoveredAt: new Date().toISOString(),
    }))

    const preliminaryPlan = buildWorkflowTestPlan(spec, cleanUrl, initialScreens)

    return NextResponse.json({
      success: true,
      spec,
      plan: preliminaryPlan,
    })
  } catch (err: any) {
    console.error("[Workflow Plan API] Error:", err)
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to generate workflow plan." },
      { status: 500 }
    )
  }
}
