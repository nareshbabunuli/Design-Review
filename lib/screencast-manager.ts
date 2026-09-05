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

function normalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    let path = u.pathname
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1)
    }
    return `${u.protocol}//${u.host}${path}${u.search}`
  } catch {
    return (rawUrl || "").trim().replace(/\/+$/, "")
  }
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

    // Clean up if browser disconnected or page was closed
    if (current && (!current.browser.connected || current.page.isClosed())) {
      try {
        await current.browser.close()
      } catch (e) {}
      current = null
      globalForScreencast.screencastSession = null
    }

    // Reuse existing session if already running and healthy
    if (current && current.browser.connected && !current.page.isClosed()) {
      try {
        // Update viewport if changed by more than 1px
        if (
          Math.abs(current.width - options.width) > 1 ||
          Math.abs(current.height - options.height) > 1
        ) {
          current.width = options.width
          current.height = options.height
          await current.page
            .setViewport({
              width: Math.round(options.width),
              height: Math.round(options.height),
            })
            .catch(() => {})
        }

        // Navigate ONLY if URL genuinely changed
        if (normalizeUrl(current.currentUrl) !== normalizeUrl(options.url)) {
          current.currentUrl = options.url
          try {
            // Fast non-fatal navigation: if it takes longer than 8s (e.g. slow dev server or websockets),
            // do not crash or restart Chrome! The page keeps loading and CDP streams frames as it renders.
            await current.page.goto(options.url, {
              waitUntil: "domcontentloaded",
              timeout: 8000,
            })
          } catch (navErr: any) {
            console.warn("[ScreencastManager] Navigation notice (streaming live while page renders):", navErr?.message || navErr)
          }
        }

        // Inject/refresh auth if provided
        if (options.accessToken) {
          await this.injectAuthIntoLivePage(current.page, options)
        }

        // Only take an immediate frame if no frame has ever arrived yet
        if (!current.latestFrame) {
          try {
            const freshFrame = await current.page.screenshot({
              type: "jpeg",
              quality: 50,
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
        }

        return
      } catch (err) {
        console.warn("[ScreencastManager] Warning updating existing page:", err)
        // CRITICAL: NEVER kill the browser unless the process has actually crashed/disconnected!
        if (!current.browser.connected || current.page.isClosed()) {
          console.warn("[ScreencastManager] Browser process lost, cleaning up for restart...")
          try {
            await current.browser.close()
          } catch (e) {}
          current = null
          globalForScreencast.screencastSession = null
        } else {
          // Browser is still alive and streaming, continue without crashing
          return
        }
      }
    }

    // Clean up any stale session before launching
    if (globalForScreencast.screencastSession) {
      try {
        await globalForScreencast.screencastSession.browser.close()
      } catch (e) {}
      globalForScreencast.screencastSession = null
    }

    console.log("[ScreencastManager] Launching fast Chrome instance for Canvas Screencast...")
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--hide-scrollbars",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-default-apps",
        "--mute-audio",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints",
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

    // Set up CDP screencast frame listener with non-blocking ACK
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      // Immediately acknowledge frame asynchronously without blocking the event loop
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})

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

    // Fast initial navigation: if it takes >10s, don't crash, let it render live
    try {
      await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 10000 })
    } catch (navErr: any) {
      console.warn("[ScreencastManager] Initial navigation notice (streaming live while page renders):", navErr?.message || navErr)
    }

    // Start CDP continuous screencast with optimized frame rate (everyNthFrame: 2 cuts CPU & bandwidth by 50%)
    try {
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 55,
        maxWidth: Math.round(options.width),
        maxHeight: Math.round(options.height),
        everyNthFrame: 2,
      })
    } catch (startErr) {
      console.warn("[ScreencastManager] Failed to start CDP screencast:", startErr)
    }

    // Dispatch an initial frame immediately if available
    try {
      const initialFrame = await page.screenshot({
        type: "jpeg",
        quality: 50,
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
