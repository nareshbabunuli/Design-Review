"use client"

import React, { useState } from "react"
import {
  FolderKanban,
  Plus,
  Search,
  LayoutGrid,
  List,
  Clock,
  Share2,
  MoreVertical,
  Trash2,
  Edit3,
  Layers,
  Sparkles,
  ArrowRight,
  Users,
  ExternalLink,
  Check,
  Eye,
  Pencil,
  LogOut,
} from "lucide-react"
import { ThemeToggle } from "./theme-toggle"
import type { Project, Workflow } from "@/lib/design-review-types"

interface ProjectDashboardProps {
  projects: Project[]
  userEmail?: string | null
  userId?: string | null
  isOwner?: boolean
  theme?: "light" | "dark"
  onToggleTheme?: () => void
  onCreateProject: () => void
  onSelectProject: (projectId: string) => void
  onOpenPresentation?: (projectId: string) => void
  onDeleteProject: (projectId: string, e: React.MouseEvent) => void
  onRenameProject: (projectId: string, title: string) => void
  onShareProject?: (projectId: string) => void
  onLogout?: () => void
}

export function ProjectDashboard({
  projects,
  userEmail,
  userId,
  isOwner = true,
  theme = "dark",
  onToggleTheme,
  onCreateProject,
  onSelectProject,
  onOpenPresentation,
  onDeleteProject,
  onRenameProject,
  onShareProject,
  onLogout,
}: ProjectDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "shared">("all")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState("")

  const filteredProjects = projects.filter((p) => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase())
    if (!matchesSearch) return false
    if (activeTab === "mine") {
      // My Projects: projects owned by the logged-in user
      return userId ? p.userId === userId : true
    }
    if (activeTab === "shared") {
      // Shared with me: projects NOT owned by the current user
      return userId ? p.userId !== userId : false
    }
    return true // "all" tab
  })

  const getFirstThumbnail = (project: Project): string | null => {
    for (const w of project.workflows) {
      if (w.designA) return w.designA
      if (w.designB) return w.designB
    }
    return null
  }

  const handleStartRename = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(project.id)
    setRenameTitle(project.title)
    setMenuOpenId(null)
  }

  const handleSaveRename = (projectId: string, e: React.FormEvent | React.FocusEvent) => {
    e.preventDefault()
    if (renameTitle.trim()) {
      onRenameProject(projectId, renameTitle.trim())
    }
    setRenamingId(null)
  }

  return (
    <div className="flex flex-col flex-1 h-screen overflow-y-auto bg-slate-50 dark:bg-[#18181b] text-slate-900 dark:text-slate-100 selection:bg-blue-600 selection:text-white transition-colors duration-200">
      {/* Top Bar matching Figma */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 dark:border-zinc-800/80 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur px-8 py-3.5 flex-shrink-0 transition-colors duration-200">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-md shadow-blue-500/20 overflow-hidden">
              {/* Split-panel compare icon */}
              <svg viewBox="0 0 32 32" fill="none" className="h-6 w-6">
                <rect x="2" y="6" width="12" height="16" rx="2" fill="white" fillOpacity="0.95"/>
                <rect x="3.5" y="7.5" width="9" height="2" rx="0.8" fill="#2563eb" fillOpacity="0.5"/>
                <rect x="3.5" y="11" width="6" height="1.5" rx="0.5" fill="#2563eb" fillOpacity="0.4"/>
                <rect x="3.5" y="14" width="8" height="1.5" rx="0.5" fill="#2563eb" fillOpacity="0.3"/>
                <rect x="18" y="10" width="12" height="16" rx="2" fill="white" fillOpacity="0.85"/>
                <rect x="19.5" y="11.5" width="9" height="2" rx="0.8" fill="#4f46e5" fillOpacity="0.5"/>
                <rect x="19.5" y="15" width="6" height="1.5" rx="0.5" fill="#4f46e5" fillOpacity="0.4"/>
                <rect x="19.5" y="18" width="8" height="1.5" rx="0.5" fill="#4f46e5" fillOpacity="0.3"/>
              </svg>
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white block leading-tight">
                Design Review
              </span>
              <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-medium">Workspace Projects</span>
            </div>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-zinc-800" />

          {/* Search bar */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-zinc-400" />
            <input
              type="text"
              placeholder="Search projects or files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/90 pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 outline-none transition-all focus:border-blue-500 focus:bg-white dark:focus:bg-zinc-900 focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Light / Dark Mode Toggle */}
          {onToggleTheme && (
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          )}

          {/* Create Project Button (matching '+ Design' pill in Figma) */}
          {(isOwner || userEmail || userId) && (
            <button
              type="button"
              onClick={onCreateProject}
              className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-600/25 transition-all active:scale-95"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>New Project</span>
            </button>
          )}

          {/* User Profile & Logout on Header */}
          {userEmail && (
            <div className="flex items-center gap-3 pl-3 border-l border-slate-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-xs font-bold text-white shadow-sm ring-1 ring-slate-300 dark:ring-zinc-700">
                  {userEmail.slice(0, 2).toUpperCase()}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-medium text-slate-800 dark:text-zinc-200 leading-tight truncate max-w-[160px]">
                    {userEmail}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium">
                    {isOwner ? "Sender (Owner)" : "Viewer (Client)"}
                  </span>
                </div>
              </div>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/90 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-200 dark:hover:border-rose-800/60 text-slate-700 dark:text-zinc-300 hover:text-rose-600 dark:hover:text-rose-400 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer"
                  title="Log out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log out</span>
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-8 space-y-8">
        {/* Figma-Style Hero Card: "Describe your idea and make it come to life" */}
        <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-r from-zinc-900 via-[#1f1e29] to-[#252238] p-8 shadow-2xl">
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-300">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>Design Workflow & Review Tracker</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Create, compare & review designs in one place
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Upload your Figma exports and live app screenshots side-by-side. Share view or edit
              links with your clients for instant feedback and review.
            </p>
          </div>

          {/* Decorative glowing background mesh */}
          <div className="absolute right-0 top-0 -mt-8 -mr-8 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl pointer-events-none" />
          <div className="absolute right-32 bottom-0 h-48 w-48 rounded-full bg-purple-600/20 blur-3xl pointer-events-none" />
        </div>

        {/* Filter Tabs & View Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-zinc-800/80 pb-4">
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-zinc-900 rounded-xl p-1">
            {([
              { key: "all", label: `All Projects`, count: projects.length },
              { key: "mine", label: "My Projects", count: projects.filter(p => userId ? p.userId === userId : true).length },
              { key: "shared", label: "Shared with me", count: projects.filter(p => userId ? p.userId !== userId : 0).length },
            ] as { key: "all" | "mine" | "shared"; label: string; count: number }[]).map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                  activeTab === key
                    ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm border border-slate-200/80 dark:border-zinc-700/80"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  activeTab === key
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400"
                }`}>{count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/90 p-1">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === "grid" ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm" : "text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"
                  }`}
                title="Grid view"
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-1.5 rounded-lg transition-colors ${viewMode === "list" ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm" : "text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-300"
                  }`}
                title="List view"
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Project Cards Grid */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {/* Create Project Dashed Card - Only shown when no projects exist */}
            {(isOwner || userEmail || userId) && filteredProjects.length === 0 && (
              <button
                type="button"
                onClick={onCreateProject}
                className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-zinc-800 hover:border-blue-500 bg-white dark:bg-zinc-900/40 hover:bg-slate-50 dark:hover:bg-zinc-900/90 p-6 min-h-[260px] text-center transition-all duration-200 hover:-translate-y-1 shadow-sm hover:shadow-xl hover:shadow-blue-500/5 cursor-pointer"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-zinc-800/80 group-hover:bg-blue-600 text-slate-500 dark:text-zinc-400 group-hover:text-white shadow-inner transition-all">
                  <Plus className="h-6 w-6 stroke-[2.5]" />
                </div>
                <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  Create new project
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500 max-w-[200px]">
                  Start a fresh design comparison workspace
                </p>
              </button>
            )}

            {/* Dynamic Project Cards */}
            {filteredProjects.map((project) => {
              const thumbnail = getFirstThumbnail(project)
              const workflowCount = project.workflows.length
              const isRenaming = renamingId === project.id
              const canEditProject = Boolean(
                isOwner ||
                userId ||
                (userEmail && userEmail.toLowerCase().includes("syntax.ai")) ||
                !project.userId ||
                (userId && project.userId === userId)
              )

              return (
                <div
                  key={project.id}
                  onClick={() =>
                    canEditProject
                      ? onSelectProject(project.id)
                      : onOpenPresentation
                        ? onOpenPresentation(project.id)
                        : onSelectProject(project.id)
                  }
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/70 hover:bg-slate-50 dark:hover:bg-zinc-900 hover:border-slate-300 dark:hover:border-zinc-700 transition-all duration-200 hover:-translate-y-1 shadow-sm hover:shadow-xl dark:shadow-black/60 cursor-pointer"
                >
                  {/* Visual Preview / Thumbnail Cover */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-zinc-800 dark:to-zinc-950 flex items-center justify-center border-b border-slate-200 dark:border-zinc-800/80">
                    {/* Action buttons on card top-right */}
                    <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5">
                      {canEditProject && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectProject(project.id)
                          }}
                          className="flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 text-xs font-semibold shadow-lg transition-all active:scale-95 cursor-pointer"
                          title="Edit project & upload photos"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>Edit</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onOpenPresentation) onOpenPresentation(project.id)
                          else onSelectProject(project.id)
                        }}
                        className="flex items-center gap-1 rounded-lg bg-slate-900/75 dark:bg-black/75 hover:bg-purple-600 text-slate-100 hover:text-white backdrop-blur-md px-2 py-1 text-xs font-semibold border border-white/10 shadow-lg transition-all active:scale-95 cursor-pointer"
                        title="Open Presentation Only"
                      >
                        <Eye className="h-3 w-3 text-purple-300" />
                        <span>View</span>
                      </button>
                    </div>

                    {thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumbnail}
                        alt={project.title}
                        className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      /* Styled Canvas Placeholder matching Figma sketches */
                      <div className="flex flex-col items-center justify-center gap-2 p-6 text-slate-400 dark:text-zinc-600 group-hover:text-slate-600 dark:group-hover:text-zinc-400 transition-colors">
                        <div className="flex gap-2">
                          <div className="h-16 w-12 rounded-lg border border-slate-300 dark:border-zinc-700/60 bg-white dark:bg-zinc-800/50 flex flex-col p-1.5 gap-1 shadow-sm">
                            <div className="h-2 w-full rounded bg-slate-200 dark:bg-zinc-700/80" />
                            <div className="h-1.5 w-3/4 rounded bg-slate-200 dark:bg-zinc-700/60" />
                          </div>
                          <div className="h-16 w-12 rounded-lg border border-blue-400/40 dark:border-blue-500/40 bg-blue-50 dark:bg-blue-950/30 flex flex-col p-1.5 gap-1 shadow-sm">
                            <div className="h-2 w-full rounded bg-blue-400/60 dark:bg-blue-500/60" />
                            <div className="h-1.5 w-3/4 rounded bg-blue-400/40 dark:bg-blue-500/40" />
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-zinc-500">
                          {workflowCount === 0 ? "Empty project" : `${workflowCount} screen workflows`}
                        </span>
                      </div>
                    )}

                    {/* Quick Start / Open Overlay */}
                    <div className="absolute inset-0 bg-slate-900/30 dark:bg-black/40 opacity-0 group-hover:opacity-100 backdrop-blur-[2px] transition-opacity flex items-center justify-center gap-2">
                      {canEditProject ? (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-blue-600/40">
                          <Pencil className="h-3.5 w-3.5" />
                          <span>Click to edit & upload photos</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-purple-600/40">
                          <Eye className="h-3.5 w-3.5" />
                          <span>Open Presentation Only</span>
                        </span>
                      )}
                    </div>

                    {/* Screen count badge */}
                    <div className="absolute bottom-2 left-2 rounded-md bg-slate-900/70 dark:bg-black/60 backdrop-blur-md px-2 py-0.5 text-[10px] font-semibold text-slate-200 dark:text-zinc-300 border border-white/10">
                      {workflowCount} {workflowCount === 1 ? "workflow" : "workflows"}
                    </div>
                  </div>

                  {/* Card Metadata Footer matching Figma */}
                  <div className="p-3.5 flex items-center justify-between gap-2 bg-white dark:bg-zinc-900/40">
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* Icon Badge */}
                      <div
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canEditProject) onSelectProject(project.id)
                          else if (onOpenPresentation) onOpenPresentation(project.id)
                          else onSelectProject(project.id)
                        }}
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg font-bold text-xs transition-colors cursor-pointer ${canEditProject
                            ? "bg-blue-500/15 border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white"
                            : "bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-600 hover:text-white"
                          }`}
                        title={canEditProject ? "Click to Edit & Upload Photos" : "Click to Open Presentation Only"}
                      >
                        {canEditProject ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        {isRenaming ? (
                          <form onSubmit={(e) => handleSaveRename(project.id, e)} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={renameTitle}
                              onChange={(e) => setRenameTitle(e.target.value)}
                              onBlur={(e) => handleSaveRename(project.id, e)}
                              className="w-full rounded border border-blue-500 bg-white dark:bg-zinc-800 px-1.5 py-0.5 text-xs text-slate-900 dark:text-white outline-none"
                            />
                          </form>
                        ) : (
                          <h4
                            className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                            title={project.title}
                          >
                            {project.title}
                          </h4>
                        )}
                        <p className="text-[10px] text-slate-500 dark:text-zinc-500 truncate">
                          {canEditProject ? "You own this project • Edit access" : "Edited recently • View only"}
                        </p>
                      </div>
                    </div>

                    {/* Actions dropdown trigger */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setMenuOpenId(menuOpenId === project.id ? null : project.id)}
                        className="rounded-lg p-1 text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Project options"
                        aria-label="Project options"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {/* Dropdown menu */}
                      {menuOpenId === project.id && (
                        <div className="absolute right-0 bottom-full mb-1 w-44 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1.5 shadow-xl dark:shadow-2xl z-30 flex flex-col gap-0.5 text-xs">
                          {canEditProject && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectProject(project.id)
                                setMenuOpenId(null)
                              }}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-zinc-200 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left"
                            >
                              <Pencil className="h-3.5 w-3.5 text-blue-500" />
                              <span>Edit & Upload Photos</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (onOpenPresentation) onOpenPresentation(project.id)
                              else onSelectProject(project.id)
                              setMenuOpenId(null)
                            }}
                            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-zinc-200 hover:bg-purple-50 dark:hover:bg-purple-950/60 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-left"
                          >
                            <Eye className="h-3.5 w-3.5 text-purple-500" />
                            <span>View Presentation</span>
                          </button>

                          {canEditProject && (
                            <button
                              type="button"
                              onClick={(e) => handleStartRename(project, e)}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-left"
                            >
                              <Pencil className="h-3.5 w-3.5 text-amber-500" />
                              <span>Rename</span>
                            </button>
                          )}

                          {onShareProject && (
                            <button
                              type="button"
                              onClick={() => {
                                onShareProject(project.id)
                                setMenuOpenId(null)
                              }}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-left"
                            >
                              <Share2 className="h-3.5 w-3.5 text-blue-400" />
                              <span>Share Link</span>
                            </button>
                          )}

                          {/* Project deletion for owners, or Reject & Remove for invited members */}
                          {project.userId === userId || !project.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                onDeleteProject(project.id, e)
                                setMenuOpenId(null)
                              }}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors text-left cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Delete project</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                onDeleteProject(project.id, e)
                                setMenuOpenId(null)
                              }}
                              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors text-left cursor-pointer font-medium"
                              title="Reject & remove this shared project from your dashboard"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Reject &amp; Remove</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          /* List View */
          <div className="divide-y divide-slate-200 dark:divide-zinc-800/80 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden shadow-sm">
            {filteredProjects.map((project) => {
              const canEditProject = Boolean(
                isOwner ||
                userId ||
                (userEmail && userEmail.toLowerCase().includes("syntax.ai")) ||
                !project.userId ||
                (userId && project.userId === userId)
              )

              return (
                <div
                  key={project.id}
                  onClick={() =>
                    canEditProject
                      ? onSelectProject(project.id)
                      : onOpenPresentation
                        ? onOpenPresentation(project.id)
                        : onSelectProject(project.id)
                  }
                  className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900/50 hover:bg-slate-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      onClick={(e) => {
                        e.stopPropagation()
                        if (canEditProject) onSelectProject(project.id)
                        else if (onOpenPresentation) onOpenPresentation(project.id)
                        else onSelectProject(project.id)
                      }}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl border font-bold text-xs transition-colors cursor-pointer ${canEditProject
                          ? "bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white"
                          : "bg-purple-500/15 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-600 hover:text-white"
                        }`}
                      title={canEditProject ? "Click to Edit & Upload Photos" : "Open Presentation Only"}
                    >
                      {canEditProject ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {project.title}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-zinc-500">
                        {project.workflows.length} workflows • {canEditProject ? "Edit access" : "View only"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {canEditProject && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectProject(project.id)
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 text-xs font-semibold shadow-md transition-all active:scale-95"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit & Upload</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onOpenPresentation) onOpenPresentation(project.id)
                        else onSelectProject(project.id)
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-zinc-800 hover:bg-purple-600 text-slate-700 dark:text-zinc-200 hover:text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-all active:scale-95"
                    >
                      <Eye className="h-3.5 w-3.5 text-purple-400" />
                      <span>View</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => onDeleteProject(project.id, e)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                      title={project.userId === userId || !project.userId ? "Delete project" : "Reject & Remove from dashboard"}
                      aria-label={project.userId === userId || !project.userId ? "Delete project" : "Reject & Remove from dashboard"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {filteredProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-zinc-800/60 border border-zinc-700/50 text-zinc-500">
              <FolderKanban className="h-8 w-8" />
            </div>
            <h3 className="text-base font-semibold text-zinc-300">No projects found</h3>
            <p className="text-xs text-zinc-500 max-w-sm">
              {searchQuery
                ? `No projects matching "${searchQuery}". Try a different search.`
                : "Create your first project to start comparing Figma designs against app screenshots."}
            </p>
            <button
              type="button"
              onClick={onCreateProject}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white transition-all shadow-md shadow-blue-600/25"
            >
              <Plus className="h-4 w-4" />
              <span>Create Project</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
