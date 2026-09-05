import { NextRequest, NextResponse } from "next/server"
import { execFile } from "child_process"
import fs from "fs"
import path from "path"
import os from "os"
import { createClient } from "@supabase/supabase-js"

function getBrowserExecutable(): string | null {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

export async function POST(req: NextRequest) {
  let tempDir = ""
  try {
    const { url, width = 430, height = 932, workflowId } = await req.json()

    if (!workflowId) {
      return NextResponse.json({ error: "Missing workflowId" }, { status: 400 })
    }

    const browserExe = getBrowserExecutable()
    if (!browserExe) {
      return NextResponse.json({ error: "No headless browser found on host" }, { status: 500 })
    }

    const targetUrl = (url || "http://localhost:8081").trim()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-snap-"))
    const outFile = path.join(tempDir, "screenshot.png")
    const userDataDir = path.join(tempDir, "user-data")

    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      `--user-data-dir=${userDataDir}`,
      `--screenshot=${outFile}`,
      `--window-size=${Math.round(width)},${Math.round(height)}`,
      targetUrl,
    ]

    // Run headless browser with 6-second timeout
    await new Promise<void>((resolve, reject) => {
      const child = execFile(browserExe, args, { timeout: 6000 }, (err) => {
        if (err && !fs.existsSync(outFile)) {
          reject(err)
        } else {
          resolve()
        }
      })
      child.on("error", reject)
    })

    if (!fs.existsSync(outFile)) {
      return NextResponse.json(
        { error: `Could not capture screenshot of ${targetUrl}. Ensure the local server is running.` },
        { status: 502 }
      )
    }

    const imageBuffer = fs.readFileSync(outFile)

    // Upload directly to Supabase storage
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

    const supabase = createClient(supabaseUrl, supabaseKey)

    const fileName = `${workflowId}-designB-${Date.now()}.png`
    const filePath = `workflows/${workflowId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from("designs")
      .upload(filePath, imageBuffer, {
        upsert: true,
        contentType: "image/png",
      })

    if (uploadError) {
      console.error("Failed to upload screenshot to Supabase storage:", uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: pubData } = supabase.storage.from("designs").getPublicUrl(filePath)
    const publicUrl = pubData.publicUrl

    return NextResponse.json({
      success: true,
      publicUrl,
      width,
      height,
    })
  } catch (err: any) {
    console.error("Screenshot capture error:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to capture screenshot" },
      { status: 500 }
    )
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (e) {
        // ignore cleanup errors
      }
    }
  }
}
