# Screenshot Save Troubleshooting Guide

## Problem
Unable to save live screen capture and save in workflow-simulator.tsx

## Solution Overview
We've implemented comprehensive debugging, error handling, retry logic, and fallback mechanisms to identify and fix the save issue.

## What Was Fixed

### 1. Enhanced Error Logging ✅
- Added detailed console logging throughout capture and save process
- Logs include function entry/exit, parameter validation, API responses, and error details
- All logs are prefixed with `[DEBUG]` for easy filtering

### 2. Database RPC Function Verification ✅
- Verified `update_workflow_field_secure` RPC function is correctly configured
- Confirmed `designB` field is properly handled in the RPC function
- RPC requires either owner status OR edit access permission

### 3. Fallback Save Mechanism ✅
- If RPC fails, automatically attempts direct database update
- Includes proper column mapping (designB → design_b)
- Provides detailed error messages if both methods fail

### 4. Better Error Handling ✅
- Retry logic: 3 attempts with exponential backoff (1s, 2s, 3s delays)
- Validation checks before save attempts
- Clear error messages explaining what failed
- Toast notifications with specific error details

### 5. Debug Mode ✅
- Toggle debug panel with "Debug" button in header
- Shows current state (workflow ID, flags, pending items)
- Displays recent activity (last capture, last save)
- Lists recent errors for quick diagnosis
- Can clear error history

## How to Use

### Testing the Fix

1. **Open the application** and navigate to a workflow
2. **Enable Debug Mode** by clicking the "Debug" button in the top header
3. **Try capturing a screenshot**:
   - Click "Capture Live Frame" to capture from live iframe
   - OR click "Upload Screenshot" to upload an image file
4. **Watch the debug panel** at the bottom for real-time information
5. **Check browser console** for detailed `[DEBUG]` logs

### Debug Output Locations

#### Browser Console
Look for logs with `[DEBUG]` prefix:
```
[DEBUG] handleCaptureLiveFrame started { currentWorkflow: "abc123...", ... }
[DEBUG] Capture API response { status: 200, ok: true }
[DEBUG] Setting pending capture URL https://...
[DEBUG] saveCapturedScreenshot started { ... }
[DEBUG] Calling onUpdateField with designB { ... }
[DEBUG] Calling RPC update_workflow_field_secure { ... }
[DEBUG] RPC response { data: true, error: null }
[DEBUG] saveCapturedScreenshot completed successfully
```

#### Debug Panel (UI)
The debug panel shows:
- **Current State**: Workflow ID, capturing status, saving status, pending items
- **Recent Activity**: Timestamps of last capture and save
- **Recent Errors**: List of the last 5 errors encountered

## Common Issues and Solutions

### Issue 1: "Permission denied" error
**Symptoms**: RPC fails with permission error
**Cause**: User doesn't have edit access to the project
**Solution**: 
- Check project permissions in `project_members` table
- Owner should have full access
- Non-owners need `access = 'edit'` to update designs
- Verify RLS policies are correctly configured

### Issue 2: "onUpdateField is undefined"
**Symptoms**: Log shows `onUpdateFieldExists: false`
**Cause**: Parent component didn't pass the callback
**Solution**:
- Verify WorkflowSimulator receives `onUpdateField` prop
- Check app/page.tsx passes `onUpdateField={updateWorkflowField}`

### Issue 3: Screenshot captured but not saved
**Symptoms**: Capture succeeds, modal shows, but clicking "Save" fails
**Cause**: Database update failing silently
**Solution**:
- Check console for RPC error details
- Review fallback direct update logs
- Verify Supabase connection is active
- Check network tab for failed requests

### Issue 4: Capture API fails
**Symptoms**: "Capture failed: Could not capture screenshot"
**Cause**: Headless browser can't access the URL
**Solution**:
- Ensure local dev server is running (e.g., localhost:8081)
- Check the URL is accessible from the server
- Verify Chrome/Edge is installed on the server
- Check API route logs: `app/api/capture-screenshot/route.ts`

### Issue 5: Storage upload fails
**Symptoms**: "Screenshot upload failed: storage error"
**Cause**: Supabase storage permissions or quota issue
**Solution**:
- Verify `designs` bucket exists in Supabase Storage
- Check RLS policies allow authenticated users to upload
- Verify storage quota hasn't been exceeded
- Check Supabase service role key is configured

## Retry Logic

The save operations now automatically retry on failure:
- **Attempt 1**: Immediate
- **Attempt 2**: After 1 second delay
- **Attempt 3**: After 2 seconds delay (3 seconds total)

If all 3 attempts fail, the user sees a detailed error message.

## Validation Checks

Before attempting to save, the system validates:
- ✅ Current workflow exists
- ✅ Workflow has a valid ID
- ✅ Screenshot URL exists and is valid format
- ✅ onUpdateField callback is available

If validation fails, the operation is aborted with a clear error message.

## Database Schema

Relevant tables and columns:

### workflows table
```sql
- id: uuid (primary key)
- project_id: uuid (foreign key)
- design_a: text (Figma design URL)
- design_b: text (App screenshot URL) ← THIS IS WHAT WE'RE SAVING
- title: text
- our_notes: text
- client_message: text
- reason: text
```

### project_members table
```sql
- project_id: uuid
- user_id: uuid
- role: text (client, freelancer, developer, owner)
- access: text (view, edit) ← MUST BE 'edit' for designB updates
- can_comment: boolean
- can_approve: boolean
```

## API Endpoints

### POST /api/capture-screenshot
Captures a screenshot using headless browser

**Request:**
```json
{
  "url": "http://localhost:8081",
  "width": 393,
  "height": 852,
  "workflowId": "abc123..."
}
```

**Response (success):**
```json
{
  "success": true,
  "publicUrl": "https://...supabase.co/storage/v1/object/public/designs/...",
  "width": 393,
  "height": 852
}
```

**Response (error):**
```json
{
  "error": "Could not capture screenshot..."
}
```

## RPC Function

### update_workflow_field_secure
Updates a single workflow field with permission checking

**Parameters:**
- `p_workflow_id`: uuid
- `p_field`: text (e.g., "designB")
- `p_value_text`: text (URL for designB)
- `p_value_bool`: boolean (null for designB)

**Permissions:**
- Project owner: Always allowed
- Non-owner: Requires `access = 'edit'`

## Next Steps

1. **Test with Debug Mode enabled**
2. **Monitor console logs** during capture and save
3. **Check database** to verify the `design_b` column is being updated
4. **Review Supabase logs** if issues persist
5. **Share debug output** if you need further assistance

## Testing Checklist

- [ ] Debug mode toggles on/off correctly
- [ ] Console shows detailed logs for capture
- [ ] Console shows detailed logs for save
- [ ] Validation errors appear in both console and toast
- [ ] Retry logic executes on transient failures
- [ ] Success messages appear on successful save
- [ ] Debug panel shows current state accurately
- [ ] Errors are tracked in debug panel
- [ ] Screenshot appears in workflow after save
- [ ] designB field is updated in database

## Support

If the issue persists after implementing these fixes:

1. Enable debug mode
2. Attempt to capture and save a screenshot
3. Copy the console logs (filter by `[DEBUG]`)
4. Take a screenshot of the debug panel
5. Check Supabase logs for any errors
6. Share all information for further diagnosis

---

**Last Updated**: 2026-09-05
**Status**: All debugging tools and fixes implemented ✅
