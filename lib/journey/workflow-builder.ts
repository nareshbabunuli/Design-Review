/**
 * Turns ordered journey steps into a Design-Review Workflow record.
 */

import { createClient } from "@supabase/supabase-js"
import type { JourneyConfig, JourneyStep, JourneyRole } from "./types"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  return createClient(url, key)
}

function roleLabel(role: JourneyRole, custom?: string): string {
  if (role === "custom" && custom) return custom
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function buildTitle(config: JourneyConfig, steps: JourneyStep[]): string {
  if (config.title) return config.title
  const role = roleLabel(config.role, config.customRoleLabel)
  if (steps.length === 0) return `${role} Journey`
  const path = steps
    .slice(0, 4)
    .map((s) => (s.pageType !== "other" ? s.pageType : (s.title || "page").slice(0, 24)))
    .join(" → ")
  const more = steps.length > 4 ? ` (+${steps.length - 4})` : ""
  return `${role} – ${path}${more}`
}

function buildNotes(config: JourneyConfig, steps: JourneyStep[]): string {
  const meta = {
    journeyRole: config.role,
    customRoleLabel: config.customRoleLabel || null,
    startUrl: config.startUrl,
    capturedAt: new Date().toISOString(),
    stepCount: steps.length,
    steps: steps.map((s) => ({
      index: s.index,
      url: s.url,
      title: s.title,
      pageType: s.pageType,
      hasBlockingIssue: s.hasBlockingIssue,
      severity: s.severity || null,
      screenshotUrl: s.screenshotUrl,
      viewport: s.viewport,
      capturedAt: s.capturedAt,
    })),
  }
  return JSON.stringify(meta, null, 2)
}

export async function createWorkflowFromJourney(
  config: JourneyConfig,
  steps: JourneyStep[]
): Promise<{ workflowId: string; title: string }> {
  if (steps.length === 0) {
    throw new Error("No steps captured — cannot create workflow")
  }

  const supabase = getSupabase()
  const title = buildTitle(config, steps)
  const notes = buildNotes(config, steps)
  const firstShot = steps[0].screenshotUrl
  const lastShot = steps[steps.length - 1].screenshotUrl

  const { data, error } = await supabase
    .from("workflows")
    .insert({
      project_id: config.projectId,
      title,
      design_a: null,
      design_b: firstShot,
      figma_url: null,
      our_notes: notes,
      client_message: "",
      client_task_done: false,
      reason: `Auto-captured ${config.role} journey (${steps.length} screens). Last screen: ${lastShot}`,
      is_done: false,
    })
    .select("id, title")
    .single()

  if (error) throw new Error(`Failed to create workflow: ${error.message}`)
  if (!data?.id) throw new Error("Workflow insert returned no id")

  return { workflowId: data.id, title: data.title || title }
}
