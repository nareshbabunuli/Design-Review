export type WorkflowComment = {
  id: string
  workflowId: string
  authorId: string
  authorEmail?: string
  reason?: string
  body: string
  createdAt: string
}

export type WorkflowRevision = {
  id: string
  workflowId: string
  revisionNumber: number
  authorId?: string
  authorEmail?: string
  authorRole: "client" | "freelancer" | "owner"
  reason: string
  designA?: string | null
  designB?: string | null
  createdAt: string
}

export type Workflow = {
  id: string
  projectId?: string
  title: string
  designA: string | null
  designB: string | null
  figmaUrl?: string | null
  ourNotes: string
  clientMessage: string
  clientTaskDone: boolean
  reason: string
  isDone: boolean
  comments: WorkflowComment[]
  revisions?: WorkflowRevision[]
}

export type Project = {
  id: string
  title: string
  isExpanded: boolean
  userId?: string
  figmaUrl?: string | null
  workflowOrder?: string[] | null
  isOrderLocked?: boolean
  workflows: Workflow[]
}

export type EditingId = string | null

export type MemberRole = "client" | "freelancer" | "owner"
export type AccessPermission = "view" | "edit"

export type ProjectMember = {
  id: string
  userId: string
  userEmail?: string
  role: MemberRole
  access: AccessPermission
  canComment: boolean
  canApprove: boolean
  createdAt: string
}

export type ProjectInvite = {
  id: string
  inviteeEmail: string
  token: string
  role: MemberRole
  access: AccessPermission
  canComment: boolean
  canApprove: boolean
  status: "pending" | "accepted" | "rejected" | "revoked" | "expired"
  createdAt: string
  expiresAt?: string
}

export type UserPermissions = {
  authenticated: boolean
  isOwner: boolean
  role: MemberRole | null
  access: AccessPermission | null
  canComment: boolean
  canApprove: boolean
}