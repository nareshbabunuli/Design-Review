# Screenshot Capture Fix Applied

## Problem Identified

Based on the console logs, the issue was:

```
[DEBUG] Capture API response {status: 500, statusText: 'Internal Server Error', ok: false}
```

Chrome was launching successfully but **the screenshot file was not being created**. The Chrome process was exiting with warnings (GCM registration errors, TensorFlow Lite messages) that were being treated as fatal errors, even though they're just non-critical warnings.

## Root Cause

1. **Chrome exits "successfully" but no screenshot** - The virtual-time-budget (4 seconds) was too short
2. **stderr treated as error** - Chrome logs warnings to stderr that aren't actually errors
3. **Target URL not verified** - No check if localhost:8081 is actually accessible
4. **Insufficient Chrome flags** - Missing flags for localhost/dev environments

## Fixes Applied

### 1. Enhanced Error Handling
```typescript
// Now checks if screenshot file exists regardless of stderr output
if (fs.existsSync(outFile)) {
  console.log("[DEBUG API] Screenshot file created successfully")
  resolve()
} else if (err) {
  reject(new Error(`Screenshot failed: ${err.message}. Check if ${targetUrl} is accessible.`))
} else {
  reject(new Error(`Chrome completed but screenshot file not found. Target URL may have failed to load: ${targetUrl}`))
}
```

### 2. Increased Timeouts
- Virtual time budget: `4000ms` → `10000ms` (10 seconds for page to load)
- Overall timeout: `15000ms` → `30000ms` (30 seconds total)

### 3. Additional Chrome Flags
Added flags for better localhost handling:
```typescript
"--disable-dev-shm-usage",           // Prevent crashes on limited memory
"--disable-software-rasterizer",     // Better rendering
"--disable-web-security",            // Allow localhost access  
"--disable-features=IsolateOrigins,site-per-process", // Simplify for localhost
```

### 4. Pre-flight URL Check
Now verifies the target URL is accessible before attempting screenshot:
```typescript
const testResponse = await fetch(targetUrl, { 
  method: 'HEAD',
  signal: AbortSignal.timeout(5000) 
})
```

If the URL is not reachable, you get a clear error:
```
Cannot reach http://localhost:8081. Make sure your development server is running on this port.
```

### 5. Enhanced Debug Logging
Added throughout the API route:
```typescript
console.log("[DEBUG API] Target URL:", targetUrl)
console.log("[DEBUG API] Screenshot output:", outFile)
console.log("[DEBUG API] Using browser:", browserExe)
console.log("[DEBUG API] Target URL is accessible, status:", testResponse.status)
console.log("[DEBUG API] Chrome stdout:", stdout)
console.log("[DEBUG API] Chrome stderr:", stderr)
console.log("[DEBUG API] Screenshot file verified, size:", fs.statSync(outFile).size, "bytes")
```

## Testing the Fix

### 1. Make sure your target app is running:
```bash
# Start your development server
# For example, if it's on port 8081:
npm run dev
# or
yarn dev
# or whatever command starts your app
```

### 2. Start the design review tool:
```bash
cd d:\wamp64\www\design-workflow-tracker
npm run dev
```

### 3. Test the capture:
1. Navigate to the workflow simulator
2. Make sure the URL shows `http://localhost:8081` (or your app's port)
3. Click "Capture Live Frame"
4. Watch the browser console for `[DEBUG API]` logs

### Expected Output (Success):
```
[DEBUG] handleCaptureLiveFrame started
[DEBUG] Making capture API request
[DEBUG] Capture API response {status: 200, ok: true}
[DEBUG] Setting pending capture URL https://...
Screenshot captured! Review and save it.
```

### Expected Output (Target not running):
```
[DEBUG] Capture API response {status: 502, ok: false}
[DEBUG] Capture API failed { error: "Cannot reach http://localhost:8081..." }
Capture failed: Cannot reach http://localhost:8081. Make sure your development server is running on this port.
```

## What Changed in Each File

### `app/api/capture-screenshot/route.ts`
- ✅ Added pre-flight check to verify target URL is accessible
- ✅ Increased virtual-time-budget from 4s to 10s
- ✅ Increased timeout from 15s to 30s
- ✅ Added Chrome flags for better localhost handling
- ✅ Enhanced error handling to distinguish between file exists and process errors
- ✅ Added comprehensive debug logging
- ✅ Improved error messages with actionable guidance

### Files NOT Changed (already correct)
- `components/design-review/workflow-simulator.tsx` - Already had proper error handling and retry logic
- Database migrations - Already configured correctly
- Supabase client setup - Already working

## Common Scenarios

### Scenario 1: Target app not running
**Error**: `Cannot reach http://localhost:8081. Make sure your development server is running.`

**Solution**: Start your app:
```bash
npm run dev  # or whatever command runs your app
```

### Scenario 2: Wrong port
**Error**: `Cannot reach http://localhost:8081...`

**Solution**: Change the URL in the browser bar to the correct port (e.g., `:5173`, `:3001`, `:8080`)

### Scenario 3: Screenshot still fails after URL check
**Error**: `Chrome completed but screenshot file not found`

**Solution**: 
- Increase the virtual-time-budget further (edit route.ts)
- Check if the page has JavaScript errors preventing render
- Try a simpler page first (static HTML)

### Scenario 4: Timeout errors
**Error**: Command timed out after 30000ms

**Solution**:
- Page is too slow to load
- Increase timeout in route.ts
- Check your app's performance
- Try with a faster loading page first

## Verification Checklist

Before testing, verify:

- [ ] Your target app is running (e.g., http://localhost:8081 loads in a regular browser)
- [ ] Chrome or Edge is installed at: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- [ ] The design review tool is running (`npm run dev`)
- [ ] Debug mode is enabled (click Debug button)
- [ ] Browser console is open to see logs

## Next Steps if Still Failing

If the screenshot still doesn't work:

1. **Check the server terminal** - Look for `[DEBUG API]` logs showing what Chrome is doing
2. **Share both sets of logs**:
   - Browser console (`[DEBUG]` logs)
   - Server terminal (`[DEBUG API]` logs)
3. **Try a different URL** - Test with a static page or public URL to isolate the issue
4. **Check Chrome version** - Run: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --version`

## Files Modified

- ✅ `app/api/capture-screenshot/route.ts` - Enhanced with better error handling, timeouts, and logging

---

**Status**: Fix applied and ready for testing
**Expected Result**: Screenshot capture should now work reliably for localhost development servers
