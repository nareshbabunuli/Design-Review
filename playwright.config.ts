import { defineConfig, devices } from "@playwright/test"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = process.env.PORT || 3000
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

/**
 * Official Next.js Playwright Configuration
 * @see https://nextjs.org/docs/app/guides/testing/playwright
 */
export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  timeout: 45 * 1000,
  retries: 1,
  outputDir: "test-results/",

  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    timeout: 120 * 1000,
    reuseExistingServer: true,
  },

  use: {
    baseURL: BASE_URL,
    trace: "retry-with-trace",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "Mobile Chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
})
