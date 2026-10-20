import JSZip from "jszip"
import type { AutomationJob } from "./types"
import { sanitizeJobForClient } from "@/lib/browser/secure-browser"
import { generateHTMLReport } from "./html-report-generator"
import { generateAppMapHtml } from "./map-html-exporter"

export async function buildTestBundleZip(job: AutomationJob): Promise<{ buffer: Buffer; fileName: string }> {
  const zip = new JSZip()
  const sanitized = sanitizeJobForClient(job as unknown as Record<string, unknown>)

  // 0. Comprehensive HTML Report & Interactive App Map
  const htmlReport = generateHTMLReport(job)
  const appMapHtml = generateAppMapHtml({
    plan: job.fullAppTestPlan,
    screens: job.screens || job.fullAppTestPlan?.screens || [],
    transitions: job.fullAppTestPlan?.transitions || [],
    title: `${job.targetUrl || "App"} - Interactive App Map`,
    targetUrl: job.targetUrl,
    timestamp: (job as any).completedAt || (job as any).createdAt,
  })

  zip.file("README.txt", "1. Open 'test-report.html' for the comprehensive test report & findings.\n2. Open 'app-map.html' for the interactive standalone App Map (screens, paths, transitions).\nBoth files can be opened offline in any modern browser or printed to PDF.")
  zip.file("test-report.html", htmlReport)
  zip.file("app-map.html", appMapHtml)

  // 1. Full Job Data (sanitized)
  zip.file("job.json", JSON.stringify(sanitized, null, 2))

  // 2. Summary
  const summary = {
    id: job.id,
    targetUrl: job.targetUrl,
    mode: job.mode,
    status: job.status,
    role: job.role,
    startedAt: job.startedAt || (job as any).createdAt,
    completedAt: (job as any).completedAt,
    screensCount: job.screens?.length || 0,
    issuesCount: job.issues?.length || 0,
    planApprovalState: job.planApprovalState,
    testPlanSummary: job.fullAppTestPlan
      ? {
          name: (job.fullAppTestPlan as any).name || (job.fullAppTestPlan as any).title || "Test Plan",
          stepsCount: job.fullAppTestPlan.steps?.length || 0,
          scenariosCount: (job.fullAppTestPlan as any).scenarios?.length || (job.fullAppTestPlan.steps?.length ? 1 : 0),
        }
      : null,
  }
  zip.file("summary.json", JSON.stringify(summary, null, 2))

  // 3. Test Plan
  if (job.fullAppTestPlan) {
    zip.file("test-plan.json", JSON.stringify(job.fullAppTestPlan, null, 2))
  }

  // 4. Action Ledger
  if (job.actionLedger) {
    zip.file("action-ledger.json", JSON.stringify(job.actionLedger, null, 2))
  }

  // 5. Issues
  if (job.issues && job.issues.length > 0) {
    zip.file("issues.json", JSON.stringify(job.issues, null, 2))
  }

  // 6. Logs
  if (job.logs && job.logs.length > 0) {
    const formattedLogs = job.logs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n")
    zip.file("execution.log", formattedLogs)
    zip.file("logs.json", JSON.stringify(job.logs, null, 2))
  }

  // 7. Screenshots
  const screensFolder = zip.folder("screens")
  if (screensFolder) {
    const screens = job.screens || []
    screens.forEach((screen, index) => {
      const screenPrefix = `screen-${index + 1}-${(screen.title || "untitled").replace(/[^a-z0-9_-]/gi, "_")}`
      if (screen.screenshots) {
        Object.entries(screen.screenshots).forEach(([viewport, src]) => {
          if (typeof src === "string" && src.startsWith("data:image/")) {
            const base64Data = src.replace(/^data:image\/\w+;base64,/, "")
            screensFolder.file(`${screenPrefix}-${viewport}.png`, base64Data, { base64: true })
          }
        })
      }
    })
  }

  const content = await zip.generateAsync({ type: "nodebuffer" })
  const safeId = (job.id || "test-job").replace(/[^a-z0-9_-]/gi, "_")
  const fileName = `test-bundle-${safeId}-${Date.now()}.zip`

  return {
    buffer: content,
    fileName,
  }
}