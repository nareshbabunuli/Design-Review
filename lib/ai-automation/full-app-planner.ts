import {
  AutomationJob,
  ActionableElement,
  AppScreenNode,
  AppWorkflowTransition,
  TestPlanStep,
  FullAppTestPlan,
  ActionLedgerEntry,
  PostmanCollectionSummary,
  PostmanEndpointMapping,
} from "./types"
import { appendLog } from "./job-store"
import { SYNTHETIC_TEST_DATA, inferContextualTestValue } from "./full-app-utils"
import {
  parsePostmanCollection,
  matchEndpointToForm,
  buildFormPayloadFromPostman,
} from "./postman-importer"
import { secretRedactor } from "./secure-credentials-manager"

export function rebuildActionLedger(job: AutomationJob, entries: ActionLedgerEntry[]): void {
  const now = new Date().toISOString()
  const deduped = new Map<string, ActionLedgerEntry>()
  for (const entry of entries) {
    const previous = deduped.get(entry.actionKey)
    if (!previous || (entry.lastTestedAt || "") >= (previous.lastTestedAt || "")) {
      deduped.set(entry.actionKey, entry)
    }
  }
  const normalized = Array.from(deduped.values())
  job.actionLedger = {
    entries: normalized,
    untestedQueue: normalized.filter((entry) => entry.status === "untested").map((entry) => entry.actionKey),
    updatedAt: now,
    total: normalized.length,
    untested: normalized.filter((entry) => entry.status === "untested").length,
    tested: normalized.filter((entry) => ["passed", "failed", "skipped"].includes(entry.status)).length,
    failed: normalized.filter((entry) => entry.status === "failed").length,
    blocked: normalized.filter((entry) => entry.status === "blocked").length,
  }
}

export function stableActionKeyForScreen(screen: AppScreenNode, element: ActionableElement): string {
  const rawKey = element.actionKey || [
    "dom",
    element.type,
    element.name.trim().toLowerCase(),
    element.selector || "",
    element.href || "",
    element.formId || "",
  ].join("|")
  const prefix = `screen|${screen.path}|`
  return rawKey.startsWith(prefix) ? rawKey : `${prefix}${rawKey}`
}

export function mergeScreenActionsIntoLedger(job: AutomationJob, screen: AppScreenNode): void {
  const existing = new Map<string, ActionLedgerEntry>(
    (job.actionLedger?.entries || []).map((entry) => [entry.actionKey, entry])
  )
  const now = new Date().toISOString()

  for (const element of screen.actionableElements) {
    const actionKey = stableActionKeyForScreen(screen, element)

    element.actionKey = actionKey
    const previous = existing.get(actionKey)

    existing.set(actionKey, {
      actionKey,
      screenId: screen.id,
      screenUrl: screen.url,
      screenPath: screen.path,
      name: element.name,
      type: element.type,
      selector: element.selector,
      href: element.href,
      interactionConfidence: element.interactionConfidence,
      discoveryReason: element.discoveryReason,
      status: previous?.status || "untested",
      attempts: previous?.attempts || 0,
      discoveredAt: previous?.discoveredAt || now,
      lastTestedAt: previous?.lastTestedAt,
      workflowId: previous?.workflowId,
      error: previous?.error,
      evidence: previous?.evidence,
      history: previous?.history || [],
    })
  }

  rebuildActionLedger(job, Array.from(existing.values()))
}

export function updateActionLedgerForStep(
  job: AutomationJob,
  step: TestPlanStep,
  status: ActionLedgerEntry["status"],
  observedOutcome?: string,
  error?: string,
  evidence?: { beforeScreenshotUrl?: string; afterScreenshotUrl?: string }
): void {
  const ledger = job.actionLedger
  if (!ledger) return

  const entry = step.actionKey
    ? ledger.entries.find((candidate) => candidate.actionKey === step.actionKey)
    : ledger.entries.find((candidate) =>
        candidate.screenId === step.screenId &&
        candidate.name.toLowerCase() === step.targetName.toLowerCase() &&
        (!step.targetSelector || candidate.selector === step.targetSelector)
      )

  if (!entry) return

  const timestamp = new Date().toISOString()
  entry.status = status
  entry.lastTestedAt = timestamp

  // Starting a retry should not erase the previous resolved outcome.
  if (status === "running" || status === "untested") {
    rebuildActionLedger(job, ledger.entries)
    return
  }

  entry.attempts += 1
  const safeError = error ? secretRedactor.redact(error) : undefined
  const safeOutcome = observedOutcome ? secretRedactor.redact(observedOutcome) : undefined
  entry.error = safeError
  entry.evidence = {
    beforeScreenshotUrl: evidence?.beforeScreenshotUrl,
    afterScreenshotUrl: evidence?.afterScreenshotUrl,
    observedOutcome: safeOutcome,
  }
  entry.history = [
    ...(entry.history || []),
    {
      status,
      timestamp,
      observedOutcome: safeOutcome,
      error: safeError,
      beforeScreenshotUrl: evidence?.beforeScreenshotUrl,
      afterScreenshotUrl: evidence?.afterScreenshotUrl,
    },
  ].slice(-20)

  rebuildActionLedger(job, ledger.entries)
}

export function linkTestPlanStepsToLedger(job: AutomationJob, testPlan: FullAppTestPlan): void {
  const ledger = job.actionLedger
  if (!ledger) return

  for (const step of testPlan.steps) {
    if (step.actionKey) continue

    // A form scenario exercises the form's submit control. Link it to that
    // control so the ledger does not create a redundant standalone click step.
    if (step.actionType === "form_scenario" && step.formId) {
      const screen = testPlan.screens.find((candidate) => candidate.id === step.screenId)
      const form = screen?.forms.find((candidate) => candidate.id === step.formId)
      const submitName = form?.submitButton?.trim().toLowerCase()
      const submitEntry = submitName
        ? ledger.entries.find((candidate) =>
            candidate.screenId === step.screenId &&
            candidate.name.trim().toLowerCase() === submitName
          )
        : undefined
      if (submitEntry) {
        step.actionKey = submitEntry.actionKey
        continue
      }
    }

    const entry = ledger.entries.find((candidate) =>
      candidate.screenId === step.screenId &&
      candidate.name.toLowerCase() === step.targetName.toLowerCase() &&
      (!step.targetSelector || candidate.selector === step.targetSelector)
    )
    if (entry) step.actionKey = entry.actionKey
  }
}

/**
 * Ensures every discovered ledger action has an executable plan step. This is
 * used after initial planning and after every live DOM rescan, so links, tabs,
 * form fields and controls revealed by modals do not disappear from coverage.
 */
export function queueUnplannedLedgerActions(
  job: AutomationJob,
  testPlan: FullAppTestPlan,
  onlyScreenId?: string,
  insertAfterIndex?: number
): number {
  const ledger = job.actionLedger
  if (!ledger) return 0

  linkTestPlanStepsToLedger(job, testPlan)
  const represented = new Set(
    testPlan.steps.map((step) => step.actionKey).filter((key): key is string => Boolean(key))
  )
  let added = 0
  let insertAt = insertAfterIndex === undefined ? -1 : insertAfterIndex + 1

  // Keep dismiss/close controls last when a modal is discovered, so the queue
  // gets a chance to exercise the other controls before the view disappears.
  const candidates = ledger.entries
    .filter((entry) => {
      if (entry.status !== "untested") return false
      if (onlyScreenId && entry.screenId !== onlyScreenId) return false
      // If already authenticated, only skip primary login credential inputs/submits,
      // but PRESERVE auxiliary actions (forgot password, create account, register, SSO)!
      if (job.authState === "logged_in") {
        const sc = testPlan.screens.find((s) => s.id === entry.screenId)
        if (sc?.isLoginWall) {
          const isPrimaryAuthInputOrSubmit =
            (entry.type === "input" && /(email|user|pass|login)/i.test(entry.name)) ||
            ((entry.type === "button" || entry.type === "clickable") && /^(sign\s*in|log\s*in|submit)$/i.test(entry.name.trim()))
          if (isPrimaryAuthInputOrSubmit) {
            entry.status = "skipped"
            entry.error = "Covered by authentication step (login form credentials already submitted)."
            return false
          }
        }
      }
      return true
    })
    .sort((a, b) => {
      const aDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(a.name.trim())
      const bDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(b.name.trim())
      return Number(aDismiss) - Number(bDismiss)
    })

  for (const entry of candidates) {
    if (represented.has(entry.actionKey)) continue

    const screen = testPlan.screens.find((candidate) => candidate.id === entry.screenId)
    const element = screen?.actionableElements.find((candidate) => candidate.actionKey === entry.actionKey)
    const actionType: TestPlanStep["actionType"] =
      entry.type === "input" ? "fill" :
      entry.type === "select" ? "select" :
      entry.type === "checkbox" || entry.type === "radio" || entry.type === "toggle" ? "toggle" :
      entry.type === "file_upload" ? "upload" :
      entry.type === "button" || entry.type === "clickable" || entry.type === "link" ||
      entry.type === "tab" || entry.type === "menu" || (entry.type === "other" && element?.isInteractive) ? "click" :
      "verify"

    // Do not silently turn an unknown element into a passing verification step.
    if (actionType === "verify") continue

    const name = entry.name || "Unnamed action"
    let syntheticValue: string | undefined
    if (actionType === "fill") {
      syntheticValue = inferContextualTestValue({
        screenName: screen?.name || entry.screenPath,
        fieldName: name,
        inputType: element?.inputType,
        placeholder: element?.placeholder,
        options: element?.options,
      })
    } else if (actionType === "select") {
      syntheticValue = inferContextualTestValue({
        screenName: screen?.name || entry.screenPath,
        fieldName: name,
        inputType: element?.inputType,
        placeholder: element?.placeholder,
        options: element?.options,
      })
    }

    let fileTypeRequired: TestPlanStep["fileTypeRequired"]
    if (actionType === "upload") {
      const accept = element?.accept || ""
      fileTypeRequired = /pdf/i.test(accept + name) ? "pdf" :
        /csv/i.test(accept + name) ? "csv" :
        /video/i.test(accept + name) ? "video" :
        /doc/i.test(accept + name) ? "document" : "image"
    }

    const queuedStep: TestPlanStep = {
      id: `step-${Date.now()}-${testPlan.steps.length + added + 1}`,
      screenId: entry.screenId,
      screenName: screen?.name || entry.screenPath,
      stepIndex: insertAt < 0 ? testPlan.steps.length + 1 : insertAt + 1,
      actionType,
      targetName: name,
      targetSelector: entry.selector,
      actionKey: entry.actionKey,
      syntheticValue,
      fileTypeRequired,
      expectedResult: actionType === "click"
        ? `Clicking "${name}" produces a verifiable UI, navigation, modal, or network effect.`
        : actionType === "fill"
          ? `Field "${name}" accepts synthetic input and reflects the entered value.`
          : actionType === "select"
            ? `Control "${name}" changes to the selected option.`
            : actionType === "upload"
              ? `Upload control "${name}" accepts a compatible test file.`
              : `Control "${name}" responds to interaction and its outcome is recorded.`,
      status: "pending",
    }
    if (insertAt < 0) {
      testPlan.steps.push(queuedStep)
    } else {
      testPlan.steps.splice(insertAt, 0, queuedStep)
      insertAt++
    }
    represented.add(entry.actionKey)
    added++
  }

  if (added > 0) {
    testPlan.steps.forEach((step, index) => { step.stepIndex = index + 1 })
    appendLog(job, "info", `[QUEUE] Added ${added} previously unplanned action(s) to the execution queue.`)
  }
  return added
}

/**
 * Keep pending work for the current screen together in the queue. This avoids
 * repeatedly leaving and re-entering tabs while their controls are still pending.
 * Dismiss/close controls are moved to the end so they do not hide untested siblings.
 */
export function prioritizePendingStepsForScreen(
  testPlan: FullAppTestPlan,
  screenId: string,
  afterIndex: number
): number {
  const start = afterIndex + 1
  if (start >= testPlan.steps.length) return 0

  const remaining = testPlan.steps.slice(start)
  const sameScreen = remaining.filter((step) => step.screenId === screenId && step.status === "pending")
  if (sameScreen.length === 0) return 0

  const sameScreenIds = new Set(sameScreen.map((step) => step.id))
  const otherSteps = remaining.filter((step) => !sameScreenIds.has(step.id))
  sameScreen.sort((a, b) => {
    const aDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(a.targetName.trim())
    const bDismiss = /^(close|dismiss|cancel|back|done|finish)(\b|$)/i.test(b.targetName.trim())
    return Number(aDismiss) - Number(bDismiss)
  })

  testPlan.steps.splice(start, remaining.length, ...sameScreen, ...otherSteps)
  testPlan.steps.forEach((step, index) => { step.stepIndex = index + 1 })
  return sameScreen.length
}

/**
 * Builds the structured test plan from discovered screens and actionable elements
 */
export function generateStructuredTestPlan(
  targetUrl: string,
  screens: AppScreenNode[],
  transitions: AppWorkflowTransition[],
  options?: {
    isAuthenticated?: boolean
    postmanCollection?: string | Record<string, any>
  }
): FullAppTestPlan {
  const steps: TestPlanStep[] = []
  let stepCounter = 1

  let postmanSummary: PostmanCollectionSummary | undefined = undefined
  if (options?.postmanCollection) {
    try {
      postmanSummary = parsePostmanCollection(options.postmanCollection)
    } catch (err: any) {
      console.warn("[Postman Import] Failed to parse collection:", err?.message)
    }
  }

  const requiredFileTypesMap = new Map<string, number>()

  for (const screen of screens) {
    // Track which forms are handled so we avoid loose duplicate steps for their inputs/submits
    const handledFormIds = new Set<string>()

    // If this screen was a pre-auth login wall and we are already authenticated:
    if (screen.isLoginWall && options?.isAuthenticated) {
      // Login already ran during discovery. Only report a pass when that run left
      // evidence: the post-login screen reached via "Submit Login Form".
      const loginTransition = transitions.find((t) => t.fromScreenId === screen.id && t.actionType === "form_submit")
      const postLogin = loginTransition ? screens.find((s) => s.id === loginTransition.toScreenId) : undefined
      const hasEvidence = Boolean(postLogin?.screenshotUrl)
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "verify",
        targetName: "User Authentication",
        expectedResult: "User is successfully authenticated and redirected to application dashboard.",
        actualResult: hasEvidence
          ? `Login submitted during discovery; landed on ${postLogin!.id} "${postLogin!.name}" (${postLogin!.path}).`
          : "Session reports logged in, but no post-login screen evidence was captured during discovery.",
        status: hasEvidence ? "passed" : "blocked",
        verdict: hasEvidence ? "passed" : "blocked",
        screenshotUrl: postLogin?.screenshotUrl,
        evidenceTimestamp: postLogin?.discoveredAt,
      })
      // Mark primary login form as handled so we don't duplicate credentials checks,
      // but continue below to plan auxiliary actions (Forgot password, Create account, etc.)
      screen.forms?.forEach((f) => handledFormIds.add(f.id))

      // Include discrete sign-in actions so the map captures the workflow from the start
      const userInput = screen.actionableElements.find((el) => el.type === "input" && /(email|user|login)/i.test(el.name))
      const passInput = screen.actionableElements.find((el) => el.type === "input" && /pass/i.test(el.name))
      const submitBtn = screen.actionableElements.find((el) => el.type === "button" && /^(sign\s*in|log\s*in|submit|continue)$/i.test(el.name.trim()))

      if (userInput) {
        steps.push({
          id: `step-${stepCounter++}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: steps.length + 1,
          actionType: "fill",
          targetName: userInput.name,
          targetSelector: userInput.selector,
          syntheticValue: "user@example.com",
          expectedResult: `Enter credentials into "${userInput.name}" field.`,
          actualResult: "Credentials entered during initial authentication.",
          status: "passed",
          verdict: "passed",
        })
      }
      if (passInput) {
        steps.push({
          id: `step-${stepCounter++}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: steps.length + 1,
          actionType: "fill",
          targetName: passInput.name,
          targetSelector: passInput.selector,
          syntheticValue: "********",
          expectedResult: `Enter password into "${passInput.name}" field.`,
          actualResult: "Password entered during initial authentication.",
          status: "passed",
          verdict: "passed",
        })
      }
      if (submitBtn) {
        steps.push({
          id: `step-${stepCounter++}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: steps.length + 1,
          actionType: "click",
          targetName: submitBtn.name,
          targetSelector: submitBtn.selector,
          expectedResult: `Click "${submitBtn.name}" to authenticate.`,
          actualResult: `Submitted credentials; redirected to ${postLogin ? postLogin.name : "dashboard"}.`,
          status: "passed",
          verdict: "passed",
        })
      }
    }

    // 1. Plan Form Scenarios (grouped by screen.forms)
    if (screen.forms && screen.forms.length > 0) {
      for (const form of screen.forms) {
        handledFormIds.add(form.id)
        const formElements = screen.actionableElements.filter(
          (el) => el.formId === form.id || (form.fields && form.fields.includes(el.name))
        )
        const hasRequired = formElements.some((el) => el.isRequired)
        const hasFormat = formElements.some(
          (el) =>
            el.inputType === "email" ||
            el.inputType === "tel" ||
            /email|phone|mobile/i.test(el.name) ||
            /email|phone|mobile/i.test(el.placeholder || "")
        )

        // Strict order: required_empty -> invalid_format -> valid (last)
        if (hasRequired) {
          steps.push({
            id: `step-${stepCounter++}`,
            screenId: screen.id,
            screenName: screen.name,
            stepIndex: steps.length + 1,
            actionType: "form_scenario",
            formId: form.id,
            formVariant: "required_empty",
            targetName: `Form "${form.name || form.id}" (Required Empty Check)`,
            targetSelector: form.selector,
            expectedResult: `Form "${form.name || form.id}" blocks submission and shows validation error when required fields are blank; no mutating 2xx request.`,
            status: "pending",
          })
        }

        if (hasFormat) {
          steps.push({
            id: `step-${stepCounter++}`,
            screenId: screen.id,
            screenName: screen.name,
            stepIndex: steps.length + 1,
            actionType: "form_scenario",
            formId: form.id,
            formVariant: "invalid_format",
            targetName: `Form "${form.name || form.id}" (Invalid Format Check)`,
            targetSelector: form.selector,
            expectedResult: `Form "${form.name || form.id}" blocks submission and displays format error when invalid email/phone is typed; no mutating 2xx request.`,
            status: "pending",
          })
        }

        // Check if a Postman endpoint matches this form
        let matchedEndpointMapping: PostmanEndpointMapping | null = null
        if (postmanSummary && postmanSummary.endpoints.length > 0) {
          for (const ep of postmanSummary.endpoints) {
            const m = matchEndpointToForm(ep, form, formElements, screen.path)
            if (m && (m.overallConfidence === "high" || m.overallConfidence === "medium")) {
              matchedEndpointMapping = m
              break
            }
          }
        }

        let fieldPayload: Record<string, string> | undefined = undefined
        if (matchedEndpointMapping) {
          fieldPayload = buildFormPayloadFromPostman(matchedEndpointMapping, formElements)
        }

        // Always valid scenario last:
        const validTargetName = matchedEndpointMapping
          ? `Form "${form.name || form.id}" (Valid Submission via API: ${matchedEndpointMapping.endpoint.name})`
          : `Form "${form.name || form.id}" (Valid Submission)`

        const validExpected = matchedEndpointMapping
          ? `Form "${form.name || form.id}" accepts mapped fields from Postman endpoint "${matchedEndpointMapping.endpoint.name}" (${matchedEndpointMapping.overallConfidence} confidence) and submits, confirmed on wire.`
          : `Form "${form.name || form.id}" accepts valid synthetic data and submits, resulting in transition, modal close, toast, or 2xx response.`

        steps.push({
          id: `step-${stepCounter++}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: steps.length + 1,
          actionType: "form_scenario",
          formId: form.id,
          formVariant: "valid",
          targetName: validTargetName,
          targetSelector: form.selector,
          fieldPayload,
          postmanEndpoint: matchedEndpointMapping?.endpoint,
          postmanMappings: matchedEndpointMapping?.fieldMappings,
          expectedResult: validExpected,
          status: "pending",
        })
      }
    }

    // 2. Plan Standalone Form Input field interactions (not part of any handled form)
    const standaloneInputs = screen.actionableElements.filter(
      (el) =>
        el.type === "input" &&
        (!el.formId || !handledFormIds.has(el.formId)) &&
        !(screen.isLoginWall && options?.isAuthenticated && /(email|user|pass|login)/i.test(el.name))
    )
    for (const input of standaloneInputs) {
      // Never store real credentials in the plan (persisted + shown in Plan tab).
      // executeStructuredTestPlan substitutes session credentials at fill time.
      const syntheticVal = inferContextualTestValue({
        screenName: screen.name,
        fieldName: input.name,
        inputType: input.inputType,
        placeholder: input.placeholder,
        options: input.options,
      })

      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "fill",
        targetName: input.name,
        targetSelector: input.selector,
        syntheticValue: syntheticVal,
        expectedResult: `Field "${input.name}" accepts synthetic input value without validation errors.`,
        status: "pending",
      })
    }

    // 3. Plan File Uploads
    const fileUploads = screen.actionableElements.filter((el) => el.type === "file_upload")
    for (const upload of fileUploads) {
      let fType: "image" | "pdf" | "document" | "csv" | "other" = "image"
      if (upload.accept?.includes("pdf") || /pdf/i.test(upload.name)) fType = "pdf"
      else if (upload.accept?.includes("csv") || /csv/i.test(upload.name)) fType = "csv"
      else if (upload.accept?.includes("doc") || /doc/i.test(upload.name)) fType = "document"

      requiredFileTypesMap.set(fType, (requiredFileTypesMap.get(fType) || 0) + 1)

      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "upload",
        targetName: upload.name,
        targetSelector: upload.selector,
        fileTypeRequired: fType,
        expectedResult: `Upload control accepts valid ${fType.toUpperCase()} dummy test file.`,
        status: "pending",
      })
    }

    // 4. Plan Standalone Dropdowns / Selects
    const standaloneSelects = screen.actionableElements.filter(
      (el) => el.type === "select" && (!el.formId || !handledFormIds.has(el.formId))
    )
    for (const select of standaloneSelects) {
      const choice = select.options && select.options.length > 0 ? select.options[0] : "Option 1"
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "select",
        targetName: select.name,
        targetSelector: select.selector,
        syntheticValue: choice,
        expectedResult: `Select "${select.name}" value changes to "${choice}".`,
        status: "pending",
      })
    }

    // 5. Plan Standalone Checkboxes & Toggles
    const standaloneToggles = screen.actionableElements.filter(
      (el) => (el.type === "checkbox" || el.type === "toggle") && (!el.formId || !handledFormIds.has(el.formId))
    )
    for (const toggle of standaloneToggles) {
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "toggle",
        targetName: toggle.name,
        targetSelector: toggle.selector,
        expectedResult: `Toggle/Checkbox "${toggle.name}" toggles state cleanly.`,
        status: "pending",
      })
    }

    // 6. Plan Standalone Buttons & Action Submits
    const standaloneButtons = screen.actionableElements.filter(
      (el) =>
        el.type === "button" &&
        (!el.formId || !handledFormIds.has(el.formId) || /forgot|create|register|signup|reset/i.test(el.name)) &&
        !/(logout|sign\s*out|log\s*off|delete\s*account)/i.test(el.name) &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.selector || "") &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.actionKey || "") &&
        !(screen.isLoginWall && options?.isAuthenticated && /^(sign\s*in|log\s*in|submit)$/i.test(el.name.trim()))
    )
    for (const btn of standaloneButtons) {
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "click",
        targetName: btn.name,
        targetSelector: btn.selector,
        expectedResult: `Clicking button "${btn.name}" triggers expected transition or modal response.`,
        status: "pending",
      })

      if (!transitions.some((t) => t.fromScreenId === screen.id && t.action === btn.name)) {
        transitions.push({
          id: `tr-${transitions.length + 1}`,
          fromScreenId: screen.id,
          toScreenId: screen.id,
          action: btn.name,
          actionType: "click",
          triggerSelector: btn.selector,
        })
      }
    }

    // 7. Plan Standalone Clickables, Cards, Tabs, Links & Menus
    const standaloneClickables = screen.actionableElements.filter(
      (el) =>
        (el.type === "clickable" || el.type === "tab" || el.type === "link" || el.type === "menu") &&
        (!el.formId || !handledFormIds.has(el.formId) || el.type === "link" || el.type === "clickable" || /forgot|create|register|signup|reset/i.test(el.name)) &&
        !/(logout|sign\s*out|log\s*off|delete\s*account)/i.test(el.name) &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.selector || "") &&
        !/(logout|sign\s*out|log\s*off)/i.test(el.actionKey || "") &&
        !(screen.isLoginWall && options?.isAuthenticated && /^(sign\s*in|log\s*in|submit)$/i.test(el.name.trim()))
    )
    for (const item of standaloneClickables) {
      const typeLabel =
        item.type === "tab" ? "Tab" :
        item.type === "link" ? "Link" :
        item.type === "menu" ? "Menu item" : "Control"
      steps.push({
        id: `step-${stepCounter++}`,
        screenId: screen.id,
        screenName: screen.name,
        stepIndex: steps.length + 1,
        actionType: "click",
        targetName: item.name,
        targetSelector: item.selector,
        actionKey: item.actionKey,
        expectedResult: `Clicking ${typeLabel.toLowerCase()} "${item.name}" triggers expected state change, transition, modal, or UI response.`,
        status: "pending",
      })

      // If this item connects to another known screen (e.g. Drills, Workout, Profile tab, or link), point edge to that screen!
      let targetScreenId = screen.id
      const targetScreen = screens.find(
        (s) =>
          s.id !== screen.id &&
          (s.name.toLowerCase().includes(item.name.toLowerCase()) ||
            item.name.toLowerCase().includes(s.name.toLowerCase()) ||
            (item.href && s.url.includes(item.href)))
      )
      if (targetScreen) {
        targetScreenId = targetScreen.id
      }

      if (!transitions.some((t) => t.fromScreenId === screen.id && t.toScreenId === targetScreenId && t.action === item.name)) {
        transitions.push({
          id: `tr-${transitions.length + 1}`,
          fromScreenId: screen.id,
          toScreenId: targetScreenId,
          action: item.name,
          actionType: "click",
          triggerSelector: item.selector,
        })
      }
    }
  }

  const requiredFileTypes = Array.from(requiredFileTypesMap.entries()).map(([type, count]) => ({
    type: type as any,
    count,
  }))

  return {
    id: `plan-${Date.now()}`,
    targetUrl,
    screens,
    transitions,
    steps,
    postmanSummary,
    requiredFileTypes,
    status: "planned",
    coverage: {
      screensTested: 0,
      totalScreens: screens.length,
      actionsTested: 0,
      totalActions: steps.length,
      formsTested: 0,
      totalForms: screens.reduce((acc, s) => acc + (s.forms?.length || 0), 0),
      percentage: 0,
    },
  }
}
