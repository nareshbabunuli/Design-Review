"use client"

import { useState, useEffect, useCallback } from "react"
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
} from "lucide-react"
import type { Project } from "@/lib/design-review-types"
import { ThemeToggle } from "./theme-toggle"

type ReportModalProps = {
  project: Project
  isOwner?: boolean
  isViewerOnly?: boolean
  canComment?: boolean
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
}

type LightboxState = {
  src: string
  title: string
  workflowTitle: string
  workflowIndex: number
  type: "designA" | "designB"
}

export function ReportModal({
  project,
  isOwner = false,
  isViewerOnly = false,
  canComment = true,
  inviteeEmail,
  user = null,
  theme = "dark",
  onToggleTheme,
  onLogout,
  onClose,
  onUpdateWorkflowField,
}: ReportModalProps) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const [zoom, setZoom] = useState<number>(1)
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({})
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({})
  const [clientMessageDrafts, setClientMessageDrafts] = useState<Record<string, string>>({})
  const [submittedNotesId, setSubmittedNotesId] = useState<string | null>(null)
  const [submittedReasonId, setSubmittedReasonId] = useState<string | null>(null)
  const [submittedClientMessageId, setSubmittedClientMessageId] = useState<string | null>(null)

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

  const handleSubmitReason = (workflowId: string) => {
    if (!onUpdateWorkflowField) return
    const currentVal =
      reasonDrafts[workflowId] !== undefined
        ? reasonDrafts[workflowId]
        : project.workflows.find((w) => w.id === workflowId)?.reason || ""
    onUpdateWorkflowField(workflowId, "reason", currentVal)
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
        <section className="flex flex-col items-center justify-center bg-white dark:bg-slate-900 rounded-2xl shadow-xl dark:shadow-2xl border border-transparent dark:border-slate-800 p-16 w-full max-w-[1280px] min-h-[500px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:max-w-none print:min-h-0 print:h-screen print:p-8 print:rounded-none print-page-break print-avoid-break print:flex print:items-center print:justify-center transition-colors">
          <div className="text-center">
            <h1 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-6 tracking-tight text-balance">
              Design Review Report
            </h1>
            <p className="text-2xl text-slate-500 dark:text-slate-400 font-light mb-3">
              Completed Workflows &amp; Final Approvals
            </p>
            <p className="text-xl text-blue-600 dark:text-blue-400 font-semibold">Project: {project.title}</p>
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
                <FolderKanban className="text-blue-500 h-8 w-8 md:h-10 md:w-10 shrink-0" />
                <span>Workflow: {workflow.title}</span>
              </h2>
              <span className="text-xs md:text-sm font-medium text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-full">
                Slide {wfIdx + 1} of {project.workflows.length}
              </span>
            </div>

            <div className="flex flex-col flex-grow w-full gap-8 print:gap-4">
              {/* Image comparison grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full print:grid-cols-2 print:gap-4">
                {/* Figma design */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg md:text-xl font-bold text-slate-800 dark:text-slate-200">
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
                          <span className="text-xs font-semibold bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-700 px-2 py-0.5 rounded-full print:hidden">
                            From Client
                          </span>
                        )}
                        {onUpdateWorkflowField && (
                          <button
                            type="button"
                            disabled={!canComment}
                            onClick={() => {
                              if (!canComment) {
                                alert(`Approvals are locked to ${inviteeEmail}. Only ${inviteeEmail} can accept or verify.`)
                                return
                              }
                              onUpdateWorkflowField(
                                workflow.id,
                                "clientTaskDone",
                                !workflow.clientTaskDone
                              )
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors print:border ${
                              !canComment
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
                        {!canComment && inviteeEmail && (
                          <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-3 text-xs text-amber-800 dark:text-amber-300 print:hidden">
                            <Lock className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                            <span>
                              Comments &amp; approvals are restricted to <strong>{inviteeEmail}</strong>.
                            </span>
                          </div>
                        )}
                        <textarea
                          value={
                            clientMessageDrafts[workflow.id] !== undefined
                              ? clientMessageDrafts[workflow.id]
                              : workflow.clientMessage || ""
                          }
                          disabled={!canComment}
                          onChange={(e) =>
                            setClientMessageDrafts((prev) => ({
                              ...prev,
                              [workflow.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            !canComment
                              ? `Feedback is locked. Only ${inviteeEmail} can comment.`
                              : "Type your message, requested changes, or feedback..."
                          }
                          className={`w-full flex-1 min-h-[130px] rounded-lg border p-3 text-sm focus:outline-none resize-y print:hidden transition-colors ${
                            !canComment
                              ? "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                              : "border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
                          }`}
                        />
                        {canComment && (
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
              <div className="bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-5 w-full flex flex-col">
                <div className="flex justify-between items-center mb-2 text-amber-900 dark:text-amber-200 font-bold text-base md:text-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <span>Reason for Final Changes</span>
                  </div>
                  {isOwner && onUpdateWorkflowField && (
                    <span className="text-xs font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700 px-2.5 py-0.5 rounded-full print:hidden">
                      Developer Explanation Form
                    </span>
                  )}
                </div>
                {isOwner && onUpdateWorkflowField ? (
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
              </div>
            </div>
          </section>
        ))}

        {/* Final slide */}
        <section className="flex flex-col items-center justify-center bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-2xl shadow-xl p-16 w-full max-w-[1280px] min-h-[400px] shrink-0 relative overflow-hidden print:shadow-none print:w-full print:aspect-auto print:h-screen print:rounded-none">
          <div className="text-center">
            <h2 className="text-5xl md:text-6xl font-bold text-slate-900 dark:text-white mb-6 tracking-tight text-balance">
              Report Concluded
            </h2>
            <p className="text-2xl text-slate-500 dark:text-slate-400 font-light text-pretty">
              All workflows have been successfully reviewed and verified.
            </p>
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
