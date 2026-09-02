# Design Workflow Tracker - Setup Guide

## Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase project with PostgreSQL database

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   npx vercel env pull .env.local
   ```

3. **Create storage bucket & apply policies:**
   ```bash
   npm run setup-storage
   ```
   Or apply all database & storage RLS policies at once:
   ```bash
   npm run apply-rls
   ```

4. **Apply Row Level Security (RLS) Policies:**

   The application requires RLS policies on `workflows`, `workflow_comments`, and `storage.objects` (for the `designs` bucket).

   ### Option A: Automatic via npm Script (Recommended)
   Run:
   ```bash
   npm run apply-rls
   ```
   This will automatically connect to your PostgreSQL database (using `POSTGRES_URL` in `.env.local`) and apply all policies.

   ### Option B: Apply via Supabase Dashboard SQL Editor
   1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
   2. Select your project
   3. Navigate to **SQL Editor**
   4. Run `supabase/migrations/add_workflow_rls_policies.sql` (for table permissions)
   5. Run `supabase/migrations/add_storage_rls_policies.sql` (for storage upload permissions)

   **Key Storage Policies (`storage.objects`):**
   - `Allow public read access on designs`: Anyone can view uploaded design images
   - `Allow authenticated and anon uploads to designs`: Users can upload images to `designs`
   - `Allow authenticated and anon updates to designs`: Allows overwriting/upserting designs
   - `Allow authenticated and anon deletes from designs`: Allows deleting images from `designs`

   **Key Table Policies:**
   - `workflows_select`: Users can view workflows from their projects
   - `workflows_insert`: Users can create workflows in their projects
   - `workflows_update`: Users can update workflows in their projects
   - `workflows_delete`: Users can delete workflows from their projects
   - `workflow_comments_select`: Users can view comments on accessible workflows
   - `workflow_comments_insert`: Users can comment on accessible workflows

## Running the Application

```bash
# Development mode
npm run dev

# Production build
npm run build
npm run start
```

The application will be available at `http://localhost:3000`

## Database Schema

The application uses the following tables:
- `projects`: User projects
- `workflows`: Design review workflows
- `workflow_comments`: Comments on workflows
- `project_members`: Project team members
- `storage.objects`: Uploaded images and designs

## Features

- Create and manage design review projects
- Upload Figma designs and app screenshots
- Track design review status
- Collaborate with team members
- Generate presentation reports
- Export as PDF

## Troubleshooting

### "StorageApiError: new row violates row-level security policy"

This error occurs when attempting to upload an image to Supabase Storage, but the `storage.objects` table does not have an RLS policy permitting `INSERT` or `UPDATE` into the `designs` bucket.

**Fix:**
1. Run `npm run setup-storage` or `npm run apply-rls` in your terminal.
2. Alternatively, open Supabase SQL Editor and run `supabase/migrations/add_storage_rls_policies.sql`.

### "Row level security policy" on Workflows or Comments

1. Run `npm run apply-rls`.
2. Check that `workflows` and `workflow_comments` tables have RLS enabled and policies created (see `supabase/migrations/add_workflow_rls_policies.sql`).
3. Ensure you're authenticated with a valid user.

### "Bucket not found" Error

The storage bucket may not be created. Run:
```bash
npm run setup-storage
```
