# 🔐 Screenshot Captures Login Page - Auth Issue

## TL;DR - What's Happening

✅ **Screenshot capture is working**  
❌ **But it captures the LOGIN PAGE instead of your authenticated app**

**Why?** The headless Chrome browser has NO authentication cookies/session, so your app at `localhost:8081` redirects it to login.

---

## ✅ What We've Already Implemented

### 1. **Token-Based Bypass in the URL**
The simulator now appends `?screenshot_token=screenshot_bypass_dev_token_12345` to all capture requests.

**File**: `components/design-review/workflow-simulator.tsx` (line ~697-701)

### 2. **Supabase Auth Token Passing**
The simulator passes your Supabase session tokens to the capture API:
```typescript
accessToken: session?.access_token,
refreshToken: session?.refresh_token,
```

**File**: `components/design-review/workflow-simulator.tsx` (line ~723-732)

### 3. **Cookie File Writing (Attempted)**
The API tries to write Supabase cookies to a file for Chrome to use.

**File**: `app/api/capture-screenshot/route.ts` (line ~18-43)

**Note**: This may not work with `execFile` Chrome - cookies might not be read.

---

## ⚠️ The Problem

**Chrome's `execFile` with `--headless=new` doesn't easily support cookie injection.**

The cookies file we write likely isn't being read by Chrome, so the headless browser still has no auth.

---

## 🎯 The Solution

You have **THREE options**:

---

### Option 1: Modify Your App (localhost:8081) - **RECOMMENDED**

This is the **cleanest and most reliable solution**.

#### Step 1: Find Your Auth Middleware

Look for files like:
- `middleware.ts`
- `middleware.js`  
- Auth guards in your route handlers
- `_app.tsx` / `_app.js` auth checks

#### Step 2: Add Auth Bypass for Dev

```typescript
// middleware.ts or your auth check
export function middleware(request: Request) {
  const url = new URL(request.url)
  
  // 🔓 Bypass authentication for screenshot capture (dev only)
  if (
    url.searchParams.get('screenshot_token') === 'screenshot_bypass_dev_token_12345' &&
    process.env.NODE_ENV === 'development'
  ) {
    console.log('[AUTH] Screenshot bypass token detected - skipping auth')
    return NextResponse.next() // Skip authentication
  }
  
  // ... your normal auth logic continues here
  const session = await getSession(request)
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  
  return NextResponse.next()
}
```

**Security**: This only works when `NODE_ENV=development`, so it's completely safe.

#### Step 3: Test

```bash
# Visit this URL in your browser:
http://localhost:8081?screenshot_token=screenshot_bypass_dev_token_12345
```

**Expected**: Should show your app content (not login page)

#### Step 4: Try Capture Button

Click "Capture Live Frame" in the workflow simulator - should now capture authenticated content!

---

### Option 2: Switch to Puppeteer (More Complex)

If you can't modify your app, we could switch from Chrome `execFile` to Puppeteer, which supports proper cookie injection.

**Steps**:
1. Install Puppeteer: `npm install puppeteer`
2. Rewrite the API route to use Puppeteer
3. Set cookies properly with `page.setCookie()`

**Downside**: Puppeteer is ~300MB and slower to install. Would need significant API rewrite.

---

### Option 3: Manual Screenshot Upload (Works NOW)

**No code changes required!**

1. **Navigate to your page** in the iframe (while logged in)
2. **Take a screenshot**:
   - Windows: `Win + Shift + S` or Snipping Tool
   - Mac: `Cmd + Shift + 4`
3. **Click "Upload Screenshot"** button in the UI
4. **Select your screenshot file**
5. **Click "Save"**

This always works because it uses YOUR authenticated browser session!

---

## 🔍 Debugging

### Check What's Being Captured

Look at the server logs when you click "Capture Live Frame":

```
[DEBUG API] Target URL: http://localhost:8081?screenshot_token=screenshot_bypass_dev_token_12345
[DEBUG API] Has auth tokens: {accessToken: true, refreshToken: true}
[DEBUG API] Created cookies file: C:\Users\...\cookies.txt
[DEBUG API] Screenshot file created successfully
```

### Check Your App

In your app at localhost:8081, add logging:

```typescript
console.log('[AUTH] Checking request:', request.url)
console.log('[AUTH] screenshot_token:', url.searchParams.get('screenshot_token'))
console.log('[AUTH] NODE_ENV:', process.env.NODE_ENV)
```

You should see:
```
[AUTH] Checking request: http://localhost:8081/?screenshot_token=screenshot_bypass_dev_token_12345
[AUTH] screenshot_token: screenshot_bypass_dev_token_12345
[AUTH] NODE_ENV: development
[AUTH] Screenshot bypass token detected - skipping auth
```

If you don't see `[AUTH] Screenshot bypass token detected`, the bypass isn't working.

---

## 📋 Summary

| What | Status | Location |
|------|--------|----------|
| Token in URL | ✅ Done | `workflow-simulator.tsx` |
| Supabase tokens sent | ✅ Done | `workflow-simulator.tsx` |
| Cookie file writing | ✅ Done (may not work) | `route.ts` |
| **Auth bypass in your app** | ⏳ **YOUR TURN** | **Your app at localhost:8081** |

---

## 🚀 Quick Start (Option 1)

1. Open your app's authentication middleware at `localhost:8081`
2. Add the bypass code above (check for `screenshot_token` parameter)
3. Restart your app
4. Test: Visit `http://localhost:8081?screenshot_token=screenshot_bypass_dev_token_12345`
5. If that shows your app (not login), try the "Capture Live Frame" button!

---

## 🆘 Need Help?

Let me know:
- **What framework** your app uses (Next.js, Express, React, etc.)
- **Where your auth logic is** located
- **Any errors** you see in the logs

I can provide framework-specific code examples!

---

## 📚 Related Documentation

- `SOLUTION_AUTHENTICATION_BYPASS.md` - Detailed bypass implementation guide
- `FINAL_IMPLEMENTATION_STATUS.md` - Complete implementation status
- `SCREENSHOT_SAVE_TROUBLESHOOTING.md` - Troubleshooting guide
