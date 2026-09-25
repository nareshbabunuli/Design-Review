import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { email, password, authMode } = await request.json()
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
            } catch {}
          },
        },
      }
    )

    let result
    if (authMode === "signup") {
      result = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo:
            process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${request.nextUrl.origin}/auth/callback`,
        },
      })
    } else {
      result = await supabase.auth.signInWithPassword({ email, password })
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 })
    }

    return NextResponse.json({
      user: result.data.user,
      session: result.data.session,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal server error" }, { status: 500 })
  }
}
