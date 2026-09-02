-- Migration: Fix infinite recursion between projects and project_members RLS policies

-- 1. Helper function to check project membership without triggering RLS recursion
CREATE OR REPLACE FUNCTION is_project_member(check_project_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = check_project_id AND user_id = check_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION is_project_member(uuid, uuid) TO anon, authenticated, service_role;

-- 2. Helper function to check project ownership without triggering RLS recursion
CREATE OR REPLACE FUNCTION is_project_owner(check_project_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects
    WHERE id = check_project_id AND user_id = check_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION is_project_owner(uuid, uuid) TO anon, authenticated, service_role;

-- 3. Update projects_select policy
DROP POLICY IF EXISTS "projects_select" ON projects;
DROP POLICY IF EXISTS "projects_select_own" ON projects;
CREATE POLICY "projects_select" ON projects
  FOR SELECT
  USING (
    user_id = auth.uid() OR is_project_member(id, auth.uid())
  );

-- 4. Update project_members policies
DROP POLICY IF EXISTS "project_members_select" ON project_members;
CREATE POLICY "project_members_select" ON project_members
  FOR SELECT
  USING (
    user_id = auth.uid() OR is_project_owner(project_id, auth.uid())
  );

DROP POLICY IF EXISTS "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members
  FOR INSERT
  WITH CHECK (
    is_project_owner(project_id, auth.uid())
  );

DROP POLICY IF EXISTS "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members
  FOR DELETE
  USING (
    is_project_owner(project_id, auth.uid())
  );
