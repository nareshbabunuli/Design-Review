import { NextRequest, NextResponse } from "next/server"
import { ScreencastManager } from "@/lib/screencast-manager"

export async function POST(req: NextRequest) {
  try {
    const event = await req.json()
    await ScreencastManager.dispatchInput(event)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to dispatch input" }, { status: 500 })
  }
}
