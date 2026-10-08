import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export class AuthError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "AuthError"
  }
}

export type ProjectAccess = {
  user: { id: string; email?: string }
  role: "owner" | "client" | "freelancer" | string
  access: "view" | "edit"
}

/**
 * Require an authenticated user who owns or is a member of the project.
 * Throws AuthError(401|403) on failure — convert with authErrorResponse().
 */
export async function requireProjectAccess(
  projectId: string,
  minAccess: "view" | "edit" = "edit"
): Promise<ProjectAccess> {
  if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
    throw new AuthError(400, "projectId is required")
  }

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
            // Called from a Server Component that cannot set cookies — ignore
          }
        },
      },
    }
  )

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new AuthError(401, "Sign in required to run automation")
  }

  // Owner check
  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", projectId.trim())
    .maybeSingle()

  if (project?.user_id === user.id) {
    return {
      user: { id: user.id, email: user.email },
      role: "owner",
      access: "edit",
    }
  }

  // Member check
  const { data: member } = await supabase
    .from("project_members")
    .select("access, role")
    .eq("project_id", projectId.trim())
    .eq("user_id", user.id)
    .maybeSingle()

  if (!member) {
    throw new AuthError(403, "You are not a member of this project")
  }

  const memberAccess = (member.access === "edit" ? "edit" : "view") as "view" | "edit"

  if (minAccess === "edit" && memberAccess !== "edit" && member.role !== "owner") {
    throw new AuthError(403, "Edit access is required to start or control tests")
  }

  return {
    user: { id: user.id, email: user.email },
    role: member.role || "client",
    access: memberAccess,
  }
}

/** Require any signed-in user (no project check). */
export async function requireUser(): Promise<{ id: string; email?: string }> {
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

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new AuthError(401, "Sign in required")
  }

  return { id: user.id, email: user.email }
}

export function authErrorResponse(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error("[auth]", err)
  return NextResponse.json({ error: "Internal server error" }, { status: 500 })
}
