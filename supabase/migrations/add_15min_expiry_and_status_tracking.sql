-- Migration: Add 15-minute invite expiry and comprehensive status tracking (accepted, pending, rejected, expired)

-- 1. Ensure project_invites has expires_at column and updated status check
ALTER TABLE public.project_invites 
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '15 minutes');

ALTER TABLE public.project_invites 
  DROP CONSTRAINT IF EXISTS project_invites_status_check;

ALTER TABLE public.project_invites 
  ADD CONSTRAINT project_invites_status_check 
  CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked', 'expired'));

-- 2. Update create_project_invitation to set 15-minute expiration
CREATE OR REPLACE FUNCTION public.create_project_invitation(
  p_project_id uuid,
  p_email text,
  p_role text DEFAULT 'client',
  p_access text DEFAULT 'view',
  p_can_comment boolean DEFAULT true,
  p_can_approve boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_clean_email text := lower(trim(p_email));
  v_clean_role text := CASE WHEN p_role = 'freelancer' THEN 'freelancer' ELSE 'client' END;
  v_clean_access text := CASE WHEN p_access = 'edit' THEN 'edit' ELSE 'view' END;
  v_invite_record record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_clean_email IS NULL OR v_clean_email = '' OR v_clean_email NOT LIKE '%@%' THEN
    RAISE EXCEPTION 'A valid email is required for invitation.';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can send invitations.';
  END IF;

  -- Insert invite with 15-minute expiration
  INSERT INTO public.project_invites (
    project_id,
    owner_id,
    invitee_email,
    role,
    access,
    can_comment,
    can_approve,
    status,
    expires_at,
    created_at
  )
  VALUES (
    p_project_id,
    v_user_id,
    v_clean_email,
    v_clean_role,
    v_clean_access,
    p_can_comment,
    p_can_approve,
    'pending',
    now() + interval '15 minutes',
    now()
  )
  RETURNING * INTO v_invite_record;

  RETURN json_build_object(
    'id', v_invite_record.id,
    'token', v_invite_record.token,
    'invitee_email', v_invite_record.invitee_email,
    'role', v_invite_record.role,
    'access', v_invite_record.access,
    'can_comment', v_invite_record.can_comment,
    'can_approve', v_invite_record.can_approve,
    'status', v_invite_record.status,
    'expires_at', v_invite_record.expires_at,
    'created_at', v_invite_record.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_project_invitation(uuid, text, text, text, boolean, boolean) TO authenticated;

-- 3. RPC to Renew/Resend an Invitation with a fresh 15-minute expiry
CREATE OR REPLACE FUNCTION public.renew_project_invitation(p_project_id uuid, p_invite_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_invite record;
  v_new_token text := encode(gen_random_bytes(16), 'hex');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can renew invitations.';
  END IF;

  UPDATE public.project_invites
  SET token = v_new_token,
      status = 'pending',
      created_at = now(),
      expires_at = now() + interval '15 minutes'
  WHERE id = p_invite_id AND project_id = p_project_id
  RETURNING * INTO v_invite;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found.';
  END IF;

  RETURN json_build_object(
    'id', v_invite.id,
    'token', v_invite.token,
    'invitee_email', v_invite.invitee_email,
    'role', v_invite.role,
    'access', v_invite.access,
    'can_comment', v_invite.can_comment,
    'can_approve', v_invite.can_approve,
    'status', v_invite.status,
    'expires_at', v_invite.expires_at,
    'created_at', v_invite.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_project_invitation(uuid, uuid) TO authenticated;

-- 4. Update get_project_people_and_permissions to return all statuses and computed expiry
CREATE OR REPLACE FUNCTION public.get_project_people_and_permissions(p_project_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_members json;
  v_invites json;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can view people & permissions.';
  END IF;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', pm.id,
      'user_id', pm.user_id,
      'user_email', pm.user_email,
      'role', pm.role,
      'access', pm.access,
      'can_comment', pm.can_comment,
      'can_approve', pm.can_approve,
      'created_at', pm.created_at
    ) ORDER BY pm.created_at ASC
  ), '[]'::json) INTO v_members
  FROM public.project_members pm
  WHERE pm.project_id = p_project_id;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', pi.id,
      'invitee_email', pi.invitee_email,
      'token', pi.token,
      'role', pi.role,
      'access', pi.access,
      'can_comment', pi.can_comment,
      'can_approve', pi.can_approve,
      'status', CASE
        WHEN pi.status = 'pending' AND now() > COALESCE(pi.expires_at, pi.created_at + interval '15 minutes') THEN 'expired'
        ELSE pi.status
      END,
      'created_at', pi.created_at,
      'expires_at', COALESCE(pi.expires_at, pi.created_at + interval '15 minutes')
    ) ORDER BY pi.created_at DESC
  ), '[]'::json) INTO v_invites
  FROM public.project_invites pi
  WHERE pi.project_id = p_project_id;

  RETURN json_build_object(
    'members', v_members,
    'invites', v_invites
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_people_and_permissions(uuid) TO authenticated;

-- 5. Update reject_project_invite to set status = 'rejected'
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

  IF v_user_id IS NOT NULL THEN
    DELETE FROM public.project_members
    WHERE project_id = v_invite.project_id AND user_id = v_user_id;
  END IF;

  UPDATE public.project_invites
  SET status = 'rejected'
  WHERE id = v_invite.id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_project_invite(text) TO authenticated, anon;

-- 6. Update leave_project to mark invites as 'rejected'
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

  DELETE FROM public.project_members
  WHERE project_id = p_project_id AND user_id = v_user_id;

  IF v_user_email IS NOT NULL THEN
    UPDATE public.project_invites
    SET status = 'rejected'
    WHERE project_id = p_project_id AND lower(trim(invitee_email)) = lower(trim(v_user_email));
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.leave_project(uuid) TO authenticated;

-- 7. Update accept_project_invite to enforce 15-minute expiry check
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

  v_user_email := lower(trim(COALESCE(
    (auth.jwt() ->> 'email'),
    (SELECT email FROM auth.users WHERE id = v_user_id)
  )));

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE token = p_invite_token;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid invitation link.';
  END IF;

  IF v_invite.status = 'revoked' THEN
    RAISE EXCEPTION 'This invitation has been cancelled.';
  END IF;

  IF v_invite.status = 'rejected' THEN
    RAISE EXCEPTION 'This invitation was previously rejected. Please request a new invite.';
  END IF;

  -- 15-minute expiration check
  IF now() > COALESCE(v_invite.expires_at, v_invite.created_at + interval '15 minutes') THEN
    UPDATE public.project_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'This invitation link has expired (15-minute limit). Please ask the project owner to send a new invite.';
  END IF;

  SELECT * INTO v_project
  FROM public.projects
  WHERE id = v_invite.project_id;

  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Project associated with this invitation was not found.';
  END IF;

  -- If user is the owner
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

  -- Enforce email match if targeted
  IF v_invite.invitee_email IS NOT NULL AND trim(v_invite.invitee_email) != '' THEN
    IF v_user_email IS NULL OR lower(trim(v_invite.invitee_email)) != v_user_email THEN
      RAISE EXCEPTION 'This invitation was sent to %. You are currently signed in as %. Please log in with % to access this project.',
        v_invite.invitee_email, COALESCE(v_user_email, 'unknown'), v_invite.invitee_email;
    END IF;
  END IF;

  -- Add to project_members
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
    role = EXCLUDED.role,
    access = EXCLUDED.access,
    can_comment = EXCLUDED.can_comment,
    can_approve = EXCLUDED.can_approve,
    user_email = EXCLUDED.user_email;

  -- Mark invite as accepted
  UPDATE public.project_invites
  SET status = 'accepted'
  WHERE id = v_invite.id;

  RETURN json_build_object(
    'success', true,
    'project_id', v_invite.project_id,
    'title', v_project.title,
    'role', COALESCE(v_invite.role, 'client'),
    'access', COALESCE(v_invite.access, 'view'),
    'can_comment', COALESCE(v_invite.can_comment, true),
    'can_approve', COALESCE(v_invite.can_approve, false)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text) TO authenticated, anon;
