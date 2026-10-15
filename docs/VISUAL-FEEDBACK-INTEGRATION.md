# Visual Feedback Integration Analysis & Implementation Plan

**Status**: Foundation exists; visual context not fully integrated into decision loop  
**Date**: 2026-10-14  
**Repository**: Design-Review (main branch audit)

---

## Current State: What Already Works

### ✅ Laya Decision Infrastructure (`lib/journey/laya-client.ts`)
- `layaPredict()` supports three decision types:
  - **choice**: Select from labeled options (used for test selection)
  - **noul**: Yes/no probability (used for readiness, blocking issues)
  - **score**: Rank criteria (not yet used in test loop)
- `classifyPage()` accepts optional `screenshotBase64` parameter
- State can be text string OR `{ image, note, text }` object
- Falls back gracefully when Laya server unavailable

### ✅ Action Ledger & Discovery (`lib/ai-automation/full-app-engine.ts`)
- `extractActionableInventory()` → calls `enrichInventoryWithLaya()` 
- Identifies primary actions, auth flows, navigation tabs
- Maintains stable action keys across screen states
- Merges discovered controls into ledger
- Queues unplanned actions for coverage

### ✅ Human-Like Test Loop (`lib/ai-automation/human-test-loop.ts`)
- `runHumanLikeDecisionLoop()` generates candidates from DOM
- Calls `layaPredict()` with structured page state (URL, forms, tables, errors)
- Records before/after screenshots via `options.captureScreenshot`
- Builds DOM graph with edges for navigation transitions
- Queues discovered routes for depth-first exploration
- Records action outcomes in ledger

### ✅ Vision Checklist System (`lib/ai-automation/runner.ts`)
- `generateVisionThinkingModelAndChecklist()` from `openrouter.ts`
- Sends screenshot + command text to AI gateway
- Generates `thinkingModel` (screen understanding) + `checklist` test items
- Executes checklist sequentially with "go back and forth" navigation
- Updates job.checklist and stores in messages

---

## The Gap: Vision Not in Next-Test Decision

### 🔴 Problem 1: Screenshot captured but not used for selection

**Current flow:**
```typescript
// human-test-loop.ts line ~924
const beforeScreenshotUrl = await options?.captureScreenshot?.("human-loop-before-" + step)

// line ~947
const result = await layaPredict(layaUrl, {
  state: JSON.stringify({
    url: state.url,
    forms: state.forms.length,
    // ... structured text only, NO SCREENSHOT
  }),
  questions: { next_test: { type: "choice", criteria } }
})
```

**What's missing:**
- Screenshot is captured before action
- Screenshot is NOT included in Laya state for test selection
- Decision made purely from DOM metadata (form count, table rows, error text)
- Visual context (button color, modal z-index, loading spinner) ignored

**Why it matters:**
- Laya Vision can see disabled buttons that DOM reports as enabled
- Can detect overlapping modals blocking primary actions
- Can identify visual hierarchy (large "Save" vs small "Cancel")
- Can spot loading states not reflected in DOM

---

### 🔴 Problem 2: Vision checklist runs separately from discovery loop

**Current architecture:**
- Vision checklist: runs in `runner.ts` "chat" mode from user command
- Discovery loop: runs in "full_app" mode, separate execution path
- No cross-pollination between vision findings and action ledger

**Effect:**
- Vision checklist tests ~10 controls from AI interpretation
- Discovery loop tests all DOM elements via deterministic generation
- Vision insights (e.g., "this modal is blocking the form") don't influence discovery priorities
- Coverage gaps when visual state differs from DOM state

---

### 🔴 Problem 3: Recovery doesn't resume queued coverage

**Current behavior (line ~914):**
```typescript
if (!restored) {
  markDiscoveryIncomplete("Could not return to " + routeToReturn)
  // Sets restorationFailed = true, adds error to job
  // But loop continues to next route or breaks
}
```

**Problem:**
- `routeQueue` contains discovered URLs not yet explored
- If restoration fails, remaining queue is abandoned
- No mechanism to serialize queue and resume later
- User sees "doesn't come back to test it" because queue is lost

---

## Implementation Plan: Wire Visual Context Into Decisions

### Phase 1: Add Screenshot to Laya Test Selection ✨ HIGH IMPACT

**File**: `lib/ai-automation/human-test-loop.ts`  
**Function**: `runHumanLikeDecisionLoop()` line ~947

**Change**:
```typescript
// BEFORE
const result = await layaPredict(layaUrl, {
  state: JSON.stringify({ url: state.url, ... }),
  questions: { next_test: { ... } }
})

// AFTER
const screenshotBase64 = beforeScreenshotUrl 
  ? await fetch(beforeScreenshotUrl).then(r => r.arrayBuffer()).then(buf => Buffer.from(buf).toString('base64'))
  : undefined

const result = await layaPredict(layaUrl, {
  state: screenshotBase64 
    ? { 
        image: screenshotBase64, 
        note: JSON.stringify({ url: state.url, forms: state.forms.length, ... })
      }
    : JSON.stringify({ url: state.url, ... }),
  questions: { next_test: { ... } }
})
```

**Impact**:
- Laya Vision sees the actual rendered UI before choosing next test
- Can detect visual blockers, loading states, modal overlays
- Prioritizes visible, clickable controls over hidden/disabled ones
- Aligns decision with human perception, not just DOM structure

**Risk**: Screenshot download + base64 encoding adds ~200-500ms per decision  
**Mitigation**: Cache screenshot buffer; only convert when Laya available

---

### Phase 2: Feed Vision Checklist Into Action Ledger 🔄 MEDIUM IMPACT

**File**: `lib/ai-automation/runner.ts`  
**Function**: Vision checklist execution block (lines ~1199-1360)

**Change**: After each checklist item passes/fails, record in action ledger

```typescript
// After line ~1318 (checklist item completes)
if (job.actionLedger) {
  const ledgerEntry: ActionLedgerEntry = {
    actionKey: `vision-chk-${item.id}`,
    screenUrl: page.url(),
    screenTitle: await page.title(),
    actionTitle: item.title,
    actionType: item.actionType || "click",
    selector: item.selector,
    status: item.status === "passed" ? "passed" : item.status === "failed" ? "failed" : "blocked",
    timestamp: Date.now(),
    evidence: item.observations || "",
    screenshots: { before: liveScreenshotUrl, after: screenshotUrl }
  }
  
  if (!job.actionLedger.entries) job.actionLedger.entries = []
  job.actionLedger.entries.push(ledgerEntry)
}
```

**Impact**:
- Vision-driven tests become part of unified coverage tracking
- Discovery loop won't re-test controls already validated by vision checklist
- Action ledger becomes single source of truth for "what was tested"

---

### Phase 3: Persist & Resume Route Queue 💾 MEDIUM IMPACT

**File**: `lib/ai-automation/human-test-loop.ts`  
**Location**: Start of loop (line ~825) and error handler (line ~914)

**Change 1: Restore queue from job state**
```typescript
// After line ~825
const routeQueue: Array<{ url: string; returnTo: string }> = 
  job.routeQueue || []  // Load from job if exists
const queuedRoutes = new Set<string>(
  [page.url(), ...routeQueue.map(r => r.url)]
)
```

**Change 2: Save queue to job on every update**
```typescript
// After each routeQueue.push() (e.g., line ~984)
job.routeQueue = [...routeQueue]
saveJob(job)
```

**Change 3: Don't abandon queue on restoration failure**
```typescript
// Line ~914 - replace markDiscoveryIncomplete with:
appendLog(job, "error", `Could not restore ${routeToReturn}; deferring remaining ${routeQueue.length} routes for next run.`)
job.routeQueue = routeQueue  // Persist for recovery
job.restorationPoint = { url: page.url(), timestamp: Date.now() }
saveJob(job)
break  // Exit loop but keep queue
```

**Impact**:
- User can resume exploration from last successful state
- Coverage gaps become resumable work, not lost opportunity
- Bounded loop limit becomes "session boundary" not "coverage ceiling"

---

### Phase 4: OpenCV Visual Diff (Optional) 🔬 LOW PRIORITY

**Context**: No OpenCV integration found in current codebase

**If added later**:
- Compare before/after screenshots pixel-wise
- Detect "nothing changed" false positives (click had no effect)
- Measure visual change magnitude to prioritize impactful actions
- Flag regressions (expected element disappeared after interaction)

**Recommendation**: Defer until Phase 1-3 integrated and validated

---

## Verification Plan

### Phase 1 Test:
1. Run discovery loop on page with modal overlay
2. Verify Laya decision includes screenshot in POST body
3. Check if Laya deprioritizes controls hidden behind modal
4. Compare selection with/without vision (A/B test)

### Phase 2 Test:
1. Run vision checklist on dashboard with 10 controls
2. Verify action ledger contains entries with `actionKey: vision-chk-*`
3. Run discovery loop on same page
4. Confirm no duplicate tests for vision-validated controls

### Phase 3 Test:
1. Set `maxSteps: 5` to force early loop exit
2. Navigate to page with 10+ unvisited routes
3. Check `job.routeQueue` persisted with pending URLs
4. Trigger restoration failure (kill page mid-navigation)
5. Restart job; verify queue reloaded and exploration resumes

---

## Decision: Extend, Don't Rebuild

**Confirmed:**
- ✅ Laya client supports vision input (image + note)
- ✅ Screenshot capture infrastructure exists
- ✅ Action ledger is unified coverage store
- ✅ Discovery loop is decision-driven, not hardcoded

**Missing pieces:**
- 🔴 Wire screenshot into `layaPredict()` call (30 lines)
- 🔴 Record vision checklist in action ledger (20 lines)  
- 🔴 Persist route queue across sessions (40 lines)

**Total integration effort**: ~90 lines of targeted changes across 2 files

**Alternative (rebuild)**: Would require 500+ lines and break existing Laya decision flow

---

## Next Steps

1. **Immediate**: Implement Phase 1 (vision in test selection)
2. **Week 1**: Add Phase 2 (ledger integration)
3. **Week 2**: Add Phase 3 (queue persistence)
4. **Validation**: Run on 3 production apps, compare coverage vs. main branch
5. **Document**: Update ARCHITECTURE.md with visual decision flow diagram

---

## References

- Laya client: `lib/journey/laya-client.ts` lines 25-65 (predict with image)
- Test loop: `lib/ai-automation/human-test-loop.ts` lines 799-1100
- Vision checklist: `lib/ai-automation/runner.ts` lines 1126-1360
- Action ledger: `lib/ai-automation/full-app-engine.ts` lines 1891-2080
