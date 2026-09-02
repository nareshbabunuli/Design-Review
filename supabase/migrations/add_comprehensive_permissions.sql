-- Migration: Comprehensive Permission Model & Separation of Access vs Comment Permissions
-- 1. Ensure project_members table exists and has all required fields
CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'freelancer', 'owner')),
  access text NOT NULL DEFAULT 'view' CHECK (access IN ('view', 'edit')),
  can_comment boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_members_unique_user UNIQUE (project_id, user_id)
);

-- Add any missing columns to project_members if it already existed
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'client';
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'view';
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS can_comment boolean NOT NULL DEFAULT false;
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS can_approve boolean NOT NULL DEFAULT false;

-- 2. Ensure project_invites table exists and has all required fields
CREATE TABLE IF NOT EXISTS public.project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id),
  invitee_email text NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'freelancer')),
  access text NOT NULL DEFAULT 'view' CHECK (access IN ('view', 'edit')),
  can_comment boolean NOT NULL DEFAULT true,
  can_approve boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add any missing columns to project_invites
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'client';
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'view';
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS can_comment boolean NOT NULL DEFAULT true;
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS can_approve boolean NOT NULL DEFAULT false;
ALTER TABLE public.project_invites ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- 3. Workflow Revisions Table (for Freelancer revisions and tracking Reason for Final Changes)
CREATE TABLE IF NOT EXISTS public.workflow_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  revision_number integer NOT NULL DEFAULT 1,
  author_id uuid REFERENCES auth.users(id),
  author_email text,
  author_role text NOT NULL DEFAULT 'freelancer',
  reason text NOT NULL,
  design_a text,
  design_b text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_revisions ENABLE ROW LEVEL SECURITY;

-- Helper functions for RLS checks (SECURITY DEFINER to prevent recursive RLS)
CREATE OR REPLACE FUNCTION public.check_is_project_owner(check_project_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = check_project_id AND user_id = check_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.check_is_project_member(check_project_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = check_project_id AND user_id = check_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_is_project_owner(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_is_project_member(uuid, uuid) TO anon, authenticated, service_role;

-- Projects RLS Policies
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      user_id = auth.uid() OR public.check_is_project_member(id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL AND user_id = auth.uid()
  );

-- Workflows RLS Policies
DROP POLICY IF EXISTS "workflows_select" ON public.workflows;
CREATE POLICY "workflows_select" ON public.workflows
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      public.check_is_project_owner(project_id, auth.uid()) OR 
      public.check_is_project_member(project_id, auth.uid())
    )
  );

-- Project Members RLS Policies
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select" ON public.project_members
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      user_id = auth.uid() OR 
      public.check_is_project_owner(project_id, auth.uid())
    )
  );

-- Project Invites RLS Policies
DROP POLICY IF EXISTS "project_invites_select" ON public.project_invites;
CREATE POLICY "project_invites_select" ON public.project_invites
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      owner_id = auth.uid() OR 
      public.check_is_project_owner(project_id, auth.uid())
    )
  );

-- Workflow Revisions RLS Policies
DROP POLICY IF EXISTS "workflow_revisions_select" ON public.workflow_revisions;
CREATE POLICY "workflow_revisions_select" ON public.workflow_revisions
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      public.check_is_project_owner(project_id, auth.uid()) OR 
      public.check_is_project_member(project_id, auth.uid())
    )
  );

-- 4. RPC: Get caller's granular permissions for a project
CREATE OR REPLACE FUNCTION public.get_user_project_permissions(p_project_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean := false;
  v_role text := 'client';
  v_access text := 'view';
  v_can_comment boolean := false;
  v_can_approve boolean := false;
  v_member record;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object(
      'authenticated', false,
      'is_owner', false,
      'role', null,
      'access', null,
      'can_comment', false,
      'can_approve', false
    );
  END IF;

  -- Check owner
  SELECT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND user_id = v_user_id
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN json_build_object(
      'authenticated', true,
      'is_owner', true,
      'role', 'owner',
      'access', 'edit',
      'can_comment', true,
      'can_approve', true
    );
  END IF;

  -- Check membership
  SELECT role, access, can_comment, can_approve INTO v_member
  FROM public.project_members
  WHERE project_id = p_project_id AND user_id = v_user_id;

  IF v_member.role IS NOT NULL THEN
    RETURN json_build_object(
      'authenticated', true,
      'is_owner', false,
      'role', v_member.role,
      'access', v_member.access,
      'can_comment', v_member.can_comment,
      'can_approve', v_member.can_approve
    );
  END IF;

  -- Not a member
  RETURN json_build_object(
    'authenticated', true,
    'is_owner', false,
    'role', null,
    'access', null,
    'can_comment', false,
    'can_approve', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_project_permissions(uuid) TO authenticated, anon;

-- 5. RPC: Get People & Permissions for project (Owner only)
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
      'status', pi.status,
      'created_at', pi.created_at
    ) ORDER BY pi.created_at DESC
  ), '[]'::json) INTO v_invites
  FROM public.project_invites pi
  WHERE pi.project_id = p_project_id AND pi.status != 'revoked';

  RETURN json_build_object(
    'members', v_members,
    'invites', v_invites
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_project_people_and_permissions(uuid) TO authenticated;

-- 6. RPC: Create Project Invitation (Owner only)
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

  -- Insert or update invite
  INSERT INTO public.project_invites (
    project_id,
    owner_id,
    invitee_email,
    role,
    access,
    can_comment,
    can_approve,
    status
  )
  VALUES (
    p_project_id,
    v_user_id,
    v_clean_email,
    v_clean_role,
    v_clean_access,
    p_can_comment,
    p_can_approve,
    'pending'
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
    'status', v_invite_record.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_project_invitation(uuid, text, text, text, boolean, boolean) TO authenticated;

-- 7. RPC: Accept Project Invite (Authenticated user with matching email)
CREATE OR REPLACE FUNCTION public.accept_project_invite(p_invite_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite record;
  v_project record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required. Please sign in to accept this invitation.';
  END IF;

  -- Get authenticated user's email
  SELECT lower(email) INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE token = p_invite_token AND status != 'revoked';

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation link.';
  END IF;

  -- Enforce email match if specific email was targeted
  IF v_invite.invitee_email IS NOT NULL AND lower(v_invite.invitee_email) != v_user_email THEN
    RAISE EXCEPTION 'This invitation was sent to %. You are currently logged in as %. Please log in with % to access this project.',
      v_invite.invitee_email, v_user_email, v_invite.invitee_email;
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
    v_invite.role,
    v_invite.access,
    v_invite.can_comment,
    v_invite.can_approve
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

  -- Return project details and caller permissions
  SELECT * INTO v_project
  FROM public.projects
  WHERE id = v_invite.project_id;

  RETURN json_build_object(
    'project_id', v_project.id,
    'title', v_project.title,
    'role', v_invite.role,
    'access', v_invite.access,
    'can_comment', v_invite.can_comment,
    'can_approve', v_invite.can_approve
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text) TO authenticated;

-- 8. RPC: Update member permissions (Owner only)
CREATE OR REPLACE FUNCTION public.update_project_member_permissions(
  p_project_id uuid,
  p_member_id uuid,
  p_access text,
  p_can_comment boolean,
  p_can_approve boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can change permissions.';
  END IF;

  UPDATE public.project_members
  SET
    access = CASE WHEN p_access = 'edit' THEN 'edit' ELSE 'view' END,
    can_comment = p_can_comment,
    can_approve = p_can_approve
  WHERE id = p_member_id AND project_id = p_project_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_project_member_permissions(uuid, uuid, text, boolean, boolean) TO authenticated;

-- 9. RPC: Revoke member access (Owner only)
CREATE OR REPLACE FUNCTION public.revoke_project_member(p_project_id uuid, p_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can revoke members.';
  END IF;

  DELETE FROM public.project_members
  WHERE id = p_member_id AND project_id = p_project_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_project_member(uuid, uuid) TO authenticated;

-- 10. RPC: Revoke invite (Owner only)
CREATE OR REPLACE FUNCTION public.revoke_project_invite(p_project_id uuid, p_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = p_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Access denied. Only project owners can revoke invites.';
  END IF;

  UPDATE public.project_invites
  SET status = 'revoked'
  WHERE id = p_invite_id AND project_id = p_project_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_project_invite(uuid, uuid) TO authenticated;

-- 11. RPC: Secure field update with independent access, comment, and approval permission validation
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

  -- 3. Project content / edit fields: 'designA', 'designB', 'ourNotes', 'reason', 'isDone', 'title'
  IF p_field IN ('designA', 'designB', 'ourNotes', 'reason', 'isDone', 'title') THEN
    IF NOT v_is_owner AND v_access != 'edit' THEN
      RAISE EXCEPTION 'Permission denied. You need edit access to modify project content.';
    END IF;

    IF p_field = 'designA' THEN
      UPDATE public.workflows
      SET design_a = CASE WHEN p_value_text = '__CLEAR__' THEN NULL ELSE p_value_text END
      WHERE id = p_workflow_id;
    ELSIF p_field = 'designB' THEN
      UPDATE public.workflows
      SET design_b = CASE WHEN p_value_text = '__CLEAR__' THEN NULL ELSE p_value_text END
      WHERE id = p_workflow_id;
    ELSIF p_field = 'ourNotes' THEN
      UPDATE public.workflows SET our_notes = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'reason' THEN
      UPDATE public.workflows SET reason = p_value_text WHERE id = p_workflow_id;
    ELSIF p_field = 'isDone' THEN
      UPDATE public.workflows SET is_done = p_value_bool WHERE id = p_workflow_id;
    ELSIF p_field = 'title' THEN
      UPDATE public.workflows SET title = p_value_text WHERE id = p_workflow_id;
    END IF;

    RETURN true;
  END IF;

  RAISE EXCEPTION 'Invalid field specified: %', p_field;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_workflow_field_secure(uuid, text, text, boolean) TO authenticated;

-- 12. RPC: Submit Workflow Revision with Mandatory Reason
CREATE OR REPLACE FUNCTION public.submit_workflow_revision(
  p_workflow_id uuid,
  p_reason text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_project_id uuid;
  v_is_owner boolean := false;
  v_role text := 'client';
  v_access text := 'view';
  v_current_wf record;
  v_next_rev integer;
  v_new_rev record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason for final changes is mandatory when submitting a revision.';
  END IF;

  SELECT * INTO v_current_wf
  FROM public.workflows
  WHERE id = p_workflow_id;

  IF v_current_wf.id IS NULL THEN
    RAISE EXCEPTION 'Workflow not found.';
  END IF;

  v_project_id := v_current_wf.project_id;

  -- Check owner or member with edit permission
  SELECT (user_id = v_user_id) INTO v_is_owner
  FROM public.projects
  WHERE id = v_project_id;

  IF NOT COALESCE(v_is_owner, false) THEN
    SELECT role, access INTO v_role, v_access
    FROM public.project_members
    WHERE project_id = v_project_id AND user_id = v_user_id;

    IF v_access != 'edit' THEN
      RAISE EXCEPTION 'Permission denied. Edit permission required to submit revisions.';
    END IF;
  ELSE
    v_role := 'owner';
  END IF;

  SELECT lower(email) INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  -- Calculate next revision number
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
  FROM public.workflow_revisions
  WHERE workflow_id = p_workflow_id;

  -- Insert revision
  INSERT INTO public.workflow_revisions (
    project_id,
    workflow_id,
    revision_number,
    author_id,
    author_email,
    author_role,
    reason,
    design_a,
    design_b
  )
  VALUES (
    v_project_id,
    p_workflow_id,
    v_next_rev,
    v_user_id,
    v_user_email,
    v_role,
    trim(p_reason),
    v_current_wf.design_a,
    v_current_wf.design_b
  )
  RETURNING * INTO v_new_rev;

  -- Update workflow reason
  UPDATE public.workflows
  SET reason = trim(p_reason)
  WHERE id = p_workflow_id;

  RETURN json_build_object(
    'id', v_new_rev.id,
    'revision_number', v_new_rev.revision_number,
    'author_email', v_new_rev.author_email,
    'author_role', v_new_rev.author_role,
    'reason', v_new_rev.reason,
    'created_at', v_new_rev.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_workflow_revision(uuid, text) TO authenticated;

-- 13. RPC: Get Workflow Revisions
CREATE OR REPLACE FUNCTION public.get_workflow_revisions(p_workflow_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_revisions json;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.workflows
  WHERE id = p_workflow_id;

  IF v_project_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  IF NOT public.check_is_project_owner(v_project_id, v_user_id) AND 
     NOT public.check_is_project_member(v_project_id, v_user_id) THEN
    RAISE EXCEPTION 'Access denied.';
  END IF;

  SELECT COALESCE(json_agg(
    json_build_object(
      'id', r.id,
      'workflow_id', r.workflow_id,
      'revision_number', r.revision_number,
      'author_id', r.author_id,
      'author_email', r.author_email,
      'author_role', r.author_role,
      'reason', r.reason,
      'design_a', r.design_a,
      'design_b', r.design_b,
      'created_at', r.created_at
    ) ORDER BY r.revision_number DESC
  ), '[]'::json) INTO v_revisions
  FROM public.workflow_revisions r
  WHERE r.workflow_id = p_workflow_id;

  RETURN v_revisions;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workflow_revisions(uuid) TO authenticated;

-- Enable Supabase Realtime publication on workflow_revisions & project_members
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'workflow_revisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE workflow_revisions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'project_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE project_members;
  END IF;
END $$;
