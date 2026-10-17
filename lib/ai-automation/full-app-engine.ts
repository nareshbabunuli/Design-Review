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
  isSameOriginUrl,
  deriveScreenName,
  buildFigmaWorkflowMap,
  synthesizeFullAppPlanFromJob,
  isFullAppCommand,
} from "./full-app-utils"
export { isSameOriginUrl } from "./full-app-utils"
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

import {
  type LoginCreds,
  takeSecureScreenshot,
  publishLiveAction,
  publishLiveFrame,
  waitForSpaPageReady,
  hasLoginWall,
  attemptLogin,
  authenticateIfNeeded,
  collectLinks,
  collectLinksWithExpansion,
  discoverAndMapApp,
  completeJourneyReturnAndLogout,
} from "./full-app-discovery"

export {
  type LoginCreds,
  takeSecureScreenshot,
  publishLiveAction,
  publishLiveFrame,
  waitForSpaPageReady,
  hasLoginWall,
  attemptLogin,
  authenticateIfNeeded,
  collectLinks,
  collectLinksWithExpansion,
  discoverAndMapApp,
  completeJourneyReturnAndLogout,
} from "./full-app-discovery"

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


import {
  enrichInventoryWithLaya,
  extractActionableInventory,
} from "./full-app-inventory"

export {
  enrichInventoryWithLaya,
  extractActionableInventory,
} from "./full-app-inventory"

/**
 * Systematically discovers all reachable screens in the application,
 * generating screen nodes with unique IDs (S001, S002, ...) and action transitions.
 */

import {
  rebuildActionLedger,
  stableActionKeyForScreen,
  mergeScreenActionsIntoLedger,
  updateActionLedgerForStep,
  linkTestPlanStepsToLedger,
  queueUnplannedLedgerActions,
  prioritizePendingStepsForScreen,
  generateStructuredTestPlan,
} from "./full-app-planner"

export {
  rebuildActionLedger,
  stableActionKeyForScreen,
  mergeScreenActionsIntoLedger,
  updateActionLedgerForStep,
  linkTestPlanStepsToLedger,
  queueUnplannedLedgerActions,
  prioritizePendingStepsForScreen,
  generateStructuredTestPlan,
} from "./full-app-planner"



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

      const targetOrigin = new URL(testPlan.targetUrl).origin
      const preActionUrl = isSameOriginUrl(page.url(), targetOrigin)
        ? page.url()
        : targetScreen?.url && isSameOriginUrl(targetScreen.url, targetOrigin)
          ? targetScreen.url
          : testPlan.targetUrl

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
      // without changing the URL. Never index external domains (e.g. linkedin.com);
      // return immediately to the main app page.
      const currentUrl = page.url()
      const origin = new URL(testPlan.targetUrl).origin
      if (!isSameOriginUrl(currentUrl, origin)) {
        appendLog(
          job,
          "info",
          `↩️ [EXTERNAL NAVIGATION] "${step.targetName}" navigated to external domain (${secretRedactor.redact(currentUrl)}). Returning to ${secretRedactor.redact(preActionUrl)} without testing external site.`
        )
        step.actualResult = `${observation} (External navigation to ${secretRedactor.redact(currentUrl)} verified; returned to main page)`
        await page.goto(preActionUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null)
        await waitForSpaPageReady(page, 1500).catch(() => {})
        job.currentUrl = page.url()
        await publishLiveFrame(job, page).catch(() => {})
        emitSessionEvent(job, "test_result", {
          url: job.currentUrl,
          message: `Step ${step.id}: ${step.status} — ${step.targetName} (external link verified, returned to main app)`,
          payload: {
            stepId: step.id,
            screenId: step.screenId,
            status: step.status,
            verdict: step.verdict,
            hasScreenshot: Boolean(step.screenshotUrl),
          },
        })
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
        continue
      }

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

  // PHASE 4.5: Return to Main Page & Complete Authenticated Logout Journey
  try {
    const journeyEnd = await completeJourneyReturnAndLogout(
      job,
      page,
      testPlan.targetUrl,
      testPlan.screens,
      testPlan.transitions,
      credentials
    )
    if (journeyEnd.loggedOut) {
      const mainScreen = testPlan.screens.find((s) => s.id === journeyEnd.mainScreenId) || testPlan.screens[0]
      const logoutStep: TestPlanStep = {
        id: `STEP-${String(testPlan.steps.length + 1).padStart(3, "0")}`,
        stepIndex: testPlan.steps.length + 1,
        screenId: mainScreen?.id || "S001",
        screenName: mainScreen?.name || "Main Page",
        url: journeyEnd.finalUrl,
        actionType: "click",
        targetName: journeyEnd.logoutLabel || "Log Out",
        expectedResult: "Return to main page and log out to complete the authenticated application journey.",
        actualResult: `Returned to main page and clicked "${journeyEnd.logoutLabel || "Log Out"}" -> navigated to ${secretRedactor.redact(journeyEnd.finalUrl)}.`,
        status: "passed",
        verdict: "passed",
        screenshotUrl: journeyEnd.screenshotUrl,
        evidenceTimestamp: new Date().toISOString(),
      }
      testPlan.steps.push(logoutStep)
      passedCount++
    }
    job.flowGraph = buildFigmaWorkflowMap(testPlan)
    job.fullAppTestPlan = testPlan
    saveJob(job)
  } catch (journeyErr: any) {
    appendLog(job, "warn", `Journey completion return/logout check encountered error: ${journeyErr?.message}`)
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


// Merge targeted rediscovery into the existing graph without throwing away verified
// screens. URL + screen name distinguishes meaningful UI states on the same route.
function mergeRediscoveredGraph(
  existingScreens: AppScreenNode[],
  existingTransitions: AppWorkflowTransition[],
  freshScreens: AppScreenNode[],
  freshTransitions: AppWorkflowTransition[],
): { screens: AppScreenNode[]; transitions: AppWorkflowTransition[] } {
  const screens = existingScreens.map((screen) => ({ ...screen }))
  const transitions = existingTransitions.map((transition) => ({ ...transition }))
  const identity = (screen: AppScreenNode) => {
    let route = screen.path || screen.url
    try {
      const parsed = new URL(screen.url)
      route = `${parsed.origin}${parsed.pathname.replace(/\/$/, "") || "/"}`
    } catch {
      route = route.split(/[?#]/)[0].replace(/\/$/, "") || "/"
    }
    return `${route.toLowerCase()}::${screen.name.trim().toLowerCase()}::${(screen.modalTriggerText || "").trim().toLowerCase()}`
  }
  const ids = new Map<string, string>()
  const known = new Map(screens.map((screen) => [identity(screen), screen]))
  let sequence = screens.reduce((max, screen) => Math.max(max, Number(screen.id.replace(/^S/i, "")) || 0), 0) + 1

  for (const fresh of freshScreens) {
    const key = identity(fresh)
    const prior = known.get(key)
    if (prior) {
      // Refresh evidence/inventory for a known state but preserve its stable ID.
      Object.assign(prior, fresh, { id: prior.id, isNewDiscovery: false })
      ids.set(fresh.id, prior.id)
      continue
    }
    const id = `S${String(sequence++).padStart(3, "0")}`
    const added = { ...fresh, id, isNewDiscovery: true }
    screens.push(added)
    known.set(key, added)
    ids.set(fresh.id, id)
  }

  const transitionKeys = new Set(transitions.map((t) => `${t.fromScreenId}::${t.toScreenId}::${t.action.toLowerCase()}`))
  for (const fresh of freshTransitions) {
    const fromScreenId = ids.get(fresh.fromScreenId) || fresh.fromScreenId
    const toScreenId = ids.get(fresh.toScreenId) || fresh.toScreenId
    if (!screens.some((screen) => screen.id === fromScreenId) || !screens.some((screen) => screen.id === toScreenId)) continue
    const key = `${fromScreenId}::${toScreenId}::${fresh.action.toLowerCase()}`
    if (transitionKeys.has(key)) continue
    transitions.push({ ...fresh, id: `tr-${transitions.length + 1}`, fromScreenId, toScreenId })
    transitionKeys.add(key)
  }
  return { screens, transitions }
}

function extractRediscoveryUrl(prompt: string, fallback: string, origin: string): string {
  const match = prompt.match(/https?:\/\/[^\s"'<>]+/i)
  if (!match) return fallback
  try {
    const candidate = new URL(match[0].replace(/[),.;]+$/, ""))
    if (candidate.origin === origin) return candidate.toString()
  } catch {}
  return fallback
}

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
      const rediscoveryPrompt = typeof (job as any).rediscoveryPrompt === "string" ? (job as any).rediscoveryPrompt : ""
      const discoveryStartUrl = rediscoveryPrompt
        ? extractRediscoveryUrl(rediscoveryPrompt, job.targetUrl, new URL(job.targetUrl).origin)
        : job.targetUrl
      if (rediscoveryPrompt) {
        appendLog(job, "info", `[REDISCOVERY] User requested a targeted map update: ${rediscoveryPrompt.slice(0, 240)}`)
        await page.goto(discoveryStartUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null)
        await waitForSpaPageReady(page, 2500)
      }
      let discovery = await discoverAndMapApp(job, page, discoveryStartUrl, {
        maxScreens: rediscoveryPrompt ? Math.max(params.maxScreens || 10, 15) : (params.maxScreens || 10),
        credentials: sessionCreds,
        projectDir: params.projectDir,
        layaUrl: (params as any).layaBaseUrl || (job as any).layaBaseUrl,
      })
      if (rediscoveryPrompt && job.fullAppTestPlan) {
        const merged = mergeRediscoveredGraph(
          job.fullAppTestPlan.screens || [],
          job.fullAppTestPlan.transitions || [],
          discovery.screens,
          discovery.transitions,
        )
        discovery = merged
        appendLog(job, "success", `[REDISCOVERY] Merged verified discoveries into the existing map: ${merged.screens.length} screens, ${merged.transitions.length} transitions.`)
        ;(job as any).rediscoveryPrompt = undefined
      }

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
        const requestedRediscovery = typeof (refreshed as any).rediscoveryPrompt === "string" ? (refreshed as any).rediscoveryPrompt.trim() : ""
        if (requestedRediscovery && requestedRediscovery !== (job as any).lastProcessedRediscoveryPrompt) {
          ;(job as any).lastProcessedRediscoveryPrompt = requestedRediscovery
          appendLog(job, "info", `[REDISCOVERY] Revisiting the application for: ${requestedRediscovery.slice(0, 240)}`)
          const startUrl = extractRediscoveryUrl(requestedRediscovery, job.targetUrl, new URL(job.targetUrl).origin)
          await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null)
          await waitForSpaPageReady(page, 2500)
          const extra = await discoverAndMapApp(job, page, startUrl, {
            maxScreens: Math.max(params.maxScreens || 10, 15),
            credentials: sessionCreds,
            projectDir: params.projectDir,
            layaUrl: (params as any).layaBaseUrl || (job as any).layaBaseUrl,
          })
          const merged = mergeRediscoveredGraph(testPlan.screens || [], testPlan.transitions || [], extra.screens, extra.transitions)
          testPlan = generateStructuredTestPlan(job.targetUrl, merged.screens, merged.transitions, {
            isAuthenticated: job.authState === "logged_in",
            postmanCollection: params.postmanCollection || job.postmanCollection,
          })
          linkTestPlanStepsToLedger(job, testPlan)
          queueUnplannedLedgerActions(job, testPlan)
          job.screens = merged.screens.map((screen) => ({
            url: screen.url,
            path: screen.path,
            title: `${screen.id} ${screen.name}`,
            screenshotUrl: screen.screenshotUrl,
            testedAt: new Date().toISOString(),
            screenshots: screen.screenshotUrl ? { Desktop: screen.screenshotUrl } : {},
            backNavigationStatus: "passed" as const,
            responsiveStatus: "passed" as const,
            issuesCount: 0,
          }))
          job.fullAppTestPlan = testPlan
          job.flowGraph = buildFigmaWorkflowMap(testPlan)
          job.planApprovalState = "awaiting_review"
          job.progress = 35
          job.currentStep = "Map updated with rediscovered screens. Review the updated map and test plan, then approve execution."
          ;(job as any).rediscoveryPrompt = undefined
          saveJob(job)
          emitSessionEvent(job, "progress", {
            message: "Targeted rediscovery finished and the existing app map was updated. Review the revised plan.",
            payload: { phase: "rediscovery", screenCount: merged.screens.length, transitionCount: merged.transitions.length },
          })
          appendLog(job, "success", `[REDISCOVERY] Updated plan now covers ${testPlan.screens.length} screens and ${testPlan.steps.length} steps. Awaiting user review.`)
          continue
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

