import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { token, fileKey, nodeIds } = await req.json()

    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "Figma token is required" }, { status: 400 })
    }

    if (!fileKey || typeof fileKey !== "string" || !fileKey.trim()) {
      return NextResponse.json({ error: "Figma fileKey is required" }, { status: 400 })
    }

    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return NextResponse.json({ images: {} })
    }

    const cleanToken = token.trim()
    const idsParam = nodeIds.map((id) => encodeURIComponent(String(id))).join(",")

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45000)

    const imgRes = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${idsParam}&format=png&scale=1`,
      {
        headers: {
          "X-Figma-Token": cleanToken,
        },
        signal: controller.signal,
      }
    )
    clearTimeout(timeoutId)

    if (!imgRes.ok) {
      const errStatus = imgRes.status
      if (errStatus === 429) {
        const retryHeader = imgRes.headers.get("retry-after")
        const retrySec = retryHeader ? parseInt(retryHeader, 10) : 30
        return NextResponse.json(
          { error: "Rate limit exceeded", isRateLimit: true, retryAfter: retrySec },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { error: `Figma image render returned status ${errStatus}` },
        { status: errStatus }
      )
    }

    const imgData = await imgRes.json()
    return NextResponse.json({
      images: imgData?.images || {},
    })
  } catch (err: any) {
    console.error("Error in Figma images batch API:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to render screen images" },
      { status: 500 }
    )
  }
}
