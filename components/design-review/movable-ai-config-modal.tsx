"use client"

import React, { useState, useRef, useEffect } from "react"
import { GripHorizontal, Sparkles, X } from "lucide-react"
import AiConfigPanel, { AiConfigPanelProps } from "./ai-config-panel"

export interface MovableAiConfigModalProps extends Omit<AiConfigPanelProps, "onClose" | "isEmbedded"> {
  isOpen: boolean
  onClose: () => void
}

export default function MovableAiConfigModal({
  isOpen,
  onClose,
  ...panelProps
}: MovableAiConfigModalProps) {
  // Draggable window coordinates
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null)
  const isDraggingRef = useRef(false)

  // Reset position or center on open
  useEffect(() => {
    if (isOpen) {
      // Keep within viewport bounds
      setPosition((prev) => ({
        x: Math.min(Math.max(prev.x, -window.innerWidth / 2 + 200), window.innerWidth / 2 - 200),
        y: Math.min(Math.max(prev.y, -100), window.innerHeight / 2 - 100),
      }))
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from header background/labels, not interactive buttons/inputs
    if ((e.target as HTMLElement).closest("button, input, select, a")) return
    e.preventDefault()
    isDraggingRef.current = true
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position.x,
      initY: position.y,
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current || !dragRef.current) return
      const dx = moveEvent.clientX - dragRef.current.startX
      const dy = moveEvent.clientY - dragRef.current.startY
      setPosition({
        x: dragRef.current.initX + dx,
        y: dragRef.current.initY + dy,
      })
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      dragRef.current = null
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
      {/* Semi-transparent backdrop that allows clicking outside to close */}
      <div
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-2xs pointer-events-auto transition-opacity"
        onClick={onClose}
      />

      {/* Movable Floating Modal Window */}
      <div
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
        className="pointer-events-auto relative w-full max-w-xl mx-4 bg-[#0d1017] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 fade-in-50 duration-150 select-text ring-1 ring-white/10"
      >
        {/* Draggable Title Header */}
        <div
          onMouseDown={handleMouseDown}
          className="h-11 px-4 bg-gradient-to-r from-slate-900 via-[#131722] to-slate-900 border-b border-slate-800 flex items-center justify-between cursor-move select-none shrink-0"
          title="Click and drag to move this window"
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="h-4 w-4 text-slate-500 hover:text-purple-400 transition-colors" />
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span className="font-bold text-white text-xs tracking-tight">AI Vision Engine &amp; Config</span>
            <span className="text-[10px] text-purple-300 font-mono bg-purple-950/80 border border-purple-700/50 px-1.5 py-0.2 rounded">
              {panelProps.aiProvider}
            </span>
            <span className="text-[10px] text-slate-500 hidden sm:inline">· Drag anywhere to move</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Close (Esc)"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-950/60">
          <AiConfigPanel {...panelProps} onClose={onClose} isEmbedded={false} />
        </div>
      </div>
    </div>
  )
}
