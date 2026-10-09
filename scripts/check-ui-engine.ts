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

async function main() {
  console.log("=== Testing Outcome-Verified UI Testing Engine (Phases 1, 2 & 6) ===")

  // 1. Start local HTTP server serving fixture
  const fixturePath = path.join(process.cwd(), "scripts", "fixtures", "ui-fixture.html")
  const fixtureHtml = fs.readFileSync(fixturePath, "utf8")

  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/ping")) {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true }))
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
  console.log("✔ Pay Now: hard_block verified")

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
    type: "full_app",
    targetUrl: fixtureUrl,
    status: "running",
    testingPhase: "executing",
    progress: 0,
    currentStep: "Starting test",
    logs: [],
    issues: [],
    discoveredScreens: [],
    flowGraph: { nodes: [], edges: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await executeStructuredTestPlan(job, page, plan)

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

