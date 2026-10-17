import { NextRequest, NextResponse } from "next/server"
import { getJob, cancelJob, saveJob, executeJob, appendLog } from "@/lib/ai-automation/runner"
import {
  requireUser,
  requireProjectAccess,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/require-project-access"
import { sanitizeJobForClient } from "@/lib/browser/secure-browser"
import { setJobSecrets, clearJobSecrets } from "@/lib/ai-automation/job-secret-vault"
import { emitSessionEvent } from "@/lib/ai-automation/job-store"
import { assertSafeTargetUrlWithDevBypass, UrlGuardError } from "@/lib/security/url-guard"

async function assertJobAccess(job: { projectId?: string; userId?: string }) {
  const user = await requireUser()
  if (job.projectId) {
    await requireProjectAccess(job.projectId, "view")
    return user
  }
  if (job.userId && job.userId !== user.id) {
    throw new AuthError(403, "Not allowed to access this job")
  }
  return user
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const jobId = searchParams.get("jobId")

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId parameter" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)

    return NextResponse.json({
      success: true,
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    if (err instanceof UrlGuardError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error("[API ai-automation/status] Error:", err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { jobId, action, username, password } = body

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
    }

    const job = getJob(jobId)
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    await assertJobAccess(job as any)
    if (job.projectId) {
      await requireProjectAccess(job.projectId, "edit")
    }

    if (action === "navigate_session") {
      if (job.status !== "running" && job.status !== "queued") {
        return NextResponse.json({ error: "Navigation requires an active testing session" }, { status: 409 })
      }
      const requestedUrl = assertSafeTargetUrlWithDevBypass(String(body.url || ""))
      const currentUrl = job.currentUrl || job.targetUrl
      const currentOrigin = new URL(job.targetUrl).origin
      if (new URL(requestedUrl).origin !== currentOrigin) {
        return NextResponse.json({
          error: "Navigation within an active session must stay on the current target origin. Start a separate session to test another application.",
        }, { status: 400 })
      }
      const pendingUrl = job.pendingSessionNavigation?.url
      if (requestedUrl === currentUrl && !pendingUrl) {
        return NextResponse.json({
          success: true,
          unchanged: true,
          job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
        })
      }
      if (requestedUrl === pendingUrl) {
        return NextResponse.json({
          success: true,
          queued: true,
          unchanged: true,
          job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
        })
      }

      job.sessionId ||= job.id
      job.currentUrl = requestedUrl
      job.targetUrl = requestedUrl
      if (job.fullAppTestPlan) job.fullAppTestPlan.targetUrl = requestedUrl
      job.pendingSessionNavigation = {
        requestId: `${job.sessionId}:nav:${Date.now()}`,
        url: requestedUrl,
        requestedAt: new Date().toISOString(),
      }
      emitSessionEvent(job, "navigation_requested", {
        url: requestedUrl,
        message: `Navigation requested: ${requestedUrl}`,
        payload: { requestId: job.pendingSessionNavigation.requestId },
      })
      return NextResponse.json({
        success: true,
        queued: true,
        message: "Navigation queued for the next safe browser action boundary.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "session_input") {
      if (job.status !== "running" && job.status !== "queued") {
        return NextResponse.json({ error: "There is no active testing session to receive input" }, { status: 409 })
      }
      const text = typeof body.text === "string" ? body.text.trim() : ""
      if (!text) return NextResponse.json({ error: "Missing session input" }, { status: 400 })

      // Explicit navigation requests in chat update the same session rather than
      // creating a new automation job. Relative paths resolve against its current URL.
      const navigationMatch = text.match(/\b(?:navigate|go|open|visit)\s+(?:to\s+)?(https?:\/\/[^\s]+|\/[^\s]*)/i)
      if (navigationMatch) {
        const currentUrl = job.currentUrl || job.targetUrl
        const requestedUrl = assertSafeTargetUrlWithDevBypass(new URL(navigationMatch[1], currentUrl).href)
        if (new URL(requestedUrl).origin !== new URL(job.targetUrl).origin) {
          return NextResponse.json({ error: "Session navigation must stay on the current target origin." }, { status: 400 })
        }
        if (requestedUrl !== (job.pendingSessionNavigation?.url || job.currentUrl || job.targetUrl)) {
          job.sessionId ||= job.id
          job.currentUrl = requestedUrl
          job.targetUrl = requestedUrl
          if (job.fullAppTestPlan) job.fullAppTestPlan.targetUrl = requestedUrl
          job.pendingSessionNavigation = {
            requestId: `${job.sessionId}:nav:${Date.now()}`,
            url: requestedUrl,
            requestedAt: new Date().toISOString(),
          }
          emitSessionEvent(job, "navigation_requested", {
            url: requestedUrl,
            message: `Chat requested navigation to ${requestedUrl}`,
            payload: { requestId: job.pendingSessionNavigation.requestId, source: "chat" },
          })
        }
      }

      emitSessionEvent(job, "user_input", {
        message: "User input received by the active testing session.",
        payload: {
          inputId: `${job.sessionId || job.id}:input:${Date.now()}`,
          text: text.replace(/\b(password|pass|pwd|token|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1: ****"),
        },
      })
      return NextResponse.json({
        success: true,
        message: "Input delivered to the active session.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (
      action === "pause_recording" ||
      action === "resume_recording" ||
      action === "stop_recording"
    ) {
      if (job.status !== "running") {
        return NextResponse.json({ error: "Recording can only be controlled while a test is running" }, { status: 409 })
      }
      const currentState = (job as any).recordingControl || "recording"
      if (currentState === "stopped") {
        return NextResponse.json({ error: "Recording has already stopped and cannot be resumed" }, { status: 409 })
      }
      if (action === "pause_recording" && currentState !== "recording") {
        return NextResponse.json({ error: "Recording is not currently running" }, { status: 409 })
      }
      if (action === "resume_recording" && currentState !== "paused") {
        return NextResponse.json({ error: "Recording is not paused" }, { status: 409 })
      }
      const nextState =
        action === "pause_recording"
          ? "paused"
          : action === "resume_recording"
            ? "recording"
            : "stopped"
      ;(job as any).recordingControl = nextState
      saveJob(job)
      return NextResponse.json({
        success: true,
        message:
          nextState === "paused"
            ? "Recording paused"
            : nextState === "recording"
              ? "Recording resumed"
              : "Recording stopped",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "stop") {
      clearJobSecrets(jobId)
      const stopped = cancelJob(jobId)
      const updated = getJob(jobId)
      if (stopped && updated) {
        emitSessionEvent(updated, "session_stopped", {
          message: "Testing session stopped; the active browser and recording are being finalized.",
          payload: { reason: "user_requested" },
        })
      }
      return NextResponse.json({
        success: stopped,
        message: stopped ? "Job stopped" : "Job not found or already completed",
        job: updated
          ? sanitizeJobForClient(updated as unknown as Record<string, unknown>)
          : null,
      })
    }

    if (action === "approve_test_plan") {
      if (!job.fullAppTestPlan || (job.planApprovalState !== "awaiting_review" && job.planApprovalState !== "approved")) {
        return NextResponse.json({ error: "This job is not waiting for plan approval." }, { status: 409 })
      }
      job.planApprovalState = "approved"
      const wasRunning = job.status === "running"
      job.status = "running"
      job.currentStep = "Test plan approved. Executing test plan..."
      saveJob(job)
      emitSessionEvent(job, "user_input", {
        message: "User approved the test plan. Execution will continue.",
        payload: { action: "approve_test_plan", planId: job.fullAppTestPlan.id },
      })

      if (!wasRunning) {
        setImmediate(() => {
          executeJob(job, {
            url: job.targetUrl,
            projectId: job.projectId,
            mode: "full_app",
            role: job.role,
            layaBaseUrl: job.layaBaseUrl,
            viewports: job.viewports,
            maxScreens: job.maxScreens,
            aiModel: job.aiModel,
            aiBaseUrl: job.aiBaseUrl,
            dummyTestFiles: job.dummyTestFiles,
            uploadFilesDir: job.uploadFilesDir,
            postmanCollection: job.postmanCollection,
          }).catch((err) => {
            console.error(`[AI Bot] Fatal error running approved job ${job.id}:`, err)
            job.status = "failed"
            job.error = err?.message || "Execution error"
            saveJob(job)
          })
        })
      }

      return NextResponse.json({
        success: true,
        message: "Plan approved. Continuing execution.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "rediscover_missing_screen") {
      const instruction = typeof body.instruction === "string" ? body.instruction.trim() : ""
      if (!instruction) {
        return NextResponse.json({ error: "Describe the missing screen, tab, dialog, or state you want rediscovered." }, { status: 400 })
      }
      if (!job.fullAppTestPlan) {
        return NextResponse.json({ error: "Run initial app discovery first so new screens can be merged into the existing map." }, { status: 409 })
      }
      if (job.status === "running" && job.planApprovalState !== "awaiting_review") {
        return NextResponse.json({ error: "Targeted rediscovery is available after the current execution finishes, or while its test plan is awaiting review." }, { status: 409 })
      }

      ;(job as any).rediscoveryPrompt = instruction
      ;(job as any).lastProcessedRediscoveryPrompt = undefined
      emitSessionEvent(job, "user_input", {
        message: `User requested rediscovery of a missing screen: ${instruction.slice(0, 240)}`,
        payload: { action: "rediscover_missing_screen", instruction },
      })

      if (job.status === "running" && job.planApprovalState === "awaiting_review") {
        job.currentStep = "Rediscovery requested. Revisiting the application and merging any verified missing screens into the existing map..."
        saveJob(job)
        return NextResponse.json({
          success: true,
          message: "I’ll revisit the application, explore the requested area, merge newly verified states into the existing map, and regenerate the plan for your review.",
          job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
        })
      }

      job.status = "running"
      job.progress = 5
      job.planApprovalState = undefined
      job.testingPhase = "discovery"
      job.error = undefined
      job.finishedAt = undefined
      job.currentStep = "Reopening the application to rediscover the missing screen and update the existing map..."
      saveJob(job)
      setImmediate(() => {
        executeJob(job, {
          url: job.targetUrl,
          projectId: job.projectId,
          mode: "full_app",
          role: job.role,
          layaBaseUrl: job.layaBaseUrl,
          viewports: job.viewports,
          maxScreens: Math.max(job.maxScreens || 10, 15),
          aiModel: job.aiModel,
          aiBaseUrl: job.aiBaseUrl,
          dummyTestFiles: job.dummyTestFiles,
          uploadFilesDir: job.uploadFilesDir,
          postmanCollection: job.postmanCollection,
        }).catch((err) => {
          console.error(`[AI Bot] Targeted rediscovery failed for job ${job.id}:`, err)
          job.status = "failed"
          job.error = err?.message || "Targeted rediscovery failed"
          saveJob(job)
        })
      })
      return NextResponse.json({
        success: true,
        message: "Targeted rediscovery started. I’ll merge verified screens into the existing map and return a revised plan for review.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "edit_test_plan") {
      const instruction = typeof body.instruction === "string" ? body.instruction.trim() : ""
      const plan = job.fullAppTestPlan
      if (job.status !== "running" || !plan || job.planApprovalState !== "awaiting_review") {
        return NextResponse.json({ error: "The plan can only be edited while it is waiting for review." }, { status: 409 })
      }
      if (!instruction) return NextResponse.json({ error: "Enter a plan change first." }, { status: 400 })

      const removeMatch = instruction.match(/(?:remove|delete|drop)\s+(?:step\s*)#?(\d+)/i)
      const renameMatch = instruction.match(/(?:rename|change)\s+(?:step\s*)#?(\d+)\s+(?:to|as)\s+(.+)/i)
      const expectedMatch = instruction.match(/(?:change|update|set)\s+(?:the\s+)?expected(?:\s+result)?\s+(?:for\s+)?(?:step\s*)#?(\d+)\s+(?:to|as)\s+(.+)/i)
      let message = ""

      if (removeMatch) {
        const number = Number(removeMatch[1])
        const index = plan.steps.findIndex((step, i) => step.stepIndex === number || i + 1 === number)
        if (index < 0) return NextResponse.json({ error: `I couldn't find step ${number}. Use the visible step number.` }, { status: 422 })
        const [removed] = plan.steps.splice(index, 1)
        message = `Removed step ${number}: ${removed.targetName}.`
      } else if (renameMatch) {
        const number = Number(renameMatch[1])
        const step = plan.steps.find((item, i) => item.stepIndex === number || i + 1 === number)
        if (!step) return NextResponse.json({ error: `I couldn't find step ${number}.` }, { status: 422 })
        step.targetName = renameMatch[2].trim()
        message = `Renamed step ${number} to “${step.targetName}”.`
      } else if (expectedMatch) {
        const number = Number(expectedMatch[1])
        const step = plan.steps.find((item, i) => item.stepIndex === number || i + 1 === number)
        if (!step) return NextResponse.json({ error: `I couldn't find step ${number}.` }, { status: 422 })
        step.expectedResult = expectedMatch[2].trim()
        message = `Updated the expected result for step ${number}.`
      } else if (/^(?:add|include|create)\s+(?:a\s+)?(?:test|step|check)\s+(?:for|to check|that checks)\s+/i.test(instruction)) {
        const targetName = instruction.replace(/^(?:add|include|create)\s+(?:a\s+)?(?:test|step|check)\s+(?:for|to check|that checks)\s+/i, "").trim()
        if (!targetName) return NextResponse.json({ error: "Describe what the new test should check." }, { status: 400 })
        const normalized = targetName.toLowerCase()
        const screen = plan.screens.find((item) =>
          normalized.includes(item.name.toLowerCase()) ||
          normalized.includes(item.path.toLowerCase()) ||
          item.name.toLowerCase().includes(normalized)
        ) || plan.screens[0]
        if (!screen) return NextResponse.json({ error: "There are no discovered screens to attach this test to." }, { status: 422 })
        const nextIndex = plan.steps.reduce((max, step) => Math.max(max, step.stepIndex), 0) + 1
        plan.steps.push({
          id: `plan-chat-${Date.now()}`,
          screenId: screen.id,
          screenName: screen.name,
          stepIndex: nextIndex,
          actionType: "verify",
          targetName,
          expectedResult: `Verify that ${targetName} works as expected.`,
          status: "pending",
        })
        plan.coverage.totalActions = plan.steps.length
        message = `Added “${targetName}” to the plan on ${screen.name}. Please check its expected result before approving.`
      } else {
        return NextResponse.json({
          error: "I can apply these plan edits: “remove step 3”, “rename step 3 to Check signup validation”, “change expected result for step 3 to ...”, or “add a test for signup validation”.",
        }, { status: 422 })
      }

      // Re-index after structural edits so displayed numbering stays unique and predictable.
      plan.steps.forEach((step, index) => { step.stepIndex = index + 1 })
      plan.coverage.totalActions = plan.steps.length
      plan.coverage.totalScreens = plan.screens.length
      job.fullAppTestPlan = plan
      job.planApprovalState = "awaiting_review"
      job.currentStep = "Plan updated. Review the changes, continue chatting if needed, then approve execution."
      saveJob(job)
      emitSessionEvent(job, "user_input", {
        message: `Plan updated: ${message}`,
        payload: { action: "edit_test_plan", planId: plan.id, instruction },
      })
      return NextResponse.json({
        success: true,
        message,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "provide_credentials") {
      if (!username && !password) {
        return NextResponse.json(
          { error: "username or email required" },
          { status: 400 }
        )
      }
      const safeUser = String(username || "")
      const safePass = String(password || "")
      setJobSecrets(jobId, {
        credentials: { username: safeUser, password: safePass },
      })
      ;(job as any).pendingCredentials = { username: safeUser, password: safePass }
      if (!job.messages) job.messages = []
      job.messages.push({
        id: `msg-user-cred-${Date.now()}`,
        sender: "user",
        text: safePass ? `Credentials provided for ${safeUser}` : `Email provided: ${safeUser}`,
        timestamp: new Date().toISOString(),
      })

      // Sync provided credentials to plan steps
      if (job.fullAppTestPlan?.steps) {
        for (const s of job.fullAppTestPlan.steps) {
          if (s.actionType === "fill") {
            const isEmail = /e-?mail/i.test(s.targetName) || /e-?mail/i.test(s.targetSelector || "")
            const isUser = /user|login/i.test(s.targetName) || /user|login/i.test(s.targetSelector || "")
            const isPass = /pass/i.test(s.targetName) || /pass/i.test(s.targetSelector || "")
            if ((isEmail || isUser) && safeUser) s.syntheticValue = safeUser
            if (isPass && safePass) s.syntheticValue = safePass
          }
        }
      }

      if (job.status !== "running") {
        job.status = "running"
        saveJob(job)
        setImmediate(() => {
          executeJob(job, {
            url: job.targetUrl,
            projectId: job.projectId,
            mode: "full_app",
            credentials: { username: safeUser, password: safePass },
          }).catch((err) => {
            console.error(`[AI Bot] Fatal error running job with credentials ${job.id}:`, err)
          })
        })
      } else {
        saveJob(job)
      }
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "update_step_value") {
      const { stepId, value } = body
      if (job.fullAppTestPlan?.steps && stepId) {
        const targetStep = job.fullAppTestPlan.steps.find((s) => s.id === stepId)
        if (targetStep) {
          targetStep.syntheticValue = String(value ?? "")
          saveJob(job)
        }
      }
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_auth") {
      setJobSecrets(jobId, { credentials: { username: "", password: "" } })
      ;(job as any).pendingCredentials = { skip: true }
      ;(job as any).authState = "skipped"
      ;(job as any).authPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "reset_test_data") {
      // Clear all map data and test plan data
      job.screens = []
      ;(job as any).appMap = undefined
      job.fullAppTestPlan = undefined
      job.planApprovalState = undefined
      job.actionLedger = undefined
      job.issues = []
      job.testingPhase = undefined
      job.currentStep = "Map and test data reset. Ready for a new test run."
      job.authState = "none"
      job.authPrompt = undefined
      job.pendingCredentials = undefined
      job.error = undefined

      appendLog(job, "info", "[RESET] Application screen map, test plan, and execution data have been reset.")
      if (!job.messages) job.messages = []
      job.messages.push({
        id: `msg-reset-${Date.now()}`,
        sender: "agent",
        text: "🔄 Screen map and test plan data have been cleared. You can now re-scan, run a new pre-flight plan, or start testing fresh.",
        timestamp: new Date().toISOString(),
      })
      emitSessionEvent(job, "user_input", {
        message: "Map and test data reset by user.",
        payload: { action: "reset_test_data" },
      })
      saveJob(job)

      return NextResponse.json({
        success: true,
        message: "Map and test data reset successfully.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "confirm_verification") {
      const { verificationUrl, verificationCode } = body
      const verification = {
        completed: true,
        verificationUrl: verificationUrl ? String(verificationUrl) : undefined,
        verificationCode: verificationCode ? String(verificationCode) : undefined,
      }
      setJobSecrets(jobId, { verification })
      ;(job as any).pendingVerification = verification
      ;(job as any).verificationState = "verified"
      ;(job as any).verificationPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "External verification confirmation received. Resuming testing.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_verification") {
      setJobSecrets(jobId, { verification: { skip: true } })
      ;(job as any).pendingVerification = { skip: true }
      ;(job as any).verificationState = "skipped"
      ;(job as any).verificationPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "External verification skipped.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "provide_settings_credentials") {
      const { credentials } = body
      if (!credentials || typeof credentials !== "object") {
        return NextResponse.json(
          { error: "credentials object required" },
          { status: 400 }
        )
      }
      const secretValues: Record<string, string> = {}
      for (const [key, value] of Object.entries(credentials)) {
        if (typeof value === "string") secretValues[key] = value
      }
      setJobSecrets(jobId, { settingsCredentials: secretValues })
      ;(job as any).pendingSettingsCredentials = secretValues
      ;(job as any).settingsState = "configured"
      ;(job as any).settingsPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "Settings credentials received securely. Resuming testing.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "skip_settings_credentials") {
      setJobSecrets(jobId, { settingsCredentials: { __skip: "true" } })
      ;(job as any).pendingSettingsCredentials = { skip: true }
      ;(job as any).settingsState = "skipped"
      ;(job as any).settingsPrompt = undefined
      saveJob(job)
      return NextResponse.json({
        success: true,
        message: "Settings credentials skipped.",
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    if (action === "unblock_workflows") {
      const mode = body.mode || "retry" // "retry" | "synthetic_data" | "credentials" | "skip"
      const username = body.username ? String(body.username).trim() : ""
      const password = body.password ? String(body.password).trim() : ""
      const screenId = body.screenId ? String(body.screenId).trim() : ""

      // 1. If credentials provided, store securely in vault
      if (username || password) {
        setJobSecrets(jobId, {
          credentials: { username, password },
        })
        ;(job as any).pendingCredentials = { username, password }
        job.authState = "logged_in"
        job.authPrompt = undefined
      } else if (mode === "skip") {
        setJobSecrets(jobId, { credentials: { username: "", password: "" } })
        ;(job as any).pendingCredentials = { skip: true }
        ;(job as any).authState = "skipped"
        job.authPrompt = undefined
      }

      // 2. Unblock steps in test plan
      let unblockedCount = 0
      if (job.fullAppTestPlan?.steps) {
        for (const s of job.fullAppTestPlan.steps) {
          const matchScreen = !screenId || s.screenId === screenId
          if (matchScreen && (s.status === "blocked" || (mode === "retry" && s.status === "failed"))) {
            if (mode === "skip") {
              s.status = "skipped_unsafe"
              s.actualResult = "Skipped by user to unblock remaining workflow steps."
            } else {
              s.status = "pending"
              s.error = undefined
              s.actualResult = undefined
              if (s.actionType === "fill") {
                const isEmail = /e-?mail/i.test(s.targetName) || /e-?mail/i.test(s.targetSelector || "")
                const isUser = /user|login/i.test(s.targetName) || /user|login/i.test(s.targetSelector || "")
                const isPass = /pass/i.test(s.targetName) || /pass/i.test(s.targetSelector || "")
                if ((isEmail || isUser) && username) s.syntheticValue = username
                else if (isPass && password) s.syntheticValue = password
                else if (mode === "synthetic_data" && !s.syntheticValue) {
                  s.syntheticValue = isEmail
                    ? `test.user+${Date.now()}@example.com`
                    : isPass
                    ? "TestPass#2026!"
                    : "Synthetic Valid Data"
                }
              }
            }
            unblockedCount++
          }
        }
      }

      // 3. Reset blocked ledger items
      if (job.actionLedger?.entries) {
        for (const entry of job.actionLedger.entries) {
          if (entry.status === "blocked") {
            entry.status = mode === "skip" ? "skipped" : "untested"
            entry.error = undefined
          }
        }
        job.actionLedger.blocked = job.actionLedger.entries.filter((e) => e.status === "blocked").length
      }

      // 4. Reset screens testStatus if blocked
      if (job.fullAppTestPlan?.screens) {
        for (const sc of job.fullAppTestPlan.screens) {
          if ((sc as any).testStatus === "blocked") {
            (sc as any).testStatus = "pending"
          }
        }
      }

      // 5. Append message and log
      const message =
        mode === "skip"
          ? `Skipped ${unblockedCount} blocked workflow step(s). Continuing test execution.`
          : mode === "credentials"
          ? `Applied credentials. Unblocked ${unblockedCount} step(s) and resumed workflow execution.`
          : mode === "synthetic_data"
          ? `Applied synthetic test data. Unblocked ${unblockedCount} step(s) and resumed workflow execution.`
          : `Unblocked and reset ${unblockedCount} workflow step(s) for re-test.`

      appendLog(job, "info", `[UNBLOCK] ${message}`)
      if (!job.messages) job.messages = []
      job.messages.push({
        id: `msg-unblock-${Date.now()}`,
        sender: "agent",
        text: `✅ ${message}`,
        timestamp: new Date().toISOString(),
      })

      // 6. Resume execution if not actively running
      if (job.status !== "running" && mode !== "skip" && unblockedCount > 0) {
        job.status = "running"
        job.currentStep = message
        saveJob(job)
        setImmediate(() => {
          executeJob(job, {
            url: job.targetUrl,
            projectId: job.projectId,
            mode: (job.mode as any) || "feature_workflow",
            credentials: username ? { username, password } : undefined,
          }).catch((err) => {
            console.error(`[AI Bot] Fatal error resuming unblocked job ${job.id}:`, err)
          })
        })
      } else {
        job.currentStep = message
        saveJob(job)
      }

      emitSessionEvent(job, "user_input", {
        message,
        payload: { action: "unblock_workflows", mode, unblockedCount },
      })

      return NextResponse.json({
        success: true,
        message,
        unblockedCount,
        job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
      })
    }

    return NextResponse.json({
      success: true,
      job: sanitizeJobForClient(job as unknown as Record<string, unknown>),
    })
  } catch (err: unknown) {
    if (err instanceof AuthError) return authErrorResponse(err)
    return NextResponse.json(
      { error: (err as Error)?.message || "Internal server error" },
      { status: 500 }
    )
  }
}
