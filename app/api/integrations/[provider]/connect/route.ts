import { randomBytes } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  getProviderConfig,
  oauthCookieOptions,
  stateCookieName,
  type RepositoryProvider,
} from "@/lib/integrations/repository-connections"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const user = await requireUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Sign in to Open Design AI before connecting a repository account." }, { status: 401 })

  const { provider: rawProvider } = await context.params
  if (rawProvider !== "github" && rawProvider !== "gitlab") {
    return NextResponse.json({ error: "Unsupported repository provider." }, { status: 404 })
  }
  const provider = rawProvider as RepositoryProvider
  const config = getProviderConfig(provider)
  if (!config.clientId || !config.clientSecret) {
    return NextResponse.json({
      error: `${provider === "github" ? "GitHub" : "GitLab"} OAuth is not configured. Add the client ID and secret to the server environment.`,
    }, { status: 503 })
  }

  const state = randomBytes(32).toString("base64url")
  const callback = new URL(config.callbackPath, request.nextUrl.origin)
  const authorize = new URL(config.authorizeUrl)
  authorize.searchParams.set("client_id", config.clientId)
  authorize.searchParams.set("redirect_uri", callback.toString())
  authorize.searchParams.set("state", state)

  if (provider === "github") {
    authorize.searchParams.set("scope", "read:user repo")
  } else {
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("scope", "read_user read_repository write_repository api")
  }

  const response = NextResponse.redirect(authorize)
  response.cookies.set(stateCookieName(provider), `${state}.${user.id}`, oauthCookieOptions(10 * 60))
  return response
}
