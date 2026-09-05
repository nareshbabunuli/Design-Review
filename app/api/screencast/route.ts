import { NextRequest } from "next/server"
import { ScreencastManager } from "@/lib/screencast-manager"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get("url") || "http://localhost:8082"
  const width = parseInt(searchParams.get("width") || "393", 10)
  const height = parseInt(searchParams.get("height") || "852", 10)
  const accessToken = searchParams.get("accessToken") || undefined
  const refreshToken = searchParams.get("refreshToken") || undefined

  // Start or reuse the screencast session
  try {
    await ScreencastManager.startSession({
      url,
      width,
      height,
      accessToken,
      refreshToken,
    })
  } catch (err) {
    console.error("[API /api/screencast] Failed to start screencast session:", err)
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // 1. Immediately send connected comment to flush HTTP response headers
      // This prevents EventSource from timing out or throwing connection errors!
      controller.enqueue(encoder.encode(": connected\n\n"))

      // 2. Keepalive heartbeat every 15s to keep connection open through proxies
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"))
        } catch (e) {
          clearInterval(heartbeat)
        }
      }, 15000)

      // 3. Subscribe to frames. If latestFrame is already cached in memory,
      // ScreencastManager immediately calls this callback with the frame!
      let lastSent = 0
      const unsubscribe = ScreencastManager.subscribe((base64Frame: string) => {
        try {
          const now = Date.now()
          // Drop frames if stream buffer is full or arriving faster than ~30 FPS
          // This eliminates bufferbloat lag so the client always sees the real-time frame!
          if (now - lastSent < 32 || (controller.desiredSize !== null && controller.desiredSize <= 0)) {
            return
          }
          lastSent = now
          const payload = `event: frame\ndata: ${base64Frame}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch (e) {
          clearInterval(heartbeat)
          unsubscribe()
        }
      })

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch (e) {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
