import { NextRequest, NextResponse } from "next/server"

// In-memory cache for fetched Figma files (5-minute TTL)
interface CacheEntry {
  data: any
  timestamp: number
}
const fileCache = new Map<string, CacheEntry>()

function extractFigmaFileKey(urlOrKey: string): string | null {
  if (!urlOrKey) return null
  const trimmed = urlOrKey.trim()

  // Match figma.com/(file|design|proto|board)/KEY
  const match = trimmed.match(/figma\.com\/(?:file|design|proto|board)\/([a-zA-Z0-9_-]+)/i)
  if (match && match[1]) {
    return match[1]
  }

  // Fallback: Check if it's already a raw file key (typically 12-40 alphanumeric/dash characters)
  if (/^[a-zA-Z0-9_-]{10,45}$/.test(trimmed)) {
    return trimmed
  }

  return null
}

interface ExtractedScreen {
  id: string
  name: string
  pageId: string
  pageName: string
  width: number
  height: number
  type: string
  figmaUrl: string
  imageUrl?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const { token, fileUrl } = await req.json()

    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "Figma access token is required" }, { status: 400 })
    }

    if (!fileUrl || typeof fileUrl !== "string" || !fileUrl.trim()) {
      return NextResponse.json({ error: "Figma file URL or key is required" }, { status: 400 })
    }

    const cleanToken = token.trim()
    const fileKey = extractFigmaFileKey(fileUrl)

    if (!fileKey) {
      return NextResponse.json(
        {
          error:
            "Invalid Figma URL format. Please provide a link like 'https://www.figma.com/design/:fileId/:title' or 'https://www.figma.com/file/:fileId/:title'.",
        },
        { status: 400 }
      )
    }

    // Check in-memory cache first (prevents re-triggering Figma 429 rate limits)
    const cached = fileCache.get(fileKey)
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return NextResponse.json(cached.data)
    }

    // 1. Fetch file document structure (depth=3 captures frames on canvas and inside sections)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    const fileRes = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=3`, {
      headers: {
        "X-Figma-Token": cleanToken,
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!fileRes.ok) {
      let errMsg = `Figma API returned status ${fileRes.status}`
      try {
        const errJson = await fileRes.json()
        if (errJson?.message) errMsg = errJson.message
        else if (errJson?.err) errMsg = errJson.err
      } catch {}

      if (fileRes.status === 404) {
        errMsg = "Figma file not found. Please check that the URL is correct and the token has access to this file."
      } else if (fileRes.status === 403) {
        errMsg = "Access denied. Your Figma token does not have permission to view this file."
      } else if (fileRes.status === 429) {
        const retryHeader = fileRes.headers.get("retry-after")
        const planTier = fileRes.headers.get("x-figma-plan-tier")
        const limitType = fileRes.headers.get("x-figma-rate-limit-type")
        const upgradeLink = fileRes.headers.get("x-figma-upgrade-link")
        const retrySec = retryHeader ? parseInt(retryHeader, 10) : 30
        const isMonthlyLimit = retrySec > 120

        console.warn(`[Figma 429] tier: ${planTier}, type: ${limitType}, retryAfter: ${retrySec}s, upgrade: ${upgradeLink}`)
        const errMsg = isMonthlyLimit
          ? "Figma Starter (Free) monthly quota reached (6 API calls/month). Quota resets on October 1st."
          : `Figma API rate limit reached. Retrying automatically in ${retrySec}s...`

        return NextResponse.json(
          {
            error: errMsg,
            isRateLimit: true,
            isMonthlyLimit,
            retryAfter: retrySec || 30,
            planTier,
            limitType,
            upgradeLink,
          },
          { status: 429 }
        )
      }

      return NextResponse.json({ error: errMsg, isRateLimit: fileRes.status === 429 }, { status: fileRes.status })
    }

    const fileData = await fileRes.json()
    const screens: ExtractedScreen[] = []
    const pages: { id: string; name: string; screenCount: number }[] = []

    // 2. Traverse document tree to collect top-level screen frames
    const documentChildren = fileData.document?.children || []

    for (const page of documentChildren) {
      if (page.type !== "CANVAS") continue
      let pageScreensCount = 0

      const inspectNode = (node: any) => {
        const box = node.absoluteBoundingBox || node.size
        const w = box ? Math.round(box.width ?? box.x ?? 0) : 0
        const h = box ? Math.round(box.height ?? box.y ?? 0) : 0

        // Inspect FRAME nodes and master template COMPONENT nodes (width or height >= 240px)
        // This skips small UI elements (buttons, inputs, icons) while capturing full-page website/app screens
        const isCandidate =
          node.type === "FRAME" ||
          (node.type === "COMPONENT" && (w >= 320 || h >= 480))

        if (isCandidate && (w >= 240 || h >= 240)) {
          pageScreensCount++
          screens.push({
            id: node.id,
            name: node.name || "Untitled Screen",
            pageId: page.id,
            pageName: page.name || "Page",
            width: w,
            height: h,
            type: node.type,
            figmaUrl: `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(node.id)}`,
          })
          // Do not inspect inner layers of an already-identified screen
          return
        }

        // If it's a SECTION or GROUP on the canvas, inspect child frames
        if ((node.type === "SECTION" || node.type === "GROUP") && Array.isArray(node.children)) {
          for (const child of node.children) {
            inspectNode(child)
          }
        }
      }

      for (const child of page.children || []) {
        inspectNode(child)
      }

      pages.push({
        id: page.id,
        name: page.name || "Untitled Page",
        screenCount: pageScreensCount,
      })
    }

    // Instant lazy load: return screens immediately without blocking on image rendering
    const responsePayload = {
      fileKey,
      fileName: fileData.name || "Figma File",
      lastModified: fileData.lastModified,
      thumbnailUrl: fileData.thumbnailUrl || null,
      pages,
      totalScreens: screens.length,
      screens,
    }

    // Store in cache
    fileCache.set(fileKey, { data: responsePayload, timestamp: Date.now() })

    return NextResponse.json(responsePayload)
  } catch (err: any) {
    console.error("Error fetching Figma file:", err)
    return NextResponse.json({ error: err?.message || "Failed to process Figma file" }, { status: 500 })
  }
}
