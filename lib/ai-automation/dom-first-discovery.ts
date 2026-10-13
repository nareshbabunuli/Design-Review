import type { Page } from "puppeteer"


export type DomNavigationEvent = {
  kind: "pushState" | "replaceState" | "popstate" | "hashchange"
  from: string
  to: string
  observedAt: string
}

/** Install a lightweight, idempotent observer for SPA/history/hash URL changes. */
export async function installDomNavigationObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    // TypeScript test runners may inject an esbuild __name helper into the
    // serialized callback. Define a harmless browser-local fallback first.
    const browserWindow = window as Window & { __name?: (fn: unknown, name?: string) => unknown }
    browserWindow.__name ??= (fn) => fn
    const target = window as Window & { __domDiscoveryObserverInstalled?: boolean; __domDiscoveryNavigationEvents?: DomNavigationEvent[] }
    if (target.__domDiscoveryObserverInstalled) return
    target.__domDiscoveryObserverInstalled = true
    target.__domDiscoveryNavigationEvents = []
    let lastHref = location.href
    const record = (kind: DomNavigationEvent["kind"], from: string) => {
      target.__domDiscoveryNavigationEvents!.push({ kind, from, to: location.href, observedAt: new Date().toISOString() })
      lastHref = location.href
      if (target.__domDiscoveryNavigationEvents!.length > 100) target.__domDiscoveryNavigationEvents!.splice(0, target.__domDiscoveryNavigationEvents!.length - 100)
    }
    const originalPushState = history.pushState.bind(history)
    const originalReplaceState = history.replaceState.bind(history)
    history.pushState = function (...args: Parameters<History["pushState"]>) {
      const from = lastHref
      const result = originalPushState(...args)
      if (location.href !== from) record("pushState", from)
      return result
    }
    history.replaceState = function (...args: Parameters<History["replaceState"]>) {
      const from = lastHref
      const result = originalReplaceState(...args)
      if (location.href !== from) record("replaceState", from)
      return result
    }
    addEventListener("popstate", () => record("popstate", lastHref))
    addEventListener("hashchange", (event) => record("hashchange", (event as HashChangeEvent).oldURL))
  })
}

/** Drain observed client-side URL changes without retaining stale events across actions. */
export async function drainDomNavigationEvents(page: Page): Promise<DomNavigationEvent[]> {
  return page.evaluate(() => {
    const target = window as Window & { __domDiscoveryNavigationEvents?: DomNavigationEvent[] }
    const events = target.__domDiscoveryNavigationEvents || []
    target.__domDiscoveryNavigationEvents = []
    return events
  }).catch(() => [])
}

export type RankedLocatorStrategy = "role" | "attribute" | "label-text" | "structural"

export type RankedLocatorCandidate = {
  strategy: RankedLocatorStrategy
  selector: string
  role?: string
  name?: string
  attribute?: string
  confidence: number
  uniqueAtDiscovery: boolean
  context?: string
}

export type DomDiscoveryElement = {
  selector: string
  locators: RankedLocatorCandidate[]
  tag: string
  role: string
  label: string
  href?: string
  kind: "navigation" | "overlay" | "form" | "state-change" | "action" | "unknown"
  risk: "safe" | "review" | "blocked"
  enabled: boolean
}

export type DomDiscoverySnapshot = {
  url: string
  origin: string
  title: string
  elements: DomDiscoveryElement[]
  counts: Record<string, number>
  forms: number
  dialogs: number
  scrollableRegions: number
}

/**
 * DOM-first inventory. This pass only observes; it never clicks, submits,
 * changes values, or follows links. Navigation is recorded for a later,
 * deliberate exploration pass.
 */
export async function inspectPageDom(page: Page): Promise<DomDiscoverySnapshot> {
  return page.evaluate(() => {
    const browserWindow = window as Window & { __name?: (fn: unknown, name?: string) => unknown }
    browserWindow.__name ??= (fn) => fn
    const visible = (el: Element) => {
      const h = el as HTMLElement
      const r = h.getBoundingClientRect()
      const s = getComputedStyle(h)
      return r.width > 2 && r.height > 2 && s.display !== "none" &&
        s.visibility !== "hidden" && s.opacity !== "0" && h.getAttribute("aria-hidden") !== "true"
    }
    const labelOf = (el: Element) => {
      const h = el as HTMLElement
      const input = el as HTMLInputElement
      const labelledBy = h.getAttribute("aria-labelledby")
      const referenced = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ") : ""
      const label = h.getAttribute("aria-label") || referenced || input.labels?.[0]?.textContent ||
        h.innerText || input.placeholder || input.name || input.title || el.tagName
      return String(label).replace(/\s+/g, " ").trim().slice(0, 120)
    }
    const roleOf = (el: Element) => {
      const explicit = el.getAttribute("role")
      if (explicit) return explicit
      const tag = el.tagName.toLowerCase()
      if (tag === "button" || tag === "summary") return "button"
      if (tag === "a" && el.hasAttribute("href")) return "link"
      if (tag === "textarea") return "textbox"
      if (tag === "select") return "combobox"
      if (tag === "input") {
        const type = (el.getAttribute("type") || "text").toLowerCase()
        if (type === "checkbox") return "checkbox"
        if (type === "radio") return "radio"
        if (type === "submit" || type === "button" || type === "reset") return "button"
        return "textbox"
      }
      return ""
    }
    const cssAttr = (name: string, value: string) => "[" + name + "=" + JSON.stringify(value) + "]"
    const locatorCandidatesOf = (el: Element, label: string): RankedLocatorCandidate[] => {
      const h = el as HTMLElement
      const candidates: RankedLocatorCandidate[] = []
      const add = (candidate: RankedLocatorCandidate) => {
        if (!candidate.selector || candidates.some((item) => item.strategy === candidate.strategy && item.selector === candidate.selector && item.role === candidate.role && item.name === candidate.name)) return
        candidates.push(candidate)
      }
      const role = roleOf(el)
      if (role && label) {
        const roleSelector = role === "button" ? 'button,[role="button"],[role="tab"],[role="menuitem"],summary' : '[role=' + JSON.stringify(role) + '],' + el.tagName.toLowerCase()
        const uniqueNamedMatch = (() => {
          try { return Array.from(document.querySelectorAll(roleSelector)).filter((candidate) => roleOf(candidate) === role && labelOf(candidate) === label).length === 1 } catch { return false }
        })()
        add({ strategy: "role", selector: roleSelector, role, name: label, confidence: 0.98, uniqueAtDiscovery: uniqueNamedMatch, context: "active document" })
      }
      const testId = h.getAttribute("data-testid") || h.getAttribute("data-test-id") || h.getAttribute("data-cy")
      if (testId) {
        const attr = h.hasAttribute("data-testid") ? "data-testid" : h.hasAttribute("data-test-id") ? "data-test-id" : "data-cy"
        const selector = cssAttr(attr, testId)
        add({ strategy: "attribute", selector, attribute: attr, confidence: 0.96, uniqueAtDiscovery: document.querySelectorAll(selector).length === 1, context: "active document" })
      }
      if (h.id) {
        const selector = "#" + CSS.escape(h.id)
        add({ strategy: "attribute", selector, attribute: "id", confidence: 0.94, uniqueAtDiscovery: document.querySelectorAll(selector).length === 1, context: "active document" })
      }
      const name = h.getAttribute("name")
      if (name) {
        const selector = el.tagName.toLowerCase() + cssAttr("name", name)
        add({ strategy: "attribute", selector, attribute: "name", confidence: 0.91, uniqueAtDiscovery: document.querySelectorAll(selector).length === 1, context: "active document" })
      }
      if (label) {
        const textSelector = el.tagName.toLowerCase() + ':not([aria-label])'
        add({ strategy: "label-text", selector: textSelector, role: role || undefined, name: label, confidence: 0.78, uniqueAtDiscovery: false, context: "active document" })
      }
      const structural = selectorOf(el)
      add({ strategy: "structural", selector: structural, confidence: 0.45, uniqueAtDiscovery: (() => { try { return document.querySelectorAll(structural).length === 1 } catch { return false } })(), context: "active document" })
      return candidates.sort((a, b) => b.confidence - a.confidence)
    }
    const selectorOf = (el: Element) => {
      const h = el as HTMLElement
      if (h.id && document.querySelectorAll("#" + CSS.escape(h.id)).length === 1) return "#" + CSS.escape(h.id)
      const name = h.getAttribute("name")
      if (name) {
        const byName = el.tagName.toLowerCase() + "[name=" + JSON.stringify(name) + "]"
        if (document.querySelectorAll(byName).length === 1) return byName
      }
      const aria = h.getAttribute("aria-label")
      if (aria) {
        const byAria = el.tagName.toLowerCase() + "[aria-label=" + JSON.stringify(aria) + "]"
        if (document.querySelectorAll(byAria).length === 1) return byAria
      }
      const parts: string[] = []
      let current: Element | null = el
      while (current && current !== document.documentElement) {
        const parent: Element | null = current.parentElement
        const tag = current.tagName.toLowerCase()
        if (!parent) { parts.unshift(tag); break }
        const siblings = (Array.from(parent.children) as Element[]).filter((child: Element) => child.tagName === current!.tagName)
        parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tag)
        const candidate = parts.join(" > ")
        try { if (document.querySelectorAll(candidate).length === 1) return candidate } catch {}
        current = parent
      }
      return parts.join(" > ") || el.tagName.toLowerCase()
    }
    const nodes = Array.from(document.querySelectorAll(
      'a[href],area[href],button,input,select,textarea,summary,[aria-haspopup],[aria-expanded],[data-dropdown],[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[onclick],[tabindex]:not([tabindex="-1"])'
    )).filter(visible).slice(0, 300)
    const elements = nodes.map((el) => {
      const h = el as HTMLElement
      const input = el as HTMLInputElement
      const label = labelOf(el)
      const locators = locatorCandidatesOf(el, label)
      const role = h.getAttribute("role") || ""
      const href = el instanceof HTMLAnchorElement || el instanceof HTMLAreaElement ? el.href : undefined
      const target = h.getAttribute("target") || ""
      const path = (() => { try { return href ? new URL(href, location.href).pathname : "" } catch { return "" } })()
      const external = (() => { try { return !!href && new URL(href, location.href).origin !== location.origin } catch { return !!href } })()
      const navigation = !!href || /^(back|forward|next page|previous page)$/i.test(label) ||
        /^(back|forward)$/i.test(h.getAttribute("aria-label") || "") ||
        /^(link|navigation)$/i.test(role) || /^(back|forward)$/i.test(h.getAttribute("data-action") || "")
      const risky = /delete|remove|destroy|purchase|pay|checkout|charge|send|publish|deploy|invite|refund|transfer|logout|log out|sign out|unsubscribe|change password|revoke access|grant access/i.test(label + " " + path)
      const isForm = /^(input|select|textarea)$/.test(el.tagName.toLowerCase()) || !!el.closest("form")
      const overlay = /^(dialog)$/.test(el.tagName.toLowerCase()) || !!el.closest('[role="dialog"],dialog[open],.modal,[data-modal]')
      const stateChange = role === "tab" || role === "switch" || role === "checkbox" || role === "radio" ||
        h.hasAttribute("aria-expanded") || h.hasAttribute("aria-pressed") || h.hasAttribute("aria-controls")
      return {
        selector: locators.find((candidate) => candidate.uniqueAtDiscovery && candidate.strategy !== "role" && candidate.strategy !== "label-text")?.selector || selectorOf(el),
        locators,
        tag: el.tagName.toLowerCase(),
        role,
        label,
        href,
        kind: (navigation ? "navigation" : overlay ? "overlay" : isForm ? "form" : stateChange ? "state-change" : /^(button)$/.test(el.tagName.toLowerCase()) || role === "button" || h.hasAttribute("onclick") ? "action" : "unknown") as DomDiscoveryElement["kind"],
        risk: (risky ? "blocked" : external || target === "_blank" ? "review" : "safe") as DomDiscoveryElement["risk"],
        enabled: !("disabled" in input && input.disabled) && h.getAttribute("aria-disabled") !== "true",
      }
    })
    const counts: Record<string, number> = {}
    for (const element of elements) counts[element.kind] = (counts[element.kind] || 0) + 1
    return {
      url: location.href,
      origin: location.origin,
      title: document.title,
      elements,
      counts,
      forms: document.forms.length,
      dialogs: document.querySelectorAll('[role="dialog"],dialog[open],.modal,[data-modal]').length,
      scrollableRegions: Array.from(document.querySelectorAll("body *")).filter((el) => {
        const s = getComputedStyle(el)
        return /(auto|scroll)/.test(s.overflowY + " " + s.overflowX) && (el.scrollHeight > el.clientHeight + 10 || el.scrollWidth > el.clientWidth + 10)
      }).length,
    }
  })
}

/** Revalidate ranked locator candidates against the live DOM before acting. */
export async function resolveRankedLocator(
  page: Page,
  candidates: RankedLocatorCandidate[],
): Promise<{ selector: string; strategy: RankedLocatorStrategy; confidence: number } | null> {
  const ordered = [...candidates].sort((a, b) => b.confidence - a.confidence)
  for (const candidate of ordered) {
    try {
      const resolved = await page.evaluate((expected) => {
        const browserWindow = window as Window & { __name?: (fn: unknown, name?: string) => unknown }
        browserWindow.__name ??= (fn) => fn
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
        const nameOf = (el: Element) => {
          const h = el as HTMLElement
          const input = el as HTMLInputElement
          const ids = (h.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
          const referenced = ids.map((id) => document.getElementById(id)?.textContent || "").join(" ")
          return String(h.getAttribute("aria-label") || referenced || input.labels?.[0]?.textContent ||
            h.innerText || input.placeholder || h.getAttribute("name") || h.getAttribute("title") || el.tagName)
            .replace(/\s+/g, " ").trim().slice(0, 120)
        }
        const matching = Array.from(document.querySelectorAll(expected.selector)).filter((el) => {
          const h = el as HTMLElement
          const style = getComputedStyle(h)
          const rect = h.getBoundingClientRect()
          if (rect.width <= 2 || rect.height <= 2 || style.display === "none" || style.visibility === "hidden" ||
              style.opacity === "0" || h.getAttribute("aria-hidden") === "true") return false
          if (expected.role && roleOf(el) !== expected.role) return false
          if (expected.name && nameOf(el) !== expected.name) return false
          return true
        })
        if (matching.length !== 1) return null
        const el = matching[0]
        const unique = (selector: string) => {
          try { return document.querySelectorAll(selector).length === 1 } catch { return false }
        }
        const h = el as HTMLElement
        if (h.id) {
          const byId = "#" + CSS.escape(h.id)
          if (unique(byId)) return { selector: byId }
        }
        for (const attr of ["data-testid", "data-test-id", "data-cy", "aria-label", "name"]) {
          const value = h.getAttribute(attr)
          if (!value) continue
          const byAttr = el.tagName.toLowerCase() + "[" + attr + "=" + JSON.stringify(value) + "]"
          if (unique(byAttr)) return { selector: byAttr }
        }
        const parts: string[] = []
        let current: Element | null = el
        while (current && current !== document.documentElement) {
          const parent: Element | null = current.parentElement
          const tagName = current.tagName.toLowerCase()
          if (!parent) { parts.unshift(tagName); break }
          const siblings = (Array.from(parent.children) as Element[]).filter((child: Element) => child.tagName === current!.tagName)
          parts.unshift(siblings.length > 1 ? tagName + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tagName)
          const structural = parts.join(" > ")
          if (unique(structural)) return { selector: structural }
          current = parent
        }
        return parts.length ? { selector: parts.join(" > ") } : null
      }, candidate)
      if (resolved?.selector) {
        return { selector: resolved.selector, strategy: candidate.strategy, confidence: candidate.confidence }
      }
    } catch {
      // Invalid or stale candidates are skipped in favor of the next ranked alternative.
    }
  }
  return null
}

function discoveryStateSignature(snapshot: DomDiscoverySnapshot): string {
  return JSON.stringify({
    title: snapshot.title,
    elements: snapshot.elements.map((element) => [element.selector, element.label, element.kind, element.risk, element.enabled, element.href]),
    counts: snapshot.counts,
    forms: snapshot.forms,
    dialogs: snapshot.dialogs,
    scrollableRegions: snapshot.scrollableRegions,
  })
}

/**
 * Explore one recorded same-origin link, capture its destination inventory,
 * and return to the source URL. A failed restoration is surfaced to the caller.
 */
export async function exploreInternalLinkAndReturn(
  page: Page,
  selector: string,
  expectedHref: string,
  captureScreenshot?: (label: string) => Promise<string>,
): Promise<{ destination: DomDiscoverySnapshot | null; screenshotUrl?: string; observation: string; restored: boolean; blocked?: boolean; stateChanged?: boolean }> {
  const sourceUrl = page.url()
  let sourceOrigin = ""
  let target: URL
  try {
    sourceOrigin = new URL(sourceUrl).origin
    target = new URL(expectedHref, sourceUrl)
  } catch {
    return { destination: null, observation: "Navigation candidate has an invalid URL; no click was attempted.", restored: true, blocked: true }
  }
  if (target.origin !== sourceOrigin) {
    return { destination: null, observation: "External navigation was inventoried but not followed.", restored: true, blocked: true }
  }
  if (/\/(logout|log-out|signout|sign-out|delete|purchase|checkout|payment)(\/|$)/i.test(target.pathname)) {
    return { destination: null, observation: "Navigation path appears consequential and was blocked by the safe exploration policy.", restored: true, blocked: true }
  }
  const beforeSnapshot = await inspectPageDom(page).catch(() => null)
  const element = await page.$(selector).catch(() => null)
  if (!element) return { destination: null, observation: "Navigation element is no longer present; candidate remains unresolved.", restored: false }
  const linkInfo = await element.evaluate((el) => ({ href: (el as HTMLAnchorElement).href || "", target: el.getAttribute("target") || "" })).catch(() => ({ href: "", target: "" }))
  const liveHref = linkInfo.href
  if (linkInfo.target.toLowerCase() === "_blank") {
    await element.dispose().catch(() => {})
    return { destination: null, observation: "New-tab navigation was inventoried but not clicked in this pass.", restored: true, blocked: true }
  }
  let liveTargetMatches = false
  try {
    liveTargetMatches = Boolean(liveHref) && new URL(liveHref, sourceUrl).href === target.href
  } catch {
    liveTargetMatches = false
  }
  if (!liveTargetMatches) {
    await element.dispose().catch(() => {})
    return { destination: null, observation: "Navigation target changed or became invalid since discovery; refusing a stale click.", restored: true, blocked: true }
  }
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => null),
      element.click({ delay: 20 }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 250))
    const afterUrl = page.url()
    if (afterUrl === sourceUrl) {
      const snapshot = await inspectPageDom(page)
      const stateChanged = Boolean(beforeSnapshot && discoveryStateSignature(beforeSnapshot) !== discoveryStateSignature(snapshot))
      return {
        destination: snapshot,
        observation: stateChanged
          ? "Click stayed on the same URL but changed the observed DOM state; recorded as a same-page transition."
          : "Click stayed on the same URL and no meaningful DOM inventory change was observed; the interaction is not verified.",
        restored: true,
        stateChanged,
      }
    }
    const destination = await inspectPageDom(page)
    const screenshotUrl = await captureScreenshot?.("dom-discovery-destination").catch(() => "") || ""
    const summary = "Visited " + destination.url + ' ("' + destination.title + '"); discovered ' +
      destination.elements.length + " interactive elements (" +
      Object.entries(destination.counts).map(([kind, count]) => kind + "=" + count).join(", ") +
      "), forms=" + destination.forms + ", dialogs=" + destination.dialogs + "."
    const restored = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
    return { destination, screenshotUrl, observation: summary + (restored ? " Returned to the source URL." : " WARNING: source URL restoration failed."), restored, stateChanged: true }
  } catch (error: any) {
    const restored = page.url() === sourceUrl || await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
    return { destination: null, observation: "Navigation exploration failed: " + String(error?.message || error) + (restored ? "; source URL restored." : "; source URL restoration failed."), restored }
  } finally {
    await element.dispose().catch(() => {})
  }
}
