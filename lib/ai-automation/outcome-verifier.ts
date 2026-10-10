import type { Page, ElementHandle, HTTPRequest, HTTPResponse } from "puppeteer"
import { humanClick } from "./human-actions"
import { secretRedactor } from "./secure-credentials-manager"
import type {
  ObservedEffect,
  AutomationVerdict,
  StepEvidence,
  NetworkCallEvidence,
  ResourceIssueEvidence,
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
  /** Current page URL, used to distinguish same-document hash links from navigation. */
  currentUrl?: string
}

/**
 * Derives expected observable effects strictly from element semantics.
 */
export function expectFor(el: ElementSemantics): ObservedEffect[] {
  const tag = (el.tagName || "").toLowerCase()
  const role = (el.role || "").toLowerCase()
  const type = (el.type || "").toLowerCase()
  const href = el.href || ""

  // Anchors can expose absolute hrefs even for same-document hash links.
  // Compare resolved URLs when the caller supplies the current page URL.
  if (tag === "a" || role === "link") {
    if (!href || href.startsWith("javascript:")) {
      return ["content_changed", "modal_opened"]
    }
    if (href.startsWith("#")) return ["content_changed", "modal_opened"]
    if (el.currentUrl) {
      try {
        const target = new URL(href, el.currentUrl)
        const current = new URL(el.currentUrl)
        if (target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) {
          return ["content_changed", "modal_opened"]
        }
      } catch {
        // Invalid URLs fall through to the conservative navigation expectation.
      }
    }
    return ["navigated"]
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
 * Finds visible data tables/grids that expose column headers but no data rows and
 * do not provide an explicit empty-state message. Empty tables are reported as
 * review findings, not automatic failures, because some products legitimately have no data.
 */
export async function detectEmptyDataSurfaces(
  page: Page
): Promise<Array<{ name: string; headers: string[]; selector: string }>> {
  try {
    return await page.evaluate(() => {
      const surfaces = Array.from(document.querySelectorAll("table, [role='grid'], [role='table']"))
      const empty: Array<{ name: string; headers: string[]; selector: string }> = []
      const emptyStatePattern = /no data|no results|nothing to show|no records|no items|empty state|add your first|get started/i

      surfaces.forEach((surface, index) => {
        const el = surface as HTMLElement
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (rect.width <= 1 || rect.height <= 1 || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return

        const headers = Array.from(el.querySelectorAll("th, [role='columnheader']"))
          .map((header) => (header.textContent || "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
        if (headers.length === 0) return

        const rows = Array.from(el.querySelectorAll("tbody tr, [role='row']"))
        const dataRows = rows.filter((row) => {
          if (row.querySelector("th, [role='columnheader']")) return false
          const text = (row.textContent || "").replace(/\s+/g, " ").trim()
          if (!text || emptyStatePattern.test(text)) return false
          return Boolean(row.querySelector("td, [role='cell'], [role='gridcell']"))
        })
        if (dataRows.length > 0) return

        const contextText = [el.innerText || "", el.parentElement?.innerText || ""].join(" ").slice(0, 1200)
        if (emptyStatePattern.test(contextText)) return

        const caption = el.getAttribute("aria-label") ||
          el.querySelector("caption")?.textContent?.trim() ||
          headers.slice(0, 4).join(", ") ||
          `Data table ${index + 1}`
        empty.push({
          name: caption,
          headers: headers.slice(0, 12),
          selector: el.matches("table") ? `table:nth-of-type(${index + 1})` : (el.getAttribute("role") || "data-grid"),
        })
      })

      return empty
    })
  } catch {
    return []
  }
}

/**
 * Finds visible images or audio/video elements that failed to load/decode.
 * This DOM-level check also catches broken assets loaded before per-step network
 * listeners were attached.
 */
export async function detectBrokenDomAssets(
  page: Page
): Promise<Array<{ url: string; resourceType: "image" | "media"; description: string }>> {
  try {
    return await page.evaluate(() => {
      const broken: Array<{ url: string; resourceType: "image" | "media"; description: string }> = []
      const visible = (el: Element) => {
        const node = el as HTMLElement
        const rect = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
      }

      document.querySelectorAll("img").forEach((img) => {
        const url = img.currentSrc || img.src
        if (!url || !visible(img) || !img.complete || img.naturalWidth > 0) return
        broken.push({
          url,
          resourceType: "image",
          description: "Visible image did not load or decode (possible missing file or unsupported format).",
        })
      })

      document.querySelectorAll("video, audio").forEach((media) => {
        const node = media as HTMLMediaElement
        const url = node.currentSrc || node.querySelector("source")?.getAttribute("src") || node.getAttribute("src") || ""
        if (!url || !visible(media)) return
        if (node.error || node.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          broken.push({
            url: new URL(url, document.baseURI).href,
            resourceType: "media",
            description: node.error
              ? `Media failed to load (media error code ${node.error.code}).`
              : "Media element has no usable source.",
          })
        }
      })

      return broken
    })
  } catch {
    return []
  }
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
  private allRequests = new Set<HTTPRequest>()
  private calls: NetworkCallEvidence[] = []
  private resourceIssues: ResourceIssueEvidence[] = []
  private requestHandler: (req: HTTPRequest) => void
  private responseHandler: (res: HTTPResponse) => void
  private requestFailedHandler: (req: HTTPRequest) => void

  constructor(page: Page, targetUrl: string, noiseHosts: string[] = []) {
    this.page = page
    try {
      this.targetOrigin = new URL(targetUrl).origin
    } catch {
      this.targetOrigin = ""
    }
    this.customNoise = noiseHosts.map((h) => new RegExp(`(^|\\.)${h.replace(/\./g, "\\.")}$`, "i"))

    this.requestHandler = (req: HTTPRequest) => {
      const url = req.url()
      if (this.isNoise(url)) return

      // Track every first-party/meaningful resource, not only API calls.
      this.allRequests.add(req)
      const type = req.resourceType()
      if (type === "xhr" || type === "fetch") this.inFlight.add(req)
    }

    this.responseHandler = (res: HTTPResponse) => {
      const req = res.request()
      const status = res.status()
      if (this.allRequests.has(req)) {
        this.allRequests.delete(req)
        if (status >= 400) {
          this.recordResourceIssue({
            url: req.url(),
            resourceType: req.resourceType(),
            method: req.method().toUpperCase(),
            status,
          })
        }
      }

      // Preserve the existing API-call evidence contract for outcome classification.
      if (!this.inFlight.has(req)) return
      this.inFlight.delete(req)

      const method = req.method().toUpperCase()
      const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method)

      let headers: Record<string, string> | undefined = undefined
      let postData: string | undefined = undefined
      try {
        const rawHeaders = req.headers()
        headers = Object.fromEntries(
          Object.entries(rawHeaders).map(([name, value]) => [
            name,
            /authorization|cookie|set-cookie|api[-_]?key|token|secret/i.test(name)
              ? "[REDACTED_HEADER]"
              : secretRedactor.redact(value),
          ])
        )
        postData = secretRedactor.redact(req.postData())
      } catch {}

      this.calls.push({
        method,
        url: secretRedactor.redact(req.url()),
        status,
        isMutating,
        headers,
        postData,
      })
    }

    this.requestFailedHandler = (req: HTTPRequest) => {
      if (!this.allRequests.has(req)) return
      this.allRequests.delete(req)
      this.inFlight.delete(req)
      const failure = req.failure()
      this.recordResourceIssue({
        url: req.url(),
        resourceType: req.resourceType(),
        method: req.method().toUpperCase(),
        errorText: failure?.errorText || "Request failed without an HTTP response",
      })
    }

    this.page.on("request", this.requestHandler)
    this.page.on("response", this.responseHandler)
    this.page.on("requestfailed", this.requestFailedHandler)
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

  private recordResourceIssue(issue: Omit<ResourceIssueEvidence, "timestamp">): void {
    const safeUrl = secretRedactor.redact(issue.url)
    const key = [safeUrl, issue.resourceType, issue.status ?? "", issue.errorText ?? ""].join("|")
    if (this.resourceIssues.some((item) =>
      [item.url, item.resourceType, item.status ?? "", item.errorText ?? ""].join("|") === key
    )) return

    this.resourceIssues.push({
      ...issue,
      url: safeUrl,
      timestamp: new Date().toISOString(),
    })
  }

  public getCapturedCalls(): NetworkCallEvidence[] {
    return [...this.calls]
  }

  public getResourceIssues(): ResourceIssueEvidence[] {
    return [...this.resourceIssues]
  }

  public cleanup(): void {
    this.page.off("request", this.requestHandler)
    this.page.off("response", this.responseHandler)
    this.page.off("requestfailed", this.requestFailedHandler)
    this.inFlight.clear()
    this.allRequests.clear()
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
      this.errors.push(secretRedactor.redact(err?.message || String(err)))
    }
    this.consoleHandler = (msg: any) => {
      if (msg.type?.() === "error") {
        this.errors.push(secretRedactor.redact(msg.text?.() || "Console error"))
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

  // Resolve the target using stable DOM semantics before falling back to coordinates.
  const resolveTarget = async (): Promise<ElementHandle<Element> | null> => {
    const selectors = [
      targetSelector,
      targetSelector?.startsWith("#") ? targetSelector : undefined,
      targetName ? `[aria-label="${targetName.replace(/"/g, '\\\"')}"]` : undefined,
      targetName ? `[name="${targetName.replace(/"/g, '\\\"')}"]` : undefined,
    ].filter(Boolean) as string[]

    for (const selector of selectors) {
      try {
        const handle = await page.$(selector)
        if (handle) {
          const usable = await page.evaluate((el) => {
            const e = el as HTMLElement
            const r = e.getBoundingClientRect()
            const s = getComputedStyle(e)
            return r.width > 1 && r.height > 1 &&
              s.display !== "none" &&
              s.visibility !== "hidden" &&
              s.opacity !== "0" &&
              !(e as HTMLButtonElement).disabled &&
              e.getAttribute("aria-disabled") !== "true"
          }, handle)
          if (usable) return handle
        }
      } catch {}
    }

    const handles = await page.$$("button, a, [role='button'], input[type='button'], input[type='submit'], [role='link'], [role='tab'], [role='menuitem']")
    let best: ElementHandle<Element> | null = null
    let bestScore = 0

    for (const handle of handles) {
      const score = await page.evaluate((el, name) => {
        const e = el as HTMLElement
        const r = e.getBoundingClientRect()
        const s = getComputedStyle(e)
        if (r.width <= 1 || r.height <= 1 || s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return 0
        if ((e as HTMLButtonElement).disabled || e.getAttribute("aria-disabled") === "true") return 0

        const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase()
        const wanted = norm(name)
        const text = norm(e.innerText || e.textContent || "")
        const aria = norm(e.getAttribute("aria-label") || "")
        const title = norm(e.getAttribute("title") || "")
        const id = norm(e.id || "")
        const testId = norm(e.getAttribute("data-testid") || e.getAttribute("data-test-id") || "")

        if (!wanted) return 0
        if (aria === wanted || text === wanted || title === wanted || id === wanted || testId === wanted) return 100
        if (aria.includes(wanted) || text.includes(wanted)) return 70
        if (wanted.includes(text) && text.length > 2) return 55
        return 0
      }, handle, targetName)

      if (score > bestScore) {
        bestScore = score
        best = handle
      }
    }
    return best
  }

  const getBlockingElement = async (handle: ElementHandle<Element>) => {
    return await page.evaluate((el) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) return { blocked: false, reason: "not-visible" }
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const top = document.elementFromPoint(x, y)
      if (!top || top === el || el.contains(top)) return { blocked: false }
      const blocking = top.closest("[role='dialog'], dialog[open], [aria-modal='true'], .modal, [data-modal], button, [role='button'], [aria-label]")
      return {
        blocked: Boolean(blocking && blocking !== el && !el.contains(blocking)),
        reason: blocking ? ((blocking as HTMLElement).innerText || blocking.getAttribute("aria-label") || blocking.tagName).trim().slice(0, 120) : "unknown-overlay"
      }
    }, handle)
  }

  const handle = await resolveTarget()
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

  await page.evaluate((el) => (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "center" }), handle).catch(() => {})

  // Never blindly click through an overlay. Record the blocker and let the caller's
  // existing modal/human-action flow handle it first.
  const blocker = await getBlockingElement(handle)
  if (blocker.blocked) {
    coveredElementDetected = true
    return {
      verdict: "blocked",
      observedEffect: "no_effect",
      reason: `Target "${targetName}" is blocked by an overlay/modal (${blocker.reason}). Overlay must be handled before the underlying action.`,
      retriesUsed: 0,
      isWeakPass: false,
      settleDurationMs: 0,
      coveredElementDetected,
      beforeSnapshot: before,
      afterSnapshot: before,
    }
  }

  // Primary path: DOM identifies the exact target; humanClick performs the physical
  // interaction using the target's fresh bounding box and humanized mouse movement.
  // This keeps DOM as the source of truth while avoiding direct element.click().
  try {
    await humanClick(page, handle)
  } catch (err: any) {
    console.warn("[outcome-verifier] humanized DOM-target click failed:", err?.message)
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

  // Secondary path: re-resolve the element in case the DOM changed after the first attempt.
  if (observedEffect === "no_effect" && !options.dialogShownRef.value) {
    retriesUsed = 1
    const freshHandle = await resolveTarget()
    if (freshHandle) {
      const freshBlocker = await getBlockingElement(freshHandle)
      if (freshBlocker.blocked) {
        coveredElementDetected = true
      } else {
        try {
          await humanClick(page, freshHandle)
        } catch {
          // Physical mouse fallback below is intentionally last resort.
        }
      }
    }

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

  // Last-resort physical click. The target is still resolved from the DOM; this
  // stage only retries the physical click with a fresh bounding box.
  if (observedEffect === "no_effect" && !options.dialogShownRef.value) {
    retriesUsed = 2
    const fallbackHandle = await resolveTarget()
    if (fallbackHandle) {
      const box = await fallbackHandle.boundingBox()
      if (box) {
        const centerX = box.x + box.width / 2
        const centerY = box.y + box.height / 2
        const top = await page.evaluate((x, y) => document.elementFromPoint(x, y), centerX, centerY).catch(() => null)
        if (top) {
          const sameTarget = await page.evaluate((point, el) => point === el || el.contains(point), top, fallbackHandle).catch(() => false)
          if (!sameTarget) {
            coveredElementDetected = true
          } else {
            await page.mouse.move(centerX, centerY)
            await page.mouse.click(centerX, centerY)
          }
        }
      }
    }

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

  let verdict: AutomationVerdict = "suspected_non_functional"
  let reason = ""

  if (observedEffect === "error_shown") {
    verdict = "failed"
    reason = `Triggered UI or console error: ${consoleRecorder.getErrors().join("; ") || "Error alert displayed"}`
  } else if (expectedEffects.includes(observedEffect)) {
    verdict = "passed"
    if (retriesUsed > 0) {
      isWeakPass = true
      reason = `Passed after DOM-resolution retry ${retriesUsed + 1} (${observedEffect}).${coveredElementDetected ? " Element coverage was also checked." : ""}`
    } else {
      reason = `Observed expected effect: ${observedEffect}.`
    }
  } else if (observedEffect === "no_effect") {
    verdict = "suspected_non_functional"
    reason = `Target was resolved from the DOM and attempted with humanized mouse movement; the final physical retry also produced no observable UI, navigation, media or network change.`
  } else {
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

/**
 * Verifies modal dismissal via close button or Escape key,
 * and checks whether keyboard focus was restored properly (WCAG 2.4.3).
 */
export async function verifyModalCloseAndFocus(
  page: Page,
  triggerSelector?: string,
  triggerName?: string
): Promise<{
  closed: boolean
  focusRestored: boolean
  method: "close_button" | "escape" | "none"
  activeElementTag?: string
}> {
  // 1. Try finding close button
  const closeBtnHandle = await page.evaluateHandle(() => {
    const modal = document.querySelector('[role="dialog"], dialog[open], .modal, [data-modal]')
    if (!modal) return null
    return (
      modal.querySelector(
        'button[id*="close" i], [aria-label*="close" i], button.close, [data-dismiss], [data-close], button[class*="close"], button:has(svg)'
      ) ||
      Array.from(modal.querySelectorAll("button")).find((b) => /close|dismiss|cancel/i.test(b.textContent || "")) ||
      null
    )
  })

  let closed = false
  let method: "close_button" | "escape" | "none" = "none"

  const btnElement = closeBtnHandle.asElement()
  if (btnElement) {
    await page
      .evaluate((el) => {
        if (el && (el as HTMLElement).click) (el as HTMLElement).click()
      }, btnElement)
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 400))
    const stateAfterBtn = await captureState(page)
    if (!stateAfterBtn.hasModal) {
      closed = true
      method = "close_button"
    }
  }

  // 2. If not closed, try Escape key
  if (!closed) {
    await page.keyboard.press("Escape")
    await new Promise((r) => setTimeout(r, 400))
    const stateAfterEsc = await captureState(page)
    if (!stateAfterEsc.hasModal) {
      closed = true
      method = "escape"
    }
  }

  // 3. Check focus restoration
  const focusCheck = await page.evaluate((trigSel) => {
    const active = document.activeElement
    const isBody = !active || active === document.body || active === document.documentElement
    let restoredToTrigger = false
    if (trigSel) {
      try {
        const trig = document.querySelector(trigSel)
        if (trig && trig === active) restoredToTrigger = true
      } catch {}
    }
    return {
      isBody,
      activeTag: active ? active.tagName.toLowerCase() : "none",
      restoredToTrigger,
    }
  }, triggerSelector)

  return {
    closed,
    focusRestored: !focusCheck.isBody,
    method,
    activeElementTag: focusCheck.activeTag,
  }
}

