export type AutomationViewport = {
  name: string
  width: number
  height: number
}

export type AutomationIssue = {
  id: string
  screenUrl: string
  screenTitle: string
  type:
    | "back_navigation"
    | "responsive_overflow"
    | "broken_asset"
    | "js_error"
    | "layout_shift"
    | "non_functional_control"
    | "form_validation"
    | "api_ui_mismatch"
    | "data_not_reflected"
    | "covered_element"
    | "focus_not_restored"
    | "http_error"
    | "request_failed"
    | "empty_data_surface"
  | "correlated_ui_data_failure"
  severity: "low" | "medium" | "high" | "blocker"
  viewport?: string
  description: string
  expected?: string
  actual?: string
  /** Related browser, network and visible-data evidence observed in the same step. */
  correlatedEvidence?: {
    consoleErrors?: string[]
    networkFailures?: Array<{ url: string; status?: number; errorText?: string; resourceType?: string }>
    emptyDataSurfaces?: string[]
  }
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

export type TestScenarioCategory =
  | "navigation"
  | "auth"
  | "forms"
  | "validation"
  | "error-handling"
  | "content"
  | "edge"

export type TestScenario = {
  id: string
  name: string
  category: TestScenarioCategory
  goal: string
  /** Natural-language instruction handed to the browser agent for this scenario. */
  instruction: string
  needsAuth: boolean
  fillsForms: boolean
  expectedOutcome: string
}

export type TestCaseBug = {
  description: string
  severity: "low" | "medium" | "high" | "blocker"
  repro: string[]
}

export type TestCaseScreenshot = {
  label: string
  url: string
}

export type EvidenceTrace = {
  phase: "OBSERVE" | "DECIDE" | "RECOVER" | "VERIFY"
  timestamp: string
  summary: string
  evidence?: {
    url?: string
    screenshotUrl?: string
    consoleErrors?: string[]
    actions?: number
  }
}

export type TestCaseResult = {
  scenarioId: string
  name: string
  category: TestScenarioCategory
  status: "passed" | "failed" | "blocked" | "skipped"
  steps: string[]
  screenshots: TestCaseScreenshot[]
  bugs: TestCaseBug[]
  startedAt: string
  finishedAt: string
  error?: string
  /** Evidence trail for observe/decide/recover/verify in the existing report. */
  evidenceTrace?: EvidenceTrace[]
}

export type FlowGraphNode = {
  id: string
  url: string
  title: string
  screenshotUrl?: string
  scenarioId?: string
}

export type FlowGraphEdge = {
  from: string
  to: string
  label: string
}

export type FlowGraph = {
  nodes: FlowGraphNode[]
  edges: FlowGraphEdge[]
}

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
  /** Autonomous runs: per-scenario results (15 test cases). */
  testCases?: TestCaseResult[]
  /** Autonomous runs: Figma-style node/edge flow of visited screens. */
  flowGraph?: FlowGraph
  /** Autonomous runs: session recording (webm) URL. */
  recordingUrl?: string
  /** Structured multi-step workflows executed during full app testing */
  workflows?: WorkflowRun[]
  /** Evidence-based failure report in Markdown format */
  markdownReport?: string
  postmanSummary?: PostmanCollectionSummary
  endpointMappings?: PostmanEndpointMapping[]
  postmanCoverage?: PostmanCoverageReport
  aiExecutiveSummary?: {
    executiveSummary: string
    keyStrengths: string[]
    criticalFixes: string[]
    overallScore: number
  }
}

export type PostmanCoverageReport = {
  totalEndpoints: number
  matchedEndpoints: number
  executedEndpoints: number
  wireConfirmedEndpoints: number
  wireVerificationFailedEndpoints: number
  unencounteredEndpoints: number
  coveragePercentage: number
  endpoints: Array<{
    name: string
    method: string
    url: string
    status: "unencountered" | "matched" | "executed" | "wire_confirmed" | "wire_verification_failed"
    screenId?: string
    formId?: string
  }>
  uiFieldsWithoutPostmanMatch: Array<{
    screenId: string
    formId?: string
    uiFieldName: string
    uiSelector?: string
  }>
  postmanFieldsNotFoundInUi: Array<{
    endpointName: string
    apiFieldName: string
  }>
}

export type AIThinkingModel = {
  screenUnderstanding: string
  identifiedElements: Array<{
    name: string
    type: "input" | "button" | "link" | "checkbox" | "select" | "text" | "other"
    selector?: string
    purpose: string
  }>
  riskAssessment: string[]
  strategy: string
}

export type ChecklistTestItem = {
  id: string
  title: string
  goal: string
  expectedOutcome: string
  status: "pending" | "running" | "passed" | "failed" | "skipped"
  actions: AgentAction[]
  observations?: string
  screenshotUrl?: string
  error?: string
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
  imageUrl?: string
  thinkingModel?: AIThinkingModel
  checklist?: ChecklistTestItem[]
}

export type AgentAction = {
  id: string
  type: "navigate" | "click" | "type" | "back" | "resize" | "inspect" | "scroll" | "assert"
  description: string
  thought?: string
  target?: string
  selector?: string
  value?: string
  coordinates?: { x: number; y: number }
  observation?: string
  status?: "pending" | "running" | "passed" | "failed" | "blocked"
  durationMs?: number
  timestamp: string
  screenshotUrl?: string
}

export type ActionableElementType =
  | "button"
  | "clickable"
  | "link"
  | "text"
  | "form"
  | "input"
  | "select"
  | "checkbox"
  | "radio"
  | "toggle"
  | "tab"
  | "menu"
  | "file_upload"
  | "other"

export type ActionLedgerStatus = "untested" | "running" | "passed" | "failed" | "blocked" | "skipped"

export type ActionLedgerAttempt = {
  status: Exclude<ActionLedgerStatus, "untested" | "running">
  timestamp: string
  observedOutcome?: string
  error?: string
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
}

export type ActionLedgerEntry = {
  actionKey: string
  screenId: string
  screenUrl: string
  screenPath: string
  name: string
  type: ActionableElementType
  selector?: string
  href?: string
  interactionConfidence?: number
  discoveryReason?: string[]
  status: ActionLedgerStatus
  attempts: number
  discoveredAt: string
  lastTestedAt?: string
  workflowId?: string
  error?: string
  evidence?: { beforeScreenshotUrl?: string; afterScreenshotUrl?: string; observedOutcome?: string }
  /** Most recent resolved outcomes, retained when the same action is retried. */
  history?: ActionLedgerAttempt[]
}

export type ActionLedger = {
  entries: ActionLedgerEntry[]
  /** Stable queue of actions that still need execution. */
  untestedQueue: string[]
  updatedAt: string
  total: number
  untested: number
  tested: number
  failed: number
  blocked: number
}

export type ActionableElement = {
  id: string
  name: string
  type: ActionableElementType
  selector?: string
  /** Resolved destination for navigation-capable DOM actions (primarily anchors). */
  href?: string
  /** Stable semantic identity used by the Action Ledger across rediscovery. */
  actionKey?: string
  /** Confidence that a non-native DOM object represents a user action. */
  interactionConfidence?: number
  /** Why the semantic detector considered this object actionable. */
  discoveryReason?: string[]
  inputType?: string
  accept?: string
  placeholder?: string
  value?: string
  isRequired?: boolean
  options?: string[]
  formId?: string
  tested?: boolean
  testStatus?: "passed" | "failed" | "blocked" | "pending"
  isInteractive?: boolean
  error?: string
}

export type AppScreenNode = {
  id: string // Unique: S001, S002, S003...
  name: string // Human readable: Login, Register, Dashboard, etc.
  url: string
  path: string
  screenshotUrl?: string
  actionableElements: ActionableElement[]
  forms: Array<{
    id: string
    name?: string
    selector?: string
    fields: string[]
    submitButton?: string
    submitSelector?: string
    isInsideModal?: boolean
  }>
  isNewDiscovery?: boolean
  isLoginWall?: boolean
  discoveredAt: string
}

export type AppWorkflowTransition = {
  id: string
  fromScreenId: string // e.g. "S001"
  toScreenId: string // e.g. "S002"
  action: string // e.g. "Click Register", "Submit Login Form"
  actionType: "click" | "form_submit" | "navigation" | "modal_open"
  triggerSelector?: string
}

export type AutomationVerdict =
  | "passed"
  | "failed"
  | "suspected_non_functional"
  | "blocked"
  | "skipped_unsafe"

export type ObservedEffect =
  | "navigated"
  | "modal_opened"
  | "modal_closed"
  | "dialog_shown"
  | "content_changed"
  | "media_started"
  | "network_only"
  | "error_shown"
  | "value_changed"
  | "no_effect"

export type NetworkCallEvidence = {
  method: string
  url: string
  status?: number
  durationMs?: number
  isMutating: boolean
  headers?: Record<string, string>
  postData?: string
}

/** Resource failures captured for documents, scripts, styles, images, media and API requests. */
export type ResourceIssueEvidence = {
  url: string
  resourceType: string
  method: string
  status?: number
  errorText?: string
  timestamp: string
}

export type StepEvidence = {
  expectedEffects: ObservedEffect[]
  observedEffect: ObservedEffect
  verdict: AutomationVerdict
  reason: string
  retriesUsed: number
  isWeakPass?: boolean
  settleDurationMs: number
  networkCalls: NetworkCallEvidence[]
  consoleErrors: string[]
  beforeScreenshotUrl?: string
  afterScreenshotUrl?: string
  coveredElementDetected?: boolean
  reproCurl?: string
}

export type WorkflowStepEvidence = {
  stepIndex: number
  screenId: string
  screenName: string
  action: string
  targetSelector?: string
  targetName?: string
  inputData?: Record<string, any>
  expectedOutcome: string
  observedOutcome?: string
  verdict: AutomationVerdict
  durationMs: number
  evidence?: StepEvidence
  reproCurl?: string
  dataPersisted?: boolean
  screenshotUrl?: string
  error?: string
}

export type WorkflowRun = {
  id: string
  name: string
  entryScreenId: string
  entryUrl: string
  steps: WorkflowStepEvidence[]
  failedAtStep?: number
  verdict: AutomationVerdict
  entityTrackingId?: string
  dataReflected?: boolean
  summary: string
  reproSteps?: string[]
}

export type TestPlanStep = {
  id: string
  screenId: string
  screenName: string
  stepIndex: number
  actionType:
    | "fill"
    | "click"
    | "upload"
    | "select"
    | "toggle"
    | "verify"
    | "navigate"
    | "form_scenario"
    | "modal_close"
  targetName: string
  targetSelector?: string
  /** Stable Action Ledger identity for the DOM action this step executes. */
  actionKey?: string
  syntheticValue?: string
  fileTypeRequired?: "image" | "pdf" | "document" | "video" | "csv" | "other"
  expectedResult: string
  actualResult?: string
  status: "pending" | "running" | "passed" | "failed" | "blocked" | "suspected_non_functional" | "skipped_unsafe"
  verdict?: AutomationVerdict
  evidence?: StepEvidence
  screenshotUrl?: string
  evidenceTimestamp?: string
  error?: string
  isNewDiscovery?: boolean
  formId?: string
  formVariant?: "valid" | "required_empty" | "invalid_format" | "boundary"
  fieldPayload?: Record<string, string>
  postmanEndpoint?: ParsedPostmanEndpoint
  postmanMappings?: PostmanFieldMapping[]
  confirmedOnWire?: boolean
}

export type FullAppTestPlan = {
  id: string
  targetUrl: string
  screens: AppScreenNode[]
  transitions: AppWorkflowTransition[]
  steps: TestPlanStep[]
  workflows?: WorkflowRun[]
  postmanSummary?: PostmanCollectionSummary
  requiredFileTypes: Array<{
    type: "image" | "pdf" | "document" | "video" | "csv" | "other"
    count: number
    providedFileUrl?: string
    providedFileName?: string
  }>
  status: "discovery" | "planned" | "testing" | "completed" | "error"
  coverage: {
    screensTested: number
    totalScreens: number
    actionsTested: number
    totalActions: number
    formsTested: number
    totalForms: number
    percentage: number
  }
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
  actionLedger?: ActionLedger
  aiModel?: string
  aiBaseUrl?: string
  layaBaseUrl?: string
  role?: string
  chainedWorkflowId?: string
  error?: string
  projectDir?: string
  /** "autonomous" routes the job through the Stagehand scenario engine; "full_app" routes to systematic engine; "feature_workflow" runs targeted feature testing. */
  mode?: "chat" | "crawl" | "autonomous" | "full_app" | "feature_workflow"
  /** Autonomous runs: planned scenarios, per-scenario results, flow graph, recording. */
  scenarios?: TestScenario[]
  testCases?: TestCaseResult[]
  flowGraph?: FlowGraph
  recordingUrl?: string
  /** Vision-driven thinking model & interactive UI checklist */
  thinkingModel?: AIThinkingModel
  checklist?: ChecklistTestItem[]
  /** Systematic Full App Testing & Feature Workflow architecture */
  fullAppTestPlan?: FullAppTestPlan
  testingPhase?: "discovery" | "planning" | "files" | "executing" | "reporting"
  dummyTestFiles?: Record<string, { name: string; url: string; type: string }>
  /** Feature / Workflow Testing mode fields */
  workflowName?: string
  featureWorkflowSpec?: FeatureWorkflowSpec
  edgeCasesTested?: FeatureWorkflowEdgeCase[]
  workflowClarification?: { question: string; options?: string[] }
  /** Login-wall handling: engine pauses in "awaiting_credentials" until the UI supplies creds or skips. */
  authState?: "none" | "awaiting_credentials" | "logged_in" | "login_failed" | "skipped"
  authPrompt?: string
  pendingCredentials?: { username?: string; password?: string; skip?: boolean }
  /** Payment form handling: pauses or prompts for test card credentials, or uses sandbox defaults. */
  paymentState?: "none" | "awaiting_payment_credentials" | "provided" | "skipped"
  paymentPrompt?: string
  pendingPaymentCredentials?: TestPaymentCredentials
  /** Last AI-provider error surfaced loudly to the user (never a silent fallback). */
  aiError?: string
  /** Postman Collection v2.1 for API-to-UI data mapping */
  postmanCollection?: string | Record<string, any>
  postmanSummary?: PostmanCollectionSummary
  /** Folder path for real test files to upload during testing */
  uploadFilesDir?: string
  /** Email & external verification handling: pauses testing until user clicks email link or enters OTP code */
  verificationState?: "none" | "awaiting_verification" | "verified" | "skipped"
  verificationPrompt?: string
  pendingVerification?: {
    completed?: boolean
    verificationUrl?: string
    verificationCode?: string
    skip?: boolean
  }
  /** Secure application settings & API keys configuration: prompts user for API keys/tokens and masks them */
  settingsState?: "none" | "awaiting_credentials" | "configured" | "skipped"
  settingsPrompt?: string
  requiredSettingsFields?: Array<{
    key: string
    label: string
    isSecret?: boolean
    placeholder?: string
  }>
  pendingSettingsCredentials?: Record<string, string> & { skip?: boolean }
}

export type TestPaymentCredentials = {
  cardNumber?: string
  cardHolder?: string
  expiryDate?: string
  cvv?: string
  zipCode?: string
  skip?: boolean
  useDefaultSandbox?: boolean
}

export type FeatureWorkflowEdgeCase = {
  id: string
  name: string
  type: "missing_field" | "invalid_format" | "boundary" | "duplicate" | "valid"
  description: string
  expectedBehavior: string
  status?: "pending" | "running" | "passed" | "failed" | "blocked"
  actualResult?: string
  screenshotUrl?: string
  error?: string
}

export type FeatureWorkflowSpec = {
  workflowName: string
  userGoal: string
  startingPoint: string
  expectedOutcome: string
  likelyScreens: string[]
  requiredActions: string[]
  formsInvolved: string[]
  syntheticDataRequired: Record<string, string>
  possibleBranches: string[]
  validationStates: string[]
  edgeCases: FeatureWorkflowEdgeCase[]
  clarificationQuestion?: string
  isAmbiguous?: boolean
}

export type StartAutomationRequest = {
  url: string
  projectId: string
  projectDir?: string
  userInstruction?: string
  workflowPrompt?: string
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
  aiApiKey?: string
  aiModel?: string
  aiBaseUrl?: string
  /** "autonomous" runs Stagehand; "full_app" runs systematic discovery->plan->execute; "feature_workflow" tests specific user workflow; default is crawl/chat. */
  mode?: "autonomous" | "crawl" | "chat" | "full_app" | "feature_workflow"
  scenarioCount?: number
  /** User-provided image (data URI or URL) for vision inspection */
  image?: string
  dummyTestFiles?: Record<string, { name: string; url: string; type: string }>
  /** Allow specific actions normally blocked or soft-skipped by safety guard (e.g. 'delete', 'send', 'invite') */
  allowActions?: string[]
  /** Custom additional hosts to filter out from network tracking */
  noiseHosts?: string[]
  /** Postman Collection v2.1 for API-to-UI data mapping */
  postmanCollection?: string | Record<string, any>
  /** Custom test payment credentials or sandbox preferences */
  paymentCredentials?: TestPaymentCredentials
  allowTestPayments?: boolean
  /** Whether to record session video with visible cursor & interaction highlights (default true) */
  recordVideo?: boolean
  /** Folder path for real test files to check and upload during file upload testing */
  uploadFilesDir?: string
}

export type ParsedPostmanEndpoint = {
  name: string
  method: string
  url: string
  pathSegments: string[]
  headers: Record<string, string>
  payloadFields: Record<string, any>
  rawBody?: string
  description?: string
}

export type PostmanFieldMapping = {
  uiFieldName: string
  uiSelector?: string
  uiInputType?: string
  apiFieldName: string
  apiValue: any
  confidenceScore: number
  confidenceLevel: "high" | "medium" | "low" | "unmatched"
  matchMethod: "exact_key" | "fuzzy_label" | "semantic_type" | "fallback"
  confirmedOnWire?: boolean
}

export type PostmanEndpointMapping = {
  endpoint: ParsedPostmanEndpoint
  screenId: string
  formId?: string
  fieldMappings: PostmanFieldMapping[]
  overallConfidence: "high" | "medium" | "low"
}

export type PostmanCollectionSummary = {
  name: string
  description?: string
  endpoints: ParsedPostmanEndpoint[]
}


