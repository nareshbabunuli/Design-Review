-- Migration: Add figma_url to projects and create update_project_figma_url RPC

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS figma_url text;

CREATE OR REPLACE FUNCTION public.update_project_figma_url(p_project_id uuid, p_figma_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
  SET figma_url = p_figma_url
  WHERE id = p_project_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_project_figma_url(uuid, text) TO authenticated;
