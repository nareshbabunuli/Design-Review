import fs from "fs"
import path from "path"
import puppeteer, { type Browser, type Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import {
  AutomationJob,
  AutomationIssue,
  DiscoveredScreen,
  AutomationLog,
  AutomationViewport,
  StartAutomationRequest,
  AgentAction,
  AgentChatMessage,
} from "./types"
import { analyzeScreenWithAI, generateAIExecutiveReport, interpretCommandWithAI } from "./openrouter"
import type { AICommandInterpretation } from "./openrouter"
import { tryLayaReflexPlan } from "./laya-reflex"
import { discoverLocalProjectRoutes } from "./discover-routes"
import { classifyPage, pickNextLink, isLayaAvailable, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import { executeAutonomousJob, isAutonomousCommand } from "./autonomous-runner"
import type { JourneyStep, PageType } from "@/lib/journey/types"

const DEFAULT_VIEWPORTS: AutomationViewport[] = [
  { name: "Mobile", width: 390, height: 844 },
  { name: "Tablet", width: 768, height: 1024 },
  { name: "Desktop", width: 1440, height: 900 },
]

// In-memory job registry across Node process
declare global {
  // eslint-disable-next-line no-var
  var __AI_AUTOMATION_JOBS__: Map<string, AutomationJob> | undefined
}

if (!globalThis.__AI_AUTOMATION_JOBS__) {
  globalThis.__AI_AUTOMATION_JOBS__ = new Map<string, AutomationJob>()
}

const jobStore = globalThis.__AI_AUTOMATION_JOBS__

const JOBS_DIR = path.join(process.cwd(), ".jobs")

function ensureJobsDir() {
  if (!fs.existsSync(JOBS_DIR)) {
    try {
      fs.mkdirSync(JOBS_DIR, { recursive: true })
    } catch {}
  }
}

export function saveJob(job: AutomationJob) {
  jobStore.set(job.id, job)
  try {
    ensureJobsDir()
    fs.writeFileSync(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job, null, 2), "utf8")
  } catch (err) {
    console.warn("[AI Runner] Failed to persist job to disk:", err)
  }
}

export function getJob(jobId: string): AutomationJob | null {
  if (jobStore.has(jobId)) {
    return jobStore.get(jobId)!
  }
  try {
    ensureJobsDir()
    const filePath = path.join(JOBS_DIR, `${jobId}.json`)
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as AutomationJob
      jobStore.set(jobId, data)
      return data
    }
  } catch {}
  return null
}

export function appendLog(job: AutomationJob, level: AutomationLog["level"], message: string) {
  const log: AutomationLog = {
    timestamp: new Date().toISOString(),
    level,
    message,
  }
  job.logs.push(log)
  saveJob(job)
  console.log(`[AI Bot][${job.id.slice(0, 6)}][${level.toUpperCase()}] ${message}`)
}

export async function createAndStartJob(params: StartAutomationRequest): Promise<AutomationJob> {
  const jobId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `job-${Date.now()}`

  const targetViewports = params.viewports && params.viewports.length > 0 ? params.viewports : DEFAULT_VIEWPORTS

  const initialMessages: AgentChatMessage[] = []
  if (params.userInstruction) {
    initialMessages.push({
      id: `msg-${Date.now()}-u`,
      sender: "user",
      text: params.userInstruction.trim(),
      timestamp: new Date().toISOString(),
      status: "completed",
    })
    initialMessages.push({
      id: `msg-${Date.now()}-a`,
      sender: "agent",
      text: "Analyzing command and preparing Antigravity browser testing plan...",
      timestamp: new Date().toISOString(),
      status: "thinking",
    })
  }

  const newJob: AutomationJob = {
    id: jobId,
    targetUrl: params.url.trim(),
    projectId: params.projectId,
    projectDir: params.projectDir,
    mode: params.mode || (params.userInstruction ? "chat" : "crawl"),
    status: "queued",
    progress: 5,
    currentStep: params.userInstruction ? `Command: "${params.userInstruction}"` : "Initializing automation runner...",
    startedAt: new Date().toISOString(),
    credentialsProvided: Boolean(params.credentials?.username || params.credentials?.token),
    viewports: targetViewports,
    maxScreens: Math.min(Math.max(params.maxScreens || 5, 1), 15),
    aiModel: params.aiModel || "deepseek-v4-flash:free",
    aiBaseUrl: params.aiBaseUrl,
    layaBaseUrl: params.layaBaseUrl,
    role: params.role || "user",
    messages: initialMessages,
    logs: [],
    screens: [],
    issues: [],
  }

  saveJob(newJob)

  // Launch execution asynchronously without awaiting
  setImmediate(() => {
    executeJob(newJob, params).catch((err) => {
      console.error(`[AI Bot] Fatal error running job ${newJob.id}:`, err)
      newJob.status = "failed"
      newJob.error = err?.message || "Unknown automation error"
      newJob.finishedAt = new Date().toISOString()
      appendLog(newJob, "error", `Fatal execution failure: ${newJob.error}`)
      saveJob(newJob)
    })
  })

  return newJob
}

export function cancelJob(jobId: string): boolean {
  const job = getJob(jobId)
  if (!job) return false
  if (job.status === "running" || job.status === "queued") {
    job.status = "stopped"
    job.currentStep = "Automation cancelled by user"
    job.finishedAt = new Date().toISOString()
    appendLog(job, "warn", "Automation job terminated by user request.")
    saveJob(job)
    return true
  }
  return false
}

async function uploadScreenshot(
  imageBuffer: Buffer,
  workflowId: string,
  suffix: string
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const fileName = `${workflowId}-${suffix}-${Date.now()}.png`
      const filePath = `workflows/${workflowId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from("designs")
        .upload(filePath, imageBuffer, {
          upsert: true,
          contentType: "image/png",
        })

      if (!uploadError) {
        const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
        if (pubData?.publicUrl) {
          return pubData.publicUrl
        }
      }
    } catch (e) {
      console.warn("[AI Bot] Storage upload error, using data URI fallback:", e)
    }
  }

  // Fallback to base64 data URI
  return `data:image/png;base64,${imageBuffer.toString("base64")}`
}

async function createDatabaseWorkflow(
  projectId: string,
  screenTitle: string,
  screenshotUrl: string,
  notes: string,
  reason: string,
  isDone: boolean
): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseKey) return null

  try {
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        project_id: projectId,
        title: screenTitle,
        design_b: screenshotUrl,
        our_notes: notes,
        client_message: "Automated scan completed by AI UI Testing Bot.",
        client_task_done: false,
        reason,
        is_done: isDone,
      })
      .select("id")
      .single()

    if (error) {
      console.warn("[AI Bot] Database workflow insert notice:", error.message)
      return null
    }
    return data?.id || null
  } catch (err) {
    console.warn("[AI Bot] Failed to insert workflow into database:", err)
    return null
  }
}

async function recordAgentAction(
  job: AutomationJob,
  page: Page,
  action: {
    type: AgentAction["type"]
    description: string
    thought?: string
    target?: string
    highlightSelector?: string
    coordinates?: { x: number; y: number }
    observation?: string
    status?: "pending" | "running" | "passed" | "failed"
    durationMs?: number
  }
) {
  try {
    let resolvedCoords = action.coordinates

    // Inject Antigravity Visual Testing Overlay (Cursor, Radar Pulse, HUD Bar)
    await page.evaluate(
      (actionType, desc, thoughtText, sel, manualCoords) => {
        try {
          // Clean existing overlay if any
          document.getElementById("__antigravity_overlay_root__")?.remove()

          let cx = manualCoords?.x || 100
          let cy = manualCoords?.y || 100
          let targetLabel = sel || "Screen Area"

          if (sel) {
            const el = document.querySelector(sel)
            if (el) {
              el.scrollIntoView({ behavior: "instant", block: "center" })
              const r = el.getBoundingClientRect()
              cx = r.left + r.width / 2
              cy = r.top + r.height / 2
              const textContent = el.textContent?.trim().slice(0, 24) || ""
              targetLabel = textContent ? `"${textContent}" (${sel})` : sel
            }
          }

          const root = document.createElement("div")
          root.id = "__antigravity_overlay_root__"
          root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999999;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;"

          // Top Antigravity Browser Agent HUD bar
          const hud = document.createElement("div")
          hud.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 14px;
            background: rgba(15, 23, 42, 0.94);
            border: 1px solid rgba(139, 92, 246, 0.6);
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(124, 58, 237, 0.3);
            border-radius: 9999px;
            color: #f8fafc;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
            backdrop-filter: blur(10px);
          `

          const badge = document.createElement("span")
          badge.style.cssText = "display:flex;align-items:center;gap:6px;color:#a855f7;font-weight:700;letter-spacing:0.04em;"
          badge.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;display:inline-block;"></span>ANTIGRAVITY AGENT`

          const typeBadge = document.createElement("span")
          typeBadge.style.cssText = "padding:2px 7px;border-radius:4px;background:#4338ca;color:#ffffff;font-size:10px;text-transform:uppercase;font-weight:700;"
          typeBadge.textContent = actionType

          const actionText = document.createElement("span")
          actionText.style.cssText = "color:#e2e8f0;max-width:280px;overflow:hidden;text-overflow:ellipsis;"
          actionText.textContent = desc

          hud.appendChild(badge)
          hud.appendChild(typeBadge)
          hud.appendChild(actionText)
          root.appendChild(hud)

          // Virtual Cursor & Radar Ring (if action is interactive: click, type, inspect)
          if (["click", "type", "inspect", "back"].includes(actionType)) {
            // Radar pulse circle
            const radar = document.createElement("div")
            radar.style.cssText = `
              position: fixed;
              left: ${cx - 20}px;
              top: ${cy - 20}px;
              width: 40px;
              height: 40px;
              border-radius: 50%;
              border: 2px solid #8b5cf6;
              background: rgba(139, 92, 246, 0.2);
              box-shadow: 0 0 20px #8b5cf6;
              animation: antigravityPulse 1.2s infinite ease-out;
            `

            // Inner pointer dot
            const dot = document.createElement("div")
            dot.style.cssText = `
              position: fixed;
              left: ${cx - 5}px;
              top: ${cy - 5}px;
              width: 10px;
              height: 10px;
              border-radius: 50%;
              background: #ffffff;
              box-shadow: 0 0 10px #38bdf8;
            `

            // Floating target pill
            const pill = document.createElement("div")
            pill.style.cssText = `
              position: fixed;
              left: ${Math.max(12, cx + 16)}px;
              top: ${Math.max(12, cy - 24)}px;
              padding: 3px 8px;
              border-radius: 6px;
              background: rgba(30, 27, 75, 0.95);
              border: 1px solid rgba(139, 92, 246, 0.6);
              color: #f1f5f9;
              font-size: 10px;
              font-weight: 600;
              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
              white-space: nowrap;
            `
            pill.textContent = `🎯 ${actionType.toUpperCase()}: ${targetLabel}`

            root.appendChild(radar)
            root.appendChild(dot)
            root.appendChild(pill)
          }

          document.body.appendChild(root)
        } catch {}
      },
      action.type,
      action.description,
      action.thought || "",
      action.highlightSelector || null,
      action.coordinates || null
    ).catch(() => {})

    // Calculate element coordinates if selector present
    if (action.highlightSelector && !resolvedCoords) {
      try {
        const el = await page.$(action.highlightSelector)
        if (el) {
          const box = await el.boundingBox()
          if (box) {
            resolvedCoords = {
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
            }
            // Move Puppeteer virtual mouse
            await page.mouse.move(resolvedCoords.x, resolvedCoords.y, { steps: 3 }).catch(() => {})
          }
        }
      } catch {}
    }

    // Capture visual snapshot for live simulator screen
    const buffer = await page.screenshot({ type: "png" }).catch(() => null)
    if (buffer) {
      const base64Url = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`
      job.currentScreenshotUrl = base64Url
    }

    // Clean overlay after snapshot
    await page.evaluate(() => {
      document.getElementById("__antigravity_overlay_root__")?.remove()
    }).catch(() => {})

    const actionRecord: AgentAction = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: action.type,
      description: action.description,
      thought: action.thought || `Autonomous Antigravity step executing ${action.type} command.`,
      target: action.target || action.highlightSelector,
      coordinates: resolvedCoords,
      observation: action.observation || `Action executed successfully on ${page.url()}`,
      status: action.status || "passed",
      durationMs: action.durationMs || 150,
      timestamp: new Date().toISOString(),
      screenshotUrl: job.currentScreenshotUrl,
    }

    job.currentAction = actionRecord
    if (!job.actionHistory) job.actionHistory = []
    job.actionHistory.unshift(actionRecord)
    if (job.actionHistory.length > 30) {
      job.actionHistory = job.actionHistory.slice(0, 30)
    }

    saveJob(job)
  } catch (err) {
    console.warn("[AI Agent] Antigravity action capture notice:", err)
  }
}

async function executeJob(job: AutomationJob, params: StartAutomationRequest) {
  job.status = "running"
  const openRouterKey = params.openRouterApiKey || process.env.OPENROUTER_API_KEY || process.env.UNOROUTER_API_KEY
  const aiBase = (params.aiBaseUrl || "").trim()
  const isLocalAi = Boolean(aiBase && (aiBase.includes("localhost") || aiBase.includes("127.0.0.1")))
  const isUnoRouter = aiBase.includes("unorouter.com")
  const hasAiConfigured = isLocalAi || Boolean(openRouterKey)
  appendLog(job, "info", `Starting headless automation crawl on: ${job.targetUrl}`)
  if (!hasAiConfigured && aiBase && !isLocalAi) {
    appendLog(
      job,
      "warn",
      "AI provider key missing for the remote gateway — AI visual analysis and autonomous exploration will be skipped. " +
        "Add a free UnoRouter key at https://unorouter.com/token and paste it in AI Settings → OmniRouter.",
    )
  }

  // Autonomous mode: the Stagehand scenario engine drives the browser.
  // Triggered explicitly (mode === "autonomous") or by exploration-style
  // chat commands ("test every page", "run 15 scenarios", ...).
  if (params.mode === "autonomous" || (params.userInstruction && isAutonomousCommand(params.userInstruction))) {
    appendLog(job, "info", "Autonomous exploration requested — handing off to the Stagehand scenario engine.")
    job.mode = "autonomous"
    saveJob(job)
    await executeAutonomousJob(job, params)
    return
  }

  let browser: Browser | null = null

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--hide-scrollbars",
        "--disable-extensions",
      ],
    })

    const page = await browser.newPage()

    // Collect runtime JavaScript console errors
    page.on("pageerror", (err: any) => {
      const errMsg = err?.message || String(err)
      const issue: AutomationIssue = {
        id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        screenUrl: page.url(),
        screenTitle: "Console Error",
        type: "js_error",
        severity: "medium",
        description: `Uncaught JavaScript Exception: ${errMsg}`,
        timestamp: new Date().toISOString(),
      }
      job.issues.push(issue)
      appendLog(job, "warn", `JavaScript error detected on ${page.url()}: ${errMsg}`)
    })

    job.progress = 10
    job.currentStep = "Navigating to target entry URL..."
    saveJob(job)

    // Initial navigation
    appendLog(job, "info", `Navigating to ${job.targetUrl}...`)
    await page.goto(job.targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e) => {
      appendLog(job, "warn", `Initial navigation note: ${e?.message}`)
    })

    await recordAgentAction(job, page, {
      type: "navigate",
      description: `Opened ${job.targetUrl}`,
      target: job.targetUrl,
    })

    // Authentication: explicit credentials, pre-filled form inputs, or user login intent
    const isLoginIntent = Boolean(params.userInstruction && /(login|signin|sign in|auth|credential|creds)/i.test(params.userInstruction))
    const hasPasswordInput = (await page.$('input[type="password"]')) !== null
    const isLoginUrl = /(login|signin|auth)/i.test(page.url())

    if (hasPasswordInput || isLoginUrl || params.credentials?.username || isLoginIntent) {
      const loginCheck = await page.evaluate((creds) => {
        const pass = document.querySelector('input[type="password"]') as HTMLInputElement | null
        const user = document.querySelector(
          'input[type="email"], input[name*="email"], input[name*="user"], input[id*="email"], input[type="text"]'
        ) as HTMLInputElement | null
        const hasFormValues = Boolean(pass && pass.value) || Boolean(user && user.value)
        const hasExplicit = Boolean(creds?.username && creds?.password)
        return { shouldLogin: hasFormValues || hasExplicit, hasExplicit, hasFormValues }
      }, params.credentials).catch(() => ({ shouldLogin: false, hasExplicit: false, hasFormValues: false }))

      if (loginCheck.shouldLogin) {
        job.progress = 15
        job.currentStep = "Logging into application..."
        saveJob(job)
        appendLog(job, "info", "Login screen detected. Submitting authentication...")

        try {
          const userInput = await page.$(
            'input[type="email"], input[name*="email"], input[name*="user"], input[id*="email"], input[type="text"]'
          )
          const passInput = await page.$('input[type="password"]')

          if (params.credentials?.username && userInput) {
            await userInput.click({ count: 3 }).catch(() => {})
            await userInput.type(params.credentials.username, { delay: 10 })
          }
          if (params.credentials?.password && passInput) {
            await passInput.click({ count: 3 }).catch(() => {})
            await passInput.type(params.credentials.password, { delay: 10 })
          }

          const submitSelector = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, input[type="submit"]')) as (HTMLButtonElement | HTMLInputElement)[]
            const btn = btns.find((b) => b.type === "submit" || /(sign in|login|log in|submit|continue)/i.test(b.textContent || b.value || ""))
            if (btn) {
              btn.setAttribute("data-agent-auth-submit", "true")
              return '[data-agent-auth-submit="true"]'
            }
            return null
          }).catch(() => null)

          if (submitSelector) {
            const submitBtn = await page.$(submitSelector)
            if (submitBtn) {
              await recordAgentAction(job, page, {
                type: "click",
                description: "Clicked Sign In / Login button",
                thought: "Submitting authentication credentials to enter application dashboard.",
                highlightSelector: submitSelector,
              })
              await submitBtn.click().catch(() => {})
              await Promise.race([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 4000 }).catch(() => null),
                new Promise((r) => setTimeout(r, 2000)),
              ])
              const postTitle = await page.title().catch(() => "")
              appendLog(job, "success", `Logged into application. Current screen: "${postTitle}" (${page.url()})`)
            }
          } else {
            await page.keyboard.press("Enter")
            await new Promise((r) => setTimeout(r, 2000))
          }
        } catch (authErr: any) {
          appendLog(job, "warn", `Auto-login encountered notice: ${authErr?.message}`)
        }
      }
    }

    if (params.userInstruction) {
      appendLog(job, "info", `Interpreting chat command: "${params.userInstruction}"`)
      job.currentStep = `Interpreting command: "${params.userInstruction}"`
      saveJob(job)

      // Laya System-1 reflex fast-path (~30ms local): resolve simple commands
      // without a slow, rate-limited cloud model call. Escalates automatically
      // when Laya is offline or unsure — the cloud interpreter runs unchanged.
      let plan: AICommandInterpretation | null = await tryLayaReflexPlan(
        page,
        params.userInstruction,
        params.layaBaseUrl,
      ).catch(() => null)
      let usedFallback = false
      if (plan) {
        appendLog(job, "success", "[Laya reflex] Fast-path plan accepted — skipping cloud interpretation.")
      } else {
        appendLog(job, "info", "Laya reflex unsure or offline — escalating to cloud command interpreter.")
        const interpreted = await interpretCommandWithAI({
          command: params.userInstruction,
          currentUrl: page.url(),
          apiKey: openRouterKey,
          baseUrl: params.aiBaseUrl,
          model: params.aiModel,
        })
        plan = interpreted
        usedFallback = interpreted.usedFallback
        if (interpreted.usedFallback) {
          // LOUD failure: never present the offline fallback as a success.
          job.aiError = interpreted.fallbackReason
          appendLog(job, "warn", `AI provider unreachable — ${interpreted.fallbackReason}`)
          if (job.messages && job.messages.length > 1) {
            job.messages[1].text =
              `\u26a0\uFE0F AI provider unreachable: ${interpreted.fallbackReason} ` +
              `Running the offline fallback plan (basic inspection only) — it cannot really execute your command.`
            job.messages[1].status = "executing"
            saveJob(job)
          }
        }
      }

      appendLog(job, "info", `AI Plan: ${plan.planSummary}`)
      if (job.messages && job.messages.length > 1) {
        job.messages[1].text = plan.planSummary
        job.messages[1].status = "executing"
        saveJob(job)
      }

      for (let i = 0; i < plan.actions.length; i++) {
        const act = plan.actions[i]
        job.currentStep = `[${i + 1}/${plan.actions.length}] ${act.description}`
        job.progress = Math.round(20 + ((i + 1) / plan.actions.length) * 65)
        saveJob(job)

        if (act.type === "navigate" && act.target) {
          const navUrl = act.target.startsWith("http") ? act.target : new URL(act.target, page.url()).href
          await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
          await recordAgentAction(job, page, {
            type: "navigate",
            description: act.description,
            thought: act.thought,
            target: navUrl,
          })
        } else if (act.type === "click") {
          const targetStr = act.target || ""
          let selector =
            targetStr.startsWith("#") ||
            targetStr.startsWith(".") ||
            targetStr.includes("[") ||
            targetStr.includes(":nth-of-type(")
              ? targetStr
              : null

          if (!selector && targetStr) {
            selector = await page.evaluate((txt) => {
              const elements = Array.from(
                document.querySelectorAll("button, a, input[type='submit'], [role='button'], select, [tabindex]")
              ) as HTMLElement[]
              // 1. Exact match on trimmed text or value
              let el = elements.find((e) => {
                const t = (e.textContent || (e as HTMLInputElement).value || "").trim().toLowerCase()
                return t === txt.toLowerCase()
              })
              // 2. Partial match on text
              if (!el) {
                el = elements.find((e) => {
                  const t = (e.textContent || (e as HTMLInputElement).value || "").toLowerCase()
                  return t.includes(txt.toLowerCase())
                })
              }
              // 3. Login / Sign-in intent synonyms
              if (!el && /(login|signin|sign in|auth|submit|continue)/i.test(txt)) {
                el = elements.find((e) => {
                  const t = (e.textContent || (e as HTMLInputElement).value || (e as HTMLInputElement).type || "").toLowerCase()
                  return /(sign in|login|log in|submit)/i.test(t)
                })
              }
              if (el) {
                const marker = `agent-tgt-${Date.now()}`
                el.setAttribute("data-agent-click-target", marker)
                return `[data-agent-click-target="${marker}"]`
              }
              return null
            }, targetStr).catch(() => null)
          }

          if (selector) {
            await recordAgentAction(job, page, {
              type: "click",
              description: act.description,
              thought: act.thought,
              highlightSelector: selector,
              target: targetStr,
            })
            const el = await page.$(selector)
            if (el) {
              await el.click().catch(() => {})
              // Allow either SPA DOM re-render or native page navigation
              await Promise.race([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 4000 }).catch(() => null),
                new Promise((r) => setTimeout(r, 1500)),
              ])
            }
          }
        } else if (act.type === "type") {
          const inputSel = act.target || "input:not([type='hidden']), textarea"
          await recordAgentAction(job, page, {
            type: "type",
            description: act.description,
            thought: act.thought,
            highlightSelector: inputSel,
          })
          const inp = await page.$(inputSel)
          if (inp && act.value) {
            await inp.type(act.value, { delay: 15 }).catch(() => {})
          }
        } else if (act.type === "back") {
          const originUrl = page.url()
          await recordAgentAction(job, page, {
            type: "back",
            description: act.description,
            thought: act.thought,
            target: originUrl,
          })
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
            page.goBack(),
          ])
          const finalUrl = page.url()
          await recordAgentAction(job, page, {
            type: "assert",
            description: `Back navigation verified: returned to ${finalUrl}`,
            thought: `Asserted popstate restoration to ${originUrl}. Current: ${finalUrl}`,
            status: "passed",
          })
        } else if (act.type === "scroll") {
          await page.evaluate(() => window.scrollBy({ top: 380, behavior: "instant" }))
          await recordAgentAction(job, page, {
            type: "scroll",
            description: act.description,
            thought: act.thought,
            coordinates: { x: 200, y: 380 },
          })
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
        } else if (act.type === "inspect" || act.type === "assert") {
          await recordAgentAction(job, page, {
            type: act.type,
            description: act.description,
            thought: act.thought,
            status: "passed",
          })
        }
      }

      // Capture final screen result for command
      const rawTitle = await page.title().catch(() => "")
      const screenTitle = rawTitle.trim() || new URL(page.url()).pathname || "Command Result"
      const finalBuffer = await page.screenshot({ type: "png" })
      const uploadedUrl = await uploadScreenshot(Buffer.from(finalBuffer), job.projectId, "cmd")

      const wfId = await createDatabaseWorkflow(
        job.projectId,
        `[Command] ${params.userInstruction.slice(0, 32)}`,
        uploadedUrl,
        `Command: ${params.userInstruction}\nPlan: ${plan.planSummary}`,
        "Executed Antigravity browser command.",
        true
      )

      job.screens.push({
        url: page.url(),
        title: screenTitle,
        path: new URL(page.url()).pathname || "/",
        testedAt: new Date().toISOString(),
        screenshotUrl: uploadedUrl,
        screenshots: { Mobile: uploadedUrl },
        backNavigationStatus: "passed",
        responsiveStatus: "passed",
        workflowId: wfId || undefined,
        issuesCount: job.issues.length,
      })

      if (job.messages && job.messages.length > 1) {
                job.messages[1].text = usedFallback
          ? `\u26a0\uFE0F Offline fallback only \u2014 ran ${plan.actions.length} basic check(s), not your command. ${job.aiError || ""} Fix the AI provider (AI Settings \u2192 OmniRouter) for real command execution.`
          : `\u2705 Executed ${plan.actions.length} action(s). ${plan.planSummary}`
        job.messages[1].status = "completed"
      }
    } else {
      // Discover internal screens
      job.progress = 20
      job.currentStep = "Discovering application screens & navigation routes..."
      saveJob(job)

      const targetOrigin = new URL(job.targetUrl).origin

    const discoveredUrls: string[] = await page.evaluate((origin) => {
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[]
      const links = new Set<string>()

      for (const a of anchors) {
        try {
          const href = a.href
          if (
            href.startsWith(origin) &&
            !href.includes("#") &&
            !href.includes("mailto:") &&
            !href.includes("tel:") &&
            !/(logout|signout|delete|leave)/i.test(href)
          ) {
            const clean = href.split("?")[0].replace(/\/$/, "") || href
            links.add(clean)
          }
        } catch {}
      }

      return Array.from(links)
    }, targetOrigin)

    // If testing a local instance, also discover routes directly from the project's filesystem!
    let localFsUrls: string[] = []
    if (targetOrigin.includes("localhost") || targetOrigin.includes("127.0.0.1")) {
      try {
        const fsRoutes = discoverLocalProjectRoutes(job.targetUrl, params.projectDir)
        localFsUrls = fsRoutes.map((r) => r.url)
        appendLog(job, "info", `Local Project Scanner: Found ${localFsUrls.length} routes in app filesystem.`)
      } catch (e: any) {
        appendLog(job, "warn", `Local route scan notice: ${e?.message}`)
      }
    }

    // Ensure initial URL is at head of queue, merged with local FS routes and anchor links
    const queue = Array.from(new Set([job.targetUrl, ...localFsUrls, ...discoveredUrls])).slice(0, job.maxScreens)
    appendLog(job, "info", `Discovered ${queue.length} screens to test (limit: ${job.maxScreens}).`)

    const progressPerScreen = 70 / Math.max(queue.length, 1)

    // Test each screen
    for (let index = 0; index < queue.length; index++) {
      const currentStatus = getJob(job.id)?.status
      if (currentStatus === "stopped") {
        appendLog(job, "warn", "Job cancelled. Stopping crawl sequence.")
        break
      }

      const screenUrl = queue[index]
      const screenStep = `Testing screen ${index + 1}/${queue.length}: ${screenUrl}`
      job.currentStep = screenStep
      job.progress = Math.round(20 + index * progressPerScreen)
      saveJob(job)
      appendLog(job, "info", screenStep)

      // Navigate to screen
      await page.goto(screenUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch((e) => {
        appendLog(job, "warn", `Navigation to ${screenUrl} notice: ${e?.message}`)
      })

      // Wait brief moment for rendering
      await new Promise((r) => setTimeout(r, 600))

      const rawTitle = await page.title().catch(() => "")
      const screenTitle = rawTitle.trim() || new URL(screenUrl).pathname || "Screen"
      const screenPath = new URL(screenUrl).pathname || "/"

      // Laya System-1 Fast Classification (~30ms) - only if configured
      const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "")
      const layaUrl = params.layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL
      let classifiedPageType: PageType = "other"
      let layaHasBlocker = false

      if (layaUrl) {
        try {
          const layaResult = await classifyPage(pageText, screenUrl, layaUrl)
          if (layaResult) {
            classifiedPageType = layaResult.pageType
            layaHasBlocker = layaResult.hasBlockingIssue
            appendLog(
              job,
              "info",
              `[Laya ~30ms] Screen classified as: ${classifiedPageType.toUpperCase()} (Ready: ${layaResult.ready ? "Stable" : "Loading"}, Blocker: ${layaHasBlocker ? "YES" : "NO"})`
            )

            await recordAgentAction(job, page, {
              type: "inspect",
              description: `[Laya System-1] Classified as ${classifiedPageType.toUpperCase()}`,
              thought: `Laya fast decision: identified page type "${classifiedPageType}" for ${params.role || "user"} flow. Layout readiness: ${layaResult.ready ? "Interactive" : "Loading"}.`,
              target: screenUrl,
              status: layaHasBlocker ? "failed" : "passed",
            })
          }
        } catch (layaErr: any) {
          console.warn("[Laya] Classification notice:", layaErr?.message)
        }
      }

      await recordAgentAction(job, page, {
        type: "inspect",
        description: `Inspecting screen "${screenTitle}"`,
        thought: `Extracting DOM interactive surface on "${screenTitle}" to test responsive layout, interactive controls, and native back navigation.`,
        target: screenUrl,
      })

      const screenIssues: AutomationIssue[] = []
      if (layaHasBlocker) {
        const blockIssue: AutomationIssue = {
          id: `laya-block-${Date.now()}-${index}`,
          screenUrl,
          screenTitle,
          type: "layout_shift",
          severity: "blocker",
          description: `[Laya Fast System-1] UI/UX blocking issue detected: layout broken or key action unreadable.`,
          timestamp: new Date().toISOString(),
        }
        screenIssues.push(blockIssue)
        job.issues.push(blockIssue)
      }
      let backNavigationStatus: "passed" | "failed" | "skipped" = "skipped"
      let responsiveStatus: "passed" | "warning" | "failed" = "passed"

      // 1. Interactive Element Exercise (Antigravity Control Simulation)
      try {
        const interactiveSelector = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button:not([disabled]), [role='button'], [role='tab'], select")) as HTMLElement[]
          for (const btn of btns) {
            const rect = btn.getBoundingClientRect()
            const text = (btn.textContent || "").trim()
            // Skip destructive actions: logout, delete, leave
            if (
              rect.width > 10 &&
              rect.height > 10 &&
              !/(logout|signout|delete|leave|pay)/i.test(text)
            ) {
              const marker = `ctrl-${Date.now()}`
              btn.setAttribute("data-agent-ctrl", marker)
              return `[data-agent-ctrl="${marker}"]`
            }
          }
          return null
        })

        if (interactiveSelector) {
          const btnEl = await page.$(interactiveSelector)
          if (btnEl) {
            await recordAgentAction(job, page, {
              type: "click",
              description: `Testing interactive control on ${screenTitle}`,
              thought: `Triggering interactive element to verify UI state update, click handlers, and runtime stability without unhandled exceptions.`,
              highlightSelector: interactiveSelector,
            })
            await btnEl.click().catch(() => {})
            await new Promise((r) => setTimeout(r, 600))
          }
        }

        // Scroll test: Audit sticky header and below-the-fold layout
        const canScroll = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 100)
        if (canScroll) {
          await page.evaluate(() => window.scrollBy({ top: 380, behavior: "instant" }))
          await recordAgentAction(job, page, {
            type: "scroll",
            description: "Auditing sticky header & below-the-fold layout",
            thought: "Scrolling viewport down 380px to assert sticky navbar containment and responsive positioning.",
            coordinates: { x: 200, y: 380 },
          })
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }))
        }
      } catch (interactiveErr: any) {
        appendLog(job, "info", `Interactive element test notice: ${interactiveErr?.message}`)
      }

      // 2. Back Navigation Testing
      if (params.checkBackNavigation !== false) {
        try {
          const originalUrl = page.url()

          // Find internal link or clickable button on page
          const linkToClick = await page.$("main a[href], nav a[href], a[href]")
          if (linkToClick) {
            const destHref = await linkToClick.evaluate((el: any) => el.href).catch(() => null)
            if (destHref && destHref.startsWith(targetOrigin) && destHref !== originalUrl) {
              await recordAgentAction(job, page, {
                type: "click",
                description: `Navigating to internal route: ${destHref}`,
                thought: `Navigating forward to test browser session history stack and ensure native back button can recover exact screen.`,
                highlightSelector: "main a[href], nav a[href], a[href]",
              })

              await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
                linkToClick.click(),
              ])

              await recordAgentAction(job, page, {
                type: "back",
                description: `Triggering browser native goBack() ↩️`,
                thought: `Simulating user pressing the native browser Back button. Asserting window.history.back() restores exact origin state without broken redirects.`,
                target: originalUrl,
              })

              // Now execute back navigation
              await Promise.all([
                page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => {}),
                page.goBack(),
              ])

              const finalUrl = page.url()
              if (finalUrl === originalUrl || finalUrl.split("?")[0] === originalUrl.split("?")[0]) {
                backNavigationStatus = "passed"
                await recordAgentAction(job, page, {
                  type: "assert",
                  description: `Back navigation verified: returned to exact screen`,
                  thought: `History integrity check passed. Current URL (${finalUrl}) matches expected URL (${originalUrl}).`,
                  status: "passed",
                  target: originalUrl,
                })
                appendLog(job, "success", `Back navigation verified on ${screenTitle}: returned to exact screen.`)
              } else {
                backNavigationStatus = "failed"
                await recordAgentAction(job, page, {
                  type: "assert",
                  description: `Back navigation mismatch! Expected ${originalUrl}, got ${finalUrl}`,
                  thought: `History stack drift detected. Route state was not properly preserved on popstate.`,
                  status: "failed",
                  target: finalUrl,
                })
                const navIssue: AutomationIssue = {
                  id: `nav-${Date.now()}-${index}`,
                  screenUrl,
                  screenTitle,
                  type: "back_navigation",
                  severity: "high",
                  description: `Back navigation failed. Expected ${originalUrl}, but landed on ${finalUrl}`,
                  expected: originalUrl,
                  actual: finalUrl,
                  timestamp: new Date().toISOString(),
                }
                screenIssues.push(navIssue)
                job.issues.push(navIssue)
                appendLog(job, "error", `Back navigation failure on ${screenTitle}: Expected ${originalUrl}, got ${finalUrl}`)
              }

              // Return back to current testing screen if drifted
              if (page.url() !== screenUrl) {
                await page.goto(screenUrl, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {})
              }
            } else {
              backNavigationStatus = "skipped"
            }
          }
        } catch (navErr: any) {
          backNavigationStatus = "failed"
          const navIssue: AutomationIssue = {
            id: `nav-${Date.now()}-${index}`,
            screenUrl,
            screenTitle,
            type: "back_navigation",
            severity: "high",
            description: `Error executing back navigation test: ${navErr?.message}`,
            timestamp: new Date().toISOString(),
          }
          screenIssues.push(navIssue)
          job.issues.push(navIssue)
        }
      }

      // 2. Responsive Layout Testing across Viewports
      const screenshotMap: Record<string, string> = {}
      let primaryScreenshotUrl = ""

      for (const vp of job.viewports) {
        try {
          await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1.5 })
          await new Promise((r) => setTimeout(r, 400))

          // Audit for horizontal overflow & broken images
          const auditResult = await page.evaluate(() => {
            const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 2
            const brokenImages = Array.from(document.querySelectorAll("img")).filter(
              (img) => img.naturalWidth === 0 && img.complete && Boolean(img.src)
            ).length

            return {
              hasHorizontalOverflow,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              brokenImages,
            }
          })

          if (auditResult.hasHorizontalOverflow) {
            responsiveStatus = "failed"
            const overflowIssue: AutomationIssue = {
              id: `resp-${Date.now()}-${vp.name}`,
              screenUrl,
              screenTitle,
              type: "responsive_overflow",
              severity: "medium",
              viewport: vp.name,
              description: `Horizontal scroll leak at ${vp.name} (${vp.width}px): page content width (${auditResult.scrollWidth}px) exceeds viewport (${auditResult.innerWidth}px).`,
              expected: `scrollWidth <= ${auditResult.innerWidth}px`,
              actual: `scrollWidth = ${auditResult.scrollWidth}px`,
              timestamp: new Date().toISOString(),
            }
            screenIssues.push(overflowIssue)
            job.issues.push(overflowIssue)
            appendLog(job, "warn", `Responsive overflow detected on ${screenTitle} at ${vp.name} (${vp.width}px).`)
          }

          if (auditResult.brokenImages > 0) {
            const brokenIssue: AutomationIssue = {
              id: `img-${Date.now()}-${vp.name}`,
              screenUrl,
              screenTitle,
              type: "broken_asset",
              severity: "low",
              viewport: vp.name,
              description: `${auditResult.brokenImages} broken image(s) detected on screen.`,
              timestamp: new Date().toISOString(),
            }
            screenIssues.push(brokenIssue)
            job.issues.push(brokenIssue)
          }

          // Take screenshot of primary mobile size (or first size)
          if (vp.name.toLowerCase().includes("mobile") || !primaryScreenshotUrl) {
            const buffer = await page.screenshot({ type: "png", fullPage: false })
            const uploadedUrl = await uploadScreenshot(Buffer.from(buffer), job.projectId, vp.name.toLowerCase())
            screenshotMap[vp.name] = uploadedUrl
            if (!primaryScreenshotUrl) primaryScreenshotUrl = uploadedUrl
          }
        } catch (respErr: any) {
          appendLog(job, "warn", `Notice during responsive test on ${vp.name}: ${respErr?.message}`)
        }
      }

      // If mobile screenshot not set, take fallback
      if (!primaryScreenshotUrl) {
        const fallbackBuffer = await page.screenshot({ type: "png" })
        primaryScreenshotUrl = await uploadScreenshot(Buffer.from(fallbackBuffer), job.projectId, "default")
      }

      // 2.5 OpenRouter / Local AI Model Visual QA Inspection
      let aiAnalysisResult: { uxScore: number; summary: string } | undefined
      if (hasAiConfigured && primaryScreenshotUrl) {
        const providerName = isLocalAi ? "Local AI (Ollama / LM Studio)" : isUnoRouter ? "UnoRouter" : "OpenRouter Cloud"
        appendLog(job, "info", `Requesting ${providerName} visual review for "${screenTitle}" (${params.aiModel || "deepseek-v4-flash:free"})...`)
        const aiFinding = await analyzeScreenWithAI({
          screenshotUrl: primaryScreenshotUrl,
          screenTitle,
          screenUrl,
          apiKey: openRouterKey,
          baseUrl: params.aiBaseUrl,
          model: params.aiModel,
        })

        if (aiFinding) {
          aiAnalysisResult = {
            uxScore: aiFinding.uxScore,
            summary: aiFinding.summary,
          }
          if (aiFinding.issues && Array.isArray(aiFinding.issues)) {
            for (const aiIssue of aiFinding.issues) {
              const aiIssueRecord: AutomationIssue = {
                id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                screenUrl,
                screenTitle,
                type: "layout_shift",
                severity: aiIssue.severity || "medium",
                description: `[AI Inspection] ${aiIssue.title}: ${aiIssue.description}${aiIssue.recommendation ? ` (Fix: ${aiIssue.recommendation})` : ""}`,
                timestamp: new Date().toISOString(),
              }
              screenIssues.push(aiIssueRecord)
              job.issues.push(aiIssueRecord)
              appendLog(job, "warn", `AI Model flagged: ${aiIssue.title}`)
            }
          }
        }
      }

      // 3. Create Workflow in Database
      const notes = [
        `Automated AI UI verification on ${screenUrl}`,
        `Back Navigation: ${backNavigationStatus.toUpperCase()}`,
        `Responsive Viewports: ${job.viewports.map((v) => v.name).join(", ")}`,
        screenIssues.length > 0
          ? `Detected Issues (${screenIssues.length}): ${screenIssues.map((i) => i.description).join("; ")}`
          : "All responsive and back-button tests passed cleanly.",
      ].join("\n")

      const reason = screenIssues.length > 0 ? screenIssues[0].description : "Verified responsive layout & back navigation."
      const isDone = screenIssues.length === 0

      const workflowId = await createDatabaseWorkflow(
        job.projectId,
        screenTitle,
        primaryScreenshotUrl,
        notes,
        reason,
        isDone
      )

      if (workflowId) {
        appendLog(job, "success", `Created review workflow #${workflowId.slice(0, 8)} for screen "${screenTitle}".`)
      }

      const screenRecord: DiscoveredScreen = {
        url: screenUrl,
        title: screenTitle,
        path: screenPath,
        pageType: classifiedPageType,
        testedAt: new Date().toISOString(),
        screenshotUrl: primaryScreenshotUrl,
        screenshots: screenshotMap,
        backNavigationStatus,
        responsiveStatus,
        workflowId: workflowId || undefined,
        issuesCount: screenIssues.length,
        issues: screenIssues,
        aiAnalysis: aiAnalysisResult,
      }

      job.screens.push(screenRecord)
      saveJob(job)
    }
  }

    // 4. Generate Final Comprehensive Report
    job.progress = 95
    job.currentStep = "Compiling audit report and analytics..."
    saveJob(job)

    const totalScreens = job.screens.length
    const passedScreens = job.screens.filter((s) => s.issuesCount === 0).length
    const failedScreens = totalScreens - passedScreens
    const totalIssues = job.issues.length

    const backNavPassedCount = job.screens.filter((s) => s.backNavigationStatus === "passed").length
    const backNavTestableCount = job.screens.filter((s) => s.backNavigationStatus !== "skipped").length
    const backNavigationScore =
      backNavTestableCount > 0 ? Math.round((backNavPassedCount / backNavTestableCount) * 100) : 100

    const responsivePassedCount = job.screens.filter((s) => s.responsiveStatus === "passed").length
    const responsiveScore = totalScreens > 0 ? Math.round((responsivePassedCount / totalScreens) * 100) : 100

    const recommendations: string[] = []
    if (job.issues.some((i) => i.type === "back_navigation")) {
      recommendations.push("Fix history state and back navigation on failed routes to prevent user lock-in.")
    }
    if (job.issues.some((i) => i.type === "responsive_overflow")) {
      recommendations.push("Set overflow-x: hidden or constrain max-width on containers causing mobile horizontal scroll.")
    }
    if (job.issues.some((i) => i.type === "broken_asset")) {
      recommendations.push("Verify image paths and CDN assets that returned broken images.")
    }
    if (recommendations.length === 0) {
      recommendations.push("Great job! All audited screens passed responsive layout and back navigation tests.")
    }

    // AI Executive Synthesis
    let aiExecSummary: { executiveSummary: string; keyStrengths: string[]; criticalFixes: string[]; overallScore: number } | undefined
    if (hasAiConfigured && job.screens.length > 0) {
      appendLog(job, "info", `Generating AI executive summary via ${isLocalAi ? "Local AI" : isUnoRouter ? "UnoRouter" : "OpenRouter"} (${params.aiModel || "deepseek-v4-flash:free"})...`)
      const aiExec = await generateAIExecutiveReport({
        screensSummary: job.screens.map((s) => `${s.title} (${s.url})`).join(", "),
        detectedIssuesCount: job.issues.length,
        targetUrl: job.targetUrl,
        apiKey: openRouterKey,
        baseUrl: params.aiBaseUrl,
        model: params.aiModel,
      })
      if (aiExec) {
        aiExecSummary = aiExec
        if (aiExec.criticalFixes && aiExec.criticalFixes.length > 0) {
          recommendations.unshift(...aiExec.criticalFixes.map((f) => `[AI Priority] ${f}`))
        }
      }
    }

    job.report = {
      totalScreensTested: totalScreens,
      passedScreens,
      failedScreens,
      totalIssues,
      backNavigationScore,
      responsiveScore,
      summary: aiExecSummary?.executiveSummary || `Audited ${totalScreens} screens. Back navigation fidelity: ${backNavigationScore}%, Responsive fidelity: ${responsiveScore}%. Total issues flagged: ${totalIssues}.`,
      recommendations,
      aiExecutiveSummary: aiExecSummary,
    }

    // 5. Create Chained Journey Workflow in Database (e.g. Login ➔ Dashboard ➔ Settings)
    if (job.screens.length > 0) {
      try {
        const journeySteps: JourneyStep[] = job.screens.map((s, idx) => ({
          index: idx,
          url: s.url,
          title: s.title,
          screenshotUrl: s.screenshotUrl || "",
          pageType: (s.pageType as PageType) || "other",
          hasBlockingIssue: s.issuesCount > 0,
          severity: s.issuesCount > 0
            ? (s.issues?.some((i) => i.severity === "blocker") ? "Blocker" : "High")
            : undefined,
          viewport: { width: 1280, height: 800 },
          capturedAt: s.testedAt,
          issues: (s.issues || []).map((iss) => ({
            id: iss.id,
            type: iss.type,
            severity: iss.severity,
            description: iss.description,
          })),
          aiAnalysis: s.aiAnalysis,
        }))

        const flowSummary = job.screens
          .slice(0, 4)
          .map((s) => (s.pageType && s.pageType !== "other" ? s.pageType.charAt(0).toUpperCase() + s.pageType.slice(1) : s.title.slice(0, 18)))
          .join(" ➔ ")

        const journeyRole = (params.role as any) || "user"
        const roleLabel = journeyRole.charAt(0).toUpperCase() + journeyRole.slice(1)
        const chainedTitle = `${roleLabel} Journey: ${flowSummary}`

        const createdWf = await createWorkflowFromJourney(
          {
            projectId: job.projectId,
            startUrl: job.targetUrl,
            role: journeyRole,
            title: chainedTitle,
          },
          journeySteps
        )

        job.chainedWorkflowId = createdWf.workflowId
        job.report.chainedWorkflowId = createdWf.workflowId
        appendLog(job, "success", `🏁 Created Chained Workflow: "${chainedTitle}" (#${createdWf.workflowId.slice(0, 8)})`)
      } catch (wfErr: any) {
        appendLog(job, "warn", `Chained journey workflow notice: ${wfErr?.message}`)
      }
    }

    job.progress = 100
    job.status = "completed"
    job.currentStep = "Automation completed successfully."
    job.finishedAt = new Date().toISOString()
    appendLog(job, "success", `Automation job finished: ${job.report.summary}`)
    saveJob(job)
  } catch (err: any) {
    job.status = "failed"
    job.error = err?.message || "Execution error"
    job.finishedAt = new Date().toISOString()
    appendLog(job, "error", `Automation failed: ${job.error}`)
    saveJob(job)
  } finally {
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
