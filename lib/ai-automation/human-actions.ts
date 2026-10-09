/**
 * Human-paced browser actions for QA automation.
 * Looks like a fast human tester: visible mouse path + keystrokes,
 * without the multi-second delays of a slow demo.
 * Covers login AND full journey navigation (click-through, not silent goto).
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

/** Move real Puppeteer mouse + visual overlay cursor. */
export async function humanMouseMove(page: Page, x: number, y: number): Promise<void> {
  await installVisualOverlay(page).catch(() => {})
  await Promise.all([
    page.mouse.move(x, y, { steps: HUMAN_PACE.mouseSteps }).catch(() => {}),
    animateCursorTo(page, x, y).catch(() => {}),
  ])
  await sleep(HUMAN_PACE.afterMoveMs)
}

/** Move to element center, optional click with ripple. */
export async function humanClick(
  page: Page,
  el: ElementHandle<Element>,
  opts?: { double?: boolean },
): Promise<Point | null> {
  await el
    .evaluate((node) => {
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
    .catch(() => {})
  await sleep(40)

  const pt = await getCenter(el)
  if (pt) {
    await humanMouseMove(page, pt.x, pt.y)
    await triggerClickAnimation(page, pt.x, pt.y).catch(() => {})
    if (opts?.double) {
      await page.mouse.click(pt.x, pt.y, { clickCount: 2 }).catch(() => el.click({ clickCount: 2 }))
    } else {
      await page.mouse.click(pt.x, pt.y).catch(() => el.click())
    }
  } else {
    await el.click().catch(() => {})
  }
  await sleep(HUMAN_PACE.afterClickMs)
  return pt
}

/** Clear field and type with human-paced keystrokes (never instant .fill). */
export async function humanType(
  page: Page,
  el: ElementHandle<Element>,
  text: string,
  opts?: { maskInBanner?: boolean; label?: string },
): Promise<void> {
  await humanClick(page, el, { double: true })
  await page.keyboard.down("Control").catch(() => {})
  await page.keyboard.press("KeyA").catch(() => {})
  await page.keyboard.up("Control").catch(() => {})
  await page.keyboard.press("Backspace").catch(() => {})
  await sleep(30)

  const banner = opts?.maskInBanner
    ? `${opts.label || "Password"}: ${"•".repeat(Math.min(text.length, 10))}`
    : `${opts?.label || "Typing"}: ${text.slice(0, 40)}`
  await showActionBanner(page, banner).catch(() => {})

  try {
    await page.keyboard.type(text, { delay: HUMAN_PACE.typeDelayMs })
  } catch {
    await el.type(text, { delay: HUMAN_PACE.typeDelayMs }).catch(() => {})
  }
  await sleep(HUMAN_PACE.betweenFieldsMs)
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

/** Visible login: mouse + type + Sign In (fast human pace). */
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
    await humanType(page, userInput, creds.username, { label: "Email" })
    await highlightInputTyping(page, USER_SEL, creds.username).catch(() => {})
    await say("Typed username")
    await sleep(HUMAN_PACE.settleMs / 2)

    await say("Move to password field")
    await showActionBanner(page, "Focus password").catch(() => {})
    await humanType(page, passInput, creds.password, { maskInBanner: true, label: "Password" })
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
      await humanClick(page, submitEl)
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

    const landedUrl = page.url()
    await say(`Landed on ${landedUrl}`)
    await showActionBanner(page, "Logged in").catch(() => {})
    return { ok: true, steps, landedUrl }
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || "Visible login failed" }
  }
}

/** Playwright/Stagehand visible login — never uses instant fill(). */
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

    const moveClickType = async (handle: any, text: string, label: string) => {
      await handle.scrollIntoViewIfNeeded?.().catch(() => {})
      const box = await handle.boundingBox?.().catch(() => null)
      if (box && stagePage.mouse?.move) {
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
      await stagePage.keyboard?.type(text, { delay: HUMAN_PACE.typeDelayMs }).catch(async () => {
        await handle.type(text, { delay: HUMAN_PACE.typeDelayMs }).catch(() => {})
      })
      await say(`${label} entered`)
      await sleep(HUMAN_PACE.betweenFieldsMs)
    }

    await say("Move to email / username field")
    await moveClickType(user, creds.username, "Username")
    await say("Move to password field")
    await moveClickType(pass, creds.password, "Password")

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
    const landedUrl = await stagePage.url().catch(() => undefined)
    await say(`Landed on ${landedUrl || "?"}`)
    return { ok: true, steps, landedUrl }
  } catch (err: any) {
    return { ok: false, steps, error: err?.message || "Visible login failed" }
  }
}

// ---------------------------------------------------------------------------
// Whole-journey human navigation (not only login)
// ---------------------------------------------------------------------------

/** Find a visible element by approximate label/text and human-click it. */
export async function humanClickByText(
  page: Page,
  text: string,
  opts?: { selectors?: string },
): Promise<boolean> {
  const sel =
    opts?.selectors ||
    'button, a, [role="button"], input[type="submit"], [onclick], label, summary'
  const handle = await page.evaluateHandle(
    (needle, selectorList) => {
      const n = needle.toLowerCase().trim()
      const nodes = Array.from(document.querySelectorAll(selectorList)) as HTMLElement[]
      const visible = nodes.filter((el) => {
        const r = el.getBoundingClientRect()
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
        if (t === n) return 100
        if (t.includes(n) || n.includes(t.slice(0, 24))) return 80
        return 0
      }
      visible.sort((a, b) => score(b) - score(a))
      return visible.find((el) => score(el) >= 80) || null
    },
    text,
    sel,
  )
  const el = handle.asElement() as ElementHandle<Element> | null
  if (!el) return false
  await humanClick(page, el)
  return true
}

/** Click an in-page link matching href (human mouse). */
export async function humanClickHref(page: Page, href: string): Promise<boolean> {
  const handle = await page.evaluateHandle((targetHref) => {
    let targetPath = targetHref
    try {
      const u = new URL(targetHref, location.href)
      targetPath = u.pathname + u.search
    } catch {}
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
    const match = anchors.find((a) => {
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
  await humanClick(page, el)
  return true
}

/**
 * Navigate like a tester: prefer clicking an on-page control toward the URL.
 * Falls back to page.goto only when no clickable path exists (first load / deep link).
 */
export async function humanNavigateTo(
  page: Page,
  url: string,
  opts?: { forceGoto?: boolean; waitMs?: number },
): Promise<{ method: "click" | "goto"; ok: boolean }> {
  const waitMs = opts?.waitMs ?? 2500
  if (!opts?.forceGoto) {
    const clicked = await humanClickHref(page, url).catch(() => false)
    if (clicked) {
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
        sleep(waitMs),
      ])
      await sleep(HUMAN_PACE.settleMs)
      return { method: "click", ok: true }
    }
    try {
      const path = new URL(url).pathname
      const segment = path.split("/").filter(Boolean).pop() || ""
      const label = segment.replace(/[-_]/g, " ")
      if (label.length >= 2) {
        const byText = await humanClickByText(page, label)
        if (byText) {
          await Promise.race([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
            sleep(waitMs),
          ])
          await sleep(HUMAN_PACE.settleMs)
          return { method: "click", ok: true }
        }
      }
    } catch {}
  }

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
    await sleep(HUMAN_PACE.settleMs)
    return { method: "goto", ok: true }
  } catch {
    return { method: "goto", ok: false }
  }
}
