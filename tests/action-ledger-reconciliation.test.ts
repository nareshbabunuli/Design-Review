import test from "node:test"
import assert from "node:assert/strict"
import { reconcileActionLedger } from "../lib/ai-automation/action-ledger-reconciliation"
import type { ActionLedger, ActionLedgerEntry } from "../lib/ai-automation/types"

function entry(actionKey: string, status: ActionLedgerEntry["status"]): ActionLedgerEntry {
  return {
    actionKey,
    screenId: "screen-1",
    screenUrl: "https://example.test/",
    screenPath: "/",
    name: actionKey,
    type: "button",
    status,
    attempts: status === "passed" || status === "failed" || status === "blocked" ? 1 : 0,
    discoveredAt: "2026-10-10T00:00:00.000Z",
  }
}

function ledger(entries: ActionLedgerEntry[], untestedQueue: string[] = []): ActionLedger {
  return { entries, untestedQueue, updatedAt: "", total: 0, untested: 0, tested: 0, failed: 0, blocked: 0 }
}

test("reconciles passed, failed, blocked and untested entries without double-counting queue keys", () => {
  const value = ledger([
    entry("passed-1", "passed"),
    entry("failed-1", "failed"),
    entry("blocked-1", "blocked"),
    entry("untested-1", "untested"),
  ], ["untested-1", "untested-1", "passed-1", "orphan-candidate"])
  const missed = reconcileActionLedger(value)
  assert.deepEqual(missed, ["untested-1", "orphan-candidate"])
  assert.equal(value.total, 5)
  assert.equal(value.tested, 2)
  assert.equal(value.failed, 1)
  assert.equal(value.blocked, 1)
  assert.equal(value.untested, 2)
})

test("recovers untested entries missing from the queue and finalizes running entries", () => {
  const value = ledger([
    entry("forgotten-untested", "untested"),
    entry("interrupted-running", "running"),
    entry("resolved", "passed"),
  ], ["resolved"])
  const missed = reconcileActionLedger(value, true)
  assert.deepEqual(missed, ["forgotten-untested", "interrupted-running"])
  assert.equal(value.entries[1].status, "untested")
  assert.match(value.entries[1].error || "", /Run ended before an outcome/)
  assert.equal(value.tested, 1)
  assert.equal(value.untested, 2)
})

test("removes resolved entries from queue and does not mark blocked controls as tested", () => {
  const value = ledger([
    entry("blocked", "blocked"),
    entry("failed", "failed"),
    entry("passed", "passed"),
  ], ["blocked", "failed", "passed"])
  reconcileActionLedger(value)
  assert.deepEqual(value.untestedQueue, [])
  assert.equal(value.tested, 2)
  assert.equal(value.failed, 1)
  assert.equal(value.blocked, 1)
  assert.equal(value.untested, 0)
})
