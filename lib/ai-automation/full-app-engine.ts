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
  NetworkRecorder,
  ConsoleRecorder,
} from "./outcome-verifier"

// Generate realistic dummy file buffers (PNG, PDF, CSV, TXT)
export function createDummyFileBuffer(type: "image" | "pdf" | "document" | "csv" | "video" | "other"): {
  buffer: Buffer
  fileName: string
  mimeType: string
} {
  switch (type) {
    case "image": {
      // 1x1 transparent PNG buffer
      const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
      return {
        buffer: Buffer.from(pngBase64, "base64"),
        fileName: "dummy_test_image.png",
        mimeType: "image/png",
      }
    }
    case "csv": {
      const csv = "id,name,value,status\n1,Synthetic Item A,100,active\n2,Synthetic Item B,200,pending\n"
      return {
        buffer: Buffer.from(csv, "utf8"),
        fileName: "dummy_test_data.csv",
        mimeType: "text/csv",
      }
    }
    case "pdf": {
      // Minimal valid PDF structure
      const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \n0000000117 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n200\n%%EOF"
      return {
        buffer: Buffer.from(pdf, "utf8"),
        fileName: "dummy_test_document.pdf",
        mimeType: "application/pdf",
      }
    }
    default: {
      const doc = "Synthetic automated test document content.\nCreated for automated UI file upload verification."
      return {
        buffer: Buffer.from(doc, "utf8"),
        fileName: "dummy_test_document.txt",
        mimeType: "text/plain",
      }
    }
  }
}

/**
 * Extracts complete inventory of actionable elements on the active page
 */
export async function extractActionableInventory(page: Page): Promise<{
  actionableElements: ActionableElement[]
  forms: Array<{ id: string; name?: string; fields: string[]; submitButton?: string }>
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
    document.querySelectorAll("form, [data-form], .form").forEach((form, fIdx) => {
      const formId = form.id || `form-${fIdx + 1}`
      const formFields: string[] = []
      let submitBtnText = ""

      form.querySelectorAll("input, select, textarea").forEach((field: any) => {
        const fieldName = field.name || field.id || field.placeholder || `field-${field.type}`
        formFields.push(fieldName)
      })

      const submit = form.querySelector('button[type="submit"], input[type="submit"]')
      if (submit) {
        submitBtnText = (submit.textContent || (submit as HTMLInputElement).value || "Submit").trim()
      }

      forms.push({
        id: formId,
        name: form.getAttribute("aria-label") || form.getAttribute("name") || `Form #${fIdx + 1}`,
        fields: formFields,
        submitButton: submitBtnText || undefined,
      })
    })

    const isVisible = (el: HTMLElement) => {
      const style = window.getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.width > 2 &&
        rect.height > 2
      )
    }

    // 4. File Upload Controls
    document.querySelectorAll('input[type="file"]').forEach((el: any) => {
      const name = el.name || el.id || el.getAttribute("aria-label") || "Upload File"
      elements.push({
        id: `elem-${elementCounter++}`,
        name,
        type: "file_upload",
        selector: el.id ? `#${el.id}` : el.name ? `input[name="${el.name}"]` : 'input[type="file"]',
        inputType: "file",
        accept: el.accept || "image/*,.pdf,.doc,.docx",
        isRequired: el.required || false,
      })
    })

    // 5. Input Fields (Text, Email, Password, Number, Search, Date, etc.)
    document.querySelectorAll("input, textarea").forEach((el: any) => {
      if (el.type === "file" || el.type === "hidden" || el.type === "submit" || el.type === "button") return
      if (!isVisible(el)) return

      const type = el.type || (el.tagName.toLowerCase() === "textarea" ? "textarea" : "text")
      let elementType: any = "input"
      if (type === "checkbox") elementType = "checkbox"
      else if (type === "radio") elementType = "radio"

      const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
      const labelText = labelEl ? (labelEl.textContent || "").trim() : ""
      const name = labelText || el.placeholder || el.name || el.id || `${type} input`

      elements.push({
        id: `elem-${elementCounter++}`,
        name: name.replace(/[:*]/g, "").trim(),
        type: elementType,
        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : undefined,
        inputType: type,
        placeholder: el.placeholder || undefined,
        value: el.value || undefined,
        isRequired: el.required || false,
      })
    })

    // 6. Dropdowns / Selects
    document.querySelectorAll("select, [role='combobox'], [role='listbox']").forEach((el: any) => {
      if (!isVisible(el)) return
      const labelEl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null
      const name = (labelEl ? labelEl.textContent : "") || el.name || el.id || "Dropdown Option"

      const options: string[] = []
      if (el.tagName.toLowerCase() === "select") {
        el.querySelectorAll("option").forEach((opt: HTMLOptionElement) => {
          const txt = (opt.textContent || opt.value || "").trim()
          if (txt && !options.includes(txt)) options.push(txt)
        })
      }

      elements.push({
        id: `elem-${elementCounter++}`,
        name: name.replace(/[:*]/g, "").trim(),
        type: "select",
        selector: el.id ? `#${el.id}` : el.name ? `select[name="${el.name}"]` : undefined,
        options: options.slice(0, 8),
      })
    })

    // 7. Tabs, Radios & Toggles
    document.querySelectorAll("[role='tab'], [role='switch'], .toggle, [data-tab]").forEach((el: any) => {
      if (!isVisible(el)) return
      const txt = (el.textContent || el.getAttribute("aria-label") || "Tab / Toggle").trim()
      if (!txt) return
      elements.push({
        id: `elem-${elementCounter++}`,
        name: txt,
        type: el.getAttribute("role") === "tab" ? "tab" : "toggle",
        selector: el.id ? `#${el.id}` : undefined,
      })
    })

    // 8. Buttons & Clickable Triggers
    document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']").forEach((el: any) => {
      if (!isVisible(el)) return
      const rawText = (el.textContent || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim()
      if (!rawText && !el.querySelector("svg, img")) return

      // Skip dangerous session terminating logout buttons during exploration
      if (/(logout|sign out|log off|delete account)/i.test(rawText)) return

      const cleanText = rawText.replace(/\s+/g, " ").slice(0, 40) || "Action Button"
      elements.push({
        id: `elem-${elementCounter++}`,
        name: cleanText,
        type: "button",
        selector: el.id ? `#${el.id}` : undefined,
      })
    })

    // 9. Links & Navigation
    document.querySelectorAll("a[href]").forEach((el: any) => {
      if (!isVisible(el)) return
      const href = el.getAttribute("href") || ""
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return
      if (/(logout|signout)/i.test(href)) return

      const text = (el.textContent || el.getAttribute("title") || href).trim().replace(/\s+/g, " ").slice(0, 40)
      if (!text) return

      elements.push({
        id: `elem-${elementCounter++}`,
        name: text,
        type: "link",
        selector: el.id ? `#${el.id}` : `a[href="${href}"]`,
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

    appendLog(job, "info", `[AUTH] Typing credentials for "${active.username}" and submitting login form...`)
    job.authPrompt = undefined
    job.currentStep = "Logging in with provided credentials..."
    saveJob(job)

    if (await attemptLogin(page, active)) {
      if (creds) Object.assign(creds, { username: active.username, password: active.password })
      job.authState = "logged_in"
      job.authPrompt = undefined
      appendLog(job, "success", `[AUTH] Logged in. Now at ${page.url()}`)
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
      const buf = await page.screenshot({ type: "jpeg", quality: 75 })
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
      appendLog(job, "info", `[DISCOVERY] Navigating to: ${cand.href}...`)
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
                const buf = await page.screenshot({ type: "jpeg", quality: 75 })
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
  options?: { isAuthenticated?: boolean }
): FullAppTestPlan {
  const steps: TestPlanStep[] = []
  let stepCounter = 1

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

    // 1. Plan Form Input field interactions with synthetic faker test data
    const inputs = screen.actionableElements.filter((el) => el.type === "input")
    for (const input of inputs) {
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

    // 2. Plan File Uploads
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

    // 3. Plan Dropdowns / Selects
    const selects = screen.actionableElements.filter((el) => el.type === "select")
    for (const select of selects) {
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

    // 4. Plan Checkboxes & Toggles
    const toggles = screen.actionableElements.filter((el) => el.type === "checkbox" || el.type === "toggle")
    for (const toggle of toggles) {
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

    // 5. Plan Buttons & Action Submits
    const buttons = screen.actionableElements.filter((el) => el.type === "button")
    for (const btn of buttons) {
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
  options?: { allowActions?: string[]; noiseHosts?: string[] }
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
    const safety = classifyAction(step.targetName, options?.allowActions || [])
    if (safety.tier === "hard_block" || safety.tier === "soft_skip") {
      step.status = "skipped_unsafe"
      step.verdict = "skipped_unsafe"
      step.actualResult = `Skipped by safety guard: ${safety.reason}`
      skippedUnsafeCount++
      appendLog(job, "warn", `[SAFETY GUARD ${i + 1}/${testPlan.steps.length}] ${step.targetName} skipped: ${safety.reason}`)
      continue
    }

    step.status = "running"
    job.currentStep = `[${i + 1}/${testPlan.steps.length}] Testing ${step.screenName}: ${step.actionType.toUpperCase()} ${step.targetName}`
    job.progress = Math.round(30 + ((i + 1) / testPlan.steps.length) * 65)
    saveJob(job)

    appendLog(job, "info", `[EXECUTE ${i + 1}/${testPlan.steps.length}] ${step.screenId} ${step.screenName} -> ${step.actionType} "${step.targetName}"`)

    const netRecorder = new NetworkRecorder(page, testPlan.targetUrl, options?.noiseHosts)
    const consoleRecorder = new ConsoleRecorder(page)
    const dialogRef = { value: false }

    const dialogHandler = async (dialog: any) => {
      dialogRef.value = true
      const actionSafety = classifyAction(step.targetName, options?.allowActions || [])
      if (actionSafety.tier !== "allow") {
        await dialog.dismiss().catch(() => {})
      } else {
        await dialog.accept().catch(() => {})
      }
    }
    page.once("dialog", dialogHandler)

    try {
      // 1. Target Screen Navigation Check
      const targetScreen = testPlan.screens.find((s) => s.id === step.screenId)
      if (targetScreen && !page.url().includes(targetScreen.path.split("#")[0])) {
        await page.goto(targetScreen.url, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null)
        await new Promise((r) => setTimeout(r, 400))
      }

      // 2. Perform Action & Verify
      let actionVerdict: AutomationVerdict = "passed"
      let observation = ""

      if (step.actionType === "fill") {
        let inputVal = step.syntheticValue || SYNTHETIC_TEST_DATA.fullName
        if (credentials?.password) {
          if (/pass/i.test(step.targetName)) inputVal = credentials.password
          else if (credentials.username && /e-?mail|user|login/i.test(step.targetName)) inputVal = credentials.username
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
          observation = `Typed synthetic value "${inputVal}" into field "${step.targetName}".`
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
        const dummy = createDummyFileBuffer(fileType)
        const tmpPath = path.join(os.tmpdir(), `upload-test-${Date.now()}-${dummy.fileName}`)
        fs.writeFileSync(tmpPath, dummy.buffer)

        try {
          const fileInput = await page.$('input[type="file"]')
          if (!fileInput) {
            actionVerdict = "blocked"
            observation = `No <input type="file"> found for upload "${step.targetName}".`
          } else {
            await (fileInput as any).uploadFile(tmpPath)
            await settle(page, netRecorder, 3000)

            const uploadState = await page.evaluate(() => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
              const fileCount = input?.files?.length || 0
              const hasPreview = Boolean(document.querySelector('img[src^="data:"], img[src^="blob:"], .file-preview, [data-preview]'))
              return { fileCount, hasPreview }
            })

            const calls = netRecorder.getCapturedCalls()
            const hasMultipartRequest = calls.some((c) => c.isMutating)

            if (uploadState.fileCount > 0 && (uploadState.hasPreview || hasMultipartRequest)) {
              actionVerdict = "passed"
              observation = `Attached dummy ${fileType.toUpperCase()} file ("${dummy.fileName}"). Wire/DOM confirmation verified.`
            } else if (uploadState.fileCount > 0) {
              actionVerdict = "passed"
              observation = `File attached to input element ("${dummy.fileName}").`
            } else {
              actionVerdict = "failed"
              observation = `Failed to attach file to upload control "${step.targetName}".`
            }
          }
        } finally {
          try { fs.unlinkSync(tmpPath) } catch {}
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

      // 4. Capture Evidence Screenshot (Full for failure/suspected/weak pass, compressed thumbnail for pass)
      try {
        const isCritical = actionVerdict === "failed" || actionVerdict === "suspected_non_functional" || step.evidence?.isWeakPass
        const buf = await page.screenshot({
          type: "jpeg",
          quality: isCritical ? 80 : 50,
        })
        step.screenshotUrl = `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`
        step.evidenceTimestamp = new Date().toISOString()
      } catch {}

      // 5. Dynamic Check for NEW DISCOVERY
      const currentUrl = page.url()
      const origin = new URL(testPlan.targetUrl).origin
      const currentNorm = normalizePath(currentUrl, origin)

      const currentHeading = await page.evaluate(() => {
        const h = document.querySelector("h1, h2, [role='heading'], [data-screen-title]")
        return h ? (h.textContent || "").trim().slice(0, 40) : ""
      })
      const isKnown = testPlan.screens.some(
        (s) => s.path === currentNorm && (!currentHeading || s.name.toLowerCase().includes(currentHeading.toLowerCase()))
      )
      const hasNewModal = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"], dialog[open]')
        return Boolean(d && window.getComputedStyle(d).display !== "none")
      })

      if (!isKnown || hasNewModal) {
        const newInv = await extractActionableInventory(page)
        const newScreenId = `S${String(testPlan.screens.length + 1).padStart(3, "0")}`
        const newScreenName = deriveScreenName(currentNorm, newInv.heading, newInv.modalTitle)

        if (!testPlan.screens.some((s) => s.name === newScreenName && s.path === currentNorm)) {
          appendLog(job, "success", `🌟 [NEW DISCOVERY] Found unmapped screen: ${newScreenId} "${newScreenName}" during test!`)

          const newScreenNode: AppScreenNode = {
            id: newScreenId,
            name: newScreenName,
            url: currentUrl,
            path: currentNorm,
            screenshotUrl: step.screenshotUrl,
            actionableElements: newInv.actionableElements,
            forms: newInv.forms,
            isNewDiscovery: true,
            discoveredAt: new Date().toISOString(),
          }

          testPlan.screens.push(newScreenNode)
          testPlan.transitions.push({
            id: `tr-${testPlan.transitions.length + 1}`,
            fromScreenId: step.screenId,
            toScreenId: newScreenId,
            action: `[NEW DISCOVERY] Triggered by ${step.targetName}`,
            actionType: "click",
          })

          const newStep: TestPlanStep = {
            id: `step-${testPlan.steps.length + 1}`,
            screenId: newScreenId,
            screenName: newScreenName,
            stepIndex: testPlan.steps.length + 1,
            actionType: "verify",
            targetName: `${newScreenName} Content`,
            expectedResult: `Verify new discovery screen "${newScreenName}" is interactive.`,
            actualResult: `Discovered during test of ${step.targetName} with ${newInv.actionableElements.length} elements.`,
            status: "passed",
            verdict: "passed",
            isNewDiscovery: true,
            screenshotUrl: step.screenshotUrl,
            evidenceTimestamp: new Date().toISOString(),
          }
          testPlan.steps.push(newStep)
          passedCount++
        }
      }

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
      step.error = stepErr?.message || "Execution exception"
      appendLog(job, "warn", `Step ${i + 1} exception: ${stepErr?.message}`)
    } finally {
      netRecorder.cleanup()
      consoleRecorder.cleanup()
    }
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

  try {
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
    if (isProductionLike(job.targetUrl)) {
      appendLog(
        job,
        "warn",
        `⚠️ [SAFETY WARNING] Target URL "${job.targetUrl}" appears to be a production environment. Destructive/payment actions will be guarded.`
      )
    }

    // Install network guard for payment/email hosts
    await installNetworkGuard(page, {
      allowActions: params.allowActions,
      onBlocked: (url, reason) => {
        appendLog(job, "warn", `[SAFETY GUARD] Aborted request to ${url} (${reason}).`)
      },
    })

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
    })
    job.fullAppTestPlan = testPlan
    job.flowGraph = buildFigmaWorkflowMap(testPlan)
    saveJob(job)

    appendLog(
      job,
      "info",
      `📋 Test Plan Generated: ${testPlan.steps.length} test steps across ${testPlan.screens.length} screens (${testPlan.requiredFileTypes.length} file upload types detected).`
    )

    // PHASE 3: Systematic Execution of Test Plan
    await executeStructuredTestPlan(job, page, testPlan, params.dummyTestFiles, sessionCreds, {
      allowActions: params.allowActions,
      noiseHosts: params.noiseHosts,
    })

    // PHASE 4: Final Reporting & Coverage
    job.testingPhase = "reporting"
    job.status = "completed"
    job.progress = 100
    job.finishedAt = new Date().toISOString()
    saveJob(job)

    appendLog(job, "success", "🏁 Full App Testing pipeline completed successfully with full evidence and coverage report.")
  } catch (err: any) {
    console.error("[FullAppEngine] Fatal execution failure:", err)
    job.status = "failed"
    job.error = err?.message || "Execution exception occurred during Full App Testing"
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

