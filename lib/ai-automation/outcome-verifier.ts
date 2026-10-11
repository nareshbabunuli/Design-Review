import type { Page, ElementHandle, HTTPRequest, HTTPResponse } from "puppeteer"
import { humanClick } from "./human-actions"
import { secretRedactor } from "./secure-credentials-manager"
import type {
  ObservedEffect,
  AutomationVerdict,
  StepEvidence,
  NetworkCallEvidence,
  ResourceIssueEvidence,
} from "./types"

/** Built-in analytics / telemetry / tracking host regexes to filter out */
const DEFAULT_NOISE_HOSTS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)segment\.(com|io)$/i,
  /(^|\.)hotjar\.com$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)intercom\.io$/i,
  /(^|\.)posthog\.com$/i,
  /(^|\.)mixpanel\.com$/i,
  /(^|\.)datadoghq\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)facebook\.net$/i,
]

const NOISE_PATH_PATTERNS = [
  /\/ping(\/|$|\?)/i,
  /\/health(\/|$|\?)/i,
  /\/heartbeat(\/|$|\?)/i,
  /\/telemetry(\/|$|\?)/i,
  /\/analytics(\/|$|\?)/i,
  /\/favicon\.ico$/i,
]

// Pure semantics live in outcome-semantics.ts so unit tests avoid Puppeteer/storage imports.
export type { ElementSemantics } from "./outcome-semantics"
export { expectFor } from "./outcome-semantics"

export type PageSnapshot = {
  url: string
  title: string
  hasModal: boolean
  modalText: string
  elementCount: number
  headingText: string
  mediaPlaying: boolean
  normalizedHash: string
  hasErrorAlert: boolean
}
