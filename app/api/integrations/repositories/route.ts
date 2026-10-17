import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  decryptConnection,
  tokenCookieName,
  providerBaseUrl,
  type RepositoryProvider,
} from "@/lib/integrations/repository-connections"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const user = await requireUser().catch(() => null)
  if (!user) return NextResponse.json({ connected: false, repositories: [], error: "Sign in to Open Design AI to access connected repositories." }, { status: 401 })
  const rawProvider = request.nextUrl.searchParams.get("provider")
  if (rawProvider !== "github" && rawProvider !== "gitlab") {
    return NextResponse.json({ error: "Choose github or gitlab as the provider." }, { status: 400 })
  }
  const provider = rawProvider as RepositoryProvider
  const connection = decryptConnection<{ accessToken: string; username?: string; connectedAt: number; userId: string }>(
    request.cookies.get(tokenCookieName(provider))?.value
  )
  if (!connection || connection.userId !== user.id) {
    return NextResponse.json({ connected: false, repositories: [], error: "This provider is not connected. Reconnect it in Settings." }, { status: 401 })
  }

  try {
    const baseUrl = providerBaseUrl(provider)
    const url = provider === "github"
      ? "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
      : `${baseUrl}/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at`
    const response = await fetch(url, {
      headers: provider === "github"
        ? { Authorization: `Bearer ${connection.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }
        : { Authorization: `Bearer ${connection.accessToken}` },
      cache: "no-store",
    })
    if (!response.ok) {
      const status = response.status
      if (status === 401 || status === 403) {
        return NextResponse.json({ connected: false, repositories: [], error: "The provider rejected access. Reconnect the account and verify its repository permissions." }, { status: 502 })
      }
      return NextResponse.json({ connected: true, repositories: [], error: `Repository provider returned status ${status}.` }, { status: 502 })
    }
    const data = await response.json()
    const repositories = (Array.isArray(data) ? data : []).map((repo: Record<string, any>) => ({
      id: String(repo.id),
      name: String(repo.name || repo.path || "Untitled repository"),
      fullName: String(repo.full_name || repo.path_with_namespace || repo.name || ""),
      private: Boolean(repo.private ?? repo.visibility === "private"),
      defaultBranch: String(repo.default_branch || repo.default_branch_name || "main"),
      url: String(repo.html_url || repo.web_url || ""),
      cloneUrl: String(repo.clone_url || repo.http_url_to_repo || ""),
      updatedAt: String(repo.updated_at || repo.last_activity_at || ""),
    }))
    return NextResponse.json({
      connected: true,
      provider,
      username: connection.username || "",
      repositories,
    })
  } catch (error) {
    console.error("Repository listing failed", { provider, error })
    return NextResponse.json({ connected: true, repositories: [], error: "Could not load repositories. Check your connection and retry." }, { status: 502 })
  }
}
