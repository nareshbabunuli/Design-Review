/**
 * Scenario planner for autonomous test runs.
 *
 * Produces N realistic end-to-end test scenarios for the target app.
 * Tries the configured AI gateway first; falls back to a heuristic
 * 15-scenario pack built from discovered routes. The fallback is
 * reported honestly (usedAi=false) — never presented as AI-planned.
 */

import type { TestScenario, TestScenarioCategory } from "./types"
import { parseJsonSafe } from "./openrouter"

const UNOROUTER_BASE_URL = "https://api.unorouter.com/v1"

function isLocalBase(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1")
}

function buildHeaders(base: string, apiKey?: string): Record<string, string> | null {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`
  } else if (!isLocalBase(base)) {
    return null
  }
  return headers
}

function uid(prefix: string, i: number): string {
  return `${prefix}-${Date.now().toString(36)}-${i}`
}

type PlannerOpts = {
  targetUrl: string
  routePaths: string[]
  hasCredentials: boolean
  landingHint?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  count?: number
}

export async function planScenarios(
  opts: PlannerOpts,
): Promise<{ scenarios: TestScenario[]; usedAi: boolean; error?: string }> {
  const count = Math.min(Math.max(opts.count || 15, 1), 25)

  // 1) Try the AI gateway.
  const base = (opts.baseUrl?.trim() || UNOROUTER_BASE_URL).replace(/\/$/, "")
  const headers = buildHeaders(base, opts.apiKey)
  if (headers) {
    try {
      const rawModel = opts.model?.trim()
      const model = isLocalBase(base)
        ? !rawModel || rawModel === "deepseek-v4-flash:free"
          ? "fast"
          : rawModel
        : rawModel || "deepseek-v4-flash:free"
      const routes = opts.routePaths.length > 0 ? opts.routePaths.join(", ") : "(no routes discovered yet)"
      const prompt = `You are a QA test planner. The target is a web application at ${opts.targetUrl}.
Known in-app routes: ${routes}.
${opts.landingHint ? `Landing page hint: ${opts.landingHint}` : ""}
${opts.hasCredentials ? "Valid test credentials WILL be supplied to the agent at runtime — include login success + login failure scenarios." : "No credentials are available — do NOT include scenarios that require login; include one scenario that probes whether the app requires authentication."}

Write exactly ${count} realistic end-to-end test scenarios covering: navigation, form validation, successful submissions (use obviously-fake data like "Test User" / qa+timestamp@example.com), error handling, auth, broken assets/console errors, and edge cases (404, back button, mobile viewport).

Return STRICTLY valid JSON: an array of objects with keys:
{ "name": string, "category": one of navigation|auth|forms|validation|error-handling|content|edge, "goal": string, "instruction": string (imperative steps for a browser agent), "needsAuth": boolean, "fillsForms": boolean, "expectedOutcome": string }

Rules: never invent credentials; never touch delete/destroy/purchase/checkout/logout controls; stay on the target origin; form submissions must use clearly-labeled test data.`

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2200,
          response_format: { type: "json_object" },
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const content: string | undefined = data?.choices?.[0]?.message?.content
        if (content) {
          const parsed = parseJsonSafe<any>(content)
          const arr = Array.isArray(parsed) ? parsed : parsed?.scenarios
          if (Array.isArray(arr) && arr.length > 0) {
            const scenarios = arr.slice(0, count).map((s: any, i: number) => ({
              id: uid("scn", i),
              name: String(s.name || `Scenario ${i + 1}`).slice(0, 80),
              category: validCategory(s.category),
              goal: String(s.goal || "").slice(0, 300),
              instruction: String(s.instruction || s.goal || "").slice(0, 1200),
              needsAuth: Boolean(s.needsAuth),
              fillsForms: Boolean(s.fillsForms),
              expectedOutcome: String(s.expectedOutcome || "").slice(0, 300),
            })) as TestScenario[]
            return { scenarios, usedAi: true }
          }
        }
        return { scenarios: heuristicScenarios(opts, count), usedAi: false, error: "AI planner returned no usable scenarios — using the built-in scenario pack." }
      }
      const errText = await res.text().catch(() => "")
      let reason = ""
      try {
        const errObj = JSON.parse(errText)
        reason = errObj?.error?.message || errObj?.message || errText
      } catch {
        reason = errText
      }
      reason = (reason || "").replace(/\s+/g, " ").trim().slice(0, 200)
      return {
        scenarios: heuristicScenarios(opts, count),
        usedAi: false,
        error: `AI planner gateway returned HTTP ${res.status}${reason ? `: ${reason}` : ""} — using the built-in scenario pack.`,
      }
    } catch (err: any) {
      return {
        scenarios: heuristicScenarios(opts, count),
        usedAi: false,
        error: `AI planner unreachable (${err?.message || "network error"}) — using the built-in scenario pack.`,
      }
    }
  }

  return {
    scenarios: heuristicScenarios(opts, count),
    usedAi: false,
    error: "No AI provider key for the remote gateway — using the built-in scenario pack. Add a key in AI Settings → OmniRouter for AI-planned scenarios.",
  }
}

function validCategory(c: any): TestScenarioCategory {
  const ok: TestScenarioCategory[] = ["navigation", "auth", "forms", "validation", "error-handling", "content", "edge"]
  return ok.includes(c) ? c : "content"
}

/**
 * Built-in 15-scenario pack. Generic enough for any web app, concrete
 * enough for the browser agent to execute without inventing data.
 */
function heuristicScenarios(opts: PlannerOpts, count: number): TestScenario[] {
  const routes = opts.routePaths.length > 0 ? opts.routePaths : ["/"]
  const routeList = routes.slice(0, 8).join(", ")
  const H = opts.hasCredentials

  const all: Array<Omit<TestScenario, "id">> = [
    {
      name: "Cold load smoke test",
      category: "navigation",
      goal: "The app loads at the entry URL with no blank screen, no uncaught JS errors and no broken images.",
      instruction: `Go to ${opts.targetUrl}. Wait for the page to settle. Report: is there visible content (not a blank screen)? Open the browser console state — note any uncaught errors. Count broken images. Do not click anything yet.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Visible content renders; zero uncaught JS errors; zero broken images.",
    },
    {
      name: "Primary navigation walk",
      category: "navigation",
      goal: "Visit each discovered in-app route and verify it renders.",
      instruction: `Visit each of these in-app routes one by one: ${routeList}. After each navigation, confirm the page shows real content (not blank, not a 500 error). Then use the browser Back button to return. Record every URL visited.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Every route renders content; back navigation returns to the previous screen.",
    },
    {
      name: "Back-button integrity",
      category: "navigation",
      goal: "Browser history works: forward navigation then Back restores the exact screen.",
      instruction: `From ${opts.targetUrl}, click the first safe internal navigation link you find. Note the new URL. Press the browser Back button. Verify you return to the exact previous URL and the page still renders.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Back returns to the exact previous URL with content intact.",
    },
    {
      name: "Mobile viewport smoke",
      category: "edge",
      goal: "The entry screen is usable at 390px width with no horizontal scroll leak.",
      instruction: `You are at mobile width. Scroll the whole page top to bottom. Check: does any content force horizontal scrolling? Are buttons and inputs reachable and tappable (not overlapping)? Report what breaks.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "No horizontal overflow; controls remain reachable at 390px.",
    },
    H
      ? {
          name: "Login with valid credentials",
          category: "auth",
          goal: "Sign in succeeds with the supplied test credentials and lands on an authenticated screen.",
          instruction: `Find the sign-in form (email + password + submit). Fill it with the credentials supplied by the test harness — never invent your own. Submit. Verify: did the URL change away from the login screen, or did an authenticated element (avatar, dashboard, logout control) appear? Capture a screenshot of the filled form BEFORE submitting (the harness masks secrets) and of the resulting screen after.`,
          needsAuth: true,
          fillsForms: true,
          expectedOutcome: "Authenticated screen reached; session persists after reload.",
        }
      : {
          name: "Auth wall probe",
          category: "auth",
          goal: "Determine whether the app requires authentication and where it redirects.",
          instruction: `Try visiting ${routes[0] || "/"}. If you are redirected to a login screen, report the login URL and which routes are protected. Do NOT attempt to log in (no credentials supplied). If no login exists, report that the app is publicly accessible.`,
          needsAuth: false,
          fillsForms: false,
          expectedOutcome: "Clear statement of which routes require auth, with the login URL if any.",
        },
    {
      name: "Login with wrong password",
      category: "validation",
      goal: "Invalid credentials produce a clear error — no crash, no silent failure, no navigation to a broken state.",
      instruction: `On the sign-in form, enter a syntactically valid email and an obviously wrong password ("WrongPass123!"). Submit. Verify: an inline or toast error appears explaining the failure, and you remain on the login screen. ${H ? "Use a wrong password, NOT the harness credentials." : "Skip gracefully with a note if no login form exists."}`,
      needsAuth: false,
      fillsForms: true,
      expectedOutcome: "Visible error message; still on login screen; no console exceptions.",
    },
    {
      name: "Form discovery and empty submit",
      category: "validation",
      goal: "The first meaningful form validates required fields instead of submitting empty.",
      instruction: `Find the first non-login form on the site (contact, create, settings — skip newsletter spam if it is the only form and say so). Click submit with all fields empty. Verify: required-field validation messages appear and no request that creates data is sent.`,
      needsAuth: false,
      fillsForms: true,
      expectedOutcome: "Client-side required validation blocks the empty submit with visible messages.",
    },
    {
      name: "Invalid email format rejected",
      category: "validation",
      goal: "Email inputs reject malformed addresses.",
      instruction: `In the first form with an email field, type "not-an-email" and submit (or blur the field). Verify: a validation error appears for the email field. Do not submit the form for real.`,
      needsAuth: false,
      fillsForms: true,
      expectedOutcome: "Malformed email is flagged by validation before any submission.",
    },
    {
      name: "Happy-path form fill and submit",
      category: "forms",
      goal: "A realistic form can be completed with test data and submits to a success state.",
      instruction: `Pick the most meaningful non-destructive form (create/add/contact). Fill every field with obviously-fake test data: name "QA Test User", email "qa-test+<timestamp>@example.com", text "Automated test — safe to delete". Capture a screenshot of the POPULATED form before submitting (secrets are masked by the harness). Submit. Verify and report the success state (confirmation message, new item in a list, URL change). If the form triggers payment, delete or publish, STOP and report it as skipped.`,
      needsAuth: false,
      fillsForms: true,
      expectedOutcome: "Success state reached with fake data; pre-submit screenshot captured.",
    },
    {
      name: "In-app search or filter",
      category: "content",
      goal: "Search/filter controls respond and show coherent results.",
      instruction: `If the app has a search box or filter dropdown, use it: search for a common term, then for a nonsense term ("zzz-no-match"). Verify: results update for the real term, and the nonsense term shows an empty state (not a crash). If no search exists, report that and skip.`,
      needsAuth: false,
      fillsForms: true,
      expectedOutcome: "Results update; empty query shows a designed empty state.",
    },
    {
      name: "Console error and broken-asset sweep",
      category: "content",
      goal: "No page in the main flow throws uncaught JS errors or serves broken images.",
      instruction: `Revisit each route: ${routeList}. On each, record uncaught console errors and count images that failed to load (naturalWidth 0 with a src). Summarize per route.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Per-route list of console errors and broken images (ideally zero).",
    },
    {
      name: "404 handling",
      category: "edge",
      goal: "An unknown route shows a designed 404 page, not a blank screen or stack trace.",
      instruction: `Navigate to ${opts.targetUrl.replace(/\/$/, "")}/__qa_no_such_page_404__. Verify: the app shows a 404/not-found page with a way back (link or button). Report if you see a raw error or blank page instead.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Designed 404 page with a recovery path.",
    },
    {
      name: "Deep-link and reload stability",
      category: "edge",
      goal: "Reloading an inner route keeps the user on that route with content intact.",
      instruction: `Navigate to ${routes[1] || routes[0] || "/"}. Reload the page. Verify: you stay on the same URL (no bounce to login or home unless auth genuinely requires it) and content renders.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Same URL after reload; content renders.",
    },
    {
      name: "Destructive controls are guarded",
      category: "error-handling",
      goal: "Delete/remove/destroy controls (if any) require confirmation — the agent must NOT execute them.",
      instruction: `Survey the UI for controls labeled delete, remove, destroy, cancel subscription or similar. Do NOT click them. For each, report: does it exist, and does hovering/focusing suggest a confirmation step? This is an audit only — never execute a destructive action.`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Inventory of destructive controls with their apparent guards; zero executed.",
    },
    {
      name: "Full user-journey pass",
      category: "navigation",
      goal: "Chain the app's core journey end to end: entry → key section → interaction → return.",
      instruction: `Act as a first-time user of this app. From ${opts.targetUrl}, complete the most central journey you can identify (e.g. browse → open item → interact → go back), using only safe controls. Narrate each step and finish with a verdict: does the core journey work without errors?`,
      needsAuth: false,
      fillsForms: false,
      expectedOutcome: "Core journey completes; step-by-step narration; verdict with any bugs found.",
    },
  ]

  return all.slice(0, count).map((s, i) => ({ ...s, id: uid("scn", i) }))
}
