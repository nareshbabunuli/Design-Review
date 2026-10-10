import fs from "fs"
import path from "path"
import os from "os"
import puppeteer, { type Browser, type Page } from "puppeteer"
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
} from "./types"
import { saveJob, getJob, appendLog } from "./job-store"
import { discoverLocalProjectRoutes } from "./discover-routes"

import {
  SYNTHETIC_TEST_DATA,
  normalizePath,
  deriveScreenName,
  buildFigmaWorkflowMap,
  synthesizeFullAppPlanFromJob,
  isFullAppCommand,
} from "./full-app-utils"
import { classifyAction, isProductionLike, installNetworkGuard } from "./safety-guard"
import {
  expectFor,
  captureState,
  settle,
  classifyEffect,
  runWithLadder,
  verifyModalCloseAndFocus,
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
import {
  installVisualOverlay,
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
 * Extracts complete inventory of actionable elements on the active page
 */
export async function extractActionableInventory(page: Page): Promise<{
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
  return await page.evaluate(() => {
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
    const h1 = document.querySelector("h1, h2, header h2")
    const heading = h1 ? (h1.textContent || "").trim() : ""

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
        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : undefined,
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
        selector: el.id ? `#${el.id}` : el.name ? `select[name="${el.name}"]` : undefined,
        options: options.slice(0, 8),
        formId,
      })
    })

    // 7. Tabs, Radios & Toggles
    document.querySelectorAll("[role='tab'], [role='switch'], .toggle, [data-tab]").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const txt = (el.textContent || el.getAttribute("aria-label") || "Tab / Toggle").trim()
      if (!txt) return

      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: txt,
        type: el.getAttribute("role") === "tab" ? "tab" : "toggle",
        selector: el.id ? `#${el.id}` : undefined,
        formId,
      })
    })

    // 8. Buttons & Clickable Triggers
    document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const rawText = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim()
      if (!rawText && !el.querySelector("svg, img")) return

      // Skip dangerous session terminating logout buttons during exploration
      if (/(logout|sign out|log off|delete account)/i.test(rawText)) return

      const cleanText = rawText.replace(/\s+/g, " ").slice(0, 40) || "Action Button"
      const parentForm = el.closest("form, [data-form], .form") as HTMLElement | null
      const formId = parentForm ? (parentForm.id || (parentForm as any).dataset?.formTestId || undefined) : undefined

      elements.push({
        id: `elem-${elementCounter++}`,
        name: cleanText,
        type: "button",
        selector: el.id ? `#${el.id}` : undefined,
        formId,
      })
    })

    // 9. Custom clickable / accessibility controls
    // Native buttons/links are already covered above. This catches common
    // React/Vue/custom controls such as <div onClick>, role=button/link,
    // keyboard-focusable elements, and aria-controls-driven triggers.
    const customInteractiveSelector =
      '[onclick], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [aria-controls], [tabindex]:not([tabindex="-1"])'
    document.querySelectorAll(customInteractiveSelector).forEach((el: any) => {
      const tag = (el.tagName || '').toLowerCase()
      if (["button", "a", "input", "select", "textarea", "option"].includes(tag)) return

      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const rawText = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim()
      if (!rawText && !el.getAttribute("aria-controls")) return
      if (/(logout|sign out|log off|delete account)/i.test(rawText)) return

      const name = rawText.replace(/\s+/g, " ").slice(0, 40) || el.getAttribute("aria-controls") || "Custom Action"
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

      const selector = el.id
        ? "#" + el.id
        : el.getAttribute("data-testid")
        ? "[data-testid=\"" + el.getAttribute("data-testid") + "\"]"
        : undefined
      const actionKey = [
        type,
        window.location.pathname,
        name.toLowerCase(),
        href || "",
        el.getAttribute("aria-controls") || "",
      ].join("|")

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
    // 10. Semantic UI objects (media/cards/galleries) that may be interactive
    // A UI object can be actionable without being a native button or anchor.
    // Detect strong semantic signals, but do not click every image/div blindly.
    const semanticObjectSelector =
      'img, video, [class*="card" i], [class*="tile" i], [class*="gallery" i], [class*="thumbnail" i], [class*="avatar" i], [class*="carousel" i], [data-testid], [data-cy], [data-action]'
    const semanticSeen = new Set<string>()
    document.querySelectorAll(semanticObjectSelector).forEach((el: any) => {
      const tag = (el.tagName || '').toLowerCase()
      if (["button", "a", "input", "select", "textarea", "option"].includes(tag)) return
      // Prefer the containing card/gallery object over its child thumbnail.
      if ((tag === "img" || tag === "video") && el.closest('[class*="card" i], [class*="tile" i], [class*="gallery" i], [class*="carousel" i], [data-action]')) return

      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const text = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || "")
        .trim().replace(/\s+/g, " ").slice(0, 60)
      const className = typeof el.className === "string" ? el.className : ""
      const identity = [el.id || "", el.getAttribute("data-testid") || el.getAttribute("data-cy") || "", className].join("|")
      const hasMedia = Boolean(el.matches("img, video") || el.querySelector("img, video, picture, source"))
      const hasSemanticName = /(video|image|photo|gallery|avatar|profile|product|card|tile|thumbnail|carousel|media|preview|attachment)/i.test(identity + " " + text)
      const hasActionSignal = Boolean(
        el.hasAttribute("onclick") ||
        el.hasAttribute("data-action") ||
        el.hasAttribute("aria-controls") ||
        el.getAttribute("role") === "button" ||
        el.getAttribute("role") === "link" ||
        style.cursor === "pointer" ||
        el.tabIndex >= 0
      )
      const repeatedObject = Boolean(el.parentElement && Array.from(el.parentElement.children).filter((child: any) => {
        const childClass = typeof child.className === "string" ? child.className : ""
        return child !== el && childClass && className && childClass === className
      }).length >= 1)

      // Strong signals are enough; media/card semantics alone are only a candidate
      // when combined with a second signal such as repetition or pointer behavior.
      const reasons: string[] = []
      if (hasMedia) reasons.push("contains media")
      if (hasSemanticName) reasons.push("semantic media/card naming")
      if (hasActionSignal) reasons.push("DOM interaction signal")
      if (repeatedObject) reasons.push("repeated UI object")
      if (!hasActionSignal && !(hasMedia && (hasSemanticName || repeatedObject))) return

      const confidence = Math.min(0.99,
        0.45 +
        (hasMedia ? 0.15 : 0) +
        (hasSemanticName ? 0.12 : 0) +
        (hasActionSignal ? 0.20 : 0) +
        (repeatedObject ? 0.08 : 0)
      )
      const type = /video/i.test(identity + " " + text) ? "clickable" :
        /gallery|carousel/i.test(identity + " " + text) ? "clickable" :
        /avatar|profile/i.test(identity + " " + text) ? "clickable" :
        "clickable"
      const name = text || (hasMedia ? (tag === "video" ? "Video" : "Image") : "Interactive Card")
      const hrefAttr = el.getAttribute("href") || undefined
      let href: string | undefined
      try { href = hrefAttr ? new URL(hrefAttr, window.location.href).href : undefined } catch { href = hrefAttr }
      const selector = el.id
        ? "#" + el.id
        : el.getAttribute("data-testid")
        ? "[data-testid=\\\"" + el.getAttribute("data-testid") + "\\\"]"
        : el.getAttribute("data-cy")
        ? "[data-cy=\\\"" + el.getAttribute("data-cy") + "\\\"]"
        : undefined
      const actionKey = [
        "semantic",
        window.location.pathname,
        type,
        name.toLowerCase(),
        href || "",
        el.getAttribute("aria-controls") || "",
        el.getAttribute("data-testid") || el.getAttribute("data-cy") || className,
      ].join("|")
      if (semanticSeen.has(actionKey)) return
      semanticSeen.add(actionKey)

      elements.push({
        id: `elem-${elementCounter++}`,
        name,
        type,
        selector,
        href,
        actionKey,
        interactionConfidence: Number(confidence.toFixed(2)),
        discoveryReason: reasons,
        isInteractive: true,
      })
    })

    // 9. Links & Navigation
    document.querySelectorAll("a[href]").forEach((el: any) => {
      const style = window.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || el.offsetWidth <= 2 || el.offsetHeight <= 2) return

      const href = el.getAttribute("href") || ""
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return
      if (/(logout|signout)/i.test(href)) return

      const text = (el.textContent || el.getAttribute("title") || href).trim().replace(/\s+/g, " ").slice(0, 40)
      if (!text) return

      const absoluteHref = (() => {
        try {
          return new URL(href, window.location.href).href
        } catch {
          return href
        }
      })()
      const normalizedHref = absoluteHref.split("#")[0]
      const actionKey = [
        "link",
        window.location.pathname,
        text.toLowerCase(),
        normalizedHref,
      ].join("|")

      elements.push({
        id: `elem-${elementCounter++}`,
        name: text,
        type: "link",
        selector: el.id ? `#${el.id}` : `a[href="${href}"]`,
        href: absoluteHref,
        actionKey,
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
}

/**
 * Systematically discovers all reachable screens in the application,
 * generating screen nodes with unique IDs (S001, S002, ...) and action transitions.
 */
type LoginCreds = { username?: string; password?: string }

/** True when a visible password field is on the page (login wall). */
async function hasLoginWall(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const pw = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]
      return pw.some((p) => p.offsetParent !== null)
    })
    .catch(() => false)
}

/** Types creds into the login form, submits, returns true when the password field is gone. */
async function attemptLogin(page: Page, creds: LoginCreds): Promise<boolean> {
  try {
    const filled = await page.evaluate((u, p) => {
      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(
        (x) => x.offsetParent !== null
      )
      if (!pw) return false
      const scope = pw.closest("form") || document
      const user = (Array.from(
        scope.querySelectorAll('input[type="email"], input[type="text"], input[name*="user" i], input[name*="email" i], input:not([type])')
      ) as HTMLInputElement[]).find((x) => x.offsetParent !== null)
      const setVal = (el: HTMLInputElement, v: string) => {
        el.focus()
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter ? setter.call(el, v) : (el.value = v)
        el.dispatchEvent(new Event("input", { bubbles: true }))
        el.dispatchEvent(new Event("change", { bubbles: true }))
      }
      if (user && u) setVal(user, u)
      setVal(pw, p)
      return true
    }, creds.username || "", creds.password || "")
    if (!filled) return false

    const clicked = await page.evaluate(() => {
      const pw = (Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[]).find(
        (x) => x.offsetParent !== null
      )
      const scope = (pw && pw.closest("form")) || document
      const btns = Array.from(scope.querySelectorAll('button, input[type="submit"]')) as HTMLElement[]
      const btn =
        btns.find((b) => /sign\s*in|log\s*in|login|continue|submit/i.test((b.textContent || (b as any).value || "").trim())) ||
        btns.find((b) => (b as HTMLButtonElement).type === "submit") ||
        btns[0]
      if (!btn) return false
      btn.click()
      return true
    })
    if (!clicked) await page.keyboard.press("Enter")

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null),
      new Promise((r) => setTimeout(r, 8000)),
    ])
    await new Promise((r) => setTimeout(r, 1200))
    return !(await hasLoginWall(page))
  } catch {
    return false
  }
}

/**
 * Handles a login wall: uses provided creds if any, otherwise pauses the job and
 * waits for the UI to supply them (or skip). Returns true when logged in.
 */
async function authenticateIfNeeded(job: AutomationJob, page: Page, creds?: LoginCreds): Promise<boolean> {
  let active: LoginCreds | undefined = creds && creds.password ? creds : undefined

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!active) {
      job.authState = "awaiting_credentials"
      job.authPrompt =
        attempt === 0
          ? "Login required. Enter test credentials to continue testing the authenticated app, or skip."
          : "Login failed with those credentials. Try again or skip."
      job.pendingCredentials = undefined
      job.currentStep = "Waiting for login credentials..."
      appendLog(job, "warn", "[AUTH] Login wall detected and no credentials available - waiting for user input.")
      saveJob(job)

      const deadline = Date.now() + 10 * 60 * 1000
      while (!job.pendingCredentials && job.status === "running" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500))
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

    secretRedactor.registerMultiple([active.username, active.password])
    appendLog(job, "info", "[AUTH] Typing provided test credentials and submitting the login form...")
    job.authPrompt = undefined
    job.currentStep = "Logging in with provided credentials..."
    saveJob(job)

    if (await attemptLogin(page, active)) {
      if (creds) Object.assign(creds, { username: active.username, password: active.password })
      job.authState = "logged_in"
      job.authPrompt = undefined
      appendLog(job, "success", `[AUTH] Logged in. Now at ${secretRedactor.redact(page.url())}`)
      saveJob(job)
      return true
    }

    job.authState = "login_failed"
    appendLog(job, "error", "[AUTH] Login failed - password field still present after submit.")
    saveJob(job)
    active = undefined
  }
  job.authState = "skipped"
  saveJob(job)
  return false
}

async function collectLinks(page: Page, origin: string): Promise<Array<{ text: string; href: string }>> {
  return page.evaluate((org: string) => {
    const list: Array<{ text: string; href: string }> = []
    const seen = new Set<string>()
    document.querySelectorAll("a[href]").forEach((a: any) => {
      try {
        const full = a.href
        if (
          full.startsWith(org) &&
          !full.includes("#") &&
          !full.includes("mailto:") &&
          !/(logout|signout|delete|leave)/i.test(full)
        ) {
          const norm = full.split("?")[0].replace(/\/$/, "") || full
          if (!seen.has(norm)) {
            seen.add(norm)
            list.push({ text: (a.textContent || norm).trim().slice(0, 30), href: full })
          }
        }
      } catch {}
    })
    return list
  }, origin)
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
    .filter((entry) => entry.status === "untested" && (!onlyScreenId || entry.screenId === onlyScreenId))
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

export async function discoverAndMapApp(
  job: AutomationJob,
  page: Page,
  baseUrl: string,
  options: { maxScreens?: number; credentials?: LoginCreds } = {}
): Promise<{
  screens: AppScreenNode[]
  transitions: AppWorkflowTransition[]
}> {
  const maxLimit = options.maxScreens || 10
  const screens: AppScreenNode[] = []
  const transitions: AppWorkflowTransition[] = []
  const origin = new URL(baseUrl).origin
  const pathScreenMap = new Map<string, string>() // normalized path -> screenId (e.g. S001)

  appendLog(job, "info", "Starting Phase 1: Systematic Application Discovery & Mapping...")
  job.testingPhase = "discovery"
  job.currentStep = "Phase 1: Discovering and mapping application screens..."
  saveJob(job)

  let screenSeq = 1

  // Records the page's current state as a screen (reuses ID if path already known).
  const mapCurrentScreen = async (forceNew = false): Promise<{ id: string; isNew: boolean }> => {
    const curPath = normalizePath(page.url(), origin)
    if (!forceNew) {
      const known = pathScreenMap.get(curPath)
      if (known) return { id: known, isNew: false }
    }

    const inv = await extractActionableInventory(page)
    const id = `S${String(screenSeq++).padStart(3, "0")}`
    let shot = ""
    try {
      const buf = await takeSecureScreenshot(page, { type: "jpeg", quality: 75 })
      shot = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
    } catch {}
    const node: AppScreenNode = {
      id,
      name: deriveScreenName(curPath, inv.heading, inv.modalTitle),
      url: page.url(),
      path: curPath,
      screenshotUrl: shot || undefined,
      actionableElements: inv.actionableElements,
      forms: inv.forms,
      discoveredAt: new Date().toISOString(),
    }
    screens.push(node)
    pathScreenMap.set(curPath, id)
    mergeScreenActionsIntoLedger(job, node)
    saveJob(job)
    appendLog(
      job,
      "success",
      `[DISCOVERY] Screen ${node.id}: "${node.name}" (${node.path}) mapped with ${node.actionableElements.length} actionable elements.`
    )
    return { id, isNew: true }
  }

  const addTransition = (from: string, to: string, action: string, actionType: AppWorkflowTransition["actionType"]) => {
    if (transitions.some((t) => t.fromScreenId === from && t.toScreenId === to && t.action === action)) return
    transitions.push({ id: `tr-${transitions.length + 1}`, fromScreenId: from, toScreenId: to, action, actionType })
  }

  // Map starting screen
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
      const post = await mapCurrentScreen(true)
      addTransition(root.id, post.id, "Submit Login Form", "form_submit")
      startId = post.id
    }
  } else {
    job.authState = "none"
  }

  // BFS over internal links: every newly mapped screen contributes its own links
  type Cand = { from: string; text: string; href: string }
  const queue: Cand[] = (await collectLinks(page, origin)).map((c) => ({ from: startId, ...c }))

  try {
    const fsRoutes = discoverLocalProjectRoutes(baseUrl)
    for (const r of fsRoutes) queue.push({ from: startId, text: r.path, href: r.url })
  } catch {}

  const visitedHrefs = new Set<string>()
  while (queue.length > 0 && screens.length < maxLimit && job.status === "running") {
    const cand = queue.shift()!
    const candPath = normalizePath(cand.href, origin)

    const known = pathScreenMap.get(candPath)
    if (known) {
      if (known !== cand.from) addTransition(cand.from, known, `Navigate to ${cand.text || candPath}`, "navigation")
      continue
    }
    if (visitedHrefs.has(candPath)) continue
    visitedHrefs.add(candPath)

    try {
      appendLog(job, "info", `[DISCOVERY] Navigating to: ${secretRedactor.redact(cand.href)}...`)
      await page.goto(cand.href, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null)
      await new Promise((r) => setTimeout(r, 600))

      // Session expired / redirected to login mid-crawl: re-auth once if we have a session
      if (job.authState === "logged_in" && (await hasLoginWall(page))) {
        appendLog(job, "warn", "[AUTH] Redirected to login mid-crawl - skipping protected route.")
        continue
      }

      const here = await mapCurrentScreen()
      addTransition(cand.from, here.id, `Click ${cand.text || candPath}`, "click")
      if (here.isNew) {
        const more = await collectLinks(page, origin)
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
        const list: Array<{ name: string; selector?: string }> = []
        document.querySelectorAll('[role="tab"], [data-tab], nav button, aside button, .tab, .tab-btn').forEach((el: any) => {
          const txt = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")
          if (txt && txt.length < 35 && !/(logout|sign\s*out|log\s*off|delete)/i.test(txt)) {
            list.push({
              name: txt,
              selector: el.id ? `#${el.id}` : el.getAttribute("data-tab") ? `[data-tab="${el.getAttribute("data-tab")}"]` : undefined,
            })
          }
        })
        return list
      })

      for (const tab of spaTabs) {
        if (screens.length >= maxLimit || job.status !== "running") break
        try {
          const clicked = await page.evaluate((target) => {
            const findEl = (sel?: string) => {
              if (!sel || !sel.trim()) return null
              try { return document.querySelector(sel) } catch { return null }
            }
            const el = (findEl(target.selector) ||
              Array.from(document.querySelectorAll('[role="tab"], [data-tab], nav button, aside button, .tab, .tab-btn, button')).find((b: any) =>
                (b.textContent || "").trim().toLowerCase().includes(target.name.toLowerCase())
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
              const tabNode: AppScreenNode = {
                id: tabScreenId,
                name: screenHeading,
                url: page.url(),
                path: `${normalizePath(page.url(), origin)}#${encodeURIComponent(tab.name.toLowerCase().replace(/\s+/g, "-"))}`,
                screenshotUrl: shot || undefined,
                actionableElements: inv.actionableElements,
                forms: inv.forms,
                discoveredAt: new Date().toISOString(),
              }
              screens.push(tabNode)
              mergeScreenActionsIntoLedger(job, tabNode)
              saveJob(job)
              addTransition(startId, tabNode.id, `Switch to "${tab.name}" Tab`, "click")
              appendLog(
                job,
                "success",
                `[DISCOVERY] Screen ${tabNode.id}: "${tabNode.name}" (SPA Tab) mapped with ${tabNode.actionableElements.length} actionable elements.`
              )
            }
          }
        } catch {}
      }
    } catch {}
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
    // If this screen was a pre-auth login wall and we are already authenticated:
    if (screen.isLoginWall && options?.isAuthenticated) {
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "verify",
        targetName: "User Authentication",
        expectedResult: "User is successfully authenticated and redirected to application dashboard.",
        actualResult: "Authentication passed with provided test credentials.",
        status: "passed",
      })
      continue
    }

    // Track which forms are handled so we avoid loose duplicate steps for their inputs/submits
    const handledFormIds = new Set<string>()

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
      (el) => el.type === "input" && (!el.formId || !handledFormIds.has(el.formId))
    )
    for (const input of standaloneInputs) {
      let syntheticVal = SYNTHETIC_TEST_DATA.fullName
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
      (el) => el.type === "button" && (!el.formId || !handledFormIds.has(el.formId))
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

  for (let i = 0; i < testPlan.steps.length; i++) {
    const step = testPlan.steps[i]

    // Pre-verified steps (e.g. login authentication verified during discovery)
    if (step.status === "passed") {
      passedCount++
      testedScreensSet.add(step.screenId)
      appendLog(job, "success", `[EXECUTE ${i + 1}/${testPlan.steps.length}] ${step.screenId} ${step.screenName} -> ${step.targetName}: PASSED`)
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
        const targetBasePath = targetScreen.path.split("#")[0]
        if (!page.url().includes(targetBasePath)) {
          await page.goto(targetScreen.url, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null)
          await new Promise((r) => setTimeout(r, 400))
        }

        // Discovery assigns a synthetic #tab-name path to SPA views. The URL
        // alone cannot restore those views, so reactivate the matching tab before
        // testing its child controls. Modal states are kept open by queue priority.
        const stateMarker = targetScreen.path.split("#")[1]
        if (stateMarker && !stateMarker.startsWith("modal-")) {
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

      // 2. Perform Action & Verify
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

          // Click submit
          await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return
            const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])') as HTMLElement | null
            if (submit) {
              submit.click()
            } else if (typeof form.requestSubmit === "function") {
              form.requestSubmit()
            } else {
              form.submit()
            }
          }, formSel)

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
          // Fill valid dummy data for normal fields, invalid for email/phone
          await page.evaluate((sel, testData) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return
            form.querySelectorAll("input, textarea").forEach((field: any) => {
              const type = (field.type || "").toLowerCase()
              const name = (field.name || field.id || "").toLowerCase()

              if (type === "email" || name.includes("email")) {
                field.value = "invalid-email-format"
              } else if (type === "tel" || name.includes("phone")) {
                field.value = "not-a-valid-phone-number"
              } else if (type === "checkbox" || type === "radio") {
                field.checked = true
              } else if (type !== "submit" && type !== "button" && type !== "hidden") {
                field.value = testData.fullName || "Jane Doe"
              }
              field.dispatchEvent(new Event("input", { bubbles: true }))
              field.dispatchEvent(new Event("change", { bubbles: true }))
            })
          }, formSel, SYNTHETIC_TEST_DATA)

          if (formSel) {
            await highlightInputTyping(page, `${formSel} input:not([type="hidden"])`, "[Invalid Format Check]")
          }

          // Click submit
          await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return
            const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])') as HTMLElement | null
            if (submit) {
              submit.click()
            } else if (typeof form.requestSubmit === "function") {
              form.requestSubmit()
            } else {
              form.submit()
            }
          }, formSel)

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

          // Fill missing/invalid fields with synthetic data (or use explicit API payload/test card).
          await page.evaluate(
            (sel, testData, payload, paymentCreds) => {
              const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
              if (!form) return

              form.querySelectorAll("input, textarea, select").forEach((field: any) => {
                const type = (field.type || "").toLowerCase()
                const name = (field.name || field.id || "").toLowerCase()
                const placeholder = (field.placeholder || "").toLowerCase()
                const existingValue = typeof field.value === "string" ? field.value.trim() : ""
                const sensitive = type === "password" || /password|passcode|secret|token|api[-_ ]?key|private[-_ ]?key|card|cvv|cvc|security code/i.test(name + " " + placeholder)

                if (payload && payload[field.name || field.id]) {
                  field.value = payload[field.name || field.id]
                  field.dispatchEvent(new Event("input", { bubbles: true }))
                  field.dispatchEvent(new Event("change", { bubbles: true }))
                  return
                }

                if (field.tagName.toLowerCase() === "select") {
                  // Keep a valid, already-selected option. Otherwise move off a
                  // placeholder option when a real option is available.
                  if (field.value && field.selectedIndex > 0 && field.checkValidity()) return
                  if (field.options && field.options.length > 1) {
                    field.selectedIndex = 1
                  } else if (field.options && field.options.length > 0) {
                    field.selectedIndex = 0
                  }
                  field.dispatchEvent(new Event("change", { bubbles: true }))
                  return
                }

                if (type === "checkbox" || type === "radio") {
                  field.checked = true
                  field.dispatchEvent(new Event("change", { bubbles: true }))
                  return
                }

                if (type === "submit" || type === "button" || type === "hidden" || type === "file") return

                // Preserve existing valid non-sensitive app data instead of
                // overwriting it with synthetic values on every submission.
                if (!sensitive && existingValue && field.checkValidity()) return

                // Payment card field auto-filling
                if (paymentCreds) {
                  if (
                    /card[-_]?num|credit[-_]?card|cc[-_]?num|card_number|cardnumber/i.test(name) ||
                    /card\s*number/i.test(placeholder)
                  ) {
                    field.value = paymentCreds.cardNumber || "4242 4242 4242 4242"
                    field.dispatchEvent(new Event("input", { bubbles: true }))
                    field.dispatchEvent(new Event("change", { bubbles: true }))
                    return
                  }
                  if (/cvv|cvc|security[-_]?code/i.test(name) || /cvv|cvc|security\s*code/i.test(placeholder)) {
                    field.value = paymentCreds.cvv || "123"
                    field.dispatchEvent(new Event("input", { bubbles: true }))
                    field.dispatchEvent(new Event("change", { bubbles: true }))
                    return
                  }
                  if (/exp|expiration|expiry/i.test(name) || /exp|mm\/yy/i.test(placeholder)) {
                    field.value = paymentCreds.expiryDate || "12/34"
                    field.dispatchEvent(new Event("input", { bubbles: true }))
                    field.dispatchEvent(new Event("change", { bubbles: true }))
                    return
                  }
                  if (/zip|postal/i.test(name) || /zip|postal/i.test(placeholder)) {
                    field.value = paymentCreds.zipCode || "90210"
                    field.dispatchEvent(new Event("input", { bubbles: true }))
                    field.dispatchEvent(new Event("change", { bubbles: true }))
                    return
                  }
                }

                if (type === "email" || /email/i.test(name) || /email/i.test(placeholder)) {
                  field.value = testData.email || "qa-test@example.com"
                } else if (type === "password" || /pass/i.test(name)) {
                  field.value = testData.password || "Password123!"
                } else if (type === "tel" || /phone/i.test(name)) {
                  field.value = testData.phone || "+15551234567"
                } else if (type === "number" || /amount|count|age|qty/i.test(name)) {
                  field.value = "10"
                } else if (type === "url" || /url|website/i.test(name)) {
                  field.value = "https://example.com"
                } else {
                  field.value = testData.fullName || "Jane Doe"
                }

                field.dispatchEvent(new Event("input", { bubbles: true }))
                field.dispatchEvent(new Event("change", { bubbles: true }))
              })
            },
            formSel,
            SYNTHETIC_TEST_DATA,
            step.fieldPayload || null,
            activePaymentCreds || null
          )

          if (formSel) {
            await highlightInputTyping(
              page,
              `${formSel} input:not([type="hidden"])`,
              activePaymentCreds ? "Test Card Loaded" : "Synthetic Data"
            )
          }
          await showActionBanner(page, `Submitting Form: "${step.targetName}"`)

          // Click submit
          await page.evaluate((sel) => {
            const form = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
            if (!form) return
            const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])') as HTMLElement | null
            if (submit) {
              submit.click()
            } else if (typeof form.requestSubmit === "function") {
              form.requestSubmit()
            } else {
              form.submit()
            }
          }, formSel)

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
        if (credentials?.password) {
          if (/pass/i.test(step.targetName)) inputVal = credentials.password
          else if (credentials.username && /e-?mail|user|login/i.test(step.targetName)) inputVal = credentials.username
        }
        const isSensitiveField = /password|passcode|secret|token|api[-_ ]?key|private[-_ ]?key|cvv|security code/i.test(step.targetName)
        const displayValue = isSensitiveField ? "[REDACTED]" : secretRedactor.redact(inputVal)
        await showActionBanner(page, `Type "${displayValue}" -> ${step.targetName}`)
        if (step.targetSelector) {
          await highlightInputTyping(page, step.targetSelector, displayValue)
        }
        const targetArg = { selector: step.targetSelector, name: step.targetName }
        const before = await captureState(page)
        const filled = await page.evaluate((target, val) => {
          const findEl = (sel?: string) => {
            if (!sel || !sel.trim()) return null
            try { return document.querySelector(sel) } catch { return null }
          }
          const el = (findEl(target.selector) ||
            Array.from(document.querySelectorAll("input, textarea")).find(
              (inp: any) =>
                (inp.placeholder && inp.placeholder.toLowerCase().includes(target.name.toLowerCase())) ||
                (inp.name && inp.name.toLowerCase().includes(target.name.toLowerCase())) ||
                (inp.id && inp.id.toLowerCase().includes(target.name.toLowerCase()))
            )) as HTMLInputElement | null
          if (!el) return false
          el.focus()
          el.value = val
          el.dispatchEvent(new Event("input", { bubbles: true }))
          el.dispatchEvent(new Event("change", { bubbles: true }))
          return true
        }, targetArg, inputVal)

        await settle(page, netRecorder, 1500)
        const after = await captureState(page)

        if (filled) {
          actionVerdict = "passed"
          observation = isSensitiveField
            ? `Filled sensitive field "${step.targetName}" (value redacted from evidence).`
            : `Typed synthetic value "${secretRedactor.redact(inputVal)}" into field "${step.targetName}".`
        } else {
          actionVerdict = "failed"
          observation = `Could not locate input field "${step.targetName}".`
        }

        step.evidence = {
          expectedEffects: ["value_changed", "content_changed"],
          observedEffect: filled ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 250,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
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
        await showActionBanner(page, `Select "${step.syntheticValue}" -> ${step.targetName}`)
        const targetArg = { selector: step.targetSelector, name: step.targetName }
        const selected = await page.evaluate((target, val) => {
          const findEl = (sel?: string) => {
            if (!sel || !sel.trim()) return null
            try { return document.querySelector(sel) } catch { return null }
          }
          const sel = (findEl(target.selector) || document.querySelector("select")) as HTMLSelectElement | null
          if (!sel) return false
          sel.focus()
          const opt = Array.from(sel.options).find((o) => o.text.includes(val) || o.value.includes(val))
          if (opt) {
            sel.value = opt.value
            sel.dispatchEvent(new Event("change", { bubbles: true }))
            return true
          }
          return false
        }, targetArg, step.syntheticValue || "")

        await settle(page, netRecorder, 1000)
        actionVerdict = selected ? "passed" : "failed"
        observation = selected ? `Selected option "${step.syntheticValue}".` : `Failed to select option.`

        step.evidence = {
          expectedEffects: ["value_changed", "content_changed"],
          observedEffect: selected ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 250,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
        }
      } else if (step.actionType === "toggle") {
        await showActionBanner(page, `Toggle "${step.targetName}"`)
        const targetArg = { selector: step.targetSelector, name: step.targetName }
        const toggled = await page.evaluate((target) => {
          const findEl = (sel?: string) => {
            if (!sel || !sel.trim()) return null
            try { return document.querySelector(sel) } catch { return null }
          }
          const el = (findEl(target.selector) ||
            Array.from(document.querySelectorAll('input[type="checkbox"], [role="switch"]')).find(
              (c: any) => c.name?.includes(target.name) || c.id?.includes(target.name)
            )) as HTMLInputElement | null
          if (!el) return false
          el.click()
          return true
        }, targetArg)

        await settle(page, netRecorder, 1000)
        actionVerdict = toggled ? "passed" : "failed"
        observation = toggled ? `Toggled state of "${step.targetName}".` : `Could not find toggle.`

        step.evidence = {
          expectedEffects: ["value_changed", "content_changed"],
          observedEffect: toggled ? "value_changed" : "no_effect",
          verdict: actionVerdict,
          reason: observation,
          retriesUsed: 0,
          settleDurationMs: 250,
          networkCalls: netRecorder.getCapturedCalls(),
          consoleErrors: consoleRecorder.getErrors(),
        }
      } else if (step.actionType === "click") {
        await showActionBanner(page, `Click "${step.targetName}"`)
        if (step.targetSelector) {
          const coords = await animateCursorToSelector(page, step.targetSelector)
          if (coords) {
            await triggerClickAnimation(page, coords.x, coords.y)
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
        actionVerdict = "passed"
        observation = step.actualResult || `Verified: ${step.expectedResult || step.targetName}`
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
        step.evidenceTimestamp = new Date().toISOString()
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
      const currentScreenName = deriveScreenName(currentNorm, newInv.heading, newInv.modalTitle)
      const hasActiveModal = Boolean(newInv.modalTitle)

      let currentScreen = testPlan.screens.find((screen) =>
        screen.path.split("#")[0] === currentNorm &&
        screen.name.trim().toLowerCase() === currentScreenName.trim().toLowerCase()
      )

      if (!currentScreen && !hasActiveModal) {
        currentScreen = testPlan.screens.find((screen) =>
          screen.path.split("#")[0] === currentNorm &&
          (!newInv.heading || screen.name.toLowerCase().includes(newInv.heading.toLowerCase()))
        )
      }

      if (!currentScreen) {
        const newScreenId = `S${String(testPlan.screens.length + 1).padStart(3, "0")}`
        currentScreen = {
          id: newScreenId,
          name: currentScreenName,
          url: currentUrl,
          path: hasActiveModal ? `${currentNorm}#modal-${encodeURIComponent((newInv.modalTitle || "dialog").toLowerCase().replace(/\\s+/g, "-"))}` : currentNorm,
          screenshotUrl: step.screenshotUrl,
          actionableElements: [],
          forms: [],
          isNewDiscovery: true,
          discoveredAt: new Date().toISOString(),
        }
        testPlan.screens.push(currentScreen)
        testPlan.transitions.push({
          id: `tr-${testPlan.transitions.length + 1}`,
          fromScreenId: step.screenId,
          toScreenId: newScreenId,
          action: `[NEW DISCOVERY] Triggered by ${step.targetName}`,
          actionType: hasActiveModal ? "modal_open" : "click",
        })
        appendLog(job, "success", `🌟 [NEW DISCOVERY] Found ${hasActiveModal ? "modal/view" : "screen"} ${newScreenId}: "${currentScreenName}" during test.`)
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
      mergeScreenActionsIntoLedger(job, resolvedScreen)
      linkTestPlanStepsToLedger(job, testPlan)
      const queuedNow = queueUnplannedLedgerActions(job, testPlan, resolvedScreen.id, i)
      if (queuedNow > 0) {
        appendLog(job, "info", `[COVERAGE] "${resolvedScreen.name}" now has ${resolvedScreen.actionableElements.length} known controls; ${queuedNow} new/unplanned action(s) queued for execution.`)
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

  // PHASE 5: Comprehensive Evidence Reporting & Markdown Artifact
  appendLog(job, "info", `Generating Phase 5: Evidence-Based Failure Report & Markdown Artifact...`)
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

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--hide-scrollbars",
        "--disable-extensions",
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })

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
      await videoRecorder.start()
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
    await new Promise((r) => setTimeout(r, 800))

    const sessionCreds: { username?: string; password?: string } = { ...(params.credentials || {}) }
    const discovery = await discoverAndMapApp(job, page, job.targetUrl, {
      maxScreens: params.maxScreens || 10,
      credentials: sessionCreds,
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
    const testPlan = generateStructuredTestPlan(job.targetUrl, discovery.screens, discovery.transitions, {
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
    })

    // Finalize session video recording
    if (videoRecorder) {
      const recUrl = await videoRecorder.stop(job)
      if (recUrl) {
        job.recordingUrl = recUrl
        if (job.report) job.report.recordingUrl = recUrl
      }
    }

    // Preserve an explicit incomplete-coverage failure from the execution phase.
    if (job.status === "failed" || job.fullAppTestPlan?.status === "error") {
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
    }
    job.status = "failed"
    job.error = secretRedactor.redact(err?.message || "Execution exception occurred during Full App Testing")
    job.finishedAt = new Date().toISOString()
    appendLog(job, "error", `Fatal Full App Testing failure: ${job.error}`)
    saveJob(job)
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
  }
}

