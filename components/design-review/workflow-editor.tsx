"use client"

import {
  Upload,
  CheckCircle,
  Circle,
  FileText,
  MessageSquare,
  AlertCircle,
  FolderKanban,
  ChevronRight,
  CheckSquare,
  ExternalLink,
  Send,
  User,
  ShieldCheck,
  Eye,
} from "lucide-react"
import { useState } from "react"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"

type WorkflowEditorProps = {
  project: Project
  workflow: Workflow
  isOwner: boolean
  onUpdateField: (field: keyof Workflow, value: string | boolean | null) => void
  onShowReport: () => void
  onAddComment?: (body: string, reason?: string) => void
}

type ImageUploadProps = {
  title: string
  image: string | null
  id: string
  type: "design" | "reference"
  workflowId: string
  isOwner: boolean
  onUpload: (file: File) => void
  onDelete: () => void
  isUploading?: boolean
}

function ImageUpload({
  title,
  image,
  id,
  type,
  workflowId,
  isOwner,
  onUpload,
  onDelete,
  isUploading,
}: ImageUploadProps) {
  const uploadText =
    type === "design" ? "Click to upload Figma export" : "Click to upload design reference"

  const handlePaste = (e: React.ClipboardEvent<HTMLLabelElement>) => {
    e.preventDefault()
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile()
        if (file) onUpload(file)
        break
      }
    }
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
              Read-only
            </span>
          </div>
          {image && (
            <a
              href={image}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View full
            </a>
          )}
        </div>
        <div className="relative flex h-80 flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 overflow-hidden p-2">
          {image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={image} alt={title} className="h-full w-full object-contain drop-shadow-sm" />
          ) : (
            <div className="flex flex-col items-center text-slate-400 dark:text-slate-500">
              <span className="text-sm font-medium">No image uploaded yet</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
          {type === "reference" && (
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full">
              Client Reference
            </span>
          )}
        </div>
        {image && (
          <div className="flex items-center gap-3">
            <a
              href={image}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View full
            </a>
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete()
              }}
              className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 font-medium cursor-pointer"
            >
              Remove photo
            </button>
          </div>
        )}
      </div>
      <label
        htmlFor={id}
        onPaste={handlePaste}
        className="relative flex h-80 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 transition-colors hover:bg-slate-100 dark:hover:bg-slate-850 overflow-hidden group"
      >
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={title} className="h-full w-full object-contain p-2 drop-shadow-sm" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white font-medium bg-black/60 px-4 py-2 rounded-lg backdrop-blur-sm">
                {isUploading ? "Uploading..." : "Click to change"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-slate-400 dark:text-slate-500">
            <Upload className="mb-2 h-8 w-8 text-slate-400 dark:text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">{isUploading ? "Uploading..." : uploadText}</span>
            <span className="text-xs mt-2 text-slate-400 dark:text-slate-600">or paste an image</span>
          </div>
        )}
        <input
          type="file"
          id={id}
          accept="image/*"
          className="hidden"
          disabled={isUploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
          }}
        />
      </label>
    </div>
  )
}

export function WorkflowEditor({
  project,
  workflow,
  isOwner,
  onUpdateField,
  onShowReport,
  onAddComment,
}: WorkflowEditorProps) {
  const supabase = createClient()
  const [uploadingA, setUploadingA] = useState(false)
  const [uploadingB, setUploadingB] = useState(false)
  const [submittedNotes, setSubmittedNotes] = useState(false)
  const [submittedReason, setSubmittedReason] = useState(false)
  const [submittedClientMessage, setSubmittedClientMessage] = useState(false)

  const handleSubmitNotes = () => {
    onUpdateField("ourNotes", workflow.ourNotes)
    setSubmittedNotes(true)
    setTimeout(() => setSubmittedNotes(false), 2500)
  }

  const handleSubmitReason = () => {
    onUpdateField("reason", workflow.reason)
    setSubmittedReason(true)
    setTimeout(() => setSubmittedReason(false), 2500)
  }

  const handleSubmitClientMessage = () => {
    onUpdateField("clientMessage", workflow.clientMessage)
    setSubmittedClientMessage(true)
    setTimeout(() => setSubmittedClientMessage(false), 2500)
  }

  const handleImageUpload = async (field: "designA" | "designB", file: File) => {
    const setUploading = field === "designA" ? setUploadingA : setUploadingB
    setUploading(true)

    try {
      if (!file) {
        setUploading(false)
        return
      }

      const fileExt = file.name.split(".").pop()?.toLowerCase() || "jpg"
      const fileName = `${workflow.id}-${field}-${Date.now()}.${fileExt}`
      const filePath = `workflows/${workflow.id}/${fileName}`

      const { error: uploadError } = await supabase.storage.from("designs").upload(filePath, file, { upsert: true })

      if (uploadError) {
        console.error("Upload error:", uploadError)
        const msg = uploadError.message || ""
        if (msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("rls")) {
          alert(
            "Storage RLS Error: Row Level Security policy blocked the upload.\n\n" +
            "Please run 'npm run setup-storage' in your project terminal, or run supabase/migrations/add_storage_rls_policies.sql in your Supabase SQL Editor."
          )
        } else {
          alert(`Error uploading image: ${uploadError.message}`)
        }
        setUploading(false)
        return
      }

      const { data } = supabase.storage.from("designs").getPublicUrl(filePath)
      const publicUrl = data.publicUrl

      onUpdateField(field, publicUrl)
      setUploading(false)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to upload image"
      console.error("Error uploading image:", err)
      alert(`Error: ${errorMsg}`)
      setUploading(false)
    }
  }

  return (
    <div className="p-8 mx-auto max-w-6xl pb-20 flex flex-col gap-8 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between pb-6 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
            <FolderKanban className="h-4 w-4" />
            {project.title}
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <span className="text-slate-500 dark:text-slate-400">{workflow.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{workflow.title}</h1>
            {isOwner ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-950/80 px-3 py-1 text-xs font-semibold text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Team (Our Notes)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 dark:bg-purple-950/80 px-3 py-1 text-xs font-semibold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                <Eye className="h-3.5 w-3.5" /> Client Review (Comment &amp; Verify)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isOwner && (
            <button
              onClick={() => onUpdateField("isDone", !workflow.isDone)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all shadow-sm cursor-pointer ${
                workflow.isDone
                  ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700"
                  : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800"
              }`}
            >
              <CheckSquare className="h-4 w-4" />
              {workflow.isDone ? "Reopen Workflow" : "Complete Workflow"}
            </button>
          )}

          {/* Presentation Button - Always accessible to both Team and Client */}
          <button
            onClick={onShowReport}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 hover:shadow transition-all cursor-pointer"
          >
            <FileText className="h-4 w-4" />
            View Presentation
          </button>
        </div>
      </div>

      {/* Images */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ImageUpload
          title="Figma"
          image={workflow.designA}
          id={`upload-a-${workflow.id}`}
          type="design"
          workflowId={workflow.id}
          isOwner={isOwner}
          isUploading={uploadingA}
          onUpload={(file) => handleImageUpload("designA", file)}
          onDelete={() => onUpdateField("designA", null)}
        />
        <ImageUpload
          title="App Screenshot"
          image={workflow.designB}
          id={`upload-b-${workflow.id}`}
          type="reference"
          workflowId={workflow.id}
          isOwner={isOwner}
          isUploading={uploadingB}
          onUpload={(file) => handleImageUpload("designB", file)}
          onDelete={() => onUpdateField("designB", null)}
        />
      </div>

      {/* Notes & Client Message */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Our Internal Notes (Developer) */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col transition-colors">
          <div className="mb-4 flex items-center justify-between text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Our Notes (Developer)</h3>
            </div>
            {!isOwner && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
                Read-only
              </span>
            )}
          </div>
          {isOwner ? (
            <>
              <textarea
                value={workflow.ourNotes}
                onChange={(e) => onUpdateField("ourNotes", e.target.value)}
                className="flex-1 min-h-[160px] w-full resize-none rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Developer notes about the design structure, constraints, or UX decisions..."
              />
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  {submittedNotes ? "✓ Notes submitted!" : "Click submit to save notes"}
                </span>
                <button
                  type="button"
                  onClick={handleSubmitNotes}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                    submittedNotes
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                  }`}
                >
                  {submittedNotes ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Submitted!</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>Submit Notes</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-[160px] w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
              {workflow.ourNotes || <span className="text-slate-400 dark:text-slate-600 italic">No developer notes provided.</span>}
            </div>
          )}
        </div>

        {/* Client's Message / Feedback */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col transition-colors">
          <div className="mb-4 flex items-center justify-between text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-purple-500" />
              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Client&apos;s Message</h3>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && (
                <span className="text-xs text-purple-700 dark:text-purple-300 font-medium bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2.5 py-0.5 rounded-full">
                  From Client
                </span>
              )}
              <button
                type="button"
                onClick={() => onUpdateField("clientTaskDone", !workflow.clientTaskDone)}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                  workflow.clientTaskDone
                    ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                    : "bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-300 dark:border-purple-800"
                }`}
              >
                {workflow.clientTaskDone ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                <span>{workflow.clientTaskDone ? "Accepted & Verified" : "Accept & Verify"}</span>
              </button>
            </div>
          </div>

          {!isOwner ? (
            <>
              <textarea
                value={workflow.clientMessage || ""}
                onChange={(e) => onUpdateField("clientMessage", e.target.value)}
                className="flex-1 min-h-[140px] w-full resize-none rounded-lg border border-purple-200 dark:border-purple-800/80 bg-white dark:bg-slate-950 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                placeholder="Type your feedback, requested changes, or questions here..."
              />
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {submittedClientMessage
                    ? "✓ Feedback submitted to developer!"
                    : "Submit your comments to the team"}
                </span>
                <button
                  type="button"
                  onClick={handleSubmitClientMessage}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                    submittedClientMessage
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-purple-600 text-white hover:bg-purple-700"
                  }`}
                >
                  {submittedClientMessage ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Submitted!</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>Submit Feedback</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-[160px] w-full rounded-xl border border-purple-200/80 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 p-4 text-sm text-slate-800 dark:text-slate-200 leading-relaxed flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-400 font-semibold">
                  <User className="h-3.5 w-3.5" />
                  <span>Message sent by Client:</span>
                </div>
                <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap pl-1">
                  {workflow.clientMessage || (
                    <span className="text-slate-400 dark:text-slate-600 italic">No message sent by client yet.</span>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Reason for Final Changes (Developer gives why this changed) */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Reason for Final Changes</h3>
          </div>
          <span className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2.5 py-0.5 rounded-full">
            Developer Explanation
          </span>
        </div>
        {isOwner ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
              Developer explains why these specific changes were made in response to client feedback or requirements:
            </p>
            <textarea
              value={workflow.reason}
              onChange={(e) => onUpdateField("reason", e.target.value)}
              className="h-28 w-full resize-none rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              placeholder="e.g., Modified checkout layout, adjusted button contrast, and aligned with client's new design reference..."
            />
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                {submittedReason ? "✓ Reason submitted!" : "Click submit to save reason"}
              </span>
              <button
                type="button"
                onClick={handleSubmitReason}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                  submittedReason
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-amber-600 text-white hover:bg-amber-700"
                }`}
              >
                {submittedReason ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Submitted!</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Submit Reason</span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="w-full rounded-lg border border-amber-100 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 p-4 text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
            {workflow.reason || <span className="text-slate-400 dark:text-slate-600 italic">No reason provided by developer yet.</span>}
          </div>
        )}
      </div>
    </div>
  )
}