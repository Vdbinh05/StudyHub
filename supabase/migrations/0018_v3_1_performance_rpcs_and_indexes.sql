-- ============================================================================
-- StudyHub V3.1 — Migration 0018: Performance RPCs & Targeted Composite Indexes
--   1. Five targeted composite/partial indexes for hot read & review paths
--   2. public.get_dashboard_summary() — collapses 11-query /api/dashboard fan-out
--      into 1 single PostgreSQL RPC round-trip with exact response parity
--   3. public.get_study_set_summary(p_set_id uuid) — aggregates chapters,
--      question types, mastery counts & starred count inside PostgreSQL
--   4. public.record_study_session_answer(...) — collapses 9-11 serial hops in
--      POST /api/sessions/[sessionId]/answers into 1 atomic DB round-trip
-- ============================================================================
-- 100% additive, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies 0001–0017. ZERO DROP POLICY, ZERO DROP TRIGGER, ZERO TEMP TABLE.
-- 100% (SELECT auth.uid()), 100% SET search_path = '', REVOKE FROM PUBLIC, anon.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Targeted Composite / Partial Indexes (Zero unindexed FKs preserved)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_study_sessions_user_started
  ON public.study_sessions (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_submitted
  ON public.exam_attempts (user_id, submitted_at DESC)
  WHERE status IN ('submitted', 'expired');

CREATE INDEX IF NOT EXISTS idx_starred_questions_user_set
  ON public.starred_questions (user_id, study_set_id);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_answers_user_wrong
  ON public.exam_attempt_answers (user_id, attempt_id, attempt_question_id)
  WHERE is_correct = false;

CREATE INDEX IF NOT EXISTS idx_study_session_answers_session_correct
  ON public.study_session_answers (session_id, user_id, is_correct);

-- ----------------------------------------------------------------------------
-- 2. public.get_dashboard_summary() — Single-RTT Dashboard Aggregation RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
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
    count(*) FILTER (WHERE p.wrong_count > 0 AND p.mastery_level <> 'mastered')::integer,
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

  -- Active UTC dates over the past year (sessions + session answers + submitted/expired exams)
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

  -- 14-day UTC activity series + today's answer count
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
      AND COALESCE(ea.submitted_at, ea.created_at) >= v_14d_cutoff
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

-- ----------------------------------------------------------------------------
-- 3. public.get_study_set_summary(p_set_id uuid) — Single-RTT Set Hub Summary
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_study_set_summary(p_set_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
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
    count(*) FILTER (WHERE p.wrong_count > 0 AND p.mastery_level <> 'mastered')::integer
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
-- 4. public.record_study_session_answer(...) — Single-RTT Atomic Study Answer
--    100% grading + SM-2 + V3 confidence/hint mastery parity with progress-helper.ts & 0016
-- ----------------------------------------------------------------------------
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
  v_completed_count integer := 0;
  v_correct_count integer := 0;

  -- SM-2 & V3 confidence/hint state
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

  SELECT * INTO v_session
  FROM public.study_sessions ss
  WHERE ss.id = p_session_id
    AND ss.user_id = v_caller;

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

  -- SH-012 / SEC-023: Verify the answered question belongs to this session's study set(s)
  IF (v_session.study_set_id IS NOT NULL OR COALESCE(array_length(v_session.source_study_set_ids, 1), 0) > 0)
     AND NOT COALESCE(
       (v_session.study_set_id IS NOT NULL AND v_question.study_set_id = v_session.study_set_id)
       OR (v_session.source_study_set_ids IS NOT NULL AND v_question.study_set_id = ANY(v_session.source_study_set_ids)),
       false
     ) THEN
    RAISE EXCEPTION 'Question does not belong to this study session' USING ERRCODE = '22023';
  END IF;

  -- Resolve effective selected option IDs (plain array or structured_response.kind = 'options')
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

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE sa.is_correct)::integer
  INTO v_completed_count, v_correct_count
  FROM public.study_session_answers sa
  WHERE sa.session_id = v_session.id
    AND sa.user_id = v_caller;

  UPDATE public.study_sessions
  SET completed_items = v_completed_count,
      correct_items = v_correct_count
  WHERE id = v_session.id
    AND user_id = v_caller;

  IF COALESCE(p_update_progress, true) THEN
    SELECT * INTO v_existing
    FROM public.user_question_progress p
    WHERE p.user_id = v_caller
      AND p.question_id = v_question.id;
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

    -- V3 confidence & hint mastery/interval guards (aligned 1:1 with progress-helper.ts)
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
    ) VALUES (
      v_caller,
      v_question.study_set_id,
      v_question.id,
      v_final_mastery,
      v_next_correct,
      v_next_wrong,
      v_final_streak,
      v_next_wrong_streak,
      v_final_ease,
      v_final_interval,
      v_final_reps,
      v_now,
      v_next_last_wrong_at,
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
      v_derived_mistake_status,
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

    IF p_confidence IS NOT NULL THEN
      INSERT INTO public.learning_confidence_events (
        user_id,
        study_set_id,
        question_id,
        mode,
        confidence,
        is_correct,
        hint_used,
        response_time_ms,
        created_at
      ) VALUES (
        v_caller,
        v_question.study_set_id,
        v_question.id,
        v_session.mode,
        p_confidence,
        v_passed,
        COALESCE(p_hint_used, false),
        p_response_time_ms,
        v_now
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
