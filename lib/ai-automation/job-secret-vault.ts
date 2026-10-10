/**
 * Ephemeral per-job secret vault.
 *
 * Secrets supplied during a running test are kept in process memory only.
 * They are deliberately not part of AutomationJob persistence or API responses.
 */
export type JobSecrets = {
  credentials?: { username?: string; password?: string; token?: string }
  settingsCredentials?: Record<string, string>
  paymentCredentials?: Record<string, string>
  verification?: { verificationUrl?: string; verificationCode?: string; completed?: boolean; skip?: boolean }
}

declare global {
  // eslint-disable-next-line no-var
  var __AI_AUTOMATION_JOB_SECRETS__: Map<string, JobSecrets> | undefined
}

const vault = globalThis.__AI_AUTOMATION_JOB_SECRETS__ ??= new Map<string, JobSecrets>()

export function setJobSecrets(jobId: string, patch: JobSecrets): void {
  const current = vault.get(jobId) || {}
  vault.set(jobId, {
    ...current,
    ...patch,
    credentials: patch.credentials ?? current.credentials,
    settingsCredentials: patch.settingsCredentials ?? current.settingsCredentials,
    paymentCredentials: patch.paymentCredentials ?? current.paymentCredentials,
    verification: patch.verification ?? current.verification,
  })
}

export function getJobSecrets(jobId: string): JobSecrets | undefined {
  return vault.get(jobId)
}

export function clearJobSecrets(jobId: string): void {
  vault.delete(jobId)
}
