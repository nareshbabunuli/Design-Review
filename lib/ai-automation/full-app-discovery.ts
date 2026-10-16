import type { Page } from "puppeteer"
import {
  AutomationJob,
  AppScreenNode,
  AppWorkflowTransition,
  AgentAction,
} from "./types"
import { saveJob, getJob, appendLog, emitSessionEvent } from "./job-store"
import { discoverLocalProjectRoutes, matchRouteForPath } from "./discover-routes"
import { getJobSecrets } from "./job-secret-vault"
import { classifyPage, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
import { normalizePath, deriveScreenName } from "./full-app-utils"
import { humanClick, humanMouseMove } from "./human-actions"
import { maskPageSecretsBeforeScreenshot, secretRedactor } from "./secure-credentials-manager"
import { extractActionableInventory } from "./full-app-inventory"
import { mergeScreenActionsIntoLedger } from "./full-app-planner"

export async function takeSecureScreenshot(page: Page, options: { type: "jpeg"; quality: number }): Promise<Buffer> {
  const unmask = await maskPageSecretsBeforeScreenshot(page)
  try {
    return (await page.screenshot(options)) as Buffer
  } finally {
    await unmask()
  }
}

/** Publish the real Puppeteer action so the live mirror and cursor overlay follow the same session. */
export async function publishLiveAction(
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
export async function publishLiveFrame(job: AutomationJob, page: Page): Promise<void> {
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

export type LoginCreds = { username?: string; password?: string }

/** Waits for single-page applications (React/Next/Expo/SPA) to hydrate past initial splash/loading screens. */
export async function waitForSpaPageReady(page: Page, timeoutMs = 4000): Promise<void> {
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
export async function hasLoginWall(page: Page): Promise<boolean> {
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
export async function attemptLogin(job: AutomationJob, page: Page, creds: LoginCreds): Promise<boolean> {
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

export async function collectLinks(
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
export async function collectLinksWithExpansion(
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
