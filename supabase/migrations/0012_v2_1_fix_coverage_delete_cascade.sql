-- ============================================================================
-- StudyHub V2.1 — Migration 0012: Fix Cascading Account Delete (`23503`) When
-- User Owns a Full Coverage Cycle (`release_coverage_cycle_on_attempt_delete`)
-- ============================================================================
-- Fixes live PG 17.12 P0 error (`23503: insert or update on table "coverage_cycles"
-- violates foreign key constraint "coverage_cycles_user_id_fkey"`) when deleting a
-- user account (`DELETE FROM auth.users` -> cascades `public.profiles`) who has
-- completed or started a Full Coverage Cycle:
--   - During cascading account deletion, PostgreSQL deletes `public.profiles` first,
--     then cascades sibling tables `exam_attempts` and `coverage_cycles`.
--   - If `exam_attempts` cascades before `coverage_cycles`, `BEFORE DELETE` trigger
--     `trg_release_coverage_cycle_on_attempt_delete` previously ran `UPDATE public.coverage_cycles`
--     while `profiles(id)` was already removed, failing `coverage_cycles_user_id_fkey` (`23503`).
--   - Guarding with `EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id)` skips
--     the redundant sibling update during cascading account deletion while preserving 100%
--     of direct `DELETE /api/exams/[attemptId]` release semantics.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_coverage_cycle_on_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assigned integer;
BEGIN
  -- Skip during cascading profile/account deletion when parent profiles row is already gone;
  -- coverage_cycles and coverage_cycle_questions will themselves cascade cleanly.
  IF OLD.coverage_cycle_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id)
     AND EXISTS (SELECT 1 FROM public.coverage_cycles WHERE id = OLD.coverage_cycle_id) THEN
    UPDATE public.coverage_cycle_questions
    SET state = 'unassigned',
        assigned_attempt_id = NULL,
        assigned_at = NULL,
        was_answered = false
    WHERE cycle_id = OLD.coverage_cycle_id
      AND assigned_attempt_id = OLD.id
      AND state = 'assigned';

    SELECT count(*)::integer INTO v_assigned
    FROM public.coverage_cycle_questions
    WHERE cycle_id = OLD.coverage_cycle_id
      AND state = 'assigned';

    UPDATE public.coverage_cycles
    SET active_attempt_id = CASE
          WHEN active_attempt_id = OLD.id THEN NULL
          ELSE active_attempt_id
        END,
        assigned_count = v_assigned,
        updated_at = now()
    WHERE id = OLD.coverage_cycle_id;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.release_coverage_cycle_on_attempt_delete() FROM PUBLIC, anon, authenticated;
