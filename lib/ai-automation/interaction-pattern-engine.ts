/**
 * Deterministic interaction-pattern engine for autonomous UI testing.
 *
 * Answers: "What meaningful tests are applicable to the current state?"
 * It does not choose the next test. Laya chooses from the candidates.
 */

export type InteractionPatternCategory =
  | "navigation" | "actions" | "overlays" | "forms" | "data"
  | "authentication" | "async" | "accessibility" | "responsive"

export type InteractionPattern =
  | "link_navigation" | "external_link" | "back_navigation" | "forward_navigation" | "refresh"
  | "button" | "toggle" | "checkbox" | "radio" | "expand_collapse"
  | "save" | "delete" | "cancel" | "undo"
  | "modal" | "popup" | "dropdown" | "popover" | "tooltip"
  | "required_validation" | "invalid_input" | "valid_input" | "password_confirmation"
  | "form_submit" | "form_cancel" | "form_reset" | "multi_step_form"
  | "table" | "empty_state" | "pagination" | "sorting" | "filtering" | "search"
  | "create" | "update" | "delete_data" | "refresh_data"
  | "login" | "logout" | "session" | "protected_route" | "authorization"
  | "loading" | "error_state" | "network_failure" | "retry"
  | "keyboard_navigation" | "focus" | "focus_restoration" | "accessible_name"
  | "responsive_layout"

export type PatternRisk = "safe" | "mutating" | "destructive"

export type PatternTarget = {
  selector?: string
  label?: string
  role?: string
  href?: string
  elementType?: string
}

export type InteractionPatternMatch = {
  pattern: InteractionPattern
  category: InteractionPatternCategory
  confidence: number
  targets: PatternTarget[]
  reason: string
  risk: PatternRisk
}

export type CandidateTest = {
  id: string
  pattern: InteractionPattern
  category: InteractionPatternCategory
  title: string
  goal: string
  target?: PatternTarget
  targets: PatternTarget[]
  preconditions: string[]
  actions: string[]
  expectedOutcome: string
  risk: PatternRisk
  priority: number
  stateKey: string
  generatedAt: string
}

export type PatternElement = {
  selector?: string
  tag?: string
  role?: string
  type?: string
  label?: string
  text?: string
  href?: string
  visible?: boolean
  enabled?: boolean
  disabled?: boolean
  required?: boolean
  placeholder?: string
  expanded?: boolean
  pressed?: boolean
  sortable?: boolean
  accessibleName?: boolean
  clickHandler?: boolean
}

export type PatternFormField = {
  selector?: string
  label?: string
  name?: string
  type?: string
  required?: boolean
  invalid?: boolean
  confirmationFor?: string
}

export type PatternForm = {
  selector?: string
  name?: string
  fields: PatternFormField[]
  submitTargets?: PatternTarget[]
  cancelTargets?: PatternTarget[]
  resetTargets?: PatternTarget[]
  multiStep?: boolean
}

export type PatternTable = {
  selector?: string
  name?: string
  columns: string[]
  rowCount: number
  hasExplicitEmptyState: boolean
  hasPagination: boolean
  hasSorting: boolean
  hasFiltering: boolean
}

export type PatternDialog = {
  selector?: string
  label?: string
  modal?: boolean
  closeTargets?: PatternTarget[]
  hasForm?: boolean
}

export type PatternState = {
  stateKey: string
  url: string
  origin?: string
  route?: string
  title?: string
  viewport?: { width: number; height: number }
  elements: PatternElement[]
  forms: PatternForm[]
  tables: PatternTable[]
  dialogs: PatternDialog[]
  loading?: boolean
  consoleErrorCount?: number
  network?: {
    failedCount?: number
    status4xx?: number
    status5xx?: number
    resource404Count?: number
  }
}

const META: Record<InteractionPattern, {
  category: InteractionPatternCategory
  risk: PatternRisk
  priority: number
}> = {
  link_navigation: { category: "navigation", risk: "safe", priority: 72 },
  external_link: { category: "navigation", risk: "safe", priority: 25 },
  back_navigation: { category: "navigation", risk: "safe", priority: 62 },
  forward_navigation: { category: "navigation", risk: "safe", priority: 42 },
  refresh: { category: "navigation", risk: "safe", priority: 38 },
  button: { category: "actions", risk: "safe", priority: 55 },
  toggle: { category: "actions", risk: "mutating", priority: 50 },
  checkbox: { category: "actions", risk: "mutating", priority: 44 },
  radio: { category: "actions", risk: "safe", priority: 42 },
  expand_collapse: { category: "actions", risk: "safe", priority: 45 },
  save: { category: "actions", risk: "mutating", priority: 68 },
  delete: { category: "actions", risk: "destructive", priority: 8 },
  cancel: { category: "actions", risk: "safe", priority: 40 },
  undo: { category: "actions", risk: "safe", priority: 55 },
  modal: { category: "overlays", risk: "safe", priority: 66 },
  popup: { category: "overlays", risk: "safe", priority: 48 },
  dropdown: { category: "overlays", risk: "safe", priority: 50 },
  popover: { category: "overlays", risk: "safe", priority: 40 },
  tooltip: { category: "overlays", risk: "safe", priority: 25 },
  required_validation: { category: "forms", risk: "safe", priority: 78 },
  invalid_input: { category: "forms", risk: "safe", priority: 74 },
  valid_input: { category: "forms", risk: "mutating", priority: 60 },
  password_confirmation: { category: "forms", risk: "safe", priority: 64 },
  form_submit: { category: "forms", risk: "mutating", priority: 62 },
  form_cancel: { category: "forms", risk: "safe", priority: 45 },
  form_reset: { category: "forms", risk: "safe", priority: 38 },
  multi_step_form: { category: "forms", risk: "mutating", priority: 67 },
  table: { category: "data", risk: "safe", priority: 70 },
  empty_state: { category: "data", risk: "safe", priority: 64 },
  pagination: { category: "data", risk: "safe", priority: 54 },
  sorting: { category: "data", risk: "safe", priority: 46 },
  filtering: { category: "data", risk: "safe", priority: 55 },
  search: { category: "data", risk: "safe", priority: 58 },
  create: { category: "data", risk: "mutating", priority: 60 },
  update: { category: "data", risk: "mutating", priority: 58 },
  delete_data: { category: "data", risk: "destructive", priority: 8 },
  refresh_data: { category: "data", risk: "safe", priority: 43 },
  login: { category: "authentication", risk: "safe", priority: 76 },
  logout: { category: "authentication", risk: "safe", priority: 28 },
  session: { category: "authentication", risk: "safe", priority: 58 },
  protected_route: { category: "authentication", risk: "safe", priority: 56 },
  authorization: { category: "authentication", risk: "safe", priority: 62 },
  loading: { category: "async", risk: "safe", priority: 62 },
  error_state: { category: "async", risk: "safe", priority: 72 },
  network_failure: { category: "async", risk: "safe", priority: 78 },
  retry: { category: "async", risk: "safe", priority: 54 },
  keyboard_navigation: { category: "accessibility", risk: "safe", priority: 44 },
  focus: { category: "accessibility", risk: "safe", priority: 45 },
  focus_restoration: { category: "accessibility", risk: "safe", priority: 42 },
  accessible_name: { category: "accessibility", risk: "safe", priority: 35 },
  responsive_layout: { category: "responsive", risk: "safe", priority: 50 },
}

function norm(v?: string): string {
  return (v || "").trim().toLowerCase().replace(/\s+/g, " ")
}

function target(el: PatternElement): PatternTarget {
  return {
    selector: el.selector,
    label: el.label || el.text || el.placeholder || el.role || el.tag,
    role: el.role,
    href: el.href,
    elementType: el.tag || el.type,
  }
}

function add(
  out: InteractionPatternMatch[],
  pattern: InteractionPattern,
  targets: PatternTarget[],
  reason: string,
  confidence = 1,
) {
  const m = META[pattern]
  out.push({
    pattern,
    category: m.category,
    confidence,
    targets,
    reason,
    risk: m.risk,
  })
}

function containsAny(text: string, values: string[]): boolean {
  return values.some((v) => text.includes(v))
}

function visible(el: PatternElement): boolean {
  return el.visible !== false && el.disabled !== true && el.enabled !== false
}

export function detectInteractionPatterns(state: PatternState): InteractionPatternMatch[] {
  const out: InteractionPatternMatch[] = []
  const elements = state.elements.filter(visible)

  for (const el of elements) {
    const t = target(el)
    const tag = norm(el.tag)
    const role = norm(el.role)
    const type = norm(el.type)
    const text = norm([el.label, el.text, el.placeholder, el.type].filter(Boolean).join(" "))

    if (el.href) {
      if (state.origin && /^https?:\/\//i.test(el.href) && !el.href.startsWith(state.origin)) {
        add(out, "external_link", [t], "Visible link leaves the target origin.", 0.98)
      } else {
        add(out, "link_navigation", [t], "Visible in-app navigation link.", 0.99)
      }
    }

    if (tag === "button" || role === "button" || role === "tab" || role === "menuitem" || role === "option" || role === "link" || type === "button" || type === "submit") {
      if (containsAny(text, ["delete", "remove", "destroy", "unsubscribe", "cancel subscription"])) {
        add(out, "delete", [t], "Destructive action detected; execution is disabled by default.", 0.99)
      } else if (containsAny(text, ["save", "update"])) {
        add(out, "save", [t], "Save/update action detected.", 0.96)
      } else if (containsAny(text, ["cancel", "close"])) {
        add(out, "cancel", [t], "Cancel/close action detected.", 0.94)
      } else if (containsAny(text, ["undo", "restore"])) {
        add(out, "undo", [t], "Undo/restore action detected.", 0.94)
      } else if (containsAny(text, ["add", "create", "new"])) {
        add(out, "create", [t], "Create/add action detected.", 0.94)
      } else {
        add(out, "button", [t], "Visible actionable button.", 0.9)
      }
    }

    if (el.clickHandler && !["button", "a", "input", "select", "textarea"].includes(tag) && !["button", "link", "tab", "menuitem", "option"].includes(role)) {
      add(out, "button", [t], "Custom visible element exposes click/tab interaction semantics.", 0.82)
    }
    if (type === "checkbox" || role === "checkbox") {
      add(out, "checkbox", [t], "Checkbox can change selection state.", 0.99)
    }
    if (type === "radio" || role === "radio") {
      add(out, "radio", [t], "Radio control can change selection state.", 0.99)
    }
    if (role === "switch" || (el.pressed !== undefined && (tag === "button" || role === "button"))) {
      add(out, "toggle", [t], "Toggle/switch exposes a stateful control.", 0.96)
    }
    if ((tag === "select" || role === "combobox") && type !== "hidden") {
      add(out, "dropdown", [t], "Dropdown/combobox can change selected options.", 0.96)
    }
    if ((tag === "button" || role === "button") && (el.expanded !== undefined || containsAny(text, ["expand", "collapse", "show more", "show less"]))) {
      add(out, "expand_collapse", [t], "Expandable/collapsible control detected.", 0.94)
    }
    if (type === "search" || role === "searchbox" || text.includes("search")) {
      add(out, "search", [t], "Search control detected.", 0.98)
    }
    // Only text-entry controls receive synthetic text. Choice controls and
    // action controls have dedicated patterns; specialized inputs need
    // type-aware values and must not be treated as generic text fields.
    const textEntryTypes = new Set([
      "text", "email", "search", "tel", "url", "password",
    ])
    const isTextEntry = tag === "textarea" || (tag === "input" && textEntryTypes.has(type))
    if (isTextEntry) {
      if (type !== "search") {
        add(out, "valid_input", [t], "Text-entry field can be tested with a type-appropriate synthetic value.", 0.9)
      }
      if (el.required) add(out, "required_validation", [t], "Required text-entry field can be tested empty without submitting.", 0.98)
      if (type === "email" || type === "url") {
        add(out, "invalid_input", [t], "Typed field supports malformed-input validation.", 0.96)
      }
    }
    if (el.accessibleName === false && ["button", "a", "input", "select", "textarea"].includes(tag)) {
      add(out, "accessible_name", [t], "Interactive element appears to lack an accessible name.", 0.96)
    }
  }

  for (const form of state.forms) {
    const targetForField = (f: PatternFormField): PatternTarget => ({
      selector: f.selector,
      label: f.label || f.name || f.type,
      elementType: f.type,
    })
    const targets = form.fields.map(targetForField)
    const requiredTargets = form.fields
      .filter((f) => f.required && (f.type === "textarea" || ["text", "email", "search", "tel", "url", "password"].includes(norm(f.type))))
      .map(targetForField)
    const invalidTargets = form.fields.filter((f) => f.invalid || f.type === "email").map(targetForField)
    const confirmationTargets = form.fields.filter((f) => f.confirmationFor).map(targetForField)
    if (requiredTargets.length) {
      add(out, "required_validation", requiredTargets, "Form contains required fields.", 0.99)
    }
    if (invalidTargets.length) {
      add(out, "invalid_input", invalidTargets, "Form contains fields suitable for safe invalid-input validation.", 0.98)
    }
    if (confirmationTargets.length) {
      add(out, "password_confirmation", confirmationTargets, "Form contains a confirmation field.", 0.98)
    }
    if (form.submitTargets?.length) add(out, "form_submit", form.submitTargets, "Form has a submit action.", 0.95)
    if (form.cancelTargets?.length) add(out, "form_cancel", form.cancelTargets, "Form has a cancel action.", 0.97)
    if (form.resetTargets?.length) add(out, "form_reset", form.resetTargets, "Form has a reset action.", 0.97)
    if (form.multiStep) add(out, "multi_step_form", form.submitTargets || targets, "Form is multi-step.", 0.99)
  }

  for (const table of state.tables) {
    const t: PatternTarget = { selector: table.selector, label: table.name || "data table", elementType: "table" }
    add(out, "table", [t], "Data table/grid detected.", 0.99)
    if (table.rowCount === 0) {
      add(out, "empty_state", [t],
        table.hasExplicitEmptyState
          ? "Table is empty and has an explicit empty state; verify it."
          : "Table is empty without an explicit empty state; investigate it.",
        0.99)
    }
    const paginationTargets = elements.filter((el) => /\b(next|previous|prev|first page|last page|page \d+)\b/i.test(norm([el.label, el.text, el.role].filter(Boolean).join(" ")))).map(target)
    const sortingTargets = elements.filter((el) => el.sortable || /\bsort\b/i.test(norm([el.label, el.text].filter(Boolean).join(" ")))).map(target)
    const filteringTargets = elements.filter((el) => /\bfilter\b/i.test(norm([el.label, el.text, el.placeholder].filter(Boolean).join(" ")))).map(target)
    if (table.hasPagination && paginationTargets.length) add(out, "pagination", paginationTargets.slice(0, 4), "Pagination controls are available.", 0.97)
    if (table.hasSorting && sortingTargets.length) add(out, "sorting", sortingTargets.slice(0, 4), "Sortable controls are available.", 0.95)
    if (table.hasFiltering && filteringTargets.length) add(out, "filtering", filteringTargets.slice(0, 4), "Filtering controls are available.", 0.95)
  }

  for (const dialog of state.dialogs.filter((d) => d.modal !== false)) {
    const t: PatternTarget = { selector: dialog.selector, label: dialog.label || "dialog", elementType: "dialog" }
    add(out, "modal", [t], "Dialog/modal is open.", 0.99)
    if (dialog.closeTargets?.length) add(out, "cancel", dialog.closeTargets, "Dialog exposes a close action.", 0.97)
    if (dialog.hasForm) add(out, "form_submit", [t], "Dialog contains a form.", 0.96)
  }

  if (state.network?.failedCount || state.network?.status4xx || state.network?.status5xx || state.network?.resource404Count) {
    add(out, "network_failure", [], "Current state contains failed network/resource evidence.", 0.99)
  }
  if ((state.consoleErrorCount || 0) > 0) {
    add(out, "error_state", [], "Current state contains browser console errors.", 0.99)
  }
  if (state.loading) add(out, "loading", [], "Current state is loading.", 0.98)

  // These are state-transition tests, not DOM targets.
  add(out, "back_navigation", [], "Safe browser-history test is applicable.", 0.8)
  add(out, "forward_navigation", [], "Safe browser Forward test is applicable when same-origin history exists.", 0.6)
  add(out, "keyboard_navigation", [], "Keyboard focus traversal can be inspected safely.", 0.58)
  add(out, "responsive_layout", [], "A mobile viewport can be checked for overflow and clipping.", 0.56)
  add(out, "refresh", [], "Safe reload test is applicable.", 0.75)

  return dedupe(out)
}

function dedupe(matches: InteractionPatternMatch[]): InteractionPatternMatch[] {
  const seen = new Set<string>()
  return matches.filter((m) => {
    const key = m.pattern + "|" + m.targets.map((t) => t.selector || t.label || t.href || "").sort().join(",")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stableId(stateKey: string, pattern: InteractionPattern, target?: PatternTarget): string {
  const input = stateKey + "|" + pattern + "|" + (target?.selector || target?.href || target?.label || "screen")
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return "test-" + (hash >>> 0).toString(16)
}

function candidateFor(
  state: PatternState,
  match: InteractionPatternMatch,
  t: PatternTarget | undefined,
): CandidateTest {
  const label = t?.label || match.pattern.replace(/_/g, " ")
  let title = "Test " + label
  let goal = "Verify " + match.pattern.replace(/_/g, " ") + " behavior."
  let actions = ["Perform the safe interaction.", "Observe the resulting UI, console and network state.", "Verify expected versus actual behavior."]
  let expected = "The interaction produces the expected state without an application error."

  switch (match.pattern) {
    case "link_navigation":
      title = "Navigate using " + label
      goal = "Verify safe in-app navigation."
      actions = ["Activate the link.", "Wait for the destination to settle.", "Verify URL and destination content."]
      expected = "Expected route loads without blank/error state."
      break
    case "back_navigation":
      title = "Verify browser Back"
      goal = "Verify browser history restores the previous state."
      actions = ["Navigate to a safe child state.", "Press browser Back.", "Compare URL and meaningful UI state."]
      expected = "Back restores the previous state."
      break
    case "refresh":
      title = "Verify reload stability"
      goal = "Verify the current route survives a reload."
      actions = ["Reload.", "Wait for stability.", "Compare URL and meaningful UI state."]
      expected = "The same route remains usable after reload."
      break
    case "search":
      title = "Test search: " + label
      goal = "Verify search and no-match behavior."
      actions = ["Enter a safe query.", "Verify results change.", "Try a no-match query.", "Verify an explicit empty state.", "Clear search."]
      expected = "Search updates results and handles no-match safely."
      break
    case "required_validation":
      title = "Test required validation"
      goal = "Verify required fields block invalid submission."
      actions = ["Leave required fields empty.", "Attempt safe submission.", "Inspect validation and network."]
      expected = "Visible validation blocks invalid submission."
      break
    case "invalid_input":
      title = "Test invalid input: " + label
      goal = "Verify malformed input is rejected."
      actions = ["Enter an invalid value.", "Blur or submit safely.", "Inspect validation and network."]
      expected = "Invalid value is clearly rejected."
      break
    case "modal":
      title = "Test modal: " + label
      goal = "Verify modal lifecycle and focus behavior."
      actions = ["Inspect modal.", "Use safe controls.", "Close modal.", "Verify underlying state and focus restoration."]
      expected = "Modal opens/closes correctly and underlying UI remains usable."
      break
    case "table":
      title = "Verify table: " + label
      goal = "Verify data rendering and table state."
      actions = ["Inspect loading.", "Inspect rows/columns.", "Correlate data requests.", "Verify visible data."]
      expected = "Table shows coherent data or an explicit empty/error state."
      break
    case "empty_state":
      title = "Verify empty state: " + label
      goal = "Determine whether empty data is intentional and correctly communicated."
      actions = ["Inspect table/grid.", "Inspect related network request.", "Inspect console.", "Verify empty-state UI."]
      expected = "Empty data is explained by a valid state or becomes evidence for an issue."
      break
    case "pagination":
      title = "Test pagination: " + label
      goal = "Verify page transitions and data consistency."
      actions = ["Open next page.", "Verify URL/state/data.", "Return to previous page.", "Verify original state."]
      expected = "Pagination changes data correctly and remains consistent."
      break
    case "sorting":
      title = "Test sorting: " + label
      goal = "Verify sortable data changes predictably."
      actions = ["Select a safe sortable column.", "Verify ordering.", "Toggle order.", "Verify consistency."]
      expected = "Rows reorder consistently."
      break
    case "filtering":
      title = "Test filtering: " + label
      goal = "Verify filtering and clearing behavior."
      actions = ["Apply a safe filter.", "Verify matching data.", "Clear filter.", "Verify original state."]
      expected = "Filter results are correct and clear cleanly."
      break
    case "network_failure":
      title = "Investigate network/resource failure"
      goal = "Correlate failed requests/resources with UI behavior."
      actions = ["Inspect failed request/status.", "Inspect console.", "Inspect affected UI.", "Correlate evidence."]
      expected = "Failure is accurately classified and evidence-backed."
      break
    case "error_state":
      title = "Investigate console error"
      goal = "Determine whether a console error is user-impacting."
      actions = ["Capture error.", "Identify triggering state/action.", "Inspect affected UI.", "Correlate network evidence."]
      expected = "Error is explained or linked to a reproducible issue."
      break
    case "save":
      title = "Verify save: " + label
      goal = "Verify a safe change persists."
      actions = ["Make safe test change.", "Save.", "Verify success.", "Navigate/reload.", "Verify persistence."]
      expected = "Saved state persists."
      break
    case "delete":
    case "delete_data":
      title = "Audit destructive control: " + label
      goal = "Inspect destructive protection without executing the action."
      actions = ["Inspect control.", "Inspect confirmation/guard.", "Do not execute."]
      expected = "Destructive action is guarded appropriately."
      break
    default:
      break
  }

  return {
    id: stableId(state.stateKey, match.pattern, t),
    pattern: match.pattern,
    category: match.category,
    title,
    goal,
    target: t,
    targets: match.targets,
    preconditions: ["State " + state.stateKey + " is active"],
    actions,
    expectedOutcome: expected,
    risk: match.risk,
    priority: META[match.pattern].priority + Math.round(match.confidence * 10),
    stateKey: state.stateKey,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Generate candidates only for the current state.
 * Laya receives these candidates and selects the next test.
 */
export function generateCandidateTests(
  state: PatternState,
  options?: {
    alreadyTestedIds?: Iterable<string>
    maxCandidates?: number
    allowMutating?: boolean
    allowDestructive?: boolean
  },
): CandidateTest[] {
  const tested = new Set(options?.alreadyTestedIds || [])
  const allowMutating = options?.allowMutating ?? true
  const allowDestructive = options?.allowDestructive ?? false
  const max = Math.max(1, options?.maxCandidates ?? 40)

  const candidates: CandidateTest[] = []
  for (const match of detectInteractionPatterns(state)) {
    if (match.risk === "mutating" && !allowMutating) continue
    if (match.risk === "destructive" && !allowDestructive) continue

    const targets = match.targets.length ? match.targets : [undefined]
    for (const t of targets) {
      const candidate = candidateFor(state, match, t)
      if (!tested.has(candidate.id)) candidates.push(candidate)
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority).slice(0, max)
}

export function getPatternCoverage(
  matches: InteractionPatternMatch[],
  candidates: CandidateTest[],
) {
  return {
    detectedPatterns: new Set(matches.map((m) => m.pattern)).size,
    candidateTests: candidates.length,
    categories: [...new Set(matches.map((m) => m.category))],
    patterns: [...new Set(matches.map((m) => m.pattern))],
  }
}
