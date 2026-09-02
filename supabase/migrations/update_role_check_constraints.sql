-- Fix role check constraint on project_members and project_invites
ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('client', 'freelancer', 'owner'));

ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_role_check;
ALTER TABLE public.project_invites ADD CONSTRAINT project_invites_role_check CHECK (role IN ('client', 'freelancer', 'owner'));

ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_access_check;
ALTER TABLE public.project_members ADD CONSTRAINT project_members_access_check CHECK (access IN ('view', 'edit'));

ALTER TABLE public.project_invites DROP CONSTRAINT IF EXISTS project_invites_access_check;
ALTER TABLE public.project_invites ADD CONSTRAINT project_invites_access_check CHECK (access IN ('view', 'edit'));
