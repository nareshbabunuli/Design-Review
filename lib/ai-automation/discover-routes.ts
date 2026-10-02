import fs from "fs"
import path from "path"

export interface DiscoveredProjectRoute {
  path: string
  url: string
  file: string
  title?: string
}

export interface LocalProjectInfo {
  name: string
  path: string
  defaultPort?: number
}

/**
 * Lists available Next.js/web projects in the workspace parent directory (d:/wamp64/www).
 */
export function listAvailableLocalProjects(): LocalProjectInfo[] {
  const cwd = process.cwd()
  const parent = path.resolve(cwd, "..")
  const results: LocalProjectInfo[] = []

  try {
    const entries = fs.readdirSync(parent, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue
      const full = path.join(parent, entry.name)
      const hasPkg = fs.existsSync(path.join(full, "package.json"))
      const hasApp =
        fs.existsSync(path.join(full, "app")) ||
        fs.existsSync(path.join(full, "pages")) ||
        fs.existsSync(path.join(full, "src", "app"))
      if (hasPkg && hasApp) {
        results.push({
          name: entry.name,
          path: full.replace(/\\/g, "/"),
          defaultPort:
            entry.name === "landlord-accounting-portal"
              ? 3001
              : entry.name === "design-workflow-tracker"
              ? 3000
              : undefined,
        })
      }
    }
  } catch {}

  results.sort((a, b) => {
    if (a.name === "landlord-accounting-portal") return -1
    if (b.name === "landlord-accounting-portal") return 1
    return a.name.localeCompare(b.name)
  })

  return results
}

/**
 * Resolves the directory of the project to test.
 * Prioritizes explicitly passed customDir, then heuristics based on baseUrl port,
 * falling back to process.cwd().
 */
export function resolveProjectDirectory(baseUrl = "http://localhost:3000", customDir?: string): string {
  const cwd = process.cwd()

  // 1. Explicit directory provided
  if (customDir && customDir.trim()) {
    const trimmed = customDir.trim()
    if (fs.existsSync(trimmed)) return path.resolve(trimmed)
    const relFromCwd = path.resolve(cwd, trimmed)
    if (fs.existsSync(relFromCwd)) return relFromCwd
    const relFromParent = path.resolve(cwd, "..", trimmed)
    if (fs.existsSync(relFromParent)) return relFromParent
  }

  // 2. Derive from baseUrl port/origin
  try {
    const urlObj = new URL(baseUrl)
    if (urlObj.port === "3001" || urlObj.port === "3002") {
      const landlordDir = path.resolve(cwd, "..", "landlord-accounting-portal")
      if (fs.existsSync(landlordDir)) return landlordDir
    }
  } catch {}

  return cwd
}

/**
 * Scans the target project directory for app router and pages router files,
 * converting file structure into testable URL paths for the given baseUrl.
 */
export function discoverLocalProjectRoutes(
  baseUrl = "http://localhost:3000",
  customProjectDir?: string
): DiscoveredProjectRoute[] {
  const projectDir = resolveProjectDirectory(baseUrl, customProjectDir)
  const results: DiscoveredProjectRoute[] = []
  const seenPaths = new Set<string>()

  const addRoute = (routePath: string, relativeFile: string, title?: string) => {
    let clean = routePath.replace(/\/+/g, "/")
    if (!clean.startsWith("/")) clean = "/" + clean
    if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1)

    if (seenPaths.has(clean)) return
    seenPaths.add(clean)

    const url = new URL(clean, baseUrl.replace(/\/$/, "")).href
    results.push({
      path: clean,
      url,
      file: relativeFile,
      title: title || (clean === "/" ? "Home Dashboard" : clean.slice(1).replace(/-/g, " ")),
    })
  }

  // 1. Scan App Router (`app/` or `src/app/`)
  const possibleAppDirs = [path.join(projectDir, "app"), path.join(projectDir, "src", "app")]
  for (const appDir of possibleAppDirs) {
    if (fs.existsSync(appDir)) {
      scanAppRouterDir(appDir, "", projectDir, addRoute)
    }
  }

  // 2. Scan Pages Router (`pages/` or `src/pages/`)
  const possiblePagesDirs = [path.join(projectDir, "pages"), path.join(projectDir, "src", "pages")]
  for (const pagesDir of possiblePagesDirs) {
    if (fs.existsSync(pagesDir)) {
      scanPagesRouterDir(pagesDir, "", projectDir, addRoute)
    }
  }

  // 3. Known query-param views in app/page.tsx (e.g., view=simulator, view=editor)
  const homePageFile = path.join(projectDir, "app", "page.tsx")
  if (fs.existsSync(homePageFile)) {
    try {
      const code = fs.readFileSync(homePageFile, "utf-8")
      if (code.includes("view=simulator") || code.includes('"simulator"')) {
        addRoute("/?view=simulator", "app/page.tsx?view=simulator", "Simulator View")
      }
      if (code.includes("view=editor") || code.includes('"editor"')) {
        addRoute("/?view=editor", "app/page.tsx?view=editor", "Editor View")
      }
    } catch {}
  }

  // Check for app/page.jsx for Next.js JS projects (e.g. landlord-accounting-portal)
  const homePageJsx = path.join(projectDir, "app", "page.jsx")
  if (fs.existsSync(homePageJsx) && !seenPaths.has("/")) {
    addRoute("/", "app/page.jsx", "Home Dashboard")
  }

  return results
}

function scanAppRouterDir(
  currentDir: string,
  routePrefix: string,
  projectRootDir: string,
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
        let segment = entry.name
        if (segment.startsWith("(") && segment.endsWith(")")) {
          segment = ""
        }
        const nextPrefix = segment ? `${routePrefix}/${segment}` : routePrefix
        scanAppRouterDir(fullPath, nextPrefix, projectRootDir, addRoute)
      } else if (entry.isFile()) {
        if (/^page\.(tsx|jsx|js|ts)$/.test(entry.name)) {
          const relativeFile = path.relative(projectRootDir, fullPath).replace(/\\/g, "/")
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
  projectRootDir: string,
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
        scanPagesRouterDir(fullPath, `${routePrefix}/${entry.name}`, projectRootDir, addRoute)
      } else if (entry.isFile() && /\.(tsx|jsx|js|ts)$/.test(entry.name)) {
        const basename = entry.name.replace(/\.(tsx|jsx|js|ts)$/, "")
        const relativeFile = path.relative(projectRootDir, fullPath).replace(/\\/g, "/")
        if (basename === "index") {
          addRoute(routePrefix || "/", relativeFile)
        } else {
          addRoute(`${routePrefix}/${basename}`, relativeFile)
        }
      }
    }
  } catch {}
}
