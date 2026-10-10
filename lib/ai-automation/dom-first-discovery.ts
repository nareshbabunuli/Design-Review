import type { Page } from "puppeteer"

export type DomDiscoveryElement = {
  selector: string
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
      'a[href],area[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[onclick],[tabindex]:not([tabindex="-1"])'
    )).filter(visible).slice(0, 300)
    const elements = nodes.map((el) => {
      const h = el as HTMLElement
      const input = el as HTMLInputElement
      const label = labelOf(el)
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
        selector: selectorOf(el),
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

/**
 * Explore one recorded same-origin link, capture its destination inventory,
 * and return to the source URL. A failed restoration is surfaced to the caller.
 */
export async function exploreInternalLinkAndReturn(
  page: Page,
  selector: string,
  expectedHref: string,
  captureScreenshot?: (label: string) => Promise<string>,
): Promise<{ destination: DomDiscoverySnapshot | null; screenshotUrl?: string; observation: string; restored: boolean }> {
  const sourceUrl = page.url()
  let sourceOrigin = ""
  let target: URL
  try {
    sourceOrigin = new URL(sourceUrl).origin
    target = new URL(expectedHref, sourceUrl)
  } catch {
    return { destination: null, observation: "Navigation candidate has an invalid URL; no click was attempted.", restored: true }
  }
  if (target.origin !== sourceOrigin) {
    return { destination: null, observation: "External navigation was inventoried but not followed.", restored: true }
  }
  if (/\/(logout|log-out|signout|sign-out|delete|purchase|checkout|payment)(\/|$)/i.test(target.pathname)) {
    return { destination: null, observation: "Navigation path appears consequential and was blocked by the safe exploration policy.", restored: true }
  }
  const element = await page.$(selector).catch(() => null)
  if (!element) return { destination: null, observation: "Navigation element is no longer present; candidate remains unresolved.", restored: false }
  const linkInfo = await element.evaluate((el) => ({ href: (el as HTMLAnchorElement).href || "", target: el.getAttribute("target") || "" })).catch(() => ({ href: "", target: "" }))
  const liveHref = linkInfo.href
  if (linkInfo.target.toLowerCase() === "_blank") {
    await element.dispose().catch(() => {})
    return { destination: null, observation: "New-tab navigation was inventoried but not clicked in this pass.", restored: true }
  }
  let liveTargetMatches = false
  try {
    liveTargetMatches = Boolean(liveHref) && new URL(liveHref, sourceUrl).href === target.href
  } catch {
    liveTargetMatches = false
  }
  if (!liveTargetMatches) {
    await element.dispose().catch(() => {})
    return { destination: null, observation: "Navigation target changed or became invalid since discovery; refusing a stale click.", restored: true }
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
      return { destination: snapshot, observation: "Click did not change the URL; recorded as a same-page interaction for later state verification.", restored: true }
    }
    const destination = await inspectPageDom(page)
    const screenshotUrl = await captureScreenshot?.("dom-discovery-destination").catch(() => "") || ""
    const summary = "Visited " + destination.url + ' ("' + destination.title + '"); discovered ' +
      destination.elements.length + " interactive elements (" +
      Object.entries(destination.counts).map(([kind, count]) => kind + "=" + count).join(", ") +
      "), forms=" + destination.forms + ", dialogs=" + destination.dialogs + "."
    const restored = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
    return { destination, screenshotUrl, observation: summary + (restored ? " Returned to the source URL." : " WARNING: return to source URL failed."), restored }
  } catch (error: any) {
    const restored = page.url() === sourceUrl || await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
    return { destination: null, observation: "Navigation exploration failed: " + String(error?.message || error) + (restored ? "; source URL restored." : "; source URL restoration failed."), restored }
  } finally {
    await element.dispose().catch(() => {})
  }
}
