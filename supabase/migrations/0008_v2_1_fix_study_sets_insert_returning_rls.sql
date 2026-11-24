-- ============================================================================
-- StudyHub V2.1 — Migration 0008: Fix `study_sets` INSERT...RETURNING RLS (`42501`)
-- ============================================================================
-- Fixes `42501: new row violates row-level security policy for table "study_sets"`
-- on `INSERT INTO public.study_sets ... RETURNING *` (`POST /api/sets`):
--   - `study_sets_select_readable` previously called only STABLE `can_read_study_set()`,
--     whose internal SELECT read the pre-statement snapshot before the newly inserted row
--     became visible. Short-circuiting `owner_id = (SELECT auth.uid()) OR visibility = 'public'`
--     directly on the tuple resolves `INSERT ... RETURNING *` while preserving strict SH-015
--     `'public'`-only visibility (never `'unlisted'`).
--   - Updates `study_sets_insert_own` to use `public.is_folder_owner(folder_id, (SELECT auth.uid()))`.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

ALTER POLICY "study_sets_select_readable" ON public.study_sets
  USING (
    owner_id = (SELECT auth.uid())
    OR visibility = 'public'
    OR public.can_read_study_set(id, (SELECT auth.uid()))
  );

ALTER POLICY "study_sets_insert_own" ON public.study_sets
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      folder_id IS NULL
      OR public.is_folder_owner(folder_id, (SELECT auth.uid()))
    )
  );
