import { NextRequest, NextResponse } from "next/server"
import puppeteer, { type Browser } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import fs from "fs"

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
    const {
      url,
      width = 393,
      height = 852,
      workflowId,
      captureMode = "clean-app",
      crop,
      accessToken,
      refreshToken,
      cookies,
      credentials,
    }: CaptureScreenshotRequest = await req.json()

    if (!workflowId) {
      return NextResponse.json({ error: "Missing workflowId" }, { status: 400 })
    }

    const targetUrl = (url || "http://localhost:8081").trim()
    console.log("[DEBUG API] Target URL:", targetUrl, "Width:", width, "Height:", height, "Mode:", captureMode, "Crop:", crop)
    console.log("[DEBUG API] Has accessToken:", !!accessToken)
    console.log("[DEBUG API] Has credentials:", !!credentials)

    const profileDir = path.join(process.cwd(), ".chrome-profile")
    if (!fs.existsSync(profileDir)) {
      try {
        fs.mkdirSync(profileDir, { recursive: true })
      } catch (e) {}
    }

    const targetWidth = Math.round(width)
    const targetHeight = Math.round(height)

    // Calculate exact crop clip rect if provided
    let clipRect = { x: 0, y: 0, width: targetWidth, height: targetHeight }
    if (crop) {
      const cropX = Math.max(0, Math.min(targetWidth - 1, Math.round(crop.x)))
      const cropY = Math.max(0, Math.min(targetHeight - 1, Math.round(crop.y)))
      const cropW = Math.max(1, Math.min(Math.round(crop.width), targetWidth - cropX))
      const cropH = Math.max(1, Math.min(Math.round(crop.height), targetHeight - cropY))
      clipRect = { x: cropX, y: cropY, width: cropW, height: cropH }
    }

    console.log("[DEBUG API] Launching Puppeteer with persistent profile")
    let browser: Browser | null = null
    let imageBuffer: Buffer

    try {
      browser = await puppeteer.launch({
        headless: true,
        userDataDir: profileDir,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-web-security",
          "--hide-scrollbars",
          "--disable-extensions",
        ],
      })

      const page = await browser.newPage()
      await page.setViewport({ width: Math.round(width), height: Math.round(height) })

      const hostname = new URL(targetUrl).hostname

      // 1. Set cookies from the iframe or credentials
      const combinedCookies = [cookies, credentials?.cookie].filter(Boolean).join("; ")
      if (combinedCookies) {
        const cookiePairs = combinedCookies.split(";").map((c: string) => c.trim()).filter(Boolean)
        console.log("[DEBUG API] Setting", cookiePairs.length, "cookies")
        
        for (const cookiePair of cookiePairs) {
          const [name, value] = cookiePair.split("=").map((s: string) => s.trim())
          if (name && value) {
            try {
              await page.setCookie({
                name,
                value,
                domain: hostname,
                path: "/",
                expires: Math.floor(Date.now() / 1000) + 86400 * 7,
              })
            } catch (e: any) {
              console.warn("[DEBUG API] Failed to set cookie", name, ":", e?.message)
            }
          }
        }
      }

      // 2. Set custom bearer/localStorage token if provided
      if (credentials?.token) {
        await page.evaluateOnNewDocument((token: string) => {
          localStorage.setItem("token", token)
          localStorage.setItem("authToken", token)
          localStorage.setItem("auth_token", token)
          localStorage.setItem("access_token", token)
        }, credentials.token)
      }

      // 3. Set Supabase auth cookies if provided
      if (accessToken && refreshToken) {
        console.log("[DEBUG API] Setting Supabase auth cookies")
        await page.setCookie(
          { name: "sb-access-token", value: accessToken, domain: hostname, path: "/" },
          { name: "sb-refresh-token", value: refreshToken, domain: hostname, path: "/" }
        )
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
        let projectRef = "default"
        try {
          projectRef = new URL(supabaseUrl).hostname.split(".")[0]
        } catch (e) {}
        
        const storageKey = `sb-${projectRef}-auth-token`
        const sessionData = {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 3600,
          token_type: "bearer",
          user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated" }
        }

        await page.evaluateOnNewDocument((key: string, data: any) => {
          const sessionStr = JSON.stringify(data)
          localStorage.setItem(key, sessionStr)
          localStorage.setItem("supabase.auth.token", sessionStr)
        }, storageKey, sessionData)
      }

      // 4. Navigate to the URL
      console.log("[DEBUG API] Navigating to:", targetUrl)
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch((e: any) => {
        console.warn("[DEBUG API] Initial navigation notice:", e?.message)
      })

      // 5. Check if page redirected to a login screen and auto-login if credentials are provided
      const currentLoadedUrl = page.url()
      const hasPasswordInput = (await page.$('input[type="password"]')) !== null
      const isLoginScreen =
        currentLoadedUrl.includes("/login") ||
        currentLoadedUrl.includes("/signin") ||
        currentLoadedUrl.includes("/auth") ||
        hasPasswordInput

      if (isLoginScreen && credentials?.username && credentials?.password) {
        console.log("[DEBUG API] Login screen detected, performing auto-login...")
        try {
          const userInput = await page.$(
            'input[type="email"], input[name*="email"], input[name*="user"], input[id*="email"], input[id*="user"], input[type="text"]'
          )
          const passInput = await page.$(
            'input[type="password"], input[name*="pass"], input[id*="pass"]'
          )

          if (userInput && passInput) {
            await userInput.click({ count: 3 }).catch(() => {})
            await userInput.type(credentials.username, { delay: 15 })
            await passInput.click({ count: 3 }).catch(() => {})
            await passInput.type(credentials.password, { delay: 15 })

            const submitBtn = await page.$(
              'button[type="submit"], input[type="submit"], form button, button'
            )
            if (submitBtn) {
              await Promise.all([
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
                submitBtn.click(),
              ])
            } else {
              await page.keyboard.press("Enter")
              await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
            }

            console.log("[DEBUG API] Auto-login submitted, landed on:", page.url())

            // If the login redirected to root or dashboard instead of target URL, navigate to targetUrl
            try {
              const targetPath = new URL(targetUrl).pathname
              if (targetPath && targetPath !== "/" && !page.url().includes(targetPath)) {
                console.log("[DEBUG API] Navigating to target subpage after login:", targetUrl)
                await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
              }
            } catch (e) {}
          }
        } catch (authErr) {
          console.warn("[DEBUG API] Auto-login error notice:", authErr)
        }
      }

      // Wait for app root to render and any loading text to disappear
      try {
        await page.waitForFunction(
          () => {
            const root = document.getElementById("root") || document.getElementById("__next") || document.body
            const text = (root?.innerText || "").trim().toLowerCase()
            const isOnlyLoading = text.startsWith("loading") && text.length < 50
            return (root?.children?.length ?? 0) > 0 && !isOnlyLoading
          },
          { timeout: 8000 }
        ).catch(() => {})
      } catch (e) {}

      // Wait for fonts and content to settle
      await page.evaluate(async () => {
        if (document.fonts) {
          await document.fonts.ready.catch(() => {})
        }
      })
      await new Promise((r) => setTimeout(r, 1500))

      console.log("[DEBUG API] Capturing screenshot with clip:", clipRect)
      const screenshotBuffer = await page.screenshot({
        type: "png",
        clip: clipRect,
      })
      imageBuffer = Buffer.from(screenshotBuffer)
    } finally {
      if (browser) {
        await browser.close().catch(() => {})
      }
    }

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

    // Direct database persistence with service role credentials to ensure design_b is updated
    const { error: dbUpdateError } = await supabase
      .from("workflows")
      .update({ design_b: publicUrl })
      .eq("id", workflowId)

    if (dbUpdateError) {
      console.warn("[DEBUG API] Notice updating workflow record in DB:", dbUpdateError.message)
    } else {
      console.log("[DEBUG API] Successfully updated workflow design_b in database:", workflowId)
    }

    return NextResponse.json({
      success: true,
      publicUrl,
      width: clipRect.width,
      height: clipRect.height,
    })
  } catch (err: any) {
    console.error("Screenshot capture error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to capture screenshot" },
      { status: 500 }
    )
  }
}
