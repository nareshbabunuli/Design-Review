import puppeteer, { Browser, Page, CDPSession } from "puppeteer"

interface ScreencastSession {
  browser: Browser
  page: Page
  cdp: CDPSession
  currentUrl: string
  width: number
  height: number
  subscribers: Set<(frame: string) => void>
  latestFrame: string | null
  isStarting: boolean
}

// Store globally in Node to avoid recreating on hot reload
const globalForScreencast = globalThis as unknown as {
  screencastSession?: ScreencastSession | null
}

export class ScreencastManager {
  private static startLock: Promise<void> | null = null

  private static async getSession(): Promise<ScreencastSession | null> {
    return globalForScreencast.screencastSession || null
  }

  public static async startSession(options: {
    url: string
    width: number
    height: number
    accessToken?: string
    refreshToken?: string
    session?: any
    rawStorageKey?: string
  }): Promise<void> {
    // If another startSession is currently in progress, wait for it to finish first
    if (this.startLock) {
      try {
        await this.startLock
      } catch (e) {}
    }

    this.startLock = this._startSessionInternal(options)
    try {
      await this.startLock
    } finally {
      this.startLock = null
    }
  }

  private static async _startSessionInternal(options: {
    url: string
    width: number
    height: number
    accessToken?: string
    refreshToken?: string
    session?: any
    rawStorageKey?: string
  }): Promise<void> {
    let current = await this.getSession()

    // Clean up if browser disconnected
    if (current && !current.browser.connected) {
      current = null
      globalForScreencast.screencastSession = null
    }

    // Reuse existing session if already running
    if (current) {
      try {
        // Update viewport if changed
        if (current.width !== options.width || current.height !== options.height) {
          current.width = options.width
          current.height = options.height
          await current.page.setViewport({
            width: Math.round(options.width),
            height: Math.round(options.height),
          })
        }

        // Navigate if URL changed
        if (current.currentUrl !== options.url) {
          current.currentUrl = options.url
          await current.page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 })
        }

        // Inject/refresh auth if provided
        if (options.accessToken) {
          await this.injectAuthIntoLivePage(current.page, options)
        }

        // Dispatch a fresh screenshot so any waiting subscribers get a frame immediately
        try {
          const freshFrame = await current.page.screenshot({
            type: "jpeg",
            quality: 60,
            encoding: "base64",
          })
          if (freshFrame) {
            current.latestFrame = freshFrame
            for (const sub of current.subscribers) {
              try {
                sub(freshFrame)
              } catch (e) {}
            }
          }
        } catch (e) {}

        return
      } catch (err) {
        console.warn("[ScreencastManager] Error updating existing page, restarting browser:", err)
        try {
          await current.browser.close()
        } catch (e) {}
        current = null
        globalForScreencast.screencastSession = null
      }
    }

    // Clean up any stale session before launching
    if (globalForScreencast.screencastSession) {
      try {
        await globalForScreencast.screencastSession.browser.close()
      } catch (e) {}
      globalForScreencast.screencastSession = null
    }

    console.log("[ScreencastManager] Launching new Chrome instance for Canvas Screencast...")
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({
      width: Math.round(options.width),
      height: Math.round(options.height),
    })

    // Inject Supabase authentication on initial document creation
    if (options.accessToken) {
      await this.injectAuthOnNewDocument(page, options)
    }

    const cdp = await page.target().createCDPSession()
    const subscribers = new Set<(frame: string) => void>()

    const newSession: ScreencastSession = {
      browser,
      page,
      cdp,
      currentUrl: options.url,
      width: options.width,
      height: options.height,
      subscribers,
      latestFrame: null,
      isStarting: false,
    }

    globalForScreencast.screencastSession = newSession

    // Set up CDP screencast frame listener
    cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
      // Immediately acknowledge frame so CDP sends the next one
      try {
        await cdp.send("Page.screencastFrameAck", { sessionId })
      } catch (e) {}

      // Cache latest frame for immediate delivery to new subscribers
      newSession.latestFrame = data

      // Broadcast to all active canvas subscribers
      for (const subscriber of newSession.subscribers) {
        try {
          subscriber(data)
        } catch (subErr) {
          console.error("[ScreencastManager] Subscriber callback error:", subErr)
        }
      }
    })

    // Navigate to page
    try {
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 25000 })
    } catch (navErr) {
      console.warn("[ScreencastManager] Initial navigation warning:", navErr)
    }

    // Start CDP continuous screencast
    try {
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: Math.round(options.width),
        maxHeight: Math.round(options.height),
        everyNthFrame: 1,
      })
    } catch (startErr) {
      console.warn("[ScreencastManager] Failed to start CDP screencast:", startErr)
    }

    // CRITICAL FIX: Take an immediate screenshot right now!
    // This guarantees the first frame is dispatched immediately, even on static pages!
    try {
      const initialFrame = await page.screenshot({
        type: "jpeg",
        quality: 60,
        encoding: "base64",
      })
      if (initialFrame) {
        newSession.latestFrame = initialFrame
        for (const subscriber of newSession.subscribers) {
          try {
            subscriber(initialFrame)
          } catch (e) {}
        }
      }
    } catch (shotErr) {
      console.warn("[ScreencastManager] Failed to capture initial screenshot:", shotErr)
    }

    console.log("[ScreencastManager] Screencast streaming started successfully!")
  }

  private static async injectAuthOnNewDocument(page: Page, options: {
    url: string
    accessToken?: string
    refreshToken?: string
    session?: any
    rawStorageKey?: string
  }): Promise<void> {
    if (!options.accessToken) return
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    let projectRef = "default"
    try {
      projectRef = new URL(supabaseUrl).hostname.split(".")[0]
    } catch (e) {}

    const storageKey = `sb-${projectRef}-auth-token`
    const fallbackKey = `supabase.auth.token`
    const sessionData = options.session || {
      access_token: options.accessToken,
      refresh_token: options.refreshToken,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated" },
    }

    await page.evaluateOnNewDocument(
      (key1, key2, key3, data) => {
        const str = JSON.stringify(data)
        localStorage.setItem(key1, str)
        localStorage.setItem(key2, str)
        if (key3) localStorage.setItem(key3, str)
      },
      storageKey,
      fallbackKey,
      options.rawStorageKey,
      sessionData
    )

    try {
      const hostname = new URL(options.url).hostname
      await page.setCookie(
        { name: "sb-access-token", value: options.accessToken, domain: hostname, path: "/" },
        { name: "sb-refresh-token", value: options.refreshToken || "", domain: hostname, path: "/" }
      )
    } catch (e) {}
  }

  private static async injectAuthIntoLivePage(page: Page, options: {
    url: string
    accessToken?: string
    refreshToken?: string
    session?: any
    rawStorageKey?: string
  }): Promise<void> {
    if (!options.accessToken) return
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
    let projectRef = "default"
    try {
      projectRef = new URL(supabaseUrl).hostname.split(".")[0]
    } catch (e) {}

    const storageKey = `sb-${projectRef}-auth-token`
    const fallbackKey = `supabase.auth.token`
    const sessionData = options.session || {
      access_token: options.accessToken,
      refresh_token: options.refreshToken,
      expires_in: 3600,
      token_type: "bearer",
      user: { id: "00000000-0000-0000-0000-000000000000", aud: "authenticated", role: "authenticated" },
    }

    await page.evaluate(
      (key1, key2, key3, data) => {
        const str = JSON.stringify(data)
        localStorage.setItem(key1, str)
        localStorage.setItem(key2, str)
        if (key3) localStorage.setItem(key3, str)
      },
      storageKey,
      fallbackKey,
      options.rawStorageKey,
      sessionData
    ).catch(() => {})

    try {
      const hostname = new URL(options.url).hostname
      await page.setCookie(
        { name: "sb-access-token", value: options.accessToken, domain: hostname, path: "/" },
        { name: "sb-refresh-token", value: options.refreshToken || "", domain: hostname, path: "/" }
      )
    } catch (e) {}
  }

  public static subscribe(callback: (frame: string) => void): () => void {
    const session = globalForScreencast.screencastSession
    if (session) {
      session.subscribers.add(callback)
      // If we already have a frame in memory, dispatch it immediately!
      if (session.latestFrame) {
        try {
          callback(session.latestFrame)
        } catch (e) {}
      }
    }

    return () => {
      if (globalForScreencast.screencastSession) {
        globalForScreencast.screencastSession.subscribers.delete(callback)
      }
    }
  }

  public static async dispatchInput(event: {
    type: "click" | "mousedown" | "mouseup" | "mousemove" | "wheel" | "keydown" | "keyup" | "insertText"
    x?: number
    y?: number
    button?: "left" | "middle" | "right"
    deltaX?: number
    deltaY?: number
    key?: string
    text?: string
  }): Promise<void> {
    const session = globalForScreencast.screencastSession
    if (!session || !session.cdp) return

    const cdp = session.cdp

    try {
      switch (event.type) {
        case "click":
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
            button: event.button || "left",
            clickCount: 1,
          })
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
            button: event.button || "left",
            clickCount: 1,
          })
          break

        case "mousedown":
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
            button: event.button || "left",
            clickCount: 1,
          })
          break

        case "mouseup":
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
            button: event.button || "left",
            clickCount: 1,
          })
          break

        case "mousemove":
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
          })
          break

        case "wheel":
          await cdp.send("Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: Math.round(event.x || 0),
            y: Math.round(event.y || 0),
            deltaX: event.deltaX || 0,
            deltaY: event.deltaY || 0,
          })
          break

        case "insertText":
          if (event.text) {
            await cdp.send("Input.insertText", { text: event.text })
          }
          break

        case "keydown":
          if (event.key === "Backspace") {
            await cdp.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              windowsVirtualKeyCode: 8,
              nativeVirtualKeyCode: 8,
              key: "Backspace",
              code: "Backspace",
            })
            await cdp.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              windowsVirtualKeyCode: 8,
              nativeVirtualKeyCode: 8,
              key: "Backspace",
              code: "Backspace",
            })
          } else if (event.key === "Enter") {
            await cdp.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              key: "Enter",
              code: "Enter",
              text: "\r",
            })
            await cdp.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              key: "Enter",
              code: "Enter",
            })
          } else if (event.key === "Tab") {
            await cdp.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              windowsVirtualKeyCode: 9,
              nativeVirtualKeyCode: 9,
              key: "Tab",
              code: "Tab",
            })
            await cdp.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              windowsVirtualKeyCode: 9,
              nativeVirtualKeyCode: 9,
              key: "Tab",
              code: "Tab",
            })
          } else if (event.text && event.text.length === 1 && !event.key?.startsWith("Arrow")) {
            await cdp.send("Input.insertText", { text: event.text })
          } else {
            await cdp.send("Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              key: event.key || "",
            })
            await cdp.send("Input.dispatchKeyEvent", {
              type: "keyUp",
              key: event.key || "",
            })
          }
          break

        case "keyup":
          break
      }

      // Immediately trigger a frame refresh after typing or clicking so the UI updates with zero lag
      if (session.page && (event.type === "click" || event.type === "keydown" || event.type === "insertText")) {
        setTimeout(async () => {
          try {
            if (!session.page) return
            const shot = await session.page.screenshot({ type: "jpeg", quality: 75, encoding: "base64" })
            if (shot) {
              session.latestFrame = shot
              for (const sub of session.subscribers) {
                try {
                  sub(shot)
                } catch (e) {}
              }
            }
          } catch (e) {}
        }, 50)
      }
    } catch (dispatchErr) {
      console.error("[ScreencastManager] Input dispatch error:", dispatchErr)
    }
  }

  public static async closeSession(): Promise<void> {
    const session = globalForScreencast.screencastSession
    if (session) {
      try {
        await session.cdp.send("Page.stopScreencast")
      } catch (e) {}
      try {
        await session.browser.close()
      } catch (e) {}
      globalForScreencast.screencastSession = null
      console.log("[ScreencastManager] Screencast session closed.")
    }
  }
}
