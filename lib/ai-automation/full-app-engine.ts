import fs from "fs"
import path from "path"
import os from "os"
import puppeteer, { type Browser, type Page, type ElementHandle } from "puppeteer"
import { safePuppeteerLaunch } from "../browser/secure-browser"
import {
  AutomationJob,
  AutomationIssue,
  DiscoveredScreen,
  ActionableElement,
  ActionableElementType,
  AppScreenNode,
  AppWorkflowTransition,
  TestPlanStep,
  FullAppTestPlan,
  StartAutomationRequest,
  FlowGraph,
  StepEvidence,
  AutomationVerdict,
  ActionLedgerEntry,
  AgentAction,
} from "./types"
import { saveJob, getJob, appendLog, emitSessionEvent } from "./job-store"
import { discoverLocalProjectRoutes, matchRouteForPath } from "./discover-routes"
import { getJobSecrets } from "./job-secret-vault"
import { assertSafeTargetUrlWithDevBypass } from "../security/url-guard"
import { isLayaAvailable, layaPredict, classifyPage, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"

import {
  SYNTHETIC_TEST_DATA,
  normalizePath,
  normalizeUrlForRestore,
  deriveScreenName,
  buildFigmaWorkflowMap,
  synthesizeFullAppPlanFromJob,
  isFullAppCommand,
} from "./full-app-utils"
import { collectScreenEvidence, collectWorkflowEvidence, type ScreenEvidenceBundle } from "./ux-evidence-collector"
import { applyAllScoringChecks } from "./ux-scoring-checks"
import { calculateOverallUXScore } from "./ux-scoring-rubric"
import { classifyAction, isProductionLike, installNetworkGuard } from "./safety-guard"
import {
  expectFor,
  captureState,
  settle,
  classifyEffect,
  runWithLadder,
  verifyModalCloseAndFocus,
  detectEmptyDataSurfaces,
  detectBrokenDomAssets,
  NetworkRecorder,
  ConsoleRecorder,
} from "./outcome-verifier"
import {
  parsePostmanCollection,
  matchEndpointToForm,
  buildFormPayloadFromPostman,
  confirmMappingOnWire,
} from "./postman-importer"
import {
  PostmanCollectionSummary,
  PostmanEndpointMapping,
  WorkflowRun,
  TestPaymentCredentials,
} from "./types"
import { executeChainedWorkflows } from "./workflow-chainer"
import { buildAutomationReport } from "./evidence-reporter"
import { humanClick, humanType, humanMouseMove } from "./human-actions"
import {
  installVisualOverlay,
  animateCursorTo,
  animateCursorToSelector,
  triggerClickAnimation,
  highlightInputTyping,
  showActionBanner,
  SessionVideoRecorder,
} from "./visual-recorder"
import {
  createDummyFileBuffer,
  resolveUploadFolder,
  scanUploadFolder,
  pickUploadFile,
  UploadFolderInventory,
} from "./test-file-manager"

export {
  createDummyFileBuffer,
  resolveUploadFolder,
  scanUploadFolder,
  pickUploadFile,
  type UploadFolderInventory,
} from "./test-file-manager"

import {
  detectVerificationScreen,
  waitForExternalVerification,
  detectSettingsCredentialsRequirement,
  promptAndFillSecureSettings,
  maskPageSecretsBeforeScreenshot,
  secretRedactor,
} from "./secure-credentials-manager"

export {
  detectVerificationScreen,
  waitForExternalVerification,
  detectSettingsCredentialsRequirement,
  promptAndFillSecureSettings,
  maskPageSecretsBeforeScreenshot,
  secretRedactor,
} from "./secure-credentials-manager"

async function takeSecureScreenshot(page: Page, options: { type: "jpeg"; quality: number }): Promise<Buffer> {
  const unmask = await maskPageSecretsBeforeScreenshot(page)
  try {
    return (await page.screenshot(options)) as Buffer
  } finally {
    await unmask()
  }
}

/** Publish the real Puppeteer action so the live mirror and cursor overlay follow the same session. */
async function publishLiveAction(
  job: AutomationJob,
  page: Page,
  details: {
    type: AgentAction["type"]
    description: string
    target?: string
    selector?: string
    value?: string
    sensitive?: boolean
  },
): Promise<void> {
  let coordinates: { x: number; y: number } | undefined
  if (details.selector) {
    try {
      const el = await page.$(details.selector)
      const box = await el?.boundingBox()
      if (box) coordinates = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    } catch {}
  }

  const sourceViewport = page.viewport()
  job.currentAction = {
    id: `full-app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: details.type,
    description: details.description,
    thought: "Executing the planned browser action with real mouse and keyboard input.",
    target: details.target,
    selector: details.selector,
    value: details.sensitive ? undefined : details.value,
    coordinates,
    viewportWidth: sourceViewport?.width,
    viewportHeight: sourceViewport?.height,
    status: "running",
    timestamp: new Date().toISOString(),
  }
  job.currentUrl = page.url()
  saveJob(job)
}

/** Refresh the image mirror from the exact browser page that is being tested. */
async function publishLiveFrame(job: AutomationJob, page: Page): Promise<void> {
  let overlayState: Array<{ id: string; visibility: string; opacity: string }> = []
  try {
    // The UI draws its own smoothly animated cursor above the screenshot mirror.
    // Hide the recording-only DOM cursor while capturing this frame to avoid double cursors.
    overlayState = await page.evaluate(() => {
      const ids = ["qa-visual-cursor", "qa-visual-ripple", "qa-visual-banner", "qa-visual-typing"]
      return ids.flatMap((id) => {
        const el = document.getElementById(id)
        if (!el) return []
        const state = { id, visibility: el.style.visibility, opacity: el.style.opacity }
        el.style.visibility = "hidden"
        return [state]
      })
    }).catch(() => [])
    const buf = await takeSecureScreenshot(page, { type: "jpeg", quality: 45 })
    job.currentScreenshotUrl = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
    job.currentUrl = page.url()
    saveJob(job)
  } catch (err) {
    appendLog(job, "warn", `Live browser frame could not be refreshed: ${(err as Error)?.message || err}`)
  } finally {
    if (overlayState.length > 0) {
      await page.evaluate((states) => {
        for (const state of states) {
          const el = document.getElementById(state.id)
          if (!el) continue
          el.style.visibility = state.visibility
          el.style.opacity = state.opacity
        }
      }, overlayState).catch(() => {})
    }
  }
}

/** Find the visible field represented by a planned selector, with a semantic fallback. */
async function findVisibleInput(
  page: Page,
  selector: string | undefined,
  name: string,
): Promise<import("puppeteer").ElementHandle<Element> | null> {
  if (selector) {
    try {
      const matches = await page.$$(selector)
      for (const match of matches) {
        if (await match.boundingBox()) return match
      }
    } catch {}
  }

  const candidates = await page.$$("input:not([type=hidden]), textarea, [contenteditable=true]")
  for (const candidate of candidates) {
    const matches = await candidate.evaluate((node, targetName) => {
      const el = node as HTMLInputElement
      const label = el.labels ? Array.from(el.labels).map((item) => item.textContent || "").join(" ") : ""
      const haystack = [label, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("name"), el.id]
        .filter(Boolean).join(" ").toLowerCase()
      const normalizedTarget = String(targetName).toLowerCase().trim()
      return haystack.includes(normalizedTarget) || normalizedTarget.split(/\s+/).some((token) => token.length > 2 && haystack.includes(token))
    }, name).catch(() => false)
    if (matches && await candidate.boundingBox()) return candidate
  }
  return null
}

type VisibleFormFillTask = {
  selector: string
  name: string
  value: string
  kind: "type" | "select" | "check"
  sensitive: boolean
}

/** Fill a real form through visible pointer and keyboard input, publishing each action to the live mirror. */
async function fillFormVisibly(
  job: AutomationJob,
  page: Page,
  formSelector: string,
  testData: typeof SYNTHETIC_TEST_DATA,
  payload?: Record<string, unknown> | null,
  paymentCreds?: TestPaymentCredentials | null,
  forceInvalidFormat = false,
): Promise<{ attempted: number; failed: number }> {
  const markerPrefix = `qa-human-${job.id}-${Date.now()}`
  const tasks = await page.evaluate(
    (sel, data, formPayload, payment, prefix, invalidFormat) => {
      const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
      if (!form) return [] as VisibleFormFillTask[]
      const tasks: VisibleFormFillTask[] = []
      const radioGroups = new Set<string>()
      const mark = (field: Element, index: number) => {
        const marker = `${prefix}-${index}`
        field.setAttribute("data-qa-human-fill", marker)
        return `[data-qa-human-fill="${marker}"]`
      }

      Array.from(form.querySelectorAll("input, textarea, select")).forEach((field: any, index) => {
        const type = String(field.type || "").toLowerCase()
        const tag = String(field.tagName || "").toLowerCase()
        const name = String(field.name || field.id || "").toLowerCase()
        const placeholder = String(field.placeholder || "").toLowerCase()
        const label = field.labels ? Array.from(field.labels).map((x: any) => x.textContent || "").join(" ").toLowerCase() : ""
        const sensitive = type === "password" || /password|passcode|secret|token|api[-_ ]?key|private[-_ ]?key|card|cvv|cvc|security code/i.test(name + " " + placeholder + " " + label)
        const existingValue = typeof field.value === "string" ? field.value.trim() : ""
        const style = window.getComputedStyle(field)
        const rect = field.getBoundingClientRect()
        if (field.disabled || field.readOnly || rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return
        if (["submit", "button", "hidden", "file", "reset"].includes(type)) return

        const key = String(field.name || field.id || "")
        if (invalidFormat && (type === "email" || /email/i.test(name + " " + placeholder + " " + label))) {
          tasks.push({ selector: mark(field, index), name: label || placeholder || key || "Email", value: "invalid-email-format", kind: "type", sensitive })
          return
        }
        if (invalidFormat && (type === "tel" || /phone|mobile/i.test(name + " " + placeholder + " " + label))) {
          tasks.push({ selector: mark(field, index), name: label || placeholder || key || "Phone", value: "not-a-valid-phone-number", kind: "type", sensitive })
          return
        }
        if (formPayload && key && Object.prototype.hasOwnProperty.call(formPayload, key)) {
          tasks.push({ selector: mark(field, index), name: label || placeholder || key || "Form field", value: String(formPayload[key] ?? ""), kind: tag === "select" ? "select" : "type", sensitive })
          return
        }

        if (tag === "select") {
          if (field.value && field.selectedIndex > 0 && field.checkValidity()) return
          const option = Array.from(field.options || []).find((item: any, optionIndex: number) => optionIndex > 0 && !item.disabled) || Array.from(field.options || []).find((item: any) => !item.disabled)
          if (option) tasks.push({ selector: mark(field, index), name: label || key || "Dropdown", value: String((option as any).value), kind: "select", sensitive: false })
          return
        }

        if (type === "checkbox") {
          if (!field.checked) tasks.push({ selector: mark(field, index), name: label || key || "Checkbox", value: "true", kind: "check", sensitive: false })
          return
        }

        if (type === "radio") {
          const groupKey = String(field.name || `radio-${index}`)
          if (radioGroups.has(groupKey)) return
          radioGroups.add(groupKey)
          const group = Array.from(form.querySelectorAll('input[type="radio"]')).filter((radio: any) => String(radio.name || "") === String(field.name || ""))
          if (group.some((radio: any) => radio.checked)) return
          if (group[0] === field) tasks.push({ selector: mark(field, index), name: label || key || "Radio option", value: "true", kind: "check", sensitive: false })
          return
        }

        if (!sensitive && existingValue && field.checkValidity()) return

        let value = String(data.fullName || "QA Test User")
        if (type === "email" || /email/i.test(name + " " + placeholder + " " + label)) value = String(data.email || "qa-test@example.com")
        else if (type === "password" || /password|passcode/i.test(name + " " + placeholder + " " + label)) value = String(data.password || "QaTest!234")
        else if (type === "tel" || /phone|mobile/i.test(name + " " + placeholder + " " + label)) value = String(data.phone || "+15555550123")
        else if (type === "number" || /amount|count|age|qty/i.test(name + " " + placeholder + " " + label)) value = "10"
        else if (type === "url" || /url|website/i.test(name + " " + placeholder + " " + label)) value = "https://example.com"
        else if (type === "date") value = new Date().toISOString().slice(0, 10)

        if (payment) {
          if (/card[-_]?num|credit[-_]?card|cc[-_]?num|card_number|cardnumber/i.test(name) || /card\s*number/i.test(placeholder)) value = payment.cardNumber || "4242 4242 4242 4242"
          else if (/cvv|cvc|security[-_]?code/i.test(name) || /cvv|cvc|security\s*code/i.test(placeholder)) value = payment.cvv || "123"
          else if (/exp|expiration|expiry/i.test(name) || /exp|mm\/yy/i.test(placeholder)) value = payment.expiryDate || "12/34"
          else if (/zip|postal/i.test(name + " " + placeholder)) value = payment.zipCode || "90210"
        }

        tasks.push({ selector: mark(field, index), name: label || placeholder || key || `${type || tag} field`, value, kind: "type", sensitive })
      })
      return tasks
    },
    formSelector,
    testData,
    payload || null,
    paymentCreds || null,
    markerPrefix,
    forceInvalidFormat,
  )

  let failed = 0
  for (const task of tasks) {
    const field = await page.$(task.selector).catch(() => null)
    const box = await field?.boundingBox().catch(() => null)
    if (!field || !box) {
      failed++
      appendLog(job, "warn", `[FORM] Could not find visible field "${task.name}" for human-paced input.`)
      continue
    }

    await publishLiveAction(job, page, {
      type: task.kind === "type" ? "type" : "click",
      description: task.kind === "type" ? `Typing into ${task.name}` : `Selecting ${task.name}`,
      target: task.name,
      selector: task.selector,
      value: task.value,
      sensitive: task.sensitive,
    })
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
    await publishLiveFrame(job, page)

    let ok = false
    if (task.kind === "type") {
      ok = await humanType(page, field, task.value, { label: task.name, maskInBanner: task.sensitive })
    } else if (task.kind === "check") {
      ok = Boolean(await humanClick(page, field))
    } else {
      const optionIndex = await field.evaluate((node, value) => Array.from((node as HTMLSelectElement).options).findIndex((option) => option.value === value), task.value).catch(() => -1)
      if (optionIndex >= 0 && await humanClick(page, field)) {
        try {
          await page.keyboard.press("Home")
          for (let i = 0; i < optionIndex; i++) await page.keyboard.press("ArrowDown")
          await page.keyboard.press("Enter")
          ok = await field.evaluate((node, value) => (node as HTMLSelectElement).value === value, task.value).catch(() => false)
        } catch {}
      }
    }

    if (!ok) failed++
    if (job.currentAction) job.currentAction.status = ok ? "passed" : "failed"
    await publishLiveFrame(job, page)
  }

  return { attempted: tasks.length, failed }
}

async function clickFormSubmitVisibly(job: AutomationJob, page: Page, formSelector: string, targetName: string): Promise<boolean> {
  const marker = `qa-human-submit-${job.id}-${Date.now()}`
  const selector = await page.evaluate((sel, markerValue) => {
    const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
    if (!form) return ""
    const submit = (
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      form.querySelector('button:not([type="button"])') ||
      form.querySelector('[role="button"]')
    ) as HTMLElement | null
    if (!submit) return ""
    submit.setAttribute("data-qa-human-submit", markerValue)
    return `[data-qa-human-submit="${markerValue}"]`
  }, formSelector, marker)
  if (!selector) return false

  const submit = await page.$(selector).catch(() => null)
  const box = await submit?.boundingBox().catch(() => null)
  await publishLiveAction(job, page, {
    type: "click",
    description: `Submitting ${targetName}`,
    target: targetName,
    selector,
  })
  if (box) {
    await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
    await publishLiveFrame(job, page)
  }
  const clicked = submit ? Boolean(await humanClick(page, submit)) : false
  if (job.currentAction) job.currentAction.status = clicked ? "passed" : "failed"
  await publishLiveFrame(job, page)
  return clicked
}

export const DEFAULT_SANDBOX_CARD: TestPaymentCredentials = {
  cardNumber: "4242 4242 4242 4242",
  cardHolder: "Test Automation User",
  expiryDate: "12/34",
  cvv: "123",
  zipCode: "90210",
}

/**
 * Prompts user for test payment credentials when a payment form is reached,
 * or cleanly falls back to standard sandbox card details in automated/test mode.
 */
export async function promptPaymentCredentialsIfNeeded(
  job: AutomationJob,
  initialCreds?: TestPaymentCredentials
): Promise<TestPaymentCredentials> {
  if (initialCreds && (initialCreds.cardNumber || initialCreds.skip || initialCreds.useDefaultSandbox)) {
    secretRedactor.registerMultiple([
      initialCreds.cardNumber, initialCreds.cardHolder, initialCreds.expiryDate, initialCreds.cvv, initialCreds.zipCode,
    ])
    return initialCreds
  }

  if (job.pendingPaymentCredentials) {
    const creds = job.pendingPaymentCredentials
    secretRedactor.registerMultiple([
      creds.cardNumber, creds.cardHolder, creds.expiryDate, creds.cvv, creds.zipCode,
    ])
    job.pendingPaymentCredentials = undefined
    return creds
  }

  job.paymentState = "awaiting_payment_credentials"
  job.paymentPrompt =
    "Payment / Checkout form detected. Supply custom test payment card details or accept standard sandbox card (Stripe 4242...)."
  job.currentStep = "Waiting for test payment credentials..."
  appendLog(job, "info", "💳 Payment form detected - waiting for test card credentials or sandbox default...")
  saveJob(job)

  // Pause up to 30 seconds for UI response, then default to sandbox card in test mode
  const deadline = Date.now() + 30 * 1000
  while (!job.pendingPaymentCredentials && job.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    const refreshed = getJob(job.id)
    if (refreshed?.pendingPaymentCredentials) {
      job.pendingPaymentCredentials = refreshed.pendingPaymentCredentials
      break
    }
    if (refreshed?.status && refreshed.status !== "running") {
      job.status = refreshed.status
      break
    }
  }

  const supplied = job.pendingPaymentCredentials || DEFAULT_SANDBOX_CARD
  secretRedactor.registerMultiple([
    supplied.cardNumber,
    supplied.cardHolder,
    supplied.expiryDate,
    supplied.cvv,
    supplied.zipCode,
  ])
  job.pendingPaymentCredentials = undefined
  job.paymentState = supplied.skip ? "skipped" : "provided"
  job.paymentPrompt = undefined
  saveJob(job)
  return supplied
}


/**
 * Uses Laya (~30ms local typed decisions) to classify and enrich discovered DOM elements.
 * Confirms whether elements are interactive triggers, identifies their functional role,
 * detects auxiliary auth flows and navigation tabs, and bumps confidence for key workflow controls.
 */
async function enrichInventoryWithLaya(
  elements: ActionableElement[],
  pageUrl: string,
  layaBaseUrl?: string
): Promise<ActionableElement[]> {
  const url = layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL
  if (!url) return elements
  const online = await isLayaAvailable(url).catch(() => false)
  if (!online) return elements

  const candidates = elements.filter(
    (el) => el.type === "clickable" || el.type === "button" || el.type === "tab" || el.type === "link"
  ).slice(0, 16)

  if (candidates.length === 0) return elements
  if (candidates.length === 1) {
    candidates[0].interactionConfidence = 0.95
    candidates[0].discoveryReason = [
      ...(candidates[0].discoveryReason || []),
      "Single primary workflow action on screen",
    ]
    return elements
  }

  try {
    const criteria: Record<string, string> = {}
    candidates.forEach((c, idx) => {
      criteria[`item_${idx}`] = `[${c.type.toUpperCase()}] "${c.name}" (${c.selector || "selector"})`
    })
    criteria["none"] = "None of the above controls"

    const questions: Record<string, any> = {
      primary_actions: {
        type: "choice" as const,
        instructions: "Which control is a primary workflow action or key navigation target on this screen?",
        criteria,
      },
    }

    const hasAuthCandidates = candidates.some((c) =>
      /forgot|create|register|signup|sign\s*up|password|reset/i.test(c.name)
    )
    if (hasAuthCandidates) {
      questions.auxiliary_auth = {
        type: "choice" as const,
        instructions: "Which control is an auxiliary authentication recovery or alternate flow (e.g. Forgot Password, Sign Up, Create Account)?",
        criteria,
      }
    }

    const hasTabCandidates = candidates.some(
      (c) => c.type === "tab" || /home|workout|drills|messages|profile|dashboard|explore/i.test(c.name)
    )
    if (hasTabCandidates) {
      questions.navigation_tab = {
        type: "choice" as const,
        instructions: "Which control represents a key navigation tab or view switcher?",
        criteria,
      }
    }

    const payload = {
      state: `Page: ${pageUrl}\nDiscovered interactive UI controls on this screen:\n${candidates.map((c, i) => `${i}. [${c.type}] "${c.name}"`).join("\n")}`,
      questions,
    }

    const res = await layaPredict(url, payload).catch(() => null)
    if (res?.answers) {
      const answers = res.answers

      // Primary action confirmation
      if (answers.primary_actions) {
        const choice = String(answers.primary_actions.choice || answers.primary_actions || "")
        const match = choice.match(/item_(\d+)/)
        if (match) {
          const primaryIdx = parseInt(match[1], 10)
          if (candidates[primaryIdx]) {
            candidates[primaryIdx].interactionConfidence = 0.98
            candidates[primaryIdx].discoveryReason = [
              ...(candidates[primaryIdx].discoveryReason || []),
              "Laya System-1 confirmed primary workflow action",
            ]
          }
        }
      }

      // Auxiliary authentication option identification
      if (answers.auxiliary_auth) {
        const choice = String(answers.auxiliary_auth.choice || answers.auxiliary_auth || "")
        const match = choice.match(/item_(\d+)/)
        if (match) {
          const authIdx = parseInt(match[1], 10)
          if (candidates[authIdx]) {
            candidates[authIdx].interactionConfidence = 0.99
            ;(candidates[authIdx] as any).isAuxiliaryAuth = true
            candidates[authIdx].discoveryReason = [
              ...(candidates[authIdx].discoveryReason || []),
              "Laya System-1 confirmed auxiliary auth flow",
            ]
          }
        }
      }

      // Navigation tab confirmation
      if (answers.navigation_tab) {
        const choice = String(answers.navigation_tab.choice || answers.navigation_tab || "")
        const match = choice.match(/item_(\d+)/)
        if (match) {
          const tabIdx = parseInt(match[1], 10)
          if (candidates[tabIdx]) {
            candidates[tabIdx].type = "tab"
            candidates[tabIdx].interactionConfidence = 0.98
            candidates[tabIdx].discoveryReason = [
              ...(candidates[tabIdx].discoveryReason || []),
              "Laya System-1 confirmed navigation tab",
            ]
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("[Laya DOM Enrichment]", err?.message)
  }

  return elements
}

/**
 * Extracts complete inventory of actionable elements on the active page
 */
export async function extractActionableInventory(page: Page, layaBaseUrl?: string): Promise<{
  actionableElements: ActionableElement[]
  forms: Array<{
    id: string
    name?: string
    selector?: string
    fields: string[]
    submitButton?: string
    submitSelector?: string
    isInsideModal?: boolean
  }>
  modalTitle?: string
  heading?: string
}> {
  const raw = await page.evaluate(() => {
    function generateOptimalSelector(el: Element): string {
      if (!el || !(el instanceof Element)) return ""
      const h = el as HTMLElement
      if (h.id && document.querySelectorAll("#" + CSS.escape(h.id)).length === 1) {
        return "#" + CSS.escape(h.id)
      }
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-cy") || el.getAttribute("data-test")
      if (testId) {
        const sel = `[data-testid="${CSS.escape(testId)}"]`
        if (document.querySelectorAll(sel).length === 1) return sel
        const selCy = `[data-cy="${CSS.escape(testId)}"]`
        if (document.querySelectorAll(selCy).length === 1) return selCy
      }
      const name = el.getAttribute("name")
      if (name) {
        const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`
        if (document.querySelectorAll(sel).length === 1) return sel
      }
      const aria = el.getAttribute("aria-label")
      if (aria) {
        const sel = `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`
        if (document.querySelectorAll(sel).length === 1) return sel
      }
      const role = el.getAttribute("role")
      if (role) {
        const sel = `${el.tagName.toLowerCase()}[role="${CSS.escape(role)}"]`
        if (document.querySelectorAll(sel).length === 1) return sel
      }
      if (el.tagName.toLowerCase() === "a" && el.getAttribute("href")) {
        const href = el.getAttribute("href")!
        const sel = `a[href="${CSS.escape(href)}"]`
        if (document.querySelectorAll(sel).length === 1) return sel
      }
      const parts: string[] = []
      let curr: Element | null = el
      while (curr && curr !== document.documentElement && curr !== document.body) {
        const parent: Element | null = curr.parentElement
        const tag = curr.tagName.toLowerCase()
        if (!parent) { parts.unshift(tag); break }
        const siblings = Array.from(parent.children).filter((c: any) => c.tagName === curr!.tagName)
        const idx = siblings.indexOf(curr) + 1
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
        const candidate = parts.join(" > ")
        try {
          if (document.querySelectorAll(candidate).length === 1) return candidate
        } catch {}
        curr = parent
      }
      return parts.join(" > ") || el.tagName.toLowerCase()
    }

    function getAccessibleControlName(el: Element, fallback = "Action Control"): string {
      if (!el) return fallback
      const h = el as HTMLElement
      const ariaLabel = h.getAttribute("aria-label")
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().replace(/\s+/g, " ").slice(0, 50)
      const labelledBy = h.getAttribute("aria-labelledby")
      if (labelledBy) {
        const refText = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim()
        if (refText) return refText.replace(/\s+/g, " ").slice(0, 50)
      }
      const title = h.getAttribute("title")
      if (title && title.trim()) return title.trim().replace(/\s+/g, " ").slice(0, 50)
      const headingEl = el.querySelector("h1, h2, h3, h4, [class*='title' i], [class*='heading' i]")
      if (headingEl && headingEl.textContent?.trim()) {
        return headingEl.textContent.trim().replace(/\s+/g, " ").slice(0, 50)
      }
      const text = (h.textContent || "").trim()
      if (text) return text.replace(/\s+/g, " ").slice(0, 50)
      const input = el as HTMLInputElement
      if (input.value && typeof input.value === "string" && input.value.trim()) return input.value.trim().slice(0, 50)
      if (input.placeholder && input.placeholder.trim()) return input.placeholder.trim().slice(0, 50)
      if (input.name && input.name.trim()) return input.name.trim().slice(0, 50)
      const img = el.querySelector("img[alt]")
      if (img && img.getAttribute("alt")?.trim()) return img.getAttribute("alt")!.trim().slice(0, 50)
      const svg = el.querySelector("svg")
      if (svg) {
        const svgAria = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || svg.getAttribute("data-icon") || svg.getAttribute("data-lucide")
        if (svgAria && svgAria.trim()) return svgAria.trim().slice(0, 50)
        const svgClass = typeof svg.className === "string" ? svg.className : ((svg.className as any)?.baseVal || "")
        const iconMatch = svgClass.match(/(?:lucide|fa|icon|feather|tabler|bi|material)[-_]([a-z0-9-]+)/i)
        if (iconMatch && iconMatch[1]) {
          const iconName = iconMatch[1].replace(/[-_]/g, " ")
          return iconName.charAt(0).toUpperCase() + iconName.slice(1)
        }
      }
      const testId = h.getAttribute("data-testid") || h.getAttribute("data-cy")
      if (testId) {
        return testId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 50)
      }
      return fallback
    }

    const elements: any[] = []
    const forms: any[] = []
    let elementCounter = 1

    // 1. Detect active modal dialog
    const modalEl = document.querySelector('[role="dialog"], .modal, [data-modal], dialog[open]')
    let modalTitle = ""
    if (modalEl) {
      const modalHeading = modalEl.querySelector("h1, h2, h3, [class*='title'], [class*='header']")
      if (modalHeading) {
        modalTitle = (modalHeading.textContent || "").trim()
      }
    }

    // 2. Page main heading
    let heading = ""
    const headingEl = document.querySelector(
      'h1, h2, [role="heading"], header h1, header h2, header [dir="auto"], [class*="title" i], [class*="heading" i]'
    )
    if (headingEl) {
      heading = (headingEl.textContent || "").trim()
    }
    if (!heading) {
      const prominent = Array.from(document.querySelectorAll('div[dir="auto"], span[dir="auto"], header *'))
        .map((el) => (el.textContent || "").trim())
        .find((t) => t.length >= 4 && t.length <= 40 && !/(copyright|all rights|version|\d{1,2}:\d{2})/i.test(t))
      if (prominent) heading = prominent
    }

    // 3. Scan Forms
    document.querySelectorAll("form, [data-form], .form").forEach((form: any, fIdx) => {
      const formId = form.id || (form.dataset.formTestId ||= `form-${fIdx + 1}`)
      const formSelector = form.id
        ? `#${form.id}`
        : form.getAttribute("name")
        ? `form[name="${form.getAttribute("name")}"]`
        : `form:nth-of-type(${fIdx + 1})`
      const isInsideModal = Boolean(form.closest('[role="dialog"], dialog, .modal, [data-modal]'))
      const formFields: string[] = []
      let submitBtnText = ""
      let submitSelector = ""

      form.querySelectorAll("input, select, textarea").forEach((field: any) => {
        const fieldName = field.name || field.id || field.placeholder || `field-${field.type}`
        formFields.push(fieldName)
      })

      const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])')
      if (submit) {
        submitBtnText = (submit.textContent || (submit as HTMLInputElement).value || "Submit").trim()
        submitSelector = submit.id
          ? `#${submit.id}`
          : `${formSelector} button[type="submit"], ${formSelector} input[type="submit"], ${formSelector} button`
      }

      forms.push({
        id: formId,
        name: form.getAttribute("aria-label") || form.getAttribute("name") || `Form #${fIdx + 1}`,
        selector: formSelector,
        fields: formFields,
        submitButton: submitBtnText || undefined,
        submitSelector: submitSelector || undefined,
        isInsideModal,
      })
    })

    // 4. File Upload Controls
    document.querySelectorAll('input[type="file"]').forEach((el: any) => {
      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined
      const name = el.name || el.id || el.getAttribute("aria-label") || "Upload File"
      elements.push({
        id: `elem-${elementCounter++}`,
        name,
        type: "file_upload",
        selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : 'input[type="file"]',
        inputType: "file",
        accept: el.accept || "image/*,.pdf,.doc,.docx",
        isRequired: el.required || false,
        formId,
      })
    })

    // 5. Input Fields (Text, Email, Password, Number, Search, Date, etc.)
    document.querySelectorAll("input, textarea").forEach((el: any) => {
      if (el.type === "file" || el.type === "hidden" || el.type === "submit" || el.type === "button") return
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const type = el.type || (el.tagName.toLowerCase() === "textarea" ? "textarea" : "text")
      let elementType: any = "input"
      if (type === "checkbox") elementType = "checkbox"
      else if (type === "radio") elementType = "radio"

      const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
      const labelText = labelEl ? (labelEl.textContent || "").trim() : ""
      const name = labelText || el.placeholder || el.name || el.id || `${type} input`

      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: name.replace(/[:*]/g, "").trim(),
        type: elementType,
        selector: generateOptimalSelector(el),
        inputType: type,
        placeholder: el.placeholder || undefined,
        value: el.value || undefined,
        isRequired: el.required || false,
        formId,
      })
    })

    // 6. Dropdowns / Selects
    document.querySelectorAll("select, [role='combobox'], [role='listbox']").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
      const name = (labelEl ? labelEl.textContent : "") || el.name || el.id || "Dropdown Option"

      const options: string[] = []
      if (el.tagName.toLowerCase() === "select") {
        el.querySelectorAll("option").forEach((opt: HTMLOptionElement) => {
          const txt = (opt.textContent || opt.value || "").trim()
          if (txt && !options.includes(txt)) options.push(txt)
        })
      }

      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: name.replace(/[:*]/g, "").trim(),
        type: "select",
        selector: generateOptimalSelector(el),
        options: options.slice(0, 8),
        formId,
      })
    })
    // 7. Tabs, Radios & Toggles
    document.querySelectorAll("[role='tab'], [role='switch'], .toggle, [data-tab]").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const txt = getAccessibleControlName(el, "Tab / Toggle")
      if (!txt) return

      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: txt,
        type: el.getAttribute("role") === "tab" ? "tab" : "toggle",
        selector: generateOptimalSelector(el),
        formId,
      })
    })

    const isLogoutControl = (targetEl: any, labelText = ""): boolean => {
      try {
        const raw = (labelText || targetEl.textContent || targetEl.value || targetEl.getAttribute?.("aria-label") || targetEl.getAttribute?.("title") || "").trim()
        const cls = typeof targetEl.className === "string" ? targetEl.className : ((targetEl.className as any)?.baseVal || "")
        const id = targetEl.id || ""
        const href = targetEl.getAttribute?.("href") || ""
        const actionAttr = targetEl.getAttribute?.("data-action") || ""
        const testId = targetEl.getAttribute?.("data-testid") || ""
        const svgLucide = targetEl.querySelector?.("svg")?.getAttribute?.("data-lucide") || ""
        const svgClass = targetEl.querySelector?.("svg")?.getAttribute?.("class") || ""
        const combined = [raw, cls, id, href, actionAttr, testId, svgLucide, svgClass].join(" ")
        return /(logout|sign[-_ ]?out|log[-_ ]?off|delete[-_ ]?account)/i.test(combined)
      } catch {
        return false
      }
    }

    // 8. Buttons & Clickable Triggers
    document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const rawText = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim()
      if (!rawText && !el.querySelector("svg, img")) return

      // Skip dangerous session terminating logout buttons during exploration
      if (isLogoutControl(el, rawText)) return

      const cleanText = getAccessibleControlName(el, "Action Button")
      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: cleanText,
        type: "button",
        selector: generateOptimalSelector(el),
        formId,
      })
    })

    // 9. Navigation Bars & Bottom Navigation (Home, Workout, Drills, Messages, Profile)
    const navSelector =
      'nav, [role="navigation"], [role="tablist"], footer nav, [class*="bottomNav" i], [class*="bottom-nav" i], [class*="tabBar" i], [class*="tab-bar" i], [class*="bottom-bar" i]'
    document.querySelectorAll(navSelector).forEach((navContainer: any) => {
      const items = navContainer.querySelectorAll('a, button, [role="tab"], [role="button"], li, div')
      items.forEach((item: any) => {
        if (item === navContainer) return
        const style = window.getComputedStyle(item)
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || item.offsetWidth <= 2 || item.offsetHeight <= 2) return

        const txt = getAccessibleControlName(item, "")
        if (!txt || txt.length > 35) return
        if (isLogoutControl(item, txt)) return

        const selector = generateOptimalSelector(item)
        const actionKey = ["tab", window.location.pathname, txt.toLowerCase(), selector].join("|")
        if (elements.some((e: any) => e.selector === selector || e.actionKey === actionKey)) return

        elements.push({
          id: `elem-${elementCounter++}`,
          name: txt,
          type: "tab",
          selector,
          actionKey,
          interactionConfidence: 0.95,
          discoveryReason: ["Detected inside navigation/bottom tab bar"],
          isInteractive: true,
        })
      })
    })

    // 10. Top Navigation & Header Actions (Notifications bell, Settings gear, Profile avatar, Back)
    const headerSelector =
      'header, [role="banner"], [role="toolbar"], [class*="header" i], [class*="topbar" i], [class*="top-bar" i]'
    document.querySelectorAll(headerSelector).forEach((headerContainer: any) => {
      const items = headerContainer.querySelectorAll('button, a, [role="button"], [class*="icon" i], [class*="btn" i], [class*="action" i]')
      items.forEach((item: any) => {
        if (item === headerContainer) return
        const style = window.getComputedStyle(item)
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || item.offsetWidth <= 2 || item.offsetHeight <= 2) return

        const txt = getAccessibleControlName(item, "Header Action")
        if (!txt || isLogoutControl(item, txt)) return

        const selector = generateOptimalSelector(item)
        const actionKey = ["header_action", window.location.pathname, txt.toLowerCase(), selector].join("|")
        if (elements.some((e: any) => e.selector === selector || e.actionKey === actionKey)) return

        elements.push({
          id: `elem-${elementCounter++}`,
          name: txt,
          type: "button",
          selector,
          actionKey,
          interactionConfidence: 0.92,
          discoveryReason: ["Detected inside header/top navigation bar"],
          isInteractive: true,
        })
      })
    })

    // 11. Interactive Cards, Tiles & Feature Action Blocks (e.g. DRILLS card)
    const cardSelector =
      '[class*="card" i], [class*="tile" i], [class*="feature" i], [class*="banner" i], [class*="box" i][class*="click" i], [data-action]'
    document.querySelectorAll(cardSelector).forEach((card: any) => {
      const tag = (card.tagName || '').toLowerCase()
      if (["button", "a", "input", "select", "textarea", "option"].includes(tag)) return
      const style = window.getComputedStyle(card)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || card.offsetWidth <= 10 || card.offsetHeight <= 10) return

      if (card.parentElement && card.parentElement.closest('[class*="card" i], [class*="tile" i]')) return

      const isClickable = Boolean(
        style.cursor === "pointer" ||
        card.getAttribute("role") === "button" ||
        card.getAttribute("tabindex") === "0" ||
        card.hasAttribute("data-action") ||
        card.hasAttribute("onclick")
      )
      if (!isClickable && !card.querySelector("h1, h2, h3, h4")) return

      const heading = card.querySelector("h1, h2, h3, h4, [class*='title' i], [class*='heading' i]")
      const title = (heading ? heading.textContent : "") || getAccessibleControlName(card, "Interactive Card")
      const cleanTitle = (title || "").trim().replace(/\s+/g, " ").slice(0, 50)
      if (!cleanTitle || isLogoutControl(card, cleanTitle)) return

      const selector = generateOptimalSelector(card)
      const actionKey = ["card", window.location.pathname, cleanTitle.toLowerCase(), selector].join("|")
      if (elements.some((e: any) => e.selector === selector || e.actionKey === actionKey)) return

      elements.push({
        id: `elem-${elementCounter++}`,
        name: cleanTitle,
        type: "clickable",
        selector,
        actionKey,
        interactionConfidence: 0.92,
        discoveryReason: ["Interactive card/feature tile"],
        isInteractive: true,
      })
    })

    // 12. Custom clickable / accessibility controls & pointer elements
    const customInteractiveSelector =
      '[onclick], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [aria-controls], [tabindex]:not([tabindex="-1"])'
    document.querySelectorAll(customInteractiveSelector).forEach((el: any) => {
      const tag = (el.tagName || '').toLowerCase()
      if (["button", "a", "input", "select", "textarea", "option"].includes(tag)) return

      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const rawText = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim()
      if (!rawText && !el.getAttribute("aria-controls") && !el.querySelector("svg, img")) return
      if (isLogoutControl(el, rawText)) return

      const name = getAccessibleControlName(el, el.getAttribute("aria-controls") || "Custom Action")
      const role = el.getAttribute("role")
      const type: ActionableElementType =
        role === "tab" ? "tab" :
        role === "switch" ? "toggle" :
        role === "menuitem" ? "menu" :
        role === "link" ? "link" : "clickable"
      const hrefAttr = el.getAttribute("href") || undefined
      let href: string | undefined
      try {
        href = hrefAttr ? new URL(hrefAttr, window.location.href).href : undefined
      } catch {
        href = hrefAttr
      }

      const selector = generateOptimalSelector(el)
      const actionKey = [
        type,
        window.location.pathname,
        name.toLowerCase(),
        href || "",
        el.getAttribute("aria-controls") || "",
      ].join("|")
      if (elements.some((e: any) => e.selector === selector || e.actionKey === actionKey)) return

      elements.push({
        id: `elem-${elementCounter++}`,
        name,
        type,
        selector,
        href,
        actionKey,
        isInteractive: true,
      })
    })

    // 13. Links & Navigation (including intra-app triggers like Forgot password / Create account)
    document.querySelectorAll("a").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const href = el.getAttribute("href") || ""
      if (href.startsWith("mailto:") || href.startsWith("tel:")) return
      if (/(logout|signout)/i.test(href)) return

      const text = getAccessibleControlName(el, href || "Link").slice(0, 50)
      if (!text || isLogoutControl(el, text)) return

      const isHashOrJs = !href || href.startsWith("#") || href.startsWith("javascript:")
      const absoluteHref = isHashOrJs ? undefined : (() => {
        try {
          return new URL(href, window.location.href).href
        } catch {
          return href
        }
      })()
      const type: ActionableElementType = isHashOrJs ? "clickable" : "link"
      const selector = generateOptimalSelector(el)
      const actionKey = [
        type,
        window.location.pathname,
        text.toLowerCase(),
        absoluteHref || href || "anchor",
      ].join("|")
      if (elements.some((e: any) => e.selector === selector || e.actionKey === actionKey)) return

      const isAuthAux = /forgot|create|register|signup|sign\s*up|password|reset/i.test(text)
      elements.push({
        id: `elem-${elementCounter++}`,
        name: text,
        type,
        selector,
        href: absoluteHref,
        actionKey,
        interactionConfidence: isAuthAux ? 0.95 : 0.85,
        discoveryReason: isAuthAux ? ["Auxiliary authentication link"] : ["Anchor navigation"],
        isInteractive: true,
      })
    })

    return {
      actionableElements: elements,
      forms,
      modalTitle: modalTitle || undefined,
      heading: heading || undefined,
    }
  })

  const enriched = await enrichInventoryWithLaya(raw.actionableElements, page.url(), layaBaseUrl)
  return {
    ...raw,
    actionableElements: enriched,
  }
}

/**
 * Systematically discovers all reachable screens in the application,
 * generating screen nodes with unique IDs (S001, S002, ...) and action transitions.
 */
type LoginCreds = { username?: string; password?: string }

/** Waits for single-page applications (React/Next/Expo/SPA) to hydrate past initial splash/loading screens. */
async function waitForSpaPageReady(page: Page, timeoutMs = 4000): Promise<void> {
  try {
    await page
      .waitForFunction(
        () => {
          if (document.querySelector('input[type="password"], input[type="email"], input[type="text"]')) return true
          const inputs = document.querySelectorAll("input, button, select, textarea, a[href]")
          const hasContent = (document.body?.innerText || "").trim().length > 30
          return inputs.length >= 2 || hasContent
        },
        { timeout: timeoutMs }
      )
      .catch(() => null)
    await new Promise((r) => setTimeout(r, 800))
  } catch {}
}

/** True when a visible password field or sign-in form is on the page (login wall). */
async function hasLoginWall(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const isVisible = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          (el.offsetParent !== null || rect.height > 0) &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        )
      }

      const pw = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      if (pw.some(isVisible)) return true

      // Fallback: visible email/username input + visible sign in button / sign in heading
      const emailOrUser = (Array.from(
        document.querySelectorAll(
          'input[type="email"], input[name*="user" i], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="user" i]'
        )
      ) as HTMLInputElement[]).filter(isVisible)

      if (emailOrUser.length === 0) return false

      const bodyText = (document.body?.innerText || "").toLowerCase()
      const hasSignInHeading = /sign\s*in\s*to|log\s*in\s*to|enter\s*your\s*(email|password)|forgot\s*password/i.test(bodyText)
      const hasAuthButton = Array.from(
        document.querySelectorAll('button, input[type="submit"], [role="button"], a, div[class*="cursor"], div[class*="r-cursor"], div[tabindex], div, span')
      ).some((el) => isVisible(el as HTMLElement) && /^\s*(sign\s*in|log\s*in|login)\s*$/i.test(el.textContent?.trim() || ""))

      return hasSignInHeading || hasAuthButton
    })
  } catch {
    return false
  }
}

/** Types creds into the login form, submits, returns true when the password field is gone. */
async function attemptLogin(job: AutomationJob, page: Page, creds: LoginCreds): Promise<boolean> {
  try {
    // 1. Wait briefly for inputs to mount in SPA
    await page.waitForSelector('input[type="password"], input[type="email"], input[name*="user" i], input[name*="email" i]', { timeout: 8000 }).catch(() => null)

    const inputsFound = await page.evaluate(() => {
      const isVisible = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          (el.offsetParent !== null || rect.height > 0) &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }

      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(isVisible)
      const scope = (pw && pw.closest("form")) || document
      const user = (Array.from(
        scope.querySelectorAll(
          'input[type="email"], input[name*="user" i], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="user" i], input[type="text"], input:not([type])'
        )
      ) as HTMLInputElement[]).find((x) => isVisible(x) && x.type !== "password")

      if (!pw && !user) return false
      return { hasPw: Boolean(pw), hasUser: Boolean(user) }
    })

    if (!inputsFound) return false

    // 2. Obtain element handles for native CDP typing
    const userHandle = await page.evaluateHandle(() => {
      const isVisible = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          (el.offsetParent !== null || rect.height > 0) &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(isVisible)
      const scope = (pw && pw.closest("form")) || document
      const inputs = Array.from(
        scope.querySelectorAll(
          'input[type="email"], input[name*="user" i], input[name*="email" i], input[placeholder*="email" i], input[placeholder*="user" i], input[type="text"], input:not([type])'
        )
      ) as HTMLInputElement[]
      return inputs.find((x) => isVisible(x) && x.type !== "password") || null
    })

    const passHandle = await page.evaluateHandle(() => {
      const isVisible = (el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return (
          (el.offsetParent !== null || rect.height > 0) &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        )
      }
      return (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(isVisible) || null
    })

    const userEl = userHandle.asElement() as any
    const passEl = passHandle.asElement() as any

    // 3. Human mouse movements & keystrokes (triggers visual overlay cursor & React Native Web updates)
    if (userEl && creds.username) {
      const userSelector = await userEl.evaluate((el: HTMLElement) => {
        const marker = `login-user-${Date.now()}`
        el.setAttribute("data-qa-human-login", marker)
        return `[data-qa-human-login="${marker}"]`
      }).catch(() => undefined)
      await publishLiveAction(job, page, {
        type: "type",
        description: "Typing login username",
        target: "Email / username",
        selector: userSelector,
        value: creds.username,
      })
      const userBox = await userEl.boundingBox().catch(() => null)
      if (userBox) {
        await humanMouseMove(page, userBox.x + userBox.width / 2, userBox.y + userBox.height / 2)
        await publishLiveFrame(job, page)
      }
      await userEl.click({ count: 3 }).catch(() => {})
      await page.keyboard.press("Backspace").catch(() => {})
      await page.keyboard.down("Control").catch(() => {})
      await page.keyboard.press("KeyA").catch(() => {})
      await page.keyboard.up("Control").catch(() => {})
      await page.keyboard.press("Backspace").catch(() => {})
      await userEl.type(creds.username, { delay: 10 }).catch(() => {})
    }

    if (passEl && creds.password) {
      const passSelector = await passEl.evaluate((el: HTMLElement) => {
        const marker = `login-password-${Date.now()}`
        el.setAttribute("data-qa-human-login", marker)
        return `[data-qa-human-login="${marker}"]`
      }).catch(() => undefined)
      await publishLiveAction(job, page, {
        type: "type",
        description: "Typing login password",
        target: "Password",
        selector: passSelector,
        sensitive: true,
      })
      const passBox = await passEl.boundingBox().catch(() => null)
      if (passBox) {
        await humanMouseMove(page, passBox.x + passBox.width / 2, passBox.y + passBox.height / 2)
        await publishLiveFrame(job, page)
      }
      await passEl.click({ count: 3 }).catch(() => {})
      await page.keyboard.press("Backspace").catch(() => {})
      await page.keyboard.down("Control").catch(() => {})
      await page.keyboard.press("KeyA").catch(() => {})
      await page.keyboard.up("Control").catch(() => {})
      await page.keyboard.press("Backspace").catch(() => {})
      await passEl.type(creds.password, { delay: 10 }).catch(() => {})
    }

    // Secondary fallback sync for controlled inputs with custom property descriptors
    await page.evaluate((u, p) => {
      const setIfNeeded = (el: HTMLInputElement | null, val: string) => {
        if (!el || el.value === val) return
        el.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        if (setter) setter.call(el, val)
        else el.value = val
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      }
      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(
        (x) => x.offsetParent !== null || x.getBoundingClientRect().height > 0
      )
      if (pw && pw.value !== p) setIfNeeded(pw, p)

      const scope = (pw && pw.closest("form")) || document
      const user = (Array.from(
        scope.querySelectorAll(
          'input[type="email"], input[name*="user" i], input[name*="email" i], input[placeholder*="email" i], input[type="text"]'
        )
      ) as HTMLInputElement[]).find((x) => (x.offsetParent !== null || x.getBoundingClientRect().height > 0) && x.type !== "password")
      if (user && u && user.value !== u) setIfNeeded(user, u)
    }, creds.username || "", creds.password || "")

    // 4. Find submit button or touchable element (supporting RN Web div[class*="r-cursor"], UIKittenButton, etc.)
    const btnHandle = await page.evaluateHandle(() => {
      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(
        (x) => x.offsetParent !== null || x.getBoundingClientRect().height > 0
      )
      const scope = (pw && pw.closest("form")) || document

      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }

      const all = Array.from(
        scope.querySelectorAll(
          'button, input[type="submit"], [role="button"], a, div[class*="cursor"], div[class*="r-cursor"], div[tabindex], div, span'
        )
      ) as HTMLElement[]

      const isAuthExact = (t: string) => /^\s*(sign\s*in|log\s*in|login|continue|submit|next)\s*$/i.test(t.trim())
      const isAuthContains = (t: string) => /\b(sign\s*in|log\s*in|login|continue|submit|next)\b/i.test(t.trim())

      // Priority 1: exact text match on visible element
      const exact = all.find((el) => isVisible(el) && isAuthExact(el.textContent || (el as any).value || ""))
      if (exact) {
        return exact.closest('[class*="r-cursor"], [role="button"], button') || exact
      }

      // Priority 2: explicit submit type
      const submitType = all.find(
        (el) => isVisible(el) && ((el as HTMLButtonElement).type === "submit" || el.getAttribute("type") === "submit")
      )
      if (submitType) return submitType

      // Priority 3: partial text match (e.g. "Sign In to continue")
      const partial = all.find(
        (el) =>
          isVisible(el) &&
          isAuthContains(el.textContent || (el as any).value || "") &&
          (el.textContent || "").trim().length < 40
      )
      if (partial) {
        return partial.closest('[class*="r-cursor"], [role="button"], button') || partial
      }

      // Priority 4: first button in form
      const firstBtn = all.find((el) => isVisible(el) && el.tagName === "BUTTON")
      return firstBtn || null
    })

    const btnEl = btnHandle.asElement() as any
    let clicked = false

    if (btnEl) {
      const submitSelector = await btnEl.evaluate((el: HTMLElement) => {
        const marker = `login-submit-${Date.now()}`
        el.setAttribute("data-qa-human-login", marker)
        return `[data-qa-human-login="${marker}"]`
      }).catch(() => undefined)
      await publishLiveAction(job, page, {
        type: "click",
        description: "Clicking login submit",
        target: "Sign in",
        selector: submitSelector,
      })
      const submitBox = await btnEl.boundingBox().catch(() => null)
      if (submitBox) {
        await humanMouseMove(page, submitBox.x + submitBox.width / 2, submitBox.y + submitBox.height / 2)
        await publishLiveFrame(job, page)
      }
      const humanClickPoint = await humanClick(page, btnEl).catch(() => null)
      clicked = Boolean(humanClickPoint)
      if (clicked) {
        if (job.currentAction) job.currentAction.status = "passed"
        await publishLiveFrame(job, page)
      } else {
        // Fallback for React Native Web / touchable controls that ignore native mouse input.
        await page.evaluate((el: any) => {
          if (!el) return
          const rect = el.getBoundingClientRect()
          const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }
          el.dispatchEvent(new PointerEvent("pointerdown", opts))
          el.dispatchEvent(new MouseEvent("mousedown", opts))
          el.dispatchEvent(new PointerEvent("pointerup", opts))
          el.dispatchEvent(new MouseEvent("mouseup", opts))
          el.dispatchEvent(new MouseEvent("click", opts))
          if (typeof el.click === "function") el.click()
        }, btnHandle)

        await btnEl.click().catch(() => {})
        clicked = true
      }
    }

    if (!clicked) {
      await page.keyboard.press("Enter").catch(() => {})
    }

    // 5. Poll for login completion (URL change, visible password field disappearance, or explicit error notification)
    const startUrl = page.url()
    const deadline = Date.now() + 15000

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 600))

      const status = await page.evaluate((initialUrl) => {
        const isVisible = (el: HTMLElement) => {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          return (
            (el.offsetParent !== null || rect.height > 0) &&
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          )
        }
        const pw = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
        const hasVisiblePw = pw.some(isVisible)

        const currentUrl = window.location.href
        const urlChanged = currentUrl !== initialUrl && !currentUrl.includes("login") && !currentUrl.includes("signin")
        const bodyText = (document.body?.innerText || "").toLowerCase()
        const errorMatch = /invalid\s*(email|username|password|credentials)|wrong\s*password|user\s*not\s*found|login\s*failed|unable\s*to\s*connect/i.test(bodyText)

        return { hasVisiblePw, urlChanged, errorMatch }
      }, startUrl)

      if (status.urlChanged || (inputsFound.hasPw && !status.hasVisiblePw) || (!inputsFound.hasPw && !(await hasLoginWall(page)))) {
        await new Promise((r) => setTimeout(r, 1200))
        return true
      }

      if (status.errorMatch) {
        return false
      }
    }

    return !(await hasLoginWall(page))
  } catch {
    return false
  }
}

/**
 * Handles a login wall: uses provided creds if any, otherwise pauses the job and
 * waits for the UI to supply them (or skip). Returns true when logged in.
 */
export async function authenticateIfNeeded(job: AutomationJob, page: Page, creds?: LoginCreds): Promise<boolean> {
  let active: LoginCreds | undefined = creds && (creds.username || creds.password) ? creds : undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!active) {
      job.authState = "awaiting_credentials"
      job.authPrompt =
        attempt === 0
          ? "Login or email required. Enter your email (and password if needed) to continue testing, or skip."
          : "Login or email attempt failed. Try again or skip."
      job.pendingCredentials = undefined
      job.currentStep = "Waiting for login or email..."
      appendLog(job, "warn", "[AUTH] Login or email required on this screen - waiting for user input.")

      if (!job.messages) job.messages = []
      job.messages.push({
        id: `msg-auth-${Date.now()}`,
        sender: "agent",
        text: attempt === 0
          ? "🔐 Login or email required on this screen. Please enter your email (and password if needed), or type 'skip'."
          : "⚠️ Login or email verification didn't succeed. Please enter your email or password again, or type 'skip'.",
        timestamp: new Date().toISOString(),
      })
      emitSessionEvent(job, "user_input", {
        message: "Login or email required to continue testing.",
        payload: { authState: "awaiting_credentials", prompt: job.authPrompt },
      })
      saveJob(job)

      const deadline = Date.now() + 10 * 60 * 1000
      while (!job.pendingCredentials && job.status === "running" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500))
        const vaultCreds = getJobSecrets(job.id)?.credentials
        if (vaultCreds && (vaultCreds.username || vaultCreds.password)) {
          job.pendingCredentials = { username: vaultCreds.username, password: vaultCreds.password }
          break
        }
        const refreshed = getJob(job.id)
        if (refreshed?.pendingCredentials) {
          job.pendingCredentials = refreshed.pendingCredentials
          break
        }
        if (refreshed?.status && refreshed.status !== "running") {
          job.status = refreshed.status
          break
        }
      }
      const supplied = job.pendingCredentials as AutomationJob["pendingCredentials"]
      job.pendingCredentials = undefined
      if (job.status !== "running") return false
      if (!supplied || supplied.skip) {
        job.authState = "skipped"
        job.authPrompt = undefined
        appendLog(job, "warn", "[AUTH] Login skipped - mapping only publicly reachable screens.")
        saveJob(job)
        return false
      }
      active = supplied
    }

    if (active.username) secretRedactor.registerMultiple([active.username])
    if (active.password) secretRedactor.registerMultiple([active.password])
    appendLog(job, "info", `[AUTH] Typing credentials for ${active.username || "user"} and submitting...`)
    job.authPrompt = undefined
    job.currentStep = "Submitting credentials..."
    saveJob(job)

    if (await attemptLogin(job, page, active)) {
      if (creds) Object.assign(creds, { username: active.username, password: active.password })
      job.authState = "logged_in"
      job.authPrompt = undefined
      appendLog(job, "success", `[AUTH] Logged in successfully. Now at ${secretRedactor.redact(page.url())}`)
      if (!job.messages) job.messages = []
      job.messages.push({
        id: `msg-auth-ok-${Date.now()}`,
        sender: "agent",
        text: `✅ Successfully authenticated with ${active.username || "credentials"}. Resuming test execution.`,
        timestamp: new Date().toISOString(),
      })
      saveJob(job)
      return true
    }

    job.authState = "login_failed"
    appendLog(job, "error", "[AUTH] Authentication failed - screen still requires login after submit.")
    saveJob(job)
    active = undefined
  }
  job.authState = "skipped"
  saveJob(job)
  return false
}

async function collectLinks(
  page: Page,
  origin: string,
  knownRoutes: Array<{ path: string; title?: string }> = []
): Promise<Array<{ text: string; href: string }>> {
  return page.evaluate(
    (org: string, routes: Array<{ path: string; title?: string }>) => {
      const list: Array<{ text: string; href: string }> = []
      const seen = new Set<string>()

      const tryAdd = (href?: string | null, rawText?: string | null) => {
        try {
          if (!href || typeof href !== "string") return
          const trimmed = href.trim()
          if (
            !trimmed ||
            trimmed.startsWith("javascript:") ||
            trimmed.startsWith("mailto:") ||
            trimmed.startsWith("tel:")
          ) {
            return
          }

          let full = trimmed
          if (full.startsWith("/")) {
            full = org + full
          } else if (!full.startsWith("http://") && !full.startsWith("https://")) {
            full = org + "/" + full.replace(/^\/+/, "")
          }

          if (!full.startsWith(org)) return
          if (/(logout|signout|sign-out|log-off|delete-account|leave)/i.test(full)) return

          const norm = full.replace(/\/+$/, "") || full
          if (!seen.has(norm)) {
            seen.add(norm)
            const cleanText = (rawText || norm.replace(org, "") || "Navigate").trim().slice(0, 40)
            list.push({ text: cleanText, href: full })
          }
        } catch {}
      }

      // 1. Standard Anchor Links
      document.querySelectorAll("a[href]").forEach((a: any) => {
        tryAdd(a.getAttribute("href") || a.href, a.textContent || a.getAttribute("aria-label"))
      })

      // 2. Elements with explicit routing data attributes (Next.js Link, React Router, custom buttons)
      document
        .querySelectorAll("[data-href], [data-path], [data-route], [data-to], [data-url]")
        .forEach((el: any) => {
          const target =
            el.getAttribute("data-href") ||
            el.getAttribute("data-path") ||
            el.getAttribute("data-route") ||
            el.getAttribute("data-to") ||
            el.getAttribute("data-url")
          if (target) tryAdd(target, el.textContent || el.getAttribute("aria-label"))
        })

      // 3. Bottom Navigation, Tab Bars, Mobile Docks, and Navigation Bars
      const navSelector = [
        "nav",
        "header",
        "aside",
        '[role="navigation"]',
        '[role="tablist"]',
        "footer",
        '[class*="sidebar" i]',
        '[class*="drawer" i]',
        '[class*="bottomNav" i]',
        '[class*="bottom-nav" i]',
        '[class*="tabBar" i]',
        '[class*="tab-bar" i]',
        '[class*="bottom-bar" i]',
        '[class*="navigation" i]',
        '[class*="fixed"][class*="bottom-"]',
        '[class*="sticky"][class*="bottom-"]',
        '[aria-label*="nav" i]',
        '[aria-label*="tab" i]',
        '[id*="bottom-nav" i]',
        '[id*="tabbar" i]',
      ].join(", ")

      document.querySelectorAll(navSelector).forEach((navContainer: any) => {
        const items = navContainer.querySelectorAll(
          'a, button, [role="tab"], [role="button"], li, [data-tab], [data-href], [data-path]'
        )
        items.forEach((item: any) => {
          const directHref =
            item.getAttribute("href") ||
            item.getAttribute("data-href") ||
            item.getAttribute("data-path") ||
            item.getAttribute("data-route") ||
            item.getAttribute("data-to") ||
            item.getAttribute("data-url")

          let label = (
            item.getAttribute("aria-label") ||
            item.getAttribute("title") ||
            item.textContent ||
            ""
          ).trim()

          // If label is empty, extract icon info (e.g. Lucide/Material/FontAwesome/Feather)
          if (!label) {
            const svg = item.querySelector("svg")
            if (svg) {
              label =
                svg.getAttribute("aria-label") ||
                svg.querySelector("title")?.textContent ||
                svg.getAttribute("data-icon") ||
                svg.getAttribute("data-lucide") ||
                ""
              if (!label) {
                const svgClass =
                  typeof svg.className === "string"
                    ? svg.className
                    : (svg.className as any)?.baseVal || ""
                const iconMatch = svgClass.match(
                  /(?:lucide|fa|icon|feather|tabler|bi|material)[-_]([a-z0-9-]+)/i
                )
                if (iconMatch && iconMatch[1]) {
                  label = iconMatch[1].replace(/[-_]/g, " ")
                }
              }
            }
          }

          if (directHref) {
            tryAdd(directHref, label)
          } else if (label && !/(logout|sign\s*out|log\s*off)/i.test(label)) {
            // Match against known project routes first
            const normLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "")
            const matchedRoute = routes?.find((r) => {
              const rClean = r.path.toLowerCase().replace(/[^a-z0-9]/g, "")
              const rTitleClean = (r.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")
              return (
                (rClean && (normLabel.includes(rClean) || rClean.includes(normLabel))) ||
                (rTitleClean && (normLabel.includes(rTitleClean) || rTitleClean.includes(normLabel)))
              )
            })

            if (matchedRoute) {
              tryAdd(matchedRoute.path, label)
            } else if (label.length < 25) {
              const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
              if (slug) tryAdd(`/${slug}`, label)
            }
          }
        })
      })

      return list
    },
    origin,
    knownRoutes.map((r) => ({ path: r.path, title: r.title }))
  )
}

/**
 * Discovery expansion pass (2026-10-14 fix): wraps collectLinks with
 * (a) hamburger/drawer opener auto-click, (b) menu/popover trigger expansion
 * ([aria-haspopup], [aria-expanded="false"], [data-state="closed"]) with
 * scraping of newly mounted [role="menu"]/[role="dialog"] items, and
 * (c) a scroll-to-bottom-and-back pass so lazy/virtualized content renders
 * before the crawl. The drawer is closed and the starting URL restored
 * afterwards; menu items are returned as extra crawl candidates. Every
 * sub-step is guarded so one stuck menu cannot hang the crawl.
 */
async function collectLinksWithExpansion(
  page: Page,
  origin: string,
  knownRoutes: Array<{ path: string; title?: string }> = []
): Promise<Array<{ text: string; href: string }>> {
  const startUrl = page.url()
  const extra: Array<{ text: string; href: string }> = []
  let drawerOpened = false

  try {
    // (a) Hamburger / drawer opener: click once so drawer nav enters the DOM.
    // Left open while collectLinks scrapes; closed again at the end.
    try {
      drawerOpened = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[]
        const opener = btns.find(
          (b) => /menu/i.test(b.getAttribute("aria-label") || "") && b.getClientRects().length > 0
        )
        if (opener) {
          opener.click()
          return true
        }
        return false
      })
      if (drawerOpened) await new Promise((r) => setTimeout(r, 350))
    } catch {}

    // (b) Menu / popover triggers: expand each, scrape mounted items, close.
    try {
      const menuItems = await page.evaluate(async () => {
        const out: Array<{ text: string; href: string }> = []
        const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
        const triggers = Array.from(
          document.querySelectorAll('[aria-haspopup], [aria-expanded="false"], [data-state="closed"]')
        ) as HTMLElement[]
        for (const t of triggers.slice(0, 12)) {
          try {
            if (t.getClientRects().length === 0) continue
            t.click()
            await sleep(150)
            const items = Array.from(
              document.querySelectorAll(
                '[role="menu"] a[href], [role="menu"] [role="menuitem"], [role="listbox"] [role="option"], [role="dialog"] a[href]'
              )
            ) as HTMLElement[]
            for (const it of items) {
              const href =
                it.getAttribute("href") || it.getAttribute("data-href") || it.getAttribute("data-path")
              const text = (it.textContent || it.getAttribute("aria-label") || "").trim().slice(0, 40)
              if (href && text) out.push({ text, href })
            }
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
            await sleep(80)
          } catch {}
        }
        return out
      })
      for (const m of menuItems || []) extra.push(m)
    } catch {}

    // (c) Scroll pass for lazy-loaded / virtualized content.
    try {
      await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))
        window.scrollTo(0, document.body.scrollHeight)
        await sleep(400)
        window.scrollTo(0, 0)
        await sleep(200)
      })
    } catch {}
  } catch {}

  // Standard crawl now sees drawer nav plus menu-expanded and lazily rendered content.
  let links: Array<{ text: string; href: string }> = []
  try {
    links = await collectLinks(page, origin, knownRoutes)
  } catch {}

  // Merge menu candidates (same normalization rules as collectLinks' tryAdd).
  try {
    const seen = new Set(links.map((l) => l.href.replace(/\/+$/, "")))
    for (const m of extra) {
      let full = (m.href || "").trim()
      if (!full || /^(javascript:|mailto:|tel:)/i.test(full)) continue
      if (full.startsWith("/")) full = origin + full
      else if (!/^https?:\/\//i.test(full)) full = origin + "/" + full.replace(/^\/+/, "")
      if (!full.startsWith(origin)) continue
      if (/(logout|signout|sign-out|log-off|delete-account|leave)/i.test(full)) continue
      const norm = full.replace(/\/+$/, "") || full
      if (!seen.has(norm)) {
        seen.add(norm)
        links.push({ text: m.text.slice(0, 40) || "Navigate", href: full })
      }
    }
  } catch {}

  // Restore: toggle the drawer closed and return to the starting URL if a
  // click navigated away mid-pass.
  try {
    if (drawerOpened) {
      await page
        .evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[]
          const opener = btns.find(
            (b) => /menu/i.test(b.getAttribute("aria-label") || "") && b.getClientRects().length > 0
          )
          if (opener) opener.click()
          else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
        })
        .catch(() => {})
      await new Promise((r) => setTimeout(r, 250))
    }
    if (page.url() !== startUrl) {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null)
    }
  } catch {}

  return links
}

function rebuildActionLedger(job: AutomationJob, entries: ActionLedgerEntry[]): void {
  const now = new Date().toISOString()
  const deduped = new Map<string, ActionLedgerEntry>()
  for (const entry of entries) {
    const previous = deduped.get(entry.actionKey)
    if (!previous || (entry.lastTestedAt || "") >= (previous.lastTestedAt || "")) {
      deduped.set(entry.actionKey, entry)
    }
  }
  const normalized = Array.from(deduped.values())
  job.actionLedger = {
    entries: normalized,
    untestedQueue: normalized.filter((entry) => entry.status === "untested").map((entry) => entry.actionKey),
    updatedAt: now,
    total: normalized.length,
    untested: normalized.filter((entry) => entry.status === "untested").length,
    tested: normalized.filter((entry) => ["passed", "failed", "skipped"].includes(entry.status)).length,
    failed: normalized.filter((entry) => entry.status === "failed").length,
    blocked: normalized.filter((entry) => entry.status === "blocked").length,
  }
}

function stableActionKeyForScreen(screen: AppScreenNode, element: ActionableElement): string {
  const rawKey = element.actionKey || [
    "dom",
    element.type,
    element.name.trim().toLowerCase(),
    element.selector || "",
    element.href || "",
    element.formId || "",
  ].join("|")
  const prefix = `screen|${screen.path}|`
  return rawKey.startsWith(prefix) ? rawKey : `${prefix}${rawKey}`
}

function mergeScreenActionsIntoLedger(job: AutomationJob, screen: AppScreenNode): void {
  const existing = new Map<string, ActionLedgerEntry>(
    (job.actionLedger?.entries || []).map((entry) => [entry.actionKey, entry])
  )
  const now = new Date().toISOString()

  for (const element of screen.actionableElements) {
    const actionKey = stableActionKeyForScreen(screen, element)

    element.actionKey = actionKey
    const previous = existing.get(actionKey)

    existing.set(actionKey, {
      actionKey,
      screenId: screen.id,
      screenUrl: screen.url,
      screenPath: screen.path,
      name: element.name,
      type: element.type,
      selector: element.selector,
      href: element.href,
      interactionConfidence: element.interactionConfidence,
      discoveryReason: element.discoveryReason,
      status: previous?.status || "untested",
      attempts: previous?.attempts || 0,
      discoveredAt: previous?.discoveredAt || now,
      lastTestedAt: previous?.lastTestedAt,
      workflowId: previous?.workflowId,
      error: previous?.error,
      evidence: previous?.evidence,
      history: previous?.history || [],
    })
  }

  rebuildActionLedger(job, Array.from(existing.values()))
}

function updateActionLedgerForStep(
  job: AutomationJob,
  step: TestPlanStep,
  status: ActionLedgerEntry["status"],
  observedOutcome?: string,
  error?: string,
  evidence?: { beforeScreenshotUrl?: string; afterScreenshotUrl?: string }
): void {
  const ledger = job.actionLedger
  if (!ledger) return

  const entry = step.actionKey
    ? ledger.entries.find((candidate) => candidate.actionKey === step.actionKey)
    : ledger.entries.find((candidate) =>
        candidate.screenId === step.screenId &&
        candidate.name.toLowerCase() === step.targetName.toLowerCase() &&
        (!step.targetSelector || candidate.selector === step.targetSelector)
      )

  if (!entry) return

  const timestamp = new Date().toISOString()
  entry.status = status
  entry.lastTestedAt = timestamp

  // Starting a retry should not erase the previous resolved outcome.
  if (status === "running" || status === "untested") {
    rebuildActionLedger(job, ledger.entries)
    return
  }

  entry.attempts += 1
  const safeError = error ? secretRedactor.redact(error) : undefined
  const safeOutcome = observedOutcome ? secretRedactor.redact(observedOutcome) : undefined
  entry.error = safeError
  entry.evidence = {
    beforeScreenshotUrl: evidence?.beforeScreenshotUrl,
    afterScreenshotUrl: evidence?.afterScreenshotUrl,
    observedOutcome: safeOutcome,
  }
  entry.history = [
    ...(entry.history || []),
    {
      status,
      timestamp,
      observedOutcome: safeOutcome,
      error: safeError,
      beforeScreenshotUrl: evidence?.beforeScreenshotUrl,
      afterScreenshotUrl: evidence?.afterScreenshotUrl,
    },
  ].slice(-20)

  rebuildActionLedger(job, ledger.entries)
}

function linkTestPlanStepsToLedger(job: AutomationJob, testPlan: FullAppTestPlan): void {
  const ledger = job.actionLedger
  if (!ledger) return

  for (const step of testPlan.steps) {
    if (step.actionKey) continue

    // A form scenario exercises the form's submit control. Link it to that
    // control so the ledger does not create a redundant standalone click step.
    if (step.actionType === "form_scenario" && step.formId) {
      const screen = testPlan.screens.find((candidate) => candidate.id === step.screenId)
      const form = screen?.forms.find((candidate) => candidate.id === step.formId)
      const submitName = form?.submitButton?.trim().toLowerCase()
      const submitEntry = submitName
        ? ledger.entries.find((candidate) =>
            candidate.screenId === step.screenId &&
            candidate.name.trim().toLowerCase() === submitName
          )
        : undefined
      if (submitEntry) {
        step.actionKey = submitEntry.actionKey
        continue
      }
    }

    const entry = ledger.entries.find((candidate) =>
      candidate.screenId === step.screenId &&
      candidate.name.toLowerCase() === step.targetName.toLowerCase() &&
      (!step.targetSelector || candidate.selector === step.targetSelector)
    )
    if (entry) step.actionKey = entry.actionKey
  }
}

/**
 * Ensures every discovered ledger action has an executable plan step. This is
 * used after initial planning and after every live DOM rescan, so links, tabs,
 * form fields and controls revealed by modals do not disappear from coverage.
 */
function queueUnplannedLedgerActions(
  job: AutomationJob,
  testPlan: FullAppTestPlan,
  onlyScreenId?: string,
  insertAfterIndex?: number
): number {
  const ledger = job.actionLedger
  if (!ledger) return 0

  linkTestPlanStepsToLedger(job, testPlan)
  const represented = new Set(
    testPlan.steps.map((step) => step.actionKey).filter((key): key is string => Boolean(key))
  )
  let added = 0
  let insertAt = insertAfterIndex === undefined ? -1 : insertAfterIndex + 1

  // Keep dismiss/close controls last when a modal is discovered, so the queue
  // gets a chance to exercise the other controls before the view disappears.
  const candidates = ledger.entries
    .filter((entry) => {
      if (entry.status !== "untested") return false
      if (onlyScreenId && entry.screenId !== onlyScreenId) return false
      // If already authenticated, only skip primary login credential inputs/submits,
      // but PRESERVE auxiliary actions (forgot password, create account, register, SSO)!
      if (job.authState === "logged_in") {
        const sc = testPlan.screens.find((s) => s.id === entry.screenId)
        if (sc?.isLoginWall) {
          const isPrimaryAuthInputOrSubmit =
            (entry.type === "input" && /(email|user|pass|login)/i.test(entry.name)) ||
            ((entry.type === "button" || entry.type === "clickable") && /^(sign\s*in|log\s*in|submit)$/i.test(entry.name.trim()))
          if (isPrimaryAuthInputOrSubmit) {
            entry.status = "skipped"
            entry.error = "Covered by authentication step (login form credentials already submitted)."
            return false
          }
        }
      }
      return true
    })
    .sort((a, b) => {
      const aDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(a.name.trim())
      const bDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(b.name.trim())
      return Number(aDismiss) - Number(bDismiss)
    })

  for (const entry of candidates) {
    if (represented.has(entry.actionKey)) continue

    const screen = testPlan.screens.find((candidate) => candidate.id === entry.screenId)
    const element = screen?.actionableElements.find((candidate) => candidate.actionKey === entry.actionKey)
    const actionType: TestPlanStep["actionType"] =
      entry.type === "input" ? "fill" :
      entry.type === "select" ? "select" :
      entry.type === "checkbox" || entry.type === "radio" || entry.type === "toggle" ? "toggle" :
      entry.type === "file_upload" ? "upload" :
      entry.type === "button" || entry.type === "clickable" || entry.type === "link" ||
      entry.type === "tab" || entry.type === "menu" || (entry.type === "other" && element?.isInteractive) ? "click" :
      "verify"

    // Do not silently turn an unknown element into a passing verification step.
    if (actionType === "verify") continue

    const name = entry.name || "Unnamed action"
    let syntheticValue: string | undefined
    if (actionType === "fill") {
      const inputType = (element?.inputType || "").toLowerCase()
      if (inputType === "email" || /email/i.test(name)) syntheticValue = SYNTHETIC_TEST_DATA.email
      else if (inputType === "password" || /password/i.test(name)) syntheticValue = SYNTHETIC_TEST_DATA.password
      else if (inputType === "tel" || /phone|mobile/i.test(name)) syntheticValue = SYNTHETIC_TEST_DATA.phone
      else syntheticValue = SYNTHETIC_TEST_DATA.fullName
    } else if (actionType === "select") {
      syntheticValue = element?.options?.[0] || "Option 1"
    }

    let fileTypeRequired: TestPlanStep["fileTypeRequired"]
    if (actionType === "upload") {
      const accept = element?.accept || ""
      fileTypeRequired = /pdf/i.test(accept + name) ? "pdf" :
        /csv/i.test(accept + name) ? "csv" :
        /video/i.test(accept + name) ? "video" :
        /doc/i.test(accept + name) ? "document" : "image"
    }

    const queuedStep: TestPlanStep = {
      id: `step-${Date.now()}-${testPlan.steps.length + added + 1}`,
      screenId: entry.screenId,
      screenName: screen?.name || entry.screenPath,
      stepIndex: insertAt < 0 ? testPlan.steps.length + 1 : insertAt + 1,
      actionType,
      targetName: name,
      targetSelector: entry.selector,
      actionKey: entry.actionKey,
      syntheticValue,
      fileTypeRequired,
      expectedResult: actionType === "click"
        ? `Clicking "${name}" produces a verifiable UI, navigation, modal, or network effect.`
        : actionType === "fill"
          ? `Field "${name}" accepts synthetic input and reflects the entered value.`
          : actionType === "select"
            ? `Control "${name}" changes to the selected option.`
            : actionType === "upload"
              ? `Upload control "${name}" accepts a compatible test file.`
              : `Control "${name}" responds to interaction and its outcome is recorded.`,
      status: "pending",
    }
    if (insertAt < 0) {
      testPlan.steps.push(queuedStep)
    } else {
      testPlan.steps.splice(insertAt, 0, queuedStep)
      insertAt++
    }
    represented.add(entry.actionKey)
    added++
  }

  if (added > 0) {
    testPlan.steps.forEach((step, index) => { step.stepIndex = index + 1 })
    appendLog(job, "info", `[QUEUE] Added ${added} previously unplanned action(s) to the execution queue.`)
  }
  return added
}

/**
 * Keep pending work for the current screen together in the queue. This avoids
 * repeatedly leaving and re-entering tabs while their controls are still pending.
 * Dismiss/close controls are moved to the end so they do not hide untested siblings.
 */
function prioritizePendingStepsForScreen(
  testPlan: FullAppTestPlan,
  screenId: string,
  afterIndex: number
): number {
  const start = afterIndex + 1
  if (start >= testPlan.steps.length) return 0

  const remaining = testPlan.steps.slice(start)
  const sameScreen = remaining.filter((step) => step.screenId === screenId && step.status === "pending")
  if (sameScreen.length === 0) return 0

  const sameScreenIds = new Set(sameScreen.map((step) => step.id))
  const otherSteps = remaining.filter((step) => !sameScreenIds.has(step.id))
  sameScreen.sort((a, b) => {
    const aDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(a.targetName.trim())
    const bDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(b.targetName.trim())
    return Number(aDismiss) - Number(bDismiss)
  })

  testPlan.steps.splice(start, remaining.length, ...sameScreen, ...otherSteps)
  testPlan.steps.forEach((step, index) => { step.stepIndex = index + 1 })
  return sameScreen.length
}

export async function discoverAndMapApp(
  job: AutomationJob,
  page: Page,
  baseUrl: string,
  options: { maxScreens?: number; credentials?: LoginCreds; projectDir?: string; layaUrl?: string } = {}
): Promise<{
  screens: AppScreenNode[]
  transitions: AppWorkflowTransition[]
}> {
  const maxLimit = options.maxScreens || 10
  const screens: AppScreenNode[] = []
  const transitions: AppWorkflowTransition[] = []
  const origin = new URL(baseUrl).origin
  const pathScreenMap = new Map<string, string>() // normalized path -> screenId (e.g. S001)

  // Seed project routes & component locations
  const fsRoutes = discoverLocalProjectRoutes(baseUrl, options.projectDir)
  const getComponentLocationForPath = (p: string) => matchRouteForPath(fsRoutes, p)?.file

  appendLog(job, "info", "Starting Phase 1: Systematic Application Discovery & Mapping...")
  job.testingPhase = "discovery"
  job.currentStep = "Phase 1: Discovering and mapping application screens..."
  saveJob(job)

  let screenSeq = 1

  const layaUrl = options.layaUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL

  // Records the page's current state as a screen (reuses ID if path already known).
  const mapCurrentScreen = async (forceNew = false): Promise<{ id: string; isNew: boolean }> => {
    const curPath = normalizePath(page.url(), origin)
    if (!forceNew) {
      const known = pathScreenMap.get(curPath)
      if (known) return { id: known, isNew: false }
    }

    // Pass A: Extract top-of-viewport actionable elements & forms
    const inv = await extractActionableInventory(page, layaUrl)

    // Pass B: Progressive Viewport Scrolling (Top-to-Bottom Exploration)
    try {
      const scrollMetrics = await page.evaluate(() => ({
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 0),
        innerHeight: window.innerHeight || 800,
      })).catch(() => ({ scrollHeight: 0, innerHeight: 800 }))

      if (scrollMetrics.scrollHeight > scrollMetrics.innerHeight + 100) {
        appendLog(job, "info", `[SCROLL DISCOVERY] Page is scrollable (${scrollMetrics.scrollHeight}px > ${scrollMetrics.innerHeight}px). Scanning below fold...`)
        const stepSize = Math.max(250, Math.floor(scrollMetrics.innerHeight * 0.75))
        const maxScroll = Math.min(scrollMetrics.scrollHeight, scrollMetrics.innerHeight * 4)
        let currentScroll = 0
        while (currentScroll + stepSize < maxScroll) {
          currentScroll += stepSize
          await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), currentScroll).catch(() => {})
          await new Promise((r) => setTimeout(r, 180))

          const scrolledInv = await extractActionableInventory(page, layaUrl)
          for (const el of scrolledInv.actionableElements) {
            if (!inv.actionableElements.some((e) => e.selector === el.selector || (e.name === el.name && e.type === el.type))) {
              inv.actionableElements.push(el)
            }
          }
          for (const form of scrolledInv.forms) {
            if (!inv.forms.some((f) => f.id === form.id || f.selector === form.selector)) {
              inv.forms.push(form)
            }
          }
        }
        // Restore scroll to top
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })).catch(() => {})
        await new Promise((r) => setTimeout(r, 150))
      }
    } catch (scrollErr: any) {
      console.warn("[Progressive Scroll Discovery]", scrollErr?.message)
    }

    const id = `S${String(screenSeq++).padStart(3, "0")}`
    let shot = ""
    try {
      const buf = await takeSecureScreenshot(page, { type: "jpeg", quality: 75 })
      shot = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
    } catch {}

    // Laya Vision: visual classification and blocking UI check
    let layaInfo: { pageType?: string; hasBlockingIssue?: boolean; ready?: boolean } = {}
    try {
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => "")
      const layaResult = await classifyPage(pageText, page.url(), layaUrl, shot)
      if (layaResult) {
        layaInfo = layaResult
        if (layaResult.hasBlockingIssue) {
          job.issues.push({
            id: `issue-vis-${Date.now()}`,
            screenUrl: page.url(),
            screenTitle: `Screen ${id}`,
            type: "layout_shift",
            severity: "high",
            description: `Laya Vision detected a potential visual layout or blocking UI issue on ${page.url()}`,
            timestamp: new Date().toISOString(),
          })
        }
      }
    } catch (layaErr: any) {
      console.warn("[Laya Vision Classification]", layaErr?.message)
    }

    const pageHasLoginWall = await hasLoginWall(page).catch(() => false)
    const compLoc = getComponentLocationForPath(curPath)
    const rawName = deriveScreenName(curPath, inv.heading, inv.modalTitle, pageHasLoginWall)
    const displayName = layaInfo.pageType && layaInfo.pageType !== "other" && (!inv.heading || inv.heading.length < 3)
      ? `${layaInfo.pageType.charAt(0).toUpperCase() + layaInfo.pageType.slice(1)} Screen (${curPath})`
      : rawName

    const node: AppScreenNode = {
      id,
      name: displayName,
      url: page.url(),
      path: curPath,
      componentLocation: compLoc,
      sourceFile: compLoc,
      screenshotUrl: shot || undefined,
      actionableElements: inv.actionableElements,
      forms: inv.forms,
      isLoginWall: pageHasLoginWall,
      discoveredAt: new Date().toISOString(),
      pageType: layaInfo.pageType,
      hasBlockingIssue: layaInfo.hasBlockingIssue,
      isReady: layaInfo.ready,
    }
    screens.push(node)
    pathScreenMap.set(curPath, id)
    // Publish the same live browser frame the crawler is currently inspecting.
    if (shot) job.currentScreenshotUrl = shot
    job.currentUrl = page.url()
    mergeScreenActionsIntoLedger(job, node)
    saveJob(job)
    appendLog(
      job,
      "success",
      `[DISCOVERY] Screen ${node.id}: "${node.name}" (${node.path}) mapped with ${node.actionableElements.length} actionable elements (type: ${node.pageType || "standard"}).`
    )
    return { id, isNew: true }
  }

  const addTransition = (from: string, to: string, action: string, actionType: AppWorkflowTransition["actionType"]) => {
    if (transitions.some((t) => t.fromScreenId === from && t.toScreenId === to && t.action === action)) return
    transitions.push({ id: `tr-${transitions.length + 1}`, fromScreenId: from, toScreenId: to, action, actionType })
  }

  // Map starting screen (wait for SPA splash to finish first)
  await waitForSpaPageReady(page, 4500)
  const startingHadLoginWall = await hasLoginWall(page)
  const root = await mapCurrentScreen()
  if (startingHadLoginWall) {
    const rootNode = screens.find((s) => s.id === root.id)
    if (rootNode) rootNode.isLoginWall = true
  }
  let startId = root.id

  // Login wall: use provided creds, or pause and ask the user
  if (startingHadLoginWall) {
    const loggedIn = await authenticateIfNeeded(job, page, options.credentials)
    if (loggedIn) {
      await waitForSpaPageReady(page, 3000)
      const post = await mapCurrentScreen(true)
      addTransition(root.id, post.id, "Submit Login Form", "form_submit")
      startId = post.id
    }
  } else {
    job.authState = "none"
  }

  // BFS over internal links: every newly mapped screen contributes its own links
  type Cand = { from: string; text: string; href: string }
  const queue: Cand[] = (await collectLinksWithExpansion(page, origin, fsRoutes)).map((c) => ({ from: startId, ...c }))

  try {
    for (const r of fsRoutes) queue.push({ from: startId, text: r.title || r.path, href: r.url })
  } catch {}

  const visitedHrefs = new Set<string>()
  while (queue.length > 0 && screens.length < maxLimit && job.status === "running") {
    const cand = queue.shift()!
    const candPath = normalizePath(cand.href, origin)

    const known = pathScreenMap.get(candPath)
    if (known) {
      if (known !== cand.from) {
        addTransition(cand.from, known, `Navigate to ${cand.text || candPath}`, "navigation")
        addTransition(known, cand.from, `Return / Back ↩️`, "navigation")
      }
      continue
    }
    if (visitedHrefs.has(candPath)) continue
    visitedHrefs.add(candPath)

    try {
      appendLog(job, "info", `[DISCOVERY] Navigating to: ${secretRedactor.redact(cand.href)}...`)
      await page.goto(cand.href, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null)
      await waitForSpaPageReady(page, 2000)

      // Check if redirected to login wall mid-crawl
      const pageHadLoginWall = await hasLoginWall(page)
      if (pageHadLoginWall && job.authState !== "logged_in" && job.authState !== "skipped") {
        appendLog(job, "warn", `[AUTH] Login wall encountered at ${cand.href}. Pausing for credentials...`)
        const loggedIn = await authenticateIfNeeded(job, page, options.credentials)
        if (loggedIn) {
          await waitForSpaPageReady(page, 3000)
          const post = await mapCurrentScreen(true)
          addTransition(cand.from, post.id, "Submit Login Form", "form_submit")
          continue
        }
      } else if (job.authState === "logged_in" && pageHadLoginWall) {
        appendLog(job, "warn", "[AUTH] Redirected to login mid-crawl - skipping protected route.")
        continue
      }

      const here = await mapCurrentScreen()
      addTransition(cand.from, here.id, `Navigate to ${cand.text || candPath}`, "navigation")
      addTransition(here.id, cand.from, `Return / Back ↩️`, "navigation")
      if (here.isNew) {
        const more = await collectLinksWithExpansion(page, origin, fsRoutes)
        for (const m of more) queue.push({ from: here.id, ...m })
      }
    } catch (err: any) {
      appendLog(job, "warn", `Discovery navigation error on ${cand.href}: ${err?.message}`)
    }
  }

  // SPA View & Tab Discovery: discover and map tabs/views on the start screen
  if (screens.length < maxLimit && job.status === "running") {
    try {
      const spaTabs = await page.evaluate(() => {
        function getAccessibleControlName(el: Element, fallback = "Tab"): string {
          if (!el) return fallback
          const h = el as HTMLElement
          const ariaLabel = h.getAttribute("aria-label")
          if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().replace(/\s+/g, " ").slice(0, 50)
          const title = h.getAttribute("title")
          if (title && title.trim()) return title.trim().replace(/\s+/g, " ").slice(0, 50)
          const text = (h.textContent || "").trim()
          if (text) return text.replace(/\s+/g, " ").slice(0, 50)
          const svg = el.querySelector("svg")
          if (svg) {
            const svgAria = svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || svg.getAttribute("data-icon") || svg.getAttribute("data-lucide")
            if (svgAria && svgAria.trim()) return svgAria.trim().slice(0, 50)
            const svgClass = typeof svg.className === "string" ? svg.className : ((svg.className as any)?.baseVal || "")
            const iconMatch = svgClass.match(/(?:lucide|fa|icon|feather|tabler|bi|material)[-_]([a-z0-9-]+)/i)
            if (iconMatch && iconMatch[1]) {
              const iconName = iconMatch[1].replace(/[-_]/g, " ")
              return iconName.charAt(0).toUpperCase() + iconName.slice(1)
            }
          }
          return fallback
        }

        function generateOptimalSelector(el: Element): string {
          if (!el || !(el instanceof Element)) return ""
          const h = el as HTMLElement
          if (h.id && document.querySelectorAll("#" + CSS.escape(h.id)).length === 1) return "#" + CSS.escape(h.id)
          const testId = el.getAttribute("data-testid") || el.getAttribute("data-cy")
          if (testId) {
            const sel = `[data-testid="${CSS.escape(testId)}"]`
            if (document.querySelectorAll(sel).length === 1) return sel
          }
          const aria = el.getAttribute("aria-label")
          if (aria) {
            const sel = `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`
            if (document.querySelectorAll(sel).length === 1) return sel
          }
          const parts: string[] = []
          let curr: Element | null = el
          while (curr && curr !== document.documentElement && curr !== document.body) {
            const parent: Element | null = curr.parentElement
            const tag = curr.tagName.toLowerCase()
            if (!parent) { parts.unshift(tag); break }
            const siblings = Array.from(parent.children).filter((c: any) => c.tagName === curr!.tagName)
            const idx = siblings.indexOf(curr) + 1
            parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag)
            const candidate = parts.join(" > ")
            try { if (document.querySelectorAll(candidate).length === 1) return candidate } catch {}
            curr = parent
          }
          return parts.join(" > ") || el.tagName.toLowerCase()
        }

        const list: Array<{ name: string; selector: string }> = []
        const seenNames = new Set<string>()
        const tabQuery =
          '[role="tab"], [data-tab], nav a, nav button, nav [role="button"], footer nav *, [role="navigation"] a, [role="navigation"] button, [role="navigation"] [role="button"], [role="tablist"] > *, [class*="bottomNav" i] *, [class*="bottom-nav" i] *, [class*="tabBar" i] *, [class*="tab-bar" i] *, [class*="fixed"][class*="bottom-"] *, [class*="sticky"][class*="bottom-"] *, .tab, .tab-btn'

        document.querySelectorAll(tabQuery).forEach((el: any) => {
          const style = window.getComputedStyle(el)
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return
          const txt = getAccessibleControlName(el, "").trim().replace(/\s+/g, " ")
          if (!txt || txt.length > 35 || /(logout|sign\s*out|log\s*off|delete)/i.test(txt)) return
          if (seenNames.has(txt.toLowerCase())) return
          seenNames.add(txt.toLowerCase())
          list.push({
            name: txt,
            selector: generateOptimalSelector(el),
          })
        })
        return list
      })

      const bottomNavScreenIds: string[] = [startId]

      for (const tab of spaTabs) {
        if (screens.length >= maxLimit || job.status !== "running") break
        try {
          const clicked = await page.evaluate((target) => {
            const findEl = (sel?: string) => {
              if (!sel || !sel.trim()) return null
              try { return document.querySelector(sel) } catch { return null }
            }
            const el = (findEl(target.selector) ||
              Array.from(document.querySelectorAll(
                '[role="tab"], [data-tab], nav a, nav button, nav [role="button"], footer nav *, [role="navigation"] *, [class*="bottomNav" i] *, [class*="tabBar" i] *, .tab, button, a'
              )).find((b: any) =>
                (b.textContent || b.getAttribute("aria-label") || "").trim().toLowerCase().includes(target.name.toLowerCase())
              )) as HTMLElement | null
            if (!el) return false
            el.click()
            return true
          }, tab)

          if (clicked) {
            await new Promise((r) => setTimeout(r, 600))
            const inv = await extractActionableInventory(page)
            const screenHeading = inv.heading || tab.name
            if (!screens.some((s) => s.name.toLowerCase() === screenHeading.toLowerCase())) {
              const tabScreenId = `S${String(screenSeq++).padStart(3, "0")}`
              let shot = ""
              try {
                const buf = await takeSecureScreenshot(page, { type: "jpeg", quality: 75 })
                shot = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
              } catch {}
              const tabPath = normalizePath(page.url(), origin)
              const finalPath = tabPath !== "/" && !tabPath.includes("#")
                ? tabPath
                : `${tabPath}#${encodeURIComponent(tab.name.toLowerCase().replace(/\s+/g, "-"))}`
              const compLoc = getComponentLocationForPath(tabPath)
              const tabNode: AppScreenNode = {
                id: tabScreenId,
                name: screenHeading,
                url: page.url(),
                path: finalPath,
                componentLocation: compLoc,
                sourceFile: compLoc,
                screenshotUrl: shot || undefined,
                actionableElements: inv.actionableElements,
                forms: inv.forms,
                discoveredAt: new Date().toISOString(),
              }
              screens.push(tabNode)
              if (shot) job.currentScreenshotUrl = shot
              job.currentUrl = page.url()
              mergeScreenActionsIntoLedger(job, tabNode)
              saveJob(job)

              // Interconnect bottom navigation tabs across the entire journey map
              for (const otherId of bottomNavScreenIds) {
                if (otherId !== tabNode.id) {
                  addTransition(otherId, tabNode.id, `Navigate to "${tab.name}" via Bottom Nav`, "click")
                  addTransition(tabNode.id, otherId, `Return / Back ↩️`, "click")
                }
              }
              bottomNavScreenIds.push(tabNode.id)

              appendLog(
                job,
                "success",
                `[DISCOVERY] Screen ${tabNode.id}: "${tabNode.name}" (SPA / Bottom Nav Tab) mapped with ${tabNode.actionableElements.length} actionable elements.`
              )
            }
          }
        } catch {}
      }
    } catch {}
  }

  // In-Page Modals, Drawers & Dialog Discovery
  if (screens.length < maxLimit && job.status === "running") {
    try {
      const modalTriggers = await page.evaluate(() => {
        const triggers: Array<{ name: string; selector: string }> = []
        document.querySelectorAll('button, [role="button"], a').forEach((el: any) => {
          const style = window.getComputedStyle(el)
          if (style.display === "none" || style.visibility === "hidden" || el.offsetWidth <= 4) return
          const txt = (el.textContent || el.getAttribute("aria-label") || "").trim()
          const isModalTrigger = Boolean(
            el.getAttribute("aria-haspopup") === "dialog" ||
            el.getAttribute("data-modal-target") ||
            el.getAttribute("data-target") ||
            /\b(settings|preferences|filter|filter by|add new|create item|quick view|modal)\b/i.test(txt)
          )
          if (isModalTrigger && txt.length > 0 && txt.length < 35 && !/(logout|sign\s*out|delete)/i.test(txt)) {
            triggers.push({ name: txt, selector: el.id ? `#${CSS.escape(el.id)}` : "" })
          }
        })
        return triggers.slice(0, 4)
      })

      for (const trig of modalTriggers) {
        if (screens.length >= maxLimit || job.status !== "running") break
        try {
          const clicked = await page.evaluate((sel, name) => {
            const el = ((sel ? document.querySelector(sel) : null) ||
              Array.from(document.querySelectorAll('button, [role="button"]')).find((b: any) =>
                (b.textContent || "").trim().toLowerCase() === name.toLowerCase()
              )) as HTMLElement | null
            if (!el || typeof el.click !== "function") return false
            el.click()
            return true
          }, trig.selector, trig.name)

          if (clicked) {
            await new Promise((r) => setTimeout(r, 450))
            const modalFound = await page.evaluate(() => {
              const dlg = document.querySelector('[role="dialog"], dialog[open], [class*="modal" i], [class*="drawer" i]')
              return Boolean(dlg)
            })

            if (modalFound) {
              const modalPath = `${normalizePath(page.url(), origin)}#modal-${encodeURIComponent(trig.name.toLowerCase().replace(/\s+/g, "-"))}`
              if (!pathScreenMap.has(modalPath)) {
                const modalId = `S${String(screenSeq++).padStart(3, "0")}`
                const inv = await extractActionableInventory(page, layaUrl)
                let shot = ""
                try {
                  const buf = await takeSecureScreenshot(page, { type: "jpeg", quality: 75 })
                  shot = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
                } catch {}

                const modalNode: AppScreenNode = {
                  id: modalId,
                  name: `${trig.name} (Modal)`,
                  url: page.url(),
                  path: modalPath,
                  screenshotUrl: shot || undefined,
                  actionableElements: inv.actionableElements,
                  forms: inv.forms,
                  discoveredAt: new Date().toISOString(),
                  modalTriggerText: trig.name,
                  pageType: "detail",
                }
                screens.push(modalNode)
                pathScreenMap.set(modalPath, modalId)
                addTransition(startId, modalId, `Open ${trig.name}`, "modal_open")
                addTransition(modalId, startId, `Close ${trig.name}`, "modal_close")
                mergeScreenActionsIntoLedger(job, modalNode)
                appendLog(job, "success", `[DISCOVERY] In-Page Modal Screen ${modalId}: "${modalNode.name}" mapped with ${modalNode.actionableElements.length} elements.`)
              }
            }

            // Close modal: press Escape and click close button if present to restore state
            await page.keyboard.press("Escape").catch(() => {})
            await page.evaluate(() => {
              const closeBtn = document.querySelector('[aria-label*="close" i], button.close, [data-dismiss="modal"]') as HTMLElement | null
              if (closeBtn) closeBtn.click()
            }).catch(() => {})
            await new Promise((r) => setTimeout(r, 300))
          }
        } catch (mErr: any) {
          console.warn("[Modal Discovery]", mErr?.message)
        }
      }
    } catch (e: any) {
      console.warn("[Modal Scan]", e?.message)
    }
  }

  // Return to the start screen before test planning
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null)

  return { screens, transitions }
}

/**
 * Builds the structured test plan from discovered screens and actionable elements
 */
export function generateStructuredTestPlan(
  targetUrl: string,
  screens: AppScreenNode[],
  transitions: AppWorkflowTransition[],
  options?: {
    isAuthenticated?: boolean
    postmanCollection?: string | Record<string, any>
  }
): FullAppTestPlan {
  const steps: TestPlanStep[] = []
  let stepCounter = 1

  let postmanSummary: PostmanCollectionSummary | undefined = undefined
  if (options?.postmanCollection) {
    try {
      postmanSummary = parsePostmanCollection(options.postmanCollection)
    } catch (err: any) {
      console.warn("[Postman Import] Failed to parse collection:", err?.message)
    }
  }

  const requiredFileTypesMap = new Map<string, number>()

  for (const screen of screens) {
    // Track which forms are handled so we avoid loose duplicate steps for their inputs/submits
    const handledFormIds = new Set<string>()

    // If this screen was a pre-auth login wall and we are already authenticated:
    if (screen.isLoginWall && options?.isAuthenticated) {
      // Login already ran during discovery. Only report a pass when that run left
      // evidence: the post-login screen reached via "Submit Login Form".
      const loginTransition = transitions.find((t) => t.fromScreenId === screen.id && t.actionType === "form_submit")
      const postLogin = loginTransition ? screens.find((s) => s.id === loginTransition.toScreenId) : undefined
      const hasEvidence = Boolean(postLogin?.screenshotUrl)
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "verify",
        targetName: "User Authentication",
        expectedResult: "User is successfully authenticated and redirected to application dashboard.",
        actualResult: hasEvidence
          ? `Login submitted during discovery; landed on ${postLogin!.id} "${postLogin!.name}" (${postLogin!.path}).`
          : "Session reports logged in, but no post-login screen evidence was captured during discovery.",
        status: hasEvidence ? "passed" : "blocked",
        verdict: hasEvidence ? "passed" : "blocked",
        screenshotUrl: postLogin?.screenshotUrl,
        evidenceTimestamp: postLogin?.discoveredAt,
      })
      // Mark primary login form as handled so we don't duplicate credentials checks,
      // but continue below to plan auxiliary actions (Forgot password, Create account, etc.)
      screen.forms?.forEach((f) => handledFormIds.add(f.id))
    }

    // 1. Plan Form Scenarios (grouped by screen.forms)
    if (screen.forms && screen.forms.length > 0) {
      for (const form of screen.forms) {
        handledFormIds.add(form.id)
        const formElements = screen.actionableElements.filter(
          (el) => el.formId === form.id || (form.fields && form.fields.includes(el.name))
        )
        const hasRequired = formElements.some((el) => el.isRequired)
        const hasFormat = formElements.some(
          (el) =>
            el.inputType === "email" ||
            el.inputType === "tel" ||
            /email|phone|mobile/i.test(el.name) ||
            /email|phone|mobile/i.test(el.placeholder || "")
        )

        // Strict order: required_empty -> invalid_format -> valid (last)
        if (hasRequired) {
          steps.push({
            id: `step-${stepCounter++}`,
            screenId: screen.id,
            screenName: screen.name,
            stepIndex: steps.length + 1,
            actionType: "form_scenario",
            formId: form.id,
            formVariant: "required_empty",
            targetName: `Form "${form.name || form.id}" (Required Empty Check)`,
            targetSelector: form.selector,
            expectedResult: `Form "${form.name || form.id}" blocks submission and shows validation error when required fields are blank; no mutating 2xx request.`,
            status: "pending",
          })
        }

        if (hasFormat) {
          steps.push({
            id: `step-${stepCounter++}`,
            screenId: screen.id,
            screenName: screen.name,
            stepIndex: steps.length + 1,
            actionType: "form_scenario",
            formId: form.id,
            formVariant: "invalid_format",
            targetName: `Form "${form.name || form.id}" (Invalid Format Check)`,
            targetSelector: form.selector,
            expectedResult: `Form "${form.name || form.id}" blocks submission and displays format error when invalid email/phone is typed; no mutating 2xx request.`,
            status: "pending",
          })
        }

        // Check if a Postman endpoint matches this form
        let matchedEndpointMapping: PostmanEndpointMapping | null = null
        if (postmanSummary && postmanSummary.endpoints.length > 0) {
          for (const ep of postmanSummary.endpoints) {
            const m = matchEndpointToForm(ep, form, formElements, screen.path)
            if (m && (m.overallConfidence === "high" || m.overallConfidence === "medium")) {
              matchedEndpointMapping = m
              break
            }
          }
        }

        let fieldPayload: Record<string, string> | undefined = undefined
        if (matchedEndpointMapping) {
          fieldPayload = buildFormPayloadFromPostman(matchedEndpointMapping, formElements)
        }

        // Always valid scenario last:
        const validTargetName = matchedEndpointMapping
          ? `Form "${form.name || form.id}" (Valid Submission via API: ${matchedEndpointMapping.endpoint.name})`
          : `Form "${form.name || form.id}" (Valid Submission)`

        const validExpected = matchedEndpointMapping
          ? `Form "${form.name || form.id}" accepts mapped fields from Postman endpoint "${matchedEndpointMapping.endpoint.name}" (${matchedEndpointMapping.overallConfidence} confidence) and submits, confirmed on wire.`
          : `Form "${form.name || form.id}" accepts valid synthetic data and submits, resulting in transition, modal close, toast, or 2xx response.`

        steps.push({
          id: `step-${stepCounter++}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: steps.length + 1,
          actionType: "form_scenario",
          formId: form.id,
          formVariant: "valid",
          targetName: validTargetName,
          targetSelector: form.selector,
          fieldPayload,
          postmanEndpoint: matchedEndpointMapping?.endpoint,
          postmanMappings: matchedEndpointMapping?.fieldMappings,
          expectedResult: validExpected,
          status: "pending",
        })
      }
    }

    // 2. Plan Standalone Form Input field interactions (not part of any handled form)
    const standaloneInputs = screen.actionableElements.filter(
      (el) =>
        el.type === "input" &&
        (!el.formId || !handledFormIds.has(el.formId)) &&
        !(screen.isLoginWall && options?.isAuthenticated && /(email|user|pass|login)/i.test(el.name))
    )
    for (const input of standaloneInputs) {
      let syntheticVal = SYNTHETIC_TEST_DATA.fullName
      // Never store real credentials in the plan (persisted + shown in Plan tab).
      // executeStructuredTestPlan substitutes session credentials at fill time.
      if (input.inputType === "email" || /email/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.email
      } else if (input.inputType === "password" || /password/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.password
      } else if (input.inputType === "tel" || /phone|mobile/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.phone
      } else if (/first/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.firstName
      } else if (/last/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.lastName
      } else if (/note|description|comment/i.test(input.name)) {
        syntheticVal = SYNTHETIC_TEST_DATA.notes
      }

      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "fill",
        targetName: input.name,
        targetSelector: input.selector,
        syntheticValue: syntheticVal,
        expectedResult: `Field "${input.name}" accepts synthetic input value without validation errors.`,
        status: "pending",
      })
    }

    // 3. Plan File Uploads
    const fileUploads = screen.actionableElements.filter((el) => el.type === "file_upload")
    for (const upload of fileUploads) {
      let fType: "image" | "pdf" | "document" | "csv" | "other" = "image"
      if (upload.accept?.includes("pdf") || /pdf/i.test(upload.name)) fType = "pdf"
      else if (upload.accept?.includes("csv") || /csv/i.test(upload.name)) fType = "csv"
      else if (upload.accept?.includes("doc") || /doc/i.test(upload.name)) fType = "document"

      requiredFileTypesMap.set(fType, (requiredFileTypesMap.get(fType) || 0) + 1)

      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "upload",
        targetName: upload.name,
        targetSelector: upload.selector,
        fileTypeRequired: fType,
        expectedResult: `Upload control accepts valid ${fType.toUpperCase()} dummy test file.`,
        status: "pending",
      })
    }

    // 4. Plan Standalone Dropdowns / Selects
    const standaloneSelects = screen.actionableElements.filter(
      (el) => el.type === "select" && (!el.formId || !handledFormIds.has(el.formId))
    )
    for (const select of standaloneSelects) {
      const choice = select.options && select.options.length > 0 ? select.options[0] : "Option 1"
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "select",
        targetName: select.name,
        targetSelector: select.selector,
        syntheticValue: choice,
        expectedResult: `Select "${select.name}" value changes to "${choice}".`,
        status: "pending",
      })
    }

    // 5. Plan Standalone Checkboxes & Toggles
    const standaloneToggles = screen.actionableElements.filter(
      (el) => (el.type === "checkbox" || el.type === "toggle") && (!el.formId || !handledFormIds.has(el.formId))
    )
    for (const toggle of standaloneToggles) {
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "toggle",
        targetName: toggle.name,
        targetSelector: toggle.selector,
        expectedResult: `Toggle/Checkbox "${toggle.name}" toggles state cleanly.`,
        status: "pending",
      })
    }

    // 6. Plan Standalone Buttons & Action Submits
    const standaloneButtons = screen.actionableElements.filter(
      (el) =>
        el.type === "button" &&
        (!el.formId || !handledFormIds.has(el.formId) || /forgot|create|register|signup|reset/i.test(el.name)) &&
        !/(logout|sign\s*out|log\s*off|delete\s*account)/i.test(el.name) &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.selector || "") &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.actionKey || "") &&
        !(screen.isLoginWall && options?.isAuthenticated && /^(sign\s*in|log\s*in|submit)$/i.test(el.name.trim()))
    )
    for (const btn of standaloneButtons) {
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "click",
        targetName: btn.name,
        targetSelector: btn.selector,
        expectedResult: `Clicking button "${btn.name}" triggers expected transition or modal response.`,
        status: "pending",
      })

      if (!transitions.some((t) => t.fromScreenId === screen.id && t.action === btn.name)) {
        transitions.push({
          id: `tr-${transitions.length + 1}`,
          fromScreenId: screen.id,
          toScreenId: screen.id,
          action: btn.name,
          actionType: "click",
          triggerSelector: btn.selector,
        })
      }
    }

    // 7. Plan Standalone Clickables, Cards, Tabs, Links & Menus
    const standaloneClickables = screen.actionableElements.filter(
      (el) =>
        (el.type === "clickable" || el.type === "tab" || el.type === "link" || el.type === "menu") &&
        (!el.formId || !handledFormIds.has(el.formId) || el.type === "link" || el.type === "clickable" || /forgot|create|register|signup|reset/i.test(el.name)) &&
        !/(logout|sign\s*out|log\s*off|delete\s*account)/i.test(el.name) &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.selector || "") &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.actionKey || "") &&
        !(screen.isLoginWall && options?.isAuthenticated && /^(sign\s*in|log\s*in|submit)$/i.test(el.name.trim()))
    )
    for (const item of standaloneClickables) {
      const typeLabel =
        item.type === "tab" ? "Tab" :
        item.type === "link" ? "Link" :
        item.type === "menu" ? "Menu item" : "Control"
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "click",
        targetName: item.name,
        targetSelector: item.selector,
        actionKey: item.actionKey,
        expectedResult: `Clicking ${typeLabel.toLowerCase()} "${item.name}" triggers expected state change, transition, modal, or UI response.`,
        status: "pending",
      })

      // If this item connects to another known screen (e.g. Drills, Workout, Profile tab, or link), point edge to that screen!
      let targetScreenId = screen.id
      const targetScreen = screens.find(
        (s) =>
          s.id !== screen.id &&
          (s.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(s.name.toLowerCase()) ||
            (item.href && s.url.includes(item.href)))
      )
      if (targetScreen) {
        targetScreenId = targetScreen.id
      }

      if (!transitions.some((t) => t.fromScreenId === screen.id && t.toScreenId === targetScreenId && t.action === item.name)) {
        transitions.push({
          id: `tr-${transitions.length + 1}`,
          fromScreenId: screen.id,
          toScreenId: targetScreenId,
          action: item.name,
          actionType: "click",
          triggerSelector: item.selector,
        })
      }
    }
  }

  const requiredFileTypes = Array.from(requiredFileTypesMap.entries()).map(([type, count]) => ({
    type: type as any,
    count,
  }))

  return {
    id: `plan-${Date.now()}`,
    targetUrl,
    screens,
    transitions,
    steps,
    postmanSummary,
    requiredFileTypes,
    status: "planned",
    coverage: {
      screensTested: 0,
      totalScreens: screens.length,
      actionsTested: 0,
      totalActions: steps.length,
      formsTested: 0,
      totalForms: screens.reduce((acc, s) => acc + (s.forms?.length || 0), 0),
      percentage: 0,
    },
  }
}

/**
 * Systematically executes the structured test plan step by step:
 * Action -> Observe -> Verify -> Record -> Continue
 * Includes dynamic detection of NEW DISCOVERY.
 */
export async function executeStructuredTestPlan(
  job: AutomationJob,
  page: Page,
  testPlan: FullAppTestPlan,
  dummyFiles?: Record<string, { name: string; url: string; type: string }>,
  credentials?: { username?: string; password?: string },
  options?: {
    allowActions?: string[]
    noiseHosts?: string[]
    postmanSummary?: PostmanCollectionSummary
    skipWorkflows?: boolean
    paymentCredentials?: TestPaymentCredentials
    allowTestPayments?: boolean
    uploadFilesDir?: string
    uploadInventory?: UploadFolderInventory | null
    projectDir?: string
  }
): Promise<void> {
  appendLog(job, "info", `Starting Phase 3: Outcome-Verified Test Plan Execution (${testPlan.steps.length} steps)...`)
  job.testingPhase = "executing"
  testPlan.status = "testing"
  job.fullAppTestPlan = testPlan
  saveJob(job)

  let passedCount = 0
  let failedCount = 0
  let blockedCount = 0
  let suspectedCount = 0
  let skippedUnsafeCount = 0
  const testedScreensSet = new Set<string>()

  let activeUploadInventory = options?.uploadInventory || null
  if (!activeUploadInventory && options?.uploadFilesDir) {
    activeUploadInventory = scanUploadFolder(options.uploadFilesDir)
  }

  const isProd = isProductionLike(testPlan.targetUrl)
  const isPaymentPermitted = options?.allowTestPayments === true
  const fsPlanRoutes = discoverLocalProjectRoutes(testPlan.targetUrl, options?.projectDir)
  const getComponentLocationForPlanPath = (p: string) => matchRouteForPath(fsPlanRoutes, p)?.file

  const startingHadLoginWall = await hasLoginWall(page)
  if (startingHadLoginWall && job.authState !== "logged_in" && job.authState !== "skipped") {
    appendLog(job, "warn", "[AUTH] Login or email wall detected before test execution - requesting credentials...")
    await authenticateIfNeeded(job, page, credentials)
  }

  for (let i = 0; i < testPlan.steps.length; i++) {
    // Consume navigation requests only at a safe action boundary. Completed steps,
    // the existing plan, evidence and recording remain attached to this session.
    const pendingNavigation = job.pendingSessionNavigation
    if (pendingNavigation) {
      try {
        const requestedUrl = assertSafeTargetUrlWithDevBypass(pendingNavigation.url)
        if (requestedUrl !== page.url()) {
          await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
          await waitForSpaPageReady(page, 2500)
          const landedUrl = page.url() || requestedUrl
          const origin = new URL(landedUrl).origin
          const routePath = normalizePath(landedUrl, origin)
          const inventory = await extractActionableInventory(page)
          const screenName = deriveScreenName(routePath, inventory.heading, inventory.modalTitle)
          let activeScreen = testPlan.screens.find((screen) =>
            screen.path.split("#")[0] === routePath &&
            screen.name.trim().toLowerCase() === screenName.trim().toLowerCase()
          )
          let createdByNavigation = false
          if (!activeScreen) {
            const screenId = `S${String(testPlan.screens.length + 1).padStart(3, "0")}`
            activeScreen = {
              id: screenId,
              name: screenName,
              url: landedUrl,
              path: routePath,
              actionableElements: [],
              forms: [],
              isNewDiscovery: true,
              discoveredAt: new Date().toISOString(),
            }
            testPlan.screens.push(activeScreen)
            testPlan.transitions.push({
              id: `tr-${testPlan.transitions.length + 1}`,
              fromScreenId: testPlan.steps[Math.max(0, i - 1)]?.screenId || testPlan.screens[0]?.id || screenId,
              toScreenId: screenId,
              action: "Navigate from shared session URL",
              actionType: "navigation",
            })
            createdByNavigation = true
          }

          const knownKeys = new Set(activeScreen.actionableElements.map((element) => {
            const key = stableActionKeyForScreen(activeScreen!, element)
            element.actionKey = key
            return key
          }))
          for (const element of inventory.actionableElements) {
            const key = stableActionKeyForScreen(activeScreen, element)
            element.actionKey = key
            if (!knownKeys.has(key)) {
              activeScreen.actionableElements.push(element)
              knownKeys.add(key)
            }
          }
          const knownForms = new Set(activeScreen.forms.map((form) => [form.id, form.selector || "", form.name || ""].join("|").toLowerCase()))
          for (const form of inventory.forms) {
            const key = [form.id, form.selector || "", form.name || ""].join("|").toLowerCase()
            if (!knownForms.has(key)) {
              activeScreen.forms.push(form)
              knownForms.add(key)
            }
          }
          activeScreen.url = landedUrl
          mergeScreenActionsIntoLedger(job, activeScreen)
          linkTestPlanStepsToLedger(job, testPlan)
          queueUnplannedLedgerActions(job, testPlan, activeScreen.id, i - 1)
          prioritizePendingStepsForScreen(testPlan, activeScreen.id, i - 1)
          job.targetUrl = landedUrl
          job.currentUrl = landedUrl
          testPlan.targetUrl = landedUrl
          job.flowGraph = buildFigmaWorkflowMap(testPlan)
          job.fullAppTestPlan = testPlan
          emitSessionEvent(job, "navigation_completed", {
            url: landedUrl,
            message: `Browser navigated to ${landedUrl}; existing test progress and evidence were preserved.`,
            payload: { requestId: pendingNavigation.requestId, screenId: activeScreen.id },
          })
          if (createdByNavigation) {
            emitSessionEvent(job, "screen_discovered", {
              url: landedUrl,
              message: `Discovered screen ${activeScreen.name} from session navigation.`,
              payload: { screenId: activeScreen.id, path: activeScreen.path },
            })
          }
          saveJob(job)
        } else {
          emitSessionEvent(job, "navigation_completed", {
            url: requestedUrl,
            message: `Session is already at ${requestedUrl}; duplicate navigation ignored.`,
            payload: { requestId: pendingNavigation.requestId, unchanged: true },
          })
        }
      } catch (navigationError: any) {
        const actualUrl = page.url()
        if (actualUrl.startsWith("http://") || actualUrl.startsWith("https://")) {
          job.currentUrl = actualUrl
          job.targetUrl = actualUrl
          testPlan.targetUrl = actualUrl
          job.fullAppTestPlan = testPlan
        }
        emitSessionEvent(job, "error", {
          url: job.currentUrl || page.url(),
          message: `Session navigation failed: ${navigationError?.message || "Unable to navigate"}`,
          payload: { requestId: pendingNavigation.requestId, requestedUrl: pendingNavigation.url },
        })
        appendLog(job, "error", `Session navigation failed: ${navigationError?.message || "Unable to navigate"}`)
      } finally {
        job.pendingSessionNavigation = undefined
        saveJob(job)
      }
    }

    const step = testPlan.steps[i]

    // Pre-verified steps (e.g. login authentication verified during discovery)
    if (step.status === "passed") {
      passedCount++
      testedScreensSet.add(step.screenId)
      appendLog(job, "success", `[EXECUTE ${i + 1}/${testPlan.steps.length}] ${step.screenId} ${step.screenName} -> ${step.targetName}: PASSED`)
      continue
    }
    if (step.status === "blocked") {
      blockedCount++
      appendLog(job, "warn", `[EXECUTE ${i + 1}/${testPlan.steps.length}] ${step.screenId} ${step.screenName} -> ${step.targetName}: BLOCKED (${step.actualResult || "pre-resolved"})`)
      continue
    }

    // Safety guard check
    const safety = classifyAction(step.targetName, options?.allowActions || [], {
      isProduction: isProd,
      allowTestPayments: isPaymentPermitted,
    })
    if (safety.tier === "hard_block" || safety.tier === "soft_skip") {
      step.status = "skipped_unsafe"
      step.verdict = "skipped_unsafe"
      step.actualResult = `Skipped by safety guard: ${safety.reason}`
      updateActionLedgerForStep(job, step, "skipped", step.actualResult)
      skippedUnsafeCount++
      appendLog(job, "warn", `[SAFETY GUARD ${i + 1}/${testPlan.steps.length}] ${step.targetName} skipped: ${safety.reason}`)
      continue
    }

    step.status = "running"
    updateActionLedgerForStep(job, step, "running")
    job.currentStep = `[${i + 1}/${testPlan.steps.length}] Testing ${step.screenName}: ${step.actionType.toUpperCase()} ${step.targetName}`
    emitSessionEvent(job, "browser_action", { message: job.currentStep, payload: { stepId: step.id, screenId: step.screenId, actionType: step.actionType } })
    job.progress = Math.round(30 + ((i + 1) / testPlan.steps.length) * 65)
    saveJob(job)

    appendLog(job, "info", `[EXECUTE ${i + 1}/${testPlan.steps.length}] ${step.screenId} ${step.screenName} -> ${step.actionType} "${step.targetName}"`)

    const netRecorder = new NetworkRecorder(page, testPlan.targetUrl, options?.noiseHosts)
    const consoleRecorder = new ConsoleRecorder(page)
    const dialogRef = { value: false }

    const dialogHandler = async (dialog: any) => {
      dialogRef.value = true
      const actionSafety = classifyAction(step.targetName, options?.allowActions || [], {
        isProduction: isProd,
        allowTestPayments: isPaymentPermitted,
      })
      if (actionSafety.tier !== "allow") {
        await dialog.dismiss().catch(() => {})
      } else {
        await dialog.accept().catch(() => {})
      }
    }
    page.once("dialog", dialogHandler)

    try {
      // 1. Restore the target screen before executing its action.
      const targetScreen = testPlan.screens.find((s) => s.id === step.screenId)
      if (targetScreen) {
        const targetUrlStr = targetScreen.url || testPlan.targetUrl
        // Full-URL drift check: compare origin + pathname + search so query-param
        // states (e.g. /leases?tab=expired) trigger restoration. The hash is
        // synthetic (#modal-* / #tab-*) and never appears in the live URL.
        const curRestoreKey = normalizeUrlForRestore(page.url())
        const targetRestoreKey = normalizeUrlForRestore(
          new URL(targetUrlStr, testPlan.targetUrl).href
        )

        if (curRestoreKey !== targetRestoreKey) {
          const targetNormPath = (targetScreen.path || "/").split("#")[0]
          const navUrl = targetUrlStr.startsWith("http")
            ? targetUrlStr
            : new URL(targetNormPath, testPlan.targetUrl).href
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null)
          await waitForSpaPageReady(page, 1500).catch(() => {})
        }

        // Discovery assigns synthetic #tab-name / #modal-* paths to SPA views.
        // The URL alone cannot restore those views: reactivate the matching tab,
        // or replay the recorded trigger click for modals — a plain goto()
        // destroys the React state that keeps a modal open.
        const stateMarker = targetScreen.path.split("#")[1]
        if (stateMarker && stateMarker.startsWith("modal-")) {
          const reopened = await page.evaluate(
            ({ selector, text }: { selector: string | null; text: string | null }) => {
              const norm = (v: string) => (v || "").trim().replace(/\s+/g, " ").toLowerCase()
              let el: HTMLElement | null = null
              if (selector) {
                try {
                  el = document.querySelector(selector) as HTMLElement | null
                } catch {}
              }
              if (!el && text) {
                const want = norm(text)
                const cands = Array.from(
                  document.querySelectorAll('button, a, [role="button"], [tabindex], input[type="submit"]')
                ) as HTMLElement[]
                el =
                  cands.find((c) => {
                    const t = norm(c.innerText || c.textContent || c.getAttribute("aria-label") || "")
                    return !!t && (t === want || t.includes(want) || want.includes(t))
                  }) || null
              }
              if (!el || el.getClientRects().length === 0) return false
              // Already open (e.g. queue order kept it alive) — nothing to do.
              if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true
              el.click()
              return true
            },
            {
              selector: targetScreen.modalTriggerSelector || null,
              text: targetScreen.modalTriggerText || null,
            }
          ).catch(() => false)
          if (reopened) {
            await new Promise((r) => setTimeout(r, 400))
          } else {
            appendLog(job, "warn", `[COVERAGE] Could not reopen modal "${targetScreen.name}" via its recorded trigger.`)
          }
        } else if (stateMarker) {
          let tabLabel = stateMarker
          try { tabLabel = decodeURIComponent(stateMarker) } catch {}
          tabLabel = tabLabel.replace(/-/g, " ").trim().toLowerCase()
          const activatedTab = await page.evaluate((name) => {
            const candidates = Array.from(document.querySelectorAll(
              '[role="tab"], [data-tab], nav button, aside button, .tab, .tab-btn, button'
            )) as HTMLElement[]
            const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase()
            const tab = candidates.find((candidate) => {
              const label = normalize(candidate.textContent || candidate.getAttribute("aria-label") || "")
              return label === name || label.includes(name)
            })
            if (!tab) return false
            const isAlreadyActive =
              tab.getAttribute("aria-selected") === "true" ||
              tab.getAttribute("data-state") === "active" ||
              tab.classList.contains("active")
            if (!isAlreadyActive) tab.click()
            return true
          }, tabLabel).catch(() => false)
          if (!activatedTab) {
            appendLog(job, "warn", `[COVERAGE] Could not restore SPA tab "${tabLabel}" for step "${step.targetName}".`)
          } else {
            await new Promise((r) => setTimeout(r, 250))
          }
        }
      }

      // 2. Determine target coordinates for visual cursor animation & mirror overlay
      let actionCoords: { x: number; y: number } | undefined
      if (step.targetSelector) {
        actionCoords = await page.evaluate((sel) => {
          try {
            const el = document.querySelector(sel) as HTMLElement | null
            if (!el) return undefined
            const r = el.getBoundingClientRect()
            if (r.width <= 1 || r.height <= 1) return undefined
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
          } catch { return undefined }
        }, step.targetSelector) || undefined
      }

      if (!actionCoords && step.targetName) {
        actionCoords = await page.evaluate((name) => {
          try {
            const clean = (s: string) => (s || "").replace(/[^a-z0-9]/gi, "").toLowerCase()
            const wanted = clean(name)
            if (!wanted) return undefined
            const all = Array.from(document.querySelectorAll("button, a, input, textarea, select, [role='button'], [tabindex], div, span")) as HTMLElement[]
            for (const el of all) {
              const r = el.getBoundingClientRect()
              if (r.width <= 2 || r.height <= 2) continue
              const t = clean(el.innerText || el.textContent || el.getAttribute("aria-label") || (el as any).placeholder || el.id || "")
              if (t === wanted || (wanted.length > 3 && t.includes(wanted))) {
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
              }
            }
            return undefined
          } catch { return undefined }
        }, step.targetName) || undefined
      }

      const actionTypeMap: AgentAction["type"] =
        step.actionType === "fill" ? "type" :
        step.actionType === "click" ? "click" :
        step.actionType === "select" ? "click" :
        step.actionType === "toggle" ? "click" :
        step.actionType === "upload" ? "click" : "assert"

      job.currentAction = {
        id: `action-${step.id}`,
        type: actionTypeMap,
        target: step.targetName,
        selector: step.targetSelector,
        value: step.actionType === "fill" ? (step.syntheticValue || "") : undefined,
        coordinates: actionCoords,
        description: `Testing ${step.actionType}: "${step.targetName}"`,
        status: "running",
        timestamp: new Date().toISOString(),
      }
      saveJob(job)

      if (actionCoords) {
        await animateCursorTo(page, actionCoords.x, actionCoords.y, step.actionType).catch(() => {})
      }

      // Capture lightweight live preview frame for real-time simulator mirror
      try {
        const liveShot = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false })
        job.currentScreenshotUrl = `data:image/jpeg;base64,${Buffer.from(liveShot).toString("base64")}`
        saveJob(job)
      } catch {}

      // 3. Perform Action & Verify
      let actionVerdict: AutomationVerdict = "passed"
      let observation = ""

      if (step.actionType === "form_scenario") {
        const formVariant = step.formVariant || "valid"
        const formSel = step.targetSelector || (step.formId ? `#${step.formId}` : "form")
        await showActionBanner(page, `Testing Form: "${step.targetName}" (${formVariant})`)

        const formExists = await page.evaluate((sel) => {
          try {
            return Boolean(document.querySelector(sel) || document.querySelector("form"))
          } catch {
            return Boolean(document.querySelector("form"))
          }
        }, formSel)

        if (!formExists) {
          actionVerdict = "failed"
          observation = `Could not locate form with selector "${formSel}".`
          step.evidence = {
            expectedEffects: ["value_changed", "content_changed"],
            observedEffect: "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: 0,
            networkCalls: netRecorder.getCapturedCalls(),
            consoleErrors: consoleRecorder.getErrors(),
          }
        } else if (formVariant === "required_empty") {
          // Clear all form inputs
          await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return
            form.querySelectorAll("input, textarea, select").forEach((field: any) => {
              if (field.type === "checkbox" || field.type === "radio") {
                field.checked = false
              } else if (field.type !== "submit" && field.type !== "button" && field.type !== "hidden") {
                field.value = ""
              }
              field.dispatchEvent(new Event("input", { bubbles: true }))
              field.dispatchEvent(new Event("change", { bubbles: true }))
            })
          }, formSel)

          if (formSel) {
            await highlightInputTyping(page, `${formSel} input:not([type="hidden"])`, "[Empty Validation Check]")
          }

          // Submit using a real mouse click so validation is visible in the session.
          const submittedByMouse = await clickFormSubmitVisibly(job, page, formSel, `${step.targetName} (empty validation)`)
          if (!submittedByMouse) {
            appendLog(job, "warn", `[FORM] No visible submit button could be clicked for "${step.targetName}".`)
          }

          const settleMs = await settle(page, netRecorder, 2000)
          const calls = netRecorder.getCapturedCalls()
          const mutating2xx = calls.some((c) => c.isMutating && typeof c.status === "number" && c.status >= 200 && c.status < 300)

          const validation = await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return { hasError: false, detail: "Form not found" }

            const invalids = form.querySelectorAll(":invalid")
            if (invalids.length > 0) return { hasError: true, detail: `HTML5 :invalid on ${invalids.length} field(s)` }

            const ariaInvalids = form.querySelectorAll('[aria-invalid="true"]')
            if (ariaInvalids.length > 0) return { hasError: true, detail: `aria-invalid="true" on ${ariaInvalids.length} field(s)` }

            const alerts = document.querySelectorAll('[role="alert"], .error, .invalid-feedback, [class*="error"], [class*="alert"]')
            const visible = Array.from(alerts).filter((el: any) => {
              const s = window.getComputedStyle(el)
              return s.display !== "none" && s.visibility !== "hidden" && (el.textContent || "").trim().length > 0
            })
            if (visible.length > 0) return { hasError: true, detail: `Visible validation error: "${(visible[0].textContent || "").trim().slice(0, 60)}"` }

            const msgFields = Array.from(form.querySelectorAll("input, select, textarea")).filter((f: any) => Boolean(f.validationMessage))
            if (msgFields.length > 0) return { hasError: true, detail: `Validation message: "${(msgFields[0] as any).validationMessage}"` }

            return { hasError: false, detail: "No visible validation error indicated" }
          }, formSel)

          if (mutating2xx) {
            actionVerdict = "failed"
            observation = "Form submitted empty required fields and was accepted with 2xx mutating network request."
          } else if (validation.hasError) {
            actionVerdict = "passed"
            observation = `Required field validation correctly blocked empty submission (${validation.detail}).`
          } else {
            actionVerdict = "failed"
            observation = "Form submission blocked or stalled, but no visible validation message or :invalid state was shown."
          }

          step.evidence = {
            expectedEffects: ["value_changed", "content_changed"],
            observedEffect: validation.hasError ? "content_changed" : mutating2xx ? "network_only" : "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: settleMs,
            networkCalls: calls,
            consoleErrors: consoleRecorder.getErrors(),
          }
        } else if (formVariant === "invalid_format") {
          // Use real keyboard input for invalid email/phone values and normal synthetic data elsewhere.
          const invalidFill = await fillFormVisibly(
            job,
            page,
            formSel,
            SYNTHETIC_TEST_DATA,
            null,
            null,
            true,
          )
          if (invalidFill.failed > 0) {
            appendLog(job, "warn", `[FORM] ${invalidFill.failed}/${invalidFill.attempted} invalid-format field interaction(s) could not be completed.`)
          }

          // Submit using a real mouse click so validation is visible in the session.
          const submittedByMouse = await clickFormSubmitVisibly(job, page, formSel, `${step.targetName} (invalid format)`)
          if (!submittedByMouse) {
            appendLog(job, "warn", `[FORM] No visible submit button could be clicked for "${step.targetName}".`)
          }

          const settleMs = await settle(page, netRecorder, 2000)
          const calls = netRecorder.getCapturedCalls()
          const mutating2xx = calls.some((c) => c.isMutating && typeof c.status === "number" && c.status >= 200 && c.status < 300)

          const validation = await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return { hasError: false, detail: "Form not found" }

            const invalids = form.querySelectorAll(":invalid")
            if (invalids.length > 0) return { hasError: true, detail: `HTML5 :invalid on ${invalids.length} field(s)` }

            const ariaInvalids = form.querySelectorAll('[aria-invalid="true"]')
            if (ariaInvalids.length > 0) return { hasError: true, detail: `aria-invalid="true" on ${ariaInvalids.length} field(s)` }

            const alerts = document.querySelectorAll('[role="alert"], .error, .invalid-feedback, [class*="error"], [class*="alert"]')
            const visible = Array.from(alerts).filter((el: any) => {
              const s = window.getComputedStyle(el)
              return s.display !== "none" && s.visibility !== "hidden" && (el.textContent || "").trim().length > 0
            })
            if (visible.length > 0) return { hasError: true, detail: `Visible validation error: "${(visible[0].textContent || "").trim().slice(0, 60)}"` }

            const msgFields = Array.from(form.querySelectorAll("input, select, textarea")).filter((f: any) => Boolean(f.validationMessage))
            if (msgFields.length > 0) return { hasError: true, detail: `Validation message: "${(msgFields[0] as any).validationMessage}"` }

            return { hasError: false, detail: "No format validation error displayed" }
          }, formSel)

          if (mutating2xx) {
            actionVerdict = "failed"
            observation = "Form submitted invalid email/phone format and server accepted with 2xx mutating network request."
          } else if (validation.hasError) {
            actionVerdict = "passed"
            observation = `Format validation correctly rejected invalid format (${validation.detail}).`
          } else {
            actionVerdict = "failed"
            observation = "No visible format validation error displayed for invalid email/phone input."
          }

          step.evidence = {
            expectedEffects: ["value_changed", "content_changed"],
            observedEffect: validation.hasError ? "content_changed" : mutating2xx ? "network_only" : "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: settleMs,
            networkCalls: calls,
            consoleErrors: consoleRecorder.getErrors(),
          }
        } else {
          // formVariant === "valid"
          const beforeState = await captureState(page)

          // Detect payment / checkout form
          const isPaymentForm =
            /payment|checkout|pay|billing|subscription|order|cart/i.test(step.targetName) ||
            /pay|checkout|card/i.test(step.screenName) ||
            (await page.evaluate((sel) => {
              const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
              if (!form) return false
              const txt = (form.textContent || "").toLowerCase()
              const inputs = Array.from(form.querySelectorAll("input"))
              return (
                /card\s*(number|no)|cvv|cvc|expir/i.test(txt) ||
                inputs.some((inp: any) => /card|cvv|cvc|exp/i.test(inp.name || inp.id || inp.placeholder || ""))
              )
            }, formSel))

          let activePaymentCreds: TestPaymentCredentials | undefined = undefined
          if (isPaymentForm) {
            activePaymentCreds = await promptPaymentCredentialsIfNeeded(job, options?.paymentCredentials)
            appendLog(
              job,
              "info",
              `💳 Using test payment card (${activePaymentCreds.cardNumber?.slice(-4) ? '•••• ' + activePaymentCreds.cardNumber?.slice(-4) : 'sandbox card'}) for form "${step.targetName}"`
            )
          }

          // Reuse valid values already present in the app where safe; explicit
          // Postman mappings and supplied sandbox credentials take precedence.
          const existingValuesReused = await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return 0
            return Array.from(form.querySelectorAll("input, textarea, select")).filter((field: any) => {
              const type = (field.type || "").toLowerCase()
              const name = (field.name || field.id || "").toLowerCase()
              const placeholder = (field.placeholder || "").toLowerCase()
              const sensitive = type === "password" || /password|passcode|secret|token|api[-_ ]?key|private[-_ ]?key|card|cvv|cvc|security code/i.test(name + " " + placeholder)
              if (["checkbox", "radio", "file", "hidden", "submit", "button"].includes(type)) return false
              return !sensitive && typeof field.value === "string" && field.value.trim().length > 0 && field.checkValidity()
            }).length
          }, formSel)

          if (existingValuesReused > 0) {
            appendLog(job, "info", `[DATA] Reusing ${existingValuesReused} existing valid field value(s); sensitive fields are excluded.`)
          }

          // Fill missing/invalid fields with visible mouse and keyboard input.
          const fillResult = await fillFormVisibly(
            job,
            page,
            formSel,
            SYNTHETIC_TEST_DATA,
            step.fieldPayload || null,
            activePaymentCreds || null,
          )
          if (fillResult.failed > 0) {
            appendLog(job, "warn", `[FORM] ${fillResult.failed}/${fillResult.attempted} field interaction(s) could not be completed with visible input.`)
          }
          await showActionBanner(page, `Submitting Form: "${step.targetName}"`)

          // Submit with a real pointer click so the same action is visible in the mirror and recording.
          const submittedByMouse = await clickFormSubmitVisibly(job, page, formSel, step.targetName)
          if (!submittedByMouse) {
            appendLog(job, "warn", `[FORM] No visible submit button could be clicked for "${step.targetName}".`)
          }

          const settleMs = await settle(page, netRecorder, 8000)
          const afterState = await captureState(page)
          const calls = netRecorder.getCapturedCalls()
          const mutating2xx = calls.some((c) => c.isMutating && typeof c.status === "number" && c.status >= 200 && c.status < 300)
          const navigated = beforeState.url !== afterState.url
          const modalClosed = beforeState.hasModal && !afterState.hasModal

          const successFeedback = await page.evaluate(() => {
            const successEls = document.querySelectorAll(
              '[role="status"], .success, .alert-success, [class*="toast"], [class*="success"], [data-success]'
            )
            const visible = Array.from(successEls).filter((el: any) => {
              const s = window.getComputedStyle(el)
              return s.display !== "none" && s.visibility !== "hidden" && (el.textContent || "").trim().length > 0
            })
            return visible.length > 0 ? (visible[0].textContent || "").trim().slice(0, 80) : null
          })

          if (navigated || modalClosed || mutating2xx || successFeedback) {
            actionVerdict = "passed"
            const details: string[] = []
            if (navigated) details.push(`navigated to ${afterState.url}`)
            if (modalClosed) details.push("closed modal dialog")
            if (mutating2xx) details.push("server returned 2xx mutating response")
            if (successFeedback) details.push(`success feedback: "${successFeedback}"`)
            observation = `Form submitted successfully with valid data (${details.join(", ")})${existingValuesReused > 0 ? `; reused ${existingValuesReused} existing valid field value(s)` : ""}.`

            if (step.postmanEndpoint && step.postmanMappings) {
              const wireCheck = confirmMappingOnWire(
                {
                  endpoint: step.postmanEndpoint,
                  screenId: step.screenId,
                  formId: step.formId,
                  fieldMappings: step.postmanMappings,
                  overallConfidence: "high",
                },
                calls
              )

              if (wireCheck.confirmed) {
                step.confirmedOnWire = true
                observation += ` On-wire confirmation verified: outgoing ${step.postmanEndpoint.method} request matched Postman endpoint "${step.postmanEndpoint.name}".`
              } else {
                step.confirmedOnWire = false
                job.issues.push({
                  id: `issue-api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  screenUrl: page.url(),
                  screenTitle: step.screenName,
                  type: "api_ui_mismatch",
                  severity: "medium",
                  description: `Form "${step.targetName}" was filled from Postman documentation ("${step.postmanEndpoint.name}") but wire request did not match expected API endpoint: ${wireCheck.mismatches.join("; ")}`,
                  expected: `Outgoing request to ${step.postmanEndpoint.method} matching [${step.postmanEndpoint.pathSegments.join("/")}]`,
                  actual: "No matching network call captured on wire",
                  timestamp: new Date().toISOString(),
                })
              }
            }
          } else if (consoleRecorder.getErrors().length > 0 || calls.some((c) => c.isMutating && typeof c.status === "number" && c.status >= 400)) {
            actionVerdict = "failed"
            observation = `Form submission encountered errors: ${consoleRecorder.getErrors().join("; ") || "HTTP error status"}`
          } else {
            actionVerdict = "suspected_non_functional"
            observation = "Form submission produced no navigation, no modal closure, no success feedback, and no network activity. Suspected non-functional or mock form."
            job.issues.push({
              id: `issue-form-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              screenUrl: page.url(),
              screenTitle: step.screenName,
              type: "non_functional_control",
              severity: "medium",
              description: `Form "${step.targetName}" submitted valid synthetic data but produced zero observable outcome, navigation, or network activity.`,
              expected: "Navigation, modal closure, success toast, or 2xx mutating network response.",
              actual: "Page remained static with no network or DOM response.",
              timestamp: new Date().toISOString(),
            })
          }

          step.evidence = {
            expectedEffects: ["navigated", "network_only", "modal_opened", "content_changed"],
            observedEffect: navigated ? "navigated" : modalClosed ? "content_changed" : mutating2xx ? "network_only" : "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: settleMs,
            networkCalls: calls,
            consoleErrors: consoleRecorder.getErrors(),
          }
        }
      } else if (step.actionType === "fill") {
        let inputVal = step.syntheticValue || SYNTHETIC_TEST_DATA.fullName
        const isEmailField = /e-?mail/i.test(step.targetName) || /e-?mail/i.test(step.targetSelector || "")
        const isUsernameField = /user|login/i.test(step.targetName) || /user|login/i.test(step.targetSelector || "")
        const isPasswordField = /pass/i.test(step.targetName) || /pass/i.test(step.targetSelector || "")

        if (isEmailField && credentials?.username) {
          inputVal = credentials.username
        } else if (isUsernameField && credentials?.username) {
          inputVal = credentials.username
        } else if (isPasswordField && credentials?.password) {
          inputVal = credentials.password
        } else if (isEmailField && !credentials?.username && job.authState !== "skipped") {
          appendLog(job, "warn", `[AUTH] Email input field "${step.targetName}" detected. Prompting user for email...`)
          await authenticateIfNeeded(job, page, credentials)
          if (credentials?.username) {
            inputVal = credentials.username
          }
        }
        const isSensitiveField = /password|passcode|secret|token|api[-_ ]?key|private[-_ ]?key|card|cvv|cvc|security code/i.test(step.targetName)
        const displayValue = isSensitiveField ? "[REDACTED]" : secretRedactor.redact(inputVal)
        const field = await findVisibleInput(page, step.targetSelector, step.targetName)
        const fieldSelector = step.targetSelector || undefined

        if (!field) {
          actionVerdict = "failed"
          observation = `Could not locate a visible input field "${step.targetName}" for real keyboard typing.`
          step.evidence = {
            expectedEffects: ["value_changed", "content_changed"],
            observedEffect: "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: 0,
            networkCalls: netRecorder.getCapturedCalls(),
            consoleErrors: consoleRecorder.getErrors(),
          }
        } else {
          const box = await field.boundingBox()
          const resolvedSelector = await field.evaluate((el) => {
            const node = el as HTMLElement
            if (!node.id) node.id = `qa-live-field-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            return `#${CSS.escape(node.id)}`
          }).catch(() => fieldSelector || "")

          await publishLiveAction(job, page, {
            type: "type",
            description: `Typing into ${step.targetName}`,
            target: step.targetName,
            selector: resolvedSelector || undefined,
            value: inputVal,
            sensitive: isSensitiveField,
          })

          if (box) {
            await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
            // Publish a frame after the real pointer reaches the field so the
            // visible browser mirror does not wait until the whole test step ends.
            await publishLiveFrame(job, page)
          }

          await showActionBanner(page, `Type "${displayValue}" -> ${step.targetName}`)
          const filled = await humanType(page, field, inputVal, {
            label: step.targetName,
            maskInBanner: isSensitiveField,
          })

          await settle(page, netRecorder, 500)

          if (job.currentAction) job.currentAction.status = filled ? "passed" : "failed"
          await publishLiveFrame(job, page)

          if (filled) {
            actionVerdict = "passed"
            observation = isSensitiveField
              ? `Filled sensitive field "${step.targetName}" with native keyboard input (value redacted from evidence).`
              : `Typed synthetic value "${secretRedactor.redact(inputVal)}" into field "${step.targetName}" using native keyboard input.`
          } else {
            actionVerdict = "failed"
            observation = `Could not type into visible field "${step.targetName}".`
          }

          step.evidence = {
            expectedEffects: ["value_changed", "content_changed"],
            observedEffect: filled ? "value_changed" : "no_effect",
            verdict: actionVerdict,
            reason: observation,
            retriesUsed: 0,
            settleDurationMs: 500,
            networkCalls: netRecorder.getCapturedCalls(),
            consoleErrors: consoleRecorder.getErrors(),
          }
        }
      } else if (step.actionType === "upload") {
        const fileType = step.fileTypeRequired || "image"
        await showActionBanner(page, `Upload ${fileType.toUpperCase()} -> ${step.targetName}`)

        // 1. Inspect accept attribute of target upload control
        const acceptAttr = await page.evaluate((sel) => {
          const el = (sel ? document.querySelector(sel) : null) || document.querySelector('input[type="file"]')
          return el ? el.getAttribute("accept") || "" : ""
        }, step.targetSelector)

        // 2. Pick matching file from user-mentioned upload folder or fallback to synthetic dummy
        const picked = pickUploadFile(activeUploadInventory, {
          fileTypeRequired: fileType,
          acceptAttr,
          targetName: step.targetName,
        })

        try {
          const fileInput =
            (step.targetSelector ? await page.$(step.targetSelector) : null) ||
            (await page.$('input[type="file"]'))

          if (!fileInput) {
            actionVerdict = "blocked"
            observation = `No <input type="file"> found for upload "${step.targetName}".`
          } else {
            await (fileInput as any).uploadFile(picked.filePath)
            await settle(page, netRecorder, 3000)

            const uploadState = await page.evaluate(() => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
              const fileCount = input?.files?.length || 0
              const hasPreview = Boolean(document.querySelector('img[src^="data:"], img[src^="blob:"], .file-preview, [data-preview]'))
              return { fileCount, hasPreview }
            })

            const calls = netRecorder.getCapturedCalls()
            const hasMultipartRequest = calls.some((c) => c.isMutating)

            const sourceNote = picked.isFromFolder
              ? `from folder "${path.basename(picked.filePath)}" (${picked.fileSizeKB} KB)`
              : `("${picked.fileName}")`

            if (uploadState.fileCount > 0 && (uploadState.hasPreview || hasMultipartRequest)) {
              actionVerdict = "passed"
              observation = `Attached ${fileType.toUpperCase()} file ${sourceNote}. Wire/DOM confirmation verified.`
            } else if (uploadState.fileCount > 0) {
              actionVerdict = "passed"
              observation = `File attached to input element: ${sourceNote}.`
            } else {
              actionVerdict = "failed"
              observation = `Failed to attach file to upload control "${step.targetName}".`
            }

            if (picked.isFromFolder) {
              appendLog(
                job,
                "info",
                `📁 Attached test file from folder: "${picked.fileName}" (${picked.fileSizeKB} KB) into "${step.targetName}"`
              )
            }
          }
        } finally {
          if (picked.cleanUp) {
            picked.cleanUp()
          }
        }

        step.evidence = {
          expectedEffects: ["value_changed", "network_only", "content_changed"],
          observedEffect: actionVerdict === "passed" ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 500,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
        }
      } else if (step.actionType === "select") {
        const target = (step.targetSelector ? await page.$(step.targetSelector).catch(() => null) : null) || await page.$("select")
        if (!target || !(await target.boundingBox())) {
          actionVerdict = "failed"
          observation = `Could not locate visible dropdown "${step.targetName}".`
        } else {
          const selector = step.targetSelector || await target.evaluate((el) => {
            const node = el as HTMLElement
            if (!node.id) node.id = `qa-live-select-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            return `#${CSS.escape(node.id)}`
          }).catch(() => "")
          await publishLiveAction(job, page, {
            type: "click",
            description: `Selecting ${step.targetName}`,
            target: step.targetName,
            selector,
            value: step.syntheticValue,
          })
          const box = await target.boundingBox()
          if (box) {
            await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
            await publishLiveFrame(job, page)
          }
          const optionIndex = await target.evaluate((node, val) => Array.from((node as HTMLSelectElement).options).findIndex((option) => option.text.includes(val) || option.value.includes(val)), step.syntheticValue || "").catch(() => -1)
          const focused = await humanClick(page, target)
          let selected = false
          if (focused && optionIndex >= 0) {
            try {
              await page.keyboard.press("Home")
              for (let i = 0; i < optionIndex; i++) await page.keyboard.press("ArrowDown")
              await page.keyboard.press("Enter")
              selected = await target.evaluate((node, val) => {
                const el = node as HTMLSelectElement
                const option = el.options[el.selectedIndex]
                return Boolean(option && (option.value === val || option.text.includes(val)))
              }, step.syntheticValue || "").catch(() => false)
            } catch {}
          }
          actionVerdict = selected ? "passed" : "failed"
          observation = selected ? `Selected option "${step.syntheticValue}" using keyboard input.` : `Failed to select option "${step.syntheticValue}" with visible keyboard input.`
          if (job.currentAction) job.currentAction.status = selected ? "passed" : "failed"
          await publishLiveFrame(job, page)
        }

        step.evidence = {
          expectedEffects: ["value_changed", "content_changed"],
          observedEffect: actionVerdict === "passed" ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 250,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
        }
      } else if (step.actionType === "toggle") {
        const target = (step.targetSelector ? await page.$(step.targetSelector).catch(() => null) : null) ||
          (await page.$('input[type="checkbox"], [role="switch"]'))
        if (!target || !(await target.boundingBox())) {
          actionVerdict = "failed"
          observation = `Could not locate visible toggle "${step.targetName}".`
        } else {
          const selector = step.targetSelector || await target.evaluate((el) => {
            const node = el as HTMLElement
            if (!node.id) node.id = `qa-live-toggle-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            return `#${CSS.escape(node.id)}`
          }).catch(() => "")
          const before = await target.evaluate((node) => {
            const el = node as HTMLInputElement
            return typeof el.checked === "boolean" ? el.checked : el.getAttribute("aria-checked") === "true"
          }).catch(() => false)
          await publishLiveAction(job, page, {
            type: "click",
            description: `Toggling ${step.targetName}`,
            target: step.targetName,
            selector,
          })
          const box = await target.boundingBox()
          if (box) {
            await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
            await publishLiveFrame(job, page)
          }
          const clicked = Boolean(await humanClick(page, target))
          await settle(page, netRecorder, 500)
          const after = await target.evaluate((node) => {
            const el = node as HTMLInputElement
            return typeof el.checked === "boolean" ? el.checked : el.getAttribute("aria-checked") === "true"
          }).catch(() => before)
          const toggled = clicked && after !== before
          actionVerdict = toggled ? "passed" : "failed"
          observation = toggled ? `Toggled "${step.targetName}" with a real mouse click.` : `Could not confirm a state change for "${step.targetName}".`
          if (job.currentAction) job.currentAction.status = toggled ? "passed" : "failed"
          await publishLiveFrame(job, page)
        }

        step.evidence = {
          expectedEffects: ["value_changed", "content_changed"],
          observedEffect: actionVerdict === "passed" ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 250,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
        }
      } else if (step.actionType === "click") {
        await publishLiveAction(job, page, {
          type: "click",
          description: `Clicking ${step.targetName}`,
          target: step.targetName,
          selector: step.targetSelector,
        })
        await showActionBanner(page, `Click "${step.targetName}"`)
        if (step.targetSelector) {
          const clickTarget = await page.$(step.targetSelector).catch(() => null)
          const box = await clickTarget?.boundingBox().catch(() => null)
          if (box) {
            await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2)
            await publishLiveFrame(job, page)
            await triggerClickAnimation(page, box.x + box.width / 2, box.y + box.height / 2)
          } else {
            const coords = await animateCursorToSelector(page, step.targetSelector)
            if (coords) await triggerClickAnimation(page, coords.x, coords.y)
          }
        }

        const expectedEffects = expectFor({
          name: step.targetName,
          isSubmit: /submit|save|register|login/i.test(step.targetName),
        })

        const ladderResult = await runWithLadder(
          page,
          step.targetSelector,
          step.targetName,
          expectedEffects,
          netRecorder,
          consoleRecorder,
          { maxSettleMs: 3000, dialogShownRef: dialogRef }
        )

        actionVerdict = ladderResult.verdict
        observation = ladderResult.reason
        if (job.currentAction) {
          job.currentAction.status = ladderResult.verdict === "passed" || ladderResult.verdict === "suspected_non_functional"
            ? "passed"
            : ladderResult.verdict === "blocked" || ladderResult.verdict === "skipped_unsafe"
              ? "blocked"
              : "failed"
        }
        await publishLiveFrame(job, page)

        if (ladderResult.observedEffect === "modal_opened") {
          appendLog(job, "info", `Modal dialog opened by "${step.targetName}". Verifying dismissal & focus restoration...`)
          const modalOutcome = await verifyModalCloseAndFocus(page, step.targetSelector, step.targetName)
          if (modalOutcome.closed) {
            observation += ` Modal verified and closed via ${modalOutcome.method}.`
            if (!modalOutcome.focusRestored) {
              job.issues.push({
                id: `issue-focus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                screenUrl: page.url(),
                screenTitle: step.screenName,
                type: "focus_not_restored",
                severity: "low",
                description: `Modal opened by "${step.targetName}" closed, but keyboard focus was reset to <body> instead of returning to trigger element (WCAG 2.4.3).`,
                expected: "Keyboard focus restored to trigger button or active element.",
                actual: "document.activeElement is <body>",
                timestamp: new Date().toISOString(),
              })
            }
          } else {
            appendLog(job, "warn", `Modal opened by "${step.targetName}" could not be dismissed via close button or Escape key.`)
          }
        }

        step.evidence = {
          expectedEffects,
          observedEffect: ladderResult.observedEffect,
          verdict: ladderResult.verdict,
          reason: ladderResult.reason,
          retriesUsed: ladderResult.retriesUsed,
          isWeakPass: ladderResult.isWeakPass,
          settleDurationMs: ladderResult.settleDurationMs,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
          coveredElementDetected: ladderResult.coveredElementDetected,
        }

        if (ladderResult.verdict === "suspected_non_functional") {
          job.issues.push({
            id: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            screenUrl: page.url(),
            screenTitle: step.screenName,
            type: "non_functional_control",
            severity: "medium",
            description: `Element "${step.targetName}" produced zero observable UI, navigation, media or network change after click retry ladder. Suspected placeholder or non-functional control.`,
            expected: `Expected observable effect (${expectedEffects.join(" or ")})`,
            actual: "No state change, no network call, no modal or navigation",
            timestamp: new Date().toISOString(),
          })
        }

        if (ladderResult.coveredElementDetected) {
          job.issues.push({
            id: `issue-cov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            screenUrl: page.url(),
            screenTitle: step.screenName,
            type: "covered_element",
            severity: "low",
            description: `Element "${step.targetName}" is partially or fully obscured by another overlapping element at its center coordinates.`,
            timestamp: new Date().toISOString(),
          })
        }
      } else if (step.actionType === "verify") {
        // Chat-added verification steps must be backed by visible browser evidence;
        // never mark a generic assertion as passed merely because it was in the plan.
        const visibleEvidence = await page.evaluate((query) => {
          const needle = String(query || "").trim().toLowerCase()
          if (!needle) return false
          const bodyText = (document.body?.innerText || "").toLowerCase()
          if (bodyText.includes(needle)) return true
          const candidates = Array.from(document.querySelectorAll(
            "button, a, input, textarea, select, [role=button], [role=tab], [aria-label], [title], label"
          ))
          return candidates.some((node) => {
            const element = node as HTMLElement
            const rect = element.getBoundingClientRect()
            const style = window.getComputedStyle(element)
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return false
            const description = [
              element.innerText,
              element.getAttribute("aria-label"),
              element.getAttribute("title"),
              element.getAttribute("placeholder"),
              element.getAttribute("name"),
              element.getAttribute("id"),
              (element as HTMLInputElement).value,
            ].filter(Boolean).join(" ").toLowerCase()
            return description.includes(needle)
          })
        }, step.targetName).catch(() => false)
        actionVerdict = visibleEvidence ? "passed" : "failed"
        observation = visibleEvidence
          ? `Visible UI evidence found for "${step.targetName}".`
          : `No visible UI evidence found for "${step.targetName}". Expected: ${step.expectedResult}`
      }

      // 3. Record Verdict
      step.verdict = actionVerdict
      step.status = actionVerdict
      step.actualResult = observation

      // Check for email confirmation / external verification requirements
      try {
        const verifyCheck = await detectVerificationScreen(page)
        if (verifyCheck.needsVerification) {
          const verified = await waitForExternalVerification(job, page, verifyCheck)
          if (verified) {
            observation += " External email verification confirmed by user."
            step.actualResult = observation
          }
        }
      } catch {}

      // Check for application settings API keys / credential requirements
      try {
        const settingsCheck = await detectSettingsCredentialsRequirement(page)
        if (settingsCheck.requiresCredentials) {
          const configured = await promptAndFillSecureSettings(job, page, settingsCheck.fields)
          if (configured) {
            observation += " Application settings credentials securely configured."
            step.actualResult = observation
          }
        }
      } catch {}

      // Runtime diagnostics are collected alongside each action's outcome.
      // They do not silently turn a legitimate empty state into a failed action.
      const diagnosticUrl = page.url()
      const diagnosticTimestamp = new Date().toISOString()
      const pushDiagnostic = (issue: AutomationIssue) => {
        const duplicate = job.issues.some((existing) =>
          existing.type === issue.type &&
          existing.screenUrl === issue.screenUrl &&
          existing.description === issue.description
        )
        if (!duplicate) {
          job.issues.push(issue)
          appendLog(
            job,
            issue.severity === "high" || issue.severity === "blocker" ? "warn" : "info",
            `[DIAGNOSTIC] ${issue.type}: ${issue.description}`
          )
        }
      }

      for (const resourceIssue of netRecorder.getResourceIssues()) {
        const isAsset = /^(image|media|font)$/.test(resourceIssue.resourceType)
        const issueType: AutomationIssue["type"] = isAsset
          ? "broken_asset"
          : resourceIssue.status !== undefined
            ? "http_error"
            : "request_failed"
        const statusText = resourceIssue.status !== undefined
          ? `HTTP ${resourceIssue.status}`
          : "Request failed"
        const detail = resourceIssue.errorText ? ` (${resourceIssue.errorText})` : ""
        const description = `${statusText} for ${resourceIssue.resourceType} resource: ${resourceIssue.url}${detail}`
        const severity: AutomationIssue["severity"] =
          (resourceIssue.status !== undefined && resourceIssue.status >= 500) ||
          /document|script|media/.test(resourceIssue.resourceType)
            ? "high"
            : resourceIssue.status === 404 && isAsset
              ? "medium"
              : "medium"

        pushDiagnostic({
          id: `issue-resource-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          screenUrl: diagnosticUrl,
          screenTitle: step.screenName,
          type: issueType,
          severity,
          description,
          expected: "Resource should load successfully (HTTP 2xx/3xx) without a network failure.",
          actual: `${statusText}; resource type: ${resourceIssue.resourceType}; method: ${resourceIssue.method}.`,
          timestamp: resourceIssue.timestamp || diagnosticTimestamp,
        })
      }

      const observedResourceUrls = new Set(
        netRecorder.getResourceIssues().map((resourceIssue) => secretRedactor.redact(resourceIssue.url))
      )
      const brokenDomAssets = await detectBrokenDomAssets(page)
      for (const asset of brokenDomAssets) {
        const safeAssetUrl = secretRedactor.redact(asset.url)
        if (observedResourceUrls.has(safeAssetUrl)) continue
        pushDiagnostic({
          id: `issue-dom-asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          screenUrl: diagnosticUrl,
          screenTitle: step.screenName,
          type: "broken_asset",
          // detectBrokenDomAssets currently returns image assets only.
          severity: "medium",
          description: `Broken visible image asset: ${safeAssetUrl}. ${asset.description}`,
          expected: "Visible images and media should load and decode successfully.",
          actual: asset.description,
          timestamp: diagnosticTimestamp,
        })
      }

      for (const consoleError of consoleRecorder.getErrors()) {
        pushDiagnostic({
          id: `issue-js-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          screenUrl: diagnosticUrl,
          screenTitle: step.screenName,
          type: "js_error",
          severity: "high",
          description: `Browser JavaScript/console error: ${secretRedactor.redact(consoleError)}`,
          expected: "No uncaught JavaScript exceptions or console errors during the tested action.",
          actual: secretRedactor.redact(consoleError),
          timestamp: diagnosticTimestamp,
        })
      }

      const emptySurfaces = await detectEmptyDataSurfaces(page)
      const correlatedConsoleErrors = consoleRecorder.getErrors().map((message) => secretRedactor.redact(message))
      const correlatedNetworkFailures = netRecorder.getResourceIssues()
        .filter((item) => (item.status !== undefined && item.status >= 400) || Boolean(item.errorText))
        .map((item) => ({
          url: secretRedactor.redact(item.url),
          status: item.status,
          errorText: item.errorText ? secretRedactor.redact(item.errorText) : undefined,
          resourceType: item.resourceType,
        }))

      // An empty table alone may be valid. Correlate it with same-step browser
      // or network errors to raise a more actionable issue.
      if (emptySurfaces.length > 0 && (correlatedConsoleErrors.length > 0 || correlatedNetworkFailures.length > 0)) {
        const serverFailure = correlatedNetworkFailures.some((item) => typeof item.status === "number" && item.status >= 500)
        const description = `Correlated UI/data failure: ${emptySurfaces.length} empty table/grid(s), ${correlatedConsoleErrors.length} console error(s), ${correlatedNetworkFailures.length} failed request(s).`
        pushDiagnostic({
          id: `issue-correlated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          screenUrl: diagnosticUrl,
          screenTitle: step.screenName,
          type: "correlated_ui_data_failure",
          severity: serverFailure ? "high" : "medium",
          description,
          expected: "Tables should show data or a clear empty state, without related console or request failures.",
          actual: [
            `Empty surfaces: ${emptySurfaces.map((item) => item.name).join(", ")}`,
            ...correlatedConsoleErrors.slice(0, 3).map((item) => `Console: ${item}`),
            ...correlatedNetworkFailures.slice(0, 4).map((item) => `Network: ${item.status ?? item.errorText ?? "failed"} ${item.url}`),
          ].join("\\n"),
          correlatedEvidence: {
            consoleErrors: correlatedConsoleErrors,
            networkFailures: correlatedNetworkFailures,
            emptyDataSurfaces: emptySurfaces.map((item) => item.name),
          },
          timestamp: diagnosticTimestamp,
        })
      }

      for (const surface of emptySurfaces) {
        const description = `Visible data table/grid "${surface.name}" has column headers but no data rows and no explicit empty-state message.`
        pushDiagnostic({
          id: `issue-empty-data-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          screenUrl: diagnosticUrl,
          screenTitle: step.screenName,
          type: "empty_data_surface",
          severity: "low",
          description,
          expected: "The table contains expected data rows or presents a clear, intentional empty-state message.",
          actual: `No data rows found. Detected columns: ${surface.headers.join(", ")}.`,
          timestamp: diagnosticTimestamp,
        })
      }

      if (actionVerdict === "passed") {
        passedCount++
      } else if (actionVerdict === "suspected_non_functional") {
        suspectedCount++
      } else if (actionVerdict === "failed") {
        failedCount++
        step.error = observation
      } else if (actionVerdict === "blocked") {
        blockedCount++
        step.error = observation
      }

      testedScreensSet.add(step.screenId)

      // 4. Capture Evidence Screenshot (Masking all passwords, tokens & API keys first)
      try {
        const isCritical = actionVerdict === "failed" || actionVerdict === "suspected_non_functional" || step.evidence?.isWeakPass
        const buf = await takeSecureScreenshot(page, {
          type: "jpeg",
          quality: isCritical ? 80 : 50,
        })
        step.screenshotUrl = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
        // Keep only the latest browser frame on the job for the live simulator mirror.
        // The full-resolution step screenshot remains attached to test evidence.
        job.currentScreenshotUrl = step.screenshotUrl
        job.currentUrl = page.url()
        step.evidenceTimestamp = new Date().toISOString()
        saveJob(job)
      } catch {}

      // Commit the final ledger outcome only after checkpoints and the evidence
      // screenshot have completed, so the history reflects the actual result.
      const ledgerStatus: ActionLedgerEntry["status"] =
        actionVerdict === "suspected_non_functional" ? "failed" :
        actionVerdict === "skipped_unsafe" ? "skipped" :
        actionVerdict
      updateActionLedgerForStep(
        job,
        step,
        ledgerStatus,
        observation,
        actionVerdict === "failed" || actionVerdict === "suspected_non_functional" || actionVerdict === "blocked"
          ? observation
          : undefined,
        { afterScreenshotUrl: step.screenshotUrl }
      )

      // 5. Dynamic inventory: rescan after EVERY action, even if the route
      // already exists. A modal, tab or expanded section can reveal new controls
      // without changing the URL.
      const currentUrl = page.url()
      const origin = new URL(testPlan.targetUrl).origin
      const currentNorm = normalizePath(currentUrl, origin)
      const newInv = await extractActionableInventory(page)
      const hasActiveModal = Boolean(newInv.modalTitle)
      const pageHasLoginWall = await hasLoginWall(page).catch(() => false)

      const previousScreen = testPlan.screens.find((s) => s.id === step.screenId)
      const prevElementNames = new Set(previousScreen?.actionableElements.map((e) => e.name.toLowerCase()) || [])
      const newElementNames = new Set(newInv.actionableElements.map((e) => e.name.toLowerCase()))
      const commonNames = Array.from(newElementNames).filter((n) => prevElementNames.has(n))
      const similarity =
        prevElementNames.size > 0
          ? commonNames.length / Math.max(prevElementNames.size, newElementNames.size)
          : 0
      const isSignificantViewChange =
        hasActiveModal ||
        (newInv.actionableElements.length >= 2 && similarity < 0.45)

      let currentScreenName = deriveScreenName(currentNorm, newInv.heading, newInv.modalTitle, pageHasLoginWall)
      const actionClean = step.targetName.replace(/^Click\s*"?|"?\s*$/gi, "").trim()
      if (hasActiveModal || isSignificantViewChange || Boolean(step.screenshotUrl)) {
        if (!newInv.heading || currentScreenName === "Home / Dashboard" || currentScreenName === previousScreen?.name) {
          currentScreenName = actionClean ? `${actionClean} (${step.actionType || "Action"})` : "Action Screen"
        }
      }

      const isLogoutAction = /log\s*out|sign\s*out|log\s*off/i.test(step.targetName)
      const isReturnedToLogin = Boolean(pageHasLoginWall || /login|sign[-_ ]?in/i.test(currentNorm))

      let currentScreen: AppScreenNode | undefined
      let createdNewScreen = false

      if (isLogoutAction || (isReturnedToLogin && step.screenId !== "S001")) {
        const loginScreen =
          testPlan.screens.find((s) => s.isLoginWall || /login|sign\s*in/i.test(s.name) || /login|sign[-_ ]?in/i.test(s.path)) ||
          testPlan.screens[0]

        if (loginScreen) {
          currentScreen = loginScreen
          const originScreenId = step.screenId || previousScreen?.id || "S001"
          if (!testPlan.transitions.some((t) => t.fromScreenId === originScreenId && t.toScreenId === loginScreen.id && /log\s*out|sign\s*out|login/i.test(t.action))) {
            testPlan.transitions.push({
              id: `tr-logout-to-login-${testPlan.transitions.length + 1}`,
              fromScreenId: originScreenId,
              toScreenId: loginScreen.id,
              action: step.targetName || "Log out (Return to Login)",
              actionType: "navigation",
            })
          }
          appendLog(job, "success", `🔄 [WORKFLOW COMPLETE] Transition mapped from "${originScreenId}" back to "${loginScreen.name}" (${loginScreen.id}) via "${step.targetName || 'Log out'}". Workflow lifecycle completed!`)
        }
      }

      if (!currentScreen) {
        currentScreen = testPlan.screens.find((screen) => {
          if (screen.id === step.screenId && screen.id !== "S001") return true
          if (hasActiveModal) return screen.name.toLowerCase() === currentScreenName.toLowerCase()
          return (
            screen.path.split("#")[0] === currentNorm &&
            screen.name.trim().toLowerCase() === currentScreenName.trim().toLowerCase() &&
            Boolean(screen.isLoginWall) === pageHasLoginWall
          )
        })
      }

      if (!currentScreen) {
        createdNewScreen = true
        const newScreenId = `S${String(testPlan.screens.length + 1).padStart(3, "0")}`
        const compLoc = getComponentLocationForPlanPath(currentNorm)
        currentScreen = {
          id: newScreenId,
          name: currentScreenName,
          url: currentUrl,
          path: hasActiveModal
            ? `${currentNorm}#modal-${encodeURIComponent((newInv.modalTitle || "dialog").toLowerCase().replace(/\s+/g, "-"))}`
            : `${currentNorm}#action-${step.stepIndex}-${encodeURIComponent(currentScreenName.toLowerCase().replace(/\s+/g, "-"))}`,
          componentLocation: compLoc,
          sourceFile: compLoc,
          screenshotUrl: step.screenshotUrl,
          actionableElements: [],
          forms: [],
          isLoginWall: pageHasLoginWall,
          isNewDiscovery: true,
          discoveredAt: new Date().toISOString(),
          modalTriggerSelector: hasActiveModal ? step.targetSelector : undefined,
          modalTriggerText: hasActiveModal ? step.targetName : undefined,
        }
        testPlan.screens.push(currentScreen)
        const originScreenId = step.screenId || testPlan.screens[0]?.id || "S001"
        testPlan.transitions.push({
          id: `tr-${testPlan.transitions.length + 1}`,
          fromScreenId: originScreenId,
          toScreenId: newScreenId,
          action: step.targetName,
          actionType: hasActiveModal ? "modal_open" : step.actionType === "fill" ? "form_submit" : "click",
          triggerSelector: hasActiveModal ? step.targetSelector : undefined,
        })
        // Map backward return transition as well to verify bidirectional workflow
        testPlan.transitions.push({
          id: `tr-return-${testPlan.transitions.length + 1}`,
          fromScreenId: newScreenId,
          toScreenId: originScreenId,
          action: `Return / Back ↩️ (Verified)`,
          actionType: hasActiveModal ? "modal_close" : "navigation",
        })
        step.screenId = newScreenId
        step.screenName = currentScreenName
        step.url = currentUrl
        step.componentLocation = compLoc
        appendLog(job, "success", `🌟 [ACTION SCREEN] Created screen ${newScreenId}: "${currentScreenName}" with verified return path to ${originScreenId}.`)
      } else if (step.screenshotUrl && !currentScreen.screenshotUrl) {
        currentScreen.screenshotUrl = step.screenshotUrl
      }

      const resolvedScreen = currentScreen as AppScreenNode

      // Merge inventory into the existing screen instead of replacing it.
      // Stable keys preserve history and allow the queue to distinguish new actions.
      const knownElementKeys = new Set(
        resolvedScreen.actionableElements.map((element) => {
          const key = stableActionKeyForScreen(resolvedScreen, element)
          element.actionKey = key
          return key
        })
      )
      for (const element of newInv.actionableElements) {
        const key = stableActionKeyForScreen(resolvedScreen, element)
        element.actionKey = key
        if (!knownElementKeys.has(key)) {
          resolvedScreen.actionableElements.push(element)
          knownElementKeys.add(key)
        }
      }

      const knownFormKeys = new Set(
        resolvedScreen.forms.map((form) => [form.id, form.selector || "", form.name || ""].join("|").toLowerCase())
      )
      for (const form of newInv.forms) {
        const key = [form.id, form.selector || "", form.name || ""].join("|").toLowerCase()
        if (!knownFormKeys.has(key)) {
          resolvedScreen.forms.push(form)
          knownFormKeys.add(key)
        }
      }

      resolvedScreen.url = currentUrl
      if (step.screenshotUrl) resolvedScreen.screenshotUrl = step.screenshotUrl

      // Record / update transition for this click so the workflow map reflects actual navigation
      if (step.actionType === "click" || step.actionType === "toggle") {
        const destScreenId = resolvedScreen.id || step.screenId
        const existingTrans = testPlan.transitions.find(
          (t) => t.fromScreenId === step.screenId && t.action === step.targetName
        )
        if (existingTrans) {
          existingTrans.toScreenId = destScreenId
        } else {
          testPlan.transitions.push({
            id: `tr-${testPlan.transitions.length + 1}`,
            fromScreenId: step.screenId,
            toScreenId: destScreenId,
            action: step.targetName,
            actionType: step.actionType === "click" ? "click" : "toggle",
            triggerSelector: step.targetSelector,
          })
        }
      }

      mergeScreenActionsIntoLedger(job, resolvedScreen)
      linkTestPlanStepsToLedger(job, testPlan)
      const queuedNow = queueUnplannedLedgerActions(job, testPlan, resolvedScreen.id, i)
      const prioritizedNow = prioritizePendingStepsForScreen(testPlan, resolvedScreen.id, i)
      job.currentUrl = currentUrl
      job.flowGraph = buildFigmaWorkflowMap(testPlan)
      job.fullAppTestPlan = testPlan
      if (createdNewScreen) {
        emitSessionEvent(job, "screen_discovered", {
          url: currentUrl,
          message: `Discovered ${hasActiveModal ? "modal/view" : "screen"} ${resolvedScreen.name} while testing.`,
          payload: { screenId: resolvedScreen.id, path: resolvedScreen.path, actionableCount: resolvedScreen.actionableElements.length },
        })
      }
      emitSessionEvent(job, "test_result", {
        url: currentUrl,
        message: `Step ${step.id}: ${step.status} — ${step.targetName}`,
        payload: {
          stepId: step.id,
          screenId: resolvedScreen.id,
          status: step.status,
          verdict: step.verdict,
          hasScreenshot: Boolean(step.screenshotUrl),
        },
      })
      if (step.screenshotUrl) {
        emitSessionEvent(job, "evidence", {
          url: currentUrl,
          message: `Screenshot evidence captured for ${step.id}.`,
          payload: { stepId: step.id, screenId: resolvedScreen.id, capturedAt: step.evidenceTimestamp },
        })
      }
      if (queuedNow > 0 || prioritizedNow > 0) {
        appendLog(
          job,
          "info",
          `[COVERAGE] "${resolvedScreen.name}" has ${resolvedScreen.actionableElements.length} known controls; ${queuedNow} new action(s) queued and ${prioritizedNow} pending step(s) prioritized for this screen.`
        )
      }
      saveJob(job)

      // 6. Update Coverage
      testPlan.coverage = {
        screensTested: testedScreensSet.size,
        totalScreens: testPlan.screens.length,
        actionsTested: passedCount + failedCount + blockedCount + suspectedCount + skippedUnsafeCount,
        totalActions: testPlan.steps.length,
        formsTested: testPlan.screens.filter((s) => testedScreensSet.has(s.id)).reduce((acc, s) => acc + (s.forms?.length || 0), 0),
        totalForms: testPlan.screens.reduce((acc, s) => acc + (s.forms?.length || 0), 0),
        percentage: Math.round(((passedCount + failedCount + blockedCount + suspectedCount + skippedUnsafeCount) / testPlan.steps.length) * 100),
      }

      saveJob(job)
    } catch (stepErr: any) {
      step.status = "failed"
      step.verdict = "failed"
      failedCount++
      step.error = secretRedactor.redact(stepErr?.message || "Execution exception")
      updateActionLedgerForStep(job, step, "failed", step.error, step.error)
      appendLog(job, "warn", `Step ${i + 1} exception: ${secretRedactor.redact(stepErr?.message || "Execution exception")}`)
    } finally {
      netRecorder.cleanup()
      consoleRecorder.cleanup()
    }
  }

  // A run is not complete while any discovered action remains untested or running.
  // This prevents the report from claiming full coverage after a queueing gap.
  const unresolvedLedgerEntries = (job.actionLedger?.entries || []).filter(
    (entry) => entry.status === "untested" || entry.status === "running"
  )
  const unresolvedSteps = testPlan.steps.filter(
    (queued) => queued.status === "pending" || queued.status === "running"
  )
  if (unresolvedLedgerEntries.length > 0 || unresolvedSteps.length > 0) {
    const detail = `${unresolvedLedgerEntries.length} ledger action(s) and ${unresolvedSteps.length} plan step(s) remain unverified.`
    appendLog(job, "error", `[COVERAGE INCOMPLETE] ${detail} The run will not be marked complete.`)
    testPlan.status = "error"
    job.testingPhase = "executing"
    job.status = "failed"
    job.progress = Math.min(job.progress, 99)
    job.currentStep = detail
    saveJob(job)
    return
  }

  // PHASE 4: Chained Multi-Step Workflows ("go next next" & state persistence)
  if (!options?.skipWorkflows) {
    appendLog(job, "info", `Starting Phase 4: Chained Workflow Execution & State Persistence...`)
    try {
      testPlan.workflows = await executeChainedWorkflows(
        job,
        page,
        testPlan.screens,
        testPlan.transitions,
        testPlan.targetUrl,
        {
          postmanSummary: options?.postmanSummary || testPlan.postmanSummary,
          allowActions: options?.allowActions,
          noiseHosts: options?.noiseHosts,
          allowTestPayments: isPaymentPermitted,
          paymentCredentials: options?.paymentCredentials,
        }
      )
    } catch (wfErr: any) {
      appendLog(job, "warn", `Workflow chaining encountered error: ${wfErr?.message}`)
    }
  }

  // PHASE 5: UX Intelligence Evidence Collection & Scoring
  appendLog(job, "info", `Collecting UX Intelligence evidence across ${testPlan.steps.length} steps...`)
  try {
    const uxEvidenceBundles: ScreenEvidenceBundle[] = []
    const processedScreens = new Set<string>()
    
    for (const step of testPlan.steps) {
      const screen = testPlan.screens.find((s) => s.id === step.screenId)
      
      if (screen && step.screenshotUrl && !processedScreens.has(screen.id)) {
        try {
          const screenSteps = testPlan.steps.filter((s) => s.screenId === screen.id)
          const workflowEvidence = collectWorkflowEvidence(
            screen.id,
            screen.name,
            screenSteps,
            screenSteps.every(s => s.status === "passed") // completedSuccessfully
          )
          
          const evidenceBundle = await collectScreenEvidence(
            page,
            screen,
            step.screenshotUrl,
            [workflowEvidence]
          )
          
          uxEvidenceBundles.push(evidenceBundle)
          processedScreens.add(screen.id)
        } catch (uxErr: any) {
          appendLog(job, "warn", `UX evidence collection failed for screen ${screen.id}: ${uxErr?.message}`)
        }
      }
    }

    if (uxEvidenceBundles.length > 0) {
      appendLog(job, "info", `Running UX scoring checks across ${uxEvidenceBundles.length} screens...`)
      const allScoringChecks = uxEvidenceBundles.flatMap((bundle) => applyAllScoringChecks(bundle))
      const uxScore = calculateOverallUXScore(allScoringChecks)
      
      // Store UX audit score with evidence bundles
      job.uxAuditScore = {
        overall: uxScore.overall,
        grade: uxScore.grade,
        confidence: uxScore.confidence,
        dimensions: uxScore.dimensions,
        totalChecksApplied: uxScore.totalChecksApplied,
        evidenceBundles: uxEvidenceBundles as any[]
      }
      
      const taskEffScore = uxScore.dimensions.find(d => d.dimension === 'taskEffectiveness')?.score || 0
      const workflowEffScore = uxScore.dimensions.find(d => d.dimension === 'workflowEfficiency')?.score || 0
      
      appendLog(job, "success", `✓ UX Intelligence Score: ${uxScore.overall.toFixed(1)}/100 (${uxScore.grade}) | Task Effectiveness: ${taskEffScore.toFixed(1)} | Workflow Efficiency: ${workflowEffScore.toFixed(1)}`)
      saveJob(job)
    }
  } catch (uxErr: any) {
    appendLog(job, "warn", `UX Intelligence scoring encountered error: ${uxErr?.message}`)
  }

  // PHASE 6: Comprehensive Evidence Reporting & Markdown Artifact
  appendLog(job, "info", `Generating Phase 6: Evidence-Based Failure Report & Markdown Artifact...`)
  try {
    buildAutomationReport(job, testPlan, testPlan.workflows || [], {
      postmanSummary: options?.postmanSummary || testPlan.postmanSummary,
    })
  } catch (repErr: any) {
    appendLog(job, "warn", `Evidence report generation encountered error: ${repErr?.message}`)
  }

  testPlan.status = "completed"
  job.testingPhase = "reporting"
  job.status = "completed"
  job.progress = 100
  job.currentStep = `Outcome-verified Full App Testing completed: ${passedCount} Passed, ${suspectedCount} Suspected Non-Functional, ${failedCount} Failed, ${skippedUnsafeCount} Skipped Unsafe.`
  saveJob(job)

  appendLog(
    job,
    "success",
    `✅ Outcome-Verified Testing Finished! ${passedCount} passed, ${suspectedCount} suspected non-functional, ${failedCount} failed, ${skippedUnsafeCount} skipped unsafe across ${testPlan.screens.length} mapped screens.`
  )
}

// Re-export pure client-safe utilities
export {
  buildFigmaWorkflowMap,
  synthesizeFullAppPlanFromJob,
  isFullAppCommand,
  normalizePath,
  deriveScreenName,
} from "./full-app-utils"

export async function executeFullAppTestingJob(
  job: AutomationJob,
  params: StartAutomationRequest
): Promise<void> {
  let browser: Browser | null = null
  let videoRecorder: SessionVideoRecorder | null = null
  let liveFrameTimer: ReturnType<typeof setInterval> | null = null

  try {
    secretRedactor.registerMultiple([
      params.credentials?.username,
      params.credentials?.password,
      params.credentials?.token,
      params.paymentCredentials?.cardNumber,
      params.paymentCredentials?.cardHolder,
      params.paymentCredentials?.expiryDate,
      params.paymentCredentials?.cvv,
      params.paymentCredentials?.zipCode,
    ])
    job.status = "running"
    job.testingPhase = "discovery"
    job.progress = 5
    job.currentStep = "Initiating Phase 1: Application Discovery & Mapping..."
    saveJob(job)

    appendLog(job, "info", `🚀 [FULL APP TESTING] Target: ${job.targetUrl}`)
    appendLog(job, "info", "Architecture: DISCOVER → MAP → CREATE TEST PLAN → EXECUTE → VERIFY → REPORT")

    browser = await safePuppeteerLaunch()

    const page = await browser.newPage()
    const primaryVp = params.viewports?.[0] || { width: 1440, height: 900 }
    const isMobileVp = primaryVp.width <= 768
    await page.setViewport({
      width: primaryVp.width,
      height: primaryVp.height,
      deviceScaleFactor: 1,
      isMobile: isMobileVp,
      hasTouch: isMobileVp,
    })

    // Live mirror: capture frames continuously so cursor moves / keystrokes are visible.
    // In-memory only (job object is shared with the store); the frame endpoint reads it.
    // ponytail: JPEG polling ~4fps; upgrade to CDP screencast if recorder stops using it.
    let frameBusy = false
    liveFrameTimer = setInterval(async () => {
      if (frameBusy || page.isClosed()) return
      frameBusy = true
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 40, fullPage: false })
        job.currentScreenshotUrl = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
      } catch {} finally {
        frameBusy = false
      }
    }, 250)

    // Safety environment inspection
    const isProd = isProductionLike(job.targetUrl)
    const allowTestPayments = params.allowTestPayments ?? !isProd
    if (isProd) {
      appendLog(
        job,
        "warn",
        `⚠️ [SAFETY WARNING] Target URL "${job.targetUrl}" appears to be a production environment. Destructive/payment actions will be guarded.`
      )
    }

    // Install network guard for payment/email hosts
    await installNetworkGuard(page, {
      allowActions: params.allowActions,
      allowTestPayments,
      isProduction: isProd,
      onBlocked: (url, reason) => {
        appendLog(job, "warn", `[SAFETY GUARD] Aborted request to ${url} (${reason}).`)
      },
    })

    // Start session video recorder (with visible mouse cursor, ripples & interaction highlights)
    if (params.recordVideo !== false) {
      videoRecorder = new SessionVideoRecorder(page, job.projectId, job.id)
      await videoRecorder.start(job)
      job.recordingControl = "recording"
      emitSessionEvent(job, "recording", { message: "Continuous session recording started.", payload: { state: "recording" } })
      appendLog(job, "info", "🎥 Session journey recording active with visible cursor & interaction overlay.")
    } else {
      await installVisualOverlay(page)
    }

    // Track console JS errors
    page.on("pageerror", (err: any) => {
      const errMsg = err?.message || String(err)
      const issue: AutomationIssue = {
        id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        screenUrl: page.url(),
        screenTitle: "Console Error",
        type: "js_error",
        severity: "medium",
        description: `Uncaught JavaScript Exception: ${errMsg}`,
        timestamp: new Date().toISOString(),
      }
      job.issues.push(issue)
      appendLog(job, "warn", `JavaScript error on ${page.url()}: ${errMsg}`)
      saveJob(job)
    })

    // PHASE 1: Systematic Discovery & Mapping
    await page.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null)
    await waitForSpaPageReady(page, 4500)
    if (page.url().startsWith("http://") || page.url().startsWith("https://")) {
      job.currentUrl = page.url()
      try {
        const preview = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false })
        job.currentScreenshotUrl = `data:image/jpeg;base64,${Buffer.from(preview).toString("base64")}`
        saveJob(job)
      } catch {}
      emitSessionEvent(job, "navigation_completed", {
        url: job.currentUrl,
        message: `Browser opened ${job.currentUrl}.`,
        payload: { phase: "discovery" },
      })
    }

    const sessionCreds: { username?: string; password?: string } = { ...(params.credentials || {}) }
    const vaultCreds = getJobSecrets(job.id)?.credentials
    if (vaultCreds) {
      if (!sessionCreds.username && vaultCreds.username) sessionCreds.username = vaultCreds.username
      if (!sessionCreds.password && vaultCreds.password) sessionCreds.password = vaultCreds.password
    }
    let testPlan: FullAppTestPlan

    if (job.planApprovalState === "approved" && job.fullAppTestPlan && job.fullAppTestPlan.steps?.length > 0) {
      testPlan = job.fullAppTestPlan
      appendLog(
        job,
        "info",
        `⚡ Executing approved test plan with ${testPlan.steps.length} steps directly.`
      )
    } else {
      const discovery = await discoverAndMapApp(job, page, job.targetUrl, {
        maxScreens: params.maxScreens || 10,
        credentials: sessionCreds,
        projectDir: params.projectDir,
        layaUrl: (params as any).layaBaseUrl || (job as any).layaBaseUrl,
      })

      // Populate screens for UI compatibility
      job.screens = discovery.screens.map((s) => {
        const shots: Record<string, string> = {}
        if (s.screenshotUrl) shots["Desktop"] = s.screenshotUrl
        return {
          url: s.url,
          path: s.path,
          title: `${s.id} ${s.name}`,
          screenshotUrl: s.screenshotUrl,
          testedAt: new Date().toISOString(),
          screenshots: shots,
          backNavigationStatus: "passed" as const,
          responsiveStatus: "passed" as const,
          issuesCount: 0,
        }
      })

      // PHASE 2: Generate Structured Test Plan from Discovered Map
      job.testingPhase = "planning"
      job.currentStep = "Phase 2: Generating structured test plan and actionable element inventory..."
      job.progress = 30
      saveJob(job)

      appendLog(job, "info", "Phase 2: Generating structured test plan from discovered screens & elements...")
      testPlan = generateStructuredTestPlan(job.targetUrl, discovery.screens, discovery.transitions, {
        isAuthenticated: job.authState === "logged_in",
        postmanCollection: params.postmanCollection || job.postmanCollection,
      })
      linkTestPlanStepsToLedger(job, testPlan)
      queueUnplannedLedgerActions(job, testPlan)
      job.fullAppTestPlan = testPlan
      job.flowGraph = buildFigmaWorkflowMap(testPlan)
      saveJob(job)

      appendLog(
        job,
        "info",
        `📋 Test Plan Generated: ${testPlan.steps.length} test steps across ${testPlan.screens.length} screens (${testPlan.requiredFileTypes.length} file upload types detected).`
      )

      // MAP & PLAN FIRST: keep the authenticated browser and recording alive while
      // the user reviews the plan. Execution resumes only after explicit approval.
      job.planApprovalState = "awaiting_review"
      job.testingPhase = "planning"
      job.currentStep = "Test plan ready. Review it in the Plan tab, chat to revise it, then approve execution."
      job.progress = 35
      saveJob(job)
      emitSessionEvent(job, "progress", {
        message: "Authenticated discovery is complete. The test plan is waiting for review and approval.",
        payload: { phase: "plan_review", stepCount: testPlan.steps.length, screenCount: testPlan.screens.length },
      })
      appendLog(job, "info", "⏸️ Execution paused for plan review. Revise the plan in chat or approve it to continue this same browser session.")

      while (job.status === "running" && job.planApprovalState !== "approved") {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const refreshed = getJob(job.id)
        if (!refreshed) {
          job.status = "failed"
          job.error = "The testing job disappeared while waiting for plan approval."
          saveJob(job)
          return
        }
        if (refreshed.status !== "running") {
          job.status = refreshed.status
          return
        }
        if (refreshed.fullAppTestPlan && refreshed.fullAppTestPlan.id === testPlan.id) {
          Object.assign(testPlan, refreshed.fullAppTestPlan)
          job.fullAppTestPlan = testPlan
        }
        job.planApprovalState = refreshed.planApprovalState
      }

      if (job.status !== "running" || job.planApprovalState !== "approved") return
      // Use the latest server-persisted revision, not the original generated plan.
      const approvedJob = getJob(job.id)
      if (approvedJob?.fullAppTestPlan?.id === testPlan.id) {
        Object.assign(testPlan, approvedJob.fullAppTestPlan)
        job.fullAppTestPlan = testPlan
      }
    }
    job.testingPhase = "files"
    job.currentStep = "Plan approved. Preparing test assets before execution..."
    job.progress = 38
    saveJob(job)
    appendLog(job, "success", `✅ Plan approved with ${testPlan.steps.length} steps. Continuing in the existing browser session.`)

    // Resolve upload folder from params / user prompt mention / project conventions
    const uploadFilesDir = resolveUploadFolder({
      uploadFilesDir: params.uploadFilesDir || job.uploadFilesDir,
      projectDir: params.projectDir || job.projectDir,
      prompt: params.userInstruction || params.workflowPrompt,
    })

    let uploadInventory = null
    if (uploadFilesDir) {
      uploadInventory = scanUploadFolder(uploadFilesDir)
      job.uploadFilesDir = uploadFilesDir
      appendLog(
        job,
        "info",
        `📁 Detected upload test folder: "${uploadFilesDir}" (${uploadInventory.files.length} test files indexed).`
      )
    }

    // PHASE 3: Systematic Execution of Test Plan & Workflows
    await executeStructuredTestPlan(job, page, testPlan, params.dummyTestFiles, sessionCreds, {
      allowActions: params.allowActions,
      noiseHosts: params.noiseHosts,
      postmanSummary: testPlan.postmanSummary,
      allowTestPayments,
      paymentCredentials: params.paymentCredentials,
      uploadFilesDir: uploadFilesDir || undefined,
      uploadInventory,
      projectDir: params.projectDir,
    })

    // Finalize session video recording
    if (videoRecorder) {
      const recUrl = await videoRecorder.stop(job)
      if (recUrl) {
        job.recordingUrl = recUrl
        if (job.report) job.report.recordingUrl = recUrl
      }
      job.recordingControl = "stopped"
      emitSessionEvent(job, "recording", { message: recUrl ? "Session recording finalized." : "Session recording stopped without a published URL.", payload: { state: "stopped", recordingUrl: recUrl || undefined } })
    }

    // Preserve an explicit incomplete-coverage failure from the execution phase.
    if ((job.status as string) === "failed" || job.fullAppTestPlan?.status === "error") {
      job.status = "failed"
      job.testingPhase = "reporting"
      job.finishedAt = new Date().toISOString()
      saveJob(job)
      appendLog(job, "error", "Full App Testing stopped without claiming completion because coverage remains unresolved.")
      return
    }

    // PHASE 4: Final Reporting & Coverage
    job.testingPhase = "reporting"
    job.status = "completed"
    job.progress = 100
    job.finishedAt = new Date().toISOString()
    saveJob(job)

    appendLog(job, "success", "🏁 Full App Testing pipeline completed successfully with full evidence and coverage report.")
  } catch (err: any) {
    console.error("[FullAppEngine] Fatal execution failure:", err)
    if (videoRecorder) {
      const recUrl = await videoRecorder.stop(job).catch(() => "")
      if (recUrl) {
        job.recordingUrl = recUrl
        if (job.report) job.report.recordingUrl = recUrl
      }
      job.recordingControl = "stopped"
      emitSessionEvent(job, "recording", {
        message: recUrl ? "Session recording finalized after an error." : "Session recording stopped after an error.",
        payload: { state: "stopped", recordingUrl: recUrl || undefined },
      })
    }
    job.status = "failed"
    job.error = secretRedactor.redact(err?.message || "Execution exception occurred during Full App Testing")
    job.finishedAt = new Date().toISOString()
    appendLog(job, "error", `Fatal Full App Testing failure: ${job.error}`)
    saveJob(job)
  } finally {
    if (liveFrameTimer) {
      clearInterval(liveFrameTimer)
      liveFrameTimer = null
    }
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
  }
}

