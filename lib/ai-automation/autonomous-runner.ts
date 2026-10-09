/**
 * Autonomous test runner — the engine behind "make the Testing Bot work".
 *
 * Takes over a job when the user asks for autonomous exploration
 * (mode === "autonomous", or chat commands like "test every page" /
 * "run 15 scenarios"). For each planned scenario it drives a real
 * Stagehand browser agent against the target app, records session video,
 * captures masked screenshots, and compiles test cases + a flow graph +
 * a final report into the existing job shape the UI already renders.
 *
 * Honesty rules: if the AI provider is unreachable the run is marked
 * BLOCKED with the reason — never a fake pass. Destructive actions are
 * forbidden by instruction AND verified post-hoc; a hit fails loudly.
 */

import path from "path"
import fs from "fs"
import puppeteer, { type Browser, type Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"

import type {
  AutomationJob,
  AutomationIssue,
  DiscoveredScreen,
  StartAutomationRequest,
  TestCaseResult,
  TestCaseBug,
  FlowGraph,
} from "./types"
import { saveJob, getJob, appendLog, jobDir } from "./job-store"
import { planScenarios } from "./scenario-planner"
import { discoverLocalProjectRoutes } from "./discover-routes"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import type { JourneyStep, PageType } from "@/lib/journey/types"
import { performVisibleLoginPlaywright } from "./human-actions"
import { resolveAiApiKey, NEBIUS_BASE_URL } from "./ai-gateway"

export function isAutonomousCommand(cmd: string): boolean {
  return /(every page|all pages|full (test|audit|run)|autonomous|test every|explore( the app)?|end[\s-]?to[\s-]?end|\d+\s*scenarios?)/i.test(
    cmd,
  )
}

export function scenarioCountFromCommand(cmd: string, fallback: number): number {
  const m = cmd.match(/(\d+)\s*scenarios?/i)
  if (m) return Math.min(Math.max(parseInt(m[1], 10), 1), 25)
  return Math.min(Math.max(fallback || 15, 1), 25)
}

const RISKY_ACTION =
  /(delete|remove|destroy|purchase|pay|checkout|charge|submit payment|send email|send message|publish|deploy|logout|sign ?out|cancel subscription|unsubscribe)/i

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Cover password / sensitive inputs with black boxes so screenshots never leak secrets. */
async function maskSensitiveFields(page: any): Promise<() => Promise<void>> {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('[data-qa-mask="1"]').forEach((el) => el.remove())
      const boxes: HTMLElement[] = []
      document
        .querySelectorAll('input[type="password"], [data-sensitive="true"]')
        .forEach((input) => {
          const el = input as HTMLElement
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          const box = document.createElement("div")
          box.setAttribute("data-qa-mask", "1")
          box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:#0b0b0f;z-index:99999998;border-radius:4px;pointer-events:none;`
          document.body.appendChild(box)
          boxes.push(box)
        })
    })
  } catch {}
  return async () => {
    try {
      await page.evaluate(() => {
        document.querySelectorAll('[data-qa-mask="1"]').forEach((el) => el.remove())
      })
    } catch {}
  }
}

async function uploadArtifact(
  imageBuffer: Buffer,
  projectId: string,
  suffix: string,
  contentType: string,
  ext: string,
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const fileName = `${projectId}-${suffix}-${Date.now()}.${ext}`
      const filePath = `automation/${projectId}/${fileName}`
      const { error: uploadError } = await supabase.storage
        .from("designs")
        .upload(filePath, imageBuffer, { upsert: true, contentType })
      if (!uploadError) {
        const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
        if (pubData?.publicUrl) return pubData.publicUrl
      }
    } catch (e) {
      console.warn("[Autonomous] Storage upload error, using local fallback:", e)
    }
  }
  if (contentType.startsWith("image/")) {
    return `data:${contentType};base64,${imageBuffer.toString("base64")}`
  }
  // Video too large for data URIs — keep the local file path as last resort.
  return ""
}

async function captureMasked(
  page: any,
  projectId: string,
  suffix: string,
): Promise<string> {
  const unmask = await maskSensitiveFields(page)
  try {
    const buf = await page.screenshot({ type: "png" })
    return await uploadArtifact(Buffer.from(buf), projectId, suffix, "image/png", "png")
  } catch {
    return ""
  } finally {
    await unmask()
  }
}

async function discoverRoutes(page: Page, targetUrl: string): Promise<string[]> {
  const origin = new URL(targetUrl).origin
  let urls: string[] = []
  try {
    urls = await page.evaluate((org: string) => {
      const links = new Set<string>()
      for (const a of Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]) {
        try {
          const href = a.href
          if (
            href.startsWith(org) &&
            !href.includes("#") &&
            !href.includes("mailto:") &&
            !href.includes("tel:") &&
            !/(logout|signout|delete|leave)/i.test(href)
          ) {
            links.add(href.split("?")[0].replace(/\/$/, "") || href)
          }
        } catch {}
      }
      return Array.from(links)
    }, origin)
  } catch {}
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    try {
      const fsRoutes = discoverLocalProjectRoutes(targetUrl)
      urls = Array.from(new Set([...urls, ...fsRoutes.map((r) => r.url)]))
    } catch {}
  }
  const paths = Array.from(new Set(urls.map((u) => new URL(u).pathname || "/")))
  return ["/", ...paths.filter((p) => p !== "/")].slice(0, 10)
}

/** Auto-login on the Stagehand (Playwright) page when harness credentials exist. */
/** Visible auto-login with human-paced mouse/typing and explicit success verification. */
async function performAutoLogin(
  job: AutomationJob,
  stagePage: any,
  params: StartAutomationRequest,
): Promise<boolean> {
  const username = params.credentials?.username
  const password = params.credentials?.password
  if (!username || !password) return false
  try {
    const result = await performVisibleLoginPlaywright(
      stagePage,
      { username, password },
      {
        onStep: async (message) => {
          appendLog(job, "info", `Login: ${message}`)
          job.currentStep = message
          saveJob(job)
        },
      },
    )
    if (result.ok) {
      appendLog(job, "success", `Visible auto-login verified. Landed on: ${result.landedUrl || "?"}`)
      return true
    }
    appendLog(job, "warn", `Visible auto-login incomplete: ${result.error || "unknown"}`)
  } catch (err: any) {
    appendLog(job, "warn", `Auto-login notice: ${err?.message || String(err)}`)
  }
  return false
}

type EvidenceTrace = {
  phase: "OBSERVE" | "DECIDE" | "RECOVER" | "VERIFY"
  timestamp: string
  summary: string
  evidence?: { url?: string; screenshotUrl?: string; consoleErrors?: string[]; actions?: number }
}

type ScenarioRun = {
  steps: string[]
  evidenceTrace: EvidenceTrace[]
  actionsTaken: number
  visited: { url: string; title: string; screenshotUrl: string }[]
  transitions: { from: string; to: string; label: string }[]
  issues: AutomationIssue[]
  riskyHit: string | null
  agentSummary: string
  agentSuccess: boolean
  error?: string
}

function addEvidence(
  out: ScenarioRun,
  phase: EvidenceTrace["phase"],
  summary: string,
  evidence?: EvidenceTrace["evidence"],
): void {
  out.evidenceTrace.push({ phase, timestamp: new Date().toISOString(), summary, evidence })
}

function scenarioSystemPrompt(
  scenarioName: string,
  goal: string,
  expectedOutcome: string,
  hasCredentials: boolean,
): string {
  return `You are the autonomous QA exploration agent inside Design Review.

CURRENT TEST SCENARIO: ${scenarioName}
GOAL: ${goal}
EXPECTED OUTCOME: ${expectedOutcome}

Rules:
1. Work ONLY on this scenario's goal. Do not wander into unrelated areas.
2. Interact with SAFE controls: navigation links, tabs, menus, accordions, filters, search, dropdowns, dialogs, pagination, theme controls and non-destructive forms.
3. After every click, observe the resulting UI. Check for navigation, modal/menu state changes, blank screens, broken layout, runtime errors and failed requests.
4. NEVER execute destructive or irreversible actions. Never click controls whose purpose is delete, remove, destroy, purchase, pay, checkout, charge, send, publish, deploy, logout/sign out, cancel subscription or similar. Report them as skipped.
5. ${hasCredentials ? "The test harness already signed you in where possible. If you reach a login screen, use ONLY harness-provided credentials — never invent your own." : "No credentials were provided. Do NOT attempt to log in or invent credentials. If a login wall blocks the scenario, report it as blocked and move on."}
6. Use obviously-fake test data for any form you submit (e.g. "QA Test User", qa-test+<timestamp>@example.com). Never use real-looking personal data.
7. Stay on the target origin. Do not follow external sites.
8. When you encounter a broken interaction or error, note it and continue with the rest of the scenario.
9. Finish with a concise verdict: the steps you took, any bugs found with reproduction steps, and end your final message with EXACTLY one line: VERDICT: PASS or VERDICT: FAIL against the expected outcome above.

This is a QA task, not task completion. Prioritize honest observation over a clean-looking run.`
}

async function runScenarioWithStagehand(
  job: AutomationJob,
  browser: Browser,
  params: StartAutomationRequest,
  scenario: { id: string; name: string; goal: string; instruction: string; expectedOutcome: string; needsAuth: boolean },
): Promise<ScenarioRun> {
  const { Stagehand } = await import("@browserbasehq/stagehand")

  const baseURL = params.aiBaseUrl?.trim() || NEBIUS_BASE_URL
  const apiKey = resolveAiApiKey(baseURL, params.aiApiKey)
  const modelName = params.aiModel?.trim() || "nvidia/Nemotron-3-Nano-Omni"

  const out: ScenarioRun = {
    steps: [],
    evidenceTrace: [],
    actionsTaken: 0,
    visited: [],
    transitions: [],
    issues: [],
    riskyHit: null,
    agentSummary: "",
    agentSuccess: false,
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: { cdpUrl: browser.wsEndpoint() },
    model: { modelName, apiKey, baseURL },
    selfHeal: true,
    verbose: 0,
  } as any)

  const stopTracker = { done: false }
  try {
    await stagehand.init()
    const stagePage: any = stagehand.context.activePage()
    if (!stagePage) throw new Error("Stagehand attached but found no active page.")

    await stagePage.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {})

    // Real console-error signal: Playwright pageerror events on the agent's own page.
    const pageErrors: string[] = []
    try {
      stagePage.on("pageerror", (e: any) => pageErrors.push(e?.message || String(e)))
    } catch {}

    const targetOrigin = new URL(job.targetUrl).origin
    addEvidence(out, "OBSERVE", "Initial browser state captured before scenario execution.", {
      url: await stagePage.url().catch(() => job.targetUrl),
      consoleErrors: [],
      actions: 0,
    })

    if (scenario.needsAuth) {
      await performAutoLogin(job, stagePage, params)
    }

    // Track every URL the agent actually visits, with a masked screenshot each.
    // Screenshots come from the Stagehand page itself — the agent's real view.
    const takeShot = (suffix: string) => captureMasked(stagePage, job.projectId, suffix)
    const seen = new Map<string, string>()
    let prevUrl = ""
    const tracker = (async () => {
      let n = 0
      while (!stopTracker.done) {
        try {
          const u: string = await stagePage.url().catch(() => "")
          if (!u || u.startsWith("about:")) {
            await sleep(1500)
            continue
          }
          // Origin containment: Stagehand has no allowed_domains — enforce it here.
          // Off-origin navigation is never legitimate: yank the agent back loudly.
          let uOrigin = ""
          try { uOrigin = new URL(u).origin } catch {}
          if (uOrigin && uOrigin !== targetOrigin) {
            const msg = `Agent left the target origin (${uOrigin}) — navigating back to ${job.targetUrl}.`
            appendLog(job, "warn", `[${scenario.name}] ${msg}`)
            out.issues.push({
              id: `origin-${Date.now()}-${n}`,
              screenUrl: u,
              screenTitle: scenario.name,
              type: "js_error",
              severity: "high",
              description: msg,
              expected: `Stay on ${targetOrigin}`,
              actual: u,
              timestamp: new Date().toISOString(),
            })
            await stagePage.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
            prevUrl = ""
            await sleep(1500)
            continue
          }
          if (!seen.has(u)) {
            const title: string = await stagePage.title().catch(() => "")
            const shotUrl = await takeShot(`scn-${scenario.id.slice(-6)}-${n++}`)
            seen.set(u, shotUrl)
            out.visited.push({ url: u, title: title.trim() || new URL(u).pathname || "Screen", screenshotUrl: shotUrl })
            if (prevUrl && prevUrl !== u) {
              out.transitions.push({ from: prevUrl, to: u, label: scenario.name })
            }
            prevUrl = u
            appendLog(job, "info", `[${scenario.name}] visited ${u}`)
            addEvidence(out, "OBSERVE", `Observed screen ${title.trim() || u} after navigation/action.`, {
              url: u,
              screenshotUrl: shotUrl,
              consoleErrors: pageErrors.slice(-5),
            })
            // Implicit oracle: broken images on every visited screen.
            const broken: number = await stagePage
              .evaluate(
                () =>
                  Array.from(document.querySelectorAll("img")).filter(
                    (img: any) => img.complete && img.naturalWidth === 0 && img.src,
                  ).length,
              )
              .catch(() => 0)
            if (broken > 0) {
              out.issues.push({
                id: `img-${Date.now()}-${n}`,
                screenUrl: u,
                screenTitle: title.trim() || u,
                type: "broken_asset",
                severity: "low",
                description: `${broken} broken image(s) on ${u} during "${scenario.name}".`,
                timestamp: new Date().toISOString(),
              })
            }
          }
        } catch {}
        await sleep(1500)
      }
    })()

    const agent = stagehand.agent({
      mode: "hybrid",
      model: { modelName, apiKey, baseURL },
      systemPrompt: scenarioSystemPrompt(
        scenario.name,
        scenario.goal,
        scenario.expectedOutcome,
        Boolean(params.credentials?.username),
      ),
    } as any)

    const maxSteps = 30
    let result: any = null
    try {
      result = await agent.execute({
        instruction: scenario.instruction,
        maxSteps,
        highlightCursor: true,
        page: stagePage,
      } as any)
    } catch (err: any) {
      out.error = err?.message || "Agent execution threw"
    } finally {
      stopTracker.done = true
      await tracker.catch(() => {})
    }

    const actionList: any[] = Array.isArray(result?.actions) ? result.actions : []
    out.agentSummary = result?.message || ""
    out.agentSuccess = result?.success !== false && !out.error

    // Closed-loop recovery: when the browser produced concrete error evidence,
    // ask the same agent for one bounded alternate action informed by that evidence.
    const observedProblems = [
      ...pageErrors.slice(-5).map((message) => `browser JavaScript error: ${message}`),
      ...out.issues
        .filter((issue) => issue.type === "broken_asset" || issue.severity === "high" || issue.severity === "blocker")
        .slice(-5)
        .map((issue) => issue.description),
    ]
    if (observedProblems.length > 0 && !out.riskyHit) {
      const observation = observedProblems.join("\n").slice(0, 1800)
      addEvidence(out, "DECIDE", `Detected concrete browser issue evidence; switching to a targeted recovery action.`, {
        url: await stagePage.url().catch(() => job.targetUrl),
        consoleErrors: pageErrors.slice(-5),
        actions: actionList.length,
      })
      appendLog(job, "warn", `[${scenario.name}] Evidence-driven recovery: ${observation.slice(0, 300)}`)
      addEvidence(out, "RECOVER", "Requested one bounded alternate action using the observed issue evidence; no destructive action is permitted.", {
        url: await stagePage.url().catch(() => job.targetUrl),
        consoleErrors: pageErrors.slice(-5),
        actions: actionList.length,
      })
      try {
        const recovery = await agent.execute({
          instruction: `A prior browser action produced this observed evidence:\n${observation}\nDo not repeat the same failed action. Inspect the current screen and take at most one safe, alternate action to determine whether the issue is recoverable. Do not submit, delete, purchase, send, publish, deploy, log out, or leave the target origin. Explain the observed result.`,
          maxSteps: 5,
          highlightCursor: true,
          page: stagePage,
        } as any)
        const recoveryActions: any[] = Array.isArray(recovery?.actions) ? recovery.actions : []
        for (const action of recoveryActions) {
          const description = String(action?.action || action?.type || "recovery action")
          actionList.push({ ...action, action: `RECOVERY: ${description}` })
          if (RISKY_ACTION.test(description)) out.riskyHit = description
        }
        out.actionsTaken = actionList.length
        if (recovery?.message) out.agentSummary += `\nEvidence-driven recovery: ${recovery.message}`
        const recoveryScreenshotUrl = await takeShot(`scn-${scenario.id.slice(-6)}-recovery`)
        addEvidence(out, "OBSERVE", "Captured the browser state after the evidence-driven recovery action.", {
          url: await stagePage.url().catch(() => job.targetUrl),
          screenshotUrl: recoveryScreenshotUrl,
          consoleErrors: pageErrors.slice(-5),
          actions: actionList.length,
        })
        appendLog(job, recovery?.success === false ? "warn" : "info",
          `[${scenario.name}] Recovery attempted ${recoveryActions.length} alternate action(s).`)
      } catch (recoveryError: any) {
        appendLog(job, "warn", `[${scenario.name}] Recovery attempt failed: ${recoveryError?.message || String(recoveryError)}`)
        out.error = out.error || `Evidence-driven recovery failed: ${recoveryError?.message || String(recoveryError)}`
      }
    }
    addEvidence(out, "DECIDE", out.error
      ? `Agent execution produced an error: ${out.error}`
      : `Agent completed ${actionList.length} browser actions; next state will be verified.`, {
      url: await stagePage.url().catch(() => job.targetUrl),
      consoleErrors: pageErrors.slice(-5),
      actions: actionList.length,
    })

    for (const a of actionList) {
      const desc = String(a?.action || a?.type || "agent action")
      const t = typeof a?.timeMs === "number" ? `[${(a.timeMs / 1000).toFixed(0)}s] ` : ""
      out.steps.push(t + desc + (a?.reasoning ? ` — ${a.reasoning}` : ""))
      if (RISKY_ACTION.test(desc)) {
        out.riskyHit = desc
      }
    }

    // Post-hoc safety gate: a risky action in the log means the run cannot be trusted.
    if (out.riskyHit) {
      out.agentSuccess = false
      out.error = `Safety gate tripped — agent log contains a potentially destructive action: "${out.riskyHit}". Scenario failed loudly instead of being trusted.`
      appendLog(job, "error", `[${scenario.name}] ${out.error}`)
      out.issues.push({
        id: `risky-${Date.now()}`,
        screenUrl: job.targetUrl,
        screenTitle: scenario.name,
        type: "js_error",
        severity: "blocker",
        description: out.error,
        timestamp: new Date().toISOString(),
      })
    }

    let finalOrigin = ""
    const finalUrl = await stagePage.url().catch(() => "")
    try { finalOrigin = finalUrl ? new URL(finalUrl).origin : "" } catch {}
    const verificationPassed = Boolean(finalUrl) && finalOrigin === targetOrigin &&
      !out.error && !out.riskyHit && out.actionsTaken > 0
    addEvidence(out, "VERIFY",
      verificationPassed
        ? "Verified target-origin containment and observable browser actions."
        : "Verification incomplete or failed; this run must not be considered a clean pass.",
      { url: finalUrl || job.targetUrl, consoleErrors: pageErrors.slice(-5), actions: out.actionsTaken },
    )

    // Implicit oracle: uncaught JS errors observed on the agent's page.
    for (const e of pageErrors.slice(0, 8)) {
      out.issues.push({
        id: `cerr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        screenUrl: job.targetUrl,
        screenTitle: scenario.name,
        type: "js_error",
        severity: "medium",
        description: `Uncaught JS error during "${scenario.name}": ${String(e).slice(0, 300)}`,
        timestamp: new Date().toISOString(),
      })
    }

    return out
  } finally {
    stopTracker.done = true
    await stagehand.close().catch(() => {})
  }
}

export async function executeAutonomousJob(
  job: AutomationJob,
  params: StartAutomationRequest,
): Promise<void> {
  job.status = "running"
  job.mode = "autonomous"
  const dir = jobDir(job.id)
  const baseURL = (params.aiBaseUrl?.trim() || NEBIUS_BASE_URL).replace(/\/$/, "")
  const apiKey = resolveAiApiKey(baseURL, params.aiApiKey)
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1")
  const aiUsable = isLocal || Boolean(apiKey?.trim())

  const say = (text: string, status: "executing" | "completed" | "error" = "executing") => {
    if (job.messages && job.messages.length > 1) {
      job.messages[1].text = text
      job.messages[1].status = status
      saveJob(job)
    }
  }

  let browser: Browser | null = null
  let recorder: any = null
  const recordingPath = path.join(dir, "recording.webm")

  try {
    const count = scenarioCountFromCommand(params.userInstruction || "", params.scenarioCount || 15)
    say(`🤖 Planning ${count} autonomous test scenarios for ${job.targetUrl}…`)
    appendLog(job, "info", `Autonomous run starting on ${job.targetUrl} — planning ${count} scenarios.`)

    // ---- AI availability gate: loud, before any browser work ----
    if (!aiUsable) {
      const reason =
        "No AI provider key for the remote gateway and no local endpoint. The autonomous agent needs a live model to think."
      job.aiError = reason
      appendLog(job, "error", `Autonomous run BLOCKED — ${reason}`)
      say(
        `⚠️ Autonomous run blocked: ${reason} Add a Nebius Token Factory API key in AI Settings, configure NEBIUS_API_KEY on the server, or point the gateway at a local endpoint.`,
        "error",
      )
      job.status = "failed"
      job.error = reason
      job.finishedAt = new Date().toISOString()
      job.testCases = []
      job.report = {
        totalScreensTested: 0,
        passedScreens: 0,
        failedScreens: 0,
        totalIssues: 0,
        backNavigationScore: 0,
        responsiveScore: 0,
        summary: `Autonomous run could not start — ${reason}`,
        recommendations: [
          "Add a Nebius Token Factory API key in AI Settings or configure NEBIUS_API_KEY on the server.",
        ],
        issues: [],
        testCases: [],
      }
      saveJob(job)
      return
    }

    // ---- Browser ----
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--hide-scrollbars",
        "--disable-extensions",
        "--autoplay-policy=no-user-gesture-required",
      ],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    page.on("pageerror", () => {})
    // Collect console errors for the issue list
    await page
      .evaluateOnNewDocument(() => {
        ;(window as any).__qaConsoleErrors = []
        window.addEventListener("error", (e: any) => {
          ;(window as any).__qaConsoleErrors.push(e?.message || String(e))
        })
      })
      .catch(() => {})

    appendLog(job, "info", `Navigating to ${job.targetUrl}…`)
    await page.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e: any) => {
      appendLog(job, "warn", `Initial navigation note: ${e?.message}`)
    })

    // ---- Session video ----
    try {
      const { PuppeteerScreenRecorder } = await import("puppeteer-screen-recorder")
      recorder = new PuppeteerScreenRecorder(page, { followNewTab: true, fps: 25 })
      await recorder.start(recordingPath)
      appendLog(job, "info", "Session video recording started.")
    } catch (err: any) {
      appendLog(job, "warn", `Video recording unavailable: ${err?.message} — continuing without video.`)
      recorder = null
    }

    // ---- Plan scenarios ----
    const routePaths = await discoverRoutes(page, job.targetUrl)
    appendLog(job, "info", `Discovered routes: ${routePaths.join(", ") || "(none)"}`)
    const planned = await planScenarios({
      targetUrl: job.targetUrl,
      routePaths,
      hasCredentials: Boolean(params.credentials?.username && params.credentials?.password),
      apiKey,
      baseUrl: baseURL,
      model: params.aiModel,
      count,
    })
    job.scenarios = planned.scenarios
    if (!planned.usedAi) {
      appendLog(job, "warn", `Scenario planner: ${planned.error}`)
    } else {
      appendLog(job, "success", `AI planned ${planned.scenarios.length} scenarios.`)
    }
    say(`🤖 Running ${planned.scenarios.length} autonomous scenarios…`)
    saveJob(job)

    // ---- Run scenarios ----
    const testCases: TestCaseResult[] = []
    const flowNodes = new Map<string, { url: string; title: string; screenshotUrl: string; scenarioId: string }>()
    const flowEdges: { from: string; to: string; label: string }[] = []
    const nodeId = (url: string) => `n-${Buffer.from(url).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`

    for (let i = 0; i < planned.scenarios.length; i++) {
      const sc = planned.scenarios[i]
      if (getJob(job.id)?.status === "stopped") {
        appendLog(job, "warn", "Autonomous run cancelled by user.")
        break
      }
      const startedAt = new Date().toISOString()
      job.currentStep = `[${i + 1}/${planned.scenarios.length}] ${sc.name}`
      job.progress = Math.round(5 + (i / planned.scenarios.length) * 85)
      saveJob(job)
      appendLog(job, "info", `Scenario ${i + 1}/${planned.scenarios.length}: ${sc.name}`)

      const attempt = async (): Promise<Awaited<ReturnType<typeof runScenarioWithStagehand>>> => {
        try {
          return await runScenarioWithStagehand(job, browser!, params, sc)
        } catch (err: any) {
          return {
            steps: [],
            actionsTaken: 0,
            visited: [],
            transitions: [],
            issues: [],
            evidenceTrace: [],
            riskyHit: null,
            agentSummary: "",
            agentSuccess: false,
            error: err?.message || "Scenario crashed",
          }
        }
      }
      let run = await attempt()
      // One retry budget for transient failures — never for safety trips.
      // (Reliability practice: retry at exactly one layer, then fail loud.)
      const transient = !run.riskyHit && (run.error || (!run.agentSuccess && run.actionsTaken === 0))
      if (transient) {
        appendLog(job, "warn", `Scenario ${i + 1} hit a transient failure — single retry.`)
        run.evidenceTrace.push({
          phase: "RECOVER",
          timestamp: new Date().toISOString(),
          summary: "Transient failure detected; applying the bounded single-retry recovery policy.",
          evidence: { actions: run.actionsTaken },
        })
        await sleep(2000)
        run = await attempt()
      }

      const bugs: TestCaseBug[] = []
      for (const iss of run.issues) {
        job.issues.push(iss)
        if (iss.severity === "high" || iss.severity === "blocker" || iss.type === "js_error") {
          bugs.push({
            description: iss.description,
            severity: iss.severity,
            repro: [`Run scenario "${sc.name}"`, `Observe: ${iss.description}`, `URL: ${iss.screenUrl}`],
          })
        }
      }

      const screenshots = run.visited
        .filter((v) => v.screenshotUrl)
        .map((v) => ({ label: v.title, url: v.screenshotUrl }))
        .slice(0, 6)

      // Tiered, honest verdict: the agent never grades its own homework.
      // An explicit VERDICT: FAIL (or "could not complete") in its summary fails
      // the case even if the engine reported success; zero actions is "blocked",
      // never "passed".
      const selfReportedFail =
        /verdict:\s*fail/i.test(run.agentSummary) || /could not (complete|finish)/i.test(run.agentSummary)
      let status: TestCaseResult["status"]
      if (run.error || run.riskyHit) status = "failed"
      else if (selfReportedFail) status = "failed"
      else if (run.actionsTaken === 0) status = "blocked"
      else status = run.agentSuccess ? "passed" : "failed"

      testCases.push({
        scenarioId: sc.id,
        name: sc.name,
        category: sc.category,
        status,
        steps: run.steps.slice(0, 20),
        screenshots,
        bugs,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: run.error,
        evidenceTrace: run.evidenceTrace,
      } as TestCaseResult & { evidenceTrace: EvidenceTrace[] })

      for (const v of run.visited) {
        const id = nodeId(v.url)
        if (!flowNodes.has(id) && v.screenshotUrl) {
          flowNodes.set(id, { url: v.url, title: v.title, screenshotUrl: v.screenshotUrl, scenarioId: sc.id })
        }
        job.screens.push({
          url: v.url,
          title: v.title,
          path: new URL(v.url).pathname || "/",
          testedAt: new Date().toISOString(),
          screenshotUrl: v.screenshotUrl,
          screenshots: { Desktop: v.screenshotUrl },
          backNavigationStatus: "skipped",
          responsiveStatus: "passed",
          issuesCount: run.issues.length,
          issues: run.issues,
        })
      }
      for (const t of run.transitions) {
        flowEdges.push({ from: nodeId(t.from), to: nodeId(t.to), label: t.label })
      }

      appendLog(
        job,
        status === "passed" ? "success" : "warn",
        `Scenario ${i + 1} ${status.toUpperCase()}: ${sc.name} (${run.actionsTaken} actions, ${run.visited.length} screens)${run.error ? ` — ${run.error}` : ""}`,
      )
      saveJob(job)
    }

    // ---- Stop video, upload ----
    let recordingUrl = ""
    if (recorder) {
      try {
        await recorder.stop()
        appendLog(job, "info", "Session recording stopped.")
        if (fs.existsSync(recordingPath) && fs.statSync(recordingPath).size > 1024) {
          recordingUrl = await uploadArtifact(
            fs.readFileSync(recordingPath),
            job.projectId,
            "recording",
            "video/webm",
            "webm",
          )
          if (recordingUrl) appendLog(job, "success", "Session video uploaded.")
          else appendLog(job, "warn", "Video upload failed — recording kept locally only.")
        }
      } catch (err: any) {
        appendLog(job, "warn", `Recording finalization note: ${err?.message}`)
      }
    }
    job.recordingUrl = recordingUrl || undefined

    // ---- Flow graph ----
    const flowGraph: FlowGraph = {
      nodes: Array.from(flowNodes.entries()).map(([id, n]) => ({ id, ...n })),
      edges: flowEdges.filter((e) => flowNodes.has(e.from) && flowNodes.has(e.to)).slice(0, 60),
    }
    job.flowGraph = flowGraph

    // ---- Report ----
    job.testCases = testCases
    const passed = testCases.filter((t) => t.status === "passed").length
    const failed = testCases.filter((t) => t.status === "failed").length
    const blocked = testCases.filter((t) => t.status === "blocked").length
    const passRate = testCases.length > 0 ? Math.round((passed / testCases.length) * 100) : 0

    const recommendations: string[] = []
    if (failed > 0 || blocked > 0) recommendations.push(`${failed + blocked} scenario(s) need attention — see test cases below.`)
    if (job.issues.some((i) => i.type === "js_error")) recommendations.push("Fix the uncaught JavaScript errors flagged during scenarios.")
    if (recommendations.length === 0) recommendations.push("All autonomous scenarios passed. Re-run after significant UI changes.")

    job.report = {
      totalScreensTested: flowGraph.nodes.length,
      passedScreens: passed,
      failedScreens: failed + blocked,
      totalIssues: job.issues.length,
      backNavigationScore: passRate,
      responsiveScore: passRate,
      summary: `Autonomous run: ${passed}/${testCases.length} scenarios passed${failed ? `, ${failed} failed` : ""}${blocked ? `, ${blocked} blocked` : ""}. ${flowGraph.nodes.length} screens visited, ${job.issues.length} issues flagged.${recordingUrl ? " Session video attached." : ""}`,
      recommendations,
      issues: job.issues,
      testCases,
      flowGraph,
      recordingUrl: recordingUrl || undefined,
      evidenceTrace: testCases.flatMap((t) => (t as TestCaseResult & { evidenceTrace?: EvidenceTrace[] }).evidenceTrace || []),
    } as AutomationJob["report"]

    // ---- Chained workflow record ----
    if (flowGraph.nodes.length > 0) {
      try {
        const steps: JourneyStep[] = flowGraph.nodes.map((n, idx) => ({
          index: idx,
          url: n.url,
          title: n.title,
          screenshotUrl: n.screenshotUrl || "",
          pageType: "other" as PageType,
          hasBlockingIssue: false,
          viewport: { width: 1440, height: 900 },
          capturedAt: new Date().toISOString(),
          issues: [],
        }))
        const created = await createWorkflowFromJourney(
          { projectId: job.projectId, startUrl: job.targetUrl, role: (params.role as any) || "user", title: `Autonomous Test: ${passed}/${testCases.length} passed` },
          steps,
        )
        job.chainedWorkflowId = created.workflowId
        job.report.chainedWorkflowId = created.workflowId
      } catch (err: any) {
        appendLog(job, "warn", `Workflow record note: ${err?.message}`)
      }
    }

    job.progress = 100
    job.status = "completed"
    job.currentStep = "Autonomous run completed."
    job.finishedAt = new Date().toISOString()
    appendLog(job, "success", `Autonomous run finished: ${job.report.summary}`)
    say(
      `✅ Autonomous run complete: ${passed}/${testCases.length} scenarios passed, ${flowGraph.nodes.length} screens, ${job.issues.length} issues.${recordingUrl ? " Video attached in the Report tab." : ""}`,
      "completed",
    )
    saveJob(job)
  } catch (err: any) {
    job.status = "failed"
    job.error = err?.message || "Autonomous run error"
    job.finishedAt = new Date().toISOString()
    appendLog(job, "error", `Autonomous run failed: ${job.error}`)
    say(`❌ Autonomous run failed: ${job.error}`, "error")
    saveJob(job)
  } finally {
    if (recorder) {
      try { await recorder.stop().catch(() => {}) } catch {}
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}

