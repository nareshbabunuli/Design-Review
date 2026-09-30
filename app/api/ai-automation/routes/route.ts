import { NextRequest, NextResponse } from "next/server"
import { discoverLocalProjectRoutes } from "@/lib/ai-automation/discover-routes"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const baseUrl = searchParams.get("baseUrl") || "http://localhost:3000"

    const routes = discoverLocalProjectRoutes(baseUrl)

    return NextResponse.json({
      success: true,
      count: routes.length,
      routes,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to scan local project routes.",
      },
      { status: 500 }
    )
  }
}
