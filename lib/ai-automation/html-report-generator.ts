import type { AutomationJob } from "./types"

/**
 * Generate a comprehensive HTML report with all testing details and UX audit.
 * Includes print styles for PDF export.
 */
export function generateHTMLReport(job: AutomationJob): string {
  const timestamp = new Date().toISOString()
  const duration = job.finishedAt
    ? Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)
    : 0

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Report - ${job.targetUrl}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }

    h1 {
      color: #2563eb;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 10px;
      margin-bottom: 30px;
      font-size: 2.5em;
    }

    h2 {
      color: #1e40af;
      margin-top: 40px;
      margin-bottom: 20px;
      font-size: 1.8em;
      border-left: 4px solid #2563eb;
      padding-left: 15px;
    }

    h3 {
      color: #475569;
      margin-top: 25px;
      margin-bottom: 15px;
      font-size: 1.3em;
    }

    .header-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
    }

    .info-item {
      display: flex;
      flex-direction: column;
    }

    .info-label {
      font-weight: 600;
      color: #64748b;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
    }

    .info-value {
      font-size: 1.1em;
      color: #1e293b;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-completed { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-running { background: #fef3c7; color: #92400e; }
    .status-passed { background: #dcfce7; color: #166534; }
    .status-blocked { background: #fecaca; color: #991b1b; }
    .status-pending { background: #e5e7eb; color: #374151; }

    .severity-blocker { color: #dc2626; font-weight: 700; }
    .severity-high { color: #ea580c; font-weight: 600; }
    .severity-medium { color: #f59e0b; font-weight: 600; }
    .severity-low { color: #84cc16; font-weight: 600; }

    .ux-score-container {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin: 30px 0;
    }

    .ux-score-main {
      text-align: center;
      margin-bottom: 30px;
    }

    .ux-score-number {
      font-size: 4em;
      font-weight: 700;
      line-height: 1;
      margin: 10px 0;
    }

    .ux-grade {
      font-size: 3em;
      font-weight: 700;
      display: inline-block;
      padding: 10px 30px;
      background: rgba(255,255,255,0.2);
      border-radius: 8px;
      margin-top: 15px;
    }

    .ux-dimensions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }

    .ux-dimension {
      background: rgba(255,255,255,0.15);
      padding: 15px;
      border-radius: 8px;
    }

    .ux-dimension-name {
      font-size: 0.9em;
      opacity: 0.9;
      margin-bottom: 8px;
    }

    .ux-dimension-score {
      font-size: 1.8em;
      font-weight: 700;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }

    .stat-card {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #2563eb;
    }

    .stat-value {
      font-size: 2.5em;
      font-weight: 700;
      color: #2563eb;
      line-height: 1;
    }

    .stat-label {
      color: #64748b;
      margin-top: 8px;
      font-size: 0.95em;
    }

    .issues-list {
      margin: 20px 0;
    }

    .issue-card {
      background: #fefefe;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #ef4444;
      padding: 20px;
      margin-bottom: 15px;
      border-radius: 4px;
    }

    .issue-card.severity-blocker { border-left-color: #dc2626; }
    .issue-card.severity-high { border-left-color: #ea580c; }
    .issue-card.severity-medium { border-left-color: #f59e0b; }
    .issue-card.severity-low { border-left-color: #84cc16; }

    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 10px;
    }

    .issue-type {
      font-weight: 600;
      color: #1e293b;
      text-transform: capitalize;
    }

    .issue-description {
      margin: 10px 0;
      color: #475569;
    }

    .issue-meta {
      display: flex;
      gap: 20px;
      font-size: 0.9em;
      color: #64748b;
      margin-top: 10px;
    }

    .screen-card {
      background: #fefefe;
      border: 1px solid #e2e8f0;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
    }

    .screen-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 15px;
    }

    .screen-title {
      font-weight: 600;
      font-size: 1.2em;
      color: #1e293b;
    }

    .screen-url {
      font-size: 0.9em;
      color: #64748b;
      margin: 5px 0;
      word-break: break-all;
    }

    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }

    .screenshot-item {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
    }

    .screenshot-item img {
      width: 100%;
      height: auto;
      display: block;
    }

    .screenshot-label {
      padding: 8px;
      background: #f8fafc;
      font-size: 0.85em;
      color: #64748b;
      text-align: center;
    }

    .test-step {
      background: #fefefe;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #3b82f6;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 4px;
    }

    .test-step.status-failed { border-left-color: #ef4444; }
    .test-step.status-blocked { border-left-color: #f59e0b; }
    .test-step.status-passed { border-left-color: #10b981; }

    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .step-action {
      font-weight: 600;
      color: #1e293b;
    }

    .step-details {
      font-size: 0.9em;
      color: #64748b;
      margin: 5px 0;
    }

    .workflow-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
    }

    .workflow-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }

    .workflow-name {
      font-weight: 700;
      font-size: 1.3em;
      color: #1e293b;
    }

    .recommendations-list {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 20px;
      margin: 20px 0;
      border-radius: 4px;
    }

    .recommendations-list ul {
      margin-left: 20px;
      margin-top: 10px;
    }

    .recommendations-list li {
      margin: 8px 0;
      color: #78350f;
    }

    .executive-summary {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin: 30px 0;
    }

    .executive-summary h3 {
      color: white;
      margin-top: 20px;
      font-size: 1.1em;
    }

    .executive-summary ul {
      margin-left: 20px;
      margin-top: 10px;
    }

    .executive-summary li {
      margin: 8px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }

    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }

    th {
      background: #f8fafc;
      font-weight: 600;
      color: #475569;
    }

    tr:hover {
      background: #f8fafc;
    }

    .log-entry {
      font-family: 'Courier New', monospace;
      font-size: 0.85em;
      padding: 8px 12px;
      margin: 2px 0;
      border-radius: 4px;
    }

    .log-error { background: #fee2e2; color: #991b1b; }
    .log-warn { background: #fef3c7; color: #92400e; }
    .log-success { background: #dcfce7; color: #166534; }
    .log-info { background: #e0f2fe; color: #075985; }

    .page-break {
      page-break-after: always;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }

      .container {
        box-shadow: none;
        padding: 20px;
        max-width: 100%;
      }

      h1 {
        font-size: 2em;
      }

      h2 {
        font-size: 1.5em;
        page-break-after: avoid;
      }

      .ux-score-container,
      .executive-summary {
        break-inside: avoid;
      }

      .issue-card,
      .screen-card,
      .workflow-card {
        break-inside: avoid;
      }

      .screenshot-item img {
        max-height: 400px;
        object-fit: contain;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Report</h1>

    <div class="header-info">
      <div class="info-item">
        <span class="info-label">Target URL</span>
        <span class="info-value">${escapeHtml(job.targetUrl)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Test Mode</span>
        <span class="info-value">${escapeHtml(job.mode || 'crawl')}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Status</span>
        <span class="info-value">
          <span class="status-badge status-${job.status}">${escapeHtml(job.status)}</span>
        </span>
      </div>
      <div class="info-item">
        <span class="info-label">Started At</span>
        <span class="info-value">${formatDate(job.startedAt)}</span>
      </div>
      ${job.finishedAt ? `
      <div class="info-item">
        <span class="info-label">Finished At</span>
        <span class="info-value">${formatDate(job.finishedAt)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Duration</span>
        <span class="info-value">${formatDuration(duration)}</span>
      </div>
      ` : ''}
      ${job.role ? `
      <div class="info-item">
        <span class="info-label">Role</span>
        <span class="info-value">${escapeHtml(job.role)}</span>
      </div>
      ` : ''}
    </div>

    ${generateExecutiveSummary(job)}
    ${generateUXAuditSection(job)}
    ${generateStatsSection(job)}
    ${generateIssuesSection(job)}
    ${generateScreensSection(job)}
    ${generateTestPlanSection(job)}
    ${generateWorkflowsSection(job)}
    ${generateRecommendations(job)}
    ${generateLogsSection(job)}

    <div style="margin-top: 60px; padding-top: 30px; border-top: 2px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 0.9em;">
      <p>Generated on ${formatDate(timestamp)}</p>
      <p>Report ID: ${escapeHtml(job.id)}</p>
    </div>
  </div>
</body>
</html>`
}

function generateExecutiveSummary(job: AutomationJob): string {
  if (!job.report?.aiExecutiveSummary) return ''

  const summary = job.report.aiExecutiveSummary

  return `
    <div class="executive-summary">
      <h2 style="color: white; border: none; margin-top: 0;">Executive Summary</h2>
      <p style="font-size: 1.1em; line-height: 1.8; margin: 20px 0;">${escapeHtml(summary.executiveSummary)}</p>

      <h3>Key Strengths</h3>
      <ul>
        ${summary.keyStrengths.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>

      <h3>Critical Fixes</h3>
      <ul>
        ${summary.criticalFixes.map(f => `<li>${escapeHtml(f)}</li>`).join('')}
      </ul>

      <div style="text-align: center; margin-top: 30px;">
        <div style="font-size: 1.2em; opacity: 0.9;">Overall Score</div>
        <div style="font-size: 3em; font-weight: 700; margin-top: 10px;">${summary.overallScore}/100</div>
      </div>
    </div>
  `
}

function generateUXAuditSection(job: AutomationJob): string {
  const uxScore = job.uxAuditScore || (job.screens?.[0]?.uxAuditScore)

  if (!uxScore) return ''

  const methodology = 'methodology' in uxScore && uxScore.methodology
    ? uxScore.methodology
    : 'totalChecksApplied' in uxScore
      ? `${uxScore.totalChecksApplied} checks applied`
      : 'Heuristic UX Audit'
  const limitations = 'limitations' in uxScore && Array.isArray(uxScore.limitations)
    ? uxScore.limitations
    : []

  return `
    <div class="page-break"></div>
    <h2>UX Intelligence Audit</h2>

    <div class="ux-score-container">
      <div class="ux-score-main">
        <div style="font-size: 1.2em; opacity: 0.9;">Overall UX Score</div>
        <div class="ux-score-number">${uxScore.overall}</div>
        <div style="font-size: 1em; opacity: 0.9;">out of 100</div>
        <div class="ux-grade">Grade ${uxScore.grade}</div>
        <div style="margin-top: 15px; font-size: 0.95em; opacity: 0.85;">
          Confidence: ${Math.round(uxScore.confidence * 100)}% | ${escapeHtml(methodology)}
        </div>
      </div>

      <h3 style="color: white; margin-top: 30px; margin-bottom: 15px;">Dimensional Breakdown</h3>
      <div class="ux-dimensions">
        ${uxScore.dimensions.map(dim => {
          const checksCount = 'checksApplied' in dim ? dim.checksApplied : dim.checks.length
          return `
          <div class="ux-dimension">
            <div class="ux-dimension-name">${escapeHtml(dim.dimension)}</div>
            <div class="ux-dimension-score">${dim.score.toFixed(1)}</div>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 5px;">
              Weight: ${(dim.weight * 100).toFixed(0)}% | ${checksCount} checks
            </div>
          </div>
        `
        }).join('')}
      </div>

      ${limitations.length > 0 ? `
        <div style="margin-top: 30px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px;">
          <h3 style="color: white; margin-top: 0; font-size: 1em;">Limitations</h3>
          <ul style="margin-left: 20px; font-size: 0.9em;">
            ${limitations.map((l: string) => `<li>${escapeHtml(l)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `
}

function generateStatsSection(job: AutomationJob): string {
  const report = job.report
  if (!report) return ''

  return `
    <h2>Test Statistics</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${report.totalScreensTested}</div>
        <div class="stat-label">Screens Tested</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.totalIssues}</div>
        <div class="stat-label">Issues Found</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.backNavigationScore}%</div>
        <div class="stat-label">Back Navigation Score</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${report.responsiveScore}%</div>
        <div class="stat-label">Responsive Score</div>
      </div>
      ${job.fullAppTestPlan ? `
        <div class="stat-card">
          <div class="stat-value">${job.fullAppTestPlan.steps?.length || 0}</div>
          <div class="stat-label">Test Steps</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${job.fullAppTestPlan.coverage?.percentage.toFixed(1) || 0}%</div>
          <div class="stat-label">Coverage</div>
        </div>
      ` : ''}
      ${report.testCases ? `
        <div class="stat-card">
          <div class="stat-value">${report.testCases.filter(tc => tc.status === 'passed').length}</div>
          <div class="stat-label">Test Cases Passed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${report.testCases.filter(tc => tc.status === 'failed').length}</div>
          <div class="stat-label">Test Cases Failed</div>
        </div>
      ` : ''}
    </div>
  `
}

function generateIssuesSection(job: AutomationJob): string {
  const issues = job.issues || []
  if (issues.length === 0) return '<h2>Issues</h2><p style="color: #10b981; font-weight: 600;">✓ No issues found!</p>'

  const grouped = issues.reduce((acc, issue) => {
    if (!acc[issue.severity]) acc[issue.severity] = []
    acc[issue.severity].push(issue)
    return acc
  }, {} as Record<string, typeof issues>)

  return `
    <div class="page-break"></div>
    <h2>Issues (${issues.length})</h2>

    ${['blocker', 'high', 'medium', 'low'].map(severity => {
      const items = grouped[severity] || []
      if (items.length === 0) return ''

      return `
        <h3 class="severity-${severity}">${severity.toUpperCase()} Severity (${items.length})</h3>
        <div class="issues-list">
          ${items.map(issue => `
            <div class="issue-card severity-${issue.severity}">
              <div class="issue-header">
                <div>
                  <span class="issue-type">${issue.type.replace(/_/g, ' ')}</span>
                  <span class="severity-${issue.severity}" style="margin-left: 10px; font-size: 0.9em;">
                    ${issue.severity.toUpperCase()}
                  </span>
                </div>
              </div>
              <div class="issue-description">${escapeHtml(issue.description)}</div>
              ${issue.expected ? `<div style="margin-top: 8px;"><strong>Expected:</strong> ${escapeHtml(issue.expected)}</div>` : ''}
              ${issue.actual ? `<div style="margin-top: 4px;"><strong>Actual:</strong> ${escapeHtml(issue.actual)}</div>` : ''}
              <div class="issue-meta">
                <span>📍 ${escapeHtml(issue.screenTitle)}</span>
                <span>🔗 ${escapeHtml(issue.screenUrl)}</span>
                ${issue.viewport ? `<span>📱 ${escapeHtml(issue.viewport)}</span>` : ''}
                <span>⏰ ${formatDate(issue.timestamp)}</span>
              </div>
              ${issue.correlatedEvidence ? `
                <div style="margin-top: 15px; padding: 10px; background: #fef3c7; border-radius: 4px; font-size: 0.9em;">
                  <strong>Correlated Evidence:</strong>
                  ${issue.correlatedEvidence.consoleErrors?.length ? `
                    <div style="margin-top: 5px;">Console Errors: ${issue.correlatedEvidence.consoleErrors.length}</div>
                  ` : ''}
                  ${issue.correlatedEvidence.networkFailures?.length ? `
                    <div style="margin-top: 5px;">Network Failures: ${issue.correlatedEvidence.networkFailures.length}</div>
                  ` : ''}
                  ${issue.correlatedEvidence.emptyDataSurfaces?.length ? `
                    <div style="margin-top: 5px;">Empty Data Surfaces: ${issue.correlatedEvidence.emptyDataSurfaces.join(', ')}</div>
                  ` : ''}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `
    }).join('')}
  `
}

function generateScreensSection(job: AutomationJob): string {
  const screens = job.screens || []
  if (screens.length === 0) return ''

  return `
    <div class="page-break"></div>
    <h2>Tested Screens (${screens.length})</h2>

    ${screens.map((screen, index) => `
      <div class="screen-card">
        <div class="screen-header">
          <div>
            <div class="screen-title">${index + 1}. ${escapeHtml(screen.title)}</div>
            <div class="screen-url">${escapeHtml(screen.url)}</div>
            ${screen.pageType ? `<div style="font-size: 0.85em; color: #64748b; margin-top: 5px;">Type: ${escapeHtml(screen.pageType)}</div>` : ''}
          </div>
          <div>
            <span class="status-badge status-${screen.backNavigationStatus}">${screen.backNavigationStatus}</span>
            <span class="status-badge status-${screen.responsiveStatus}" style="margin-left: 8px;">${screen.responsiveStatus}</span>
          </div>
        </div>

        ${screen.issuesCount ? `
          <div style="color: #dc2626; font-weight: 600; margin: 10px 0;">
            ⚠️ ${screen.issuesCount} issue${screen.issuesCount > 1 ? 's' : ''} found
          </div>
        ` : ''}

        ${screen.screenshots && Object.keys(screen.screenshots).length > 0 ? `
          <div class="screenshots-grid">
            ${Object.entries(screen.screenshots).map(([viewport, src]) => `
              <div class="screenshot-item">
                <img src="${src}" alt="${escapeHtml(viewport)} screenshot" loading="lazy" />
                <div class="screenshot-label">${escapeHtml(viewport)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${screen.uxAuditScore ? `
          <div style="margin-top: 15px; padding: 15px; background: #f8fafc; border-radius: 6px;">
            <strong>UX Score: ${screen.uxAuditScore.overall}/100 (${screen.uxAuditScore.grade})</strong>
            <div style="font-size: 0.9em; color: #64748b; margin-top: 5px;">
              Confidence: ${Math.round(screen.uxAuditScore.confidence * 100)}%
            </div>
          </div>
        ` : ''}
      </div>
    `).join('')}
  `
}

function generateTestPlanSection(job: AutomationJob): string {
  const plan = job.fullAppTestPlan
  if (!plan || !plan.steps || plan.steps.length === 0) return ''

  const stepsByStatus = plan.steps.reduce((acc, step) => {
    if (!acc[step.status]) acc[step.status] = []
    acc[step.status].push(step)
    return acc
  }, {} as Record<string, typeof plan.steps>)

  return `
    <div class="page-break"></div>
    <h2>Test Plan Execution</h2>

    <div style="margin: 20px 0;">
      <strong>Coverage:</strong> ${plan.coverage.percentage.toFixed(1)}%
      (${plan.coverage.actionsTested}/${plan.coverage.totalActions} actions,
      ${plan.coverage.formsTested}/${plan.coverage.totalForms} forms,
      ${plan.coverage.screensTested}/${plan.coverage.totalScreens} screens)
    </div>

    ${['passed', 'failed', 'blocked', 'pending'].map(status => {
      const steps = stepsByStatus[status] || []
      if (steps.length === 0) return ''

      return `
        <h3>${status.toUpperCase()} (${steps.length})</h3>
        ${steps.map((step, index) => `
          <div class="test-step status-${step.status}">
            <div class="step-header">
              <div class="step-action">
                Step ${step.stepIndex + 1}: ${escapeHtml(step.actionType)} - ${escapeHtml(step.targetName)}
              </div>
              <span class="status-badge status-${step.status}">${step.status}</span>
            </div>
            <div class="step-details">Screen: ${escapeHtml(step.screenName)}</div>
            ${step.targetSelector ? `<div class="step-details">Selector: <code>${escapeHtml(step.targetSelector)}</code></div>` : ''}
            ${step.syntheticValue ? `<div class="step-details">Value: ${escapeHtml(step.syntheticValue)}</div>` : ''}
            <div class="step-details">Expected: ${escapeHtml(step.expectedResult)}</div>
            ${step.actualResult ? `<div class="step-details">Actual: ${escapeHtml(step.actualResult)}</div>` : ''}
            ${step.error ? `<div style="color: #dc2626; margin-top: 8px;">Error: ${escapeHtml(step.error)}</div>` : ''}
            ${step.evidence ? `
              <div style="margin-top: 10px; padding: 10px; background: #f8fafc; border-radius: 4px; font-size: 0.9em;">
                <strong>Evidence:</strong> ${escapeHtml(step.evidence.verdict)} - ${escapeHtml(step.evidence.reason)}
                ${step.evidence.networkCalls?.length ? `<div>Network calls: ${step.evidence.networkCalls.length}</div>` : ''}
                ${step.evidence.consoleErrors?.length ? `<div>Console errors: ${step.evidence.consoleErrors.length}</div>` : ''}
              </div>
            ` : ''}
          </div>
        `).join('')}
      `
    }).join('')}
  `
}

function generateWorkflowsSection(job: AutomationJob): string {
  const workflows = job.report?.workflows || job.fullAppTestPlan?.workflows || []
  if (workflows.length === 0) return ''

  return `
    <div class="page-break"></div>
    <h2>Workflow Executions (${workflows.length})</h2>

    ${workflows.map(workflow => `
      <div class="workflow-card">
        <div class="workflow-header">
          <div class="workflow-name">${escapeHtml(workflow.name)}</div>
          <span class="status-badge status-${workflow.verdict}">${workflow.verdict}</span>
        </div>

        <div style="margin: 10px 0; color: #64748b;">
          Entry: ${escapeHtml(workflow.entryUrl)}
          ${workflow.entryComponentLocation ? ` (${escapeHtml(workflow.entryComponentLocation)})` : ''}
        </div>

        <div style="margin: 15px 0;">${escapeHtml(workflow.summary)}</div>

        ${workflow.dataReflected !== undefined ? `
          <div style="margin: 10px 0;">
            <strong>Data Reflection:</strong>
            <span style="color: ${workflow.dataReflected ? '#10b981' : '#dc2626'};">
              ${workflow.dataReflected ? '✓ Data persisted and reflected' : '✗ Data not reflected'}
            </span>
          </div>
        ` : ''}

        <h4 style="margin-top: 20px;">Steps (${workflow.steps.length})</h4>
        ${workflow.steps.map((step, index) => `
          <div class="test-step status-${step.verdict}" style="margin: 10px 0;">
            <div class="step-header">
              <div>${index + 1}. ${escapeHtml(step.action)}</div>
              <span class="status-badge status-${step.verdict}">${step.verdict}</span>
            </div>
            <div class="step-details">Screen: ${escapeHtml(step.screenName)}</div>
            ${step.targetName ? `<div class="step-details">Target: ${escapeHtml(step.targetName)}</div>` : ''}
            <div class="step-details">Expected: ${escapeHtml(step.expectedOutcome)}</div>
            ${step.observedOutcome ? `<div class="step-details">Observed: ${escapeHtml(step.observedOutcome)}</div>` : ''}
            ${step.error ? `<div style="color: #dc2626; margin-top: 5px;">${escapeHtml(step.error)}</div>` : ''}
            <div class="step-details">Duration: ${step.durationMs}ms</div>
          </div>
        `).join('')}

        ${workflow.reproSteps && workflow.reproSteps.length > 0 ? `
          <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-radius: 6px;">
            <strong>Reproduction Steps:</strong>
            <ol style="margin-left: 20px; margin-top: 10px;">
              ${workflow.reproSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
            </ol>
          </div>
        ` : ''}
      </div>
    `).join('')}
  `
}

function generateRecommendations(job: AutomationJob): string {
  const recommendations = job.report?.recommendations || []
  if (recommendations.length === 0) return ''

  return `
    <div class="page-break"></div>
    <h2>Recommendations</h2>
    <div class="recommendations-list">
      <ul>
        ${recommendations.map(rec => `<li>${escapeHtml(rec)}</li>`).join('')}
      </ul>
    </div>
  `
}

function generateLogsSection(job: AutomationJob): string {
  const logs = job.logs || []
  if (logs.length === 0) return ''

  return `
    <div class="page-break"></div>
    <h2>Execution Logs (${logs.length})</h2>
    <div style="max-height: 600px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; background: #fafafa;">
      ${logs.map(log => `
        <div class="log-entry log-${log.level}">
          <span style="opacity: 0.7;">[${formatTime(log.timestamp)}]</span>
          <span style="font-weight: 600; margin: 0 8px;">[${log.level.toUpperCase()}]</span>
          <span>${escapeHtml(log.message)}</span>
        </div>
      `).join('')}
    </div>
  `
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins < 60) return `${mins}m ${secs}s`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hours}h ${remainMins}m ${secs}s`
}
