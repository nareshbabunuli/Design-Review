# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: login-flow.spec.ts >> E2E Login & AI Simulator Automation >> should load Open Design AI interface and verify simulator controls
- Location: e2e\login-flow.spec.ts:31:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('h1')
Expected pattern: /Open Design AI/i
Error: element(s) not found

Call log:
  - Expect "toContainText" locator('h1') with timeout 5000ms
  - waiting for locator('h1')
  - Target page, context or browser has been closed

```

```yaml
- main: Loading workspace...
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | 
  3  | test.describe("E2E Login & AI Simulator Automation", () => {
  4  |   test("should fill login form and sign in to target application", async ({ page }) => {
  5  |     // 1. Open the target application under test
  6  |     await page.goto("http://localhost:8081", { waitUntil: "domcontentloaded" })
  7  | 
  8  |     // 2. Locate and fill Email input (wait for splash screen to clear)
  9  |     const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]').first()
  10 |     await emailInput.waitFor({ state: "visible", timeout: 15000 })
  11 |     await emailInput.click()
  12 |     await emailInput.pressSequentially("nareshbabu.nuli@gmail.com", { delay: 40 })
  13 |     await expect(emailInput).toHaveValue("nareshbabu.nuli@gmail.com")
  14 | 
  15 |     // 3. Locate and fill Password input
  16 |     const passInput = page.locator('input[type="password"], input[placeholder*="password" i]').first()
  17 |     await passInput.waitFor({ state: "visible", timeout: 5000 })
  18 |     await passInput.click()
  19 |     await passInput.pressSequentially("TestPass123!", { delay: 40 })
  20 |     await expect(passInput).toHaveValue("TestPass123!")
  21 | 
  22 |     // 4. Locate and click SIGN IN button
  23 |     const signInButton = page.locator('button:has-text("SIGN IN"), [role="button"]:has-text("SIGN IN"), div:has-text("SIGN IN")').last()
  24 |     await expect(signInButton).toBeVisible({ timeout: 5000 })
  25 |     await signInButton.click()
  26 | 
  27 |     // 5. Verification: Wait for login response (training/dashboard view loads)
  28 |     await expect(page.getByText("TRAINING").first()).toBeVisible({ timeout: 15000 })
  29 |   })
  30 | 
  31 |   test("should load Open Design AI interface and verify simulator controls", async ({ page }) => {
  32 |     await page.goto("/", { waitUntil: "domcontentloaded" })
  33 |     await expect(page).toHaveTitle(/Open Design AI/i)
  34 | 
  35 |     // Verify main landing header and navigation
  36 |     const heading = page.locator('h1')
> 37 |     await expect(heading).toContainText(/Open Design AI/i)
     |                           ^ Error: expect(locator).toContainText(expected) failed
  38 | 
  39 |     // Verify Simulator button is available
  40 |     const simButton = page.locator('button:has-text("Simulator")').first()
  41 |     await expect(simButton).toBeVisible({ timeout: 5000 })
  42 |   })
  43 | })
  44 | 
```