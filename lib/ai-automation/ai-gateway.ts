import type { AIThinkingModel, ChecklistTestItem, AgentAction } from "./types"

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

export const NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
export const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1"
const NEBIUS_DEFAULT_MODEL = "nvidia/Nemotron-3-Nano-Omni"
// Free flagship-class model on UnoRouter. Small :free models (space-bunny,
// atria-dawn) are too weak for the observe → decide → act browser loop —
// use a flagship :free variant (deepseek-v4-flash:free, gpt-5.5:free) instead.
const UNOROUTER_DEFAULT_MODEL = "deepseek-v4-flash:free"

function isLocalBase(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1")
}

export function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || NEBIUS_BASE_URL).replace(/\/$/, "")
}


/** Resolve a provider key without sending a Nebius key to OmniRouter or vice versa. */
export function resolveAiApiKey(baseUrl?: string, providedKey?: string): string | undefined {
  if (providedKey?.trim()) return providedKey.trim()
  const base = resolveBaseUrl(baseUrl)
  if (isLocalBase(base)) return undefined
  if (base.includes("tokenfactory.nebius.com")) {
    return process.env.NEBIUS_TOKEN_FACTORY_KEY || process.env.NEBIUS_API_KEY || process.env.AI_API_KEY
  }
  if (base.includes("unorouter.com")) {
    return process.env.UNOROUTER_API_KEY || process.env.AI_API_KEY
  }
  return process.env.AI_API_KEY
}

export function resolveModel(base: string, model?: string): string {
  const m = model?.trim()
  if (m) {
    if (isLocalBase(base) && m === "deepseek-v4-flash:free") {
      return "fast"
    }
    return m
  }
  return base.includes("tokenfactory.nebius.com")
    ? NEBIUS_DEFAULT_MODEL
    : isLocalBase(base)
    ? "fast"
    : UNOROUTER_DEFAULT_MODEL
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
  return headers
}

export function parseJsonSafe<T>(raw: string): T | null {
  if (!raw) return null
  const cleaned = raw.trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {}

  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T
    } catch {}
  }

  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1)) as T
    } catch {}
  }

  return null
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

export async function postChatCompletionSafe(
  base: string,
  apiKey: string | undefined,
  body: unknown,
  label: string
): Promise<Response | null> {
  const headers = buildHeaders(base, apiKey)
  if (!headers) {
    missingKeyWarning(label)
    return null
  }
  return postChatCompletion(base, headers, body, label)
}

function missingKeyWarning(label: string): void {
  console.warn(
    `[AI] ${label}: no API key for remote gateway. ` +
      `Add a Nebius Token Factory API key in AI Settings, or select OmniRouter/local AI. ` +
      `AI features are disabled until then — this is NOT silent, fix the key to proceed.`,
  )
}

export async function analyzeScreenWithAI({
  screenshotUrl,
  screenTitle,
  screenUrl,
  apiKey,
  baseUrl = NEBIUS_BASE_URL,
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

    const parsed = parseJsonSafe<AIScreenAnalysisResult>(content)
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
  baseUrl = NEBIUS_BASE_URL,
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

    return parseJsonSafe<AIExecutiveReportResult>(content)
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

export interface CommandInterpretationResult extends AICommandInterpretation {
  /** True when the offline heuristic planner was used instead of the AI model. */
  usedFallback: boolean
  /** Human-readable reason the AI call did not produce a plan. Set when usedFallback is true. */
  fallbackReason?: string
}

export type PageInspectionContext = {
  title?: string
  url?: string
  inputs?: Array<{
    type: string
    name: string
    placeholder: string
    value: string
    hasValue: boolean
  }>
  buttons?: Array<{
    text: string
    type: string
    area?: string
  }>
  interactiveElements?: Array<{
    text: string
    cleanText: string
    tag: string
    type?: string
    area?: string
    role?: string
  }>
  forms?: Array<{
    id?: string
    fields: string[]
    submitLabel: string
  }>
  hasLoginForm?: boolean
  hasPreFilledCredentials?: boolean
}

export async function interpretCommandWithAI({
  command,
  currentUrl,
  apiKey,
  baseUrl = NEBIUS_BASE_URL,
  model,
  pageContext,
  credentials,
}: {
  command: string
  currentUrl: string
  apiKey?: string
  baseUrl?: string
  model?: string
  pageContext?: PageInspectionContext | null
  credentials?: {
    username?: string
    password?: string
  }
}): Promise<CommandInterpretationResult> {
  const cleanBase = resolveBaseUrl(baseUrl)

  const asResult = (
    interpretation: AICommandInterpretation,
    usedFallback: boolean,
    fallbackReason?: string,
  ): CommandInterpretationResult => ({ ...interpretation, usedFallback, fallbackReason })

  // Fallback heuristic interpreter if no key or offline.
  // The reason is ALWAYS recorded — the UI must show it instead of a fake success.
  const fallbackInterpretation = (reason: string): CommandInterpretationResult =>
    asResult(fallbackInterpretationInner(), true, reason)

  const fallbackInterpretationInner = (): AICommandInterpretation => {
    const lower = command.toLowerCase().trim()
    const actions: AICommandInterpretation["actions"] = []

    if (/^(hi|hello|hey|greetings|start|test)(\s.*)?$/i.test(lower)) {
      actions.push({
        type: "inspect",
        thought: "User initiated agent session. Auditing page stability, buttons, and navigation.",
        description: "Audit current screen and interactive controls",
      })
      return {
        planSummary: "Session initialized. Screen inspected and ready for commands.",
        actions,
      }
    }

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

    if (
      lower.includes("login") ||
      lower.includes("sign in") ||
      lower.includes("signin") ||
      lower.includes("log in") ||
      lower.includes("logining") ||
      lower.includes("auth") ||
      lower.includes("creds") ||
      lower.includes("credential") ||
      lower.includes("detail") ||
      lower.includes("input") ||
      pageContext?.hasLoginForm
    ) {
      if (pageContext?.hasPreFilledCredentials) {
        // Form ALREADY has details filled in
        actions.push({
          type: "inspect",
          thought: "Detected pre-filled credentials in input fields. Verifying credentials presence before submission.",
          description: "Verify pre-filled login credentials",
        })
        actions.push({
          type: "click",
          target: "Sign in",
          thought: "Submitting pre-filled credentials by clicking Sign in button.",
          description: "Click Sign in button",
        })
        actions.push({
          type: "inspect",
          thought: "Waiting for dashboard to authenticate and render.",
          description: "Verify authenticated dashboard loaded",
        })
        return {
          planSummary: "Test Plan: 1. Confirm pre-filled credentials. 2. Click Sign In. 3. Verify post-login dashboard.",
          actions,
        }
      } else {
        // Form is EMPTY — decide test checklist: validation -> fill -> submit
        const testUser = credentials?.username || "john.smith@example.co.uk"
        const testPass = credentials?.password || "Password123!"

        actions.push({
          type: "inspect",
          thought: "Input fields are empty. Auditing initial empty state.",
          description: "Inspect empty login inputs",
        })
        actions.push({
          type: "click",
          target: "Sign in",
          thought: "Testing required-field validation by submitting empty form.",
          description: "Test empty submission validation",
        })
        actions.push({
          type: "type",
          target: "input[type='email'], input[name*='email'], input[type='text']",
          value: testUser,
          thought: `Populating email field with test credentials (${testUser}).`,
          description: `Enter email: ${testUser}`,
        })
        actions.push({
          type: "type",
          target: "input[type='password']",
          value: testPass,
          thought: "Populating password field with secure credentials.",
          description: "Enter password",
        })
        actions.push({
          type: "click",
          target: "Sign in",
          thought: "Submitting credentials to authenticate.",
          description: "Click Sign in",
        })
        actions.push({
          type: "inspect",
          thought: "Validating authenticated dashboard navigation.",
          description: "Verify authenticated dashboard loaded",
        })
        return {
          planSummary: "Test Plan (Empty Inputs): 1. Audit empty form. 2. Test empty submission validation. 3. Enter test credentials. 4. Submit and verify login.",
          actions,
        }
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
    return fallbackInterpretation(
      "No API key configured for the remote gateway. Add a free key in AI Settings \u2192 OmniRouter, or point the gateway URL at a local endpoint.",
    )
  }

  try {
    const contextDetails = pageContext
      ? `Live Screen State:
- Screen Title: "${pageContext.title || "Application"}"
- Detected Input Fields: ${JSON.stringify(pageContext.inputs || [])}
- Detected Buttons: ${JSON.stringify(pageContext.buttons || [])}
- Form State: ${pageContext.hasLoginForm ? (pageContext.hasPreFilledCredentials ? "Pre-filled credentials detected in inputs." : "Form inputs are EMPTY.") : "Interactive page."}
${credentials?.username ? `- Provided Test Account: ${credentials.username}` : ""}`
      : `Screen URL: ${currentUrl}`

    const prompt = `You are Google Antigravity's autonomous Browser QA Agent.
${contextDetails}

User Testing Instruction / Intent:
"${command}"

YOUR CORE OBJECTIVE:
1. Examine the page's input fields:
   - Check if inputs ALREADY have details in them.
   - If inputs have details: formulate the plan to verify prefilled details and click submit to test authentication.
   - If inputs are EMPTY: dynamically decide the test checklist to perform (e.g. 1. Test empty form validation, 2. Enter test credentials, 3. Submit and verify login) and list each test.
2. In "planSummary", list out the numbered tests to perform clearly (e.g. "Test Plan: 1. Check empty inputs. 2. Test empty submission. 3. Enter credentials. 4. Submit and verify dashboard.").
3. In "actions", provide the exact executable actions to execute those tests in sequence.
Supported action types: "navigate" | "click" | "type" | "back" | "scroll" | "assert" | "inspect"

IMPORTANT: Output ONLY a valid JSON object matching the schema below. Do NOT write any conversational text, pleasantries, preambles, or explanations like "I appreciate...". Your response MUST start with "{" and end with "}".
{
  "planSummary": "Numbered list of tests you decided to perform",
  "actions": [
    {
      "type": "click",
      "target": "text of button or input selector (e.g. 'Sign in', 'input[type=email]')",
      "value": "text to type if action is type",
      "thought": "Reasoning for this test step",
      "description": "Short human-readable test step label"
    }
  ]
}`

    const requestBody: any = {
      model: resolveModel(cleanBase, model),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 700,
    }
    if (!isLocalBase(cleanBase)) {
      requestBody.response_format = { type: "json_object" }
    }

    const res = await postChatCompletion(
      cleanBase,
      headers,
      requestBody,
      "Command interpreter",
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      let reason = ""
      try {
        const errObj = JSON.parse(errText)
        reason = errObj?.error?.message || errObj?.message || errText
      } catch {
        reason = errText
      }
      reason = (reason || "").replace(/\s+/g, " ").trim().slice(0, 220)
      console.warn(`[AI Command] Gateway error HTTP ${res.status}:`, reason)
      return fallbackInterpretation(
        `AI gateway returned HTTP ${res.status}${reason ? `: ${reason}` : " — the provider may be down, rate-limiting, or rejecting the model name."}`,
      )
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return fallbackInterpretation("The AI gateway returned an empty response.")

    const parsed = parseJsonSafe<AICommandInterpretation>(String(content))
    if (!parsed || !parsed.actions || !Array.isArray(parsed.actions) || parsed.actions.length === 0) {
      // Model replied with conversational text (e.g. greeting or clarification)
      const conversationalSummary = String(content).replace(/[\r\n]+/g, " ").trim().slice(0, 160)
      return asResult(
        {
          planSummary: conversationalSummary || `Auditing application for: "${command}"`,
          actions: [
            {
              type: "inspect",
              thought: `Interpreted user intent for "${command}". ${conversationalSummary}`,
              description: `Audit screen for: ${command}`,
            },
          ],
        },
        false,
      )
    }
    return asResult(parsed, false)
  } catch (err: any) {
    console.warn("[AI Command] Falling back to heuristic command interpreter:", err)
    return fallbackInterpretation(`AI request failed: ${err?.message || "network error"}.`)
  }
}

export interface VisionChecklistRequest {
  screenshotUrl: string
  command?: string
  currentUrl: string
  apiKey?: string
  baseUrl?: string
  model?: string
  pageContext?: PageInspectionContext | null
  credentials?: {
    username?: string
    password?: string
  }
}

export interface VisionChecklistResponse {
  thinkingModel: AIThinkingModel
  checklist: ChecklistTestItem[]
  usedFallback: boolean
  fallbackReason?: string
}

function uid(prefix: string, i: number): string {
  return `${prefix}-${Date.now().toString(36)}-${i}`
}

function fallbackVisionThinkingModelAndChecklist(
  req: VisionChecklistRequest,
  reason: string,
): VisionChecklistResponse {
  const lower = (req.command || "").toLowerCase()
  const urlLower = (req.currentUrl || "").toLowerCase()
  const titleLower = (req.pageContext?.title || "").toLowerCase()
  const pageInputsStr = (
    req.pageContext?.inputs?.map((i) => `${i.name} ${i.placeholder} ${i.type}`).join(" ") || ""
  ).toLowerCase()
  const pageButtonsStr = (
    req.pageContext?.buttons?.map((b) => b.text).join(" ") || ""
  ).toLowerCase()

  const isSignup =
    lower.includes("sign up") ||
    lower.includes("signup") ||
    lower.includes("register") ||
    lower.includes("create account") ||
    lower.includes("join") ||
    urlLower.includes("signup") ||
    urlLower.includes("register") ||
    titleLower.includes("sign up") ||
    titleLower.includes("register")

  const isLogin =
    !isSignup &&
    (lower.includes("login") ||
      lower.includes("signin") ||
      lower.includes("sign in") ||
      urlLower.includes("login") ||
      urlLower.includes("signin") ||
      req.pageContext?.hasLoginForm ||
      pageButtonsStr.includes("sign in") ||
      pageButtonsStr.includes("login") ||
      pageInputsStr.includes("password"))

  if (isSignup) {
    const thinkingModel: AIThinkingModel = {
      screenUnderstanding:
        "User Registration / Sign Up Screen. Visual inspection identifies primary form container with registration fields (Name, Email, Password, Confirmation, Terms checkbox) and 'Create Account / Sign Up' call-to-action button.",
      identifiedElements: [
        { name: "Full Name Input", type: "input", selector: "input[name*='name'], input[id*='name'], input[placeholder*='Name']", purpose: "Captures new user's full name" },
        { name: "Email Input", type: "input", selector: "input[type='email'], input[name*='email']", purpose: "Account identity and email verification" },
        { name: "Password Input", type: "input", selector: "input[type='password']:first-of-type", purpose: "User authentication password (must satisfy policy)" },
        { name: "Confirm Password Input", type: "input", selector: "input[name*='confirm'], input[id*='confirm'], input[type='password']:last-of-type", purpose: "Verification of password match" },
        { name: "Terms & Conditions Checkbox", type: "checkbox", selector: "input[type='checkbox']", purpose: "Mandatory legal agreement before account creation" },
        { name: "Sign Up CTA Button", type: "button", selector: "button[type='submit'], button", purpose: "Submits registration payload to backend" },
        { name: "Already have an account? Login Link", type: "link", selector: "a[href*='login'], a", purpose: "Alternative route to login screen" },
      ],
      riskAssessment: [
        "Empty field submission may bypass validation or trigger unhandled server exceptions",
        "Invalid email syntax (missing @ or domain) might be accepted",
        "Weak passwords (<8 characters or no digits) must be blocked by validation policy",
        "Password and Confirm Password mismatch should provide instant visual error cues",
        "Mandatory terms checkbox must prevent form submission when unchecked",
        "Double-clicking submit button might send duplicate registration requests",
      ],
      strategy:
        "Multi-phase QA Plan: 1. Verify empty form submission triggers required warnings. 2. Verify invalid email rejection. 3. Verify password policy enforcement. 4. Verify password confirmation mismatch check. 5. Verify terms acceptance requirement. 6. Execute successful valid registration with test data.",
    }

    const testEmail = `qa.test+${Date.now()}@example.com`
    const testPassword = "StrongPassword123!"

    const checklist: ChecklistTestItem[] = [
      {
        id: uid("chk", 1),
        title: "Test 1: Empty Form Submission Validation",
        goal: "Assert that submitting an empty form highlights required fields with validation warnings.",
        expectedOutcome: "Form does not submit; required input borders turn red or validation tooltips appear.",
        status: "pending",
        actions: [
          {
            id: uid("act", 1),
            type: "click",
            target: "button[type='submit'], button",
            description: "Click 'Sign Up' with blank inputs",
            thought: "Checking HTML5/React form validation triggers on empty submission.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 2),
            type: "assert",
            description: "Verify validation error indicators are rendered",
            thought: "Verifying form prevented invalid submission and displayed visual warning.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid("chk", 2),
        title: "Test 2: Invalid Email Syntax Rejection",
        goal: "Verify the email field rejects malformed addresses (e.g. missing @ or domain).",
        expectedOutcome: "Error message indicates invalid email format; form submission blocked.",
        status: "pending",
        actions: [
          {
            id: uid("act", 3),
            type: "type",
            target: "input[type='email'], input[name*='email'], input[placeholder*='mail']",
            value: "invalid-user-email-format",
            description: "Enter malformed email: 'invalid-user-email-format'",
            thought: "Testing regex/HTML5 email validation constraint.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 4),
            type: "click",
            target: "button[type='submit'], button",
            description: "Click 'Sign Up' to trigger email format validation",
            thought: "Submitting to assert email format error display.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 5),
            type: "assert",
            description: "Verify email format validation warning",
            thought: "Asserting email input displays invalid format warning.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid("chk", 3),
        title: "Test 3: Password Policy & Length Enforcement",
        goal: "Verify password input blocks weak/short passwords below minimum security requirements.",
        expectedOutcome: "Validation alert indicates password must meet minimum length/complexity.",
        status: "pending",
        actions: [
          {
            id: uid("act", 6),
            type: "type",
            target: "input[type='password']",
            value: "123",
            description: "Enter weak short password: '123'",
            thought: "Testing password strength requirement.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 7),
            type: "assert",
            description: "Verify password complexity/length warning",
            thought: "Verifying short password policy rejection.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid("chk", 4),
        title: "Test 4: Password Confirmation Matching",
        goal: "Verify that mismatched Password and Confirm Password inputs prevent submission.",
        expectedOutcome: "Validation message alerts that passwords do not match.",
        status: "pending",
        actions: [
          {
            id: uid("act", 8),
            type: "type",
            target: "input[type='password']",
            value: testPassword,
            description: `Enter valid password: '${testPassword}'`,
            thought: "Populating primary password field.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 9),
            type: "type",
            target: "input[name*='confirm'], input[id*='confirm'], input[type='password']:last-of-type",
            value: "MismatchPass999!",
            description: "Enter mismatched confirm password: 'MismatchPass999!'",
            thought: "Testing password mismatch validator.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 10),
            type: "assert",
            description: "Verify password mismatch error state",
            thought: "Asserting form flags password mismatch.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid("chk", 5),
        title: "Test 5: Valid Registration Data Entry",
        goal: "Populate all registration fields with valid synthetic test data and matching credentials.",
        expectedOutcome: "All input fields contain valid values without validation errors.",
        status: "pending",
        actions: [
          {
            id: uid("act", 11),
            type: "type",
            target: "input[name*='name'], input[id*='name'], input[placeholder*='Name']",
            value: "Alex Tester",
            description: "Enter Full Name: 'Alex Tester'",
            thought: "Filling valid user full name.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 12),
            type: "type",
            target: "input[type='email'], input[name*='email']",
            value: testEmail,
            description: `Enter valid email: '${testEmail}'`,
            thought: "Filling unique test email address.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 13),
            type: "type",
            target: "input[name*='confirm'], input[id*='confirm'], input[type='password']:last-of-type",
            value: testPassword,
            description: "Enter matching confirm password",
            thought: "Synchronizing confirm password to match primary password.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 14),
            type: "click",
            target: "input[type='checkbox']",
            description: "Check Terms of Service agreement checkbox",
            thought: "Accepting terms agreement to satisfy form requirement.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
      {
        id: uid("chk", 6),
        title: "Test 6: Form Submission & State Transition",
        goal: "Submit complete valid registration form and verify transition to dashboard or confirmation.",
        expectedOutcome: "Form submits successfully; user is redirected or receives confirmation toast.",
        status: "pending",
        actions: [
          {
            id: uid("act", 15),
            type: "click",
            target: "button[type='submit'], button",
            description: "Click 'Sign Up' / 'Create Account' button",
            thought: "Submitting validated registration payload.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
          {
            id: uid("act", 16),
            type: "inspect",
            description: "Inspect post-submission page transition and state",
            thought: "Auditing navigation or authenticated dashboard presentation.",
            status: "pending",
            timestamp: new Date().toISOString(),
          },
        ],
      },
    ]

    return { thinkingModel, checklist, usedFallback: true, fallbackReason: reason }
  }

  if (isLogin) {
    const hasExistingCreds = Boolean(
      req.pageContext?.hasPreFilledCredentials ||
        req.pageContext?.inputs?.some(
          (i) => i.hasValue && (i.type === "password" || i.value.length > 0),
        ),
    )

    const existingEmail =
      req.pageContext?.inputs?.find((i) => i.type === "email" || i.name?.includes("email"))?.value ||
      "john.smith@example.co.uk"

    const thinkingModel: AIThinkingModel = hasExistingCreds
      ? {
          screenUnderstanding: `Authentication / Sign In Screen with pre-filled test credentials (${existingEmail}). Form fields already contain credentials, password visibility toggle ('Show'), and 'Sign in' CTA button.`,
          identifiedElements: [
            {
              name: "Pre-filled Email Input",
              type: "input",
              selector: "input[type='email'], input#si-email",
              purpose: `Pre-populated email (${existingEmail})`,
            },
            {
              name: "Pre-filled Password Input",
              type: "input",
              selector: "input[type='password'], input#si-pass",
              purpose: "Pre-populated masked password field",
            },
            {
              name: "Password Visibility Toggle ('Show')",
              type: "button",
              selector: "button",
              purpose: "Toggles plain text password visibility",
            },
            {
              name: "Sign In CTA Button",
              type: "button",
              selector: "button[type='submit'], button",
              purpose: "Submits pre-filled authentication credentials",
            },
          ],
          riskAssessment: [
            "Password visibility toggle must reveal text and securely re-mask without clearing field value",
            "Submitting pre-filled valid credentials must authenticate without error and transition to dashboard",
            "Client identity ('John Smith') and portal document state must cleanly render upon landing",
          ],
          strategy:
            "1. Inspect pre-filled email and masked password state -> 2. Toggle password visibility ('Show') to verify reveal reaction -> 3. Submit authentication via 'Sign in' button -> 4. Assert transition to authenticated document portal.",
        }
      : {
          screenUnderstanding:
            "Authentication / Sign In Screen. Visual layout presents login form with user identity inputs (Email/Username, Password), optional remember-me checkbox, submit CTA, and password reset links.",
          identifiedElements: [
            {
              name: "Email/Username Input",
              type: "input",
              selector: "input[type='email'], input[name*='user']",
              purpose: "Account identification",
            },
            {
              name: "Password Input",
              type: "input",
              selector: "input[type='password']",
              purpose: "Authentication secret",
            },
            {
              name: "Sign In Button",
              type: "button",
              selector: "button[type='submit'], button",
              purpose: "Submits credentials",
            },
            {
              name: "Forgot Password Link",
              type: "link",
              selector: "a[href*='forgot'], a[href*='reset']",
              purpose: "Account recovery route",
            },
          ],
          riskAssessment: [
            "Submitting blank inputs should display required alerts",
            "Malformed email should be rejected before network request",
            "Failed authentication must show clear feedback without leaking credential specifics",
            "Successful login must smoothly transition to dashboard",
          ],
          strategy:
            "1. Test empty credentials rejection -> 2. Test invalid email formatting -> 3. Populate valid test account -> 4. Submit and verify authenticated dashboard.",
        }

    const testUser = req.credentials?.username || "alex.tester@example.com"
    const testPass = req.credentials?.password || "Password123!"

    const checklist: ChecklistTestItem[] = hasExistingCreds
      ? [
          {
            id: uid("chk", 1),
            title: "Test 1: Verify Pre-filled Credentials & Security State",
            goal: "Inspect that email and password fields are pre-populated and password is masked.",
            expectedOutcome: `Email contains '${existingEmail}' and password input has type='password'.`,
            status: "pending",
            actions: [
              {
                id: uid("act", 1),
                type: "inspect",
                target: "input[type='password'], #si-pass",
                description: `Verify credentials present (${existingEmail}) with masked password`,
                thought: "Auditing pre-filled credentials security and masking attributes.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 2),
            title: "Test 2: Toggle Password Visibility ('Show' / 'Hide')",
            goal: "Click the 'Show' button to toggle plain text password visibility, then toggle back to secure state.",
            expectedOutcome: "Password unmasks to plain text on first click and securely re-masks.",
            status: "pending",
            actions: [
              {
                id: uid("act", 2),
                type: "click",
                target: "Show",
                description: "Click 'Show' password button",
                thought: "Testing password reveal visibility toggle.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
              {
                id: uid("act", 3),
                type: "assert",
                description: "Assert password visibility toggled to plain text",
                thought: "Verifying password unmasking response.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 3),
            title: "Test 3: Submit Pre-filled Authentication Credentials",
            goal: "Click 'Sign in' button to submit existing credentials and authenticate user session.",
            expectedOutcome: "Form submits successfully; authentication transition starts.",
            status: "pending",
            actions: [
              {
                id: uid("act", 4),
                type: "click",
                target: "Sign in",
                description: "Click 'Sign in' button",
                thought: "Submitting pre-filled authentication credentials to backend.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 4),
            title: "Test 4: Verify Authenticated Client Document Portal Loaded",
            goal: "Verify post-login dashboard loaded with client name and document folder modules.",
            expectedOutcome: "Client document portal renders with 'Hello, John' or user account overview.",
            status: "pending",
            actions: [
              {
                id: uid("act", 5),
                type: "inspect",
                description: "Inspect authenticated document portal overview",
                thought: "Asserting authenticated dashboard and document cards loaded.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
        ]
      : [
          {
            id: uid("chk", 1),
            title: "Test 1: Empty Login Submission Validation",
            goal: "Assert that clicking Sign In with empty fields triggers required field error indicators.",
            expectedOutcome: "Form submission is blocked; inputs display required field alerts.",
            status: "pending",
            actions: [
              {
                id: uid("act", 1),
                type: "click",
                target: "button[type='submit'], button",
                description: "Click 'Sign In' with empty inputs",
                thought: "Testing required field validation on empty login form.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
              {
                id: uid("act", 2),
                type: "assert",
                description: "Verify validation error indicators",
                thought: "Verifying empty submission blocked.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 2),
            title: "Test 2: Invalid Email Format Rejection",
            goal: "Enter malformed email syntax and verify format validation triggers.",
            expectedOutcome: "Invalid email format warning is displayed.",
            status: "pending",
            actions: [
              {
                id: uid("act", 3),
                type: "type",
                target: "input[type='email'], input[name*='email'], input[type='text']",
                value: "not-an-email",
                description: "Enter malformed email: 'not-an-email'",
                thought: "Testing email input syntax check.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
              {
                id: uid("act", 4),
                type: "assert",
                description: "Verify email format error",
                thought: "Asserting email syntax rejection.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 3),
            title: "Test 3: Enter Test Credentials",
            goal: "Populate email and password inputs with valid test credentials.",
            expectedOutcome: "Input fields hold credentials ready for submission.",
            status: "pending",
            actions: [
              {
                id: uid("act", 5),
                type: "type",
                target: "input[type='email'], input[name*='email'], input[type='text']",
                value: testUser,
                description: `Enter email: '${testUser}'`,
                thought: "Entering test account email.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
              {
                id: uid("act", 6),
                type: "type",
                target: "input[type='password']",
                value: testPass,
                description: "Enter test password",
                thought: "Entering test account password.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 4),
            title: "Test 4: Submit Authentication & Verify Dashboard",
            goal: "Submit credentials and verify authenticated application dashboard loads.",
            expectedOutcome: "User authenticates; page transitions to authenticated dashboard.",
            status: "pending",
            actions: [
              {
                id: uid("act", 7),
                type: "click",
                target: "button[type='submit'], button",
                description: "Click 'Sign In' button",
                thought: "Submitting authentication credentials.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
              {
                id: uid("act", 8),
                type: "inspect",
                description: "Verify post-login dashboard loaded",
                thought: "Asserting authenticated view rendered.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
        ]

    return { thinkingModel, checklist, usedFallback: true, fallbackReason: reason }
  }

  // General Page Fallback
  const thinkingModel: AIThinkingModel = {
    screenUnderstanding: `General Application Screen: "${req.pageContext?.title || "Application"}". Layout features navigation header, main content region, and interactive buttons/links.`,
    identifiedElements: [
      { name: "Navigation Header", type: "other", selector: "header, nav", purpose: "Top-level application navigation" },
      { name: "Primary Action Buttons", type: "button", selector: "button, [role='button']", purpose: "Interactive commands" },
      { name: "Interactive Links", type: "link", selector: "a[href]", purpose: "Route navigation" },
    ],
    riskAssessment: [
      "Broken link destinations or unhandled 404 routes",
      "JavaScript runtime errors thrown during interactive element clicks",
      "Responsive layout horizontal overflow on mobile viewports",
    ],
    strategy: "1. Screen visual layout audit -> 2. Interactive controls testing -> 3. Responsive viewport assertion -> 4. Asset and console stability check.",
  }

  const checklist: ChecklistTestItem[] =
    req.pageContext?.interactiveElements && req.pageContext.interactiveElements.length > 0
      ? req.pageContext.interactiveElements.slice(0, 10).map((el, idx) => ({
          id: uid("chk", idx + 1),
          title: `Test ${idx + 1}: ${el.cleanText} (${el.area || "control"})`,
          goal: `Engage '${el.cleanText}' and verify view/modal response and stable return.`,
          expectedOutcome: `'${el.cleanText}' activates, transitions UI state, and returns safely to base view.`,
          status: "pending" as const,
          actions: [
            {
              id: uid("act", idx * 2 + 1),
              type: "click" as const,
              target: el.cleanText,
              description: `Click '${el.cleanText}'`,
              thought: `Triggering '${el.cleanText}' to verify UI reaction.`,
              status: "pending" as const,
              timestamp: new Date().toISOString(),
            },
            {
              id: uid("act", idx * 2 + 2),
              type: "inspect" as const,
              description: `Inspect resulting view for '${el.cleanText}'`,
              thought: `Auditing resulting state after interacting with '${el.cleanText}'.`,
              status: "pending" as const,
              timestamp: new Date().toISOString(),
            },
          ],
        }))
      : [
          {
            id: uid("chk", 1),
            title: "Test 1: Visual Layout & Navigation Header Audit",
            goal: "Inspect visual hierarchy, navigation links, and screen stability.",
            expectedOutcome: "Header and primary layout elements render cleanly without clipping.",
            status: "pending",
            actions: [
              {
                id: uid("act", 1),
                type: "inspect",
                description: "Audit layout bounds and header navigation",
                thought: "Auditing page visual containment.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 2),
            title: "Test 2: Interactive Controls & State Mutation",
            goal: "Engage detected inputs and click primary buttons to verify reactive state changes.",
            expectedOutcome: "Interactive controls accept input and state transitions without unhandled errors.",
            status: "pending",
            actions: [
              {
                id: uid("act", 2),
                type: "click" as const,
                target: req.pageContext?.buttons?.[0]?.text || "button, [role='button'], a",
                description: `Click '${req.pageContext?.buttons?.[0]?.text || "primary button"}'`,
                thought: "Testing UI event response and state transition.",
                status: "pending" as const,
                timestamp: new Date().toISOString(),
              },
            ],
          },
          {
            id: uid("chk", 3),
            title: "Test 3: Console Exception & Asset Integrity",
            goal: "Verify that zero unhandled JavaScript exceptions or broken images occurred.",
            expectedOutcome: "Zero uncaught exceptions and all critical assets loaded.",
            status: "pending",
            actions: [
              {
                id: uid("act", 3),
                type: "assert",
                description: "Verify zero fatal console errors",
                thought: "Asserting clean console execution.",
                status: "pending",
                timestamp: new Date().toISOString(),
              },
            ],
          },
        ]

  return { thinkingModel, checklist, usedFallback: true, fallbackReason: reason }
}

export async function generateVisionThinkingModelAndChecklist(
  req: VisionChecklistRequest,
): Promise<VisionChecklistResponse> {
  const cleanBase = resolveBaseUrl(req.baseUrl)
  const headers = buildHeaders(cleanBase, req.apiKey)

  if (!headers || !req.screenshotUrl) {
    const reason = !req.screenshotUrl
      ? "No screenshot image provided for vision analysis."
      : "No API key configured for remote vision gateway."
    return fallbackVisionThinkingModelAndChecklist(req, reason)
  }

  try {
    const interactiveListStr =
      req.pageContext?.interactiveElements && req.pageContext.interactiveElements.length > 0
        ? `\nDETECTED CLICKABLE CONTROLS ON SCREEN:\n${req.pageContext.interactiveElements
            .map(
              (el, i) =>
                `  ${i + 1}. Label: "${el.cleanText}" (${el.tag}${el.area ? `, area: ${el.area}` : ""}${
                  el.text !== el.cleanText ? `, full: "${el.text}"` : ""
                })`
            )
            .join("\n")}`
        : ""

    const contextDetails = req.pageContext
      ? `DOM Context:
- Title: "${req.pageContext.title || "App"}"
- Inputs: ${JSON.stringify(req.pageContext.inputs || [])}
- Buttons: ${JSON.stringify(req.pageContext.buttons || [])}
- Has Login Form: ${req.pageContext.hasLoginForm ? "Yes" : "No"}`
      : `Page URL: ${req.currentUrl}`

    const prompt = `You are a Principal UI/UX Quality Assurance Engineer & Vision Testing Bot.
Carefully examine the attached screenshot of the web page at: ${req.currentUrl}.
User Command / Goal: "${req.command || "Analyze screen, understand what it does, write down possible UI tests as a thinking model, make a checklist, and execute the tests"}"

${contextDetails}
${interactiveListStr}

YOUR CORE DELIVERABLES:
1. "thinkingModel":
   - "screenUnderstanding": Detailed explanation of what screen this is, its visual structure, layout, and UX purpose (e.g. "Client Document Portal for Landlord Accounting with sidebar navigation, property groups, document filters, and quick creation controls").
   - "identifiedElements": Array of every detected UI input, button, checkbox, link with { "name", "type": "input"|"button"|"link"|"checkbox"|"text", "selector", "purpose" }.
   - "riskAssessment": Array of specific risks, failure modes, and edge cases.
   - "strategy": Overview of the multi-phase QA execution strategy.

2. "checklist":
   - Array of ordered, concrete UI tests verifying the key clickable options and user workflows on this page.
   - Each checklist item MUST have:
     * "id": unique string (e.g. "chk-1")
     * "title": clear test name (e.g. "Test Navigation: Open 'My notes'")
     * "goal": what this test validates
     * "expectedOutcome": what must happen to pass
     * "status": "pending"
     * "actions": array of executable agent actions conforming to:
       {
         "type": "click" | "type" | "assert" | "inspect" | "scroll" | "back",
         "target": "EXACT label of the clickable option from DETECTED CLICKABLE CONTROLS (e.g. 'My notes', 'Kensington Flat', 'Add', 'All documents', 'Riverside Terraced House', 'My details', 'Light mode'). NEVER output generic 'button' or 'div'!",
         "value": "string value if type is 'type' or expected text if type is 'assert'",
         "thought": "Reasoning for this browser action",
         "description": "Short human-readable label (e.g. 'Click My notes', 'Click Kensington Flat', 'Assert notes visible')"
       }

CRITICAL RULES FOR "actions":
- For every "click" action, "target" MUST BE the EXACT text of the clickable option from the DETECTED CLICKABLE CONTROLS list above (for example: "All documents", "My notes", "Add", "Kensington Flat", "Riverside Terraced House", "My details", "Light mode").
- NEVER use generic "button" or "div" or "a" as target! The browser engine matches the exact text label to click the control.
- Each test item should exercise an interactive option, verify the resulting screen change, and expect navigation to return cleanly to base.

Return STRICTLY valid JSON conforming to this schema:
{
  "thinkingModel": {
    "screenUnderstanding": "...",
    "identifiedElements": [
      { "name": "...", "type": "input", "selector": "...", "purpose": "..." }
    ],
    "riskAssessment": ["..."],
    "strategy": "..."
  },
  "checklist": [
    {
      "id": "chk-1",
      "title": "...",
      "goal": "...",
      "expectedOutcome": "...",
      "status": "pending",
      "actions": [
        { "type": "click", "target": "...", "thought": "...", "description": "..." }
      ]
    }
  ]
}`

    const requestBody: any = {
      model: resolveModel(cleanBase, req.model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: req.screenshotUrl,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 2200,
    }

    if (!isLocalBase(cleanBase)) {
      requestBody.response_format = { type: "json_object" }
    }

    const res = await postChatCompletion(
      cleanBase,
      headers,
      requestBody,
      "Vision Thinking Model & Checklist",
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.warn(`[AI Vision Checklist] Gateway error HTTP ${res.status}:`, errText)
      return fallbackVisionThinkingModelAndChecklist(
        req,
        `AI gateway HTTP ${res.status} error. Falling back to screen heuristic checklist.`,
      )
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      return fallbackVisionThinkingModelAndChecklist(req, "AI gateway returned empty response.")
    }

    const parsed = parseJsonSafe<{
      thinkingModel: AIThinkingModel
      checklist: ChecklistTestItem[]
    }>(String(content))

    if (
      !parsed ||
      !parsed.thinkingModel ||
      !parsed.checklist ||
      !Array.isArray(parsed.checklist) ||
      parsed.checklist.length === 0
    ) {
      return fallbackVisionThinkingModelAndChecklist(req, "Failed to parse structured vision checklist.")
    }

    // Ensure IDs and initial statuses
    const normalizedChecklist = parsed.checklist.map((item, idx) => ({
      id: item.id || uid("chk", idx + 1),
      title: item.title || `Test ${idx + 1}`,
      goal: item.goal || "",
      expectedOutcome: item.expectedOutcome || "",
      status: "pending" as const,
      actions: (item.actions || []).map((act, actIdx) => ({
        id: (act as any).id || uid("act", actIdx + 1),
        type: act.type || "inspect",
        description: act.description || "Inspect element",
        thought: act.thought || "Verifying screen state",
        target: act.target,
        value: (act as any).value,
        status: "pending" as const,
        timestamp: new Date().toISOString(),
      })),
      observations: item.observations,
    }))

    return {
      thinkingModel: parsed.thinkingModel,
      checklist: normalizedChecklist,
      usedFallback: false,
    }
  } catch (err: any) {
    console.warn("[AI Vision Checklist] Failed, using fallback:", err)
    return fallbackVisionThinkingModelAndChecklist(req, `Vision analysis error: ${err?.message || "error"}`)
  }
}

