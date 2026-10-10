/**
 * Autonomous test runner — the engine behind "make the Testing Bot work".
 *
 * Takes over a job when the user asks for autonomous exploration
 * (mode === "autonomous", or chat commands like "test every page" /
 * "run 15 scenarios"). For each planned scenario it drives a real
 * Stagehand browser agent against the target app, records session video,
 * captures masked screenshots, and compiles test cases + a flow graph +
 * a final report into the existing job shape the UI already renders.
 *
 * Honesty rules: if the AI provider is unreachable the run is marked
 * BLOCKED with the reason — never a fake pass. Destructive actions are
 * forbidden by instruction AND verified post-hoc; a hit fails loudly.
 */

import path from "path"
import fs from "fs"
import puppeteer, { type Browser, type Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"

import type {
  AutomationJob,
  AutomationIssue,
  DiscoveredScreen,
  StartAutomationRequest,
  TestCaseResult,
  TestCaseBug,
  FlowGraph,
} from "./types"
import { saveJob, getJob, appendLog, jobDir } from "./job-store"
import { planScenarios } from "./scenario-planner"
import { discoverLocalProjectRoutes } from "./discover-routes"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import type { JourneyStep, PageType } from "@/lib/journey/types"
import { performVisibleLoginPlaywright } from "./human-actions"
import { runHumanLikeDecisionLoop } from "./human-test-loop"
import { resolveAiApiKey, NEBIUS_BASE_URL } from "./ai-gateway"
import { clearJobSecrets } from "./job-secret-vault"

export function isAutonomousCommand(cmd: string): boolean {
  return /(every page|all pages|full (test|audit|run)|autonomous|test every|explore( the app)?|end[\s-]?to[\s-]?end|\d+\s*scenarios?)/i.test(
    cmd,
  )
}

export function scenarioCountFromCommand(cmd: string, fallback: number): number {