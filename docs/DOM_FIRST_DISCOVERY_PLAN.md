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
- [x] Persist discovered destination element inventories as untested Action Ledger entries.
- [x] Defer `target="_blank"` links rather than clicking them in this pass.

### Phase 2 — Route queue and recursive exploration
- [x] Add a bounded in-memory queue of discovered internal URLs during the decision loop (persistent route-queue recovery remains future work).
- [x] Visit queued same-origin routes, inventory their DOM, explore safe local state changes, and return to the recorded parent URL.
- [ ] Record route graph edges (source page, triggering element, destination page).
- [ ] Re-scan after modal/tab/dropdown/form-state changes and enqueue newly revealed controls/states.
- [ ] Handle SPA route changes, hash navigation, same-URL state transitions, and multi-tab links explicitly.
- [ ] Bound total routes/actions/time, but report remaining work as incomplete rather than silently dropping it.

### Phase 3 — Central runner integration
- [x] Run the DOM-first discovery loop once centrally before scenario verification in autonomous mode.
- [x] Budget calculation excludes merely discovered/untested inventory rows; a truly shared run-wide cap still needs central-runner ownership.
- [ ] Keep Laya as candidate selector; deterministic engine defines candidates; browser only executes approved actions.
- [x] Discovery-loop exceptions are now surfaced as scenario errors instead of silently allowing a clean pass.
- [ ] Retain scenario-based Stagehand testing as an explicitly separate optional verification layer, not as a silent replacement for failed discovery.
- [x] Destination screenshots/DOM inventories and unresolved counts are recorded in the Action Ledger and final report; route graph/report enrichment remains.

### Phase 4 — Tests and release evidence
- [ ] Add isolated DOM fixture tests for internal links, external/prefix-confusion links, SPA routes, popups, tabs, forms, target=_blank, navigation loops, and restoration failure.
- [ ] Run TypeScript CI and automated fixture tests.
- [ ] Run a browser end-to-end test against a disposable sample app.
- [ ] Confirm unresolved/blocked counts prevent a false “complete” result.
- [ ] Record actual evidence in `docs/TESTING_LEDGER.md`; do not infer browser correctness from typecheck success.

## Current honest status — 2026-10-10

The first central DOM-first discovery pass is wired into the autonomous runner before AI scenario planning. It inventories visible controls, prioritizes safe in-page candidates, records destination inventories, queues same-origin routes for bounded exploration, and attempts to return to parent routes. Stagehand scenario verification remains a separate subsequent layer.

The most recent confirmed TypeScript validation before the latest coverage-reconciliation fix passed on commit `9174acd89eaaaa3308b1c1260ffed2b563871fc2` (run [#64](https://github.com/nareshbabunuli/Design-Review/actions/runs/38078951528)). The new coverage fix is commit `1e3758282eb90e4928dea53fdfa5d890fa9ba3de`; its CI result must be checked separately.

This is **not yet a proven complete recursive explorer**. Remaining work includes a truly shared run-wide budget, route graph edges, rescanning newly revealed states after tabs/modals/dropdowns, explicit SPA/hash/same-URL handling, automated browser fixtures, and a disposable-app end-to-end run. TypeScript success alone does not prove browser behavior.


### Follow-up code review — same-URL transitions

- [x] Same-URL link clicks now compare the pre-click and post-click DOM inventory signature; a click with no observed URL or inventory-state change is not marked passed.
- [ ] This is inventory-level evidence only. Route graph edges, app-specific assertions, automated fixtures, and browser E2E verification remain open.
