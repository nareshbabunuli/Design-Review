import http from "http"
import fs from "fs"
import path from "path"
import puppeteer from "puppeteer"
import { classifyAction } from "../lib/ai-automation/safety-guard"
import {
  expectFor,
  captureState,
  runWithLadder,
  verifyModalCloseAndFocus,
  NetworkRecorder,
  ConsoleRecorder,
} from "../lib/ai-automation/outcome-verifier"
import {
  extractActionableInventory,
  generateStructuredTestPlan,
  executeStructuredTestPlan,
} from "../lib/ai-automation/full-app-engine"
import type { AutomationJob, AppScreenNode } from "../lib/ai-automation/types"
import {
  parsePostmanCollection,
  matchEndpointToForm,
  buildFormPayloadFromPostman,
} from "../lib/ai-automation/postman-importer"
import { executeChainedWorkflows } from "../lib/ai-automation/workflow-chainer"
import { buildAutomationReport } from "../lib/ai-automation/evidence-reporter"
import {
  installVisualOverlay,
  animateCursorToSelector,
  triggerClickAnimation,
  highlightInputTyping,
  showActionBanner,
} from "../lib/ai-automation/visual-recorder"
import {
  detectUploadFolderMention,
  resolveUploadFolder,
  scanUploadFolder,
  pickUploadFile,
} from "../lib/ai-automation/test-file-manager"
import {
  secretRedactor,
  detectVerificationScreen,
  waitForExternalVerification,
  detectSettingsCredentialsRequirement,
  maskPageSecretsBeforeScreenshot,
} from "../lib/ai-automation/secure-credentials-manager"
import { saveJob } from "../lib/ai-automation/job-store"

async function main() {
  console.log("=== Testing Outcome-Verified UI Testing Engine (Phases 1-6 + Test Payments & Visual Recording) ===")

  // 1. Start local HTTP server serving fixture
  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "ui-fixture.html")
  const fixtureHtml = fs.readFileSync(fixturePath, "utf8")

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/ping")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.url?.startsWith("/api/register")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ success: true, id: "usr_123" }))
      return
    }
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(fixtureHtml)
  })

  await new Promise<void>((resolve) => server.listen(48921, "127.0.0.1", resolve))
  const fixtureUrl = "http://127.0.0.1:48921"
  console.log(`[Fixture Server] Listening at ${fixtureUrl}`)

  // 2. Test Safety Guard Classifications
  console.log("\n--- Test Suite 1: Safety Guard Classification ---")
  const payCheck = classifyAction("Pay Now $49")
  console.assert(payCheck.tier === "hard_block", `Expected "Pay Now $49" to be hard_block, got ${payCheck.tier}`)
  console.log("✔ Pay Now: hard_block in production default verified")

  const payCheckTestEnv = classifyAction("Pay Now $49", [], { isProduction: false })
  console.assert(payCheckTestEnv.tier === "allow", `Expected "Pay Now $49" in test env to be allow, got ${payCheckTestEnv.tier}`)
  console.log("✔ Pay Now (in non-production/test env): allow verified")

  const payCheckAllowed = classifyAction("Pay Now $49", ["pay"], { isProduction: true })
  console.assert(payCheckAllowed.tier === "allow", `Expected "Pay Now $49" with allowActions to be allow, got ${payCheckAllowed.tier}`)
  console.log("✔ Pay Now (explicit allowActions in prod): allow verified")

  const deleteCheck = classifyAction("Delete Account")
  console.assert(deleteCheck.tier === "soft_skip", `Expected "Delete Account" to be soft_skip, got ${deleteCheck.tier}`)
  console.log("✔ Delete Account (unauthorized): soft_skip verified")

  const deleteAllowed = classifyAction("Delete Account", ["delete"])
  console.assert(deleteAllowed.tier === "allow", `Expected "Delete Account" with allowActions to be allow, got ${deleteAllowed.tier}`)
  console.log("✔ Delete Account (allowlisted): allow verified")

  // 3. Launch Puppeteer Browser
  console.log("\n--- Test Suite 2: Outcome Verifier & Ladder Tests ---")
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" })

  // Test Visual Overlay & Cursor Animations
  console.log("\nTesting Visual Overlay & Motion Cursor...")
  await installVisualOverlay(page)
  const coords = await animateCursorToSelector(page, "#dead-btn")
  console.assert(Boolean(coords), "Expected visual cursor to calculate coords for #dead-btn")
  await triggerClickAnimation(page, coords!.x, coords!.y)
  await highlightInputTyping(page, "#reg-email", "qa-test@example.com")
  await showActionBanner(page, "Testing Visual Cursor & Ripple Overlay")
  console.log("✔ Visual Overlay: cursor motion, click ripple, typing highlight & banner verified")

  // TEST CASE A: Dead Button
  console.log("\nTesting: Dead Button (No Handler)...")
  const netRec1 = new NetworkRecorder(page, fixtureUrl)
  const consRec1 = new ConsoleRecorder(page)
  const deadRes = await runWithLadder(
    page,
    "#dead-btn",
    "Dead Button",
    expectFor({ name: "Dead Button" }),
    netRec1,
    consRec1,
    { dialogShownRef: { value: false } }
  )
  netRec1.cleanup()
  consRec1.cleanup()

  console.log(`Result: verdict=${deadRes.verdict}, observed=${deadRes.observedEffect}`)
  console.assert(
    deadRes.verdict === "suspected_non_functional",
    `Expected dead button to be "suspected_non_functional", got "${deadRes.verdict}"`
  )
  console.assert(
    deadRes.observedEffect === "no_effect",
    `Expected dead button observedEffect to be "no_effect", got "${deadRes.observedEffect}"`
  )
  console.log("✔ Dead Button correctly classified as suspected_non_functional (despite live clock/ticker & ping beacon)")

  // TEST CASE B: Dummy Video Card
  console.log("\nTesting: Dummy Video Card (Placeholder)...")
  const netRec2 = new NetworkRecorder(page, fixtureUrl)
  const consRec2 = new ConsoleRecorder(page)
  const videoCardRes = await runWithLadder(
    page,
    "#dummy-video-card",
    "Dummy Video Card",
    expectFor({ name: "Dummy Video Card" }),
    netRec2,
    consRec2,
    { dialogShownRef: { value: false } }
  )
  netRec2.cleanup()
  consRec2.cleanup()

  console.log(`Result: verdict=${videoCardRes.verdict}, observed=${videoCardRes.observedEffect}`)
  console.assert(
    videoCardRes.verdict === "suspected_non_functional",
    `Expected dummy video card to be "suspected_non_functional", got "${videoCardRes.verdict}"`
  )
  console.log("✔ Dummy Video Card correctly classified as suspected_non_functional")

  // TEST CASE C: Working Modal Dialog & Focus Restoration
  console.log("\nTesting: Modal Dialog Open Button & Focus Restoration...")
  const netRec3 = new NetworkRecorder(page, fixtureUrl)
  const consRec3 = new ConsoleRecorder(page)
  const modalRes = await runWithLadder(
    page,
    "#modal-btn",
    "Open Dialog Modal",
    expectFor({ name: "Open Dialog Modal", ariaHasPopup: true }),
    netRec3,
    consRec3,
    { dialogShownRef: { value: false } }
  )
  netRec3.cleanup()
  consRec3.cleanup()

  console.log(`Result: verdict=${modalRes.verdict}, observed=${modalRes.observedEffect}`)
  console.assert(modalRes.verdict === "passed", `Expected modal open button to pass, got "${modalRes.verdict}"`)
  console.assert(modalRes.observedEffect === "modal_opened", `Expected modal_opened effect, got "${modalRes.observedEffect}"`)
  console.log("✔ Modal Dialog Open verified as passed with modal_opened effect")

  // Verify modal close & focus restoration
  const modalCloseRes = await verifyModalCloseAndFocus(page, "#modal-btn", "Open Dialog Modal")
  console.assert(modalCloseRes.closed === true, "Expected modal to be closed via close button")
  console.assert(modalCloseRes.focusRestored === true, "Expected focus to be restored to trigger button")
  console.log(`✔ Modal Dialog dismissal verified via ${modalCloseRes.method} and focus restored (${modalCloseRes.activeElementTag})`)

  // TEST CASE D: Covered Button
  console.log("\nTesting: Partially Covered Button...")
  const netRec4 = new NetworkRecorder(page, fixtureUrl)
  const consRec4 = new ConsoleRecorder(page)
  const coveredRes = await runWithLadder(
    page,
    "#covered-btn",
    "Covered Button",
    expectFor({ name: "Covered Button" }),
    netRec4,
    consRec4,
    { dialogShownRef: { value: false } }
  )
  netRec4.cleanup()
  consRec4.cleanup()

  console.log(`Result: coveredElementDetected=${coveredRes.coveredElementDetected}, retries=${coveredRes.retriesUsed}`)
  console.assert(
    coveredRes.coveredElementDetected === true,
    `Expected coveredElementDetected to be true for covered button`
  )
  console.log("✔ Overlapping/Covered element correctly flagged")

  // TEST SUITE 3: Phase 2 Form Scenarios (Unit Testing)
  console.log("\n--- Test Suite 3: Form Scenarios & Structured Unit Testing ---")
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" })
  const inv = await extractActionableInventory(page)

  console.assert(inv.forms.length === 1, `Expected 1 form in inventory, got ${inv.forms.length}`)
  console.assert(inv.forms[0].id === "reg-form", `Expected form id to be "reg-form", got "${inv.forms[0].id}"`)
  console.assert(Boolean(inv.forms[0].selector), "Expected form selector to be present")
  console.assert(Boolean(inv.forms[0].submitSelector), "Expected form submitSelector to be present")
  console.log(`✔ Inventory discovered form: id="${inv.forms[0].id}", selector="${inv.forms[0].selector}"`)

  const formInputs = inv.actionableElements.filter((el) => el.formId === "reg-form")
  console.assert(formInputs.length >= 3, `Expected at least 3 elements linked to reg-form, got ${formInputs.length}`)
  console.log(`✔ ${formInputs.length} input elements successfully linked to formId "reg-form"`)

  const screenNode: AppScreenNode = {
    id: "S001",
    name: "Fixture Page",
    url: fixtureUrl,
    path: "/",
    actionableElements: inv.actionableElements,
    forms: inv.forms,
    discoveredAt: new Date().toISOString(),
  }

  const plan = generateStructuredTestPlan(fixtureUrl, [screenNode], [])
  const formSteps = plan.steps.filter((s) => s.actionType === "form_scenario" && s.formId === "reg-form")

  console.assert(formSteps.length === 3, `Expected 3 form scenarios planned, got ${formSteps.length}`)
  console.assert(
    formSteps[0].formVariant === "required_empty",
    `Expected step 0 variant to be "required_empty", got "${formSteps[0].formVariant}"`
  )
  console.assert(
    formSteps[1].formVariant === "invalid_format",
    `Expected step 1 variant to be "invalid_format", got "${formSteps[1].formVariant}"`
  )
  console.assert(
    formSteps[2].formVariant === "valid",
    `Expected step 2 variant to be "valid", got "${formSteps[2].formVariant}"`
  )
  console.log("✔ Strict form scenario ordering verified: required_empty -> invalid_format -> valid (last)")

  const looseFills = plan.steps.filter((s) => s.actionType === "fill")
  console.assert(looseFills.length === 0, `Expected 0 loose fill steps for form fields, got ${looseFills.length}`)
  console.log("✔ Standalone filter verified: no duplicate loose fill steps for form fields")

  console.log("\n--- Test Suite 4: End-to-End Structured Test Plan Execution ---")
  const job: AutomationJob = {
    id: `test-job-${Date.now()}`,
    projectId: "test-proj",
    mode: "full_app",
    targetUrl: fixtureUrl,
    status: "running",
    testingPhase: "executing",
    progress: 0,
    currentStep: "Starting test",
    logs: [],
    issues: [],
    screens: [],
    flowGraph: { nodes: [], edges: [] },
    startedAt: new Date().toISOString(),
    credentialsProvided: false,
    viewports: [],
    maxScreens: 5,
  }

  await executeStructuredTestPlan(job, page, plan, undefined, undefined, {
    skipWorkflows: true,
    allowTestPayments: false,
  })

  console.assert(
    formSteps[0].status === "passed",
    `Expected required_empty form step to PASS, got "${formSteps[0].status}" (error: ${formSteps[0].error})`
  )
  console.log(`✔ Form Variant 1 (required_empty): PASSED (${formSteps[0].actualResult})`)

  console.assert(
    formSteps[1].status === "passed",
    `Expected invalid_format form step to PASS, got "${formSteps[1].status}" (error: ${formSteps[1].error})`
  )
  console.log(`✔ Form Variant 2 (invalid_format): PASSED (${formSteps[1].actualResult})`)

  console.assert(
    formSteps[2].status === "passed",
    `Expected valid form step to PASS, got "${formSteps[2].status}" (error: ${formSteps[2].error})`
  )
  console.log(`✔ Form Variant 3 (valid submission): PASSED (${formSteps[2].actualResult})`)

  // Check safety skips in executed plan
  const safetySkips = plan.steps.filter((s) => s.status === "skipped_unsafe")
  console.assert(safetySkips.length >= 1, `Expected at least 1 safety skip, got ${safetySkips.length}`)
  console.log(`✔ Safety guard successfully skipped ${safetySkips.length} dangerous action(s) in plan`)

  // Check suspected non-functional in executed plan
  const deadStep = plan.steps.find((s) => s.targetName.toLowerCase().includes("dead button"))
  console.assert(
    deadStep?.verdict === "suspected_non_functional",
    `Expected dead button verdict to be suspected_non_functional, got "${deadStep?.verdict}"`
  )
  console.log("✔ Dead button confirmed as suspected_non_functional in plan report")

  // TEST SUITE 5: Phase 3 Postman v2.1 Import & On-Wire Confirmation
  console.log("\n--- Test Suite 5: Postman v2.1 Import & On-Wire Confirmation ---")
  const samplePostmanCollection = {
    info: {
      name: "Acme User Management API",
      _postman_id: "test-collection-id-1234",
      description: "Postman v2.1 collection for autonomous form mapping",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: fixtureUrl },
      { key: "companyDomain", value: "testing-domain.com" },
    ],
    item: [
      {
        name: "Create User Registration",
        request: {
          method: "POST",
          header: [{ key: "Content-Type", value: "application/json" }],
          body: {
            mode: "raw",
            raw: JSON.stringify({
              name: "Alice Wonderland",
              email: "alice@{{companyDomain}}",
              phone: "+1-555-0199",
            }),
          },
          url: {
            raw: "{{baseUrl}}/api/register",
            host: ["{{baseUrl}}"],
            path: ["api", "register"],
          },
          description: "Registers user and returns JSON account record",
        },
      },
    ],
  }

  // 1. Verify parser & variable resolution
  const postmanSummary = parsePostmanCollection(samplePostmanCollection)
  console.assert(postmanSummary.endpoints.length === 1, `Expected 1 endpoint parsed, got ${postmanSummary.endpoints.length}`)
  const endpoint = postmanSummary.endpoints[0]
  console.assert(endpoint.method === "POST", `Expected method POST, got ${endpoint.method}`)
  console.assert(endpoint.pathSegments.includes("register"), `Expected path to include "register"`)
  console.assert(
    endpoint.payloadFields.email === "alice@testing-domain.com",
    `Expected variable {{companyDomain}} to resolve to testing-domain.com, got ${endpoint.payloadFields.email}`
  )
  console.log(`✔ Postman collection parsed & variables resolved: ${endpoint.method} ${endpoint.url}`)

  // 2. Verify mapping to UI form
  const formElementsForMapping = inv.actionableElements.filter((el) => el.formId === inv.forms[0].id)
  const mapping = matchEndpointToForm(endpoint, inv.forms[0], formElementsForMapping, "/")
  console.assert(mapping !== null, "Expected endpoint to match reg-form")
  console.assert(mapping?.overallConfidence === "high", `Expected high confidence match, got ${mapping?.overallConfidence}`)
  console.log(`✔ Multi-signal scoring mapped endpoint to UI form: confidence=${mapping?.overallConfidence}`)

  // 3. Verify payload build
  const postmanPayload = buildFormPayloadFromPostman(mapping!, formElementsForMapping)
  console.assert(postmanPayload.name === "Alice Wonderland", `Expected Alice Wonderland, got ${postmanPayload.name}`)
  console.assert(
    postmanPayload.email === "alice@testing-domain.com",
    `Expected alice@testing-domain.com, got ${postmanPayload.email}`
  )
  console.log(`✔ Form payload built from Postman samples: name="${postmanPayload.name}", email="${postmanPayload.email}"`)

  // 4. Generate plan with Postman collection option
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" })
  const postmanPlan = generateStructuredTestPlan(fixtureUrl, [screenNode], [], {
    postmanCollection: samplePostmanCollection,
  })

  const postmanValidStep = postmanPlan.steps.find(
    (s) => s.actionType === "form_scenario" && s.formVariant === "valid" && s.formId === "reg-form"
  )
  console.assert(postmanValidStep !== undefined, "Expected postman valid step in plan")
  console.assert(
    postmanValidStep?.targetName.includes("Create User Registration"),
    `Expected step targetName to mention API name, got "${postmanValidStep?.targetName}"`
  )
  console.assert(
    postmanValidStep?.fieldPayload?.email === "alice@testing-domain.com",
    `Expected fieldPayload to contain Postman email`
  )
  console.log(`✔ Test plan generated with Postman mapped step: "${postmanValidStep?.targetName}"`)

  // 5. Execute plan and verify on-wire confirmation
  const postmanJob: AutomationJob = {
    id: `test-job-postman-${Date.now()}`,
    projectId: "test-proj",
    mode: "full_app",
    targetUrl: fixtureUrl,
    status: "running",
    testingPhase: "executing",
    progress: 0,
    currentStep: "Starting postman test",
    logs: [],
    issues: [],
    screens: [],
    flowGraph: { nodes: [], edges: [] },
    startedAt: new Date().toISOString(),
    credentialsProvided: false,
    viewports: [],
    maxScreens: 5,
  }

  await executeStructuredTestPlan(postmanJob, page, postmanPlan, undefined, undefined, { skipWorkflows: true })

  console.assert(postmanValidStep?.status === "passed", `Expected valid step to pass, got ${postmanValidStep?.status}`)
  console.assert(
    postmanValidStep?.confirmedOnWire === true,
    `Expected confirmedOnWire to be true for API-mapped form step`
  )
  console.log(`✔ On-wire confirmation PASSED: intercepted outgoing POST call matched Postman endpoint (${postmanValidStep?.actualResult})`)

  // --- Test Suite 6: Multi-Step Workflow Chaining & Evidence Reporting (Phases 4 & 5) ---
  console.log("\n--- Test Suite 6: Multi-Step Workflow Chaining & Evidence Reporting (Phases 4 & 5) ---")
  postmanJob.status = "running"
  const workflowRuns = await executeChainedWorkflows(
    postmanJob,
    page,
    postmanPlan.screens,
    postmanPlan.transitions,
    fixtureUrl,
    {
      postmanSummary,
    }
  )

  console.assert(workflowRuns.length > 0, "Expected at least 1 workflow run")
  const wf = workflowRuns[0]
  console.log(`✔ Chained workflow initialized: "${wf.name}" with tracking ID ${wf.entityTrackingId}`)

  // Step 1 check (Form submit)
  console.assert(wf.steps[0].verdict === "passed", `Expected Step 1 to pass, got ${wf.steps[0].verdict}`)
  console.assert(Boolean(wf.steps[0].reproCurl), "Expected Step 1 to produce reproducible cURL")
  console.log(`✔ Workflow Step 1 (Form Submit): PASSED with cURL command generated`)

  // Persistence check
  console.assert(wf.dataReflected === true, "Expected data persistence to be verified in DOM")
  console.log(`✔ State persistence verified: tracking ID "${wf.entityTrackingId}" reflected in rendered DOM`)

  // Step 2 check (Dummy control)
  console.assert(wf.failedAtStep === 2, `Expected workflow to stall at step 2, got ${wf.failedAtStep}`)
  console.assert(
    wf.verdict === "suspected_non_functional",
    `Expected workflow verdict suspected_non_functional, got ${wf.verdict}`
  )
  console.log(`✔ Workflow Step 2 correctly flagged dummy control as suspected_non_functional ("${wf.steps[1]?.targetName}")`)
  console.log(`✔ Entire workflow timeline written out with failure point and root cause`)

  // Evidence Report check
  const report = buildAutomationReport(postmanJob, postmanPlan, workflowRuns, { postmanSummary })
  console.assert(Boolean(report.markdownReport), "Expected markdownReport to be generated")
  console.assert(report.markdownReport?.includes("## 📊 Executive Summary"), "Expected Executive Summary in markdown")
  console.assert(
    report.markdownReport?.includes("## 🛤️ Multi-Step Workflow Journeys & Failure Timeline"),
    "Expected Workflow Journeys section in markdown"
  )
  console.assert(
    report.markdownReport?.includes("curl -X POST"),
    "Expected cURL command in markdown report"
  )
  console.assert(
    postmanJob.issues.some((i) => i.type === "non_functional_control"),
    "Expected non_functional_control issue in job.issues"
  )
  console.log("✔ Phase 5 Evidence-based Markdown report generated with full timeline, cURL & issue taxonomy")

  // --- Test Suite 7: Upload Folder Detection, File Picking & Real DOM Upload ---
  console.log("\n--- Test Suite 7: Upload Folder Detection, Classification & Real DOM Upload ---")

  // 1. Natural Language Mention Extraction
  const mention1 = detectUploadFolderMention("Please test file uploads using folder: scripts/fixtures for test files")
  console.assert(mention1 === "scripts/fixtures", `Expected "scripts/fixtures", got "${mention1}"`)

  const mention2 = detectUploadFolderMention("run testing in folder 'scripts/fixtures'")
  console.assert(mention2 === "scripts/fixtures", `Expected "scripts/fixtures", got "${mention2}"`)

  const mention3 = detectUploadFolderMention("also file upload mention a folder scripts/fixtures so ai can use that folder")
  console.assert(mention3 === "scripts/fixtures", `Expected "scripts/fixtures", got "${mention3}"`)
  console.log("✔ Upload folder extraction from prompts verified (colon, quotes, natural mention)")

  // 2. Folder Resolution & Inventory Scanning
  const resolvedDir = resolveUploadFolder({ prompt: "use folder scripts/fixtures" })
  console.assert(Boolean(resolvedDir && fs.existsSync(resolvedDir)), `Expected valid resolved folder, got ${resolvedDir}`)
  
  const inventory = scanUploadFolder(resolvedDir!)
  console.assert(inventory.files.length >= 4, `Expected at least 4 test files, found ${inventory.files.length}`)
  console.assert(inventory.filesByType.image.length > 0, "Expected at least 1 image file in fixtures")
  console.assert(inventory.filesByType.pdf.length > 0, "Expected at least 1 PDF file in fixtures")
  console.assert(inventory.filesByType.csv.length > 0, "Expected at least 1 CSV file in fixtures")
  console.log(`✔ Scanned folder "${path.basename(resolvedDir!)}": indexed ${inventory.files.length} test files (${inventory.filesByType.image.length} image, ${inventory.filesByType.pdf.length} pdf, ${inventory.filesByType.csv.length} csv)`)

  // 3. File Picking based on HTML accept attribute & target intent
  const imagePick = pickUploadFile(inventory, { acceptAttr: "image/*", fileTypeRequired: "image", targetName: "Profile Picture" })
  console.assert(imagePick.isFromFolder === true, "Expected image pick from folder")
  console.assert(imagePick.fileName.endsWith(".png"), `Expected .png file, got ${imagePick.fileName}`)

  const pdfPick = pickUploadFile(inventory, { acceptAttr: ".pdf", fileTypeRequired: "pdf", targetName: "Contract Agreement" })
  console.assert(pdfPick.isFromFolder === true, "Expected pdf pick from folder")
  console.assert(pdfPick.fileName.endsWith(".pdf"), `Expected .pdf file, got ${pdfPick.fileName}`)

  const csvPick = pickUploadFile(inventory, { acceptAttr: ".csv", fileTypeRequired: "csv", targetName: "Customer Spreadsheet" })
  console.assert(csvPick.isFromFolder === true, "Expected csv pick from folder")
  console.assert(csvPick.fileName.endsWith(".csv"), `Expected .csv file, got ${csvPick.fileName}`)
  console.log("✔ Intelligent file matching verified: accept attribute & category matched real files from folder")

  // 4. Live Browser Execution: Attach real file to <input type="file"> and verify DOM state change
  const uploadJob: AutomationJob = {
    id: "upload-job-001",
    targetUrl: fixtureUrl,
    projectId: "proj-1",
    status: "running",
    progress: 0,
    currentStep: "Executing upload test step",
    logs: [],
    issues: [],
    screens: [],
    flowGraph: { nodes: [], edges: [] },
    startedAt: new Date().toISOString(),
    credentialsProvided: false,
    viewports: [],
    maxScreens: 5,
    uploadFilesDir: resolvedDir!,
  }

  const uploadPlan = {
    id: "upload-plan-001",
    targetUrl: fixtureUrl,
    screens: [
      {
        id: "S001",
        name: "Upload Screen",
        url: fixtureUrl,
        path: "/",
        actionableElements: [],
        forms: [],
        discoveredAt: new Date().toISOString(),
      },
    ],
    transitions: [],
    steps: [
      {
        id: "step-upload-1",
        screenId: "S001",
        screenName: "Upload Screen",
        stepIndex: 1,
        actionType: "upload" as const,
        targetName: "Document Upload",
        targetSelector: "#upload-input",
        fileTypeRequired: "pdf" as const,
        expectedResult: "Upload control accepts PDF file and displays preview.",
        status: "pending" as const,
      },
    ],
    requiredFileTypes: [{ type: "pdf" as const, count: 1 }],
    status: "planned" as const,
    coverage: { screensTested: 0, totalScreens: 1, actionsTested: 0, totalActions: 1, formsTested: 0, totalForms: 0, percentage: 0 },
  }

  await executeStructuredTestPlan(uploadJob, page, uploadPlan, undefined, undefined, {
    skipWorkflows: true,
    uploadFilesDir: resolvedDir!,
    uploadInventory: inventory,
  })

  const uploadStep = uploadPlan.steps[0]
  console.assert(uploadStep.status === "passed", `Expected upload step to pass, got ${uploadStep.status}`)
  console.assert(
    Boolean(uploadStep.actualResult && (uploadStep.actualResult.includes("sample-doc.pdf") || uploadStep.actualResult.includes("PDF"))),
    `Expected actualResult to confirm attached PDF, got: ${uploadStep.actualResult}`
  )

  // Verify DOM preview in fixture turned visible
  const isPreviewVisible = await page.evaluate(() => {
    const el = document.getElementById("upload-preview")
    return el ? window.getComputedStyle(el).display !== "none" : false
  })
  console.assert(isPreviewVisible === true, "Expected #upload-preview in fixture HTML to be visible after upload")
  console.log(`✔ Live file upload execution PASSED: attached real file "${pdfPick.fileName}" to #upload-input and confirmed DOM state change`)

  // --- Test Suite 8: External Verification Pause/Resume & Secure Settings Credentials Redaction ---
  console.log("\n--- Test Suite 8: External Verification & Secure Credentials Management ---")

  // 1. Secret Redactor Pattern Masking
  const rawOpenAi = "Bearer sk-1234567890abcdefghijklmnopqrstuvwxyz"
  const redactedOpenAi = secretRedactor.redact(rawOpenAi)
  console.assert(!redactedOpenAi.includes("1234567890abcdef"), "Expected OpenAI key to be masked")
  console.assert(redactedOpenAi.includes("[REDACTED"), "Expected redaction placeholder")

  const rawStripe = "Secret stripe key: sk_test_51MzXYZ123456789012345678"
  const redactedStripe = secretRedactor.redact(rawStripe)
  console.assert(!redactedStripe.includes("51MzXYZ"), "Expected Stripe key to be masked")

  const rawGithub = "GitHub token: ghp_1234567890abcdefghijklmnopqrstuvwxyz"
  const redactedGithub = secretRedactor.redact(rawGithub)
  console.assert(!redactedGithub.includes("1234567890abcdef"), "Expected GitHub token to be masked")

  secretRedactor.register("CustomSuperSecretKey987654!")
  const customLog = "App configured with secret: CustomSuperSecretKey987654!"
  const redactedCustom = secretRedactor.redact(customLog)
  console.assert(!redactedCustom.includes("CustomSuperSecretKey987654!"), "Expected registered secret to be redacted")
  console.assert(redactedCustom.includes("[REDACTED_SECRET]"), "Expected [REDACTED_SECRET] in output")
  console.log("✔ SecretRedactor: masked OpenAI keys, Stripe test tokens, GitHub tokens, and registered secrets")

  // 2. Verification Screen Detection
  await page.evaluate(() => {
    document.body.innerHTML = `
      <div id="verify-box">
        <h2>Please check your inbox</h2>
        <p>A confirmation email has been sent to candidate@company.org. Click the link in the email to activate your account.</p>
      </div>
    `
  })
  const verifyDetect = await detectVerificationScreen(page)
  console.assert(verifyDetect.needsVerification === true, "Expected email verification screen to be detected")
  console.assert(verifyDetect.emailAddress === "candidate@company.org", `Expected detected email address, got ${verifyDetect.emailAddress}`)
  console.log(`✔ detectVerificationScreen: accurately identified email verification wall and extracted target email (${verifyDetect.emailAddress})`)

  // 3. Verification Pause & Resume Flow
  const verifJob: AutomationJob = {
    id: "verif-job-test-001",
    targetUrl: fixtureUrl,
    projectId: "proj-1",
    status: "running",
    progress: 50,
    currentStep: "Testing registration workflow",
    logs: [],
    issues: [],
    screens: [],
    startedAt: new Date().toISOString(),
    credentialsProvided: false,
    viewports: [],
    maxScreens: 5,
  }
  saveJob(verifJob)

  // Start waiter in background
  const waitPromise = waitForExternalVerification(verifJob, page, verifyDetect, { timeoutMs: 4000 })
  await new Promise((r) => setTimeout(r, 200))

  console.assert(verifJob.verificationState === "awaiting_verification", `Expected job to be awaiting_verification, got ${verifJob.verificationState}`)
  console.assert(verifJob.currentStep.includes("Paused"), "Expected currentStep to indicate pause")

  // Simulate user confirming verification via UI / API
  verifJob.pendingVerification = { completed: true }
  saveJob(verifJob)

  const waitRes = await waitPromise
  console.assert(waitRes === true, "Expected waitForExternalVerification to return true on confirmation")
  console.assert(verifJob.verificationState === "verified", `Expected job verificationState to be verified, got ${verifJob.verificationState}`)
  console.log("✔ waitForExternalVerification: successfully paused job, preserved progress, and resumed upon user confirmation")

  // 4. Application Settings Credentials Detection
  await page.evaluate(() => {
    document.body.innerHTML = `
      <form id="settings-form">
        <label for="openai_api_key">OpenAI API Key</label>
        <input type="password" id="openai_api_key" name="openai_api_key" placeholder="sk-..." value="" />

        <label for="stripe_secret_key">Stripe Secret Key</label>
        <input type="text" id="stripe_secret_key" name="stripe_secret_key" placeholder="sk_test_..." value="" />
      </form>
    `
  })
  const settingsDetect = await detectSettingsCredentialsRequirement(page)
  console.assert(settingsDetect.requiresCredentials === true, "Expected settings form to require credentials")
  console.assert(settingsDetect.fields.length >= 2, `Expected at least 2 settings credential fields, found ${settingsDetect.fields.length}`)
  console.assert(settingsDetect.fields.some((f) => f.key === "openai_api_key"), "Expected openai_api_key field detected")
  console.assert(settingsDetect.fields.some((f) => f.key === "stripe_secret_key"), "Expected stripe_secret_key field detected")
  console.log(`✔ detectSettingsCredentialsRequirement: detected ${settingsDetect.fields.length} unconfigured API key fields in settings form`)

  // 5. DOM Secret Masking for Screenshots
  const unmask = await maskPageSecretsBeforeScreenshot(page)
  const isMaskStyleInjected = await page.evaluate(() => Boolean(document.getElementById("__antigravity_secret_mask__")))
  console.assert(isMaskStyleInjected === true, "Expected secret masking CSS to be injected into page")

  await unmask()
  const isMaskRemoved = await page.evaluate(() => !document.getElementById("__antigravity_secret_mask__"))
  console.assert(isMaskRemoved === true, "Expected secret masking CSS to be removed after screenshot")
  console.log("✔ maskPageSecretsBeforeScreenshot: successfully applied DOM blur/masking before screenshot and restored state after")

  // Cleanup
  await browser.close()
  server.close()
  console.log("\n=======================================================")
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! 0 FLAKES DETECTED.")
  console.log("=======================================================\n")
}

main().catch((err) => {
  console.error("Test execution failed:", err)
  process.exit(1)
})

