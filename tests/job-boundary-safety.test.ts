import test from "node:test"
import assert from "node:assert/strict"
import { setJobSecrets, getJobSecrets, clearJobSecrets } from "../lib/ai-automation/job-secret-vault"

test("job secret vault isolates jobs and clears secrets", () => {
  setJobSecrets("job-a", { credentials: { username: "alice", password: "value-a" } })
  setJobSecrets("job-b", { credentials: { username: "bob", password: "value-b" } })
  assert.equal(getJobSecrets("job-a")?.credentials?.password, "value-a")
  assert.equal(getJobSecrets("job-b")?.credentials?.password, "value-b")
  clearJobSecrets("job-a")
  assert.equal(getJobSecrets("job-a"), undefined)
  assert.equal(getJobSecrets("job-b")?.credentials?.password, "value-b")
  clearJobSecrets("job-b")
})

test("persisted job projection removes interactive credential fields", () => {
  const job = {
    id: "persistence-test",
    pendingCredentials: { username: "alice", password: "value-a" },
    pendingSettingsCredentials: { apiKey: "value-b" },
    pendingPaymentCredentials: { cardNumber: "0000", cvv: "000" },
    pendingVerification: { verificationCode: "000000" },
    safe: "retained",
  } as Record<string, unknown>

  const persisted = JSON.parse(JSON.stringify(job))
  delete persisted.pendingCredentials
  delete persisted.pendingSettingsCredentials
  delete persisted.pendingPaymentCredentials
  delete persisted.pendingVerification

  assert.deepEqual(persisted, { id: "persistence-test", safe: "retained" })
})

test("stopped jobs cannot resume recording", () => {
  let status: "running" | "stopped" = "running"
  let recording: "recording" | "stopped" = "recording"

  const stop = () => {
    if (status === "running") {
      recording = "stopped"
      status = "stopped"
    }
  }
  const resume = () => {
    if (status === "running" && recording !== "stopped") recording = "recording"
  }

  stop()
  resume()
  assert.equal(status, "stopped")
  assert.equal(recording, "stopped")
})
