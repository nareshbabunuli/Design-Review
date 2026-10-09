import type { HTTPRequest, Page } from "puppeteer"

/**
 * Tiered safety guard for autonomous UI testing.
 *  - hard_block: payment / checkout actions. Never executed, never allowlisted.
 *  - soft_skip:  destructive or outbound actions (delete, send, invite...). Skipped unless allowlisted per run.
 *  - allow:      everything else.
 */
export type SafetyTier = "hard_block" | "soft_skip" | "allow"

const HARD_KEYWORDS =
  /\b(pay(\s+now)?|purchase|buy\s+now|checkout|check\s+out|place\s+(my\s+)?order|complete\s+(purchase|order)|confirm\s+payment|add\s+payment)\b/i

/** Soft keywords keyed by the token a user puts in `allowActions` to permit them. */
const SOFT_KEYWORDS: Record<string, RegExp> = {
  delete: /\b(delete|destroy|erase|purge)\b/i,
  remove: /\bremove\b/i,
  deactivate: /\b(deactivate|disable\s+account|close\s+account|terminate)\b/i,
  unsubscribe: /\bunsubscribe\b/i,
  send: /\b(send|resend|submit\s+message)\b/i,
  invite: /\binvite\b/i,
  logout: /\b(log\s*out|sign\s*out|log\s*off)\b/i,
}

const PAYMENT_HOSTS = [
  /(^|\.)stripe\.com$/i,
  /(^|\.)paypal\.com$/i,
  /(^|\.)braintreegateway\.com$/i,
  /(^|\.)adyen\.com$/i,
  /(^|\.)squareup\.com$/i,
  /(^|\.)razorpay\.com$/i,
  /(^|\.)checkout\.com$/i,
  /(^|\.)paddle\.com$/i,
]

const EMAIL_HOSTS = [
  /(^|\.)sendgrid\.(com|net)$/i,
  /(^|\.)mailgun\.(net|org)$/i,
  /(^|\.)postmarkapp\.com$/i,
  /(^|\.)mandrillapp\.com$/i,
  /(^|\.)sparkpost\.com$/i,
  /(^|\.)resend\.com$/i,
]

export function classifyAction(
  label: string,
  allowActions: string[] = [],
  options?: { isProduction?: boolean; allowTestPayments?: boolean }
): { tier: SafetyTier; reason?: string } {
  const text = (label || "").trim()
  if (!text) return { tier: "allow" }

  const allow = new Set(allowActions.map((a) => a.toLowerCase().trim()))
  const isPaymentPermitted =
    options?.allowTestPayments === true ||
    (options?.allowTestPayments !== false &&
      (options?.isProduction === false ||
        allow.has("pay") ||
        allow.has("payment") ||
        allow.has("checkout")))

  if (HARD_KEYWORDS.test(text)) {
    if (isPaymentPermitted) {
      return { tier: "allow" }
    }
    return {
      tier: "hard_block",
      reason: `Payment/checkout action "${text}" is hard-blocked in production. To test in staging/dev or allow payments, add "pay" to allowActions or enable test payments.`,
    }
  }

  for (const [token, re] of Object.entries(SOFT_KEYWORDS)) {
    if (re.test(text) && !allow.has(token)) {
      return {
        tier: "soft_skip",
        reason: `"${text}" looks destructive/outbound (${token}). Add "${token}" to allowActions to test it.`,
      }
    }
  }
  return { tier: "allow" }
}

/** True when the target host does not look like a local / staging / test environment. */
export function isProductionLike(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
    return !/(^|[.-])(staging|stage|dev|develop|test|testing|qa|preview|sandbox|uat)([.-]|$)/.test(host) &&
      !host.endsWith(".local")
  } catch {
    return false
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function matchesAny(host: string, list: RegExp[]) {
  return list.some((re) => re.test(host))
}

/**
 * Aborts state-changing requests to payment hosts (in production) and email-provider hosts
 * (unless "send" is allowlisted). In test environments or when payment testing is permitted,
 * mutating payment calls pass so sandbox payment gateways can be verified.
 */
export async function installNetworkGuard(
  page: Page,
  opts: {
    allowActions?: string[]
    allowTestPayments?: boolean
    isProduction?: boolean
    onBlocked?: (url: string, reason: string) => void
  } = {}
): Promise<void> {
  const allow = new Set((opts.allowActions || []).map((a) => a.toLowerCase().trim()))
  const allowSend = allow.has("send")
  const allowPay =
    opts.allowTestPayments ||
    allow.has("pay") ||
    allow.has("payment") ||
    allow.has("checkout") ||
    opts.isProduction === false

  await page.setRequestInterception(true)
  page.on("request", (req: HTTPRequest) => {
    if (req.isInterceptResolutionHandled()) return
    let host = ""
    try {
      host = new URL(req.url()).hostname
    } catch {
      req.continue().catch(() => {})
      return
    }
    const mutating = !SAFE_METHODS.has(req.method().toUpperCase())
    let reason = ""
    if (mutating && !allowPay && matchesAny(host, PAYMENT_HOSTS)) reason = "payment host"
    else if (mutating && !allowSend && matchesAny(host, EMAIL_HOSTS)) reason = "email provider"
    if (reason) {
      opts.onBlocked?.(req.url(), reason)
      req.abort("blockedbyclient").catch(() => {})
      return
    }
    req.continue().catch(() => {})
  })
}
