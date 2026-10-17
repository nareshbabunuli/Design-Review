import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/require-project-access"
import {
  decryptConnection,
  providerBaseUrl,
  tokenCookieName,
} from "@/lib/integrations/repository-connections"

export const dynamic = "force-dynamic"

type GitLabConnection = { accessToken: string; userId: string; username?: string; connectedAt: number }

async function gitlabRequest(url: string, accessToken: string, init?: RequestInit) {
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

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: NextRequest) {
  const user = await requireUser().catch(() => null)
  if (!user) return errorResponse(401, "Sign in to Open Design AI before starting a Duo review.")

  const connection = decryptConnection<GitLabConnection>(request.cookies.get(tokenCookieName("gitlab"))?.value)
  if (!connection || connection.userId !== user.id) {
    return errorResponse(401, "Connect your GitLab account in Settings before starting a Duo review.")
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, "Request body must be valid JSON.")
  }

  const projectId = typeof body.projectId === "string" || typeof body.projectId === "number"
    ? String(body.projectId).trim()
    : ""
  const goal = typeof body.goal === "string" ? body.goal.trim() : ""
  const appUrl = typeof body.appUrl === "string" ? body.appUrl.trim() : ""
  const findings = Array.isArray(body.findings) ? body.findings.slice(0, 30) : []

  if (!projectId || !/^[0-9]+$/.test(projectId)) {
    return errorResponse(400, "Choose a GitLab repository before starting the Duo review.")
  }
  if (!goal || goal.length > 8000) {
    return errorResponse(400, "Provide a review goal between 1 and 8,000 characters.")
  }

  const baseUrl = providerBaseUrl("gitlab")
  try {
    // Resolve the user's actual available privilege IDs and deliberately exclude
    // GitLab-write and git-push privileges. The agent may prepare changes in its
    // isolated workspace, but it cannot commit or push them to the project.
    const privilegesResponse = await gitlabRequest(
      `${baseUrl}/api/v4/ai/duo_workflows/workflows/agent_privileges`,
      connection.accessToken
    )
    if (!privilegesResponse.ok) {
      const detail = privilegesResponse.status === 403
        ? "Your GitLab account cannot access the Duo Agent Platform API. Check your Ultimate/Duo access and project settings."
        : `GitLab could not list Duo agent privileges (HTTP ${privilegesResponse.status}).`
      return errorResponse(502, detail)
    }
    const privilegePayload = await privilegesResponse.json()
    const allowedNames = new Set(["read_write_files", "read_only_gitlab", "run_commands"])
    const privileges = (privilegePayload.all_privileges || [])
      .filter((item: { id?: number; name?: string }) => item.name && allowedNames.has(item.name) && Number.isInteger(item.id))
    const privilegeIds = privileges.map((item: { id: number }) => item.id)
    const privilegeNames = new Set(privileges.map((item: { name: string }) => item.name))
    if (!privilegeNames.has("read_only_gitlab")) {
      return errorResponse(502, "GitLab did not provide the read-only repository privilege required for a safe Duo review.")
    }

    const fullGoal = [
      "You are reviewing a web application's end-to-end UI testing findings for Open Design AI.",
      goal,
      appUrl ? `Application under test: ${appUrl}` : "",
      "Work only in the isolated agent workspace. Do not commit, push, create a branch, open a merge request, or write to the GitLab project through GitLab APIs.",
      "Inspect relevant source files and tests. Prepare candidate fixes in priority order, explain the evidence and rationale, and run relevant local tests when possible.",
      "Return proposed changes as unified diffs grouped by issue and file. Do not claim a fix has been applied to the user's repository. The user must review and explicitly approve each change before any repository mutation.",
    ].filter(Boolean).join("\n\n")

    const additionalContext = [{
      Category: "open_design_ai_ui_test_findings",
      Content: JSON.stringify({ appUrl, findings }),
    }]
    const createResponse = await gitlabRequest(
      `${baseUrl}/api/v4/ai/duo_workflows/workflows`,
      connection.accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          goal: fullGoal,
          additional_context: additionalContext,
          workflow_definition: "developer/v1",
          environment: "web",
          source: "ide_extension",
          agent_privileges: privilegeIds,
          pre_approved_agent_privileges: privilegeIds,
          start_workflow: true,
          allow_agent_to_request_user: true,
        }),
      }
    )
    const data = await createResponse.json().catch(() => ({}))
    if (!createResponse.ok) {
      const apiMessage = typeof data.message === "string" ? data.message : ""
      const message = createResponse.status === 403
        ? `GitLab rejected the Duo workflow. ${apiMessage || "Check Duo Agent Platform access, identity verification, project settings, and service-account requirements."}`
        : `Could not start the GitLab Duo workflow (HTTP ${createResponse.status}). ${apiMessage}`
      return errorResponse(502, message.trim())
    }

    return NextResponse.json({
      success: true,
      workflow: {
        id: String(data.id),
        status: data.status || "created",
        title: data.title || "Open Design AI fix review",
        summary: data.summary || "Duo is reviewing the supplied test findings.",
        webUrl: data.web_url || null,
        projectId,
        provider: "gitlab",
      },
      safety: {
        repositoryWritePrivilege: false,
        gitPushPrivilege: false,
        requiresHumanReview: true,
      },
    }, { status: 201 })
  } catch (error) {
    console.error("Failed to start GitLab Duo workflow", error)
    return errorResponse(502, "The GitLab Duo request failed unexpectedly. Check your connection and try again.")
  }
}

export async function GET(request: NextRequest) {
  const user = await requireUser().catch(() => null)
  if (!user) return errorResponse(401, "Sign in to view a Duo review.")

  const connection = decryptConnection<GitLabConnection>(request.cookies.get(tokenCookieName("gitlab"))?.value)
  if (!connection || connection.userId !== user.id) {
    return errorResponse(401, "Reconnect GitLab to view this Duo review.")
  }

  const workflowId = request.nextUrl.searchParams.get("workflowId") || ""
  if (!/^\d+$/.test(workflowId)) return errorResponse(400, "A valid workflowId is required.")

  const baseUrl = providerBaseUrl("gitlab")
  try {
    const [flowResponse, traceResponse] = await Promise.all([
      gitlabRequest(`${baseUrl}/api/v4/ai/duo_workflows/workflows/${workflowId}`, connection.accessToken),
      gitlabRequest(`${baseUrl}/api/v4/ai/duo_workflows/workflows/${workflowId}/trace.jsonl`, connection.accessToken),
    ])
    if (!flowResponse.ok) {
      return errorResponse(flowResponse.status === 404 ? 404 : 502, `Could not retrieve the Duo workflow status (HTTP ${flowResponse.status}).`)
    }
    const flow = await flowResponse.json()
    const traceText = traceResponse.ok ? await traceResponse.text() : ""
    const messages = traceText.split("\n").filter(Boolean).slice(-80).flatMap(line => {
      try {
        const entry = JSON.parse(line)
        if (typeof entry.content !== "string" || !entry.content.trim()) return []
        return [{
          role: entry.message_type === "human" ? "user" : "assistant",
          content: entry.content.slice(0, 12000),
          status: entry.status || "success",
        }]
      } catch {
        return []
      }
    })
    return NextResponse.json({
      workflow: {
        id: String(flow.id),
        status: flow.status || "unknown",
        title: flow.title || "Open Design AI fix review",
        summary: flow.summary || "",
        webUrl: flow.web_url || null,
      },
      messages,
    })
  } catch (error) {
    console.error("Failed to retrieve GitLab Duo workflow", error)
    return errorResponse(502, "Could not retrieve the Duo session. Retry in a moment.")
  }
}
