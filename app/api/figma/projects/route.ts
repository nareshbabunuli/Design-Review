import { NextRequest, NextResponse } from "next/server"

function extractFigmaResource(input: string): {
  type: "file" | "team" | "project" | "unknown"
  id: string | null
} {
  if (!input) return { type: "unknown", id: null }
  const trimmed = input.trim()

  // Match file / design URL: figma.com/design/:key or figma.com/file/:key
  const fileMatch = trimmed.match(/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9_-]+)/i)
  if (fileMatch && fileMatch[1]) {
    return { type: "file", id: fileMatch[1] }
  }

  // Match team URL: figma.com/files/team/123456789/...
  const teamMatch = trimmed.match(/figma\.com\/files\/team\/([0-9]+)/i)
  if (teamMatch && teamMatch[1]) {
    return { type: "team", id: teamMatch[1] }
  }

  // Match project URL: figma.com/files/project/123456789/...
  const projMatch = trimmed.match(/figma\.com\/files\/project\/([0-9]+)/i)
  if (projMatch && projMatch[1]) {
    return { type: "project", id: projMatch[1] }
  }

  // Match generic files URL: figma.com/files/123456789/...
  const genericMatch = trimmed.match(/figma\.com\/files\/([0-9]+)/i)
  if (genericMatch && genericMatch[1]) {
    return { type: "team", id: genericMatch[1] }
  }

  // If pure numeric ID
  if (/^[0-9]+$/.test(trimmed)) {
    return { type: "team", id: trimmed }
  }

  // If raw file key (typically 12-40 alphanumeric/dash characters)
  if (/^[a-zA-Z0-9_-]{12,45}$/.test(trimmed)) {
    return { type: "file", id: trimmed }
  }

  return { type: "unknown", id: null }
}

export async function POST(req: NextRequest) {
  try {
    const { token, teamIdOrUrl } = await req.json()

    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "Figma token is required" }, { status: 400 })
    }

    if (!teamIdOrUrl || typeof teamIdOrUrl !== "string" || !teamIdOrUrl.trim()) {
      return NextResponse.json(
        {
          error:
            "Please provide your Figma Team Link, Project Link, or direct File Link.",
        },
        { status: 400 }
      )
    }

    const cleanToken = token.trim()
    const { type, id } = extractFigmaResource(teamIdOrUrl)

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Could not parse Figma URL. Please paste either a design file link ('https://www.figma.com/design/...'), team link, or project link.",
        },
        { status: 400 }
      )
    }

    // Case 1: Direct File URL
    if (type === "file") {
      const fileRes = await fetch(`https://api.figma.com/v1/files/${id}?depth=1`, {
        headers: { "X-Figma-Token": cleanToken },
      })

      if (!fileRes.ok) {
        return NextResponse.json(
          { error: `Failed to load Figma file (status ${fileRes.status})` },
          { status: fileRes.status }
        )
      }

      const fileData = await fileRes.json()
      return NextResponse.json({
        teamName: "Design Files",
        teamId: "direct-file",
        isDirectFile: true,
        fileKey: id,
        projects: [
          {
            id: "file-" + id,
            name: fileData.name || "Design File",
            files: [
              {
                key: id,
                name: fileData.name || "Design File",
                thumbnailUrl: fileData.thumbnailUrl || null,
                lastModified: fileData.lastModified,
              },
            ],
          },
        ],
      })
    }

    // Case 2: Direct Project URL
    if (type === "project") {
      const filesRes = await fetch(`https://api.figma.com/v1/projects/${id}/files`, {
        headers: { "X-Figma-Token": cleanToken },
      })

      if (!filesRes.ok) {
        return NextResponse.json(
          { error: `Failed to fetch project files (status ${filesRes.status})` },
          { status: filesRes.status }
        )
      }

      const filesData = await filesRes.json()
      return NextResponse.json({
        teamName: "Project Files",
        teamId: id,
        projects: [
          {
            id,
            name: filesData.name || "Project Files",
            files: (filesData.files || []).map((f: any) => ({
              key: f.key,
              name: f.name,
              thumbnailUrl: f.thumbnail_url || null,
              lastModified: f.last_modified,
            })),
          },
        ],
      })
    }

    // Case 3: Team ID -> Fetch team projects, then fetch files in each project
    const teamProjectsRes = await fetch(`https://api.figma.com/v1/teams/${id}/projects`, {
      headers: { "X-Figma-Token": cleanToken },
    })

    if (!teamProjectsRes.ok) {
      let errMsg = `Failed to fetch team projects (status ${teamProjectsRes.status})`
      if (teamProjectsRes.status === 404) {
        errMsg = "Team not found. Please verify the Team link or ID."
      } else if (teamProjectsRes.status === 403) {
        errMsg =
          "Figma restricts team project listing on Free / Starter plans. On free accounts, all designs live in 'Drafts'. Simply open your design file in Figma and paste its URL (https://www.figma.com/design/...) to import all screens directly!"
      }
      return NextResponse.json({ error: errMsg, isPlanRestriction: teamProjectsRes.status === 403 }, { status: teamProjectsRes.status })
    }

    const teamData = await teamProjectsRes.json()
    const rawProjects = teamData.projects || []

    // Fetch files for all projects in parallel
    const projectsWithFiles = await Promise.all(
      rawProjects.map(async (p: any) => {
        try {
          const fRes = await fetch(`https://api.figma.com/v1/projects/${p.id}/files`, {
            headers: { "X-Figma-Token": cleanToken },
          })
          if (fRes.ok) {
            const fData = await fRes.json()
            return {
              id: p.id,
              name: p.name,
              files: (fData.files || []).map((file: any) => ({
                key: file.key,
                name: file.name,
                thumbnailUrl: file.thumbnail_url || null,
                lastModified: file.last_modified,
              })),
            }
          }
        } catch (e) {
          console.warn(`Error fetching files for project ${p.id}:`, e)
        }
        return {
          id: p.id,
          name: p.name,
          files: [],
        }
      })
    )

    return NextResponse.json({
      teamName: teamData.name || "Figma Team",
      teamId: id,
      projects: projectsWithFiles,
    })
  } catch (err: any) {
    console.error("Error in Figma projects API:", err)
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 })
  }
}
