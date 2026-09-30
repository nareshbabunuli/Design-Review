/** Journey Capture types — Figma-style ordered screenshot workflows by role */

export type JourneyRole = "user" | "admin" | "client" | "editor" | "viewer" | "custom"

export type PageType =
  | "login"
  | "dashboard"
  | "form"
  | "list"
  | "detail"
  | "error"
  | "empty"
  | "success"
  | "settings"
  | "other"

export interface JourneyStep {
  index: number
  url: string
  title: string
  screenshotUrl: string
  pageType: PageType
  hasBlockingIssue: boolean
  severity?: "Low" | "Medium" | "High" | "Blocker"
  viewport: { width: number; height: number }
  capturedAt: string
  notes?: string
}

export interface JourneyConfig {
  projectId: string
  role: JourneyRole
  customRoleLabel?: string
  startUrl: string
  /** Explicit ordered list of URLs. If empty, runner explores links from the page. */
  urls?: string[]
  maxSteps?: number
  width?: number
  height?: number
  cookies?: string
  credentials?: {
    type?: "login" | "cookie" | "token"
    username?: string
    password?: string
    cookie?: string
    token?: string
  }
  accessToken?: string
  refreshToken?: string
  layaBaseUrl?: string
  title?: string
}

export type JourneyStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export interface JourneyState {
  id: string
  status: JourneyStatus
  config: JourneyConfig
  steps: JourneyStep[]
  currentIndex: number
  error?: string
  workflowId?: string
  startedAt: string
  finishedAt?: string
}
