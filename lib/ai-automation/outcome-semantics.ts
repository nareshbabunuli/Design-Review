import type { ObservedEffect } from "./types"

/**
 * Pure element-semantics helpers used by outcome verification and unit tests.
 * Kept free of Puppeteer / storage / network imports so tests stay lightweight.
 */

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
        if (
          target.origin === current.origin &&
          target.pathname === current.pathname &&
          target.search === current.search
        ) {
          return ["content_changed", "modal_opened"]
        }
      } catch {
        // Invalid URLs fall through to the conservative navigation expectation.
      }
    }
    return ["navigated"]
  }

  // Submit buttons
  if (
    el.isSubmit ||
    type === "submit" ||
    /submit|save|create|register|login|sign in|send/i.test(el.name || "")
  ) {
    return ["navigated", "content_changed", "network_only", "error_shown"]
  }

  // Modals & Menu triggers
  if (
    el.ariaHasPopup ||
    role === "menuitem" ||
    role === "tab" ||
    /modal|dialog|open|filter|dropdown/i.test(el.name || "")
  ) {
    return ["modal_opened", "content_changed"]
  }

  // Media / Video cards
  if (
    tag === "video" ||
    tag === "audio" ||
    /video|player|watch|listen|play/i.test(el.name || "")
  ) {
    return ["media_started", "navigated", "modal_opened"]
  }

  // Checkbox / Toggles / Selects
  if (
    type === "checkbox" ||
    type === "radio" ||
    role === "switch" ||
    tag === "select" ||
    role === "combobox"
  ) {
    return ["value_changed", "content_changed"]
  }

  // Generic button / clickable
  return ["content_changed", "navigated", "modal_opened", "network_only"]
}
