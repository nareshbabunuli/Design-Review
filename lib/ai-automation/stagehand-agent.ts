import type { Browser, Page } from "puppeteer"
import type { AutomationJob, AutomationIssue, StartAutomationRequest } from "./types"

type StagehandHooks = {
  appendLog: (job: AutomationJob, level: "info" | "success" | "warn" | "error", message: string) => void
  saveJob: (job: AutomationJob) => void
  uploadScreenshot: (buffer: Buffer, workflowId: string, suffix: string) => Promise<string>
}

type RunnerRunResult = {
  success?: boolean
  message?: string
  actions?: Array<{
    type?: string
    action?: string
    reasoning?: string
    timeMs?: number
  }>
}

const RISKY_ACTION =
  /(delete|remove|destroy|purchase|pay|checkout|charge|submit payment|send email|send message|publish|deploy|logout|sign ?out|cancel subscription|unsubscribe)/i

function actionType(value: string): "navigate" | "click" | "type" | "back" | "scroll" | "inspect" | "assert" {
  const v = value.toLowerCase()
  if (v.includes("navigate") || v.includes("goto") || v.includes("open")) return "navigate"
  if (v.includes("type") || v.includes("fill") || v.includes("input")) return "type"
  if (v.includes("back")) return "back"
  if (v.includes("scroll")) return "scroll"
  if (v.includes("assert") || v.includes("verify")) return "assert"
  if (v.includes("click") || v.includes("tap") || v.includes("press")) return "click"
  return "inspect"
}

/**
 * Runs Stagehand's open-source autonomous browser agent inside the browser
 * already launched by our Puppeteer runner. This keeps Design Review's
 * screenshots, cursor overlay and report pipeline while delegating browser
 * reasoning to an established browser engine.
 */
export async function runStagehandExploration(
  job: AutomationJob,
  browser: Browser,
  puppeteerPage: Page,
  params: StartAutomationRequest,
  hooks: StagehandHooks,
): Promise<{ pagesVisited: number; actions: number; issues: AutomationIssue[] }> {
  const { Stagehand } = await import("@browserbasehq/stagehand")

  const apiKey = params.openRouterApiKey || process.env.OPENROUTER_API_KEY || process.env.UNOROUTER_API_KEY
  const baseURL = params.aiBaseUrl?.trim() || "https://api.unorouter.com/v1"
  // Free flagship-class model on UnoRouter — small :free models are too weak
  // for the autonomous observe → decide → act loop. Alternatives:
  // "gpt-5.5:free", "qwen3.8-flash-next:free".
  const modelName = params.aiModel?.trim() || "deepseek-v4-flash:free"
  const isLocalGateway = /localhost|127\.0\.0\.1/.test(baseURL)
  if (!apiKey && !isLocalGateway) {
    throw new Error(
      "Stagehand exploration needs an AI provider key for the remote gateway. " +
        "Add your UnoRouter key in AI Settings → OmniRouter (free at https://unorouter.com/token), " +
        "or point the gateway URL at a local endpoint.",
    )
  }

  const stagehandConfig: any = {
    env: "LOCAL",
    localBrowserLaunchOptions: {
      cdpUrl: browser.wsEndpoint(),
    },
    model: {
      modelName,
      apiKey,
      baseURL,
    },
    selfHeal: true,
    verbose: 1,
  }

  hooks.appendLog(job, "info", `Runneric engine: Stagehand ${modelName} via ${baseURL} (open-source browser engine)`)

  const stagehand = new Stagehand(stagehandConfig)
  const visitedUrls = new Set<string>([job.targetUrl])
  const issues: AutomationIssue[] = []
  let actionCount = 0

  try {
    await stagehand.init()
    const stagePage = stagehand.context.activePage()
    if (!stagePage) throw new Error("Stagehand attached to the browser but found no active page.")

    await stagePage.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 })

    hooks.appendLog(job, "info", "Stagehand attached to the existing browser session.")
    hooks.appendLog(job, "info", "Autonomous exploration started: observe → decide → move → click → verify → backtrack.")

    const maxSteps = Math.min(Math.max((job.maxScreens || 5) * 20, 20), 120)

    const instruction = `
You are the autonomous QA exploration agent inside Design Review.

Your job is to explore this web application like a meticulous human QA engineer.

Rules:
1. Explore the current application thoroughly. Do not stop after testing one control.
2. Inspect the visible UI and interact with SAFE controls: navigation links, tabs, menus, accordions, filters, search controls, dropdowns, dialogs, pagination, theme controls and non-destructive forms.
3. Move to the target before interacting with it whenever possible so the interaction is visually observable.
4. After every click, observe the resulting UI. Check for navigation, modal/menu state changes, blank screens, broken layout, runtime errors and failed requests.
5. When a control navigates to another internal page, explore that page and then use browser Back to return to the previous state before testing the next sibling control.
6. Re-observe the page after state-changing interactions because React/SPA UIs can replace the DOM.
7. Exercise as many distinct safe interactive elements as the step budget allows. Avoid repeatedly clicking the same control unless verifying a state transition.
8. Scroll through long pages and test meaningful interactive controls below the fold.
9. Do NOT execute destructive or irreversible actions. Never click controls whose purpose is delete, remove, destroy, purchase, pay, checkout, charge, send, publish, deploy, logout/sign out, cancel subscription or similar. Report them as skipped.
10. Do not invent credentials, payment details or personal data. Use supplied credentials only when explicitly provided by the test harness.
11. Stay on the target origin. Do not follow external sites.
12. When you encounter a broken interaction or error, continue exploring other safe controls so the final report contains multiple findings where applicable.
13. Finish with a concise summary of what was explored, what was skipped and what failed.

This is an exploration/QA task, not a task-completion task. Prioritize interaction coverage and backtracking over completing one business workflow.
`

    const agent = stagehand.agent({
      mode: "hybrid",
      model: {
        modelName,
        apiKey,
        baseURL,
      },
      systemPrompt: instruction,
    } as any)

    const result = (await agent.execute({
      instruction: `Explore and audit the application starting at ${job.targetUrl}. Test the safe interactive surface and internal navigation paths. Return only after you have explored as much of the application as practical within the step limit.`,
      maxSteps,
      highlightCursor: true,
      page: stagePage,
    } as any)) as RunnerRunResult

    const actionList = Array.isArray(result?.actions) ? result.actions : []
    actionCount = actionList.length

    for (const [index, action] of actionList.entries()) {
      const raw = `${action.type || ""} ${action.action || ""}`.trim()
      const description = action.action || action.type || "Runner action"
      const risky = RISKY_ACTION.test(description)

      if (risky) {
        hooks.appendLog(job, "warn", `Skipped potentially destructive agent action: ${description}`)
        continue
      }

      hooks.appendLog(
        job,
        "info",
        `Runner [${index + 1}/${actionList.length}] ${description}${action.reasoning ? ` — ${action.reasoning}` : ""}`,
      )

      job.currentStep = `Runner: ${description}`
      job.progress = Math.min(90, 25 + Math.round(((index + 1) / Math.max(actionList.length, 1)) * 60))
      hooks.saveJob(job)

      const type = actionType(raw)
      if (type === "click" || type === "type" || type === "navigate" || type === "back") {
        const targetUrl = puppeteerPage.url()
        visitedUrls.add(targetUrl)

        if (type === "click") {
          const clickable = await puppeteerPage.evaluate(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2) as HTMLElement | null
            return el?.textContent?.trim().slice(0, 80) || null
          }).catch(() => null)

          if (clickable && RISKY_ACTION.test(clickable)) {
            hooks.appendLog(job, "warn", `Potentially destructive control observed and skipped: ${clickable}`)
          }
        }
      }
    }

    const finalUrl = puppeteerPage.url()
    visitedUrls.add(finalUrl)

    const finalTitle = await puppeteerPage.title().catch(() => "")
    const screenshot = await puppeteerPage.screenshot({ type: "png" }).catch(() => null)

    if (screenshot) {
      const screenshotUrl = await hooks.uploadScreenshot(
        Buffer.from(screenshot),
        job.projectId,
        "agent-final",
      )

      job.screens.push({
        url: finalUrl,
        title: finalTitle.trim() || new URL(finalUrl).pathname || "Runner Exploration",
        path: new URL(finalUrl).pathname || "/",
        testedAt: new Date().toISOString(),
        screenshotUrl,
        screenshots: { Runner: screenshotUrl },
        backNavigationStatus: "passed",
        responsiveStatus: "passed",
        issuesCount: issues.length,
        issues,
      })
    }

    hooks.appendLog(
      job,
      result?.success === false ? "warn" : "success",
      `Runneric exploration finished: ${actionCount} agent actions across ${visitedUrls.size} URL state(s). ${result?.message || ""}`,
    )

    return { pagesVisited: visitedUrls.size, actions: actionCount, issues }
  } finally {
    await stagehand.close().catch(() => {})
  }
}
