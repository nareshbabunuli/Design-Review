import { NextRequest, NextResponse } from "next/server"
import { verifyTargetTestData, generateTargetTestData } from "@/lib/ai-automation/test-data-service"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const projectDir = searchParams.get("projectDir") || undefined
    const baseUrl = searchParams.get("baseUrl") || undefined

    const result = verifyTargetTestData(projectDir, baseUrl)
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to inspect target project test data.",
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const projectDir = body?.projectDir || undefined
    const baseUrl = body?.baseUrl || undefined

    const result = generateTargetTestData(projectDir, baseUrl)
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to generate target project test data.",
      },
      { status: 500 }
    )
  }
}
