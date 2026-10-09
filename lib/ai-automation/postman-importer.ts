import type {
  ParsedPostmanEndpoint,
  PostmanFieldMapping,
  PostmanEndpointMapping,
  PostmanCollectionSummary,
  ActionableElement,
  NetworkCallEvidence,
} from "./types"
import { SYNTHETIC_TEST_DATA } from "./full-app-utils"

/**
 * Normalizes string for fuzzy key comparison (e.g. "user_email" -> "email", "First Name" -> "firstname")
 */
export function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/^user[_-]?/i, "")
    .replace(/^customer[_-]?/i, "")
    .replace(/^account[_-]?/i, "")
    .replace(/[^a-z0-9]/g, "")
}

/**
 * Resolves Postman {{variables}} against collection-level variables
 */
export function resolveVariable(val: any, varMap: Map<string, string>): any {
  if (typeof val !== "string") return val
  return val.replace(/\{\{([^}]+)\}\}/g, (_, varName) => {
    const trimmed = varName.trim()
    if (varMap.has(trimmed)) return varMap.get(trimmed)!
    if (/email/i.test(trimmed)) return SYNTHETIC_TEST_DATA.email
    if (/password/i.test(trimmed)) return SYNTHETIC_TEST_DATA.password
    if (/phone|mobile/i.test(trimmed)) return SYNTHETIC_TEST_DATA.phone
    if (/name/i.test(trimmed)) return SYNTHETIC_TEST_DATA.fullName
    return `sample-${trimmed}`
  })
}

/**
 * Recursively parses Postman Collection v2.0 / v2.1 JSON
 */
export function parsePostmanCollection(input: string | Record<string, any>): PostmanCollectionSummary {
  let json: any
  if (typeof input === "string") {
    try {
      json = JSON.parse(input)
    } catch (e: any) {
      throw new Error(`Invalid Postman Collection JSON: ${e.message}`)
    }
  } else {
    json = input
  }

  const collName = json.info?.name || "Imported Postman Collection"
  const collDesc = json.info?.description || undefined

  // Build collection variables map
  const varMap = new Map<string, string>()
  if (Array.isArray(json.variable)) {
    for (const v of json.variable) {
      if (v?.key && v?.value !== undefined) {
        varMap.set(v.key, String(v.value))
      }
    }
  }

  const endpoints: ParsedPostmanEndpoint[] = []

  function traverseItems(items: any[]) {
    if (!Array.isArray(items)) return

    for (const item of items) {
      if (!item) continue

      // Folder with sub-items
      if (Array.isArray(item.item)) {
        traverseItems(item.item)
        continue
      }

      // Request item
      const req = item.request
      if (!req) continue

      const name = item.name || "Unnamed Request"
      const method = (req.method || "GET").toUpperCase()

      // Parse URL
      let urlStr = ""
      let pathSegments: string[] = []
      if (typeof req.url === "string") {
        urlStr = resolveVariable(req.url, varMap)
        try {
          const parsedUrl = new URL(urlStr.startsWith("http") ? urlStr : `http://example.com${urlStr}`)
          pathSegments = parsedUrl.pathname.split("/").filter(Boolean)
        } catch {
          pathSegments = urlStr.split("/").filter(Boolean)
        }
      } else if (req.url && typeof req.url === "object") {
        urlStr = resolveVariable(req.url.raw || "", varMap)
        if (Array.isArray(req.url.path)) {
          pathSegments = req.url.path.map((p: any) => resolveVariable(String(p), varMap))
        }
      }

      // Parse Headers
      const headers: Record<string, string> = {}
      if (Array.isArray(req.header)) {
        for (const h of req.header) {
          if (h?.key && !h.disabled) {
            headers[h.key] = resolveVariable(h.value || "", varMap)
          }
        }
      }

      // Parse Payload Fields
      const payloadFields: Record<string, any> = {}
      let rawBody: string | undefined = undefined

      if (req.body) {
        const mode = req.body.mode
        if (mode === "raw" && req.body.raw) {
          rawBody = resolveVariable(req.body.raw, varMap)
          if (rawBody) {
            try {
              const parsed = JSON.parse(rawBody)
              if (parsed && typeof parsed === "object") {
                for (const [k, v] of Object.entries(parsed)) {
                  payloadFields[k] = resolveVariable(v, varMap)
                }
              }
            } catch {
              // Non-JSON raw body
            }
          }
        } else if (mode === "urlencoded" && Array.isArray(req.body.urlencoded)) {
          for (const param of req.body.urlencoded) {
            if (param?.key && !param.disabled) {
              payloadFields[param.key] = resolveVariable(param.value ?? "", varMap)
            }
          }
        } else if (mode === "formdata" && Array.isArray(req.body.formdata)) {
          for (const param of req.body.formdata) {
            if (param?.key && !param.disabled) {
              payloadFields[param.key] = resolveVariable(param.value ?? "", varMap)
            }
          }
        }
      }

      endpoints.push({
        name,
        method,
        url: urlStr,
        pathSegments,
        headers,
        payloadFields,
        rawBody,
        description: item.description || req.description || undefined,
      })
    }
  }

  if (Array.isArray(json.item)) {
    traverseItems(json.item)
  }

  return {
    name: collName,
    description: collDesc,
    endpoints,
  }
}

/**
 * Scores matching confidence between a single UI element and an API field
 */
export function scoreFieldMatch(
  uiEl: ActionableElement,
  apiFieldName: string,
  apiValue: any
): { score: number; method: PostmanFieldMapping["matchMethod"] } {
  const uiName = uiEl.name || ""
  const uiPlaceholder = uiEl.placeholder || ""
  const uiType = uiEl.inputType || uiEl.type

  // 1. Exact match
  if (
    uiName.toLowerCase() === apiFieldName.toLowerCase() ||
    (uiEl.selector && uiEl.selector.toLowerCase().includes(apiFieldName.toLowerCase()))
  ) {
    return { score: 1.0, method: "exact_key" }
  }

  const normApi = normalizeKey(apiFieldName)
  const normUiName = normalizeKey(uiName)
  const normUiPh = normalizeKey(uiPlaceholder)

  // 2. Normalized / fuzzy label match
  if (normApi === normUiName || normApi === normUiPh) {
    return { score: 0.9, method: "fuzzy_label" }
  }

  if (normUiName.includes(normApi) || normApi.includes(normUiName)) {
    return { score: 0.82, method: "fuzzy_label" }
  }

  // 3. Semantic type match
  if (uiType === "email" && (/email/i.test(apiFieldName) || (typeof apiValue === "string" && apiValue.includes("@")))) {
    return { score: 0.85, method: "semantic_type" }
  }

  if ((uiType === "password" || /pass/i.test(uiName)) && /pass/i.test(apiFieldName)) {
    return { score: 0.85, method: "semantic_type" }
  }

  if ((uiType === "tel" || /phone|mobile/i.test(uiName)) && /phone|mobile|tel/i.test(apiFieldName)) {
    return { score: 0.8, method: "semantic_type" }
  }

  // 4. Fallback: weak match or no match
  return { score: 0.2, method: "fallback" }
}

/**
 * Maps a Postman API endpoint to a form with multi-signal confidence scoring
 */
export function matchEndpointToForm(
  endpoint: ParsedPostmanEndpoint,
  form: { id: string; name?: string; selector?: string; fields: string[] },
  formElements: ActionableElement[],
  screenPath: string
): PostmanEndpointMapping | null {
  const apiFields = Object.keys(endpoint.payloadFields)
  if (apiFields.length === 0) return null

  // Path heuristic: does endpoint path segment match screen or form?
  let pathAffinity = 0
  const normalizedPath = screenPath.toLowerCase()
  for (const seg of endpoint.pathSegments) {
    const s = seg.toLowerCase()
    if (s.length > 2 && (normalizedPath.includes(s) || (form.name && form.name.toLowerCase().includes(s)))) {
      pathAffinity += 0.15
    }
  }

  const relevantElements = formElements.filter(
    (el) =>
      (!form.id || !el.formId || el.formId === form.id) &&
      (el.type === "input" || el.type === "select" || el.type === "file_upload")
  )
  if (relevantElements.length === 0) return null

  const fieldMappings: PostmanFieldMapping[] = []
  let totalScore = 0
  let matchedCount = 0

  for (const el of relevantElements) {
    let bestMatch: { apiKey: string; score: number; method: PostmanFieldMapping["matchMethod"] } | null = null

    for (const [apiKey, apiVal] of Object.entries(endpoint.payloadFields)) {
      const { score, method } = scoreFieldMatch(el, apiKey, apiVal)
      const adjustedScore = Math.min(1.0, score + pathAffinity)

      if (!bestMatch || adjustedScore > bestMatch.score) {
        bestMatch = { apiKey, score: adjustedScore, method }
      }
    }

    if (bestMatch && bestMatch.score >= 0.5) {
      const level: PostmanFieldMapping["confidenceLevel"] =
        bestMatch.score >= 0.85 ? "high" : bestMatch.score >= 0.6 ? "medium" : "low"

      fieldMappings.push({
        uiFieldName: el.name,
        uiSelector: el.selector,
        uiInputType: el.inputType,
        apiFieldName: bestMatch.apiKey,
        apiValue: endpoint.payloadFields[bestMatch.apiKey],
        confidenceScore: Math.round(bestMatch.score * 100) / 100,
        confidenceLevel: level,
        matchMethod: bestMatch.method,
      })
      totalScore += bestMatch.score
      matchedCount++
    } else {
      fieldMappings.push({
        uiFieldName: el.name,
        uiSelector: el.selector,
        uiInputType: el.inputType,
        apiFieldName: "",
        apiValue: undefined,
        confidenceScore: 0,
        confidenceLevel: "unmatched",
        matchMethod: "fallback",
      })
    }
  }

  if (matchedCount === 0) return null

  const avgScore = totalScore / relevantElements.length
  const overallConfidence = avgScore >= 0.75 ? "high" : avgScore >= 0.5 ? "medium" : "low"

  return {
    endpoint,
    screenId: "",
    formId: form.id,
    fieldMappings,
    overallConfidence,
  }
}

/**
 * Builds synthetic form payload combining high/medium Postman data with synthetic fallbacks
 */
export function buildFormPayloadFromPostman(
  mapping: PostmanEndpointMapping,
  formElements: ActionableElement[]
): Record<string, string> {
  const payload: Record<string, string> = {}

  for (const el of formElements) {
    const fieldMapping = mapping.fieldMappings.find(
      (m) => m.uiFieldName === el.name || (el.selector && m.uiSelector === el.selector)
    )

    if (fieldMapping && (fieldMapping.confidenceLevel === "high" || fieldMapping.confidenceLevel === "medium")) {
      const val = fieldMapping.apiValue
      if (val !== undefined && val !== null) {
        const strVal = String(val)
        payload[el.name] = strVal
        if (fieldMapping.apiFieldName) {
          payload[fieldMapping.apiFieldName] = strVal
        }
        continue
      }
    }

    // Fallback to faker/synthetic data
    let fallback = SYNTHETIC_TEST_DATA.fullName
    if (el.inputType === "email" || /email/i.test(el.name)) {
      fallback = SYNTHETIC_TEST_DATA.email
    } else if (el.inputType === "password" || /pass/i.test(el.name)) {
      fallback = SYNTHETIC_TEST_DATA.password
    } else if (el.inputType === "tel" || /phone|mobile/i.test(el.name)) {
      fallback = SYNTHETIC_TEST_DATA.phone
    }
    payload[el.name] = fallback
  }

  return payload
}

/**
 * Verifies on-wire confirmation: checks if intercepted HTTP request matches Postman endpoint
 */
export function confirmMappingOnWire(
  mapping: PostmanEndpointMapping,
  capturedCalls: NetworkCallEvidence[]
): {
  confirmed: boolean
  matchedCall?: NetworkCallEvidence
  mismatches: string[]
} {
  const ep = mapping.endpoint
  const mismatches: string[] = []

  // Find mutating call with matching method
  const candidate = capturedCalls.find((call) => {
    if (!call.isMutating) return false
    if (call.method.toUpperCase() !== ep.method.toUpperCase()) return false

    // Check path segment match
    const callUrl = call.url.toLowerCase()
    return ep.pathSegments.some((seg) => seg.length > 2 && callUrl.includes(seg.toLowerCase()))
  })

  if (!candidate) {
    return {
      confirmed: false,
      mismatches: [`No outgoing ${ep.method} request matching path [${ep.pathSegments.join("/")}] observed on wire.`],
    }
  }

  return {
    confirmed: true,
    matchedCall: candidate,
    mismatches,
  }
}
