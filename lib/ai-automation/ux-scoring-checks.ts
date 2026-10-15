/**
 * UX Scoring Checks Implementation
 * 
 * Implements research-backed scoring checks for each of the 6 UX dimensions.
 * Each check applies the 5-point rating scale (0=blocked to 4=excellent)
 * based on observable evidence.
 */

import type {
  VisualEvidence,
  DOMEvidence,
  AccessibilityEvidence,
  WorkflowEvidence,
  ScreenEvidenceBundle
} from "./ux-evidence-collector"
import {
  CheckRating,
  type ScoringCheck,
  type UXDimensionKey
} from "./ux-scoring-rubric"

/**
 * Task Effectiveness Checks (25% weight)
 * Based on: ISO 9241-11, Nielsen error prevention, Cognitive walkthrough
 */

export function checkTaskCompletion(workflow: WorkflowEvidence): ScoringCheck {
  let rating: CheckRating
  let evidence: string
  
  if (workflow.completed) {
    rating = CheckRating.EXCELLENT
    evidence = `Workflow "${workflow.workflowName}" completed successfully. All ${workflow.totalSteps} steps executed.`
  } else if (workflow.blockedStep) {
    rating = CheckRating.BLOCKED
    evidence = `Workflow blocked at step "${workflow.blockedStep}". Reason: ${workflow.failureReason || 'Unknown'}`
  } else if (workflow.errorsEncountered.length > workflow.totalSteps / 2) {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${workflow.errorsEncountered.length} errors encountered in ${workflow.totalSteps} steps (>${50}% failure rate)`
  } else if (workflow.errorsEncountered.length > 0) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${workflow.errorsEncountered.length} errors encountered but workflow partially completable`
  } else {
    rating = CheckRating.GOOD
    evidence = `Workflow completed with minor issues. ${workflow.totalSteps} steps executed.`
  }
  
  return {
    id: `TASK-EFF-001-${workflow.workflowId}`,
    dimension: 'taskEffectiveness',
    rule: 'Task completion success rate',
    rating,
    evidence,
    researchReference: 'ISO 9241-11: Effectiveness (goal achievement)',
    confidence: 0.95,
    applicable: true
  }
}

export function checkErrorRecoverability(workflow: WorkflowEvidence): ScoringCheck {
  const recoverableErrors = workflow.errorsEncountered.filter(e => e.recoveryPossible).length
  const totalErrors = workflow.errorsEncountered.length
  
  let rating: CheckRating
  let evidence: string
  
  if (totalErrors === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'No errors encountered during workflow execution'
  } else if (recoverableErrors === totalErrors) {
    rating = CheckRating.GOOD
    evidence = `All ${totalErrors} errors were recoverable with clear recovery paths`
  } else if (recoverableErrors > totalErrors / 2) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${recoverableErrors}/${totalErrors} errors recoverable. Some errors left user stuck.`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `Only ${recoverableErrors}/${totalErrors} errors recoverable. Most errors blocked progress.`
  }
  
  return {
    id: `TASK-EFF-002-${workflow.workflowId}`,
    dimension: 'taskEffectiveness',
    rule: 'Error recoverability',
    rating,
    evidence,
    researchReference: 'Nielsen (1994): Help users recognize, diagnose, and recover from errors',
    confidence: 0.85,
    applicable: totalErrors > 0
  }
}

/**
 * Workflow Efficiency Checks (20% weight)
 * Based on: ISO 9241-11, Card et al. KLM, HEART framework
 */

export function checkStepEfficiency(workflow: WorkflowEvidence): ScoringCheck {
  const efficiency = workflow.necessarySteps / workflow.totalSteps
  
  let rating: CheckRating
  let evidence: string
  
  if (efficiency >= 0.9) {
    rating = CheckRating.EXCELLENT
    evidence = `Highly efficient: ${workflow.totalSteps} steps, only ${workflow.unnecessarySteps} unnecessary`
  } else if (efficiency >= 0.75) {
    rating = CheckRating.GOOD
    evidence = `Good efficiency: ${workflow.totalSteps} steps, ${workflow.unnecessarySteps} could be eliminated`
  } else if (efficiency >= 0.6) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${workflow.unnecessarySteps} unnecessary steps found (${Math.round((1 - efficiency) * 100)}% overhead)`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `Significant inefficiency: ${workflow.unnecessarySteps}/${workflow.totalSteps} steps are unnecessary`
  }
  
  return {
    id: `WORK-EFF-001-${workflow.workflowId}`,
    dimension: 'workflowEfficiency',
    rule: 'Unnecessary step count',
    rating,
    evidence,
    researchReference: 'Card et al. (1980): Keystroke-Level Model - minimize operator count',
    confidence: 0.75, // Estimating necessary steps is heuristic
    applicable: true
  }
}

export function checkRepeatedInputs(workflow: WorkflowEvidence): ScoringCheck {
  let rating: CheckRating
  let evidence: string
  
  if (workflow.repeatedInputs === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'No repeated data entry required'
  } else if (workflow.repeatedInputs <= 1) {
    rating = CheckRating.GOOD
    evidence = `${workflow.repeatedInputs} repeated input (minor redundancy)`
  } else if (workflow.repeatedInputs <= 3) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${workflow.repeatedInputs} repeated inputs found. User must re-enter same data.`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${workflow.repeatedInputs} repeated inputs. Significant data entry redundancy.`
  }
  
  return {
    id: `WORK-EFF-002-${workflow.workflowId}`,
    dimension: 'workflowEfficiency',
    rule: 'Repeated data entry',
    rating,
    evidence,
    researchReference: 'ISO 9241-11: Efficiency (resources expended)',
    confidence: 0.90,
    applicable: true
  }
}

/**
 * Discoverability Checks (15% weight)
 * Based on: Nielsen visibility, Cognitive walkthrough, Fitts' law
 */

export function checkPrimaryCTADiscoverability(visual: VisualEvidence): ScoringCheck {
  const cta = visual.primaryCTA
  
  let rating: CheckRating
  let evidence: string
  
  if (!cta?.found) {
    rating = CheckRating.BLOCKED
    evidence = 'No primary call-to-action found on screen'
  } else if ((cta.visualWeight || 0) >= 0.7 && (cta.contrast || 0) >= 4.5) {
    rating = CheckRating.EXCELLENT
    evidence = `Primary CTA "${cta.selector}" has strong visual prominence (weight: ${cta.visualWeight?.toFixed(2)}, contrast: ${cta.contrast?.toFixed(2)}:1)`
  } else if ((cta.visualWeight || 0) >= 0.5 && (cta.contrast || 0) >= 3.0) {
    rating = CheckRating.GOOD
    evidence = `Primary CTA visible but could be more prominent (weight: ${cta.visualWeight?.toFixed(2)}, contrast: ${cta.contrast?.toFixed(2)}:1)`
  } else if ((cta.contrast || 0) < 3.0) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `Primary CTA has low contrast (${cta.contrast?.toFixed(2)}:1, below WCAG AA 3:1 minimum)`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `Primary CTA difficult to distinguish (weight: ${cta.visualWeight?.toFixed(2)})`
  }
  
  return {
    id: `DISC-001`,
    dimension: 'discoverability',
    rule: 'Primary CTA visual prominence',
    rating,
    evidence,
    researchReference: 'Nielsen (1994): Visibility of system status; Fitts (1954): Target visibility',
    wcagCriteria: cta?.contrast && cta.contrast < 3.0 ? 'WCAG 2.2 AA 1.4.3' : undefined,
    confidence: 0.80, // Visual analysis has some subjectivity
    applicable: true
  }
}

export function checkNavigationClarity(dom: DOMEvidence): ScoringCheck {
  let rating: CheckRating
  let evidence: string
  
  if (dom.hasNavigationLandmark && dom.buttons.filter(b => b.hasAccessibleName).length >= 3) {
    rating = CheckRating.EXCELLENT
    evidence = `Clear navigation structure with ${dom.buttons.length} accessible controls`
  } else if (dom.hasNavigationLandmark) {
    rating = CheckRating.GOOD
    evidence = 'Navigation landmark present but some controls lack accessible names'
  } else if (dom.buttons.length >= 3) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = 'No navigation landmark. Users rely on visual layout alone.'
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = 'Limited navigation options and no semantic structure'
  }
  
  return {
    id: `DISC-002`,
    dimension: 'discoverability',
    rule: 'Navigation structure discoverability',
    rating,
    evidence,
    researchReference: 'Cognitive walkthrough: Will user notice the correct action?',
    wcagCriteria: !dom.hasNavigationLandmark ? 'WCAG 2.2 A 1.3.1' : undefined,
    confidence: 0.85,
    applicable: true
  }
}

/**
 * Feedback & Recovery Checks (15% weight)
 * Based on: Nielsen visibility & error recovery, Hassenzahl pragmatic quality
 */

export function checkFeedbackQuality(workflow: WorkflowEvidence): ScoringCheck {
  const withFeedback = workflow.feedbackEvents.filter(e => e.feedbackProvided).length
  const total = workflow.feedbackEvents.length
  const feedbackRate = total > 0 ? withFeedback / total : 0
  
  let rating: CheckRating
  let evidence: string
  
  if (feedbackRate >= 0.9) {
    rating = CheckRating.EXCELLENT
    evidence = `Consistent feedback: ${withFeedback}/${total} actions acknowledged`
  } else if (feedbackRate >= 0.7) {
    rating = CheckRating.GOOD
    evidence = `Most actions acknowledged: ${withFeedback}/${total} provided feedback`
  } else if (feedbackRate >= 0.5) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `Inconsistent feedback: only ${withFeedback}/${total} actions acknowledged`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `Poor feedback: only ${withFeedback}/${total} actions acknowledged. User left uncertain.`
  }
  
  return {
    id: `FEED-001-${workflow.workflowId}`,
    dimension: 'feedbackRecovery',
    rule: 'Action feedback consistency',
    rating,
    evidence,
    researchReference: 'Nielsen (1994): Visibility of system status',
    confidence: 0.90,
    applicable: total > 0
  }
}

export function checkErrorMessageClarity(dom: DOMEvidence, workflow: WorkflowEvidence): ScoringCheck {
  const genericErrors = dom.errorMessages.filter(e => e.isGeneric && e.isVisible).length
  const totalErrors = workflow.errorsEncountered.length
  
  let rating: CheckRating
  let evidence: string
  
  if (totalErrors === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'No errors encountered'
  } else if (genericErrors === 0) {
    rating = CheckRating.EXCELLENT
    evidence = `All ${totalErrors} error messages are specific and actionable`
  } else if (genericErrors <= totalErrors / 2) {
    rating = CheckRating.GOOD
    evidence = `${totalErrors - genericErrors}/${totalErrors} error messages are specific`
  } else {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${genericErrors}/${totalErrors} error messages are generic (e.g. "Error", "Invalid"). Lacks actionable guidance.`
  }
  
  return {
    id: `FEED-002-${workflow.workflowId}`,
    dimension: 'feedbackRecovery',
    rule: 'Error message clarity',
    rating,
    evidence,
    researchReference: 'Nielsen (1994): Help users recognize, diagnose, and recover from errors',
    confidence: 0.85,
    applicable: totalErrors > 0
  }
}

/**
 * Accessibility & Operability Checks (15% weight)
 * Based on: WCAG 2.2, Fitts' law, Nielsen consistency
 */

export function checkWCAGCompliance(accessibility: AccessibilityEvidence): ScoringCheck {
  const critical = accessibility.violations.filter(v => v.severity === 'critical').length
  const high = accessibility.violations.filter(v => v.severity === 'high').length
  const total = accessibility.violations.length
  
  let rating: CheckRating
  let evidence: string
  
  if (total === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'No WCAG violations detected'
  } else if (critical === 0 && high === 0) {
    rating = CheckRating.GOOD
    evidence = `${total} low-severity WCAG issues found`
  } else if (critical === 0) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${high} high-severity WCAG violations found (no critical)`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${critical} critical + ${high} high-severity WCAG violations. Barriers to accessibility.`
  }
  
  return {
    id: `ACC-001`,
    dimension: 'accessibilityOperability',
    rule: 'WCAG 2.2 compliance',
    rating,
    evidence,
    researchReference: 'WCAG 2.2: Perceivable, operable, understandable, robust',
    wcagCriteria: accessibility.violations.length > 0 ? accessibility.violations[0].wcagCriteria : undefined,
    confidence: 0.90,
    applicable: true
  }
}

export function checkFormAccessibility(dom: DOMEvidence): ScoringCheck {
  const totalFields = dom.forms.flatMap(f => f.fields).length
  const fieldsWithLabels = dom.forms.flatMap(f => f.fields).filter(field => 
    field.hasLabel || field.ariaLabel
  ).length
  
  const labelRate = totalFields > 0 ? fieldsWithLabels / totalFields : 1
  
  let rating: CheckRating
  let evidence: string
  
  if (totalFields === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'No form inputs to evaluate'
  } else if (labelRate === 1) {
    rating = CheckRating.EXCELLENT
    evidence = `All ${totalFields} form fields have labels or ARIA attributes`
  } else if (labelRate >= 0.8) {
    rating = CheckRating.GOOD
    evidence = `${fieldsWithLabels}/${totalFields} fields have labels`
  } else if (labelRate >= 0.5) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${totalFields - fieldsWithLabels}/${totalFields} fields missing labels or ARIA attributes`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${totalFields - fieldsWithLabels}/${totalFields} fields missing labels. Significant accessibility barrier.`
  }
  
  return {
    id: `ACC-002`,
    dimension: 'accessibilityOperability',
    rule: 'Form field labeling',
    rating,
    evidence,
    researchReference: 'WCAG 2.2 A 3.3.2: Labels or instructions',
    wcagCriteria: labelRate < 1 ? 'WCAG 2.2 A 3.3.2' : undefined,
    confidence: 0.95,
    applicable: totalFields > 0
  }
}

/**
 * Visual Clarity Checks (10% weight)
 * Based on: Nielsen aesthetic design, WCAG perceivable
 */

export function checkTextReadability(visual: VisualEvidence): ScoringCheck {
  const readableText = visual.textElements?.filter(t => t.readable).length || 0
  const totalText = visual.textElements?.length || 0
  const readabilityRate = totalText > 0 ? readableText / totalText : 1
  
  let rating: CheckRating
  let evidence: string
  
  if (readabilityRate >= 0.95) {
    rating = CheckRating.EXCELLENT
    evidence = `${readableText}/${totalText} text elements meet readability standards (16px+, 4.5:1 contrast)`
  } else if (readabilityRate >= 0.8) {
    rating = CheckRating.GOOD
    evidence = `${readableText}/${totalText} text elements readable`
  } else if (readabilityRate >= 0.6) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${totalText - readableText}/${totalText} text elements have readability issues (small font or low contrast)`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${totalText - readableText}/${totalText} text elements fail readability standards. Hard to read.`
  }
  
  return {
    id: `VIS-001`,
    dimension: 'visualClarity',
    rule: 'Text readability',
    rating,
    evidence,
    researchReference: 'WCAG 2.2 AA 1.4.3: Contrast (minimum)',
    wcagCriteria: readabilityRate < 1 ? 'WCAG 2.2 AA 1.4.3' : undefined,
    confidence: 0.85,
    applicable: totalText > 0
  }
}

export function checkVisualClutter(visual: VisualEvidence): ScoringCheck {
  const crowdedSections = visual.crowdedSections?.length || 0
  
  let rating: CheckRating
  let evidence: string
  
  if (crowdedSections === 0) {
    rating = CheckRating.EXCELLENT
    evidence = 'Clear visual hierarchy with appropriate spacing'
  } else if (crowdedSections <= 1) {
    rating = CheckRating.GOOD
    evidence = `1 crowded section found. Overall layout is clear.`
  } else if (crowdedSections <= 3) {
    rating = CheckRating.NEEDS_IMPROVEMENT
    evidence = `${crowdedSections} crowded sections found. Visual hierarchy could be clearer.`
  } else {
    rating = CheckRating.MAJOR_FRICTION
    evidence = `${crowdedSections} crowded sections. Layout feels cluttered and overwhelming.`
  }
  
  return {
    id: `VIS-002`,
    dimension: 'visualClarity',
    rule: 'Visual hierarchy and spacing',
    rating,
    evidence,
    researchReference: 'Nielsen (1994): Aesthetic and minimalist design',
    confidence: 0.75, // Visual density is somewhat subjective
    applicable: true
  }
}

/**
 * Apply all scoring checks to collected evidence
 */
export function applyAllScoringChecks(evidence: ScreenEvidenceBundle): ScoringCheck[] {
  const checks: ScoringCheck[] = []
  
  // Task Effectiveness checks (per workflow)
  evidence.workflows.forEach(workflow => {
    checks.push(checkTaskCompletion(workflow))
    checks.push(checkErrorRecoverability(workflow))
  })
  
  // Workflow Efficiency checks (per workflow)
  evidence.workflows.forEach(workflow => {
    checks.push(checkStepEfficiency(workflow))
    checks.push(checkRepeatedInputs(workflow))
  })
  
  // Discoverability checks (per screen)
  checks.push(checkPrimaryCTADiscoverability(evidence.visual))
  checks.push(checkNavigationClarity(evidence.dom))
  
  // Feedback & Recovery checks (per workflow + screen)
  evidence.workflows.forEach(workflow => {
    checks.push(checkFeedbackQuality(workflow))
    checks.push(checkErrorMessageClarity(evidence.dom, workflow))
  })
  
  // Accessibility checks (per screen)
  checks.push(checkWCAGCompliance(evidence.accessibility))
  checks.push(checkFormAccessibility(evidence.dom))
  
  // Visual Clarity checks (per screen)
  checks.push(checkTextReadability(evidence.visual))
  checks.push(checkVisualClutter(evidence.visual))
  
  return checks
}
