"use client"

import { useState } from "react"
import {
  Plus,
  FolderKanban,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  File,
  ArrowLeft,
  ChevronUp,
  GripVertical,
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
  onMoveWorkflowUp?: (projectId: string, workflowId: string, e: React.MouseEvent) => void
  onMoveWorkflowDown?: (projectId: string, workflowId: string, e: React.MouseEvent) => void
  onReorderWorkflows?: (projectId: string, sourceIndex: number, destinationIndex: number) => void
  onMoveProjectUp?: (projectId: string, e: React.MouseEvent) => void
  onMoveProjectDown?: (projectId: string, e: React.MouseEvent) => void
  onReorderProjects?: (sourceIndex: number, destinationIndex: number) => void
}

function InlineRenameInput({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string
  onSave: (val: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState(initialValue)

  return (
    <input
      type="text"
      value={val}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val.trim() && val !== initialValue) {
          onSave(val.trim())
        }
        onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (val.trim() && val !== initialValue) {
            onSave(val.trim())
          }
          onCancel()
        } else if (e.key === "Escape") {
          onCancel()
        }
      }}
      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white px-2 py-0.5 rounded w-full outline-none border border-blue-400 focus:ring-1 focus:ring-blue-400 text-sm"
    />
  )
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
  onMoveWorkflowUp,
  onMoveWorkflowDown,
  onReorderWorkflows,
  onMoveProjectUp,
  onMoveProjectDown,
  onReorderProjects,
}: SidebarProps) {
  const [draggedWorkflow, setDraggedWorkflow] = useState<{ projectId: string; index: number } | null>(null)
  const [dragOverWorkflow, setDragOverWorkflow] = useState<{ projectId: string; index: number } | null>(null)
  const [draggedProjectIndex, setDraggedProjectIndex] = useState<number | null>(null)
  const [dragOverProjectIndex, setDragOverProjectIndex] = useState<number | null>(null)

  return (
    <aside className="w-80 flex-shrink-0 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col shadow-sm z-10 print:hidden transition-colors select-none">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 transition-colors">
        {onBackToDashboard ? (
          <button
            type="button"
            onClick={onBackToDashboard}
            className="flex items-center gap-2 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 font-semibold text-sm transition-colors group cursor-pointer"
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
          className="p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-transparent dark:border-blue-900 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors cursor-pointer"
          title="Create new project"
          aria-label="Create new project"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {projects.map((project, pIdx) => (
          <div
            key={project.id}
            className={`mb-2 rounded-lg transition-all ${
              dragOverProjectIndex === pIdx && draggedProjectIndex !== null && draggedProjectIndex !== pIdx
                ? "ring-2 ring-blue-500 bg-blue-50/50 dark:bg-blue-950/30"
                : ""
            }`}
            onDragOver={(e) => {
              if (draggedProjectIndex !== null) {
                e.preventDefault()
                e.stopPropagation()
                setDragOverProjectIndex(pIdx)
              }
            }}
            onDragLeave={() => {
              if (dragOverProjectIndex === pIdx) setDragOverProjectIndex(null)
            }}
            onDrop={(e) => {
              if (draggedProjectIndex !== null && onReorderProjects) {
                e.preventDefault()
                e.stopPropagation()
                onReorderProjects(draggedProjectIndex, pIdx)
                setDraggedProjectIndex(null)
                setDragOverProjectIndex(null)
              }
            }}
          >
            {/* Project header (folder) */}
            <div
              draggable={isOwner && projects.length > 1}
              onDragStart={(e) => {
                if (isOwner && projects.length > 1) {
                  setDraggedProjectIndex(pIdx)
                  e.dataTransfer.effectAllowed = "move"
                }
              }}
              onDragEnd={() => {
                setDraggedProjectIndex(null)
                setDragOverProjectIndex(null)
              }}
              className={`group flex items-center justify-between w-full p-2 rounded-lg cursor-pointer transition-all ${
                activeProjectId === project.id && !activeWorkflowId
                  ? "bg-slate-100 dark:bg-slate-800/80 text-slate-900 dark:text-white font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-100"
              }`}
              onClick={() => onSelectProject(project.id)}
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
                <button
                  type="button"
                  onClick={(e) => onToggleExpand(project.id, e)}
                  className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 flex-shrink-0 cursor-pointer"
                  aria-label={project.isExpanded ? "Collapse project" : "Expand project"}
                >
                  {project.isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {editingId === `project-${project.id}` ? (
                  <InlineRenameInput
                    initialValue={project.title}
                    onSave={(newTitle) => onRenameProject(project.id, newTitle)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <span className="truncate text-sm font-medium">{project.title}</span>
                )}
              </div>

              {isOwner && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
                  {/* Project Move Up/Down when multiple projects exist */}
                  {projects.length > 1 && (
                    <>
                      <button
                        type="button"
                        disabled={pIdx === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMoveProjectUp?.(project.id, e)
                        }}
                        className={`p-1 rounded-md text-slate-400 ${
                          pIdx === 0
                            ? "opacity-25 cursor-not-allowed"
                            : "hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        }`}
                        title="Move project up"
                        aria-label="Move project up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={pIdx === projects.length - 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          onMoveProjectDown?.(project.id, e)
                        }}
                        className={`p-1 rounded-md text-slate-400 ${
                          pIdx === projects.length - 1
                            ? "opacity-25 cursor-not-allowed"
                            : "hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        }`}
                        title="Move project down"
                        aria-label="Move project down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={(e) => onCreateWorkflow(project.id, e)}
                    className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                    title="Add workflow"
                    aria-label="Add workflow"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingId(`project-${project.id}`)
                    }}
                    className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    title="Rename project"
                    aria-label="Rename project"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  {projects.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => onDeleteProject(project.id, e)}
                      className="p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 cursor-pointer"
                      title="Delete project"
                      aria-label="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Workflows (screens / files) */}
            {project.isExpanded && (
              <div className="ml-5 pl-2 border-l-2 border-slate-100 dark:border-slate-800 mt-1 space-y-0.5">
                {project.workflows.map((workflow, wIdx) => {
                  const isDraggingThis =
                    draggedWorkflow?.projectId === project.id && draggedWorkflow?.index === wIdx
                  const isDragOverThis =
                    dragOverWorkflow?.projectId === project.id &&
                    dragOverWorkflow?.index === wIdx &&
                    draggedWorkflow?.index !== wIdx

                  return (
                    <div
                      key={workflow.id}
                      draggable={isOwner && project.workflows.length > 1}
                      onDragStart={(e) => {
                        if (isOwner && project.workflows.length > 1) {
                          setDraggedWorkflow({ projectId: project.id, index: wIdx })
                          e.dataTransfer.effectAllowed = "move"
                        }
                      }}
                      onDragOver={(e) => {
                        if (draggedWorkflow && draggedWorkflow.projectId === project.id) {
                          e.preventDefault()
                          e.stopPropagation()
                          setDragOverWorkflow({ projectId: project.id, index: wIdx })
                        }
                      }}
                      onDragLeave={() => {
                        if (
                          dragOverWorkflow?.projectId === project.id &&
                          dragOverWorkflow?.index === wIdx
                        ) {
                          setDragOverWorkflow(null)
                        }
                      }}
                      onDrop={(e) => {
                        if (
                          draggedWorkflow &&
                          draggedWorkflow.projectId === project.id &&
                          onReorderWorkflows
                        ) {
                          e.preventDefault()
                          e.stopPropagation()
                          onReorderWorkflows(project.id, draggedWorkflow.index, wIdx)
                          setDraggedWorkflow(null)
                          setDragOverWorkflow(null)
                        }
                      }}
                      onDragEnd={() => {
                        setDraggedWorkflow(null)
                        setDragOverWorkflow(null)
                      }}
                      onClick={() => onSelectWorkflow(project.id, workflow.id)}
                      className={`group flex items-center justify-between w-full p-2 rounded-lg cursor-pointer transition-all ${
                        isDraggingThis ? "opacity-40 scale-95" : ""
                      } ${
                        isDragOverThis
                          ? "ring-2 ring-blue-500 bg-blue-100/60 dark:bg-blue-950/80"
                          : activeWorkflowId === workflow.id
                          ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold shadow-xs"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60 hover:text-slate-900 dark:hover:text-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
                        {isOwner && project.workflows.length > 1 && (
                          <span
                            className="text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing p-0.5 rounded transition-colors"
                            title="Drag to reorder screen"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>
                        )}

                        <File
                          className={`h-3.5 w-3.5 flex-shrink-0 ${
                            activeWorkflowId === workflow.id
                              ? "text-blue-500"
                              : "text-slate-400 dark:text-slate-500"
                          }`}
                        />

                        {editingId === `workflow-${workflow.id}` ? (
                          <InlineRenameInput
                            initialValue={workflow.title}
                            onSave={(newTitle) => onRenameWorkflow(project.id, workflow.id, newTitle)}
                            onCancel={() => setEditingId(null)}
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
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex-shrink-0">
                          {/* Move Up Button */}
                          <button
                            type="button"
                            disabled={wIdx === 0}
                            onClick={(e) => {
                              e.stopPropagation()
                              onMoveWorkflowUp?.(project.id, workflow.id, e)
                            }}
                            className={`p-1 rounded-md text-slate-400 ${
                              wIdx === 0
                                ? "opacity-25 cursor-not-allowed"
                                : "hover:bg-blue-100 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                            }`}
                            title="Move up"
                            aria-label="Move workflow up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>

                          {/* Move Down Button */}
                          <button
                            type="button"
                            disabled={wIdx === project.workflows.length - 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              onMoveWorkflowDown?.(project.id, workflow.id, e)
                            }}
                            className={`p-1 rounded-md text-slate-400 ${
                              wIdx === project.workflows.length - 1
                                ? "opacity-25 cursor-not-allowed"
                                : "hover:bg-blue-100 dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                            }`}
                            title="Move down"
                            aria-label="Move workflow down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>

                          {/* Rename Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingId(`workflow-${workflow.id}`)
                            }}
                            className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                            title="Rename screen"
                            aria-label="Rename workflow"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={(e) => onDeleteWorkflow(project.id, workflow.id, e)}
                            className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 cursor-pointer"
                            title="Delete screen"
                            aria-label="Delete workflow"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {project.workflows.length === 0 && (
                  <div className="text-xs text-slate-400 dark:text-slate-500 p-2 italic">
                    No workflows added
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  )
}
