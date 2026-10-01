/**
 * Thin client for Laya (https://github.com/NandhaKishorM/laya)
 * Fast local typed decisions (~30ms). Falls back gracefully when Laya is offline.
 */

import type { PageType } from "./types"

const DEFAULT_LAYA_URL = process.env.LAYA_BASE_URL || "http://127.0.0.1:8000"

export interface LayaPredictPayload {
  state: string
  questions: Record<
    string,
    | { type: "noul"; instructions: string }
    | { type: "choice"; instructions: string; criteria: Record<string, string> }
    | { type: "score"; instructions: string; criteria: string[] }
  >
}

async function predict(
  baseUrl: string,
  payload: LayaPredictPayload
): Promise<Record<string, any> | null> {
  const cleanBase = baseUrl.replace(/\/$/, "")
  const endpoints = [`${cleanBase}/v1/systemone`, `${cleanBase}/predict`]

  for (const url of endpoints) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) {
        return await res.json()
      }
    } catch {
      // try fallback endpoint
    }
  }
  return null
}

export async function isLayaAvailable(baseUrl = DEFAULT_LAYA_URL): Promise<boolean> {
  const cleanBase = baseUrl.replace(/\/$/, "")
  const healthEndpoints = [`${cleanBase}/health`, `${cleanBase}/`]
  for (const url of healthEndpoints) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1500)
      const res = await fetch(url, {
        signal: controller.signal,
      }).catch(() => null)
      clearTimeout(timer)
      if (res?.ok) return true
    } catch {}
  }
  return false
}

export async function classifyPage(
  pageText: string,
  url: string,
  baseUrl = DEFAULT_LAYA_URL
): Promise<{ pageType: PageType; hasBlockingIssue: boolean; ready: boolean }> {
  const state = `URL: ${url}\n\nPage content (truncated):\n${pageText.slice(0, 2500)}`

  const result = await predict(baseUrl, {
    state,
    questions: {
      ready: {
        type: "noul",
        instructions: "Is this page fully loaded and interactive (not a spinner or blank)?",
      },
      page_type: {
        type: "choice",
        instructions: "What kind of page is this?",
        criteria: {
          login: "login, sign-in or authentication form",
          dashboard: "main overview, home or dashboard",
          form: "data entry or multi-field form",
          list: "table, list or collection of items",
          detail: "single item detail or profile view",
          error: "error message, 404 or failure state",
          empty: "empty state with no data",
          success: "success, confirmation or thank-you",
          settings: "settings, preferences or account page",
          other: "anything else",
        },
      },
      blocking: {
        type: "noul",
        instructions:
          "Is there a clear blocking UI or UX problem (broken layout, unreadable text, missing primary action)?",
      },
    },
  })

  if (!result?.answers) {
    return { pageType: "other", hasBlockingIssue: false, ready: true }
  }

  const answers = result.answers
  const pageTypeRaw = answers.page_type?.choice || answers.page_type?.label || answers.page_type || "other"
  const pageType = (typeof pageTypeRaw === "string" ? pageTypeRaw : String(pageTypeRaw)) as PageType
  const readyProb = answers.ready?.noul ?? answers.ready?.probability ?? answers.ready ?? 0.8
  const blockingProb = answers.blocking?.noul ?? answers.blocking?.probability ?? answers.blocking ?? 0

  return {
    pageType: [
      "login",
      "dashboard",
      "form",
      "list",
      "detail",
      "error",
      "empty",
      "success",
      "settings",
      "other",
    ].includes(pageType)
      ? pageType
      : "other",
    hasBlockingIssue: Number(blockingProb) > 0.55,
    ready: Number(readyProb) > 0.4,
  }
}

export async function pickNextLink(
  candidates: { label: string; href: string }[],
  role: string,
  baseUrl = DEFAULT_LAYA_URL
): Promise<string | null> {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0].href

  const criteria: Record<string, string> = {}
  candidates.slice(0, 12).forEach((c, i) => {
    criteria[`opt_${i}`] = `${c.label || "link"} → ${c.href}`
  })

  const result = await predict(baseUrl, {
    state: `We are capturing a ${role} user journey. Choose the best next navigation target to continue a typical ${role} flow.`,
    questions: {
      next: {
        type: "choice",
        instructions: `Which link should we follow next for a realistic ${role} workflow? Prefer primary navigation over logout/external.`,
        criteria,
      },
    },
  })

  if (!result?.answers?.next) return candidates[0].href

  const nextAns = result.answers.next
  const label = nextAns?.choice || nextAns?.label || nextAns || ""
  const match = String(label).match(/opt_(\d+)/)
  if (match) {
    const idx = parseInt(match[1], 10)
    if (candidates[idx]) return candidates[idx].href
  }
  return candidates[0].href
}

export { DEFAULT_LAYA_URL }

/** Shared low-level call: POST { state, questions } to a Laya server, with endpoint fallback. */
export async function layaPredict(
  baseUrl: string,
  payload: LayaPredictPayload,
): Promise<Record<string, any> | null> {
  return predict(baseUrl, payload)
}
