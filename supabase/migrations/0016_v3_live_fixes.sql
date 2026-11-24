-- ============================================================================
-- StudyHub V3.0 — Migration 0016: Live PG 17.12 Fixes (V3-DB-01 .. V3-DB-05)
-- ============================================================================
-- 100% additive, backward-compatible, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies 0001–0015. ZERO DROP POLICY, ZERO DROP TRIGGER, ZERO TEMP TABLE.
-- Fixes:
--   - V3-DB-01: Drop legacy V1 `questions_prompt_check` & `question_options_content_check`
--               (PG 17.12 deparses `trim(...)` as `btrim(...)`, which bypassed 0013's drop loop!)
--   - V3-DB-02: Restore V2.1 SM-2 wrong-answer ease_factor penalty (-0.54, or -0.59 on
--               high-confidence misconception) in `submit_exam_attempt` & `sync_offline_learning_events`.
--   - V3-DB-03: Enforce confidence & hint mastery guards (`guessing` interval=1 / cap < mastered,
--               `unsure` interval<=4 / cap < mastered, `hint_used` interval<=6 / cap < mastered,
--               no independent_recall_count increment on guessing/unsure/hint).
--   - V3-DB-04: `clone_study_set` remaps JSONB `type_payload->>'passage_id'` & `'diagram_id'`
--               and clones `content_media_relations` for `question_option` rows.
--   - V3-DB-05: `reset_learning_progress` clears `learning_confidence_events` for subject/chapter/
--               question scopes; `sync_offline_learning_events` guards `checkpoint_upsert` against
--               stale `progress_generation`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. V3-DB-01: Drop Legacy V1 Text-Only CHECK Constraints on questions & question_options
-- ----------------------------------------------------------------------------
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_prompt_check;
ALTER TABLE public.question_options DROP CONSTRAINT IF EXISTS question_options_content_check;

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%btrim(prompt)%'
        OR pg_get_constraintdef(oid) ILIKE '%trim(prompt)%'
      )
      AND conname <> 'questions_prompt_or_media_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.questions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.question_options'::regclass
      AND contype = 'c'
      AND (
        pg_get_constraintdef(oid) ILIKE '%btrim(content)%'
        OR pg_get_constraintdef(oid) ILIKE '%trim(content)%'
      )
      AND conname <> 'question_options_content_or_image_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.question_options DROP CONSTRAINT %I', v_conname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. V3-DB-02 + V3-DB-03: Updated submit_exam_attempt()
--    - Zero temp tables (PgBouncer-safe jsonb_to_recordset)
--    - Restored SM-2 wrong-answer ease penalty (-0.54; -0.59 on certain misconception)
--    - Confidence & hint mastery/interval guards aligned 1:1 with confidence.ts
--    - Confidence NEVER alters exam score_percent or passed!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_jwt_role text := public.current_jwt_role();
  v_pre_cycle_id uuid;
  v_pre_user_id uuid;
  v_attempt public.exam_attempts%ROWTYPE;
  v_now timestamptz := now();
  v_final_status text;
  v_time_spent integer;
  v_answered_count integer := 0;
  v_correct_count integer := 0;
  v_wrong_count integer := 0;
  v_unanswered_count integer := 0;
  v_score_percent numeric(5,2) := 0.00;
  v_passed boolean := false;
  v_breakdowns jsonb;
  v_cycle_json jsonb := NULL;
  v_cycle_newly_completed integer := 0;
  v_cycle_total integer;
  v_cycle_completed integer;
  v_cycle_assigned integer;
  v_cycle_answered integer;
  v_cycle_unassigned integer;
  v_cycle_status text;
  v_user_gen integer := 1;
  v_graded jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF v_caller IS NULL AND v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT ea.coverage_cycle_id, ea.user_id INTO v_pre_cycle_id, v_pre_user_id
  FROM public.exam_attempts ea
  WHERE ea.id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL AND v_pre_user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_pre_cycle_id IS NOT NULL THEN
    PERFORM 1
    FROM public.coverage_cycles cc
    WHERE cc.id = v_pre_cycle_id
    FOR UPDATE;
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL AND v_attempt.user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_attempt.status = 'discarded' THEN
    RAISE EXCEPTION 'Discarded exam attempt cannot be submitted' USING ERRCODE = 'P0004';
  END IF;

  IF v_attempt.status IN ('submitted', 'expired') THEN
    v_breakdowns := public.build_exam_breakdowns(p_attempt_id);
    IF v_attempt.coverage_cycle_id IS NOT NULL THEN
      SELECT to_jsonb(cc) INTO v_cycle_json
      FROM public.coverage_cycles cc
      WHERE cc.id = v_attempt.coverage_cycle_id;
    END IF;

    SELECT jsonb_build_object(
      'attempt', to_jsonb(v_attempt),
      'sources', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC)
        FROM public.exam_attempt_sources s WHERE s.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'questions', COALESCE((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
        FROM public.exam_attempt_questions q WHERE q.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'answers', COALESCE((
        SELECT jsonb_agg(to_jsonb(a))
        FROM public.exam_attempt_answers a WHERE a.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'subject_breakdown', v_breakdowns->'subject_breakdown',
      'chapter_breakdown', v_breakdowns->'chapter_breakdown',
      'tag_breakdown', v_breakdowns->'tag_breakdown',
      'coverage_cycle', v_cycle_json
    ) INTO v_result;
    RETURN v_result;
  END IF;

  IF v_attempt.expires_at IS NOT NULL AND v_now > v_attempt.expires_at THEN
    v_final_status := 'expired';
  ELSE
    v_final_status := 'submitted';
  END IF;

  v_time_spent := GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_attempt.started_at)))::integer);
  IF v_attempt.duration_limit_seconds IS NOT NULL THEN
    v_time_spent := LEAST(v_time_spent, v_attempt.duration_limit_seconds);
  END IF;

  SELECT COALESCE(up.progress_generation, 1) INTO v_user_gen
  FROM public.user_preferences up
  WHERE up.user_id = v_attempt.user_id;
  v_user_gen := COALESCE(v_user_gen, 1);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'attempt_question_id', eq.id,
        'question_id', eq.question_id,
        'resolved_study_set_id', COALESCE(eq.source_study_set_id, q_live.study_set_id, v_attempt.study_set_id),
        'answer_id', ea.id,
        'has_answer', CASE
          WHEN ea.id IS NULL THEN false
          ELSE public.has_exam_answer(eq.question_type, ea.selected_option_ids, ea.typed_answer, ea.structured_response)
        END,
        'is_correct', CASE
          WHEN ea.id IS NULL THEN false
          WHEN NOT public.has_exam_answer(eq.question_type, ea.selected_option_ids, ea.typed_answer, ea.structured_response) THEN false
          ELSE public.grade_v3_exam_answer(
            eq.question_type,
            eq.correct_option_ids,
            eq.accepted_answers_snapshot,
            eq.type_payload_snapshot,
            ea.selected_option_ids,
            ea.typed_answer,
            ea.structured_response
          )
        END,
        'confidence', ea.confidence,
        'hint_used', COALESCE(ea.hint_used, false)
      )
    ),
    '[]'::jsonb
  )
  INTO v_graded
  FROM public.exam_attempt_questions eq
  LEFT JOIN public.exam_attempt_answers ea
    ON ea.attempt_id = p_attempt_id
   AND ea.attempt_question_id = eq.id
  LEFT JOIN public.questions q_live
    ON q_live.id = eq.question_id
  WHERE eq.attempt_id = p_attempt_id;

  UPDATE public.exam_attempt_answers ea
  SET is_correct = g.is_correct,
      updated_at = v_now
  FROM jsonb_to_recordset(v_graded) AS g(
    attempt_question_id uuid,
    question_id uuid,
    resolved_study_set_id uuid,
    answer_id uuid,
    has_answer boolean,
    is_correct boolean,
    confidence text,
    hint_used boolean
  )
  WHERE ea.id = g.answer_id;

  -- Strictly correctness-based exam totals (confidence NEVER changes exam score or pass/fail!)
  SELECT
    count(*) FILTER (WHERE g.has_answer)::integer,
    count(*) FILTER (WHERE g.has_answer AND g.is_correct)::integer,
    count(*) FILTER (WHERE g.has_answer AND NOT g.is_correct)::integer,
    count(*) FILTER (WHERE NOT g.has_answer)::integer
  INTO v_answered_count, v_correct_count, v_wrong_count, v_unanswered_count
  FROM jsonb_to_recordset(v_graded) AS g(
    attempt_question_id uuid,
    question_id uuid,
    resolved_study_set_id uuid,
    answer_id uuid,
    has_answer boolean,
    is_correct boolean,
    confidence text,
    hint_used boolean
  );

  IF v_attempt.total_questions > 0 THEN
    v_score_percent := round((v_correct_count::numeric / v_attempt.total_questions::numeric) * 100, 2);
  ELSE
    v_score_percent := 0.00;
  END IF;
  v_passed := v_score_percent >= v_attempt.pass_threshold;

  INSERT INTO public.learning_confidence_events (
    user_id,
    study_set_id,
    question_id,
    mode,
    confidence,
    is_correct,
    hint_used,
    created_at
  )
  SELECT
    v_attempt.user_id,
    g.resolved_study_set_id,
    g.question_id,
    'exam',
    g.confidence,
    g.is_correct,
    g.hint_used,
    v_now
  FROM jsonb_to_recordset(v_graded) AS g(
    attempt_question_id uuid,
    question_id uuid,
    resolved_study_set_id uuid,
    answer_id uuid,
    has_answer boolean,
    is_correct boolean,
    confidence text,
    hint_used boolean
  )
  JOIN public.questions q_exists
    ON q_exists.id = g.question_id
   AND q_exists.study_set_id = g.resolved_study_set_id
  WHERE g.has_answer
    AND g.confidence IS NOT NULL;

  -- Set-based SM-2 + V3 confidence/hint mastery guards aligned 1:1 with sm2.ts & confidence.ts
  WITH eligible AS (
    SELECT
      g.question_id,
      g.resolved_study_set_id AS study_set_id,
      g.is_correct,
      g.confidence,
      g.hint_used,
      COALESCE(p.mastery_level, 'new') AS prev_mastery,
      COALESCE(p.mistake_status, 'active') AS prev_mistake_status,
      COALESCE(p.correct_count, 0) AS prev_correct,
      COALESCE(p.wrong_count, 0) AS prev_wrong,
      COALESCE(p.consecutive_correct, 0) AS prev_streak,
      COALESCE(p.consecutive_wrong, 0) AS prev_wrong_streak,
      COALESCE(p.ease_factor, 2.50) AS prev_ef,
      COALESCE(p.interval_days, 0) AS prev_interval,
      COALESCE(p.repetitions, 0) AS prev_reps,
      COALESCE(p.low_confidence_count, 0) AS prev_low_conf,
      COALESCE(p.high_conf_wrong_count, 0) AS prev_high_conf_wrong,
      COALESCE(p.guess_correct_count, 0) AS prev_guess_correct,
      COALESCE(p.independent_recall_count, 0) AS prev_indep,
      COALESCE(p.hint_used_count, 0) AS prev_hints,
      p.last_wrong_at AS prev_last_wrong_at
    FROM jsonb_to_recordset(v_graded) AS g(
      attempt_question_id uuid,
      question_id uuid,
      resolved_study_set_id uuid,
      answer_id uuid,
      has_answer boolean,
      is_correct boolean,
      confidence text,
      hint_used boolean
    )
    JOIN public.questions q_exists
      ON q_exists.id = g.question_id
     AND q_exists.study_set_id = g.resolved_study_set_id
    LEFT JOIN public.user_question_progress p
      ON p.user_id = v_attempt.user_id
     AND p.question_id = g.question_id
    WHERE g.has_answer
  ),
  base_sm2 AS (
    SELECT
      e.*,
      e.prev_correct + CASE WHEN e.is_correct THEN 1 ELSE 0 END AS next_correct,
      e.prev_wrong + CASE WHEN e.is_correct THEN 0 ELSE 1 END AS next_wrong,
      CASE
        WHEN NOT e.is_correct THEN 0
        WHEN e.confidence = 'guessing' THEN LEAST(e.prev_streak + 1, 2)
        ELSE e.prev_streak + 1
      END AS next_streak,
      CASE WHEN e.is_correct THEN 0 ELSE e.prev_wrong_streak + 1 END AS next_wrong_streak,
      CASE
        WHEN NOT e.is_correct THEN 0
        WHEN e.confidence = 'guessing' THEN LEAST(e.prev_reps, 1)
        ELSE e.prev_reps + 1
      END AS next_reps,
      CASE
        WHEN NOT e.is_correct THEN 1
        WHEN e.confidence = 'guessing' THEN 1
        ELSE (
          CASE
            WHEN e.prev_reps = 0 THEN 1
            WHEN e.prev_reps = 1 THEN 6
            ELSE GREATEST(1, LEAST(3650, round(GREATEST(1, e.prev_interval) * e.prev_ef)::integer))
          END
        )
      END AS raw_interval,
      CASE
        WHEN e.is_correct THEN round(GREATEST(1.30, LEAST(4.00, e.prev_ef)), 2)
        WHEN e.confidence = 'certain' THEN round(GREATEST(1.30, e.prev_ef - 0.59), 2)
        ELSE round(GREATEST(1.30, e.prev_ef - 0.54), 2)
      END AS next_ef,
      CASE WHEN e.is_correct THEN e.prev_last_wrong_at ELSE v_now END AS next_last_wrong_at,
      e.prev_low_conf + CASE WHEN e.confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END AS next_low_conf,
      e.prev_high_conf_wrong + CASE WHEN NOT e.is_correct AND e.confidence = 'certain' THEN 1 ELSE 0 END AS next_high_conf_wrong,
      e.prev_guess_correct + CASE WHEN e.is_correct AND e.confidence = 'guessing' THEN 1 ELSE 0 END AS next_guess_correct,
      e.prev_indep + CASE
        WHEN e.is_correct
         AND NOT e.hint_used
         AND (e.confidence IS NULL OR e.confidence = 'certain')
        THEN 1 ELSE 0
      END AS next_indep,
      e.prev_hints + CASE WHEN e.hint_used THEN 1 ELSE 0 END AS next_hints
    FROM eligible e
  ),
  computed AS (
    SELECT
      b.*,
      CASE
        WHEN NOT b.is_correct THEN 1
        WHEN b.confidence = 'guessing' THEN 1
        WHEN b.confidence = 'unsure' THEN LEAST(b.raw_interval, 4)
        WHEN b.hint_used THEN LEAST(b.raw_interval, 6)
        ELSE b.raw_interval
      END AS next_interval
    FROM base_sm2 b
  )
  INSERT INTO public.user_question_progress (
    user_id,
    study_set_id,
    question_id,
    mastery_level,
    correct_count,
    wrong_count,
    consecutive_correct,
    consecutive_wrong,
    ease_factor,
    interval_days,
    repetitions,
    last_reviewed_at,
    last_wrong_at,
    next_review_at,
    last_confidence,
    low_confidence_count,
    high_conf_wrong_count,
    guess_correct_count,
    independent_recall_count,
    hint_used_count,
    mistake_status,
    progress_generation,
    updated_at
  )
  SELECT
    v_attempt.user_id,
    c.study_set_id,
    c.question_id,
    CASE
      WHEN NOT c.is_correct THEN 'learning'
      WHEN c.confidence = 'guessing' THEN
        CASE WHEN c.prev_mastery = 'mastered' OR c.next_streak >= 2 OR c.next_interval >= 6 THEN 'familiar' ELSE 'learning' END
      WHEN c.confidence = 'unsure' OR c.hint_used THEN
        CASE WHEN c.next_streak >= 2 OR c.next_interval >= 6 THEN 'familiar' ELSE 'learning' END
      WHEN c.next_streak >= 3 AND c.next_interval >= 14 THEN 'mastered'
      WHEN c.next_streak >= 2 OR c.next_interval >= 6 THEN 'familiar'
      ELSE 'learning'
    END,
    c.next_correct,
    c.next_wrong,
    c.next_streak,
    c.next_wrong_streak,
    c.next_ef,
    c.next_interval,
    c.next_reps,
    v_now,
    c.next_last_wrong_at,
    v_now + make_interval(days => c.next_interval),
    c.confidence,
    c.next_low_conf,
    c.next_high_conf_wrong,
    c.next_guess_correct,
    c.next_indep,
    c.next_hints,
    CASE
      WHEN NOT c.is_correct THEN 'active'
      WHEN c.next_wrong > 0 AND (c.confidence = 'guessing' OR c.hint_used) THEN
        CASE WHEN c.prev_mistake_status = 'resolved' THEN 'improving' ELSE c.prev_mistake_status END
      WHEN c.next_wrong > 0 AND c.next_streak >= 2 THEN 'resolved'
      WHEN c.next_wrong > 0 THEN 'improving'
      ELSE 'resolved'
    END,
    v_user_gen,
    v_now
  FROM computed c
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

  UPDATE public.exam_attempts
  SET status = v_final_status,
      answered_count = v_answered_count,
      correct_count = v_correct_count,
      wrong_count = v_wrong_count,
      unanswered_count = v_unanswered_count,
      score_percent = v_score_percent,
      passed = v_passed,
      time_spent_seconds = v_time_spent,
      submitted_at = v_now
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  UPDATE public.study_sets s
  SET last_studied_at = v_now
  WHERE s.owner_id = v_attempt.user_id
    AND s.id IN (
      SELECT DISTINCT g.resolved_study_set_id
      FROM jsonb_to_recordset(v_graded) AS g(resolved_study_set_id uuid)
      WHERE g.resolved_study_set_id IS NOT NULL
    );

  IF v_attempt.coverage_cycle_id IS NOT NULL THEN
    UPDATE public.coverage_cycle_questions cq
    SET state = 'completed',
        assigned_attempt_id = NULL,
        completed_attempt_id = p_attempt_id,
        was_answered = true,
        last_is_correct = g.is_correct,
        completed_at = v_now
    FROM jsonb_to_recordset(v_graded) AS g(
      question_id uuid,
      has_answer boolean,
      is_correct boolean
    )
    WHERE cq.cycle_id = v_attempt.coverage_cycle_id
      AND cq.assigned_attempt_id = p_attempt_id
      AND cq.question_id = g.question_id
      AND g.has_answer = true;

    GET DIAGNOSTICS v_cycle_newly_completed = ROW_COUNT;

    UPDATE public.coverage_cycle_questions cq
    SET state = 'unassigned',
        assigned_attempt_id = NULL,
        was_answered = false
    WHERE cq.cycle_id = v_attempt.coverage_cycle_id
      AND cq.assigned_attempt_id = p_attempt_id
      AND cq.state = 'assigned';

    UPDATE public.coverage_cycle_attempts
    SET status = 'completed',
        answered_question_count = v_answered_count,
        completed_question_count = v_cycle_newly_completed
    WHERE cycle_id = v_attempt.coverage_cycle_id
      AND attempt_id = p_attempt_id;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE state = 'completed')::integer,
      count(*) FILTER (WHERE state = 'assigned')::integer,
      count(*) FILTER (WHERE was_answered)::integer,
      count(*) FILTER (WHERE state = 'unassigned' AND question_id IS NOT NULL)::integer
    INTO v_cycle_total, v_cycle_completed, v_cycle_assigned, v_cycle_answered, v_cycle_unassigned
    FROM public.coverage_cycle_questions
    WHERE cycle_id = v_attempt.coverage_cycle_id;

    v_cycle_status := CASE
      WHEN v_cycle_assigned = 0 AND v_cycle_unassigned = 0 THEN 'completed'
      ELSE 'active'
    END;

    UPDATE public.coverage_cycles
    SET status = v_cycle_status,
        assigned_count = v_cycle_assigned,
        answered_count = v_cycle_answered,
        completed_count = v_cycle_completed,
        active_attempt_id = CASE WHEN active_attempt_id = p_attempt_id THEN NULL ELSE active_attempt_id END,
        completed_at = CASE WHEN v_cycle_status = 'completed' THEN COALESCE(completed_at, v_now) ELSE NULL END,
        updated_at = v_now
    WHERE id = v_attempt.coverage_cycle_id;

    SELECT to_jsonb(cc) INTO v_cycle_json
    FROM public.coverage_cycles cc
    WHERE cc.id = v_attempt.coverage_cycle_id;
  END IF;

  v_breakdowns := public.build_exam_breakdowns(p_attempt_id);

  SELECT jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC)
      FROM public.exam_attempt_sources s WHERE s.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
      FROM public.exam_attempt_questions q WHERE q.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'answers', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.exam_attempt_answers a WHERE a.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'subject_breakdown', v_breakdowns->'subject_breakdown',
    'chapter_breakdown', v_breakdowns->'chapter_breakdown',
    'tag_breakdown', v_breakdowns->'tag_breakdown',
    'coverage_cycle', v_cycle_json
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. V3-DB-04: Updated clone_study_set() — Remaps JSONB passage_id & diagram_id
--    in questions.type_payload AND clones content_media_relations for question_options
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_study_set(
  p_source_set_id uuid,
  p_title text DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_src public.study_sets%ROWTYPE;
  v_member_clone boolean;
  v_new_set public.study_sets%ROWTYPE;
  v_target_title text;
  v_copied_q integer := 0;
  v_pmap jsonb := '[]'::jsonb;
  v_dmap jsonb := '[]'::jsonb;
  v_qmap jsonb := '[]'::jsonb;
  v_omap jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_read_study_set(p_source_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src
  FROM public.study_sets
  WHERE id = p_source_set_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study set not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_src.owner_id <> v_caller AND v_src.visibility <> 'public' THEN
    SELECT m.allow_clone INTO v_member_clone
    FROM public.study_set_members m
    WHERE m.study_set_id = p_source_set_id
      AND m.user_id = v_caller;

    IF COALESCE(v_member_clone, false) = false THEN
      RAISE EXCEPTION 'Cloning is disabled for this shared study set.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.folders f WHERE f.id = p_folder_id AND f.owner_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Target folder not found' USING ERRCODE = 'P0002';
  END IF;

  v_target_title := left(
    trim(COALESCE(NULLIF(p_title, ''), v_src.title || ' (Copy)')),
    200
  );

  INSERT INTO public.study_sets (
    owner_id,
    folder_id,
    title,
    description,
    subject,
    set_type,
    visibility,
    source_language,
    default_exam_duration_minutes,
    default_pass_threshold
  ) VALUES (
    v_caller,
    p_folder_id,
    v_target_title,
    v_src.description,
    v_src.subject,
    v_src.set_type,
    'private',
    v_src.source_language,
    v_src.default_exam_duration_minutes,
    v_src.default_pass_threshold
  )
  RETURNING * INTO v_new_set;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('old_id', sp.id, 'new_id', gen_random_uuid())),
    '[]'::jsonb
  ) INTO v_pmap
  FROM public.shared_passages sp
  WHERE sp.study_set_id = p_source_set_id;

  INSERT INTO public.shared_passages (
    id, study_set_id, owner_id, title, content_text, content_rich,
    audio_media_id, transcript, source_reference, sort_order
  )
  SELECT
    pm.new_id, v_new_set.id, v_caller, sp.title, sp.content_text, sp.content_rich,
    sp.audio_media_id, sp.transcript, sp.source_reference, sp.sort_order
  FROM jsonb_to_recordset(v_pmap) AS pm(old_id uuid, new_id uuid)
  JOIN public.shared_passages sp ON sp.id = pm.old_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('old_id', ds.id, 'new_id', gen_random_uuid())),
    '[]'::jsonb
  ) INTO v_dmap
  FROM public.diagram_sets ds
  WHERE ds.study_set_id = p_source_set_id;

  INSERT INTO public.diagram_sets (
    id, study_set_id, owner_id, title, description, base_media_id,
    base_image_url, image_width, image_height
  )
  SELECT
    dm.new_id, v_new_set.id, v_caller, ds.title, ds.description, ds.base_media_id,
    ds.base_image_url, ds.image_width, ds.image_height
  FROM jsonb_to_recordset(v_dmap) AS dm(old_id uuid, new_id uuid)
  JOIN public.diagram_sets ds ON ds.id = dm.old_id;

  INSERT INTO public.diagram_hotspots (
    diagram_id, study_set_id, label, accepted_alternatives, description,
    hint, shape, geometry, sort_order
  )
  SELECT
    dm.new_id, v_new_set.id, dh.label, dh.accepted_alternatives, dh.description,
    dh.hint, dh.shape, dh.geometry, dh.sort_order
  FROM jsonb_to_recordset(v_dmap) AS dm(old_id uuid, new_id uuid)
  JOIN public.diagram_hotspots dh ON dh.diagram_id = dm.old_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('old_id', ranked.id, 'new_id', gen_random_uuid(), 'new_pos', ranked.new_pos)),
    '[]'::jsonb
  ) INTO v_qmap
  FROM (
    SELECT
      q.id,
      (row_number() OVER (ORDER BY q.position ASC, q.created_at ASC, q.id ASC) - 1)::integer AS new_pos
    FROM public.questions q
    WHERE q.study_set_id = p_source_set_id
  ) ranked;

  INSERT INTO public.questions (
    id, study_set_id, question_type, position, chapter, prompt, prompt_rich,
    prompt_image_url, back_text, back_rich, back_image_url, explanation,
    explanation_rich, hint, hint_rich, audio_media_id, audio_url, audio_transcript,
    passage_id, diagram_id, type_payload, difficulty, source_metadata
  )
  SELECT
    m.new_id,
    v_new_set.id,
    q.question_type,
    m.new_pos,
    q.chapter,
    q.prompt,
    q.prompt_rich,
    q.prompt_image_url,
    q.back_text,
    q.back_rich,
    q.back_image_url,
    q.explanation,
    q.explanation_rich,
    q.hint,
    q.hint_rich,
    q.audio_media_id,
    q.audio_url,
    q.audio_transcript,
    pm.new_id,
    dm.new_id,
    CASE
      WHEN q.type_payload IS NULL THEN NULL
      ELSE (
        CASE
          WHEN pm_json.new_id IS NOT NULL AND q.type_payload ? 'passage_id'
          THEN jsonb_set(q.type_payload, '{passage_id}', to_jsonb(pm_json.new_id::text), false)
          ELSE q.type_payload
        END
        || CASE
          WHEN dm_json.new_id IS NOT NULL AND q.type_payload ? 'diagram_id'
          THEN jsonb_build_object('diagram_id', dm_json.new_id::text)
          ELSE '{}'::jsonb
        END
      )
    END,
    q.difficulty,
    q.source_metadata
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.questions q ON q.id = m.old_id
  LEFT JOIN jsonb_to_recordset(v_pmap) AS pm(old_id uuid, new_id uuid) ON pm.old_id = q.passage_id
  LEFT JOIN jsonb_to_recordset(v_dmap) AS dm(old_id uuid, new_id uuid) ON dm.old_id = q.diagram_id
  LEFT JOIN jsonb_to_recordset(v_pmap) AS pm_json(old_id uuid, new_id uuid)
    ON pm_json.old_id::text = NULLIF(q.type_payload->>'passage_id', '')
  LEFT JOIN jsonb_to_recordset(v_dmap) AS dm_json(old_id uuid, new_id uuid)
    ON dm_json.old_id::text = NULLIF(q.type_payload->>'diagram_id', '');

  GET DIAGNOSTICS v_copied_q = ROW_COUNT;

  -- Build 1:1 option map so question_option content_media_relations clone cleanly too!
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('old_id', o.id, 'new_id', gen_random_uuid(), 'new_q_id', m.new_id)),
    '[]'::jsonb
  ) INTO v_omap
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.question_options o ON o.question_id = m.old_id;

  INSERT INTO public.question_options (
    id, question_id, study_set_id, position, label, content, content_rich,
    image_url, media_id, image_alt, is_correct
  )
  SELECT
    om.new_id, om.new_q_id, v_new_set.id, o.position, o.label, o.content, o.content_rich,
    o.image_url, o.media_id, o.image_alt, o.is_correct
  FROM jsonb_to_recordset(v_omap) AS om(old_id uuid, new_id uuid, new_q_id uuid)
  JOIN public.question_options o ON o.id = om.old_id
  ORDER BY o.position ASC;

  INSERT INTO public.question_accepted_answers (
    question_id, study_set_id, answer_text, normalized_answer, match_mode
  )
  SELECT
    m.new_id, v_new_set.id, aa.answer_text, aa.normalized_answer, aa.match_mode
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.question_accepted_answers aa ON aa.question_id = m.old_id;

  INSERT INTO public.tags (owner_id, name, slug, color)
  SELECT DISTINCT v_caller, t.name, t.slug, t.color
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.question_tags qt ON qt.question_id = m.old_id
  JOIN public.tags t ON t.id = qt.tag_id
  ON CONFLICT (owner_id, slug) DO NOTHING;

  INSERT INTO public.question_tags (question_id, tag_id, study_set_id)
  SELECT DISTINCT m.new_id, caller_t.id, v_new_set.id
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.question_tags qt ON qt.question_id = m.old_id
  JOIN public.tags src_t ON src_t.id = qt.tag_id
  JOIN public.tags caller_t ON caller_t.owner_id = v_caller AND caller_t.slug = src_t.slug
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT cmr.media_id, 'question', m.new_id, cmr.role, cmr.sort_order, cmr.alt_text, cmr.caption
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question' AND cmr.entity_id = m.old_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT cmr.media_id, 'question_option', om.new_id, cmr.role, cmr.sort_order, cmr.alt_text, cmr.caption
  FROM jsonb_to_recordset(v_omap) AS om(old_id uuid, new_id uuid, new_q_id uuid)
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question_option' AND cmr.entity_id = om.old_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT cmr.media_id, 'shared_passage', pm.new_id, cmr.role, cmr.sort_order, cmr.alt_text, cmr.caption
  FROM jsonb_to_recordset(v_pmap) AS pm(old_id uuid, new_id uuid)
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'shared_passage' AND cmr.entity_id = pm.old_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT cmr.media_id, 'diagram_set', dm.new_id, cmr.role, cmr.sort_order, cmr.alt_text, cmr.caption
  FROM jsonb_to_recordset(v_dmap) AS dm(old_id uuid, new_id uuid)
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'diagram_set' AND cmr.entity_id = dm.old_id
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_new_set FROM public.study_sets WHERE id = v_new_set.id;

  RETURN jsonb_build_object(
    'study_set', to_jsonb(v_new_set),
    'copied_questions', v_copied_q
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clone_study_set(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_study_set(uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. V3-DB-05a: Updated reset_learning_progress() — Clears learning_confidence_events
--    across ALL scopes (including subject, chapter, question) while strictly
--    preserving exam_attempts history & all study content!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_learning_progress(
  p_scope text,
  p_study_set_id uuid DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_chapter text DEFAULT NULL,
  p_question_ids uuid[] DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_clear_mistakes boolean DEFAULT true,
  p_clear_starred boolean DEFAULT false,
  p_clear_checkpoints boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_reset_progress integer := 0;
  v_cleared_checkpoints integer := 0;
  v_cleared_starred integer := 0;
  v_new_gen integer := 2;
  v_target_set_ids uuid[] := '{}'::uuid[];
  v_target_q_ids uuid[] := '{}'::uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_scope NOT IN ('all', 'study_set', 'subject', 'chapter', 'question', 'mode') THEN
    RAISE EXCEPTION 'Invalid reset scope' USING ERRCODE = '22023';
  END IF;

  IF p_scope = 'study_set' AND p_study_set_id IS NULL THEN
    RAISE EXCEPTION 'study_set_id is required for study_set scope' USING ERRCODE = '22023';
  ELSIF p_scope = 'subject' AND NULLIF(trim(COALESCE(p_subject, '')), '') IS NULL THEN
    RAISE EXCEPTION 'subject is required for subject scope' USING ERRCODE = '22023';
  ELSIF p_scope = 'chapter' AND (p_study_set_id IS NULL OR NULLIF(trim(COALESCE(p_chapter, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'study_set_id and chapter are required for chapter scope' USING ERRCODE = '22023';
  ELSIF p_scope = 'question' AND COALESCE(array_length(p_question_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'question_ids are required for question scope' USING ERRCODE = '22023';
  ELSIF p_scope = 'mode' AND NULLIF(trim(COALESCE(p_mode, '')), '') IS NULL THEN
    RAISE EXCEPTION 'mode is required for mode scope' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.user_preferences (user_id, progress_generation, updated_at)
  VALUES (v_caller, 2, v_now)
  ON CONFLICT (user_id) DO UPDATE
  SET progress_generation = public.user_preferences.progress_generation + 1,
      updated_at = v_now
  RETURNING progress_generation INTO v_new_gen;

  IF p_scope = 'mode' THEN
    IF COALESCE(p_clear_checkpoints, true) THEN
      DELETE FROM public.learning_session_checkpoints
      WHERE user_id = v_caller
        AND mode = p_mode
        AND (p_study_set_id IS NULL OR study_set_id = p_study_set_id);
      GET DIAGNOSTICS v_cleared_checkpoints = ROW_COUNT;
    END IF;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller
      AND mode = p_mode
      AND (p_study_set_id IS NULL OR study_set_id = p_study_set_id);

    RETURN jsonb_build_object(
      'reset_progress_count', 0,
      'cleared_checkpoints_count', v_cleared_checkpoints,
      'cleared_starred_count', 0,
      'new_progress_generation', v_new_gen
    );
  END IF;

  IF p_scope = 'all' THEN
    DELETE FROM public.user_question_progress
    WHERE user_id = v_caller
      AND (COALESCE(p_clear_mistakes, true) OR wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller;

    IF COALESCE(p_clear_checkpoints, true) THEN
      DELETE FROM public.learning_session_checkpoints
      WHERE user_id = v_caller;
      GET DIAGNOSTICS v_cleared_checkpoints = ROW_COUNT;
    END IF;

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller;
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;

  ELSIF p_scope = 'study_set' THEN
    DELETE FROM public.user_question_progress
    WHERE user_id = v_caller
      AND study_set_id = p_study_set_id
      AND (COALESCE(p_clear_mistakes, true) OR wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller AND study_set_id = p_study_set_id;

    IF COALESCE(p_clear_checkpoints, true) THEN
      DELETE FROM public.learning_session_checkpoints
      WHERE user_id = v_caller AND study_set_id = p_study_set_id;
      GET DIAGNOSTICS v_cleared_checkpoints = ROW_COUNT;
    END IF;

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller AND study_set_id = p_study_set_id;
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;

  ELSIF p_scope = 'subject' THEN
    SELECT COALESCE(array_agg(s.id), '{}'::uuid[]) INTO v_target_set_ids
    FROM public.study_sets s
    WHERE lower(trim(COALESCE(s.subject, ''))) = lower(trim(p_subject))
      AND public.can_read_study_set(s.id, v_caller);

    DELETE FROM public.user_question_progress
    WHERE user_id = v_caller
      AND study_set_id = ANY(v_target_set_ids)
      AND (COALESCE(p_clear_mistakes, true) OR wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller
      AND study_set_id = ANY(v_target_set_ids);

    IF COALESCE(p_clear_checkpoints, true) THEN
      DELETE FROM public.learning_session_checkpoints
      WHERE user_id = v_caller
        AND study_set_id = ANY(v_target_set_ids);
      GET DIAGNOSTICS v_cleared_checkpoints = ROW_COUNT;
    END IF;

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller
        AND study_set_id = ANY(v_target_set_ids);
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;

  ELSIF p_scope = 'chapter' THEN
    SELECT COALESCE(array_agg(q.id), '{}'::uuid[]) INTO v_target_q_ids
    FROM public.questions q
    WHERE q.study_set_id = p_study_set_id
      AND lower(trim(COALESCE(q.chapter, ''))) = lower(trim(p_chapter));

    DELETE FROM public.user_question_progress
    WHERE user_id = v_caller
      AND question_id = ANY(v_target_q_ids)
      AND (COALESCE(p_clear_mistakes, true) OR wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller
      AND question_id = ANY(v_target_q_ids);

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller AND question_id = ANY(v_target_q_ids);
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;

  ELSIF p_scope = 'question' THEN
    DELETE FROM public.user_question_progress
    WHERE user_id = v_caller
      AND question_id = ANY(p_question_ids)
      AND (COALESCE(p_clear_mistakes, true) OR wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    DELETE FROM public.learning_confidence_events
    WHERE user_id = v_caller
      AND question_id = ANY(p_question_ids);

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller AND question_id = ANY(p_question_ids);
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'reset_progress_count', v_reset_progress,
    'cleared_checkpoints_count', v_cleared_checkpoints,
    'cleared_starred_count', v_cleared_starred,
    'new_progress_generation', v_new_gen
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_learning_progress(text, uuid, text, text, uuid[], text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_learning_progress(text, uuid, text, text, uuid[], text, boolean, boolean, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. V3-DB-02 + V3-DB-03 + V3-DB-05b: Updated sync_offline_learning_events()
--    - Restores -0.54 wrong ease penalty (-0.59 on certain misconception)
--    - Applies guessing/unsure/hint mastery & interval guards
--    - Includes 'checkpoint_upsert' in stale progress_generation guard
-- ----------------------------------------------------------------------------
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

    SELECT lse.user_id INTO v_existing_owner
    FROM public.learning_sync_events lse
    WHERE lse.event_id = v_event_id;

    IF FOUND THEN
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

    IF v_set_id IS NULL AND v_q_id IS NOT NULL THEN
      SELECT q.study_set_id INTO v_set_id FROM public.questions q WHERE q.id = v_q_id;
    END IF;

    IF v_set_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM public.study_sets s WHERE s.id = v_set_id) INTO v_set_exists;
      IF NOT v_set_exists THEN
        v_status := 'rejected_deleted';
        v_msg := 'Study set no longer exists.';
      ELSIF NOT public.can_read_study_set(v_set_id, v_caller) THEN
        v_status := 'rejected_revoked';
        v_msg := 'Access to this study set was revoked.';
      END IF;
    END IF;

    IF v_status = 'applied' AND v_q_id IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM public.questions q
        WHERE q.id = v_q_id AND (v_set_id IS NULL OR q.study_set_id = v_set_id)
      ) INTO v_q_exists;
      IF NOT v_q_exists THEN
        v_status := 'rejected_deleted';
        v_msg := 'Question no longer exists.';
      END IF;
    END IF;

    -- Guard stale progress/checkpoint events created BEFORE latest progress reset
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

          WITH prev AS (
            SELECT
              COALESCE(p.mastery_level, 'new') AS pm,
              COALESCE(p.mistake_status, 'active') AS pms,
              COALESCE(p.correct_count, 0) AS pc,
              COALESCE(p.wrong_count, 0) AS pw,
              COALESCE(p.consecutive_correct, 0) AS psc,
              COALESCE(p.consecutive_wrong, 0) AS psw,
              COALESCE(p.ease_factor, 2.50) AS pef,
              COALESCE(p.interval_days, 0) AS pint,
              COALESCE(p.repetitions, 0) AS preps,
              COALESCE(p.low_confidence_count, 0) AS plc,
              COALESCE(p.high_conf_wrong_count, 0) AS phcw,
              COALESCE(p.guess_correct_count, 0) AS pgc,
              COALESCE(p.independent_recall_count, 0) AS pir,
              COALESCE(p.hint_used_count, 0) AS phu,
              p.last_wrong_at AS plw
            FROM (SELECT 1) d
            LEFT JOIN public.user_question_progress p
              ON p.user_id = v_caller AND p.question_id = v_q_id
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

    IF v_status <> 'conflict' THEN
      INSERT INTO public.learning_sync_events (
        event_id, user_id, event_type, study_set_id, question_id,
        client_timestamp, progress_generation, status, payload, result_detail, processed_at
      ) VALUES (
        v_event_id,
        v_caller,
        v_event_type,
        CASE WHEN v_set_exists THEN v_set_id ELSE NULL END,
        CASE WHEN v_q_exists THEN v_q_id ELSE NULL END,
        v_client_ts,
        v_ev_gen,
        v_status,
        v_payload,
        CASE WHEN v_msg IS NOT NULL THEN jsonb_build_object('message', v_msg) ELSE NULL END,
        v_now
      )
      ON CONFLICT (event_id) DO NOTHING;
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
