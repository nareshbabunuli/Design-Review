import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json()
    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "Figma token is required" }, { status: 400 })
    }

    const cleanToken = token.trim()
    const res = await fetch("https://api.figma.com/v1/me", {
      headers: {
        "X-Figma-Token": cleanToken,
      },
    })

    if (!res.ok) {
      let errMsg = `Figma API returned status ${res.status}`
      try {
        const errJson = await res.json()
        if (errJson?.message) errMsg = errJson.message
        else if (errJson?.err) errMsg = errJson.err
      } catch {}
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({
      valid: true,
      user: {
        id: data.id,
        email: data.email,
        handle: data.handle,
        img_url: data.img_url,
      },
    })
  } catch (err: any) {
    console.error("Error verifying Figma token:", err)
    return NextResponse.json({ error: err?.message || "Failed to verify Figma token" }, { status: 500 })
  }
}
