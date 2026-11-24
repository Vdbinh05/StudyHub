-- ============================================================================
-- StudyHub V2.1 — Migration 0006: Supabase Cloud Security & Performance Hardening
-- ============================================================================
-- Resolves Supabase Cloud Security Advisor & Performance Advisor findings:
--   1. Move `pg_trgm` extension out of `public` into `extensions` schema (`extension_in_public = 0`).
--   2. Revoke Supabase Cloud default `anon` (and `authenticated` where internal/trigger-only)
--      EXECUTE privileges on all 27 trigger/internal/auth-only SECURITY DEFINER functions,
--      leaving ONLY the 2 intentional public RPCs (`can_read_study_set`, `preview_share_link`)
--      executable by `anon`.
--   3. Add covering composite `(study_set_id, question_id)` indexes for all 6 composite foreign
--      keys introduced in Migration 0005 (`unindexed_foreign_keys = 0`).
--
-- Non-destructive and fully idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Move `pg_trgm` extension out of `public` into `extensions` schema
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'
      AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Revoke Supabase Cloud default EXECUTE grants on SECURITY DEFINER functions
--    (Supabase Cloud grants default EXECUTE to `anon` & `authenticated` in `public`,
--     so `REVOKE ... FROM PUBLIC` alone does not strip explicit `anon`/`authenticated` grants.)
-- ----------------------------------------------------------------------------

-- 2a. Trigger & internal-only SECURITY DEFINER functions (revoke from PUBLIC, anon, authenticated)
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_study_set_question_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_study_set_question_count_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_study_set_question_count_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_coverage_cycle_on_attempt_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_exam_breakdowns(uuid) FROM PUBLIC, anon, authenticated;

-- Reinforce V1 revoked exam RPC (never callable by client roles)
REVOKE ALL ON FUNCTION public.create_exam_attempt(uuid, text, jsonb, integer, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- 2b. Authenticated-only RLS helpers & RPCs (revoke from PUBLIC & anon; grant to authenticated)
REVOKE ALL ON FUNCTION public.is_study_set_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_study_set_owner(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_edit_study_set(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_study_set(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_study_media_path(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_study_media_path(text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.find_profile_by_username_or_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_profile_by_username_or_email(text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_exam_attempt_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_attempt_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.redeem_share_link(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_share_link(text) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_deduped_study_sets(uuid[], uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_deduped_study_sets(uuid[], uuid[], boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.get_exam_eligible_pool(uuid[], uuid[], boolean, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_eligible_pool(uuid[], uuid[], boolean, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.create_coverage_cycle(text, jsonb, jsonb, text, integer, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_coverage_cycle(text, jsonb, jsonb, text, integer, jsonb, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public.discard_coverage_cycle_active_exam(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_coverage_cycle_active_exam(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.restart_coverage_cycle(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restart_coverage_cycle(uuid, jsonb, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.clone_study_set(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_study_set(uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) TO authenticated;

-- 2c. Explicitly confirm the ONLY 2 intentional public SECURITY DEFINER RPCs
REVOKE ALL ON FUNCTION public.can_read_study_set(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_study_set(uuid, uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.preview_share_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_share_link(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Composite (study_set_id, question_id) covering indexes for 0005 composite FKs
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_question_options_set_question
  ON public.question_options (study_set_id, question_id);

CREATE INDEX IF NOT EXISTS idx_question_accepted_answers_set_question
  ON public.question_accepted_answers (study_set_id, question_id);

CREATE INDEX IF NOT EXISTS idx_question_tags_set_question
  ON public.question_tags (study_set_id, question_id);

CREATE INDEX IF NOT EXISTS idx_user_question_progress_set_question
  ON public.user_question_progress (study_set_id, question_id);

CREATE INDEX IF NOT EXISTS idx_starred_questions_set_question
  ON public.starred_questions (study_set_id, question_id);

CREATE INDEX IF NOT EXISTS idx_study_session_answers_set_question
  ON public.study_session_answers (study_set_id, question_id);
