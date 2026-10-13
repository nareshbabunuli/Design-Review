import test from "node:test"
import assert from "node:assert/strict"
import { generateStructuredTestPlan } from "../lib/ai-automation/full-app-engine"
import type { AppScreenNode, AppWorkflowTransition } from "../lib/ai-automation/types"

const loginWall: AppScreenNode = {
  id: "S001",
  name: "Sign In",
  url: "http://localhost:3000/login",
  path: "/login",
  isLoginWall: true,
  discoveredAt: "2026-10-13T00:00:00.000Z",
  actionableElements: [],
  forms: [],
}

const dashboard: AppScreenNode = {
  id: "S002",
  name: "Dashboard",
  url: "http://localhost:3000/dashboard",
  path: "/dashboard",
  screenshotUrl: "data:image/jpeg;base64,AAAA",
  discoveredAt: "2026-10-13T00:00:00.000Z",
  actionableElements: [
    { type: "input", name: "Email", inputType: "email", selector: "#email" } as any,
    { type: "input", name: "Password", inputType: "password", selector: "#pw" } as any,
  ],
  forms: [],
}

const loginTransition: AppWorkflowTransition = {
  id: "tr-1",
  fromScreenId: "S001",
  toScreenId: "S002",
  action: "Submit Login Form",
  actionType: "form_submit",
}

test("auth step passes only with post-login evidence", () => {
  const plan = generateStructuredTestPlan("http://localhost:3000", [loginWall, dashboard], [loginTransition], {
    isAuthenticated: true,
  })
  const auth = plan.steps.find((s) => s.targetName === "User Authentication")!
  assert.equal(auth.status, "passed")
  assert.equal(auth.screenshotUrl, dashboard.screenshotUrl)
  assert.match(auth.actualResult || "", /S002/)
})

test("auth step is blocked, not passed, without evidence", () => {
  const plan = generateStructuredTestPlan("http://localhost:3000", [loginWall, dashboard], [], {
    isAuthenticated: true,
  })
  const auth = plan.steps.find((s) => s.targetName === "User Authentication")!
  assert.equal(auth.status, "blocked")
  assert.equal(auth.screenshotUrl, undefined)
})

test("plan never embeds real credentials", () => {
  const plan = generateStructuredTestPlan("http://localhost:3000", [loginWall, dashboard], [loginTransition], {
    isAuthenticated: true,
    // Extra field simulates an old caller still passing credentials.
    ...({ credentials: { username: "real.user@corp.com", password: "S3cret-Real-Pass" } } as object),
  })
  const serialized = JSON.stringify(plan)
  assert.ok(!serialized.includes("real.user@corp.com"))
  assert.ok(!serialized.includes("S3cret-Real-Pass"))
})
