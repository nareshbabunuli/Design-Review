/**
 * Closed-loop human-like autonomous testing controller.
 *
 * Pattern engine discovers bounded candidate tests.
 * Laya chooses the next candidate.
 * Puppeteer executes only safe candidates.
 * The Action Ledger records every decision and untested candidate.
 *
 * This controller deliberately does not replace Stagehand or the existing
 * scenario runner. It adds a deterministic, auditable decision loop before
 * the broader AI exploration pass.
 */

import type { Page } from "puppeteer"
import { layaPredict, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
import {
  generateCandidateTests,
  type CandidateTest,
  type PatternState,
} from "./interaction-pattern-engine"
import type { AutomationIssue, AutomationJob, AgentAction, ActionableElementType } from "./types"
import { appendLog, saveJob } from "./job-store"
import { inspectPageDom, exploreInternalLinkAndReturn } from "./dom-first-discovery"

const MAX_LOOP_STEPS = 24
const LAYA_THRESHOLD = 0.35

function visibleSelector(el: Element): string {
  const html = el as HTMLElement
  if (html.id) return "#" + CSS.escape(html.id)
  const aria = html.getAttribute("aria-label")
  if (aria) return `[aria-label="${CSS.escape(aria)}"]`
  const name = html.getAttribute("name")
  if (name) return `[name="${CSS.escape(name)}"]`
  const tag = html.tagName.toLowerCase()
  const parent = html.parentElement
  if (!parent) return tag
  const siblings = Array.from(parent.children).filter((x) => x.tagName === html.tagName)
  const index = siblings.indexOf(html)
  return `${tag}:nth-of-type(${index + 1})`
}

async function readPatternState(page: Page, stateKey: string): Promise<PatternState> {
  return page.evaluate((key) => {
    const visibleSelector = (el: Element): string => {
      const unique = (selector: string) => {
        try { return document.querySelectorAll(selector).length === 1 } catch { return false }
      }
      const html = el as HTMLElement
      if (html.id) {
        const byId = "#" + CSS.escape(html.id)
        if (unique(byId)) return byId
      }
      const aria = html.getAttribute("aria-label")
      if (aria) {
        const byAria = html.tagName.toLowerCase() + "[aria-label=" + JSON.stringify(aria) + "]"
        if (unique(byAria)) return byAria
      }
      const name = html.getAttribute("name")
      if (name) {
        const byName = html.tagName.toLowerCase() + "[name=" + JSON.stringify(name) + "]"
        if (unique(byName)) return byName
      }
      const parts: string[] = []
      let current: Element | null = el
      while (current && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase()
        const parent: Element | null = current.parentElement
        if (!parent) { parts.unshift(tag); break }
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
        const segment = siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tag
        parts.unshift(segment)
        const candidate = parts.join(" > ")
        if (unique(candidate)) return candidate
        current = parent
      }
      return parts.join(" > ") || el.tagName.toLowerCase()
    }
    const visible = (el: Element) => {
      const h = el as HTMLElement
      const r = h.getBoundingClientRect()
      const s = getComputedStyle(h)
      return r.width > 2 && r.height > 2 && s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0"
    }
    const labelOf = (el: Element) => {
      const h = el as HTMLElement
      const input = el as HTMLInputElement
      return (h.getAttribute("aria-label") || h.innerText || input.placeholder || input.name || input.value || el.tagName)
        .replace(/\s+/g, " ").trim().slice(0, 100)
    }
    const elements = Array.from(document.querySelectorAll(
      'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="tab"],[role="menuitem"],[role="option"],[onclick],[tabindex]:not([tabindex="-1"])'
    )).filter(visible).slice(0, 120).map((el) => {
      const input = el as HTMLInputElement
      return {
        selector: visibleSelector(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || undefined,
        type: input.type || undefined,
        label: labelOf(el),
        text: labelOf(el),
        href: (el as HTMLAnchorElement).href || undefined,
        visible: true,
        enabled: !(el as HTMLButtonElement).disabled,
        disabled: (el as HTMLButtonElement).disabled,
        required: input.required,
        placeholder: input.placeholder || undefined,
        expanded: el.getAttribute("aria-expanded") == null ? undefined : el.getAttribute("aria-expanded") === "true",
        pressed: el.getAttribute("aria-pressed") == null ? undefined : el.getAttribute("aria-pressed") === "true",
        sortable: el.getAttribute("aria-sort") != null || el.hasAttribute("data-sortable"),
        accessibleName: !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el as HTMLInputElement).labels?.length || el.textContent?.trim() || input.placeholder || input.title),

        clickHandler: el.hasAttribute("onclick"),

      }
    })
    const forms = Array.from(document.querySelectorAll("form")).filter(visible).slice(0, 20).map((form) => ({
      selector: visibleSelector(form),
      name: form.getAttribute("aria-label") || form.getAttribute("name") || undefined,
      fields: Array.from(form.querySelectorAll("input,textarea,select")).map((f) => {
        const i = f as HTMLInputElement
        return {
          selector: visibleSelector(f),
          label: i.getAttribute("aria-label") || i.placeholder || i.name || f.tagName.toLowerCase(),
          name: i.name || undefined,
          type: i.type || undefined,
          required: i.required,
          invalid: !i.checkValidity(),
          confirmationFor: /confirm/i.test(i.getAttribute("aria-label") || i.placeholder || i.name || "") ? "password" : undefined,
        }
      }),
      submitTargets: Array.from(form.querySelectorAll('button[type="submit"],input[type="submit"]')).map((x) => ({
        selector: visibleSelector(x), label: labelOf(x), elementType: "submit"
      })),
      cancelTargets: Array.from(form.querySelectorAll('button')).filter((x) => /cancel|close/i.test(labelOf(x))).map((x) => ({
        selector: visibleSelector(x), label: labelOf(x), elementType: "button"
      })),
      resetTargets: Array.from(form.querySelectorAll('button[type="reset"],input[type="reset"]')).map((x) => ({
        selector: visibleSelector(x), label: labelOf(x), elementType: "reset"
      })),
      multiStep: /next|continue|step/i.test((form.textContent || "").slice(0, 1000)),
    }))
    const tables = Array.from(document.querySelectorAll("table,[role=grid],[role=table]")).filter(visible).slice(0, 20).map((table) => {
      const rows = Array.from(table.querySelectorAll("tbody tr,[role=row]")).filter((row) => !row.querySelector("th,[role=columnheader]"))
      const dataRows = rows.filter((row) => !!row.querySelector("td,[role=cell],[role=gridcell]") && !!(row.textContent || "").trim())
      const headers = Array.from(table.querySelectorAll("th,[role=columnheader]")).map((x) => (x.textContent || "").trim()).filter(Boolean)
      const text = (table.parentElement?.textContent || table.textContent || "").replace(/\s+/g, " ")
      return {
        selector: visibleSelector(table),
        name: table.getAttribute("aria-label") || headers.slice(0, 4).join(", ") || "data table",
        columns: headers,
        rowCount: dataRows.length,
        hasExplicitEmptyState: /no data|no results|no records|no items|nothing to show|empty/i.test(text),
        hasPagination: /next|previous|page \\d|pagination/i.test(text),
        hasSorting: table.querySelector('[aria-sort],th button,[role=columnheader][tabindex]') !== null,
        hasFiltering: /filter/i.test(text),
      }
    })
    const dialogs = Array.from(document.querySelectorAll('[role=dialog],dialog[open],.modal,[data-modal]')).filter(visible).map((d) => ({
      selector: visibleSelector(d),
      label: (d as HTMLElement).getAttribute("aria-label") || (d.textContent || "").slice(0, 80),
      modal: true,
      closeTargets: Array.from(d.querySelectorAll('button,[role=button]')).filter((x) => /close|cancel/i.test(labelOf(x))).map((x) => ({
        selector: visibleSelector(x), label: labelOf(x), elementType: "button"
      })),
      hasForm: !!d.querySelector("form"),
    }))
    return {
      stateKey: key,
      url: location.href,
      origin: location.origin,
      route: location.pathname,
      title: document.title,
      viewport: { width: innerWidth, height: innerHeight },
      elements,
      forms,
      tables,
      dialogs,
      loading: Array.from(document.querySelectorAll('[aria-busy="true"],.loading,.spinner')).some(visible),
    }
  }, stateKey)
}

function chooseCriteria(candidates: CandidateTest[]): Record<string, string> {
  const criteria: Record<string, string> = {}
  candidates.slice(0, 14).forEach((c, i) => {
    criteria[`test_${i}`] = `${c.title} | pattern=${c.pattern} | risk=${c.risk} | priority=${c.priority} | goal=${c.goal}`
  })
  criteria.escalate = "No safe candidate is appropriate; stop this loop and report blocked coverage."
  return criteria
}

function readChoice(answer: any, candidates: CandidateTest[]): { index: number; confidence: number } | null {
  const raw = String(answer?.choice ?? answer?.label ?? answer?.value ?? answer?.answer ?? "")
  if (/^\s*(escalate|stop|none)\b/i.test(raw)) return { index: -1, confidence: 1 }
  const indexed = raw.match(/(?:test|opt|option)[_\s-]*(\d+)/i)
  let index = indexed ? Number(indexed[1]) : -1
  if (index < 0 || index >= candidates.length) {
    const normalized = raw.trim().toLowerCase()
    index = candidates.findIndex((candidate) =>
      normalized === candidate.title.toLowerCase() ||
      normalized.startsWith(candidate.title.toLowerCase() + " |") ||
      normalized.includes(candidate.title.toLowerCase())
    )
  }
  if (index < 0 || index >= candidates.length) return null
  const scoreValue = answer?.confidence ?? answer?.probability ?? answer?.score
  // Laya often omits confidence for choice answers. A valid listed choice is still a decision.
  const confidence = scoreValue == null ? 1 : Number(scoreValue)
  return { index, confidence: Number.isFinite(confidence) ? confidence : 0 }
}

function isDestructive(candidate: CandidateTest): boolean {
  return candidate.risk === "destructive" || /delete|remove|destroy|purchase|pay|checkout|charge|send|publish|deploy|invite|refund|transfer|grant access|revoke access|change password|reset password|log\s*out|sign\s*out|unsubscribe/i.test(candidate.title)
}

async function executeCandidate(page: Page, candidate: CandidateTest): Promise<{ ok: boolean; blocked?: boolean; observation: string }> {
  const unsafeText = [candidate.title, candidate.target?.label || "", candidate.target?.href || ""].join(" ")
  if (
    isDestructive(candidate) ||
    candidate.pattern === "external_link" ||
    ["form_submit", "multi_step_form", "save", "create", "update", "delete_data", "logout", "login"].includes(candidate.pattern) ||
    /\b(submit|send|publish|deploy|purchase|pay|checkout|charge|subscribe|unsubscribe|delete|remove|destroy|refund|transfer|invite|grant access|revoke access|change password|reset password|logout|log\s+out|sign\s+out)\b/i.test(unsafeText) ||
    candidate.target?.elementType?.toLowerCase() === "submit"
  ) {
    return { ok: false, blocked: true, observation: "Blocked by safe-testing policy: action could submit a form, mutate data, leave the target site, or cause an irreversible side effect." }
  }

  const beforeUrl = page.url()
  const beforeTargetState = candidate.target?.selector ? await page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLInputElement | HTMLElement | null
    if (!el) return null
    return {
      checked: "checked" in el ? Boolean((el as HTMLInputElement).checked) : el.getAttribute("aria-checked"),
      pressed: el.getAttribute("aria-pressed"),
      expanded: el.getAttribute("aria-expanded"),
      selected: el.getAttribute("aria-selected"),
      value: "value" in el ? String((el as HTMLInputElement).value || "") : null,
    }
  }, candidate.target.selector).catch(() => null) : null
  const before = await page.evaluate(() => ({
    title: document.title,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200),
    dialogs: document.querySelectorAll('[role="dialog"],dialog[open],.modal,[data-modal]').length,
    forms: document.querySelectorAll("form").length,
    tables: Array.from(document.querySelectorAll("table,[role=grid],[role=table]")).map((t) => t.querySelectorAll("tbody tr,[role=row]").length).join(","),
    controls: Array.from(document.querySelectorAll("button,[role=button],input,select,textarea")).filter((el) => {
      const r = el.getBoundingClientRect(), st = getComputedStyle(el)
      return r.width > 2 && r.height > 2 && st.display !== "none" && st.visibility !== "hidden"
    }).map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 50) + ":checked=" + (("checked" in el) ? String((el as HTMLInputElement).checked) : (el.getAttribute("aria-checked") || "")) + ":pressed=" + (el.getAttribute("aria-pressed") || "") + ":expanded=" + (el.getAttribute("aria-expanded") || "") + ":sort=" + (el.getAttribute("aria-sort") || "") + ":value=" + (("value" in el) ? String((el as HTMLInputElement).value || "") : "")).slice(0, 100).join("|"),
  })).catch(() => null)

  if (candidate.pattern === "back_navigation" || candidate.pattern === "forward_navigation") {
    const back = candidate.pattern === "back_navigation"
    try {
      if (back) await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 })
      else await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 })
      await new Promise((resolve) => setTimeout(resolve, 350))
    } catch (error: any) {
      return { ok: false, observation: (back ? "Back" : "Forward") + " navigation failed: " + (error?.message || String(error)) }
    }
    const afterUrl = page.url()
    if (afterUrl === beforeUrl) {
      return { ok: false, blocked: true, observation: (back ? "Back" : "Forward") + " has no available same-tab history transition in this state; marked blocked rather than failed." }
    }
    let beforeOrigin = "", afterOrigin = ""
    try { beforeOrigin = new URL(beforeUrl).origin; afterOrigin = new URL(afterUrl).origin } catch {}
    let afterPath = ""
    try { afterPath = new URL(afterUrl).pathname } catch {}
    if (!beforeOrigin || afterOrigin !== beforeOrigin || /\/logout|\/signout|\/delete|\/purchase|\/checkout/i.test(afterPath)) {
      await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {})
      return { ok: false, blocked: true, observation: (back ? "Back" : "Forward") + " would leave the safe test path/origin; returned to " + beforeUrl + "." }
    }
    return { ok: true, observation: (back ? "Back" : "Forward") + " changed URL from " + beforeUrl + " to " + afterUrl + "." }
  }

  if (candidate.pattern === "responsive_layout") {
    const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    try {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
      await new Promise((resolve) => setTimeout(resolve, 350))
      const result = await page.evaluate(() => {
        const doc = document.documentElement, body = document.body
        const overflow = Math.max(doc.scrollWidth, body?.scrollWidth || 0) - innerWidth
        const offenders = Array.from(document.querySelectorAll("body *")).filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.right > innerWidth + 3 && getComputedStyle(el).position !== "fixed"
        }).slice(0, 5).map((el) => (el as HTMLElement).tagName.toLowerCase() + (el.id ? "#" + el.id : "")).join(", ")
        return { overflow, offenders }
      })
      return result.overflow <= 2
        ? { ok: true, observation: "Mobile viewport 390×844 has no significant horizontal overflow." }
        : { ok: false, observation: "Mobile viewport has " + result.overflow + "px horizontal overflow; examples: " + result.offenders }
    } catch (error: any) {
      return { ok: false, observation: "Responsive viewport check failed: " + (error?.message || String(error)) }
    } finally {
      await page.setViewport({ width: original.width, height: original.height, deviceScaleFactor: 1 }).catch(() => {})
    }
  }

  if (candidate.pattern === "keyboard_navigation") {
    try {
      const beforeActive = await page.evaluate(() => {
        const el = document.activeElement
        return el ? el.tagName + "|" + (el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).name || "") : ""
      })
      await page.keyboard.press("Tab")
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return { visible: false, label: "" }
        const r = el.getBoundingClientRect(), st = getComputedStyle(el)
        return { visible: r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none", label: el.getAttribute("aria-label") || el.innerText || (el as HTMLInputElement).name || el.tagName }
      })
      return focused.visible
        ? { ok: true, observation: "Tab moved focus to a visible element: " + String(focused.label).slice(0, 100) + "; previous focus: " + beforeActive.slice(0, 80) }
        : { ok: false, observation: "Tab did not produce a visible focused element." }
    } catch (error: any) {
      return { ok: false, observation: "Keyboard focus test failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.pattern === "refresh") {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 })
      await new Promise((resolve) => setTimeout(resolve, 300))
      const title = await page.title()
      return title || page.url()
        ? { ok: true, observation: "Reloaded " + page.url() + '; document title: "' + title + '".' }
        : { ok: false, observation: "Reload completed without a usable document." }
    } catch (error: any) {
      return { ok: false, observation: "Reload failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.pattern === "accessible_name") {
    const selector = candidate.target?.selector
    if (!selector) return { ok: false, observation: "No target available for accessible-name inspection." }
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      const input = el as HTMLInputElement
      const named = !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") ||
        el.innerText?.trim() || input.placeholder || input.labels?.length)
      return { named, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "" }
    }, selector).catch(() => null)
    return !result ? { ok: false, observation: "Could not inspect accessible name." } : result.named
      ? { ok: true, observation: "Interactive " + result.tag + " has an accessible-name source." }
      : { ok: false, observation: "Interactive " + result.tag + " has no detected accessible name." }
  }

  if (["table", "empty_state", "network_failure", "error_state", "loading", "modal"].includes(candidate.pattern)) {
    const evidence = await page.evaluate((pattern, selector) => {
      const visible = (node: Element) => {
        const r = node.getBoundingClientRect(), st = getComputedStyle(node)
        return r.width > 2 && r.height > 2 && st.display !== "none" && st.visibility !== "hidden"
      }
      const selected = selector ? document.querySelector(selector) : null
      const table = selected && selected.matches("table,[role=grid],[role=table]") ? selected : selected?.closest("table,[role=grid],[role=table]")
      const rows = table ? Array.from(table.querySelectorAll("tbody tr,[role=row]")).filter((row) =>
        !!row.querySelector("td,[role=cell],[role=gridcell]") && !!(row.textContent || "").trim()).length : 0
      const tableText = (table?.parentElement?.textContent || table?.textContent || "").replace(/\s+/g, " ")
      const emptyCopy = /no data|no results|no records|no items|nothing to show|empty/i.test(tableText)
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog[open],.modal,[data-modal]')).filter(visible).length
      return {
        tableFound: !!table, rows, emptyCopy, dialogs,
        loading: !!document.querySelector('[aria-busy="true"],.loading,.spinner'),
        bodyText: (document.body?.innerText || "").slice(0, 1000), pattern,
      }
    }, candidate.pattern, candidate.target?.selector).catch(() => null)
    if (!evidence) return { ok: false, observation: "Could not inspect the current DOM state." }
    if (candidate.pattern === "modal") return evidence.dialogs > 0
      ? { ok: true, observation: "Observed " + evidence.dialogs + " visible dialog/modal(s); inspected without clicking the container." }
      : { ok: false, observation: "Expected dialog/modal is not visible." }
    if (candidate.pattern === "table") return evidence.tableFound
      ? { ok: true, observation: "Inspected table/grid: " + evidence.rows + " data row(s); explicit empty state: " + evidence.emptyCopy + "; loading: " + evidence.loading + "." }
      : { ok: false, observation: "Expected table/grid was not found." }
    if (candidate.pattern === "empty_state") return evidence.tableFound && (evidence.rows > 0 || evidence.emptyCopy)
      ? { ok: true, observation: "Table state is explained: " + evidence.rows + " row(s); empty-state copy: " + evidence.emptyCopy + "." }
      : { ok: false, observation: "Table has no visible data and no clear empty-state explanation. Context: " + evidence.bodyText.slice(0, 180) }
    if (candidate.pattern === "loading") return evidence.loading
      ? { ok: true, observation: "Loading indicator is visible; follow-up verification is needed." }
      : { ok: false, observation: "Loading state detected earlier is no longer visible." }
    return { ok: true, observation: "Inspected " + candidate.pattern + " state. Runtime console/network evidence is captured separately for correlation. Context: " + evidence.bodyText.slice(0, 180) }
  }

  if (candidate.target?.href) {
    try {
      const targetUrl = new URL(candidate.target.href, beforeUrl)
      const currentOrigin = new URL(beforeUrl).origin
      if (targetUrl.origin !== currentOrigin || /\/logout|\/signout|\/delete|\/purchase|\/checkout/i.test(targetUrl.pathname)) {
        return { ok: false, blocked: true, observation: "Blocked navigation target outside the safe same-origin test policy: " + targetUrl.href }
      }
    } catch {
      return { ok: false, blocked: true, observation: "Blocked navigation target that could not be resolved safely." }
    }
  }

  const selector = candidate.target?.selector
  if (!selector) return { ok: false, observation: "Candidate has no executable target; it cannot be marked passed." }
  const target = await page.$(selector).catch(() => null)
  if (!target) return { ok: false, observation: "Target is no longer present; state changed before execution." }
  const targetInfo = await target.evaluate((el) => {
    const input = el as HTMLInputElement
    return {
      enabled: !input.disabled && el.getAttribute("aria-disabled") !== "true",
      type: input.type || "",
      value: "value" in input ? String(input.value || "") : "",
      required: !!input.required || !!input.closest("form")?.querySelector("[required]"),
      valid: typeof input.checkValidity === "function" ? input.checkValidity() : true,
    }
  }).catch(() => null)
  if (!targetInfo?.enabled) {
    await target.dispose().catch(() => {})
    return { ok: false, observation: "Target is disabled or not actionable." }
  }

  const setInputValue = async (value: string) => target.evaluate((el, nextValue) => {
    const input = el as HTMLInputElement
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    if (setter) setter.call(input, nextValue)
    else input.value = nextValue
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)

  if (candidate.pattern === "dropdown" && (await target.evaluate((el) => el.tagName.toLowerCase() === "select").catch(() => false))) {
    const info = await target.evaluate((el) => {
      const select = el as HTMLSelectElement
      return { count: select.options.length, value: select.value, hasSelectedOption: select.selectedIndex >= 0 }
    }).catch(() => null)
    await target.dispose().catch(() => {})
    return info && info.count > 0 && info.hasSelectedOption
      ? { ok: true, observation: "Native dropdown exposes " + info.count + " option(s) and a valid selected option; no form submission or persistent mutation performed." }
      : { ok: false, observation: "Native dropdown has no selectable options or no valid selected option." }
  }

  if (candidate.pattern === "required_validation") {
    const required = await target.evaluate((el) => (el as HTMLInputElement).required).catch(() => false)
    const original = targetInfo.value
    if (!required) {
      await target.dispose().catch(() => {})
      return { ok: false, observation: "Target is not itself a required field." }
    }
    try {
      await setInputValue("")
      const emptyIsInvalid = await target.evaluate((el) => !(el as HTMLInputElement).checkValidity()).catch(() => false)
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      return emptyIsInvalid
        ? { ok: true, observation: "Required field correctly fails native validity when empty; original value restored and no submission occurred." }
        : { ok: false, observation: "Required field remained valid when empty; original value restored." }
    } catch (error: any) {
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      return { ok: false, observation: "Required validation check failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.pattern === "invalid_input") {
    if (targetInfo.type !== "email" && targetInfo.type !== "url") {
      await target.dispose().catch(() => {})
      return { ok: false, observation: 'Safe invalid-input check is not implemented for field type "' + (targetInfo.type || "unknown") + '".' }
    }
    const original = targetInfo.value
    try {
      await setInputValue(targetInfo.type === "email" ? "not-an-email" : "not-a-url")
      const invalid = await target.evaluate((el) => !(el as HTMLInputElement).checkValidity()).catch(() => false)
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      return invalid
        ? { ok: true, observation: "Browser rejected malformed email via native validity; original value restored." }
        : { ok: false, observation: "Malformed email was not rejected by native validity; original value restored." }
    } catch (error: any) {
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      return { ok: false, observation: "Invalid-input interaction failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.pattern === "search" || candidate.pattern === "valid_input") {
    const original = targetInfo.value
    const value = targetInfo.type === "email"
      ? "qa-test+" + Date.now() + "@example.com"
      : targetInfo.type === "url"
        ? "https://example.com/qa-test"
        : targetInfo.type === "tel"
          ? "2025550100"
          : targetInfo.type === "password"
            ? "Qa-test-Only-123!"
            : targetInfo.type === "search"
              ? "qa-test-search"
              : "QA test input"
    try {
      await setInputValue(value)
      await new Promise((resolve) => setTimeout(resolve, 500))
      const actual = await target.evaluate((el) => String((el as HTMLInputElement).value || "")).catch(() => "")
      const afterText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200)).catch(() => "")
      const searchShowsOutcome = before?.text !== afterText || /no results|no matches|nothing found|no data/i.test(afterText)
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      if (actual !== value) return { ok: false, observation: 'Input did not retain the synthetic value; observed "' + actual.slice(0, 60) + '".' }
      if (candidate.pattern === "search" && !searchShowsOutcome) return { ok: false, observation: "Search accepted the query but no visible result/empty-state change was observed; verify whether search is wired up." }
      return { ok: true, observation: "Synthetic value accepted by " + candidate.title + "; field verified and original value restored. Visible text: " + afterText.slice(0, 180) }
    } catch (error: any) {
      await setInputValue(original).catch(() => {})
      await target.dispose().catch(() => {})
      return { ok: false, observation: "Input interaction failed: " + (error?.message || String(error)) }
    }
  }

  if (targetInfo.type === "submit" || candidate.target?.elementType?.toLowerCase() === "submit" || candidate.pattern === "form_submit") {
    await target.dispose().catch(() => {})
    return { ok: false, blocked: true, observation: "Form submission blocked because no isolated test-data cleanup transaction is configured." }
  }
  try {
    await target.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }))
    await target.click()
  } catch (error: any) {
    await target.dispose().catch(() => {})
    return { ok: false, observation: "Click failed: " + (error?.message || String(error)) }
  }
  await target.dispose().catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  const afterUrl = page.url()
  const after = await page.evaluate(() => ({
    title: document.title,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200),
    dialogs: document.querySelectorAll('[role="dialog"],dialog[open],.modal,[data-modal]').length,
    forms: document.querySelectorAll("form").length,
    tables: Array.from(document.querySelectorAll("table,[role=grid],[role=table]")).map((t) => t.querySelectorAll("tbody tr,[role=row]").length).join(","),
    controls: Array.from(document.querySelectorAll("button,[role=button],input,select,textarea")).filter((el) => {
      const r = el.getBoundingClientRect(), st = getComputedStyle(el)
      return r.width > 2 && r.height > 2 && st.display !== "none" && st.visibility !== "hidden"
    }).map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 50) + ":checked=" + (("checked" in el) ? String((el as HTMLInputElement).checked) : (el.getAttribute("aria-checked") || "")) + ":pressed=" + (el.getAttribute("aria-pressed") || "") + ":expanded=" + (el.getAttribute("aria-expanded") || "") + ":value=" + (("value" in el) ? String((el as HTMLInputElement).value || "") : "")).slice(0, 80).join("|"),
  })).catch(() => null)
  if (!after) return { ok: false, observation: "Click executed but post-action DOM could not be inspected." }
  const changed = afterUrl !== beforeUrl || before?.title !== after.title || before?.text !== after.text ||
    before?.dialogs !== after.dialogs || before?.forms !== after.forms || before?.tables !== after.tables || before?.controls !== after.controls
  const afterTargetState = candidate.target?.selector ? await page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLInputElement | HTMLElement | null
    if (!el) return null
    return {
      checked: "checked" in el ? Boolean((el as HTMLInputElement).checked) : el.getAttribute("aria-checked"),
      pressed: el.getAttribute("aria-pressed"),
      expanded: el.getAttribute("aria-expanded"),
      selected: el.getAttribute("aria-selected"),
      value: "value" in el ? String((el as HTMLInputElement).value || "") : null,
    }
  }, candidate.target.selector).catch(() => null) : null
  const stateChanged = !!beforeTargetState && !!afterTargetState &&
    (beforeTargetState.checked !== afterTargetState.checked ||
      beforeTargetState.pressed !== afterTargetState.pressed ||
      beforeTargetState.expanded !== afterTargetState.expanded ||
      beforeTargetState.selected !== afterTargetState.selected ||
      beforeTargetState.value !== afterTargetState.value)
  if (["checkbox", "radio", "toggle"].includes(candidate.pattern)) {
    return stateChanged
      ? { ok: true, observation: 'Verified ' + candidate.pattern + ' state transition for "' + candidate.title + '".' }
      : { ok: false, observation: 'Clicked "' + candidate.title + '" but its checked/pressed/selected state did not change; a generic page change is not sufficient evidence.' }
  }
  if (candidate.pattern === "expand_collapse") {
    return stateChanged
      ? { ok: true, observation: 'Verified expanded/collapsed state changed for "' + candidate.title + '".' }
      : { ok: false, observation: 'Clicked "' + candidate.title + '" but aria-expanded state did not change; expected outcome is unverified.' }
  }
  return changed
    ? { ok: true, observation: 'Activated "' + candidate.title + '"; observable UI transition occurred. URL: ' + beforeUrl + " → " + afterUrl + '; title: "' + after.title + '". This confirms a transition, not necessarily the full business outcome.' }
    : { ok: false, observation: 'Clicked "' + candidate.title + '" but no URL/content/dialog/form/table/control change was observed; possible non-functional control.' }
}

function ensureLedger(job: AutomationJob) {
  if (!job.actionLedger) {
    job.actionLedger = {
      entries: [],
      untestedQueue: [],
      updatedAt: new Date().toISOString(),
      total: 0,
      untested: 0,
      tested: 0,
      failed: 0,
      blocked: 0,
    }
  }
  return job.actionLedger
}

function recordLedger(job: AutomationJob, candidate: CandidateTest, status: "passed" | "failed" | "blocked", observation: string, screenUrl: string, screenshots?: { before?: string; after?: string }) {
  const ledger = ensureLedger(job)
  const now = new Date().toISOString()
  const actionKey = candidate.id
  const existing = ledger.entries.find((e) => e.actionKey === actionKey)
  if (existing) {
    existing.status = status
    existing.attempts += 1
    existing.lastTestedAt = now
    existing.error = status === "failed" || status === "blocked" ? observation : undefined
    existing.evidence = { ...(existing.evidence || {}), observedOutcome: observation, beforeScreenshotUrl: screenshots?.before || existing.evidence?.beforeScreenshotUrl, afterScreenshotUrl: screenshots?.after || existing.evidence?.afterScreenshotUrl }
    existing.history = [...(existing.history || []), { status, timestamp: now, observedOutcome: observation, error: existing.error, beforeScreenshotUrl: screenshots?.before, afterScreenshotUrl: screenshots?.after }]
  } else {
    const role = (candidate.target?.role || "").toLowerCase()
    const elementType = (candidate.target?.elementType || "").toLowerCase()
    const actionType: ActionableElementType =
      role === "tab" ? "tab" :
      role === "menuitem" ? "menu" :
      role === "switch" ? "toggle" :
      role === "checkbox" || elementType === "checkbox" ? "checkbox" :
      role === "radio" || elementType === "radio" ? "radio" :
      role === "button" || elementType === "button" ? "button" :
      role === "link" || !!candidate.target?.href || elementType === "a" ? "link" :
      elementType === "select" ? "select" :
      ["input", "textarea"].includes(elementType) ? "input" : "other"
    ledger.entries.push({
      actionKey,
      screenId: candidate.stateKey,
      screenUrl,
      screenPath: (() => { try { return new URL(screenUrl).pathname } catch { return screenUrl } })(),
      name: candidate.title,
      type: actionType,
      selector: candidate.target?.selector,
      href: candidate.target?.href,
      interactionConfidence: candidate.priority / 100,
      discoveryReason: [candidate.goal],
      status,
      attempts: 1,
      discoveredAt: candidate.generatedAt,
      lastTestedAt: now,
      evidence: { observedOutcome: observation, beforeScreenshotUrl: screenshots?.before, afterScreenshotUrl: screenshots?.after },
      history: [{ status, timestamp: now, observedOutcome: observation, error: status === "failed" || status === "blocked" ? observation : undefined, beforeScreenshotUrl: screenshots?.before, afterScreenshotUrl: screenshots?.after }],
    })
  }
  ledger.untestedQueue = ledger.untestedQueue.filter((id) => id !== actionKey)
  const inventoryKey = candidate.target?.selector ? "dom-inventory:" + screenUrl + "::" + candidate.target.selector : ""
  const inventoryEntry = inventoryKey ? ledger.entries.find((entry) => entry.actionKey === inventoryKey) : undefined
  if (inventoryEntry) {
    inventoryEntry.status = status
    inventoryEntry.attempts += 1
    inventoryEntry.lastTestedAt = now
    inventoryEntry.error = status === "failed" || status === "blocked" ? observation : undefined
    inventoryEntry.evidence = { ...(inventoryEntry.evidence || {}), observedOutcome: observation, beforeScreenshotUrl: screenshots?.before || inventoryEntry.evidence?.beforeScreenshotUrl, afterScreenshotUrl: screenshots?.after || inventoryEntry.evidence?.afterScreenshotUrl }
    inventoryEntry.history = [...(inventoryEntry.history || []), { status, timestamp: now, observedOutcome: observation, error: inventoryEntry.error, beforeScreenshotUrl: screenshots?.before, afterScreenshotUrl: screenshots?.after }]
    ledger.untestedQueue = ledger.untestedQueue.filter((id) => id !== inventoryKey)
  }
  ledger.total = ledger.entries.length
  ledger.untested = ledger.entries.filter((e) => e.status === "untested").length
  ledger.tested = ledger.entries.filter((e) => e.status === "passed" || e.status === "failed").length
  ledger.failed = ledger.entries.filter((e) => e.status === "failed").length
  ledger.blocked = ledger.entries.filter((e) => e.status === "blocked").length
  ledger.updatedAt = now
}

function queueMissedCoverage(job: AutomationJob, candidates: CandidateTest[]) {
  const ledger = ensureLedger(job)
  for (const candidate of candidates) {
    if (!ledger.entries.some((e) => e.actionKey === candidate.id) && !ledger.untestedQueue.includes(candidate.id)) {
      ledger.untestedQueue.push(candidate.id)
    }
  }
  ledger.untested = ledger.untestedQueue.length + ledger.entries.filter((e) => e.status === "untested").length
  ledger.total = Math.max(ledger.total, ledger.entries.length + ledger.untestedQueue.length)
  ledger.updatedAt = new Date().toISOString()
}


function recordDomInventory(job: AutomationJob, snapshot: Awaited<ReturnType<typeof inspectPageDom>>): void {
  const ledger = ensureLedger(job)
  for (const element of snapshot.elements) {
    const actionKey = "dom-inventory:" + snapshot.url + "::" + element.selector
    if (ledger.entries.some((entry) => entry.actionKey === actionKey)) continue
    const type: ActionableElementType =
      element.role === "tab" ? "tab" :
      element.role === "menuitem" ? "menu" :
      element.role === "switch" ? "toggle" :
      element.role === "checkbox" ? "checkbox" :
      element.role === "radio" ? "radio" :
      element.href ? "link" :
      element.tag === "input" || element.tag === "textarea" ? "input" :
      element.tag === "select" ? "select" :
      element.tag === "button" || element.role === "button" ? "button" : "other"
    ledger.entries.push({
      actionKey,
      screenId: snapshot.url,
      screenUrl: snapshot.url,
      screenPath: (() => { try { return new URL(snapshot.url).pathname } catch { return snapshot.url } })(),
      name: element.label,
      type,
      selector: element.selector,
      href: element.href,
      interactionConfidence: element.risk === "safe" ? 0.8 : 0.3,
      discoveryReason: ["DOM-first inventory", "kind:" + element.kind, "risk:" + element.risk],
      // Disabled controls are visible inventory, but not actionable coverage.
      // Record them as blocked rather than leaving them permanently unresolved.
      status: element.enabled ? "untested" : "blocked",
      attempts: 0,
      discoveredAt: new Date().toISOString(),
      error: element.enabled ? undefined : "Control is disabled in the observed DOM state.",
    })
    if (element.enabled) ledger.untestedQueue.push(actionKey)
  }
  ledger.total = ledger.entries.length
  ledger.untested = ledger.entries.filter((entry) => entry.status === "untested").length
  ledger.tested = ledger.entries.filter((entry) => entry.status === "passed" || entry.status === "failed").length
  ledger.failed = ledger.entries.filter((entry) => entry.status === "failed").length
  ledger.blocked = ledger.entries.filter((entry) => entry.status === "blocked").length
  ledger.updatedAt = new Date().toISOString()
  saveJob(job)
}

function domGraphNodeId(snapshot: Awaited<ReturnType<typeof inspectPageDom>>): string {
  const signature = JSON.stringify({
    url: snapshot.url,
    title: snapshot.title,
    elements: snapshot.elements.map((element) => [element.selector, element.label, element.kind, element.risk, element.enabled, element.href]),
    forms: snapshot.forms,
    dialogs: snapshot.dialogs,
  })
  let hash = 2166136261
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return snapshot.url + "::dom-" + (hash >>> 0).toString(16)
}

function recordDomGraphNode(job: AutomationJob, snapshot: Awaited<ReturnType<typeof inspectPageDom>>): string {
  const graph = job.domDiscoveryGraph || (job.domDiscoveryGraph = { nodes: [], edges: [], truncated: false })
  const id = domGraphNodeId(snapshot)
  if (!graph.nodes.some((node) => node.id === id)) {
    if (graph.nodes.length >= 200) {
      graph.truncated = true
    } else {
      graph.nodes.push({
        id,
        url: snapshot.url,
        title: snapshot.title,
        observedAt: new Date().toISOString(),
        elementCount: snapshot.elements.length,
      })
    }
  }
  return id
}

function recordDomGraphEdge(
  job: AutomationJob,
  input: {
    from: string
    to: string
    action: string
    selector?: string
    transition: "navigation" | "same_url_state"
    status: "passed" | "failed" | "blocked"
    evidence: string
  },
): void {
  const graph = job.domDiscoveryGraph || (job.domDiscoveryGraph = { nodes: [], edges: [], truncated: false })
  const id = [input.from, input.to, input.action, input.selector || ""].join("::")
  if (graph.edges.some((edge) => edge.id === id)) return
  if (graph.edges.length >= 400) {
    graph.truncated = true
    return
  }
  graph.edges.push({ id, ...input, observedAt: new Date().toISOString() })
}

export async function runHumanLikeDecisionLoop(
  job: AutomationJob,
  page: Page,
  options?: { maxSteps?: number; layaBaseUrl?: string; captureScreenshot?: (label: string) => Promise<string> },
): Promise<{ actions: AgentAction[]; issues: AutomationIssue[]; completed: boolean; missedCoverage: string[] }> {
  const actions: AgentAction[] = []
  const issues: AutomationIssue[] = []
  const runtimeEvidence = { consoleErrors: [] as string[], pageErrors: [] as string[], failedRequests: [] as string[], badResponses: [] as string[] }
  const onConsole = (message: any) => { if (message.type?.() === "error") runtimeEvidence.consoleErrors.push(String(message.text?.() || "Console error").slice(0, 300)) }
  const onPageError = (error: unknown): void => { runtimeEvidence.pageErrors.push(String(error instanceof Error ? error.message : error).slice(0, 300)); }
  const onRequestFailed = (request: any) => runtimeEvidence.failedRequests.push((String(request.resourceType?.() || "other") + " " + String(request.method?.() || "GET") + " " + String(request.url?.() || "") + ": " + String(request.failure?.()?.errorText || "request failed")).slice(0, 400))
  const onResponse = (response: any) => { if (response.status?.() >= 400) runtimeEvidence.badResponses.push((String(response.request?.()?.resourceType?.() || "other") + " " + String(response.status()) + " " + String(response.request?.()?.method?.() || "GET") + " " + String(response.url?.() || "")).slice(0, 400)) }
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("requestfailed", onRequestFailed)
  page.on("response", onResponse)
  const maxSteps = Math.max(0, Math.min(options?.maxSteps ?? MAX_LOOP_STEPS, 50))
  const layaUrl = (options?.layaBaseUrl || job.layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL).replace(/\/$/, "")
  const tested = new Set<string>((job.actionLedger?.entries || []).map((entry) => entry.actionKey))
  const routeQueue: Array<{ url: string; returnTo: string }> = []
  const queuedRoutes = new Set<string>([page.url()])
  let activeRoute: { url: string; returnTo: string } | null = null

  for (let step = 0; step < maxSteps; step++) {
    if (!activeRoute && routeQueue.length > 0) {
      const nextRoute = routeQueue.shift()!
      const navigated = await page.goto(nextRoute.url, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
      if (navigated) {
        activeRoute = nextRoute
        appendLog(job, "info", `[DOMDiscovery] Exploring queued route ${nextRoute.url}; return target ${nextRoute.returnTo}.`)
      } else {
        appendLog(job, "warn", `[DOMDiscovery] Could not open queued route ${nextRoute.url}; route remains unresolved.`)
      }
    }
    const url = await page.url()
    const domInventory = await inspectPageDom(page).catch(() => null)
    let sourceGraphNodeId = url
    if (domInventory) {
      recordDomInventory(job, domInventory)
      sourceGraphNodeId = recordDomGraphNode(job, domInventory)
      if (step === 0) appendLog(job, "info", `[DOMDiscovery] Inventoried ${domInventory.elements.length} visible interactive elements on ${domInventory.url}; ${Object.entries(domInventory.counts).map(([kind, count]) => `${kind}=${count}`).join(", ")}; forms=${domInventory.forms}; dialogs=${domInventory.dialogs}. Navigation links are recorded, not followed during inventory.`)
    }
    const state = await readPatternState(page, url)
    state.consoleErrorCount = runtimeEvidence.consoleErrors.length + runtimeEvidence.pageErrors.length
    state.network = {
      failedCount: runtimeEvidence.failedRequests.length,
      status4xx: runtimeEvidence.badResponses.filter((entry) => /(?:^|\s)4\d\d\s/.test(entry)).length,
      status5xx: runtimeEvidence.badResponses.filter((entry) => /(?:^|\s)5\d\d\s/.test(entry)).length,
      resource404Count: runtimeEvidence.badResponses.filter((entry) => /(?:^|\s)404\s/.test(entry)).length,
    }
    const stateSignature = JSON.stringify({
      elements: state.elements.map((el) => [el.selector, el.label, el.type, el.disabled, el.expanded, el.pressed, el.accessibleName]),
      forms: state.forms.map((form) => [form.name, form.fields.map((field) => [field.name, field.type, field.required])]),
      tables: state.tables.map((table) => [table.name, table.rowCount, table.hasExplicitEmptyState]),
      dialogs: state.dialogs.map((dialog) => dialog.label),
      loading: state.loading,
    })
    let fingerprint = 2166136261
    for (let i = 0; i < stateSignature.length; i++) { fingerprint ^= stateSignature.charCodeAt(i); fingerprint = Math.imul(fingerprint, 16777619) }
    const stateKey = url + "::ui-" + (fingerprint >>> 0).toString(16)
    state.stateKey = stateKey
    const candidates = generateCandidateTests(state, { alreadyTestedIds: tested, maxCandidates: 40, allowMutating: true, allowDestructive: false })
    queueMissedCoverage(job, candidates)

    if (candidates.length === 0) {
      if (activeRoute) {
        const routeToReturn = activeRoute.returnTo
        const restored = await page.goto(routeToReturn, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
        appendLog(job, restored ? "info" : "error", `[DOMDiscovery] ${restored ? "Finished route and returned to" : "Failed to return from route to"} ${routeToReturn}.`)
        activeRoute = null
        if (restored) continue
      }
      if (routeQueue.length > 0) continue
      break
    }
    const nonNavigation = candidates.filter((candidate) => !["link_navigation", "back_navigation", "forward_navigation", "external_link"].includes(candidate.pattern))
    const decisionCandidates = nonNavigation.length > 0 ? nonNavigation.slice(0, 18) : candidates.filter((candidate) => candidate.pattern === "link_navigation").slice(0, 18)
    if (decisionCandidates.length === 0) {
      // These candidates are intentionally not auto-executed by policy. Record
      // them as blocked, not untested, so the ledger distinguishes a deliberate
      // safety boundary from work the explorer accidentally missed.
      for (const candidate of candidates) {
        if (tested.has(candidate.id)) continue
        const reason = candidate.pattern === "external_link"
          ? "Blocked by safe-testing policy: external destinations are inventoried but never followed automatically."
          : "Deferred by safe-testing policy: browser-history navigation is not auto-triggered by the discovery pass."
        tested.add(candidate.id)
        recordLedger(job, candidate, "blocked", reason, url)
      }
      appendLog(job, "info", "[DOMDiscovery] Remaining candidates are navigation/history/external actions; external links and browser-history controls are recorded as blocked rather than followed automatically.")
      if (activeRoute) {
        const routeToReturn = activeRoute.returnTo
        const restored = await page.goto(routeToReturn, { waitUntil: "domcontentloaded", timeout: 12000 }).then(() => true).catch(() => false)
        appendLog(job, restored ? "info" : "error", `[DOMDiscovery] ${restored ? "Returned to" : "Could not return to"} ${routeToReturn} after route exploration.`)
        activeRoute = null
        if (restored) continue
      }
      if (routeQueue.length > 0) continue
      break
    }
    const criteria = chooseCriteria(decisionCandidates)
    let selected: CandidateTest | null = null
    let selectionSource: "laya" | "fallback" = "fallback"
    try {
      const result = await layaPredict(layaUrl, {
        state: JSON.stringify({
          url: state.url,
          title: state.title,
          route: state.route,
          interactiveCount: state.elements.length,
          forms: state.forms.length,
          tables: state.tables.map((t) => ({ name: t.name, rows: t.rowCount, empty: t.hasExplicitEmptyState })),
          dialogs: state.dialogs.length,
          consoleErrors: runtimeEvidence.consoleErrors.slice(-5),
          pageErrors: runtimeEvidence.pageErrors.slice(-5),
          failedRequests: runtimeEvidence.failedRequests.slice(-5),
          badResponses: runtimeEvidence.badResponses.slice(-5),
          previousTestIds: [...tested].slice(-20),
        }),
        questions: {
          next_test: {
            type: "choice",
            instructions: "Choose the safest meaningful untested candidate. Prefer high-value coverage and do not choose escalate unless no candidate is useful.",
            criteria,
          },
        },
      })
      const choice = readChoice(result?.answers?.next_test, decisionCandidates)
      if (choice?.index === -1) {
        appendLog(job, "info", "[HumanLoop] Laya escalated: no safe candidate selected; remaining coverage stays queued.")
        break
      }
      if (choice && choice.confidence >= LAYA_THRESHOLD && choice.index >= 0 && choice.index < decisionCandidates.length) {
        selected = decisionCandidates[choice.index]
        selectionSource = "laya"
      }
    } catch (error: any) {
      appendLog(job, "warn", `[HumanLoop] Laya unavailable: ${error?.message || String(error)}. Falling back to deterministic priority.`)
    }

    if (!selected) {
      selected = decisionCandidates[0]
      appendLog(job, "info", `[HumanLoop] Deterministic fallback selected: ${selected.title}`)
    }

    const started = Date.now()
    job.currentStep = "Laya selected: " + selected.title
    const evidenceBaseline = {
      consoleErrors: runtimeEvidence.consoleErrors.length,
      pageErrors: runtimeEvidence.pageErrors.length,
      failedRequests: runtimeEvidence.failedRequests.length,
      badResponses: runtimeEvidence.badResponses.length,
    }
    const beforeScreenshotUrl = await options?.captureScreenshot?.("human-loop-before-" + step).catch(() => "") || ""
    let observation: { ok: boolean; blocked?: boolean; observation: string }
    let destinationScreenshotUrl = ""
    if (selected.pattern === "link_navigation" && selected.target?.selector && selected.target.href) {
      const explored = await exploreInternalLinkAndReturn(page, selected.target.selector, selected.target.href,
        options?.captureScreenshot ? (label) => options.captureScreenshot ? options.captureScreenshot(label + "-" + step) : Promise.resolve("") : undefined)
      destinationScreenshotUrl = explored.screenshotUrl || ""
      observation = { ok: Boolean(explored.destination && explored.restored && explored.stateChanged !== false), blocked: Boolean(explored.blocked) || !explored.restored, observation: explored.observation }
      if (explored.destination) {
        appendLog(job, "info", `[DOMDiscovery] ${explored.observation}`)
        const destinationGraphNodeId = recordDomGraphNode(job, explored.destination)
        if (explored.destination.url !== url || explored.stateChanged) {
          recordDomGraphEdge(job, {
            from: sourceGraphNodeId,
            to: destinationGraphNodeId,
            action: selected.title,
            selector: selected.target.selector,
            transition: explored.destination.url === url ? "same_url_state" : "navigation",
            status: observation.ok ? "passed" : observation.blocked ? "blocked" : "failed",
            evidence: explored.observation,
          })
        }
        if (explored.destination.url !== url && explored.restored && !queuedRoutes.has(explored.destination.url)) {
          queuedRoutes.add(explored.destination.url)
          routeQueue.push({ url: explored.destination.url, returnTo: url })
          appendLog(job, "info", `[DOMDiscovery] Queued destination for full DOM exploration: ${explored.destination.url}.`)
        }
        recordDomInventory(job, explored.destination)
        if (!explored.restored) appendLog(job, "error", `[DOMDiscovery] Could not restore source after visiting ${explored.destination.url}; coverage remains incomplete.`)
      }
    } else {
      observation = await executeCandidate(page, selected)
    }
    const afterScreenshotUrl = destinationScreenshotUrl || await options?.captureScreenshot?.("human-loop-after-" + step).catch(() => "") || ""

    // Correlate only evidence that appeared during this action with unexplained empty tables
    // on the same observed screen; unrelated old errors are not attached to this issue.
    const stepConsoleErrors = [
      ...runtimeEvidence.consoleErrors.slice(evidenceBaseline.consoleErrors),
      ...runtimeEvidence.pageErrors.slice(evidenceBaseline.pageErrors),
    ]
    const stepFailedRequests = runtimeEvidence.failedRequests.slice(evidenceBaseline.failedRequests)
    const stepBadResponses = runtimeEvidence.badResponses.slice(evidenceBaseline.badResponses)
    const observedPostState = await readPatternState(page, await page.url()).catch(() => state)
    const unexplainedEmptyTables = observedPostState.tables.filter((table) => table.rowCount === 0 && !table.hasExplicitEmptyState)
    if (unexplainedEmptyTables.length && (stepConsoleErrors.length || stepFailedRequests.length || stepBadResponses.length)) {
      const isDataRequest = (entry: string) => /^(xhr|fetch)\s/i.test(entry) || /\/api(?:\/|[?#])|graphql|rpc|\.json(?:[?#]|$)/i.test(entry)
    const networkFailures: Array<{ url: string; resourceType?: string; errorText: string; status?: number }> = [
        ...stepFailedRequests.filter(isDataRequest).map((entry) => ({
          url: entry.match(/https?:\/\/\S+/)?.[0] || entry.slice(0, 180),
          resourceType: /^(xhr|fetch)\s/i.test(entry) ? entry.split(/\s+/)[0] : undefined,
          errorText: entry.slice(0, 300),
        })),
        ...stepBadResponses.filter(isDataRequest).map((entry) => {
          const match = entry.match(/(?:^|\s)(\d{3})\s+\w+\s+(https?:\/\/\S+)/)
          return { url: match?.[2] || entry.slice(0, 180), status: match ? Number(match[1]) : undefined, resourceType: /^(xhr|fetch)\s/i.test(entry) ? entry.split(/\s+/)[0] : undefined, errorText: entry.slice(0, 300) }
        }),
      ]
      const hasServerFailure = networkFailures.some((failure) => (failure.status || 0) >= 500)
      issues.push({
        id: "correlated-ui-data-" + Date.now() + "-" + step,
        screenUrl: url,
        screenTitle: observedPostState.title || state.title || url,
        type: "correlated_ui_data_failure",
        severity: hasServerFailure ? "high" : "medium",
        description: "A data table has no rows or explicit empty state while new console/network failures occurred during the same action.",
        expected: "The table should render data or explain a valid empty/error state; related requests should succeed.",
        actual: "Empty surfaces: " + unexplainedEmptyTables.map((table) => table.name || table.selector || "table").join(", ") +
          "; console errors: " + stepConsoleErrors.length + "; failed requests/status errors: " + networkFailures.length + ".",
        correlatedEvidence: {
          consoleErrors: stepConsoleErrors.slice(0, 8),
          networkFailures: networkFailures.slice(0, 8),
          emptyDataSurfaces: unexplainedEmptyTables.map((table) => table.name || table.selector || "table"),
        },
        timestamp: new Date().toISOString(),
      })
    }
    tested.add(selected.id)
    const status = observation.ok ? "passed" : (observation.blocked || isDestructive(selected) ? "blocked" : "failed")
    recordLedger(job, selected, status, observation.observation, url, { before: beforeScreenshotUrl, after: afterScreenshotUrl })

    const action: AgentAction = {
      id: `human-loop-${Date.now()}-${step}`,
      type: selected.pattern === "back_navigation" ? "back"
        : selected.pattern === "forward_navigation" || selected.pattern === "refresh" ? "navigate"
        : selected.pattern === "responsive_layout" ? "resize"
        : selected.pattern === "keyboard_navigation" || ["table","empty_state","network_failure","error_state","loading","modal","accessible_name"].includes(selected.pattern) ? "inspect"
        : ["input","textarea","select"].includes(selected.target?.elementType?.toLowerCase() || "") ? "type" : "click",
      description: selected.title,
      thought: (selectionSource === "laya" ? "Laya selected: " : "Deterministic fallback selected: ") + selected.goal,
      target: selected.target?.selector || selected.target?.href,
      observation: observation.observation,
      screenshotUrl: afterScreenshotUrl || undefined,
      status: status === "blocked" ? "blocked" : status,
      durationMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    }
    actions.push(action)
    if (!job.actionHistory) job.actionHistory = []
    job.actionHistory.unshift(action)
    job.actionHistory = job.actionHistory.slice(0, 50)
    appendLog(job, observation.ok ? "success" : "warn", `[HumanLoop] ${selected.title}: ${observation.observation}`)

    if (!observation.ok && !observation.blocked && !isDestructive(selected)) {
      issues.push({
        id: `human-loop-${Date.now()}`,
        screenUrl: url,
        screenTitle: state.title || url,
        type: "non_functional_control",
        severity: "medium",
        description: `Candidate test failed: ${selected.title}`,
        expected: selected.expectedOutcome,
        actual: observation.observation,
        timestamp: new Date().toISOString(),
      })
    }

    saveJob(job)
  }

  page.off("console", onConsole)
  page.off("pageerror", onPageError)
  page.off("requestfailed", onRequestFailed)
  page.off("response", onResponse)
  const ledger = ensureLedger(job)
  ledger.total = ledger.entries.length + ledger.untestedQueue.length
  ledger.untested = ledger.untestedQueue.length + ledger.entries.filter((entry) => entry.status === "untested").length
  ledger.tested = ledger.entries.filter((entry) => entry.status === "passed" || entry.status === "failed").length
  ledger.failed = ledger.entries.filter((entry) => entry.status === "failed").length
  ledger.blocked = ledger.entries.filter((entry) => entry.status === "blocked").length
  ledger.updatedAt = new Date().toISOString()
  // Reconcile both representations: queued candidate IDs and inventory entries can
  // independently remain untested. Looking only at untestedQueue can falsely report
  // completion when an existing ledger entry was not added to that queue.
  const missedCoverage = [...new Set([
    ...ledger.untestedQueue,
    ...ledger.entries.filter((entry) => entry.status === "untested").map((entry) => entry.actionKey),
  ])]
  const completed = maxSteps > 0 && missedCoverage.length === 0
  const signalCount = runtimeEvidence.consoleErrors.length + runtimeEvidence.pageErrors.length + runtimeEvidence.failedRequests.length + runtimeEvidence.badResponses.length
  if (signalCount) appendLog(job, "warn", "[HumanLoop] Captured " + signalCount + " console/network signal(s) for correlation.")
  return { actions, issues, completed, missedCoverage }
}