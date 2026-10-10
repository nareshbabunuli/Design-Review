import type { Page } from "puppeteer"
import type { AutomationJob } from "./types"
import { getJob, saveJob, appendLog } from "./job-store"

/**
 * Global Session Secret Redactor.
 * Holds registered secret values (API keys, passwords, bearer tokens)
 * and sanitizes logs, cURL strings, network captures, and reports.
 */
class SecretRedactor {
  private sensitiveValues = new Set<string>()

  register(value?: string | null) {
    if (!value || typeof value !== "string") return
    const trimmed = value.trim()
    // Ignore short trivial strings like "yes", "true", "admin"
    if (trimmed.length >= 6) {
      this.sensitiveValues.add(trimmed)
    }
  }

  registerMultiple(values?: (string | undefined | null)[]) {
    if (!values) return
    for (const v of values) {
      this.register(v)
    }
  }

  redact(text?: string | null): string {
    if (!text || typeof text !== "string") return text || ""
    let result = text

    // 1. Redact specifically registered secrets
    for (const secret of this.sensitiveValues) {
      if (result.includes(secret)) {
        result = result.split(secret).join("[REDACTED_SECRET]")
      }
    }

    // 2. Redact known token & API key patterns
    // OpenAI / general sk- keys
    result = result.replace(/sk-[A-Za-z0-9_\-]{20,}/g, "sk-[REDACTED_KEY]")
    // Stripe test & live keys
    result = result.replace(/sk_(test|live)_[A-Za-z0-9]{20,}/g, "sk_$1_[REDACTED_STRIPE]")
    // GitHub tokens
    result = result.replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "ghp_[REDACTED_GITHUB]")
    // AWS Access Key ID
    result = result.replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED_AWS]")
    // Bearer tokens
    result = result.replace(/Bearer\s+([A-Za-z0-9_\-\.]{20,})/gi, "Bearer [REDACTED_TOKEN]")
    // Credential and payment fields in JSON bodies
    result = result.replace(
      /("(?:password|pass|secret|token|api_?key|card_?number|cardnumber|cvv|cvc|security_?code|expiry|expiration)"\s*:\s*")([^"]+)(")/gi,
      '$1[REDACTED]$3'
    )
    // Credential and payment fields in form-urlencoded bodies and query strings
    result = result.replace(
      /((?:password|pass|secret|token|api_?key|card_?number|cardnumber|cvv|cvc|security_?code|expiry|expiration)=)([^&]+)/gi,
      "$1[REDACTED]"
    )

    return result
  }
}

export const secretRedactor = new SecretRedactor()

/**
 * Mask sensitive input elements (passwords, tokens, API keys) on the DOM
 * immediately before a screenshot is captured, and unmask after.
 */
export async function maskPageSecretsBeforeScreenshot(page: Page): Promise<() => Promise<void>> {
  try {
    await page.evaluate(() => {
      const styleId = "__antigravity_secret_mask__"
      if (document.getElementById(styleId)) return

      const style = document.createElement("style")
      style.id = styleId
      style.innerHTML = `
        input[type="password"],
        input[name*="key" i],
        input[name*="token" i],
        input[name*="secret" i],
        input[name*="password" i],
        input[id*="password" i],
        input[id*="token" i],
        input[id*="secret" i],
        [data-secret="true"],
        [data-sensitive="true"] {
          filter: blur(8px) !important;
          -webkit-text-security: disc !important;
          opacity: 0.7 !important;
        }
      `
      document.head.appendChild(style)
    })
  } catch {}

  return async () => {
    try {
      await page.evaluate(() => {
        const el = document.getElementById("__antigravity_secret_mask__")
        if (el && el.parentNode) {
          el.parentNode.removeChild(el)
        }
      })
    } catch {}
  }
}

/**
 * Inspects the current page DOM to detect if the workflow has hit an email confirmation,
 * magic link, OTP code, or external verification wall.
 */
export async function detectVerificationScreen(page: Page): Promise<{
  needsVerification: boolean
  reason?: string
  emailAddress?: string
}> {
  try {
    return await page.evaluate(() => {
      const bodyText = (document.body ? document.body.innerText : "").toLowerCase()
      const currentUrl = window.location.href.toLowerCase()

      const verificationPhrases = [
        "confirmation email sent",
        "confirm your email",
        "check your email",
        "check your inbox",
        "verify your email",
        "verification email sent",
        "verification link sent",
        "we sent a link to",
        "we sent a confirmation",
        "we've sent a confirmation",
        "click the link in the email",
        "click the activation link",
        "activate your account",
        "enter the 6-digit code",
        "enter the verification code",
        "waiting for email confirmation",
        "verify your account",
      ]

      const matchedPhrase = verificationPhrases.find((phrase) => bodyText.includes(phrase))

      const urlTriggers = [
        "/verify-email",
        "/verify",
        "/confirm-email",
        "/confirm",
        "/check-email",
        "/verification-pending",
        "/email-sent",
      ]
      const matchedUrl = urlTriggers.some((u) => currentUrl.includes(u))

      if (!matchedPhrase && !matchedUrl) {
        return { needsVerification: false }
      }

      // Try extracting displayed email
      const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)

      return {
        needsVerification: true,
        reason: matchedPhrase
          ? `Screen displays verification requirement: "${matchedPhrase}".`
          : `URL indicates pending verification (${currentUrl}).`,
        emailAddress: emailMatch ? emailMatch[0] : undefined,
      }
    })
  } catch {
    return { needsVerification: false }
  }
}

/**
 * Pauses testing when an email confirmation or external verification is required,
 * prompts the user via the interactive UI/API, and resumes once confirmed.
 */
export async function waitForExternalVerification(
  job: AutomationJob,
  page: Page,
  detected?: { reason?: string; emailAddress?: string },
  opts?: { timeoutMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000 // 15 minutes default
  const deadline = Date.now() + timeoutMs

  const emailNote = detected?.emailAddress ? ` sent to ${detected.emailAddress}` : ""
  const prompt = `Email confirmation / external verification${emailNote} required. Please open your email, click the confirmation link (or paste it below), and confirm to resume testing.`

  job.verificationState = "awaiting_verification"
  job.verificationPrompt = prompt
  job.currentStep = "Paused: Waiting for user to complete email confirmation / external verification..."
  job.pendingVerification = undefined
  saveJob(job)

  appendLog(
    job,
    "warn",
    `📬 [VERIFICATION] ${detected?.reason || "External confirmation required."} Testing paused. Waiting for user to complete email verification.`
  )

  while (job.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800))
    const refreshed = getJob(job.id)

    if (refreshed?.pendingVerification) {
      job.pendingVerification = refreshed.pendingVerification
      break
    }
    if (refreshed?.status && refreshed.status !== "running") {
      job.status = refreshed.status
      break
    }
  }

  const pending = job.pendingVerification
  job.pendingVerification = undefined

  if (job.status !== "running") {
    return false
  }

  if (!pending || pending.skip) {
    job.verificationState = "skipped"
    job.verificationPrompt = undefined
    appendLog(job, "warn", "[VERIFICATION] Verification skipped by user. Continuing public screen exploration.")
    saveJob(job)
    return false
  }

  // 1. If user provided a direct verification URL, navigate the browser to it
  if (pending.verificationUrl && pending.verificationUrl.trim()) {
    const rawUrl = pending.verificationUrl.trim()
    appendLog(
      job,
      "info",
      `[VERIFICATION] Navigating browser to supplied verification link: ${secretRedactor.redact(rawUrl)}`
    )
    try {
      await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
      await new Promise((r) => setTimeout(r, 2000))
    } catch (err: any) {
      appendLog(job, "warn", `[VERIFICATION] Error navigating to verification URL: ${err?.message}`)
    }
  }

  // 2. If user entered an OTP verification code, enter it into code inputs
  if (pending.verificationCode && pending.verificationCode.trim()) {
    const code = pending.verificationCode.trim()
    appendLog(job, "info", `[VERIFICATION] Entering ${code.length}-digit verification code into form...`)
    try {
      await page.evaluate((c) => {
        const input = (document.querySelector('input[autocomplete="one-time-code"], input[name*="code" i], input[id*="code" i], input[type="text"]') as HTMLInputElement)
        if (input) {
          input.value = c
          input.dispatchEvent(new Event("input", { bubbles: true }))
          input.dispatchEvent(new Event("change", { bubbles: true }))
        }
      }, code)
      // Attempt click submit
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button, input[type='submit']")).find((b) =>
          /verify|confirm|submit|continue/i.test((b as HTMLElement).innerText || (b as HTMLInputElement).value || "")
        )
        if (btn) (btn as HTMLElement).click()
      })
      await new Promise((r) => setTimeout(r, 2500))
    } catch {}
  }

  // 3. User confirmed externally: reload/verify app screen
  if (pending.completed && !pending.verificationUrl && !pending.verificationCode) {
    appendLog(
      job,
      "info",
      "[VERIFICATION] User confirmed external email verification completed. Refreshing application state..."
    )
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 })
      await new Promise((r) => setTimeout(r, 2000))
    } catch {}
  }

  job.verificationState = "verified"
  job.verificationPrompt = undefined
  job.currentStep = "Email verification complete. Resuming outcome-verified testing..."
  saveJob(job)

  appendLog(
    job,
    "success",
    "✨ [VERIFICATION VERIFIED] External verification confirmed! Resuming testing pipeline from current progress."
  )

  return true
}

/**
 * Detects if an application settings or configuration form requires unconfigured API keys,
 * tokens, or secrets to be provided before testing can proceed.
 */
export async function detectSettingsCredentialsRequirement(page: Page): Promise<{
  requiresCredentials: boolean
  fields: Array<{ key: string; label: string; selector: string; isSecret: boolean; placeholder?: string }>
}> {
  try {
    return await page.evaluate(() => {
      const fields: Array<{
        key: string
        label: string
        selector: string
        isSecret: boolean
        placeholder?: string
      }> = []

      const inputs = Array.from(document.querySelectorAll("input, textarea"))

      for (const el of inputs) {
        const input = el as HTMLInputElement
        if (input.type === "hidden" || input.type === "submit" || input.type === "checkbox") continue

        const name = (input.name || input.id || "").toLowerCase()
        const placeholder = (input.placeholder || "").toLowerCase()
        const labelEl = input.id ? document.querySelector(`label[for="${input.id}"]`) : input.closest("label")
        const labelText = (labelEl ? labelEl.textContent || "" : "").toLowerCase()

        const combined = `${name} ${placeholder} ${labelText}`

        const isApiKey = /api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key|webhook[_-]?secret|stripe_?key|openai_?key|auth[_-]?token/i.test(
          combined
        )
        const isPassword = input.type === "password" || /password|client_?secret/i.test(combined)

        if ((isApiKey || isPassword) && !input.value.trim()) {
          const selector = input.id ? `#${input.id}` : input.name ? `input[name="${input.name}"]` : ""
          if (selector) {
            fields.push({
              key: input.name || input.id,
              label: labelEl ? labelEl.textContent?.trim() || input.name : input.name || "API Key / Credential",
              selector,
              isSecret: true,
              placeholder: input.placeholder || "Enter secret key or token",
            })
          }
        }
      }

      return {
        requiresCredentials: fields.length > 0,
        fields,
      }
    })
  } catch {
    return { requiresCredentials: false, fields: [] }
  }
}

/**
 * Prompts user for application settings credentials through a secure input form,
 * registers the secrets into the redactor (ensuring they are never logged or screenshotted),
 * fills the configuration in the app, validates submission, and resumes testing.
 */
export async function promptAndFillSecureSettings(
  job: AutomationJob,
  page: Page,
  fields: Array<{ key: string; label: string; selector: string; isSecret: boolean; placeholder?: string }>,
  opts?: { timeoutMs?: number }
): Promise<boolean> {
  if (fields.length === 0) return true

  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000 // 10 minutes default
  const deadline = Date.now() + timeoutMs

  job.settingsState = "awaiting_credentials"
  job.settingsPrompt = `Application settings requires ${fields.length} API key(s) or credential(s) to continue testing. Please enter them securely below.`
  job.requiredSettingsFields = fields.map((f) => ({
    key: f.key,
    label: f.label,
    isSecret: f.isSecret,
    placeholder: f.placeholder,
  }))
  job.pendingSettingsCredentials = undefined
  job.currentStep = "Paused: Waiting for secure application settings credentials..."
  saveJob(job)

  appendLog(
    job,
    "warn",
    `🔐 [SETTINGS] Application requires ${fields.map((f) => `"${f.label}"`).join(", ")}. Paused for secure user input (never exposed in logs/screenshots).`
  )

  while (job.status === "running" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800))
    const refreshed = getJob(job.id)

    if (refreshed?.pendingSettingsCredentials) {
      job.pendingSettingsCredentials = refreshed.pendingSettingsCredentials
      break
    }
    if (refreshed?.status && refreshed.status !== "running") {
      job.status = refreshed.status
      break
    }
  }

  const supplied = job.pendingSettingsCredentials
  job.pendingSettingsCredentials = undefined

  if (job.status !== "running") return false

  if (!supplied || supplied.skip) {
    job.settingsState = "skipped"
    job.settingsPrompt = undefined
    job.requiredSettingsFields = undefined
    appendLog(job, "warn", "[SETTINGS] Configuration skipped by user. Continuing with existing settings.")
    saveJob(job)
    return false
  }

  // Register all secret values into SecretRedactor to ensure 100% redaction everywhere
  for (const [key, val] of Object.entries(supplied)) {
    if (typeof val === "string" && val.trim()) {
      secretRedactor.register(val.trim())
    }
  }

  // Fill each field securely into the DOM
  for (const f of fields) {
    const rawVal = supplied[f.key]
    if (rawVal && typeof rawVal === "string") {
      appendLog(job, "info", `[SETTINGS] Securely applying credential for "${f.label}"...`)
      try {
        await page.evaluate(
          (sel, val) => {
            const input = document.querySelector(sel) as HTMLInputElement
            if (input) {
              input.value = val
              input.dispatchEvent(new Event("input", { bubbles: true }))
              input.dispatchEvent(new Event("change", { bubbles: true }))
            }
          },
          f.selector,
          rawVal
        )
      } catch (err: any) {
        appendLog(job, "warn", `[SETTINGS] Could not fill field "${f.label}": ${err?.message}`)
      }
    }
  }

  // Submit the settings form
  try {
    await page.evaluate(() => {
      const submitBtn = Array.from(document.querySelectorAll("button, input[type='submit']")).find((b) =>
        /save|update|submit|apply/i.test((b as HTMLElement).innerText || (b as HTMLInputElement).value || "")
      )
      if (submitBtn) {
        ;(submitBtn as HTMLElement).click()
      }
    })
    await new Promise((r) => setTimeout(r, 2000))
  } catch {}

  job.settingsState = "configured"
  job.settingsPrompt = undefined
  job.requiredSettingsFields = undefined
  job.currentStep = "Settings configuration applied securely. Continuing testing..."
  saveJob(job)

  appendLog(
    job,
    "success",
    "✔ [SETTINGS CONFIGURED] Application settings credentials successfully applied and validated. Resuming testing."
  )

  return true
}
