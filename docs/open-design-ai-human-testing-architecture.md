# Open Design AI — Human-Like UI Testing Architecture

## 1. Purpose

Open Design AI must test an application like a disciplined human tester rather than blindly clicking every DOM element.

The system must:
- understand the current screen
- discover meaningful interaction patterns
- generate applicable test cases
- select the most valuable next test
- execute the test
- observe UI, network, console, and resource behavior
- verify expected vs actual outcomes
- correlate evidence into real issues
- recover when appropriate
- continue testing newly revealed states
- know when testing is genuinely complete

The existing MAP → PLAN → EXECUTE workflow and Action Ledger remain the foundation.

## 2. Core Architecture

```
Target App
   ↓
Browser / Playwright
   ↓
Observation / State Builder
(DOM • Screenshot • URL • A11y • Console • Network • Resources)
   ↓
Page Understanding / Model Routing (OmniRoute)
   ↓
Interaction Pattern Engine
   ↓
Candidate Test Generator
   ↓
Laya Decision Engine
   ↓
Action Ledger
   ↓
Test Executor
   ↓
Verification Engine
   ↓
Issue / Evidence OR New State
   ↓
Next decision
```

## 3. Responsibility Boundaries

### Browser / Playwright
Responsible for physical browser interaction:
- click, fill, select, key press
- navigate, back, forward, reload
- switch tabs/windows
- wait for UI stability
- screenshots

It must not decide what should be tested.

### Observation / State Builder
Capture:
- URL/route
- buttons, links/hrefs, inputs, selects, checkboxes/radios
- tabs, menus, dialogs/modals, popups
- forms, tables/grids, pagination
- search/filter/sort controls
- loading/empty states
- screenshots and accessibility metadata
- console errors/exceptions
- network requests/status codes
- failed resources
- relevant DOM changes

Raw DOM is not passed everywhere. Create a compact deterministic state representation.

### OmniRoute / Model Routing
OmniRoute remains the model/provider routing layer for:
- page understanding where required
- semantic interpretation
- structured extraction from difficult UI states
- future model/provider substitution

OmniRoute does not own the testing loop or complete test strategy.

### Interaction Pattern Engine
Defines the testing universe and deterministically detects reusable patterns.

Initial categories:

**Navigation:** internal/external links, routes, back, forward, refresh, redirect, deep links, history.

**Actions:** buttons, icon buttons, toggles, checkbox/radio, expand/collapse, show/hide, save, delete, cancel, undo.

**Overlays:** modal, popup, dropdown, popover, tooltip, context menu.

**Forms:** required/invalid/valid validation, dependent fields, password confirmation, submit, cancel, reset, multi-step, back/next, persistence.

**Data:** table/grid loading, empty state, pagination, sorting, filtering, search, create/update/delete, refresh, stale/duplicate data.

**Authentication:** login, logout, session expiry, protected routes, authorization/roles, unauthorized access.

**Async:** loading, success, error, retry, timeout, network failure.

**Responsive/Accessibility:** viewport/layout, overflow/clipping, keyboard navigation, focus, focus restoration, accessible names, responsive controls.

The pattern engine should be deterministic and model-independent wherever possible.

### Candidate Test Generator
Converts detected patterns into concrete tests.

Example:
```
Detected:
- Orders table
- Search input
- Add Order button
- Pagination

Candidates:
T01 Verify table loads
T02 Test search
T03 Test Add Order
T04 Test pagination
T05 Test refresh
T06 Test back navigation
```

Each candidate includes:
- stable test ID
- pattern and target
- preconditions
- action sequence
- expected result
- risk/destructive flag
- priority
- dependencies
- state constraints

Do not expose thousands of raw DOM elements as model decisions.

### Laya Decision Engine
Laya selects the next test from valid candidates.

Laya answers: "Which meaningful test should we run next from the candidates available in this state?"

Laya must not invent arbitrary browser commands.

Input:
- current structured state
- candidate tests
- Action Ledger history
- already-tested patterns
- unresolved issues
- risk and coverage information
- current goal

Output:
- selected test ID
- confidence/probability when supported
- optional decision metadata

The deterministic controller validates the selected test.

### Action Ledger
The Action Ledger is the source of truth for the run.

Record at minimum:
```ts
type ActionLedgerEntry = {
  id: string
  timestamp: string
  stateId: string
  action: string
  actionType: string
  target?: string
  expected?: unknown
  actual?: unknown
  decision?: {
    engine: string
    candidateIds: string[]
    selectedId: string
    confidence?: number
  }
  consoleEvents: unknown[]
  networkEvents: unknown[]
  resourceFailures: unknown[]
  screenshots: string[]
  issueIds: string[]
  recovery?: unknown
  status: "passed" | "failed" | "blocked" | "skipped"
}
```

Every important action must be reproducible from the Ledger.

### Test Executor
Executes only validated actions.

Before execution:
- validate target and preconditions
- check destructive-risk policy
- record intended action

After execution:
- wait for stable state
- collect observations
- write result to Ledger

### Verification Engine
Determines whether the application actually behaved correctly.

Never treat click completion, HTTP 200, a success toast, or absence of an obvious error as proof by itself.

Verify actual UI and data state.

Example:
```
Create order
→ API 200
→ success toast
→ verify order appears in table
→ navigate away
→ return
→ verify order persists
```

## 4. Diagnostic Correlation

Errors must be correlated rather than reported independently.

Example:
```
Action: Click "Load Orders"

Observations:
- GET /api/orders → 500
- Console → TypeError
- Orders table → 0 rows
- Empty-state message → missing

Result:
ONE issue: "Orders failed to load"

Evidence:
- action
- URL
- screenshot
- network request
- console error
- UI state
```

Supported diagnostics include console errors, uncaught exceptions, 4xx/5xx responses, network failures, 404 resources, missing media, failed fonts/CSS/JS, empty tables/grids, missing empty states, UI/data inconsistencies, and loading states that never resolve.

Expected empty states and legitimate third-party failures must not automatically become defects.

## 5. Human-Like Testing Loop

```
OBSERVE
  ↓
UNDERSTAND STATE
  ↓
DETECT PATTERNS
  ↓
GENERATE CANDIDATES
  ↓
FILTER ALREADY-TESTED / INVALID TESTS
  ↓
Laya SELECTS NEXT TEST
  ↓
RECORD DECISION
  ↓
EXECUTE
  ↓
OBSERVE CONSEQUENCES
  ↓
VERIFY
  ↓
CORRELATE EVIDENCE
  ↓
PASS / ISSUE / BLOCKED
  ↓
RECOVER IF APPROPRIATE
  ↓
UPDATE LEDGER
  ↓
DISCOVER NEW STATE
  ↓
GENERATE NEW CANDIDATES
  ↓
REPEAT
```

## 6. State Model

A state represents a meaningful testing context, not merely a URL.

```ts
type TestState = {
  id: string
  url: string
  route: string
  title?: string
  visibleElements: unknown[]
  patterns: string[]
  forms: unknown[]
  tables: unknown[]
  dialogs: unknown[]
  networkSummary: unknown[]
  consoleSummary: unknown[]
  resourceFailures: unknown[]
  screenshot?: string
  parentStateId?: string
  triggeredByActionId?: string
}
```

Two states with the same URL may differ when a modal is open, tab/filter is selected, form contains data, pagination changed, or authentication state changed.

## 7. Recovery

Recovery must be controlled and recorded:
- wait for loading
- retry once
- refresh
- reopen modal
- return to previous page
- retry a non-destructive action
- choose an alternative valid path

Never hide the original failure. Every recovery becomes another Ledger entry.

## 8. Completion Criteria

Do not report complete merely because all discovered buttons were clicked.

A run is complete only when:
- meaningful reachable states have been evaluated
- applicable interaction patterns have been considered
- candidate tests are exhausted or intentionally skipped
- recoverable paths are handled
- destructive tests are explicitly excluded or approved
- issues are correlated and deduplicated
- important outcomes have evidence
- no pending high-value test remains
- the agent has a defensible reason to stop

## 9. Safety / Human Approval

Pause for human approval when an action may:
- make a real purchase
- send a real message/email
- delete production data
- change production configuration
- expose secrets
- perform irreversible external actions
- require an email confirmation or user-owned approval

Credentials and API keys must be collected securely and redacted from screenshots, logs, console output, and the Action Ledger.

## 10. Implementation Order

### Phase 1 — Pattern Registry
Create the deterministic interaction-pattern and test-case registry.

### Phase 2 — State Builder
Normalize DOM, accessibility, screenshot, network, console, resource, and UI-state observations.

### Phase 3 — Candidate Generator
Generate applicable tests from detected patterns.

### Phase 4 — Laya Decision Engine
Connect the existing Laya integration through:
```ts
interface DecisionEngine {
  chooseNextTest(
    context: TestDecisionContext
  ): Promise<TestDecision>
}
```

Implement a deterministic fallback:
```
DecisionEngine
├── LayaDecisionEngine
└── RuleBasedDecisionEngine
```

### Phase 5 — Ledger Integration
Record candidate set, Laya decision, execution, observations, verification, recovery, and issue links.

### Phase 6 — Verification / Correlation
Strengthen expected-vs-actual verification and UI + console + network correlation.

### Phase 7 — Adaptive State Exploration
When an action creates a new modal, form, tab, route, or state, generate new candidates automatically.

### Phase 8 — End-to-End Evaluation
Test representative applications containing navigation, forms, modals, tables, pagination, search/filter, authentication, API failures, console errors, broken resources, empty states, and responsive layouts.

Measure action success rate, issue-detection precision, duplicate issue rate, false-positive rate, state coverage, interaction-pattern coverage, time per tested state, and decision latency.

## 11. Non-Goals

Do not:
- replace the existing MAP → PLAN → EXECUTE workflow
- replace OmniRoute
- let Laya directly control arbitrary browser commands
- send the entire raw DOM to every model call
- treat every console warning as an issue
- treat every empty table as a defect
- click every element without a test purpose
- declare success based only on API status
- declare completion based only on clicked-element count

## 12. Architectural Principle

> **The testing engine defines what can be tested. Laya decides what should be tested next. Playwright executes it. The verifier decides whether it worked. The Action Ledger remembers everything.**

This separation keeps Open Design AI fast, auditable, deterministic where possible, and flexible about which AI model/provider is used.

## 13. Target Result

The final agent should:
1. inspect the current screen
2. build a structured state
3. identify applicable interaction patterns
4. generate meaningful test candidates
5. have Laya select the next test
6. execute it through Playwright
7. observe and verify the result
8. correlate failures into evidence-backed issues
9. discover new states and generate new candidates
10. repeat until completion criteria are satisfied

The objective is not to make a model click like a human. The objective is to build a testing system that reasons about application state like a disciplined human tester while using AI only where it adds value.
