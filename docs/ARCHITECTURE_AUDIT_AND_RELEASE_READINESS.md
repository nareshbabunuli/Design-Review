# Open Design AI — Architecture Audit and Release Readiness

**Branch:** `action-ledger-development`  
**Audit date:** 2026-10-10  
**Scope:** Architecture document compared with current implementation and automated checks. This is a code/document audit, not a claim that a real application has passed end-to-end testing.

## Executive assessment

**Status: implementation foundation in place; end-to-end readiness not yet demonstrated.**

The repository has a DOM-first discovery pass, bounded route/state graph, deterministic interaction-pattern and candidate generation, Laya selection with deterministic fallback, browser execution, safety guards, outcome observation, issue/evidence reporting, and an Action Ledger. Recent work centralizes ledger reconciliation and keeps unresolved actions from being silently counted as complete.

Latest confirmed CI before this audit: run #109 passed at `cb2cf844bef03866a550b6c462bebbe12c00bce1`. This audit adds safety/pattern regression tests; the new CI run must pass before those tests are considered verified.

## Architecture traceability

| Architecture stage | Implementation evidence | Assessment | Remaining proof |
|---|---|---|---|
| Browser / DOM observation | `dom-first-discovery.ts`, `human-test-loop.ts` | Implemented; fixture coverage exists | Real app with dynamic tabs, overlays and routes |
| State and pattern understanding | `readPatternState`, `interaction-pattern-engine.ts` | Partial: DOM structure is normalized; full accessibility/network/console/resource state is not uniformly represented in every decision | Confirm evidence completeness per action |
| Candidate generation | `generateCandidateTests` | Implemented for detected patterns | Validate false positives, omissions and candidate limits |
| Laya selection + fallback | `layaPredict`, confidence threshold, deterministic fallback | Implemented | Prove candidate IDs are validated and fallback is auditable under live/error conditions |
| Safety policy | `safety-guard.ts`, risk filtering in pattern engine | Implemented, with policy boundaries needing regression tests | Verify every consequential label and network guard in isolated fixtures |
| Execution and rescanning | `executeCandidate`, DOM rescan after successful safe interaction | Implemented | Validate real controls, restoration, and failures |
| Outcome verification | `outcome-verifier.ts` and human-loop observations | Partial: generic observable-effect checks exist; they are not equivalent to domain-specific business assertions | Ensure high-impact outcomes use explicit UI/data assertions rather than click/network/toast alone |
| Evidence and issue correlation | `human-test-loop.ts`, `evidence-reporter.ts`, issue evidence types | Partial | Check correlated evidence accuracy, deduplication and redaction in final reports |
| Action Ledger | `action-ledger-reconciliation.ts`, panel and regression tests | Implemented for queue/status consistency; CI run #109 passed before this audit's new tests | Validate rendered UI and end-of-run counts on a real run |
| Recovery and completion | restoration checks, bounded graph, pending queue gates | Implemented safeguards | Exercise restoration failures and prove report stays incomplete |
| End-to-end evaluation | checklist and fixture tests | Not complete | Run representative fixture app and capture actual report/evidence |
| Release readiness | testing ledger/checklist | Not complete | Fresh build/deployment verification plus recorded fixture results |

## Targeted work done in this audit

- Added `tests/architecture-safety-patterns.test.ts` to cover same-origin versus hostile-suffix links, hidden/disabled controls, destructive candidate exclusion, production payment hard-blocking and outbound-message allowlisting.
- Added the new test file to `test:dom-discovery` so it runs with existing regression fixtures.
- The test addition is committed; do not count it as passing until its CI run succeeds.

Recent Action Ledger fixes already present on this branch:
- central reconciliation helper;
- creation of ledger entries for newly discovered controls;
- pending queue reconciliation and unresolved-running finalization;
- regression tests for passed/failed/blocked/untested states.

## End-to-end validation session plan

Use a disposable fixture application, not a production customer app.

1. **Discovery session:** navigation links, hash/SPA route, tab with controls revealed in-place, modal and modal siblings. Capture graph and ledger.
2. **Forms session:** required field, invalid email/URL, valid values, search with results and no-match state, select/checkbox/radio. Confirm restoration and no unintended submit.
3. **Safety session:** payment, delete, send/invite, password/access changes. Confirm blocked/skipped behavior and that no external side effect occurs.
4. **Failure correlation session:** induce one API failure plus console error and empty data surface; expect one correlated issue with relevant evidence, not duplicate unrelated findings.
5. **Recovery/completion session:** force a safe navigation/restoration failure and leave one candidate pending; run must remain incomplete and report why.
6. **UI/retry session:** verify Action Ledger Live/Queue/History, retry history, screenshot evidence and narrow viewport layout.
7. **Release session:** fresh CI, production build/deployment, smoke test, inspect report and record commit/run/deployment evidence.

## Release gate

Do not call the autonomous testing engine end-to-end complete until:
- new safety/pattern fixtures pass CI;
- required fixture sessions above pass or have explicitly documented blockers;
- pending/blocked/unresolved work is accurately reflected in reports;
- restoration failures and truncated discovery cannot produce a complete result;
- production build/deployment is confirmed on the current commit;
- `docs/TESTING_LEDGER.md` and `docs/ACTION_LEDGER_IMPLEMENTATION_CHECKLIST.md` record actual evidence rather than stale historical statuses.

## Progress estimate (engineering readiness, not percent of all source code)

- **Core architecture implementation:** approximately 70–80% represented in code.
- **Automated confidence:** improving; latest previously confirmed CI is green, new audit tests are pending.
- **End-to-end validation:** still a major outstanding milestone.
- **Release readiness:** not yet established.

These are qualitative planning estimates, not measured completion metrics. A reliable final percentage needs the fixture sessions and release gate above.
