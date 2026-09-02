-- 1. Allow project members to select projects
DROP POLICY IF EXISTS "projects_select_own" ON projects;
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects
  FOR SELECT
  USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM project_members pm
      WHERE pm.project_id = projects.id
      AND pm.user_id = auth.uid()
    )
  );

-- 2. Function to get project data by invite token (Google Drive style share link)
CREATE OR REPLACE FUNCTION get_project_by_invite(invite_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_result json;
BEGIN
  -- Find project from invite token
  SELECT project_id INTO v_project_id
  FROM public.project_invites
  WHERE token = invite_token;

  IF v_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Build JSON of project with workflows
  SELECT json_build_object(
    'id', p.id,
    'title', p.title,
    'is_expanded', p.is_expanded,
    'user_id', p.user_id,
    'workflows', COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', w.id,
          'project_id', w.project_id,
          'title', w.title,
          'design_a', w.design_a,
          'design_b', w.design_b,
          'our_notes', w.our_notes,
          'client_message', w.client_message,
          'client_task_done', w.client_task_done,
          'reason', w.reason,
          'is_done', w.is_done
        )
        ORDER BY w.id ASC
      )
      FROM public.workflows w
      WHERE w.project_id = p.id
    ), '[]'::json)
  ) INTO v_result
  FROM public.projects p
  WHERE p.id = v_project_id;

  RETURN v_result;
END;
$$;

-- 3. Function to update client feedback by invite token (client comments & accept/verify)
CREATE OR REPLACE FUNCTION update_workflow_by_invite(
  invite_token text,
  target_workflow_id uuid,
  new_client_message text DEFAULT NULL,
  new_client_task_done boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id uuid;
  v_wf_project_id uuid;
BEGIN
  SELECT project_id INTO v_project_id
  FROM public.project_invites
  WHERE token = invite_token;

  IF v_project_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT project_id INTO v_wf_project_id
  FROM public.workflows
  WHERE id = target_workflow_id;

  IF v_wf_project_id IS DISTINCT FROM v_project_id THEN
    RETURN false;
  END IF;

  IF new_client_message IS NOT NULL AND new_client_task_done IS NOT NULL THEN
    UPDATE public.workflows
    SET client_message = new_client_message,
        client_task_done = new_client_task_done
    WHERE id = target_workflow_id;
  ELSIF new_client_message IS NOT NULL THEN
    UPDATE public.workflows
    SET client_message = new_client_message
    WHERE id = target_workflow_id;
  ELSIF new_client_task_done IS NOT NULL THEN
    UPDATE public.workflows
    SET client_task_done = new_client_task_done
    WHERE id = target_workflow_id;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION get_project_by_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_workflow_by_invite(text, uuid, text, boolean) TO anon, authenticated;
