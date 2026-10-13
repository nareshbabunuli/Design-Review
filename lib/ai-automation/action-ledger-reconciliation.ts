import type { ActionLedger, ActionLedgerAttempt, ActionLedgerEntry, ActionLedgerStatus } from "./types"

const HISTORY_CAP = 20

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

export type LedgerOutcomeInput = {
  status: Exclude<ActionLedgerStatus, "untested">
  observedOutcome?: string
  error?: string
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
  timestamp?: string
}

/**
 * Apply a resolved or in-progress outcome to a ledger entry.
 * - "running" does not erase prior history or increment attempts.
 * - Resolved statuses append to history (capped) and update evidence.
 * Returns the entry for chaining; caller should still call reconcileActionLedger.
 */
export function applyLedgerOutcome(entry: ActionLedgerEntry, input: LedgerOutcomeInput): ActionLedgerEntry {
  const timestamp = input.timestamp || new Date().toISOString()
  entry.status = input.status
  entry.lastTestedAt = timestamp

  // Starting a retry must not erase previous resolved outcomes.
  if (input.status === "running") {
    return entry
  }

  entry.attempts = (entry.attempts || 0) + 1
  entry.error = input.error
  entry.evidence = {
    beforeScreenshotUrl: input.beforeScreenshotUrl ?? entry.evidence?.beforeScreenshotUrl,
    afterScreenshotUrl: input.afterScreenshotUrl ?? entry.evidence?.afterScreenshotUrl,
    observedOutcome: input.observedOutcome ?? entry.evidence?.observedOutcome,
  }

  const attempt: ActionLedgerAttempt = {
    status: input.status,
    timestamp,
    observedOutcome: input.observedOutcome,
    error: input.error,
    beforeScreenshotUrl: input.beforeScreenshotUrl,
    afterScreenshotUrl: input.afterScreenshotUrl,
  }
  entry.history = [...(entry.history || []), attempt].slice(-HISTORY_CAP)
  return entry
}

/**
 * True only when every discovered action has left the pending set.
 * Blocked/skipped count as resolved for coverage purposes; untested/running do not.
 */
export function isCoverageComplete(ledger: ActionLedger): boolean {
  if (!ledger.entries.length && !ledger.untestedQueue.length) return true
  if (ledger.untestedQueue.length > 0) return false
  return !ledger.entries.some((entry) => entry.status === "untested" || entry.status === "running")
}
