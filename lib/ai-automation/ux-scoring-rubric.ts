/**
 * Research-backed UX Scoring Rubric
 * 
 * Based on established HCI research (see ux-research-references.ts),
 * this scoring system evaluates usability through observable evidence
 * rather than subjective AI opinions.
 * 
 * Grounded in:
 * - ISO 9241-11: Effectiveness, efficiency, satisfaction
 * - Nielsen's heuristics (1994): Visibility, consistency, error prevention
 * - Cognitive walkthrough (Polson et al. 1992): Step-by-step evaluation
 * - WCAG 2.2: Accessibility compliance
 */

import { ISO_9241_11_REFERENCE, WCAG_REFERENCE } from "./ux-research-references"

/**
 * Six research-backed UX dimensions with weights
 * Total: 100%
 */
export const UX_DIMENSIONS = {
  taskEffectiveness: {
    weight: 0.25, // 25%
    label: "Task Effectiveness",
    description: "Can the user achieve the goal and get the correct result?",
    researchBasis: [
      "ISO 9241-11: Effectiveness component",
      "Nielsen (1994): Error prevention and recovery",
      "Cognitive walkthrough: Goal achievement"
    ]
  },
  workflowEfficiency: {
    weight: 0.20, // 20%
    label: "Workflow Efficiency",
    description: "Are there unnecessary steps, repeated inputs, dead ends or excessive backtracking?",
    researchBasis: [
      "ISO 9241-11: Efficiency component",
      "Card et al. (1980): Keystroke-level model",
      "Rodden et al. (2010): Task success metrics"
    ]
  },
  discoverability: {
    weight: 0.15, // 15%
    label: "Discoverability",
    description: "Can users find the right action and understand where to start?",
    researchBasis: [
      "Nielsen (1994): Visibility of system status",
      "Cognitive walkthrough: Notice correct action",
      "Fitts (1954): Target visibility and size"
    ]
  },
  feedbackRecovery: {
    weight: 0.15, // 15%
    label: "Feedback and Error Recovery",
    description: "Does the interface explain progress, success, errors and how to recover?",
    researchBasis: [
      "Nielsen (1994): Visibility of system status, error recovery",
      "Cognitive walkthrough: Understand feedback",
      "Hassenzahl (2003): Pragmatic quality"
    ]
  },
  accessibilityOperability: {
    weight: 0.15, // 15%
    label: "Accessibility and Operability",
    description: "Can controls be operated and understood with different input methods?",
    researchBasis: [
      "WCAG 2.2: Perceivable, operable, understandable, robust",
      "Fitts (1954): Target size and distance",
      "Nielsen (1994): Consistency and standards"
    ]
  },
  visualClarity: {
    weight: 0.10, // 10%
    label: "Visual Clarity and Consistency",
    description: "Are hierarchy, readability, spacing and responsive layouts clear and consistent?",
    researchBasis: [
      "Nielsen (1994): Aesthetic and minimalist design",
      "Hassenzahl (2003): Pragmatic quality",
      "WCAG 2.2: Perceivable (contrast, text sizing)"
    ]
  }
} as const

export type UXDimensionKey = keyof typeof UX_DIMENSIONS

/**
 * Five-point scoring rubric for each check
 * Based on severity assessment from heuristic evaluation
 */
export enum CheckRating {
  BLOCKED = 0,           // Blocked or severely broken
  MAJOR_FRICTION = 1,    // Major friction
  NEEDS_IMPROVEMENT = 2, // Needs improvement
  GOOD = 3,              // Good
  EXCELLENT = 4          // Excellent
}

export const RATING_DESCRIPTIONS = {
  [CheckRating.BLOCKED]: {
    label: "Blocked or severely broken",
    description: "The user cannot complete the task, or a serious usability barrier makes the interaction unusable.",
    severity: "critical"
  },
  [CheckRating.MAJOR_FRICTION]: {
    label: "Major friction",
    description: "The task may be possible, but the interface has a substantial obstacle or confusing interaction.",
    severity: "high"
  },
  [CheckRating.NEEDS_IMPROVEMENT]: {
    label: "Needs improvement",
    description: "The task works, but avoidable confusion, repetition or weak feedback remains.",
    severity: "medium"
  },
  [CheckRating.GOOD]: {
    label: "Good",
    description: "The interaction is clear and usable, with only minor friction.",
    severity: "low"
  },
  [CheckRating.EXCELLENT]: {
    label: "Excellent",
    description: "The interaction is clear, efficient and appropriately supported by feedback and recovery options.",
    severity: "none"
  }
} as const

/**
 * Individual scoring check result
 */
export type ScoringCheck = {
  id: string
  dimension: UXDimensionKey
  rule: string // Which heuristic/guideline
  rating: CheckRating
  evidence: string // Observable evidence supporting rating
  researchReference?: string // e.g., "Nielsen (1994): Error prevention"
  wcagCriteria?: string // e.g., "WCAG 2.2 AA 1.3.1"
  confidence: number // 0-1
  applicable: boolean // False if check doesn't apply to this workflow
}

/**
 * Dimension score calculation
 */
export type DimensionScore = {
  dimension: UXDimensionKey
  score: number // 0-100
  weight: number // 0-1
  weightedContribution: number // score * weight
  checksApplied: number
  checksTotal: number
  averageRating: number // 0-4
  confidence: number // 0-1
  checks: ScoringCheck[]
}

/**
 * Overall UX Audit Score
 */
export type UXAuditScore = {
  overall: number // 0-100
  grade: "A" | "B" | "C" | "D" | "F"
  confidence: number // 0-1
  dimensions: DimensionScore[]
  totalChecksApplied: number
  totalChecksAvailable: number
  coveragePercentage: number
  methodology: string
  limitations: string[]
  calculatedAt: string
}

/**
 * Calculate dimension score from checks
 * 
 * Formula: D_i = (mean rating / 4) × 100
 */
export function calculateDimensionScore(
  dimension: UXDimensionKey,
  checks: ScoringCheck[]
): DimensionScore {
  const applicableChecks = checks.filter(c => c.applicable && c.dimension === dimension)
  
  if (applicableChecks.length === 0) {
    return {
      dimension,
      score: 0,
      weight: UX_DIMENSIONS[dimension].weight,
      weightedContribution: 0,
      checksApplied: 0,
      checksTotal: checks.filter(c => c.dimension === dimension).length,
      averageRating: 0,
      confidence: 0,
      checks: []
    }
  }

  const totalRating = applicableChecks.reduce((sum, check) => sum + check.rating, 0)
  const averageRating = totalRating / applicableChecks.length
  const averageConfidence = applicableChecks.reduce((sum, check) => sum + check.confidence, 0) / applicableChecks.length

  // Convert 0-4 scale to 0-100 scale
  const score = (averageRating / 4) * 100
  
  const weight = UX_DIMENSIONS[dimension].weight
  const weightedContribution = (weight * score)

  return {
    dimension,
    score: Math.round(score * 10) / 10, // Round to 1 decimal
    weight,
    weightedContribution: Math.round(weightedContribution * 10) / 10,
    checksApplied: applicableChecks.length,
    checksTotal: checks.filter(c => c.dimension === dimension).length,
    averageRating: Math.round(averageRating * 10) / 10,
    confidence: Math.round(averageConfidence * 100) / 100,
    checks: applicableChecks
  }
}

/**
 * Calculate overall UX Audit Score
 * 
 * Formula: UX Score = Σ(w_i × D_i / 100)
 * where w_i is weight percentage and D_i is dimension score
 */
export function calculateOverallUXScore(
  allChecks: ScoringCheck[]
): UXAuditScore {
  const dimensions: DimensionScore[] = []
  
  for (const dimensionKey of Object.keys(UX_DIMENSIONS) as UXDimensionKey[]) {
    const dimScore = calculateDimensionScore(dimensionKey, allChecks)
    dimensions.push(dimScore)
  }

  // Weighted sum
  const overall = dimensions.reduce((sum, dim) => sum + dim.weightedContribution, 0)
  
  // Overall confidence (average of dimensional confidences weighted by their contribution)
  const totalWeight = dimensions.reduce((sum, dim) => sum + (dim.checksApplied > 0 ? dim.weight : 0), 0)
  const confidence = totalWeight > 0
    ? dimensions.reduce((sum, dim) => 
        sum + (dim.checksApplied > 0 ? dim.confidence * dim.weight : 0), 0) / totalWeight
    : 0

  const totalApplied = dimensions.reduce((sum, dim) => sum + dim.checksApplied, 0)
  const totalAvailable = dimensions.reduce((sum, dim) => sum + dim.checksTotal, 0)
  const coverage = totalAvailable > 0 ? (totalApplied / totalAvailable) * 100 : 0

  return {
    overall: Math.round(overall * 10) / 10,
    grade: getScoreGrade(overall),
    confidence: Math.round(confidence * 100) / 100,
    dimensions,
    totalChecksApplied: totalApplied,
    totalChecksAvailable: totalAvailable,
    coveragePercentage: Math.round(coverage * 10) / 10,
    methodology: generateMethodologyDescription(),
    limitations: generateLimitations(totalApplied, confidence),
    calculatedAt: new Date().toISOString()
  }
}

/**
 * Convert numeric score to letter grade
 */
export function getScoreGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A"
  if (score >= 75) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}

/**
 * Get grade label with description
 */
export function getGradeLabel(grade: "A" | "B" | "C" | "D" | "F"): { label: string; description: string } {
  const labels = {
    A: { label: "Strong usability", description: "The interface demonstrates excellent usability with clear workflows, effective feedback, and minimal friction." },
    B: { label: "Good usability", description: "The interface is generally usable with some areas for improvement in discoverability or efficiency." },
    C: { label: "Needs improvement", description: "The interface has notable usability issues that create friction or confusion for users." },
    D: { label: "Significant UX friction", description: "The interface has substantial usability problems that significantly impede task completion." },
    F: { label: "Critical UX problems", description: "The interface has severe usability barriers that prevent or severely hinder task completion." }
  }
  return labels[grade]
}

function generateMethodologyDescription(): string {
  return `This UX Audit Score is calculated using a research-backed six-dimension framework based on ISO 9241-11 (usability definition), Nielsen's heuristics (1994), cognitive walkthrough methodology (Polson et al. 1992), and WCAG 2.2 accessibility guidelines. Each dimension is scored using a five-point rubric (0=blocked, 1=major friction, 2=needs improvement, 3=good, 4=excellent) based on observable evidence from visual inspection, DOM analysis, accessibility evaluation, and live workflow execution. Dimension scores are weighted and combined to produce an overall score from 0-100.`
}

function generateLimitations(checksApplied: number, confidence: number): string[] {
  const limitations: string[] = []

  limitations.push(
    `This is an automated UX audit evaluating observable interface behavior and workflow execution. It is distinct from perceived user experience, which requires validated questionnaires (SUS, UEQ, UMUX-LITE) administered to actual users after they try the product.`
  )

  if (checksApplied < 10) {
    limitations.push(
      `Limited test coverage (${checksApplied} checks applied). Scores based on small samples have higher uncertainty (Sauro & Lewis, 2005).`
    )
  }

  if (confidence < 0.7) {
    limitations.push(
      `Low confidence score (${Math.round(confidence * 100)}%) indicates hypothetical or uncertain findings that should be validated with real users.`
    )
  }

  limitations.push(
    `Elapsed time of AI browser agent does not represent actual human task time. Efficiency scoring prioritizes unnecessary actions and deviations; human performance estimates require validated models (Card et al. 1980) or real participant testing.`
  )

  limitations.push(
    `Visual analysis and screenshot inspection provide hypotheses about discoverability and clarity. These must be validated through user testing, as what appears clear to an automated system may not be clear to actual users (Hornbæk, 2006).`
  )

  return limitations
}

/**
 * Score band definitions for reporting
 */
export const SCORE_BANDS = {
  strong: { min: 90, max: 100, label: "Strong usability", color: "green" },
  good: { min: 75, max: 89, label: "Good usability", color: "blue" },
  needsImprovement: { min: 60, max: 74, label: "Needs improvement", color: "yellow" },
  significantFriction: { min: 40, max: 59, label: "Significant UX friction", color: "orange" },
  critical: { min: 0, max: 39, label: "Critical UX problems", color: "red" }
} as const

export function getScoreBand(score: number) {
  if (score >= 90) return SCORE_BANDS.strong
  if (score >= 75) return SCORE_BANDS.good
  if (score >= 60) return SCORE_BANDS.needsImprovement
  if (score >= 40) return SCORE_BANDS.significantFriction
  return SCORE_BANDS.critical
}
