/**
 * Human-paced browser actions for QA automation.
 * Looks like a fast human tester: visible mouse path + keystrokes.
 * Failures return false / ok:false instead of looking like success.
 */

import type { ElementHandle, Page } from "puppeteer"
import {
  animateCursorTo,
  highlightInputTyping,
  installVisualOverlay,
  showActionBanner,
  triggerClickAnimation,
} from "./visual-recorder"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fast-human defaults: readable on video, not sluggish. */
export const HUMAN_PACE = {
  mouseSteps: 8,
  afterMoveMs: 45,
  typeDelayMs: 32,
  betweenFieldsMs: 90,
  afterClickMs: 70,
  settleMs: 400,
} as const

export type Point = { x: number; y: number }

/** Compare origin + path + search (ignore hash); trailing slashes treated equal. */
export function sameUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    const strip = (p: string) => p.replace(/\/+$/, "") || "/"
    return (
      strip(ua.origin + ua.pathname) + ua.search ===
      strip(ub.origin + ub.pathname) + ub.search
    )
  } catch {
    return a === b
  }
}

export async function getCenter(el: ElementHandle<Element>): Promise<Point | null> {
  try {
    const box = await el.boundingBox()
    if (!box || box.width < 1 || box.height < 1) return null
    return {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }
  } catch {
    return null
  }
}

async function isVisibleHandle(el: ElementHandle<Element>): Promise<boolean> {
  try {
    return await el.evaluate((node) => {
      const r = (node as HTMLElement).getBoundingClientRect()
      const style = window.getComputedStyle(node as Element)
      if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false
      return r.width > 2 && r.height > 2
    })
  } catch {
    return false
  }
}

export async function humanMouseMove(page: Page, x: number, y: number): Promise<void> {
  await installVisualOverlay(page).catch(() => {})
  try {
    await page.mouse.move(x, y, { steps: HUMAN_PACE.mouseSteps })
  } catch (err) {
    console.warn("[human-actions] mouse.move failed:", (err as Error)?.message)
  }
  await animateCursorTo(page, x, y).catch(() => {})
  await sleep(HUMAN_PACE.afterMoveMs)
}

export async function humanClick(
  page: Page,
  el: ElementHandle<Element>,
  opts?: { double?: boolean },
): Promise<Point | null> {
  try {
    await el.evaluate((node) => {
      try {
        ;(node as HTMLElement).scrollIntoView({
          block: "center",
          inline: "center",
          behavior: "instant" as ScrollBehavior,
        })
      } catch {
        /* ignore */
      }
    })
  } catch (err) {
    console.warn("[human-actions] scrollIntoView failed:", (err as Error)?.message)
    return null
  }
  await sleep(40)

  if (!(await isVisibleHandle(el))) {
    console.warn("[human-actions] humanClick skipped — element not visible")
    return null
  }

  const pt = await getCenter(el)
  if (!pt) {
    console.warn("[human-actions] humanClick skipped — no bounding box (refusing silent el.click)")
    return null
  }

  await humanMouseMove(page, pt.x, pt.y)
  await triggerClickAnimation(page, pt.x, pt.y).catch(() => {})

  try {
    if (opts?.double) {
      await page.mouse.click(pt.x, pt.y)
      await sleep(100)
      await page.mouse.click(pt.x, pt.y)
    } else {
      await page.mouse.click(pt.x, pt.y)
    }
  } catch (err) {
    console.warn("[human-actions] mouse.click failed:", (err as Error)?.message)
    return null
  }

  await sleep(HUMAN_PACE.afterClickMs)
  return pt
}

export async function humanType(
  page: Page,
  el: ElementHandle<Element>,
  text: string,
  opts?: { maskInBanner?: boolean; label?: string },
): Promise<boolean> {
  const pt = await humanClick(page, el, { double: true })
  if (!pt) {
    console.warn("[human-actions] humanType aborted — could not focus field")
    return false
  }

  try {
    await page.keyboard.down("Control")
    await page.keyboard.press("KeyA")
    await page.keyboard.up("Control")
    await page.keyboard.press("Backspace")
  } catch {
    /* best effort clear */
  }
  await sleep(30)

  const banner = opts?.maskInBanner
    ? `${opts.label || "Password"}: ${"•".repeat(Math.min(text.length, 10))}`
    : `${opts?.label || "Typing"}: ${text.slice(0, 40)}`
  await showActionBanner(page, banner).catch(() => {})

  try {
    await page.keyboard.type(text, { delay: HUMAN_PACE.typeDelayMs })
  } catch {
    try {
      await el.type(text, { delay: HUMAN_PACE.typeDelayMs })
    } catch (err) {
      console.warn("[human-actions] humanType failed:", (err as Error)?.message)
      return false
    }
  }
  await sleep(HUMAN_PACE.betweenFieldsMs)
  return true
}

export type VisibleLoginResult = {
  ok: boolean
  steps: string[]
  landedUrl?: string
  error?: string
}

const USER_SEL =
  'input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[id*="user" i], input[autocomplete="username"], input[type="text"]'
const PASS_SEL = 'input[type="password"], input[name*="pass" i], input[id*="pass" i]'

export async function performVisibleLogin(
  page: Page,
  creds: { username: string; password: string },
  opts?: {
    onStep?: (message: string) => void | Promise<void>
    maskPasswords?: () => Promise<void>
  },
): Promise<VisibleLoginResult> {
  const steps: string[] = []
  const say = async (m: string) => {
    steps.push(m)
    await opts?.onStep?.(m)
  }

  try {
    await installVisualOverlay(page).catch(() => {})

    const hasPw = await page.$(PASS_SEL)
    if (!hasPw) return { ok: false, steps, error: "No password field on page" }

    const userInput = await page.$(USER_SEL)
    const passInput = await page.$(PASS_SEL)
    if (!userInput || !passInput) return { ok: false, steps, error: "Login form fields not found" }

    await say("Move to email / username field")
    await showActionBanner(page, "Focus email / username").catch(() => {})
    const typedUser = await humanType(page, userInput, creds.username, { label: "Email" })
    if (!typedUser) return { ok: false, steps, error: "Failed to type username" }
    await highlightInputTyping(page, USER_SEL, creds.username).catch(() => {})
    await say("Typed username")
    await sleep(HUMAN_PACE.settleMs / 2)

    await say("Move to password field")
    await showActionBanner(page, "Focus password").catch(() => {})
    const typedPass = await humanType(page, passInput, creds.password, {
      maskInBanner: true,
      label: "Password",
    })
    if (!typedPass) return { ok: false, steps, error: "Failed to type password" }
    await say("Typed password")
    await opts?.maskPasswords?.().catch(() => {})
    await sleep(HUMAN_PACE.settleMs / 2)

    const submitHandle = await page.evaluateHandle(() => {
      const btns = Array.from(
        document.querySelectorAll('button, input[type="submit"], [role="button"]'),
      ) as HTMLElement[]
      const match = btns.find((b) => {
        const t = (b.textContent || (b as HTMLInputElement).value || "").toLowerCase()
        const type = (b as HTMLInputElement).type
        return type === "submit" || /(sign\s*in|log\s*in|login|continue|submit)/i.test(t)
      })
      if (match) {
        match.setAttribute("data-human-login-submit", "true")
        return match
      }
      return null
    })

    const submitEl = submitHandle.asElement() as ElementHandle<Element> | null
    if (submitEl) {
      await say("Move to Sign In and click")
      await showActionBanner(page, "Click Sign In").catch(() => {})
      const clicked = await humanClick(page, submitEl)
      if (!clicked) {
        console.warn("[human-actions] Sign In click missed — trying Enter")
        await page.keyboard.press("Enter").catch(() => {})
      }
    } else {
      await say("Press Enter to submit")
      await showActionBanner(page, "Submit (Enter)").catch(() => {})
      await page.keyboard.press("Enter")
    }

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
      sleep(2200),
    ])
    await sleep(HUMAN_PACE.settleMs)

    const stillOnLogin = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
          const r = (el as HTMLInputElement).getBoundingClientRect()
          const style = window.getComputedStyle(el)
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false
          return r.width > 2 && r.height > 2
        }),
      )
      .catch(() => true)
    if (stillOnLogin) {
      const err = "Still on login page after submit — login likely failed"
      await say(err)
      return { ok: false, steps, error: err, landedUrl: page.url() }
    }

    const landedUrl = page.url()
    await say(`Landed on ${landedUrl}`)
    await showActionBanner(page, "Logged in").catch(() => {})
    return { ok: true, steps, landedUrl }
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || "Visible login failed" }
  }
}

export async function performVisibleLoginPlaywright(
  stagePage: any,
  creds: { username: string; password: string },
  opts?: { onStep?: (message: string) => void | Promise<void> },
): Promise<VisibleLoginResult> {
  const steps: string[] = []
  const say = async (m: string) => {
    steps.push(m)
    await opts?.onStep?.(m)
  }

  try {
    const pass = await stagePage.$(PASS_SEL).catch(() => null)
    if (!pass) return { ok: false, steps, error: "No password field" }
    const user = await stagePage.$(USER_SEL).catch(() => null)
    if (!user) return { ok: false, steps, error: "No username field" }

    const moveClickType = async (handle: any, text: string, label: string): Promise<boolean> => {
      await handle.scrollIntoViewIfNeeded?.().catch(() => {})
      const box = await handle.boundingBox?.().catch(() => null)
      if (!box || box.width < 2 || box.height < 2) {
        console.warn(`[human-actions] ${label} field not visible`)
        return false
      }
      if (stagePage.mouse?.move) {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await stagePage.mouse.move(x, y, { steps: HUMAN_PACE.mouseSteps }).catch(() => {})
        await sleep(HUMAN_PACE.afterMoveMs)
        await stagePage.mouse.click(x, y).catch(() => handle.click().catch(() => {}))
      } else {
        await handle.click().catch(() => {})
      }
      await sleep(HUMAN_PACE.afterClickMs)
      await handle.click({ clickCount: 3 }).catch(() => {})
      try {
        await stagePage.keyboard?.type(text, { delay: HUMAN_PACE.typeDelayMs })
      } catch {
        await handle.type(text, { delay: HUMAN_PACE.typeDelayMs }).catch(() => {})
      }
      await say(`${label} entered`)
      await sleep(HUMAN_PACE.betweenFieldsMs)
      return true
    }

    await say("Move to email / username field")
    if (!(await moveClickType(user, creds.username, "Username"))) {
      return { ok: false, steps, error: "Failed to type username" }
    }
    await say("Move to password field")
    if (!(await moveClickType(pass, creds.password, "Password"))) {
      return { ok: false, steps, error: "Failed to type password" }
    }

    const submit =
      (await stagePage.$('button[type="submit"], input[type="submit"]').catch(() => null)) ||
      (await stagePage
        .$('button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")')
        .catch(() => null))

    if (submit) {
      await say("Move to Sign In and click")
      const box = await submit.boundingBox?.().catch(() => null)
      if (box && stagePage.mouse?.move) {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        await stagePage.mouse.move(x, y, { steps: HUMAN_PACE.mouseSteps }).catch(() => {})
        await sleep(HUMAN_PACE.afterMoveMs)
        await stagePage.mouse.click(x, y).catch(() => submit.click())
      } else {
        await submit.click().catch(() => {})
      }
    } else {
      await say("Press Enter to submit")
      await stagePage.keyboard?.press("Enter").catch(() => {})
    }

    await sleep(2200)

    const stillOnLogin = await stagePage
      .evaluate(() =>
        Array.from(document.querySelectorAll('input[type="password"]')).some((el: any) => {
          const r = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false
          return r.width > 2 && r.height > 2
        }),
      )
      .catch(() => true)
    if (stillOnLogin) {
      const err = "Still on login page after submit — login likely failed"
      await say(err)
      return {
        ok: false,
        steps,
        error: err,
        landedUrl: await stagePage.url().catch(() => undefined),
      }
    }

    const landedUrl = await stagePage.url().catch(() => undefined)
    await say(`Landed on ${landedUrl || "?"}`)
    return { ok: true, steps, landedUrl }
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || "Visible login failed" }
  }
}

export async function humanClickByText(
  page: Page,
  text: string,
  opts?: { selectors?: string },
): Promise<boolean> {
  const n = (text || "").toLowerCase().trim()
  if (n.length < 3) {
    console.warn("[human-actions] humanClickByText skipped — label too short:", text)
    return false
  }

  const sel =
    opts?.selectors ||
    'button, a, [role="button"], input[type="submit"], [onclick], label, summary'

  const handle = await page.evaluateHandle(
    (needle, selectorList) => {
      const nodes = Array.from(document.querySelectorAll(selectorList)) as HTMLElement[]
      const vh = window.innerHeight || 800
      const visible = nodes.filter((el) => {
        const r = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        if (style.visibility === "hidden" || style.display === "none") return false
        return r.width > 2 && r.height > 2 && !!(el.offsetParent || el.getClientRects().length)
      })

      const score = (el: HTMLElement) => {
        const t = (
          el.textContent ||
          (el as HTMLInputElement).value ||
          el.getAttribute("aria-label") ||
          ""
        )
          .toLowerCase()
          .trim()
        if (!t) return 0
        if (t === needle) return 100
        if (t.includes(needle)) return 80
        return 0
      }

      const ranked = visible
        .map((el) => {
          const r = el.getBoundingClientRect()
          const inTop = r.top >= 0 && r.top < vh * 0.6 ? 1 : 0
          return { el, s: score(el), inTop }
        })
        .filter((x) => x.s >= 80)
        .sort((a, b) => b.s - a.s || b.inTop - a.inTop)

      return ranked[0]?.el || null
    },
    n,
    sel,
  )

  const el = handle.asElement() as ElementHandle<Element> | null
  if (!el) return false
  const clicked = await humanClick(page, el)
  if (!clicked) {
    console.warn("[human-actions] humanClickByText click failed for:", text)
    return false
  }
  return true
}

export async function humanClickHref(page: Page, href: string): Promise<boolean> {
  const handle = await page.evaluateHandle((targetHref) => {
    let targetPath = targetHref
    try {
      const u = new URL(targetHref, location.href)
      targetPath = u.pathname + u.search
    } catch {}
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
    const visible = anchors.filter((a) => {
      const r = a.getBoundingClientRect()
      const style = window.getComputedStyle(a)
      if (style.visibility === "hidden" || style.display === "none") return false
      return r.width > 2 && r.height > 2 && !!(a.offsetParent || a.getClientRects().length)
    })
    const match = visible.find((a) => {
      try {
        const abs = new URL(a.href, location.href)
        const p = abs.pathname + abs.search
        return abs.href === targetHref || p === targetPath || a.getAttribute("href") === targetHref
      } catch {
        return false
      }
    })
    return match || null
  }, href)

  const el = handle.asElement() as ElementHandle<Element> | null
  if (!el) return false
  const clicked = await humanClick(page, el)
  if (!clicked) {
    console.warn("[human-actions] humanClickHref refused invisible/missed link:", href)
    return false
  }
  return true
}

export async function humanNavigateTo(
  page: Page,
  url: string,
  opts?: { forceGoto?: boolean; waitMs?: number },
): Promise<{ method: "click" | "goto"; ok: boolean }> {
  const waitMs = opts?.waitMs ?? 2500

  const tryClickPath = async (): Promise<boolean> => {
    const clicked = await humanClickHref(page, url)
    if (clicked) {
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
        sleep(waitMs),
      ])
      await sleep(HUMAN_PACE.settleMs)
      if (sameUrl(page.url(), url)) return true
      console.warn(
        `[human-actions] click href did not land on target (now ${page.url()}, wanted ${url})`,
      )
      return false
    }

    try {
      const path = new URL(url).pathname
      const segment = path.split("/").filter(Boolean).pop() || ""
      const label = segment.replace(/[-_]/g, " ")
      if (label.length >= 3) {
        const byText = await humanClickByText(page, label)
        if (byText) {
          await Promise.race([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
            sleep(waitMs),
          ])
          await sleep(HUMAN_PACE.settleMs)
          if (sameUrl(page.url(), url)) return true
          console.warn(
            `[human-actions] click-by-text did not land on target (now ${page.url()}, wanted ${url})`,
          )
        }
      }
    } catch {}
    return false
  }

  if (!opts?.forceGoto) {
    const okClick = await tryClickPath()
    if (okClick) return { method: "click", ok: true }
  }

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
    await sleep(HUMAN_PACE.settleMs)
    return { method: "goto", ok: true }
  } catch (err) {
    console.warn("[human-actions] goto failed:", (err as Error)?.message, url)
    return { method: "goto", ok: false }
  }
}
