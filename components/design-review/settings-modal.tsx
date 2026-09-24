"use client"

import React, { useState, useEffect } from "react"
import {
  X,
  Lock,
  Mail,
  KeyRound,
  ShieldCheck,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  ExternalLink,
  Sparkles,
  Layers,
  ArrowRight,
  CheckCircle2,
  Trash2,
  RefreshCw,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail?: string | null
  userId?: string | null
  initialTab?: "account" | "integrations"
  onOpenFigmaImport?: () => void
}

export function SettingsModal({
  isOpen,
  onClose,
  userEmail,
  userId,
  initialTab = "account",
  onOpenFigmaImport,
}: SettingsModalProps) {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<"account" | "integrations">(initialTab)

  // Account tab state
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  // Figma integration state
  const [figmaToken, setFigmaToken] = useState("")
  const [isFigmaConnected, setIsFigmaConnected] = useState(false)
  const [figmaUser, setFigmaUser] = useState<{ id?: string; email?: string; handle?: string; img_url?: string } | null>(null)
  const [connectingFigma, setConnectingFigma] = useState(false)
  const [figmaError, setFigmaError] = useState("")
  const [figmaSuccess, setFigmaSuccess] = useState("")

  // Reset tab when modal opens or initialTab changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
      setErrorMsg("")
      setSuccessMsg("")
      setFigmaError("")
      setFigmaSuccess("")

      // Check saved Figma token
      if (typeof window !== "undefined") {
        const token = localStorage.getItem("figma_access_token")
        const profileStr = localStorage.getItem("figma_user_profile")
        if (token) {
          setFigmaToken(token)
          setIsFigmaConnected(true)
        } else {
          setIsFigmaConnected(false)
        }
        if (profileStr) {
          try {
            setFigmaUser(JSON.parse(profileStr))
          } catch {}
        }
      }
    }
  }, [isOpen, initialTab])

  if (!isOpen) return null

  // Password update
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")
    setSuccessMsg("")

    if (!newPassword) {
      setErrorMsg("Please enter a new password.")
      return
    }

    if (newPassword.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.")
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("Passwords do not match. Please re-enter.")
      return
    }

    try {
      setLoading(true)
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        setErrorMsg(error.message)
      } else {
        setSuccessMsg("Password updated successfully!")
        setNewPassword("")
        setConfirmPassword("")
        setTimeout(() => {
          setSuccessMsg("")
        }, 4000)
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  // Connect Figma token
  const handleConnectFigma = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setFigmaError("")
    setFigmaSuccess("")

    const cleanToken = figmaToken.trim()
    if (!cleanToken) {
      setFigmaError("Please paste your Figma Personal Access Token.")
      return
    }

    try {
      setConnectingFigma(true)
      const res = await fetch("/api/figma/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cleanToken }),
      })

      const data = await res.json()
      if (!res.ok) {
        setFigmaError(data.error || "Failed to verify Figma token.")
        return
      }

      setIsFigmaConnected(true)
      setFigmaUser(data.user)
      setFigmaSuccess(`Connected to Figma as ${data.user.handle || data.user.email}!`)
      if (typeof window !== "undefined") {
        localStorage.setItem("figma_access_token", cleanToken)
        localStorage.setItem("figma_user_profile", JSON.stringify(data.user))
      }
    } catch (err: any) {
      setFigmaError(err.message || "Failed to connect to Figma API.")
    } finally {
      setConnectingFigma(false)
    }
  }

  // Disconnect Figma
  const handleDisconnectFigma = () => {
    setFigmaToken("")
    setIsFigmaConnected(false)
    setFigmaUser(null)
    setFigmaSuccess("Figma account disconnected.")
    if (typeof window !== "undefined") {
      localStorage.removeItem("figma_access_token")
      localStorage.removeItem("figma_user_profile")
    }
    setTimeout(() => setFigmaSuccess(""), 3000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-slate-900 dark:text-white transition-all flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              {activeTab === "account" ? (
                <KeyRound className="h-5 w-5" />
              ) : (
                <Plug className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                Settings &amp; Integrations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage your credentials and third-party app connections
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-slate-50/30 dark:bg-slate-900/30">
          <button
            type="button"
            onClick={() => setActiveTab("account")}
            className={`py-3 px-3 border-b-2 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "account"
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>Account Security</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("integrations")}
            className={`py-3 px-3 border-b-2 text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer relative ${
              activeTab === "integrations"
                ? "border-purple-600 text-purple-600 dark:text-purple-400"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Plug className="h-3.5 w-3.5" />
            <span>Third-Party Integrations</span>
            {isFigmaConnected && (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* TAB 1: ACCOUNT */}
          {activeTab === "account" && (
            <div className="space-y-6">
              {/* Email Section (Read Only / Locked) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-blue-500" />
                    <span>Account Email Address</span>
                  </label>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    <Lock className="h-2.5 w-2.5" />
                    Locked (Permanent)
                  </span>
                </div>

                <div className="relative">
                  <input
                    type="email"
                    disabled
                    value={userEmail || "user@example.com"}
                    className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 text-sm cursor-not-allowed font-medium select-all"
                  />
                  <Lock className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500" />
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Your email address is linked to your project ownership, collaborators, and shared invitations and cannot be changed.
                </p>
              </div>

              <div className="h-px bg-slate-200 dark:bg-slate-800" />

              {/* Update Password Form */}
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 mb-1">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>Change Password</span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Set a strong password with at least 6 characters.
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-start gap-2 text-xs text-rose-600 dark:text-rose-300 animate-in fade-in duration-150">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-300 animate-in fade-in duration-150">
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="font-semibold">{successMsg}</span>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    New Password
                    <div className="relative mt-1.5">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter at least 6 characters"
                        minLength={6}
                        className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>

                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Confirm New Password
                    <div className="relative mt-1.5">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-type new password"
                        minLength={6}
                        className="w-full pl-3.5 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </label>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="submit"
                    disabled={loading || !newPassword}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all active:scale-95 cursor-pointer"
                  >
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{loading ? "Updating..." : "Update Password"}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: THIRD-PARTY INTEGRATIONS */}
          {activeTab === "integrations" && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Third-Party Integrations
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Connect your design and development tools to import screens and sync specifications directly.
                </p>
              </div>

              {figmaError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{figmaError}</span>
                </div>
              )}

              {figmaSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-xs text-emerald-600 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{figmaSuccess}</span>
                </div>
              )}

              {/* FIGMA INTEGRATION CARD */}
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-4 transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 via-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/20">
                      <svg className="h-6 w-6" viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="currentColor"/>
                        <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="currentColor"/>
                        <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="currentColor"/>
                        <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="currentColor"/>
                        <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="currentColor"/>
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Figma</h4>
                        {isFigmaConnected ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Connected
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-semibold">
                            Not Connected
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Directly import artboards &amp; specs as review screens
                      </p>
                    </div>
                  </div>

                  {isFigmaConnected && onOpenFigmaImport && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onOpenFigmaImport()
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-500/20 transition-all cursor-pointer shrink-0"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Import Screens</span>
                    </button>
                  )}
                </div>

                {isFigmaConnected ? (
                  /* Connected details */
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600 text-white font-bold text-xs">
                        {figmaUser?.img_url ? (
                          <img src={figmaUser.img_url} alt="" className="h-7 w-7 rounded-lg object-cover" />
                        ) : (
                          figmaUser?.handle?.slice(0, 2).toUpperCase() || "FG"
                        )}
                      </div>
                      <div className="text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {figmaUser?.handle || "Authenticated User"}
                        </span>
                        {figmaUser?.email && (
                          <span className="text-slate-400 ml-1.5">({figmaUser.email})</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {onOpenFigmaImport && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose()
                            onOpenFigmaImport()
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <span>Open Importer</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleDisconnectFigma}
                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        title="Disconnect Figma"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Connect Form */
                  <form onSubmit={handleConnectFigma} className="space-y-3 pt-1">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="password"
                        value={figmaToken}
                        onChange={(e) => setFigmaToken(e.target.value)}
                        placeholder="Paste Figma Personal Access Token (figd_...)"
                        className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-mono placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                      />
                      <button
                        type="submit"
                        disabled={connectingFigma || !figmaToken.trim()}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-sm disabled:opacity-50 transition-all cursor-pointer shrink-0"
                      >
                        {connectingFigma && <Loader2 className="h-3 w-3 animate-spin" />}
                        <span>{connectingFigma ? "Verifying..." : "Connect Figma"}</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <a
                        href="https://www.figma.com/settings"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                      >
                        <span>How to get a Figma Access Token</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>

                      {onOpenFigmaImport && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose()
                            onOpenFigmaImport()
                          }}
                          className="hover:text-purple-600 dark:hover:text-purple-400 cursor-pointer font-medium"
                        >
                          Launch Importer Demo &rarr;
                        </button>
                      )}
                    </div>
                  </form>
                )}
              </div>

              {/* GITHUB CARD (Informational) */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-slate-800">
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">GitHub Repository</h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Source code repository sync and release tagging
                    </p>
                  </div>
                </div>
                <a
                  href="https://github.com/nareshbabunuli/Design-Review"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1 cursor-pointer"
                >
                  <span>View Repo</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {/* SLACK CARD (Coming Soon) */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-center justify-between gap-4 opacity-75">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4A154B] text-white">
                    <span className="font-bold text-sm">#</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">Slack</h4>
                      <span className="px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-[9px] font-semibold text-slate-500">
                        Coming Soon
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Channel notifications on client approval &amp; feedback
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
