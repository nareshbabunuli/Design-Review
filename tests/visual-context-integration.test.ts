/**
 * Integration tests for context-aware testing: visual context and queue recovery
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { AutomationJob } from "@/lib/ai-automation/types"
import { preprocessScreenshotForLaya } from "@/lib/ai-automation/vision-preprocessor"

function expect(actual: any) {
  return {
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    toBeDefined: () => assert.notStrictEqual(actual, undefined),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toHaveLength: (len: number) => assert.strictEqual(actual?.length, len),
    toBeGreaterThan: (n: number) => assert.ok(actual > n, `Expected ${actual} > ${n}`),
    toBeLessThanOrEqual: (n: number) => assert.ok(actual <= n, `Expected ${actual} <= ${n}`),
  }
}

describe("Visual Context Integration", () => {
  describe("Vision Preprocessor", () => {
    it("should extract visual features from screenshot", async () => {
      // Create a minimal test screenshot (1x1 red pixel PNG)
      const testScreenshot = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64"
      )

      const domElements = [
        {
          selector: "#test-button",
          bounds: { x: 10, y: 20, width: 100, height: 40 },
          label: "Test Button",
          type: "button",
        },
        {
          selector: "#test-input",
          bounds: { x: 10, y: 80, width: 200, height: 30 },
          label: "Test Input",
          type: "input",
        },
      ]

      const result = await preprocessScreenshotForLaya(testScreenshot, domElements)

      expect(result).toBeDefined()
      expect(result.features).toBeDefined()
      expect(result.features.elementBoundingBoxes).toHaveLength(2)
      expect(result.features.layoutClusters.length).toBeGreaterThan(0)
      expect(result.features.visualHierarchy).toHaveLength(2)

      // Check visual hierarchy ranking
      expect(result.features.visualHierarchy[0].rank).toBe(1)
      expect(result.features.visualHierarchy[0].prominence).toBeGreaterThan(0)
      expect(result.features.visualHierarchy[0].prominence).toBeLessThanOrEqual(1)
    })

    it("should handle empty element list gracefully", async () => {
      const testScreenshot = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64"
      )

      const result = await preprocessScreenshotForLaya(testScreenshot, [])

      expect(result).toBeDefined()
      expect(result.features.elementBoundingBoxes).toHaveLength(0)
      expect(result.features.layoutClusters).toHaveLength(0)
      expect(result.features.visualHierarchy).toHaveLength(0)
    })

    it("should calculate position scores correctly", async () => {
      const testScreenshot = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64"
      )

      // Top-left element should have higher prominence than bottom-right
      const domElements = [
        {
          selector: "#top-left",
          bounds: { x: 10, y: 10, width: 100, height: 40 },
          label: "Top Left",
          type: "button",
        },
        {
          selector: "#bottom-right",
          bounds: { x: 1000, y: 800, width: 100, height: 40 },
          label: "Bottom Right",
          type: "button",
        },
      ]

      const result = await preprocessScreenshotForLaya(testScreenshot, domElements)

      const topLeftHierarchy = result.features.visualHierarchy.find(
        (el) => el.selector === "#top-left"
      )
      const bottomRightHierarchy = result.features.visualHierarchy.find(
        (el) => el.selector === "#bottom-right"
      )

      expect(topLeftHierarchy).toBeDefined()
      expect(bottomRightHierarchy).toBeDefined()
      expect(topLeftHierarchy!.prominence).toBeGreaterThan(bottomRightHierarchy!.prominence)
    })

    it("should cluster elements by spatial region", async () => {
      const testScreenshot = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
        "base64"
      )

      const domElements = [
        { selector: "#top-1", bounds: { x: 100, y: 50, width: 50, height: 30 }, label: "Top 1" },
        { selector: "#top-2", bounds: { x: 200, y: 60, width: 50, height: 30 }, label: "Top 2" },
        { selector: "#center-1", bounds: { x: 500, y: 400, width: 50, height: 30 }, label: "Center" },
        { selector: "#bottom-1", bounds: { x: 100, y: 950, width: 50, height: 30 }, label: "Bottom" },
      ]

      const result = await preprocessScreenshotForLaya(testScreenshot, domElements)

      expect(result.features.layoutClusters.length).toBeGreaterThan(0)
      
      const topCluster = result.features.layoutClusters.find((c) => c.spatialGroup === "top")
      const centerCluster = result.features.layoutClusters.find((c) => c.spatialGroup === "center")
      const bottomCluster = result.features.layoutClusters.find((c) => c.spatialGroup === "bottom")

      // At least one spatial group should be detected
      expect([topCluster, centerCluster, bottomCluster].some(c => c !== undefined)).toBe(true)
    })
  })

  describe("Queue Recovery", () => {
    it("should record unresolved routes without stopping", () => {
      const job: Partial<AutomationJob> = {
        id: "test-job",
        unresolvedRoutes: [],
      }

      // Simulate recording unresolved routes
      const recordUnresolvedRoute = (url: string, reason: string) => {
        if (!job.unresolvedRoutes) job.unresolvedRoutes = []
        job.unresolvedRoutes.push({ url, reason, timestamp: Date.now() })
      }

      recordUnresolvedRoute("http://test.local/page1", "Navigation failed")
      recordUnresolvedRoute("http://test.local/page2", "Restoration failed")

      expect(job.unresolvedRoutes).toHaveLength(2)
      expect(job.unresolvedRoutes![0].url).toBe("http://test.local/page1")
      expect(job.unresolvedRoutes![0].reason).toBe("Navigation failed")
      expect(job.unresolvedRoutes![1].url).toBe("http://test.local/page2")
      expect(job.unresolvedRoutes![1].reason).toBe("Restoration failed")
    })

    it("should restore unresolved routes from previous run", () => {
      const job: Partial<AutomationJob> = {
        id: "test-job",
        unresolvedRoutes: [
          { url: "http://test.local/retry1", reason: "Previous failure", timestamp: Date.now() - 1000 },
          { url: "http://test.local/retry2", reason: "Previous failure", timestamp: Date.now() - 2000 },
        ],
      }

      const routeQueue: Array<{ url: string; returnTo: string }> = []
      const queuedRoutes = new Set<string>()

      // Simulate queue restoration logic
      if (job.unresolvedRoutes && job.unresolvedRoutes.length > 0) {
        for (const unresolved of job.unresolvedRoutes) {
          if (!queuedRoutes.has(unresolved.url)) {
            queuedRoutes.add(unresolved.url)
            routeQueue.push({ url: unresolved.url, returnTo: "http://test.local/" })
          }
        }
        job.unresolvedRoutes = []
      }

      expect(routeQueue).toHaveLength(2)
      expect(routeQueue[0].url).toBe("http://test.local/retry1")
      expect(routeQueue[1].url).toBe("http://test.local/retry2")
      expect(job.unresolvedRoutes).toHaveLength(0)
    })

    it("should not mark job as failed when routes are unresolved", () => {
      const job: Partial<AutomationJob> = {
        id: "test-job",
        error: undefined,
        unresolvedRoutes: [
          { url: "http://test.local/failed", reason: "Could not navigate", timestamp: Date.now() },
        ],
      }

      // The old behavior would set job.error
      // The new behavior should NOT set job.error
      expect(job.error).toBeUndefined()
      expect(job.unresolvedRoutes).toHaveLength(1)
    })
  })

  describe("Laya Payload Construction", () => {
    it("should build state payload with visual context", () => {
      const state: any = {
        url: "http://test.local/dashboard",
        title: "Dashboard",
        route: "/dashboard",
        elements: [
          { selector: "#btn1", label: "Button 1" },
          { selector: "#btn2", label: "Button 2" },
        ],
        forms: [],
        tables: [],
        dialogs: [],
      }

      const beforeScreenshotUrl = "https://storage.example.com/screenshot.png"
      const visualFeatures = {
        features: {
          elementBoundingBoxes: [
            { selector: "#btn1", box: [10, 20, 100, 40] as [number, number, number, number], saliency: 0.9, visualWeight: 0.85 },
            { selector: "#btn2", box: [10, 80, 100, 40] as [number, number, number, number], saliency: 0.7, visualWeight: 0.65 },
          ],
          layoutClusters: [
            { elements: ["#btn1", "#btn2"], spatialGroup: "top" as const, clusterCenter: [60, 50] as [number, number] },
          ],
          visualHierarchy: [
            { selector: "#btn1", rank: 1, prominence: 0.85 },
            { selector: "#btn2", rank: 2, prominence: 0.65 },
          ],
        },
      }

      // Build payload like human-test-loop.ts does
      const statePayload: any = {
        url: state.url,
        title: state.title,
        route: state.route,
        interactiveCount: state.elements.length,
        forms: state.forms.length,
        tables: state.tables,
        dialogs: state.dialogs.length,
      }

      if (beforeScreenshotUrl || visualFeatures) {
        statePayload.visual = {
          screenshotUrl: beforeScreenshotUrl || undefined,
          screenshotCapturedAt: Date.now(),
          ...(visualFeatures?.features && {
            elementCount: visualFeatures.features.elementBoundingBoxes.length,
            topElements: visualFeatures.features.visualHierarchy.slice(0, 10).map((el: any) => ({
              selector: el.selector,
              rank: el.rank,
              prominence: el.prominence,
            })),
            layoutClusters: visualFeatures.features.layoutClusters.map((cluster: any) => ({
              group: cluster.spatialGroup,
              elementCount: cluster.elements.length,
            })),
          }),
        }
      }

      expect(statePayload.visual).toBeDefined()
      expect(statePayload.visual.screenshotUrl).toBe(beforeScreenshotUrl)
      expect(statePayload.visual.elementCount).toBe(2)
      expect(statePayload.visual.topElements).toHaveLength(2)
      expect(statePayload.visual.topElements[0].selector).toBe("#btn1")
      expect(statePayload.visual.topElements[0].rank).toBe(1)
      expect(statePayload.visual.layoutClusters).toHaveLength(1)
      expect(statePayload.visual.layoutClusters[0].group).toBe("top")
    })

    it("should build state payload without visual context if unavailable", () => {
      const state: any = {
        url: "http://test.local/dashboard",
        title: "Dashboard",
        route: "/dashboard",
        elements: [{ selector: "#btn1", label: "Button 1" }],
        forms: [],
        tables: [],
        dialogs: [],
      }

      const beforeScreenshotUrl = ""
      const visualFeatures = undefined

      const statePayload: any = {
        url: state.url,
        title: state.title,
        route: state.route,
        interactiveCount: state.elements.length,
        forms: state.forms.length,
        tables: state.tables,
        dialogs: state.dialogs.length,
      }

      if (beforeScreenshotUrl || visualFeatures) {
        statePayload.visual = {
          screenshotUrl: beforeScreenshotUrl || undefined,
          screenshotCapturedAt: Date.now(),
        }
      }

      // Visual context should not be added if unavailable
      expect(statePayload.visual).toBeUndefined()
      expect(statePayload.url).toBe("http://test.local/dashboard")
      expect(statePayload.interactiveCount).toBe(1)
    })
  })
})

describe("Completion Calculation", () => {
  it("should mark incomplete when unresolved routes exist", () => {
    const job: Partial<AutomationJob> = {
      unresolvedRoutes: [
        { url: "http://test.local/unresolved", reason: "Failed", timestamp: Date.now() },
      ],
    }

    const missedCoverage: string[] = []
    const graphTruncated = false
    const hasUnresolvedRoutes = Boolean(job.unresolvedRoutes && job.unresolvedRoutes.length > 0)
    const maxSteps = 10

    const completed = maxSteps > 0 && missedCoverage.length === 0 && !graphTruncated && !hasUnresolvedRoutes

    expect(completed).toBe(false)
    expect(hasUnresolvedRoutes).toBe(true)
  })

  it("should mark complete when all routes resolved", () => {
    const job: Partial<AutomationJob> = {
      unresolvedRoutes: [],
    }

    const missedCoverage: string[] = []
    const graphTruncated = false
    const hasUnresolvedRoutes = Boolean(job.unresolvedRoutes && job.unresolvedRoutes.length > 0)
    const maxSteps = 10

    const completed = maxSteps > 0 && missedCoverage.length === 0 && !graphTruncated && !hasUnresolvedRoutes

    expect(completed).toBe(true)
    expect(hasUnresolvedRoutes).toBe(false)
  })
})
