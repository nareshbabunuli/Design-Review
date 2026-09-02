"use client"

import { useEffect, useMemo, useState } from "react"
import { FolderKanban, Loader2, LogOut, Mail, Share2, Copy, Check, Eye, Pencil, ArrowLeft } from "lucide-react"
import type { Session, AuthChangeEvent } from "@supabase/supabase-js"
import type { Project, Workflow, WorkflowComment, EditingId } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import { Sidebar } from "@/components/design-review/sidebar"
import { WorkflowEditor } from "@/components/design-review/workflow-editor"
import { ReportModal } from "@/components/design-review/report-modal"
import { ProjectDashboard } from "@/components/design-review/project-dashboard"
import { ThemeToggle } from "@/components/design-review/theme-toggle"
import { LandingPage } from "@/components/design-review/landing-page"

type ProjectRow = { id: string; title: string; is_expanded: boolean; user_id: string }
type WorkflowRow = {
  id: string
  project_id: string
  title: string
  design_a: string | null
  design_b: string | null
  our_notes: string
  client_message: string
  client_task_done: boolean
  reason: string
  is_done: boolean
}
type CommentRow = {
  id: string
  workflow_id: string
  author_id: string
  author_email?: string
  body: string
  reason?: string
  created_at: string
}

const mapData = (projects: ProjectRow[], workflows: WorkflowRow[], comments: CommentRow[]): Project[] =>
  projects.map((p) => ({
    id: p.id,
    title: p.title,
    isExpanded: p.is_expanded,
    userId: p.user_id,
    workflows: workflows
      .filter((w) => w.project_id === p.id)
      .map((w) => ({
        id: w.id,
        title: w.title,
        designA: w.design_a,
        designB: w.design_b,
        ourNotes: w.our_notes,
        clientMessage: w.client_message,
        clientTaskDone: w.client_task_done,
        reason: w.reason,
        isDone: w.is_done,
        comments: comments
          .filter((c) => c.workflow_id === w.id)
          .map((c) => ({
            id: c.id,
            workflowId: c.workflow_id,
            authorId: c.author_id,
            authorEmail: c.author_email,
            body: c.body,
            reason: c.reason,
            createdAt: c.created_at,
          })),
      })),
  }))

export default function Page() {
  const supabase = createClient()
  const [isAuthChecking, setIsAuthChecking] = useState(true)
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<EditingId>(null)
  const [showReport, setShowReport] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authLoading, setAuthLoading] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authMessage, setAuthMessage] = useState("")
  const [showResend, setShowResend] = useState(false)
  const [isOwner, setIsOwner] = useState(true)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteLink, setInviteLink] = useState("")
  const [copied, setCopied] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [invitePermission, setInvitePermission] = useState<"view" | "edit">("view")
  const [activeInvitePermission, setActiveInvitePermission] = useState<"view" | "edit" | null>(null)
  const [viewMode, setViewMode] = useState<"dashboard" | "editor">("dashboard")
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [showLanding, setShowLanding] = useState(true)

  // Extract invite token on initial client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = new URLSearchParams(window.location.search).get("invite")
      if (token) {
        setInviteToken(token)
      }
    }
  }, [])

  // Theme initialization from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null
    if (saved) {
      setTheme(saved)
      document.documentElement.classList.toggle("dark", saved === "dark")
    } else {
      document.documentElement.classList.add("dark")
    }
  }, [])

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("theme", next)
    document.documentElement.classList.toggle("dark", next === "dark")
  }

  // Auth check - immediately retrieve existing session from cache/cookies
  useEffect(() => {
    let mounted = true

    supabase.auth
      .getSession()
      .then(({ data: { session } }: { data: { session: Session | null } }) => {
        if (!mounted) return
        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email })
        } else {
          setUser(null)
        }
        setIsAuthChecking(false)
      })
      .catch((err: unknown) => {
        console.error("Auth session check error:", err)
        if (mounted) {
          setUser(null)
          setIsAuthChecking(false)
        }
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!mounted) return
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email })
      } else {
        setUser(null)
      }
      setIsAuthChecking(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase.auth])

  // Google Drive-Style Invite Loader: Instantly loads presentation & review for anyone with the invite link
  useEffect(() => {
    if (!supabase || !inviteToken) return

    let cancelled = false
    setLoading(true)

    const loadInviteProject = async () => {
      const { data, error } = await supabase.rpc("get_project_by_invite", {
        invite_token: inviteToken,
      })

      if (cancelled) return

      if (error || !data) {
        console.error("Invite token load error:", error)
        setAuthMessage("This invite link is invalid or has expired.")
        setLoading(false)
        return
      }

      const pData = data as {
        id: string
        title: string
        is_expanded: boolean
        user_id: string
        permission?: "view" | "edit"
        workflows: Array<{
          id: string
          project_id: string
          title: string
          design_a: string | null
          design_b: string | null
          our_notes: string | null
          client_message: string | null
          client_task_done: boolean
          reason: string | null
          is_done: boolean
        }>
      }

      const mappedWorkflows: Workflow[] = (pData.workflows || []).map((w) => ({
        id: w.id,
        projectId: w.project_id,
        title: w.title,
        designA: w.design_a,
        designB: w.design_b,
        ourNotes: w.our_notes || "",
        clientMessage: w.client_message || "",
        clientTaskDone: w.client_task_done,
        reason: w.reason || "",
        isDone: w.is_done,
        comments: [],
      }))

      const project: Project = {
        id: pData.id,
        title: pData.title,
        isExpanded: pData.is_expanded,
        userId: pData.user_id,
        workflows: mappedWorkflows,
      }

      const perm = pData.permission || "view"
      setActiveInvitePermission(perm)
      const canEdit = perm === "edit" || (user ? user.id === pData.user_id : false)

      setProjects([project])
      setActiveProjectId(project.id)
      setActiveWorkflowId(project.workflows[0]?.id ?? null)
      setIsOwner(canEdit)
      setShowReport(perm === "view") // View: can only see presentations; Edit: open editor directly!
      setLoading(false)

      if (user) {
        try {
          await supabase.rpc("redeem_project_invite", { invite_token: inviteToken })
        } catch (err) {
          console.error("Error redeeming project invite:", err)
        }
      }
    }

    loadInviteProject()
    return () => {
      cancelled = true
    }
  }, [supabase, inviteToken, user])

  // Initial Data Load (when not using an invite link)
  useEffect(() => {
    if (inviteToken) return // Skip regular load if loading via invite
    if (!user || !supabase) {
      setProjects([])
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const load = async () => {
      const { data: ps, error } = await supabase
        .from("projects")
        .select("id,title,is_expanded,user_id")
        .order("created_at", { ascending: true })

      if (error) {
        setAuthMessage("We could not load your workspace.")
        setLoading(false)
        return
      }

      const ids = (ps as ProjectRow[]).map((p) => p.id)
      const [{ data: ws }, { data: cs }] = await Promise.all([
        supabase
          .from("workflows")
          .select("id,project_id,title,design_a,design_b,our_notes,client_message,client_task_done,reason,is_done")
          .in("project_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        supabase
          .from("workflow_comments")
          .select("id,workflow_id,author_id,body,reason,created_at"),
      ])

      if (!cancelled) {
        const next = mapData(ps as ProjectRow[], (ws || []) as WorkflowRow[], (cs || []) as CommentRow[])
        setProjects(next)
        setIsOwner((ps as ProjectRow[]).every((p) => p.user_id === user.id))
        setActiveProjectId(next[0]?.id ?? null)
        setActiveWorkflowId(next[0]?.workflows[0]?.id ?? null)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user, supabase, inviteToken])

  // Real-time Collaborative Synchronization (Simultaneous commenting & updates)
  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel("design_review_realtime")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "workflows" },
        (payload: { new: Record<string, any> }) => {
          const updated = payload.new as WorkflowRow
          setProjects((prev) =>
            prev.map((p) => ({
              ...p,
              workflows: p.workflows.map((w) =>
                w.id === updated.id
                  ? {
                    ...w,
                    title: updated.title,
                    designA: updated.design_a,
                    designB: updated.design_b,
                    ourNotes: updated.our_notes,
                    clientMessage: updated.client_message,
                    clientTaskDone: updated.client_task_done,
                    reason: updated.reason,
                    isDone: updated.is_done,
                  }
                  : w
              ),
            }))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const activeWorkflow = activeProject?.workflows.find((w) => w.id === activeWorkflowId) ?? null

  const effectiveIsOwner = useMemo(() => {
    // 1. The user who created the project is ALWAYS the Owner / Sender
    if (user && activeProject?.userId && activeProject.userId === user.id) {
      return true
    }

    // 2. An invited guest with edit permission
    if (inviteToken && activeInvitePermission) {
      return activeInvitePermission === "edit"
    }

    // 3. User with direct edit access to project
    if (user && activeProject?.userId && activeProject.userId === user.id) {
      return true
    }
    return false
  }, [user, activeProject, inviteToken, activeInvitePermission])

  const isViewerOnly = Boolean(!effectiveIsOwner && (activeInvitePermission === "view" || Boolean(inviteToken)))

  const update = (fn: (items: Project[]) => Project[]) => setProjects(fn)

  const authenticate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setAuthLoading(true)
    setAuthMessage("")
    setShowResend(false)

    const result =
      authMode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo:
              process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
          },
        })

    setAuthLoading(false)

    if (result.error) {
      const message = result.error.message.toLowerCase()
      if (message.includes("confirm") || message.includes("verified")) {
        setAuthMessage("Your email is not confirmed yet. Check your inbox, then try signing in again.")
        setShowResend(true)
      } else if (message.includes("invalid login credentials")) {
        setAuthMessage("Invalid email or password.")
      } else {
        setAuthMessage("We could not sign you in. Please check your details and try again.")
      }
      return
    }

    if (authMode === "signin" && result.data?.user) {
      setUser({ id: result.data.user.id, email: result.data.user.email })
      setIsAuthChecking(false)
    }

    if (authMode === "signup" && !result.data.session) {
      setAuthMessage("Account created. Check your email and click the confirmation link before signing in.")
      setShowResend(true)
    }
  }

  const resendConfirmation = async () => {
    if (!supabase || !email) return
    setAuthLoading(true)
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo:
          process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback`,
      },
    })
    setAuthLoading(false)
    setAuthMessage(
      error
        ? "We could not resend the confirmation email. Please try again."
        : "Confirmation email sent. Check your inbox, then sign in."
    )
    setShowResend(!error)
  }

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setUser(null)
    setProjects([])
    setActiveProjectId(null)
    setActiveWorkflowId(null)
    setAuthMessage("")
    setIsAuthChecking(false)
  }

  const createProject = async (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    if (!supabase) return
    if (!user) {
      alert("Please sign in or create an account to create your own projects.")
      return
    }
    setAuthMessage("")

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, title: `New Project ${projects.length + 1}`, is_expanded: true })
      .select("id,title,is_expanded,user_id")
      .single()

    if (error) {
      console.error("Error creating project:", error)
      alert(`Error creating project: ${error.message}`)
      setAuthMessage(`We could not create the project: ${error.message}`)
      return
    }

    const p: Project = { id: data.id, title: data.title, isExpanded: true, userId: data.user_id, workflows: [] }
    update((x) => [...x, p])
    setActiveProjectId(p.id)
    setActiveWorkflowId(null)
    setIsOwner(true)
    setShowReport(false)
    setViewMode("editor")
  }

  const createWorkflow = async (projectId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!supabase) return
    if (!user) {
      alert("Please sign in to add workflows.")
      return
    }

    const { data, error } = await supabase
      .from("workflows")
      .insert({ project_id: projectId, title: "New Workflow" })
      .select("*")
      .single()

    if (error) {
      console.error("Error creating workflow:", error)
      alert(`Error creating workflow: ${error.message}`)
      return
    }

    if (data) {
      const w: Workflow = {
        id: data.id,
        projectId: data.project_id,
        title: data.title,
        designA: data.design_a,
        designB: data.design_b,
        ourNotes: data.our_notes || "",
        clientMessage: data.client_message || "",
        clientTaskDone: data.client_task_done,
        reason: data.reason || "",
        isDone: data.is_done,
        comments: [],
      }
      update((x) =>
        x.map((p) => (p.id === projectId ? { ...p, isExpanded: true, workflows: [...p.workflows, w] } : p))
      )
      setActiveProjectId(projectId)
      setActiveWorkflowId(w.id)
    }
  }

  // Update workflow field: Owner can update all fields; Client can ONLY comment (clientMessage) & accept/verify (clientTaskDone)
  const updateWorkflowField = async (
    workflowId: string,
    field: keyof Workflow,
    value: string | boolean | null
  ) => {
    if (!supabase || !workflowId || !activeProjectId) return

    const allowedForClient = ["clientMessage", "clientTaskDone"]
    if (!effectiveIsOwner && !allowedForClient.includes(field)) {
      return
    }

    // Optimistic local state update
    update((xs) =>
      xs.map((p) =>
        p.id === activeProjectId
          ? {
            ...p,
            workflows: p.workflows.map((w) => (w.id === workflowId ? { ...w, [field]: value } : w)),
          }
          : p
      )
    )

    // If reviewing or editing via invite link (Google Drive style share)
    if (inviteToken) {
      const currentWf = activeProject?.workflows.find((w) => w.id === workflowId)
      const newMsg = field === "clientMessage" ? (value as string) : (currentWf?.clientMessage ?? null)
      const newDone = field === "clientTaskDone" ? (value as boolean) : (currentWf?.clientTaskDone ?? null)
      const newDesignA = field === "designA" ? ((value as string) || "__CLEAR__") : null
      const newDesignB = field === "designB" ? ((value as string) || "__CLEAR__") : null
      const newOurNotes = field === "ourNotes" ? (value as string) : null
      const newReason = field === "reason" ? (value as string) : null

      await supabase.rpc("update_workflow_by_invite", {
        invite_token: inviteToken,
        target_workflow_id: workflowId,
        new_client_message: newMsg,
        new_client_task_done: newDone,
        new_design_a: newDesignA,
        new_design_b: newDesignB,
        new_our_notes: newOurNotes,
        new_reason: newReason,
      })
      return
    }

    const dbField =
      ({
        designA: "design_a",
        designB: "design_b",
        ourNotes: "our_notes",
        clientMessage: "client_message",
        clientTaskDone: "client_task_done",
        reason: "reason",
        isDone: "is_done",
      } as Record<string, string>)[field] ?? field

    await supabase.from("workflows").update({ [dbField]: value }).eq("id", workflowId)
  }

  const updateField = (field: keyof Workflow, value: string | boolean | null) => {
    if (activeWorkflowId) {
      updateWorkflowField(activeWorkflowId, field, value)
    }
  }

  // Add Comment: Allowed for both Owner and Client, supports Reason
  const addComment = async (body: string, reason?: string, targetWorkflowId?: string) => {
    const wid = targetWorkflowId || activeWorkflowId
    if (!supabase || !user || !wid) return

    const tempId = `temp-${Date.now()}`
    const newComment: WorkflowComment = {
      id: tempId,
      workflowId: wid,
      authorId: user.id,
      authorEmail: user.email || (isOwner ? "Our Team" : "Client"),
      reason: reason || undefined,
      body,
      createdAt: new Date().toISOString(),
    }

    // Optimistic local state update
    update((xs) =>
      xs.map((p) => ({
        ...p,
        workflows: p.workflows.map((w) => (w.id === wid ? { ...w, comments: [...w.comments, newComment] } : w)),
      }))
    )

    const payload: { workflow_id: string; author_id: string; body: string; reason?: string } = {
      workflow_id: wid,
      author_id: user.id,
      body,
    }
    if (reason) payload.reason = reason

    const { data } = await supabase
      .from("workflow_comments")
      .insert(payload)
      .select("id,workflow_id,author_id,body,reason,created_at")
      .single()

    if (data) {
      update((xs) =>
        xs.map((p) => ({
          ...p,
          workflows: p.workflows.map((w) =>
            w.id === wid
              ? {
                ...w,
                comments: w.comments.map((c) =>
                  c.id === tempId
                    ? {
                      id: data.id,
                      workflowId: data.workflow_id,
                      authorId: data.author_id,
                      body: data.body,
                      reason: data.reason,
                      createdAt: data.created_at,
                    }
                    : c
                ),
              }
              : w
          ),
        }))
      )
    }
  }

  const createInvite = async () => {
    if (!supabase || !activeProjectId) return
    const { data } = await supabase
      .from("project_invites")
      .insert({
        project_id: activeProjectId,
        owner_id: user?.id,
        invitee_email: inviteEmail || null,
        permission: invitePermission,
      })
      .select("token, permission")
      .single()

    if (data) {
      setInviteLink(`${window.location.origin}${window.location.pathname}?invite=${data.token}`)
      setInviteEmail("")
    }
  }

  // Show full-screen loading state while verifying existing session on page load/refresh
  if (isAuthChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 shadow-xl">
            <FolderKanban className="h-8 w-8 text-white animate-pulse" />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Loading workspace...</span>
          </div>
        </div>
      </main>
    )
  }

  // ─── LANDING PAGE ─── shown to unauthenticated visitors with no invite
  if (!user && !inviteToken && showLanding) {
    return (
      <LandingPage
        theme={theme}
        onToggleTheme={toggleTheme}
        onGetStarted={() => setShowLanding(false)}
      />
    )
  }

  if (!user && !inviteToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-zinc-950 p-6 transition-colors duration-200">
        {/* Theme toggle in top-right corner of auth screen */}
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <form onSubmit={authenticate} className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white p-8 shadow-xl transition-colors duration-200">
          <button
            type="button"
            onClick={() => setShowLanding(true)}
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Home</span>
          </button>

          <div className="mb-8">
            <FolderKanban className="mb-5 h-12 w-12 rounded-2xl bg-slate-900 dark:bg-zinc-800 p-3 text-white" />
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Design Review</h1>
            <p className="mt-2 text-slate-500 dark:text-slate-400">
              {authMode === "signin" ? "Sign in to your workspace." : "Create your review workspace."}
            </p>
          </div>

          <label className="mb-4 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Email
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="mb-5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Password
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {authMessage && (
            <div className="mb-4 rounded-xl bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 p-3 text-sm text-slate-700 dark:text-slate-300">
              <p>{authMessage}</p>
              {showResend && (
                <button
                  type="button"
                  onClick={resendConfirmation}
                  className="mt-2 font-medium text-slate-900 dark:text-white underline underline-offset-2"
                >
                  Resend confirmation email
                </button>
              )}
            </div>
          )}
          <button className="w-full rounded-xl bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 py-3 text-white font-semibold transition-colors" disabled={authLoading}>
            {authLoading ? "Loading..." : authMode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            type="button"
            className="mt-4 w-full text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
          >
            {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </main>
    )
  }

  // IF NOT OWNER / VIEWER: Never show the editor page for this project!
  // Only projects with edit option can open the editor workspace!
  if (activeProject && !effectiveIsOwner) {
    if (showReport || viewMode === "editor") {
      return (
        <div className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 text-white">
          <ReportModal
            project={activeProject}
            isOwner={false}
            isViewerOnly={true}
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={handleSignOut}
            onClose={() => {
              setShowReport(false)
              setViewMode("dashboard")
            }}
            onUpdateWorkflowField={updateWorkflowField}
          />
        </div>
      )
    }

    // When client closes presentation view, they see the Design Review Dashboard with their project card (which has the View icon on it and opens presentation only!)
    return (
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#18181b] text-slate-100">
        <ProjectDashboard
          projects={projects}
          userEmail={user?.email}
          userId={user?.id}
          isOwner={false}
          theme={theme}
          onToggleTheme={toggleTheme}
          onCreateProject={createProject}
          onSelectProject={(id) => {
            const p = projects.find((x) => x.id === id)
            setActiveProjectId(id)
            setActiveWorkflowId(p?.workflows[0]?.id ?? null)
            const canEdit = Boolean(user && p?.userId === user.id)
            if (canEdit) {
              setShowReport(false)
              setViewMode("editor")
            } else {
              setShowReport(true)
            }
          }}
          onOpenPresentation={(id) => {
            const p = projects.find((x) => x.id === id)
            setActiveProjectId(id)
            setActiveWorkflowId(p?.workflows[0]?.id ?? null)
            setShowReport(true)
          }}
          onDeleteProject={() => { }}
          onRenameProject={() => { }}
          onLogout={handleSignOut}
        />
      </div>
    )
  }

  if (viewMode === "dashboard" && !inviteToken) {
    return (
      <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#18181b] text-slate-100">
        <ProjectDashboard
          projects={projects}
          userEmail={user?.email}
          userId={user?.id}
          isOwner={effectiveIsOwner}
          theme={theme}
          onToggleTheme={toggleTheme}
          onCreateProject={createProject}
          onSelectProject={(id) => {
            const p = projects.find((x) => x.id === id)
            setActiveProjectId(id)
            setActiveWorkflowId(p?.workflows[0]?.id ?? null)
            const canEdit = Boolean(user && p?.userId === user.id)
            if (canEdit) {
              setShowReport(false)
              setViewMode("editor")
            } else {
              setShowReport(true)
            }
          }}
          onOpenPresentation={(id) => {
            const p = projects.find((x) => x.id === id)
            setActiveProjectId(id)
            setActiveWorkflowId(p?.workflows[0]?.id ?? null)
            setShowReport(true)
          }}
          onDeleteProject={async (id, e) => {
            e.stopPropagation()
            if (supabase) await supabase.from("projects").delete().eq("id", id)
            update((xs) => xs.filter((x) => x.id !== id))
          }}
          onRenameProject={async (id, title) => {
            if (supabase) await supabase.from("projects").update({ title }).eq("id", id)
            update((xs) => xs.map((p) => (p.id === id ? { ...p, title } : p)))
          }}
          onLogout={handleSignOut}
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 print:h-auto print:overflow-visible print:block print:bg-white transition-colors duration-200">
      <Sidebar
        projects={activeProject ? [activeProject] : projects}
        activeProjectId={activeProjectId}
        activeWorkflowId={activeWorkflowId}
        editingId={editingId}
        isOwner={effectiveIsOwner}
        onBackToDashboard={() => setViewMode("dashboard")}
        setEditingId={setEditingId}
        onCreateProject={createProject}
        onCreateWorkflow={createWorkflow}
        onToggleExpand={async (id, e) => {
          e?.stopPropagation()
          if (!supabase) return
          const p = projects.find((x) => x.id === id)
          if (p) {
            await supabase.from("projects").update({ is_expanded: !p.isExpanded }).eq("id", id)
            update((xs) => xs.map((x) => (x.id === id ? { ...x, isExpanded: !x.isExpanded } : x)))
          }
        }}
        onDeleteProject={async (id, e) => {
          e.stopPropagation()
          if (supabase) await supabase.from("projects").delete().eq("id", id)
          update((xs) => xs.filter((x) => x.id !== id))
          if (activeProjectId === id) {
            setActiveProjectId(null)
            setActiveWorkflowId(null)
            setViewMode("dashboard")
          }
        }}
        onDeleteWorkflow={async (pid, wid, e) => {
          e.stopPropagation()
          if (supabase) await supabase.from("workflows").delete().eq("id", wid)
          update((xs) => xs.map((p) => (p.id === pid ? { ...p, workflows: p.workflows.filter((w) => w.id !== wid) } : p)))
        }}
        onSelectProject={(id) => {
          setActiveProjectId(id)
          setActiveWorkflowId(null)
        }}
        onSelectWorkflow={(pid, wid) => {
          setActiveProjectId(pid)
          setActiveWorkflowId(wid)
        }}
        onRenameProject={async (id, title) => {
          if (supabase) await supabase.from("projects").update({ title }).eq("id", id)
          update((xs) => xs.map((p) => (p.id === id ? { ...p, title } : p)))
        }}
        onRenameWorkflow={async (pid, id, title) => {
          if (supabase) await supabase.from("workflows").update({ title }).eq("id", id)
          update((xs) => xs.map((p) => (p.id === pid ? { ...p, workflows: p.workflows.map((w) => (w.id === id ? { ...w, title } : w)) } : p)))
        }}
      />

      <main className={`relative flex flex-col flex-1 h-screen overflow-hidden ${showReport ? "print:hidden" : ""}`}>
        {/* Top Pinned Header with User Login & Logout */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-6 py-3 shadow-sm dark:shadow-slate-900/50 flex-shrink-0 print:hidden transition-colors duration-200">
          <div className="flex items-center gap-3">
            {!inviteToken && (
              <button
                type="button"
                onClick={() => setViewMode("dashboard")}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors active:scale-95"
                title="Return to Projects Hub"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Projects</span>
              </button>
            )}

            {isViewerOnly && (
              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors active:scale-95"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>View Presentation</span>
              </button>
            )}

            {activeProject && (
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{activeProject.title}</span>
                {activeWorkflow && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span className="font-medium text-blue-600 dark:text-blue-400">{activeWorkflow.title}</span>
                  </>
                )}
              </div>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${effectiveIsOwner
                  ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                  : "bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                }`}
            >
              {effectiveIsOwner ? "Sender (Owner)" : "Viewer (Client)"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {effectiveIsOwner && (
              <div className="flex items-center gap-2">
                <input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Client email (optional)"
                  className="w-36 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500"
                />

                {/* Option to choose Edit or View permission */}
                <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setInvitePermission("view")
                      setInviteLink("")
                    }}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-all ${invitePermission === "view"
                        ? "bg-white text-purple-700 shadow-sm border border-purple-200"
                        : "text-slate-600 hover:text-slate-900"
                      }`}
                    title="View: Can only see presentations and comment"
                  >
                    <Eye className="h-3 w-3" />
                    <span>View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInvitePermission("edit")
                      setInviteLink("")
                    }}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-all ${invitePermission === "edit"
                        ? "bg-white text-blue-700 shadow-sm border border-blue-200"
                        : "text-slate-600 hover:text-slate-900"
                      }`}
                    title="Edit: Can edit and upload images & designs"
                  >
                    <Pencil className="h-3 w-3" />
                    <span>Edit</span>
                  </button>
                </div>

                <button
                  onClick={createInvite}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors ${invitePermission === "edit"
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-purple-600 hover:bg-purple-700"
                    }`}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Get {invitePermission === "edit" ? "Edit" : "View"} Link</span>
                </button>

                {inviteLink && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(inviteLink)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${invitePermission === "edit"
                        ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                        : "border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100"
                      }`}
                    title="Copy generated invite link"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? "Copied!" : `Copy ${invitePermission === "edit" ? "Edit" : "View"} Link`}</span>
                  </button>
                )}
              </div>
            )}

            {/* User Login Info or Invite Guest Mode */}
            {user ? (
              <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200 dark:border-slate-700">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 dark:bg-blue-600 text-xs font-bold text-white shadow-sm">
                  {user.email ? user.email.slice(0, 2).toUpperCase() : "US"}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-medium text-slate-800 dark:text-slate-200 leading-tight truncate max-w-[180px]">
                    {user.email}
                  </span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
                    Logged in
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${activeInvitePermission === "edit"
                      ? "bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                      : "bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                    }`}
                >
                  {activeInvitePermission === "edit" ? (
                    <>
                      <Pencil className="h-3.5 w-3.5" /> Shared (Can Edit Images)
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" /> Shared (Presentation View Only)
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Theme Toggle */}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />

            {/* Logout or Sign In Button */}
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-700 dark:hover:text-rose-400 hover:border-rose-200 dark:hover:border-rose-800"
                aria-label="Log out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log out</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.history.replaceState({}, "", window.location.pathname)
                  window.location.reload()
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>Sign in</span>
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950 transition-colors duration-200">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" />
            </div>
          ) : activeProject && activeWorkflow ? (
            <WorkflowEditor
              project={activeProject}
              workflow={activeWorkflow}
              isOwner={effectiveIsOwner}
              onUpdateField={updateField}
              onShowReport={() => setShowReport(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">
              Select or create a workflow to begin
            </div>
          )}
        </div>
      </main>

      {showReport && activeProject && (
        <ReportModal
          project={activeProject}
          isOwner={effectiveIsOwner}
          user={user}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleSignOut}
          onClose={() => setShowReport(false)}
          onUpdateWorkflowField={updateWorkflowField}
        />
      )}
    </div>
  )
}
