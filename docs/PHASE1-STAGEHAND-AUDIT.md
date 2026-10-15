# Phase 1: Stagehand Integration Audit

**Date**: 2026-10-15  
**Status**: ✅ AUDIT COMPLETE  
**Risk Level**: 🟡 MEDIUM - Stagehand executes actions but only in Autonomous mode

---

## Executive Summary

**Current State**: Stagehand is properly isolated to Autonomous mode only. It does NOT execute actions in Full App Testing mode.

**Key Finding**: No duplicate action risk exists currently, but the architecture could benefit from explicit safeguards to prevent future regressions.

---

## Architecture Analysis

### Mode Routing (runner.ts:840)

```typescript
if (params.mode === "autonomous" || (params.userInstruction && isAutonomousCommand(params.userInstruction))) {
  appendLog(job, "info", "Autonomous exploration requested — handing off to the Stagehand scenario engine.")
  job.mode = "autonomous"
  saveJob(job)
  await executeAutonomousJob(job, params)  // ← Stagehand path
  return  // ← Early return prevents fallthrough
}

// ... Full App Testing continues below (Puppeteer only)
```

**Analysis**: Clean separation. Autonomous mode returns early and never reaches Full App code.

### Stagehand Usage Patterns

| File | Function | Purpose | Executes Actions? |
|------|----------|---------|-------------------|
| `autonomous-runner.ts` | `runScenarioWithStagehand()` | Run planned scenarios | ✅ YES - via `agent.execute()` |
| `stagehand-agent.ts` | `runStagehandExploration()` | Exploratory testing | ✅ YES - via `agent.execute()` |

### Action Execution Points

#### 1. Scenario Runner (`autonomous-runner.ts:431`)
```typescript
const agent = stagehand.agent({
  mode: "hybrid",
  model: { modelName, apiKey, baseURL },
  systemPrompt: scenarioSystemPrompt(...)
})

result = await agent.execute({
  instruction: scenario.instruction,
  maxSteps,
  highlightCursor: true,
  page: stagePage,  // ← Stagehand's Playwright page
})
```

**Context**: Only called from `runScenarioWithStagehand()`, which is only called from `executeAutonomousJob()` in autonomous mode.

#### 2. Exploration Runner (`stagehand-agent.ts:122`)
```typescript
const agent = stagehand.agent({
  mode: "hybrid",
  model: { modelName, apiKey, baseURL },
  systemPrompt: instruction,
})

const result = await agent.execute({
  instruction: `Explore and audit the application...`,
  maxSteps,
  highlightCursor: true,
  page: stagePage,  // ← Stagehand's Playwright page
})
```

**Context**: Only called from `runStagehandExploration()`, which is only called in autonomous mode.

---

## Full App Testing Path Analysis

### Human Test Loop (`human-test-loop.ts`)

**Browser**: Puppeteer  
**Actions**: Direct Puppeteer API calls  
**Stagehand usage**: ❌ NONE

```typescript
export async function runHumanLikeDecisionLoop(
  job: AutomationJob,
  page: Page,  // ← Puppeteer Page
  options?: { maxSteps?: number; layaBaseUrl?: string; captureScreenshot?: (label: string) => Promise<string> },
): Promise<...> {
  // Uses:
  // - readPatternState(page, url)  // Puppeteer
  // - executeCandidate(page, candidate)  // Puppeteer
  // - page.click() / page.type()  // Puppeteer
  
  // NO Stagehand imports or calls
}
```

### Full App Engine (`full-app-engine.ts`)

**Browser**: Puppeteer  
**Actions**: `humanClick()`, `humanType()`, `humanMouseMove()`  
**Stagehand usage**: ❌ NONE

---

## CDP Connection Analysis

Both modes share the same browser via CDP:

```typescript
// Autonomous mode
const stagehand = new Stagehand({
  env: "LOCAL",
  localBrowserLaunchOptions: { 
    cdpUrl: browser.wsEndpoint()  // ← Connects to Puppeteer's browser
  },
  // ...
})
```

**Important**: Stagehand connects to the browser but operates on its own Playwright page handle:
- `stagePage = stagehand.context.activePage()` ← Playwright Page
- `page` (in Full App mode) ← Puppeteer Page

These are different page objects pointing to the same browser tab, but controlled by different APIs.

---

## Risk Assessment

### ✅ Current State is Safe

1. **Mode isolation is clean**: Early return in `runner.ts` prevents mode mixing
2. **No shared execution path**: Full App never imports or calls Stagehand
3. **Separate page handles**: Even with shared browser, they use different APIs
4. **No cross-contamination**: Autonomous actions don't affect Full App ledger

### 🟡 Potential Future Risks

1. **No explicit guards**: If someone refactors mode routing, they could break isolation
2. **Implicit dependency**: Safety relies on code flow, not explicit checks
3. **No runtime validation**: System doesn't actively prevent Stagehand in wrong mode
4. **No action source logging**: Can't audit which component triggered each action

---

## Recommendations

### Immediate (This Phase)

1. ✅ **Add explicit mode checks** in Stagehand functions
2. ✅ **Add action source logging** for every click/type
3. ✅ **Add runtime guards** to prevent Stagehand execution in Full App mode
4. ✅ **Document the isolation** so future developers don't break it

### Future (Phase 2+)

1. Use Stagehand ONLY for `observe()` and `extract()` in Full App mode
2. Never call `agent.execute()` or `act()` outside Autonomous mode
3. Route all actions through unified `InteractionEngine`

---

## Implementation Tasks

### Task 1.1: Add Mode Guards ✅ READY TO IMPLEMENT

```typescript
// In stagehand-agent.ts and autonomous-runner.ts

function assertAutonomousMode(job: AutomationJob, functionName: string) {
  if (job.mode !== 'autonomous') {
    throw new Error(
      `[SafetyGuard] ${functionName} can only be called in autonomous mode. ` +
      `Current mode: ${job.mode}. This is a programming error.`
    )
  }
}

// Add to start of runStagehandExploration() and runScenarioWithStagehand()
assertAutonomousMode(job, 'runStagehandExploration')
```

### Task 1.2: Add Action Source Logging ✅ READY TO IMPLEMENT

```typescript
// In executeCandidate() and Stagehand action execution

function logActionExecution(
  job: AutomationJob,
  action: string,
  source: 'puppeteer' | 'stagehand',
  target: string,
  mode: string
) {
  appendLog(
    job,
    'debug',
    `[ActionSource] ${action} via ${source} on ${target} (mode=${mode})`
  )
}
```

### Task 1.3: Add Environment Variable Control ✅ READY TO IMPLEMENT

```typescript
// New file: lib/ai-automation/stagehand-config.ts

export const STAGEHAND_CONFIG = {
  // Allows disabling Stagehand execution globally for testing
  ALLOW_EXECUTION: process.env.STAGEHAND_ALLOW_EXECUTION !== 'false',
  
  // Log all Stagehand actions
  LOG_ACTIONS: process.env.STAGEHAND_LOG_ACTIONS !== 'false',
  
  // Modes where Stagehand execution is permitted
  ALLOWED_MODES: ['autonomous'] as const,
}

export function canStagehandExecute(mode: string): boolean {
  if (!STAGEHAND_CONFIG.ALLOW_EXECUTION) {
    return false
  }
  return STAGEHAND_CONFIG.ALLOWED_MODES.includes(mode as any)
}
```

### Task 1.4: Add Verification Test ✅ READY TO IMPLEMENT

```typescript
// New file: tests/stagehand-isolation.test.ts

describe('Stagehand Isolation', () => {
  it('should not execute in Full App mode', async () => {
    const job = createTestJob({ mode: 'full_app' })
    
    await expect(
      runStagehandExploration(job, browser, page, params, hooks)
    ).rejects.toThrow('can only be called in autonomous mode')
  })
  
  it('should execute in Autonomous mode', async () => {
    const job = createTestJob({ mode: 'autonomous' })
    
    await expect(
      runStagehandExploration(job, browser, page, params, hooks)
    ).resolves.toBeDefined()
  })
})
```

---

## Conclusion

**Current risk**: 🟢 LOW - Modes are properly separated  
**Action required**: 🟡 MEDIUM - Add explicit guards to prevent future regressions  
**Urgency**: Medium - Not a current bug, but important architectural safeguard

The codebase is architecturally sound, but relies on implicit flow control rather than explicit guards. Implementing the recommended safeguards will make the isolation explicit and auditable.
