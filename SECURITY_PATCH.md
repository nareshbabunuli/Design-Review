# Security hardening patch — Design-Review / Open Design AI

## What this fixes

| Issue | Fix |
|-------|-----|
| Unauthenticated automation / screenshot / journey APIs | `requireProjectAccess` on all start/control routes |
| SSRF (any URL into Puppeteer) | `assertSafeTargetUrlWithDevBypass` before every navigation |
| Service-role on open endpoints | Screenshot uses **user-scoped** Supabase client |
| Anon storage write/delete | Migration removes anon INSERT/UPDATE/DELETE |
| Secrets in job status responses | `sanitizeJobForClient` strips credentials / API keys |
| Screencast input open to anyone | Returns **410 Gone** |
| Shared insecure Puppeteer flags | Central `launchTestBrowser` (sandbox flags via env only) |

## How to apply

### 1. New helpers (add)

- `lib/auth/require-project-access.ts`
- `lib/security/url-guard.ts`
- `lib/browser/secure-browser.ts`
- `lib/supabase/server-user.ts`

### 2. Replace these API routes

- `app/api/ai-automation/start/route.ts`
- `app/api/ai-automation/autonomous/route.ts`
- `app/api/ai-automation/chat/route.ts`
- `app/api/ai-automation/status/route.ts`
- `app/api/journey/start/route.ts`
- `app/api/journey/status/route.ts`
- `app/api/capture-screenshot/route.ts`
- `app/api/screencast/input/route.ts`

### 3. Run the storage migration

In Supabase SQL editor, run:

`supabase/migrations/fix_storage_rls_remove_anon_writes.sql`

### 4. Environment

```env
# Production: keep sandbox unless you run Chrome inside a locked container
# PUPPETEER_NO_SANDBOX=true

# Local dev only — allows http://localhost targets
# ALLOW_LOCALHOST_TARGETS=true
```

Client-supplied `openRouterApiKey` is **ignored in production** by the patched routes.

### 5. Frontend call sites

Ensure every automation / screenshot request:

1. Is made **while the user is signed in** (session cookies sent automatically).
2. Includes **`projectId`** (required for authorization).
3. For screenshot: also send `projectId` (new required field).

## Agent permissions (still work)

Authenticated project members with **edit** access can still supply test credentials, open a real browser against allowed URLs, capture screenshots, and poll/stop jobs. Unauthenticated callers cannot.
