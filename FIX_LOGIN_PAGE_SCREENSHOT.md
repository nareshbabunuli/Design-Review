# Fix: Screenshot Captures Login Page Instead of App

## Problem

The screenshot always captures the **login page** instead of your actual authenticated app because:

1. **Headless Chrome starts fresh** - No cookies, no authentication, no session
2. **Your app redirects to login** - When an unauthenticated browser visits `http://localhost:8081`, it redirects to login
3. **Server-side capture can't access your session** - The API route can't see your browser's authentication cookies

## Solution: Client-Side Capture with html2canvas

I've updated the code to **capture directly from the iframe** in your browser, which maintains your authentication. This is the best solution because:

✅ Uses your existing authenticated session  
✅ Captures exactly what you see in the iframe  
✅ No need to manage cookies or tokens  
✅ Falls back to server-side if cross-origin issues occur  

## Installation Required

Install the html2canvas library:

```bash
cd d:\wamp64\www\design-workflow-tracker
npm install html2canvas
```

## How It Works Now

### Step 1: Try Client-Side Capture (New!)
```typescript
// Access the iframe document directly
const iframeDoc = iframeRef.current.contentDocument

// Capture using html2canvas (preserves your login state!)
const canvas = await html2canvas(iframeDoc.body, {
  width: viewportWidth,
  height: viewportHeight,
  useCORS: true,
  allowTaint: true,
})

// Convert to PNG and upload to Supabase
const captureDataUrl = canvas.toDataURL('image/png')
```

### Step 2: Fallback to Server-Side (if needed)
If the iframe is cross-origin (different domain), it falls back to the server-side capture.

## Testing After Fix

1. **Install html2canvas**:
   ```bash
   npm install html2canvas
   ```

2. **Make sure you're logged in** to your app at `http://localhost:8081`

3. **Navigate in the iframe** to the page you want to capture

4. **Click "Capture Live Frame"**

5. **Expected Result**: Screenshot of the authenticated page, not the login page!

## Why This Works

**Before (broken)**:
```
Your Browser (logged in) → API Route → Fresh Headless Chrome (NOT logged in) 
→ localhost:8081 → Redirects to Login → Captures Login Page ❌
```

**After (fixed)**:
```
Your Browser (logged in) → Iframe (already logged in) → html2canvas 
→ Captures from YOUR session → Correct page ✅
```

## Alternative Solutions

If the html2canvas approach doesn't work for your use case:

### Option A: Disable Authentication in Dev
For localhost dev servers, you can often disable auth checks:

```javascript
// In your app's middleware or auth config
if (process.env.NODE_ENV === 'development') {
  // Skip auth for local development
  return next()
}
```

### Option B: Use a Dev Token
Some apps support a dev/test token:

1. Generate a long-lived dev token
2. Pass it in the URL: `http://localhost:8081?token=dev-token-here`
3. Your app accepts the token and authenticates automatically

### Option C: Screenshot After Manual Navigation
1. Keep the iframe view showing your app (after login)
2. Click "Capture Live Frame"
3. The capture happens from the iframe's current state

### Option D: Use Puppeteer (Advanced)
Replace the API route with Puppeteer for better cookie/auth handling:

```bash
npm install puppeteer
```

```typescript
// In API route
const browser = await puppeteer.launch()
const page = await browser.newPage()

// Set cookies from your session
await page.setCookie({
  name: 'session',
  value: 'your-session-cookie',
  domain: 'localhost',
  path: '/',
})

await page.goto(url)
await page.screenshot({ path: 'screenshot.png' })
```

## Troubleshooting

### Issue 1: "Cannot access iframe document - may be cross-origin"

**Cause**: Your app is on a different port or domain than the review tool

**Solution**: 
- Make sure both are on `localhost` (not mixing localhost/127.0.0.1)
- Use the same protocol (both http:// or both https://)
- Or use the manual screenshot upload feature instead

### Issue 2: html2canvas captures blank/white page

**Cause**: Page hasn't finished loading or uses canvas/WebGL

**Solutions**:
- Wait a moment after navigation before capturing
- Check if your app uses canvas (html2canvas has issues with canvas)
- Use the "Upload Screenshot" button and take a manual screenshot

### Issue 3: Images missing in capture

**Cause**: CORS issues with images

**Solution**: Already handled with `useCORS: true` and `allowTaint: true`

### Issue 4: Still captures login page

**Causes**:
1. You're not actually logged in to the iframe
2. Session expired
3. Cross-origin preventing access (falls back to server-side)

**Solutions**:
1. Log in manually in the iframe first
2. Refresh your session
3. Use manual screenshot upload as workaround

## Manual Screenshot Upload (Always Works)

As a backup, you can always:

1. **Navigate to your page** in the iframe
2. **Take a screenshot** (Windows: Win + Shift + S, or use Snipping Tool)
3. **Click "Upload Screenshot"**
4. **Select your screenshot file**
5. **Click "Save this screenshot"**

This always works regardless of authentication, cross-origin, or any other issues!

## Files Modified

- ✅ `components/design-review/workflow-simulator.tsx` - Added client-side html2canvas capture
- ✅ `app/api/capture-screenshot/route.ts` - Enhanced for debugging (still available as fallback)

## Quick Summary

**The Fix**: 
```bash
npm install html2canvas
```

Then restart your dev server. The capture now uses your authenticated browser session instead of launching a fresh headless browser.

**Result**: Screenshots will show your actual app, not the login page! 🎉

---

**Status**: Ready to test after installing html2canvas
**Recommendation**: Try client-side capture first, use manual upload as backup
