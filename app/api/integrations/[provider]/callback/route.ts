import { NextRequest, NextResponse } from "next/server"
import {
  encryptConnection,
  getProviderConfig,
  oauthCookieOptions,
  stateCookieName,
  tokenCookieName,
  type RepositoryProvider,
} from "@/lib/integrations/repository-connections"

type OAuthParams = { params: Promise<{ provider: string }> }

export async function GET(request: NextRequest, context: OAuthParams) {
  const { provider: rawProvider } = await context.params
  if (rawProvider !== "github" && rawProvider !== "gitlab") {
    return NextResponse.json({ error: "Unsupported repository provider." }, { status: 404 })
  }
  const provider = rawProvider as RepositoryProvider
  const origin = request.nextUrl.origin
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/?settings=integrations&connection_error=${encodeURIComponent(reason)}`, origin))

  const expectedState = request.cookies.get(stateCookieName(provider))?.value
  const receivedState = request.nextUrl.searchParams.get("state")
  if (!expectedState || !receivedState || expectedState !== receivedState) {
    return fail("OAuth state validation failed. Please try connecting again.")
  }
  if (request.nextUrl.searchParams.get("error")) {
    return fail("Authorization was cancelled or denied.")
  }

  const code = request.nextUrl.searchParams.get("code")
  if (!code) return fail("The provider did not return an authorization code.")

  const config = getProviderConfig(provider)
  if (!config.clientId || !config.clientSecret) return fail("OAuth credentials are not configured on the server.")
  const callbackUrl = new URL(config.callbackPath, origin).toString()

  try {
    const body = provider === "github"
      ? { client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callbackUrl }
      : { client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code", redirect_uri: callbackUrl }

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    const tokenData = await tokenResponse.json()
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Repository OAuth token exchange failed", { provider, status: tokenResponse.status })
      return fail("Could not exchange the authorization code. Check the OAuth app callback URL and credentials.")
    }

    const accessToken = String(tokenData.access_token)
    const profileUrl = provider === "github"
      ? "https://api.github.com/user"
      : `${(process.env.GITLAB_BASE_URL || "https://gitlab.com").replace(/\/$/, "")}/api/v4/user`
    const profileResponse = await fetch(profileUrl, {
      headers: provider === "github"
        ? { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
        : { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
    if (!profileResponse.ok) {
      console.error("Repository OAuth profile lookup failed", { provider, status: profileResponse.status })
      return fail("Authorization succeeded but the account could not be verified.")
    }
    const profile = await profileResponse.json()
    const cookieValue = encryptConnection({
      accessToken,
      username: String(profile.login || profile.username || profile.name || ""),
      connectedAt: Date.now(),
    })
    const response = NextResponse.redirect(new URL("/?settings=integrations&connection=connected", origin))
    response.cookies.set(tokenCookieName(provider), cookieValue, oauthCookieOptions(60 * 60 * 24 * 30))
    response.cookies.set(stateCookieName(provider), "", oauthCookieOptions(0))
    return response
  } catch (error) {
    console.error("Repository OAuth callback failed", { provider, error })
    return fail("Connection failed unexpectedly. Please retry and check the server logs.")
  }
}
