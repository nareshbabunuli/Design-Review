"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, GitBranch, Loader2, RefreshCw, Trash2 } from "lucide-react"

type Provider = "github" | "gitlab"
type Repository = {
  id: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  url: string
  cloneUrl: string
  updatedAt: string
}
type ProviderState = {
  loading: boolean
  connected: boolean
  username: string
  repositories: Repository[]
  error: string
}

const emptyState = (): ProviderState => ({
  loading: true, connected: false, username: "", repositories: [], error: "",
})

const providerLabels: Record<Provider, string> = { github: "GitHub", gitlab: "GitLab" }

export function RepositoryConnections() {
  const [states, setStates] = useState<Record<Provider, ProviderState>>({
    github: emptyState(), gitlab: emptyState(),
  })
  const [working, setWorking] = useState<Provider | null>(null)

  const loadProvider = useCallback(async (provider: Provider) => {
    setStates(current => ({ ...current, [provider]: { ...current[provider], loading: true, error: "" } }))
    try {
      const response = await fetch(`/api/integrations/repositories?provider=${provider}`, {
        cache: "no-store",
      })
      const data = await response.json()
      if (response.status === 401) {
        setStates(current => ({ ...current, [provider]: { ...emptyState(), loading: false } }))
        return
      }
      if (!response.ok) {
        setStates(current => ({
          ...current,
          [provider]: {
            ...current[provider], loading: false, error: data.error || `Could not load ${providerLabels[provider]} repositories.`,
          },
        }))
        return
      }
      setStates(current => ({
        ...current,
        [provider]: {
          loading: false,
          connected: Boolean(data.connected),
          username: data.username || "",
          repositories: Array.isArray(data.repositories) ? data.repositories : [],
          error: "",
        },
      }))
    } catch {
      setStates(current => ({
        ...current,
        [provider]: { ...current[provider], loading: false, error: `Network error loading ${providerLabels[provider]}. Check your connection and retry.` },
      }))
    }
  }, [])

  useEffect(() => {
    void loadProvider("github")
    void loadProvider("gitlab")
  }, [loadProvider])

  const connect = async (provider: Provider) => {
    setWorking(provider)
    try {
      const response = await fetch(`/api/integrations/${provider}/connect`, { redirect: "manual" })
      // A manual redirect response means OAuth is ready; navigate in the top-level browser.
      if (response.type === "opaqueredirect" || response.status === 0 || response.status === 307 || response.status === 302) {
        window.location.assign(`/api/integrations/${provider}/connect`)
        return
      }
      const data = await response.json().catch(() => ({}))
      setStates(current => ({
        ...current,
        [provider]: { ...current[provider], error: data.error || `${providerLabels[provider]} OAuth is not configured. Contact the app administrator.` },
      }))
    } catch {
      // Browsers may hide cross-origin OAuth redirects from fetch; fall back to navigation.
      window.location.assign(`/api/integrations/${provider}/connect`)
      return
    } finally {
      setWorking(null)
    }
  }

  const disconnect = async (provider: Provider) => {
    setWorking(provider)
    try {
      const response = await fetch(`/api/integrations/${provider}/disconnect`, { method: "POST" })
      if (!response.ok) throw new Error("Disconnect request failed")
      setStates(current => ({ ...current, [provider]: { ...emptyState(), loading: false } }))
    } catch {
      setStates(current => ({
        ...current,
        [provider]: { ...current[provider], error: `Could not disconnect ${providerLabels[provider]}. Please retry.` },
      }))
    } finally {
      setWorking(null)
    }
  }

  return (
    <section className="space-y-4" aria-label="Repository connections">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Repository Connections</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Connect GitHub or GitLab to browse repositories and prepare reviewed code changes. Changes are never pushed automatically.
        </p>
      </div>

      {(["github", "gitlab"] as Provider[]).map(provider => {
        const state = states[provider]
        const label = providerLabels[provider]
        return (
          <div key={provider} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${provider === "github" ? "bg-slate-900 text-white dark:bg-slate-700" : "bg-orange-600 text-white"}`}>
                  {provider === "github" ? "GH" : "GL"}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">{label}</h4>
                    {state.loading ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Checking</span>
                    ) : state.connected ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Connected</span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-400">Not connected</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {state.connected ? `Connected as ${state.username || "authorized user"}` : "Authorize access to repositories you choose to work with"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {state.connected ? (
                  <>
                    <button type="button" onClick={() => void loadProvider(provider)} disabled={state.loading || working !== null} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-50 dark:hover:bg-slate-800" aria-label={`Refresh ${label} repositories`}><RefreshCw className={`h-3.5 w-3.5 ${state.loading ? "animate-spin" : ""}`} /></button>
                    <button type="button" onClick={() => void disconnect(provider)} disabled={working !== null} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-950/40" aria-label={`Disconnect ${label}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </>
                ) : (
                  <button type="button" onClick={() => void connect(provider)} disabled={working !== null || state.loading} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200">
                    {working === provider && <Loader2 className="h-3 w-3 animate-spin" />}
                    Connect {label}
                  </button>
                )}
              </div>
            </div>

            {state.error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{state.error}</span></div>}

            {state.connected && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Accessible repositories ({state.repositories.length})</p>
                  <span className="text-[10px] text-slate-500">Read access · branch-based changes</span>
                </div>
                {state.repositories.length === 0 && !state.loading ? (
                  <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">No repositories returned. Check account access and provider permissions.</p>
                ) : (
                  <ul className="max-h-44 space-y-1 overflow-y-auto">
                    {state.repositories.map(repo => (
                      <li key={repo.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">{repo.fullName}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500"><GitBranch className="h-3 w-3" />{repo.defaultBranch}{repo.private ? " · Private" : " · Public"}</p>
                        </div>
                        {repo.url && <a href={repo.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repo.fullName} on ${label}`} className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800"><ExternalLink className="h-3.5 w-3.5" /></a>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )
      })}
      <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        Tokens are encrypted in secure, HTTP-only cookies and are not exposed to browser JavaScript. Revoke access from the provider at any time. GitLab Duo agent execution is configured separately from repository access.
      </p>
    </section>
  )
}
