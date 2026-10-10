import fs from "fs"
import path from "path"
import puppeteer, { type Browser, type Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import {
  AutomationJob,
  AutomationIssue,
  DiscoveredScreen,
  AutomationLog,
  AutomationViewport,
  StartAutomationRequest,
  AgentAction,
  AgentChatMessage,
  AIThinkingModel,
  ChecklistTestItem,
} from "./types"
import {
  resolveAiApiKey,
  NEBIUS_BASE_URL,
  analyzeScreenWithAI,
  generateAIExecutiveReport,
  interpretCommandWithAI,
  generateVisionThinkingModelAndChecklist,
} from "./ai-gateway"
import type { AICommandInterpretation } from "./ai-gateway"
import { tryLayaReflexPlan } from "./laya-reflex"
import { discoverLocalProjectRoutes } from "./discover-routes"
import { classifyPage, pickNextLink, isLayaAvailable, DEFAULT_LAYA_URL } from "@/lib/journey/laya-client"
import { createWorkflowFromJourney } from "@/lib/journey/workflow-builder"
import { executeAutonomousJob, isAutonomousCommand } from "./autonomous-runner"
import { clearJobSecrets } from "./job-secret-vault"