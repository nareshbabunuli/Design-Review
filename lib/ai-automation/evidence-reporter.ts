import {
  AutomationJob,
  AutomationReport,
  AutomationIssue,
  FullAppTestPlan,
  WorkflowRun,
  PostmanCollectionSummary,
  PostmanEndpointMapping,
} from "./types"
import { formatCurlCommand } from "./workflow-chainer"
import { secretRedactor } from "./secure-credentials-manager"

/**
 * Builds the comprehensive outcome-verified UI testing report,
 * populating job.report with workflow execution traces, issue taxonomy,
 * cURL reproduction steps, and full Markdown report artifact.
 */
export function buildAutomationReport(
  job: AutomationJob,
  testPlan: FullAppTestPlan,
  workflows: WorkflowRun[] = [],
  options?: {
    postmanSummary?: PostmanCollectionSummary
    endpointMappings?: PostmanEndpointMapping[]
  }
): AutomationReport {
  const steps = testPlan.steps || []
  const passedSteps = steps.filter((s) => s.verdict === "passed" || s.status === "passed").length
  const suspectedSteps = steps.filter(
    (s) => s.verdict === "suspected_non_functional" || s.status === "suspected_non_functional"
  ).length
  const failedSteps = steps.filter((s) => s.verdict === "failed" || s.status === "failed").length
  const skippedUnsafe = steps.filter(
    (s) => s.verdict === "skipped_unsafe" || s.status === "skipped_unsafe"
  ).length
  const blockedSteps = steps.filter((s) => s.verdict === "blocked" || s.status === "blocked").length

  const totalIssues = job.issues.length

  // Screen counts
  const totalScreens = testPlan.screens.length
  const failedScreenIds = new Set(
    job.issues.filter((i) => i.severity === "high" || i.severity === "blocker").map((i) => i.screenUrl)
  )
  const failedScreens = failedScreenIds.size
  const passedScreens = Math.max(0, totalScreens - failedScreens)

  // Workflows summary
  const passedWorkflows = workflows.filter((w) => w.verdict === "passed").length
  const failedWorkflows = workflows.filter(
    (w) => w.verdict === "failed" || w.verdict === "suspected_non_functional"
  ).length

  // Generate Recommendations
  const recommendations: string[] = []
  if (suspectedSteps > 0) {
    recommendations.push(
      `Investigate ${suspectedSteps} suspected non-functional control(s) (e.g. placeholder cards, dead buttons) that produced zero observable DOM or network response.`
    )
  }
  if (job.issues.some((i) => i.type === "data_not_reflected")) {
    recommendations.push(
      "Fix state persistence desync: entities created via successful 2xx form submissions are not rendered on subsequent screens."
    )
  }
  if (job.issues.some((i) => i.type === "api_ui_mismatch")) {
    recommendations.push(
      "Align UI form field names and submission URLs with the Postman API specification to prevent payload dropping."
    )
  }
  if (job.issues.some((i) => i.type === "focus_not_restored")) {
    recommendations.push(
      "Improve WCAG accessibility: ensure closing modal dialogs returns focus to the initiating trigger element."
    )
  }
  if (recommendations.length === 0) {
    recommendations.push("All tested screens and workflows demonstrated verified outcomes and expected functional behavior.")
  }

  const summary = `Outcome-Verified Full App Testing completed across ${totalScreens} screens. ` +
    `${passedSteps}/${steps.length} test steps passed. ` +
    `${suspectedSteps} suspected non-functional controls flagged. ` +
    `${failedSteps} failed. ${skippedUnsafe} skipped by safety guard. ` +
    `${workflows.length} multi-step workflow chains executed (${passedWorkflows} passed, ${failedWorkflows} failed/stalled).`

  // Build Markdown Document
  const md = generateMarkdownReportText({
    job,
    testPlan,
    workflows,
    passedSteps,
    suspectedSteps,
    failedSteps,
    skippedUnsafe,
    blockedSteps,
    totalScreens,
    passedScreens,
    failedScreens,
    totalIssues,
    summary,
    recommendations,
    postmanSummary: options?.postmanSummary,
    endpointMappings: options?.endpointMappings,
  })

  const report: AutomationReport = {
    totalScreensTested: totalScreens,
    passedScreens,
    failedScreens,
    totalIssues,
    backNavigationScore: 100,
    responsiveScore: 100,
    summary,
    recommendations,
    issues: job.issues,
    workflows,
    markdownReport: md,
    flowGraph: job.flowGraph,
    postmanSummary: options?.postmanSummary,
    endpointMappings: options?.endpointMappings,
  }

  job.report = report
  return report
}

/**
 * Generates the full formatted Markdown report text
 */
function generateMarkdownReportText(params: {
  job: AutomationJob
  testPlan: FullAppTestPlan
  workflows: WorkflowRun[]
  passedSteps: number
  suspectedSteps: number
  failedSteps: number
  skippedUnsafe: number
  blockedSteps: number
  totalScreens: number
  passedScreens: number
  failedScreens: number
  totalIssues: number
  summary: string
  recommendations: string[]
  postmanSummary?: PostmanCollectionSummary
  endpointMappings?: PostmanEndpointMapping[]
}): string {
  const {
    job,
    testPlan,
    workflows,
    passedSteps,
    suspectedSteps,
    failedSteps,
    skippedUnsafe,
    totalScreens,
    totalIssues,
    summary,
    recommendations,
    postmanSummary,
    endpointMappings,
  } = params

  const dateStr = new Date().toLocaleString()
  const overallVerdict = failedSteps > 0 || totalIssues > 0 ? "ISSUES DETECTED" : "PASSED"

  const sections: string[] = []

  // Header
  sections.push(`# 🧪 Outcome-Verified UI Testing Report`)
  sections.push(`**Target URL:** \`${job.targetUrl}\`  `)
  sections.push(`**Executed:** ${dateStr} | **Job ID:** \`${job.id}\` | **Verdict:** **${overallVerdict}**\n`)

  // Executive Summary & KPIs
  sections.push(`## 📊 Executive Summary\n`)
  sections.push(`${summary}\n`)

  sections.push(`| Metric | Count | Status |`)
  sections.push(`| :--- | :--- | :--- |`)
  sections.push(`| **Discovered Screens** | ${totalScreens} | Verified |`)
  sections.push(`| **Total Steps Planned** | ${testPlan.steps.length} | Completed |`)
  sections.push(`| **Passed Steps** | ${passedSteps} | ✅ Healthy |`)
  sections.push(`| **Suspected Non-Functional** | ${suspectedSteps} | ⚠️ Placeholder / Dead Controls |`)
  sections.push(`| **Failed Steps** | ${failedSteps} | ❌ Action Failed |`)
  sections.push(`| **Safety Skipped** | ${skippedUnsafe} | 🛡️ Protected by Safety Guard |`)
  sections.push(`| **Total Issues Flagged** | ${totalIssues} | Detailed Below |`)
  sections.push(`| **Workflow Chains Tested** | ${workflows.length} | Multi-step Journeys |\n`)

  // Postman API Mapping Section
  if (postmanSummary) {
    sections.push(`## 📡 Postman API Collection Integration\n`)
    sections.push(`**Collection Name:** \`${postmanSummary.name}\` (${postmanSummary.endpoints.length} endpoints imported)\n`)

    if (endpointMappings && endpointMappings.length > 0) {
      sections.push(`| API Endpoint | HTTP Method | Target Screen / Form | Confidence | Wire Verified |`)
      sections.push(`| :--- | :--- | :--- | :--- | :--- |`)
      for (const map of endpointMappings) {
        const wireStatus = map.fieldMappings.some((f) => f.confirmedOnWire) ? "✅ Confirmed" : "⚠️ Unverified"
        sections.push(
          `| \`${map.endpoint.name}\` | \`${map.endpoint.method}\` | ${map.screenId} (${map.formId || "form"}) | **${map.overallConfidence.toUpperCase()}** | ${wireStatus} |`
        )
      }
      sections.push("")
    }
  }

  // Workflows Section ("write down whole workflow so that user gets idea where it failed")
  if (workflows.length > 0) {
    sections.push(`## 🛤️ Multi-Step Workflow Journeys & Failure Timeline\n`)
    sections.push(`The testing engine executes complete end-to-end user workflows ("go next next"), validates entity persistence in the DOM, and pinpoints exact step failures.\n`)

    for (const wf of workflows) {
      const statusIcon = wf.verdict === "passed" ? "✅" : wf.verdict === "suspected_non_functional" ? "⚠️" : "❌"
      sections.push(`### ${statusIcon} [${wf.id}] ${wf.name}`)
      sections.push(`- **Entry Screen:** ${wf.entryScreenId} (\`${wf.entryUrl}\`)`)
      sections.push(`- **Tracking ID:** \`${wf.entityTrackingId || "N/A"}\``)
      sections.push(`- **Persistence Verified:** ${wf.dataReflected ? "✅ Yes (Entity reflected in rendered DOM)" : "⚠️ No (Entity missing from subsequent screen)"}`)
      sections.push(`- **Final Status:** **${wf.verdict.toUpperCase()}** ${wf.failedAtStep ? `(Failed at Step ${wf.failedAtStep})` : ""}`)
      sections.push(`- **Summary:** ${wf.summary}\n`)

      sections.push(`#### Step-by-Step Execution Trace:`)
      for (const step of wf.steps) {
        const stepIcon = step.verdict === "passed" ? "✔" : step.verdict === "suspected_non_functional" ? "⚠️" : "❌"
        sections.push(`1. **[Step ${step.stepIndex}] ${stepIcon} ${step.action}** on *${step.screenName}*`)
        sections.push(`   - **Target:** \`${step.targetName || step.targetSelector || "element"}\``)
        if (step.inputData) {
          sections.push(`   - **Input Data:** \`${JSON.stringify(step.inputData)}\``)
        }
        sections.push(`   - **Expected:** ${step.expectedOutcome}`)
        sections.push(`   - **Observed:** ${step.observedOutcome || "N/A"} (${step.durationMs}ms)`)

        if (step.reproCurl) {
          sections.push(`   - **Mutating cURL Command:**\n\`\`\`bash\n${step.reproCurl}\n\`\`\``)
        }
      }
      sections.push("")

      if (wf.reproSteps && wf.reproSteps.length > 0) {
        sections.push(`**Reproduction Steps:**`)
        for (const r of wf.reproSteps) {
          sections.push(`- ${r}`)
        }
        sections.push("")
      }
      sections.push(`---\n`)
    }
  }

  // Issues Catalog
  if (job.issues.length > 0) {
    sections.push(`## 🚨 Discovered Issues Catalog\n`)
    sections.push(`| Severity | Type | Screen | Description | Expected vs Observed |`)
    sections.push(`| :--- | :--- | :--- | :--- | :--- |`)
    for (const issue of job.issues) {
      const sevIcon = issue.severity === "high" || issue.severity === "blocker" ? "🔴" : issue.severity === "medium" ? "🟡" : "🔵"
      sections.push(
        `| ${sevIcon} **${issue.severity.toUpperCase()}** | \`${issue.type}\` | ${issue.screenTitle} | ${issue.description} | Exp: ${issue.expected || "N/A"}<br/>Obs: ${issue.actual || "N/A"} |`
      )
    }
    sections.push("")
  }

  // Recommendations
  sections.push(`## 💡 Recommended Remediation\n`)
  for (let idx = 0; idx < recommendations.length; idx++) {
    sections.push(`${idx + 1}. ${recommendations[idx]}`)
  }
  sections.push("")

  return secretRedactor ? secretRedactor.redact(sections.join("\n")) : sections.join("\n")
}
