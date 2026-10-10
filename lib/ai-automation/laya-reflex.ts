/**
 * Laya System-1 reflex layer for the chat-command loop.
 *
 * Before burning a slow, rate-limited frontier-model call to interpret a user
 * command ("click the login button"), enumerate the page's interactable
 * elements and let a local Laya server pick the matching action in ~30ms.
 *
 * Confidence-gated: anything Laya is unsure about (or when Laya is offline)
 * returns null and the caller escalates to the full AI interpreter unchanged.
 */

import type { Page } from "puppeteer"
import { layaPredict, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
type AICommandInterpretation = {
  planSummary: string
  actions: Array<{ type: "click" | "type"; target: string; value?: string; description: string; thought?: string }>
}

export type ReflexCandidate = {
  id: number
  kind: "click" | "type"
  label: string
  selector: string
}

const LAYA_CONFIDENCE_THRESHOLD = 0.55
const MAX_CANDIDATES = 14

/**
 * Enumerate visible interactable elements and build a precise CSS selector
 * for each (id-based when possible, otherwise an nth-of-type path).
 */
async function snapshotCandidates(page: Page): Promise<ReflexCandidate[]> {
  const raw = await page
    .evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(
          'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="switch"]',
        ),
      ).filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 4 && r.height > 4 && style.visibility !== "hidden" && style.display !== "none"
      })
      return els.slice(0, 40).map((el) => {
        const htmlEl = el as HTMLElement
        const input = el as HTMLInputElement
        const label = (
          htmlEl.getAttribute("aria-label") ||
          htmlEl.innerText ||
          input.value ||
          input.placeholder ||
          input.name ||
          htmlEl.getAttribute("title") ||
          el.tagName
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 60)
        let selector: string
        if (htmlEl.id) {
          selector = "#" + CSS.escape(htmlEl.id)
        } else {
          const parts: string[] = []
          let node: Element | null = el
          while (node && node !== document.body && parts.length < 4) {
            const tag = node.tagName.toLowerCase()
            const parent = node.parentNode as Element | null
            if (!parent) break
            const tagName = node.tagName
            const siblings = Array.from(parent.children).filter((s) => s.tagName === tagName)
            parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`)
            node = parent
          }
          selector = parts.join(" > ")
        }
        const tag = el.tagName.toLowerCase()
        const typeAttr = (input.getAttribute("type") || "").toLowerCase()
        const kind =
          tag === "textarea" ||
          tag === "select" ||
          (tag === "input" &&
            !["button", "submit", "checkbox", "radio", "file", "hidden", "image"].includes(typeAttr))
            ? ("type" as const)
            : ("click" as const)
        return { label: label || tag, selector, kind }
      })
    })
    .catch(() => [])
  return (raw as Array<{ label: string; selector: string; kind: "click" | "type" }>).map((c, i) => ({
    id: i,
    kind: c.kind,
    label: c.label,
    selector: c.selector,
  }))
}

/**
 * Extract an explicit literal to type. Only quoted text is trusted —
 * anything ambiguous escalates to the frontier model (Laya can't generate text).
 */
function extractTypeValue(command: string): string | null {
  const quoted = command.match(/["“”']([^"“”']+)["“”']/)
  if (quoted) return quoted[1].trim() || null
  return null
}

function readConfidence(ans: any): number {
  const v = ans?.confidence ?? ans?.answer_confidence ?? ans?.probability ?? ans?.score ?? 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Try to resolve the command locally with Laya. Returns a ready-to-execute
 * plan, or null when Laya is offline / unsure (caller must escalate).
 */
export async function tryLayaReflexPlan(
  page: Page,
  command: string,
  layaBaseUrl?: string,
): Promise<AICommandInterpretation | null> {
  const baseUrl = (layaBaseUrl || process.env.LAYA_BASE_URL || DEFAULT_LAYA_URL).replace(/\/$/, "")

  const candidates = await snapshotCandidates(page)
  if (candidates.length === 0) return null

  const criteria: Record<string, string> = {}
  candidates.slice(0, MAX_CANDIDATES).forEach((c) => {
    criteria[`act_${c.id}`] = `[${c.kind}] ${c.label}`
  })
  criteria["escalate"] = "No candidate clearly matches the command — escalate to the full AI model"

  let pageText = ""
  try {
    pageText = await page.evaluate(() => document.body.innerText.slice(0, 1200)).catch(() => "")
  } catch {
    /* ignore */
  }

  const started = Date.now()
  const result = await layaPredict(baseUrl, {
    state: `User command: "${command}"\nPage URL: ${page.url()}\nVisible text: ${pageText}`,
    questions: {
      action: {
        type: "choice",
        instructions:
          "Which UI action best fulfills the user's command? Choose escalate unless exactly one candidate is a clear, direct match.",
        criteria,
      },
    },
  })
  const elapsedMs = Date.now() - started

  const ans = result?.answers?.action
  if (!ans) return null
  const choiceRaw = String(ans.choice ?? ans.label ?? "")
  if (!choiceRaw || choiceRaw === "escalate") return null
  const match = choiceRaw.match(/act_(\d+)/)
  if (!match) return null
  const candidate = candidates[Number(match[1])]
  if (!candidate) return null

  const confidence = readConfidence(ans)
  if (confidence < LAYA_CONFIDENCE_THRESHOLD) return null

  const confStr = confidence.toFixed(2)
  if (candidate.kind === "type") {
    const value = extractTypeValue(command)
    if (!value) return null // needs generated text — escalate
    return {
      planSummary: `[Laya reflex ${elapsedMs}ms] Type into "${candidate.label}" (confidence ${confStr}) — no cloud call used.`,
      actions: [
        {
          type: "type",
          target: candidate.selector,
          value,
          description: `Type "${value}" into ${candidate.label}`,
          thought: `Laya System-1 reflex (${elapsedMs}ms): matched "${command}" to input "${candidate.label}".`,
        },
      ],
    }
  }

  return {
    planSummary: `[Laya reflex ${elapsedMs}ms] Click "${candidate.label}" (confidence ${confStr}) — no cloud call used.`,
    actions: [
      {
        type: "click",
        target: candidate.selector,
        description: `Click ${candidate.label}`,
        thought: `Laya System-1 reflex (${elapsedMs}ms): matched "${command}" to "${candidate.label}".`,
      },
    ],
  }
}
