"use client"

import { useState, useEffect } from "react"
import {
  Share2,
  X,
  Copy,
  Check,
  UserPlus,
  Users,
  Eye,
  Pencil,
  MessageSquare,
  MessageSquareOff,
  Shield,
  ShieldCheck,
  Trash2,
  Send,
  Loader2,
  CheckCircle2,
  Clock,
  Lock,
  RotateCcw,
  AlertCircle,
  XCircle,
  Timer,
} from "lucide-react"
import type {
  Project,
  MemberRole,
  AccessPermission,
  ProjectMember,
  ProjectInvite,
} from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"

type SharePermissionsModalProps = {
  project: Project
  isOpen: boolean
  onClose: () => void
  currentUserEmail?: string
}

export function SharePermissionsModal({
  project,
  isOpen,
  onClose,
  currentUserEmail: propUserEmail,
}: SharePermissionsModalProps) {
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<"invite" | "people">("invite")
  const [currentUserEmail, setCurrentUserEmail] = useState<string>(propUserEmail || "")
  
  // Invite Form State
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("client")
  const [access, setAccess] = useState<AccessPermission>("view")
  const [canComment, setCanComment] = useState<boolean>(true)
  const [canApprove, setCanApprove] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [generatedLink, setGeneratedLink] = useState("")
  const [copied, setCopied] = useState(false)
  const [formError, setFormError] = useState("")

  // People & Permissions List State
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [invites, setInvites] = useState<ProjectInvite[]>([])
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)
  const [peopleFilter, setPeopleFilter] = useState<"all" | "accepted" | "pending" | "rejected" | "expired">("all")
  const [nowTime, setNowTime] = useState<number>(Date.now())

  // Ticking countdown timer for remaining expiry time
  useEffect(() => {
    if (!isOpen) return
    const interval = setInterval(() => setNowTime(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  // Load People & Permissions when modal opens or tab switches
  const loadPeople = async () => {
    if (!supabase || !project.id) return
    setIsLoadingPeople(true)
    try {
      if (!currentUserEmail) {
        const { data: userData } = await supabase.auth.getUser()
        if (userData?.user?.email) {
          setCurrentUserEmail(userData.user.email)
        }
      }

      const { data, error } = await supabase.rpc("get_project_people_and_permissions", {
        p_project_id: project.id,
      })

      if (error) {
        console.error("Error loading people & permissions:", error)
      } else if (data) {
        const rawMembers = Array.isArray(data.members) ? data.members : []
        const mappedMembers: ProjectMember[] = rawMembers.map((m: any) => ({
          id: m.id,
          userId: m.user_id || m.userId,
          userEmail: m.user_email || m.userEmail || "Team Member",
          role: m.role || "client",
          access: m.access || "view",
          canComment: m.can_comment ?? m.canComment ?? false,
          canApprove: m.can_approve ?? m.canApprove ?? false,
          createdAt: m.created_at || m.createdAt,
        }))

        const rawInvites = Array.isArray(data.invites) ? data.invites : []
        const mappedInvites: ProjectInvite[] = rawInvites.map((i: any) => ({
          id: i.id,
          inviteeEmail: i.invitee_email || i.inviteeEmail || "Invited User",
          token: i.token,
          role: i.role || "client",
          access: i.access || "view",
          canComment: i.can_comment ?? i.canComment ?? false,
          canApprove: i.can_approve ?? i.canApprove ?? false,
          status: i.status || "pending",
          createdAt: i.created_at || i.createdAt,
          expiresAt: i.expires_at || i.expiresAt,
        }))

        setMembers(mappedMembers)
        setInvites(mappedInvites)
      }
    } catch (err) {
      console.error("Failed to load people:", err)
    } finally {
      setIsLoadingPeople(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      if (propUserEmail) setCurrentUserEmail(propUserEmail)
      loadPeople()
    }
  }, [isOpen, project.id, propUserEmail])

  if (!isOpen) return null

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError("")
    if (!email || !email.includes("@")) {
      setFormError("Please enter a valid email address.")
      return
    }

    setIsSubmitting(true)
    try {
      const { data, error } = await supabase.rpc("create_project_invitation", {
        p_project_id: project.id,
        p_email: email,
        p_role: role,
        p_access: access,
        p_can_comment: role === "client" ? canComment : false,
        p_can_approve: role === "client" ? canApprove : false,
      })

      if (error) {
        setFormError(error.message || "Failed to create invitation.")
      } else if (data) {
        const link = `${window.location.origin}${window.location.pathname}?invite=${data.token}`
        setGeneratedLink(link)
        setEmail("")
        loadPeople()
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create invitation.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCopyLink = (linkToCopy: string) => {
    navigator.clipboard.writeText(linkToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleToggleMemberAccess = async (member: ProjectMember) => {
    const nextAccess: AccessPermission = member.access === "view" ? "edit" : "view"
    setActionLoadingId(member.id)
    try {
      await supabase.rpc("update_project_member_permissions", {
        p_project_id: project.id,
        p_member_id: member.id,
        p_access: nextAccess,
        p_can_comment: member.canComment,
        p_can_approve: member.canApprove,
      })
      await loadPeople()
    } catch (err) {
      console.error("Error updating member access:", err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleToggleMemberComment = async (member: ProjectMember) => {
    const nextComment = !member.canComment
    setActionLoadingId(member.id)
    try {
      await supabase.rpc("update_project_member_permissions", {
        p_project_id: project.id,
        p_member_id: member.id,
        p_access: member.access,
        p_can_comment: nextComment,
        p_can_approve: member.canApprove,
      })
      await loadPeople()
    } catch (err) {
      console.error("Error updating member comment permission:", err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRevokeMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to revoke access for this member?")) return
    setActionLoadingId(memberId)
    try {
      await supabase.rpc("revoke_project_member", {
        p_project_id: project.id,
        p_member_id: memberId,
      })
      await loadPeople()
    } catch (err) {
      console.error("Error revoking member:", err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    if (!confirm("Are you sure you want to cancel this pending invitation?")) return
    setActionLoadingId(inviteId)
    try {
      await supabase.rpc("revoke_project_invite", {
        p_project_id: project.id,
        p_invite_id: inviteId,
      })
      await loadPeople()
    } catch (err) {
      console.error("Error revoking invite:", err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRenewInvite = async (invite: ProjectInvite) => {
    setActionLoadingId(invite.id)
    try {
      const { data, error } = await supabase.rpc("renew_project_invitation", {
        p_project_id: project.id,
        p_invite_id: invite.id,
      })

      if (error) {
        console.error("Error renewing invite:", error)
        alert(error.message || "Failed to renew invitation.")
      } else if (data) {
        const link = `${window.location.origin}${window.location.pathname}?invite=${data.token}`
        handleCopyLink(link)
        await loadPeople()
      }
    } catch (err) {
      console.error("Failed to renew invite:", err)
    } finally {
      setActionLoadingId(null)
    }
  }

  const getInviteRemainingTime = (invite: ProjectInvite) => {
    if (invite.status === "rejected") {
      return { isExpired: false, isRejected: true, label: "Declined by recipient" }
    }
    if (invite.status === "accepted") {
      return { isExpired: false, isRejected: false, label: "Accepted" }
    }

    const expiryMs = invite.expiresAt
      ? new Date(invite.expiresAt).getTime()
      : new Date(invite.createdAt).getTime() + 15 * 60 * 1000

    const diff = expiryMs - nowTime
    if (diff <= 0 || invite.status === "expired") {
      return { isExpired: true, isRejected: false, label: "Expired (15m limit reached)" }
    }

    const mins = Math.floor(diff / 60000)
    const secs = Math.floor((diff % 60000) / 1000)
    return { isExpired: false, isRejected: false, label: `Expires in ${mins}m ${secs < 10 ? "0" : ""}${secs}s` }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Share2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Share Project &amp; Permissions</h2>
              <p className="text-xs text-slate-400 truncate max-w-[280px] sm:max-w-xs">{project.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center border-b border-slate-800 bg-slate-950/20 px-6 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("invite")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all cursor-pointer border-b-2 ${
              activeTab === "invite"
                ? "border-blue-500 text-blue-400 bg-slate-800/60"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Invite Person</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("people")}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-t-xl transition-all cursor-pointer border-b-2 ${
              activeTab === "people"
                ? "border-blue-500 text-blue-400 bg-slate-800/60"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>People &amp; Permissions</span>
            {(members.length > 0 || invites.length > 0) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                {members.length + invites.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {activeTab === "invite" ? (
            <form onSubmit={handleCreateInvite} className="space-y-5">
              {/* Invitee Email */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Person&apos;s Email <span className="text-rose-400">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  required
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
                />
                <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                  <Lock className="h-3 w-3 text-slate-500" />
                  Invited user must sign in with this email to access.
                </p>
              </div>

              {/* Role Selection: Client vs Freelancer */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">Role Type</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRole("client")
                      setCanComment(true)
                    }}
                    className={`flex items-start gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      role === "client"
                        ? "border-purple-500 bg-purple-950/30 ring-1 ring-purple-500/30"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/40 text-slate-400"
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg mt-0.5 ${role === "client" ? "bg-purple-600 text-white" : "bg-slate-800 text-slate-400"}`}>
                      <Users className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="block text-xs font-semibold text-white">Client</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Reviewer / stakeholder reviewing designs
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRole("freelancer")
                      setAccess("edit")
                      setCanComment(false)
                    }}
                    className={`flex items-start gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      role === "freelancer"
                        ? "border-blue-500 bg-blue-950/30 ring-1 ring-blue-500/30"
                        : "border-slate-800 bg-slate-950/60 hover:bg-slate-800/40 text-slate-400"
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg mt-0.5 ${role === "freelancer" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400"}`}>
                      <Shield className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="block text-xs font-semibold text-white">Freelancer</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                        Developer / designer making revisions
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Permission Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* 1. Access Permission */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Access Permission
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setAccess("view")}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        access === "view"
                          ? "bg-purple-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Eye className="h-3 w-3" />
                      <span>View Only</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccess("edit")}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        access === "edit"
                          ? "bg-blue-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <Pencil className="h-3 w-3" />
                      <span>Can Edit</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {access === "edit" ? "Can upload & modify workflows" : "Presentation & read-only preview"}
                  </p>
                </div>

                {/* 2. Comment Permission (Separated & Independent!) */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Client Commenting
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCanComment(true)}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        canComment
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>Can Comment</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCanComment(false)}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        !canComment
                          ? "bg-slate-700 text-slate-200 shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <MessageSquareOff className="h-3 w-3" />
                      <span>No Comments</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {canComment ? "Allowed to submit client feedback" : "Client comment box locked"}
                  </p>
                </div>
              </div>

              {/* Client Approval / Verify Option */}
              {role === "client" && (
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer hover:bg-slate-950 transition-colors">
                  <input
                    type="checkbox"
                    checked={canApprove}
                    onChange={(e) => setCanApprove(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
                  />
                  <div>
                    <span className="block text-xs font-semibold text-slate-200">
                      Grant Client Approval &amp; Verification
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      Allows client to mark items as &quot;Accepted &amp; Verified&quot;
                    </span>
                  </div>
                </label>
              )}

              {formError && (
                <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs">
                  {formError}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 py-3 text-xs font-semibold text-white shadow-lg shadow-blue-600/20 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating invitation...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span>Create &amp; Generate Invite Link</span>
                  </>
                )}
              </button>

              {/* Generated Link Display */}
              {generatedLink && (
                <div className="p-4 rounded-2xl bg-blue-950/30 border border-blue-500/40 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-semibold text-blue-300">
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Invitation Link Generated</span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                      <Clock className="h-3 w-3" /> Valid for 15 minutes
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950 border border-slate-800">
                    <input
                      readOnly
                      value={generatedLink}
                      className="bg-transparent text-xs text-slate-300 flex-1 outline-none truncate font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyLink(generatedLink)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all cursor-pointer ${
                        copied ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-500 shadow"
                      }`}
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copied ? "Copied!" : "Copy Link"}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Send this link to your recipient. The link will expire automatically in 15 minutes.
                  </p>
                </div>
              )}
            </form>
          ) : (
            /* People & Permissions Tab */
            <div className="space-y-4">
              {isLoadingPeople ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                  <span className="text-xs">Loading members &amp; invitations...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Project Owner Card */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                      Project Owner
                    </span>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-slate-950/80 border border-amber-900/40 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white text-xs font-bold shadow flex-shrink-0">
                          <ShieldCheck className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                              {currentUserEmail || "You (Project Owner)"}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800">
                              Owner
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span className="text-emerald-400 font-medium">Full Access</span>
                            <span>•</span>
                            <span>Project Creator &amp; Administrator</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                        <span className="text-[11px] font-medium text-slate-400 px-2.5 py-1 bg-slate-900/80 rounded-lg border border-slate-800">
                          Primary Owner
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Status Categorization & Filter Tabs */}
                  {(() => {
                    const acceptedMembers = members
                    const pendingInvites = invites.filter((i) => {
                      const timing = getInviteRemainingTime(i)
                      return i.status === "pending" && !timing.isExpired
                    })
                    const expiredInvites = invites.filter((i) => {
                      const timing = getInviteRemainingTime(i)
                      return i.status === "expired" || (i.status === "pending" && timing.isExpired)
                    })
                    const rejectedInvites = invites.filter((i) => i.status === "rejected")
                    const totalCollaborators = members.length + invites.length

                    const showAccepted = peopleFilter === "all" || peopleFilter === "accepted"
                    const showPending = peopleFilter === "all" || peopleFilter === "pending"
                    const showRejected = peopleFilter === "all" || peopleFilter === "rejected"
                    const showExpired = peopleFilter === "all" || peopleFilter === "expired"

                    return (
                      <div className="space-y-3 pt-2">
                        {/* Header & Filter Pills */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            Collaborators &amp; Invitations ({totalCollaborators})
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveTab("invite")}
                            className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 transition-colors self-start sm:self-auto"
                          >
                            <UserPlus className="h-3 w-3" />
                            <span>+ Invite New</span>
                          </button>
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
                          <button
                            type="button"
                            onClick={() => setPeopleFilter("all")}
                            className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer whitespace-nowrap ${
                              peopleFilter === "all"
                                ? "bg-blue-600 text-white shadow-sm"
                                : "bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800"
                            }`}
                          >
                            All ({totalCollaborators})
                          </button>
                          <button
                            type="button"
                            onClick={() => setPeopleFilter("accepted")}
                            className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                              peopleFilter === "accepted"
                                ? "bg-emerald-600 text-white shadow-sm"
                                : "bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800"
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Accepted ({acceptedMembers.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPeopleFilter("pending")}
                            className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                              peopleFilter === "pending"
                                ? "bg-amber-600 text-white shadow-sm"
                                : "bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800"
                            }`}
                          >
                            <Clock className="h-3.5 w-3.5 text-amber-400" />
                            <span>Pending ({pendingInvites.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPeopleFilter("rejected")}
                            className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                              peopleFilter === "rejected"
                                ? "bg-rose-600 text-white shadow-sm"
                                : "bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800"
                            }`}
                          >
                            <XCircle className="h-3.5 w-3.5 text-rose-400" />
                            <span>Rejected ({rejectedInvites.length})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPeopleFilter("expired")}
                            className={`px-3 py-1.5 rounded-xl font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                              peopleFilter === "expired"
                                ? "bg-amber-700 text-white shadow-sm"
                                : "bg-slate-950/60 text-slate-400 hover:text-white border border-slate-800"
                            }`}
                          >
                            <Timer className="h-3.5 w-3.5 text-amber-400" />
                            <span>Expired ({expiredInvites.length})</span>
                          </button>
                        </div>

                        {/* List Content */}
                        {totalCollaborators === 0 ? (
                          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-2xl bg-slate-950/40 border border-slate-800/60 text-center text-slate-400 gap-3 border-dashed">
                            <Users className="h-7 w-7 text-slate-600 stroke-[1.5]" />
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-slate-300">No members or invitations yet</p>
                              <p className="text-[11px] max-w-xs text-slate-500">
                                Send 15-minute invitation links to clients or freelancers to collaborate on designs.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveTab("invite")}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition-all cursor-pointer"
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                              <span>Invite Someone</span>
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* 1. Accepted Members */}
                            {showAccepted &&
                              acceptedMembers.map((member) => {
                                const initials = member.userEmail
                                  ? member.userEmail.slice(0, 2).toUpperCase()
                                  : "ME"
                                const isLoading = actionLoadingId === member.id

                                return (
                                  <div
                                    key={member.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/90 gap-3 hover:border-slate-700 transition-colors"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xs font-bold shadow flex-shrink-0">
                                        {initials}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold text-white truncate max-w-[180px] sm:max-w-xs">
                                            {member.userEmail}
                                          </span>
                                          <span
                                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                                              member.role === "freelancer"
                                                ? "bg-blue-950 text-blue-400 border border-blue-800"
                                                : "bg-purple-950 text-purple-400 border border-purple-800"
                                            }`}
                                          >
                                            {member.role}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                                          <span className="flex items-center gap-1 text-emerald-400 font-medium">
                                            <CheckCircle2 className="h-3 w-3" /> Accepted Member
                                          </span>
                                          <span>•</span>
                                          <span>{member.access === "edit" ? "Can Edit" : "View Only"}</span>
                                          <span>•</span>
                                          <span>{member.canComment ? "Can Comment" : "No Comments"}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Owner Controls */}
                                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleToggleMemberAccess(member)}
                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                                          member.access === "edit"
                                            ? "bg-blue-950/80 border-blue-700 text-blue-300 hover:bg-blue-900"
                                            : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
                                        }`}
                                        title="Toggle between View Only and Can Edit"
                                      >
                                        {member.access === "edit" ? "Edit" : "View"}
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleToggleMemberComment(member)}
                                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                                          member.canComment
                                            ? "bg-emerald-950/80 border-emerald-700 text-emerald-300 hover:bg-emerald-900"
                                            : "bg-slate-900 border-slate-700 text-slate-400 hover:bg-slate-800"
                                        }`}
                                        title="Toggle Client Commenting Permission"
                                      >
                                        {member.canComment ? "Comments On" : "Comments Off"}
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRevokeMember(member.id)}
                                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 hover:border-rose-800 transition-colors cursor-pointer"
                                        title="Revoke Access"
                                        aria-label="Revoke Access"
                                      >
                                        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}

                            {/* 2. Pending Active Invitations (valid within 15 mins) */}
                            {showPending &&
                              pendingInvites.map((invite) => {
                                const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${invite.token}`
                                const isLoading = actionLoadingId === invite.id
                                const timing = getInviteRemainingTime(invite)

                                return (
                                  <div
                                    key={invite.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-amber-950/20 border border-amber-600/30 gap-3 hover:border-amber-500/50 transition-colors"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex-shrink-0">
                                        <Clock className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold text-slate-200 truncate max-w-[180px] sm:max-w-xs">
                                            {invite.inviteeEmail}
                                          </span>
                                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-950 text-amber-400 border border-amber-800">
                                            Pending
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                                          <span className="text-amber-300 font-mono font-medium flex items-center gap-1">
                                            <Timer className="h-3 w-3" /> {timing.label}
                                          </span>
                                          <span>•</span>
                                          <span className="capitalize">{invite.role}</span>
                                          <span>•</span>
                                          <span>{invite.access === "edit" ? "Can Edit" : "View Only"}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Actions for Pending Invite */}
                                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => handleCopyLink(inviteLink)}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-950/60 hover:bg-amber-900 text-amber-200 border border-amber-700/60 transition-colors cursor-pointer"
                                        title="Copy invite link (valid 15 mins)"
                                      >
                                        <Copy className="h-3 w-3" />
                                        <span>Copy Link</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRevokeInvite(invite.id)}
                                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 hover:border-rose-800 transition-colors cursor-pointer"
                                        title="Cancel Invitation"
                                        aria-label="Cancel Invitation"
                                      >
                                        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}

                            {/* 3. Rejected Invitations */}
                            {showRejected &&
                              rejectedInvites.map((invite) => {
                                const isLoading = actionLoadingId === invite.id

                                return (
                                  <div
                                    key={invite.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-rose-950/20 border border-rose-800/40 gap-3 hover:border-rose-700/60 transition-colors"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex-shrink-0">
                                        <XCircle className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold text-slate-300 truncate max-w-[180px] sm:max-w-xs">
                                            {invite.inviteeEmail}
                                          </span>
                                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-950 text-rose-400 border border-rose-800">
                                            Rejected
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                                          <span className="text-rose-400 font-medium">Declined by recipient</span>
                                          <span>•</span>
                                          <span className="capitalize">{invite.role}</span>
                                          <span>•</span>
                                          <span>{invite.access === "edit" ? "Can Edit" : "View Only"}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Actions for Rejected: Re-invite (15m) or Remove */}
                                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRenewInvite(invite)}
                                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-700/60 transition-colors cursor-pointer"
                                        title="Send a fresh 15-minute invitation link"
                                      >
                                        {isLoading ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RotateCcw className="h-3 w-3" />
                                        )}
                                        <span>Re-invite (15m)</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRevokeInvite(invite.id)}
                                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 hover:border-rose-800 transition-colors cursor-pointer"
                                        title="Remove Record"
                                        aria-label="Remove Record"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}

                            {/* 4. Expired Invitations (15 mins elapsed) */}
                            {showExpired &&
                              expiredInvites.map((invite) => {
                                const isLoading = actionLoadingId === invite.id

                                return (
                                  <div
                                    key={invite.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-slate-950/50 border border-slate-800/80 gap-3 hover:border-slate-700 transition-colors"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800/80 text-amber-400 border border-amber-500/20 flex-shrink-0">
                                        <AlertCircle className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-semibold text-slate-300 truncate max-w-[180px] sm:max-w-xs">
                                            {invite.inviteeEmail}
                                          </span>
                                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-900 text-amber-400 border border-amber-900/60">
                                            Expired (15m)
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                                          <span className="text-amber-400/80">15-minute window elapsed</span>
                                          <span>•</span>
                                          <span className="capitalize">{invite.role}</span>
                                          <span>•</span>
                                          <span>{invite.access === "edit" ? "Can Edit" : "View Only"}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Actions for Expired: Renew Link (15m) or Remove */}
                                    <div className="flex items-center gap-1.5 self-end sm:self-center flex-shrink-0">
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRenewInvite(invite)}
                                        className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow transition-colors cursor-pointer"
                                        title="Renew this link with a fresh 15-minute token"
                                      >
                                        {isLoading ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RotateCcw className="h-3 w-3" />
                                        )}
                                        <span>Renew Link (15m)</span>
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLoading}
                                        onClick={() => handleRevokeInvite(invite.id)}
                                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 hover:border-rose-800 transition-colors cursor-pointer"
                                        title="Delete Expired Link"
                                        aria-label="Delete Expired Link"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
