import { NextRequest, NextResponse } from "next/server"
import {
  discoverLocalProjectRoutes,
  listAvailableLocalProjects,
  resolveProjectDirectory,
} from "@/lib/ai-automation/discover-routes"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const baseUrl = searchParams.get("baseUrl") || "http://localhost:3000"
    const projectDir = searchParams.get("projectDir") || undefined

    const activeProjectDir = resolveProjectDirectory(baseUrl, projectDir)
    const routes = discoverLocalProjectRoutes(baseUrl, projectDir)
    const availableProjects = listAvailableLocalProjects()

    return NextResponse.json({
      success: true,
      activeProjectDir,
      count: routes.length,
      routes,
      availableProjects,
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
