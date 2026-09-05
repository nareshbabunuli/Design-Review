"use client"

import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react"
import { Loader2, Wifi, WifiOff, RefreshCw } from "lucide-react"

export interface CanvasScreencastRef {
  getScreenshot: () => string | null
}

interface CanvasScreencastProps {
  url: string
  width: number
  height: number
  accessToken?: string
  refreshToken?: string
  className?: string
}

export const CanvasScreencast = forwardRef<CanvasScreencastRef, CanvasScreencastProps>(
  ({ url, width, height, accessToken, refreshToken, className = "" }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const [isConnected, setIsConnected] = useState(false)
    const [hasFirstFrame, setHasFirstFrame] = useState(false)
    const [fps, setFps] = useState(0)
    const frameCountRef = useRef(0)
    const eventSourceRef = useRef<EventSource | null>(null)
    const [reloadKey, setReloadKey] = useState(0)

    // Expose instant screenshot capture directly from the canvas!
    useImperativeHandle(ref, () => ({
      getScreenshot: () => {
        if (!canvasRef.current) return null
        try {
          return canvasRef.current.toDataURL("image/png")
        } catch (e) {
          console.error("[CanvasScreencast] toDataURL error:", e)
          return null
        }
      },
    }))

    // Calculate FPS
    useEffect(() => {
      const interval = setInterval(() => {
        setFps(frameCountRef.current)
        frameCountRef.current = 0
      }, 1000)
      return () => clearInterval(interval)
    }, [])

    // Connect to the Server-Sent Events stream
    useEffect(() => {
      setHasFirstFrame(false)
      setIsConnected(false)

      const params = new URLSearchParams({
        url: url || "http://localhost:8082",
        width: width.toString(),
        height: height.toString(),
      })

      if (accessToken) params.append("accessToken", accessToken)
      if (refreshToken) params.append("refreshToken", refreshToken)

      const sseUrl = `/api/screencast?${params.toString()}`
      const es = new EventSource(sseUrl)
      eventSourceRef.current = es

      es.onopen = () => {
        setIsConnected(true)
      }

      let isRendering = false
      let latestBase64: string | null = null

      es.addEventListener("frame", (event: MessageEvent) => {
        const base64 = event.data
        if (!base64) return
        latestBase64 = base64

        // Always render the absolute freshest frame and drop stale ones
        if (!isRendering) {
          isRendering = true
          requestAnimationFrame(async () => {
            const frameToDraw = latestBase64
            latestBase64 = null

            if (frameToDraw && canvasRef.current) {
              const canvas = canvasRef.current
              const ctx = canvas.getContext("2d")
              if (ctx) {
                try {
                  // Fast native off-main-thread image decode via img.decode()
                  const img = new Image()
                  img.src = `data:image/jpeg;base64,${frameToDraw}`
                  await img.decode()
                  if (canvasRef.current) {
                    ctx.drawImage(img, 0, 0, width, height)
                    frameCountRef.current += 1
                    setHasFirstFrame(true)
                  }
                } catch {
                  // Fallback if decode interrupted by quick frame replacement
                }
              }
            }
            isRendering = false
          })
        }
      })

      es.onerror = (err) => {
        console.warn("[CanvasScreencast] SSE connection notice:", err)
        setIsConnected(false)
      }

      return () => {
        es.close()
        eventSourceRef.current = null
      }
    }, [url, width, height, accessToken, refreshToken, reloadKey])

    // Convert mouse coordinates on the canvas element to internal viewport coordinates
    const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current) return { x: 0, y: 0 }
      const rect = canvasRef.current.getBoundingClientRect()
      const scaleX = width / rect.width
      const scaleY = height / rect.height
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      }
    }

    const sendInput = useCallback(async (payload: any) => {
      try {
        await fetch("/api/screencast/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        })
      } catch (e) {
        console.error("[CanvasScreencast] Failed to send input:", e)
      }
    }, [])

    const [clickRipple, setClickRipple] = useState<{ x: number; y: number; id: number } | null>(null)
    const rippleIdRef = useRef(0)

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      canvasRef.current?.focus()
      const { x, y } = getCanvasCoordinates(e)

      // Instant 0ms tactile feedback dot
      const id = ++rippleIdRef.current
      setClickRipple({ x, y, id })
      setTimeout(() => {
        setClickRipple((curr) => (curr?.id === id ? null : curr))
      }, 300)

      sendInput({ type: "click", x, y, button: "left" })
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (e.key === "Tab" || e.key === "Backspace" || e.key === "Enter") {
        e.preventDefault()
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Printable character (letters, numbers, symbols, space)
        sendInput({ type: "insertText", text: e.key })
      } else {
        // Special key (Enter, Backspace, Tab, Arrows, etc.)
        sendInput({ type: "keydown", key: e.key, text: e.key })
      }
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const text = e.clipboardData.getData("text")
      if (text) {
        sendInput({ type: "insertText", text })
      }
    }

    // High-performance wheel scrolling: leading-edge immediate dispatch + batched trailing edge
    const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const accumulatedWheelRef = useRef<{ deltaX: number; deltaY: number; x: number; y: number } | null>(null)
    const lastWheelSendRef = useRef<number>(0)

    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const { x, y } = getCanvasCoordinates(e as any)
      const now = Date.now()

      // Leading-edge: send immediately if 50ms have passed since last dispatch
      if (now - lastWheelSendRef.current > 50) {
        lastWheelSendRef.current = now
        sendInput({
          type: "wheel",
          x,
          y,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
        })
        return
      }

      // Otherwise accumulate and batch for trailing edge
      if (!accumulatedWheelRef.current) {
        accumulatedWheelRef.current = { deltaX: e.deltaX, deltaY: e.deltaY, x, y }
      } else {
        accumulatedWheelRef.current.deltaX += e.deltaX
        accumulatedWheelRef.current.deltaY += e.deltaY
        accumulatedWheelRef.current.x = x
        accumulatedWheelRef.current.y = y
      }

      if (!wheelTimeoutRef.current) {
        wheelTimeoutRef.current = setTimeout(() => {
          if (accumulatedWheelRef.current) {
            lastWheelSendRef.current = Date.now()
            sendInput({
              type: "wheel",
              ...accumulatedWheelRef.current,
            })
            accumulatedWheelRef.current = null
          }
          wheelTimeoutRef.current = null
        }, 35) // Batch at ~30Hz
      }
    }

    return (
      <div className={`relative w-full h-full bg-slate-900 overflow-hidden select-none flex items-center justify-center ${className}`}>
        {/* The Live HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          tabIndex={0}
          width={width}
          height={height}
          onClick={handleClick}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          title="Click to focus and type with keyboard (or switch to Iframe mode for 0ms native speed)"
          className="w-full h-full object-contain cursor-pointer outline-none focus:ring-1 focus:ring-indigo-500/50"
        />

        {/* Instant 0ms Visual Tap Indicator */}
        {clickRipple && (
          <div
            className="absolute rounded-full bg-indigo-400/40 border border-indigo-300/80 pointer-events-none animate-ping"
            style={{
              left: `${(clickRipple.x / width) * 100}%`,
              top: `${(clickRipple.y / height) * 100}%`,
              width: 20,
              height: 20,
              transform: "translate(-50%, -50%)",
            }}
          />
        )}

        {/* Loading overlay before first frame arrives */}
        {!hasFirstFrame && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-slate-300 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <div className="text-xs font-medium text-slate-300">Starting Canvas Screencast…</div>
            <div className="text-[10px] text-slate-400">Streaming Chrome display to canvas via CDP</div>
          </div>
        )}

        {/* Floating status badge & manual reload button */}
        <div className="absolute top-2 right-2 flex items-center gap-2 pointer-events-auto z-20">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            title="Reconnect Canvas Stream"
            className="p-1 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur border border-white/10 text-slate-300 hover:text-white transition cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur border border-white/10 text-[10px] text-white font-mono pointer-events-none">
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">LIVE</span>
                {fps > 0 && <span className="text-slate-400">{fps} FPS</span>}
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-amber-400" />
                <span className="text-amber-400">Connecting...</span>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }
)

CanvasScreencast.displayName = "CanvasScreencast"
