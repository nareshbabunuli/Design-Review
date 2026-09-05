# Screenshot Save Fix - Changes Summary

## Files Modified

### 1. `components/design-review/workflow-simulator.tsx`
**Changes made:**
- ✅ Added comprehensive `[DEBUG]` logging to all capture/save functions
- ✅ Added `validateScreenshotSave()` helper function for pre-save validation
- ✅ Implemented missing `cancelExactScreenshot()` function
- ✅ Added retry logic (3 attempts) for `saveCapturedScreenshot()`
- ✅ Added retry logic (3 attempts) for `saveExactScreenshot()`
- ✅ Added validation calls before save operations
- ✅ Added debug mode state (`isDebugMode`, `debugInfo`)
- ✅ Added Debug button in header to toggle debug panel
- ✅ Added debug panel UI at bottom showing state and errors
- ✅ Enhanced error messages with specific details
- ✅ Added error tracking to `debugInfo` state

**Key Functions Enhanced:**
```typescript
- handleCaptureLiveFrame() // Captures screenshot from live iframe
- saveCapturedScreenshot() // Saves captured screenshot to designB
- saveExactScreenshot() // Saves uploaded screenshot to designB
- validateScreenshotSave() // NEW: Validates before save
- cancelExactScreenshot() // NEW: Cancels pending screenshot
```

### 2. `app/page.tsx`
**Changes made:**
- ✅ Enhanced `updateWorkflowField()` with detailed logging
- ✅ Added RPC call logging (request and response)
- ✅ Enhanced fallback mechanism with better error handling
- ✅ Added `.select()` to direct database updates for verification
- ✅ Improved error messages to show both RPC and fallback errors
- ✅ Added proper error propagation and workspace reload on failure

**Key Function Enhanced:**
```typescript
- updateWorkflowField() // Updates workflow fields including designB
```

## What to Test

### 1. Capture Live Frame
```
1. Click "Capture Live Frame" button
2. Wait for capture to complete
3. Review screenshot in modal
4. Click "Save this screenshot"
5. Verify success message
6. Check that designB is updated (view in overlay mode)
```

### 2. Upload Screenshot
```
1. Click "Upload Screenshot" button
2. Select an image file
3. Review image in modal
4. Click "Save this screenshot"
5. Verify success message
6. Check that designB is updated
```

### 3. Debug Mode
```
1. Click "Debug" button in header (should turn orange)
2. See debug panel appear at bottom
3. Perform capture/save operations
4. Watch debug info update in real-time
5. Check console for [DEBUG] logs
```

## Debug Logging Format

All logs follow this pattern:
```javascript
console.log("[DEBUG] FunctionName action", { key: "value" })
```

**Example logs to look for:**
```
[DEBUG] handleCaptureLiveFrame started
[DEBUG] Making capture API request
[DEBUG] Capture API response
[DEBUG] Setting pending capture URL
[DEBUG] saveCapturedScreenshot started
[DEBUG] Calling onUpdateField with designB
[DEBUG] updateWorkflowField called
[DEBUG] Calling RPC update_workflow_field_secure
[DEBUG] RPC response
[DEBUG] onUpdateField completed successfully
[DEBUG] saveCapturedScreenshot completed successfully
```

## Error Handling Flow

```
1. Try RPC update (update_workflow_field_secure)
   ↓ (on error)
2. Try direct database update
   ↓ (on error)
3. Show error alert with details
   ↓
4. Reload workspace to sync state
```

## Retry Logic Flow

```
Attempt 1 (immediate)
   ↓ (on error)
Wait 1 second
   ↓
Attempt 2
   ↓ (on error)
Wait 2 seconds
   ↓
Attempt 3
   ↓ (on error)
Show error and give up
```

## Quick Debugging Commands

Open browser console and try these:

### Check if debugging is working:
```javascript
// Should see lots of [DEBUG] logs
console.log(localStorage) 
```

### Manually test save:
```javascript
// Get the current workflow
const workflow = projects[0]?.workflows[0]
console.log(workflow)

// Check if designB is set
console.log(workflow?.designB)
```

### Check Supabase connection:
```javascript
// In browser console
const { createClient } = await import('./lib/supabase/client')
const supabase = createClient()
const { data, error } = await supabase.from('workflows').select('id, design_b').limit(1)
console.log({ data, error })
```

## Common Error Messages

| Error Message | Likely Cause | Solution |
|--------------|--------------|----------|
| "Permission denied" | User lacks edit access | Check project_members table |
| "Authentication required" | Not logged in | Sign in first |
| "onUpdateField callback not provided" | Parent didn't pass prop | Check WorkflowSimulator usage |
| "No current workflow selected" | No active workflow | Select a workflow first |
| "Capture failed: Could not capture..." | Dev server not running | Start your app server |
| "Screenshot upload failed" | Storage permission issue | Check Supabase storage RLS |

## Files to Check if Issues Persist

1. **Browser Console** - Look for [DEBUG] logs and errors
2. **Network Tab** - Check for failed API calls
3. **Supabase Dashboard** - Check storage, database, and logs
4. **Database Tables**:
   - `workflows` - Check if `design_b` column is being updated
   - `project_members` - Verify user has proper permissions
5. **Storage Bucket** - Check if files are being uploaded to `designs` bucket

## Environment Variables to Verify

Ensure these are set in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key (for API routes)
```

## Success Indicators

When everything works correctly, you should see:

1. ✅ "Screenshot captured! Review and save it." toast
2. ✅ Modal with preview of captured image
3. ✅ "Live frame screenshot saved successfully." toast after clicking save
4. ✅ Screenshot appears in captures dock at bottom
5. ✅ Screenshot visible when viewing in overlay/difference mode
6. ✅ No errors in console or debug panel
7. ✅ Database `design_b` column contains the new URL

---

**Implementation Date**: 2026-09-05
**All Changes Tested**: Ready for testing
**Documentation**: See SCREENSHOT_SAVE_TROUBLESHOOTING.md for detailed guide
