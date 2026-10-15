import type { Page } from "puppeteer"
import {
  inspectPageDom,
  resolveCurrentDomTarget,
  type DomActionTargetHint,
  type DomDiscoverySnapshot,
} from "./dom-first-discovery"

export type TargetResolutionSource = "dom" | "stagehand-observe"
export type TargetResolutionMatch = "selector" | "href" | "label" | "stagehand-observe"

/**
 * A browser-independent description of a freshly grounded target.
 * confidence is a heuristic ranking score, not a calibrated probability.
 */
export type GroundedTarget = {
  selector: string
  label: string
  tag: string
  role: string
  href?: string
  source: TargetResolutionSource
  match: TargetResolutionMatch
  confidence: number
  observedUrl: string
  observedAt: string
}

export type StagehandObservationRequest = {
  description: string
  hint: DomActionTargetHint
  snapshot: DomDiscoverySnapshot
}

/**
 * An observer may propose locators, but receives no executor interface and
 * returns hints only. Every proposal is grounded again against the live DOM.
 */
export type StagehandObservationProvider = (
  request: StagehandObservationRequest,
) => Promise<DomActionTargetHint[] | null>

export type ResolveGroundedTargetRequest = {
  description: string
  hint: DomActionTargetHint
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase()
const normalizeHref = (value: string, base: string) => {
  try { return new URL(value, base).href } catch { return "" }
}

function confidenceFor(match: "selector" | "href" | "label" | "stagehand-observe"): number {
  switch (match) {
    case "selector": return 0.95
    case "href": return 0.92
    case "label": return 0.84
    case "stagehand-observe": return 0.72
  }
  return 0
}

async function materializeTarget(
  page: Page,
  resolved: { selector: string; label: string; href?: string; matchedBy: "selector" | "href" | "label" },
  source: TargetResolutionSource,
  hint: DomActionTargetHint,
  snapshot?: DomDiscoverySnapshot,
): Promise<GroundedTarget | null> {
  const current = snapshot ?? await inspectPageDom(page).catch(() => null)
  if (!current) return null
  const matches = current.elements.filter((element) => {
    const hasResolvedLocator = element.selector === resolved.selector ||
      element.locators.some((locator) => locator.selector === resolved.selector && locator.uniqueAtDiscovery)
    if (!hasResolvedLocator || normalize(element.label) !== normalize(hint.label || resolved.label)) return false
    if (hint.role && normalize(element.role) !== normalize(hint.role)) return false
    if (hint.elementType &&
      normalize(element.tag) !== normalize(hint.elementType) &&
      normalize(element.role) !== normalize(hint.elementType)) return false
    if (hint.href) {
      const expectedHref = normalizeHref(hint.href, current.url)
      const actualHref = element.href ? normalizeHref(element.href, current.url) : ""
      if (!expectedHref || !actualHref || expectedHref !== actualHref) return false
    }
    return true
  })
  if (matches.length !== 1) return null
  const element = matches[0]
  const match: TargetResolutionMatch = source === "stagehand-observe" ? "stagehand-observe" : resolved.matchedBy
  return {
    selector: resolved.selector,
    label: element.label,
    tag: element.tag,
    role: element.role,
    href: element.href,
    source,
    match,
    confidence: confidenceFor(match),
    observedUrl: current.url,
    observedAt: new Date().toISOString(),
  }
}

/**
 * DOM-first target grounding with an optional Stagehand observe-only fallback.
 *
 * The original label/destination/role/type remain hard constraints when
 * checking Stagehand's suggestion. The observer cannot click, type, navigate,
 * or submit through this contract.
 */
export async function resolveGroundedTarget(
  page: Page,
  request: ResolveGroundedTargetRequest,
  observeWithStagehand?: StagehandObservationProvider,
): Promise<GroundedTarget | null> {
  const { hint } = request
  const direct = await resolveCurrentDomTarget(page, hint).catch(() => null)
  if (direct) {
    return materializeTarget(page, direct, "dom", hint)
  }

  // Do not let AI replace an absent intent with an arbitrary selector.
  // At least one stable identity constraint must be supplied by the plan.
  if (!observeWithStagehand || (!hint.label && !hint.href)) return null
  const snapshot = await inspectPageDom(page).catch(() => null)
  if (!snapshot) return null

  const proposals = await observeWithStagehand({
    description: request.description.slice(0, 400),
    hint,
    snapshot,
  }).catch(() => null)
  if (!Array.isArray(proposals)) return null

  // Keep the model-assisted fallback bounded. Each proposal is independently
  // revalidated; a wrong or stale proposal is skipped, never executed.
  for (const proposal of proposals.slice(0, 8)) {
    if (!proposal?.selector) continue
    if (hint.label && proposal.label && normalize(proposal.label) !== normalize(hint.label)) continue
    if (hint.role && proposal.role && normalize(proposal.role) !== normalize(hint.role)) continue
    if (hint.elementType && proposal.elementType &&
      normalize(proposal.elementType) !== normalize(hint.elementType) &&
      normalize(proposal.role || "") !== normalize(hint.elementType)) continue
    if (hint.href && proposal.href &&
      normalizeHref(hint.href, snapshot.url) !== normalizeHref(proposal.href, snapshot.url)) continue

    const constrainedHint: DomActionTargetHint = {
      selector: proposal.selector,
      label: hint.label || proposal.label,
      role: hint.role || proposal.role,
      href: hint.href || proposal.href,
      elementType: hint.elementType || proposal.elementType,
    }
    if (!constrainedHint.label && !constrainedHint.href) continue

    const grounded = await resolveCurrentDomTarget(page, constrainedHint).catch(() => null)
    if (!grounded) continue
    const finalSnapshot = await inspectPageDom(page).catch(() => null)
    if (!finalSnapshot) return null
    const result = await materializeTarget(page, grounded, "stagehand-observe", constrainedHint, finalSnapshot)
    if (result) return result
  }
  return null
}

type StagehandActionSuggestion = {
  selector?: unknown
  description?: unknown
  method?: unknown
}

/**
 * Adapt Stagehand v3 observe() into target proposals. This intentionally calls
 * observe() only; it never calls act(), page.click(), or any other executor.
 */
export function createStagehandObservationProvider(
  stagehand: unknown,
  page: Page,
): StagehandObservationProvider {
  return async ({ description, hint }) => {
    const observer = stagehand as {
      observe?: (instruction: string, options?: { page?: unknown; timeout?: number }) => Promise<unknown>
    }
    if (typeof observer?.observe !== "function") return null

    const constraints = [
      hint.label ? `expected label: "${hint.label.slice(0, 120)}"` : "",
      hint.role ? `expected role: ${hint.role}` : "",
      hint.elementType ? `expected element type: ${hint.elementType}` : "",
      hint.href ? `expected destination: ${hint.href.slice(0, 300)}` : "",
    ].filter(Boolean).join("; ")
    const instruction = [
      "OBSERVE ONLY. Do not click, type, fill, navigate, submit, or modify the page.",
      `Identify visible interactive target(s) for this QA intent: ${description.slice(0, 300)}.`,
      constraints ? `Required identity constraints: ${constraints}.` : "",
      "Return candidate selectors and descriptions only. Prefer the exact intended control.",
    ].filter(Boolean).join(" ")

    const raw = await observer.observe(instruction, { page, timeout: 10000 }).catch(() => null)
    const record = raw as { data?: unknown; actions?: unknown; result?: unknown } | null
    const actions: unknown[] = Array.isArray(raw) ? raw
      : Array.isArray(record?.data) ? record.data
      : Array.isArray(record?.actions) ? record.actions
      : Array.isArray(record?.result) ? record.result
      : []
    const proposals: DomActionTargetHint[] = []
    for (const action of actions.slice(0, 8) as StagehandActionSuggestion[]) {
      if (typeof action?.selector !== "string" || !action.selector.trim()) continue
      const target = await readObservedTarget(page, action.selector).catch(() => null)
      if (!target) continue
      // Do not trust generated prose as the target's accessible name. Use the
      // fresh live DOM label and constrain it again in resolveGroundedTarget().
      proposals.push(target)
    }
    return proposals
  }
}

/** Convert Stagehand's CSS/XPath locator to a unique live CSS locator. */
async function readObservedTarget(page: Page, rawSelector: string): Promise<DomActionTargetHint | null> {
  return page.evaluate((inputSelector) => {
    const selector = inputSelector.replace(/^xpath\s*=\s*/i, "").trim()
    let element: Element | null = null
    let cssParsed = false
    try {
      const matches = Array.from(document.querySelectorAll(selector))
      cssParsed = true
      if (matches.length !== 1) return null
      element = matches[0]
    } catch {
      // Stagehand may provide an XPath. It is resolved here, never passed to
      // the Puppeteer executor as though it were a CSS selector.
    }
    if (!cssParsed) {
      try {
        const result = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        if (result.snapshotLength !== 1) return null
        const node = result.snapshotItem(0)
        if (node instanceof Element) element = node
      } catch {
        return null
      }
    }
    if (!element) return null

    const html = element as HTMLElement
    const rect = html.getBoundingClientRect()
    const style = getComputedStyle(html)
    if (rect.width <= 2 || rect.height <= 2 || style.display === "none" ||
      style.visibility === "hidden" || style.opacity === "0" || html.getAttribute("aria-hidden") === "true") return null

    const roleOf = (el: Element) => {
      const h = el as HTMLElement
      const explicit = h.getAttribute("role")
      if (explicit) return explicit
      const tag = el.tagName.toLowerCase()
      if (tag === "button" || tag === "summary") return "button"
      if (tag === "a" && h.hasAttribute("href")) return "link"
      if (tag === "textarea") return "textbox"
      if (tag === "select") return "combobox"
      if (tag === "input") {
        const type = (h.getAttribute("type") || "text").toLowerCase()
        if (type === "checkbox") return "checkbox"
        if (type === "radio") return "radio"
        if (["submit", "button", "reset", "image"].includes(type)) return "button"
        return "textbox"
      }
      return ""
    }
    const input = element as HTMLInputElement
    const labelledBy = html.getAttribute("aria-labelledby")
    const referenced = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : ""
    const tooltip = html.getAttribute("data-tooltip") || html.getAttribute("data-tooltip-content") ||
      html.getAttribute("data-original-title") || html.getAttribute("data-action") || ""
    const icon = html.querySelector('svg[aria-label],svg[title],svg[class*="lucide-"],[data-lucide],svg title,[data-icon]') as HTMLElement | null
    const iconName = (icon?.getAttribute("data-lucide") || icon?.getAttribute("data-icon") ||
      Array.from((icon as SVGElement | null)?.classList || []).find((name) => name.startsWith("lucide-")) || "")
      .replace(/^lucide-/, "").replace(/-icon$/, "")
    const iconWords: Record<string, string> = {
      x: "Close", close: "Close", menu: "Menu", search: "Search", plus: "Add",
      "ellipsis": "More options", "ellipsis-vertical": "More options", "more-horizontal": "More options",
      "arrow-left": "Back", "chevron-left": "Back", "arrow-right": "Next",
      "chevron-right": "Next", settings: "Settings", pencil: "Edit", edit: "Edit",
      "trash-2": "Delete", trash: "Delete", calendar: "Calendar", copy: "Copy",
    }
    const label = String(html.getAttribute("aria-label") || referenced || input.labels?.[0]?.textContent ||
      html.innerText || input.value || input.placeholder || html.getAttribute("name") || html.title ||
      tooltip || icon?.getAttribute("aria-label") || icon?.getAttribute("title") ||
      icon?.querySelector("title")?.textContent || iconWords[iconName] ||
      html.getAttribute("data-testid") || html.getAttribute("data-test-id") || html.getAttribute("data-cy") || "")
      .replace(/\s+/g, " ").trim().slice(0, 120)
    if (!label) return null

    const unique = (candidate: string) => {
      try { return document.querySelectorAll(candidate).length === 1 } catch { return false }
    }
    const attrSelector = (name: string, value: string) => "[" + name + "=" + JSON.stringify(value) + "]"
    let safeSelector = ""
    if (html.id) {
      const byId = "#" + CSS.escape(html.id)
      if (unique(byId)) safeSelector = byId
    }
    if (!safeSelector) {
      for (const attr of ["data-testid", "data-test-id", "data-cy", "aria-label", "name"]) {
        const value = html.getAttribute(attr)
        if (!value) continue
        const candidate = html.tagName.toLowerCase() + attrSelector(attr, value)
        if (unique(candidate)) { safeSelector = candidate; break }
      }
    }
    if (!safeSelector) {
      const parts: string[] = []
      let current: Element | null = element
      while (current && current !== document.documentElement) {
        const parent = current.parentElement
        const tag = current.tagName.toLowerCase()
        if (!parent) { parts.unshift(tag); break }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tag)
        const candidate = parts.join(" > ")
        if (unique(candidate)) { safeSelector = candidate; break }
        current = parent
      }
    }
    if (!safeSelector || !unique(safeSelector)) return null
    const href = element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement
      ? element.href
      : html.getAttribute("href") || undefined
    return {
      selector: safeSelector,
      label,
      role: roleOf(element) || undefined,
      elementType: element.tagName.toLowerCase(),
      href,
    }
  }, rawSelector)
}
