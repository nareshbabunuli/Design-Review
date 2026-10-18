import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  decryptConnection,
  encryptConnection,
  oauthCookieOptions,
  providerBaseUrl,
  refreshRepositoryConnection,
  tokenCookieName,
  type RepositoryConnection,
} from "@/lib/integrations/repository-connections"

export const dynamic = "force-dynamic"

type GitLabConnection = RepositoryConnection

type Check = { id: string; label: string; ok: boolean; detail: string }

function errorResponse(status: number, message: string) {
  return NextResponse.json({ ready: false, checks: [], error: message }, { status })
}

async function gitlabRequest(url: string, accessToken: string) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  })
}

/**
 * Safe preflight for the in-app GitLab Duo workflow. This never starts an agent
 * or writes to a repository; it only verifies the connected identity and the
 * Duo Agent Platform privilege endpoint.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser().catch(() => null)
  if (!user) return errorResponse(401, "Sign in before checking GitLab Duo readiness.")

  const connection = decryptConnection<GitLabConnection>(request.cookies.get(tokenCookieName("gitlab"))?.value)
  if (!connection || connection.userId !== user.id) {
    return errorResponse(401, "Connect GitLab in Settings → Third-Party Integrations first.")
  }

  const baseUrl = providerBaseUrl("gitlab")
  let activeConnection = connection
  let refreshedCookieValue: string | null = null

  try {
    const refreshed = await refreshRepositoryConnection("gitlab", connection)
    activeConnection = refreshed.connection
    if (refreshed.refreshed) refreshedCookieValue = encryptConnection(activeConnection)

    const [userResponse, privilegesResponse] = await Promise.all([
      gitlabRequest(`${baseUrl}/api/v4/user`, activeConnection.accessToken),
      gitlabRequest(`${baseUrl}/api/v4/ai/duo_workflows/workflows/agent_privileges`, activeConnection.accessToken),
    ])

    const checks: Check[] = [{
      id: "oauth",
      label: "GitLab OAuth connection",
      ok: userResponse.ok,
      detail: userResponse.ok
        ? "GitLab accepted the connected account token."
        : userResponse.status === 401
          ? "The token is expired or revoked. Reconnect GitLab in Settings."
          : `GitLab identity check returned HTTP ${userResponse.status}.`,
    }]

    let accountName = ""
    if (userResponse.ok) {
      const profile = await userResponse.json().catch(() => ({}))
      accountName = typeof profile.username === "string" ? profile.username : ""
    }

    let privileges: string[] = []
    let privilegesPayload: { all_privileges?: Array<{ name?: string }> } = {}
    if (privilegesResponse.ok) {
      privilegesPayload = await privilegesResponse.json().catch(() => ({}))
      privileges = (privilegesPayload.all_privileges || [])
        .map(item => item.name)
        .filter((name): name is string => typeof name === "string")
    }

    checks.push({
      id: "duo-api",
      label: "Duo Agent Platform API",
      ok: privilegesResponse.ok,
      detail: privilegesResponse.ok
        ? "The connected account can reach the Duo Agent Platform privilege endpoint."
        : privilegesResponse.status === 403
          ? "GitLab denied access. Check Duo entitlement, account verification, project settings, and required GitLab tier."
          : `Duo privilege check returned HTTP ${privilegesResponse.status}.`,
    })

    const requiredPrivileges = ["read_only_gitlab", "read_write_files", "run_commands"]
    const missingPrivileges = requiredPrivileges.filter(name => !privileges.includes(name))
    checks.push({
      id: "privileges",
      label: "Safe agent capabilities",
      ok: privilegesResponse.ok && missingPrivileges.length === 0,
      detail: privilegesResponse.ok
        ? missingPrivileges.length === 0
          ? "Read-only GitLab access, isolated workspace file editing, and command execution are available."
          : `GitLab did not advertise required capabilities: ${missingPrivileges.join(", ")}.`
        : "Capabilities could not be verified until the Duo API check succeeds.",
    })

    const response = NextResponse.json({
      ready: checks.every(check => check.ok),
      checkedAt: new Date().toISOString(),
      accountName: accountName || null,
      checks,
      note: "This preflight does not start a workflow or change repository files. Repository access is checked when you select a project and start a review.",
    })
    if (refreshedCookieValue) {
      response.cookies.set(tokenCookieName("gitlab"), refreshedCookieValue, oauthCookieOptions(60 * 60 * 24 * 30))
    }
    return response
  } catch (error) {
    console.error("GitLab Duo readiness check failed", error)
    return errorResponse(502, "Could not check GitLab Duo readiness. Verify the connection and try again.")
  }
}
