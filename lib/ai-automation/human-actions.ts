/**
 * Human-paced browser actions for QA automation.
 * Looks like a fast human tester: visible mouse path + keystrokes,
 * without the multi-second delays of a slow demo.
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
  await el.evaluate((node) => {
    try {
      ;(node as HTMLElement).scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior })
    } catch {
      /* ignore */
    }
  }).catch(() => {})
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
  const pt = await humanClick(page, el, { double: true })
  // Select-all + clear for controlled inputs
  await page.keyboard.down("Control").catch(() => {})
  await page.keyboard.press("KeyA").catch(() => {})
  await page.keyboard.up("Control").catch(() => {})
  await page.keyboard.press("Backspace").catch(() => {})
  await sleep(30)

  const banner = opts?.maskInBanner
    ? `${opts.label || "Password"}: ${"•".repeat(Math.min(text.length, 10))}`
    : `${opts?.label || "Typing"}: ${text.slice(0, 40)}`
  await showActionBanner(page, banner).catch(() => {})

  // Prefer keyboard.type so key events fire; fallback to element.type
  try {
    await page.keyboard.type(text, { delay: HUMAN_PACE.typeDelayMs })
  } catch {
    await el.type(text, { delay: HUMAN_PACE.typeDelayMs }).catch(() => {})
  }
  await sleep(HUMAN_PACE.betweenFieldsMs)
  if (pt) {
    /* keep cursor near field for screenshot readability */
  }
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

/**
 * Perform login the way a fast human QA tester would:
 * mouse to email → type → mouse to password → type → mouse to Sign In → click.
 * Visible on screenshots/video; paced for speed, not a silent credential dump.
 */
export async function performVisibleLogin(
  page: Page,
  creds: { username: string; password: string },
  opts?: {
    onStep?: (message: string) => void | Promise<void>
    /** Optional: mark password fields sensitive before screenshots */
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
    if (!hasPw) {
      return { ok: false, steps, error: "No password field on page" }
    }

    const userInput = await page.$(USER_SEL)
    const passInput = await page.$(PASS_SEL)
    if (!userInput || !passInput) {
      return { ok: false, steps, error: "Login form fields not found" }
    }

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

    // Prefer explicit submit control
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

/**
 * Playwright-compatible visible login (Stagehand active page).
 * Uses locator/mouse APIs when present; never uses instant fill().
 */
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
      // Triple-click select then type — no fill()
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
      (await stagePage.$('button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').catch(() => null))

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
