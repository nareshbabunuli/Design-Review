# Action Ledger Fixture Validation Guide

**Branch:** `action-ledger-development`  
**Fixture:** `tests/fixtures/action-ledger-coverage.html`  
**Also useful:** `tests/fixtures/dom-discovery.html`, `scripts/fixtures/ui-fixture.html`

This guide closes the remaining checklist items that require a browser run. Unit tests cover reconciliation, history retention, safety classification, and pure outcome semantics; they do **not** replace these sessions.

## Quick start

```bash
# From repo root
python3 -m http.server 8765 --directory tests/fixtures
# Open http://localhost:8765/action-ledger-coverage.html
```

Point the AI Simulator **target URL** at that page (or host it under any static server). Use Full App or Feature / Workflow Testing as appropriate. Prefer a disposable session; do not use production credentials.

## Session map (maps to checklist)

| # | Checklist item | Fixture section | Pass criteria |
|---|---|---|---|
| 1 | Tab reveals controls without URL change | §1 SPA-style tabs | Opening **Settings** queues/tests `Save settings`, `Reset defaults`, checkbox; URL path unchanged; those actions appear in Action Ledger |
| 2 | Modal sibling actions before dismiss | §2 Modal | After **Open details modal**, `Edit item` and `Duplicate` are attempted before `Close`; Close does not hide siblings from the queue permanently |
| 3 | Auth branches stay in queue | §3 Auth branches | Login, Sign Up, and Forgot Password each produce distinct ledger entries; none disappear after another branch is exercised |
| 4 | Form prefilled / missing / invalid / valid | §4 Profile form | Prefilled values preferred; empty required fields fail validation; invalid email fails native validity; valid submit records passed with observation |
| 5 | Email/OTP pause/resume | §5 OTP | **Send verification code** exposes OTP UI; run can pause for user input; confirming `123456` records success; wrong code records failure without claiming full coverage |
| 6 | History after retry | Any failing control then retry | Action Ledger **History** shows prior `failed` then later `passed` (or second failed); attempts ≥ 2 |
| 7 | Never report full coverage while untested remain | Leave at least one control untouched | Final status is incomplete/failed or progress < 100%; ledger still shows queued/untested; report must not claim full coverage |
| 8 | Safety blocks | §6 Consequential | Pay now / Delete account / Send invitation / Change password classified blocked or skipped; no destructive side effect |
| 9 | Link classification | §7 Links | Internal vs external vs prefix-confusion vs same-document hash classified conservatively; hash control can still be discovered |

## Evidence to capture

For each session, keep:

1. Screenshot of the fixture before the run.
2. Screenshot of the Action Ledger (Queue + History) mid-run or at end.
3. Final report summary showing counts (passed / failed / blocked / untested).
4. Commit SHA and (if available) CI run URL for the code under test.

Record results in `docs/TESTING_LEDGER.md` under a dated subsection. Do not mark a checklist item `[x]` without that evidence.

## Unit-level coverage already in CI

```bash
pnpm test:dom-discovery
# or:
npx tsx --test \
  tests/action-ledger-reconciliation.test.ts \
  tests/architecture-safety-patterns.test.ts \
  tests/dom-discovery.test.mjs \
  tests/dom-discovery.integration.test.ts
```

These assert:

- Queue / total / tested / failed / blocked reconciliation
- Running entries finalize back to untested
- History preserved across fail → running → pass
- History capped at 20
- `isCoverageComplete` is false while untested/running remain
- Same-origin vs hostile-suffix links, destructive exclusion, payment hard-block, outbound soft-skip
- Hash-link expected effects

## When to merge

Merge only after:

1. TypeScript / `test:dom-discovery` green on the merge commit.
2. Sessions 1–7 above have recorded evidence in `TESTING_LEDGER.md`.
3. Vercel (or local production) build succeeds for that commit.

A discovered action is not considered tested merely because its screen was mapped.
