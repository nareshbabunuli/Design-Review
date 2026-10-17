import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  oauthCookieOptions,
  stateCookieName,
  tokenCookieName,
  type RepositoryProvider,
} from "@/lib/integrations/repository-connections"

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const user = await requireUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Sign in to Open Design AI to disconnect this provider." }, { status: 401 })
  const { provider: rawProvider } = await context.params
  if (rawProvider !== "github" && rawProvider !== "gitlab") {
    return NextResponse.json({ error: "Unsupported repository provider." }, { status: 404 })
  }
  const provider = rawProvider as RepositoryProvider
  const response = NextResponse.json({ success: true, provider })
  response.cookies.set(tokenCookieName(provider), "", oauthCookieOptions(0))
  response.cookies.set(stateCookieName(provider), "", oauthCookieOptions(0))
  return response
}
