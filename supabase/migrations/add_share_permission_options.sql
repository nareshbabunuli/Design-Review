-- Migration: Add share permission options (view vs edit)

-- 1. Add permission column to project_invites ('view' or 'edit')
ALTER TABLE public.project_invites 
ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'view';

-- 2. Update get_project_by_invite to return permission
CREATE OR REPLACE FUNCTION get_project_by_invite(invite_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_permission text;
  v_invitee_email text;
  v_result json;
BEGIN
  -- Find project and permission from invite token
  SELECT project_id, COALESCE(permission, 'view'), invitee_email INTO v_project_id, v_permission, v_invitee_email
  FROM public.project_invites
  WHERE token = invite_token;

  IF v_project_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Build JSON of project with workflows, permission, and target invitee email
  SELECT json_build_object(
    'id', p.id,
    'title', p.title,
    'is_expanded', p.is_expanded,
    'user_id', p.user_id,
    'permission', v_permission,
    'invitee_email', v_invitee_email,
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

GRANT EXECUTE ON FUNCTION get_project_by_invite(text) TO anon, authenticated, service_role;

-- 3. Update update_workflow_by_invite to support editing images and fields when permission = 'edit'
CREATE OR REPLACE FUNCTION update_workflow_by_invite(
  invite_token text,
  target_workflow_id uuid,
  new_client_message text DEFAULT NULL,
  new_client_task_done boolean DEFAULT NULL,
  new_design_a text DEFAULT NULL,
  new_design_b text DEFAULT NULL,
  new_our_notes text DEFAULT NULL,
  new_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_permission text;
  v_wf_project_id uuid;
BEGIN
  SELECT project_id, COALESCE(permission, 'view') INTO v_project_id, v_permission
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

  -- If permission is 'edit', can edit images and developer notes as well
  IF v_permission = 'edit' THEN
    UPDATE public.workflows
    SET
      client_message = COALESCE(new_client_message, client_message),
      client_task_done = COALESCE(new_client_task_done, client_task_done),
      design_a = CASE WHEN new_design_a = '__CLEAR__' THEN NULL WHEN new_design_a IS NOT NULL THEN new_design_a ELSE design_a END,
      design_b = CASE WHEN new_design_b = '__CLEAR__' THEN NULL WHEN new_design_b IS NOT NULL THEN new_design_b ELSE design_b END,
      our_notes = COALESCE(new_our_notes, our_notes),
      reason = COALESCE(new_reason, reason)
    WHERE id = target_workflow_id;
    RETURN true;
  END IF;

  -- If permission is 'view', can only comment & accept/verify
  IF new_client_message IS NOT NULL AND new_client_task_done IS NOT NULL THEN
    UPDATE public.workflows
    SET client_message = new_client_message,
        client_task_done = new_client_task_done
    WHERE id = target_workflow_id;
    RETURN true;
  ELSIF new_client_message IS NOT NULL THEN
    UPDATE public.workflows
    SET client_message = new_client_message
    WHERE id = target_workflow_id;
    RETURN true;
  ELSIF new_client_task_done IS NOT NULL THEN
    UPDATE public.workflows
    SET client_task_done = new_client_task_done
    WHERE id = target_workflow_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION update_workflow_by_invite(text, uuid, text, boolean, text, text, text, text) TO anon, authenticated, service_role;
