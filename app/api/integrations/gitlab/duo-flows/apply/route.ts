import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  decryptConnection,
  providerBaseUrl,
  tokenCookieName,
} from "@/lib/integrations/repository-connections"

export const dynamic = "force-dynamic"

type GitLabConnection = { accessToken: string; userId: string; username?: string; connectedAt: number }
type ProposedFile = { path: string; content: string }
type ProposedFix = { id: string; summary?: string; issue?: string; files: ProposedFile[] }

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

async function gitlabFetch(url: string, accessToken: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  })
}

export async function POST(request: NextRequest) {
  const user = await requireUser().catch(() => null)
  if (!user) return errorResponse(401, "Sign in before approving a proposed fix.")

  const connection = decryptConnection<GitLabConnection>(request.cookies.get(tokenCookieName("gitlab"))?.value)
  if (!connection || connection.userId !== user.id) return errorResponse(401, "Reconnect GitLab before approving a proposed fix.")

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return errorResponse(400, "Request body must be valid JSON.") }

  if (body.approved !== true) return errorResponse(400, "Explicit approval is required before any repository change.")
  const projectId = typeof body.projectId === "string" ? body.projectId : ""
  const baseBranch = typeof body.baseBranch === "string" ? body.baseBranch.trim() : ""
  const workflowId = typeof body.workflowId === "string" ? body.workflowId : ""
  const proposals = Array.isArray(body.proposals) ? body.proposals as ProposedFix[] : []
  if (!/^\d+$/.test(projectId)) return errorResponse(400, "Invalid GitLab project ID.")
  if (!baseBranch || baseBranch.length > 200 || baseBranch.startsWith("-")) return errorResponse(400, "Invalid base branch.")
  if (!/^\d+$/.test(workflowId)) return errorResponse(400, "Invalid Duo workflow ID.")
  if (proposals.length < 1 || proposals.length > 20) return errorResponse(400, "Select between 1 and 20 proposed fixes to approve.")

  const files = new Map<string, string>()
  for (const proposal of proposals) {
    if (!proposal || typeof proposal.id !== "string" || !Array.isArray(proposal.files) || proposal.files.length === 0) {
      return errorResponse(400, "A proposed fix has an invalid file list.")
    }
    for (const file of proposal.files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        return errorResponse(400, "Every proposed file must include a path and complete file content.")
      }
      const path = file.path.trim()
      if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => part === ".." || part === "." || part === ".git") || path.length > 500) {
        return errorResponse(400, "A proposed file path is unsafe.")
      }
      if (file.content.length > 200_000) return errorResponse(413, `Proposed file ${path} is too large to approve in this workflow.`)
      if (files.has(path) && files.get(path) !== file.content) return errorResponse(400, `The approved fixes contain conflicting versions of ${path}. Approve those fixes separately.`)
      files.set(path, file.content)
    }
  }
  if (files.size > 40) return errorResponse(413, "A single approval can change at most 40 files.")

  const baseUrl = providerBaseUrl("gitlab")
  const branchName = `open-design-ai/duo-fixes-${workflowId}`
  const projectUrl = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}`

  try {
    // Always apply approved proposals to a dedicated branch, never the base/default branch.
    const branchCheck = await gitlabFetch(`${projectUrl}/repository/branches/${encodeURIComponent(branchName)}`, connection.accessToken)
    if (branchCheck.status === 404) {
      const createBranch = await gitlabFetch(`${projectUrl}/repository/branches`, connection.accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ branch: branchName, ref: baseBranch }).toString(),
      })
      if (!createBranch.ok) {
        const data = await createBranch.json().catch(() => ({}))
        return errorResponse(502, `Could not create the isolated fix branch. ${data.message || `GitLab returned HTTP ${createBranch.status}.`}`)
      }
    } else if (!branchCheck.ok) {
      return errorResponse(502, `Could not verify the fix branch (HTTP ${branchCheck.status}).`)
    }

    const actions: Array<{ action: "create" | "update"; file_path: string; content: string }> = []
    for (const [path, content] of files.entries()) {
      const encodedPath = encodeURIComponent(path)
      const fileCheck = await gitlabFetch(`${projectUrl}/repository/files/${encodedPath}?ref=${encodeURIComponent(branchName)}`, connection.accessToken)
      if (fileCheck.ok) {
        actions.push({ action: "update", file_path: path, content })
      } else if (fileCheck.status === 404) {
        actions.push({ action: "create", file_path: path, content })
      } else {
        return errorResponse(502, `Could not inspect ${path} on the fix branch (HTTP ${fileCheck.status}).`)
      }
    }

    const title = proposals.length === 1
      ? (proposals[0].summary || proposals[0].issue || "approved Duo fix")
      : `approved batch of ${proposals.length} Duo fixes`
    const commitResponse = await gitlabFetch(`${projectUrl}/repository/commits`, connection.accessToken, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branch_name: branchName,
        commit_message: `Open Design AI: ${title} (workflow ${workflowId})`,
        actions,
      }),
    })
    const commit = await commitResponse.json().catch(() => ({}))
    if (!commitResponse.ok) {
      return errorResponse(502, `GitLab rejected the approved change (HTTP ${commitResponse.status}). ${commit.message || ""}`.trim())
    }

    return NextResponse.json({
      success: true,
      approved: true,
      branch: branchName,
      commit: { id: commit.id, shortId: commit.short_id, message: commit.message, webUrl: commit.web_url },
      filesChanged: actions.length,
      proposalsApproved: proposals.length,
      pushPolicy: "User explicitly approved this branch commit. No changes were pushed to the default branch.",
    }, { status: 201 })
  } catch (error) {
    console.error("Failed to apply approved GitLab Duo fix", error)
    return errorResponse(502, "Could not apply the approved fix. No success was reported; check the GitLab branch and retry safely.")
  }
}
