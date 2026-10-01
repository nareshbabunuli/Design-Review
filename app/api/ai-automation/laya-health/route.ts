import { NextRequest, NextResponse } from "next/server"
import { isLayaAvailable } from "@/lib/journey/laya-client"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const baseUrl = searchParams.get("baseUrl") || undefined
    const isLive = await isLayaAvailable(baseUrl)
    return NextResponse.json({ live: isLive })
  } catch {
    return NextResponse.json({ live: false })
  }
}
