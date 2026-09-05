# Solution: Bypass Authentication for Screenshot Capture

## The Real Problem

The screenshot captures the **login page** because:
1. Headless Chrome runs as a **fresh browser** with no cookies/session
2. Your app at `localhost:8081` requires authentication
3. When headless Chrome visits without auth → **redirects to login** → captures login page

## The Solution

You need to make your app on `localhost:8081` **skip authentication checks for development/screenshot capture**.

## Option 1: Add a Screenshot Bypass Token (Recommended)

### In Your App (localhost:8081):

Add a special query parameter that bypasses auth:

```javascript
// In your app's middleware/auth check
export function middleware(request) {
  const url = new URL(request.url)
  
  // Special bypass for screenshot capture
  if (url.searchParams.get('screenshot_token') === process.env.SCREENSHOT_TOKEN) {
    // Skip auth check
    return NextResponse.next()
  }
  
  // Normal auth check for everyone else
  // ... your existing auth logic
}
```

### In Your .env (localhost:8081):

```bash
SCREENSHOT_TOKEN=dev-screenshot-bypass-token-12345
```

### Update the Capture URL:

In the workflow simulator, append the token:

```typescript
// When capturing, use:
const captureUrl = `${currentUrl}?screenshot_token=dev-screenshot-bypass-token-12345`
```

## Option 2: Disable Auth in Development (Simplest)

### In Your App (localhost:8081):

```javascript
// In your middleware or auth component
export function middleware(request) {
  // Skip ALL auth checks in development
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next()
  }
  
  // Normal auth check for production
  // ... your existing auth logic
}
```

**WARNING**: This disables auth for ALL dev requests, not just screenshots.

## Option 3: Detect Headless Browser

### In Your App (localhost:8081):

Detect headless Chrome and skip auth:

```javascript
// In your middleware/auth check
export function middleware(request) {
  const userAgent = request.headers.get('user-agent') || ''
  
  // Headless Chrome has "HeadlessChrome" in user agent
  if (userAgent.includes('HeadlessChrome')) {
    // Skip auth for screenshot capture
    return NextResponse.next()
  }
  
  // Normal auth check
  // ... your existing auth logic
}
```

## Option 4: Use a Dev Session Cookie

### Create a long-lived dev session:

1. Log in to your app normally
2. In DevTools Console, get your session cookie:
   ```javascript
   document.cookie
   ```
3. Copy the session cookie value

### Pass it to the capture API:

Update the capture API to accept and set cookies:

```typescript
// app/api/capture-screenshot/route.ts
const args = [
  "--headless=new",
  // ... other args
  `--cookie="session=${sessionCookie}; domain=localhost; path=/"`,
  targetUrl,
]
```

## Option 5: Manual Screenshot Upload (Works Immediately)

No code changes needed!

1. **Navigate to your authenticated page** in the iframe
2. **Take a screenshot** manually:
   - Windows: `Win + Shift + S` or Snipping Tool
   - Mac: `Cmd + Shift + 4`
3. **Click "Upload Screenshot"** button
4. **Select your screenshot file**
5. **Click "Save"**

This always works because it uses YOUR logged-in browser!

## Implementation Guide for Option 1 (Recommended)

### Step 1: Update Your App's Auth Middleware

```javascript
// In your app at localhost:8081
// File: middleware.ts or wherever your auth logic is

const SCREENSHOT_TOKEN = 'dev-screenshot-bypass-token-12345'

export function middleware(request) {
  const url = new URL(request.url)
  
  // Allow screenshot capture with token
  if (
    url.searchParams.get('screenshot_token') === SCREENSHOT_TOKEN &&
    process.env.NODE_ENV === 'development'
  ) {
    console.log('[AUTH] Screenshot bypass token detected')
    return NextResponse.next() // Skip auth
  }
  
  // Your normal auth logic continues here
  const session = await getSession(request)
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  return NextResponse.next()
}
```

### Step 2: Update the Simulator to Use Token

```typescript
// In workflow-simulator.tsx

// Add a constant at the top
const SCREENSHOT_TOKEN = 'dev-screenshot-bypass-token-12345'

// Update handleCaptureLiveFrame to append token:
const captureUrl = currentUrl.includes('?') 
  ? `${currentUrl}&screenshot_token=${SCREENSHOT_TOKEN}`
  : `${currentUrl}?screenshot_token=${SCREENSHOT_TOKEN}`

const res = await fetch("/api/capture-screenshot", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: captureUrl, // Use the modified URL with token
    width: viewportWidth,
    height: viewportHeight,
    workflowId: currentWorkflow.id,
  }),
})
```

### Step 3: Test

1. Restart both apps (your app and the review tool)
2. Click "Capture Live Frame"
3. Check the server logs - you should see `[AUTH] Screenshot bypass token detected`
4. Screenshot should show your authenticated page!

## Security Notes

⚠️ **Option 1 (Token)**: 
- Only works in development mode
- Token is in source code (not a secret in production)
- Acceptable for local dev

⚠️ **Option 2 (Disable Dev Auth)**:
- Opens your entire dev app
- Only use if app doesn't have sensitive data in dev

⚠️ **Option 3 (Detect Headless)**:
- Could be bypassed by real headless scrapers
- Only safe for dev environments

✅ **Option 5 (Manual Upload)**:
- No security concerns
- Always works
- Best backup option

## Testing Checklist

After implementing Option 1:

- [ ] Your app's middleware checks for `screenshot_token` parameter
- [ ] Token matches between your app and the simulator
- [ ] Only works when `NODE_ENV=development`
- [ ] Capture shows authenticated page, not login page
- [ ] Manual navigation still works normally (without token)

## If You Still See Login Page

1. **Check server logs** - Does your app see the token?
2. **Check the URL** - Open DevTools Network tab, verify the token is in the URL
3. **Try manual URL** - Visit `http://localhost:8081?screenshot_token=dev-screenshot-bypass-token-12345` in a regular browser - it should work
4. **Check middleware order** - Make sure auth bypass runs BEFORE your auth check

## Quick Test

Run this in your terminal:

```bash
curl "http://localhost:8081?screenshot_token=dev-screenshot-bypass-token-12345"
```

If it returns HTML (not a redirect), the bypass works!

---

**Recommended**: Use Option 1 (token bypass) for development
**Backup**: Use Option 5 (manual upload) anytime
**Production**: None of these options should be enabled in production!
