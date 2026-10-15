# Unified Interaction Architecture - Implementation Plan

## Overview

This document outlines the concrete implementation steps for consolidating Open Design AI's interaction layer into a single reliable testing workflow.

## Phase 1: Risk Mitigation (Week 1) - PRIORITY

### Goal
Prevent duplicate clicks and ensure Stagehand doesn't execute actions outside the controlled path.

### Tasks

#### 1.1 Audit Stagehand Integration
- [ ] Review all calls to `stagehand.agent()` in `autonomous-runner.ts`
- [ ] Document every path where Stagehand could trigger actions
- [ ] Identify if Stagehand's `.act()` method is used in Full App mode
- [ ] Map out CDP connection lifecycle

**Files to review:**
- `lib/ai-automation/autonomous-runner.ts`
- `lib/ai-automation/stagehand-agent.ts`
- `lib/ai-automation/runner.ts` (mode selection logic)

#### 1.2 Add Execution Guards
```typescript
// In autonomous-runner.ts and stagehand-agent.ts

const STAGEHAND_MODE = process.env.STAGEHAND_MODE || 'grounding-only'

if (STAGEHAND_MODE === 'grounding-only') {
  // Only allow .observe() and .extract()
  // Block .act() and .click()
  stagehand.disableActions = true
}
```

#### 1.3 Add Action Source Logging
```typescript
// In execution layer
function logAction(action: string, source: 'puppeteer' | 'stagehand', target: any) {
  appendLog(job, 'debug', `[ActionSource] ${action} via ${source}: ${JSON.stringify(target)}`)
}
```

#### 1.4 Verification Test
- [ ] Run Full App test with logging enabled
- [ ] Verify ZERO Stagehand actions execute
- [ ] Confirm all clicks go through Puppeteer

---

## Phase 2: Target Resolution Contract (Week 2)

### Goal
Define browser-agnostic target descriptions and add confidence scoring.

### Tasks

#### 2.1 Create Core Types
```typescript
// lib/ai-automation/grounded-target.ts

export interface GroundedTarget {
  // Semantic properties
  role?: string
  accessibleName?: string
  text?: string
  
  // Structural properties
  tagName?: string
  selector?: string
  href?: string
  
  // Spatial properties
  bounds?: { x: number; y: number; width: number; height: number }
  visualProminence?: number
  
  // Grounding metadata
  confidence: number
  groundedBy: "dom-discovery" | "stagehand" | "visual-analysis" | "hybrid"
  resolvedAt: string
  
  // Safety context
  actionType?: ActionableElementType
  risk?: "safe" | "mutating" | "destructive"
}

export interface TargetResolutionOptions {
  preferStagehand?: boolean
  requireConfidence?: number
  allowFallback?: boolean
}

export interface TargetResolver {
  resolve(description: string, page: Page, options?: TargetResolutionOptions): Promise<GroundedTarget | null>
}
```

#### 2.2 Implement DOM Discovery Resolver
```typescript
// lib/ai-automation/resolvers/dom-resolver.ts

export class DomDiscoveryResolver implements TargetResolver {
  async resolve(description: string, page: Page, options?: TargetResolutionOptions): Promise<GroundedTarget | null> {
    // Use existing inspectPageDom logic
    const state = await readPatternState(page, description)
    
    // Find best match
    const element = await this.findElementByDescription(state.elements, description)
    
    if (!element) {
      return null
    }
    
    // Calculate confidence based on match quality
    const confidence = this.calculateConfidence(element, description)
    
    return {
      selector: element.selector,
      role: element.role,
      accessibleName: element.label,
      text: element.text,
      tagName: element.tag,
      bounds: element.bounds,
      confidence,
      groundedBy: "dom-discovery",
      resolvedAt: new Date().toISOString(),
      actionType: this.classifyActionType(element),
      risk: this.assessRisk(element)
    }
  }
  
  private calculateConfidence(element: any, description: string): number {
    // Score based on:
    // - Exact text match: +0.4
    // - Role match: +0.3
    // - Accessibility name match: +0.3
    // Return value between 0 and 1
  }
}
```

#### 2.3 Implement Stagehand Grounding Resolver (Fallback)
```typescript
// lib/ai-automation/resolvers/stagehand-resolver.ts

export class StagehandGroundingResolver implements TargetResolver {
  constructor(private stagehand: any) {}
  
  async resolve(description: string, page: Page, options?: TargetResolutionOptions): Promise<GroundedTarget | null> {
    try {
      // Use Stagehand's observe() to identify element
      const observation = await this.stagehand.observe({
        instruction: `Find the element matching: ${description}`,
        useVision: true
      })
      
      // Extract selector from Stagehand's result
      const selector = this.extractSelector(observation)
      
      if (!selector) {
        return null
      }
      
      // Verify element still exists in Puppeteer page
      const element = await page.$(selector)
      if (!element) {
        return null
      }
      
      // Get element details from Puppeteer
      const details = await element.evaluate((el: HTMLElement) => ({
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label') || el.textContent?.trim(),
        tag: el.tagName.toLowerCase(),
        bounds: el.getBoundingClientRect()
      }))
      
      return {
        selector,
        role: details.role || undefined,
        accessibleName: details.label || undefined,
        text: details.label || undefined,
        tagName: details.tag,
        bounds: details.bounds,
        confidence: observation.confidence || 0.7, // Stagehand's confidence
        groundedBy: "stagehand",
        resolvedAt: new Date().toISOString(),
        actionType: this.classifyFromTag(details.tag),
        risk: "safe" // Conservative default
      }
    } catch (error) {
      console.error('[StagehandResolver] Failed:', error)
      return null
    }
  }
}
```

#### 2.4 Implement Composite Resolver
```typescript
// lib/ai-automation/resolvers/composite-resolver.ts

export class CompositeTargetResolver implements TargetResolver {
  constructor(
    private domResolver: DomDiscoveryResolver,
    private stagehandResolver: StagehandGroundingResolver | null
  ) {}
  
  async resolve(description: string, page: Page, options?: TargetResolutionOptions): Promise<GroundedTarget | null> {
    // Try DOM discovery first
    const domResult = await this.domResolver.resolve(description, page, options)
    
    if (domResult && domResult.confidence >= (options?.requireConfidence || 0.7)) {
      return domResult
    }
    
    // If DOM confidence is low and Stagehand is available, try semantic grounding
    if (this.stagehandResolver && (options?.preferStagehand || domResult?.confidence < 0.7)) {
      const stagehandResult = await this.stagehandResolver.resolve(description, page, options)
      
      // Compare results if both succeeded
      if (domResult && stagehandResult) {
        // Log discrepancy for analysis
        this.logGroundingComparison(description, domResult, stagehandResult)
        
        // Prefer higher confidence
        return stagehandResult.confidence > domResult.confidence ? stagehandResult : domResult
      }
      
      return stagehandResult || domResult
    }
    
    // No fallback allowed or no Stagehand available
    if (!options?.allowFallback) {
      return null
    }
    
    return domResult
  }
}
```

---

## Phase 3: Unified Action Interface (Week 3)

### Goal
Single execution path with automatic safety, recording, and verification.

### Tasks

#### 3.1 Define InteractionEngine Interface
```typescript
// lib/ai-automation/interaction-engine.ts

export interface PageSnapshot {
  url: string
  title: string
  viewport: { width: number; height: number }
  elements: ActionableElement[]
  forms: any[]
  tables: any[]
  dialogs: any[]
  visualFeatures?: VisualFeatures
  loading: boolean
  consoleErrorCount: number
  networkFailures: number
}

export interface ActionResult {
  success: boolean
  observation: string
  stateChanged: boolean
  beforeScreenshot?: string
  afterScreenshot?: string
  networkActivity?: string[]
  consoleErrors?: string[]
  blocked?: boolean
  blockReason?: string
  durationMs: number
  timestamp: string
}

export interface ExpectedOutcome {
  type: "state_change" | "navigation" | "modal_open" | "modal_close" | "data_load" | "validation_error"
  description: string
  timeout?: number
}

export interface VerificationResult {
  verified: boolean
  observation: string
  evidence?: any
}

export interface InteractionEngine {
  inspect(): Promise<PageSnapshot>
  resolveTarget(description: string, options?: TargetResolutionOptions): Promise<GroundedTarget | null>
  click(target: GroundedTarget, options?: ActionOptions): Promise<ActionResult>
  type(target: GroundedTarget, value: string, options?: ActionOptions): Promise<ActionResult>
  navigate(url: string): Promise<ActionResult>
  verify(expected: ExpectedOutcome): Promise<VerificationResult>
  waitFor(condition: string, timeout?: number): Promise<boolean>
}
```

#### 3.2 Implement PuppeteerInteractionEngine
```typescript
// lib/ai-automation/engines/puppeteer-engine.ts

export class PuppeteerInteractionEngine implements InteractionEngine {
  constructor(
    private page: Page,
    private job: AutomationJob,
    private resolver: TargetResolver,
    private recorder?: SessionVideoRecorder
  ) {}
  
  async inspect(): Promise<PageSnapshot> {
    const state = await readPatternState(this.page, this.page.url())
    
    // Get visual features if available
    let visualFeatures: VisualFeatures | undefined
    try {
      const screenshot = await this.page.screenshot({ type: "png" })
      if (screenshot) {
        const { preprocessScreenshotForLaya } = await import("./vision-preprocessor")
        visualFeatures = await preprocessScreenshotForLaya(Buffer.from(screenshot), state.elements)
      }
    } catch {}
    
    return {
      url: state.url,
      title: state.title,
      viewport: state.viewport,
      elements: state.elements,
      forms: state.forms,
      tables: state.tables,
      dialogs: state.dialogs,
      visualFeatures,
      loading: state.loading,
      consoleErrorCount: state.consoleErrorCount || 0,
      networkFailures: state.network?.failedCount || 0
    }
  }
  
  async resolveTarget(description: string, options?: TargetResolutionOptions): Promise<GroundedTarget | null> {
    return this.resolver.resolve(description, this.page, options)
  }
  
  async click(target: GroundedTarget, options?: ActionOptions): Promise<ActionResult> {
    const startTime = Date.now()
    const beforeUrl = this.page.url()
    
    // Safety checks
    const safetyCheck = await this.performSafetyChecks(target)
    if (!safetyCheck.safe) {
      return {
        success: false,
        observation: safetyCheck.reason,
        stateChanged: false,
        blocked: true,
        blockReason: safetyCheck.reason,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      }
    }
    
    // Capture before state
    const beforeScreenshot = options?.recordEvidence ? 
      await this.page.screenshot({ type: 'png' }).then(b => `data:image/png;base64,${Buffer.from(b).toString('base64')}`) : 
      undefined
    
    // Execute click through existing human-like action
    try {
      if (!target.selector) {
        throw new Error('No selector available for click')
      }
      
      const element = await this.page.$(target.selector)
      if (!element) {
        throw new Error('Element not found: ' + target.selector)
      }
      
      // Use existing humanClick if human-like option is set
      if (options?.humanLike) {
        await animateCursorToSelector(this.page, target.selector)
        await humanClick(this.page, target.selector)
      } else {
        await element.click()
      }
      
      // Wait for any transitions
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Capture after state
      const afterUrl = this.page.url()
      const afterScreenshot = options?.recordEvidence ? 
        await this.page.screenshot({ type: 'png' }).then(b => `data:image/png;base64,${Buffer.from(b).toString('base64')}`) : 
        undefined
      
      const stateChanged = beforeUrl !== afterUrl || beforeScreenshot !== afterScreenshot
      
      return {
        success: true,
        observation: `Clicked ${target.accessibleName || target.selector}`,
        stateChanged,
        beforeScreenshot,
        afterScreenshot,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      }
    } catch (error: any) {
      return {
        success: false,
        observation: `Click failed: ${error.message}`,
        stateChanged: false,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      }
    }
  }
  
  private async performSafetyChecks(target: GroundedTarget): Promise<{ safe: boolean; reason?: string }> {
    // Use existing safety guards
    if (target.risk === 'destructive') {
      return { safe: false, reason: 'Destructive action blocked by safety policy' }
    }
    
    // Check production environment
    const isProd = await isProductionLike(this.page)
    if (isProd && target.risk === 'mutating') {
      return { safe: false, reason: 'Mutating action blocked in production-like environment' }
    }
    
    return { safe: true }
  }
  
  // Implement other methods similarly...
}
```

#### 3.3 Update human-test-loop.ts
```typescript
// Replace direct Puppeteer calls with InteractionEngine

export async function runHumanLikeDecisionLoop(
  job: AutomationJob,
  page: Page,
  options?: { /* ... */ },
): Promise<{ /* ... */ }> {
  
  // Create interaction engine
  const resolver = new CompositeTargetResolver(
    new DomDiscoveryResolver(),
    null // No Stagehand in Full App mode yet
  )
  
  const engine = new PuppeteerInteractionEngine(page, job, resolver)
  
  for (let step = 0; step < maxSteps; step++) {
    // Inspect page
    const snapshot = await engine.inspect()
    
    // Generate candidates (existing logic)
    const candidates = generateCandidateTests(snapshot, { /* ... */ })
    
    // Laya decides (existing logic)
    const selected = await selectWithLaya(candidates, snapshot)
    
    // Resolve target through unified interface
    const target = await engine.resolveTarget(selected.title, {
      requireConfidence: 0.7,
      allowFallback: true
    })
    
    if (!target) {
      appendLog(job, 'warn', `Could not resolve target for: ${selected.title}`)
      continue
    }
    
    // Execute through unified interface
    const result = await engine.click(target, {
      humanLike: true,
      recordEvidence: true
    })
    
    // Record result (existing ledger logic)
    recordLedger(job, selected, result.success ? 'passed' : 'failed', result.observation, /* ... */)
  }
}
```

---

## Phase 4: Evidence & Safety Consolidation (Week 4)

### Tasks

#### 4.1 Unified Evidence Collection
- [ ] Ensure `ActionResult` captures all evidence consistently
- [ ] Consolidate screenshot masking logic
- [ ] Unify network/console log collection
- [ ] Single action ledger update function

#### 4.2 Shared Safety Pipeline
- [ ] Move all safety checks to InteractionEngine
- [ ] Remove duplicate safety logic from individual actions
- [ ] Add safety check logging for audit trail

---

## Phase 5: Selective Stagehand Integration (Week 5+)

### Tasks

#### 5.1 Add Stagehand Grounding Strategy
- [ ] Implement `StagehandGroundingResolver`
- [ ] Add to `CompositeTargetResolver` as optional fallback
- [ ] Add confidence comparison logging

#### 5.2 Quality Measurement
- [ ] Track grounding source for each action
- [ ] Log confidence scores vs success rate
- [ ] Build dataset for threshold tuning

---

## Testing Strategy

### Unit Tests
```typescript
describe('CompositeTargetResolver', () => {
  it('should prefer DOM discovery when confidence is high', async () => {
    // ...
  })
  
  it('should fall back to Stagehand when DOM confidence is low', async () => {
    // ...
  })
  
  it('should fail when confidence is below threshold and fallback disabled', async () => {
    // ...
  })
})
```

### Integration Tests
```typescript
describe('PuppeteerInteractionEngine', () => {
  it('should execute click with safety checks', async () => {
    // ...
  })
  
  it('should block destructive actions', async () => {
    // ...
  })
  
  it('should record evidence for all actions', async () => {
    // ...
  })
})
```

### System Tests
- [ ] Run Full App test on demo app
- [ ] Verify zero duplicate actions
- [ ] Confirm all actions logged with source
- [ ] Check evidence consistency

---

## Success Criteria

- [ ] Zero duplicate clicks detected in logs
- [ ] All actions route through InteractionEngine
- [ ] Safety checks applied 100% of the time
- [ ] Evidence format consistent across all actions
- [ ] Stagehand only used for grounding, not execution
- [ ] Action ledger updates work identically for all grounding sources

---

## Rollback Plan

If issues arise, we can roll back in phases:
1. Disable Stagehand grounding (fall back to DOM only)
2. Keep unified interface but use direct Puppeteer
3. Revert to original implementation

Each phase is independently deployable.
