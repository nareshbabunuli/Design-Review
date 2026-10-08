import type { Page, ElementHandle, HTTPRequest, HTTPResponse } from "puppeteer"
import type {
  ObservedEffect,
  AutomationVerdict,
  StepEvidence,
  NetworkCallEvidence,
} from "./types"

/** Built-in analytics / telemetry / tracking host regexes to filter out */
const DEFAULT_NOISE_HOSTS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)segment\.(com|io)$/i,
  /(^|\.)hotjar\.com$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)intercom\.io$/i,
  /(^|\.)posthog\.com$/i,
  /(^|\.)mixpanel\.com$/i,
  /(^|\.)datadoghq\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)facebook\.net$/i,
]

const NOISE_PATH_PATTERNS = [
  /\/ping(\/|$|\?)/i,
  /\/health(\/|$|\?)/i,
  /\/heartbeat(\/|$|\?)/i,
  /\/telemetry(\/|$|\?)/i,
  /\/analytics(\/|$|\?)/i,
  /\/favicon\.ico$/i,
]

export type ElementSemantics = {
  type?: string
  tagName?: string
  href?: string
  isSubmit?: boolean
  role?: string
  name?: string
  ariaHasPopup?: boolean
}

/**
 * Derives expected observable effects strictly from element semantics.
 */
export function expectFor(el: ElementSemantics): ObservedEffect[] {
  const tag = (el.tagName || "").toLowerCase()
  const role = (el.role || "").toLowerCase()
  const type = (el.type || "").toLowerCase()
  const href = el.href || ""

  // Anchor with non-hash navigation
  if (tag === "a" || role === "link") {
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      return ["navigated"]
    }
    return ["content_changed", "modal_opened"]
  }

  // Submit buttons
  if (el.isSubmit || type === "submit" || /submit|save|create|register|login|sign in|send/i.test(el.name || "")) {
    return ["navigated", "content_changed", "network_only", "error_shown"]
  }

  // Modals & Menu triggers
  if (el.ariaHasPopup || role === "menuitem" || role === "tab" || /modal|dialog|open|filter|dropdown/i.test(el.name || "")) {
    return ["modal_opened", "content_changed"]
  }

  // Media / Video cards
  if (tag === "video" || tag === "audio" || /video|player|watch|listen|play/i.test(el.name || "")) {
    return ["media_started", "navigated", "modal_opened"]
  }

  // Checkbox / Toggles / Selects
  if (type === "checkbox" || type === "radio" || role === "switch" || tag === "select" || role === "combobox") {
    return ["value_changed", "content_changed"]
  }

  // Generic button / clickable
  return ["content_changed", "navigated", "modal_opened", "network_only"]
}

export type PageSnapshot = {
  url: string
  title: string
  hasModal: boolean
  modalText: string
  elementCount: number
  headingText: string
  mediaPlaying: boolean
  normalizedHash: string
  hasErrorAlert: boolean
}

/**
 * Normalises visible text by stripping numbers, dates, times, relative timestamps,
 * and countdowns, ignoring volatile elements (timers, live-regions, tickers).
 */
export function normalizeVisibleText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, "") // Times
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, "") // Dates
    .replace(/\b\d+\s*(s|sec|m|min|h|hr|d|day|yr)s?(\s+ago)?\b/gi, "") // Relative time
    .replace(/\b\d+\b/g, "") // Numbers / IDs
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Captures clean structural state of the active page.
 */
export async function captureState(page: Page, excludedSelectors: string[] = []): Promise<PageSnapshot> {
  return await page.evaluate((excluded) => {
    // Modal detection
    const modalEl = document.querySelector('[role="dialog"], dialog[open], .modal, [data-modal]') as HTMLElement | null
    const isModalVisible = Boolean(
      modalEl &&
      (modalEl.offsetWidth > 0 || modalEl.offsetHeight > 0 || modalEl.getClientRects().length > 0) &&
      window.getComputedStyle(modalEl).display !== "none" &&
      window.getComputedStyle(modalEl).visibility !== "hidden"
    )
    const hasModal = Boolean(modalEl && isModalVisible)
    const modalText = hasModal && modalEl ? (modalEl.innerText || "").slice(0, 100) : ""

    // Headings
    const h = document.querySelector("h1, h2, [role='heading']") as HTMLElement | null
    const isHVisible = Boolean(
      h &&
      (h.offsetWidth > 0 || h.offsetHeight > 0 || h.getClientRects().length > 0) &&
      window.getComputedStyle(h).display !== "none" &&
      window.getComputedStyle(h).visibility !== "hidden"
    )
    const headingText = h && isHVisible ? (h.innerText || "").trim().slice(0, 80) : ""

    // Media playing
    const mediaEls = Array.from(document.querySelectorAll("video, audio")) as HTMLMediaElement[]
    const mediaPlaying = mediaEls.some((m) => !m.paused && m.currentTime > 0)

    // Error banners
    const alertEl = document.querySelector('[role="alert"], .error-message, .alert-danger, [data-error]') as HTMLElement | null
    const isAlertVisible = Boolean(
      alertEl &&
      (alertEl.offsetWidth > 0 || alertEl.offsetHeight > 0 || alertEl.getClientRects().length > 0) &&
      window.getComputedStyle(alertEl).display !== "none" &&
      window.getComputedStyle(alertEl).visibility !== "hidden"
    )
    const hasErrorAlert = Boolean(alertEl && isAlertVisible && (alertEl.innerText || "").trim().length > 0)

    // Element count in main container
    const mainEl = (document.querySelector("main, [role='main'], #root, #__next, body") || document.body) as HTMLElement
    const elementCount = mainEl.querySelectorAll("*").length

    // Extract text ignoring volatile regions
    const clone = mainEl.cloneNode(true) as HTMLElement
    // Strip known volatile elements
    clone.querySelectorAll('[aria-live], marquee, [role="timer"], [aria-roledescription="carousel"], time').forEach((e) => e.remove())
    excluded.forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((e) => e.remove())
      } catch {}
    })

    const rawText = (clone.innerText || "").slice(0, 5000)

    // Hash calculation helper (simple FNV-1a on normalized text)
    const norm = rawText
      .toLowerCase()
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g, "")
      .replace(/\b\d+\s*(s|sec|m|min|h|hr|d|day|yr)s?(\s+ago)?\b/gi, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .trim()

    let hash = 2166136261
    for (let i = 0; i < norm.length; i++) {
      hash ^= norm.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }

    return {
      url: window.location.href,
      title: document.title,
      hasModal,
      modalText,
      elementCount,
      headingText,
      mediaPlaying,
      normalizedHash: (hash >>> 0).toString(16),
      hasErrorAlert,
    }
  }, excludedSelectors)
}

/**
 * Pre-action volatility probe: checks if page content changes on its own over 400ms.
 * Returns selectors that naturally fluctuate so we don't false-pass on live tickers.
 */
export async function probeVolatility(page: Page): Promise<string[]> {
  const dynamicSelectors: string[] = []
  try {
    const s1 = await captureState(page)
    await new Promise((r) => setTimeout(r, 400))
    const s2 = await captureState(page)
    if (s1.normalizedHash !== s2.normalizedHash) {
      dynamicSelectors.push("[data-dynamic-text]", ".ticker", ".clock", ".live-update")
    }
  } catch {}
  return dynamicSelectors
}

/**
 * In-flight filtered network tracking for a single step window.
 */
export class NetworkRecorder {
  private page: Page
  private targetOrigin: string
  private customNoise: RegExp[]
  private inFlight = new Set<HTTPRequest>()
  private calls: NetworkCallEvidence[] = []
  private requestHandler: (req: HTTPRequest) => void
  private responseHandler: (res: HTTPResponse) => void

  constructor(page: Page, targetUrl: string, noiseHosts: string[] = []) {
    this.page = page
    try {
      this.targetOrigin = new URL(targetUrl).origin
    } catch {
      this.targetOrigin = ""
    }
    this.customNoise = noiseHosts.map((h) => new RegExp(`(^|\\.)${h.replace(/\./g, "\\.")}$`, "i"))

    this.requestHandler = (req: HTTPRequest) => {
      const type = req.resourceType()
      if (type !== "xhr" && type !== "fetch") return

      const url = req.url()
      if (this.isNoise(url)) return

      this.inFlight.add(req)
    }

    this.responseHandler = (res: HTTPResponse) => {
      const req = res.request()
      if (!this.inFlight.has(req)) return
      this.inFlight.delete(req)

      const method = req.method().toUpperCase()
      const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method)

      this.calls.push({
        method,
        url: req.url(),
        status: res.status(),
        isMutating,
      })
    }

    this.page.on("request", this.requestHandler)
    this.page.on("response", this.responseHandler)
  }

  private isNoise(urlStr: string): boolean {
    try {
      const u = new URL(urlStr)
      if (this.targetOrigin && u.origin !== this.targetOrigin) {
        // Third party host: check if in noise list
        for (const re of DEFAULT_NOISE_HOSTS) {
          if (re.test(u.hostname)) return true
        }
        for (const re of this.customNoise) {
          if (re.test(u.hostname)) return true
        }
      }
      for (const p of NOISE_PATH_PATTERNS) {
        if (p.test(u.pathname)) return true
      }
      return false
    } catch {
      return true
    }
  }

  public getInFlightCount(): number {
    return this.inFlight.size
  }

  public getCapturedCalls(): NetworkCallEvidence[] {
    return [...this.calls]
  }

  public cleanup(): void {
    this.page.off("request", this.requestHandler)
    this.page.off("response", this.responseHandler)
    this.inFlight.clear()
  }
}

/**
 * Tracks page console errors and exceptions during step execution.
 */
export class ConsoleRecorder {
  private page: Page
  private errors: string[] = []
  private errorHandler: (err: any) => void
  private consoleHandler: (msg: any) => void

  constructor(page: Page) {
    this.page = page
    this.errorHandler = (err: any) => {
      this.errors.push(err?.message || String(err))
    }
    this.consoleHandler = (msg: any) => {
      if (msg.type?.() === "error") {
        this.errors.push(msg.text?.() || "Console error")
      }
    }
    this.page.on("pageerror", this.errorHandler)
    this.page.on("console", this.consoleHandler)
  }

  public getErrors(): string[] {
    return [...this.errors]
  }

  public cleanup(): void {
    this.page.off("pageerror", this.errorHandler)
    this.page.off("console", this.consoleHandler)
  }
}

/**
 * Condition-based settle loop: polls every 250ms until an expected effect is observed
 * or network / DOM quiet is reached. No static sleeps.
 */
export async function settle(
  page: Page,
  netRecorder: NetworkRecorder,
  maxTimeoutMs = 3000,
  isExpectedMet?: () => boolean
): Promise<number> {
  const start = Date.now()
  let previousHash = ""

  while (Date.now() - start < maxTimeoutMs) {
    await new Promise((r) => setTimeout(r, 250))

    // Early exit if condition is already satisfied
    if (isExpectedMet && isExpectedMet()) {
      break
    }

    // Check if network is quiet and state is stable
    const inFlight = netRecorder.getInFlightCount()
    if (inFlight === 0) {
      try {
        const state = await captureState(page)
        if (state.normalizedHash === previousHash) {
          // Stable across two polls
          break
        }
        previousHash = state.normalizedHash
      } catch {}
    }
  }

  return Date.now() - start
}

/**
 * Compares before and after states, filtered network calls, and console logs
 * to classify the observed effect.
 */
export function classifyEffect(
  before: PageSnapshot,
  after: PageSnapshot,
  calls: NetworkCallEvidence[],
  consoleErrors: string[],
  dialogShown: boolean
): ObservedEffect {
  if (dialogShown) return "dialog_shown"

  // URL change
  if (before.url !== after.url) {
    const uBefore = before.url.split("#")[0]
    const uAfter = after.url.split("#")[0]
    if (uBefore !== uAfter) return "navigated"
  }

  // Modal open / close
  if (!before.hasModal && after.hasModal) return "modal_opened"
  if (before.hasModal && !after.hasModal) return "modal_closed"

  // Media started
  if (!before.mediaPlaying && after.mediaPlaying) return "media_started"

  // Error shown
  if (consoleErrors.length > 0 || (!before.hasErrorAlert && after.hasErrorAlert)) {
    return "error_shown"
  }

  // Structural or text change
  if (before.normalizedHash !== after.normalizedHash || Math.abs(before.elementCount - after.elementCount) > 1) {
    return "content_changed"
  }

  // Network activity without visible UI change
  if (calls.length > 0) {
    const hasSuccessfulCall = calls.some((c) => (c.status || 0) >= 200 && (c.status || 0) < 400)
    if (hasSuccessfulCall) return "network_only"
  }

  return "no_effect"
}

/**
 * Retry ladder execution for clicks:
 * 1. ElementHandle.click()
 * 2. Hover + Bounding-box center click (checking for overlapping/covered element)
 * 3. Focus + Keyboard Enter / Space
 */
export async function runWithLadder(
  page: Page,
  targetSelector: string | undefined,
  targetName: string,
  expectedEffects: ObservedEffect[],
  netRecorder: NetworkRecorder,
  consoleRecorder: ConsoleRecorder,
  options: { maxSettleMs?: number; dialogShownRef: { value: boolean } }
): Promise<{
  verdict: AutomationVerdict
  observedEffect: ObservedEffect
  reason: string
  retriesUsed: number
  isWeakPass: boolean
  settleDurationMs: number
  coveredElementDetected?: boolean
  beforeSnapshot: PageSnapshot
  afterSnapshot: PageSnapshot
}> {
  const before = await captureState(page)
  let retriesUsed = 0
  let isWeakPass = false
  let coveredElementDetected = false
  let observedEffect: ObservedEffect = "no_effect"
  let settleDurationMs = 0

  // Locate element handle
  const findHandle = async (): Promise<ElementHandle<Element> | null> => {
    if (targetSelector) {
      try {
        const h = await page.$(targetSelector)
        if (h) return h
      } catch {}
    }
    // Fallback: evaluate element search
    const handles = await page.$$("button, a, [role='button'], input[type='button'], input[type='submit']")
    for (const h of handles) {
      const match = await page.evaluate(
        (el, name) => {
          const txt = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim().toLowerCase()
          const target = name.toLowerCase()
          return txt === target || txt.includes(target) || target.includes(txt)
        },
        h,
        targetName
      )
      if (match) return h
    }
    return null
  }

  const handle = await findHandle()
  if (!handle) {
    return {
      verdict: "blocked",
      observedEffect: "no_effect",
      reason: `Could not locate actionable element "${targetName}" on screen.`,
      retriesUsed: 0,
      isWeakPass: false,
      settleDurationMs: 0,
      beforeSnapshot: before,
      afterSnapshot: before,
    }
  }

  // --- Attempt 1: Real ElementHandle click ---
  try {
    await page.evaluate((el) => (el as HTMLElement).scrollIntoView?.({ block: "center" }), handle).catch(() => {})
    await handle.click({ delay: 20 })
  } catch (err: any) {
    console.warn("[outcome-verifier] handle.click error:", err?.message)
  }

  settleDurationMs = await settle(page, netRecorder, options.maxSettleMs || 3000)
  let after = await captureState(page)
  observedEffect = classifyEffect(
    before,
    after,
    netRecorder.getCapturedCalls(),
    consoleRecorder.getErrors(),
    options.dialogShownRef.value
  )

  // --- Attempt 2: Bounding box hover + center click ---
  if (observedEffect === "no_effect" && !options.dialogShownRef.value) {
    retriesUsed = 1
    const box = await handle.boundingBox()
    if (box) {
      const centerX = box.x + box.width / 2
      const centerY = box.y + box.height / 2

      // Check if element is partially covered
      const covered = await page.evaluate(
        (x, y, el) => {
          const topEl = document.elementFromPoint(x, y)
          return topEl !== null && topEl !== el && !el.contains(topEl)
        },
        centerX,
        centerY,
        handle
      )

      if (covered) {
        coveredElementDetected = true
      }

      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await new Promise((r) => setTimeout(r, 40))
      await page.mouse.up()

      settleDurationMs += await settle(page, netRecorder, 2000)
      after = await captureState(page)
      observedEffect = classifyEffect(
        before,
        after,
        netRecorder.getCapturedCalls(),
        consoleRecorder.getErrors(),
        options.dialogShownRef.value
      )
    }
  }

  // --- Attempt 3: Focus + Keyboard Enter / Space ---
  if (observedEffect === "no_effect" && !options.dialogShownRef.value) {
    retriesUsed = 2
    try {
      await handle.focus()
      await page.keyboard.press("Enter")
      await new Promise((r) => setTimeout(r, 100))
      await page.keyboard.press("Space")
    } catch {}

    settleDurationMs += await settle(page, netRecorder, 2000)
    after = await captureState(page)
    observedEffect = classifyEffect(
      before,
      after,
      netRecorder.getCapturedCalls(),
      consoleRecorder.getErrors(),
      options.dialogShownRef.value
    )
  }

  // Evaluate final verdict
  let verdict: AutomationVerdict = "suspected_non_functional"
  let reason = ""

  if (observedEffect === "error_shown") {
    verdict = "failed"
    reason = `Triggered UI or console error: ${consoleRecorder.getErrors().join("; ") || "Error alert displayed"}`
  } else if (expectedEffects.includes(observedEffect)) {
    verdict = "passed"
    if (retriesUsed > 0) {
      isWeakPass = true
      reason = `Passed on fallback ladder attempt ${retriesUsed + 1} (${observedEffect}). ${coveredElementDetected ? "Note: Element appears partially covered." : ""}`
    } else {
      reason = `Observed expected effect: ${observedEffect}.`
    }
  } else if (observedEffect === "no_effect") {
    verdict = "suspected_non_functional"
    reason = `Element was clicked through all 3 ladder stages (real pointer, center coordinate, keyboard) but produced zero observable UI, navigation, media or network change. Suspected non-functional or placeholder control.`
  } else {
    // Some effect happened, but wasn't in explicit expected set
    verdict = "passed"
    reason = `Observed effect "${observedEffect}" (expected: ${expectedEffects.join(", ")}).`
  }

  return {
    verdict,
    observedEffect,
    reason,
    retriesUsed,
    isWeakPass,
    settleDurationMs,
    coveredElementDetected,
    beforeSnapshot: before,
    afterSnapshot: after,
  }
}
