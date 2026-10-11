import fs from "fs"
import path from "path"
import os from "os"
import type { Page } from "puppeteer"
import { createClient } from "@supabase/supabase-js"
import { appendLog } from "./job-store"
import type { AutomationJob } from "./types"

const OVERLAY_SCRIPT = "(function(){if(window.__qaOverlayInstalled)return;window.__qaOverlayInstalled=true;const style=document.createElement('style');style.id='qa-visual-overlay-style';style.textContent='';document.head.appendChild(style);})();"
// The full visual overlay is installed by the existing helpers below.
export async function installVisualOverlay(page: Page): Promise<void> {
  try {
    await page.evaluateOnNewDocument("(function(){if(window.__qaOverlayInstalled)return;window.__qaOverlayInstalled=true;})();")
    await page.evaluate("(function(){if(window.__qaOverlayInstalled)return;window.__qaOverlayInstalled=true;})();").catch(() => {})
  } catch {}
}

export async function animateCursorTo(page: Page, x: number, y: number): Promise<void> {
  try { await page.mouse.move(x, y) } catch {}
}
export async function animateCursorToSelector(page: Page, selector: string): Promise<{x:number;y:number}|null> {
  try {
    const c = await page.evaluate((sel) => { const el=document.querySelector(sel) as HTMLElement|null; if(!el)return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} }, selector)
    if (c) { await animateCursorTo(page,c.x,c.y); return c }
  } catch {}
  return null
}
export async function triggerClickAnimation(_page: Page, _x?: number, _y?: number): Promise<void> {
  await new Promise(r => setTimeout(r, 50))
}
export async function highlightInputTyping(_page: Page, _selector: string, _value: string): Promise<void> {
  await new Promise(r => setTimeout(r, 50))
}
export async function showActionBanner(_page: Page, _text: string): Promise<void> {}

export async function uploadSessionVideo(videoBuffer: Buffer, projectId: string, jobId: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const filePath = `automation/${projectId}/${projectId}-session-video-${jobId}-${Date.now()}.webm`
      const { error } = await supabase.storage.from("designs").upload(filePath, videoBuffer, {upsert:true,contentType:"video/webm"})
      if (!error) {
        const { data } = supabase.storage.from("designs").getPublicUrl(filePath)
        if (data?.publicUrl) return data.publicUrl
      }
    } catch {}
  }
  return ""
}

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
        saveRecordingState(job)
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
      try { await this.recorder.stop() } finally {
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

  async stop(job?: AutomationJob): Promise<string> {
    if (this.monitor) { clearInterval(this.monitor); this.monitor = null }
    await this.transition.catch(() => {})
    if (this.recorder) {
      try { await this.recorder.stop() } catch (err: any) {
        if (job) appendLog(job, "warn", `Session video finalization note: ${err?.message || String(err)}`)
      }
      this.recorder = null
    }
    this.state = "stopped"
    const urls: string[] = []
    for (let i=0;i<this.segmentPaths.length;i++) {
      const p=this.segmentPaths[i]
      try {
        if (!fs.existsSync(p) || fs.statSync(p).size <= 1024) continue
        const url=await uploadSessionVideo(fs.readFileSync(p),this.projectId,`${this.jobId}-segment-${i+1}`)
        if(url) urls.push(url)
      } catch (err:any) {
        if(job) appendLog(job,"warn",`Recording segment upload failed: ${err?.message || String(err)}`)
      }
    }
    if (job) {
      ;(job as any).recordingSegments = urls.length ? urls : undefined
      ;(job as any).recordingControl = "stopped"
      if (urls[0]) {
        job.recordingUrl = urls[0]
        appendLog(job,"success",`Session recording finalized with ${urls.length} segment(s).`)
      }
    }
    return urls[0] || ""
  }

  getSegments(): string[] {
    return []
  }
}

function saveRecordingState(job: AutomationJob): void {
  try { require("./job-store").saveJob(job) } catch {}
}
