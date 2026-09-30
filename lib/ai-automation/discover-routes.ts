import fs from "fs"
import path from "path"

export interface DiscoveredProjectRoute {
  path: string
  url: string
  file: string
  title?: string
}

/**
 * Scans the local Next.js project directory for app router and pages router files,
 * converting file structure into testable URL paths.
 */
export function discoverLocalProjectRoutes(baseUrl = "http://localhost:3000"): DiscoveredProjectRoute[] {
  const cwd = process.cwd()
  const results: DiscoveredProjectRoute[] = []
  const seenPaths = new Set<string>()

  const addRoute = (routePath: string, relativeFile: string, title?: string) => {
    // Normalize path
    let clean = routePath.replace(/\/+/g, "/")
    if (!clean.startsWith("/")) clean = "/" + clean
    if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1)

    if (seenPaths.has(clean)) return
    seenPaths.add(clean)

    // Build absolute URL
    const url = new URL(clean, baseUrl.replace(/\/$/, "")).href
    results.push({
      path: clean,
      url,
      file: relativeFile,
      title: title || clean === "/" ? "Home Dashboard" : clean.slice(1).replace(/-/g, " "),
    })
  }

  // 1. Scan App Router (`app/` or `src/app/`)
  const possibleAppDirs = [path.join(cwd, "app"), path.join(cwd, "src", "app")]
  for (const appDir of possibleAppDirs) {
    if (fs.existsSync(appDir)) {
      scanAppRouterDir(appDir, "", appDir, addRoute)
    }
  }

  // 2. Scan Pages Router (`pages/` or `src/pages/`)
  const possiblePagesDirs = [path.join(cwd, "pages"), path.join(cwd, "src", "pages")]
  for (const pagesDir of possiblePagesDirs) {
    if (fs.existsSync(pagesDir)) {
      scanPagesRouterDir(pagesDir, "", pagesDir, addRoute)
    }
  }

  // 3. Detect known query-param views in app/page.tsx (e.g., view=simulator, view=editor)
  const homePageFile = path.join(cwd, "app", "page.tsx")
  if (fs.existsSync(homePageFile)) {
    try {
      const code = fs.readFileSync(homePageFile, "utf-8")
      if (code.includes('view=simulator') || code.includes('"simulator"')) {
        addRoute("/?view=simulator", "app/page.tsx?view=simulator", "Simulator View")
      }
      if (code.includes('view=editor') || code.includes('"editor"')) {
        addRoute("/?view=editor", "app/page.tsx?view=editor", "Editor View")
      }
    } catch {}
  }

  return results
}

function scanAppRouterDir(
  currentDir: string,
  routePrefix: string,
  appRootDir: string,
  addRoute: (p: string, f: string, t?: string) => void
) {
  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "api") {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        // Skip route groups like (auth) in the route URL path, but recurse inside
        let segment = entry.name
        if (segment.startsWith("(") && segment.endsWith(")")) {
          segment = ""
        }
        const nextPrefix = segment ? `${routePrefix}/${segment}` : routePrefix
        scanAppRouterDir(fullPath, nextPrefix, appRootDir, addRoute)
      } else if (entry.isFile()) {
        // Match page.tsx, page.jsx, page.js
        if (/^page\.(tsx|jsx|js|ts)$/.test(entry.name)) {
          const relativeFile = path.relative(process.cwd(), fullPath).replace(/\\/g, "/")
          const routePath = routePrefix || "/"
          addRoute(routePath, relativeFile)
        }
      }
    }
  } catch {}
}

function scanPagesRouterDir(
  currentDir: string,
  routePrefix: string,
  pagesRootDir: string,
  addRoute: (p: string, f: string, t?: string) => void
) {
  try {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "api") {
        continue
      }

      const fullPath = path.join(currentDir, entry.name)

      if (entry.isDirectory()) {
        scanPagesRouterDir(fullPath, `${routePrefix}/${entry.name}`, pagesRootDir, addRoute)
      } else if (entry.isFile() && /\.(tsx|jsx|js|ts)$/.test(entry.name)) {
        const basename = entry.name.replace(/\.(tsx|jsx|js|ts)$/, "")
        const relativeFile = path.relative(process.cwd(), fullPath).replace(/\\/g, "/")
        if (basename === "index") {
          addRoute(routePrefix || "/", relativeFile)
        } else {
          addRoute(`${routePrefix}/${basename}`, relativeFile)
        }
      }
    }
  } catch {}
}
