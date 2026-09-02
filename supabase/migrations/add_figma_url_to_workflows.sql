-- Migration: Add figma_url column to workflows and update update_workflow_field_secure

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS figma_url text;

CREATE OR REPLACE FUNCTION public.update_workflow_field_secure(
  p_workflow_id uuid,
  p_field text,
  p_value_text text DEFAULT NULL,
  p_value_bool boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_is_owner boolean := false;
  v_role text := 'client';
  v_access text := 'view';
  v_can_comment boolean := false;
  v_can_approve boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update project workflows.';
  END IF;

  -- Find project of workflow
  SELECT project_id INTO v_project_id
  FROM public.workflows
  WHERE id = p_workflow_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found.';
  END IF;

  -- Check owner
  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = v_project_id;

  -- If not owner, get member permissions
  IF NOT COALESCE(v_is_owner, false) THEN
    SELECT role, access, can_comment, can_approve
    INTO v_role, v_access, v_can_comment, v_can_approve
    FROM public.project_members
    WHERE project_id = v_project_id AND user_id = v_user_id;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Access denied. You are not a member of this project.';
    END IF;
  END IF;

  -- 1. Client commenting field: 'clientMessage'
  IF p_field = 'clientMessage' THEN
    IF NOT v_is_owner AND NOT v_can_comment THEN
      RAISE EXCEPTION 'Permission denied. You do not have commenting permissions on this project.';
    END IF;
    UPDATE public.workflows SET client_message = p_value_text WHERE id = p_workflow_id;
    RETURN true;
  END IF;

  -- 2. Client approval field: 'clientTaskDone'
  IF p_field = 'clientTaskDone' THEN
    IF NOT v_is_owner AND NOT v_can_approve THEN
      RAISE EXCEPTION 'Permission denied. You do not have approval/verification permissions on this project.';
    END IF;
    UPDATE public.workflows SET client_task_done = p_value_bool WHERE id = p_workflow_id;
    RETURN true;
  END IF;

  -- 3. Project content / edit fields: 'designA', 'designB', 'ourNotes', 'reason', 'isDone', 'title', 'figmaUrl'
  IF p_field IN ('designA', 'designB', 'ourNotes', 'reason', 'isDone', 'title', 'figmaUrl') THEN
    IF NOT v_is_owner AND v_access != 'edit' THEN
      RAISE EXCEPTION 'Permission denied. You do not have edit permissions on this project.';
    END IF;

    IF p_field = 'designA' THEN
      UPDATE public.workflows SET design_a = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'designB' THEN
      UPDATE public.workflows SET design_b = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'ourNotes' THEN
      UPDATE public.workflows SET our_notes = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'reason' THEN
      UPDATE public.workflows SET reason = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'isDone' THEN
      UPDATE public.workflows SET is_done = p_value_bool WHERE id = p_workflow_id;
    ELSIF p_field = 'title' THEN
      UPDATE public.workflows SET title = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'figmaUrl' THEN
      UPDATE public.workflows SET figma_url = p_value_text WHERE id = p_workflow_id;
    END IF;

    RETURN true;
  END IF;

  RAISE EXCEPTION 'Unknown or unpermitted field: %', p_field;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_workflow_field_secure(uuid, text, text, boolean) TO authenticated;
