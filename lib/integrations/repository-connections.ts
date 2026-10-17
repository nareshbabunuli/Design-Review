import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

export type RepositoryProvider = "github" | "gitlab"

const TOKEN_COOKIE: Record<RepositoryProvider, string> = {
  github: "odai_github_connection",
  gitlab: "odai_gitlab_connection",
}

const STATE_COOKIE: Record<RepositoryProvider, string> = {
  github: "odai_github_oauth_state",
  gitlab: "odai_gitlab_oauth_state",
}

function encryptionKey() {
  const secret = process.env.REPOSITORY_CONNECTION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("Repository connections are not configured. Set REPOSITORY_CONNECTION_SECRET to a random secret of at least 32 characters.")
  }
  // Hash the configured secret into a fixed-size AES-256 key.
  return createHash("sha256").update(secret, "utf8").digest()
}

export function tokenCookieName(provider: RepositoryProvider) {
  return TOKEN_COOKIE[provider]
}

export function stateCookieName(provider: RepositoryProvider) {
  return STATE_COOKIE[provider]
}

export function encryptConnection(value: { accessToken: string; username?: string; connectedAt: number; userId: string }) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}

export function decryptConnection<T extends { accessToken: string }>(value?: string): T | null {
  if (!value) return null
  try {
    const bytes = Buffer.from(value, "base64url")
    if (bytes.length < 29) return null
    const iv = bytes.subarray(0, 12)
    const tag = bytes.subarray(12, 28)
    const encrypted = bytes.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as T
  } catch {
    return null
  }
}

export function oauthCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  }
}

export function getProviderConfig(provider: RepositoryProvider) {
  if (provider === "github") {
    return {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      callbackPath: "/api/integrations/github/callback",
    }
  }
  return {
    clientId: process.env.GITLAB_OAUTH_CLIENT_ID,
    clientSecret: process.env.GITLAB_OAUTH_CLIENT_SECRET,
    authorizeUrl: `${(process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "")}/oauth/authorize`,
    tokenUrl: `${(process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "")}/oauth/token`,
    callbackPath: "/api/integrations/gitlab/callback",
  }
}

export function providerBaseUrl(provider: RepositoryProvider) {
  return provider === "gitlab"
    ? (process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "")
    : "https://api.github.com"
}
