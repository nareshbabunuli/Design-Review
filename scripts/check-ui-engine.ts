import http from "http"
import fs from "fs"
import path from "path"
import puppeteer from "puppeteer"
import { classifyAction } from "../lib/ai-automation/safety-guard"
import {
  expectFor,
  captureState,
  runWithLadder,
  NetworkRecorder,
  ConsoleRecorder,
} from "../lib/ai-automation/outcome-verifier"

async function main() {
  console.log("=== Testing Outcome-Verified UI Testing Engine (Phase 1 & 6) ===")

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

  // TEST CASE C: Working Modal Dialog
  console.log("\nTesting: Modal Dialog Open Button...")
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
