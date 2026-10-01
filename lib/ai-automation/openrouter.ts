export interface AIScreenAnalysisResult {
  issues: Array<{
    title: string
    severity: "low" | "medium" | "high" | "blocker"
    description: string
    recommendation?: string
  }>
  uxScore: number // 0-100
  summary: string
}

export interface AIExecutiveReportResult {
  executiveSummary: string
  keyStrengths: string[]
  criticalFixes: string[]
  overallScore: number
}

export const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1"
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
const OPENROUTER_DEFAULT_MODEL = "google/gemini-2.0-flash-001"
// Free flagship-class model on UnoRouter. Small :free models (space-bunny,
// atria-dawn) are too weak for the observe → decide → act browser loop —
// use a flagship :free variant (deepseek-v4-flash:free, gpt-5.5:free) instead.
const UNOROUTER_DEFAULT_MODEL = "deepseek-v4-flash:free"

function isLocalBase(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1")
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || UNOROUTER_BASE_URL).replace(/\/$/, "")
}

function resolveModel(base: string, model?: string): string {
  const m = model?.trim()
  if (m) return m
  return base.includes("openrouter.ai") ? OPENROUTER_DEFAULT_MODEL : UNOROUTER_DEFAULT_MODEL
}

/**
 * Builds auth headers. Returns null when a key is required but missing —
 * callers must fail LOUDLY in that case, never silently fall back to a
 * placeholder key (remote gateways like UnoRouter reject those with 401).
 * Local gateways (localhost) genuinely don't need a key.
 */
function buildHeaders(base: string, apiKey?: string): Record<string, string> | null {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`
  } else if (!isLocalBase(base)) {
    return null
  }
  if (base.includes("openrouter")) {
    headers["HTTP-Referer"] = "http://localhost:3000"
    headers["X-Title"] = "Design Workflow Tracker"
  }
  return headers
}

/**
 * POST with retry on 429 honoring Retry-After.
 * UnoRouter's free tier is ~1 request/min per model, and Stagehand's agent
 * loop makes many calls — without this the agent dies on the first throttle.
 */
async function postChatCompletion(
  base: string,
  headers: Record<string, string>,
  body: unknown,
  label: string,
  maxRetries = 4,
): Promise<Response> {
  let attempt = 0
  for (;;) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after") || "60")
      const waitSec = Math.min(Math.max(Number.isNaN(retryAfter) ? 60 : retryAfter, 2), 180)
      console.warn(
        `[AI] ${label}: rate limited (429). Waiting ${waitSec}s before retry ${attempt + 1}/${maxRetries}... ` +
          `Tip: rotate between free models (deepseek-v4-flash:free, gpt-5.5:free) for more throughput.`,
      )
      await new Promise((r) => setTimeout(r, waitSec * 1000))
      attempt++
      continue
    }
    return res
  }
}

function missingKeyWarning(label: string): void {
  console.warn(
    `[AI] ${label}: no API key for remote gateway. ` +
      `Get a free key at https://unorouter.com/token and set it in AI Settings → OmniRouter. ` +
      `AI features are disabled until then — this is NOT silent, fix the key to proceed.`,
  )
}

export async function analyzeScreenWithAI({
  screenshotUrl,
  screenTitle,
  screenUrl,
  apiKey,
  baseUrl = UNOROUTER_BASE_URL,
  model,
}: {
  screenshotUrl: string
  screenTitle: string
  screenUrl: string
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<AIScreenAnalysisResult | null> {
  const cleanBase = resolveBaseUrl(baseUrl)

  const headers = buildHeaders(cleanBase, apiKey)
  if (!headers) {
    missingKeyWarning("Screen analysis")
    return null
  }
  if (!screenshotUrl) return null

  try {
    const isDataUri = screenshotUrl.startsWith("data:")
    const imageUrl = isDataUri ? screenshotUrl : screenshotUrl

    const prompt = `You are a Senior UI/UX Quality Assurance Engineer.
Perform an automated visual inspection of this screen:
- Screen Title: "${screenTitle}"
- Target URL: ${screenUrl}

Identify visual defects, layout alignment errors, typography clipping, contrast issues, responsive inconsistencies, and touch target violations.

Return strictly valid JSON in this schema:
{
  "issues": [
    {
      "title": "Short title of defect",
      "severity": "low" | "medium" | "high" | "blocker",
      "description": "Specific visual defect description and where it occurs",
      "recommendation": "How to fix in CSS / React"
    }
  ],
  "uxScore": 85,
  "summary": "1-2 sentence overall visual assessment"
} `

    const res = await postChatCompletion(
      cleanBase,
      headers,
      {
        model: resolveModel(cleanBase, model),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      },
      "Screen analysis",
    )

    if (!res.ok) {
      const errText = await res.text()
      console.warn("[AI Vision] Screen analysis API notice:", res.status, errText)
      return null
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null

    const parsed: AIScreenAnalysisResult = JSON.parse(content)
    return parsed
  } catch (err) {
    console.warn("[AI Vision] Failed screen analysis:", err)
    return null
  }
}

export async function generateAIExecutiveReport({
  screensSummary,
  detectedIssuesCount,
  targetUrl,
  apiKey,
  baseUrl = UNOROUTER_BASE_URL,
  model,
}: {
  screensSummary: string
  detectedIssuesCount: number
  targetUrl: string
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<AIExecutiveReportResult | null> {
  const cleanBase = resolveBaseUrl(baseUrl)

  const headers = buildHeaders(cleanBase, apiKey)
  if (!headers) {
    missingKeyWarning("Executive report")
    return null
  }

  try {
    const prompt = `You are a Principal Product Designer and QA Architect.
Generate an executive audit summary for an automated UI crawl of: ${targetUrl}.

Audit details:
- Screens inspected: ${screensSummary}
- Total detected bugs/issues: ${detectedIssuesCount}

Return strictly valid JSON in this schema:
{
  "executiveSummary": "Concise 2-3 sentence overview of app visual stability and navigation health.",
  "keyStrengths": ["Strength 1", "Strength 2"],
  "criticalFixes": ["Priority fix 1", "Priority fix 2", "Priority fix 3"],
  "overallScore": 88
}`

    const res = await postChatCompletion(
      cleanBase,
      headers,
      {
        model: resolveModel(cleanBase, model),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: "json_object" },
      },
      "Executive report",
    )

    if (!res.ok) return null

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null

    return JSON.parse(content) as AIExecutiveReportResult
  } catch (err) {
    console.warn("[AI Vision] Failed executive report generation:", err)
    return null
  }
}

export interface AICommandInterpretation {
  planSummary: string
  actions: Array<{
    type: "navigate" | "click" | "type" | "back" | "scroll" | "assert" | "inspect"
    target?: string
    value?: string
    thought: string
    description: string
  }>
}

export async function interpretCommandWithAI({
  command,
  currentUrl,
  apiKey,
  baseUrl = UNOROUTER_BASE_URL,
  model,
}: {
  command: string
  currentUrl: string
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<AICommandInterpretation> {
  const cleanBase = resolveBaseUrl(baseUrl)

  // Fallback heuristic interpreter if no key or offline
  const fallbackInterpretation = (): AICommandInterpretation => {
    const lower = command.toLowerCase()
    const actions: AICommandInterpretation["actions"] = []

    if (lower.includes("back")) {
      actions.push({
        type: "back",
        thought: "Testing browser history popstate to assert exact previous screen restoration.",
        description: "Trigger native browser back navigation ↩️",
      })
      actions.push({
        type: "assert",
        thought: "Asserting current URL and state match expected origin without history drift.",
        description: "Validate back navigation state fidelity",
      })
      return {
        planSummary: "Executing native back button test and history state assertion.",
        actions,
      }
    }

    if (lower.includes("scroll")) {
      actions.push({
        type: "scroll",
        thought: "Scrolling viewport to audit sticky navigation containment and footer layout.",
        description: "Scroll down 400px to test layout containment",
      })
      return {
        planSummary: "Auditing layout below the fold and sticky header positioning.",
        actions,
      }
    }

    if (lower.includes("mobile") || lower.includes("responsive") || lower.includes("overflow")) {
      actions.push({
        type: "inspect",
        thought: "Switching viewport to 390px Mobile and auditing for horizontal scroll leaks.",
        description: "Inspect mobile responsive layout bounds",
      })
      actions.push({
        type: "assert",
        thought: "Asserting document.documentElement.scrollWidth <= window.innerWidth.",
        description: "Assert no horizontal overflow leak",
      })
      return {
        planSummary: "Conducting responsive viewport audit across mobile and tablet widths.",
        actions,
      }
    }

    if (lower.includes("click") || lower.includes("toggle") || lower.includes("switch")) {
      const match = command.match(/click\s+(?:on\s+)?["']?([^"'\n,]+)["']?/i)
      const targetName = match ? match[1].trim() : "interactive element"
      actions.push({
        type: "click",
        target: targetName,
        thought: `Locating and clicking "${targetName}" to verify event listeners and state updates.`,
        description: `Click ${targetName}`,
      })
      return {
        planSummary: `Finding and clicking "${targetName}" to verify UI reactivity.`,
        actions,
      }
    }

    // Default general inspection plan
    actions.push({
      type: "inspect",
      thought: `Analyzing interactive surface on ${currentUrl} based on user instruction: "${command}".`,
      description: `Audit interactive controls for: ${command}`,
    })
    actions.push({
      type: "assert",
      thought: "Checking for uncaught JavaScript console exceptions and broken image assets.",
      description: "Verify screen stability and asset fidelity",
    })

    return {
      planSummary: `Executing browser inspection for command: "${command}"`,
      actions,
    }
  }

  const headers = buildHeaders(cleanBase, apiKey)
  if (!headers) {
    // No key for a remote gateway: say so loudly, then use the offline
    // heuristic planner so the UI still does something useful.
    missingKeyWarning("Command interpreter")
    return fallbackInterpretation()
  }

  try {
    const prompt = `You are Google Antigravity's autonomous Browser Control Agent.
The user is testing a web application at: ${currentUrl}
The user gives this testing command:
"${command}"

Break down this user command into an ordered sequence of browser testing actions.
Supported action types: "navigate" | "click" | "type" | "back" | "scroll" | "assert" | "inspect"

Return strictly valid JSON in this schema:
{
  "planSummary": "1-2 sentence overview of your testing plan",
  "actions": [
    {
      "type": "click",
      "target": "text or CSS selector or description of element",
      "value": "text to type if type action",
      "thought": "Agent's reasoning for this step",
      "description": "Short human-readable action label"
    }
  ]
}`

    const res = await postChatCompletion(
      cleanBase,
      headers,
      {
        model: resolveModel(cleanBase, model),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
      },
      "Command interpreter",
    )

    if (!res.ok) return fallbackInterpretation()

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return fallbackInterpretation()

    const parsed = JSON.parse(content) as AICommandInterpretation
    if (!parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
      return fallbackInterpretation()
    }
    return parsed
  } catch (err) {
    console.warn("[AI Command] Falling back to heuristic command interpreter:", err)
    return fallbackInterpretation()
  }
}
