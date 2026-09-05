import { NextResponse } from "next/server"
import { ScreencastManager } from "@/lib/screencast-manager"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await ScreencastManager.closeSession()
  } catch (e) {}

  return NextResponse.json({
    status: "deprecated",
    message: "Canvas screencast has been decommissioned. Live preview now runs natively via iframe.",
  })
}

