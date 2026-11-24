-- ============================================================================
-- StudyHub V1.0 — Migration 0003: Functions, Triggers & Atomic Exam RPCs
-- 100% deterministic logic, immutable exam snapshots, idempotent scoring.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shared updated_at maintenance trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_user_preferences
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_folders
  BEFORE UPDATE ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_study_sets
  BEFORE UPDATE ON public.study_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_questions
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_user_question_progress
  BEFORE UPDATE ON public.user_question_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_exam_attempt_answers
  BEFORE UPDATE ON public.exam_attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_set_updated_at_friendships
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. handle_new_user() — creates profiles + user_preferences on signup
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_display_name text;
  v_username text;
BEGIN
  v_display_name := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', '')), '');
  IF v_display_name IS NULL THEN
    v_display_name := split_part(COALESCE(NEW.email, 'user'), '@', 1);
  END IF;

  v_username := lower(NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username', '')), ''));
  IF v_username IS NOT NULL AND v_username !~ '^[a-z0-9_]{3,30}$' THEN
    v_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    v_display_name,
    v_username,
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')), '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- Retry without username if requested username was already taken
    INSERT INTO public.profiles (id, email, display_name, username, avatar_url)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      v_display_name,
      NULL,
      NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')), '')
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 3. Automatic study_sets.question_count synchronization
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_study_set_question_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.study_sets
    SET question_count = question_count + 1
    WHERE id = NEW.study_set_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.study_sets
    SET question_count = GREATEST(0, question_count - 1)
    WHERE id = OLD.study_set_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_study_set_question_count
  AFTER INSERT OR DELETE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.sync_study_set_question_count();

-- ----------------------------------------------------------------------------
-- 4. Exam Snapshot Immutability Guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_exam_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'exam_attempt_questions rows are immutable and cannot be updated.';
END;
$$;

CREATE TRIGGER trg_prevent_exam_snapshot_update
  BEFORE UPDATE ON public.exam_attempt_questions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_exam_snapshot_update();

-- ----------------------------------------------------------------------------
-- 5. Safe Exact-Match User Lookup RPC (prevents user enumeration dumps)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_profile_by_username_or_email(p_query text)
RETURNS TABLE (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_clean text := lower(trim(COALESCE(p_query, '')));
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF char_length(v_clean) < 3 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.display_name, p.username, p.avatar_url
  FROM public.profiles p
  WHERE p.id <> v_caller
    AND (
      lower(p.username) = v_clean
      OR lower(p.email) = v_clean
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.status = 'blocked'
        AND (
          (f.requester_id = p.id AND f.addressee_id = v_caller)
          OR (f.requester_id = v_caller AND f.addressee_id = p.id)
        )
    )
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.find_profile_by_username_or_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_profile_by_username_or_email(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Deterministic Short-Answer Normalizer (SQL helper for submit_exam_attempt)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_short_answer(p_input text, p_mode text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text text;
  v_num numeric;
BEGIN
  v_text := regexp_replace(trim(COALESCE(p_input, '')), '\s+', ' ', 'g');

  IF p_mode = 'exact' THEN
    RETURN v_text;
  ELSIF p_mode = 'case_insensitive' THEN
    RETURN lower(v_text);
  ELSIF p_mode = 'ignore_diacritics' THEN
    v_text := lower(v_text);
    -- Vietnamese & common Latin diacritics normalization
    v_text := translate(
      v_text,
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'
    );
    v_text := regexp_replace(v_text, '^[.,;:!?''"()\[\]{}]+|[.,;:!?''"()\[\]{}]+$', '', 'g');
    RETURN regexp_replace(trim(v_text), '\s+', ' ', 'g');
  ELSIF p_mode = 'numeric' THEN
    v_text := replace(regexp_replace(v_text, '\s+', '', 'g'), ',', '.');
    BEGIN
      v_num := v_text::numeric;
      RETURN trim(trailing '.' FROM trim(trailing '0' FROM v_num::text));
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN lower(v_text);
    END;
  END IF;

  RETURN lower(v_text);
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_short_answer(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_short_answer(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Atomic & Idempotent Exam Submission RPC (docs/DATABASE.md §7)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_attempt public.exam_attempts%ROWTYPE;
  v_now timestamptz := now();
  v_final_status text;
  v_time_spent integer;
  v_q record;
  v_ans public.exam_attempt_answers%ROWTYPE;
  v_has_answer boolean;
  v_is_correct boolean;
  v_answered_count integer := 0;
  v_correct_count integer := 0;
  v_wrong_count integer := 0;
  v_unanswered_count integer := 0;
  v_score_percent numeric(5,2) := 0.00;
  v_passed boolean := false;
  v_selected_sorted uuid[];
  v_correct_sorted uuid[];
  v_acc jsonb;
  v_acc_mode text;
  v_acc_norm text;
  v_typed_norm text;
  v_existing_prog public.user_question_progress%ROWTYPE;
  v_new_reps integer;
  v_new_interval integer;
  v_new_ease numeric(4,2);
  v_new_consec integer;
  v_new_mastery text;
  v_result jsonb;
BEGIN
  -- 1. Lock attempt row exclusively to guarantee concurrency safety & idempotency
  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Verify caller owns this attempt (when invoked via authenticated JWT)
  IF v_caller IS NOT NULL AND v_attempt.user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- 3. Idempotency check: if already submitted/expired, return graded payload untouched
  IF v_attempt.status IN ('submitted', 'expired') THEN
    SELECT jsonb_build_object(
      'attempt', to_jsonb(v_attempt),
      'questions', COALESCE((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
        FROM public.exam_attempt_questions q
        WHERE q.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'answers', COALESCE((
        SELECT jsonb_agg(to_jsonb(a))
        FROM public.exam_attempt_answers a
        WHERE a.attempt_id = p_attempt_id
      ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- 4. Determine submitted vs expired using server clock
  IF v_attempt.expires_at IS NOT NULL AND v_now > v_attempt.expires_at THEN
    v_final_status := 'expired';
  ELSE
    v_final_status := 'submitted';
  END IF;

  -- 5. Compute server-side elapsed seconds
  v_time_spent := GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_attempt.started_at)))::integer);
  IF v_attempt.duration_limit_seconds IS NOT NULL THEN
    v_time_spent := LEAST(v_time_spent, v_attempt.duration_limit_seconds);
  END IF;

  -- 6. Grade every snapshot question deterministically
  FOR v_q IN
    SELECT *
    FROM public.exam_attempt_questions
    WHERE attempt_id = p_attempt_id
    ORDER BY position ASC
  LOOP
    SELECT * INTO v_ans
    FROM public.exam_attempt_answers
    WHERE attempt_id = p_attempt_id
      AND attempt_question_id = v_q.id;

    v_has_answer := false;
    v_is_correct := false;

    IF FOUND THEN
      IF v_q.question_type = 'short_answer' THEN
        v_has_answer := v_ans.typed_answer IS NOT NULL AND char_length(trim(v_ans.typed_answer)) > 0;
        IF v_has_answer THEN
          FOR v_acc IN SELECT * FROM jsonb_array_elements(COALESCE(v_q.accepted_answers_snapshot, '[]'::jsonb))
          LOOP
            v_acc_mode := COALESCE(v_acc->>'match_mode', 'case_insensitive');
            v_acc_norm := public.normalize_short_answer(COALESCE(v_acc->>'answer_text', v_acc->>'normalized_answer', ''), v_acc_mode);
            v_typed_norm := public.normalize_short_answer(v_ans.typed_answer, v_acc_mode);
            IF v_typed_norm = v_acc_norm AND char_length(v_acc_norm) > 0 THEN
              v_is_correct := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;
      ELSE
        -- Choice questions: grade strictly by stable option UUID set equality
        v_has_answer := COALESCE(array_length(v_ans.selected_option_ids, 1), 0) > 0;
        IF v_has_answer THEN
          SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
          INTO v_selected_sorted
          FROM unnest(v_ans.selected_option_ids) AS x;

          SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
          INTO v_correct_sorted
          FROM unnest(v_q.correct_option_ids) AS x;

          v_is_correct := (array_length(v_correct_sorted, 1) > 0 AND v_selected_sorted = v_correct_sorted);
        END IF;
      END IF;

      UPDATE public.exam_attempt_answers
      SET is_correct = CASE WHEN v_has_answer THEN v_is_correct ELSE false END,
          updated_at = v_now
      WHERE id = v_ans.id;
    END IF;

    IF v_has_answer THEN
      v_answered_count := v_answered_count + 1;
      IF v_is_correct THEN
        v_correct_count := v_correct_count + 1;
      ELSE
        v_wrong_count := v_wrong_count + 1;
      END IF;

      -- 8. Upsert user_question_progress using deterministic SM-2 rules when source question still exists
      IF v_q.question_id IS NOT NULL AND v_attempt.study_set_id IS NOT NULL THEN
        SELECT * INTO v_existing_prog
        FROM public.user_question_progress
        WHERE user_id = v_attempt.user_id
          AND question_id = v_q.question_id;

        IF NOT FOUND THEN
          IF v_is_correct THEN
            v_new_reps := 1;
            v_new_interval := 1;
            v_new_ease := 2.50;
            v_new_consec := 1;
            v_new_mastery := 'learning';
          ELSE
            v_new_reps := 0;
            v_new_interval := 1;
            v_new_ease := 2.30;
            v_new_consec := 0;
            v_new_mastery := 'learning';
          END IF;

          INSERT INTO public.user_question_progress (
            user_id, study_set_id, question_id, mastery_level,
            correct_count, wrong_count, consecutive_correct,
            ease_factor, interval_days, repetitions,
            last_reviewed_at, next_review_at
          ) VALUES (
            v_attempt.user_id, v_attempt.study_set_id, v_q.question_id, v_new_mastery,
            CASE WHEN v_is_correct THEN 1 ELSE 0 END,
            CASE WHEN v_is_correct THEN 0 ELSE 1 END,
            v_new_consec, v_new_ease, v_new_interval, v_new_reps,
            v_now, v_now + make_interval(days => v_new_interval)
          );
        ELSE
          IF v_is_correct THEN
            v_new_reps := v_existing_prog.repetitions + 1;
            v_new_consec := v_existing_prog.consecutive_correct + 1;
            v_new_ease := LEAST(4.00, GREATEST(1.30, v_existing_prog.ease_factor + 0.05));
            IF v_new_reps = 1 THEN
              v_new_interval := 1;
            ELSIF v_new_reps = 2 THEN
              v_new_interval := 6;
            ELSE
              v_new_interval := GREATEST(1, round(v_existing_prog.interval_days * v_new_ease)::integer);
            END IF;
            IF v_new_consec >= 4 AND v_new_interval >= 14 THEN
              v_new_mastery := 'mastered';
            ELSIF v_new_consec >= 2 THEN
              v_new_mastery := 'familiar';
            ELSE
              v_new_mastery := 'learning';
            END IF;
          ELSE
            v_new_reps := 0;
            v_new_consec := 0;
            v_new_ease := GREATEST(1.30, v_existing_prog.ease_factor - 0.20);
            v_new_interval := 1;
            v_new_mastery := 'learning';
          END IF;

          UPDATE public.user_question_progress
          SET mastery_level = v_new_mastery,
              correct_count = v_existing_prog.correct_count + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
              wrong_count = v_existing_prog.wrong_count + CASE WHEN v_is_correct THEN 0 ELSE 1 END,
              consecutive_correct = v_new_consec,
              ease_factor = v_new_ease,
              interval_days = v_new_interval,
              repetitions = v_new_reps,
              last_reviewed_at = v_now,
              next_review_at = v_now + make_interval(days => v_new_interval),
              updated_at = v_now
          WHERE id = v_existing_prog.id;
        END IF;
      END IF;
    ELSE
      v_unanswered_count := v_unanswered_count + 1;
    END IF;
  END LOOP;

  -- 7. Finalize exam_attempts score & status
  IF v_attempt.total_questions > 0 THEN
    v_score_percent := round((v_correct_count::numeric * 100.0) / v_attempt.total_questions::numeric, 2);
  END IF;
  v_passed := v_score_percent >= v_attempt.pass_threshold;

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

  IF v_attempt.study_set_id IS NOT NULL THEN
    UPDATE public.study_sets
    SET last_studied_at = v_now
    WHERE id = v_attempt.study_set_id;
  END IF;

  -- 9. Return complete graded payload (answers & explanations now unlocked)
  SELECT jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'questions', COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
      FROM public.exam_attempt_questions q
      WHERE q.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'answers', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.exam_attempt_answers a
      WHERE a.attempt_id = p_attempt_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Server-Clock Atomic Exam Attempt Creation RPC
-- Enforces read access, server clock started_at/expires_at, and returns
-- sanitized pre-submit payload (ZERO answer/explanation disclosure).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_exam_attempt(
  p_study_set_id uuid,
  p_title_snapshot text,
  p_config jsonb,
  p_duration_limit_seconds integer,
  p_pass_threshold integer,
  p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_total integer;
  v_attempt public.exam_attempts%ROWTYPE;
  v_item jsonb;
  v_pos integer := 0;
  v_correct_ids uuid[];
  v_sanitized_questions jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_read_study_set(p_study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RAISE EXCEPTION 'Questions snapshot array is required' USING ERRCODE = '22023';
  END IF;

  v_total := jsonb_array_length(p_questions);
  IF v_total <= 0 OR v_total > 500 THEN
    RAISE EXCEPTION 'Exam must contain between 1 and 500 questions' USING ERRCODE = '22023';
  END IF;

  IF p_duration_limit_seconds IS NOT NULL AND p_duration_limit_seconds > 0 THEN
    v_expires_at := v_now + make_interval(secs => p_duration_limit_seconds);
  ELSE
    v_expires_at := NULL;
  END IF;

  INSERT INTO public.exam_attempts (
    user_id,
    study_set_id,
    study_set_title_snapshot,
    status,
    config,
    total_questions,
    unanswered_count,
    pass_threshold,
    duration_limit_seconds,
    started_at,
    expires_at
  ) VALUES (
    v_caller,
    p_study_set_id,
    p_title_snapshot,
    'in_progress',
    COALESCE(p_config, '{}'::jsonb),
    v_total,
    v_total,
    GREATEST(1, LEAST(100, COALESCE(p_pass_threshold, 70))),
    p_duration_limit_seconds,
    v_now,
    v_expires_at
  )
  RETURNING * INTO v_attempt;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[])
    INTO v_correct_ids
    FROM jsonb_array_elements_text(COALESCE(v_item->'correct_option_ids', '[]'::jsonb)) AS x;

    INSERT INTO public.exam_attempt_questions (
      attempt_id,
      question_id,
      position,
      question_type,
      chapter_snapshot,
      prompt_snapshot,
      prompt_image_url_snapshot,
      explanation_snapshot,
      options_snapshot,
      correct_option_ids,
      accepted_answers_snapshot
    ) VALUES (
      v_attempt.id,
      NULLIF(v_item->>'question_id', '')::uuid,
      v_pos,
      v_item->>'question_type',
      v_item->>'chapter_snapshot',
      v_item->>'prompt_snapshot',
      v_item->>'prompt_image_url_snapshot',
      v_item->>'explanation_snapshot',
      COALESCE(v_item->'options_snapshot', '[]'::jsonb),
      v_correct_ids,
      COALESCE(v_item->'accepted_answers_snapshot', '[]'::jsonb)
    );

    v_pos := v_pos + 1;
  END LOOP;

  -- Strictly strip correct_option_ids, accepted_answers_snapshot, explanation_snapshot
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'attempt_id', q.attempt_id,
        'question_id', q.question_id,
        'position', q.position,
        'question_type', q.question_type,
        'chapter_snapshot', q.chapter_snapshot,
        'prompt_snapshot', q.prompt_snapshot,
        'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
        'options_snapshot', q.options_snapshot,
        'created_at', q.created_at
      )
      ORDER BY q.position ASC
    ),
    '[]'::jsonb
  )
  INTO v_sanitized_questions
  FROM public.exam_attempt_questions q
  WHERE q.attempt_id = v_attempt.id;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'questions', v_sanitized_questions,
    'answers', '[]'::jsonb,
    'server_now', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_attempt(uuid, text, jsonb, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_exam_attempt(uuid, text, jsonb, integer, integer, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Safe Exam Attempt Detail RPC (Anti-Leak Pre-Submit, Full Post-Submit)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_exam_attempt_detail(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_attempt public.exam_attempts%ROWTYPE;
  v_questions jsonb;
  v_answers jsonb;
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

  IF v_attempt.status IN ('submitted', 'expired') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.position ASC), '[]'::jsonb)
    INTO v_questions
    FROM public.exam_attempt_questions q
    WHERE q.attempt_id = p_attempt_id;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'attempt_id', q.attempt_id,
          'question_id', q.question_id,
          'position', q.position,
          'question_type', q.question_type,
          'chapter_snapshot', q.chapter_snapshot,
          'prompt_snapshot', q.prompt_snapshot,
          'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
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

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'questions', v_questions,
    'answers', v_answers,
    'server_now', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_attempt_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_attempt_detail(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Share Link Preview & Redeem RPCs (No Token Enumeration)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_share_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.study_set_share_links%ROWTYPE;
  v_set public.study_sets%ROWTYPE;
  v_owner_name text;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 16 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link
  FROM public.study_set_share_links
  WHERE token = p_token
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_set
  FROM public.study_sets
  WHERE id = v_link.study_set_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT display_name INTO v_owner_name
  FROM public.profiles
  WHERE id = v_set.owner_id;

  RETURN jsonb_build_object(
    'link_id', v_link.id,
    'study_set_id', v_set.id,
    'title', v_set.title,
    'description', v_set.description,
    'subject', v_set.subject,
    'set_type', v_set.set_type,
    'question_count', v_set.question_count,
    'owner_name', COALESCE(v_owner_name, 'StudyHub User'),
    'permission', v_link.permission,
    'allow_clone', v_link.allow_clone,
    'expires_at', v_link.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_share_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_share_link(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.redeem_share_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_link public.study_set_share_links%ROWTYPE;
  v_set public.study_sets%ROWTYPE;
  v_existing_role text;
  v_granted_role text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link
  FROM public.study_set_share_links
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'NOT_FOUND');
  END IF;

  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error_code', 'REVOKED');
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('error_code', 'EXPIRED');
  END IF;

  SELECT * INTO v_set
  FROM public.study_sets
  WHERE id = v_link.study_set_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'NOT_FOUND');
  END IF;

  IF v_set.owner_id = v_caller THEN
    v_granted_role := 'owner';
  ELSE
    SELECT role INTO v_existing_role
    FROM public.study_set_members
    WHERE study_set_id = v_set.id
      AND user_id = v_caller;

    IF v_existing_role IS NULL THEN
      INSERT INTO public.study_set_members (study_set_id, user_id, role, invited_by)
      VALUES (v_set.id, v_caller, v_link.permission, v_link.created_by);
      v_granted_role := v_link.permission;
    ELSIF v_existing_role = 'viewer' AND v_link.permission = 'editor' THEN
      UPDATE public.study_set_members
      SET role = 'editor'
      WHERE study_set_id = v_set.id
        AND user_id = v_caller;
      v_granted_role := 'editor';
    ELSE
      v_granted_role := v_existing_role;
    END IF;

    UPDATE public.study_set_share_links
    SET use_count = use_count + 1
    WHERE id = v_link.id;
  END IF;

  RETURN jsonb_build_object(
    'study_set_id', v_set.id,
    'title', v_set.title,
    'role', v_granted_role,
    'allow_clone', v_link.allow_clone
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_share_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_share_link(text) TO authenticated;

