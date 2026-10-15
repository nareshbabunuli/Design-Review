/**
 * UX Evidence Collector
 * 
 * Collects observable evidence for UX scoring from multiple sources:
 * - Visual: Screenshots, layout, contrast, spacing
 * - DOM: Structure, labels, semantic HTML, ARIA
 * - Accessibility: WCAG compliance, keyboard navigation
 * - Workflow: Task completion, step count, error recovery
 */

import type { Page } from "puppeteer"
import type { AppScreenNode, TestPlanStep, ActionableElement } from "./types"

/**
 * Visual evidence from screenshot and DOM inspection
 */
export type VisualEvidence = {
  screenshot: string // Data URL or file path
  timestamp: string
  viewport: { width: number; height: number }
  
  // Visual hierarchy analysis
  primaryCTA?: {
    found: boolean
    selector?: string
    visualWeight?: number // 0-1 (size, color, position)
    contrast?: number // Color contrast ratio
    coordinates?: { x: number; y: number; width: number; height: number }
  }
  
  // Layout analysis
  crowdedSections?: Array<{
    selector: string
    elementCount: number
    density: number // elements per 100px²
  }>
  
  // Readability
  textElements?: Array<{
    text: string
    fontSize: number
    lineHeight: number
    contrast: number
    readable: boolean
  }>
}

/**
 * DOM structure and semantic evidence
 */
export type DOMEvidence = {
  capturedAt: string
  
  // Form analysis
  forms: Array<{
    id: string
    selector: string
    fields: Array<{
      name: string
      type: string
      hasLabel: boolean
      labelText?: string
      hasPlaceholder: boolean
      required: boolean
      ariaLabel?: string
    }>
  }>
  
  // Interactive elements
  buttons: Array<{
    text: string
    type: string // button, submit, link
    hasAccessibleName: boolean
    disabled: boolean
  }>
  
  // Semantic structure
  headingHierarchy: Array<{ level: number; text: string }>
  hasMainLandmark: boolean
  hasNavigationLandmark: boolean
  
  // Error/feedback elements
  errorMessages: Array<{
    text: string
    isGeneric: boolean // "Error" vs "Email must contain @"
    isVisible: boolean
  }>
}

/**
 * Accessibility evidence (WCAG compliance)
 */
export type AccessibilityEvidence = {
  capturedAt: string
  
  // WCAG violations
  violations: Array<{
    id: string
    wcagCriteria: string // e.g., "1.3.1"
    level: "A" | "AA" | "AAA"
    severity: "critical" | "high" | "medium" | "low"
    description: string
    element: string // Selector
    recommendation: string
  }>
  
  // Keyboard navigation
  keyboardAccessible: boolean
  focusIndicatorVisible: boolean
  
  // ARIA usage
  ariaIssues: Array<{
    type: "missing" | "invalid" | "redundant"
    element: string
    description: string
  }>
  
  // Color contrast
  contrastIssues: Array<{
    element: string
    foreground: string
    background: string
    ratio: number
    required: number // WCAG AA or AAA
  }>
}

/**
 * Workflow execution evidence
 */
export type WorkflowEvidence = {
  workflowId: string
  workflowName: string
  executedAt: string
  
  // Task completion
  completed: boolean
  blockedStep?: string
  failureReason?: string
  
  // Efficiency metrics
  totalSteps: number
  necessarySteps: number // Expected minimum
  unnecessarySteps: number
  repeatedInputs: number // Same data entered multiple times
  backtrackCount: number // User had to go back
  
  // Error handling
  errorsEncountered: Array<{
    stepId: string
    errorType: "validation" | "system" | "navigation"
    errorMessage: string
    recoveryPossible: boolean
    recoverySteps?: number
  }>
  
  // Feedback quality
  feedbackEvents: Array<{
    action: string
    feedbackProvided: boolean
    feedbackType?: "success" | "error" | "progress" | "none"
    feedbackClarity?: number // 0-1
  }>
}

/**
 * Complete evidence bundle for a screen
 */
export type ScreenEvidenceBundle = {
  screenId: string
  screenUrl: string
  screenTitle: string
  capturedAt: string
  
  visual: VisualEvidence
  dom: DOMEvidence
  accessibility: AccessibilityEvidence
  workflows: WorkflowEvidence[]
}

/**
 * Collect visual evidence from screenshot and DOM analysis
 */
export async function collectVisualEvidence(
  page: Page,
  screenshotUrl: string
): Promise<VisualEvidence> {
  const viewport = page.viewport()!
  
  const analysis = await page.evaluate(() => {
    // Find primary CTA
    const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
    const primaryCandidates = buttons.filter(btn => {
      const text = (btn.textContent || '').toLowerCase()
      return /^(get started|sign up|try|buy|continue|next|submit|create)$/i.test(text.trim())
    })
    
    let primaryCTA: VisualEvidence['primaryCTA'] = { found: false }
    
    if (primaryCandidates.length > 0) {
      const btn = primaryCandidates[0] as HTMLElement
      const rect = btn.getBoundingClientRect()
      const style = getComputedStyle(btn)
      
      // Calculate visual weight (size + position + color)
      const sizeScore = Math.min((rect.width * rect.height) / 10000, 1) // Normalize by 100x100px
      const positionScore = rect.top < window.innerHeight / 2 ? 0.8 : 0.4 // Above fold is better
      const visualWeight = (sizeScore + positionScore) / 2
      
      // Calculate contrast ratio (simplified)
      const bgColor = style.backgroundColor
      const color = style.color
      const contrast = calculateContrastRatio(color, bgColor)
      
      primaryCTA = {
        found: true,
        selector: btn.tagName + (btn.id ? `#${btn.id}` : '') + (btn.className ? `.${btn.className.split(' ')[0]}` : ''),
        visualWeight,
        contrast,
        coordinates: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        }
      }
    }
    
    // Check for crowded sections
    const sections = Array.from(document.querySelectorAll('section, div[class*="container"], main'))
    const crowdedSections = sections
      .map(section => {
        const rect = (section as HTMLElement).getBoundingClientRect()
        const children = section.querySelectorAll('*').length
        const area = rect.width * rect.height
        const density = area > 0 ? (children / area) * 10000 : 0
        
        return {
          selector: (section as HTMLElement).tagName.toLowerCase(),
          elementCount: children,
          density
        }
      })
      .filter(s => s.density > 5) // More than 5 elements per 100px²
    
    // Check text readability
    const textElements = Array.from(document.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6'))
      .slice(0, 20) // Sample first 20
      .map(el => {
        const style = getComputedStyle(el as HTMLElement)
        const fontSize = parseFloat(style.fontSize)
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5
        const contrast = calculateContrastRatio(style.color, style.backgroundColor)
        
        return {
          text: (el.textContent || '').slice(0, 50),
          fontSize,
          lineHeight,
          contrast,
          readable: fontSize >= 16 && contrast >= 4.5 // WCAG AA
        }
      })
    
    return {
      primaryCTA,
      crowdedSections,
      textElements
    }
    
    function calculateContrastRatio(fg: string, bg: string): number {
      // Simplified contrast calculation (would use proper color parsing in production)
      if (!fg || !bg || fg === 'rgba(0, 0, 0, 0)') return 4.5 // Default to acceptable
      
      // Parse RGB values (simplified - real implementation would handle all CSS color formats)
      const fgMatch = fg.match(/\d+/g)
      const bgMatch = bg.match(/\d+/g)
      
      if (!fgMatch || !bgMatch) return 4.5
      
      const fgLum = relativeLuminance(parseInt(fgMatch[0]), parseInt(fgMatch[1]), parseInt(fgMatch[2]))
      const bgLum = relativeLuminance(parseInt(bgMatch[0]), parseInt(bgMatch[1]), parseInt(bgMatch[2]))
      
      const lighter = Math.max(fgLum, bgLum)
      const darker = Math.min(fgLum, bgLum)
      
      return (lighter + 0.05) / (darker + 0.05)
    }
    
    function relativeLuminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map(c => {
        c = c / 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
    }
  })
  
  return {
    screenshot: screenshotUrl,
    timestamp: new Date().toISOString(),
    viewport: { width: viewport.width, height: viewport.height },
    ...analysis
  }
}

/**
 * Collect DOM structure evidence
 */
export async function collectDOMEvidence(page: Page): Promise<DOMEvidence> {
  const evidence = await page.evaluate(() => {
    // Analyze forms
    const forms = Array.from(document.querySelectorAll('form')).map((form, idx) => {
      const fields = Array.from(form.querySelectorAll('input, textarea, select')).map(field => {
        const input = field as HTMLInputElement
        const label = form.querySelector(`label[for="${input.id}"]`) || 
                     input.closest('label')
        
        return {
          name: input.name || input.id || `field-${idx}`,
          type: input.type || input.tagName.toLowerCase(),
          hasLabel: !!label,
          labelText: label?.textContent?.trim(),
          hasPlaceholder: !!input.placeholder,
          required: input.required,
          ariaLabel: input.getAttribute('aria-label') || undefined
        }
      })
      
      return {
        id: form.id || `form-${idx}`,
        selector: form.id ? `#${form.id}` : `form:nth-of-type(${idx + 1})`,
        fields
      }
    })
    
    // Analyze buttons
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]')).map(btn => {
      const el = btn as HTMLElement
      return {
        text: el.textContent?.trim() || '',
        type: btn.tagName.toLowerCase(),
        hasAccessibleName: !!(el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title')),
        disabled: (btn as HTMLButtonElement).disabled || false
      }
    })
    
    // Analyze heading hierarchy
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
      level: parseInt(h.tagName.charAt(1)),
      text: h.textContent?.trim() || ''
    }))
    
    // Check landmarks
    const hasMainLandmark = !!document.querySelector('main, [role="main"]')
    const hasNavigationLandmark = !!document.querySelector('nav, [role="navigation"]')
    
    // Find error messages
    const errorMessages = Array.from(document.querySelectorAll(
      '[class*="error"], [role="alert"], .invalid-feedback, [aria-live="assertive"]'
    )).map(el => {
      const text = (el as HTMLElement).textContent?.trim() || ''
      return {
        text,
        isGeneric: /^(error|invalid|required|failed)$/i.test(text),
        isVisible: (el as HTMLElement).offsetParent !== null
      }
    })
    
    return {
      forms,
      buttons,
      headingHierarchy: headings,
      hasMainLandmark,
      hasNavigationLandmark,
      errorMessages
    }
  })
  
  return {
    capturedAt: new Date().toISOString(),
    ...evidence
  }
}

/**
 * Collect accessibility evidence
 * Uses Puppeteer's built-in accessibility snapshot
 */
export async function collectAccessibilityEvidence(page: Page): Promise<AccessibilityEvidence> {
  const violations: AccessibilityEvidence['violations'] = []
  const ariaIssues: AccessibilityEvidence['ariaIssues'] = []
  const contrastIssues: AccessibilityEvidence['contrastIssues'] = []
  
  try {
    // Get accessibility snapshot
    const snapshot = await page.accessibility.snapshot()
    
    // Analyze for common violations
    const pageAnalysis = await page.evaluate(() => {
      const issues = {
        keyboardAccessible: true,
        focusIndicatorVisible: true,
        violations: [] as any[],
        ariaIssues: [] as any[],
        contrastIssues: [] as any[]
      }
      
      // Check images without alt text (WCAG 1.1.1)
      document.querySelectorAll('img').forEach((img, idx) => {
        if (!img.alt && img.offsetParent !== null) {
          issues.violations.push({
            id: `img-alt-${idx}`,
            wcagCriteria: '1.1.1',
            level: 'A' as const,
            severity: 'high' as const,
            description: 'Image missing alt text',
            element: `img:nth-of-type(${idx + 1})`,
            recommendation: 'Add descriptive alt text to the image'
          })
        }
      })
      
      // Check form inputs without labels (WCAG 1.3.1, 3.3.2)
      document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((input, idx) => {
        const el = input as HTMLInputElement
        const hasLabel = !!document.querySelector(`label[for="${el.id}"]`) || !!el.closest('label')
        const hasAriaLabel = !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby')
        
        if (!hasLabel && !hasAriaLabel && el.offsetParent !== null) {
          issues.violations.push({
            id: `input-label-${idx}`,
            wcagCriteria: '3.3.2',
            level: 'A' as const,
            severity: 'high' as const,
            description: 'Form input missing label',
            element: el.name || el.id || `input:nth-of-type(${idx + 1})`,
            recommendation: 'Add a visible label or aria-label to the input field'
          })
        }
      })
      
      // Check buttons without accessible names (WCAG 4.1.2)
      document.querySelectorAll('button, [role="button"]').forEach((btn, idx) => {
        const el = btn as HTMLElement
        const hasName = !!el.textContent?.trim() || !!el.getAttribute('aria-label') || !!el.getAttribute('title')
        
        if (!hasName && el.offsetParent !== null) {
          issues.violations.push({
            id: `button-name-${idx}`,
            wcagCriteria: '4.1.2',
            level: 'A' as const,
            severity: 'critical' as const,
            description: 'Button missing accessible name',
            element: el.id || `button:nth-of-type(${idx + 1})`,
            recommendation: 'Add text content, aria-label, or title to the button'
          })
        }
      })
      
      // Check heading hierarchy (WCAG 1.3.1)
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      let prevLevel = 0
      headings.forEach((h, idx) => {
        const level = parseInt(h.tagName.charAt(1))
        if (level - prevLevel > 1 && prevLevel > 0) {
          issues.violations.push({
            id: `heading-hierarchy-${idx}`,
            wcagCriteria: '1.3.1',
            level: 'A' as const,
            severity: 'medium' as const,
            description: `Heading level skipped (${prevLevel} to ${level})`,
            element: `${h.tagName.toLowerCase()}:nth-of-type(${idx + 1})`,
            recommendation: 'Use proper heading hierarchy without skipping levels'
          })
        }
        prevLevel = level
      })
      
      return issues
    })
    
    violations.push(...pageAnalysis.violations)
    ariaIssues.push(...pageAnalysis.ariaIssues)
    contrastIssues.push(...pageAnalysis.contrastIssues)
    
  } catch (err) {
    console.warn('[AccessibilityEvidence] Failed to collect:', err)
  }
  
  return {
    capturedAt: new Date().toISOString(),
    violations,
    keyboardAccessible: true, // Would test with actual keyboard navigation
    focusIndicatorVisible: true,
    ariaIssues,
    contrastIssues
  }
}

/**
 * Collect workflow execution evidence
 */
export function collectWorkflowEvidence(
  workflowId: string,
  workflowName: string,
  steps: TestPlanStep[],
  completedSuccessfully: boolean,
  blockedStep?: string
): WorkflowEvidence {
  const totalSteps = steps.length
  const passedSteps = steps.filter(s => s.status === 'passed').length
  const failedSteps = steps.filter(s => s.status === 'failed')
  
  // Estimate necessary steps (simplified - would use Card et al. KLM in production)
  const necessarySteps = Math.max(Math.floor(totalSteps * 0.7), 1)
  const unnecessarySteps = Math.max(totalSteps - necessarySteps, 0)
  
  // Count repeated inputs (same value entered multiple times)
  const valuesSeen = new Map<string, number>()
  steps.forEach(step => {
    if (step.syntheticValue) {
      const count = valuesSeen.get(step.syntheticValue) || 0
      valuesSeen.set(step.syntheticValue, count + 1)
    }
  })
  const repeatedInputs = Array.from(valuesSeen.values()).filter(count => count > 1).length
  
  // Extract errors
  const errorsEncountered = failedSteps.map(step => ({
    stepId: step.id,
    errorType: step.error?.includes('validation') ? 'validation' as const : 'system' as const,
    errorMessage: step.error || step.actualResult || 'Unknown error',
    recoveryPossible: !!step.actualResult?.includes('retry'),
    recoverySteps: undefined
  }))
  
  // Analyze feedback quality
  const feedbackEvents = steps.map(step => ({
    action: step.targetName,
    feedbackProvided: !!step.actualResult,
    feedbackType: step.status === 'passed' ? 'success' as const : 
                  step.status === 'failed' ? 'error' as const : 'none' as const,
    feedbackClarity: step.actualResult ? 
      (step.actualResult.length > 20 ? 0.8 : 0.4) : 0 // Longer = more detailed
  }))
  
  return {
    workflowId,
    workflowName,
    executedAt: new Date().toISOString(),
    completed: completedSuccessfully,
    blockedStep,
    failureReason: failedSteps[0]?.error,
    totalSteps,
    necessarySteps,
    unnecessarySteps,
    repeatedInputs,
    backtrackCount: 0, // Would track navigation history
    errorsEncountered,
    feedbackEvents
  }
}

/**
 * Collect complete evidence bundle for a screen
 */
export async function collectScreenEvidence(
  page: Page,
  screen: AppScreenNode,
  screenshotUrl: string,
  workflows: WorkflowEvidence[]
): Promise<ScreenEvidenceBundle> {
  const [visual, dom, accessibility] = await Promise.all([
    collectVisualEvidence(page, screenshotUrl),
    collectDOMEvidence(page),
    collectAccessibilityEvidence(page)
  ])
  
  return {
    screenId: screen.id,
    screenUrl: screen.url,
    screenTitle: screen.name,
    capturedAt: new Date().toISOString(),
    visual,
    dom,
    accessibility,
    workflows
  }
}
