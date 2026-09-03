-- Migration: Add workflow_order and is_order_locked to projects, and order_index to workflows

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workflow_order jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_order_locked boolean DEFAULT false;

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS order_index integer DEFAULT 0;

-- RPC to update workflow order and/or lock state
CREATE OR REPLACE FUNCTION public.update_project_workflow_order(
  p_project_id uuid,
  p_workflow_order jsonb,
  p_is_locked boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_member_access text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check owner
  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  -- Check member access if not owner
  IF NOT COALESCE(v_is_owner, false) THEN
    SELECT access INTO v_member_access
    FROM public.project_members
    WHERE project_id = p_project_id AND user_id = v_user_id;

    IF v_member_access != 'edit' THEN
      RAISE EXCEPTION 'Access denied. Only users with edit permissions can reorder workflows.';
    END IF;
  END IF;

  -- Update workflow_order and optionally is_order_locked
  IF p_is_locked IS NOT NULL THEN
    UPDATE public.projects
    SET
      workflow_order = p_workflow_order,
      is_order_locked = p_is_locked
    WHERE id = p_project_id;
  ELSE
    UPDATE public.projects
    SET workflow_order = p_workflow_order
    WHERE id = p_project_id;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_project_workflow_order(uuid, jsonb, boolean) TO authenticated;

-- RPC to toggle lock state
CREATE OR REPLACE FUNCTION public.set_project_order_lock(
  p_project_id uuid,
  p_is_locked boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_member_access text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    SELECT access INTO v_member_access
    FROM public.project_members
    WHERE project_id = p_project_id AND user_id = v_user_id;

    IF v_member_access != 'edit' THEN
      RAISE EXCEPTION 'Access denied. Only project owners or editors can lock/unlock ordering.';
    END IF;
  END IF;

  UPDATE public.projects
  SET is_order_locked = p_is_locked
  WHERE id = p_project_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_project_order_lock(uuid, boolean) TO authenticated;
