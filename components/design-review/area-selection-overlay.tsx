"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { Maximize2, X, Camera } from "lucide-react"

interface AreaSelectionOverlayProps {
  isActive: boolean
  containerWidth: number
  containerHeight: number
  scale: number
  selectionBoxRef: React.RefObject<HTMLDivElement | null>
  onCapture: (cropBox?: { x: number; y: number; width: number; height: number }) => void
  onCaptureFullScreen?: () => void
  onClose: () => void
  isCapturing: boolean
}

type ResizeHandle = "nw" | "ne" | "sw" | "se"

export function AreaSelectionOverlay({
  isActive,
  containerWidth,
  containerHeight,
  scale,
  selectionBoxRef,
  onCapture,
  onCaptureFullScreen,
  onClose,
  isCapturing,
}: AreaSelectionOverlayProps) {
  // Selection box coordinates inside container - defaults to 100% full screen
  const [box, setBox] = useState({
    x: 0,
    y: 0,
    width: containerWidth,
    height: containerHeight,
  })

  // Track previous container dimensions to intelligently preserve crop box across preset changes
  const prevDimensionsRef = useRef({ width: containerWidth, height: containerHeight })

  useEffect(() => {
    const prevWidth = prevDimensionsRef.current.width
    const prevHeight = prevDimensionsRef.current.height
    prevDimensionsRef.current = { width: containerWidth, height: containerHeight }

    setBox((prev) => {
      // If was previously full screen (or within 2px tolerance), maintain 100% full screen for new preset
      const wasFullScreen =
        prev.x === 0 &&
        prev.y === 0 &&
        Math.abs(prev.width - prevWidth) <= 2 &&
        Math.abs(prev.height - prevHeight) <= 2

      if (wasFullScreen) {
        return {
          x: 0,
          y: 0,
          width: containerWidth,
          height: containerHeight,
        }
      }

      // Otherwise preserve the crop box but clamp cleanly within the new container boundaries
      const clampedW = Math.min(containerWidth, Math.max(40, prev.width))
      const clampedH = Math.min(containerHeight, Math.max(40, prev.height))
      const clampedX = Math.max(0, Math.min(containerWidth - clampedW, prev.x))
      const clampedY = Math.max(0, Math.min(containerHeight - clampedH, prev.y))

      return {
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH,
      }
    })
  }, [containerWidth, containerHeight])

  // Dragging & resizing state using Pointer Capture
  const interactionRef = useRef<{
    type: "none" | "drag" | "resize"
    handle: ResizeHandle | null
    pointerId: number | null
    startX: number
    startY: number
    startBoxX: number
    startBoxY: number
    startWidth: number
    startHeight: number
  }>({
    type: "none",
    handle: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    startBoxX: 0,
    startBoxY: 0,
    startWidth: 0,
    startHeight: 0,
  })

  // Start dragging the selection box
  const handleBoxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // If target is a handle or button, ignore box drag
    const target = e.target as HTMLElement
    if (target.closest(".resize-handle") || target.closest(".toolbar-action")) return

    e.preventDefault()
    e.stopPropagation()

    const activeScale = scale > 0 ? scale : 1
    interactionRef.current = {
      type: "drag",
      handle: null,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startBoxX: box.x,
      startBoxY: box.y,
      startWidth: box.width,
      startHeight: box.height,
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Fallback if browser doesn't support capture on this element
    }
  }

  // Start resizing via a corner handle
  const handleResizePointerDown = (handle: ResizeHandle, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    interactionRef.current = {
      type: "resize",
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startBoxX: box.x,
      startBoxY: box.y,
      startWidth: box.width,
      startHeight: box.height,
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Fallback
    }
  }

  // Unified pointer move listener
  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      const { type, handle, startX, startY, startBoxX, startBoxY, startWidth, startHeight } =
        interactionRef.current
      if (type === "none") return

      const activeScale = scale > 0 ? scale : 1
      const dx = (e.clientX - startX) / activeScale
      const dy = (e.clientY - startY) / activeScale
      const minSize = 40

      if (type === "drag") {
        const maxX = Math.max(0, containerWidth - startWidth)
        const maxY = Math.max(0, containerHeight - startHeight)
        const newX = Math.max(0, Math.min(maxX, startBoxX + dx))
        const newY = Math.max(0, Math.min(maxY, startBoxY + dy))

        setBox((prev) => ({
          ...prev,
          x: Math.round(newX),
          y: Math.round(newY),
        }))
      } else if (type === "resize" && handle) {
        setBox((prev) => {
          let newX = prev.x
          let newY = prev.y
          let newWidth = prev.width
          let newHeight = prev.height

          if (handle === "se") {
            // South-East: top-left is fixed
            const maxW = containerWidth - startBoxX
            const maxH = containerHeight - startBoxY
            newWidth = Math.max(minSize, Math.min(maxW, startWidth + dx))
            newHeight = Math.max(minSize, Math.min(maxH, startHeight + dy))
            newX = startBoxX
            newY = startBoxY
          } else if (handle === "sw") {
            // South-West: top-right is fixed
            const rightEdge = startBoxX + startWidth
            const maxH = containerHeight - startBoxY
            const targetX = startBoxX + dx
            newX = Math.max(0, Math.min(rightEdge - minSize, targetX))
            newWidth = rightEdge - newX
            newHeight = Math.max(minSize, Math.min(maxH, startHeight + dy))
            newY = startBoxY
          } else if (handle === "ne") {
            // North-East: bottom-left is fixed
            const bottomEdge = startBoxY + startHeight
            const maxW = containerWidth - startBoxX
            const targetY = startBoxY + dy
            newY = Math.max(0, Math.min(bottomEdge - minSize, targetY))
            newHeight = bottomEdge - newY
            newWidth = Math.max(minSize, Math.min(maxW, startWidth + dx))
            newX = startBoxX
          } else if (handle === "nw") {
            // North-West: bottom-right is fixed
            const rightEdge = startBoxX + startWidth
            const bottomEdge = startBoxY + startHeight
            const targetX = startBoxX + dx
            const targetY = startBoxY + dy
            newX = Math.max(0, Math.min(rightEdge - minSize, targetX))
            newY = Math.max(0, Math.min(bottomEdge - minSize, targetY))
            newWidth = rightEdge - newX
            newHeight = bottomEdge - newY
          }

          return {
            x: Math.round(newX),
            y: Math.round(newY),
            width: Math.round(newWidth),
            height: Math.round(newHeight),
          }
        })
      }
    },
    [containerWidth, containerHeight, scale]
  )

  const handlePointerUp = useCallback(() => {
    interactionRef.current = {
      type: "none",
      handle: null,
      pointerId: null,
      startX: 0,
      startY: 0,
      startBoxX: 0,
      startBoxY: 0,
      startWidth: 0,
      startHeight: 0,
    }
  }, [])

  useEffect(() => {
    if (!isActive) return

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [isActive, handlePointerMove, handlePointerUp])

  const boxRef = useRef(box)
  boxRef.current = box

  // Keyboard navigation & operability:
  // - Arrow keys: nudge position
  // - Alt + Arrow keys: resize
  // - Shift + Arrow keys: 10px step instead of 1px
  // - Escape: close overlay
  // - Enter: trigger capture
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is typing in form field
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return
      }

      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        e.stopPropagation()
        if (!isCapturing) {
          onCapture(boxRef.current)
        }
        return
      }

      const step = e.shiftKey ? 10 : 1

      if (e.altKey) {
        // Alt + Arrow keys: Resize
        if (e.key === "ArrowRight") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            width: Math.min(containerWidth - prev.x, Math.max(40, prev.width + step)),
          }))
        } else if (e.key === "ArrowLeft") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            width: Math.max(40, prev.width - step),
          }))
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            height: Math.min(containerHeight - prev.y, Math.max(40, prev.height + step)),
          }))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            height: Math.max(40, prev.height - step),
          }))
        }
      } else {
        // Arrow keys: Move / Nudge
        if (e.key === "ArrowLeft") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            x: Math.max(0, prev.x - step),
          }))
        } else if (e.key === "ArrowRight") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            x: Math.min(containerWidth - prev.width, prev.x + step),
          }))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            y: Math.max(0, prev.y - step),
          }))
        } else if (e.key === "ArrowDown") {
          e.preventDefault()
          setBox((prev) => ({
            ...prev,
            y: Math.min(containerHeight - prev.height, prev.y + step),
          }))
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isActive, containerWidth, containerHeight, isCapturing, onCapture, onClose])

  const snapToFullScreen = useCallback(() => {
    setBox({
      x: 0,
      y: 0,
      width: containerWidth,
      height: containerHeight,
    })
  }, [containerWidth, containerHeight])

  if (!isActive) return null

  // Flip toolbar inside the box when box is near the top edge (< 44px) so it is never clipped
  const isToolbarInside = box.y < 44

  return (
    <div
      id="area-selection-overlay-root"
      className="absolute inset-0 z-40 pointer-events-auto select-none overflow-hidden transition-opacity duration-75 touch-none"
    >
      {/* Dimmed backdrop outside selection box */}
      <div className="absolute inset-0 bg-black/30 pointer-events-none" />

      {/* The Selection Box */}
      <div
        ref={selectionBoxRef}
        onPointerDown={handleBoxPointerDown}
        style={{
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
        }}
        className="absolute border-2 border-dashed border-indigo-500 bg-indigo-500/15 cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] transition-shadow pointer-events-auto touch-none"
      >
        {/* Dimensions Badge & Floating Action Bar */}
        {/* Flips inside when box.y < 44px to prevent overflowing off-screen */}
        <div
          className={`toolbar-action absolute flex items-center justify-between gap-1 pointer-events-auto z-50 transition-all duration-150 ${
            isToolbarInside
              ? "top-2 left-2 right-2 bg-slate-950/90 backdrop-blur-md p-1.5 rounded-lg border border-white/20 shadow-xl"
              : "-top-11 left-0 right-0 py-0.5"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded bg-indigo-950/95 text-white font-mono text-[10px] font-semibold shadow-md border border-indigo-500/50 backdrop-blur-xs whitespace-nowrap">
              {box.width} × {box.height}px
            </span>
            <button
              type="button"
              onClick={() => {
                if (onCaptureFullScreen) {
                  onCaptureFullScreen()
                } else {
                  snapToFullScreen()
                }
              }}
              disabled={isCapturing}
              className="px-2 py-0.5 rounded bg-slate-900/90 hover:bg-slate-800 text-white text-[10px] font-medium shadow border border-white/20 flex items-center gap-1 cursor-pointer transition whitespace-nowrap disabled:opacity-50"
              title="Capture 100% full device preview without cropping"
            >
              <Maximize2 className="w-2.5 h-2.5" />
              <span>Full Screen</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onCapture(box)}
              disabled={isCapturing}
              className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-[11px] font-semibold shadow-md border border-emerald-400/50 flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
              title="Capture selected area (Enter)"
            >
              <Camera className="w-3 h-3" />
              <span>{isCapturing ? "Snapping..." : "Capture Area"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md bg-slate-900/90 hover:bg-rose-900 text-white shadow border border-white/20 cursor-pointer transition"
              title="Close selection tool (Esc)"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 4 Corner Resize Handles with touch-friendly hit areas */}
        <div
          onPointerDown={(e) => handleResizePointerDown("nw", e)}
          className="resize-handle absolute -top-2 -left-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white cursor-nwse-resize shadow-md hover:scale-125 transition-transform touch-none"
          title="Resize top-left"
        />
        <div
          onPointerDown={(e) => handleResizePointerDown("ne", e)}
          className="resize-handle absolute -top-2 -right-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white cursor-nesw-resize shadow-md hover:scale-125 transition-transform touch-none"
          title="Resize top-right"
        />
        <div
          onPointerDown={(e) => handleResizePointerDown("sw", e)}
          className="resize-handle absolute -bottom-2 -left-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white cursor-nesw-resize shadow-md hover:scale-125 transition-transform touch-none"
          title="Resize bottom-left"
        />
        <div
          onPointerDown={(e) => handleResizePointerDown("se", e)}
          className="resize-handle absolute -bottom-2 -right-2 w-4 h-4 rounded-full bg-indigo-500 border-2 border-white cursor-nwse-resize shadow-md hover:scale-125 transition-transform touch-none"
          title="Resize bottom-right"
        />
      </div>
    </div>
  )
}
