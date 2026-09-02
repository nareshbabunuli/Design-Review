-- Updated and robust accept_project_invite RPC function
CREATE OR REPLACE FUNCTION public.accept_project_invite(p_invite_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite record;
  v_project record;
  v_is_owner boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please sign in to accept this invitation.';
  END IF;

  -- Extract user email from JWT claims or auth.users table
  v_user_email := lower(trim(COALESCE(
    (auth.jwt() ->> 'email'),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  )));

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE token = p_invite_token AND status != 'revoked';

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation link.';
  END IF;

  SELECT * INTO v_project
  FROM public.projects
  WHERE id = v_invite.project_id;

  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Project associated with this invitation was not found.';
  END IF;

  -- Check if user is already the owner of this project
  IF v_project.user_id = v_user_id THEN
    RETURN json_build_object(
      'success', true,
      'project_id', v_project.id,
      'title', v_project.title,
      'role', 'owner',
      'access', 'edit',
      'can_comment', true,
      'can_approve', true
    );
  END IF;

  -- Enforce email match if a specific email was targeted in the invite
  IF v_invite.invitee_email IS NOT NULL AND trim(v_invite.invitee_email) != '' THEN
    IF v_user_email IS NULL OR lower(trim(v_invite.invitee_email)) != v_user_email THEN
      RAISE EXCEPTION 'This invitation was sent to %. You are currently signed in as %. Please log in with % to access this project.',
        v_invite.invitee_email, COALESCE(v_user_email, 'unknown'), v_invite.invitee_email;
    END IF;
  END IF;

  -- Insert or update project membership
  INSERT INTO public.project_members (
    project_id,
    user_id,
    user_email,
    role,
    access,
    can_comment,
    can_approve
  )
  VALUES (
    v_invite.project_id,
    v_user_id,
    v_user_email,
    COALESCE(v_invite.role, 'client'),
    COALESCE(v_invite.access, 'view'),
    COALESCE(v_invite.can_comment, true),
    COALESCE(v_invite.can_approve, false)
  )
  ON CONFLICT (project_id, user_id)
  DO UPDATE SET
    user_email = EXCLUDED.user_email,
    role = EXCLUDED.role,
    access = EXCLUDED.access,
    can_comment = EXCLUDED.can_comment,
    can_approve = EXCLUDED.can_approve;

  -- Mark invite as accepted
  UPDATE public.project_invites
  SET status = 'accepted'
  WHERE id = v_invite.id;

  RETURN json_build_object(
    'success', true,
    'project_id', v_project.id,
    'title', v_project.title,
    'role', COALESCE(v_invite.role, 'client'),
    'access', COALESCE(v_invite.access, 'view'),
    'can_comment', COALESCE(v_invite.can_comment, true),
    'can_approve', COALESCE(v_invite.can_approve, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text) TO authenticated, anon;
