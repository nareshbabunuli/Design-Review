# DOM-First Discovery Implementation Plan

**Branch:** `action-ledger-development`  
**Goal:** Build a systematic, evidence-backed explorer that inventories a page before interaction, explores safe local state changes first, then traverses recorded internal navigation and returns to the source page.

## Design rules

- DOM inspection is read-only. It must not click, submit, mutate values, or navigate.
- Inventory visible/enabled interactive elements, forms, dialogs, links, likely behaviour, destinations, and risk.
- Treat DOM semantics as evidence, not certainty; confirm actual behaviour through a controlled interaction.
- Explore safe in-page state changes before navigation so a link does not prematurely abandon unexplored controls.
- Traverse only same-origin destinations automatically. External links, new-tab links, destructive routes, and consequential controls are recorded but not followed by default.
- Capture the destination URL/title/DOM summary and screenshot, then return to the source. A failed return is an explicit coverage failure.
- Deduplicate by stable element identity and observed page state; avoid navigation cycles.
- The Action Ledger must distinguish discovered, untested, attempted, verified, blocked, and failed work. Discovery is not verification.
- Do not claim full completion while applicable discovered work remains unresolved.

## Implementation sequence

### Phase 1 — DOM-first inventory and safe navigation probe
- [x] Add `lib/ai-automation/dom-first-discovery.ts` with read-only DOM inventory.
- [x] Inventory interactive elements and classify navigation, overlays, forms, state changes, actions, and unknown controls.
- [x] Add guarded same-origin link exploration with destination DOM snapshot, optional screenshot, and source restoration.
- [x] Call the DOM inventory before candidate selection.
- [x] Defer navigation candidates while safe in-page candidates remain.
- [ ] Persist every discovered destination and its element inventory as first-class ledger records.
- [ ] Explicitly exclude `target="_blank"` links from click exploration and verify all destination URL parsing paths are exception-safe.

### Phase 2 — Route queue and recursive exploration
- [ ] Maintain a run-level queue of discovered internal URLs and page-state fingerprints.
- [ ] Visit each route deliberately, inventory its DOM, explore safe local state changes, then return/backtrack.
- [ ] Record route graph edges (source page, triggering element, destination page).
- [ ] Re-scan after modal/tab/dropdown/form-state changes and enqueue newly revealed controls/states.
- [ ] Handle SPA route changes, hash navigation, same-URL state transitions, and multi-tab links explicitly.
- [ ] Bound total routes/actions/time, but report remaining work as incomplete rather than silently dropping it.

### Phase 3 — Central runner integration
- [ ] Make the discovery loop the primary MAP → PLAN → EXECUTE → VERIFY loop for full autonomous exploration.
- [ ] Use one run-level action/time budget, not a fresh per-scenario budget.
- [ ] Keep Laya as candidate selector; deterministic engine defines candidates; browser only executes approved actions.
- [ ] Remove silent fallback when the discovery loop throws. Preserve the error, evidence, and unresolved coverage.
- [ ] Retain scenario-based Stagehand testing as an explicitly separate optional verification layer, not as a silent replacement for failed discovery.
- [ ] Connect route graph, destination screenshots, console/network evidence, Action Ledger and final report.

### Phase 4 — Tests and release evidence
- [ ] Add isolated DOM fixture tests for internal links, external/prefix-confusion links, SPA routes, popups, tabs, forms, target=_blank, navigation loops, and restoration failure.
- [ ] Run TypeScript CI and automated fixture tests.
- [ ] Run a browser end-to-end test against a disposable sample app.
- [ ] Confirm unresolved/blocked counts prevent a false “complete” result.
- [ ] Record actual evidence in `docs/TESTING_LEDGER.md`; do not infer browser correctness from typecheck success.

## Current honest status

Phase 1 has a first implementation committed. This is **not yet a complete recursive explorer**: destination inventory persistence, route queue/backtracking, central-runner ownership, and browser end-to-end verification remain outstanding. TypeScript CI is being checked for the current commit; do not describe it as passed until the run concludes successfully.
