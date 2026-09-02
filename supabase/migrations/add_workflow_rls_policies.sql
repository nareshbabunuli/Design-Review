-- Drop existing policies if they exist
DROP POLICY IF EXISTS "workflows_select" ON workflows;
DROP POLICY IF EXISTS "workflows_insert" ON workflows;
DROP POLICY IF EXISTS "workflows_update" ON workflows;
DROP POLICY IF EXISTS "workflows_delete" ON workflows;
DROP POLICY IF EXISTS "workflow_comments_select" ON workflow_comments;
DROP POLICY IF EXISTS "workflow_comments_insert" ON workflow_comments;

-- Add reason column to workflow_comments if it does not exist
ALTER TABLE workflow_comments ADD COLUMN IF NOT EXISTS reason TEXT;

-- Enable RLS on workflows table
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to select workflows from their projects (Owner or invited Client)
CREATE POLICY "workflows_select" ON workflows
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = workflows.project_id
      AND (p.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id
        AND pm.user_id = auth.uid()
      ))
    )
  );

-- Allow authenticated users to insert workflows into their projects
CREATE POLICY "workflows_insert" ON workflows
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = workflows.project_id
      AND p.user_id = auth.uid()
    )
  );

-- Allow both Owner and invited Client (project_members) to update workflows
CREATE POLICY "workflows_update" ON workflows
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = workflows.project_id
      AND (p.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id
        AND pm.user_id = auth.uid()
      ))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = workflows.project_id
      AND (p.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id
        AND pm.user_id = auth.uid()
      ))
    )
  );

-- Allow authenticated users to delete workflows from their projects
CREATE POLICY "workflows_delete" ON workflows
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = workflows.project_id
      AND p.user_id = auth.uid()
    )
  );

-- Enable RLS on workflow_comments table
ALTER TABLE workflow_comments ENABLE ROW LEVEL SECURITY;

-- Allow users to view comments on workflows they have access to
CREATE POLICY "workflow_comments_select" ON workflow_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflows w
      JOIN projects p ON p.id = w.project_id
      WHERE w.id = workflow_comments.workflow_id
      AND (p.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id
        AND pm.user_id = auth.uid()
      ))
    )
  );

-- Allow authenticated users (Owner and invited Client) to insert comments
CREATE POLICY "workflow_comments_insert" ON workflow_comments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workflows w
      JOIN projects p ON p.id = w.project_id
      WHERE w.id = workflow_comments.workflow_id
      AND (p.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = p.id
        AND pm.user_id = auth.uid()
      ))
    )
    AND author_id = auth.uid()
  );

-- Enable Supabase Realtime publication on workflows and comments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'workflows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workflows;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'workflow_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workflow_comments;
  END IF;
END $$;
