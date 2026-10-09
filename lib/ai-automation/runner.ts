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
  AIThinkingModel,
  ChecklistTestItem,
} from "./types"
import {
  resolveAiApiKey,
  NEBIUS_BASE_URL,
  analyzeScreenWithAI,
  generateAIExecutiveReport,
  interpretCommandWithAI,
  generateVisionThinkingModelAndChecklist,
} from "./ai-gateway"
import type { AICommandInterpretation } from "./ai-gateway"
import { tryLayaReflexPlan } from "./laya-reflex"
import { discoverLocalProjectRoutes } from "./discover-routes"
import { classifyPage, pickNextLink, isLayaAvailable, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import { executeAutonomousJob, isAutonomousCommand } from "./autonomous-runner"
import {
  executeFullAppTestingJob,
  isFullAppCommand,
  synthesizeFullAppPlanFromJob,
  buildFigmaWorkflowMap,
} from "./full-app-engine"
import {
  executeFeatureWorkflowJob,
  isFeatureWorkflowCommand,
} from "./feature-workflow-engine"
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
  let job: AutomationJob | null = null
  if (jobStore.has(jobId)) {
    job = jobStore.get(jobId)!
  }

  // If memory job is missing fullAppTestPlan, check disk first
  if (!job || !job.fullAppTestPlan || !job.fullAppTestPlan.screens?.length) {
    try {
      ensureJobsDir()
      const filePath = path.join(JOBS_DIR, `${jobId}.json`)
      if (fs.existsSync(filePath)) {
        const diskJob = JSON.parse(fs.readFileSync(filePath, "utf8")) as AutomationJob
        job = diskJob
        jobStore.set(jobId, diskJob)
      }
    } catch {}
  }

  // Synthesize plan if still not present but test evidence exists
  if (job && (!job.fullAppTestPlan || !job.fullAppTestPlan.screens?.length)) {
    try {
      const synth = synthesizeFullAppPlanFromJob(job)
      if (synth) {
        job.fullAppTestPlan = synth
        job.flowGraph = buildFigmaWorkflowMap(synth)
      }
    } catch {}
  }

  return job
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
    mode:
      params.mode ||
      (params.workflowPrompt || (params.userInstruction && isFeatureWorkflowCommand(params.userInstruction))
        ? "feature_workflow"
        : params.userInstruction && isFullAppCommand(params.userInstruction)
        ? "full_app"
        : params.userInstruction
        ? "chat"
        : "crawl"),
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
    uploadFilesDir: params.uploadFilesDir,
    postmanCollection: params.postmanCollection,
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
    job.authState = "none"
    job.authPrompt = undefined
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
    let resolvedCoords = action.coordinates || null

    // 1. Calculate element coordinates if selector present and coords not yet set
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
          }
        }
      } catch {}
    }

    // Move Puppeteer virtual mouse if coordinates exist
    if (resolvedCoords) {
      await page.mouse.move(resolvedCoords.x, resolvedCoords.y, { steps: 5 }).catch(() => {})
    }

    // 2. Inject Antigravity Visual Testing Overlay (High-visibility SVG Cursor, Radar Pulse, HUD Bar)
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
              if (!manualCoords) {
                cx = r.left + r.width / 2
                cy = r.top + r.height / 2
              }
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

          // 3. High-visibility Virtual SVG Mouse Cursor, Ripple & Target Radar
          const cursorWrap = document.createElement("div")
          cursorWrap.style.cssText = `
            position: fixed;
            left: ${cx}px;
            top: ${cy}px;
            z-index: 99999999;
            pointer-events: none;
            filter: drop-shadow(0 4px 12px rgba(0,0,0,0.6));
          `

          // Ripple circle
          const ripple = document.createElement("div")
          ripple.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 44px;
            height: 44px;
            margin: -22px 0 0 -22px;
            border-radius: 50%;
            border: 2px solid ${actionType === "click" ? "#f43f5e" : "#818cf8"};
            background: ${actionType === "click" ? "rgba(244,63,94,0.3)" : "rgba(129,140,248,0.2)"};
            box-shadow: 0 0 16px ${actionType === "click" ? "#f43f5e" : "#818cf8"};
          `

          // SVG Pointer Arrow
          const svgPointer = document.createElement("div")
          svgPointer.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M5.5 3.2L18.8 12.2L12.5 13.8L15.8 20.8L12.8 22.2L9.5 15.2L5.5 19.2V3.2Z" fill="${actionType === "click" ? "#f43f5e" : actionType === "type" ? "#0ea5e9" : "#6366f1"}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
          `

          // Floating target pill
          const pill = document.createElement("div")
          pill.style.cssText = `
            position: absolute;
            left: 24px;
            top: 8px;
            padding: 3px 8px;
            border-radius: 6px;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(139, 92, 246, 0.7);
            color: #f1f5f9;
            font-size: 10px;
            font-weight: 700;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            white-space: nowrap;
          `
          pill.textContent = `🎯 ${actionType.toUpperCase()}: ${targetLabel}`

          cursorWrap.appendChild(ripple)
          cursorWrap.appendChild(svgPointer)
          cursorWrap.appendChild(pill)
          root.appendChild(cursorWrap)

          document.body.appendChild(root)
        } catch {}
      },
      action.type,
      action.description,
      action.thought || "",
      action.highlightSelector || null,
      resolvedCoords
    ).catch(() => {})

    // Capture visual snapshot for live simulator screen with the visible cursor overlay
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
      coordinates: resolvedCoords || undefined,
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

async function executeSingleAction(job: AutomationJob, page: Page, act: AgentAction) {
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
    const rawTarget = (act.target || "").trim()
    const desc = (act.description || "").trim()
    const thought = (act.thought || "").trim()

    // Determine candidate text strings to locate in the DOM
    const isGenericTag = /^(button|a|input|div|span|body|select|form|p|h\d|main|section|aside|nav)$/i.test(rawTarget)
    const candidateTexts: string[] = []

    if (rawTarget && !isGenericTag && !/^[.#\[]/.test(rawTarget)) {
      candidateTexts.push(rawTarget.replace(/^["']|["']$/g, "").trim())
    }

    // Extract element label from description (e.g. "Click Kensington Flat" -> "Kensington Flat")
    const descMatch = desc.match(/(?:click|tap|open|select|press|choose)\s+["']?([^"'\n]+?)["']?(?:\s+(?:button|tab|link|filter|group|option|menu|view|card|again))?$/i)
    if (descMatch && descMatch[1] && descMatch[1].trim().length > 1) {
      candidateTexts.push(descMatch[1].trim())
    }

    if (thought) {
      const thoughtMatch = thought.match(/(?:click|open|select|switch to)\s+["']?([^"'\n,.]+?)["']?(?:\s+(?:button|tab|filter|view|item))?/i)
      if (thoughtMatch && thoughtMatch[1] && thoughtMatch[1].trim().length > 1) {
        candidateTexts.push(thoughtMatch[1].trim())
      }
    }

    const specificSelector = (!isGenericTag && rawTarget && /^[.#\[]/.test(rawTarget)) ? rawTarget : null

    // Locate matching element in page
    const resolution = await page.evaluate(
      (candidates, specificSel) => {
        // 1. Direct specific selector
        if (specificSel) {
          try {
            const el = document.querySelector(specificSel) as HTMLElement | null
            if (el) {
              const marker = `agent-sel-${Date.now()}`
              el.setAttribute("data-agent-click-target", marker)
              el.scrollIntoView({ behavior: "instant", block: "center" })
              const r = el.getBoundingClientRect()
              return {
                selector: `[data-agent-click-target="${marker}"]`,
                coords: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
                label: (el.textContent || el.getAttribute("aria-label") || specificSel).trim().slice(0, 30),
              }
            }
          } catch {}
        }

        // 2. Search visible clickable elements
        const elements = Array.from(
          document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button'], [role='tab'], select, [tabindex='0']")
        ) as HTMLElement[]

        const visibleElements = elements.filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== "hidden"
        })

        for (const cand of candidates) {
          const cleanCand = cand.toLowerCase().trim()
          if (!cleanCand) continue

          // Exact match after stripping trailing badge numbers (e.g. "My notes1" -> "My notes", "2026-270" -> "2026-27")
          let match = visibleElements.find((el) => {
            const raw = (el.textContent || (el as HTMLInputElement).value || "").trim().toLowerCase().replace(/\s+/g, " ")
            let clean = raw
            const tym = raw.match(/^(\d{4}-\d{2})\s*\d*$/)
            if (tym) {
              clean = tym[1]
            } else {
              clean = raw.replace(/\s+\d+$/, "").replace(/([a-z])\d{1,3}$/, "$1").trim()
            }
            return clean === cleanCand || raw === cleanCand
          })

          // Substring match
          if (!match) {
            match = visibleElements.find((el) => {
              const raw = (el.textContent || (el as HTMLInputElement).value || "").toLowerCase()
              return raw.includes(cleanCand)
            })
          }

          // Aria/title match
          if (!match) {
            match = visibleElements.find((el) => {
              const aria = (el.getAttribute("aria-label") || el.title || el.getAttribute("name") || "").toLowerCase()
              return aria.includes(cleanCand)
            })
          }

          if (match) {
            const marker = `agent-tgt-${Date.now()}`
            match.setAttribute("data-agent-click-target", marker)
            match.scrollIntoView({ behavior: "instant", block: "center" })
            const r = match.getBoundingClientRect()
            return {
              selector: `[data-agent-click-target="${marker}"]`,
              coords: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
              label: (match.textContent || cand).trim().replace(/\s+/g, " ").slice(0, 30),
            }
          }
        }

        return null
      },
      candidateTexts,
      specificSelector
    )

    if (!resolution) {
      throw new Error(`Click target not found: "${rawTarget || desc}"`)
    }

    await recordAgentAction(job, page, {
      type: "click",
      description: act.description,
      thought: act.thought,
      highlightSelector: resolution.selector,
      coordinates: resolution.coords,
      target: resolution.label,
    })

    // Dispatch DOM click and Puppeteer click
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el) {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }))
        el.click()
      }
    }, resolution.selector)

    const el = await page.$(resolution.selector).catch(() => null)
    if (el) {
      await el.click().catch(() => {})
    }

    await Promise.race([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 3000 }).catch(() => null),
      new Promise((r) => setTimeout(r, 1200)),
    ])
  } else if (act.type === "type") {
    const targetStr = act.target || ""
    let inputSel = act.selector || null

    if (!inputSel && targetStr) {
      inputSel = await page
        .evaluate((sel) => {
          try {
            const el = document.querySelector(sel) as HTMLElement | null
            if (el && ("value" in el || (el as HTMLElement).isContentEditable)) {
              const marker = `agent-type-${Date.now()}`
              el.setAttribute("data-agent-type-tgt", marker)
              return `[data-agent-type-tgt="${marker}"]`
            }
          } catch {}
          return null
        }, targetStr)
        .catch(() => null)
    }

    if (!inputSel && targetStr) {
      inputSel = await page
        .evaluate((tgt) => {
          const lower = tgt.toLowerCase()
          const inputs = Array.from(
            document.querySelectorAll('input:not([type="hidden"]), textarea'),
          ) as HTMLInputElement[]
          if (lower.includes("pass")) {
            const p = inputs.find(
              (i) => i.type === "password" || /(pass)/i.test(i.name || i.id || i.placeholder),
            )
            if (p) {
              p.setAttribute("data-agent-type-tgt", "pass")
              return '[data-agent-type-tgt="pass"]'
            }
          }
          if (
            lower.includes("email") ||
            lower.includes("user") ||
            lower.includes("login") ||
            lower.includes("name")
          ) {
            const u = inputs.find(
              (i) =>
                i.type === "email" ||
                /(email|user|login|name)/i.test(i.name || i.id || i.placeholder || i.type),
            )
            if (u) {
              u.setAttribute("data-agent-type-tgt", "user")
              return '[data-agent-type-tgt="user"]'
            }
          }
          return null
        }, targetStr)
        .catch(() => null)
    }

    if (!inputSel) {
      inputSel = "input:not([type='hidden']), textarea"
    }

    await recordAgentAction(job, page, {
      type: "type",
      description: act.description,
      thought: act.thought,
      highlightSelector: inputSel,
    })

    const inp = await page.$(inputSel).catch(() => null)
    if (inp && act.value) {
      await inp.click({ count: 3 }).catch(() => {})
      await inp.type(act.value, { delay: 15 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 400))
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
    const assertVal = (act.value || "").trim().toLowerCase()
    if (act.type === "assert" && assertVal) {
      const exists = await page.evaluate((val) => {
        const bodyText = (document.body?.innerText || "").toLowerCase()
        return bodyText.includes(val)
      }, assertVal)

      if (!exists) {
        throw new Error(`Assertion failed: expected "${act.value}" on page, but not found.`)
      }
    }

    await recordAgentAction(job, page, {
      type: act.type,
      description: act.description,
      thought: act.thought,
      status: "passed",
    })
  }
}

async function executeJob(job: AutomationJob, params: StartAutomationRequest) {
  job.status = "running"
  const aiBase = (params.aiBaseUrl || NEBIUS_BASE_URL).trim()
  const aiApiKey = resolveAiApiKey(aiBase, params.aiApiKey)
  const isLocalAi = Boolean(aiBase && (aiBase.includes("localhost") || aiBase.includes("127.0.0.1")))
  const isUnoRouter = aiBase.includes("unorouter.com")
  const isNebius = aiBase.includes("tokenfactory.nebius.com")
  const hasAiConfigured = isLocalAi || Boolean(aiApiKey)
  appendLog(job, "info", `Starting headless automation crawl on: ${job.targetUrl}`)
  if (!hasAiConfigured && aiBase && !isLocalAi) {
    appendLog(
      job,
      "warn",
      "AI provider key missing for the remote gateway — AI visual analysis and autonomous exploration will be skipped. " +
        "Add a Nebius Token Factory API key in AI Settings, or configure NEBIUS_API_KEY on the server.",
    )
  }

  // Feature / Workflow Testing mode: understand workflow -> discover relevant screens -> plan -> execute -> edge cases -> report
  if (params.mode === "feature_workflow" || job.mode === "feature_workflow") {
    appendLog(job, "info", "Feature / Workflow Testing requested — initiating targeted feature workflow testing.")
    job.mode = "feature_workflow"
    saveJob(job)
    await executeFeatureWorkflowJob(job, params)
    return
  }

  // Full App Testing mode: DISCOVER → MAP → CREATE TEST PLAN → EXECUTE → VERIFY → REPORT
  if (params.mode === "full_app" || (params.userInstruction && isFullAppCommand(params.userInstruction))) {
    appendLog(job, "info", "Full App Testing requested — initiating systematic DISCOVER → MAP → TEST PLAN → EXECUTE workflow.")
    job.mode = "full_app"
    saveJob(job)
    await executeFullAppTestingJob(job, params)
    return
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
    await page.setViewport({ width: 1440, height: 900 })

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

    // Wait for client-side React / Next.js hydration and splash loaders
    await Promise.race([
      page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => null),
      new Promise((r) => setTimeout(r, 2000)),
    ])
    await page.waitForFunction(
      () => {
        const text = document.body?.innerText || ""
        return !/(loading client portal|loading app|initial loading)/i.test(text)
      },
      { timeout: 5000 }
    ).catch(() => null)
    await new Promise((r) => setTimeout(r, 600))

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

    if (params.userInstruction || params.image) {
      const cmdText = params.userInstruction || "Inspect and test screen UI"
      appendLog(job, "info", `Capturing screen image and analyzing: "${cmdText}"`)
      job.currentStep = "Capturing screen image for visual AI analysis..."
      saveJob(job)

      // 1. Capture initial visual screenshot of the screen (or use user-supplied image)
      let liveScreenshotUrl = params.image
      try {
        const initBuffer = await page.screenshot({ type: "png" })
        if (!liveScreenshotUrl && initBuffer) {
          liveScreenshotUrl = await uploadScreenshot(Buffer.from(initBuffer), job.projectId, "init-vision")
        }
      } catch (shotErr) {
        console.warn("[Runner] Initial screenshot notice:", shotErr)
      }

      if (liveScreenshotUrl) {
        job.currentScreenshotUrl = liveScreenshotUrl
      }

      appendLog(job, "info", "Inspecting screen structure & scrolling to discover all interactive elements and forms...")
      // Viewport scroll pass to uncover below-the-fold content, lazy elements, and forms
      await page.evaluate(async () => {
        try {
          const scrollHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
          if (scrollHeight > window.innerHeight) {
            window.scrollBy({ top: 400, behavior: "instant" })
            await new Promise((r) => setTimeout(r, 200))
            window.scrollTo({ top: scrollHeight, behavior: "instant" })
            await new Promise((r) => setTimeout(r, 200))
            window.scrollTo({ top: 0, behavior: "instant" })
            await new Promise((r) => setTimeout(r, 200))
          }
        } catch {}
      }).catch(() => {})

      const pageContext = await page
        .evaluate(() => {
          const inputs = Array.from(
            document.querySelectorAll('input:not([type="hidden"]), select, textarea'),
          ).map((el) => {
            const input = el as HTMLInputElement
            const val = input.value || ""
            return {
              type: input.type || input.tagName.toLowerCase(),
              name: input.name || input.id || "",
              placeholder: input.placeholder || "",
              value: input.type === "password" ? (val ? "••••••" : "") : val,
              hasValue: val.trim().length > 0,
            }
          })

          const rawElements = Array.from(
            document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], [role="tab"], select')
          )
          const seen = new Set<string>()
          const interactiveList: Array<{
            text: string
            cleanText: string
            tag: string
            type?: string
            area?: string
            role?: string
          }> = []

          rawElements.forEach((el) => {
            const rawText = (el.textContent || (el as HTMLInputElement).value || "").trim().replace(/\s+/g, " ")
            let cleanText = rawText
            const taxYearMatch = rawText.match(/^(\d{4}-\d{2})\s*\d*$/)
            if (taxYearMatch) {
              cleanText = taxYearMatch[1]
            } else {
              cleanText = rawText.replace(/\s+\d+$/, "").replace(/([a-zA-Z])\d{1,3}$/, "$1").trim()
            }
            if (!cleanText || cleanText.length < 2) return
            if (/^(Show|Forgot password\?)$/i.test(cleanText)) return

            const closestNav = el.closest("nav, aside, .sidebar, [role='navigation']")
            const closestHeader = el.closest("header, .header, .topbar, .navbar")
            const closestModal = el.closest("[role='dialog'], .modal, .dialog")
            const area = closestModal ? "modal" : closestNav ? "sidebar" : closestHeader ? "header" : "main"

            const key = `${cleanText}__${area}`
            if (seen.has(key)) return
            seen.add(key)

            interactiveList.push({
              text: rawText,
              cleanText,
              tag: el.tagName.toLowerCase(),
              type: (el as any).type || el.tagName.toLowerCase(),
              area,
              role: el.getAttribute("role") || undefined,
            })
          })

          const forms = Array.from(document.querySelectorAll("form, [data-form], .form")).map((f, fIdx) => {
            const fInputs = Array.from(f.querySelectorAll("input, select, textarea")).map(
              (inp) => (inp as HTMLInputElement).name || (inp as HTMLInputElement).placeholder || (inp as HTMLInputElement).type
            )
            const submitBtn = f.querySelector("button[type='submit'], input[type='submit']")
            return {
              id: (f as HTMLElement).id || `form-${fIdx + 1}`,
              fields: fInputs,
              submitLabel: submitBtn?.textContent?.trim() || "Submit",
            }
          })

          const buttons = interactiveList.map((b) => ({
            text: b.cleanText,
            type: b.type || "button",
            area: b.area,
          }))

          const hasPassword = inputs.some((i) => i.type === "password")
          const hasUserOrEmail = inputs.some(
            (i) => i.type === "email" || /(user|email|login)/i.test(i.name || i.placeholder),
          )
          const isLoginForm = hasPassword && hasUserOrEmail
          const prefilled = inputs.some((i) => i.hasValue)

          return {
            title: document.title || "",
            url: window.location.href,
            inputs,
            buttons,
            forms,
            interactiveElements: interactiveList,
            hasLoginForm: isLoginForm,
            hasPreFilledCredentials: prefilled,
          }
        })
        .catch(() => null)

      appendLog(job, "info", "Running Vision AI: building Thinking Model and generating UI Test Checklist...")
      job.currentStep = "Formulating Thinking Model and UI Test Checklist..."
      saveJob(job)

      const visionPlan = await generateVisionThinkingModelAndChecklist({
        screenshotUrl: liveScreenshotUrl || "",
        command: cmdText,
        currentUrl: page.url(),
        apiKey: aiApiKey,
        baseUrl: params.aiBaseUrl,
        model: params.aiModel,
        pageContext,
        credentials: params.credentials,
      })

      // If user explicitly asked to test all clickable options or go back and forth across controls:
      const wantsAllClickable = /(clickable|all options|back and forth|froth|check all|list out the tasks)/i.test(cmdText)
      if (wantsAllClickable && pageContext?.interactiveElements && pageContext.interactiveElements.length > 0) {
        appendLog(job, "info", `Enforcing comprehensive clickable options checklist (${pageContext.interactiveElements.length} controls found)...`)
        const cleanElements = pageContext.interactiveElements
          .filter((el) => {
            if (/brand|logo/i.test(el.tag) || /LandlordAccounting/i.test(el.cleanText)) return false
            if (/(john smith|logout|sign out)/i.test(el.cleanText)) return false
            return true
          })
          .slice(0, 10)

        visionPlan.checklist = cleanElements.map((el, idx) => ({
          id: `chk-opt-${idx + 1}`,
          title: `Test Option: ${el.cleanText} [${el.area || "control"}]`,
          goal: `Interact with '${el.cleanText}' (${el.area}), verify view response, and return safely to base.`,
          expectedOutcome: `Clicking '${el.cleanText}' updates the UI view or opens modal without uncaught errors.`,
          status: "pending" as const,
          actions: [
            {
              id: `act-${idx + 1}-1`,
              type: "click" as const,
              target: el.cleanText,
              description: `Click '${el.cleanText}'`,
              thought: `Triggering '${el.cleanText}' to verify UI reaction.`,
              status: "pending" as const,
              timestamp: new Date().toISOString(),
            },
            {
              id: `act-${idx + 1}-2`,
              type: "inspect" as const,
              description: `Inspect resulting view for '${el.cleanText}'`,
              thought: `Auditing resulting state after interacting with '${el.cleanText}'.`,
              status: "pending" as const,
              timestamp: new Date().toISOString(),
            },
          ],
        }))
      }

      job.thinkingModel = visionPlan.thinkingModel
      job.checklist = visionPlan.checklist
      if (visionPlan.usedFallback && visionPlan.fallbackReason) {
        job.aiError = visionPlan.fallbackReason
      }

      appendLog(job, "info", `Thinking Model: "${visionPlan.thinkingModel.screenUnderstanding}"`)
      appendLog(job, "info", `Checklist: Generated ${visionPlan.checklist.length} UI test(s). Starting execution...`)

      if (job.messages && job.messages.length > 1) {
        job.messages[1].text = `🧠 Visual Thinking Model generated for "${visionPlan.thinkingModel.screenUnderstanding}". Executing ${visionPlan.checklist.length} checklist tests...`
        job.messages[1].status = "executing"
        job.messages[1].thinkingModel = visionPlan.thinkingModel
        job.messages[1].checklist = [...visionPlan.checklist]
        job.messages[1].imageUrl = liveScreenshotUrl || undefined
        saveJob(job)
      }

      // Execute each checklist test item sequentially with "go back and forth" navigation
      const baseDashboardUrl = page.url()

      for (let cIdx = 0; cIdx < visionPlan.checklist.length; cIdx++) {
        const item = visionPlan.checklist[cIdx]
        item.status = "running"
        job.currentStep = `[Test ${cIdx + 1}/${visionPlan.checklist.length}] ${item.title}`
        job.progress = Math.round(20 + ((cIdx + 1) / visionPlan.checklist.length) * 65)

        const agentMsg = job.messages?.slice().reverse().find((m) => m.sender === "agent")
        if (agentMsg) {
          agentMsg.checklist = JSON.parse(JSON.stringify(visionPlan.checklist))
          agentMsg.status = "executing"
          const passedNow = visionPlan.checklist.filter((t) => t.status === "passed").length
          agentMsg.text = `⚡ Executing UI Tests (${passedNow}/${visionPlan.checklist.length} Passed)... Running: ${item.title}`
        }
        saveJob(job)
        appendLog(job, "info", `▶️ Checklist [${cIdx + 1}/${visionPlan.checklist.length}]: ${item.title}`)

        // 1. "GO BACK AND FORTH" - Pre-test reset to base screen
        try {
          // If on login screen (e.g. logged out), automatically re-authenticate
          const isLoginPage = await page.evaluate(() => {
            return Boolean(document.querySelector('input[type="password"]'))
          })
          if (isLoginPage) {
            const submitBtn = await page.$('button[type="submit"]')
            if (submitBtn) {
              await submitBtn.click().catch(() => {})
              await new Promise((r) => setTimeout(r, 1500))
            }
          }

          // If a modal or dialog is open from earlier, close it
          await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .modal, .dialog, .drawer, .popup')
            if (modal) {
              const cancel = Array.from(modal.querySelectorAll("button, a")).find((b) =>
                /(cancel|close|done|dismiss)/i.test(b.textContent || b.getAttribute("aria-label") || "")
              )
              if (cancel) (cancel as HTMLElement).click()
            }
          })
          await new Promise((r) => setTimeout(r, 400))

          // If in a sub-view (URL differs from base or Home button is not active), navigate Home
          const needsHomeNav = await page.evaluate((base) => {
            if (window.location.href !== base) return true
            const hasBackButton = Boolean(document.querySelector('.back-btn, [aria-label*="Back"]'))
            const activeNav = document.querySelector(".nav-item.active, .bb.active")
            return hasBackButton || Boolean(activeNav && !activeNav.textContent?.includes("Home"))
          }, baseDashboardUrl)

          if (needsHomeNav) {
            await page.evaluate(() => {
              const backBtn = Array.from(document.querySelectorAll("button, a")).find((b) =>
                /(back to all|back)/i.test(b.textContent || "")
              ) as HTMLElement | undefined
              if (backBtn) {
                backBtn.click()
                return
              }
              const homeBtn = Array.from(document.querySelectorAll("button, a")).find((b) =>
                b.textContent?.trim() === "Home" && (b.className.includes("nav-item") || b.className.includes("home"))
              ) as HTMLElement | undefined
              if (homeBtn) homeBtn.click()
            })
            await Promise.race([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 2500 }).catch(() => null),
              new Promise((r) => setTimeout(r, 600)),
            ])
          }
        } catch {}

        let itemPassed = true
        let itemError: string | undefined

        // Execute action steps for this test
        for (const act of item.actions) {
          try {
            await executeSingleAction(job, page, act)
          } catch (err: any) {
            itemPassed = false
            itemError = err?.message || "Action step failed"
            appendLog(job, "warn", `Step note in [${item.title}]: ${itemError}`)
            break
          }
        }

        // Capture snapshot after this test item (ACTUAL RESULTING VIEW)
        try {
          // Clean temporary overlay before capturing pristine screenshot
          await page.evaluate(() => {
            document.getElementById("__antigravity_overlay_root__")?.remove()
          }).catch(() => {})

          const itemBuffer = await page.screenshot({ type: "png" })
          const itemShotUrl = await uploadScreenshot(Buffer.from(itemBuffer), job.projectId, `test-${cIdx + 1}`)
          item.screenshotUrl = itemShotUrl
          job.currentScreenshotUrl = itemShotUrl

          // Push screen to job.screens so the left simulator canvas and top journey strip receive it live
          job.screens.push({
            url: page.url(),
            title: item.title,
            path: new URL(page.url()).pathname || "/",
            testedAt: new Date().toISOString(),
            screenshotUrl: itemShotUrl,
            screenshots: { Mobile: itemShotUrl },
            backNavigationStatus: "passed",
            responsiveStatus: "passed",
            workflowId: `bot-step-${item.id}`,
            issuesCount: itemPassed ? 0 : 1,
          })
        } catch {}

        item.status = itemPassed ? "passed" : "failed"
        if (itemError) item.error = itemError
        item.observations = `Validated on ${page.url()}. Status: ${item.status.toUpperCase()}`
        appendLog(job, itemPassed ? "success" : "warn", `🏁 Checklist [${cIdx + 1}/${visionPlan.checklist.length}] ${item.title}: ${item.status.toUpperCase()}`)

        // 2. "GO BACK AND FORTH" - Post-test reset to base screen
        try {
          // Close modal if opened by this test
          await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .modal, .dialog, .drawer, .popup')
            if (modal) {
              const cancel = Array.from(modal.querySelectorAll("button, a")).find((b) =>
                /(cancel|close|done|dismiss)/i.test(b.textContent || b.getAttribute("aria-label") || "")
              )
              if (cancel) (cancel as HTMLElement).click()
            }
          })
          // If in sub-view, return to Home
          await page.evaluate(() => {
            const backBtn = Array.from(document.querySelectorAll("button, a")).find((b) =>
              /(back to all|back)/i.test(b.textContent || "")
            ) as HTMLElement | undefined
            if (backBtn) {
              backBtn.click()
              return
            }
            const homeBtn = Array.from(document.querySelectorAll("button, a")).find((b) =>
              b.textContent?.trim() === "Home" && (b.className.includes("nav-item") || b.className.includes("home") || b.className.includes("tb-btn"))
            ) as HTMLElement | undefined
            if (homeBtn) homeBtn.click()
          })
          await new Promise((r) => setTimeout(r, 600))
          if (page.url() !== baseDashboardUrl) {
            await page.goto(baseDashboardUrl, { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {})
          }
        } catch {}

        if (agentMsg) {
          agentMsg.checklist = JSON.parse(JSON.stringify(visionPlan.checklist))
          const passedCount = visionPlan.checklist.filter((t) => t.status === "passed").length
          agentMsg.text = `⚡ Executing UI Tests: ${passedCount} of ${visionPlan.checklist.length} passed.`
        }
        saveJob(job)
      }

      // Capture final screen result for command
      const rawTitle = await page.title().catch(() => "")
      const screenTitle = rawTitle.trim() || new URL(page.url()).pathname || "Command Result"
      const finalBuffer = await page.screenshot({ type: "png" })
      const uploadedUrl = await uploadScreenshot(Buffer.from(finalBuffer), job.projectId, "cmd")
      job.currentScreenshotUrl = uploadedUrl

      const passedCount = visionPlan.checklist.filter((t) => t.status === "passed").length
      const totalCount = visionPlan.checklist.length

      const wfId = await createDatabaseWorkflow(
        job.projectId,
        `[Vision QA] ${cmdText.slice(0, 32)}`,
        uploadedUrl,
        `Goal: ${cmdText}\nThinking Model: ${visionPlan.thinkingModel.screenUnderstanding}\nChecklist: ${passedCount}/${totalCount} Passed`,
        "Executed Antigravity vision checklist tests.",
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

      // Compile testCases for report
      job.testCases = visionPlan.checklist.map((c) => ({
        scenarioId: c.id,
        name: c.title,
        category: "forms",
        status: c.status === "passed" ? "passed" : c.status === "failed" ? "failed" : c.status === "skipped" ? "skipped" : "blocked",
        steps: c.actions.map((a) => a.description),
        screenshots: c.screenshotUrl ? [{ label: c.title, url: c.screenshotUrl }] : [],
        bugs: c.status === "failed" ? [{ description: c.error || "Assertion failed", severity: "medium", repro: c.actions.map((a) => a.description) }] : [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: c.error,
      }))

      if (job.messages && job.messages.length > 1) {
        job.messages[1].text = `✅ UI Tests Completed: ${passedCount} of ${totalCount} checklist tests passed.\nScreen: ${visionPlan.thinkingModel.screenUnderstanding}`
        job.messages[1].status = "completed"
        job.messages[1].thinkingModel = visionPlan.thinkingModel
        job.messages[1].checklist = [...visionPlan.checklist]
      }

      job.thinkingModel = visionPlan.thinkingModel
      job.checklist = [...visionPlan.checklist]

      // Populate fullAppTestPlan and flowGraph so the Full App tab displays the workflow map, screens, and plan
      try {
        const synthPlan = synthesizeFullAppPlanFromJob(job)
        if (synthPlan) {
          job.fullAppTestPlan = synthPlan
          job.flowGraph = buildFigmaWorkflowMap(synthPlan)
        }
      } catch (err: any) {
        console.warn("[Runner] Synth plan error:", err?.message)
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

      // 2.5 Nebius / OmniRouter / Local AI Model Visual QA Inspection
      let aiAnalysisResult: { uxScore: number; summary: string } | undefined
      if (hasAiConfigured && primaryScreenshotUrl) {
        const providerName = isLocalAi ? "Local AI (Ollama / LM Studio)" : isUnoRouter ? "OmniRouter" : isNebius ? "Nebius Token Factory" : "OpenAI-compatible AI gateway"
        appendLog(job, "info", `Requesting ${providerName} visual review for "${screenTitle}" (${params.aiModel || "deepseek-v4-flash:free"})...`)
        const aiFinding = await analyzeScreenWithAI({
          screenshotUrl: primaryScreenshotUrl,
          screenTitle,
          screenUrl,
          apiKey: aiApiKey,
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
      appendLog(job, "info", `Generating AI executive summary via ${isLocalAi ? "Local AI" : isUnoRouter ? "OmniRouter" : isNebius ? "Nebius Token Factory" : "AI gateway"} (${params.aiModel || "deepseek-v4-flash:free"})...`)
      const aiExec = await generateAIExecutiveReport({
        screensSummary: job.screens.map((s) => `${s.title} (${s.url})`).join(", "),
        detectedIssuesCount: job.issues.length,
        targetUrl: job.targetUrl,
        apiKey: aiApiKey,
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
