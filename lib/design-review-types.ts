export type WorkflowComment = {
  id: string
  workflowId: string
  authorId: string
  authorEmail?: string
  reason?: string
  body: string
  createdAt: string
}

export type Workflow = {
  id: string
  projectId?: string
  title: string
  designA: string | null
  designB: string | null
  ourNotes: string
  clientMessage: string
  clientTaskDone: boolean
  reason: string
  isDone: boolean
  comments: WorkflowComment[]
}

export type Project = {
  id: string
  title: string
  isExpanded: boolean
  userId?: string
  workflows: Workflow[]
}

export type EditingId = string | null