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
  Shield,
  ShieldCheck,
  Eye,
  Lock,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  X,
  Pencil,
  Check,
} from "lucide-react"
import { useState, useEffect, useRef } from "react"
import type { Project, Workflow } from "@/lib/design-review-types"
import { createClient } from "@/lib/supabase/client"

type WorkflowEditorProps = {
  project: Project
  workflow: Workflow
  isOwner?: boolean
  canEdit?: boolean
  canComment?: boolean
  canApprove?: boolean
  userRole?: "client" | "freelancer" | "owner" | null
  inviteeEmail?: string | null
  onUpdateField: (field: keyof Workflow, value: string | boolean | null) => void
  onSubmitRevision?: (workflowId: string, reason: string) => Promise<void>
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
  isSelected?: boolean
  onSelect?: () => void
  onPreview?: (src: string, title: string) => void
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
  isSelected,
  onSelect,
  onPreview,
  onUpload,
  onDelete,
  isUploading,
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadText =
    type === "design" ? "Figma Export" : "App Screenshot"

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile()
        if (file) {
          e.preventDefault()
          onUpload(file)
        }
        break
      }
    }
  }

  const handleClipboardButtonClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect?.()
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read()
        for (const item of items) {
          for (const itemType of item.types) {
            if (itemType.startsWith("image/")) {
              const blob = await item.getType(itemType)
              const file = new File([blob], `clipboard-${Date.now()}.${itemType.split("/")[1] || "png"}`, {
                type: itemType,
              })
              onUpload(file)
              return
            }
          }
        }
      }
      alert("No image found on your clipboard. Copy an image or screenshot first, then press Ctrl+V to paste.")
    } catch {
      alert("Please press Ctrl+V (or Cmd+V on Mac) to paste your copied image.")
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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onPreview?.(image, title)}
                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Preview
              </button>
            </div>
          )}
        </div>
        <div
          onDoubleClick={() => image && onPreview?.(image, title)}
          className="relative flex h-80 flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 overflow-hidden p-2 cursor-pointer group"
          title={image ? "Double-click to open full image preview" : ""}
        >
          {image ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt={title} className="h-full w-full object-contain drop-shadow-sm group-hover:scale-[1.01] transition-transform" />
              <div className="absolute bottom-2.5 right-2.5 bg-black/65 text-white text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none flex items-center gap-1">
                <Maximize2 className="h-3 w-3" /> Double-click to open
              </div>
            </>
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
          {type === "reference" ? (
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full">
              Client Reference
            </span>
          ) : (
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
              Figma Design
            </span>
          )}
        </div>
        {image && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onPreview?.(image, title)}
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium cursor-pointer"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Preview
            </button>
            <button
              type="button"
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

      <div
        tabIndex={0}
        onClick={() => onSelect?.()}
        onDoubleClick={(e) => {
          if (image) {
            e.stopPropagation()
            onPreview?.(image, title)
          }
        }}
        onPaste={handlePaste}
        title={image ? "Double-click to open full image preview" : ""}
        className={`relative flex h-80 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all overflow-hidden group outline-none ${
          isSelected
            ? "border-blue-500 dark:border-blue-400 ring-4 ring-blue-500/20 bg-blue-50/30 dark:bg-blue-950/30 shadow-md shadow-blue-500/10"
            : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-900/60 hover:bg-slate-100/80 dark:hover:bg-slate-850"
        }`}
      >
        {/* Selection Indicator Banner */}
        {isSelected && (
          <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-full bg-blue-600 text-white px-2.5 py-0.5 text-[11px] font-semibold shadow-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span>Selected • Press Ctrl+V to paste</span>
          </div>
        )}

        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */
            <img src={image} alt={title} className="h-full w-full object-contain p-2 drop-shadow-sm group-hover:scale-[1.01] transition-transform" />}

            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  fileInputRef.current?.click()
                }}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-white/95 hover:bg-white text-slate-900 shadow-lg backdrop-blur-sm transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-blue-600" />
                <span>Choose file</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-transform ${
              isSelected ? "bg-blue-600 text-white scale-110 shadow-lg shadow-blue-500/25" : "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 group-hover:scale-105"
            }`}>
              <Upload className="h-6 w-6 stroke-[2.2]" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {isUploading ? "Uploading image..." : isSelected ? "Ready to paste!" : `Select ${uploadText}`}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[220px]">
                {isSelected
                  ? "Press Ctrl+V (or Cmd+V) to paste from clipboard"
                  : "Click to select, then press Ctrl+V to paste"}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={handleClipboardButtonClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition-all active:scale-95 cursor-pointer"
              >
                <span>Paste</span>
                <span className="text-[10px] opacity-75 font-mono">(Ctrl+V)</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-all active:scale-95 cursor-pointer"
              >
                <span>Browse file</span>
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          id={id}
          accept="image/*"
          className="hidden"
          disabled={isUploading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}

export function WorkflowEditor({
  project,
  workflow,
  isOwner = true,
  canEdit = true,
  canComment = true,
  canApprove = false,
  userRole = "owner",
  inviteeEmail,
  onUpdateField,
  onSubmitRevision,
  onShowReport,
  onAddComment,
}: WorkflowEditorProps) {
  const supabase = createClient()
  const effectiveCanEdit = canEdit ?? isOwner
  const effectiveCanComment = canComment ?? true
  const effectiveCanApprove = canApprove ?? isOwner

  const [uploadingA, setUploadingA] = useState(false)
  const [uploadingB, setUploadingB] = useState(false)
  const [submittedNotes, setSubmittedNotes] = useState(false)
  const [submittedReason, setSubmittedReason] = useState(false)
  const [submittedClientMessage, setSubmittedClientMessage] = useState(false)
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false)

  // Local drafts to avoid text being wiped out by realtime sync or race conditions
  const [notesDraft, setNotesDraft] = useState(workflow.ourNotes || "")
  const [reasonDraft, setReasonDraft] = useState(workflow.reason || "")
  const [clientMessageDraft, setClientMessageDraft] = useState(workflow.clientMessage || "")
  const [selectedSlot, setSelectedSlot] = useState<"designA" | "designB">("designA")
  const [lightboxImage, setLightboxImage] = useState<{ src: string; title: string } | null>(null)

  // Direct title inline editing
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [tempTitle, setTempTitle] = useState(workflow.title)

  const prevWorkflowIdRef = useRef(workflow.id)

  useEffect(() => {
    setTempTitle(workflow.title)
  }, [workflow.title])

  useEffect(() => {
    if (prevWorkflowIdRef.current !== workflow.id) {
      prevWorkflowIdRef.current = workflow.id
      setNotesDraft(workflow.ourNotes || "")
      setReasonDraft(workflow.reason || "")
      setClientMessageDraft(workflow.clientMessage || "")
      setTempTitle(workflow.title)
      setIsEditingTitle(false)
    }
  }, [workflow.id, workflow.ourNotes, workflow.reason, workflow.clientMessage, workflow.title])

  const handleSubmitNotes = () => {
    onUpdateField("ourNotes", notesDraft)
    setSubmittedNotes(true)
    setTimeout(() => setSubmittedNotes(false), 2500)
  }

  const handleSubmitReason = async () => {
    if (onSubmitRevision) {
      setIsSubmittingRevision(true)
      try {
        await onSubmitRevision(workflow.id, reasonDraft)
        setSubmittedReason(true)
        setTimeout(() => setSubmittedReason(false), 2500)
      } finally {
        setIsSubmittingRevision(false)
      }
    } else {
      onUpdateField("reason", reasonDraft)
      setSubmittedReason(true)
      setTimeout(() => setSubmittedReason(false), 2500)
    }
  }

  const handleSubmitClientMessage = () => {
    if (!effectiveCanComment) {
      alert(`Client commenting is disabled for your account.`)
      return
    }
    onUpdateField("clientMessage", clientMessageDraft)
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

  // Global paste handler when dropzone is selected or active
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return
      }

      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile()
          if (file) {
            e.preventDefault()
            const targetSlot = selectedSlot || (workflow.designA ? "designB" : "designA")
            handleImageUpload(targetSlot, file)
            break
          }
        }
      }
    }

    window.addEventListener("paste", handleGlobalPaste)
    return () => {
      window.removeEventListener("paste", handleGlobalPaste)
    }
  }, [selectedSlot, workflow.designA, workflow.designB, workflow.id])

  return (
    <div className="p-8 mx-auto max-w-6xl pb-20 flex flex-col gap-8 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between pb-6 border-b border-slate-200 dark:border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
            <FolderKanban className="h-4 w-4" />
            {project.title}
            <ChevronRight className="h-3 w-3 text-slate-400" />
            <span
              onDoubleClick={() => {
                if (effectiveCanEdit) {
                  setTempTitle(workflow.title)
                  setIsEditingTitle(true)
                }
              }}
              title={effectiveCanEdit ? "Double-click to rename screen" : undefined}
              className="text-slate-500 dark:text-slate-400 cursor-pointer select-none"
            >
              {workflow.title}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {isEditingTitle && effectiveCanEdit ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tempTitle}
                  autoFocus
                  onChange={(e) => setTempTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const clean = tempTitle.trim()
                      if (clean && clean !== workflow.title) {
                        onUpdateField("title", clean)
                      }
                      setIsEditingTitle(false)
                    } else if (e.key === "Escape") {
                      setTempTitle(workflow.title)
                      setIsEditingTitle(false)
                    }
                  }}
                  onBlur={() => {
                    const clean = tempTitle.trim()
                    if (clean && clean !== workflow.title) {
                      onUpdateField("title", clean)
                    }
                    setIsEditingTitle(false)
                  }}
                  className="text-2xl sm:text-3xl font-bold bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-3 py-1 rounded-xl border border-blue-500 outline-none shadow-sm focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = tempTitle.trim()
                    if (clean && clean !== workflow.title) {
                      onUpdateField("title", clean)
                    }
                    setIsEditingTitle(false)
                  }}
                  className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-sm transition-colors"
                  title="Save screen name"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 group">
                <h1
                  onDoubleClick={() => {
                    if (effectiveCanEdit) {
                      setTempTitle(workflow.title)
                      setIsEditingTitle(true)
                    }
                  }}
                  title={effectiveCanEdit ? "Double-click to rename screen" : undefined}
                  className="text-3xl font-bold text-slate-900 dark:text-white cursor-pointer select-none"
                >
                  {workflow.title}
                </h1>
                {effectiveCanEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setTempTitle(workflow.title)
                      setIsEditingTitle(true)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                    title="Rename screen"
                    aria-label="Rename screen"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {isOwner ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-950/80 px-3 py-1 text-xs font-semibold text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                <ShieldCheck className="h-3.5 w-3.5" /> Project Owner
              </span>
            ) : userRole === "freelancer" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 dark:bg-indigo-950/80 px-3 py-1 text-xs font-semibold text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                <Shield className="h-3.5 w-3.5" /> Freelancer (Revisions &amp; Notes)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 dark:bg-purple-950/80 px-3 py-1 text-xs font-semibold text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                <Eye className="h-3.5 w-3.5" /> Client ({effectiveCanEdit ? "Can Edit" : "View Only"} • {effectiveCanComment ? "Can Comment" : "No Comments"})
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {effectiveCanEdit && (
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
          isOwner={effectiveCanEdit}
          isSelected={selectedSlot === "designA"}
          onSelect={() => setSelectedSlot("designA")}
          onPreview={(src, title) => setLightboxImage({ src, title })}
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
          isOwner={effectiveCanEdit}
          isSelected={selectedSlot === "designB"}
          onSelect={() => setSelectedSlot("designB")}
          onPreview={(src, title) => setLightboxImage({ src, title })}
          isUploading={uploadingB}
          onUpload={(file) => handleImageUpload("designB", file)}
          onDelete={() => onUpdateField("designB", null)}
        />
      </div>

      {/* Notes & Client Message */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Our Internal Notes (Developer / Freelancer) */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm flex flex-col transition-colors">
          <div className="mb-4 flex items-center justify-between text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold text-lg text-slate-900 dark:text-white">
                {userRole === "freelancer" ? "Freelancer Notes" : "Developer Notes"}
              </h3>
            </div>
            {!effectiveCanEdit && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full">
                Read-only
              </span>
            )}
          </div>
          {effectiveCanEdit ? (
            <>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => onUpdateField("ourNotes", notesDraft)}
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
                disabled={!effectiveCanApprove}
                onClick={() => {
                  if (!effectiveCanApprove) {
                    alert(`Approval permissions are restricted. You do not have permission to accept or verify.`)
                    return
                  }
                  onUpdateField("clientTaskDone", !workflow.clientTaskDone)
                }}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
                  !effectiveCanApprove
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-70"
                    : workflow.clientTaskDone
                      ? "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                      : "bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 border border-purple-300 dark:border-purple-800"
                }`}
              >
                {workflow.clientTaskDone ? <CheckCircle className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                <span>{workflow.clientTaskDone ? "Accepted & Verified" : "Accept & Verify"}</span>
              </button>
            </div>
          </div>

          {userRole === "client" ? (
            <>
              {!effectiveCanComment && (
                <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <Lock className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    Client commenting is disabled for your account. You can view the project in presentation mode.
                  </span>
                </div>
              )}
              <textarea
                value={clientMessageDraft}
                disabled={!effectiveCanComment}
                onChange={(e) => setClientMessageDraft(e.target.value)}
                onBlur={() => onUpdateField("clientMessage", clientMessageDraft)}
                className={`flex-1 min-h-[140px] w-full resize-none rounded-lg border p-4 text-sm transition-colors ${
                  !effectiveCanComment
                    ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                    : "border-purple-200 dark:border-purple-800/80 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                }`}
                placeholder={
                  !effectiveCanComment
                    ? "Client commenting is disabled."
                    : "Type your feedback, requested changes, or questions here..."
                }
              />
              {effectiveCanComment && (
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
              )}
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

      {/* Reason for Final Changes & Revision Submission */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm transition-colors space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <h3 className="font-semibold text-lg text-slate-900 dark:text-white">Reason for Final Changes</h3>
          </div>
          <span className="text-xs text-amber-700 dark:text-amber-300 font-medium bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2.5 py-0.5 rounded-full">
            {userRole === "freelancer" ? "Freelancer Submission" : "Developer Explanation"}
          </span>
        </div>

        {effectiveCanEdit ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Provide a mandatory explanation for this revision explaining what was adjusted in response to client feedback:
            </p>
            <textarea
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              onBlur={() => onUpdateField("reason", reasonDraft)}
              className="h-28 w-full resize-none rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              placeholder="e.g., Updated the spacing, corrected the typography, and fixed the mobile layout..."
            />
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                {submittedReason ? "✓ Revision submitted to client!" : "Click submit to record revision"}
              </span>
              <button
                type="button"
                disabled={isSubmittingRevision || !reasonDraft.trim()}
                onClick={handleSubmitReason}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50 ${
                  submittedReason
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-amber-600 text-white hover:bg-amber-700"
                }`}
              >
                {submittedReason ? (
                  <>
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Revision Submitted!</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Submit Revision &amp; Reason</span>
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

        {/* Revision History Log */}
        {workflow.revisions && workflow.revisions.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Revision History Log</h4>
            <div className="space-y-2">
              {workflow.revisions.map((rev) => (
                <div
                  key={rev.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      Revision {rev.revisionNumber}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(rev.createdAt).toLocaleDateString()} at {new Date(rev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">Reason:</span> {rev.reason}
                  </p>
                  <div className="text-[10px] text-slate-400 pt-0.5">
                    Changes submitted by: <span className="capitalize font-medium text-slate-300">{rev.authorRole}</span> {rev.authorEmail ? `(${rev.authorEmail})` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Double Click Image Lightbox Modal */}
      {lightboxImage && (
        <ImageLightboxModal
          src={lightboxImage.src}
          title={lightboxImage.title}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}

function ImageLightboxModal({
  src,
  title,
  onClose,
}: {
  src: string
  title: string
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3))
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.5))
  const handleResetZoom = () => setZoom(1)

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-4 sm:p-6 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Top Bar */}
      <div
        className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-base sm:text-lg tracking-wide drop-shadow">{title}</span>
          <span className="text-xs text-white/60 bg-white/10 px-2.5 py-1 rounded-full border border-white/10">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {/* Floating Controls */}
        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-2xl shadow-xl">
          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer"
            title="Reset Zoom"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 hover:bg-white/20 rounded-lg transition text-white cursor-pointer flex items-center gap-1 text-xs"
            title="Open Full Image in New Tab"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <div className="h-4 w-[1px] bg-white/20 mx-0.5" />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-red-500/80 rounded-lg transition text-white cursor-pointer"
            title="Close Preview (ESC)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Image Preview Container */}
      <div
        className="relative flex-1 w-full flex items-center justify-center overflow-auto p-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title}
          style={{ transform: `scale(${zoom})`, transition: "transform 0.15s ease-out" }}
          className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl origin-center select-none cursor-grab active:cursor-grabbing"
          onDoubleClick={handleResetZoom}
        />
      </div>

      <div className="absolute bottom-4 text-xs text-white/50 text-center pointer-events-none">
        Double click inside image to reset zoom • Press ESC or click outside to close
      </div>
    </div>
  )
}