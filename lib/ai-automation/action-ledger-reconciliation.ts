import type { ActionLedger, ActionLedgerEntry } from "./types"

/**
 * Reconcile the ledger's entry statuses and pending queue into one coverage view.
 * A run that is ending must never leave an action marked running: without a
 * recorded outcome it returns to untested and remains in the queue.
 */
export function reconcileActionLedger(ledger: ActionLedger, finalize = false): string[] {
  const now = new Date().toISOString()

  if (finalize) {
    for (const entry of ledger.entries) {
      if (entry.status !== "running") continue
      entry.status = "untested"
      entry.error = entry.error || "Run ended before an outcome was recorded; action remains untested."
    }
  }

  const entryByKey = new Map<string, ActionLedgerEntry>()
  for (const entry of ledger.entries) entryByKey.set(entry.actionKey, entry)

  // Keep only pending queue keys; resolved entries must not be queued again.
  const queue = [...new Set(ledger.untestedQueue)].filter((key) => {
    const entry = entryByKey.get(key)
    return !entry || entry.status === "untested" || entry.status === "running"
  })

  // Every untested entry must be represented in the queue, even if an earlier
  // discovery path forgot to enqueue it.
  for (const entry of ledger.entries) {
    if ((entry.status === "untested" || entry.status === "running") && !queue.includes(entry.actionKey)) {
      queue.push(entry.actionKey)
    }
  }

  ledger.untestedQueue = queue
  const orphanQueueKeys = queue.filter((key) => !entryByKey.has(key))
  ledger.total = ledger.entries.length + orphanQueueKeys.length
  ledger.untested = queue.length
  ledger.tested = ledger.entries.filter((entry) => entry.status === "passed" || entry.status === "failed").length
  ledger.failed = ledger.entries.filter((entry) => entry.status === "failed").length
  ledger.blocked = ledger.entries.filter((entry) => entry.status === "blocked").length
  ledger.updatedAt = now

  return queue
}
