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
  Pencil,
  Copy,
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
    field: "ourNotes" | "clientMessage" | "clientTaskDone" | "reason" | "figmaUrl" | "designA",
    value: string | boolean | null
  ) => void
  onUpdateProjectFigmaUrl?: (projectId: string, url: string | null) => void
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

  if (workflow.figmaUrl && workflow.figmaUrl.trim()) {
    urls.push(workflow.figmaUrl.trim())
  }
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
  onUpdateProjectFigmaUrl,
  onSubmitRevision,
}: ReportModalProps) {
  const effectiveCanEdit = canEdit ?? isOwner
  const effectiveCanComment = canComment ?? true
  const effectiveCanApprove = canApprove ?? isOwner

  const canEditFigmaUrl = Boolean(
    isOwner ||
    canEdit ||
    userRole === "owner" ||
    userRole === "freelancer" ||
    (user?.id && project.userId ? project.userId === user.id : !project.userId) ||
    (user?.email && (
      user.email.toLowerCase().includes("syntax.ai") ||
      user.email.toLowerCase().includes("dev") ||
      user.email.toLowerCase().includes("freelancer")
    ))
  )

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

  // Central Single Project Figma URL at the Top
  const [projectFigmaUrl, setProjectFigmaUrl] = useState<string>("")
  const [isEditingProjectFigmaUrl, setIsEditingProjectFigmaUrl] = useState<boolean>(false)
  const [projectFigmaUrlDraft, setProjectFigmaUrlDraft] = useState<string>("")
  const [isCopiedProjectFigmaUrl, setIsCopiedProjectFigmaUrl] = useState<boolean>(false)
  const [savedProjectFigmaUrl, setSavedProjectFigmaUrl] = useState<boolean>(false)

  useEffect(() => {
    try {
      const saved =
        project.figmaUrl ||
        localStorage.getItem(`project_figma_url_${project.id}`) ||
        ""
      setProjectFigmaUrl(saved)
      setProjectFigmaUrlDraft(saved)
    } catch (e) {
      setProjectFigmaUrl(project.figmaUrl || "")
      setProjectFigmaUrlDraft(project.figmaUrl || "")
    }
  }, [project.id, project.figmaUrl])

  const handleSaveProjectFigmaUrl = () => {
    const cleanUrl = projectFigmaUrlDraft.trim() || null
    setProjectFigmaUrl(cleanUrl || "")
    setIsEditingProjectFigmaUrl(false)
    setSavedProjectFigmaUrl(true)
    try {
      localStorage.setItem(`project_figma_url_${project.id}`, cleanUrl || "")
    } catch (e) {}
    onUpdateProjectFigmaUrl?.(project.id, cleanUrl)
    setTimeout(() => setSavedProjectFigmaUrl(false), 2500)
  }

  const handleCopyProjectFigmaUrl = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard && projectFigmaUrl) {
      navigator.clipboard.writeText(projectFigmaUrl)
      setIsCopiedProjectFigmaUrl(true)
      setTimeout(() => setIsCopiedProjectFigmaUrl(false), 2000)
    }
  }

  // Count workflows with Figma assets / exports
  const figmaWorkflows = project.workflows.filter((w) => Boolean(w.designA))
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

  // Force light theme and clean styles on print (toggles print-force-light class)
  useEffect(() => {
    const beforePrint = () => {
      document.documentElement.classList.add("print-force-light")
    }
    const afterPrint = () => {
      document.documentElement.classList.remove("print-force-light")
    }
    window.addEventListener("beforeprint", beforePrint)
    window.addEventListener("afterprint", afterPrint)
    return () => {
      window.removeEventListener("beforeprint", beforePrint)
      window.removeEventListener("afterprint", afterPrint)
    }
  }, [])

  // Preload all images before opening print dialog to avoid missing/broken frames
  const handlePrint = async () => {
    const images = Array.from(document.querySelectorAll("#report-modal-root img")) as HTMLImageElement[]
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve()
        return new Promise((resolve) => {
          img.onload = resolve
          img.onerror = resolve
        })
      })
    )
    window.print()
  }

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
    <div
      id="report-modal-root"
      data-report-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-slate-200 dark:bg-slate-950 overflow-y-auto print:static print:overflow-visible print:w-full print:h-auto print:block transition-colors"
    >
      {/* Sticky control bar (hidden in print) */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 bg-slate-800 dark:bg-slate-900 text-white border-b border-slate-700 dark:border-slate-800 print:hidden shadow-md transition-colors">
        <div className="flex items-center gap-3 min-w-0 shrink">
          <h2 className="text-base sm:text-lg lg:text-xl font-bold truncate max-w-[200px] sm:max-w-[360px] lg:max-w-[520px]">Project Presentation: {project.title}</h2>
          <span className="bg-slate-700 dark:bg-slate-800 px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap shrink-0">
            {project.workflows.length} Screens
          </span>
          {isOwner ? (
            <span className="hidden sm:inline-flex items-center gap-1.5 bg-blue-900/80 text-blue-200 border border-blue-500/40 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-300" />
              Sender (Project Owner)
            </span>
          ) : (
            <span className="hidden sm:inline-flex items-center gap-1.5 bg-purple-900/80 text-purple-200 border border-purple-500/40 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap shrink-0">
              <Eye className="h-3.5 w-3.5 text-purple-300" />
              Viewer (Review & Comment)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href="https://github.com/nareshbabunuli/Design-Review"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors flex items-center justify-center cursor-pointer"
            title="GitHub: nareshbabunuli/Design-Review"
            aria-label="GitHub Repository"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          </a>

          {onToggleTheme && (
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          )}

          <button
            onClick={handlePrint}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shadow-sm cursor-pointer whitespace-nowrap"
          >
            <FileText className="h-4 w-4" /> Print / PDF
          </button>

          {user && (
            <div className="hidden md:flex items-center gap-2.5 pl-3 border-l border-slate-700">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow-sm ring-1 ring-slate-600">
                {user.email ? user.email.slice(0, 2).toUpperCase() : "CL"}
              </div>
              <div className="flex flex-col text-left">
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
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
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
        <section className="flex flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-2xl border border-transparent dark:border-slate-800 p-16 w-full max-w-[1280px] min-h-[500px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-auto print:py-16 print:p-8 print:rounded-none print-page-break print-avoid-break print:flex print:items-center print:justify-center transition-colors">
          <div className="text-center space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-6 tracking-tight text-balance">
              Design Review Report
            </h1>
            <p className="text-2xl text-slate-500 dark:text-slate-400 font-light mb-3">
              Completed Workflows &amp; Final Approvals
            </p>
            <p className="text-xl text-blue-600 dark:text-blue-400 font-semibold">
              Project: {project.title}
            </p>
            {/* Figma Project Link: View & Edit */}
            {isEditingProjectFigmaUrl ? (
              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 w-full max-w-xl mx-auto print:hidden">
                <div className="relative w-full flex-1">
                  <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-500" />
                  <input
                    type="url"
                    autoFocus
                    value={projectFigmaUrlDraft}
                    onChange={(e) => setProjectFigmaUrlDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveProjectFigmaUrl()
                      if (e.key === "Escape") setIsEditingProjectFigmaUrl(false)
                    }}
                    placeholder="Paste Figma file or prototype URL (https://www.figma.com/design/...)"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/90 border border-purple-400/80 dark:border-purple-500 text-slate-900 dark:text-white text-xs sm:text-sm outline-none focus:ring-2 focus:ring-purple-500/50 transition-all shadow-inner"
                  />
                </div>
                <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleSaveProjectFigmaUrl}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-all active:scale-95 shadow-md cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingProjectFigmaUrl(false)}
                    className="inline-flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Cancel</span>
                  </button>
                  {projectFigmaUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setProjectFigmaUrlDraft("")
                        setProjectFigmaUrl("")
                        setIsEditingProjectFigmaUrl(false)
                        try {
                          localStorage.removeItem(`project_figma_url_${project.id}`)
                        } catch (e) {}
                        onUpdateProjectFigmaUrl?.(project.id, null)
                      }}
                      className="inline-flex items-center px-2.5 py-2.5 rounded-xl hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
                      title="Remove link"
                    >
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            ) : projectFigmaUrl ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 print:mt-4">
                <a
                  href={projectFigmaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-sm font-medium hover:underline shadow-xs transition-colors"
                  title="Open Figma File"
                >
                  <Link2 className="h-4 w-4 shrink-0 text-purple-500" />
                  <span className="truncate max-w-[320px] sm:max-w-[450px]">Figma: {projectFigmaUrl}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>

                {canEditFigmaUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setProjectFigmaUrlDraft(projectFigmaUrl)
                      setIsEditingProjectFigmaUrl(true)
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-xs font-semibold transition-all hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer print:hidden shadow-xs"
                    title="Edit Figma link"
                  >
                    <Pencil className="h-3.5 w-3.5 text-blue-500" />
                    <span>Edit Link</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopyProjectFigmaUrl}
                  className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 text-xs font-medium transition-colors cursor-pointer print:hidden shadow-xs"
                  title="Copy Figma Link"
                >
                  {isCopiedProjectFigmaUrl ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                {savedProjectFigmaUrl && (
                  <span className="text-xs text-emerald-500 font-medium animate-in fade-in">Saved!</span>
                )}
              </div>
            ) : canEditFigmaUrl ? (
              <div className="mt-6 flex items-center justify-center print:hidden">
                <button
                  type="button"
                  onClick={() => {
                    setProjectFigmaUrlDraft("")
                    setIsEditingProjectFigmaUrl(true)
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-dashed border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-sm font-semibold transition-all cursor-pointer shadow-xs"
                >
                  <Link2 className="h-4 w-4 text-purple-500" />
                  <span>+ Add Figma Project Link</span>
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {/* Workflow slides */}
        {project.workflows.map((workflow, wfIdx) => (
          <section
            key={workflow.id}
            className="flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-2xl border border-transparent dark:border-slate-800 p-8 md:p-12 w-full max-w-[1280px] min-h-[720px] shrink-0 relative print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-auto print:p-6 print:rounded-none print-page-break print-avoid-break print:block transition-colors"
          >
            <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-200 dark:border-slate-800 print:mb-4 print:pb-2">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-white flex items-center gap-3 print:text-2xl">
                <FolderKanban className="text-blue-500 h-8 w-8 md:h-10 md:w-10 shrink-0 print:h-6 print:w-6" />
                <span>Workflow: {workflow.title}</span>
              </h2>
              <span className="text-xs md:text-sm font-medium text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full print:text-xs">
                Slide {wfIdx + 1} of {project.workflows.length}
              </span>
            </div>

            <div className="flex flex-col flex-grow w-full gap-8 print:gap-4">
              {/* Image comparison grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full print:grid-cols-2 print:gap-4">
                {/* Figma design */}
                <div className="flex flex-col gap-3 print:gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-200 print:text-base">
                      Figma
                    </span>
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
                          className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 text-xs md:text-sm font-medium bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-full transition-colors print:hidden cursor-pointer"
                          title="View Full Image"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Full Image
                        </button>
                      )}
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs font-medium bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full print:hidden">
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
                    className={`h-[420px] md:h-[480px] print:h-[350px] w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-900/[0.03] dark:bg-slate-950/80 flex items-center justify-center relative group overflow-hidden p-3 print:p-1.5 transition-all ${
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

                  {/* Our Notes */}
                  <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl p-5 print:p-3 flex-1 flex flex-col">
                    <div className="flex justify-between items-center mb-2 text-blue-900 dark:text-blue-200 font-bold text-base md:text-lg print:text-sm">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 print:h-4 print:w-4" />
                        <span>Our Notes</span>
                      </div>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm md:text-base print:text-xs print:max-h-[240px] print:overflow-hidden leading-relaxed">
                      {workflow.ourNotes || "No notes provided."}
                    </p>
                  </div>
                </div>

                {/* App Screenshot */}
                <div className="flex flex-col gap-3 print:gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-200 print:text-base">
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
                          className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 hover:text-purple-700 text-xs md:text-sm font-medium bg-purple-50 dark:bg-purple-950/60 hover:bg-purple-100 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800 px-2.5 py-1 rounded-full transition-colors print:hidden cursor-pointer"
                          title="View Full Image"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Full Image
                        </button>
                      )}
                      <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs font-medium bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full print:hidden">
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
                    className={`h-[420px] md:h-[480px] print:h-[350px] w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-900/[0.03] dark:bg-slate-800/30 flex items-center justify-center relative group overflow-hidden p-3 print:p-1.5 transition-all ${
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

                  {/* Client's Message */}
                  <div className="bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-xl p-5 print:p-3 flex-1 flex flex-col">
                    <div className="flex justify-between items-center mb-3 text-purple-900 dark:text-purple-200 font-bold text-base md:text-lg print:text-sm">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-purple-600 dark:text-purple-400 print:h-4 print:w-4" />
                        <span>Client&apos;s Message</span>
                      </div>
                    </div>
                    <div className="flex-1 rounded-xl bg-white dark:bg-slate-900/70 border border-purple-200/90 dark:border-purple-800/50 p-4 print:p-2.5 shadow-sm">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-400 font-semibold print:text-[10px]">
                          <User className="h-3.5 w-3.5 print:h-3 print:w-3" />
                          <span>Message from Client:</span>
                        </div>
                        <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap text-sm md:text-base print:text-xs print:max-h-[240px] print:overflow-hidden leading-relaxed pl-1">
                          {workflow.clientMessage || (
                            <span className="text-slate-400 dark:text-slate-500 italic">No message sent by client yet.</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reason for Final Changes */}
              <div className="bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-5 print:p-3 w-full flex flex-col space-y-2 print:space-y-1">
                <div className="flex justify-between items-center mb-1 text-amber-900 dark:text-amber-200 font-bold text-base md:text-lg print:text-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 print:h-4 print:w-4" />
                    <span>Reason for Final Changes</span>
                  </div>
                </div>
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-sm md:text-base print:text-xs print:max-h-[240px] print:overflow-hidden leading-relaxed">
                  {workflow.reason || "No reason provided."}
                </p>
              </div>
            </div>
          </section>
        ))}

        {/* Final slide with Digital Signature */}
        <section className="flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-2xl shadow-xl p-8 md:p-12 w-full max-w-[1280px] min-h-[480px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:aspect-auto print:min-h-0 print:h-auto print:py-12 print:px-6 print:rounded-none print-page-break print-avoid-break print:flex print:items-center print:justify-center">
          <div className="w-full max-w-2xl text-center space-y-6">
            <div>
              <h2 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-3 tracking-tight text-balance">
                Report Concluded
              </h2>
              <p className="text-lg md:text-xl text-slate-500 dark:text-slate-400 font-light text-pretty">
                All workflows have been successfully reviewed and verified.
              </p>
            </div>

            {/* Digital Signature Card */}
            <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 md:p-8 text-left shadow-xs print:p-4 print:border-slate-300">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4 print:mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 print:h-4 print:w-4" />
                  <span className="font-bold text-slate-900 dark:text-white text-base md:text-lg print:text-sm">
                    Executive Sign-off &amp; Approval
                  </span>
                </div>
                {isSigned ? (
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs px-2.5 py-1 rounded-full font-semibold print:text-[10px]">
                    <CheckCircle2 className="h-3.5 w-3.5 print:h-3 print:w-3" /> Digitally Signed
                  </span>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400 print:hidden">
                    Pending Signature
                  </span>
                )}
              </div>

              {isSigned ? (
                /* Signed State View (Rendered on Screen and in Print) */
                <div className="space-y-4 print:space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 print:border-slate-300 print:p-3">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider print:text-[10px]">
                        Signer Name
                      </p>
                      <p className="text-base md:text-lg font-bold text-slate-900 dark:text-white print:text-sm">
                        {signerName || "Authorized Signer"}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 print:text-[11px]">
                        {signerTitle || "Representative"}
                      </p>
                    </div>

                    <div className="space-y-1 sm:text-right">
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider print:text-[10px]">
                        Date &amp; Status
                      </p>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 print:text-xs">
                        {signatureDate || new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                      </p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        Verified &amp; Approved
                      </p>
                    </div>
                  </div>

                  {/* Signature Display (Draw or Type) */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center min-h-[90px] print:min-h-[70px] print:border-slate-300 print:p-2">
                    {signatureImage ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={signatureImage}
                        alt="Digital Signature"
                        className="max-h-16 max-w-full object-contain filter dark:invert"
                      />
                    ) : typedSignature ? (
                      <span className="font-serif italic text-2xl md:text-3xl text-slate-800 dark:text-slate-100 tracking-wider">
                        {typedSignature}
                      </span>
                    ) : (
                      <span className="font-serif italic text-2xl text-slate-700 dark:text-slate-200">
                        {signerName}
                      </span>
                    )}
                  </div>

                  {/* Clear / Edit Signature Button (Hidden in Print) */}
                  <div className="flex justify-end pt-1 print:hidden">
                    <button
                      onClick={handleClearSignature}
                      className="text-xs text-slate-500 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      Clear &amp; Re-sign
                    </button>
                  </div>
                </div>
              ) : (
                /* Unsigned Interactive Form on Screen + Print Fallback */
                <div className="space-y-4">
                  {/* On Screen: Signature Canvas & Inputs */}
                  <div className="space-y-3 print:hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Signer Full Name
                        </label>
                        <input
                          type="text"
                          value={signerName}
                          onChange={(e) => setSignerName(e.target.value)}
                          placeholder="e.g. Alex Johnson"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Title / Role
                        </label>
                        <input
                          type="text"
                          value={signerTitle}
                          onChange={(e) => setSignerTitle(e.target.value)}
                          placeholder="e.g. Product Lead"
                          className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Mode Toggle: Draw vs Type */}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Signature:</span>
                      <button
                        type="button"
                        onClick={() => setSignatureMode("draw")}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                          signatureMode === "draw"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        Draw
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignatureMode("type")}
                        className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                          signatureMode === "type"
                            ? "bg-blue-600 text-white"
                            : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        Type
                      </button>
                    </div>

                    {signatureMode === "draw" ? (
                      <div className="relative border border-slate-300 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                        <canvas
                          ref={canvasRef}
                          width={500}
                          height={120}
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={startDrawing}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                          className="w-full h-[100px] cursor-crosshair touch-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const canvas = canvasRef.current
                            if (canvas) {
                              const ctx = canvas.getContext("2d")
                              if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
                            }
                            setSignatureImage("")
                          }}
                          className="absolute right-2 bottom-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={typedSignature}
                        onChange={(e) => setTypedSignature(e.target.value)}
                        placeholder="Type your signature here..."
                        className="w-full px-4 py-3 text-xl font-serif italic rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={handleApplySignature}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm cursor-pointer"
                      >
                        <Check className="h-4 w-4" /> Apply Digital Signature
                      </button>
                    </div>
                  </div>

                  {/* Print-only fallback for unsigned state */}
                  <div className="hidden print:block space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="border-b border-slate-400 pb-1">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Authorized Signature</p>
                        <div className="h-10" />
                      </div>
                      <div className="border-b border-slate-400 pb-1">
                        <p className="text-[10px] text-slate-500 uppercase font-semibold">Date</p>
                        <p className="text-xs text-slate-800 pt-6">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
                    — Screen: {lightbox.workflowTitle}
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
