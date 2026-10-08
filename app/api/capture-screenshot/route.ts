import { NextRequest, NextResponse } from "next/server"
import {
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import {
  assertSafeTargetUrlWithDevBypass,
  UrlGuardError,
} from "@/lib/security/url-guard"
import { launchTestBrowser } from "@/lib/browser/secure-browser"
import { createUserClient } from "@/lib/supabase/server-user"

export interface NativeCrop {
  x: number
  y: number
  width: number
  height: number
}

interface CaptureScreenshotRequest {
  url?: string
  width?: number
  height?: number
  workflowId?: string
  projectId?: string
  captureMode?: "clean-app" | "framed-device"
  crop?: NativeCrop
  accessToken?: string
  refreshToken?: string
  cookies?: string
  credentials?: {
    type?: "login" | "cookie" | "token"
    username?: string
    password?: string
    cookie?: string
    token?: string
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: CaptureScreenshotRequest = await req.json()
    const {
      url,
      width = 393,
      height = 852,
      workflowId,
      projectId,
      crop,
      accessToken,
      refreshToken,
      cookies,
      credentials,
    } = body

    if (!workflowId) {
      return NextResponse.json({ error: "Missing workflowId" }, { status: 400 })
    }
    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId (required for authorization)" },
        { status: 400 }
      )
    }

    await requireProjectAccess(projectId, "edit")

    const targetUrlRaw = (url || "http://localhost:8081").trim()
    let targetUrl: string
    try {
      targetUrl = assertSafeTargetUrlWithDevBypass(targetUrlRaw)
    } catch (e) {
      if (e instanceof UrlGuardError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      throw e
    }

    const targetWidth = Math.round(width)
    const targetHeight = Math.round(height)

    let clipRect = { x: 0, y: 0, width: targetWidth, height: targetHeight }
    if (crop) {
      const cropX = Math.max(0, Math.min(targetWidth - 1, Math.round(crop.x)))
      const cropY = Math.max(0, Math.min(targetHeight - 1, Math.round(crop.y)))
      const cropW = Math.max(1, Math.min(Math.round(crop.width), targetWidth - cropX))
      const cropH = Math.max(1, Math.min(Math.round(crop.height), targetHeight - cropY))
      clipRect = { x: cropX, y: cropY, width: cropW, height: cropH }
    }

    const { browser, page } = await launchTestBrowser({
      url: targetUrl,
      width: targetWidth,
      height: targetHeight,
      credentials: {
        username: credentials?.username,
        password: credentials?.password,
        cookie: [cookies, credentials?.cookie].filter(Boolean).join("; ") || undefined,
        token: credentials?.token,
      },
      accessToken,
      refreshToken,
    })

    let imageBuffer: Buffer
    try {
      try {
        await page.waitForFunction(
          () => {
            const root =
              document.getElementById("root") ||
              document.getElementById("__next") ||
              document.body
            const text = (root?.innerText || "").trim().toLowerCase()
            const isOnlyLoading = text.startsWith("loading") && text.length < 50
            return (root?.children?.length ?? 0) > 0 && !isOnlyLoading
          },
          { timeout: 8000 }
        ).catch(() => {})
      } catch {}

      await page.evaluate(async () => {
        if (document.fonts) {
          await document.fonts.ready.catch(() => {})
        }
      })
      await new Promise((r) => setTimeout(r, 800))

      const screenshotBuffer = await page.screenshot({
        type: "png",
        clip: clipRect,
      })
      imageBuffer = Buffer.from(screenshotBuffer)
    } finally {
      await browser.close().catch(() => {})
    }

    const supabase = await createUserClient()
    const fileName = `${workflowId}-designB-${Date.now()}.png`
    const filePath = `workflows/${workflowId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from("designs")
      .upload(filePath, imageBuffer, {
        upsert: true,
        contentType: "image/png",
      })

    if (uploadError) {
      console.error("Failed to upload screenshot:", uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
    const publicUrl = pubData.publicUrl

    const { error: dbUpdateError } = await supabase
      .from("workflows")
      .update({ design_b: publicUrl })
      .eq("id", workflowId)

    if (dbUpdateError) {
      console.warn("[capture-screenshot] workflow update:", dbUpdateError.message)
    }

    return NextResponse.json({
      success: true,
      publicUrl,
      width: clipRect.width,
      height: clipRect.height,
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    console.error("Screenshot capture error:", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Failed to capture screenshot" },
      { status: 500 }
    )
  }
}
