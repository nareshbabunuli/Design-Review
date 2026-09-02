-- Migration: Add reject_project_invite and leave_project RPCs
-- Allows invited members to leave or reject shared projects, removing them from their dashboard

-- 1. RPC to leave a project (for invited members)
CREATE OR REPLACE FUNCTION public.leave_project(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Remove membership
  DELETE FROM public.project_members
  WHERE project_id = p_project_id AND user_id = v_user_id;

  -- Revoke any pending/accepted invite matching user's email
  IF v_user_email IS NOT NULL THEN
    UPDATE public.project_invites
    SET status = 'revoked'
    WHERE project_id = p_project_id AND lower(trim(invitee_email)) = lower(trim(v_user_email));
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_project(uuid) TO authenticated;

-- 2. RPC to reject an invitation by token
CREATE OR REPLACE FUNCTION public.reject_project_invite(p_invite_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_invite record;
BEGIN
  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE token = p_invite_token;

  IF v_invite.id IS NULL THEN
    RETURN false;
  END IF;

  -- If member record exists for this user, remove it
  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.project_members
    WHERE project_id = v_invite.project_id AND user_id = v_user_id;
  END IF;

  -- Mark invite as revoked
  UPDATE public.project_invites
  SET status = 'revoked'
  WHERE id = v_invite.id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_project_invite(text) TO authenticated, anon;

-- 3. Also allow authenticated users to delete their own project_members record directly via RLS
DROP POLICY IF EXISTS "project_members_delete_self" ON public.project_members;
CREATE POLICY "project_members_delete_self" ON public.project_members
  FOR DELETE
  USING (
    user_id = auth.uid() OR is_project_owner(project_id, auth.uid())
  );
