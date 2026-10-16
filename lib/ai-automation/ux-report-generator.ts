/**
 * UX Intelligence Report Generator
 * 
 * Generates comprehensive UX reports with:
 * - Overall UX Audit Score (0-100) with grade
 * - Dimensional breakdown with evidence
 * - Top findings with severity and recommendations
 * - Research references
 */

import type { AutomationJob, TestPlanStep } from "./types"
import type { ScreenEvidenceBundle } from "./ux-evidence-collector"
import { applyAllScoringChecks } from "./ux-scoring-checks"
import {
  calculateOverallUXScore,
  getGradeLabel,
  getScoreBand,
  type UXAuditScore,
  type ScoringCheck
} from "./ux-scoring-rubric"
import { generateReferencesSection } from "./ux-research-references"

/**
 * UX Finding with actionable recommendation
 */
export type UXFinding = {
  id: string
  dimension: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  description: string
  userImpact: string
  evidence: string
  researchBasis: string
  wcagCriteria?: string
  recommendation: string
  confidence: number
  screenId?: string
  workflowId?: string
}

/**
 * Complete UX Intelligence Report
 */
export type UXIntelligenceReport = {
  jobId: string
  targetUrl: string
  generatedAt: string
  
  // Overall score
  uxAuditScore: UXAuditScore
  
  // Top findings
  findings: UXFinding[]
  
  // Recommendations
  recommendations: Array<{
    priority: "critical" | "high" | "medium" | "low"
    title: string
    problem: string
    solution: string
    impact: string
    effort: "low" | "medium" | "high"
    relatedFindingIds: string[]
  }>
  
  // Evidence summary
  evidenceSummary: {
    screensAnalyzed: number
    workflowsTested: number
    checksPerformed: number
    wcagViolations: number
  }
}

/**
 * Generate UX findings from scoring checks
 */
function generateFindings(checks: ScoringCheck[]): UXFinding[] {
  return checks
    .filter(check => check.applicable && check.rating <= 2) // Only issues (0-2 rating)
    .map(check => {
      const severity = 
        check.rating === 0 ? 'critical' as const :
        check.rating === 1 ? 'high' as const :
        'medium' as const
      
      const userImpact = generateUserImpact(check.dimension, check.rule, check.rating)
      const recommendation = generateRecommendation(check.dimension, check.rule, check.evidence)
      
      return {
        id: check.id,
        dimension: check.dimension,
        severity,
        title: check.rule,
        description: check.evidence,
        userImpact,
        evidence: check.evidence,
        researchBasis: check.researchReference || 'Research-backed heuristic',
        wcagCriteria: check.wcagCriteria,
        recommendation,
        confidence: check.confidence
      }
    })
    .sort((a, b) => {
      // Sort by severity then confidence
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
      return severityDiff !== 0 ? severityDiff : b.confidence - a.confidence
    })
}

function generateUserImpact(dimension: string, rule: string, rating: number): string {
  const impacts = {
    taskEffectiveness: {
      blocked: 'Users cannot complete their goal',
      major: 'Users struggle significantly to complete tasks',
      needs: 'Users face obstacles that slow them down'
    },
    workflowEfficiency: {
      blocked: 'Workflow is completely inefficient',
      major: 'Users waste significant time on unnecessary steps',
      needs: 'Users experience unnecessary friction'
    },
    discoverability: {
      blocked: 'Users cannot find what they need',
      major: 'Users may miss critical actions',
      needs: 'Users need extra effort to discover options'
    },
    feedbackRecovery: {
      blocked: 'Users receive no feedback or recovery options',
      major: 'Users are left uncertain about outcomes',
      needs: 'Users receive unclear or inconsistent feedback'
    },
    accessibilityOperability: {
      blocked: 'Interface inaccessible to many users',
      major: 'Significant barriers to accessibility',
      needs: 'Some accessibility improvements needed'
    },
    visualClarity: {
      blocked: 'Visual layout is unusable',
      major: 'Visual hierarchy confuses users',
      needs: 'Visual clarity could be improved'
    }
  }
  
  const level = rating === 0 ? 'blocked' : rating === 1 ? 'major' : 'needs'
  return impacts[dimension as keyof typeof impacts]?.[level] || 'Users may face difficulties'
}

function generateRecommendation(dimension: string, rule: string, evidence: string): string {
  // Extract specific recommendations based on the rule
  if (rule.includes('Primary CTA')) {
    return 'Increase button size, use primary brand color, improve contrast to at least 4.5:1, and position prominently above the fold'
  }
  
  if (rule.includes('Error message')) {
    return 'Replace generic errors with specific guidance. Example: "Email must contain @ symbol" instead of "Invalid email"'
  }
  
  if (rule.includes('Form field labeling')) {
    return 'Add visible labels above each input field. Use aria-label for icon-only controls. Ensure labels remain visible when field has focus.'
  }
  
  if (rule.includes('WCAG compliance')) {
    return 'Review and fix WCAG violations starting with critical issues. Run automated accessibility audits and test with screen readers.'
  }
  
  if (rule.includes('Unnecessary step')) {
    return 'Streamline workflow by combining steps, pre-filling known data, or providing shortcuts for power users'
  }
  
  if (rule.includes('Repeated data entry')) {
    return 'Remember and auto-fill data entered earlier in the session. Use browser autocomplete attributes appropriately.'
  }
  
  if (rule.includes('Text readability')) {
    return 'Increase font size to at least 16px for body text. Improve contrast to meet WCAG AA standards (4.5:1 minimum)'
  }
  
  if (rule.includes('Navigation')) {
    return 'Add semantic nav element with clear hierarchy. Ensure all navigation items have accessible names.'
  }
  
  if (rule.includes('Visual hierarchy')) {
    return 'Reduce visual clutter by increasing whitespace, grouping related elements, and simplifying busy sections'
  }
  
  if (rule.includes('Action feedback')) {
    return 'Provide clear feedback after each user action. Show loading states, success confirmations, and progress indicators.'
  }
  
  return 'Review the evidence and apply relevant design improvements based on the research basis cited'
}

/**
 * Generate actionable recommendations from findings
 */
function generateRecommendations(findings: UXFinding[]) {
  const recommendations = []
  
  // Group findings by dimension
  const byDimension = findings.reduce((acc, finding) => {
    if (!acc[finding.dimension]) acc[finding.dimension] = []
    acc[finding.dimension].push(finding)
    return acc
  }, {} as Record<string, UXFinding[]>)
  
  // Generate priority recommendations
  for (const [dimension, dimFindings] of Object.entries(byDimension)) {
    const critical = dimFindings.filter(f => f.severity === 'critical')
    const high = dimFindings.filter(f => f.severity === 'high')
    
    if (critical.length > 0) {
      recommendations.push({
        priority: 'critical' as const,
        title: `Address ${critical.length} critical ${dimension} issue${critical.length > 1 ? 's' : ''}`,
        problem: critical.map(f => f.title).join('; '),
        solution: critical[0].recommendation,
        impact: 'Resolves blockers preventing users from completing tasks',
        effort: critical.length > 2 ? 'high' as const : 'medium' as const,
        relatedFindingIds: critical.map(f => f.id)
      })
    }
    
    if (high.length > 0) {
      recommendations.push({
        priority: 'high' as const,
        title: `Improve ${dimension.replace(/([A-Z])/g, ' $1').toLowerCase()}`,
        problem: `${high.length} high-severity issue${high.length > 1 ? 's' : ''} causing significant friction`,
        solution: high[0].recommendation,
        impact: 'Significantly improves user experience and reduces frustration',
        effort: 'medium' as const,
        relatedFindingIds: high.map(f => f.id)
      })
    }
  }
  
  return recommendations.slice(0, 10) // Top 10 recommendations
}

/**
 * Generate complete UX Intelligence Report
 */
export function generateUXIntelligenceReport(
  job: AutomationJob,
  evidenceBundles: ScreenEvidenceBundle[]
): UXIntelligenceReport {
  // Collect all scoring checks
  const allChecks: ScoringCheck[] = []
  evidenceBundles.forEach(bundle => {
    const checks = applyAllScoringChecks(bundle)
    allChecks.push(...checks)
  })
  
  // Calculate overall UX score
  const uxAuditScore = calculateOverallUXScore(allChecks)
  
  // Generate findings
  const findings = generateFindings(allChecks)
  
  // Generate recommendations
  const recommendations = generateRecommendations(findings)
  
  // Calculate evidence summary
  const workflowIds = new Set<string>()
  allChecks.forEach(check => {
    const match = check.id.match(/-(WF-\d+)$/)
    if (match) workflowIds.add(match[1])
  })
  
  const wcagViolations = evidenceBundles.reduce((sum, bundle) => 
    sum + bundle.accessibility.violations.length, 0
  )
  
  return {
    jobId: job.id,
    targetUrl: job.targetUrl,
    generatedAt: new Date().toISOString(),
    uxAuditScore,
    findings,
    recommendations,
    evidenceSummary: {
      screensAnalyzed: evidenceBundles.length,
      workflowsTested: workflowIds.size,
      checksPerformed: allChecks.filter(c => c.applicable).length,
      wcagViolations
    }
  }
}

/**
 * Format UX Intelligence Report as Markdown
 */
export function formatUXReportMarkdown(report: UXIntelligenceReport): string {
  const { uxAuditScore, findings, recommendations, evidenceSummary } = report
  const gradeInfo = getGradeLabel(uxAuditScore.grade)
  const band = getScoreBand(uxAuditScore.overall)
  
  let markdown = `# 🎯 UX Intelligence Report\n\n`
  markdown += `**Target URL:** \`${report.targetUrl}\`  \n`
  markdown += `**Generated:** ${new Date(report.generatedAt).toLocaleString()}  \n`
  markdown += `**Job ID:** \`${report.jobId}\`\n\n`
  
  markdown += `---\n\n`
  
  // Executive Summary
  markdown += `## 📊 Executive Summary\n\n`
  markdown += `### Overall UX Audit Score\n\n`
  markdown += `**Score:** ${uxAuditScore.overall}/100 | **Grade:** ${uxAuditScore.grade} (${gradeInfo.label})  \n`
  markdown += `**Confidence:** ${Math.round(uxAuditScore.confidence * 100)}%  \n`
  markdown += `**Assessment:** ${band.label}\n\n`
  markdown += `> ${gradeInfo.description}\n\n`
  
  // Dimensional Breakdown
  markdown += `### Dimensional Breakdown\n\n`
  markdown += `| Dimension | Score | Weight | Contribution | Checks Applied |\n`
  markdown += `|-----------|-------|--------|--------------|----------------|\n`
  
  uxAuditScore.dimensions.forEach(dim => {
    markdown += `| **${dim.dimension}** | ${dim.score}/100 | ${Math.round(dim.weight * 100)}% | ${dim.weightedContribution.toFixed(1)} | ${dim.checksApplied}/${dim.checksTotal} |\n`
  })
  markdown += `\n`
  
  // Evidence Summary
  markdown += `### Evidence Summary\n\n`
  markdown += `- **Screens Analyzed:** ${evidenceSummary.screensAnalyzed}\n`
  markdown += `- **Workflows Tested:** ${evidenceSummary.workflowsTested}\n`
  markdown += `- **Scoring Checks Performed:** ${evidenceSummary.checksPerformed}\n`
  markdown += `- **WCAG Violations Found:** ${evidenceSummary.wcagViolations}\n\n`
  
  // Top Findings
  if (findings.length > 0) {
    markdown += `---\n\n`
    markdown += `## 🔍 UX Findings\n\n`
    markdown += `Found ${findings.length} usability issue${findings.length > 1 ? 's' : ''} requiring attention:\n\n`
    
    findings.slice(0, 10).forEach((finding, idx) => {
      const severityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🟢'
      }[finding.severity]
      
      markdown += `### ${severityEmoji} [${finding.id}] ${finding.title}\n\n`
      markdown += `**Severity:** ${finding.severity.toUpperCase()} | **Confidence:** ${Math.round(finding.confidence * 100)}%  \n`
      markdown += `**Dimension:** ${finding.dimension}\n\n`
      
      markdown += `**Issue:**  \n${finding.description}\n\n`
      markdown += `**User Impact:**  \n${finding.userImpact}\n\n`
      markdown += `**Recommendation:**  \n${finding.recommendation}\n\n`
      markdown += `**Research Basis:**  \n${finding.researchBasis}`
      
      if (finding.wcagCriteria) {
        markdown += ` | **WCAG:** ${finding.wcagCriteria}`
      }
      markdown += `\n\n`
    })
  }
  
  // Recommendations
  if (recommendations.length > 0) {
    markdown += `---\n\n`
    markdown += `## 💡 Priority Recommendations\n\n`
    
    recommendations.forEach((rec, idx) => {
      const priorityEmoji = {
        critical: '🔴',
        high: '🟠',
        medium: '🟡',
        low: '🟢'
      }[rec.priority]
      
      markdown += `### ${idx + 1}. ${priorityEmoji} ${rec.title}\n\n`
      markdown += `**Priority:** ${rec.priority.toUpperCase()} | **Effort:** ${rec.effort.toUpperCase()}\n\n`
      markdown += `**Problem:**  \n${rec.problem}\n\n`
      markdown += `**Solution:**  \n${rec.solution}\n\n`
      markdown += `**Impact:**  \n${rec.impact}\n\n`
    })
  }
  
  // Methodology
  markdown += `---\n\n`
  markdown += `## 📐 Methodology\n\n`
  markdown += `${uxAuditScore.methodology}\n\n`
  
  // Limitations
  markdown += `### Important Limitations\n\n`
  uxAuditScore.limitations.forEach(limitation => {
    markdown += `- ${limitation}\n`
  })
  markdown += `\n`
  
  // Research References
  markdown += `---\n\n`
  markdown += generateReferencesSection()
  
  return markdown
}
