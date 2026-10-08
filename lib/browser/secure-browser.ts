import puppeteer, { type Browser, type Page } from "puppeteer"
import { assertSafeTargetUrlWithDevBypass } from "@/lib/security/url-guard"

export type BrowserCredentials = {
  username?: string
  password?: string
  cookie?: string
  token?: string
}

export type LaunchOptions = {
  url: string
  width?: number
  height?: number
  credentials?: BrowserCredentials
  accessToken?: string
  refreshToken?: string
  /** Project-level hostname allowlist */
  allowedHosts?: string[]
  /** Prefer isolated temp profile over shared .chrome-profile */
  isolatedProfile?: boolean
}

const SAFE_ARGS = [
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "--disable-extensions",
  "--mute-audio",
  "--no-default-browser-check",
  // Avoid --disable-web-security in production.
  // --no-sandbox only when running inside a locked-down container (set env).
]

function launchArgs(): string[] {
  const args = [...SAFE_ARGS]
  if (process.env.PUPPETEER_NO_SANDBOX === "true") {
    args.push("--no-sandbox", "--disable-setuid-sandbox")
  }
  return args
}

/**
 * Launch a hardened Puppeteer browser for UI testing.
 * Always validates the target URL before navigation.
 */
export async function launchTestBrowser(opts: LaunchOptions): Promise<{
  browser: Browser
  page: Page
  targetUrl: string
}> {
  const targetUrl = assertSafeTargetUrlWithDevBypass(opts.url, opts.allowedHosts)

  const browser = await puppeteer.launch({
    headless: true,
    args: launchArgs(),
  })

  const page = await browser.newPage()
  const width = Math.round(opts.width ?? 1280)
  const height = Math.round(opts.height ?? 800)
  await page.setViewport({ width, height, deviceScaleFactor: 1 })

  if (opts.credentials?.token) {
    await page.evaluateOnNewDocument((token: string) => {
      localStorage.setItem("token", token)
      localStorage.setItem("authToken", token)
      localStorage.setItem("auth_token", token)
      localStorage.setItem("access_token", token)
    }, opts.credentials.token)
  }

  if (opts.accessToken) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    let projectRef = "default"
    try {
      projectRef = new URL(supabaseUrl).hostname.split(".")[0]
    } catch {}

    const storageKey = `sb-${projectRef}-auth-token`
    const sessionData = {
      access_token: opts.accessToken,
      refresh_token: opts.refreshToken || "",
      expires_in: 3600,
      token_type: "bearer",
      user: {
        id: "00000000-0000-0000-0000-000000000000",
        aud: "authenticated",
        role: "authenticated",
      },
    }

    await page.evaluateOnNewDocument(
      (key: string, data: unknown) => {
        const str = JSON.stringify(data)
        localStorage.setItem(key, str)
        localStorage.setItem("supabase.auth.token", str)
      },
      storageKey,
      sessionData
    )

    try {
      const hostname = new URL(targetUrl).hostname
      await page.setCookie(
        {
          name: "sb-access-token",
          value: opts.accessToken,
          domain: hostname,
          path: "/",
        },
        {
          name: "sb-refresh-token",
          value: opts.refreshToken || "",
          domain: hostname,
          path: "/",
        }
      )
    } catch {}
  }

  if (opts.credentials?.cookie) {
    try {
      const hostname = new URL(targetUrl).hostname
      const pairs = opts.credentials.cookie
        .split(";")
        .map((c) => c.trim())
        .filter(Boolean)
      for (const pair of pairs) {
        const eq = pair.indexOf("=")
        if (eq <= 0) continue
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        if (name && value) {
          await page.setCookie({
            name,
            value,
            domain: hostname,
            path: "/",
            expires: Math.floor(Date.now() / 1000) + 86400 * 7,
          })
        }
      }
    } catch {}
  }

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch((e) => {
    console.warn("[secure-browser] navigation notice:", (e as Error)?.message)
  })

  if (opts.credentials?.username && opts.credentials?.password) {
    await tryAutoLogin(page, opts.credentials.username, opts.credentials.password, targetUrl)
  }

  return { browser, page, targetUrl }
}

async function tryAutoLogin(
  page: Page,
  username: string,
  password: string,
  targetUrl: string
) {
  try {
    const hasPassword = (await page.$('input[type="password"]')) !== null
    const url = page.url()
    const looksLikeLogin =
      hasPassword ||
      /\/(login|signin|sign-in|auth)/i.test(url)

    if (!looksLikeLogin) return

    const userInput = await page.$(
      'input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[id*="user" i], input[type="text"]'
    )
    const passInput = await page.$(
      'input[type="password"], input[name*="pass" i], input[id*="pass" i]'
    )
    if (!userInput || !passInput) return

    await userInput.click({ count: 3 }).catch(() => {})
    await userInput.type(username, { delay: 10 })
    await passInput.click({ count: 3 }).catch(() => {})
    await passInput.type(password, { delay: 10 })

    const submit = await page.$('button[type="submit"], input[type="submit"], form button')
    if (submit) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
        submit.click(),
      ])
    } else {
      await page.keyboard.press("Enter")
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
    }

    try {
      const targetPath = new URL(targetUrl).pathname
      if (targetPath && targetPath !== "/" && !page.url().includes(targetPath)) {
        await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
      }
    } catch {}
  } catch (err) {
    console.warn("[secure-browser] auto-login notice:", err)
  }
}

/** Strip secrets before persisting or returning a job object */
export function sanitizeJobForClient<T extends Record<string, unknown>>(job: T): T {
  const clone = { ...job } as Record<string, unknown>
  delete clone.credentials
  delete clone.pendingCredentials
  delete clone.openRouterApiKey
  delete clone.accessToken
  delete clone.refreshToken
  if (clone.config && typeof clone.config === "object") {
    const cfg = { ...(clone.config as Record<string, unknown>) }
    delete cfg.credentials
    delete cfg.accessToken
    delete cfg.refreshToken
    delete cfg.cookies
    clone.config = cfg
  }
  return clone as T
}
