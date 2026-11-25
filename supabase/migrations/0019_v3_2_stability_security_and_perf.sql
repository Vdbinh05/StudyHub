-- ============================================================================
-- StudyHub V3.2 — Migration 0019: Stability, Security & Performance Hardening
--   1. SEC-05: Preserve cross-tenant exam-pinned media on account deletion
--      (nullable media_assets.owner_id ON DELETE SET NULL + scoped profile trigger)
--   2. DB-08 & DB-05 & DB-09: Drop 12 redundant B-tree indexes (unindexed_fks = 0),
--      replace idx_questions_source_metadata_idem predicate, add last_studied index
--   3. DB-14: Validate 3 NOT VALID V3 CHECK constraints on questions/question_options
--   4. DB-12: Add exam_attempt_answers.is_answered + partial index + fast autosave
--   5. FUNC-10c & SEC-15 & SEC-11 & DB-10: Sanitize numerical unit cleanly when
--      unit_required = false, deterministic md5 ordering/matching sort, pin V3
--      type_payload_snapshot media, SQL option shuffle in create_exam_attempt_v2
--   6. FUNC-07: Live Full Coverage remaining counts (excluding deleted NULL rows)
--      + auto-completion on deleted remainder
--   7. DB-01 & DB-02 & SEC-10: Atomic pre-claim & FOR UPDATE locking in
--      sync_offline_learning_events (with opaque rejected_inaccessible),
--      FOR UPDATE locking in record_study_session_answer, and atomic RPCs for
--      starred toggle, SM-2 progress, content_version bump, preferences JSONB
--      deep merge, and batched diagram hotspot updates
--   8. DB-04, DB-06, DB-07, DB-09, DB-11: Hardened global_library_search(),
--      sargable dashboard/set summaries, single-RTT list_accessible_study_sets(),
--      get_study_set_questions_page(), get_user_statistics_summary(), and
--      get_user_mistakes_page()
-- ============================================================================
-- 100% additive/idempotent, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies 0001–0018. ZERO DROP POLICY, ZERO DROP TRIGGER, ZERO DROP TABLE,
-- ZERO CREATE TEMP TABLE. 100% (SELECT auth.uid()), 100% SET search_path = ''.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SEC-05: Preserve Cross-Tenant Pinned Media on User Account Deletion
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_conname text;
BEGIN
  -- Replace media_assets.owner_id FK (ON DELETE CASCADE) with ON DELETE SET NULL
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.media_assets'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%(owner_id)%REFERENCES%profiles%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%ON DELETE SET NULL%'
  LOOP
    EXECUTE format('ALTER TABLE public.media_assets DROP CONSTRAINT %I', v_conname);
  END LOOP;

  ALTER TABLE public.media_assets
    ALTER COLUMN owner_id DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.media_assets'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%(owner_id)%REFERENCES%profiles%ON DELETE SET NULL%'
  ) THEN
    ALTER TABLE public.media_assets
      ADD CONSTRAINT media_assets_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_profile_media_relations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only delete content_media_relations owned by the departing user's OWN entities.
  -- NEVER delete relations belonging to another user's exam_attempt_question or study_set!
  DELETE FROM public.content_media_relations cmr
  WHERE (cmr.entity_type = 'profile' AND cmr.entity_id = OLD.id)
     OR (
       cmr.entity_type = 'exam_attempt_question'
       AND NOT EXISTS (
         SELECT 1
         FROM public.exam_attempt_questions eaq
         JOIN public.exam_attempts ea ON ea.id = eaq.attempt_id
         WHERE eaq.id = cmr.entity_id
           AND ea.user_id <> OLD.id
       )
       AND EXISTS (
         SELECT 1
         FROM public.media_assets ma
         WHERE ma.id = cmr.media_id AND ma.owner_id = OLD.id
       )
     )
     OR (
       cmr.entity_type = 'question'
       AND NOT EXISTS (
         SELECT 1
         FROM public.questions q
         JOIN public.study_sets s ON s.id = q.study_set_id
         WHERE q.id = cmr.entity_id
           AND s.owner_id <> OLD.id
       )
       AND EXISTS (
         SELECT 1
         FROM public.media_assets ma
         WHERE ma.id = cmr.media_id AND ma.owner_id = OLD.id
       )
     )
     OR (
       cmr.entity_type = 'question_option'
       AND NOT EXISTS (
         SELECT 1
         FROM public.question_options qo
         JOIN public.study_sets s ON s.id = qo.study_set_id
         WHERE qo.id = cmr.entity_id
           AND s.owner_id <> OLD.id
       )
       AND EXISTS (
         SELECT 1
         FROM public.media_assets ma
         WHERE ma.id = cmr.media_id AND ma.owner_id = OLD.id
       )
     )
     OR (
       cmr.entity_type = 'diagram_set'
       AND NOT EXISTS (
         SELECT 1
         FROM public.diagram_sets ds
         WHERE ds.id = cmr.entity_id
           AND ds.owner_id <> OLD.id
       )
       AND EXISTS (
         SELECT 1
         FROM public.media_assets ma
         WHERE ma.id = cmr.media_id AND ma.owner_id = OLD.id
       )
     )
     OR (
       cmr.entity_type = 'shared_passage'
       AND NOT EXISTS (
         SELECT 1
         FROM public.shared_passages sp
         WHERE sp.id = cmr.entity_id
           AND sp.owner_id <> OLD.id
       )
       AND EXISTS (
         SELECT 1
         FROM public.media_assets ma
         WHERE ma.id = cmr.media_id AND ma.owner_id = OLD.id
       )
     );

  -- Delete departing user's media_assets that have ZERO remaining relations;
  -- any cross-tenant pinned asset stays intact and gets owner_id = NULL via ON DELETE SET NULL.
  DELETE FROM public.media_assets ma
  WHERE ma.owner_id = OLD.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.content_media_relations cmr
      WHERE cmr.media_id = ma.id
    );

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_profile_media_relations() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. DB-08, DB-05, DB-09: Index Hygiene & Targeted Performance Indexes
--    (Drops 12 redundant B-tree indexes while preserving unindexed_foreign_keys = 0)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_exam_attempt_questions_attempt_id;
DROP INDEX IF EXISTS public.idx_exam_attempt_answers_attempt_id;
DROP INDEX IF EXISTS public.idx_study_set_members_study_set_id;
DROP INDEX IF EXISTS public.idx_tags_owner_id;
DROP INDEX IF EXISTS public.idx_content_media_rel_media;
DROP INDEX IF EXISTS public.idx_question_options_study_set_id;
DROP INDEX IF EXISTS public.idx_question_accepted_answers_study_set_id;
DROP INDEX IF EXISTS public.idx_question_tags_study_set_id;
DROP INDEX IF EXISTS public.idx_user_question_progress_study_set_id;
DROP INDEX IF EXISTS public.idx_starred_questions_study_set_id;
DROP INDEX IF EXISTS public.idx_study_session_answers_study_set_id;
DROP INDEX IF EXISTS public.idx_study_session_answers_session_id;

-- DB-05: Replace partial predicate so Postgres planner matches source_metadata->>'import_idempotency_key' = $1
DROP INDEX IF EXISTS public.idx_questions_source_metadata_idem;
CREATE INDEX IF NOT EXISTS idx_questions_source_metadata_idem
  ON public.questions (study_set_id, (source_metadata->>'import_idempotency_key'))
  WHERE (source_metadata->>'import_idempotency_key') IS NOT NULL;

-- DB-09: Partial index for dashboard continue_learning query
CREATE INDEX IF NOT EXISTS idx_study_sets_owner_last_studied
  ON public.study_sets (owner_id, last_studied_at DESC)
  WHERE is_archived = false AND last_studied_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. DB-14: Validate the 3 NOT VALID V3 CHECK Constraints
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND conname = 'questions_prompt_or_media_v3_chk'
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.questions VALIDATE CONSTRAINT questions_prompt_or_media_v3_chk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND conname = 'questions_audio_url_safe_chk'
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.questions VALIDATE CONSTRAINT questions_audio_url_safe_chk;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.question_options'::regclass
      AND conname = 'question_options_content_or_image_v3_chk'
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.question_options VALIDATE CONSTRAINT question_options_content_or_image_v3_chk;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. DB-12: Fast Autosave answered_count via exam_attempt_answers.is_answered
-- ----------------------------------------------------------------------------
ALTER TABLE public.exam_attempt_answers
  ADD COLUMN IF NOT EXISTS is_answered boolean NOT NULL DEFAULT false;

UPDATE public.exam_attempt_answers a
SET is_answered = public.has_exam_answer(
  q.question_type,
  a.selected_option_ids,
  a.typed_answer,
  a.structured_response
)
FROM public.exam_attempt_questions q
WHERE q.id = a.attempt_question_id
  AND a.is_answered IS DISTINCT FROM public.has_exam_answer(
    q.question_type,
    a.selected_option_ids,
    a.typed_answer,
    a.structured_response
  );

CREATE INDEX IF NOT EXISTS idx_exam_attempt_answers_attempt_answered
  ON public.exam_attempt_answers (attempt_id)
  WHERE is_answered = true;

CREATE OR REPLACE FUNCTION public.save_exam_attempt_answers(
  p_attempt_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_attempt public.exam_attempts%ROWTYPE;
  v_item jsonb;
  v_q_id uuid;
  v_q_type text;
  v_sel uuid[];
  v_typed text;
  v_structured jsonb;
  v_confidence text;
  v_hint_used boolean;
  v_flagged boolean;
  v_is_answered boolean;
  v_seq bigint;
  v_stale_ids uuid[] := '{}'::uuid[];
  v_saved_ids uuid[] := '{}'::uuid[];
  v_answered_count integer;
  v_remaining integer;
  v_saved_rows jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
    RAISE EXCEPTION 'Answers array is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_attempt.user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Exam attempt is already closed' USING ERRCODE = 'P0004';
  END IF;

  IF v_attempt.expires_at IS NOT NULL AND v_now > v_attempt.expires_at THEN
    RAISE EXCEPTION 'Exam time limit has expired' USING ERRCODE = 'P0003';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_q_id := (v_item->>'attempt_question_id')::uuid;

    SELECT eq.question_type INTO v_q_type
    FROM public.exam_attempt_questions eq
    WHERE eq.id = v_q_id AND eq.attempt_id = p_attempt_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Question does not belong to this exam attempt' USING ERRCODE = '23503';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[])
    INTO v_sel
    FROM jsonb_array_elements_text(COALESCE(v_item->'selected_option_ids', '[]'::jsonb)) AS x;

    v_typed := CASE
      WHEN v_item ? 'typed_answer' AND v_item->>'typed_answer' IS NOT NULL
      THEN left(v_item->>'typed_answer', 5000)
      ELSE NULL
    END;

    v_structured := CASE
      WHEN v_item ? 'structured_response' AND v_item->'structured_response' IS NOT NULL
           AND jsonb_typeof(v_item->'structured_response') = 'object'
      THEN v_item->'structured_response'
      ELSE NULL
    END;

    v_confidence := CASE
      WHEN v_item->>'confidence' IN ('certain', 'unsure', 'guessing')
      THEN v_item->>'confidence'
      ELSE NULL
    END;

    v_hint_used := COALESCE((v_item->>'hint_used')::boolean, false);
    v_flagged := COALESCE((v_item->>'is_flagged')::boolean, false);
    v_seq := GREATEST(0, COALESCE((v_item->>'client_seq')::bigint, 0));
    v_is_answered := public.has_exam_answer(v_q_type, v_sel, v_typed, v_structured);

    INSERT INTO public.exam_attempt_answers (
      attempt_id,
      attempt_question_id,
      user_id,
      selected_option_ids,
      typed_answer,
      structured_response,
      confidence,
      hint_used,
      is_flagged,
      is_answered,
      is_correct,
      client_seq,
      updated_at
    ) VALUES (
      p_attempt_id,
      v_q_id,
      v_caller,
      v_sel,
      v_typed,
      v_structured,
      v_confidence,
      v_hint_used,
      v_flagged,
      v_is_answered,
      NULL,
      v_seq,
      v_now
    )
    ON CONFLICT (attempt_id, attempt_question_id) DO UPDATE
    SET selected_option_ids = EXCLUDED.selected_option_ids,
        typed_answer = EXCLUDED.typed_answer,
        structured_response = EXCLUDED.structured_response,
        confidence = EXCLUDED.confidence,
        hint_used = public.exam_attempt_answers.hint_used OR EXCLUDED.hint_used,
        is_flagged = EXCLUDED.is_flagged,
        is_answered = EXCLUDED.is_answered,
        client_seq = GREATEST(public.exam_attempt_answers.client_seq, EXCLUDED.client_seq),
        updated_at = v_now
    WHERE (public.exam_attempt_answers.client_seq = 0 AND EXCLUDED.client_seq = 0)
       OR EXCLUDED.client_seq >= public.exam_attempt_answers.client_seq;

    IF FOUND THEN
      v_saved_ids := array_append(v_saved_ids, v_q_id);
    ELSE
      v_stale_ids := array_append(v_stale_ids, v_q_id);
    END IF;
  END LOOP;

  -- DB-12: Index-only count on exam_attempt_answers without joining exam_attempt_questions
  SELECT count(*)::integer INTO v_answered_count
  FROM public.exam_attempt_answers a
  WHERE a.attempt_id = p_attempt_id
    AND a.is_answered = true;

  UPDATE public.exam_attempts
  SET answered_count = v_answered_count,
      unanswered_count = GREATEST(0, total_questions - v_answered_count)
  WHERE id = p_attempt_id
    AND status = 'in_progress';

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_saved_rows
  FROM public.exam_attempt_answers a
  WHERE a.attempt_id = p_attempt_id
    AND a.attempt_question_id = ANY(v_saved_ids);

  v_remaining := CASE
    WHEN v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'saved', v_saved_rows,
    'stale_ignored_ids', to_jsonb(v_stale_ids),
    'answered_count', v_answered_count,
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. FUNC-10c, SEC-15, SEC-11, DB-10: Pre-Submit Payload Sanitization,
--    Snapshot Media Pinning & SQL Option Shuffle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sanitize_pre_submit_type_payload_seeded(
  p_question_type text,
  p_payload jsonb,
  p_seed text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_payload IS NULL THEN NULL
    WHEN p_question_type = 'fill_in_blank' THEN
      jsonb_build_object(
        'type', 'fill_in_blank',
        'template_text', p_payload->'template_text',
        'require_all_blanks', COALESCE((p_payload->>'require_all_blanks')::boolean, true),
        'blanks', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'blank_id', b.val->>'blank_id',
              'hint', b.val->'hint'
            )
            ORDER BY b.ord ASC
          )
          FROM jsonb_array_elements(COALESCE(p_payload->'blanks', '[]'::jsonb)) WITH ORDINALITY AS b(val, ord)
        ), '[]'::jsonb)
      )
    WHEN p_question_type = 'numerical' THEN
      -- FUNC-10c: Preserve unit badge ONLY when unit_required is false; strictly strip when unit_required is true
      CASE
        WHEN COALESCE((p_payload->>'unit_required')::boolean, false) THEN
          jsonb_build_object(
            'type', 'numerical',
            'unit_required', true,
            'significant_figures', p_payload->'significant_figures'
          )
        ELSE
          jsonb_build_object(
            'type', 'numerical',
            'unit_required', false,
            'unit', p_payload->'unit',
            'significant_figures', p_payload->'significant_figures'
          )
      END
    WHEN p_question_type = 'ordering' THEN
      jsonb_build_object(
        'type', 'ordering',
        'allow_partial_credit', COALESCE((p_payload->>'allow_partial_credit')::boolean, false),
        'items', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', it.val->>'id',
              'text', it.val->>'text',
              'rich_text', it.val->'rich_text',
              'image_url', it.val->'image_url',
              'media_id', it.val->'media_id'
            )
            -- SEC-15: Deterministic md5 sort defeats sequential ID leaks ("item-1", "item-2", ...)
            ORDER BY md5(COALESCE(p_seed, '') || ':' || COALESCE(it.val->>'id', '')) ASC,
                     (it.val->>'id') ASC
          )
          FROM jsonb_array_elements(COALESCE(p_payload->'items', '[]'::jsonb)) AS it(val)
        ), '[]'::jsonb)
      )
    WHEN p_question_type = 'matching' THEN
      jsonb_build_object(
        'type', 'matching',
        'left_items', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', pr.val->>'id',
              'left_text', pr.val->>'left_text',
              'left_rich_text', pr.val->'left_rich_text',
              'left_image_url', pr.val->'left_image_url'
            )
            ORDER BY pr.ord ASC
          )
          FROM jsonb_array_elements(COALESCE(p_payload->'pairs', '[]'::jsonb)) WITH ORDINALITY AS pr(val, ord)
        ), '[]'::jsonb),
        'right_items', COALESCE((
          SELECT jsonb_agg(
            r.item
            ORDER BY md5(COALESCE(p_seed, '') || ':' || COALESCE(r.item->>'right_id', '')) ASC,
                     (r.item->>'right_id') ASC
          )
          FROM (
            SELECT jsonb_build_object(
              'right_id', pr.val->>'right_id',
              'right_text', pr.val->>'right_text',
              'right_rich_text', pr.val->'right_rich_text',
              'right_image_url', pr.val->'right_image_url'
            ) AS item
            FROM jsonb_array_elements(COALESCE(p_payload->'pairs', '[]'::jsonb)) AS pr(val)
            UNION ALL
            SELECT jsonb_build_object(
              'right_id', d.val->>'right_id',
              'right_text', d.val->>'right_text',
              'right_rich_text', NULL,
              'right_image_url', d.val->'right_image_url'
            ) AS item
            FROM jsonb_array_elements(COALESCE(p_payload->'distractors', '[]'::jsonb)) AS d(val)
          ) r
        ), '[]'::jsonb)
      )
    WHEN p_question_type = 'image_hotspot' THEN
      jsonb_build_object(
        'type', 'image_hotspot',
        'diagram_id', p_payload->'diagram_id',
        'image_url', p_payload->'image_url',
        'image_media_id', p_payload->'image_media_id',
        'require_all_targets', COALESCE((p_payload->>'require_all_targets')::boolean, false),
        'target_labels', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', t.val->>'id',
              'label', t.val->>'label'
            )
            ORDER BY t.ord ASC
          )
          FROM jsonb_array_elements(COALESCE(p_payload->'target_hotspots', '[]'::jsonb)) WITH ORDINALITY AS t(val, ord)
        ), '[]'::jsonb)
      )
    WHEN p_question_type = 'listening' THEN
      jsonb_build_object(
        'type', 'listening',
        'audio_media_id', p_payload->'audio_media_id',
        'audio_url', p_payload->'audio_url',
        'show_transcript_after_submit', COALESCE((p_payload->>'show_transcript_after_submit')::boolean, true),
        'max_replays', p_payload->'max_replays',
        'language', p_payload->'language',
        'sub_answer_kind', COALESCE(p_payload->>'sub_answer_kind', 'single_choice'),
        'transcript', CASE
          WHEN COALESCE((p_payload->>'show_transcript_after_submit')::boolean, true) THEN NULL
          ELSE p_payload->'transcript'
        END
      )
    WHEN p_question_type = 'reading_passage' THEN
      jsonb_build_object(
        'type', 'reading_passage',
        'passage_id', p_payload->'passage_id',
        'passage_title', p_payload->'passage_title',
        'passage_text', p_payload->'passage_text',
        'passage_rich', p_payload->'passage_rich',
        'sub_answer_kind', COALESCE(p_payload->>'sub_answer_kind', 'single_choice')
      )
    WHEN p_question_type = 'image_choice' THEN
      jsonb_build_object(
        'type', 'image_choice',
        'selection_mode', COALESCE(p_payload->>'selection_mode', 'single')
      )
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_pre_submit_type_payload_seeded(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_pre_submit_type_payload_seeded(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sanitize_pre_submit_type_payload(
  p_question_type text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT public.sanitize_pre_submit_type_payload_seeded(
    p_question_type,
    p_payload,
    COALESCE(p_question_type, '')
  );
$$;

REVOKE ALL ON FUNCTION public.sanitize_pre_submit_type_payload(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_pre_submit_type_payload(text, jsonb) TO authenticated;

-- Keep backward-compatible 18-arg create_exam_attempt_v2 signature (reading shuffle_options from p_config)
CREATE OR REPLACE FUNCTION public.create_exam_attempt_v2(
  p_title_snapshot text,
  p_primary_study_set_id uuid,
  p_sources jsonb,
  p_selected_items jsonb,
  p_config jsonb,
  p_duration_limit_seconds integer,
  p_pass_threshold integer,
  p_allocation_strategy text DEFAULT 'global_random',
  p_selection_policy text DEFAULT 'random',
  p_requested_question_count integer DEFAULT NULL,
  p_show_subject_names boolean DEFAULT true,
  p_show_chapter_names boolean DEFAULT true,
  p_allow_navigation boolean DEFAULT true,
  p_allow_mark_for_review boolean DEFAULT true,
  p_auto_submit_on_expire boolean DEFAULT true,
  p_show_review_after_submit boolean DEFAULT true,
  p_preset_id uuid DEFAULT NULL,
  p_coverage_cycle_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_total integer;
  v_verified_count integer;
  v_distinct_sets integer;
  v_single_set_id uuid;
  v_duration integer;
  v_expires_at timestamptz;
  v_attempt public.exam_attempts%ROWTYPE;
  v_questions_json jsonb;
  v_sources_json jsonb;
  v_remaining integer;
  v_shuffle_opts boolean := COALESCE((p_config->>'shuffle_options')::boolean, false);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_selected_items IS NULL OR jsonb_typeof(p_selected_items) <> 'array' THEN
    RAISE EXCEPTION 'Selected items array is required' USING ERRCODE = '22023';
  END IF;

  v_total := jsonb_array_length(p_selected_items);
  IF v_total <= 0 OR v_total > 2000 THEN
    RAISE EXCEPTION 'Exam must contain between 1 and 2000 questions' USING ERRCODE = '22023';
  END IF;

  IF p_primary_study_set_id IS NOT NULL
     AND NOT public.can_read_study_set(p_primary_study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  IF p_preset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_presets ep WHERE ep.id = p_preset_id AND ep.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Preset not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  IF p_coverage_cycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coverage_cycles cc WHERE cc.id = p_coverage_cycle_id AND cc.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Coverage cycle not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(DISTINCT q.id)::integer,
    count(DISTINCT q.study_set_id)::integer,
    min(q.study_set_id::text)::uuid
  INTO v_verified_count, v_distinct_sets, v_single_set_id
  FROM jsonb_array_elements(p_selected_items) WITH ORDINALITY AS item(val, ord)
  JOIN public.questions q ON q.id = (item.val->>'question_id')::uuid
  WHERE q.question_type <> 'flashcard'
    AND public.can_read_study_set(q.study_set_id, v_caller);

  IF v_verified_count <> v_total THEN
    RAISE EXCEPTION 'One or more selected questions are missing, invalid, or inaccessible.'
      USING ERRCODE = '42501';
  END IF;

  IF p_duration_limit_seconds IS NOT NULL AND p_duration_limit_seconds > 0 THEN
    v_duration := p_duration_limit_seconds;
    v_expires_at := v_now + make_interval(secs => v_duration);
  ELSE
    v_duration := NULL;
    v_expires_at := NULL;
  END IF;

  INSERT INTO public.exam_attempts (
    user_id,
    study_set_id,
    study_set_title_snapshot,
    status,
    config,
    total_questions,
    answered_count,
    unanswered_count,
    pass_threshold,
    duration_limit_seconds,
    started_at,
    expires_at,
    allocation_strategy,
    selection_policy,
    requested_question_count,
    show_subject_names,
    show_chapter_names,
    allow_navigation,
    allow_mark_for_review,
    auto_submit_on_expire,
    show_review_after_submit,
    preset_id,
    coverage_cycle_id,
    is_multi_subject
  ) VALUES (
    v_caller,
    CASE WHEN v_distinct_sets = 1 THEN COALESCE(p_primary_study_set_id, v_single_set_id) ELSE NULL END,
    left(trim(COALESCE(NULLIF(p_title_snapshot, ''), 'Custom Exam')), 200),
    'in_progress',
    COALESCE(p_config, '{}'::jsonb),
    v_total,
    0,
    v_total,
    GREATEST(1, LEAST(100, COALESCE(p_pass_threshold, 70))),
    v_duration,
    v_now,
    v_expires_at,
    COALESCE(p_allocation_strategy, 'global_random'),
    COALESCE(p_selection_policy, 'random'),
    COALESCE(p_requested_question_count, v_total),
    COALESCE(p_show_subject_names, true),
    COALESCE(p_show_chapter_names, true),
    COALESCE(p_allow_navigation, true),
    COALESCE(p_allow_mark_for_review, true),
    COALESCE(p_auto_submit_on_expire, true),
    COALESCE(p_show_review_after_submit, true),
    p_preset_id,
    p_coverage_cycle_id,
    (v_distinct_sets > 1)
  )
  RETURNING * INTO v_attempt;

  IF p_sources IS NOT NULL AND jsonb_typeof(p_sources) = 'array' AND jsonb_array_length(p_sources) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sources) AS src(val)
      WHERE (
        NULLIF(src.val->>'study_set_id', '') IS NOT NULL
        AND NOT public.can_read_study_set((src.val->>'study_set_id')::uuid, v_caller)
      ) OR (
        NULLIF(src.val->>'folder_id', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.folders f
          WHERE f.id = (src.val->>'folder_id')::uuid
            AND f.owner_id = v_caller
        )
      )
    ) THEN
      RAISE EXCEPTION 'One or more exam sources are missing or inaccessible.'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.exam_attempt_sources (
      attempt_id,
      user_id,
      source_type,
      study_set_id,
      folder_id,
      subject_title_snapshot,
      eligible_count,
      requested_count,
      requested_percentage,
      allocated_count,
      sort_order
    )
    SELECT
      v_attempt.id,
      v_caller,
      COALESCE(NULLIF(src.val->>'source_type', ''), 'study_set'),
      NULLIF(src.val->>'study_set_id', '')::uuid,
      NULLIF(src.val->>'folder_id', '')::uuid,
      COALESCE(NULLIF(src.val->>'subject_title_snapshot', ''), NULLIF(src.val->>'title', ''), 'Study Set'),
      GREATEST(0, COALESCE((src.val->>'eligible_count')::integer, 0)),
      CASE WHEN src.val ? 'requested_count' AND src.val->>'requested_count' IS NOT NULL
           THEN GREATEST(0, (src.val->>'requested_count')::integer) ELSE NULL END,
      CASE WHEN src.val ? 'requested_percentage' AND src.val->>'requested_percentage' IS NOT NULL
           THEN GREATEST(0, LEAST(100, (src.val->>'requested_percentage')::numeric(5,2))) ELSE NULL END,
      GREATEST(0, COALESCE((src.val->>'allocated_count')::integer, 0)),
      (src.ord - 1)::integer
    FROM jsonb_array_elements(p_sources) WITH ORDINALITY AS src(val, ord);
  END IF;

  -- Set-based V3 snapshot insertion with SQL option shuffle when opt_order is empty (DB-10)
  WITH ordered_sel AS (
    SELECT
      (item.val->>'question_id')::uuid AS question_id,
      (item.ord - 1)::integer AS pos,
      COALESCE(item.val->'option_ids_order', '[]'::jsonb) AS opt_order
    FROM jsonb_array_elements(p_selected_items) WITH ORDINALITY AS item(val, ord)
  ),
  opt_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'label', chr(65 + (row_ord - 1)),
            'content', o.content,
            'content_rich', o.content_rich,
            'image_url', o.image_url,
            'media_id', o.media_id,
            'image_alt', o.image_alt,
            'position', (row_ord - 1)
          )
          ORDER BY row_ord ASC
        ),
        '[]'::jsonb
      ) AS options_snapshot,
      COALESCE(
        array_agg(o.id ORDER BY o.position ASC) FILTER (WHERE o.is_correct),
        '{}'::uuid[]
      ) AS correct_option_ids
    FROM ordered_sel os
    JOIN LATERAL (
      SELECT
        base_opt.id,
        base_opt.content,
        base_opt.content_rich,
        base_opt.image_url,
        base_opt.media_id,
        base_opt.image_alt,
        base_opt.is_correct,
        base_opt.position,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN jsonb_typeof(os.opt_order) = 'array' AND jsonb_array_length(os.opt_order) > 0 THEN
                COALESCE(
                  (
                    SELECT (ord_idx - 1)
                    FROM jsonb_array_elements_text(os.opt_order) WITH ORDINALITY AS u(uid, ord_idx)
                    WHERE u.uid = base_opt.id::text
                    LIMIT 1
                  ),
                  100000 + base_opt.position
                )
              ELSE 0
            END ASC,
            CASE
              WHEN (jsonb_typeof(os.opt_order) <> 'array' OR jsonb_array_length(os.opt_order) = 0)
                   AND v_shuffle_opts THEN base_opt.rand_key
              ELSE ''
            END ASC,
            base_opt.position ASC,
            base_opt.id ASC
        )::integer AS row_ord
      FROM (
        SELECT
          qo.id,
          qo.content,
          qo.content_rich,
          qo.image_url,
          qo.media_id,
          qo.image_alt,
          qo.is_correct,
          qo.position,
          gen_random_uuid()::text AS rand_key
        FROM public.question_options qo
        WHERE qo.question_id = os.question_id
      ) base_opt
    ) o ON true
    GROUP BY os.question_id
  ),
  acc_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'answer_text', aa.answer_text,
            'normalized_answer', aa.normalized_answer,
            'match_mode', aa.match_mode
          )
          ORDER BY aa.created_at ASC
        ),
        '[]'::jsonb
      ) AS accepted_answers_snapshot
    FROM ordered_sel os
    JOIN public.question_accepted_answers aa ON aa.question_id = os.question_id
    GROUP BY os.question_id
  ),
  tag_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'color', t.color
          )
          ORDER BY t.name ASC
        ),
        '[]'::jsonb
      ) AS tags_snapshot
    FROM ordered_sel os
    JOIN public.question_tags qt ON qt.question_id = os.question_id
    JOIN public.tags t ON t.id = qt.tag_id
    GROUP BY os.question_id
  ),
  media_snaps AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'media_id', ma.id,
            'role', cmr.role,
            'storage_path', ma.storage_path,
            'proxy_url', '/api/uploads/signed-url?path=' || replace(ma.storage_path, '/', '%2F') || '&redirect=1',
            'mime_type', ma.mime_type,
            'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
            'caption', COALESCE(cmr.caption, ma.caption)
          )
          ORDER BY cmr.sort_order ASC, cmr.created_at ASC
        ),
        '[]'::jsonb
      ) AS media_snapshot
    FROM ordered_sel os
    JOIN public.content_media_relations cmr
      ON cmr.entity_type = 'question' AND cmr.entity_id = os.question_id
    JOIN public.media_assets ma ON ma.id = cmr.media_id
    GROUP BY os.question_id
  )
  INSERT INTO public.exam_attempt_questions (
    attempt_id,
    question_id,
    position,
    question_type,
    source_study_set_id,
    source_subject_title,
    chapter_snapshot,
    tags_snapshot,
    prompt_snapshot,
    prompt_rich_snapshot,
    prompt_image_url_snapshot,
    audio_media_id_snapshot,
    audio_url_snapshot,
    passage_snapshot,
    diagram_snapshot,
    type_payload_snapshot,
    media_snapshot,
    explanation_snapshot,
    explanation_rich_snapshot,
    options_snapshot,
    correct_option_ids,
    accepted_answers_snapshot
  )
  SELECT
    v_attempt.id,
    q.id,
    os.pos,
    q.question_type,
    q.study_set_id,
    s.title,
    q.chapter,
    COALESCE(ts.tags_snapshot, '[]'::jsonb),
    q.prompt,
    q.prompt_rich,
    q.prompt_image_url,
    q.audio_media_id,
    q.audio_url,
    CASE WHEN sp.id IS NOT NULL THEN
      jsonb_build_object(
        'id', sp.id,
        'title', sp.title,
        'content_text', sp.content_text,
        'content_rich', sp.content_rich,
        'audio_media_id', sp.audio_media_id,
        'source_reference', sp.source_reference
      )
    ELSE NULL END,
    CASE WHEN ds.id IS NOT NULL THEN
      jsonb_build_object(
        'id', ds.id,
        'title', ds.title,
        'base_media_id', ds.base_media_id,
        'base_image_url', ds.base_image_url,
        'image_width', ds.image_width,
        'image_height', ds.image_height
      )
    ELSE NULL END,
    q.type_payload,
    COALESCE(ms.media_snapshot, '[]'::jsonb),
    q.explanation,
    q.explanation_rich,
    COALESCE(ops.options_snapshot, '[]'::jsonb),
    COALESCE(ops.correct_option_ids, '{}'::uuid[]),
    COALESCE(accs.accepted_answers_snapshot, '[]'::jsonb)
  FROM ordered_sel os
  JOIN public.questions q ON q.id = os.question_id
  JOIN public.study_sets s ON s.id = q.study_set_id
  LEFT JOIN public.shared_passages sp ON sp.id = q.passage_id
  LEFT JOIN public.diagram_sets ds ON ds.id = q.diagram_id
  LEFT JOIN opt_snapshots ops ON ops.question_id = q.id
  LEFT JOIN acc_snapshots accs ON accs.question_id = q.id
  LEFT JOIN tag_snapshots ts ON ts.question_id = q.id
  LEFT JOIN media_snaps ms ON ms.question_id = q.id
  ORDER BY os.pos ASC;

  -- Pin snapshot media to exam_attempt_question (ON DELETE RESTRICT protection)
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT DISTINCT
    cmr.media_id,
    'exam_attempt_question',
    eaq.id,
    cmr.role,
    cmr.sort_order,
    cmr.alt_text,
    cmr.caption
  FROM public.exam_attempt_questions eaq
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question'
   AND cmr.entity_id = eaq.question_id
  WHERE eaq.attempt_id = v_attempt.id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    eaq.audio_media_id_snapshot,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND eaq.audio_media_id_snapshot IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    qo.media_id,
    'exam_attempt_question',
    eaq.id,
    'option',
    qo.position
  FROM public.exam_attempt_questions eaq
  JOIN public.question_options qo ON qo.question_id = eaq.question_id
  WHERE eaq.attempt_id = v_attempt.id
    AND qo.media_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    NULLIF(eaq.diagram_snapshot->>'base_media_id', '')::uuid,
    'exam_attempt_question',
    eaq.id,
    'diagram_base',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.diagram_snapshot->>'base_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.diagram_snapshot->>'base_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    NULLIF(eaq.passage_snapshot->>'audio_media_id', '')::uuid,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.passage_snapshot->>'audio_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.passage_snapshot->>'audio_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  -- SEC-11: Pin type_payload_snapshot media UUIDs (image_hotspot, listening, ordering.items)
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (eaq.type_payload_snapshot->>'image_media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'prompt',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.type_payload_snapshot->>'image_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.type_payload_snapshot->>'image_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (eaq.type_payload_snapshot->>'audio_media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.type_payload_snapshot->>'audio_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.type_payload_snapshot->>'audio_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (it.val->>'media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'option',
    (it.ord - 1)::integer
  FROM public.exam_attempt_questions eaq
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(eaq.type_payload_snapshot->'items') = 'array'
      THEN eaq.type_payload_snapshot->'items'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS it(val, ord)
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(it.val->>'media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (it.val->>'media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  -- Build SAFE pre-submit question array (ZERO answer keys, seeded md5 sanitized V3 type_payload!)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'attempt_id', q.attempt_id,
        'question_id', q.question_id,
        'position', q.position,
        'question_type', q.question_type,
        'source_study_set_id', CASE WHEN v_attempt.show_subject_names THEN q.source_study_set_id ELSE NULL END,
        'source_subject_title', CASE WHEN v_attempt.show_subject_names THEN q.source_subject_title ELSE NULL END,
        'chapter_snapshot', CASE WHEN v_attempt.show_chapter_names THEN q.chapter_snapshot ELSE NULL END,
        'tags_snapshot', q.tags_snapshot,
        'prompt_snapshot', q.prompt_snapshot,
        'prompt_rich_snapshot', q.prompt_rich_snapshot,
        'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
        'audio_media_id_snapshot', q.audio_media_id_snapshot,
        'audio_url_snapshot', q.audio_url_snapshot,
        'passage_snapshot', q.passage_snapshot,
        'diagram_snapshot', q.diagram_snapshot,
        'type_payload_snapshot', public.sanitize_pre_submit_type_payload_seeded(q.question_type, q.type_payload_snapshot, q.id::text),
        'media_snapshot', q.media_snapshot,
        'options_snapshot', q.options_snapshot,
        'created_at', q.created_at
      )
      ORDER BY q.position ASC
    ),
    '[]'::jsonb
  )
  INTO v_questions_json
  FROM public.exam_attempt_questions q
  WHERE q.attempt_id = v_attempt.id;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(src) ORDER BY src.sort_order ASC),
    '[]'::jsonb
  )
  INTO v_sources_json
  FROM public.exam_attempt_sources src
  WHERE src.attempt_id = v_attempt.id;

  IF p_preset_id IS NOT NULL THEN
    UPDATE public.exam_presets
    SET use_count = use_count + 1,
        last_used_at = v_now
    WHERE id = p_preset_id AND user_id = v_caller;
  END IF;

  v_remaining := CASE
    WHEN v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', v_sources_json,
    'questions', v_questions_json,
    'answers', '[]'::jsonb,
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_exam_attempt_detail(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_attempt public.exam_attempts%ROWTYPE;
  v_questions jsonb;
  v_answers jsonb;
  v_sources jsonb;
  v_breakdowns jsonb := NULL;
  v_remaining integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
    AND user_id = v_caller;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC), '[]'::jsonb)
  INTO v_sources
  FROM public.exam_attempt_sources s
  WHERE s.attempt_id = p_attempt_id;

  IF v_attempt.status IN ('submitted', 'expired') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.position ASC), '[]'::jsonb)
    INTO v_questions
    FROM public.exam_attempt_questions q
    WHERE q.attempt_id = p_attempt_id;

    v_breakdowns := public.build_exam_breakdowns(p_attempt_id);
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'attempt_id', q.attempt_id,
          'question_id', q.question_id,
          'position', q.position,
          'question_type', q.question_type,
          'source_study_set_id', CASE WHEN v_attempt.show_subject_names THEN q.source_study_set_id ELSE NULL END,
          'source_subject_title', CASE WHEN v_attempt.show_subject_names THEN q.source_subject_title ELSE NULL END,
          'chapter_snapshot', CASE WHEN v_attempt.show_chapter_names THEN q.chapter_snapshot ELSE NULL END,
          'tags_snapshot', q.tags_snapshot,
          'prompt_snapshot', q.prompt_snapshot,
          'prompt_rich_snapshot', q.prompt_rich_snapshot,
          'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
          'audio_media_id_snapshot', q.audio_media_id_snapshot,
          'audio_url_snapshot', q.audio_url_snapshot,
          'passage_snapshot', q.passage_snapshot,
          'diagram_snapshot', q.diagram_snapshot,
          'type_payload_snapshot', public.sanitize_pre_submit_type_payload_seeded(q.question_type, q.type_payload_snapshot, q.id::text),
          'media_snapshot', q.media_snapshot,
          'options_snapshot', q.options_snapshot,
          'created_at', q.created_at
        )
        ORDER BY q.position ASC
      ),
      '[]'::jsonb
    )
    INTO v_questions
    FROM public.exam_attempt_questions q
    WHERE q.attempt_id = p_attempt_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_answers
  FROM public.exam_attempt_answers a
  WHERE a.attempt_id = p_attempt_id;

  v_remaining := CASE
    WHEN v_attempt.status = 'in_progress' AND v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', v_sources,
    'questions', v_questions,
    'answers', v_answers,
    'subject_breakdown', COALESCE(v_breakdowns->'subject_breakdown', '[]'::jsonb),
    'chapter_breakdown', COALESCE(v_breakdowns->'chapter_breakdown', '[]'::jsonb),
    'tag_breakdown', COALESCE(v_breakdowns->'tag_breakdown', '[]'::jsonb),
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_attempt_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_attempt_detail(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. FUNC-07: Live Coverage Cycle Remaining Counts & Mid-Cycle Delete Recovery
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_coverage_cycle_subject_progress(
  p_cycle_ids uuid[]
)
RETURNS TABLE (
  cycle_id uuid,
  study_set_id uuid,
  subject_title text,
  total integer,
  completed integer,
  assigned integer,
  remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    cq.cycle_id,
    cq.source_study_set_id AS study_set_id,
    cq.source_subject_title AS subject_title,
    count(*) FILTER (
      WHERE cq.state IN ('completed', 'assigned') OR cq.question_id IS NOT NULL
    )::integer AS total,
    count(*) FILTER (WHERE cq.state = 'completed')::integer AS completed,
    count(*) FILTER (WHERE cq.state = 'assigned')::integer AS assigned,
    count(*) FILTER (
      WHERE cq.state = 'unassigned' AND cq.question_id IS NOT NULL
    )::integer AS remaining
  FROM public.coverage_cycle_questions cq
  WHERE cq.user_id = (SELECT auth.uid())
    AND (SELECT auth.uid()) IS NOT NULL
    AND cq.cycle_id = ANY(COALESCE(p_cycle_ids, '{}'::uuid[]))
  GROUP BY cq.cycle_id, cq.source_study_set_id, cq.source_subject_title
  ORDER BY cq.cycle_id, cq.source_subject_title ASC;
$$;

REVOKE ALL ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_coverage_cycle_next_exam(
  p_cycle_id uuid,
  p_selected_items jsonb,
  p_sources jsonb,
  p_title_snapshot text,
  p_config jsonb,
  p_duration_limit_seconds integer,
  p_pass_threshold integer,
  p_show_subject_names boolean DEFAULT true,
  p_show_chapter_names boolean DEFAULT true,
  p_allow_navigation boolean DEFAULT true,
  p_allow_mark_for_review boolean DEFAULT true,
  p_auto_submit_on_expire boolean DEFAULT true,
  p_show_review_after_submit boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_cycle public.coverage_cycles%ROWTYPE;
  v_next_seq integer;
  v_selected_ids uuid[];
  v_unassigned_match integer;
  v_live_remaining integer;
  v_assigned_cnt integer;
  v_created jsonb;
  v_attempt_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cycle
  FROM public.coverage_cycles
  WHERE id = p_cycle_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage cycle not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cycle.active_attempt_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.exam_attempts ea
      WHERE ea.id = v_cycle.active_attempt_id AND ea.status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'ACTIVE_ATTEMPT_EXISTS:%', v_cycle.active_attempt_id USING ERRCODE = 'P0005';
    END IF;
  END IF;

  SELECT COALESCE(array_agg((item.val->>'question_id')::uuid), '{}'::uuid[])
  INTO v_selected_ids
  FROM jsonb_array_elements(COALESCE(p_selected_items, '[]'::jsonb)) AS item(val);

  IF COALESCE(array_length(v_selected_ids, 1), 0) = 0 THEN
    SELECT
      count(*) FILTER (WHERE state = 'unassigned' AND question_id IS NOT NULL)::integer,
      count(*) FILTER (WHERE state = 'assigned')::integer
    INTO v_live_remaining, v_assigned_cnt
    FROM public.coverage_cycle_questions
    WHERE cycle_id = p_cycle_id;

    IF v_live_remaining = 0 AND v_assigned_cnt = 0 THEN
      UPDATE public.coverage_cycles
      SET status = 'completed',
          assigned_count = 0,
          active_attempt_id = NULL,
          completed_at = COALESCE(completed_at, v_now),
          updated_at = v_now
      WHERE id = p_cycle_id;

      RETURN jsonb_build_object(
        'already_completed', true,
        'cycle_id', p_cycle_id,
        'status', 'completed'
      );
    END IF;
    RAISE EXCEPTION 'CYCLE_ALREADY_COMPLETED' USING ERRCODE = 'P0006';
  END IF;

  SELECT count(*)::integer INTO v_unassigned_match
  FROM public.coverage_cycle_questions cq
  WHERE cq.cycle_id = p_cycle_id
    AND cq.state = 'unassigned'
    AND cq.question_id = ANY(v_selected_ids);

  IF v_unassigned_match <> array_length(v_selected_ids, 1) THEN
    RAISE EXCEPTION 'Selected questions are no longer unassigned in this coverage cycle.'
      USING ERRCODE = 'P0007';
  END IF;

  SELECT COALESCE(max(sequence_number), 0) + 1 INTO v_next_seq
  FROM public.coverage_cycle_attempts
  WHERE cycle_id = p_cycle_id;

  v_created := public.create_exam_attempt_v2(
    p_title_snapshot,
    NULL,
    p_sources,
    p_selected_items,
    p_config,
    p_duration_limit_seconds,
    p_pass_threshold,
    v_cycle.allocation_strategy,
    'random',
    array_length(v_selected_ids, 1),
    p_show_subject_names,
    p_show_chapter_names,
    p_allow_navigation,
    p_allow_mark_for_review,
    p_auto_submit_on_expire,
    p_show_review_after_submit,
    v_cycle.preset_id,
    p_cycle_id
  );

  v_attempt_id := (v_created->'attempt'->>'id')::uuid;

  UPDATE public.coverage_cycle_questions
  SET state = 'assigned',
      assigned_attempt_id = v_attempt_id,
      times_assigned = times_assigned + 1,
      assigned_at = v_now
  WHERE cycle_id = p_cycle_id
    AND question_id = ANY(v_selected_ids);

  INSERT INTO public.coverage_cycle_attempts (
    cycle_id,
    attempt_id,
    user_id,
    sequence_number,
    status,
    assigned_question_count
  ) VALUES (
    p_cycle_id,
    v_attempt_id,
    v_caller,
    v_next_seq,
    'in_progress',
    array_length(v_selected_ids, 1)
  );

  SELECT count(*)::integer INTO v_assigned_cnt
  FROM public.coverage_cycle_questions
  WHERE cycle_id = p_cycle_id AND state = 'assigned';

  UPDATE public.coverage_cycles
  SET active_attempt_id = v_attempt_id,
      assigned_count = v_assigned_cnt,
      status = 'active',
      updated_at = v_now
  WHERE id = p_cycle_id;

  RETURN v_created || jsonb_build_object(
    'cycle_id', p_cycle_id,
    'sequence_number', v_next_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. DB-01, DB-02 & SEC-10: Atomic Sync Pre-Claim, Row Locking & Atomic RPCs
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.learning_sync_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%rejected_revoked%'
      AND conname <> 'learning_sync_events_status_v32_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.learning_sync_events DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.learning_sync_events'::regclass
      AND conname = 'learning_sync_events_status_v32_chk'
  ) THEN
    ALTER TABLE public.learning_sync_events
      ADD CONSTRAINT learning_sync_events_status_v32_chk
      CHECK (
        status IN (
          'processing',
          'applied',
          'duplicate_ignored',
          'ignored_stale_reset',
          'rejected_revoked',
          'rejected_deleted',
          'rejected_inaccessible',
          'conflict',
          'invalid'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_offline_learning_events(
  p_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_user_gen integer := 1;
  v_item jsonb;
  v_event_id uuid;
  v_claimed_id uuid;
  v_event_type text;
  v_set_id uuid;
  v_q_id uuid;
  v_client_ts timestamptz;
  v_ev_gen integer;
  v_base_ver integer;
  v_payload jsonb;
  v_existing_owner uuid;
  v_q_exists boolean;
  v_set_exists boolean;
  v_existing_note public.user_question_notes%ROWTYPE;
  v_is_correct boolean;
  v_confidence text;
  v_hint_used boolean;
  v_starred boolean;
  v_session_key text;
  v_mode text;
  v_results jsonb := '[]'::jsonb;
  v_status text;
  v_msg text;
  v_srv_ver integer;
  v_srv_data jsonb;
  v_existing_prog public.user_question_progress%ROWTYPE;
  v_has_prog boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'Events array is required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_events) > 200 THEN
    RAISE EXCEPTION 'Maximum 200 sync events per batch' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(up.progress_generation, 1) INTO v_user_gen
  FROM public.user_preferences up
  WHERE up.user_id = v_caller;
  v_user_gen := COALESCE(v_user_gen, 1);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    v_status := 'applied';
    v_msg := NULL;
    v_srv_ver := NULL;
    v_srv_data := NULL;
    v_set_exists := false;
    v_q_exists := false;
    v_claimed_id := NULL;

    BEGIN
      v_event_id := (v_item->>'event_id')::uuid;
      v_event_type := v_item->>'event_type';
      v_set_id := NULLIF(v_item->>'study_set_id', '')::uuid;
      v_q_id := NULLIF(v_item->>'question_id', '')::uuid;
      v_client_ts := COALESCE((v_item->>'client_timestamp')::timestamptz, v_now);
      v_ev_gen := COALESCE((v_item->>'progress_generation')::integer, v_user_gen);
      v_base_ver := CASE WHEN v_item ? 'base_version' AND v_item->>'base_version' IS NOT NULL
                         THEN (v_item->>'base_version')::integer ELSE NULL END;
      v_payload := COALESCE(v_item->'payload', '{}'::jsonb);
    EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'event_id', COALESCE(v_item->>'event_id', ''),
        'status', 'invalid',
        'message', 'Malformed sync event fields.'
      ));
      CONTINUE;
    END;

    IF v_event_id IS NULL OR v_event_type NOT IN (
      'answer', 'confidence', 'star', 'note_upsert', 'checkpoint_upsert', 'mistake_resolve'
    ) THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'event_id', COALESCE(v_event_id::text, ''),
        'status', 'invalid',
        'message', 'Unsupported sync event type.'
      ));
      CONTINUE;
    END IF;

    -- DB-01: Atomically pre-claim event_id FIRST so concurrent retries can NEVER double-apply!
    INSERT INTO public.learning_sync_events (
      event_id, user_id, event_type, study_set_id, question_id,
      client_timestamp, progress_generation, status, payload, processed_at
    ) VALUES (
      v_event_id,
      v_caller,
      v_event_type,
      NULL,
      NULL,
      v_client_ts,
      v_ev_gen,
      'processing',
      v_payload,
      v_now
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id INTO v_claimed_id;

    IF v_claimed_id IS NULL THEN
      SELECT lse.user_id INTO v_existing_owner
      FROM public.learning_sync_events lse
      WHERE lse.event_id = v_event_id;

      IF v_existing_owner = v_caller THEN
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'event_id', v_event_id,
          'status', 'duplicate_ignored'
        ));
      ELSE
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'event_id', v_event_id,
          'status', 'invalid',
          'message', 'Event ID rejected.'
        ));
      END IF;
      CONTINUE;
    END IF;

    -- SEC-10: Opaque authorization check — collapse nonexistent & unauthorized into rejected_inaccessible!
    IF v_set_id IS NULL AND v_q_id IS NOT NULL THEN
      SELECT q.study_set_id INTO v_set_id
      FROM public.questions q
      WHERE q.id = v_q_id
        AND public.can_read_study_set(q.study_set_id, v_caller);

      IF v_set_id IS NULL THEN
        v_status := 'rejected_inaccessible';
        v_msg := 'Study content is unavailable or inaccessible.';
      END IF;
    END IF;

    IF v_status = 'applied' AND v_set_id IS NOT NULL THEN
      IF NOT public.can_read_study_set(v_set_id, v_caller) THEN
        v_status := 'rejected_inaccessible';
        v_msg := 'Study content is unavailable or inaccessible.';
      ELSE
        v_set_exists := true;
      END IF;
    END IF;

    IF v_status = 'applied' AND v_q_id IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.questions q
        WHERE q.id = v_q_id
          AND (v_set_id IS NULL OR q.study_set_id = v_set_id)
          AND public.can_read_study_set(q.study_set_id, v_caller)
      ) INTO v_q_exists;

      IF NOT v_q_exists THEN
        v_status := 'rejected_inaccessible';
        v_msg := 'Study content is unavailable or inaccessible.';
      END IF;
    END IF;

    IF v_status = 'applied'
       AND v_event_type IN ('answer', 'confidence', 'mistake_resolve', 'checkpoint_upsert')
       AND v_ev_gen < v_user_gen THEN
      v_status := 'ignored_stale_reset';
      v_msg := 'Event predates the latest learning progress reset.';
    END IF;

    IF v_status = 'applied' THEN
      IF v_event_type = 'answer' THEN
        IF v_set_id IS NULL OR v_q_id IS NULL THEN
          v_status := 'invalid';
          v_msg := 'answer event requires study_set_id and question_id.';
        ELSE
          v_is_correct := COALESCE((v_payload->>'is_correct')::boolean, false);
          v_confidence := CASE WHEN v_payload->>'confidence' IN ('certain', 'unsure', 'guessing')
                               THEN v_payload->>'confidence' ELSE NULL END;
          v_hint_used := COALESCE((v_payload->>'hint_used')::boolean, false);
          v_mode := CASE WHEN v_payload->>'mode' IN (
            'flashcards', 'learn', 'practice', 'write', 'match', 'review', 'spell', 'diagram', 'custom_practice'
          ) THEN v_payload->>'mode' ELSE 'practice' END;

          -- DB-01: Serialize progress mutation per (user, question) with advisory lock + FOR UPDATE
          PERFORM pg_advisory_xact_lock(
            hashtext('uqp:' || v_caller::text),
            hashtext(v_q_id::text)
          );

          SELECT * INTO v_existing_prog
          FROM public.user_question_progress p
          WHERE p.user_id = v_caller AND p.question_id = v_q_id
          FOR UPDATE;
          v_has_prog := FOUND;

          WITH prev AS (
            SELECT
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.mastery_level, 'new') ELSE 'new' END AS pm,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.mistake_status, 'active') ELSE 'active' END AS pms,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.correct_count, 0) ELSE 0 END AS pc,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.wrong_count, 0) ELSE 0 END AS pw,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.consecutive_correct, 0) ELSE 0 END AS psc,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.consecutive_wrong, 0) ELSE 0 END AS psw,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.ease_factor, 2.50) ELSE 2.50 END AS pef,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.interval_days, 0) ELSE 0 END AS pint,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.repetitions, 0) ELSE 0 END AS preps,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.low_confidence_count, 0) ELSE 0 END AS plc,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.high_conf_wrong_count, 0) ELSE 0 END AS phcw,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.guess_correct_count, 0) ELSE 0 END AS pgc,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.independent_recall_count, 0) ELSE 0 END AS pir,
              CASE WHEN v_has_prog THEN COALESCE(v_existing_prog.hint_used_count, 0) ELSE 0 END AS phu,
              CASE WHEN v_has_prog THEN v_existing_prog.last_wrong_at ELSE NULL END AS plw
          ),
          base_calc AS (
            SELECT
              pm,
              pms,
              pc + CASE WHEN v_is_correct THEN 1 ELSE 0 END AS nc,
              pw + CASE WHEN v_is_correct THEN 0 ELSE 1 END AS nw,
              CASE
                WHEN NOT v_is_correct THEN 0
                WHEN v_confidence = 'guessing' THEN LEAST(psc + 1, 2)
                ELSE psc + 1
              END AS nsc,
              CASE WHEN v_is_correct THEN 0 ELSE psw + 1 END AS nsw,
              CASE
                WHEN NOT v_is_correct THEN 0
                WHEN v_confidence = 'guessing' THEN LEAST(preps, 1)
                ELSE preps + 1
              END AS nreps,
              CASE
                WHEN NOT v_is_correct THEN 1
                WHEN v_confidence = 'guessing' THEN 1
                ELSE CASE WHEN preps = 0 THEN 1 WHEN preps = 1 THEN 6
                          ELSE GREATEST(1, LEAST(3650, round(GREATEST(1, pint) * pef)::integer)) END
              END AS raw_int,
              CASE
                WHEN v_is_correct THEN round(GREATEST(1.30, LEAST(4.00, pef)), 2)
                WHEN v_confidence = 'certain' THEN round(GREATEST(1.30, pef - 0.59), 2)
                ELSE round(GREATEST(1.30, pef - 0.54), 2)
              END AS nef,
              CASE WHEN v_is_correct THEN plw ELSE v_client_ts END AS nlw,
              plc + CASE WHEN v_confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END AS nlc,
              phcw + CASE WHEN NOT v_is_correct AND v_confidence = 'certain' THEN 1 ELSE 0 END AS nhcw,
              pgc + CASE WHEN v_is_correct AND v_confidence = 'guessing' THEN 1 ELSE 0 END AS ngc,
              pir + CASE
                WHEN v_is_correct
                 AND NOT v_hint_used
                 AND (v_confidence IS NULL OR v_confidence = 'certain')
                THEN 1 ELSE 0
              END AS nir,
              phu + CASE WHEN v_hint_used THEN 1 ELSE 0 END AS nhu
            FROM prev
          ),
          calc AS (
            SELECT
              bc.*,
              CASE
                WHEN NOT v_is_correct THEN 1
                WHEN v_confidence = 'guessing' THEN 1
                WHEN v_confidence = 'unsure' THEN LEAST(bc.raw_int, 4)
                WHEN v_hint_used THEN LEAST(bc.raw_int, 6)
                ELSE bc.raw_int
              END AS nint
            FROM base_calc bc
          )
          INSERT INTO public.user_question_progress (
            user_id, study_set_id, question_id, mastery_level,
            correct_count, wrong_count, consecutive_correct, consecutive_wrong,
            ease_factor, interval_days, repetitions, last_reviewed_at, last_wrong_at,
            next_review_at, last_confidence, low_confidence_count, high_conf_wrong_count,
            guess_correct_count, independent_recall_count, hint_used_count,
            mistake_status, progress_generation, updated_at
          )
          SELECT
            v_caller, v_set_id, v_q_id,
            CASE
              WHEN NOT v_is_correct THEN 'learning'
              WHEN v_confidence = 'guessing' THEN
                CASE WHEN pm = 'mastered' OR nsc >= 2 OR nint >= 6 THEN 'familiar' ELSE 'learning' END
              WHEN v_confidence = 'unsure' OR v_hint_used THEN
                CASE WHEN nsc >= 2 OR nint >= 6 THEN 'familiar' ELSE 'learning' END
              WHEN nsc >= 3 AND nint >= 14 THEN 'mastered'
              WHEN nsc >= 2 OR nint >= 6 THEN 'familiar'
              ELSE 'learning'
            END,
            nc, nw, nsc, nsw, nef, nint, nreps, v_client_ts, nlw,
            v_now + make_interval(days => nint), v_confidence, nlc, nhcw, ngc, nir, nhu,
            CASE
              WHEN NOT v_is_correct THEN 'active'
              WHEN nw > 0 AND (v_confidence = 'guessing' OR v_hint_used) THEN
                CASE WHEN pms = 'resolved' THEN 'improving' ELSE pms END
              WHEN nw > 0 AND nsc >= 2 THEN 'resolved'
              WHEN nw > 0 THEN 'improving'
              ELSE 'resolved'
            END,
            v_user_gen, v_now
          FROM calc
          ON CONFLICT (user_id, question_id) DO UPDATE
          SET study_set_id = EXCLUDED.study_set_id,
              mastery_level = EXCLUDED.mastery_level,
              correct_count = EXCLUDED.correct_count,
              wrong_count = EXCLUDED.wrong_count,
              consecutive_correct = EXCLUDED.consecutive_correct,
              consecutive_wrong = EXCLUDED.consecutive_wrong,
              ease_factor = EXCLUDED.ease_factor,
              interval_days = EXCLUDED.interval_days,
              repetitions = EXCLUDED.repetitions,
              last_reviewed_at = EXCLUDED.last_reviewed_at,
              last_wrong_at = EXCLUDED.last_wrong_at,
              next_review_at = EXCLUDED.next_review_at,
              last_confidence = COALESCE(EXCLUDED.last_confidence, public.user_question_progress.last_confidence),
              low_confidence_count = EXCLUDED.low_confidence_count,
              high_conf_wrong_count = EXCLUDED.high_conf_wrong_count,
              guess_correct_count = EXCLUDED.guess_correct_count,
              independent_recall_count = EXCLUDED.independent_recall_count,
              hint_used_count = EXCLUDED.hint_used_count,
              mistake_status = EXCLUDED.mistake_status,
              progress_generation = EXCLUDED.progress_generation,
              updated_at = EXCLUDED.updated_at;

          IF v_confidence IS NOT NULL THEN
            INSERT INTO public.learning_confidence_events (
              user_id, study_set_id, question_id, mode, confidence, is_correct, hint_used, created_at
            ) VALUES (
              v_caller, v_set_id, v_q_id, v_mode, v_confidence, v_is_correct, v_hint_used, v_client_ts
            );
          END IF;
        END IF;

      ELSIF v_event_type = 'confidence' THEN
        v_confidence := v_payload->>'confidence';
        v_is_correct := COALESCE((v_payload->>'is_correct')::boolean, false);
        v_hint_used := COALESCE((v_payload->>'hint_used')::boolean, false);
        v_mode := CASE WHEN v_payload->>'mode' IN (
          'flashcards', 'learn', 'practice', 'write', 'match', 'review', 'spell', 'diagram', 'custom_practice', 'exam'
        ) THEN v_payload->>'mode' ELSE 'practice' END;
        IF v_set_id IS NULL OR v_q_id IS NULL OR v_confidence NOT IN ('certain', 'unsure', 'guessing') THEN
          v_status := 'invalid';
          v_msg := 'Invalid confidence payload.';
        ELSE
          INSERT INTO public.learning_confidence_events (
            user_id, study_set_id, question_id, mode, confidence, is_correct, hint_used, created_at
          ) VALUES (
            v_caller, v_set_id, v_q_id, v_mode, v_confidence, v_is_correct, v_hint_used, v_client_ts
          );
        END IF;

      ELSIF v_event_type = 'star' THEN
        v_starred := COALESCE((v_payload->>'starred')::boolean, true);
        IF v_set_id IS NULL OR v_q_id IS NULL THEN
          v_status := 'invalid';
          v_msg := 'star event requires study_set_id and question_id.';
        ELSIF v_starred THEN
          INSERT INTO public.starred_questions (user_id, question_id, study_set_id)
          VALUES (v_caller, v_q_id, v_set_id)
          ON CONFLICT DO NOTHING;
        ELSE
          DELETE FROM public.starred_questions
          WHERE user_id = v_caller AND question_id = v_q_id;
        END IF;

      ELSIF v_event_type = 'mistake_resolve' THEN
        IF v_q_id IS NULL THEN
          v_status := 'invalid';
          v_msg := 'mistake_resolve requires question_id.';
        ELSE
          UPDATE public.user_question_progress
          SET mistake_status = 'resolved',
              updated_at = v_now
          WHERE user_id = v_caller AND question_id = v_q_id;
        END IF;

      ELSIF v_event_type = 'note_upsert' THEN
        IF v_set_id IS NULL OR v_q_id IS NULL THEN
          v_status := 'invalid';
          v_msg := 'note_upsert requires study_set_id and question_id.';
        ELSE
          PERFORM pg_advisory_xact_lock(
            hashtext('note:' || v_caller::text),
            hashtext(v_q_id::text)
          );

          SELECT * INTO v_existing_note
          FROM public.user_question_notes n
          WHERE n.user_id = v_caller AND n.question_id = v_q_id
          FOR UPDATE;

          IF FOUND AND v_base_ver IS NOT NULL AND v_base_ver <> v_existing_note.version THEN
            v_status := 'conflict';
            v_msg := 'Personal note was modified on another device.';
            v_srv_ver := v_existing_note.version;
            v_srv_data := to_jsonb(v_existing_note);
          ELSIF FOUND THEN
            UPDATE public.user_question_notes
            SET content_text = left(COALESCE(v_payload->>'content_text', ''), 10000),
                content_rich = CASE WHEN v_payload ? 'content_rich' THEN v_payload->'content_rich' ELSE content_rich END,
                version = version + 1,
                updated_at = v_now
            WHERE id = v_existing_note.id
            RETURNING version INTO v_srv_ver;
          ELSE
            INSERT INTO public.user_question_notes (
              user_id, study_set_id, question_id, content_text, content_rich, version
            ) VALUES (
              v_caller,
              v_set_id,
              v_q_id,
              left(COALESCE(v_payload->>'content_text', ''), 10000),
              v_payload->'content_rich',
              1
            )
            RETURNING version INTO v_srv_ver;
          END IF;
        END IF;

      ELSIF v_event_type = 'checkpoint_upsert' THEN
        v_session_key := NULLIF(trim(COALESCE(v_payload->>'session_key', '')), '');
        v_mode := v_payload->>'mode';
        IF v_session_key IS NULL OR v_mode NOT IN (
          'flashcards', 'learn', 'practice', 'write', 'match', 'review', 'spell', 'diagram', 'custom_practice'
        ) THEN
          v_status := 'invalid';
          v_msg := 'checkpoint_upsert requires session_key and valid mode.';
        ELSE
          INSERT INTO public.learning_session_checkpoints (
            user_id, study_set_id, mode, session_key, state_json,
            progress_percent, current_index, total_items, device_id, updated_at
          ) VALUES (
            v_caller,
            v_set_id,
            v_mode,
            left(v_session_key, 120),
            COALESCE(v_payload->'state_json', '{}'::jsonb),
            GREATEST(0, LEAST(100, COALESCE((v_payload->>'progress_percent')::numeric(5,2), 0))),
            GREATEST(0, COALESCE((v_payload->>'current_index')::integer, 0)),
            GREATEST(0, COALESCE((v_payload->>'total_items')::integer, 0)),
            left(NULLIF(v_payload->>'device_id', ''), 120),
            v_now
          )
          ON CONFLICT (user_id, session_key) DO UPDATE
          SET state_json = EXCLUDED.state_json,
              progress_percent = EXCLUDED.progress_percent,
              current_index = EXCLUDED.current_index,
              total_items = EXCLUDED.total_items,
              device_id = EXCLUDED.device_id,
              updated_at = v_now;
        END IF;
      END IF;
    END IF;

    -- Finalize claimed ledger row (or release claim on resolvable note conflict)
    IF v_status = 'conflict' THEN
      DELETE FROM public.learning_sync_events
      WHERE event_id = v_event_id AND user_id = v_caller;
    ELSE
      UPDATE public.learning_sync_events
      SET study_set_id = CASE WHEN v_set_exists THEN v_set_id ELSE NULL END,
          question_id = CASE WHEN v_q_exists THEN v_q_id ELSE NULL END,
          status = v_status,
          result_detail = CASE WHEN v_msg IS NOT NULL THEN jsonb_build_object('message', v_msg) ELSE NULL END,
          processed_at = v_now
      WHERE event_id = v_event_id AND user_id = v_caller;
    END IF;

    v_results := v_results || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'event_id', v_event_id,
        'status', v_status,
        'message', v_msg,
        'server_version', v_srv_ver,
        'server_data', v_srv_data
      ))
    );
  END LOOP;

  RETURN jsonb_build_object(
    'results', v_results,
    'server_now', v_now,
    'current_progress_generation', v_user_gen
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_offline_learning_events(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_offline_learning_events(jsonb) TO authenticated;

-- DB-01: Lock study_sessions + user_question_progress FOR UPDATE & atomic counter increment
CREATE OR REPLACE FUNCTION public.record_study_session_answer(
  p_session_id uuid,
  p_question_id uuid,
  p_selected_option_ids uuid[] DEFAULT '{}'::uuid[],
  p_typed_answer text DEFAULT NULL,
  p_structured_response jsonb DEFAULT NULL,
  p_is_correct boolean DEFAULT NULL,
  p_self_rating text DEFAULT NULL,
  p_confidence text DEFAULT NULL,
  p_hint_used boolean DEFAULT false,
  p_response_time_ms integer DEFAULT NULL,
  p_update_progress boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_session public.study_sessions%ROWTYPE;
  v_question RECORD;
  v_effective_selected uuid[];
  v_correct_ids uuid[];
  v_selected_sorted uuid[];
  v_is_choice boolean := false;
  v_is_correct boolean := false;
  v_has_accepted boolean := false;
  v_norm_user text;
  v_norm_back text;
  v_answer public.study_session_answers%ROWTYPE;

  v_existing public.user_question_progress%ROWTYPE;
  v_has_existing boolean := false;
  v_user_gen integer := 1;
  v_quality integer;
  v_passed boolean;
  v_prev_ease numeric(4,2);
  v_prev_interval integer;
  v_prev_reps integer;
  v_prev_correct integer;
  v_prev_wrong integer;
  v_prev_streak integer;
  v_prev_wrong_streak integer;
  v_prev_mastery text;
  v_prev_mistake_status text;
  v_raw_ease numeric;
  v_final_ease numeric(4,2);
  v_final_reps integer;
  v_final_interval integer;
  v_final_streak integer;
  v_final_mastery text;
  v_next_correct integer;
  v_next_wrong integer;
  v_next_wrong_streak integer;
  v_next_last_wrong_at timestamptz;
  v_indep_delta integer := 0;
  v_derived_mistake_status text;
  v_progress public.user_question_progress%ROWTYPE;
  v_progress_json jsonb := NULL;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_self_rating IS NOT NULL AND p_self_rating NOT IN ('again', 'hard', 'good', 'easy') THEN
    RAISE EXCEPTION 'Invalid self_rating value' USING ERRCODE = '22023';
  END IF;

  IF p_confidence IS NOT NULL AND p_confidence NOT IN ('certain', 'unsure', 'guessing') THEN
    RAISE EXCEPTION 'Invalid confidence value' USING ERRCODE = '22023';
  END IF;

  -- DB-01: Lock study_sessions row FOR UPDATE to serialize concurrent answer submissions
  SELECT * INTO v_session
  FROM public.study_sessions ss
  WHERE ss.id = p_session_id
    AND ss.user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study session not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT q.id, q.study_set_id, q.question_type, q.back_text
  INTO v_question
  FROM public.questions q
  WHERE q.id = p_question_id;

  IF NOT FOUND OR NOT public.can_read_study_set(v_question.study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002';
  END IF;

  IF (v_session.study_set_id IS NOT NULL OR COALESCE(array_length(v_session.source_study_set_ids, 1), 0) > 0)
     AND NOT COALESCE(
       (v_session.study_set_id IS NOT NULL AND v_question.study_set_id = v_session.study_set_id)
       OR (v_session.source_study_set_ids IS NOT NULL AND v_question.study_set_id = ANY(v_session.source_study_set_ids)),
       false
     ) THEN
    RAISE EXCEPTION 'Question does not belong to this study session' USING ERRCODE = '22023';
  END IF;

  v_effective_selected := COALESCE(p_selected_option_ids, '{}'::uuid[]);
  IF COALESCE(array_length(v_effective_selected, 1), 0) = 0
     AND p_structured_response IS NOT NULL
     AND p_structured_response->>'kind' = 'options'
     AND jsonb_typeof(p_structured_response->'selected_option_ids') = 'array' THEN
    SELECT COALESCE(array_agg(elem::uuid), '{}'::uuid[])
    INTO v_effective_selected
    FROM jsonb_array_elements_text(p_structured_response->'selected_option_ids') AS elem;
  END IF;

  v_is_choice := v_question.question_type IN ('single_choice', 'multiple_choice', 'true_false', 'image_choice');

  IF v_is_choice AND COALESCE(array_length(v_effective_selected, 1), 0) > 0 THEN
    SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
    INTO v_correct_ids
    FROM public.question_options o
    WHERE o.question_id = v_question.id
      AND o.study_set_id = v_question.study_set_id
      AND o.is_correct = true;

    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
    INTO v_selected_sorted
    FROM unnest(v_effective_selected) AS x;

    v_is_correct := COALESCE(array_length(v_correct_ids, 1), 0) > 0 AND v_correct_ids = v_selected_sorted;
  ELSIF p_is_correct IS NOT NULL THEN
    v_is_correct := p_is_correct;
  ELSIF p_self_rating IS NOT NULL THEN
    v_is_correct := (p_self_rating <> 'again');
  ELSIF p_typed_answer IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.question_accepted_answers a
      WHERE a.question_id = v_question.id
        AND a.study_set_id = v_question.study_set_id
    ) INTO v_has_accepted;

    IF v_has_accepted THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.question_accepted_answers a
        WHERE a.question_id = v_question.id
          AND a.study_set_id = v_question.study_set_id
          AND public.normalize_short_answer(p_typed_answer, a.match_mode) <> ''
          AND public.normalize_short_answer(p_typed_answer, a.match_mode)
              = public.normalize_short_answer(a.answer_text, a.match_mode)
      ) INTO v_is_correct;
    ELSIF v_question.back_text IS NOT NULL THEN
      v_norm_user := public.normalize_short_answer(p_typed_answer, 'ignore_diacritics');
      v_norm_back := public.normalize_short_answer(v_question.back_text, 'ignore_diacritics');
      v_is_correct := (v_norm_user <> '' AND v_norm_user = v_norm_back);
    ELSE
      v_is_correct := false;
    END IF;
  ELSE
    v_is_correct := false;
  END IF;

  INSERT INTO public.study_session_answers (
    session_id,
    user_id,
    study_set_id,
    question_id,
    selected_option_ids,
    typed_answer,
    structured_response,
    confidence,
    hint_used,
    is_correct,
    self_rating,
    response_time_ms
  ) VALUES (
    v_session.id,
    v_caller,
    v_question.study_set_id,
    v_question.id,
    v_effective_selected,
    p_typed_answer,
    p_structured_response,
    p_confidence,
    COALESCE(p_hint_used, false),
    v_is_correct,
    p_self_rating,
    p_response_time_ms
  )
  RETURNING * INTO v_answer;

  -- DB-01: Atomic counter increment under FOR UPDATE session lock
  UPDATE public.study_sessions
  SET completed_items = completed_items + 1,
      correct_items = correct_items + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = v_session.id
    AND user_id = v_caller;

  IF COALESCE(p_update_progress, true) THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('uqp:' || v_caller::text),
      hashtext(v_question.id::text)
    );

    SELECT * INTO v_existing
    FROM public.user_question_progress p
    WHERE p.user_id = v_caller
      AND p.question_id = v_question.id
    FOR UPDATE;
    v_has_existing := FOUND;

    SELECT COALESCE(up.progress_generation, 1) INTO v_user_gen
    FROM public.user_preferences up
    WHERE up.user_id = v_caller;
    v_user_gen := COALESCE(v_user_gen, 1);

    v_prev_ease := CASE WHEN v_has_existing THEN v_existing.ease_factor ELSE 2.50 END;
    v_prev_interval := CASE WHEN v_has_existing THEN v_existing.interval_days ELSE 0 END;
    v_prev_reps := CASE WHEN v_has_existing THEN v_existing.repetitions ELSE 0 END;
    v_prev_correct := CASE WHEN v_has_existing THEN v_existing.correct_count ELSE 0 END;
    v_prev_wrong := CASE WHEN v_has_existing THEN v_existing.wrong_count ELSE 0 END;
    v_prev_streak := CASE WHEN v_has_existing THEN v_existing.consecutive_correct ELSE 0 END;
    v_prev_wrong_streak := CASE WHEN v_has_existing THEN COALESCE(v_existing.consecutive_wrong, 0) ELSE 0 END;
    v_prev_mastery := CASE WHEN v_has_existing THEN v_existing.mastery_level ELSE 'new' END;
    v_prev_mistake_status := CASE WHEN v_has_existing THEN COALESCE(v_existing.mistake_status, 'active') ELSE 'active' END;

    IF p_self_rating IS NOT NULL THEN
      v_quality := CASE p_self_rating
        WHEN 'again' THEN 1
        WHEN 'hard' THEN 3
        WHEN 'good' THEN 4
        ELSE 5
      END;
    ELSE
      v_quality := CASE WHEN v_is_correct THEN 4 ELSE 1 END;
    END IF;

    v_passed := (v_quality >= 3) AND (p_self_rating IS NOT NULL OR v_is_correct);

    v_raw_ease := v_prev_ease + (0.1 - (5 - v_quality) * (0.08 + (5 - v_quality) * 0.02));
    v_final_ease := round(GREATEST(1.30, LEAST(4.00, v_raw_ease)), 2);

    IF NOT v_passed THEN
      v_final_reps := 0;
      v_final_interval := 1;
      v_final_streak := 0;
    ELSE
      IF v_prev_reps = 0 THEN
        v_final_interval := 1;
      ELSIF v_prev_reps = 1 THEN
        v_final_interval := 6;
      ELSE
        v_final_interval := LEAST(3650, GREATEST(1, round(v_prev_interval * v_prev_ease)::integer));
      END IF;
      v_final_reps := v_prev_reps + 1;
      v_final_streak := v_prev_streak + 1;
    END IF;

    v_next_correct := v_prev_correct + CASE WHEN v_passed THEN 1 ELSE 0 END;
    v_next_wrong := v_prev_wrong + CASE WHEN v_passed THEN 0 ELSE 1 END;

    IF v_next_correct = 0 AND v_next_wrong = 0 THEN
      v_final_mastery := 'new';
    ELSIF v_final_streak >= 3 AND v_final_interval >= 14 THEN
      v_final_mastery := 'mastered';
    ELSIF v_final_streak >= 2 OR v_final_interval >= 6 THEN
      v_final_mastery := 'familiar';
    ELSE
      v_final_mastery := 'learning';
    END IF;

    IF v_passed THEN
      IF p_confidence = 'guessing' THEN
        v_final_interval := 1;
        v_final_reps := LEAST(v_prev_reps, 1);
        v_final_streak := LEAST(v_final_streak, 2);
        IF v_prev_mastery = 'mastered' THEN
          v_final_mastery := 'familiar';
        ELSIF v_final_streak >= 2 OR v_final_interval >= 6 THEN
          v_final_mastery := 'familiar';
        ELSE
          v_final_mastery := 'learning';
        END IF;
      ELSIF p_confidence = 'unsure' THEN
        v_final_interval := LEAST(v_final_interval, 4);
        v_final_mastery := CASE WHEN v_final_streak >= 2 OR v_final_interval >= 6 THEN 'familiar' ELSE 'learning' END;
      ELSIF COALESCE(p_hint_used, false) THEN
        v_final_interval := LEAST(v_final_interval, 6);
        v_final_mastery := CASE WHEN v_final_streak >= 2 OR v_final_interval >= 6 THEN 'familiar' ELSE 'learning' END;
      ELSE
        v_indep_delta := 1;
      END IF;
    ELSIF p_confidence = 'certain' THEN
      v_final_ease := round(GREATEST(1.30, v_final_ease - 0.05), 2);
    END IF;

    v_next_wrong_streak := CASE WHEN v_passed THEN 0 ELSE v_prev_wrong_streak + 1 END;
    v_next_last_wrong_at := CASE
      WHEN v_passed THEN CASE WHEN v_has_existing THEN v_existing.last_wrong_at ELSE NULL END
      ELSE v_now
    END;

    IF NOT v_passed THEN
      v_derived_mistake_status := 'active';
    ELSIF v_next_wrong > 0 THEN
      IF p_confidence = 'guessing' OR COALESCE(p_hint_used, false) THEN
        v_derived_mistake_status := CASE WHEN v_prev_mistake_status = 'resolved' THEN 'improving' ELSE v_prev_mistake_status END;
      ELSIF v_final_streak >= 2 THEN
        v_derived_mistake_status := 'resolved';
      ELSE
        v_derived_mistake_status := 'improving';
      END IF;
    ELSE
      v_derived_mistake_status := 'resolved';
    END IF;

    INSERT INTO public.user_question_progress (
      user_id, study_set_id, question_id, mastery_level,
      correct_count, wrong_count, consecutive_correct, consecutive_wrong,
      ease_factor, interval_days, repetitions, last_reviewed_at, last_wrong_at,
      next_review_at, last_confidence, low_confidence_count, high_conf_wrong_count,
      guess_correct_count, independent_recall_count, hint_used_count,
      mistake_status, progress_generation, updated_at
    ) VALUES (
      v_caller, v_question.study_set_id, v_question.id, v_final_mastery,
      v_next_correct, v_next_wrong, v_final_streak, v_next_wrong_streak,
      v_final_ease, v_final_interval, v_final_reps, v_now, v_next_last_wrong_at,
      v_now + make_interval(days => v_final_interval),
      COALESCE(p_confidence, CASE WHEN v_has_existing THEN v_existing.last_confidence ELSE NULL END),
      (CASE WHEN v_has_existing THEN COALESCE(v_existing.low_confidence_count, 0) ELSE 0 END)
        + CASE WHEN p_confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END,
      (CASE WHEN v_has_existing THEN COALESCE(v_existing.high_conf_wrong_count, 0) ELSE 0 END)
        + CASE WHEN NOT v_passed AND p_confidence = 'certain' THEN 1 ELSE 0 END,
      (CASE WHEN v_has_existing THEN COALESCE(v_existing.guess_correct_count, 0) ELSE 0 END)
        + CASE WHEN v_passed AND p_confidence = 'guessing' THEN 1 ELSE 0 END,
      (CASE WHEN v_has_existing THEN COALESCE(v_existing.independent_recall_count, 0) ELSE 0 END)
        + v_indep_delta,
      (CASE WHEN v_has_existing THEN COALESCE(v_existing.hint_used_count, 0) ELSE 0 END)
        + CASE WHEN COALESCE(p_hint_used, false) THEN 1 ELSE 0 END,
      v_derived_mistake_status, v_user_gen, v_now
    )
    ON CONFLICT (user_id, question_id) DO UPDATE
    SET study_set_id = EXCLUDED.study_set_id,
        mastery_level = EXCLUDED.mastery_level,
        correct_count = EXCLUDED.correct_count,
        wrong_count = EXCLUDED.wrong_count,
        consecutive_correct = EXCLUDED.consecutive_correct,
        consecutive_wrong = EXCLUDED.consecutive_wrong,
        ease_factor = EXCLUDED.ease_factor,
        interval_days = EXCLUDED.interval_days,
        repetitions = EXCLUDED.repetitions,
        last_reviewed_at = EXCLUDED.last_reviewed_at,
        last_wrong_at = EXCLUDED.last_wrong_at,
        next_review_at = EXCLUDED.next_review_at,
        last_confidence = EXCLUDED.last_confidence,
        low_confidence_count = EXCLUDED.low_confidence_count,
        high_conf_wrong_count = EXCLUDED.high_conf_wrong_count,
        guess_correct_count = EXCLUDED.guess_correct_count,
        independent_recall_count = EXCLUDED.independent_recall_count,
        hint_used_count = EXCLUDED.hint_used_count,
        mistake_status = EXCLUDED.mistake_status,
        progress_generation = EXCLUDED.progress_generation,
        updated_at = EXCLUDED.updated_at
    RETURNING * INTO v_progress;

    IF p_confidence IS NOT NULL THEN
      INSERT INTO public.learning_confidence_events (
        user_id, study_set_id, question_id, mode, confidence,
        is_correct, hint_used, response_time_ms, created_at
      ) VALUES (
        v_caller, v_question.study_set_id, v_question.id, v_session.mode, p_confidence,
        v_passed, COALESCE(p_hint_used, false), p_response_time_ms, v_now
      );
    END IF;

    v_progress_json := to_jsonb(v_progress);
  END IF;

  RETURN jsonb_build_object(
    'answer', to_jsonb(v_answer),
    'is_correct', v_is_correct,
    'progress', v_progress_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_study_session_answer(uuid, uuid, uuid[], text, jsonb, boolean, text, text, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_study_session_answer(uuid, uuid, uuid[], text, jsonb, boolean, text, text, boolean, integer, boolean) TO authenticated;

-- DB-02: Atomic toggle_starred_question RPC (1 RTT, zero 23505 double-click race)
CREATE OR REPLACE FUNCTION public.toggle_starred_question(
  p_question_id uuid,
  p_study_set_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_set_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT q.study_set_id INTO v_set_id
  FROM public.questions q
  WHERE q.id = p_question_id;

  IF NOT FOUND OR NOT public.can_read_study_set(v_set_id, v_caller) THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_study_set_id IS NOT NULL AND p_study_set_id <> v_set_id THEN
    RAISE EXCEPTION 'Question does not belong to the specified study set' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('star:' || v_caller::text),
    hashtext(p_question_id::text)
  );

  DELETE FROM public.starred_questions
  WHERE user_id = v_caller
    AND question_id = p_question_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'starred', false,
      'question_id', p_question_id
    );
  END IF;

  INSERT INTO public.starred_questions (user_id, question_id, study_set_id)
  VALUES (v_caller, p_question_id, v_set_id)
  ON CONFLICT (user_id, question_id) DO NOTHING;

  RETURN jsonb_build_object(
    'starred', true,
    'question_id', p_question_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_starred_question(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_starred_question(uuid, uuid) TO authenticated;

-- DB-02: Atomic record_progress_answer RPC for POST /api/progress
CREATE OR REPLACE FUNCTION public.record_progress_answer(
  p_question_id uuid,
  p_study_set_id uuid DEFAULT NULL,
  p_is_correct boolean DEFAULT true,
  p_self_rating text DEFAULT NULL,
  p_confidence text DEFAULT NULL,
  p_hint_used boolean DEFAULT false,
  p_mode text DEFAULT NULL,
  p_response_time_ms integer DEFAULT NULL,
  p_override_mastery_level text DEFAULT NULL,
  p_override_mistake_status text DEFAULT NULL,
  p_override_ease_factor numeric DEFAULT NULL,
  p_override_interval_days integer DEFAULT NULL,
  p_override_repetitions integer DEFAULT NULL,
  p_override_next_review_at timestamptz DEFAULT NULL,
  p_has_override_next_review_at boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_set_id uuid;
  v_existing public.user_question_progress%ROWTYPE;
  v_has_existing boolean := false;
  v_user_gen integer := 1;
  v_quality integer;
  v_passed boolean;
  v_prev_ease numeric(4,2);
  v_prev_interval integer;
  v_prev_reps integer;
  v_prev_correct integer;
  v_prev_wrong integer;
  v_prev_streak integer;
  v_prev_wrong_streak integer;
  v_prev_mastery text;
  v_prev_mistake_status text;
  v_raw_ease numeric;
  v_final_ease numeric(4,2);
  v_final_reps integer;
  v_final_interval integer;
  v_final_streak integer;
  v_final_mastery text;
  v_next_correct integer;
  v_next_wrong integer;
  v_next_wrong_streak integer;
  v_next_last_wrong_at timestamptz;
  v_indep_delta integer := 0;
  v_derived_mistake_status text;
  v_progress public.user_question_progress%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_self_rating IS NOT NULL AND p_self_rating NOT IN ('again', 'hard', 'good', 'easy') THEN
    RAISE EXCEPTION 'Invalid self_rating value' USING ERRCODE = '22023';
  END IF;

  IF p_confidence IS NOT NULL AND p_confidence NOT IN ('certain', 'unsure', 'guessing') THEN
    RAISE EXCEPTION 'Invalid confidence value' USING ERRCODE = '22023';
  END IF;

  SELECT q.study_set_id INTO v_set_id
  FROM public.questions q
  WHERE q.id = p_question_id;

  IF NOT FOUND OR NOT public.can_read_study_set(v_set_id, v_caller) THEN
    RAISE EXCEPTION 'Question not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_study_set_id IS NOT NULL AND p_study_set_id <> v_set_id THEN
    RAISE EXCEPTION 'Question does not belong to the specified study set' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('uqp:' || v_caller::text),
    hashtext(p_question_id::text)
  );

  SELECT * INTO v_existing
  FROM public.user_question_progress p
  WHERE p.user_id = v_caller
    AND p.question_id = p_question_id
  FOR UPDATE;
  v_has_existing := FOUND;

  SELECT COALESCE(up.progress_generation, 1) INTO v_user_gen
  FROM public.user_preferences up
  WHERE up.user_id = v_caller;
  v_user_gen := COALESCE(v_user_gen, 1);

  v_prev_ease := CASE WHEN v_has_existing THEN v_existing.ease_factor ELSE 2.50 END;
  v_prev_interval := CASE WHEN v_has_existing THEN v_existing.interval_days ELSE 0 END;
  v_prev_reps := CASE WHEN v_has_existing THEN v_existing.repetitions ELSE 0 END;
  v_prev_correct := CASE WHEN v_has_existing THEN v_existing.correct_count ELSE 0 END;
  v_prev_wrong := CASE WHEN v_has_existing THEN v_existing.wrong_count ELSE 0 END;
  v_prev_streak := CASE WHEN v_has_existing THEN v_existing.consecutive_correct ELSE 0 END;
  v_prev_wrong_streak := CASE WHEN v_has_existing THEN COALESCE(v_existing.consecutive_wrong, 0) ELSE 0 END;
  v_prev_mastery := CASE WHEN v_has_existing THEN v_existing.mastery_level ELSE 'new' END;
  v_prev_mistake_status := CASE WHEN v_has_existing THEN COALESCE(v_existing.mistake_status, 'active') ELSE 'active' END;

  IF p_self_rating IS NOT NULL THEN
    v_quality := CASE p_self_rating
      WHEN 'again' THEN 1
      WHEN 'hard' THEN 3
      WHEN 'good' THEN 4
      ELSE 5
    END;
  ELSE
    v_quality := CASE WHEN COALESCE(p_is_correct, false) THEN 4 ELSE 1 END;
  END IF;

  v_passed := (v_quality >= 3) AND (p_self_rating IS NOT NULL OR COALESCE(p_is_correct, false));

  v_raw_ease := v_prev_ease + (0.1 - (5 - v_quality) * (0.08 + (5 - v_quality) * 0.02));
  v_final_ease := round(GREATEST(1.30, LEAST(4.00, v_raw_ease)), 2);

  IF NOT v_passed THEN
    v_final_reps := 0;
    v_final_interval := 1;
    v_final_streak := 0;
  ELSE
    IF v_prev_reps = 0 THEN
      v_final_interval := 1;
    ELSIF v_prev_reps = 1 THEN
      v_final_interval := 6;
    ELSE
      v_final_interval := LEAST(3650, GREATEST(1, round(v_prev_interval * v_prev_ease)::integer));
    END IF;
    v_final_reps := v_prev_reps + 1;
    v_final_streak := v_prev_streak + 1;
  END IF;

  v_next_correct := v_prev_correct + CASE WHEN v_passed THEN 1 ELSE 0 END;
  v_next_wrong := v_prev_wrong + CASE WHEN v_passed THEN 0 ELSE 1 END;

  IF v_next_correct = 0 AND v_next_wrong = 0 THEN
    v_final_mastery := 'new';
  ELSIF v_final_streak >= 3 AND v_final_interval >= 14 THEN
    v_final_mastery := 'mastered';
  ELSIF v_final_streak >= 2 OR v_final_interval >= 6 THEN
    v_final_mastery := 'familiar';
  ELSE
    v_final_mastery := 'learning';
  END IF;

  IF v_passed THEN
    IF p_confidence = 'guessing' THEN
      v_final_interval := 1;
      v_final_reps := LEAST(v_prev_reps, 1);
      v_final_streak := LEAST(v_final_streak, 2);
      IF v_prev_mastery = 'mastered' THEN
        v_final_mastery := 'familiar';
      ELSIF v_final_streak >= 2 OR v_final_interval >= 6 THEN
        v_final_mastery := 'familiar';
      ELSE
        v_final_mastery := 'learning';
      END IF;
    ELSIF p_confidence = 'unsure' THEN
      v_final_interval := LEAST(v_final_interval, 4);
      v_final_mastery := CASE WHEN v_final_streak >= 2 OR v_final_interval >= 6 THEN 'familiar' ELSE 'learning' END;
    ELSIF COALESCE(p_hint_used, false) THEN
      v_final_interval := LEAST(v_final_interval, 6);
      v_final_mastery := CASE WHEN v_final_streak >= 2 OR v_final_interval >= 6 THEN 'familiar' ELSE 'learning' END;
    ELSE
      v_indep_delta := 1;
    END IF;
  ELSIF p_confidence = 'certain' THEN
    v_final_ease := round(GREATEST(1.30, v_final_ease - 0.05), 2);
  END IF;

  v_next_wrong_streak := CASE WHEN v_passed THEN 0 ELSE v_prev_wrong_streak + 1 END;
  v_next_last_wrong_at := CASE
    WHEN v_passed THEN CASE WHEN v_has_existing THEN v_existing.last_wrong_at ELSE NULL END
    ELSE v_now
  END;

  IF NOT v_passed THEN
    v_derived_mistake_status := 'active';
  ELSIF v_next_wrong > 0 THEN
    IF p_confidence = 'guessing' OR COALESCE(p_hint_used, false) THEN
      v_derived_mistake_status := CASE WHEN v_prev_mistake_status = 'resolved' THEN 'improving' ELSE v_prev_mistake_status END;
    ELSIF v_final_streak >= 2 THEN
      v_derived_mistake_status := 'resolved';
    ELSE
      v_derived_mistake_status := 'improving';
    END IF;
  ELSE
    v_derived_mistake_status := 'resolved';
  END IF;

  INSERT INTO public.user_question_progress (
    user_id, study_set_id, question_id, mastery_level,
    correct_count, wrong_count, consecutive_correct, consecutive_wrong,
    ease_factor, interval_days, repetitions, last_reviewed_at, last_wrong_at,
    next_review_at, last_confidence, low_confidence_count, high_conf_wrong_count,
    guess_correct_count, independent_recall_count, hint_used_count,
    mistake_status, progress_generation, updated_at
  ) VALUES (
    v_caller,
    v_set_id,
    p_question_id,
    COALESCE(p_override_mastery_level, v_final_mastery),
    v_next_correct,
    v_next_wrong,
    v_final_streak,
    v_next_wrong_streak,
    COALESCE(p_override_ease_factor, v_final_ease),
    COALESCE(p_override_interval_days, v_final_interval),
    COALESCE(p_override_repetitions, v_final_reps),
    v_now,
    v_next_last_wrong_at,
    CASE
      WHEN COALESCE(p_has_override_next_review_at, false) THEN p_override_next_review_at
      ELSE v_now + make_interval(days => COALESCE(p_override_interval_days, v_final_interval))
    END,
    COALESCE(p_confidence, CASE WHEN v_has_existing THEN v_existing.last_confidence ELSE NULL END),
    (CASE WHEN v_has_existing THEN COALESCE(v_existing.low_confidence_count, 0) ELSE 0 END)
      + CASE WHEN p_confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END,
    (CASE WHEN v_has_existing THEN COALESCE(v_existing.high_conf_wrong_count, 0) ELSE 0 END)
      + CASE WHEN NOT v_passed AND p_confidence = 'certain' THEN 1 ELSE 0 END,
    (CASE WHEN v_has_existing THEN COALESCE(v_existing.guess_correct_count, 0) ELSE 0 END)
      + CASE WHEN v_passed AND p_confidence = 'guessing' THEN 1 ELSE 0 END,
    (CASE WHEN v_has_existing THEN COALESCE(v_existing.independent_recall_count, 0) ELSE 0 END)
      + v_indep_delta,
    (CASE WHEN v_has_existing THEN COALESCE(v_existing.hint_used_count, 0) ELSE 0 END)
      + CASE WHEN COALESCE(p_hint_used, false) THEN 1 ELSE 0 END,
    COALESCE(p_override_mistake_status, v_derived_mistake_status),
    v_user_gen,
    v_now
  )
  ON CONFLICT (user_id, question_id) DO UPDATE
  SET study_set_id = EXCLUDED.study_set_id,
      mastery_level = EXCLUDED.mastery_level,
      correct_count = EXCLUDED.correct_count,
      wrong_count = EXCLUDED.wrong_count,
      consecutive_correct = EXCLUDED.consecutive_correct,
      consecutive_wrong = EXCLUDED.consecutive_wrong,
      ease_factor = EXCLUDED.ease_factor,
      interval_days = EXCLUDED.interval_days,
      repetitions = EXCLUDED.repetitions,
      last_reviewed_at = EXCLUDED.last_reviewed_at,
      last_wrong_at = EXCLUDED.last_wrong_at,
      next_review_at = EXCLUDED.next_review_at,
      last_confidence = EXCLUDED.last_confidence,
      low_confidence_count = EXCLUDED.low_confidence_count,
      high_conf_wrong_count = EXCLUDED.high_conf_wrong_count,
      guess_correct_count = EXCLUDED.guess_correct_count,
      independent_recall_count = EXCLUDED.independent_recall_count,
      hint_used_count = EXCLUDED.hint_used_count,
      mistake_status = EXCLUDED.mistake_status,
      progress_generation = EXCLUDED.progress_generation,
      updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_progress;

  IF p_confidence IS NOT NULL AND p_mode IS NOT NULL THEN
    INSERT INTO public.learning_confidence_events (
      user_id, study_set_id, question_id, mode, confidence,
      is_correct, hint_used, response_time_ms, created_at
    ) VALUES (
      v_caller, v_set_id, p_question_id, p_mode, p_confidence,
      v_passed, COALESCE(p_hint_used, false), p_response_time_ms, v_now
    );
  END IF;

  RETURN to_jsonb(v_progress);
END;
$$;

REVOKE ALL ON FUNCTION public.record_progress_answer(
  uuid, uuid, boolean, text, text, boolean, text, integer, text, text, numeric, integer, integer, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_progress_answer(
  uuid, uuid, boolean, text, text, boolean, text, integer, text, text, numeric, integer, integer, timestamptz, boolean
) TO authenticated;

-- DB-02 & V32-037: Atomic content_version bump RPC
CREATE OR REPLACE FUNCTION public.bump_study_set_content_version(p_set_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_next integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_set_id IS NULL OR NOT public.can_edit_study_set(p_set_id, v_caller) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.study_sets
  SET content_version = COALESCE(content_version, 1) + 1,
      updated_at = now()
  WHERE id = p_set_id
  RETURNING content_version INTO v_next;

  RETURN COALESCE(v_next, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.bump_study_set_content_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bump_study_set_content_version(uuid) TO authenticated;

-- DB-02: Atomic next question position allocator
CREATE OR REPLACE FUNCTION public.allocate_question_position(p_set_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_next integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_set_id IS NULL OR NOT public.can_edit_study_set(p_set_id, v_caller) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('qpos:' || p_set_id::text));

  SELECT COALESCE(max(q.position), -1) + 1 INTO v_next
  FROM public.questions q
  WHERE q.study_set_id = p_set_id;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_question_position(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_question_position(uuid) TO authenticated;

-- DB-02: Atomic JSONB 2-level merge for PATCH /api/preferences
CREATE OR REPLACE FUNCTION public.patch_user_preferences(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_existing public.user_preferences%ROWTYPE;
  v_merged_modes jsonb;
  v_incoming_modes jsonb;
  v_section text;
  v_val jsonb;
  v_prev_section jsonb;
  v_updated public.user_preferences%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_preferences (user_id)
  VALUES (v_caller)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_existing
  FROM public.user_preferences up
  WHERE up.user_id = v_caller
  FOR UPDATE;

  v_merged_modes := CASE
    WHEN v_existing.mode_preferences IS NOT NULL AND jsonb_typeof(v_existing.mode_preferences) = 'object'
    THEN v_existing.mode_preferences
    ELSE '{}'::jsonb
  END;

  IF p_patch ? 'mode_preferences' AND jsonb_typeof(p_patch->'mode_preferences') = 'object' THEN
    v_incoming_modes := p_patch->'mode_preferences';
    FOR v_section, v_val IN SELECT * FROM jsonb_each(v_incoming_modes) LOOP
      IF jsonb_typeof(v_val) = 'object' THEN
        v_prev_section := CASE
          WHEN jsonb_typeof(v_merged_modes->v_section) = 'object'
          THEN v_merged_modes->v_section
          ELSE '{}'::jsonb
        END;
        v_merged_modes := jsonb_set(
          v_merged_modes,
          ARRAY[v_section],
          v_prev_section || v_val,
          true
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.user_preferences
  SET language = CASE WHEN p_patch ? 'language' THEN p_patch->>'language' ELSE language END,
      theme = CASE WHEN p_patch ? 'theme' THEN p_patch->>'theme' ELSE theme END,
      daily_goal = CASE WHEN p_patch ? 'daily_goal' THEN (p_patch->>'daily_goal')::integer ELSE daily_goal END,
      default_shuffle_questions = CASE WHEN p_patch ? 'default_shuffle_questions' THEN (p_patch->>'default_shuffle_questions')::boolean ELSE default_shuffle_questions END,
      default_shuffle_options = CASE WHEN p_patch ? 'default_shuffle_options' THEN (p_patch->>'default_shuffle_options')::boolean ELSE default_shuffle_options END,
      show_instant_feedback = CASE WHEN p_patch ? 'show_instant_feedback' THEN (p_patch->>'show_instant_feedback')::boolean ELSE show_instant_feedback END,
      sound_effects = CASE WHEN p_patch ? 'sound_effects' THEN (p_patch->>'sound_effects')::boolean ELSE sound_effects END,
      reduced_motion = CASE WHEN p_patch ? 'reduced_motion' THEN (p_patch->>'reduced_motion')::boolean ELSE reduced_motion END,
      confidence_enabled = CASE WHEN p_patch ? 'confidence_enabled' THEN (p_patch->>'confidence_enabled')::boolean ELSE confidence_enabled END,
      mode_preferences = v_merged_modes,
      updated_at = now()
  WHERE user_id = v_caller
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.patch_user_preferences(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_user_preferences(jsonb) TO authenticated;

-- DB-02 & DB-10: Atomic diagram patch + batched hotspot upsert (zero N+1, atomic content_version)
CREATE OR REPLACE FUNCTION public.save_diagram_patch(
  p_diagram_id uuid,
  p_patch jsonb,
  p_hotspots jsonb DEFAULT NULL,
  p_replace_hotspots boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_existing public.diagram_sets%ROWTYPE;
  v_updated public.diagram_sets%ROWTYPE;
  v_new_media_id uuid := NULL;
  v_kept_ids uuid[] := '{}'::uuid[];
  v_hotspots_json jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_replace_hotspots, false)
     AND p_hotspots IS NOT NULL
     AND jsonb_typeof(p_hotspots) = 'array'
     AND jsonb_array_length(p_hotspots) > 200 THEN
    RAISE EXCEPTION 'Maximum 200 hotspots per diagram' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.diagram_sets ds
  WHERE ds.id = p_diagram_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diagram not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_edit_study_set(v_existing.study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Enforce strict media authorization parity with content_media_relations RLS (prevents cross-tenant pinning)
  IF p_patch ? 'base_media_id' THEN
    v_new_media_id := NULLIF(p_patch->>'base_media_id', '')::uuid;
    IF v_new_media_id IS NOT NULL
       AND NOT public.can_edit_media_asset(v_new_media_id, v_caller) THEN
      RAISE EXCEPTION 'Media asset not accessible' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.diagram_sets
  SET title = CASE WHEN p_patch ? 'title' THEN p_patch->>'title' ELSE title END,
      description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
      base_media_id = CASE WHEN p_patch ? 'base_media_id' THEN NULLIF(p_patch->>'base_media_id', '')::uuid ELSE base_media_id END,
      base_image_url = CASE WHEN p_patch ? 'base_image_url' THEN p_patch->>'base_image_url' ELSE base_image_url END,
      image_width = CASE WHEN p_patch ? 'image_width' THEN (p_patch->>'image_width')::integer ELSE image_width END,
      image_height = CASE WHEN p_patch ? 'image_height' THEN (p_patch->>'image_height')::integer ELSE image_height END,
      content_version = COALESCE(content_version, 1) + 1,
      updated_at = v_now
  WHERE id = p_diagram_id
  RETURNING * INTO v_updated;

  IF p_patch ? 'base_media_id' THEN
    DELETE FROM public.content_media_relations
    WHERE entity_type = 'diagram_set'
      AND entity_id = p_diagram_id
      AND role = 'diagram_base';

    IF v_updated.base_media_id IS NOT NULL THEN
      INSERT INTO public.content_media_relations (
        media_id, entity_type, entity_id, role, sort_order
      ) VALUES (
        v_updated.base_media_id, 'diagram_set', p_diagram_id, 'diagram_base', 0
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF COALESCE(p_replace_hotspots, false) AND p_hotspots IS NOT NULL AND jsonb_typeof(p_hotspots) = 'array' THEN
    -- Batch-update existing hotspots (preserving stable UUIDs)
    WITH incoming AS (
      SELECT
        CASE WHEN public.is_strict_uuid(el.val->>'id') THEN (el.val->>'id')::uuid ELSE NULL END AS req_id,
        el.val->>'label' AS label,
        COALESCE(
          (SELECT array_agg(a) FROM jsonb_array_elements_text(COALESCE(el.val->'accepted_alternatives', '[]'::jsonb)) AS a),
          '{}'::text[]
        ) AS accepted_alternatives,
        el.val->>'description' AS description,
        el.val->>'hint' AS hint,
        el.val->>'shape' AS shape,
        el.val->'geometry' AS geometry,
        COALESCE((el.val->>'sort_order')::integer, (el.ord - 1)::integer) AS sort_order
      FROM jsonb_array_elements(p_hotspots) WITH ORDINALITY AS el(val, ord)
    ),
    updated_hs AS (
      UPDATE public.diagram_hotspots dh
      SET label = inc.label,
          accepted_alternatives = inc.accepted_alternatives,
          description = inc.description,
          hint = inc.hint,
          shape = inc.shape,
          geometry = inc.geometry,
          sort_order = inc.sort_order,
          updated_at = v_now
      FROM incoming inc
      WHERE dh.diagram_id = p_diagram_id
        AND inc.req_id IS NOT NULL
        AND dh.id = inc.req_id
      RETURNING dh.id
    ),
    inserted_hs AS (
      INSERT INTO public.diagram_hotspots (
        diagram_id, study_set_id, label, accepted_alternatives,
        description, hint, shape, geometry, sort_order
      )
      SELECT
        p_diagram_id,
        v_existing.study_set_id,
        inc.label,
        inc.accepted_alternatives,
        inc.description,
        inc.hint,
        inc.shape,
        inc.geometry,
        inc.sort_order
      FROM incoming inc
      WHERE inc.req_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM public.diagram_hotspots dh
           WHERE dh.diagram_id = p_diagram_id AND dh.id = inc.req_id
         )
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_kept_ids
    FROM (
      SELECT id FROM updated_hs
      UNION ALL
      SELECT id FROM inserted_hs
    ) kept;

    DELETE FROM public.diagram_hotspots dh
    WHERE dh.diagram_id = p_diagram_id
      AND NOT (dh.id = ANY(v_kept_ids));
  END IF;

  -- Atomic study_sets.content_version increment
  UPDATE public.study_sets
  SET content_version = COALESCE(content_version, 1) + 1,
      updated_at = v_now
  WHERE id = v_existing.study_set_id;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(dh) ORDER BY dh.sort_order ASC, dh.created_at ASC),
    '[]'::jsonb
  )
  INTO v_hotspots_json
  FROM public.diagram_hotspots dh
  WHERE dh.diagram_id = p_diagram_id;

  RETURN jsonb_build_object(
    'diagram', to_jsonb(v_updated) || jsonb_build_object('hotspots', v_hotspots_json)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_diagram_patch(uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_diagram_patch(uuid, jsonb, jsonb, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. DB-04: Hardened global_library_search() (No source_metadata scan/leak,
--    per-branch LIMIT 200, RFC 3986 percent-encoded chapter URL, viewer-safe href)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.url_encode_query_param(p_val text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT string_agg(
        CASE
          WHEN ch ~ '[A-Za-z0-9._~-]' THEN ch
          ELSE (
            SELECT string_agg('%' || upper(encode(substring(b FROM idx FOR 1), 'hex')), '')
            FROM (SELECT convert_to(ch, 'UTF8') AS b) raw_b,
                 generate_series(1, octet_length(raw_b.b)) AS idx
          )
        END,
        ''
        ORDER BY pos
      )
      FROM regexp_split_to_table(COALESCE(p_val, ''), '') WITH ORDINALITY AS t(ch, pos)
    ),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.url_encode_query_param(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.url_encode_query_param(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.global_library_search(
  p_query text,
  p_types text[] DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_clean text := trim(COALESCE(p_query, ''));
  v_escaped text;
  v_like text;
  v_prefix_like text;
  v_limit integer := GREATEST(1, LEAST(100, COALESCE(p_limit, 30)));
  v_offset integer := GREATEST(0, COALESCE(p_offset, 0));
  v_types text[];
  v_items jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_total integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_clean) < 1 THEN
    RETURN jsonb_build_object(
      'query', '',
      'items', '[]'::jsonb,
      'counts_by_type', '{}'::jsonb,
      'total', 0
    );
  END IF;

  v_escaped := replace(replace(replace(v_clean, '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_escaped || '%';
  v_prefix_like := lower(v_escaped) || '%';

  v_types := CASE
    WHEN p_types IS NULL OR cardinality(p_types) = 0
    THEN ARRAY['folder', 'study_set', 'question', 'option', 'tag', 'chapter', 'note', 'diagram']
    ELSE p_types
  END;

  WITH readable_sets AS (
    SELECT
      s.id,
      s.title,
      s.subject,
      s.description,
      s.updated_at,
      (
        s.owner_id = v_caller
        OR EXISTS (
          SELECT 1 FROM public.study_set_members me
          WHERE me.study_set_id = s.id AND me.user_id = v_caller AND me.role IN ('owner', 'editor')
        )
      ) AS can_edit
    FROM public.study_sets s
    WHERE s.owner_id = v_caller
       OR EXISTS (
         SELECT 1 FROM public.study_set_members m
         WHERE m.study_set_id = s.id AND m.user_id = v_caller
       )
  ),
  raw_hits AS (
    -- 1. Folders (strictly caller's own, capped at 200)
    (
      SELECT
        'folder'::text AS result_type,
        f.id,
        NULL::uuid AS study_set_id,
        f.name AS title,
        COALESCE(left(f.description, 160), '') AS snippet,
        NULL::text AS subtitle,
        NULL::text AS chapter,
        '/folders/' || f.id::text AS href,
        CASE WHEN lower(f.name) = lower(v_clean) THEN 100
             WHEN lower(f.name) LIKE v_prefix_like ESCAPE '\' THEN 90
             ELSE 75 END::integer AS rank,
        f.updated_at
      FROM public.folders f
      WHERE 'folder' = ANY(v_types)
        AND f.owner_id = v_caller
        AND (f.name ILIKE v_like ESCAPE '\' OR COALESCE(f.description, '') ILIKE v_like ESCAPE '\')
      ORDER BY rank DESC, f.updated_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 2. Study Sets (owned or shared member, capped at 200)
    (
      SELECT
        'study_set'::text AS result_type,
        rs.id,
        rs.id AS study_set_id,
        rs.title,
        COALESCE(left(rs.description, 160), COALESCE(rs.subject, '')) AS snippet,
        rs.subject AS subtitle,
        NULL::text AS chapter,
        '/sets/' || rs.id::text AS href,
        CASE WHEN lower(rs.title) = lower(v_clean) THEN 100
             WHEN lower(rs.title) LIKE v_prefix_like ESCAPE '\' THEN 92
             ELSE 80 END::integer AS rank,
        rs.updated_at
      FROM readable_sets rs
      WHERE 'study_set' = ANY(v_types)
        AND (
          rs.title ILIKE v_like ESCAPE '\'
          OR COALESCE(rs.subject, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(rs.description, '') ILIKE v_like ESCAPE '\'
        )
      ORDER BY rank DESC, rs.updated_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 3. Questions (student-facing text ONLY — ZERO source_metadata scan/leak! Capped at 200)
    (
      SELECT
        'question'::text AS result_type,
        q.id,
        q.study_set_id,
        left(COALESCE(NULLIF(trim(q.prompt), ''), '[Media Question]'), 120) AS title,
        left(COALESCE(q.explanation, q.back_text, q.prompt, ''), 180) AS snippet,
        rs.title || CASE WHEN q.chapter IS NOT NULL THEN ' · ' || q.chapter ELSE '' END AS subtitle,
        q.chapter,
        CASE WHEN rs.can_edit
             THEN '/sets/' || q.study_set_id::text || '/edit?q=' || q.id::text
             ELSE '/sets/' || q.study_set_id::text || '?q=' || q.id::text
        END AS href,
        CASE WHEN q.prompt ILIKE v_like ESCAPE '\' THEN 78 ELSE 65 END::integer AS rank,
        q.updated_at
      FROM public.questions q
      JOIN readable_sets rs ON rs.id = q.study_set_id
      WHERE 'question' = ANY(v_types)
        AND (
          q.prompt ILIKE v_like ESCAPE '\'
          OR COALESCE(q.back_text, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(q.explanation, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(q.chapter, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(q.audio_transcript, '') ILIKE v_like ESCAPE '\'
        )
      ORDER BY rank DESC, q.updated_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 4. Question Options (capped at 200)
    (
      SELECT
        'option'::text AS result_type,
        qo.id,
        qo.study_set_id,
        left(qo.content, 120) AS title,
        left(COALESCE(NULLIF(trim(q.prompt), ''), rs.title), 160) AS snippet,
        rs.title AS subtitle,
        q.chapter,
        CASE WHEN rs.can_edit
             THEN '/sets/' || qo.study_set_id::text || '/edit?q=' || qo.question_id::text
             ELSE '/sets/' || qo.study_set_id::text || '?q=' || qo.question_id::text
        END AS href,
        62::integer AS rank,
        q.updated_at
      FROM public.question_options qo
      JOIN public.questions q ON q.id = qo.question_id
      JOIN readable_sets rs ON rs.id = qo.study_set_id
      WHERE 'option' = ANY(v_types)
        AND qo.content ILIKE v_like ESCAPE '\'
      ORDER BY q.updated_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 5. Tags (caller's own tags, capped at 200)
    (
      SELECT
        'tag'::text AS result_type,
        t.id,
        NULL::uuid AS study_set_id,
        t.name AS title,
        t.slug AS snippet,
        NULL::text AS subtitle,
        NULL::text AS chapter,
        '/library?tag=' || t.id::text AS href,
        72::integer AS rank,
        t.created_at AS updated_at
      FROM public.tags t
      WHERE 'tag' = ANY(v_types)
        AND t.owner_id = v_caller
        AND (t.name ILIKE v_like ESCAPE '\' OR t.slug ILIKE v_like ESCAPE '\')
      ORDER BY t.created_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 6. Chapters (properly percent-encoded URL + clean chapter string, capped at 200)
    (
      SELECT
        'chapter'::text AS result_type,
        q.study_set_id AS id,
        q.study_set_id,
        q.chapter AS title,
        rs.title AS snippet,
        rs.subject AS subtitle,
        q.chapter,
        '/sets/' || q.study_set_id::text || '?chapter=' || public.url_encode_query_param(q.chapter) AS href,
        70::integer AS rank,
        rs.updated_at
      FROM public.questions q
      JOIN readable_sets rs ON rs.id = q.study_set_id
      WHERE 'chapter' = ANY(v_types)
        AND q.chapter IS NOT NULL
        AND q.chapter ILIKE v_like ESCAPE '\'
      GROUP BY q.study_set_id, q.chapter, rs.title, rs.subject, rs.updated_at
      ORDER BY rs.updated_at DESC NULLS LAST, q.chapter ASC
      LIMIT 200
    )

    UNION ALL

    -- 7. Personal Notes (STRICTLY caller's OWN notes only — capped at 200)
    (
      SELECT
        'note'::text AS result_type,
        n.id,
        n.study_set_id,
        left(n.content_text, 120) AS title,
        left(COALESCE(q.prompt, rs.title), 160) AS snippet,
        rs.title AS subtitle,
        q.chapter,
        CASE WHEN rs.can_edit
             THEN '/sets/' || n.study_set_id::text || '/edit?q=' || n.question_id::text
             ELSE '/sets/' || n.study_set_id::text || '?q=' || n.question_id::text
        END AS href,
        82::integer AS rank,
        n.updated_at
      FROM public.user_question_notes n
      JOIN readable_sets rs ON rs.id = n.study_set_id
      LEFT JOIN public.questions q ON q.id = n.question_id
      WHERE 'note' = ANY(v_types)
        AND n.user_id = v_caller
        AND n.content_text ILIKE v_like ESCAPE '\'
      ORDER BY n.updated_at DESC NULLS LAST
      LIMIT 200
    )

    UNION ALL

    -- 8. Diagrams & Hotspot Labels (capped at 200)
    (
      SELECT
        'diagram'::text AS result_type,
        ds.id,
        ds.study_set_id,
        ds.title,
        COALESCE(
          left((
            SELECT dh2.label
            FROM public.diagram_hotspots dh2
            WHERE dh2.diagram_id = ds.id
              AND (dh2.label ILIKE v_like ESCAPE '\' OR COALESCE(dh2.description, '') ILIKE v_like ESCAPE '\')
            ORDER BY dh2.sort_order ASC
            LIMIT 1
          ), 120),
          left(COALESCE(ds.description, ''), 160)
        ) AS snippet,
        rs.title AS subtitle,
        NULL::text AS chapter,
        '/diagrams/' || ds.id::text || '/study' AS href,
        76::integer AS rank,
        ds.updated_at
      FROM public.diagram_sets ds
      JOIN readable_sets rs ON rs.id = ds.study_set_id
      WHERE 'diagram' = ANY(v_types)
        AND (
          ds.title ILIKE v_like ESCAPE '\'
          OR COALESCE(ds.description, '') ILIKE v_like ESCAPE '\'
          OR EXISTS (
            SELECT 1
            FROM public.diagram_hotspots dh
            WHERE dh.diagram_id = ds.id
              AND (dh.label ILIKE v_like ESCAPE '\' OR COALESCE(dh.description, '') ILIKE v_like ESCAPE '\')
          )
        )
      ORDER BY ds.updated_at DESC NULLS LAST
      LIMIT 200
    )
  ),
  counts_agg AS (
    SELECT result_type, count(*)::integer AS cnt
    FROM raw_hits
    GROUP BY result_type
  ),
  paged AS (
    SELECT *
    FROM raw_hits
    ORDER BY rank DESC, updated_at DESC NULLS LAST, title ASC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM paged p), '[]'::jsonb),
    COALESCE((SELECT jsonb_object_agg(result_type, cnt) FROM counts_agg), '{}'::jsonb),
    COALESCE((SELECT sum(cnt)::integer FROM counts_agg), 0)
  INTO v_items, v_counts, v_total;

  RETURN jsonb_build_object(
    'query', v_clean,
    'items', v_items,
    'counts_by_type', v_counts,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.global_library_search(text, text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.global_library_search(text, text[], integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. DB-09: Sargable 14d Filter & Resolved-Mistake Alignment in Summary RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_14d_start date := v_today - 13;
  v_14d_cutoff timestamptz := ((v_today - 13)::timestamp AT TIME ZONE 'UTC');
  v_1y_cutoff timestamptz := v_now - interval '365 days';

  v_profile jsonb;
  v_preferences jsonb;
  v_daily_goal integer := 20;

  v_total_sets integer := 0;
  v_total_questions integer := 0;
  v_mastered_count integer := 0;
  v_due_count integer := 0;
  v_mistake_count integer := 0;
  v_starred_count integer := 0;
  v_total_correct bigint := 0;
  v_total_wrong bigint := 0;
  v_accuracy_percent numeric(6,2) := 0;
  v_today_answers integer := 0;
  v_streak_days integer := 0;

  v_active_dates date[];
  v_cursor date;

  v_continue_learning jsonb;
  v_recent_sets jsonb;
  v_recent_exams jsonb;
  v_in_progress_exams jsonb;
  v_active_checkpoints jsonb;
  v_recent_sessions jsonb;
  v_activity_14d jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(p) INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_caller;

  SELECT to_jsonb(up), COALESCE(up.daily_goal, 20)
  INTO v_preferences, v_daily_goal
  FROM public.user_preferences up
  WHERE up.user_id = v_caller;
  v_daily_goal := COALESCE(v_daily_goal, 20);

  SELECT
    count(*)::integer,
    COALESCE(sum(s.question_count), 0)::integer
  INTO v_total_sets, v_total_questions
  FROM public.study_sets s
  WHERE s.owner_id = v_caller
    AND s.is_archived = false;

  SELECT
    count(*) FILTER (WHERE p.mastery_level = 'mastered')::integer,
    count(*) FILTER (WHERE p.next_review_at IS NOT NULL AND p.next_review_at <= v_now)::integer,
    count(*) FILTER (
      WHERE p.wrong_count > 0
        AND p.mastery_level <> 'mastered'
        AND COALESCE(p.mistake_status, 'active') <> 'resolved'
    )::integer,
    COALESCE(sum(p.correct_count), 0)::bigint,
    COALESCE(sum(p.wrong_count), 0)::bigint
  INTO v_mastered_count, v_due_count, v_mistake_count, v_total_correct, v_total_wrong
  FROM public.user_question_progress p
  WHERE p.user_id = v_caller;

  IF (v_total_correct + v_total_wrong) > 0 THEN
    v_accuracy_percent := round((v_total_correct::numeric / (v_total_correct + v_total_wrong)::numeric) * 100, 2);
  ELSE
    v_accuracy_percent := 0;
  END IF;

  SELECT count(*)::integer INTO v_starred_count
  FROM public.starred_questions sq
  WHERE sq.user_id = v_caller;

  SELECT COALESCE(array_agg(DISTINCT d ORDER BY d DESC), ARRAY[]::date[])
  INTO v_active_dates
  FROM (
    SELECT (ss.started_at AT TIME ZONE 'UTC')::date AS d
    FROM public.study_sessions ss
    WHERE ss.user_id = v_caller
      AND ss.completed_items > 0
      AND ss.started_at >= v_1y_cutoff
    UNION
    SELECT (sa.answered_at AT TIME ZONE 'UTC')::date AS d
    FROM public.study_session_answers sa
    WHERE sa.user_id = v_caller
      AND sa.answered_at >= v_14d_cutoff
    UNION
    SELECT (COALESCE(ea.submitted_at, ea.created_at) AT TIME ZONE 'UTC')::date AS d
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
      AND ea.created_at >= v_1y_cutoff
  ) dates;

  IF array_length(v_active_dates, 1) IS NOT NULL THEN
    v_cursor := v_today;
    IF NOT (v_cursor = ANY(v_active_dates)) THEN
      v_cursor := v_cursor - 1;
    END IF;
    WHILE v_cursor = ANY(v_active_dates) LOOP
      v_streak_days := v_streak_days + 1;
      v_cursor := v_cursor - 1;
    END LOOP;
  END IF;

  WITH days AS (
    SELECT generate_series(v_14d_start, v_today, interval '1 day')::date AS day
  ),
  sess_daily AS (
    SELECT
      (sa.answered_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::integer AS answers,
      count(*) FILTER (WHERE sa.is_correct)::integer AS correct
    FROM public.study_session_answers sa
    WHERE sa.user_id = v_caller
      AND sa.answered_at >= v_14d_cutoff
    GROUP BY 1
  ),
  exam_daily AS (
    SELECT
      (COALESCE(ea.submitted_at, ea.created_at) AT TIME ZONE 'UTC')::date AS day,
      COALESCE(sum(ea.answered_count), 0)::integer AS answers,
      COALESCE(sum(ea.correct_count), 0)::integer AS correct
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
      -- DB-09: Sargable range predicate using idx_exam_attempts_user_submitted
      AND (
        ea.submitted_at >= v_14d_cutoff
        OR (ea.submitted_at IS NULL AND ea.created_at >= v_14d_cutoff)
      )
    GROUP BY 1
  ),
  merged AS (
    SELECT
      d.day,
      (COALESCE(sd.answers, 0) + COALESCE(ed.answers, 0))::integer AS answers,
      (COALESCE(sd.correct, 0) + COALESCE(ed.correct, 0))::integer AS correct
    FROM days d
    LEFT JOIN sess_daily sd ON sd.day = d.day
    LEFT JOIN exam_daily ed ON ed.day = d.day
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(m.day, 'YYYY-MM-DD'),
          'answers', m.answers,
          'correct', m.correct
        )
        ORDER BY m.day ASC
      ),
      '[]'::jsonb
    ),
    COALESCE(max(m.answers) FILTER (WHERE m.day = v_today), 0)::integer
  INTO v_activity_14d, v_today_answers
  FROM merged m;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_continue_learning
  FROM (
    SELECT s.*
    FROM public.study_sets s
    WHERE s.owner_id = v_caller
      AND s.is_archived = false
      AND s.last_studied_at IS NOT NULL
    ORDER BY s.last_studied_at DESC
    LIMIT 4
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_recent_sets
  FROM (
    SELECT s.*
    FROM public.study_sets s
    WHERE s.owner_id = v_caller
      AND s.is_archived = false
    ORDER BY s.updated_at DESC
    LIMIT 6
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_recent_exams
  FROM (
    SELECT ea.*
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
    ORDER BY ea.created_at DESC
    LIMIT 5
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_in_progress_exams
  FROM (
    SELECT ea.*
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status = 'in_progress'
    ORDER BY ea.created_at DESC
    LIMIT 5
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_active_checkpoints
  FROM (
    SELECT c.*
    FROM public.learning_session_checkpoints c
    WHERE c.user_id = v_caller
    ORDER BY c.updated_at DESC
    LIMIT 5
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_recent_sessions
  FROM (
    SELECT ss.*
    FROM public.study_sessions ss
    WHERE ss.user_id = v_caller
    ORDER BY ss.started_at DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'preferences', v_preferences,
    'kpis', jsonb_build_object(
      'total_sets', v_total_sets,
      'total_questions', v_total_questions,
      'mastered_count', v_mastered_count,
      'due_for_review', v_due_count,
      'mistakes_count', v_mistake_count,
      'starred_count', v_starred_count,
      'accuracy_percent', v_accuracy_percent,
      'today_answers', v_today_answers,
      'daily_goal', v_daily_goal,
      'streak_days', v_streak_days,
      'current_streak_days', v_streak_days
    ),
    'continue_learning', v_continue_learning,
    'recent_sets', v_recent_sets,
    'recent_exams', v_recent_exams,
    'in_progress_exams', v_in_progress_exams,
    'active_checkpoints', v_active_checkpoints,
    'recent_sessions', v_recent_sessions,
    'activity_14d', v_activity_14d
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_study_set_summary(p_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_set public.study_sets%ROWTYPE;
  v_member_role text := NULL;
  v_member_allow_clone boolean := false;
  v_role text;
  v_can_edit boolean := false;
  v_is_owner boolean := false;
  v_can_clone boolean := false;
  v_owner jsonb := NULL;
  v_chapters jsonb := '[]'::jsonb;
  v_type_counts jsonb := '{}'::jsonb;
  v_starred_count integer := 0;
  v_tracked integer := 0;
  v_new_rows integer := 0;
  v_learning integer := 0;
  v_familiar integer := 0;
  v_mastered integer := 0;
  v_due integer := 0;
  v_mistakes integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_set_id IS NULL OR NOT public.can_read_study_set(p_set_id, v_caller) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_set
  FROM public.study_sets s
  WHERE s.id = p_set_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_set.owner_id = v_caller THEN
    v_role := 'owner';
    v_can_edit := true;
    v_is_owner := true;
    v_can_clone := true;
  ELSE
    SELECT m.role, COALESCE(m.allow_clone, false)
    INTO v_member_role, v_member_allow_clone
    FROM public.study_set_members m
    WHERE m.study_set_id = p_set_id
      AND m.user_id = v_caller;

    IF v_member_role IS NULL AND v_set.visibility <> 'public' THEN
      RETURN NULL;
    END IF;

    v_role := COALESCE(v_member_role, 'public_viewer');
    v_can_edit := v_member_role IN ('owner', 'editor');
    v_is_owner := false;
    v_can_clone := (v_set.visibility = 'public') OR COALESCE(v_member_allow_clone, false);
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'avatar_url', p.avatar_url
  )
  INTO v_owner
  FROM public.profiles p
  WHERE p.id = v_set.owner_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('name', c.chapter, 'count', c.cnt) ORDER BY c.min_pos ASC, c.chapter ASC),
    '[]'::jsonb
  )
  INTO v_chapters
  FROM (
    SELECT q.chapter, count(*)::integer AS cnt, min(q.position) AS min_pos
    FROM public.questions q
    WHERE q.study_set_id = p_set_id
      AND q.chapter IS NOT NULL
      AND btrim(q.chapter) <> ''
    GROUP BY q.chapter
  ) c;

  SELECT COALESCE(jsonb_object_agg(t.question_type, t.cnt), '{}'::jsonb)
  INTO v_type_counts
  FROM (
    SELECT q.question_type, count(*)::integer AS cnt
    FROM public.questions q
    WHERE q.study_set_id = p_set_id
    GROUP BY q.question_type
  ) t;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE p.mastery_level = 'new')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'learning')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'familiar')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'mastered')::integer,
    count(*) FILTER (WHERE p.next_review_at IS NOT NULL AND p.next_review_at <= v_now)::integer,
    count(*) FILTER (
      WHERE p.wrong_count > 0
        AND p.mastery_level <> 'mastered'
        AND COALESCE(p.mistake_status, 'active') <> 'resolved'
    )::integer
  INTO v_tracked, v_new_rows, v_learning, v_familiar, v_mastered, v_due, v_mistakes
  FROM public.user_question_progress p
  WHERE p.user_id = v_caller
    AND p.study_set_id = p_set_id;

  SELECT count(*)::integer INTO v_starred_count
  FROM public.starred_questions sq
  WHERE sq.user_id = v_caller
    AND sq.study_set_id = p_set_id;

  RETURN to_jsonb(v_set) || jsonb_build_object(
    'role', v_role,
    'can_edit', v_can_edit,
    'is_owner', v_is_owner,
    'can_clone', v_can_clone,
    'owner', v_owner,
    'chapters', v_chapters,
    'question_type_counts', v_type_counts,
    'mastery_summary', jsonb_build_object(
      'new', GREATEST(0, v_set.question_count - v_tracked) + v_new_rows,
      'learning', v_learning,
      'familiar', v_familiar,
      'mastered', v_mastered,
      'due', v_due,
      'mistakes', v_mistakes
    ),
    'starred_count', v_starred_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_set_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_set_summary(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. DB-06 & V32-037: Single-RTT list_accessible_study_sets()
--     (Eliminates waterfall, removes 100-shared-set truncation, supports favoritesOnly)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_accessible_study_sets(
  p_scope text DEFAULT 'owned',
  p_search text DEFAULT NULL,
  p_folder_id text DEFAULT NULL,
  p_set_type text DEFAULT NULL,
  p_visibility text DEFAULT NULL,
  p_include_archived boolean DEFAULT false,
  p_favorites_only boolean DEFAULT false,
  p_sort text DEFAULT 'updated_desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_scope text := COALESCE(NULLIF(p_scope, ''), 'owned');
  v_sort text := COALESCE(NULLIF(p_sort, ''), 'updated_desc');
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_page_size integer := GREATEST(1, LEAST(100, COALESCE(p_page_size, 24)));
  v_offset integer := (v_page - 1) * v_page_size;
  v_like text := NULL;
  v_folder_uuid uuid := NULL;
  v_unfiled boolean := false;
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_like := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  IF p_folder_id = 'unfiled' THEN
    v_unfiled := true;
  ELSIF public.is_strict_uuid(p_folder_id) THEN
    v_folder_uuid := p_folder_id::uuid;
  END IF;

  WITH filtered AS (
    SELECT
      s.id,
      s.owner_id,
      s.folder_id,
      s.title,
      s.description,
      s.subject,
      s.set_type,
      s.visibility,
      s.source_language,
      s.question_count,
      s.default_exam_duration_minutes,
      s.default_pass_threshold,
      s.is_archived,
      s.is_favorite,
      s.content_version,
      s.last_studied_at,
      s.created_at,
      s.updated_at,
      m.role AS member_role,
      CASE
        WHEN v_scope = 'shared' THEN jsonb_build_object(
          'id', op.id,
          'display_name', op.display_name,
          'username', op.username,
          'avatar_url', op.avatar_url
        )
        ELSE NULL
      END AS owner_obj
    FROM public.study_sets s
    LEFT JOIN public.study_set_members m
      ON m.study_set_id = s.id AND m.user_id = v_caller
    LEFT JOIN public.profiles op
      ON v_scope = 'shared' AND op.id = s.owner_id
    WHERE (
      (v_scope = 'owned' AND s.owner_id = v_caller)
      OR (v_scope = 'shared' AND m.user_id IS NOT NULL AND s.owner_id <> v_caller)
      OR (v_scope = 'all' AND (s.owner_id = v_caller OR m.user_id IS NOT NULL))
    )
      AND (COALESCE(p_include_archived, false) OR s.is_archived = false)
      AND (NOT COALESCE(p_favorites_only, false) OR s.is_favorite = true)
      AND (NOT v_unfiled OR (s.owner_id = v_caller AND s.folder_id IS NULL))
      AND (v_folder_uuid IS NULL OR (s.owner_id = v_caller AND s.folder_id = v_folder_uuid))
      AND (p_set_type IS NULL OR s.set_type = p_set_type)
      AND (p_visibility IS NULL OR s.visibility = p_visibility)
      AND (
        v_like IS NULL
        OR s.title ILIKE v_like ESCAPE '\'
        OR COALESCE(s.subject, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(s.description, '') ILIKE v_like ESCAPE '\'
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total_cnt FROM filtered
  ),
  ordered AS (
    SELECT
      f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_scope = 'shared' THEN 0 WHEN v_sort = 'updated_desc' THEN (CASE WHEN f.is_favorite THEN 0 ELSE 1 END) ELSE 0 END ASC,
          CASE WHEN v_sort = 'title_asc' THEN lower(f.title) ELSE '' END ASC,
          CASE WHEN v_sort = 'question_count_desc' THEN f.question_count ELSE 0 END DESC,
          CASE WHEN v_sort = 'created_desc' THEN f.created_at ELSE NULL::timestamptz END DESC NULLS LAST,
          CASE WHEN v_sort = 'last_studied_desc' THEN f.last_studied_at ELSE NULL::timestamptz END DESC NULLS LAST,
          f.updated_at DESC,
          f.id ASC
      ) AS ord
    FROM filtered f
  ),
  paged AS (
    SELECT o.*
    FROM ordered o
    ORDER BY o.ord ASC
    LIMIT v_page_size
    OFFSET v_offset
  )
  SELECT
    (SELECT total_cnt FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN v_scope = 'shared' THEN
              jsonb_build_object(
                'id', p.id,
                'owner_id', p.owner_id,
                'folder_id', p.folder_id,
                'title', p.title,
                'description', p.description,
                'subject', p.subject,
                'set_type', p.set_type,
                'visibility', p.visibility,
                'source_language', p.source_language,
                'question_count', p.question_count,
                'default_exam_duration_minutes', p.default_exam_duration_minutes,
                'default_pass_threshold', p.default_pass_threshold,
                'is_archived', p.is_archived,
                'is_favorite', p.is_favorite,
                'content_version', p.content_version,
                'last_studied_at', p.last_studied_at,
                'created_at', p.created_at,
                'updated_at', p.updated_at,
                'member_role', COALESCE(p.member_role, 'viewer'),
                'owner', p.owner_obj
              )
            ELSE
              jsonb_build_object(
                'id', p.id,
                'owner_id', p.owner_id,
                'folder_id', p.folder_id,
                'title', p.title,
                'description', p.description,
                'subject', p.subject,
                'set_type', p.set_type,
                'visibility', p.visibility,
                'source_language', p.source_language,
                'question_count', p.question_count,
                'default_exam_duration_minutes', p.default_exam_duration_minutes,
                'default_pass_threshold', p.default_pass_threshold,
                'is_archived', p.is_archived,
                'is_favorite', p.is_favorite,
                'content_version', p.content_version,
                'last_studied_at', p.last_studied_at,
                'created_at', p.created_at,
                'updated_at', p.updated_at
              )
          END
          ORDER BY p.ord ASC
        )
        FROM paged p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_accessible_study_sets(text, text, text, text, text, boolean, boolean, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_accessible_study_sets(text, text, text, text, text, boolean, boolean, text, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. PERF-03 & DB-11: Single-RTT get_study_set_questions_page()
--     (Collapses 4 sequential RTTs to 1; strips heavy *_rich JSONB in summary mode)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_study_set_questions_page(
  p_set_id uuid,
  p_fields text DEFAULT 'full',
  p_chapter text DEFAULT NULL,
  p_difficulty text DEFAULT NULL,
  p_question_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_starred_only boolean DEFAULT false,
  p_tag_id uuid DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_is_summary boolean := (lower(COALESCE(p_fields, 'full')) = 'summary');
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_page_size integer := GREATEST(1, LEAST(500, COALESCE(p_page_size, 50)));
  v_offset integer := (v_page - 1) * v_page_size;
  v_like text := NULL;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_set_id IS NULL OR NOT public.can_read_study_set(p_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_like := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  IF v_is_summary THEN
    WITH matched AS (
      SELECT
        q.id,
        q.study_set_id,
        q.question_type,
        q.position,
        q.chapter,
        q.prompt,
        q.prompt_image_url,
        q.back_text,
        q.back_image_url,
        q.audio_media_id,
        q.audio_url,
        q.passage_id,
        q.diagram_id,
        q.difficulty,
        q.created_at,
        q.updated_at
      FROM public.questions q
      WHERE q.study_set_id = p_set_id
        AND (p_chapter IS NULL OR q.chapter = p_chapter)
        AND (p_difficulty IS NULL OR q.difficulty = p_difficulty)
        AND (p_question_type IS NULL OR q.question_type = p_question_type)
        AND (
          v_like IS NULL
          OR q.prompt ILIKE v_like ESCAPE '\'
          OR COALESCE(q.back_text, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(q.explanation, '') ILIKE v_like ESCAPE '\'
        )
        AND (
          NOT COALESCE(p_starred_only, false)
          OR EXISTS (
            SELECT 1 FROM public.starred_questions sq
            WHERE sq.user_id = v_caller AND sq.question_id = q.id
          )
        )
        AND (
          p_tag_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.question_tags qt
            WHERE qt.study_set_id = p_set_id AND qt.question_id = q.id AND qt.tag_id = p_tag_id
          )
        )
    ),
    counted AS (
      SELECT count(*)::integer AS total_cnt FROM matched
    ),
    paged AS (
      SELECT m.*
      FROM matched m
      ORDER BY m.position ASC, m.created_at ASC, m.id ASC
      LIMIT v_page_size
      OFFSET v_offset
    )
    SELECT
      (SELECT total_cnt FROM counted),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'study_set_id', p.study_set_id,
              'question_type', p.question_type,
              'position', p.position,
              'chapter', p.chapter,
              'prompt', p.prompt,
              'prompt_image_url', p.prompt_image_url,
              'back_text', p.back_text,
              'back_image_url', p.back_image_url,
              'audio_media_id', p.audio_media_id,
              'audio_url', p.audio_url,
              'passage_id', p.passage_id,
              'diagram_id', p.diagram_id,
              'difficulty', p.difficulty,
              'created_at', p.created_at,
              'updated_at', p.updated_at,
              'options', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', o.id,
                    'question_id', o.question_id,
                    'study_set_id', o.study_set_id,
                    'position', o.position,
                    'label', o.label,
                    'content', o.content,
                    'image_url', o.image_url,
                    'media_id', o.media_id,
                    'image_alt', o.image_alt,
                    'is_correct', o.is_correct,
                    'created_at', o.created_at
                  )
                  ORDER BY o.position ASC
                )
                FROM public.question_options o
                WHERE o.study_set_id = p_set_id AND o.question_id = p.id
              ), '[]'::jsonb),
              'accepted_answers', '[]'::jsonb,
              'tags', '[]'::jsonb,
              'is_starred', EXISTS (
                SELECT 1 FROM public.starred_questions sq
                WHERE sq.user_id = v_caller AND sq.question_id = p.id
              ),
              'progress', NULL
            )
            ORDER BY p.position ASC, p.created_at ASC, p.id ASC
          )
          FROM paged p
        ),
        '[]'::jsonb
      )
    INTO v_total, v_items;
  ELSE
    WITH matched AS (
      SELECT q.*
      FROM public.questions q
      WHERE q.study_set_id = p_set_id
        AND (p_chapter IS NULL OR q.chapter = p_chapter)
        AND (p_difficulty IS NULL OR q.difficulty = p_difficulty)
        AND (p_question_type IS NULL OR q.question_type = p_question_type)
        AND (
          v_like IS NULL
          OR q.prompt ILIKE v_like ESCAPE '\'
          OR COALESCE(q.back_text, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(q.explanation, '') ILIKE v_like ESCAPE '\'
        )
        AND (
          NOT COALESCE(p_starred_only, false)
          OR EXISTS (
            SELECT 1 FROM public.starred_questions sq
            WHERE sq.user_id = v_caller AND sq.question_id = q.id
          )
        )
        AND (
          p_tag_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.question_tags qt
            WHERE qt.study_set_id = p_set_id AND qt.question_id = q.id AND qt.tag_id = p_tag_id
          )
        )
    ),
    counted AS (
      SELECT count(*)::integer AS total_cnt FROM matched
    ),
    paged AS (
      SELECT m.*
      FROM matched m
      ORDER BY m.position ASC, m.created_at ASC, m.id ASC
      LIMIT v_page_size
      OFFSET v_offset
    )
    SELECT
      (SELECT total_cnt FROM counted),
      COALESCE(
        (
          SELECT jsonb_agg(
            to_jsonb(p) || jsonb_build_object(
              'options', COALESCE((
                SELECT jsonb_agg(to_jsonb(o) ORDER BY o.position ASC)
                FROM public.question_options o
                WHERE o.study_set_id = p_set_id AND o.question_id = p.id
              ), '[]'::jsonb),
              'accepted_answers', COALESCE((
                SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.created_at ASC)
                FROM public.question_accepted_answers aa
                WHERE aa.study_set_id = p_set_id AND aa.question_id = p.id
              ), '[]'::jsonb),
              'tags', COALESCE((
                SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name ASC)
                FROM public.question_tags qt
                JOIN public.tags t ON t.id = qt.tag_id
                WHERE qt.study_set_id = p_set_id AND qt.question_id = p.id
              ), '[]'::jsonb),
              'is_starred', EXISTS (
                SELECT 1 FROM public.starred_questions sq
                WHERE sq.user_id = v_caller AND sq.question_id = p.id
              ),
              'progress', (
                SELECT jsonb_build_object(
                  'question_id', up.question_id,
                  'mastery_level', up.mastery_level,
                  'correct_count', up.correct_count,
                  'wrong_count', up.wrong_count,
                  'consecutive_correct', up.consecutive_correct,
                  'consecutive_wrong', up.consecutive_wrong,
                  'ease_factor', up.ease_factor,
                  'interval_days', up.interval_days,
                  'repetitions', up.repetitions,
                  'last_reviewed_at', up.last_reviewed_at,
                  'last_wrong_at', up.last_wrong_at,
                  'next_review_at', up.next_review_at,
                  'last_confidence', up.last_confidence,
                  'low_confidence_count', up.low_confidence_count,
                  'high_conf_wrong_count', up.high_conf_wrong_count,
                  'guess_correct_count', up.guess_correct_count,
                  'independent_recall_count', up.independent_recall_count,
                  'hint_used_count', up.hint_used_count,
                  'mistake_status', up.mistake_status
                )
                FROM public.user_question_progress up
                WHERE up.user_id = v_caller AND up.question_id = p.id
                LIMIT 1
              )
            )
            ORDER BY p.position ASC, p.created_at ASC, p.id ASC
          )
          FROM paged p
        ),
        '[]'::jsonb
      )
    INTO v_total, v_items;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_set_questions_page(uuid, text, text, text, text, text, boolean, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_set_questions_page(uuid, text, text, text, text, text, boolean, uuid, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 12. DB-07: Single-RTT get_user_statistics_summary(p_days integer)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_statistics_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_days integer := GREATEST(7, LEAST(365, COALESCE(p_days, 30)));
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_start_date date := v_today - (v_days - 1);
  v_since timestamptz := v_now - make_interval(days => v_days);

  v_total_owned_questions integer := 0;
  v_owned_tracked integer := 0;
  v_new_rows integer := 0;
  v_learning integer := 0;
  v_familiar integer := 0;
  v_mastered integer := 0;
  v_due integer := 0;
  v_total_correct bigint := 0;
  v_total_wrong bigint := 0;
  v_overall_accuracy numeric(6,2) := 0;

  v_total_sessions integer := 0;
  v_total_exams integer := 0;
  v_total_study_seconds bigint := 0;
  v_exam_study_seconds bigint := 0;

  v_active_dates date[];
  v_current_streak integer := 0;
  v_longest_streak integer := 0;
  v_running integer := 0;
  v_cursor date;
  v_prev_d date := NULL;
  v_d date;

  v_confidence_calibration jsonb;
  v_daily_activity jsonb;
  v_exam_trend jsonb;
  v_perf_by_set jsonb;
  v_weak_topics jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(s.question_count), 0)::integer INTO v_total_owned_questions
  FROM public.study_sets s
  WHERE s.owner_id = v_caller AND s.is_archived = false;

  SELECT
    count(*) FILTER (WHERE p.mastery_level = 'new')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'learning')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'familiar')::integer,
    count(*) FILTER (WHERE p.mastery_level = 'mastered')::integer,
    count(*) FILTER (WHERE p.next_review_at IS NOT NULL AND p.next_review_at <= v_now)::integer,
    COALESCE(sum(p.correct_count), 0)::bigint,
    COALESCE(sum(p.wrong_count), 0)::bigint,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.study_sets os
        WHERE os.id = p.study_set_id AND os.owner_id = v_caller AND os.is_archived = false
      )
    )::integer
  INTO v_new_rows, v_learning, v_familiar, v_mastered, v_due, v_total_correct, v_total_wrong, v_owned_tracked
  FROM public.user_question_progress p
  WHERE p.user_id = v_caller;

  IF (v_total_correct + v_total_wrong) > 0 THEN
    v_overall_accuracy := round((v_total_correct::numeric / (v_total_correct + v_total_wrong)::numeric) * 100, 2);
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(ss.duration_seconds), 0)::bigint
  INTO v_total_sessions, v_total_study_seconds
  FROM public.study_sessions ss
  WHERE ss.user_id = v_caller
    AND ss.started_at >= v_since;

  SELECT
    count(*)::integer,
    COALESCE(sum(ea.time_spent_seconds), 0)::bigint
  INTO v_total_exams, v_exam_study_seconds
  FROM public.exam_attempts ea
  WHERE ea.user_id = v_caller
    AND ea.status IN ('submitted', 'expired')
    AND ea.submitted_at >= v_since;

  v_total_study_seconds := COALESCE(v_total_study_seconds, 0) + COALESCE(v_exam_study_seconds, 0);

  -- Active dates within range for current & longest streak
  SELECT COALESCE(array_agg(DISTINCT d ORDER BY d ASC), ARRAY[]::date[])
  INTO v_active_dates
  FROM (
    SELECT (ss.started_at AT TIME ZONE 'UTC')::date AS d
    FROM public.study_sessions ss
    WHERE ss.user_id = v_caller AND ss.started_at >= v_since AND ss.completed_items > 0
    UNION
    SELECT (sa.answered_at AT TIME ZONE 'UTC')::date AS d
    FROM public.study_session_answers sa
    WHERE sa.user_id = v_caller AND sa.answered_at >= v_since
    UNION
    SELECT (COALESCE(ea.submitted_at, ea.created_at) AT TIME ZONE 'UTC')::date AS d
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
      AND ea.submitted_at >= v_since
  ) dates;

  IF array_length(v_active_dates, 1) IS NOT NULL THEN
    v_cursor := v_today;
    IF NOT (v_cursor = ANY(v_active_dates)) THEN
      v_cursor := v_cursor - 1;
    END IF;
    WHILE v_cursor = ANY(v_active_dates) LOOP
      v_current_streak := v_current_streak + 1;
      v_cursor := v_cursor - 1;
    END LOOP;

    FOREACH v_d IN ARRAY v_active_dates LOOP
      IF v_prev_d IS NOT NULL AND v_d = v_prev_d + 1 THEN
        v_running := v_running + 1;
      ELSE
        v_running := 1;
      END IF;
      IF v_running > v_longest_streak THEN
        v_longest_streak := v_running;
      END IF;
      v_prev_d := v_d;
    END LOOP;
    v_longest_streak := GREATEST(v_longest_streak, v_current_streak);
  END IF;

  -- Confidence calibration
  SELECT jsonb_build_object(
    'certain', jsonb_build_object(
      'total', cert_tot,
      'correct', cert_cor,
      'accuracy_percent', CASE WHEN cert_tot > 0 THEN round((cert_cor::numeric / cert_tot::numeric) * 100, 2) ELSE 0 END
    ),
    'unsure', jsonb_build_object(
      'total', uns_tot,
      'correct', uns_cor,
      'accuracy_percent', CASE WHEN uns_tot > 0 THEN round((uns_cor::numeric / uns_tot::numeric) * 100, 2) ELSE 0 END
    ),
    'guessing', jsonb_build_object(
      'total', gue_tot,
      'correct', gue_cor,
      'accuracy_percent', CASE WHEN gue_tot > 0 THEN round((gue_cor::numeric / gue_tot::numeric) * 100, 2) ELSE 0 END
    ),
    'high_conf_wrong', hcw,
    'guess_correct', gc,
    'total_events', all_tot
  )
  INTO v_confidence_calibration
  FROM (
    SELECT
      count(*) FILTER (WHERE lce.confidence = 'certain')::integer AS cert_tot,
      count(*) FILTER (WHERE lce.confidence = 'certain' AND lce.is_correct)::integer AS cert_cor,
      count(*) FILTER (WHERE lce.confidence = 'unsure')::integer AS uns_tot,
      count(*) FILTER (WHERE lce.confidence = 'unsure' AND lce.is_correct)::integer AS uns_cor,
      count(*) FILTER (WHERE lce.confidence = 'guessing')::integer AS gue_tot,
      count(*) FILTER (WHERE lce.confidence = 'guessing' AND lce.is_correct)::integer AS gue_cor,
      count(*) FILTER (WHERE lce.confidence = 'certain' AND NOT lce.is_correct)::integer AS hcw,
      count(*) FILTER (WHERE lce.confidence = 'guessing' AND lce.is_correct)::integer AS gc,
      count(*)::integer AS all_tot
    FROM public.learning_confidence_events lce
    WHERE lce.user_id = v_caller
      AND lce.created_at >= v_since
  ) agg;

  -- Daily activity series
  WITH days AS (
    SELECT generate_series(v_start_date, v_today, interval '1 day')::date AS day
  ),
  sess_d AS (
    SELECT
      (ss.started_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::integer AS sessions,
      COALESCE(sum(ss.duration_seconds), 0)::integer AS study_seconds
    FROM public.study_sessions ss
    WHERE ss.user_id = v_caller AND ss.started_at >= v_since
    GROUP BY 1
  ),
  ans_d AS (
    SELECT
      (sa.answered_at AT TIME ZONE 'UTC')::date AS day,
      count(*)::integer AS answers,
      count(*) FILTER (WHERE sa.is_correct)::integer AS correct
    FROM public.study_session_answers sa
    WHERE sa.user_id = v_caller AND sa.answered_at >= v_since
    GROUP BY 1
  ),
  exam_d AS (
    SELECT
      (COALESCE(ea.submitted_at, ea.created_at) AT TIME ZONE 'UTC')::date AS day,
      count(*)::integer AS exams,
      COALESCE(sum(ea.answered_count), 0)::integer AS answers,
      COALESCE(sum(ea.correct_count), 0)::integer AS correct,
      COALESCE(sum(ea.time_spent_seconds), 0)::integer AS study_seconds
    FROM public.exam_attempts ea
    WHERE ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
      AND ea.submitted_at >= v_since
    GROUP BY 1
  ),
  merged AS (
    SELECT
      d.day,
      (COALESCE(ad.answers, 0) + COALESCE(ed.answers, 0))::integer AS answers,
      (COALESCE(ad.correct, 0) + COALESCE(ed.correct, 0))::integer AS correct,
      COALESCE(sd.sessions, 0)::integer AS sessions,
      COALESCE(ed.exams, 0)::integer AS exams,
      (COALESCE(sd.study_seconds, 0) + COALESCE(ed.study_seconds, 0))::integer AS study_seconds
    FROM days d
    LEFT JOIN sess_d sd ON sd.day = d.day
    LEFT JOIN ans_d ad ON ad.day = d.day
    LEFT JOIN exam_d ed ON ed.day = d.day
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(m.day, 'YYYY-MM-DD'),
        'answers', m.answers,
        'correct', m.correct,
        'sessions', m.sessions,
        'exams', m.exams,
        'study_seconds', m.study_seconds,
        'accuracy_percent', CASE WHEN m.answers > 0 THEN round((m.correct::numeric / m.answers::numeric) * 100, 2) ELSE 0 END
      )
      ORDER BY m.day ASC
    ),
    '[]'::jsonb
  )
  INTO v_daily_activity
  FROM merged m;

  -- Exam score trend
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ea.id,
        'study_set_id', ea.study_set_id,
        'title', ea.study_set_title_snapshot,
        'score_percent', ea.score_percent::numeric,
        'passed', ea.passed,
        'total_questions', ea.total_questions,
        'correct_count', ea.correct_count,
        'submitted_at', COALESCE(ea.submitted_at, ea.created_at)
      )
      ORDER BY ea.submitted_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_exam_trend
  FROM public.exam_attempts ea
  WHERE ea.user_id = v_caller
    AND ea.status IN ('submitted', 'expired')
    AND ea.submitted_at >= v_since;

  -- Performance by study set
  WITH per_set AS (
    SELECT
      p.study_set_id,
      COALESCE(sum(p.correct_count), 0)::integer AS correct_count,
      COALESCE(sum(p.wrong_count), 0)::integer AS wrong_count,
      count(*) FILTER (WHERE p.mastery_level = 'mastered')::integer AS mastered_count,
      count(*)::integer AS tracked_count
    FROM public.user_question_progress p
    WHERE p.user_id = v_caller
    GROUP BY p.study_set_id
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'study_set_id', ps.study_set_id,
        'title', COALESCE(s.title, 'Shared Study Set'),
        'subject', s.subject,
        'total_questions', COALESCE(s.question_count, ps.tracked_count),
        'mastered_count', ps.mastered_count,
        'correct_count', ps.correct_count,
        'wrong_count', ps.wrong_count,
        'accuracy_percent', CASE
          WHEN (ps.correct_count + ps.wrong_count) > 0
          THEN round((ps.correct_count::numeric / (ps.correct_count + ps.wrong_count)::numeric) * 100, 2)
          ELSE 0
        END
      )
      ORDER BY (
        CASE
          WHEN (ps.correct_count + ps.wrong_count) > 0
          THEN (ps.correct_count::numeric / (ps.correct_count + ps.wrong_count)::numeric)
          ELSE 0
        END
      ) ASC, ps.study_set_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_perf_by_set
  FROM per_set ps
  LEFT JOIN public.study_sets s
    ON s.id = ps.study_set_id AND public.can_read_study_set(s.id, v_caller);

  -- Weak chapters (top 12)
  WITH chap_agg AS (
    SELECT
      q.study_set_id,
      NULLIF(btrim(COALESCE(q.chapter, '')), '') AS chapter,
      COALESCE(sum(p.wrong_count), 0)::integer AS wrong_count,
      COALESCE(sum(p.correct_count), 0)::integer AS correct_count
    FROM public.user_question_progress p
    JOIN public.questions q ON q.id = p.question_id
    WHERE p.user_id = v_caller
      AND (p.correct_count + p.wrong_count) > 0
      AND public.can_read_study_set(q.study_set_id, v_caller)
    GROUP BY q.study_set_id, NULLIF(btrim(COALESCE(q.chapter, '')), '')
    HAVING COALESCE(sum(p.wrong_count), 0) > 0
  ),
  ranked AS (
    SELECT
      ca.*,
      COALESCE(s.title, 'Study Set') AS study_set_title,
      round((ca.correct_count::numeric / (ca.correct_count + ca.wrong_count)::numeric) * 100, 2) AS accuracy_percent
    FROM chap_agg ca
    LEFT JOIN public.study_sets s ON s.id = ca.study_set_id
    ORDER BY accuracy_percent ASC, ca.wrong_count DESC
    LIMIT 12
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'study_set_id', r.study_set_id,
        'study_set_title', r.study_set_title,
        'chapter', r.chapter,
        'wrong_count', r.wrong_count,
        'correct_count', r.correct_count,
        'accuracy_percent', r.accuracy_percent
      )
      ORDER BY r.accuracy_percent ASC, r.wrong_count DESC
    ),
    '[]'::jsonb
  )
  INTO v_weak_topics
  FROM ranked r;

  RETURN jsonb_build_object(
    'summary', jsonb_build_object(
      'total_questions', v_total_owned_questions,
      'mastered_count', v_mastered,
      'due_for_review', v_due,
      'overall_accuracy_percent', v_overall_accuracy,
      'total_study_seconds', v_total_study_seconds,
      'total_sessions', v_total_sessions,
      'total_exams', v_total_exams,
      'current_streak_days', v_current_streak,
      'longest_streak_days', v_longest_streak
    ),
    'mastery_distribution', jsonb_build_object(
      'new', GREATEST(0, v_total_owned_questions - v_owned_tracked) + v_new_rows,
      'learning', v_learning,
      'familiar', v_familiar,
      'mastered', v_mastered
    ),
    'confidence_calibration', v_confidence_calibration,
    'daily_activity', v_daily_activity,
    'exam_score_trend', v_exam_trend,
    'performance_by_set', v_perf_by_set,
    'weak_topics', v_weak_topics
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_statistics_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_statistics_summary(integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 13. DB-07: Single-RTT get_user_mistakes_page(...) — Zero 1,000-row Truncation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_mistakes_page(
  p_study_set_id uuid DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_chapter text DEFAULT NULL,
  p_tag_id uuid DEFAULT NULL,
  p_question_type text DEFAULT NULL,
  p_days integer DEFAULT NULL,
  p_min_wrong_count integer DEFAULT 1,
  p_min_consecutive_wrong integer DEFAULT NULL,
  p_exam_attempt_id uuid DEFAULT NULL,
  p_recent_exam_only boolean DEFAULT false,
  p_confidence text DEFAULT NULL,
  p_low_confidence boolean DEFAULT false,
  p_high_conf_wrong boolean DEFAULT false,
  p_guess_correct boolean DEFAULT false,
  p_due_only boolean DEFAULT false,
  p_starred_only boolean DEFAULT false,
  p_mastery_level text DEFAULT NULL,
  p_effective_tab text DEFAULT NULL,
  p_include_resolved boolean DEFAULT false,
  p_sort text DEFAULT 'wrong_count_desc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_cutoff timestamptz := CASE WHEN p_days IS NOT NULL THEN v_now - make_interval(days => p_days) ELSE NULL END;
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_page_size integer := GREATEST(1, LEAST(100, COALESCE(p_page_size, 20)));
  v_offset integer := (v_page - 1) * v_page_size;
  v_subject_norm text := CASE WHEN p_subject IS NOT NULL AND btrim(p_subject) <> '' THEN lower(btrim(p_subject)) ELSE NULL END;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  WITH recent_exam_ids AS (
    SELECT ea.id
    FROM public.exam_attempts ea
    WHERE p_exam_attempt_id IS NULL
      AND COALESCE(p_recent_exam_only, false) = true
      AND ea.user_id = v_caller
      AND ea.status IN ('submitted', 'expired')
    ORDER BY ea.submitted_at DESC NULLS LAST
    LIMIT 5
  ),
  matched AS (
    SELECT
      p.*,
      q.id AS q_exists_id
    FROM public.user_question_progress p
    JOIN public.questions q ON q.id = p.question_id
    JOIN public.study_sets s ON s.id = p.study_set_id
    WHERE p.user_id = v_caller
      AND public.can_read_study_set(p.study_set_id, v_caller)
      AND p.wrong_count >= COALESCE(p_min_wrong_count, 1)
      AND (p_study_set_id IS NULL OR p.study_set_id = p_study_set_id)
      AND (v_subject_norm IS NULL OR lower(btrim(COALESCE(s.subject, ''))) = v_subject_norm)
      AND (p_chapter IS NULL OR q.chapter = p_chapter)
      AND (p_question_type IS NULL OR q.question_type = p_question_type)
      AND (p_min_consecutive_wrong IS NULL OR COALESCE(p.consecutive_wrong, 0) >= p_min_consecutive_wrong)
      AND (p_confidence IS NULL OR p.last_confidence = p_confidence)
      AND (NOT COALESCE(p_low_confidence, false) OR COALESCE(p.low_confidence_count, 0) > 0)
      AND (NOT COALESCE(p_high_conf_wrong, false) OR COALESCE(p.high_conf_wrong_count, 0) > 0)
      AND (NOT COALESCE(p_guess_correct, false) OR COALESCE(p.guess_correct_count, 0) > 0)
      AND (NOT COALESCE(p_due_only, false) OR (p.next_review_at IS NOT NULL AND p.next_review_at <= v_now))
      AND (p_mastery_level IS NULL OR p.mastery_level = p_mastery_level)
      AND (
        v_cutoff IS NULL
        OR p.last_wrong_at >= v_cutoff
        OR p.last_reviewed_at >= v_cutoff
      )
      AND (
        CASE
          WHEN p_effective_tab = 'active' THEN p.mistake_status = 'active'
          WHEN p_effective_tab = 'improving' THEN p.mistake_status = 'improving'
          WHEN p_effective_tab = 'resolved' THEN p.mistake_status = 'resolved'
          WHEN p_effective_tab = 'unresolved' THEN COALESCE(p.mistake_status, 'active') <> 'resolved'
          WHEN NOT COALESCE(p_include_resolved, false)
               AND COALESCE(p_effective_tab, '') <> 'all'
               AND NOT COALESCE(p_guess_correct, false)
            THEN p.mastery_level <> 'mastered' AND COALESCE(p.mistake_status, 'active') <> 'resolved'
          ELSE true
        END
      )
      AND (
        NOT COALESCE(p_starred_only, false)
        OR EXISTS (
          SELECT 1 FROM public.starred_questions sq
          WHERE sq.user_id = v_caller AND sq.question_id = p.question_id
        )
      )
      AND (
        p_tag_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.question_tags qt
          WHERE qt.question_id = p.question_id AND qt.tag_id = p_tag_id
        )
      )
      AND (
        (p_exam_attempt_id IS NULL AND NOT COALESCE(p_recent_exam_only, false))
        OR EXISTS (
          SELECT 1
          FROM public.exam_attempt_answers eaa
          JOIN public.exam_attempt_questions eaq ON eaq.id = eaa.attempt_question_id
          WHERE eaa.user_id = v_caller
            AND eaa.is_correct = false
            AND eaq.question_id = p.question_id
            AND (
              (p_exam_attempt_id IS NOT NULL AND eaa.attempt_id = p_exam_attempt_id)
              OR (p_exam_attempt_id IS NULL AND eaa.attempt_id IN (SELECT id FROM recent_exam_ids))
            )
        )
      )
  ),
  counted AS (
    SELECT count(*)::integer AS total_cnt FROM matched
  ),
  ordered AS (
    SELECT
      m.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN p_sort = 'recent_wrong' THEN COALESCE(m.last_wrong_at, m.last_reviewed_at) ELSE NULL::timestamptz END DESC NULLS LAST,
          CASE WHEN p_sort = 'consecutive_wrong' THEN COALESCE(m.consecutive_wrong, 0) ELSE 0 END DESC,
          CASE WHEN p_sort = 'high_conf_wrong' THEN COALESCE(m.high_conf_wrong_count, 0) ELSE 0 END DESC,
          CASE WHEN p_sort = 'due_first' THEN COALESCE(m.next_review_at, '9999-12-31T00:00:00Z'::timestamptz) ELSE NULL::timestamptz END ASC NULLS LAST,
          m.wrong_count DESC,
          m.last_reviewed_at DESC NULLS LAST,
          m.question_id ASC
      ) AS ord
    FROM matched m
  ),
  paged AS (
    SELECT o.*
    FROM ordered o
    ORDER BY o.ord ASC
    LIMIT v_page_size
    OFFSET v_offset
  )
  SELECT
    (SELECT total_cnt FROM counted),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'progress', to_jsonb(up_row),
            'resolved', (p.mistake_status = 'resolved' OR p.mastery_level = 'mastered'),
            'is_starred', EXISTS (
              SELECT 1 FROM public.starred_questions sq
              WHERE sq.user_id = v_caller AND sq.question_id = p.question_id
            ),
            'last_wrong_answer', lw.val,
            'study_set', jsonb_build_object(
              'id', s.id,
              'title', s.title,
              'subject', s.subject
            ),
            'question', to_jsonb(q) || jsonb_build_object(
              'options', COALESCE((
                SELECT jsonb_agg(to_jsonb(o) ORDER BY o.position ASC)
                FROM public.question_options o
                WHERE o.question_id = q.id
              ), '[]'::jsonb),
              'accepted_answers', COALESCE((
                SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.created_at ASC)
                FROM public.question_accepted_answers aa
                WHERE aa.question_id = q.id
              ), '[]'::jsonb),
              'tags', COALESCE((
                SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name ASC)
                FROM public.question_tags qt
                JOIN public.tags t ON t.id = qt.tag_id
                WHERE qt.question_id = q.id
              ), '[]'::jsonb)
            )
          )
          ORDER BY p.ord ASC
        )
        FROM paged p
        JOIN public.user_question_progress up_row
          ON up_row.user_id = p.user_id AND up_row.question_id = p.question_id
        JOIN public.questions q ON q.id = p.question_id
        JOIN public.study_sets s ON s.id = p.study_set_id
        LEFT JOIN LATERAL (
          SELECT val
          FROM (
            SELECT
              sa.answered_at AS ts,
              jsonb_build_object(
                'selected_option_ids', sa.selected_option_ids,
                'typed_answer', sa.typed_answer,
                'answered_at', sa.answered_at,
                'source', 'session',
                'attempt_id', NULL
              ) AS val
            FROM public.study_session_answers sa
            WHERE sa.user_id = v_caller
              AND sa.question_id = p.question_id
              AND sa.is_correct = false
            UNION ALL
            SELECT
              eaa.updated_at AS ts,
              jsonb_build_object(
                'selected_option_ids', eaa.selected_option_ids,
                'typed_answer', eaa.typed_answer,
                'answered_at', eaa.updated_at,
                'source', 'exam',
                'attempt_id', eaq.attempt_id
              ) AS val
            FROM public.exam_attempt_answers eaa
            JOIN public.exam_attempt_questions eaq ON eaq.id = eaa.attempt_question_id
            WHERE eaa.user_id = v_caller
              AND eaa.is_correct = false
              AND eaq.question_id = p.question_id
          ) combined_wrong
          ORDER BY ts DESC NULLS LAST
          LIMIT 1
        ) lw ON true
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_mistakes_page(
  uuid, text, text, uuid, text, integer, integer, integer, uuid, boolean,
  text, boolean, boolean, boolean, boolean, boolean, text, text, boolean, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_mistakes_page(
  uuid, text, text, uuid, text, integer, integer, integer, uuid, boolean,
  text, boolean, boolean, boolean, boolean, boolean, text, text, boolean, text, integer, integer
) TO authenticated;
