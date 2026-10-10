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
import type { AutomationIssue, AutomationJob, AgentAction } from "./types"
import { appendLog, saveJob } from "./job-store"

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
      const html = el as HTMLElement
      if (html.id) return "#" + CSS.escape(html.id)
      const aria = html.getAttribute("aria-label")
      if (aria) return '[aria-label="' + CSS.escape(aria) + '"]'
      const name = html.getAttribute("name")
      if (name) return '[name="' + CSS.escape(name) + '"]'
      const tag = html.tagName.toLowerCase()
      const parent = html.parentElement
      if (!parent) return tag
      const siblings = Array.from(parent.children).filter((x) => x.tagName === html.tagName)
      return tag + ":nth-of-type(" + (siblings.indexOf(html) + 1) + ")"
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
      'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"]'
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
      loading: !!document.querySelector('[aria-busy="true"],.loading,.spinner'),
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

function readChoice(answer: any): { index: number; confidence: number } | null {
  const raw = String(answer?.choice ?? answer?.label ?? answer?.value ?? "")
  const match = raw.match(/test_(\d+)/i)
  if (!match) return null
  const scoreValue = answer?.confidence ?? answer?.probability ?? answer?.score
  // Laya often omits confidence for choice answers. A valid listed choice is still a decision.
  const confidence = scoreValue == null ? 1 : Number(scoreValue)
  return { index: Number(match[1]), confidence: Number.isFinite(confidence) ? confidence : 0 }
}

function isDestructive(candidate: CandidateTest): boolean {
  return candidate.risk === "destructive" || /delete|remove|destroy|purchase|pay|checkout|charge|send email|publish|deploy|logout|unsubscribe/i.test(candidate.title)
}

async function executeCandidate(page: Page, candidate: CandidateTest): Promise<{ ok: boolean; blocked?: boolean; observation: string }> {
  const unsafeText = [candidate.title, candidate.target?.label || "", candidate.target?.href || ""].join(" ")
  if (
    isDestructive(candidate) ||
    candidate.pattern === "external_link" ||
    ["form_submit", "multi_step_form", "save", "create", "update", "delete_data", "logout", "login"].includes(candidate.pattern) ||
    /\b(submit|send|publish|deploy|purchase|pay|checkout|charge|subscribe|unsubscribe|delete|remove|destroy|logout|sign out)\b/i.test(unsafeText) ||
    candidate.target?.elementType?.toLowerCase() === "submit"
  ) {
    return { ok: false, blocked: true, observation: "Blocked by safe-testing policy: action could submit a form, mutate data, leave the target site, or cause an irreversible side effect." }
  }

  const beforeUrl = page.url()
  const before = await page.evaluate(() => ({
    title: document.title,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200),
    dialogs: document.querySelectorAll('[role="dialog"],dialog[open],.modal,[data-modal]').length,
    forms: document.querySelectorAll("form").length,
    tables: Array.from(document.querySelectorAll("table,[role=grid],[role=table]")).map((t) => t.querySelectorAll("tbody tr,[role=row]").length).join(","),
    controls: Array.from(document.querySelectorAll("button,[role=button],input,select,textarea")).filter((el) => {
      const r = el.getBoundingClientRect(), st = getComputedStyle(el)
      return r.width > 2 && r.height > 2 && st.display !== "none" && st.visibility !== "hidden"
    }).map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 50)).slice(0, 80).join("|"),
  })).catch(() => null)

  if (candidate.pattern === "back_navigation" || candidate.pattern === "forward_navigation") {
    const back = candidate.pattern === "back_navigation"
    try {
      if (back) await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 })
      else await page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 })
      await page.waitForTimeout(350)
    } catch (error: any) {
      return { ok: false, observation: (back ? "Back" : "Forward") + " navigation failed: " + (error?.message || String(error)) }
    }
    const afterUrl = page.url()
    return afterUrl !== beforeUrl
      ? { ok: true, observation: (back ? "Back" : "Forward") + " changed URL from " + beforeUrl + " to " + afterUrl + "." }
      : { ok: false, observation: (back ? "Back" : "Forward") + " did not change the URL; no history transition was observed." }
  }

  if (candidate.pattern === "refresh") {
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 })
      await page.waitForTimeout(300)
      const title = await page.title()
      return title || page.url()
        ? { ok: true, observation: "Reloaded " + page.url() + '; document title: "' + title + '".' }
        : { ok: false, observation: "Reload completed without a usable document." }
    } catch (error: any) {
      return { ok: false, observation: "Reload failed: " + (error?.message || String(error)) }
    }
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

  const selector = candidate.target?.selector
  if (!selector) return { ok: false, observation: "Candidate has no executable target; it cannot be marked passed." }
  const locator = page.locator(selector)
  if (!(await locator.count().catch(() => 0))) return { ok: false, observation: "Target is no longer present; state changed before execution." }
  const target = locator.first()
  if (!(await target.isEnabled().catch(() => false))) return { ok: false, observation: "Target is disabled or not actionable." }

  if (candidate.pattern === "required_validation") {
    const result = await target.evaluate((el) => {
      const input = el as HTMLInputElement
      const required = input.required || !!input.closest("form")?.querySelector("[required]")
      return { required, valuePresent: !!input.value.trim(), nativeInvalid: required && !input.checkValidity() }
    }).catch(() => null)
    if (!result) return { ok: false, observation: "Could not inspect required-field validity." }
    return result.required
      ? { ok: true, observation: "Inspected required-field validation without submitting the form; field " + (result.valuePresent ? "currently contains a value." : "is empty.") }
      : { ok: false, observation: "Target is not a required field." }
  }

  if (candidate.pattern === "invalid_input") {
    const type = await target.getAttribute("type").catch(() => null)
    if (type !== "email") return { ok: false, observation: 'Safe invalid-input check is not implemented for field type "' + (type || "unknown") + '".' }
    const original = await target.inputValue().catch(() => "")
    try {
      await target.fill("not-an-email")
      const invalid = await target.evaluate((el) => !(el as HTMLInputElement).checkValidity()).catch(() => false)
      await target.fill(original).catch(() => {})
      return invalid
        ? { ok: true, observation: "Browser rejected malformed email via native validity; original value restored." }
        : { ok: false, observation: "Malformed email was not rejected by native validity; original value restored." }
    } catch (error: any) {
      await target.fill(original).catch(() => {})
      return { ok: false, observation: "Invalid-input interaction failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.pattern === "search" || candidate.pattern === "valid_input") {
    const type = await target.getAttribute("type").catch(() => null)
    const original = await target.inputValue().catch(() => "")
    const value = type === "email" ? "qa-test+" + Date.now() + "@example.com" : "QA test input"
    try {
      await target.fill(value)
      await page.waitForTimeout(500)
      const actual = await target.inputValue().catch(() => "")
      const afterText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1200)).catch(() => "")
      await target.fill(original).catch(() => {})
      return actual === value
        ? { ok: true, observation: "Synthetic value accepted by " + candidate.title + "; field verified and original value restored. Visible text: " + afterText.slice(0, 180) }
        : { ok: false, observation: 'Input did not retain the synthetic value; observed "' + actual.slice(0, 60) + '".' }
    } catch (error: any) {
      await target.fill(original).catch(() => {})
      return { ok: false, observation: "Input interaction failed: " + (error?.message || String(error)) }
    }
  }

  if (candidate.target?.elementType?.toLowerCase() === "submit" || candidate.pattern === "form_submit") {
    return { ok: false, blocked: true, observation: "Form submission blocked because no isolated test-data cleanup transaction is configured." }
  }
  try {
    await target.scrollIntoViewIfNeeded()
    await target.click({ timeout: 7000 })
  } catch (error: any) {
    return { ok: false, observation: "Click failed: " + (error?.message || String(error)) }
  }
  await page.waitForTimeout(500)
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
    }).map((el) => el.tagName + ":" + (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).placeholder || "").trim().slice(0, 50)).slice(0, 80).join("|"),
  })).catch(() => null)
  if (!after) return { ok: false, observation: "Click executed but post-action DOM could not be inspected." }
  const changed = afterUrl !== beforeUrl || before?.title !== after.title || before?.text !== after.text ||
    before?.dialogs !== after.dialogs || before?.forms !== after.forms || before?.tables !== after.tables || before?.controls !== after.controls
  return changed
    ? { ok: true, observation: 'Activated "' + candidate.title + '"; an observable UI transition occurred. URL: ' + beforeUrl + " → " + afterUrl + '; title: "' + after.title + '".' }
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

function recordLedger(job: AutomationJob, candidate: CandidateTest, status: "passed" | "failed" | "blocked", observation: string, screenUrl: string) {
  const ledger = ensureLedger(job)
  const now = new Date().toISOString()
  const actionKey = candidate.id
  const existing = ledger.entries.find((e) => e.actionKey === actionKey)
  if (existing) {
    existing.status = status
    existing.attempts += 1
    existing.lastTestedAt = now
    existing.error = status === "failed" || status === "blocked" ? observation : undefined
    existing.evidence = { ...(existing.evidence || {}), observedOutcome: observation }
    existing.history = [...(existing.history || []), { status, timestamp: now, observedOutcome: observation, error: existing.error }]
  } else {
    ledger.entries.push({
      actionKey,
      screenId: candidate.stateKey,
      screenUrl,
      screenPath: (() => { try { return new URL(screenUrl).pathname } catch { return screenUrl } })(),
      name: candidate.title,
      type: (() => { const v = (candidate.target?.elementType || "").toLowerCase(); return (["button","clickable","link","input","select","checkbox","radio","toggle","tab","menu","form","file_upload","other"].includes(v) ? v : candidate.target?.href ? "link" : "other") as import("./types").ActionableElementType })(),
      selector: candidate.target?.selector,
      href: candidate.target?.href,
      interactionConfidence: candidate.priority / 100,
      discoveryReason: [candidate.goal],
      status,
      attempts: 1,
      discoveredAt: candidate.generatedAt,
      lastTestedAt: now,
      evidence: { observedOutcome: observation },
      history: [{ status, timestamp: now, observedOutcome: observation, error: status === "failed" || status === "blocked" ? observation : undefined }],
    })
  }
  ledger.untestedQueue = ledger.untestedQueue.filter((id) => id !== actionKey)
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

export async function runHumanLikeDecisionLoop(
  job: AutomationJob,
  page: Page,
  options?: { maxSteps?: number; layaBaseUrl?: string },
): Promise<{ actions: AgentAction[]; issues: AutomationIssue[]; completed: boolean; missedCoverage: string[] }> {
  const actions: AgentAction[] = []
  const issues: AutomationIssue[] = []
  const runtimeEvidence = { consoleErrors: [] as string[], pageErrors: [] as string[], failedRequests: [] as string[], badResponses: [] as string[] }
  const onConsole = (message: any) => { if (message.type?.() === "error") runtimeEvidence.consoleErrors.push(String(message.text?.() || "Console error").slice(0, 300)) }
  const onPageError = (error: Error) => runtimeEvidence.pageErrors.push(String(error?.message || error).slice(0, 300))
  const onRequestFailed = (request: any) => runtimeEvidence.failedRequests.push((String(request.method?.() || "GET") + " " + String(request.url?.() || "") + ": " + String(request.failure?.()?.errorText || "request failed")).slice(0, 400))
  const onResponse = (response: any) => { if (response.status?.() >= 400) runtimeEvidence.badResponses.push((String(response.status()) + " " + String(response.request?.()?.method?.() || "GET") + " " + String(response.url?.() || "")).slice(0, 400)) }
  page.on("console", onConsole)
  page.on("pageerror", onPageError)
  page.on("requestfailed", onRequestFailed)
  page.on("response", onResponse)
  const maxSteps = Math.max(1, Math.min(options?.maxSteps ?? MAX_LOOP_STEPS, 50))
  const layaUrl = (options?.layaBaseUrl || job.layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL).replace(/\/$/, "")
  const tested = new Set<string>()
  let lastStateKey = ""

  for (let step = 0; step < maxSteps; step++) {
    const url = await page.url()
    const state = await readPatternState(page, url)
    state.consoleErrorCount = runtimeEvidence.consoleErrors.length + runtimeEvidence.pageErrors.length
    state.network = {
      failedCount: runtimeEvidence.failedRequests.length,
      status4xx: runtimeEvidence.badResponses.filter((entry) => /^4\d\d\s/.test(entry)).length,
      status5xx: runtimeEvidence.badResponses.filter((entry) => /^5\d\d\s/.test(entry)).length,
      resource404Count: runtimeEvidence.badResponses.filter((entry) => /^404\s/.test(entry)).length,
    }
    const stateSignature = JSON.stringify({
      elements: state.elements.map((el) => [el.selector, el.label, el.type, el.disabled]),
      forms: state.forms.map((form) => [form.name, form.fields.map((field) => [field.name, field.type, field.required])]),
      tables: state.tables.map((table) => [table.name, table.rowCount, table.hasExplicitEmptyState]),
      dialogs: state.dialogs.map((dialog) => dialog.label),
      loading: state.loading,
    })
    let fingerprint = 2166136261
    for (let i = 0; i < stateSignature.length; i++) { fingerprint ^= stateSignature.charCodeAt(i); fingerprint = Math.imul(fingerprint, 16777619) }
    const stateKey = url + "::ui-" + (fingerprint >>> 0).toString(16)
    state.stateKey = stateKey
    const candidates = generateCandidateTests(state, { alreadyTestedIds: tested, maxCandidates: 18, allowMutating: true, allowDestructive: false })
    queueMissedCoverage(job, candidates)

    if (candidates.length === 0) break

    const criteria = chooseCriteria(candidates)
    let selected: CandidateTest | null = null
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
      const choice = readChoice(result?.answers?.next_test)
      if (choice && choice.confidence >= LAYA_THRESHOLD && candidates[choice.index]) {
        selected = candidates[choice.index]
      }
    } catch (error: any) {
      appendLog(job, "warn", `[HumanLoop] Laya unavailable: ${error?.message || String(error)}. Falling back to deterministic priority.`)
    }

    if (!selected) {
      selected = candidates[0]
      appendLog(job, "info", `[HumanLoop] Deterministic fallback selected: ${selected.title}`)
    }

    const started = Date.now()
    job.currentStep = `Laya selected: ${selected.title}`
    const observation = await executeCandidate(page, selected)
    tested.add(selected.id)
    const status = observation.ok ? "passed" : (observation.blocked || isDestructive(selected) ? "blocked" : "failed")
    recordLedger(job, selected, status, observation.observation, url)

    const action: AgentAction = {
      id: `human-loop-${Date.now()}-${step}`,
      type: selected.pattern === "back_navigation" ? "back" : selected.pattern === "refresh" ? "navigate" : selected.target?.elementType === "input" ? "type" : "click",
      description: selected.title,
      thought: `Laya-selected candidate: ${selected.goal}`,
      target: selected.target?.selector || selected.target?.href,
      observation: observation.observation,
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
  const missedCoverage = [...new Set(ledger.untestedQueue)]
  const completed = missedCoverage.length === 0
  const signalCount = runtimeEvidence.consoleErrors.length + runtimeEvidence.pageErrors.length + runtimeEvidence.failedRequests.length + runtimeEvidence.badResponses.length
  if (signalCount) appendLog(job, "warn", "[HumanLoop] Captured " + signalCount + " console/network signal(s) for correlation.")
  return { actions, issues, completed, missedCoverage }
}
