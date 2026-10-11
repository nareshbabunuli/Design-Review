import fs from "fs"
import path from "path"
import os from "os"
import type { Page, ElementHandle } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import { appendLog, saveJob } from "./job-store"
import type { AutomationJob } from "./types"

const OVERLAY_SCRIPT = `
(function() {
  if (window.__qaOverlayInstalled) return;
  window.__qaOverlayInstalled = true;

  const style = document.createElement('style');
  style.id = 'qa-visual-overlay-style';
  style.textContent = \`
    #qa-visual-cursor {
      position: fixed;
      top: 0;
      left: 0;
      width: 24px;
      height: 24px;
      pointer-events: none;
      z-index: 2147483647;
      transform: translate(-100px, -100px);
      transition: transform 0.2s cubic-bezier(0.2, 0.9, 0.4, 1.1);
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.45));
    }
    #qa-visual-cursor svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    #qa-visual-ripple {
      position: fixed;
      top: 0;
      left: 0;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: 3px solid #f43f5e;
      background: rgba(244, 63, 94, 0.28);
      pointer-events: none;
      z-index: 2147483646;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.2);
      transition: transform 0.35s ease-out, opacity 0.35s ease-out;
    }
    #qa-visual-banner {
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      padding: 7px 18px;
      border-radius: 9999px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      pointer-events: none;
      z-index: 2147483645;
      display: none;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    }
    #qa-visual-typing {
      position: fixed;
      background: #0284c7;
      color: #ffffff;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.3);
      pointer-events: none;
      z-index: 2147483646;
      display: none;
      opacity: 0;
      transition: opacity 0.15s ease-in-out;
    }
    .qa-input-highlight {
      outline: 3px solid #0284c7 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 14px rgba(2, 132, 199, 0.5) !important;
      transition: outline 0.15s ease-in-out !important;
    }
  \`;
  document.head.appendChild(style);

  // 1. Mouse cursor element
  const cursor = document.createElement('div');
  cursor.id = 'qa-visual-cursor';
  cursor.innerHTML = \`
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 3.2L18.8 12.2L12.5 13.8L15.8 20.8L12.8 22.2L9.5 15.2L5.5 19.2V3.2Z" fill="#f43f5e" stroke="#ffffff" stroke-width="1.8"/>
    </svg>
  \`;
  document.documentElement.appendChild(cursor);

  // 2. Click ripple element
  const ripple = document.createElement('div');
  ripple.id = 'qa-visual-ripple';
  document.documentElement.appendChild(ripple);

  // 3. Top Action Banner
  const banner = document.createElement('div');
  banner.id = 'qa-visual-banner';
  document.documentElement.appendChild(banner);

  // 4. Typing Badge
  const typingBadge = document.createElement('div');
  typingBadge.id = 'qa-visual-typing';
  document.documentElement.appendChild(typingBadge);

  window.__qaMoveCursor = function(x, y) {
    cursor.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
  };

  window.__qaClickRipple = function(x, y) {
    ripple.style.transition = 'none';
    ripple.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(0.2)';
    ripple.style.opacity = '0.9';
    void ripple.offsetWidth;
    ripple.style.transition = 'transform 0.35s ease-out, opacity 0.35s ease-out';
    ripple.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(1.6)';
    ripple.style.opacity = '0';
  };

  window.__qaUpdateBanner = function(text) {
    if (!text) {
      banner.style.opacity = '0';
      setTimeout(function() { banner.style.display = 'none'; }, 200);
      return;
    }
    banner.textContent = text;
    banner.style.display = 'block';
    void banner.offsetWidth;
    banner.style.opacity = '1';
  };

  window.__qaHighlightInput = function(sel, val) {
    var el = document.querySelector(sel);
    if (!el) return;
    el.classList.add('qa-input-highlight');
    var rect = el.getBoundingClientRect();
    window.__qaMoveCursor(rect.left + rect.width / 2, rect.top + rect.height / 2);

    if (val) {
      typingBadge.textContent = 'Typing: ' + val;
      typingBadge.style.left = (rect.left) + 'px';
      typingBadge.style.top = (rect.bottom + 6) + 'px';
      typingBadge.style.display = 'block';
      typingBadge.style.opacity = '1';
    }

    setTimeout(function() {
      el.classList.remove('qa-input-highlight');
      typingBadge.style.opacity = '0';
      setTimeout(function() { typingBadge.style.display = 'none'; }, 200);
    }, 1200);
  };
})();
`

/**
 * Injects the visual cursor and interaction overlay into the page,
 * ensuring it automatically persists across navigations.
 */
export async function installVisualOverlay(page: Page): Promise<void> {
  try {
    await page.evaluateOnNewDocument(OVERLAY_SCRIPT)
    await page.evaluate(OVERLAY_SCRIPT).catch(() => {})
  } catch (err: any) {
    console.warn("[visual-recorder] Failed to inject visual overlay:", err?.message)
  }
}

/**
 * Smoothly animates the visual cursor to coordinates (x, y)
 */
export async function animateCursorTo(page: Page, x: number, y: number): Promise<void> {
  try {
    await page.evaluate((cx, cy) => {
      if (typeof (window as any).__qaMoveCursor === "function") {
        ;(window as any).__qaMoveCursor(cx, cy)
      }
    }, x, y)
    await new Promise((r) => setTimeout(r, 120))
  } catch {}
}

/**
 * Moves the visual cursor to the center of a given element selector
 */
export async function animateCursorToSelector(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  try {
    const coords = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      }
    }, selector)

    if (coords) {
      await animateCursorTo(page, coords.x, coords.y)
      return coords
    }
  } catch {}
  return null
}

/**
 * Fires the click ripple animation at (x, y) or at the element's position
 */
export async function triggerClickAnimation(page: Page, x?: number, y?: number): Promise<void> {
  try {
    if (typeof x === "number" && typeof y === "number") {
      await page.evaluate((cx, cy) => {
        if (typeof (window as any).__qaClickRipple === "function") {
          ;(window as any).__qaClickRipple(cx, cy)
        }
      }, x, y)
    }
    await new Promise((r) => setTimeout(r, 180))
  } catch {}
}

/**
 * Highlights an input field and shows the typing tooltip badge
 */
export async function highlightInputTyping(page: Page, selector: string, value: string): Promise<void> {
  try {
    await page.evaluate((sel, val) => {
      if (typeof (window as any).__qaHighlightInput === "function") {
        ;(window as any).__qaHighlightInput(sel, val)
      }
    }, selector, value)
    await new Promise((r) => setTimeout(r, 300))
  } catch {}
}

/**
 * Updates the floating action commentary banner displayed in session videos
 */
export async function showActionBanner(page: Page, text: string): Promise<void> {
  try {
    await page.evaluate((msg) => {
      if (typeof (window as any).__qaUpdateBanner === "function") {
        ;(window as any).__qaUpdateBanner(msg)
      }
    }, text)
  } catch {}
}

/**
 * Uploads a recording video buffer to Supabase designs bucket (or returns local path)
 */
export async function uploadSessionVideo(
  videoBuffer: Buffer,
  projectId: string,
  jobId: string
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const fileName = `${projectId}-session-video-${jobId}-${Date.now()}.webm`
      const filePath = `automation/${projectId}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from("designs")
        .upload(filePath, videoBuffer, { upsert: true, contentType: "video/webm" })

      if (!uploadError) {
        const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
        if (pubData?.publicUrl) return pubData.publicUrl
      }
    } catch (e: any) {
      console.warn("[visual-recorder] Supabase storage upload error:", e?.message)
    }
  }

  return ""
}

/**
 * Session Video Recorder: records headless session into a webm video
 * with full visual cursor movements, click ripples, and typing highlights.
 */
export class SessionVideoRecorder {
  private page: Page
  private projectId: string
  private jobId: string
  private recorder: any = null
  private recordingPath = ""
  private segmentPaths: string[] = []
  private transition: Promise<void> = Promise.resolve()
  private monitor: ReturnType<typeof setInterval> | null = null
  private state: "recording" | "paused" | "stopped" = "stopped"
  private finalizedUrl = ""
  private finalized = false
  private finalizationPromise: Promise<string> | null = null

  constructor(page: Page, projectId: string, jobId: string) {
    this.page = page
    this.projectId = projectId
    this.jobId = jobId
  }

  private async startSegment(): Promise<void> {
    const { PuppeteerScreenRecorder } = await import("puppeteer-screen-recorder")
    this.recordingPath = path.join(os.tmpdir(), `qa-journey-${this.jobId}-${Date.now()}.webm`)
    this.recorder = new PuppeteerScreenRecorder(this.page, {
      followNewTab: true,
      fps: 25,
      videoFrame: { width: 1440, height: 900 },
    })
    await this.recorder.start(this.recordingPath)
    this.segmentPaths.push(this.recordingPath)
    this.state = "recording"
  }

  async start(job?: AutomationJob): Promise<void> {
    try {
      await this.startSegment()
      await installVisualOverlay(this.page)
      if (job) {
        ;(job as any).recordingControl = "recording"
        saveJob(job)
        appendLog(job, "info", "Session video recording started.")
        this.monitor = setInterval(() => {
          const requested = (job as any).recordingControl
          if (requested === "paused" && this.state === "recording") void this.pause(job)
          else if (requested === "recording" && this.state === "paused") void this.resume(job)
          else if (requested === "stopped" && this.state !== "stopped") void this.stop(job)
        }, 250)
      }
    } catch (err: any) {
      this.recorder = null
      if (job) appendLog(job, "warn", `Session video recording unavailable: ${err?.message || String(err)}`)
    }
  }

  async pause(job?: AutomationJob): Promise<void> {
    this.transition = this.transition.then(async () => {
      if (this.state !== "recording" || !this.recorder) return
      try { await this.recorder.stop() }
      finally {
        this.recorder = null
        this.state = "paused"
        if (job) appendLog(job, "info", "Session video recording paused.")
      }
    })
    await this.transition
  }

  async resume(job?: AutomationJob): Promise<void> {
    this.transition = this.transition.then(async () => {
      if (this.state !== "paused") return
      try {
        await this.startSegment()
        if (job) appendLog(job, "info", "Session video recording resumed.")
      } catch (err: any) {
        this.state = "paused"
        if (job) appendLog(job, "warn", `Session video resume failed: ${err?.message || String(err)}`)
      }
    })
    await this.transition
  }

  stop(job?: AutomationJob): Promise<string> {
    if (this.finalizationPromise) return this.finalizationPromise
    this.finalizationPromise = this.finalize(job)
    return this.finalizationPromise
  }

  private async finalize(job?: AutomationJob): Promise<string> {
    if (this.finalized) return this.finalizedUrl
    if (this.monitor) { clearInterval(this.monitor); this.monitor = null }
    await this.transition.catch(() => {})
    if (this.recorder) {
      try { await this.recorder.stop() }
      catch (err: any) { if (job) appendLog(job, "warn", `Session video finalization note: ${err?.message || String(err)}`) }
      this.recorder = null
    }
    this.state = "stopped"
    const urls: string[] = []
    for (let i = 0; i < this.segmentPaths.length; i++) {
      const p = this.segmentPaths[i]
      try {
        if (!fs.existsSync(p) || fs.statSync(p).size <= 1024) continue
        const url = await uploadSessionVideo(fs.readFileSync(p), this.projectId, `${this.jobId}-segment-${i + 1}`)
        if (url) urls.push(url)
      } catch (err: any) {
        if (job) appendLog(job, "warn", `Recording segment upload failed: ${err?.message || String(err)}`)
      }
    }
    if (job) {
      ;(job as any).recordingSegments = urls.length ? urls : undefined
      ;(job as any).recordingControl = "stopped"
      if (urls[0]) {
        job.recordingUrl = urls[0]
        appendLog(job, "success", `Session recording finalized with ${urls.length} segment(s).`)
      }
    }
    this.finalizedUrl = urls[0] || ""
    this.finalized = true
    if (job) saveJob(job)
    return this.finalizedUrl
  }

  getSegments(): string[] {
    return [...this.segmentPaths]
  }
}
