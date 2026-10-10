import test from "node:test"
import assert from "node:assert/strict"
import { detectInteractionPatterns, generateCandidateTests, type PatternState } from "../lib/ai-automation/interaction-pattern-engine"
import { classifyAction } from "../lib/ai-automation/safety-guard"
import { expectFor } from "../lib/ai-automation/outcome-verifier"

const baseState: PatternState = {
  stateKey: "fixture-home",
  url: "https://app.example.test/",
  origin: "https://app.example.test",
  route: "/",
  title: "Fixture",
  elements: [],
  forms: [],
  tables: [],
  dialogs: [],
}

test("same-origin links are navigation candidates and hostile suffixes are external", () => {
  const state: PatternState = {
    ...baseState,
    elements: [
      { tag: "a", label: "Dashboard", href: "/dashboard", visible: true },
      { tag: "a", label: "Untrusted", href: "https://app.example.test.attacker.invalid/", visible: true },
    ],
  }
  const matches = detectInteractionPatterns(state)
  assert.ok(matches.some((m) => m.pattern === "link_navigation" && m.targets.some((t) => t.label === "Dashboard")))
  assert.ok(matches.some((m) => m.pattern === "external_link" && m.targets.some((t) => t.label === "Untrusted")))
})

test("disabled and hidden controls are not candidates", () => {
  const state: PatternState = {
    ...baseState,
    elements: [
      { tag: "button", label: "Hidden", visible: false, enabled: true },
      { tag: "button", label: "Disabled", visible: true, enabled: false },
    ],
  }
  const matches = detectInteractionPatterns(state)
  assert.equal(matches.some((m) => m.targets.some((t) => ["Hidden", "Disabled"].includes(t.label || ""))), false)
})

test("destructive candidates stay excluded by default", () => {
  const state: PatternState = {
    ...baseState,
    elements: [{ tag: "button", label: "Delete account", visible: true, enabled: true }],
  }
  const candidates = generateCandidateTests(state)
  assert.equal(candidates.some((c) => /delete account/i.test(c.title)), false)
})

test("payment actions are hard-blocked in production by default", () => {
  assert.equal(classifyAction("Pay now", [], { isProduction: true }).tier, "hard_block")
  assert.equal(classifyAction("Checkout", [], { isProduction: true }).tier, "hard_block")
})

test("outbound messaging is skipped unless explicitly allowlisted", () => {
  assert.equal(classifyAction("Send invitation email", [], { isProduction: true }).tier, "soft_skip")
  assert.equal(classifyAction("Send invitation email", ["send"], { isProduction: true }).tier, "allow")
})


test("absolute same-document hash links expect a content change, not navigation", () => {
  assert.deepEqual(expectFor({
    tagName: "a",
    href: "https://app.example.test/#settings",
    currentUrl: "https://app.example.test/",
  }), ["content_changed", "modal_opened"])
})

test("hash links to a different route still expect navigation", () => {
  assert.deepEqual(expectFor({
    tagName: "a",
    href: "https://app.example.test/settings#profile",
    currentUrl: "https://app.example.test/",
  }), ["navigated"])
})
