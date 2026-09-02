"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  CheckCircle,
  FileText,
  MessageSquare,
  AlertCircle,
  FolderKanban,
  X,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Eye,
  User,
  Send,
  Check,
  LogOut,
  ShieldCheck,
  Lock,
  Clock,
  PenTool,
  CheckCircle2,
  Calendar,
  Link2,
} from "lucide-react"
import type { Project, Workflow } from "@/lib/design-review-types"
import { ThemeToggle } from "./theme-toggle"

type ReportModalProps = {
  project: Project
  isOwner?: boolean
  canEdit?: boolean
  isViewerOnly?: boolean
  canComment?: boolean
  canApprove?: boolean
  userRole?: "client" | "freelancer" | "owner" | null
  inviteeEmail?: string | null
  user?: { id: string; email?: string } | null
  theme?: "light" | "dark"
  onToggleTheme?: () => void
  onLogout?: () => void
  onClose?: () => void
  onUpdateWorkflowField?: (
    workflowId: string,
    field: "ourNotes" | "clientMessage" | "clientTaskDone" | "reason",
    value: string | boolean | null
  ) => void
  onSubmitRevision?: (workflowId: string, reason: string) => Promise<void>
}

type LightboxState = {
  src: string
  title: string
  workflowTitle: string
  workflowIndex: number
  type: "designA" | "designB"
}

// Helper to extract Figma URLs from workflow texts and design assets
export function extractFigmaUrls(workflow: Workflow): string[] {
  const urls: string[] = []
  const urlRegex = /https?:\/\/(?:www\.)?figma\.com\/[^\s"')]+/gi

  if (workflow.designA) {
    const matches = workflow.designA.match(urlRegex)
    if (matches) urls.push(...matches)
    else if (workflow.designA.includes("figma.com")) urls.push(workflow.designA)
  }
  if (workflow.ourNotes) {
    const matches = workflow.ourNotes.match(urlRegex)
    if (matches) urls.push(...matches)
  }
  if (workflow.clientMessage) {
    const matches = workflow.clientMessage.match(urlRegex)
    if (matches) urls.push(...matches)
  }
  if (workflow.reason) {
    const matches = workflow.reason.match(urlRegex)
    if (matches) urls.push(...matches)
  }

  return Array.from(new Set(urls))
}

export function ReportModal({
  project,
  isOwner = false,
  canEdit,
  isViewerOnly = false,
  canComment = true,
  canApprove,
  userRole = "client",
  inviteeEmail,
  user = null,
  theme = "dark",
  onToggleTheme,
  onLogout,
  onClose,
  onUpdateWorkflowField,
  onSubmitRevision,
}: ReportModalProps) {
  const effectiveCanEdit = canEdit ?? isOwner
  const effectiveCanComment = canComment ?? true
  const effectiveCanApprove = canApprove ?? isOwner

  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [zoom, setZoom] = useState<number>(1)
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({})
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({})
  const [clientMessageDrafts, setClientMessageDrafts] = useState<Record<string, string>>({})
  const [submittedNotesId, setSubmittedNotesId] = useState<string | null>(null)
  const [submittedReasonId, setSubmittedReasonId] = useState<string | null>(null)
  const [submittedClientMessageId, setSubmittedClientMessageId] = useState<string | null>(null)

  // Executive Metrics
  const totalWorkflows = project.workflows.length
  const verifiedWorkflows = project.workflows.filter((w) => Boolean(w.clientTaskDone))
  const notVerifiedWorkflows = project.workflows.filter((w) => !w.clientTaskDone)
  const verifiedCount = verifiedWorkflows.length
  const notVerifiedCount = notVerifiedWorkflows.length
  const verificationRate = totalWorkflows > 0 ? Math.round((verifiedCount / totalWorkflows) * 100) : 0

  // Count workflows with Figma assets / URLs
  const figmaWorkflows = project.workflows.filter((w) => {
    if (w.designA) return true
    const combined = `${w.ourNotes || ""} ${w.clientMessage || ""} ${w.reason || ""}`
    return combined.includes("figma.com") || combined.includes("figma")
  })
  const figmaCount = figmaWorkflows.length

  // Count workflows with documented Reason of Changes
  const reasonWorkflows = project.workflows.filter(
    (w) => Boolean(w.reason && w.reason.trim()) || (w.revisions && w.revisions.length > 0)
  )
  const reasonCount = reasonWorkflows.length

  // Digital Signature State
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [signerName, setSignerName] = useState<string>("")
  const [signerTitle, setSignerTitle] = useState<string>("Client Representative")
  const [signatureDate, setSignatureDate] = useState<string>("")
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw")
  const [typedSignature, setTypedSignature] = useState<string>("")
  const [signatureImage, setSignatureImage] = useState<string>("")
  const [isSigned, setIsSigned] = useState<boolean>(false)
  const [isDrawing, setIsDrawing] = useState<boolean>(false)

  // Initialize signature from localStorage or user context
  useEffect(() => {
    try {
      const savedName = localStorage.getItem(`sig_name_${project.id}`) || user?.email || ""
      const savedTitle =
        localStorage.getItem(`sig_title_${project.id}`) ||
        (isOwner ? "Project Owner" : "Client Representative")
      const savedDate =
        localStorage.getItem(`sig_date_${project.id}`) ||
        new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      const savedImg = localStorage.getItem(`sig_img_${project.id}`) || ""
      const savedTyped = localStorage.getItem(`sig_typed_${project.id}`) || ""
      const savedMode = (localStorage.getItem(`sig_mode_${project.id}`) as "draw" | "type") || "draw"
      const savedSigned = localStorage.getItem(`sig_done_${project.id}`) === "true"

      setSignerName(savedName)
      setSignerTitle(savedTitle)
      setSignatureDate(savedDate)
      setSignatureImage(savedImg)
      setTypedSignature(savedTyped)
      setSignatureMode(savedMode)
      setIsSigned(savedSigned)
    } catch (e) {
      setSignerName(user?.email || "")
      setSignatureDate(
        new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      )
    }
  }, [project.id, user, isOwner])

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    ctx.beginPath()
    ctx.moveTo(clientX - rect.left, clientY - rect.top)
    setIsDrawing(true)
  }

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const rect = canvas.getBoundingClientRect()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY

    ctx.lineTo(clientX - rect.left, clientY - rect.top)
    ctx.strokeStyle = "#2563eb"
    ctx.lineWidth = 2.5
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.stroke()
  }

  const stopDrawing = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    const canvas = canvasRef.current
    if (canvas) {
      setSignatureImage(canvas.toDataURL())
    }
  }

  const handleApplySignature = () => {
    if (signatureMode === "draw" && !signatureImage) {
      alert("Please draw your signature in the signature box before confirming.")
      return
    }
    if (signatureMode === "type" && !typedSignature.trim()) {
      alert("Please type your signature before confirming.")
      return
    }
    if (!signerName.trim()) {
      alert("Please enter the signer's full name.")
      return
    }

    setIsSigned(true)
    try {
      localStorage.setItem(`sig_name_${project.id}`, signerName)
      localStorage.setItem(`sig_title_${project.id}`, signerTitle)
      localStorage.setItem(`sig_date_${project.id}`, signatureDate)
      localStorage.setItem(`sig_mode_${project.id}`, signatureMode)
      localStorage.setItem(`sig_typed_${project.id}`, typedSignature)
      localStorage.setItem(`sig_img_${project.id}`, signatureImage)
      localStorage.setItem(`sig_done_${project.id}`, "true")
    } catch (e) {}
  }

  const handleClearSignature = () => {
    setIsSigned(false)
    setSignatureImage("")
    setTypedSignature("")
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    try {
      localStorage.removeItem(`sig_img_${project.id}`)
      localStorage.removeItem(`sig_typed_${project.id}`)
      localStorage.removeItem(`sig_done_${project.id}`)
    } catch (e) {}
  }

  const handleSubmitNotes = (workflowId: string) => {
    if (!onUpdateWorkflowField) return
    const currentVal =
      notesDrafts[workflowId] !== undefined
        ? notesDrafts[workflowId]
        : project.workflows.find((w) => w.id === workflowId)?.ourNotes || ""
    onUpdateWorkflowField(workflowId, "ourNotes", currentVal)
    setSubmittedNotesId(workflowId)
    setTimeout(() => {
      setSubmittedNotesId((prev) => (prev === workflowId ? null : prev))
    }, 2500)
  }

  const handleSubmitReason = async (workflowId: string) => {
    const currentVal =
      reasonDrafts[workflowId] !== undefined
        ? reasonDrafts[workflowId]
        : project.workflows.find((w) => w.id === workflowId)?.reason || ""

    if (onSubmitRevision) {
      await onSubmitRevision(workflowId, currentVal)
    } else if (onUpdateWorkflowField) {
      onUpdateWorkflowField(workflowId, "reason", currentVal)
    }

    setSubmittedReasonId(workflowId)
    setTimeout(() => {
      setSubmittedReasonId((prev) => (prev === workflowId ? null : prev))
    }, 2500)
  }

  const handleSubmitClientMessage = (workflowId: string) => {
    if (!onUpdateWorkflowField) return
    const currentVal =
      clientMessageDrafts[workflowId] !== undefined
        ? clientMessageDrafts[workflowId]
        : project.workflows.find((w) => w.id === workflowId)?.clientMessage || ""
    onUpdateWorkflowField(workflowId, "clientMessage", currentVal)
    setSubmittedClientMessageId(workflowId)
    setTimeout(() => {
      setSubmittedClientMessageId((prev) => (prev === workflowId ? null : prev))
    }, 2500)
  }

  // Open lightbox
  const openLightbox = (
    src: string,
    title: string,
    workflowTitle: string,
    workflowIndex: number,
    type: "designA" | "designB"
  ) => {
    setLightbox({ src, title, workflowTitle, workflowIndex, type })
    setZoom(1)
  }

  const closeLightbox = useCallback(() => {
    setLightbox(null)
    setZoom(1)
  }, [])

  // Zoom controls
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3))
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5))
  const handleResetZoom = () => setZoom(1)

  // Navigate between images in lightbox
  const navigateImage = useCallback(
    (direction: "prev" | "next") => {
      if (!lightbox) return

      const workflows = project.workflows
      const currentWf = workflows[lightbox.workflowIndex]

      if (direction === "next") {
        // If on designA and designB exists, switch to designB
        if (lightbox.type === "designA" && currentWf?.designB) {
          setLightbox({
            src: currentWf.designB,
            title: "App Screenshot",
            workflowTitle: currentWf.title,
            workflowIndex: lightbox.workflowIndex,
            type: "designB",
          })
          setZoom(1)
          return
        }

        // Look for next workflow with an image
        for (let i = lightbox.workflowIndex + 1; i < workflows.length; i++) {
          const wf = workflows[i]
          if (wf.designA) {
            setLightbox({
              src: wf.designA,
              title: "Figma",
              workflowTitle: wf.title,
              workflowIndex: i,
              type: "designA",
            })
            setZoom(1)
            return
          }
          if (wf.designB) {
            setLightbox({
              src: wf.designB,
              title: "App Screenshot",
              workflowTitle: wf.title,
              workflowIndex: i,
              type: "designB",
            })
            setZoom(1)
            return
          }
        }
      } else {
        // If on designB and designA exists, switch to designA
        if (lightbox.type === "designB" && currentWf?.designA) {
          setLightbox({
            src: currentWf.designA,
            title: "Figma",
            workflowTitle: currentWf.title,
            workflowIndex: lightbox.workflowIndex,
            type: "designA",
          })
          setZoom(1)
          return
        }

        // Look for previous workflow with an image
        for (let i = lightbox.workflowIndex - 1; i >= 0; i--) {
          const wf = workflows[i]
          if (wf.designB) {
            setLightbox({
              src: wf.designB,
              title: "App Screenshot",
              workflowTitle: wf.title,
              workflowIndex: i,
              type: "designB",
            })
            setZoom(1)
            return
          }
          if (wf.designA) {
            setLightbox({
              src: wf.designA,
              title: "Figma",
              workflowTitle: wf.title,
              workflowIndex: i,
              type: "designA",
            })
            setZoom(1)
            return
          }
        }
      }
    },
    [lightbox, project.workflows]
  )

  // Keyboard navigation for lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightbox) return
      if (e.key === "Escape") closeLightbox()
      if (e.key === "ArrowRight") navigateImage("next")
      if (e.key === "ArrowLeft") navigateImage("prev")
      if (e.key === "+" || e.key === "=") handleZoomIn()
      if (e.key === "-") handleZoomOut()
      if (e.key === "0") handleResetZoom()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [lightbox, closeLightbox, navigateImage])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-200 dark:bg-slate-950 overflow-y-auto print:static print:bg-white print:overflow-visible print:w-full print:h-auto print:block transition-colors">
      {/* Sticky control bar (hidden in print) */}
      <div className="sticky top-0 z-40 flex justify-between items-center p-4 bg-slate-800 dark:bg-slate-900 text-white border-b border-slate-700 dark:border-slate-800 print:hidden shadow-md transition-colors">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold">Project Presentation: {project.title}</h2>
          <span className="bg-slate-700 dark:bg-slate-800 px-3 py-1 rounded-full text-sm">
            {project.workflows.length} Workflows
          </span>
          {isOwner ? (
            <span className="bg-blue-900/80 text-blue-200 border border-blue-500/40 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-300" />
              Sender (Project Owner)
            </span>
          ) : (
            <span className="bg-purple-900/80 text-purple-200 border border-purple-500/40 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-purple-300" />
              Viewer (Review & Comment)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Light / Dark Mode Toggle */}
          {onToggleTheme && (
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          )}

          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <FileText className="h-4 w-4" /> Print / PDF
          </button>

          {/* User Profile & Logout on Presentation Header */}
          {user && (
            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-700">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow-sm ring-1 ring-slate-600">
                {user.email ? user.email.slice(0, 2).toUpperCase() : "CL"}
              </div>
              <div className="hidden md:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-200 leading-tight max-w-[140px] truncate">
                  {user.email}
                </span>
                <span className="text-[10px] text-purple-300 font-medium">
                  {isOwner ? "Sender (Owner)" : "Viewer (Client)"}
                </span>
              </div>
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-950/60 hover:border-rose-700 hover:text-rose-300 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors cursor-pointer"
                  title="Log out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log out</span>
                </button>
              )}
            </div>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              title="Close Presentation View"
            >
              <X className="h-4 w-4" /> Close
            </button>
          )}
        </div>
      </div>

      {/* Slides */}
      <div className="flex flex-col items-center gap-8 py-8 print:py-0 print:gap-0 print:block w-full px-4 print:px-0">
        {/* Title slide */}
        <section className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-2xl border border-slate-200 dark:border-slate-800 p-8 sm:p-12 md:p-16 w-full max-w-[1280px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-screen print:p-8 print:rounded-none print-page-break print-avoid-break print:flex print:flex-col print:justify-between transition-colors space-y-8">
          {/* Header Title */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wider">
              <FolderKanban className="h-3.5 w-3.5" />
              <span>Project Review &amp; Sign-off Report</span>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 dark:text-white tracking-tight text-balance">
              Design Review Report
            </h1>
            <p className="text-lg sm:text-xl text-slate-500 dark:text-slate-400 font-normal">
              Completed Workflows, Figma Verification, and Change Logs
            </p>
            <p className="text-xl sm:text-2xl text-blue-600 dark:text-blue-400 font-bold pt-1">
              Project: {project.title}
            </p>
          </div>

          {/* Executive Metrics Dashboard */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
            {/* Total Workflows */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-xs font-semibold uppercase tracking-wider">Workflows</span>
                <FolderKanban className="h-4 w-4 text-blue-500" />
              </div>
              <div className="pt-2">
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
                  {totalWorkflows}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total Review Items</div>
              </div>
            </div>

            {/* Verified vs Not Verified */}
            <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                <span className="text-xs font-semibold uppercase tracking-wider">Verified</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="pt-2">
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-300">
                  {verifiedCount}
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> / {totalWorkflows}</span>
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  {verificationRate}% Accepted
                </div>
              </div>
            </div>

            {/* Not Verified */}
            <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
                <span className="text-xs font-semibold uppercase tracking-wider">Not Verified</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div className="pt-2">
                <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 dark:text-amber-300">
                  {notVerifiedCount}
                </div>
                <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  {notVerifiedCount === 0 ? "All Items Approved" : "Pending Sign-off"}
                </div>
              </div>
            </div>

            {/* Figma URLs & Exports */}
            <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between text-purple-700 dark:text-purple-400">
                <span className="text-xs font-semibold uppercase tracking-wider">Figma URLs / Designs</span>
                <Link2 className="h-4 w-4 text-purple-500" />
              </div>
              <div className="pt-2">
                <div className="text-2xl sm:text-3xl font-extrabold text-purple-700 dark:text-purple-300">
                  {figmaCount}
                </div>
                <div className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                  {reasonCount} Changes Explained
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-400">
              <span>Overall Review Verification Progress</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-bold">{verificationRate}%</span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 transition-all duration-500"
                style={{ width: `${verificationRate}%` }}
              />
            </div>
          </div>

          {/* Executive Summary Table: Reason of Changes, Figma, and Verification */}
          <div className="w-full space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-wider">
                Workflows, Figma Assets &amp; Reasons for Changes
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {verifiedCount} of {totalWorkflows} verified
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-3.5 py-2.5 w-12 text-center">#</th>
                    <th className="px-3.5 py-2.5">Workflow Name</th>
                    <th className="px-3.5 py-2.5">Figma Design / URL</th>
                    <th className="px-3.5 py-2.5">Reason of Changes</th>
                    <th className="px-3.5 py-2.5 text-right">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900/40">
                  {project.workflows.map((wf, idx) => {
                    const figmaUrls = extractFigmaUrls(wf)
                    const hasFigma = Boolean(wf.designA) || figmaUrls.length > 0
                    const changeReason = wf.reason || (wf.revisions && wf.revisions.length > 0 ? wf.revisions[0].reason : "")

                    return (
                      <tr key={wf.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-3.5 py-3 text-center font-mono text-slate-400">{idx + 1}</td>
                        <td className="px-3.5 py-3 font-semibold text-slate-900 dark:text-white max-w-[200px] truncate">
                          {wf.title}
                        </td>
                        <td className="px-3.5 py-3 max-w-[220px]">
                          {hasFigma ? (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                <Link2 className="h-3 w-3" />
                                {figmaUrls.length > 0 ? `${figmaUrls.length} URL` : "Figma Design"}
                              </span>
                              {figmaUrls.length > 0 && (
                                <a
                                  href={figmaUrls[0]}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                                  title={figmaUrls[0]}
                                >
                                  <span>Open</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">No Figma link</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 max-w-[280px]">
                          {changeReason ? (
                            <p className="line-clamp-2 text-slate-700 dark:text-slate-300 text-[11px]" title={changeReason}>
                              {changeReason}
                            </p>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">Initial design / No changes</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-right whitespace-nowrap">
                          {wf.clientTaskDone ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                              <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                              <span>Not Verified</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Workflow slides */}
        {project.workflows.map((workflow, wfIdx) => (
          <section
            key={workflow.id}
            className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-2xl border border-transparent dark:border-slate-800 p-8 md:p-12 w-full max-w-[1280px] min-h-[720px] shrink-0 relative print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-auto print:p-6 print:rounded-none print-page-break print-avoid-break print:block transition-colors"
          >
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-8 pb-4 border-b border-slate-200 dark:border-slate-800 gap-3 print:mb-4 print:pb-2">
              <div className="flex items-center gap-3 flex-wrap">
                <FolderKanban className="text-blue-500 h-7 w-7 md:h-9 md:w-9 shrink-0" />
                <h2 className="text-2xl md:text-3xl font-bold text-slate-800 dark:text-white print:text-xl">
                  Workflow: {workflow.title}
                </h2>
                {workflow.clientTaskDone ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Verified &amp; Accepted</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Not Verified (Pending)</span>
                  </span>
                )}
              </div>
              <span className="text-xs md:text-sm font-medium text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full self-start sm:self-auto">
                Slide {wfIdx + 1} of {project.workflows.length}
              </span>
            </div>

            <div className="flex flex-col flex-grow w-full gap-8 print:gap-4">
              {/* Image comparison grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full print:grid-cols-2 print:gap-4">
                {/* Figma design */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-200">
                        Figma
                      </span>
                      {(() => {
                        const figmaUrls = extractFigmaUrls(workflow)
                        if (figmaUrls.length === 0) return null
                        return (
                          <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Link2 className="h-3 w-3" />
                            <span>{figmaUrls.length} URL{figmaUrls.length > 1 ? "s" : ""}</span>
                          </span>
                        )
                      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      {workflow.designA && (
                        <button
                          onClick={() =>
                            openLightbox(
                              workflow.designA!,
                              "Figma",
                              workflow.title,
                              wfIdx,
                              "designA"
                            )
                          }
                          className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 text-xs md:text-sm font-medium bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-full transition-colors print:hidden"
                          title="View Full Image"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Full Image
                        </button>
                      )}
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs font-medium bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                        <AlertCircle className="h-3.5 w-3.5" /> Read-only
                      </span>
                    </div>
                  </div>

                  {/* Image Display Frame */}
                  <div
                    onClick={() => {
                      if (workflow.designA) {
                        openLightbox(
                          workflow.designA,
                          "Figma",
                          workflow.title,
                          wfIdx,
                          "designA"
                        )
                      }
                    }}
                    className={`h-[420px] md:h-[480px] w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/[0.03] dark:bg-slate-950/80 flex items-center justify-center relative group overflow-hidden p-3 transition-all ${
                      workflow.designA ? "cursor-pointer hover:border-blue-400 hover:shadow-md" : ""
                    }`}
                  >
                    {workflow.designA ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={workflow.designA}
                          alt="Figma design"
                          className="h-full w-full object-contain rounded-lg drop-shadow-md transition-transform duration-200 group-hover:scale-[1.01]"
                        />
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl backdrop-blur-[2px] print:hidden">
                          <span className="flex items-center gap-2 bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-white font-semibold px-5 py-2.5 rounded-full shadow-lg text-sm transform translate-y-2 group-hover:translate-y-0 transition-transform">
                            <Maximize2 className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Click to View Full Image
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center text-slate-400 dark:text-slate-500">
                        <span className="text-sm">No image uploaded</span>
                      </div>
                    )}
                  </div>

                  {/* Our Notes (Developer notes form) */}
                  <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl p-5 flex-1 flex flex-col">
                    <div className="flex justify-between items-center mb-2 text-blue-900 dark:text-blue-200 font-bold text-base md:text-lg">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        <span>Our Notes</span>
                      </div>
                      {isOwner && onUpdateWorkflowField && (
                        <span className="text-xs font-semibold bg-blue-100 dark:bg-blue-900/70 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-700 px-2 py-0.5 rounded-full print:hidden">
                          Developer Form
                        </span>
                      )}
                    </div>
                    {isOwner && onUpdateWorkflowField ? (
                      <>
                        <textarea
                          value={
                            notesDrafts[workflow.id] !== undefined
                              ? notesDrafts[workflow.id]
                              : workflow.ourNotes || ""
                          }
                          onChange={(e) => {
                            const val = e.target.value
                            setNotesDrafts((prev) => ({ ...prev, [workflow.id]: val }))
                          }}
                          placeholder="Type developer notes about design structure, constraints, or decisions..."
                          className="w-full flex-1 min-h-[130px] rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 p-3 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-y print:hidden"
                        />
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-blue-100 dark:border-blue-900/50 print:hidden">
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            {submittedNotesId === workflow.id
                              ? "✓ Notes submitted successfully!"
                              : "Click submit to save notes"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSubmitNotes(workflow.id)}
                            className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer ${
                              submittedNotesId === workflow.id
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "bg-blue-600 text-white hover:bg-blue-700"
                            }`}
                          >
                            {submittedNotesId === workflow.id ? (
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
                        <p className="hidden print:block text-slate-700 whitespace-pre-wrap text-sm leading-relaxed">
                          {workflow.ourNotes || "No notes provided."}
                        </p>
                      </>
                    ) : (
                      <p className="text-slate-700 whitespace-pre-wrap text-sm md:text-base leading-relaxed">
                        {workflow.ourNotes || "No notes provided."}
                      </p>
                    )}
                  </div>
                </div>

                {/* App screenshot */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-100">
                      App Screenshot
                    </span>
                    <div className="flex items-center gap-2">
                      {workflow.designB && (
                         <button
                          onClick={() =>
                            openLightbox(
                              workflow.designB!,
                              "App Screenshot",
                              workflow.title,
                              wfIdx,
                              "designB"
                            )
                          }
                          className="flex items-center gap-1.5 text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 text-xs md:text-sm font-medium bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-full transition-colors print:hidden"
                          title="View Full Image"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Full Image
                        </button>
                      )}
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs font-medium bg-slate-100 dark:bg-slate-800/60 px-2.5 py-1 rounded-full">
                        <AlertCircle className="h-3.5 w-3.5" /> Read-only
                      </span>
                    </div>
                  </div>

                  {/* Image Display Frame */}
                  <div
                    onClick={() => {
                      if (workflow.designB) {
                        openLightbox(
                          workflow.designB,
                          "App Screenshot",
                          workflow.title,
                          wfIdx,
                          "designB"
                        )
                      }
                    }}
                    className={`h-[420px] md:h-[480px] w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-900/[0.03] dark:bg-slate-800/30 flex items-center justify-center relative group overflow-hidden p-3 transition-all ${
                      workflow.designB ? "cursor-pointer hover:border-purple-400 dark:hover:border-purple-600 hover:shadow-md" : ""
                    }`}
                  >
                    {workflow.designB ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={workflow.designB}
                          alt="App screenshot"
                          className="h-full w-full object-contain rounded-lg drop-shadow-md transition-transform duration-200 group-hover:scale-[1.01]"
                        />
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl backdrop-blur-[2px] print:hidden">
                          <span className="flex items-center gap-2 bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-white font-semibold px-5 py-2.5 rounded-full shadow-lg text-sm transform translate-y-2 group-hover:translate-y-0 transition-transform">
                            <Maximize2 className="h-4 w-4 text-purple-600" /> Click to View Full Image
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center text-slate-400 dark:text-slate-500">
                        <span className="text-sm">No image uploaded</span>
                      </div>
                    )}
                  </div>

                  {/* Client Message (Styled as message sent by client) */}
                  <div className="bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-xl p-5 flex-1 flex flex-col">
                    <div className="flex justify-between items-center mb-3 text-purple-900 dark:text-purple-200 font-bold text-base md:text-lg">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        <span>Client&apos;s Message</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isOwner && (
                          <span className="text-xs font-semibold bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-700 px-2.5 py-0.5 rounded-full print:hidden">
                            From Client
                          </span>
                        )}
                        {onUpdateWorkflowField && (
                          <button
                            type="button"
                            disabled={!effectiveCanApprove}
                            onClick={() => {
                              if (!effectiveCanApprove) {
                                alert(`Approval permissions are restricted. You do not have permission to accept or verify.`)
                                return
                              }
                              onUpdateWorkflowField(
                                workflow.id,
                                "clientTaskDone",
                                !workflow.clientTaskDone
                              )
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors print:border ${
                              !effectiveCanApprove
                                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 cursor-not-allowed opacity-70"
                                : workflow.clientTaskDone
                                  ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700"
                                  : "bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-800/40 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 print:hidden"
                            }`}
                          >
                            {workflow.clientTaskDone ? <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : null}
                            <span>{workflow.clientTaskDone ? "Accepted & Verified" : "Accept & Verify"}</span>
                          </button>
                        )}
                        {!onUpdateWorkflowField && workflow.clientTaskDone && (
                          <span className="flex items-center gap-1.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 px-3 py-1 rounded-full text-xs font-semibold">
                            <CheckCircle className="h-4 w-4" /> Accepted &amp; Verified
                          </span>
                        )}
                      </div>
                    </div>

                    {!isOwner && onUpdateWorkflowField ? (
                      /* Client editing their own message */
                      <>
                        {!effectiveCanComment && (
                          <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-3 text-xs text-amber-800 dark:text-amber-300 print:hidden">
                            <Lock className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                            <span>
                              Client commenting is disabled for your account.
                            </span>
                          </div>
                        )}
                        <textarea
                          value={
                            clientMessageDrafts[workflow.id] !== undefined
                              ? clientMessageDrafts[workflow.id]
                              : workflow.clientMessage || ""
                          }
                          disabled={!effectiveCanComment}
                          onChange={(e) =>
                            setClientMessageDrafts((prev) => ({
                              ...prev,
                              [workflow.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            !effectiveCanComment
                              ? "Client commenting is disabled."
                              : "Type your message, requested changes, or feedback..."
                          }
                          className={`w-full flex-1 min-h-[130px] rounded-lg border p-3 text-sm focus:outline-none resize-y print:hidden transition-colors ${
                            !effectiveCanComment
                              ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                              : "border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                          }`}
                        />
                        {effectiveCanComment && (
                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-purple-100 dark:border-purple-800/50 print:hidden">
                            <span className="text-xs text-purple-700 dark:text-purple-400 font-medium">
                              {submittedClientMessageId === workflow.id
                                ? "✓ Feedback submitted to developer!"
                                : "Submit your comments to the team"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSubmitClientMessage(workflow.id)}
                              className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all ${
                                submittedClientMessageId === workflow.id
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "bg-purple-600 text-white hover:bg-purple-700"
                              }`}
                            >
                              {submittedClientMessageId === workflow.id ? (
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
                        <p className="hidden print:block text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm leading-relaxed">
                          {workflow.clientMessage || "No message provided."}
                        </p>
                      </>
                    ) : (
                      /* Developer viewing client's message styled as a received client message bubble */
                      <div className="flex-1 min-h-[130px] rounded-xl bg-white dark:bg-slate-900/70 border border-purple-200/90 dark:border-purple-800/50 p-4 shadow-sm flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-400 font-semibold">
                            <User className="h-3.5 w-3.5" />
                            <span>Message from Client:</span>
                          </div>
                          <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap text-sm md:text-base leading-relaxed pl-1">
                            {workflow.clientMessage || (
                              <span className="text-slate-400 dark:text-slate-500 italic">No message sent by client yet.</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Reason for Final Changes (Developer gives why this changed form) */}
              <div className="bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-5 w-full flex flex-col space-y-3">
                <div className="flex justify-between items-center mb-2 text-amber-900 dark:text-amber-200 font-bold text-base md:text-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <span>Reason for Final Changes</span>
                  </div>
                  {effectiveCanEdit && onUpdateWorkflowField && (
                    <span className="text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700 px-2.5 py-0.5 rounded-full print:hidden">
                      {userRole === "freelancer" ? "Freelancer Submission" : "Developer Explanation"}
                    </span>
                  )}
                </div>
                {effectiveCanEdit && onUpdateWorkflowField ? (
                  <>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 print:hidden">
                      Developer explains why these specific changes were made in response to client feedback or requirements:
                    </p>
                    <textarea
                      value={
                        reasonDrafts[workflow.id] !== undefined
                          ? reasonDrafts[workflow.id]
                          : workflow.reason || ""
                      }
                      onChange={(e) => {
                        const val = e.target.value
                        setReasonDrafts((prev) => ({ ...prev, [workflow.id]: val }))
                      }}
                      placeholder="Type the reason why changes were made (e.g., brand guidelines, responsive adjustments, client request)..."
                      className="w-full min-h-[90px] rounded-lg border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-200 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-y print:hidden"
                    />
                    <div className="flex items-center justify-between mt-3 pt-2 border-t border-amber-200/60 dark:border-amber-800/40 print:hidden">
                      <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        {submittedReasonId === workflow.id
                          ? "✓ Reason submitted successfully!"
                          : "Click submit to save reason"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSubmitReason(workflow.id)}
                        className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold shadow-sm transition-all ${
                          submittedReasonId === workflow.id
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-amber-600 text-white hover:bg-amber-700"
                        }`}
                      >
                        {submittedReasonId === workflow.id ? (
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
                    <p className="hidden print:block text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm leading-relaxed">
                      {workflow.reason || "No reason provided."}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm md:text-base leading-relaxed">
                    {workflow.reason || "No reason provided."}
                  </p>
                )}

                {/* Revision History List in Presentation View */}
                {workflow.revisions && workflow.revisions.length > 0 && (
                  <div className="pt-3 border-t border-amber-200/50 dark:border-amber-900/40 space-y-2">
                    <h5 className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                      Past Revisions &amp; Explanations:
                    </h5>
                    <div className="space-y-1.5">
                      {workflow.revisions.map((r) => (
                        <div
                          key={r.id}
                          className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/60 border border-amber-200/80 dark:border-amber-900/40 text-xs"
                        >
                          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 font-semibold mb-1">
                            <span className="text-amber-700 dark:text-amber-300">Revision {r.revisionNumber} ({r.authorRole})</span>
                            <span className="text-[10px]">{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}

        {/* Final slide - Formal Sign-off & Digital Signature */}
        <section className="flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-8 sm:p-12 md:p-16 w-full max-w-[1280px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-screen print:p-8 print:rounded-none print-page-break print-avoid-break print:flex print:flex-col print:justify-between transition-colors space-y-8">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold uppercase tracking-wider">
              <PenTool className="h-3.5 w-3.5" />
              <span>Formal Acceptance &amp; Sign-off</span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-slate-900 dark:text-white tracking-tight text-balance">
              Project Sign-off &amp; Approvals
            </h2>
            <p className="text-sm sm:text-base text-slate-500 dark:text-slate-400 font-normal max-w-2xl mx-auto">
              This document confirms the review of all workflows, linked Figma designs, reasons for changes, and final verification status for project <strong className="text-slate-900 dark:text-white">{project.title}</strong>.
            </p>

            {/* Status overview pill */}
            <div className="pt-2">
              {verifiedCount === totalWorkflows && totalWorkflows > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 shadow-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>All {totalWorkflows} Workflows Verified &amp; Approved (100%)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shadow-sm">
                  <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span>{verifiedCount} of {totalWorkflows} Workflows Verified ({notVerifiedCount} Pending Review)</span>
                </span>
              )}
            </div>
          </div>

          {/* Dual Signatures Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 w-full">
            {/* 1. Client / Approver Signature Box */}
            <div className="flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <PenTool className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Client / Approver Signature
                    </h4>
                  </div>
                  {isSigned && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="h-3 w-3" /> Signed &amp; Approved
                    </span>
                  )}
                </div>

                {/* Signer Details Form */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Signer Name
                    </label>
                    <input
                      type="text"
                      disabled={isSigned}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="e.g. Jane Doe"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-blue-500 disabled:opacity-75"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                      Role / Organization
                    </label>
                    <input
                      type="text"
                      disabled={isSigned}
                      value={signerTitle}
                      onChange={(e) => setSignerTitle(e.target.value)}
                      placeholder="e.g. Lead Stakeholder"
                      className="w-full text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-slate-900 dark:text-white outline-none focus:border-blue-500 disabled:opacity-75"
                    />
                  </div>
                </div>
              </div>

              {/* Signature Area */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium">Signature Area:</span>
                  {!isSigned && (
                    <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800/80 p-0.5 rounded-lg text-[11px] print:hidden">
                      <button
                        type="button"
                        onClick={() => setSignatureMode("draw")}
                        className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                          signatureMode === "draw"
                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Draw
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignatureMode("type")}
                        className={`px-2 py-0.5 rounded-md font-semibold transition-all cursor-pointer ${
                          signatureMode === "type"
                            ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Type
                      </button>
                    </div>
                  )}
                </div>

                {isSigned ? (
                  /* Applied Signature View */
                  <div className="h-32 w-full rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center p-3 relative overflow-hidden shadow-inner">
                    {signatureMode === "draw" && signatureImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={signatureImage}
                        alt="Digital Signature"
                        className="max-h-24 max-w-full object-contain filter dark:invert"
                      />
                    ) : (
                      <span className="font-serif italic text-3xl text-blue-600 dark:text-blue-400 select-none">
                        {typedSignature || signerName || "Digitally Signed"}
                      </span>
                    )}
                    <div className="absolute bottom-1 right-2 text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                      <span>{signatureDate}</span>
                    </div>
                  </div>
                ) : signatureMode === "draw" ? (
                  /* Interactive Canvas Pad */
                  <div className="space-y-1.5 print:hidden">
                    <div className="relative rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 h-32 overflow-hidden shadow-xs cursor-crosshair">
                      <canvas
                        ref={canvasRef}
                        width={460}
                        height={128}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        className="w-full h-full touch-none"
                      />
                      {!signatureImage && !isDrawing && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs text-slate-400 italic">
                          Draw signature here with finger or mouse
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleClearSignature}
                        className="text-[11px] text-slate-500 hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        Clear Canvas
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Typed Cursive Mode */
                  <div className="space-y-2 print:hidden">
                    <input
                      type="text"
                      value={typedSignature}
                      onChange={(e) => setTypedSignature(e.target.value)}
                      placeholder="Type your formal name to generate signature"
                      className="w-full text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 outline-none focus:border-blue-500"
                    />
                    <div className="h-20 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center p-2">
                      <span className="font-serif italic text-2xl text-blue-600 dark:text-blue-400 select-none">
                        {typedSignature || signerName || "Signature Preview"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Confirm Signature or Edit Actions */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between print:hidden">
                  {isSigned ? (
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="text-xs text-slate-500 hover:text-blue-500 font-medium transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Redo Signature</span>
                    </button>
                  ) : (
                    <div className="flex justify-end w-full">
                      <button
                        type="button"
                        onClick={handleApplySignature}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/20 transition-all cursor-pointer"
                      >
                        <PenTool className="h-3.5 w-3.5" />
                        <span>Confirm &amp; Apply Signature</span>
                      </button>
                    </div>
                  )}
                  <span className="text-[11px] text-slate-400 font-mono">{signatureDate}</span>
                </div>
              </div>
            </div>

            {/* 2. Developer / Creator Project Verification Box */}
            <div className="flex flex-col justify-between p-6 sm:p-7 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Creator Verification &amp; Seal
                    </h4>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" /> Verified Document
                  </span>
                </div>

                <div className="space-y-3 pt-3 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Project Creator / Administrator</span>
                    <span className="font-semibold text-slate-900 dark:text-white text-sm">
                      {isOwner && user?.email ? user.email : "Design Team Lead"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Project Title</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{project.title}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Report Date</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300">{signatureDate}</span>
                  </div>
                </div>
              </div>

              {/* Digital Seal of Authenticity */}
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Authenticity &amp; Integrity Seal</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  All Figma screen comparisons, version changelogs, and client feedback notes have been securely compiled and recorded in accordance with project review standards.
                </p>
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono border-t border-slate-100 dark:border-slate-800/80">
                  <span>SYSTEM AUDIT PASS</span>
                  <span>{project.id.slice(0, 8)}...</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 italic">
                Ready for production export, development handoff, or stakeholder archival.
              </div>
            </div>
          </div>

          {/* Concluding Footer Notice */}
          <div className="text-center pt-2 text-xs text-slate-400 border-t border-slate-200 dark:border-slate-800">
            Design Workflow Review System • Generated for {project.title} • {verifiedCount} Verified / {notVerifiedCount} Pending
          </div>
        </section>
      </div>

      {/* FULL IMAGE LIGHTBOX MODAL */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 backdrop-blur-md print:hidden select-none"
          onClick={closeLightbox}
        >
          {/* Top Lightbox Toolbar */}
          <div
            className="flex items-center justify-between px-6 py-4 bg-slate-900/90 border-b border-slate-800 text-white z-10 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>{lightbox.title}</span>
                  <span className="text-slate-400 font-normal text-sm">
                    — Workflow: {lightbox.workflowTitle}
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Slide {lightbox.workflowIndex + 1} of {project.workflows.length} • Click outside or press Esc to close
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 transition-colors"
                title="Zoom Out (-)"
              >
                <ZoomOut className="h-5 w-5" />
              </button>

              <span className="text-sm font-medium text-slate-300 min-w-[54px] text-center">
                {Math.round(zoom * 100)}%
              </span>

              <button
                onClick={handleZoomIn}
                disabled={zoom >= 3}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 transition-colors"
                title="Zoom In (+)"
              >
                <ZoomIn className="h-5 w-5" />
              </button>

              {zoom !== 1 && (
                <button
                  onClick={handleResetZoom}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                  title="Reset Zoom (0)"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </button>
              )}

              <div className="h-6 w-px bg-slate-700 mx-2" />

              <a
                href={lightbox.src}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                title="Open high-res original in new tab"
              >
                <ExternalLink className="h-4 w-4" /> Open Original
              </a>

              <button
                onClick={closeLightbox}
                className="p-2 ml-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition-colors"
                title="Close (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Central Image Viewport */}
          <div
            className="flex-1 relative flex items-center justify-center p-6 overflow-auto"
            onClick={closeLightbox}
          >
            {/* Prev image button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateImage("prev")
              }}
              className="absolute left-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-slate-800/80 hover:bg-slate-800 text-white backdrop-blur-sm border border-slate-700 transition-all shadow-xl hover:scale-110"
              title="Previous Image (Left Arrow)"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>

            {/* Next image button */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigateImage("next")
              }}
              className="absolute right-6 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-slate-800/80 hover:bg-slate-800 text-white backdrop-blur-sm border border-slate-700 transition-all shadow-xl hover:scale-110"
              title="Next Image (Right Arrow)"
            >
              <ChevronRight className="h-6 w-6" />
            </button>

            {/* Main Lightbox Image */}
            <div
              className="transition-transform duration-150 ease-out flex items-center justify-center max-w-full max-h-full"
              style={{ transform: `scale(${zoom})` }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightbox.src}
                alt={lightbox.title}
                className="max-h-[82vh] max-w-[88vw] object-contain rounded-xl shadow-2xl border border-slate-800/60"
              />
            </div>
          </div>

          {/* Bottom Hint */}
          <div
            className="py-2.5 text-center text-xs text-slate-500 bg-slate-900/60 border-t border-slate-800/80 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            Tip: Use <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">←</kbd> <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">→</kbd> arrows to switch images, <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">+</kbd> <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">-</kbd> to zoom, or <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">Esc</kbd> to exit.
          </div>
        </div>
      )}
    </div>
  )
}
