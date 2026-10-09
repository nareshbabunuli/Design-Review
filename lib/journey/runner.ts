/**
 * Journey Runner - visits pages, screenshots each one, uses Laya for fast decisions.
 * Navigation prefers human mouse click-through; first load uses goto.
 * Failed navigations are skipped; steps always store the actual browser URL.
 */

import puppeteer, { type Browser, type Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import fs from "fs"
import { classifyPage, pickNextLink, DEFAULT_LAYA_URL } from "./laya-client"
import type { JourneyConfig, JourneyStep, PageType } from "./types"
import { performVisibleLogin, humanNavigateTo } from "@/lib/ai-automation/human-actions"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  return createClient(url, key)
}

async function applyAuth(page: Page, config: JourneyConfig, hostname: string) {
  const combinedCookies = [config.cookies, config.credentials?.cookie].filter(Boolean).join("; ")
  if (combinedCookies) {
    for (const pair of combinedCookies.split(";").map((c) => c.trim()).filter(Boolean)) {
      const [name, value] = pair.split("=").map((s) => s.trim())
      if (name && value) {
        try {
          await page.setCookie({
            name,
            value,
            domain: hostname,
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 86400 * 7,
          })
        } catch {}
      }
    }
  }

  if (config.credentials?.token) {
    await page.evaluateOnNewDocument((token: string) => {
      localStorage.setItem("token", token)
      localStorage.setItem("authToken", token)
      localStorage.setItem("auth_token", token)
      localStorage.setItem("access_token", token)
    }, config.credentials.token)
  }

  if (config.accessToken && config.refreshToken) {
    await page.setCookie(
      { name: "sb-access-token", value: config.accessToken, domain: hostname, path: "/" },
      { name: "sb-refresh-token", value: config.refreshToken, domain: hostname, path: "/" }
    )
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    let projectRef = "default"
    try {
      projectRef = new URL(supabaseUrl).hostname.split(".")[0]
    } catch {}
    const storageKey = `sb-${projectRef}-auth-token`
    const sessionData = {
      access_token: config.accessToken,
      refresh_token: config.refreshToken,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated" },
    }
    await page.evaluateOnNewDocument(
      (key: string, data: any) => {
        const sessionStr = JSON.stringify(data)
        localStorage.setItem(key, sessionStr)
        localStorage.setItem("supabase.auth.token", sessionStr)
      },
      storageKey,
      sessionData
    )
  }
}

async function maybeAutoLogin(page: Page, config: JourneyConfig, targetUrl: string) {
  const currentUrl = page.url()
  const hasPassword = (await page.$('input[type="password"]')) !== null
  const isLogin =
    currentUrl.includes("/login") ||
    currentUrl.includes("/signin") ||
    currentUrl.includes("/auth") ||
    hasPassword

  if (!isLogin || !config.credentials?.username || !config.credentials?.password) return

  try {
    const result = await performVisibleLogin(page, {
      username: config.credentials.username,
      password: config.credentials.password,
    })
    if (!result.ok) {
      console.warn("[journey] visible auto-login incomplete:", result.error)
    }

    try {
      const targetPath = new URL(targetUrl).pathname
      if (targetPath && targetPath !== "/" && !page.url().includes(targetPath)) {
        await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
      }
    } catch {}
  } catch (e) {
    console.warn("[journey] auto-login notice:", e)
  }
}

async function waitForStable(page: Page) {
  try {
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root") || document.getElementById("__next") || document.body
        const text = (root?.innerText || "").trim().toLowerCase()
        const isOnlyLoading = text.startsWith("loading") && text.length < 50
        return (root?.children?.length ?? 0) > 0 && !isOnlyLoading
      },
      { timeout: 8000 }
    )
  } catch {}
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready.catch(() => {})
  })
  await new Promise((r) => setTimeout(r, 800))
}

async function uploadScreenshot(
  buffer: Buffer,
  journeyId: string,
  stepIndex: number
): Promise<string> {
  const supabase = getSupabase()
  const fileName = `step-${String(stepIndex).padStart(3, "0")}-${Date.now()}.png`
  const filePath = `journeys/${journeyId}/${fileName}`

  const { error } = await supabase.storage.from("designs").upload(filePath, buffer, {
    upsert: true,
    contentType: "image/png",
  })
  if (error) throw new Error(`Upload failed: ${error.message}`)

  const { data } = supabase.storage.from("designs").getPublicUrl(filePath)
  return data.publicUrl
}

async function collectInternalLinks(page: Page, origin: string): Promise<{ label: string; href: string }[]> {
  const links = await page.evaluate((originUrl: string) => {
    const out: { label: string; href: string }[] = []
    const seen = new Set<string>()
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const el = a as HTMLAnchorElement
      try {
        const abs = new URL(el.href, originUrl)
        if (abs.origin !== new URL(originUrl).origin) continue
        if (abs.hash && abs.pathname === new URL(originUrl).pathname) continue
        const href = abs.origin + abs.pathname + abs.search
        if (seen.has(href)) continue
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase()
        if (/log\s?out|sign\s?out|sign\s?off/.test(text)) continue
        seen.add(href)
        out.push({ label: (el.innerText || el.getAttribute("aria-label") || href).trim().slice(0, 80), href })
      } catch {}
    }
    return out.slice(0, 20)
  }, origin)
  return links
}

export interface RunJourneyOptions {
  journeyId: string
  config: JourneyConfig
  onStep?: (step: JourneyStep, index: number) => void | Promise<void>
}

export async function runJourney(opts: RunJourneyOptions): Promise<JourneyStep[]> {
  const { journeyId, config, onStep } = opts
  const maxSteps = Math.min(Math.max(config.maxSteps ?? 10, 1), 30)
  const width = Math.round(config.width ?? 1280)
  const height = Math.round(config.height ?? 800)
  const layaUrl = config.layaBaseUrl || DEFAULT_LAYA_URL

  const profileDir = path.join(process.cwd(), ".chrome-profile")
  if (!fs.existsSync(profileDir)) {
    try {
      fs.mkdirSync(profileDir, { recursive: true })
    } catch {}
  }

  let browser: Browser | null = null
  const steps: JourneyStep[] = []
  const visited = new Set<string>()

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
    await page.setViewport({ width, height, deviceScaleFactor: 2 })

    const queue: string[] = []
    if (config.urls && config.urls.length > 0) {
      queue.push(...config.urls.slice(0, maxSteps))
    } else {
      queue.push(config.startUrl)
    }

    let isFirstStep = true
    while (queue.length > 0 && steps.length < maxSteps) {
      const url = queue.shift()!
      const normalized = url.split("#")[0]
      if (visited.has(normalized)) continue
      visited.add(normalized)

      let hostname = "localhost"
      try {
        hostname = new URL(url).hostname
      } catch {
        continue
      }

      await applyAuth(page, config, hostname)

      console.log(`[journey] navigating ${steps.length + 1}/${maxSteps}:`, url)
      const nav = await humanNavigateTo(page, url, { forceGoto: isFirstStep })
      console.log(`[journey] nav method=${nav.method} ok=${nav.ok}`)
      isFirstStep = false

      if (!nav.ok) {
        console.warn(`[journey] navigation failed for ${url}, skipping step`)
        continue
      }

      await maybeAutoLogin(page, config, url)
      await waitForStable(page)

      const finalUrl = page.url()
      const title = await page.title().catch(() => "")
      const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "")

      const classification = await classifyPage(pageText, finalUrl, layaUrl)

      const screenshotBuffer = Buffer.from(
        await page.screenshot({ type: "png", fullPage: false })
      )
      const screenshotUrl = await uploadScreenshot(screenshotBuffer, journeyId, steps.length)

      const step: JourneyStep = {
        index: steps.length,
        url: finalUrl,
        title: title || finalUrl,
        screenshotUrl,
        pageType: classification.pageType as PageType,
        hasBlockingIssue: classification.hasBlockingIssue,
        severity: classification.hasBlockingIssue ? "High" : undefined,
        viewport: { width, height },
        capturedAt: new Date().toISOString(),
      }
      steps.push(step)
      if (onStep) await onStep(step, steps.length - 1)

      if ((!config.urls || config.urls.length === 0) && steps.length < maxSteps) {
        const candidates = await collectInternalLinks(page, finalUrl)
        const filtered = candidates.filter((c) => !visited.has(c.href.split("#")[0]))
        if (filtered.length > 0) {
          const next = await pickNextLink(filtered, config.role, layaUrl)
          if (next && !visited.has(next.split("#")[0]) && !queue.includes(next)) {
            queue.push(next)
          }
        }
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  return steps
}
