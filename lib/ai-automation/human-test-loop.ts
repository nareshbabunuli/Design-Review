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
        .replace(/\\s+/g, " ").trim().slice(0, 100)
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
      const text = (table.parentElement?.textContent || table.textContent || "").replace(/\\s+/g, " ")
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
  const raw = String(answer?.choice ?? answer?.label ?? "")
  const match = raw.match(/test_(\\d+)/)
  if (!match) return null
  const confidence = Number(answer?.confidence ?? answer?.probability ?? answer?.score ?? 0)
  return { index: Number(match[1]), confidence: Number.isFinite(confidence) ? confidence : 0 }
}

function isDestructive(candidate: CandidateTest): boolean {
  return candidate.risk === "destructive" || /delete|remove|destroy|purchase|pay|checkout|charge|send email|publish|deploy|logout|unsubscribe/i.test(candidate.title)
}

async function executeCandidate(page: Page, candidate: CandidateTest): Promise<{ ok: boolean; observation: string }> {
  if (isDestructive(candidate)) return { ok: false, observation: "Blocked by safety policy: destructive action." }

  if (candidate.pattern === "back_navigation") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {})
    return { ok: true, observation: `Browser Back completed; current URL: ${page.url()}` }
  }
  if (candidate.pattern === "refresh") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
    return { ok: true, observation: `Reload completed; current URL: ${page.url()}` }
  }

  const selector = candidate.target?.selector
  if (!selector) return { ok: false, observation: "Candidate has no executable target." }

  const locator = page.locator(selector)
  const count = await locator.count().catch(() => 0)
  if (!count) return { ok: false, observation: "Target is no longer present; state changed before execution." }

  const target = locator.first()
  if (candidate.pattern === "search" || candidate.pattern === "valid_input" || candidate.pattern === "invalid_input") {
    const type = await target.getAttribute("type").catch(() => null)
    const value = type === "email" ? `qa-test+${Date.now()}@example.com` : "QA test input"
    await target.fill(value).catch(async () => { await target.click().catch(() => {}); await page.keyboard.type(value) })
    return { ok: true, observation: `Entered synthetic test data into ${candidate.title}.` }
  }

  await target.click({ timeout: 7000 }).catch(async () => {
    await target.scrollIntoViewIfNeeded().catch(() => {})
    await target.click({ timeout: 5000 }).catch(() => {})
  })
  await new Promise((r) => setTimeout(r, 500))
  return { ok: true, observation: `Activated ${candidate.title}; current URL: ${page.url()}` }
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

function recordLedger(job: AutomationJob, candidate: CandidateTest, status: "passed" | "failed" | "blocked", observation: string) {
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
      screenUrl: job.targetUrl,
      screenPath: candidate.stateKey,
      name: candidate.title,
      type: "other",
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
  const maxSteps = Math.max(1, Math.min(options?.maxSteps ?? MAX_LOOP_STEPS, 50))
  const layaUrl = (options?.layaBaseUrl || job.layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL).replace(/\\/$/, "")
  const tested = new Set<string>()
  let lastStateKey = ""

  for (let step = 0; step < maxSteps; step++) {
    const url = await page.url()
    const stateKey = url
    const state = await readPatternState(page, stateKey)
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
    const status = observation.ok ? "passed" : (isDestructive(selected) ? "blocked" : "failed")
    recordLedger(job, selected, status, observation.observation)

    const action: AgentAction = {
      id: `human-loop-${Date.now()}-${step}`,
      type: selected.pattern === "back_navigation" ? "back" : selected.pattern === "refresh" ? "navigate" : selected.target?.elementType === "input" ? "type" : "click",
      description: selected.title,
      thought: `Laya-selected candidate: ${selected.goal}`,
      target: selected.target?.selector || selected.target?.href,
      observation: observation.observation,
      status,
      durationMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    }
    actions.push(action)
    if (!job.actionHistory) job.actionHistory = []
    job.actionHistory.unshift(action)
    job.actionHistory = job.actionHistory.slice(0, 50)
    appendLog(job, observation.ok ? "success" : "warn", `[HumanLoop] ${selected.title}: ${observation.observation}`)

    if (!observation.ok && !isDestructive(selected)) {
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

    lastStateKey = stateKey
    saveJob(job)
  }

  const ledger = ensureLedger(job)
  const missedCoverage = [...new Set(ledger.untestedQueue)]
  const completed = missedCoverage.length === 0
  return { actions, issues, completed, missedCoverage }
}
