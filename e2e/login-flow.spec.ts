import { test, expect } from "@playwright/test"

test.describe("E2E Login & AI Simulator Automation", () => {
  test("should fill login form and sign in to target application", async ({ page }) => {
    // 1. Open the target application under test
    await page.goto("http://localhost:8081", { waitUntil: "domcontentloaded" })

    // 2. Locate and fill Email input (wait for splash screen to clear)
    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first()
    await emailInput.waitFor({ state: "visible", timeout: 15000 })
    await emailInput.click()
    await emailInput.pressSequentially("nareshbabu.nuli@gmail.com", { delay: 40 })
    await expect(emailInput).toHaveValue("nareshbabu.nuli@gmail.com")

    // 3. Locate and fill Password input
    const passInput = page.locator('input[type="password"], input[placeholder*="password" i]').first()
    await passInput.waitFor({ state: "visible", timeout: 5000 })
    await passInput.click()
    await passInput.pressSequentially("TestPass123!", { delay: 40 })
    await expect(passInput).toHaveValue("TestPass123!")

    // 4. Locate and click SIGN IN button
    const signInButton = page.locator('button:has-text("SIGN IN"), [role="button"]:has-text("SIGN IN"), div:has-text("SIGN IN")').last()
    await expect(signInButton).toBeVisible({ timeout: 5000 })
    await signInButton.click()

    // 5. Verification: Wait for login response (training/dashboard view loads)
    await expect(page.getByText("TRAINING").first()).toBeVisible({ timeout: 15000 })
  })

  test("should load Open Design AI interface and verify simulator controls", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect(page).toHaveTitle(/Open Design AI/i)

    // Verify main landing header and navigation
    const heading = page.locator('h1')
    await expect(heading).toContainText(/Open Design AI/i)

    // Verify Simulator button is available
    const simButton = page.locator('button:has-text("Simulator")').first()
    await expect(simButton).toBeVisible({ timeout: 5000 })
  })
})
