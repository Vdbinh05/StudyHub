-- ============================================================================
-- StudyHub V2.1 — Migration 0009: Fix `question_tags` <-> `tags` Mutual RLS Recursion (`42P17`)
-- ============================================================================
-- Breaks the 2-hop PostgreSQL RLS mutual recursion cycle:
--   `question_tags_insert_editable` (ON public.question_tags -> SELECT public.tags)
--   -> `tags_select_readable_via_sets` (ON public.tags -> SELECT public.question_tags)
-- which triggers `42P17: infinite recursion detected in policy for relation "question_tags"`
-- on `INSERT INTO public.question_tags`.
-- Delegates `tags_select_readable_via_sets` to a hardened SECURITY DEFINER helper
-- `public.can_read_tag(uuid, uuid)` with `SET search_path = ''` and `current_jwt_role()`.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_read_tag(p_tag_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_tag_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.question_tags qt
      WHERE qt.tag_id = p_tag_id
        AND public.can_read_study_set(qt.study_set_id, p_user_id)
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_tag(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_tag(uuid, uuid) TO authenticated, service_role;

ALTER POLICY "tags_select_readable_via_sets" ON public.tags
  USING (public.can_read_tag(id, (SELECT auth.uid())));
