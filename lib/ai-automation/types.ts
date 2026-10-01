export type AutomationViewport = {
  name: string
  width: number
  height: number
}

export type AutomationIssue = {
  id: string
  screenUrl: string
  screenTitle: string
  type: "back_navigation" | "responsive_overflow" | "broken_asset" | "js_error" | "layout_shift"
  severity: "low" | "medium" | "high" | "blocker"
  viewport?: string
  description: string
  expected?: string
  actual?: string
  timestamp: string
}

export type DiscoveredScreen = {
  url: string
  title: string
  path: string
  pageType?: string
  testedAt: string
  screenshotUrl?: string
  screenshots: Record<string, string> // viewport name -> publicUrl or base64
  backNavigationStatus: "passed" | "failed" | "skipped"
  responsiveStatus: "passed" | "warning" | "failed"
  workflowId?: string
  issuesCount: number
  issues?: AutomationIssue[]
  aiAnalysis?: {
    uxScore: number
    summary: string
  }
}

export type AutomationJobStatus = "queued" | "running" | "completed" | "failed" | "stopped"

export type AutomationLog = {
  timestamp: string
  level: "info" | "success" | "warn" | "error"
  message: string
}

export type AutomationReport = {
  totalScreensTested: number
  passedScreens: number
  failedScreens: number
  totalIssues: number
  backNavigationScore: number // 0-100 percentage
  responsiveScore: number // 0-100 percentage
  summary: string
  recommendations: string[]
  issues?: AutomationIssue[]
  chainedWorkflowId?: string
  aiExecutiveSummary?: {
    executiveSummary: string
    keyStrengths: string[]
    criticalFixes: string[]
    overallScore: number
  }
}

export type AgentChatMessage = {
  id: string
  sender: "user" | "agent"
  text: string
  timestamp: string
  actionsPlanned?: AgentAction[]
  actionsExecuted?: {
    type: string
    selector?: string
    description?: string
  }[]
  status?: "thinking" | "executing" | "completed" | "error"
}

export type AgentAction = {
  id: string
  type: "navigate" | "click" | "type" | "back" | "resize" | "inspect" | "scroll" | "assert"
  description: string
  thought?: string
  target?: string
  coordinates?: { x: number; y: number }
  observation?: string
  status?: "pending" | "running" | "passed" | "failed"
  durationMs?: number
  timestamp: string
  screenshotUrl?: string
}

export type AutomationJob = {
  id: string
  targetUrl: string
  projectId: string
  status: AutomationJobStatus
  progress: number // 0 to 100
  currentStep: string
  currentAction?: AgentAction
  currentScreenshotUrl?: string
  actionHistory?: AgentAction[]
  messages?: AgentChatMessage[]
  startedAt: string
  finishedAt?: string
  credentialsProvided: boolean
  viewports: AutomationViewport[]
  maxScreens: number
  logs: AutomationLog[]
  screens: DiscoveredScreen[]
  issues: AutomationIssue[]
  report?: AutomationReport
  aiModel?: string
  aiBaseUrl?: string
  layaBaseUrl?: string
  role?: string
  chainedWorkflowId?: string
  error?: string
}

export type StartAutomationRequest = {
  url: string
  projectId: string
  userInstruction?: string
  role?: string
  layaBaseUrl?: string
  credentials?: {
    username?: string
    password?: string
    token?: string
  }
  viewports?: AutomationViewport[]
  maxScreens?: number
  checkBackNavigation?: boolean
  checkResponsive?: boolean
  openRouterApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
}

