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
  allowActions: string[] = []
): { tier: SafetyTier; reason?: string } {
  const text = (label || "").trim()
  if (!text) return { tier: "allow" }
  if (HARD_KEYWORDS.test(text)) {
    return { tier: "hard_block", reason: `Payment/checkout action "${text}" is hard-blocked` }
  }
  const allow = new Set(allowActions.map((a) => a.toLowerCase().trim()))
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
 * Aborts state-changing requests to payment hosts (always) and email-provider hosts
 * (unless "send" is allowlisted). GETs pass so payment SDK scripts still load and the
 * page renders; only the money/email-moving calls are stopped.
 * ponytail: host lists are static; extend PAYMENT_HOSTS/EMAIL_HOSTS when a target uses another provider.
 */
export async function installNetworkGuard(
  page: Page,
  opts: { allowActions?: string[]; onBlocked?: (url: string, reason: string) => void } = {}
): Promise<void> {
  const allowSend = (opts.allowActions || []).map((a) => a.toLowerCase()).includes("send")
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
    if (mutating && matchesAny(host, PAYMENT_HOSTS)) reason = "payment host"
    else if (mutating && !allowSend && matchesAny(host, EMAIL_HOSTS)) reason = "email provider"
    if (reason) {
      opts.onBlocked?.(req.url(), reason)
      req.abort("blockedbyclient").catch(() => {})
      return
    }
    req.continue().catch(() => {})
  })
}
