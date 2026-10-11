# Open Design AI — Testing Ledger

**Branch:** `action-ledger-development`  
**Last updated:** 2026-10-10 (architecture closeout pass)  
**Purpose:** Single source of truth for testing work, code changes, CI, evidence, defects, and remaining coverage. Update this file as work progresses; do not mark a test passed without evidence.

## Current status

- [x] Architecture audit and release gate documented in `docs/ARCHITECTURE_AUDIT_AND_RELEASE_READINESS.md`.
- [x] Regression coverage for safety boundaries and same-document hash-link outcome expectations added to CI.
- [x] Outcome verifier now distinguishes absolute same-document hash links from cross-route navigation when current URL is available.
- [x] Report summary now counts blocked and pending/unresolved steps and marks runs incomplete when review is required.
- [ ] Confirm CI for the latest report change: [run #115](https://github.com/nareshbabunuli/Design-Review/actions/runs/38089178309).
- [ ] Run the seven fixture/release sessions from the architecture audit and record evidence; do not call E2E/release ready before this is done.

- [x] Input classification fix committed.
- [x] Type-appropriate synthetic values for text, email, URL, telephone, password, and search fields committed.
- [x] Native malformed email/URL validation committed.
- [x] Stateful control verification strengthened: checkbox/radio/toggle must show a state change; expand/collapse must show an expanded-state change.
- [x] Form-level invalid-input candidates restricted to supported email and URL fields.
- [x] Link origin detection now compares parsed URL origins instead of string prefixes; unknown/malformed destinations are conservatively classified as external.
- [x] Expanded action-risk classification to treat purchases, payments, refunds, transfers, outbound messages, publishing/deploying, invitations, access changes, password changes, and sign-out variants as consequential candidates blocked by default.
- [x] Hardened both pattern discovery and execution guards against common wording variants (including `send`, `invite`, `log out`, `sign out`, refund/transfer, and password/access changes).
- [x] Earlier TypeScript validation run #28 passed at commit `55cb0aa82f80df94fe87a010124591ce7e09d454`.
- [x] TypeScript validation passed for both latest code commits (#29 and #30).
- [ ] Run browser fixture tests for the classification matrix.
- [ ] Run end-to-end verification against a real sample app.
- [ ] Confirm build/deployment and full coverage behavior.

## Recent code changes

| Commit | Change | Status |
|---|---|---|
| `4a24dbce8e788c46e943a48f2b4eed1610ef7f72` | Classify text-entry controls separately from choice/action controls | Committed |
| `312809179c3fccc5747c395eb21fb90a4ab7fd68` | Limit required validation to supported text fields | Committed |
| `59da1bc168018f6da32eb13a203bcb122e006318` | Limit invalid-input tests to supported native types | Committed |
| `f3d67453f8c03ae5192407ec17deb8e18ca4ce4b` | Use type-appropriate synthetic input values | Committed |
| `55cb0aa82f80df94fe87a010124591ce7e09d454` | Verify malformed URL input safely | Committed |
| `058f08517ecc0341d197de373f2885077dd41d32` | Verify stateful control outcomes explicitly | Committed; CI pending at last check |
| `04c32395a2e64a08f6ba5758eaa7520b7d618784` | Restrict form invalid-input candidates to supported types | CI passed |
| `3613eeca5d28a8b9e60ef3cdc9ab540517fe6961` | Broaden consequential-action label detection | Committed; CI pending |
| `3685a8d5a3645176f6c474bd7aff633512ad073e` | Harden execution guard against risky wording variants | Committed; CI pending |

## CI evidence

- **Previously passed:** [TypeScript validation #28](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074124209) — commit `55cb0aa82f80df94fe87a010124591ce7e09d454`.
- **Passed:** [TypeScript validation #29](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074602041) — commit `058f08517ecc0341d197de373f2885077dd41d32`.
- **Passed:** [TypeScript validation #30](https://github.com/nareshbabunuli/Design-Review/actions/runs/38074606541) — commit `04c32395a2e64a08f6ba5758eaa7520b7d618784`, including the latest form-classification change.
- [Passed before the latest guard changes](https://github.com/nareshbabunuli/Design-Review/actions/runs/38075319896): TypeScript validation #36 at `a2360616b1e78c83b16edeeb58ae38d9d8800686`.
- [In progress at ledger update](https://github.com/nareshbabunuli/Design-Review/actions/runs/38075629532): TypeScript validation #37 for the labelled manual-check documentation commit. Guard changes after that commit will trigger new CI runs.
- CI results refer to TypeScript validation only, not browser/end-to-end verification.
- TypeScript validation is not a browser test and does not prove end-to-end behavior.

## Browser fixture matrix

Run on an isolated local fixture page. Do not submit forms or trigger real external side effects.

| Fixture control | Expected classification | Expected test behavior | Status |
|---|---|---|---|
| `input[type=text]` | `valid_input` (and required validation when required) | Fill synthetic value, verify it is retained, restore original | Not run |
| `input[type=email]` | `valid_input`, `invalid_input`, required if applicable | Test safe sample and malformed email with native validity; restore original | Not run |
| `input[type=url]` | `valid_input`, `invalid_input`, required if applicable | Test safe sample and malformed URL with native validity; restore original | Not run |
| `input[type=search]` | `search` | Require visible result/empty-state change; restore original | Not run |
| `input[type=tel]` | `valid_input` | Use type-appropriate synthetic value; restore original | Not run |
| `input[type=password]` | `valid_input` | Use synthetic value; never log/store the value; restore original | Not run |
| `textarea` | `valid_input`, required if applicable | Fill and restore original | Not run |
| Checkbox | `checkbox`, not `valid_input` | Pass only if checked state changes | Not run |
| Radio | `radio`, not `valid_input` | Pass only if checked/selected state changes | Not run |
| Native select | `dropdown`, not `valid_input` | Inspect options safely; no submit or persistent mutation | Not run |
| Submit button | Submit/form-submit candidate | Must remain blocked unless isolated test-data cleanup is configured | Not run |
| Expand/collapse control | `expand_collapse` | Pass only if expanded state changes | Not run |
| Ordinary button | `button` or semantic action pattern | UI transition alone is only transition evidence, not proof of business success | Not run |

## End-to-end coverage checklist

- [ ] Confirm visible controls are classified correctly and hidden/disabled controls are excluded.
- [ ] Confirm text and specialized inputs use type-appropriate values and originals are restored.
- [ ] Confirm checkbox, radio, toggle, and expand/collapse results rely on the target's state, not unrelated page changes.
- [ ] Test same-origin, external, malformed, and prefix-confusion URLs (e.g. a trusted hostname followed by an attacker-controlled suffix).
- [ ] Test destructive/consequential labels including pay, purchase, refund, transfer, send, publish, deploy, invite, access changes, and password changes; verify all remain blocked.
- [ ] Confirm search only passes when a visible result or empty state is observed.
- [ ] Confirm no real form submission, payment, deletion, publication, email, logout, or external navigation occurs in the fixture.
- [ ] Confirm each pass/fail/blocked result includes a clear observation and is recorded in the Action Ledger.
- [ ] Confirm missed coverage remains queued and the run does not report completion while unresolved coverage remains.
- [ ] Run existing fixture checks for SPA tabs, modal sibling actions, authentication branches, form validation, email/OTP checkpoints, and retry history (see `docs/ACTION_LEDGER_IMPLEMENTATION_CHECKLIST.md`).
- [ ] Check the latest Vercel deployment/build and record its URL/result.

## Findings and follow-up

1. **Do not equate a click with success.** A generic control may only be marked as an observable transition; meaningful business outcomes need a specific assertion.
2. **Search behavior needs an app-specific assertion.** Text changing anywhere on the page may be unrelated; fixture tests should ensure the expected results/empty state is what changed.
3. **Native validity is not server validation.** Email/URL `checkValidity()` tests browser constraints only; it does not prove backend validation.
4. **Synthetic input restoration needs verification.** Confirm framework-controlled inputs retain their original state after restoration and no unwanted autosave/API side effects occur.
5. **Browser/end-to-end tests remain outstanding.** The latest consequential-action guard changes need CI confirmation, then the fixture matrix and end-to-end checks must run.


### 2026-10-10 — Persist role-based test workflows

- **Commit:** `8df90a5a1181ed6716c53ebbd6c683ce30e64981` — `feat: persist role workflows per AI simulator project`.
- Saved role workflows now load from and save to browser local storage, scoped by the target app URL. They survive refreshes in the same browser and remain separate from the Figma design-review workflow records. The scope currently uses target URL rather than the database project ID.
- Each saved item includes role, workflow name, and test prompt; users can load or delete an item from the existing workflow panel. Runs include the selected role and workflow name in the instruction sent to the existing test runner.
- Existing AI Bot username/password fields remain the credential input. Credentials are not copied into the saved workflow records.
- **Prototype limitation:** persistence is browser-local, not synchronized across browsers/devices or shared project members. Credential inputs remain the existing shared fields rather than separate per-role credential profiles. CI run [#118](https://github.com/nareshbabunuli/Design-Review/actions/runs/38089716594) passed type-check and DOM discovery fixtures for the preceding workflow UI commit; the final target-URL scoping change still needs its own CI result. Manual browser verification is pending; this does not prove end-to-end role isolation.

### 2026-10-10 — Optional test-session video recording

- Added a **Record test session video** checkbox to the AI Simulator pre-flight modal; it is enabled by default and can be switched off before a run.
- The preference is sent with both Full App and Feature / Workflow Testing requests.
- Full App Testing already respected `recordVideo: false`; Feature / Workflow Testing now starts and finalizes the existing session recorder and includes its recording URL in the report. Autonomous Testing now skips starting its recorder when recording is disabled.
- Recording remains best-effort: if the recorder dependency or storage upload is unavailable, the test run continues and logs the recording limitation. Supabase schema changes are not required; existing storage upload behavior is reused.
- **Verification:** implementation committed; CI/typecheck and browser UI verification are pending. No claim is made that a video has been captured successfully in a live run.

## Update log

- **2026-10-10:** Recorded input-classification changes, outcome-verification changes, CI runs #29 and #30 passing, URL-origin hardening, consequential-action risk classification, labelled user visual checks, and expanded consequential-action guard coverage. Browser tests have not yet been run.

## User-run visual/manual checks (labelled for later)

**Status for every check below:** `NEEDS USER VISUAL CHECK — NOT RUN`. These are intentionally deferred until the user can open the app. Do not mark them passed based on TypeScript CI.

### USER-CHECK-VIS-01 — AI Simulator UI and Action Ledger layout
- **Goal:** Check the simulator is understandable, responsive, and does not duplicate or hide important actions/evidence.
- **Steps:** Open the AI Simulator; start or open a test run; inspect the main controls, plan, current action, Action Ledger, evidence, and coverage/status areas. Check a narrow phone viewport and a desktop viewport when available.
- **Evidence to capture:** One screenshot of the initial screen and one screenshot of a run showing the Action Ledger and coverage/status.
- **Pass criteria:** Clear primary action; no overlapping, clipped, or unreachable controls; ledger entries and statuses are readable; blocked, passed, failed, and untested states are distinguishable.
- **Result:** Pending user evidence.

### USER-CHECK-VIS-02 — Real form input classification
- **Goal:** Verify controls are classified by semantics rather than treating every field as generic text input.
- **Steps:** Use a disposable test page/form with text, email, URL, search, telephone, password, checkbox, radio, select, and submit controls. Start analysis and inspect the generated candidates. Do not submit the form or use real credentials.
- **Evidence to capture:** Screenshot of the form and screenshot of the candidate list/classifications.
- **Pass criteria:** Text-like fields get type-appropriate tests; email/URL invalid-input tests target only supported types; checkbox/radio/select are not classified as text entry; submit remains blocked unless isolated safe test data and cleanup are configured.
- **Result:** Pending user evidence.

### USER-CHECK-VIS-03 — Destructive/consequential-action safety
- **Goal:** Ensure risky actions are identified and not executed by default.
- **Steps:** On a disposable fixture, inspect controls labelled with examples such as Delete, Pay, Purchase, Refund, Transfer, Send, Publish, Deploy, Invite, Change password, and Change access. Review the plan/ledger; do not confirm any real action.
- **Evidence to capture:** Screenshot showing the candidate and its risk/blocked status.
- **Pass criteria:** Destructive or consequential actions are blocked by default and clearly recorded; no external side effect occurs.
- **Result:** Pending user evidence.

### USER-CHECK-VIS-04 — Internal vs external link classification
- **Goal:** Check URL origin handling, including deceptive prefix cases.
- **Steps:** In a disposable fixture, inspect a same-origin link, a genuine external link, a malformed URL, and a prefix-confusion URL such as `https://trusted.example.attacker.invalid/`. Review candidate classification without following external links.
- **Evidence to capture:** Screenshot of fixture links and the resulting classifications.
- **Pass criteria:** Only true same-origin URLs are internal; external, malformed, and prefix-confusion destinations are treated conservatively as external.
- **Result:** Pending user evidence.

### USER-CHECK-VIS-05 — Coverage counts and completion status
- **Goal:** Ensure a run does not claim completion while discovered work remains untested.
- **Steps:** Start a disposable run with multiple safe candidates; leave at least one candidate untested or blocked. Inspect progress, remaining coverage, final status, and Action Ledger.
- **Evidence to capture:** Screenshot showing total candidates, tested/blocked/untested counts, and final status.
- **Pass criteria:** Counts reconcile; blocked and untested work remains visible; run is not labelled fully complete while unresolved applicable coverage remains.
- **Result:** Pending user evidence.

**How to resume:** Send the label (for example, `USER-CHECK-VIS-02`) with screenshots or observed results. Record each result and any defect here before changing its status to passed.

## DOM-first discovery work — 2026-10-10

- [x] Added `lib/ai-automation/dom-first-discovery.ts`: observational DOM inventory for visible interactive controls, links/destinations, forms, dialogs, likely behaviour and risk.
- [x] Wired an initial DOM inventory before candidate selection in the human-like decision loop.
- [x] Safe in-page candidates are prioritized before recorded internal-link navigation candidates.
- [x] Added a same-origin navigation probe that records destination DOM summary/screenshot and attempts to restore the source URL.
- [x] Added implementation phases and remaining work in [DOM-first discovery plan](DOM_FIRST_DISCOVERY_PLAN.md).
- [ ] Persist destination DOM inventory as individual ledger entries and add a run-level route queue.
- [ ] Harden new-tab and unusual URL handling; test SPA transitions and failed restoration.
- [ ] Complete central-runner integration; current autonomous runner still has the older scenario-first orchestration and silent Stagehand fallback.
- [ ] Browser fixture and end-to-end tests remain outstanding.

**CI status:** TypeScript validation was triggered for commit `43709eab378c21cec6913fa0ba16dd789ee6e786` (run [#42](https://github.com/nareshbabunuli/Design-Review/actions/runs/38078416648)). The run was still in progress when checked; no pass is claimed yet. A later docs commit may trigger another run.

### DOM-first route queue follow-up

- [x] Internal-link candidates are deferred until safe current-state candidates are exhausted.
- [x] Same-origin link exploration inventories the destination, captures a destination screenshot when available, and attempts to restore the source URL.
- [x] Discovered destination controls are persisted as untested Action Ledger inventory entries.
- [x] Discovered internal destinations are queued for a later full exploration pass, with a recorded parent URL for return.
- [x] Links targeting a new tab are recorded but not clicked automatically.
- [x] Discovery-loop exceptions now surface as scenario errors instead of being silently treated as successful broader exploration.
- [x] Budget calculation no longer counts untested inventory rows as already executed actions.
- [ ] A single central run-level budget and central-runner ownership are still required; the existing autonomous runner still starts from AI-planned scenarios.
- [ ] Automated browser fixtures and end-to-end route/backtracking verification remain outstanding.

### Central runner integration follow-up

- [x] Autonomous runner now runs the DOM-first decision loop once before AI scenario planning, using a single bounded 24-step discovery pass.
- [x] Removed repeated per-scenario execution of the discovery loop; Stagehand scenario verification remains a separate subsequent layer.
- [x] Stagehand action counts now include observed agent actions.
- [x] Final report adds a warning/recommendation when the discovery loop fails or the Action Ledger still has unresolved inventory.
- [x] Fixed strict TypeScript annotations in the DOM traversal helper.
- [x] Restored the full human-test-loop source after an intermediate edit truncated its tail; current file is complete and the latest CI run is being checked.
- [ ] Confirm TypeScript validation passes on the latest commit.
- [ ] Add automated browser fixtures and verify route recursion/backtracking against a disposable app.
- [ ] Verify that the report UI displays DOM inventory entries and unresolved coverage as intended.

## DOM-first discovery follow-up — 2026-10-10

- [x] Central DOM-first discovery pass runs before scenario planning; same-origin destinations are queued for a bounded exploration pass.
- [x] Destination DOM inventories and screenshots are added to the Action Ledger/report path.
- [x] Latest confirmed TypeScript validation before this follow-up passed on commit `9174acd89eaaaa3308b1c1260ffed2b563871fc2` ([run #64](https://github.com/nareshbabunuli/Design-Review/actions/runs/38078951528)).
- [x] Fixed completion reconciliation so both queued candidate IDs and ledger entries still marked `untested` prevent a false complete result (commit `1e3758282eb90e4928dea53fdfa5d890fa9ba3de`).
- [ ] Check TypeScript CI for the coverage-reconciliation commit and subsequent documentation commits.
- [ ] Add automated browser fixture tests and run against a disposable sample app.
- [ ] Validate route recursion/backtracking, restoration failures, SPA state changes, and coverage counts in a real browser.
- [ ] Keep manual UI checks USER-CHECK-VIS-01..05 pending until actual visual evidence is provided.

**Honesty rule:** The central discovery flow is wired, but no browser E2E result has been produced yet. Do not claim the explorer is fully validated or that every control is verified based on TypeScript CI alone.

### Code-review findings — coverage ledger semantics

- [x] Disabled visible controls are retained as `blocked` inventory entries rather than permanently remaining `untested` (commit `04d2199ea8bca2a70b43663a38f5a49fd6a2c51a`).
- [x] External-link and browser-history candidates that the policy intentionally does not auto-execute are recorded as `blocked` when they are the only remaining candidates (commit `d63ab3ef8b6bd09bdad7139e547a2849b219f8d2`).
- [x] TypeScript validation passed for commits #68 (`04d2199ea8bca2a70b43663a38f5a49fd6a2c51a`, [run #69](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081487980)), #69 (`d63ab3ef8b6bd09bdad7139e547a2849b219f8d2`, [run #70](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081509181)), and documentation commit #70 (`7999f7f4351c0b2a3355c75fca0f14e4d39cf32e`, [run #71](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081520068)).
- [ ] These are code-review fixes, not proof from a live browser run. SPA state changes, actual interaction outcomes, route restoration, and full ledger reconciliation still require browser fixtures.


### Follow-up code review — deferred navigation and honest completion

- [x] Fixed a classification mismatch where same-origin links opened in a new tab, malformed/stale links, external URLs, and consequential navigation paths were intentionally not clicked but could be recorded as failed instead of blocked. The DOM probe now returns an explicit policy-blocked signal, and the decision loop records that distinction.
- [x] Final autonomous-run messaging now distinguishes scenario execution finishing from DOM discovery coverage being incomplete, and includes Action Ledger tested/blocked/untested counts when available.
- [x] TypeScript validation passed for the navigation-blocking commits #71 and #72 ([#71](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081734186), [#72](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081736028)).
- [x] CI exposed a missing comma in the report object introduced by the completion-messaging change; the typecheck failed on commits #73–#76 before the correction. The syntax issue was corrected in commit `a3d76ac2b6e47639711fc227c541e233ea8c55d6`.
- [ ] TypeScript validation for the syntax correction and final branch tip is pending: [run #79](https://github.com/nareshbabunuli/Design-Review/actions/runs/38081827535). Do not treat the earlier failed runs as passing.

- [x] Fixed a false-positive pass for same-URL link interactions: discovery now compares pre/post DOM inventory signatures and only treats the interaction as verified when an observable inventory change occurs. A click with no URL or meaningful inventory change is recorded as failed/unverified, not passed.
- [ ] This inventory-signature check is a bounded heuristic; application-specific semantic assertions and browser fixture evidence are still required.
- [ ] Route graph edges, stronger same-URL/SPA state evidence, and automated browser fixtures remain the next code phases. No live-browser result is claimed.


### DOM discovery route/state graph — 2026-10-10

- [x] Added a bounded domDiscoveryGraph separate from the existing Stagehand scenario graph, preserving both views.
- [x] Record observed navigation and inventory-changing same-URL transitions with source/destination state IDs, action label, selector, status, and evidence summary.
- [x] Graph limits are 200 nodes and 400 edges; overflow is explicitly flagged as truncated.
- [ ] TypeScript CI for the graph changes is pending; browser fixtures, SPA/hash behavior, and real-browser route restoration remain unverified.

## Architecture closeout — 2026-10-10

| Commit | Change | Verification |
|---|---|---|
| `45e59f88fe4f6867f7b9c9d7ad5397c81bb72e4a` | Add safety and interaction-pattern boundary tests | CI #110 passed |
| `09509001b793dce5a9a2bd2075309c54fb159170` | Wire safety fixtures into CI | CI #111 passed |
| `92d87b0aa1d1cc47a5553ca5bd363cf5d4d65214` | Architecture audit and release plan | CI #112 passed |
| `a0c7dbac35b8bd11fd570fa696077e0ce328e86d` | Correct same-document hash link outcome expectations | CI #113 passed |
| `c9272a68111724b349b62fa43be6466844152018` | Add hash-link regression tests | CI #114 passed |
| `edb02367426a70a8518730fe1991ce4589496db0` | Report blocked and unresolved actions; avoid false PASSED status | CI #115 pending at time of update |

**Release position:** implementation is not declared complete yet. Fixture-app E2E, production build/deployment, report/evidence inspection, and unresolved-coverage scenarios remain release gates.


## 2026-10-10 — Multiple role-based workflow prototype

- Added a role/name selector to Feature / Workflow Testing (Admin, Customer, Student, Teacher, Custom role).
- Added session-local saved-flow cards so a project can draft distinct named flows, reload their prompts, and start each flow separately. Each run prompt is tagged with the selected role and workflow name for the planner/report trace.
- Prototype limitation: saved flows currently live in component state only (not persisted to the database/project after refresh); role-tagging is prompt context, not an authorization boundary. Use dedicated test accounts and verify credentials handling in the runner before relying on role-specific access assertions.
- CI must pass before treating the prototype as ready to demo. Persistent project-level workflow storage and role-specific credential profiles remain follow-up work.

### 2026-10-11 — Recording controls hardening

- The existing shared `SessionVideoRecorder` is used by the autonomous runner and supports pause/resume as separate segments; all successfully uploaded segment URLs are retained in the job/report.
- The status endpoint now rejects invalid recording transitions: pause is allowed only while recording, resume only while paused, and a stopped recording cannot be restarted during the same run.
- The UI exposes pause, resume, and stop-recording controls while a test is running. Stopping the recording does not cancel the test job.
- **Verification:** code committed; latest CI status and live browser behavior still need confirmation. Recording depends on the installed recorder package and configured Supabase Storage permissions; upload failure remains best-effort and is logged rather than reported as a successful video.
