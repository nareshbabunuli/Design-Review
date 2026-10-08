/**
 * SSRF / unsafe-navigation guard for Puppeteer targets.
 * Blocks private networks, link-local, cloud metadata, and non-http(s) schemes.
 */

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local + AWS/GCP metadata
  /^\[::1\]$/,
  /^\[fc00:/i,
  /^\[fe80:/i,
  /^metadata\.google\.internal$/i,
  /^metadata$/i,
  /\.internal$/i,
  /\.local$/i,
]

const BLOCKED_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/169\.254\./i,
  /^https?:\/\/metadata\.google/i,
  /^https?:\/\/.*\.internal(\/|$)/i,
]

export class UrlGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UrlGuardError"
  }
}

/**
 * Validate and normalize a target URL for browser automation.
 * @param raw - User-supplied URL
 * @param allowedHosts - Optional allowlist of hostnames for this project
 * @returns Normalized href
 */
export function assertSafeTargetUrl(raw: string, allowedHosts?: string[]): string {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new UrlGuardError("Target URL is required")
  }

  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new UrlGuardError("Invalid URL format")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlGuardError("Only http:// and https:// URLs are allowed")
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "")

  for (const re of BLOCKED_HOST_PATTERNS) {
    if (re.test(hostname) || re.test(parsed.hostname)) {
      throw new UrlGuardError("This hostname is not allowed for automation (private/metadata network)")
    }
  }

  for (const re of BLOCKED_URL_PATTERNS) {
    if (re.test(parsed.href)) {
      throw new UrlGuardError("This URL is not allowed for automation")
    }
  }

  // Numeric IP that looks private (extra belt)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split(".").map(Number)
    const [a, b] = parts
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new UrlGuardError("Private IP addresses are not allowed as automation targets")
    }
  }

  if (allowedHosts && allowedHosts.length > 0) {
    const normalizedAllowed = allowedHosts.map((h) => h.toLowerCase().replace(/^www\./, ""))
    const hostNorm = hostname.toLowerCase().replace(/^www\./, "")
    if (!normalizedAllowed.includes(hostNorm)) {
      throw new UrlGuardError(
        `Hostname "${hostname}" is not in this project's allowed test URLs`
      )
    }
  }

  return parsed.href
}

/** Dev-only helper: allow localhost when NODE_ENV=development */
export function assertSafeTargetUrlWithDevBypass(
  raw: string,
  allowedHosts?: string[]
): string {
  if (process.env.NODE_ENV === "development" || process.env.ALLOW_LOCALHOST_TARGETS === "true") {
    try {
      const u = new URL(raw.trim())
      if (
        u.protocol === "http:" ||
        u.protocol === "https:"
      ) {
        // Still block cloud metadata even in dev
        if (/^169\.254\./.test(u.hostname) || /metadata\.google/i.test(u.hostname)) {
          throw new UrlGuardError("Cloud metadata URLs are never allowed")
        }
        if (allowedHosts?.length) {
          return assertSafeTargetUrl(raw, allowedHosts)
        }
        return u.href
      }
    } catch (e) {
      if (e instanceof UrlGuardError) throw e
    }
  }
  return assertSafeTargetUrl(raw, allowedHosts)
}
