declare module "puppeteer-screen-recorder" {
  import type { Page } from "puppeteer"
  export class PuppeteerScreenRecorder {
    constructor(page: Page, options?: Record<string, unknown>)
    start(path: string): Promise<void>
    stop(): Promise<void>
  }
}
