"use client"

import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import {
  FolderKanban,
  Loader2,
  LogOut,
  Share2,
  Eye,
  Pencil,
  ArrowLeft,
  Menu,
  X,
  Shield,
  ShieldCheck,
  Users,
  Search,
  Plus,
} from "lucide-react"
import type { Session, AuthChangeEvent } from "@supabase/supabase-js"
import type {
  Project,
  Workflow,
  WorkflowComment,
  WorkflowRevision,
  EditingId,
  UserPermissions,
} from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"
import { Sidebar } from "@/components/design-review/sidebar"
import { WorkflowEditor } from "@/components/design-review/workflow-editor"
import { ReportModal } from "@/components/design-review/report-modal"
import { ProjectDashboard } from "@/components/design-review/project-dashboard"
import { ThemeToggle } from "@/components/design-review/theme-toggle"
import { LandingPage } from "@/components/design-review/landing-page"
import { SharePermissionsModal } from "@/components/design-review/share-permissions-modal"

type ProjectRow = { id: string; title: string; is_expanded: boolean; user_id: string; figma_url?: string | null }
type WorkflowRow = {
  id: string
  project_id: string
  title: string
  design_a: string | null
  design_b: string | null
  figma_url?: string | null
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
type RevisionRow = {
  id: string
  project_id: string
  workflow_id: string
  revision_number: number
  author_id?: string
  author_email?: string
  author_role: "client" | "freelancer" | "owner"
  reason: string
  design_a?: string | null
  design_b?: string | null
  created_at: string
}

const sortWorkflowsBySavedOrder = (projectId: string, workflows: Workflow[]): Workflow[] => {
  if (typeof window === "undefined") return workflows
  try {
    const saved = localStorage.getItem(`wf_order_${projectId}`)
    if (saved) {
      const orderIds: string[] = JSON.parse(saved)
      if (Array.isArray(orderIds) && orderIds.length > 0) {
        return [...workflows].sort((a, b) => {
          const idxA = orderIds.indexOf(a.id)
          const idxB = orderIds.indexOf(b.id)
          if (idxA === -1 && idxB === -1) return 0
          if (idxA === -1) return 1
          if (idxB === -1) return -1
          return idxA - idxB
        })
      }
    }
  } catch (e) {
    // Ignore JSON errors
  }
  return workflows
}

const sortProjectsBySavedOrder = (userId: string | undefined, list: Project[]): Project[] => {
  if (typeof window === "undefined") return list
  try {
    const saved = localStorage.getItem(`project_order_${userId || "default"}`)
    if (saved) {
      const orderIds: string[] = JSON.parse(saved)
      if (Array.isArray(orderIds) && orderIds.length > 0) {
        return [...list].sort((a, b) => {
          const idxA = orderIds.indexOf(a.id)
          const idxB = orderIds.indexOf(b.id)
          if (idxA === -1 && idxB === -1) return 0
          if (idxA === -1) return 1
          if (idxB === -1) return -1
          return idxA - idxB
        })
      }
    }
  } catch (e) {
    // Ignore JSON errors
  }
  return list
}

const mapData = (
  projects: ProjectRow[],
  workflows: WorkflowRow[],
  comments: CommentRow[],
  revisions: RevisionRow[],
  userId?: string
): Project[] => {
  const mapped = projects.map((p) => {
    const pWorkflows: Workflow[] = workflows
      .filter((w) => w.project_id === p.id)
      .map((w) => ({
        id: w.id,
        projectId: w.project_id,
        title: w.title,
        designA: w.design_a,
        designB: w.design_b,
        figmaUrl: w.figma_url || null,
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
        revisions: revisions
          .filter((r) => r.workflow_id === w.id)
          .map((r) => ({
            id: r.id,
            workflowId: r.workflow_id,
            revisionNumber: r.revision_number,
            authorId: r.author_id,
            authorEmail: r.author_email,
            authorRole: r.author_role,
            reason: r.reason,
            designA: r.design_a,
            designB: r.design_b,
            createdAt: r.created_at,
          })),
      }))

    return {
      id: p.id,
      title: p.title,
      isExpanded: p.is_expanded,
      userId: p.user_id,
      figmaUrl: p.figma_url || null,
      workflows: sortWorkflowsBySavedOrder(p.id, pWorkflows),
    }
  })

  return sortProjectsBySavedOrder(userId, mapped)
}

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
  const [viewMode, setViewMode] = useState<"dashboard" | "editor">("dashboard")
  const [dashboardSearchQuery, setDashboardSearchQuery] = useState("")
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [showLanding, setShowLanding] = useState(true)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteModalData, setInviteModalData] = useState<{
    token: string
    title: string
    role?: string
    access?: string
  } | null>(null)
  const [isProcessingInvite, setIsProcessingInvite] = useState(false)

  // Granular project permissions for current user on active project
  const [userPermissions, setUserPermissions] = useState<UserPermissions>({
    authenticated: false,
    isOwner: false,
    role: null,
    access: null,
    canComment: false,
    canApprove: false,
  })

  // Extract invite token on client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const token = new URLSearchParams(window.location.search).get("invite")
      if (token) {
        setInviteToken(token)
        setShowLanding(false)
      }
    }
  }, [])

  // Theme initialization
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

  // Auth session check
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

  // Load user's projects and workflows
  const loadWorkspace = useCallback(async () => {
    if (!user || !supabase) {
      setProjects([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { data: ps, error: pError } = await supabase
        .from("projects")
        .select("id,title,is_expanded,user_id,figma_url")
        .order("created_at", { ascending: true })

      if (pError) {
        console.error("Error loading projects:", pError)
        setLoading(false)
        return
      }

      const ids = (ps as ProjectRow[]).map((p) => p.id)
      const [{ data: ws }, { data: cs }, { data: revs }] = await Promise.all([
        supabase
          .from("workflows")
          .select("id,project_id,title,design_a,design_b,figma_url,our_notes,client_message,client_task_done,reason,is_done")
          .in("project_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        supabase
          .from("workflow_comments")
          .select("id,workflow_id,author_id,body,reason,created_at"),
        supabase
          .from("workflow_revisions")
          .select("id,project_id,workflow_id,revision_number,author_id,author_email,author_role,reason,design_a,design_b,created_at")
          .in("project_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .order("revision_number", { ascending: false }),
      ])

      const next = mapData(
        ps as ProjectRow[],
        (ws || []) as WorkflowRow[],
        (cs || []) as CommentRow[],
        (revs || []) as RevisionRow[],
        user.id
      )

      setProjects(next)
      if (next.length > 0) {
        setActiveProjectId((prev) => (prev && next.some((p) => p.id === prev) ? prev : next[0].id))
        const activeP = next.find((p) => p.id === activeProjectId) || next[0]
        if (activeP && activeP.workflows.length > 0) {
          setActiveWorkflowId((prevW) => (prevW && activeP.workflows.some((w) => w.id === prevW) ? prevW : activeP.workflows[0].id))
        }
      }
      return next
    } catch (err) {
      console.error("Failed to load workspace:", err)
      return []
    } finally {
      setLoading(false)
    }
  }, [user, supabase, activeProjectId])

  // Handle deleting an owned project (owner only) or rejecting/leaving a shared project (members only)
  const handleDeleteOrLeaveProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const targetP = projects.find((p) => p.id === id)
    // Only the actual project owner has permission to delete the project
    const isProjectOwner = targetP
      ? Boolean(user?.id && targetP.userId ? targetP.userId === user.id : !targetP.userId)
      : false

    if (isProjectOwner) {
      if (!confirm("Are you sure you want to permanently delete this project? All associated workflows, designs, and comments will be permanently deleted.")) return
      update((xs) => xs.filter((p) => p.id !== id))
      if (activeProjectId === id) setActiveProjectId(projects.find((p) => p.id !== id)?.id ?? null)
      const { error } = await supabase.from("projects").delete().eq("id", id)
      if (error) {
        console.error("Error deleting project:", error)
        alert(`Failed to delete project: ${error.message}`)
        await loadWorkspace()
      }
    } else {
      // Non-owners only have reject and accept permission - cannot delete project
      if (!confirm("Are you sure you want to reject and remove this project from your dashboard? You will no longer see this project unless re-invited.")) return
      update((xs) => xs.filter((p) => p.id !== id))
      if (activeProjectId === id) setActiveProjectId(projects.find((p) => p.id !== id)?.id ?? null)
      try {
        const { error } = await supabase.rpc("leave_project", { p_project_id: id })
        if (error) {
          console.error("Error leaving project:", error)
          alert(`Failed to reject/leave project: ${error.message}`)
          await loadWorkspace()
        }
      } catch (err) {
        console.error("Error leaving project:", err)
      }
    }
  }

  // Check and prompt invite once user is authenticated
  useEffect(() => {
    if (!user || !supabase || !inviteToken) return

    let cancelled = false
    const inspectInvite = async () => {
      try {
        const { data, error } = await supabase.rpc("get_project_by_invite", {
          invite_token: inviteToken,
        })

        if (cancelled) return

        if (error || !data) {
          console.error("Invite lookup error:", error)
          const { data: accData } = await supabase.rpc("accept_project_invite", {
            p_invite_token: inviteToken,
          })
          if (!cancelled && accData) {
            window.history.replaceState({}, "", window.location.pathname)
            setInviteToken(null)
            await loadWorkspace()
          }
        } else {
          setInviteModalData({
            token: inviteToken,
            title: data.title || "Shared Project",
            role: data.role || "client",
            access: data.permission || "view",
          })
        }
      } catch (err) {
        console.error("Error inspecting invite:", err)
      }
    }

    inspectInvite()
    return () => {
      cancelled = true
    }
  }, [user, supabase, inviteToken, loadWorkspace])

  const handleAcceptInvite = async () => {
    if (!inviteModalData || !supabase) return
    setIsProcessingInvite(true)
    const token = inviteModalData.token
    try {
      const { data, error } = await supabase.rpc("accept_project_invite", {
        p_invite_token: token,
      })
      window.history.replaceState({}, "", window.location.pathname)
      setInviteToken(null)
      setInviteModalData(null)
      if (error) {
        alert(error.message || "Failed to accept invite.")
      } else if (data) {
        const loadedProjects = await loadWorkspace()
        if (data.project_id) {
          setActiveProjectId(data.project_id)
          const targetP = loadedProjects?.find((p) => p.id === data.project_id)
          if (targetP && targetP.workflows.length > 0) {
            setActiveWorkflowId(targetP.workflows[0].id)
          }
        }
        if (data.access === "view") {
          setShowReport(true)
        } else {
          setShowReport(false)
          setViewMode("editor")
        }
      }
    } catch (err) {
      console.error("Error accepting invite:", err)
    } finally {
      setIsProcessingInvite(false)
    }
  }

  const handleRejectInvite = async () => {
    if (!inviteModalData || !supabase) return
    setIsProcessingInvite(true)
    const token = inviteModalData.token
    const projectTitle = inviteModalData.title
    try {
      await supabase.rpc("reject_project_invite", {
        p_invite_token: token,
      })
      window.history.replaceState({}, "", window.location.pathname)
      setInviteToken(null)
      setInviteModalData(null)
      await loadWorkspace()
      alert(`Invitation for "${projectTitle}" was rejected. It will not appear in your dashboard.`)
    } catch (err) {
      console.error("Error rejecting invite:", err)
    } finally {
      setIsProcessingInvite(false)
    }
  }

  // Fetch projects on auth change
  useEffect(() => {
    if (user) {
      loadWorkspace()
    } else {
      setProjects([])
      setLoading(false)
    }
  }, [user, loadWorkspace])

  // Fetch granular permissions whenever active project changes
  useEffect(() => {
    if (!user || !supabase || !activeProjectId) {
      setUserPermissions({
        authenticated: !!user,
        isOwner: false,
        role: null,
        access: null,
        canComment: false,
        canApprove: false,
      })
      return
    }

    let cancelled = false
    const fetchPermissions = async () => {
      try {
        const { data, error } = await supabase.rpc("get_user_project_permissions", {
          p_project_id: activeProjectId,
        })
        if (cancelled) return
        if (!error && data) {
          setUserPermissions(data as UserPermissions)
        }
      } catch (err) {
        console.error("Error fetching permissions:", err)
      }
    }

    fetchPermissions()
    return () => {
      cancelled = true
    }
  }, [user, supabase, activeProjectId])

  // Supabase Realtime Subscription
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
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workflow_revisions" },
        (payload: { new: Record<string, any> }) => {
          const newRev = payload.new as RevisionRow
          setProjects((prev) =>
            prev.map((p) => ({
              ...p,
              workflows: p.workflows.map((w) =>
                w.id === newRev.workflow_id
                  ? {
                      ...w,
                      revisions: [
                        {
                          id: newRev.id,
                          workflowId: newRev.workflow_id,
                          revisionNumber: newRev.revision_number,
                          authorId: newRev.author_id,
                          authorEmail: newRev.author_email,
                          authorRole: newRev.author_role,
                          reason: newRev.reason,
                          designA: newRev.design_a,
                          designB: newRev.design_b,
                          createdAt: newRev.created_at,
                        },
                        ...(w.revisions || []).filter((r) => r.id !== newRev.id),
                      ],
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
  const activeWorkflow = activeProject?.workflows.find((w) => w.id === activeWorkflowId) ?? activeProject?.workflows[0] ?? null

  const isOwner = Boolean(activeProject && user && activeProject.userId === user.id)
  const canEdit = Boolean(isOwner || userPermissions.access === "edit")
  const canClientComment = Boolean(isOwner || userPermissions.canComment)
  const canApprove = Boolean(isOwner || userPermissions.canApprove)
  const userRole = isOwner ? "owner" : (userPermissions.role || "client")

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
      const msg = result.error.message.toLowerCase()
      if (msg.includes("email not confirmed")) {
        setAuthMessage("Please confirm your email before signing in.")
        setShowResend(true)
      } else {
        setAuthMessage(result.error.message)
      }
      return
    }

    if (authMode === "signup" && !result.data.session) {
      setAuthMessage("Account created. Please check your email for the confirmation link.")
      setShowResend(true)
      return
    }

    if (result.data.user) {
      setUser({ id: result.data.user.id, email: result.data.user.email })
      setAuthMessage("")
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
    if (!supabase || !user) {
      alert("Please sign in or create an account to create your own projects.")
      return
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: user.id, title: `New Project ${projects.length + 1}`, is_expanded: true })
      .select("id,title,is_expanded,user_id")
      .single()

    if (error) {
      console.error("Error creating project:", error)
      alert(`Error creating project: ${error.message}`)
      return
    }

    const p: Project = { id: data.id, title: data.title, isExpanded: true, userId: data.user_id, workflows: [] }
    update((x) => [...x, p])
    setActiveProjectId(p.id)
    setActiveWorkflowId(null)
    setShowReport(false)
    setViewMode("editor")
  }

  const createWorkflow = async (projectId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!supabase || !user) {
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
        revisions: [],
      }
      update((x) =>
        x.map((p) => (p.id === projectId ? { ...p, isExpanded: true, workflows: [...p.workflows, w] } : p))
      )
      setActiveProjectId(projectId)
      setActiveWorkflowId(w.id)
    }
  }

  const fieldDebounceTimers = useRef<Record<string, NodeJS.Timeout>>({})

  // Update workflow field with backend permission validation
  const updateWorkflowField = async (
    workflowId: string,
    field: keyof Workflow,
    value: string | boolean | null
  ) => {
    if (!supabase || !workflowId || !activeProjectId) return

    // Optimistic local update (instant UI response)
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

    const isTextField = field === "ourNotes" || field === "clientMessage" || field === "reason" || field === "title"
    const timerKey = `${workflowId}-${field}`

    const executeSave = async () => {
      const valueText = typeof value === "string" ? value : null
      const valueBool = typeof value === "boolean" ? value : null

      const { error } = await supabase.rpc("update_workflow_field_secure", {
        p_workflow_id: workflowId,
        p_field: field,
        p_value_text: valueText,
        p_value_bool: valueBool,
      })

      if (error) {
        console.error("Permission error updating workflow field:", error)
        alert(`Permission Error: ${error.message}`)
        loadWorkspace()
      }
    }

    if (isTextField) {
      if (fieldDebounceTimers.current[timerKey]) {
        clearTimeout(fieldDebounceTimers.current[timerKey])
      }
      fieldDebounceTimers.current[timerKey] = setTimeout(() => {
        executeSave()
        delete fieldDebounceTimers.current[timerKey]
      }, 400)
    } else {
      await executeSave()
    }
  }

  const updateField = (field: keyof Workflow, value: string | boolean | null) => {
    if (activeWorkflow?.id) {
      updateWorkflowField(activeWorkflow.id, field, value)
    }
  }

  const handleUpdateProjectFigmaUrl = async (projectId: string, figmaUrl: string | null) => {
    if (!supabase || !projectId) return
    update((xs) => xs.map((p) => (p.id === projectId ? { ...p, figmaUrl } : p)))
    try {
      localStorage.setItem(`project_figma_url_${projectId}`, figmaUrl || "")
      await supabase.rpc("update_project_figma_url", {
        p_project_id: projectId,
        p_figma_url: figmaUrl,
      })
    } catch (err) {
      console.error("Error updating project Figma URL:", err)
    }
  }

  // Submit formal revision with mandatory reason
  const submitFinalRevision = async (workflowId: string, reason: string) => {
    if (!supabase || !user || !workflowId) return
    const { data, error } = await supabase.rpc("submit_workflow_revision", {
      p_workflow_id: workflowId,
      p_reason: reason,
    })

    if (error) {
      console.error("Error submitting revision:", error)
      alert(`Error submitting revision: ${error.message}`)
      return
    }

    if (data) {
      update((xs) =>
        xs.map((p) => ({
          ...p,
          workflows: p.workflows.map((w) =>
            w.id === workflowId
              ? {
                  ...w,
                  reason,
                  revisions: [
                    {
                      id: data.id,
                      workflowId,
                      revisionNumber: data.revision_number,
                      authorEmail: data.author_email,
                      authorRole: data.author_role,
                      reason: data.reason,
                      createdAt: data.created_at,
                    },
                    ...(w.revisions || []),
                  ],
                }
              : w
          ),
        }))
      )
    }
  }

  // Add Comment
  const addComment = async (body: string, reason?: string, targetWorkflowId?: string) => {
    const wid = targetWorkflowId || activeWorkflow?.id
    if (!supabase || !user || !wid) return

    const tempId = `temp-${Date.now()}`
    const newComment: WorkflowComment = {
      id: tempId,
      workflowId: wid,
      authorId: user.id,
      authorEmail: user.email || (isOwner ? "Owner" : "Member"),
      reason: reason || undefined,
      body,
      createdAt: new Date().toISOString(),
    }

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

  // Loading state during auth initialization
  if (isAuthChecking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-zinc-950 p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 shadow-xl">
            <FolderKanban className="h-8 w-8 text-white animate-pulse" />
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Loading workspace...</span>
          </div>
        </div>
      </main>
    )
  }

  // Landing Page for unauthenticated visitors without an invite
  if (!user && !inviteToken && showLanding) {
    return (
      <LandingPage
        theme={theme}
        onToggleTheme={toggleTheme}
        onGetStarted={() => setShowLanding(false)}
      />
    )
  }

  // Auth Card for unauthenticated users (either visiting or responding to invite)
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-zinc-950 p-6 transition-colors duration-200">
        <div className="fixed top-4 right-4 z-50">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <form
          onSubmit={authenticate}
          className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-900 dark:text-white p-8 shadow-xl transition-colors duration-200"
        >
          {!inviteToken && (
            <button
              type="button"
              onClick={() => setShowLanding(true)}
              className="mb-6 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Home</span>
            </button>
          )}

          <div className="mb-6">
            <FolderKanban className="mb-4 h-12 w-12 rounded-2xl bg-slate-900 dark:bg-zinc-800 p-3 text-white shadow" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Design Review</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {inviteToken
                ? "You've been invited to collaborate on this project. Please sign in or create an account with your invited email to access."
                : authMode === "signin"
                ? "Sign in to your review workspace."
                : "Create your account to get started."}
            </p>
          </div>

          <label className="mb-4 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Email Address
            <input
              className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
            />
          </label>
          <label className="mb-5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Password
            <input
              className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {authMessage && (
            <div className="mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 p-3 text-xs text-rose-700 dark:text-rose-300">
              <p>{authMessage}</p>
              {showResend && (
                <button
                  type="button"
                  onClick={resendConfirmation}
                  className="mt-2 font-semibold underline underline-offset-2 cursor-pointer"
                >
                  Resend confirmation email
                </button>
              )}
            </div>
          )}

          <button
            className="w-full rounded-xl bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 py-3 text-white font-semibold transition-colors cursor-pointer text-sm shadow-md"
            disabled={authLoading}
          >
            {authLoading ? "Loading..." : authMode === "signin" ? "Sign In & Access" : "Create Account & Access"}
          </button>
          <button
            type="button"
            className="mt-4 w-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
            onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
          >
            {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </main>
    )
  }

  // Viewer Only (Presentation mode)
  if (activeProject && !canEdit) {
    if (showReport || viewMode === "editor") {
      return (
        <div className="h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-900 text-white print:h-auto print:w-auto print:overflow-visible print:bg-white print:text-black">
          <ReportModal
            project={activeProject}
            isOwner={false}
            canEdit={false}
            canComment={canClientComment}
            canApprove={canApprove}
            userRole={userRole}
            isViewerOnly={true}
            user={user}
            theme={theme}
            onToggleTheme={toggleTheme}
            onLogout={handleSignOut}
            onClose={() => setViewMode("dashboard")}
            onUpdateWorkflowField={updateWorkflowField}
            onUpdateProjectFigmaUrl={handleUpdateProjectFigmaUrl}
            onSubmitRevision={submitFinalRevision}
          />
        </div>
      )
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 font-sans text-slate-900 dark:text-white transition-colors duration-200 print:h-auto print:w-auto print:overflow-visible print:block print:bg-white">
      {/* Mobile Drawer Backdrop */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 h-full flex flex-col min-h-0 flex-shrink-0 transform transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${showReport ? "print:hidden" : ""}`}
      >
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          activeWorkflowId={activeWorkflowId}
          editingId={editingId}
          isOwner={isOwner}
          setEditingId={(id: EditingId) => setEditingId(id)}
          onSelectProject={(id: string) => {
            setActiveProjectId(id)
            setIsMobileSidebarOpen(false)
          }}
          onSelectWorkflow={(projectId: string, workflowId: string) => {
            setActiveProjectId(projectId)
            setActiveWorkflowId(workflowId)
            setViewMode("editor")
            setIsMobileSidebarOpen(false)
          }}
          onCreateProject={createProject}
          onCreateWorkflow={createWorkflow}
          onToggleExpand={(id: string) =>
            update((xs) => xs.map((p) => (p.id === id ? { ...p, isExpanded: !p.isExpanded } : p)))
          }
          onRenameWorkflow={(projectId: string, workflowId: string, title: string) =>
            update((xs) =>
              xs.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      workflows: p.workflows.map((w) => (w.id === workflowId ? { ...w, title } : w)),
                    }
                  : p
              )
            )
          }
          onRenameProject={(id: string, title: string) =>
            update((xs) => xs.map((p) => (p.id === id ? { ...p, title } : p)))
          }
          userId={user?.id}
          onDeleteProject={handleDeleteOrLeaveProject}
          onDeleteWorkflow={async (projectId: string, workflowId: string, e: React.MouseEvent) => {
            e.stopPropagation()
            if (!confirm("Are you sure you want to delete this workflow?")) return
            update((xs) =>
              xs.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      workflows: p.workflows.filter((w) => w.id !== workflowId),
                    }
                  : p
              )
            )
            if (activeWorkflowId === workflowId) setActiveWorkflowId(null)
            await supabase.from("workflows").delete().eq("id", workflowId)
          }}
          onReorderWorkflows={(projectId: string, sourceIndex: number, destinationIndex: number) => {
            update((xs) =>
              xs.map((p) => {
                if (p.id !== projectId) return p
                const updated = [...p.workflows]
                const [moved] = updated.splice(sourceIndex, 1)
                updated.splice(destinationIndex, 0, moved)
                try {
                  localStorage.setItem(`wf_order_${projectId}`, JSON.stringify(updated.map((w) => w.id)))
                } catch (e) {
                  // Ignore
                }
                return { ...p, workflows: updated }
              })
            )
          }}
          onReorderProjects={(sourceIndex: number, destinationIndex: number) => {
            update((prev) => {
              const updated = [...prev]
              const [moved] = updated.splice(sourceIndex, 1)
              updated.splice(destinationIndex, 0, moved)
              try {
                localStorage.setItem(`project_order_${user?.id || "default"}`, JSON.stringify(updated.map((p) => p.id)))
              } catch (e) {
                // Ignore
              }
              return updated
            })
          }}
        />
      </div>

      {/* Main Workspace Area */}
      <main className={`flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-white dark:bg-slate-900 transition-colors duration-200 ${showReport ? "print:hidden" : ""}`}>
        {/* Workspace Top Header */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 flex items-center justify-between gap-3 flex-shrink-0 z-10 transition-colors duration-200">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Mobile Sidebar Hamburger Toggle */}
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Open navigation sidebar"
            >
              <Menu className="h-4 w-4" />
            </button>

            {/* View Mode Toggle: Dashboard vs Editor */}
            {activeProject && (
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setViewMode("dashboard")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === "dashboard"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("editor")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    viewMode === "editor"
                      ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  Editor
                </button>
              </div>
            )}

            {/* Active Project Title & Role Indicator (Editor Mode Only) */}
            {viewMode === "editor" && activeProject && (
              <div className="hidden sm:flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[200px]">
                  {activeProject.title}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                    isOwner
                      ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                      : userRole === "freelancer"
                      ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                      : "bg-purple-50 dark:purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                  }`}
                >
                  {isOwner ? "Owner" : userRole === "freelancer" ? "Freelancer" : `Client (${canEdit ? "Edit" : "View"})`}
                </span>
              </div>
            )}

            {/* Global Search Bar (Dashboard Mode Only) */}
            {viewMode === "dashboard" && (
              <div className="relative w-48 sm:w-64 md:w-80 hidden sm:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search projects or files..."
                  value={dashboardSearchQuery}
                  onChange={(e) => setDashboardSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/90 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 outline-none transition-all focus:border-blue-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Create Project Button (Dashboard Mode Only) */}
            {viewMode === "dashboard" && (isOwner || user) && (
              <button
                type="button"
                onClick={createProject}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">New Project</span>
              </button>
            )}

            {/* View Presentation Button (Editor Mode Only) */}
            {viewMode === "editor" && activeProject && (
              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 cursor-pointer"
                title="Open Presentation View"
              >
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Presentation</span>
              </button>
            )}

            {/* Share & Permissions Button (Owner Only in Editor Mode) */}
            {viewMode === "editor" && isOwner && activeProject && (
              <button
                type="button"
                onClick={() => setIsShareOpen(true)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share</span>
              </button>
            )}

            {/* Theme Toggle */}
            <ThemeToggle theme={theme} onToggle={toggleTheme} />

            {/* User Profile & Logout */}
            {user ? (
              <div className="flex items-center gap-1.5 sm:gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
                <div
                  className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-sm ring-1 ring-slate-300 dark:ring-zinc-700 flex-shrink-0"
                  title={user.email || "Logged in"}
                >
                  {user.email ? user.email.slice(0, 2).toUpperCase() : "US"}
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex-shrink-0 cursor-pointer"
                  title="Log out"
                  aria-label="Log out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {/* Workspace Body Area */}
        <div className="flex-1 overflow-y-auto bg-slate-100 dark:bg-slate-950 transition-colors duration-200">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" />
            </div>
          ) : viewMode === "dashboard" ? (
            <ProjectDashboard
              projects={projects}
              userEmail={user?.email}
              userId={user?.id}
              isOwner={isOwner}
              searchQuery={dashboardSearchQuery}
              onSearchChange={setDashboardSearchQuery}
              theme={theme}
              onToggleTheme={toggleTheme}
              onCreateProject={createProject}
              onSelectProject={(id: string) => {
                setActiveProjectId(id)
                setViewMode("editor")
              }}
              onOpenPresentation={(id: string) => {
                setActiveProjectId(id)
                setShowReport(true)
              }}
              onDeleteProject={handleDeleteOrLeaveProject}
              onRenameProject={(id: string, title: string) =>
                update((xs) => xs.map((p) => (p.id === id ? { ...p, title } : p)))
              }
              onShareProject={(id: string) => {
                setActiveProjectId(id)
                setIsShareOpen(true)
              }}
            />
          ) : activeProject && activeWorkflow ? (
            <WorkflowEditor
              project={activeProject}
              workflow={activeWorkflow}
              isOwner={isOwner}
              canEdit={canEdit}
              canComment={canClientComment}
              canApprove={canApprove}
              userRole={userRole}
              onUpdateField={updateField}
              onSubmitRevision={submitFinalRevision}
              onShowReport={() => setShowReport(true)}
              onAddComment={addComment}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">
              Select or create a workflow to begin
            </div>
          )}
        </div>
      </main>

      {/* Share & Granular Permissions Modal */}
      {isOwner && activeProject && (
        <SharePermissionsModal
          project={activeProject}
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          currentUserEmail={user?.email}
        />
      )}

      {/* Presentation / Report Modal */}
      {showReport && activeProject && (
        <ReportModal
          project={activeProject}
          isOwner={isOwner}
          canEdit={canEdit}
          canComment={canClientComment}
          canApprove={canApprove}
          userRole={userRole}
          user={user}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLogout={handleSignOut}
          onClose={() => setShowReport(false)}
          onUpdateWorkflowField={updateWorkflowField}
          onUpdateProjectFigmaUrl={handleUpdateProjectFigmaUrl}
          onSubmitRevision={submitFinalRevision}
        />
      )}

      {/* Project Invitation Confirmation Modal (Accept / Reject) */}
      {inviteModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl text-slate-100 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex-shrink-0">
                <Share2 className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-white">Project Invitation</h3>
                <p className="text-xs text-slate-400">You&apos;ve been invited to collaborate</p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-2">
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Project</div>
              <div className="text-sm font-bold text-white truncate">{inviteModalData.title}</div>
              <div className="flex items-center gap-2 pt-1 text-xs text-slate-400">
                <span className="px-2.5 py-0.5 rounded-full bg-purple-950 text-purple-400 border border-purple-800 text-[10px] font-semibold capitalize">
                  {inviteModalData.role || "Client"}
                </span>
                <span>•</span>
                <span className="text-emerald-400">
                  {inviteModalData.access === "edit" ? "Can Edit & Upload" : "View Only Access"}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 gap-3">
              <p className="text-[11px] text-slate-400 max-w-[220px]">
                Rejecting will decline this invitation and remove it from your dashboard.
              </p>
              <div className="flex items-center gap-2 justify-end flex-shrink-0">
                <button
                  type="button"
                  disabled={isProcessingInvite}
                  onClick={handleRejectInvite}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-xl border border-rose-900/60 transition-colors cursor-pointer"
                >
                  {isProcessingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reject"}
                </button>
                <button
                  type="button"
                  disabled={isProcessingInvite}
                  onClick={handleAcceptInvite}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/30 transition-colors cursor-pointer"
                >
                  {isProcessingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept & Open"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
