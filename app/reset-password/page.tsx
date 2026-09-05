"use client"

import React, { useState, useEffect, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Check,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { AuthChangeEvent, Session } from "@supabase/supabase-js"

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [hasValidSession, setHasValidSession] = useState(false)
  const [theme, setTheme] = useState<"light" | "dark">("dark")

  // Theme support
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null
    if (saved) {
      setTheme(saved)
      document.documentElement.classList.toggle("dark", saved === "dark")
    } else {
      document.documentElement.classList.add("dark")
    }
  }, [])

  // Handle URL code or hash recovery tokens
  useEffect(() => {
    let isMounted = true

    const initAuth = async () => {
      try {
        // 1. Check if Supabase passed a PKCE code in search params
        const params = new URLSearchParams(window.location.search)
        const code = params.get("code")

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            console.warn("Code exchange failed:", error.message)
          } else {
            if (isMounted) setHasValidSession(true)
          }
        }

        const token_hash = params.get("token_hash")
        const type = params.get("type") as any
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash, type })
          if (!error && isMounted) {
            setHasValidSession(true)
          }
        }

        // 2. Check if hash tokens exist (#access_token=...&type=recovery)
        const hash = window.location.hash
        if (hash && (hash.includes("type=recovery") || hash.includes("access_token"))) {
          if (isMounted) setHasValidSession(true)
        }

        // 3. Check existing session
        const { data: { session } } = await supabase.auth.getSession()
        if (session && isMounted) {
          setHasValidSession(true)
        }
      } catch (err) {
        console.error("Auth init error:", err)
      } finally {
        if (isMounted) setIsInitializing(false)
      }
    }

    initAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (!isMounted) return
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasValidSession(true)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  const validatePassword = () => {
    if (!password) {
      return "Please enter a new password."
    }
    if (password.length < 6) {
      return "Password must be at least 6 characters long."
    }
    if (password !== confirmPassword) {
      return "Passwords do not match."
    }
    return null
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage("")
    setSuccessMessage("")

    const validationError = validatePassword()
    if (validationError) {
      setErrorMessage(validationError)
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) {
        setErrorMessage(error.message)
        setLoading(false)
        return
      }

      setSuccessMessage("Your password has been successfully updated!")
      setPassword("")
      setConfirmPassword("")
      setLoading(false)

      // Auto redirect to dashboard after 2 seconds
      setTimeout(() => {
        router.push("/")
      }, 2000)
    } catch (err: any) {
      console.error("Password update exception:", err)
      setErrorMessage(err?.message || "An unexpected error occurred while updating your password.")
      setLoading(false)
    }
  }

  // Password rules validation for live checklist
  const hasMinLength = password.length >= 6
  const hasMatch = password.length > 0 && password === confirmPassword

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-[#0c0d12] text-slate-900 dark:text-slate-100 transition-colors">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-indigo-500/10 dark:bg-indigo-600/15 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 w-[500px] h-[500px] bg-purple-500/10 dark:bg-purple-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="rounded-3xl border border-slate-200 dark:border-zinc-800/80 bg-white/95 dark:bg-[#12131a]/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {/* Header icon */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25 mb-4">
              <KeyRound className="h-6 w-6" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Reset Your Password
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 mt-1.5 max-w-xs">
              Enter your new password below to regain access to your account.
            </p>
          </div>

          {/* Loading initialization state */}
          {isInitializing ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              <span className="text-xs text-slate-400">Verifying reset session...</span>
            </div>
          ) : successMessage ? (
            /* Success confirmation */
            <div className="flex flex-col items-center text-center py-4 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400 ring-8 ring-emerald-500/5 animate-in zoom-in-75 duration-200">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Password Updated!
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xs">
                  {successMessage}
                </p>
              </div>
              <div className="pt-2 w-full">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 px-4 text-xs sm:text-sm font-semibold text-white shadow-sm transition-all active:scale-[0.98] cursor-pointer"
                >
                  Continue to Dashboard
                </button>
              </div>
            </div>
          ) : (
            /* Reset Form */
            <form onSubmit={handleResetPassword} className="space-y-4">
              {/* Error message */}
              {errorMessage && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in duration-150">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              )}

              {/* Warning if session wasn't detected automatically */}
              {!hasValidSession && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-semibold block mb-0.5">Note:</span>
                  Please make sure you clicked the reset link from your email. If your link has expired, you can request a new one below.
                </div>
              )}

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-zinc-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/80 pl-9 pr-10 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 outline-none transition-all focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-900 focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-zinc-500" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    autoComplete="new-password"
                    required
                    className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/80 pl-9 pr-10 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 outline-none transition-all focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-900 focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Live requirements checklist */}
              <div className="pt-1 space-y-1.5 text-[11px]">
                <div className={`flex items-center gap-1.5 ${hasMinLength ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-zinc-500"}`}>
                  <Check className={`h-3 w-3 ${hasMinLength ? "opacity-100" : "opacity-40"}`} />
                  <span>At least 6 characters</span>
                </div>
                <div className={`flex items-center gap-1.5 ${hasMatch ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-zinc-500"}`}>
                  <Check className={`h-3 w-3 ${hasMatch ? "opacity-100" : "opacity-40"}`} />
                  <span>Passwords match</span>
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 px-4 text-xs sm:text-sm font-semibold text-white shadow-md shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Update Password</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Footer Back link */}
          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
