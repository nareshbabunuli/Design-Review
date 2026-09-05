import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = searchParams.get("next")

  const isRecovery = type === "recovery" || next === "/reset-password"
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
          }
        },
      },
    }
  )

  // 1. Handle PKCE authorization code exchange
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const destination = isRecovery ? `${origin}/reset-password` : `${origin}${next ?? "/"}`
      return NextResponse.redirect(destination)
    }
    console.error("Code exchange failed in auth callback:", error)
  }

  // 2. Handle token_hash verification (OTP / email link)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      const destination = isRecovery ? `${origin}/reset-password` : `${origin}${next ?? "/"}`
      return NextResponse.redirect(destination)
    }
    console.error("verifyOtp failed in auth callback:", error)
  }

  // If this was a password recovery request, redirect to reset-password page even on fallback
  if (isRecovery) {
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  return NextResponse.redirect(`${origin}${next ?? "/"}`)
}

