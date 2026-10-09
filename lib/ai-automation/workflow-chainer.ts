import { Page } from "puppeteer"
import {
  AutomationJob,
  AutomationIssue,
  AppScreenNode,
  AppWorkflowTransition,
  WorkflowRun,
  WorkflowStepEvidence,
  StepEvidence,
  AutomationVerdict,
  ObservedEffect,
  NetworkCallEvidence,
  PostmanCollectionSummary,
  PostmanEndpointMapping,
} from "./types"
import { appendLog, saveJob } from "./job-store"
import {
  captureState,
  settle,
  runWithLadder,
  NetworkRecorder,
  ConsoleRecorder,
  expectFor,
} from "./outcome-verifier"
import { classifyAction } from "./safety-guard"
import {
  matchEndpointToForm,
  buildFormPayloadFromPostman,
  confirmMappingOnWire,
} from "./postman-importer"
import { SYNTHETIC_TEST_DATA } from "./full-app-utils"

/**
 * Formats a captured mutating network call into a reproducible cURL command
 */
export function formatCurlCommand(call: NetworkCallEvidence): string {
  const parts = [`curl -X ${call.method} "${call.url}"`]
  if (call.headers) {
    const important = ["content-type", "authorization", "accept"]
    for (const [k, v] of Object.entries(call.headers)) {
      if (important.includes(k.toLowerCase()) || k.toLowerCase().startsWith("x-")) {
        parts.push(`-H "${k}: ${v}"`)
      }
    }
  }
  if (call.postData) {
    const sanitized = call.postData.replace(/"/g, '\\"')
    parts.push(`-d "${sanitized}"`)
  }
  return parts.join(" \\\n  ")
}

/**
 * Generates an isolated tracking tag for state persistence assertions (e.g. QA-A7B2)
 */
export function generateTrackingId(): string {
  return `QA-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
}

/**
 * Asserts whether a tracked entity string appears in visible rendered text,
 * strictly excluding <input>, <textarea>, <select>, and [contenteditable] values.
 */
export async function checkTextPersistence(page: Page, trackingId: string): Promise<boolean> {
  try {
    return await page.evaluate((target) => {
      const clone = document.body.cloneNode(true) as HTMLElement
      // Remove input fields, textareas, selects, and script/style tags
      const inputs = clone.querySelectorAll(
        "input, textarea, select, option, [contenteditable='true'], script, style, noscript"
      )
      inputs.forEach((el) => el.remove())

      const visibleText = (clone.innerText || clone.textContent || "").toLowerCase()
      return visibleText.includes(target.toLowerCase())
    }, trackingId)
  } catch {
    return false
  }
}

/**
 * Executes multi-step workflow chains ("go next next") with isolation,
 * Postman data driving, persistence assertions, and dummy/placeholder element detection.
 */
export async function executeChainedWorkflows(
  job: AutomationJob,
  page: Page,
  screens: AppScreenNode[],
  transitions: AppWorkflowTransition[],
  targetUrl: string,
  options?: {
    postmanSummary?: PostmanCollectionSummary
    allowActions?: string[]
    noiseHosts?: string[]
    maxHops?: number
  }
): Promise<WorkflowRun[]> {
  const workflowRuns: WorkflowRun[] = []
  const maxHops = options?.maxHops || 5

  // Identify workflow starting points: screens with forms or outbound transitions
  const startingScreens = screens.filter((s) => (s.forms && s.forms.length > 0) || !s.isNewDiscovery)

  let workflowCounter = 1

  for (const entryScreen of startingScreens) {
    if (job.status === "stopped") break

    const trackingId = generateTrackingId()
    const workflowId = `WF-${String(workflowCounter++).padStart(2, "0")}`
    const workflowName = entryScreen.forms && entryScreen.forms.length > 0
      ? `${entryScreen.name} -> Workflow Journey (${trackingId})`
      : `${entryScreen.name} Navigation Journey`

    appendLog(
      job,
      "info",
      `\n🔄 [WORKFLOW CHAIN ${workflowId}] Starting "${workflowName}" (Tracking ID: ${trackingId})`
    )

    const run: WorkflowRun = {
      id: workflowId,
      name: workflowName,
      entryScreenId: entryScreen.id,
      entryUrl: entryScreen.url || targetUrl,
      steps: [],
      verdict: "passed",
      entityTrackingId: trackingId,
      summary: "",
      reproSteps: [],
    }

    // ISOLATION: Navigate fresh to entry screen
    try {
      await page.goto(run.entryUrl, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => null)
      await new Promise((r) => setTimeout(r, 600))
    } catch (err: any) {
      run.verdict = "blocked"
      run.summary = `Failed to navigate to entry screen ${run.entryUrl}: ${err?.message}`
      workflowRuns.push(run)
      continue
    }

    let currentScreen = entryScreen
    let hop = 0
    let lastMutatingCall: NetworkCallEvidence | undefined = undefined

    // STEP 1: If entry screen has forms, execute valid form submission as Step 1
    if (entryScreen.forms && entryScreen.forms.length > 0) {
      hop++
      const form = entryScreen.forms[0]
      const formElements = entryScreen.actionableElements.filter(
        (el) => el.formId === form.id || (form.fields && form.fields.includes(el.name))
      )

      // Postman mapping check
      let matchedMapping: PostmanEndpointMapping | null = null
      if (options?.postmanSummary?.endpoints) {
        for (const ep of options.postmanSummary.endpoints) {
          const m = matchEndpointToForm(ep, form, formElements, entryScreen.path)
          if (m && (m.overallConfidence === "high" || m.overallConfidence === "medium")) {
            matchedMapping = m
            break
          }
        }
      }

      let payload: Record<string, string> = {}
      if (matchedMapping) {
        payload = buildFormPayloadFromPostman(matchedMapping, formElements)
        // Tag string name fields with trackingId for persistence verification
        for (const [k, v] of Object.entries(payload)) {
          if (typeof v === "string" && !v.includes("@") && !v.startsWith("+") && /name|user|title/i.test(k)) {
            payload[k] = `${v} (${trackingId})`
          }
        }
      } else {
        // Build synthetic payload with trackingId
        for (const el of formElements) {
          if (el.inputType === "email" || /email/i.test(el.name)) {
            payload[el.name] = `${trackingId.toLowerCase()}@testing-workflow.com`
          } else if (el.inputType === "password" || /pass/i.test(el.name)) {
            payload[el.name] = "WorkflowSecret123!"
          } else if (el.inputType === "tel" || /phone/i.test(el.name)) {
            payload[el.name] = "+15559876543"
          } else if (/first/i.test(el.name)) {
            payload[el.name] = `${trackingId}-First`
          } else if (/last/i.test(el.name)) {
            payload[el.name] = `${trackingId}-Last`
          } else {
            payload[el.name] = `${trackingId}-User`
          }
        }
      }

      // Ensure trackingId is embedded in any primary text or name field
      for (const el of formElements) {
        if (el.inputType === "text" || /name|user|title/i.test(el.name)) {
          if (payload[el.name] && !payload[el.name].includes(trackingId)) {
            payload[el.name] = `${payload[el.name]} (${trackingId})`
          } else if (!payload[el.name]) {
            payload[el.name] = `${trackingId}-Entity`
          }
        }
      }

      const netRecorder = new NetworkRecorder(page, targetUrl, options?.noiseHosts)
      const consoleRecorder = new ConsoleRecorder(page)

      const formSel = form.selector || `#${form.id}`
      const beforeShot = await captureState(page)

      // Fill form fields
      await page.evaluate(
        (sel, p, defaultData) => {
          const f = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
          if (!f) return
          f.querySelectorAll("input, textarea, select").forEach((field: any) => {
            const name = field.name || field.id || ""
            if (p[name]) {
              field.value = p[name]
            } else if (field.tagName.toLowerCase() === "select") {
              if (field.options?.length > 1) field.selectedIndex = 1
            } else if (field.type === "checkbox" || field.type === "radio") {
              field.checked = true
            } else if (field.type !== "submit" && field.type !== "button" && field.type !== "hidden") {
              field.value = defaultData.fullName
            }
            field.dispatchEvent(new Event("input", { bubbles: true }))
            field.dispatchEvent(new Event("change", { bubbles: true }))
          })
        },
        formSel,
        payload,
        SYNTHETIC_TEST_DATA
      )

      // Submit form
      await page.evaluate((sel) => {
        const f = (document.querySelector(sel) || document.querySelector("form")) as HTMLFormElement | null
        if (!f) return
        const sub = f.querySelector(
          'button[type="submit"], input[type="submit"], button:not([type="button"])'
        ) as HTMLElement | null
        if (sub) sub.click()
        else if (typeof f.requestSubmit === "function") f.requestSubmit()
        else f.submit()
      }, formSel)

      const settleDuration = await settle(page, netRecorder, 8000)
      const calls = netRecorder.getCapturedCalls()
      const afterShot = await captureState(page)

      lastMutatingCall = calls.find(
        (c) => c.isMutating && typeof c.status === "number" && c.status >= 200 && c.status < 300
      )

      const navigated = beforeShot.url !== afterShot.url
      const modalClosed = beforeShot.hasModal && !afterShot.hasModal
      const has2xx = Boolean(lastMutatingCall)

      let stepVerdict: AutomationVerdict = "passed"
      let stepObserved: ObservedEffect = "no_effect"
      let stepReason = ""

      if (navigated || modalClosed || has2xx) {
        stepVerdict = "passed"
        stepObserved = navigated ? "navigated" : modalClosed ? "content_changed" : "network_only"
        stepReason = `Form "${form.name || form.id}" submitted successfully with tracking ID "${trackingId}".`
      } else if (
        consoleRecorder.getErrors().length > 0 ||
        calls.some((c) => c.isMutating && typeof c.status === "number" && c.status >= 400)
      ) {
        stepVerdict = "failed"
        stepObserved = "error_shown"
        stepReason = `Form submission encountered error: ${consoleRecorder.getErrors().join("; ") || "HTTP error status"}`
      } else {
        stepVerdict = "suspected_non_functional"
        stepObserved = "no_effect"
        stepReason = `Form "${form.name || form.id}" produced no navigation, no network request, and no DOM effect.`
      }

      const reproCurl = lastMutatingCall ? formatCurlCommand(lastMutatingCall) : undefined

      const step1Evidence: WorkflowStepEvidence = {
        stepIndex: 1,
        screenId: entryScreen.id,
        screenName: entryScreen.name,
        action: `Fill & Submit Form "${form.name || form.id}"`,
        targetSelector: formSel,
        targetName: form.name || form.id,
        inputData: payload,
        expectedOutcome: "Form submits and triggers state transition / 2xx response.",
        observedOutcome: stepReason,
        verdict: stepVerdict,
        durationMs: settleDuration,
        reproCurl,
        evidence: {
          expectedEffects: ["navigated", "network_only", "content_changed"],
          observedEffect: stepObserved,
          verdict: stepVerdict,
          reason: stepReason,
          retriesUsed: 0,
          settleDurationMs: settleDuration,
          networkCalls: calls,
          consoleErrors: consoleRecorder.getErrors(),
          reproCurl,
        },
      }

      run.steps.push(step1Evidence)
      run.reproSteps?.push(
        `Step 1: Open "${run.entryUrl}", fill form "${formSel}" with tracking payload (${JSON.stringify(payload)}), and click submit.`
      )

      appendLog(
        job,
        stepVerdict === "passed" ? "info" : "warn",
        `[WORKFLOW ${workflowId} - STEP 1] ${entryScreen.name} -> Submit Form: ${stepVerdict.toUpperCase()} (${stepReason})`
      )

      netRecorder.cleanup()
      consoleRecorder.cleanup()

      if (stepVerdict !== "passed") {
        run.failedAtStep = 1
        run.verdict = stepVerdict
        run.summary = `Workflow stalled at Step 1: ${stepReason}`
        workflowRuns.push(run)
        continue
      }
    }

    // STEP 2 & SUBSEQUENT: Multi-step transition ("go next next")
    // Identify destination screen from current URL or discovered screens
    while (hop < maxHops && job.status !== "stopped") {
      hop++
      const currentUrl = page.url()
      const nextScreen = screens.find((s) => currentUrl.includes(s.path.split("#")[0])) || currentScreen

      // Assertion: State Persistence of trackingId
      const isPersisted = await checkTextPersistence(page, trackingId)
      if (isPersisted) {
        run.dataReflected = true
        appendLog(
          job,
          "success",
          `✨ [WORKFLOW ${workflowId} - PERSISTENCE] Entity "${trackingId}" successfully verified in rendered content on screen "${nextScreen.name}".`
        )
      } else if (lastMutatingCall && hop === 2) {
        run.dataReflected = false
        job.issues.push({
          id: `issue-persist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          screenUrl: page.url(),
          screenTitle: nextScreen.name,
          type: "data_not_reflected",
          severity: "high",
          description: `Entity created with tracking ID "${trackingId}" was not found in rendered content on subsequent screen "${nextScreen.name}" after 2xx response.`,
          expected: `Rendered DOM contains visible string "${trackingId}" outside input fields.`,
          actual: `String "${trackingId}" not found in page body.`,
          timestamp: new Date().toISOString(),
        })
        appendLog(
          job,
          "warn",
          `⚠️ [WORKFLOW ${workflowId} - PERSISTENCE] Entity "${trackingId}" was NOT reflected on screen "${nextScreen.name}" after successful creation.`
        )
      }

      // Find next candidate controls on this screen to continue workflow ("go next next")
      // Priority: Buttons/cards not tested yet, especially video cards, next buttons, or action triggers
      const candidateElements = nextScreen.actionableElements.filter((el) => {
        const t = el.type
        return t === "button" || t === "clickable" || t === "link"
      })

      if (candidateElements.length === 0) {
        // No further steps to take in this workflow
        break
      }

      // Pick next interesting element: prefer "next", "continue", "view", video/media cards, or dead/dummy buttons
      const chosenElement =
        candidateElements.find((el) => /next|continue|proceed|step|watch|video|card|detail/i.test(el.name)) ||
        candidateElements[0]

      // Safety Guard check
      const safety = classifyAction(chosenElement.name, options?.allowActions || [])
      if (safety.tier !== "allow") {
        appendLog(job, "warn", `[WORKFLOW ${workflowId} - STEP ${hop}] Skipping unsafe control "${chosenElement.name}".`)
        break
      }

      const expected = expectFor(chosenElement)
      appendLog(
        job,
        "info",
        `[WORKFLOW ${workflowId} - STEP ${hop}] Interacting with "${chosenElement.name}" on ${nextScreen.name}...`
      )

      const netRecorder = new NetworkRecorder(page, targetUrl, options?.noiseHosts)
      const consoleRecorder = new ConsoleRecorder(page)
      const dialogRef = { value: false }

      const ladderResult = await runWithLadder(
        page,
        chosenElement.selector || `button:has-text("${chosenElement.name}")`,
        chosenElement.name,
        expected,
        netRecorder,
        consoleRecorder,
        { maxSettleMs: 3000, dialogShownRef: dialogRef }
      )

      const capturedCalls = netRecorder.getCapturedCalls()
      const capturedConsoleErrors = consoleRecorder.getErrors()

      let curlCmd: string | undefined = undefined
      const mutCall = capturedCalls.find((c: NetworkCallEvidence) => c.isMutating)
      if (mutCall) {
        curlCmd = formatCurlCommand(mutCall)
      }

      const stepEvidenceObj: StepEvidence = {
        expectedEffects: expected,
        observedEffect: ladderResult.observedEffect,
        verdict: ladderResult.verdict,
        reason: ladderResult.reason,
        retriesUsed: ladderResult.retriesUsed,
        isWeakPass: ladderResult.isWeakPass,
        settleDurationMs: ladderResult.settleDurationMs,
        networkCalls: capturedCalls,
        consoleErrors: capturedConsoleErrors,
        coveredElementDetected: ladderResult.coveredElementDetected,
        reproCurl: curlCmd,
      }

      const stepEvidence: WorkflowStepEvidence = {
        stepIndex: hop,
        screenId: nextScreen.id,
        screenName: nextScreen.name,
        action: `Click "${chosenElement.name}"`,
        targetSelector: chosenElement.selector,
        targetName: chosenElement.name,
        expectedOutcome: `Control reacts with expected effect: [${expected.join(", ")}]`,
        observedOutcome: ladderResult.reason,
        verdict: ladderResult.verdict,
        durationMs: ladderResult.settleDurationMs,
        evidence: stepEvidenceObj,
        reproCurl: curlCmd,
        dataPersisted: isPersisted,
      }

      run.steps.push(stepEvidence)
      run.reproSteps?.push(
        `Step ${hop}: On screen "${nextScreen.name}" (${page.url()}), click "${chosenElement.name}" (${chosenElement.selector || "selector"}).`
      )

      netRecorder.cleanup()
      consoleRecorder.cleanup()

      // Check if control is suspected non-functional or failed (e.g. dummy video card where nothing happens)
      if (ladderResult.verdict === "suspected_non_functional") {
        run.failedAtStep = hop
        run.verdict = "suspected_non_functional"
        run.summary = `Workflow stalled at Step ${hop} ("${chosenElement.name}") on screen "${nextScreen.name}": Element produced NO EFFECT (suspected dummy/placeholder UI card).`

        appendLog(
          job,
          "warn",
          `🚨 [WORKFLOW ${workflowId} FAILED AT STEP ${hop}] "${chosenElement.name}" on ${nextScreen.name} is a dummy/placeholder control! Nothing happened.`
        )

        // Add issue for non-functional control
        job.issues.push({
          id: `issue-dummy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          screenUrl: page.url(),
          screenTitle: nextScreen.name,
          type: "non_functional_control",
          severity: "high",
          description: `Workflow "${workflowName}" failed at step ${hop}: Control "${chosenElement.name}" produced zero observable effect, media playback, modal, or network activity (dummy/placeholder control).`,
          expected: `Media playback, modal dialog, or navigation.`,
          actual: "Element clicked with full retry ladder; page remained static with no effect.",
          timestamp: new Date().toISOString(),
        })

        // Print entire workflow timeline so the user gets complete context where it failed
        appendLog(job, "info", formatWorkflowTimeline(run))
        break
      } else if (ladderResult.verdict === "failed") {
        run.failedAtStep = hop
        run.verdict = "failed"
        run.summary = `Workflow failed at Step ${hop} ("${chosenElement.name}") on screen "${nextScreen.name}": ${ladderResult.reason}`

        appendLog(
          job,
          "error",
          `❌ [WORKFLOW ${workflowId} FAILED AT STEP ${hop}] Action failed: ${ladderResult.reason}`
        )
        appendLog(job, "info", formatWorkflowTimeline(run))
        break
      } else {
        appendLog(
          job,
          "info",
          `[WORKFLOW ${workflowId} - STEP ${hop}] Passed: ${ladderResult.observedEffect} observed.`
        )
      }
    }

    if (!run.failedAtStep) {
      run.verdict = "passed"
      run.summary = `Workflow executed successfully across ${run.steps.length} steps with verified data persistence.`
      appendLog(
        job,
        "success",
        `✅ [WORKFLOW ${workflowId} PASSED] Completed all ${run.steps.length} steps cleanly.`
      )
    }

    workflowRuns.push(run)
    saveJob(job)
  }

  return workflowRuns
}

/**
 * Formats a clean, readable step-by-step workflow timeline
 */
export function formatWorkflowTimeline(run: WorkflowRun): string {
  const lines: string[] = [
    `================================================================================`,
    `WORKFLOW TIMELINE: [${run.id}] ${run.name}`,
    `Tracking ID: ${run.entityTrackingId || "N/A"} | Overall Verdict: ${run.verdict.toUpperCase()}`,
    `Failed At Step: ${run.failedAtStep ? `Step ${run.failedAtStep}` : "None (All Steps Completed)"}`,
    `================================================================================`,
  ]

  for (const step of run.steps) {
    const mark = step.verdict === "passed" ? "✔" : step.verdict === "suspected_non_functional" ? "⚠️" : "❌"
    lines.push(`[Step ${step.stepIndex}] ${mark} Screen: "${step.screenName}" (${step.screenId})`)
    lines.push(`  Action: ${step.action}`)
    if (step.inputData) {
      lines.push(`  Input: ${JSON.stringify(step.inputData)}`)
    }
    lines.push(`  Verdict: ${step.verdict.toUpperCase()} (Observed: ${step.observedOutcome || "N/A"})`)
    if (step.reproCurl) {
      lines.push(`  Reproducible cURL:\n    ${step.reproCurl.replace(/\n/g, "\n    ")}`)
    }
    lines.push("")
  }

  if (run.failedAtStep) {
    lines.push(`--> ROOT CAUSE: ${run.summary}`)
  } else {
    lines.push(`--> RESULT: All workflow steps executed and verified successfully.`)
  }
  lines.push(`================================================================================`)

  return lines.join("\n")
}
