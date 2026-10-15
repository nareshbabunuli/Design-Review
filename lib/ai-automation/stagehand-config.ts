/**
 * Stagehand execution configuration and safety guards.
 * 
 * Phase 1: Risk Mitigation
 * Ensures Stagehand only executes in Autonomous mode and never in Full App Testing.
 */

export const STAGEHAND_CONFIG = {
  /**
   * Global kill switch for Stagehand execution.
   * Set STAGEHAND_ALLOW_EXECUTION=false to disable all Stagehand actions.
   * Useful for testing and emergency rollback.
   */
  ALLOW_EXECUTION: process.env.STAGEHAND_ALLOW_EXECUTION !== 'false',
  
  /**
   * Log every Stagehand action for audit trail.
   * Helps track action sources and detect duplicate executions.
   */
  LOG_ACTIONS: process.env.STAGEHAND_LOG_ACTIONS !== 'false',
  
  /**
   * Modes where Stagehand agent.execute() is permitted.
   * CRITICAL: 'full_app' mode MUST NOT be in this list.
   */
  ALLOWED_MODES: ['autonomous'] as const,
  
  /**
   * Stagehand capabilities allowed in each mode.
   */
  MODE_CAPABILITIES: {
    autonomous: {
      canExecute: true,
      canObserve: true,
      canExtract: true,
      canAct: true,
    },
    full_app: {
      canExecute: false,  // NEVER allow execution in Full App mode
      canObserve: true,   // Future: can use for grounding
      canExtract: true,   // Future: can use for data extraction
      canAct: false,      // NEVER allow direct actions
    },
    crawl: {
      canExecute: false,
      canObserve: false,
      canExtract: false,
      canAct: false,
    },
    chat: {
      canExecute: false,
      canObserve: false,
      canExtract: false,
      canAct: false,
    },
  } as const,
}

/**
 * Check if Stagehand can execute agent actions in the given mode.
 * 
 * @param mode - Job mode ('autonomous', 'full_app', 'crawl', 'chat')
 * @returns true if Stagehand agent.execute() is allowed
 */
export function canStagehandExecute(mode: string): boolean {
  if (!STAGEHAND_CONFIG.ALLOW_EXECUTION) {
    return false
  }
  
  const capabilities = STAGEHAND_CONFIG.MODE_CAPABILITIES[mode as keyof typeof STAGEHAND_CONFIG.MODE_CAPABILITIES]
  return capabilities?.canExecute ?? false
}

/**
 * Assert that Stagehand execution is allowed in the current mode.
 * Throws an error if not allowed.
 * 
 * @param mode - Job mode
 * @param functionName - Name of calling function for error message
 * @throws Error if Stagehand cannot execute in this mode
 */
export function assertStagehandCanExecute(mode: string, functionName: string): void {
  if (!canStagehandExecute(mode)) {
    const allowed = STAGEHAND_CONFIG.ALLOWED_MODES.join(', ')
    throw new Error(
      `[SafetyGuard] ${functionName} cannot execute Stagehand actions in mode="${mode}". ` +
      `Allowed modes: ${allowed}. ` +
      `This prevents duplicate actions and maintains single execution path. ` +
      `If you need Stagehand for target grounding (not execution), use observe() or extract() instead.`
    )
  }
}

/**
 * Check if Stagehand can observe/identify elements (without executing actions).
 * 
 * @param mode - Job mode
 * @returns true if Stagehand observe/extract is allowed
 */
export function canStagehandObserve(mode: string): boolean {
  if (!STAGEHAND_CONFIG.ALLOW_EXECUTION) {
    return false
  }
  
  const capabilities = STAGEHAND_CONFIG.MODE_CAPABILITIES[mode as keyof typeof STAGEHAND_CONFIG.MODE_CAPABILITIES]
  return capabilities?.canObserve ?? false
}

/**
 * Log action execution with source tracking for audit trail.
 * 
 * @param mode - Job mode
 * @param action - Action type (click, type, navigate, etc.)
 * @param source - Execution source (puppeteer, stagehand)
 * @param target - Target element description
 */
export function logActionExecution(
  mode: string,
  action: string,
  source: 'puppeteer' | 'stagehand',
  target: string,
  logger?: (level: 'debug' | 'info', message: string) => void
): void {
  if (!STAGEHAND_CONFIG.LOG_ACTIONS) {
    return
  }
  
  const message = `[ActionSource] ${action} via ${source} on "${target}" (mode=${mode})`
  
  if (logger) {
    logger('debug', message)
  } else {
    console.log(message)
  }
}
