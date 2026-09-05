import { NextRequest, NextResponse } from "next/server"
import puppeteer from "puppeteer"
import { createClient } from "@supabase/supabase-js"

interface CaptureScreenshotRequest {
  url?: string
  width?: number
  height?: number
  workflowId?: string
  accessToken?: string
  refreshToken?: string
  cookies?: string
}

export async function POST(req: NextRequest) {
  try {
    const {
      url,
      width = 430,
      height = 932,
      workflowId,
      accessToken,
      refreshToken,
      cookies,
    }: CaptureScreenshotRequest = await req.json()

    if (!workflowId) {
      return NextResponse.json({ error: "Missing workflowId" }, { status: 400 })
    }

    const targetUrl = (url || "http://localhost:8081").trim()
    console.log("[DEBUG API] Target URL:", targetUrl)
    console.log("[DEBUG API] Has accessToken:", !!accessToken)
    console.log("[DEBUG API] Has cookies:", !!cookies)
    console.log("[DEBUG API] Cookies count:", cookies ? cookies.split(";").length : 0)

    console.log("[DEBUG API] Launching Puppeteer")
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-web-security"],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: Math.round(width), height: Math.round(height) })

    const hostname = new URL(targetUrl).hostname

    // FIRST: Set cookies from the iframe (the actual logged-in session)
    if (cookies) {
      const cookiePairs = cookies.split(";").map((c: string) => c.trim()).filter(Boolean)
      console.log("[DEBUG API] Setting", cookiePairs.length, "cookies from iframe")
      
      for (const cookiePair of cookiePairs) {
        const [name, value] = cookiePair.split("=").map((s: string) => s.trim())
        if (name && value) {
          try {
            await page.setCookie({
              name,
              value,
              domain: hostname,
              path: "/",
              expires: Math.floor(Date.now() / 1000) + 86400, // 24 hours
            })
            console.log("[DEBUG API] Set cookie:", name)
          } catch (e: any) {
            console.warn("[DEBUG API] Failed to set cookie", name, ":", e?.message)
          }
        }
      }
    }

    // SECOND: Also set Supabase auth cookies if provided
    if (accessToken && refreshToken) {
      console.log("[DEBUG API] Setting Supabase auth cookies")
      await page.setCookie(
        { name: "sb-access-token", value: accessToken, domain: hostname, path: "/" },
        { name: "sb-refresh-token", value: refreshToken, domain: hostname, path: "/" }
      )
      
      // Also inject into localStorage for SPAs
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
      let projectRef = 'default'
      try {
        projectRef = new URL(supabaseUrl).hostname.split('.')[0]
      } catch(e) {}
      
      const storageKey = `sb-${projectRef}-auth-token`
      const sessionData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated" }
      }

      await page.evaluateOnNewDocument((key, data) => {
        const sessionStr = JSON.stringify(data)
        localStorage.setItem(key, sessionStr)
        localStorage.setItem('supabase.auth.token', sessionStr)
      }, storageKey, sessionData)
    }

    // Navigate to the URL
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Wait an additional 5 seconds to ensure Expo splash screens and animations are completely finished
    await new Promise(r => setTimeout(r, 5000));

    const imageBuffer = await page.screenshot({ type: "png" })
    await browser.close()

    // Upload directly to Supabase storage
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

    const supabase = createClient(supabaseUrl, supabaseKey)

    const fileName = `${workflowId}-designB-${Date.now()}.png`
    const filePath = `workflows/${workflowId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from("designs")
      .upload(filePath, imageBuffer, {
        upsert: true,
        contentType: "image/png",
      })

    if (uploadError) {
      console.error("Failed to upload screenshot to Supabase storage:", uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
    const publicUrl = pubData.publicUrl

    return NextResponse.json({
      success: true,
      publicUrl,
      width,
      height,
    })
  } catch (err: any) {
    console.error("Screenshot capture error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to capture screenshot" },
      { status: 500 }
    )
  }
}
