import { NextRequest, NextResponse } from "next/server"
import puppeteer from "puppeteer"
import {
  humanClick,
  humanType,
  HUMAN_PACE,
} from "@/lib/ai-automation/human-actions"
import {
  installVisualOverlay,
  showActionBanner,
} from "@/lib/ai-automation/visual-recorder"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

declare global {
  // eslint-disable-next-line no-var
  var __DUMMY_TEST_FRAME__: {
    screenshot?: string
    banner?: string
    status: "idle" | "running" | "completed" | "failed"
    steps: string[]
  } | undefined
}

export async function GET() {
  return NextResponse.json(globalThis.__DUMMY_TEST_FRAME__ || { status: "idle", steps: [] })
}

export async function POST(req: NextRequest) {
  let browser: any = null
  let frameInterval: any = null
  const steps: string[] = []

  globalThis.__DUMMY_TEST_FRAME__ = {
    status: "running",
    banner: "Starting Live Browser Session...",
    steps: ["Launching browser..."],
  }

  try {
    const body = await req.json().catch(() => ({}))
    const targetUrl = body.targetUrl || "http://localhost:8081"
    const username = body.username || "nareshbabu.nuli@gmail.com"
    const password = body.password || "TestPass123!"

    steps.push(`Target URL: ${targetUrl}`)
    steps.push(`Credentials: ${username} / ••••••••`)

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })

    // Continuous Live Stream frame capture (~5 fps)
    let isCapturing = false
    frameInterval = setInterval(async () => {
      if (isCapturing || !page || page.isClosed()) return
      isCapturing = true
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 40 })
        const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`
        if (globalThis.__DUMMY_TEST_FRAME__) {
          globalThis.__DUMMY_TEST_FRAME__.screenshot = dataUrl
        }
      } catch {}
      finally {
        isCapturing = false
      }
    }, 180)

    steps.push("Navigating to application...")
    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.banner = "Navigating to Login Page..."
    }
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
    await installVisualOverlay(page).catch(() => {})

    // Wait for splash screen to dismiss (Expo app 3s splash)
    await sleep(3000)
    await installVisualOverlay(page).catch(() => {})

    // 1. Locate Email field
    steps.push("Focusing email field...")
    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.banner = "Focusing Email Field..."
    }
    await showActionBanner(page, "Focus Email: " + username).catch(() => {})

    const emailSelector = 'input[type="email"], input[placeholder*="email" i], input[name*="email" i]'
    await page.waitForSelector(emailSelector, { timeout: 6000 }).catch(() => null)
    const emailEl = await page.$(emailSelector)

    if (emailEl) {
      steps.push("Typing email: " + username)
      if (globalThis.__DUMMY_TEST_FRAME__) {
        globalThis.__DUMMY_TEST_FRAME__.banner = "Typing Email: " + username
      }
      const typed = await humanType(page, emailEl, username, { label: "Email" })
      steps.push(typed ? "Typed email successfully" : "Failed to type email")
      await sleep(HUMAN_PACE.settleMs / 2)
    } else {
      steps.push("Email field not found directly")
    }

    // 2. Locate Password field
    steps.push("Focusing password field...")
    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.banner = "Focusing Password Field..."
    }
    await showActionBanner(page, "Focus Password").catch(() => {})

    const passSelector = 'input[type="password"], input[placeholder*="password" i]'
    await page.waitForSelector(passSelector, { timeout: 4000 }).catch(() => null)
    const passEl = await page.$(passSelector)

    if (passEl) {
      steps.push("Typing password")
      if (globalThis.__DUMMY_TEST_FRAME__) {
        globalThis.__DUMMY_TEST_FRAME__.banner = "Typing Password: ••••••••••••"
      }
      const typed = await humanType(page, passEl, password, {
        maskInBanner: true,
        label: "Password",
      })
      steps.push(typed ? "Typed password successfully" : "Failed to type password")
      await sleep(HUMAN_PACE.settleMs / 2)
    }

    // 3. Locate and click SIGN IN button
    steps.push("Locating SIGN IN button...")
    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.banner = "Clicking SIGN IN..."
    }
    await showActionBanner(page, "Click SIGN IN").catch(() => {})

    const submitHandle = await page.evaluateHandle(() => {
      const candidates = Array.from(
        document.querySelectorAll('button, [role="button"], div, input[type="submit"]')
      ) as HTMLElement[]
      return (
        candidates.find((el) => {
          const txt = (el.innerText || el.textContent || "").trim().toLowerCase()
          return txt === "sign in" || txt === "login" || txt === "log in"
        }) || null
      )
    })

    const submitEl = submitHandle.asElement()
    if (submitEl) {
      steps.push("Clicking SIGN IN button...")
      const clicked = await humanClick(page, submitEl as any, { label: "SIGN IN" })
      steps.push(clicked ? "Clicked SIGN IN button" : "Failed to click SIGN IN")
    } else {
      steps.push("SIGN IN button not found; pressing Enter")
      await page.keyboard.press("Enter")
    }

    // Allow page response / redirect to render
    await sleep(3500)

    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.banner = "✓ SIGN IN Operation Completed!"
      globalThis.__DUMMY_TEST_FRAME__.status = "completed"
      globalThis.__DUMMY_TEST_FRAME__.steps = steps
    }

    const finalBuf = await page.screenshot({ type: "jpeg", quality: 60 })
    const finalScreenshot = `data:image/jpeg;base64,${finalBuf.toString("base64")}`

    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.screenshot = finalScreenshot
    }

    return NextResponse.json({
      success: true,
      message: "Form filling and sign in completed successfully",
      steps,
      screenshot: finalScreenshot,
    })
  } catch (err: any) {
    if (globalThis.__DUMMY_TEST_FRAME__) {
      globalThis.__DUMMY_TEST_FRAME__.status = "failed"
      globalThis.__DUMMY_TEST_FRAME__.banner = "Dummy test error: " + err?.message
    }
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Dummy test failed",
        steps,
      },
      { status: 500 }
    )
  } finally {
    if (frameInterval) clearInterval(frameInterval)
    if (browser) {
      await sleep(1500)
      await browser.close().catch(() => {})
    }
  }
}
