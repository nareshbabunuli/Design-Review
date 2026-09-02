"use client"

import {
  Plus,
  FolderKanban,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  File,
  ArrowLeft,
  LayoutGrid,
} from "lucide-react"
import type { Project, EditingId } from "@/lib/design-review-types"

type SidebarProps = {
  projects: Project[]
  activeProjectId: string | null
  activeWorkflowId: string | null
  editingId: EditingId
  isOwner?: boolean
  onBackToDashboard?: () => void
  setEditingId: (id: EditingId) => void
  onCreateProject: (e?: React.MouseEvent) => void
  onCreateWorkflow: (projectId: string, e?: React.MouseEvent) => void
  onToggleExpand: (projectId: string, e?: React.MouseEvent) => void
  onDeleteProject: (id: string, e: React.MouseEvent) => void
  onDeleteWorkflow: (projectId: string, workflowId: string, e: React.MouseEvent) => void
  onSelectProject: (projectId: string) => void
  onSelectWorkflow: (projectId: string, workflowId: string) => void
  onRenameProject: (projectId: string, title: string) => void
  onRenameWorkflow: (projectId: string, workflowId: string, title: string) => void
}

export function Sidebar({
  projects,
  activeProjectId,
  activeWorkflowId,
  editingId,
  isOwner = true,
  onBackToDashboard,
  setEditingId,
  onCreateProject,
  onCreateWorkflow,
  onToggleExpand,
  onDeleteProject,
  onDeleteWorkflow,
  onSelectProject,
  onSelectWorkflow,
  onRenameProject,
  onRenameWorkflow,
}: SidebarProps) {
  return (
    <aside className="w-80 flex-shrink-0 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-sm z-10 print:hidden transition-colors">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 transition-colors">
        {onBackToDashboard ? (
          <button
            type="button"
            onClick={onBackToDashboard}
            className="flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-semibold text-sm transition-colors group"
            title="Return to Projects Dashboard"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
            <span>All Projects</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold text-base">
            <FolderKanban className="text-blue-600 dark:text-blue-400 h-5 w-5" />
            <span>Projects</span>
          </div>
        )}
        <button
          type="button"
          onClick={(e) => onCreateProject(e)}
          className="p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-transparent dark:border-blue-900 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors"
          title="Create new project"
          aria-label="Create new project"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {projects.map((project) => (
          <div key={project.id} className="mb-2">
            {/* Project header (folder) */}
            <div
              className={`group flex items-center justify-between w-full p-2 rounded-lg cursor-pointer transition-all ${
                activeProjectId === project.id && !activeWorkflowId
                  ? "bg-slate-100 dark:bg-slate-800/80 text-slate-900 dark:text-white font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="flex items-center gap-1.5 flex-1 overflow-hidden">
                <button
                  onClick={(e) => onToggleExpand(project.id, e)}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400"
                  aria-label={project.isExpanded ? "Collapse project" : "Expand project"}
                >
                  {project.isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {editingId === `project-${project.id}` ? (
                  <input
                    type="text"
                    value={project.title}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onRenameProject(project.id, e.target.value)}
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(e) => e.key === "Enter" && setEditingId(null)}
                    className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-0.5 rounded w-full outline-none border border-blue-400 focus:ring-1 focus:ring-blue-400 text-sm"
                  />
                ) : (
                  <span className="truncate text-sm font-medium">{project.title}</span>
                )}
              </div>
              {isOwner && (
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => onCreateWorkflow(project.id, e)}
                    className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                    title="Add workflow"
                    aria-label="Add workflow"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(`project-${project.id}`)
                    }}
                    className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label="Rename project"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  {projects.length > 1 && (
                    <button
                      onClick={(e) => onDeleteProject(project.id, e)}
                      className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Workflows (files) */}
            {project.isExpanded && (
              <div className="ml-6 pl-2 border-l-2 border-slate-100 dark:border-slate-800 mt-1">
                {project.workflows.map((workflow) => (
                  <div
                    key={workflow.id}
                    onClick={() => onSelectWorkflow(project.id, workflow.id)}
                    className={`group flex items-center justify-between w-full p-2 rounded-lg cursor-pointer transition-all mb-1 ${
                      activeWorkflowId === workflow.id
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 overflow-hidden">
                      <File
                        className={`h-3.5 w-3.5 flex-shrink-0 ${
                          activeWorkflowId === workflow.id ? "text-blue-500" : "text-slate-400 dark:text-slate-500"
                        }`}
                      />

                      {editingId === `workflow-${workflow.id}` ? (
                        <input
                          type="text"
                          value={workflow.title}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onRenameWorkflow(project.id, workflow.id, e.target.value)}
                          onBlur={() => setEditingId(null)}
                          onKeyDown={(e) => e.key === "Enter" && setEditingId(null)}
                          className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-0.5 rounded w-full outline-none border border-blue-400 focus:ring-1 focus:ring-blue-400 text-sm"
                        />
                      ) : (
                        <span
                          className={`truncate text-sm ${
                            workflow.isDone ? "line-through opacity-70" : ""
                          }`}
                        >
                          {workflow.title}
                        </span>
                      )}
                    </div>
                    {isOwner && (
                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingId(`workflow-${workflow.id}`)
                          }}
                          className="p-1 rounded-md hover:bg-white dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          aria-label="Rename workflow"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => onDeleteWorkflow(project.id, workflow.id, e)}
                          className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500"
                          aria-label="Delete workflow"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {project.workflows.length === 0 && (
                  <div className="text-xs text-slate-400 dark:text-slate-500 p-2 italic">No workflows added</div>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
