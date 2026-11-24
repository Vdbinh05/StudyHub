-- ============================================================================
-- StudyHub V2.1 — Migration 0011: Allow PostgreSQL FK `ON DELETE SET NULL` on
-- `public.exam_attempt_questions` Without Breaking Snapshot Immutability
-- ============================================================================
-- Fixes live PG 17.12 P0 error (`P0001: exam_attempt_questions rows are immutable
-- and cannot be updated`) when deleting a question, replacing questions via import,
-- deleting a study set, or deleting a user account after taking any exam:
--   - `exam_attempt_questions.question_id` and `source_study_set_id` have
--     `ON DELETE SET NULL` foreign keys, which execute an internal PostgreSQL UPDATE
--     setting ONLY those nullable reference columns to NULL.
--   - `prevent_exam_snapshot_update()` now permits ONLY transitions of `question_id`
--     and/or `source_study_set_id` to NULL while keeping all 14 snapshot columns
--     (`id`, `attempt_id`, `position`, `question_type`, `source_subject_title`,
--      `chapter_snapshot`, `tags_snapshot`, `prompt_snapshot`, `prompt_image_url_snapshot`,
--      `explanation_snapshot`, `options_snapshot`, `correct_option_ids`,
--      `accepted_answers_snapshot`, `created_at`) 100% immutable.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_exam_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Allow ONLY PostgreSQL FK ON DELETE SET NULL on nullable reference columns
  -- while keeping all 14 exam snapshot columns 100% immutable.
  IF (
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id
    AND NEW.position IS NOT DISTINCT FROM OLD.position
    AND NEW.question_type IS NOT DISTINCT FROM OLD.question_type
    AND NEW.source_subject_title IS NOT DISTINCT FROM OLD.source_subject_title
    AND NEW.chapter_snapshot IS NOT DISTINCT FROM OLD.chapter_snapshot
    AND NEW.tags_snapshot IS NOT DISTINCT FROM OLD.tags_snapshot
    AND NEW.prompt_snapshot IS NOT DISTINCT FROM OLD.prompt_snapshot
    AND NEW.prompt_image_url_snapshot IS NOT DISTINCT FROM OLD.prompt_image_url_snapshot
    AND NEW.explanation_snapshot IS NOT DISTINCT FROM OLD.explanation_snapshot
    AND NEW.options_snapshot IS NOT DISTINCT FROM OLD.options_snapshot
    AND NEW.correct_option_ids IS NOT DISTINCT FROM OLD.correct_option_ids
    AND NEW.accepted_answers_snapshot IS NOT DISTINCT FROM OLD.accepted_answers_snapshot
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (NEW.question_id IS NULL OR NEW.question_id = OLD.question_id)
    AND (NEW.source_study_set_id IS NULL OR NEW.source_study_set_id = OLD.source_study_set_id)
    AND (
      NEW.question_id IS DISTINCT FROM OLD.question_id
      OR NEW.source_study_set_id IS DISTINCT FROM OLD.source_study_set_id
    )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'exam_attempt_questions rows are immutable and cannot be updated.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_exam_snapshot_update() FROM PUBLIC, anon, authenticated;
