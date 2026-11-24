-- ============================================================================
-- StudyHub V3.0 — Migration 0015: Deterministic 12-Type Server Grading,
-- V3 Exam/Clone RPC Upgrades, Scoped Progress Reset, Global Library Search
-- & Idempotent Offline Sync RPC
-- ============================================================================
-- 100% additive, backward-compatible, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies migrations 0001–0012. ZERO DROP POLICY, ZERO DROP TRIGGER.
-- ZERO AI logic: 100% deterministic PostgreSQL grading, search & sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pure Deterministic Geometry, Pre-Submit Anti-Leak & 12-Type Grading Helpers
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.point_in_hotspot(
  p_x numeric,
  p_y numeric,
  p_shape text,
  p_geometry jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_gx numeric;
  v_gy numeric;
  v_gw numeric;
  v_gh numeric;
  v_r numeric;
  v_pts jsonb;
  v_n integer;
  v_i integer;
  v_j integer;
  v_xi numeric;
  v_yi numeric;
  v_xj numeric;
  v_yj numeric;
  v_inside boolean := false;
  v_cross numeric;
  v_dot numeric;
  v_len_sq numeric;
  v_eps numeric := 0.000001;
BEGIN
  IF p_x IS NULL OR p_y IS NULL OR p_geometry IS NULL THEN
    RETURN false;
  END IF;

  IF p_x < 0 OR p_x > 1 OR p_y < 0 OR p_y > 1 THEN
    RETURN false;
  END IF;

  IF p_shape = 'point' THEN
    v_gx := (p_geometry->>'x')::numeric;
    v_gy := (p_geometry->>'y')::numeric;
    v_r := COALESCE((p_geometry->>'radius')::numeric, 0.04);
    IF v_gx IS NULL OR v_gy IS NULL OR v_r <= 0 THEN
      RETURN false;
    END IF;
    RETURN ((p_x - v_gx) * (p_x - v_gx) + (p_y - v_gy) * (p_y - v_gy)) <= (v_r * v_r);

  ELSIF p_shape = 'rect' THEN
    v_gx := (p_geometry->>'x')::numeric;
    v_gy := (p_geometry->>'y')::numeric;
    v_gw := (p_geometry->>'width')::numeric;
    v_gh := (p_geometry->>'height')::numeric;
    IF v_gx IS NULL OR v_gy IS NULL OR v_gw IS NULL OR v_gh IS NULL OR v_gw < 0 OR v_gh < 0 THEN
      RETURN false;
    END IF;
    RETURN p_x >= v_gx AND p_x <= (v_gx + v_gw) AND p_y >= v_gy AND p_y <= (v_gy + v_gh);

  ELSIF p_shape = 'polygon' THEN
    v_pts := p_geometry->'points';
    IF v_pts IS NULL OR jsonb_typeof(v_pts) <> 'array' THEN
      RETURN false;
    END IF;
    v_n := jsonb_array_length(v_pts);
    IF v_n < 3 THEN
      RETURN false;
    END IF;

    v_j := v_n - 1;
    FOR v_i IN 0..(v_n - 1) LOOP
      v_xi := (v_pts->v_i->>'x')::numeric;
      v_yi := (v_pts->v_i->>'y')::numeric;
      v_xj := (v_pts->v_j->>'x')::numeric;
      v_yj := (v_pts->v_j->>'y')::numeric;

      IF v_xi IS NULL OR v_yi IS NULL OR v_xj IS NULL OR v_yj IS NULL THEN
        RETURN false;
      END IF;

      -- Inclusive boundary segment check
      v_cross := abs((p_y - v_yi) * (v_xj - v_xi) - (p_x - v_xi) * (v_yj - v_yi));
      IF v_cross <= v_eps THEN
        v_dot := (p_x - v_xi) * (v_xj - v_xi) + (p_y - v_yi) * (v_yj - v_yi);
        v_len_sq := (v_xj - v_xi) * (v_xj - v_xi) + (v_yj - v_yi) * (v_yj - v_yi);
        IF v_dot >= -v_eps AND v_dot <= (v_len_sq + v_eps) THEN
          RETURN true;
        END IF;
      END IF;

      -- Standard ray-casting parity flip
      IF ((v_yi > p_y) <> (v_yj > p_y))
         AND (p_x < ((v_xj - v_xi) * (p_y - v_yi) / NULLIF(v_yj - v_yi, 0) + v_xi)) THEN
        v_inside := NOT v_inside;
      END IF;

      v_j := v_i;
    END LOOP;

    RETURN v_inside;
  END IF;

  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.point_in_hotspot(numeric, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.point_in_hotspot(numeric, numeric, text, jsonb) TO authenticated;

-- Strips EVERY answer-revealing field from type_payload_snapshot while an exam is in_progress or discarded!
CREATE OR REPLACE FUNCTION public.sanitize_pre_submit_type_payload(
  p_question_type text,
  p_payload jsonb
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
      jsonb_build_object(
        'type', 'numerical',
        'unit_required', COALESCE((p_payload->>'unit_required')::boolean, false),
        'significant_figures', p_payload->'significant_figures'
      )
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
            -- Deterministic order by UUID so original correct_position order NEVER leaks pre-submit
            ORDER BY (it.val->>'id') ASC
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
          SELECT jsonb_agg(r.item ORDER BY (r.item->>'right_id') ASC)
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

REVOKE ALL ON FUNCTION public.sanitize_pre_submit_type_payload(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_pre_submit_type_payload(text, jsonb) TO authenticated;

-- Shared deterministic answered-status predicate used identically by save_exam_attempt_answers & submit_exam_attempt
CREATE OR REPLACE FUNCTION public.has_exam_answer(
  p_question_type text,
  p_selected_option_ids uuid[],
  p_typed_answer text,
  p_structured_response jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_question_type IN ('single_choice', 'multiple_choice', 'true_false', 'image_choice') THEN
      COALESCE(array_length(p_selected_option_ids, 1), 0) > 0
      OR (
        p_structured_response IS NOT NULL
        AND jsonb_typeof(p_structured_response->'selected_option_ids') = 'array'
        AND jsonb_array_length(p_structured_response->'selected_option_ids') > 0
      )
    WHEN p_question_type IN ('short_answer', 'numerical') THEN
      char_length(trim(COALESCE(p_structured_response->>'value', p_typed_answer, ''))) > 0
      OR (p_structured_response IS NOT NULL AND p_structured_response->>'numeric_value' IS NOT NULL)
    WHEN p_question_type = 'fill_in_blank' THEN
      p_structured_response IS NOT NULL
      AND jsonb_typeof(p_structured_response->'answers') = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each_text(p_structured_response->'answers') kv
        WHERE char_length(trim(kv.value)) > 0
      )
    WHEN p_question_type = 'ordering' THEN
      p_structured_response IS NOT NULL
      AND jsonb_typeof(p_structured_response->'ordered_item_ids') = 'array'
      AND jsonb_array_length(p_structured_response->'ordered_item_ids') > 0
    WHEN p_question_type = 'matching' THEN
      p_structured_response IS NOT NULL
      AND jsonb_typeof(p_structured_response->'pairs') = 'object'
      AND EXISTS (
        SELECT 1
        FROM jsonb_each_text(p_structured_response->'pairs') kv
        WHERE char_length(trim(kv.value)) > 0
      )
    WHEN p_question_type = 'image_hotspot' THEN
      p_structured_response IS NOT NULL
      AND jsonb_typeof(p_structured_response->'clicks') = 'array'
      AND jsonb_array_length(p_structured_response->'clicks') > 0
    ELSE
      -- reading_passage, listening, or any composite sub-answer type
      COALESCE(array_length(p_selected_option_ids, 1), 0) > 0
      OR char_length(trim(COALESCE(p_typed_answer, ''))) > 0
      OR (
        p_structured_response IS NOT NULL
        AND p_structured_response <> '{}'::jsonb
        AND (
          char_length(trim(COALESCE(p_structured_response->>'value', ''))) > 0
          OR (jsonb_typeof(p_structured_response->'selected_option_ids') = 'array'
              AND jsonb_array_length(p_structured_response->'selected_option_ids') > 0)
          OR (jsonb_typeof(p_structured_response->'answers') = 'object'
              AND EXISTS (SELECT 1 FROM jsonb_each_text(p_structured_response->'answers') kv WHERE char_length(trim(kv.value)) > 0))
        )
      )
  END;
$$;

REVOKE ALL ON FUNCTION public.has_exam_answer(text, uuid[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_exam_answer(text, uuid[], text, jsonb) TO authenticated;

-- Complete deterministic server-side grader covering ALL 12 V3 exam question types!
CREATE OR REPLACE FUNCTION public.grade_v3_exam_answer(
  p_question_type text,
  p_correct_option_ids uuid[],
  p_accepted_answers jsonb,
  p_type_payload jsonb,
  p_selected_option_ids uuid[],
  p_typed_answer text,
  p_structured_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_sel uuid[];
  v_correct uuid[] := COALESCE(p_correct_option_ids, '{}'::uuid[]);
  v_sub_kind text;
  v_typed text;
  v_blank jsonb;
  v_blank_id text;
  v_blank_user text;
  v_blank_mode text;
  v_blank_ok boolean;
  v_user_num_str text;
  v_user_num numeric;
  v_target_num numeric;
  v_abs_tol numeric;
  v_rel_tol numeric;
  v_max_tol numeric;
  v_unit_req boolean;
  v_expected_unit text;
  v_user_unit text;
  v_unit_ok boolean;
  v_expected_order text[];
  v_user_order text[];
  v_pair jsonb;
  v_user_right text;
  v_target jsonb;
  v_click jsonb;
  v_hit boolean;
  v_all_hit boolean;
  v_clicks jsonb;
  v_targets jsonb;
  v_req_all boolean;
BEGIN
  -- Normalize selected option UUIDs from either column or structured_response
  IF COALESCE(array_length(p_selected_option_ids, 1), 0) > 0 THEN
    v_sel := p_selected_option_ids;
  ELSIF p_structured_response IS NOT NULL
        AND jsonb_typeof(p_structured_response->'selected_option_ids') = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[])
    INTO v_sel
    FROM jsonb_array_elements_text(p_structured_response->'selected_option_ids') AS x;
  ELSE
    v_sel := '{}'::uuid[];
  END IF;

  -- Resolve effective grading type for composite reading_passage / listening types
  IF p_question_type IN ('reading_passage', 'listening') THEN
    v_sub_kind := COALESCE(
      NULLIF(p_type_payload->>'sub_answer_kind', ''),
      CASE WHEN array_length(v_correct, 1) > 1 THEN 'multiple_choice'
           WHEN array_length(v_correct, 1) = 1 THEN 'single_choice'
           ELSE 'short_answer' END
    );
    RETURN public.grade_v3_exam_answer(
      v_sub_kind,
      v_correct,
      p_accepted_answers,
      p_type_payload,
      v_sel,
      p_typed_answer,
      p_structured_response
    );
  END IF;

  -- 1. Single Choice & True/False (strictly 1 UUID; multi-selection rejected)
  IF p_question_type IN ('single_choice', 'true_false') THEN
    RETURN array_length(v_sel, 1) = 1
       AND array_length(v_correct, 1) = 1
       AND v_sel[1] = v_correct[1];

  -- 2. Multiple Choice (exact UUID set match)
  ELSIF p_question_type = 'multiple_choice' THEN
    RETURN array_length(v_correct, 1) > 0
       AND array_length(v_sel, 1) = array_length(v_correct, 1)
       AND v_sel @> v_correct
       AND v_correct @> v_sel;

  -- 3. Image Choice (single or multiple by payload selection_mode)
  ELSIF p_question_type = 'image_choice' THEN
    IF COALESCE(p_type_payload->>'selection_mode', CASE WHEN array_length(v_correct, 1) > 1 THEN 'multiple' ELSE 'single' END) = 'multiple' THEN
      RETURN array_length(v_correct, 1) > 0
         AND array_length(v_sel, 1) = array_length(v_correct, 1)
         AND v_sel @> v_correct
         AND v_correct @> v_sel;
    ELSE
      RETURN array_length(v_sel, 1) = 1
         AND array_length(v_correct, 1) = 1
         AND v_sel[1] = v_correct[1];
    END IF;

  -- 4. Short Answer (deterministic normalization parity with write-grader.ts)
  ELSIF p_question_type = 'short_answer' THEN
    v_typed := COALESCE(p_structured_response->>'value', p_typed_answer, '');
    IF char_length(trim(v_typed)) = 0 THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_accepted_answers, '[]'::jsonb)) AS acc
      WHERE public.normalize_short_answer(v_typed, COALESCE(acc->>'match_mode', 'case_insensitive'))
            = public.normalize_short_answer(COALESCE(acc->>'answer_text', ''), COALESCE(acc->>'match_mode', 'case_insensitive'))
        AND public.normalize_short_answer(COALESCE(acc->>'answer_text', ''), COALESCE(acc->>'match_mode', 'case_insensitive')) <> ''
    );

  -- 5. Fill-in-the-Blank (every blank must match at least one accepted answer)
  ELSIF p_question_type = 'fill_in_blank' THEN
    IF p_type_payload IS NULL OR jsonb_typeof(p_type_payload->'blanks') <> 'array'
       OR jsonb_array_length(p_type_payload->'blanks') = 0
       OR p_structured_response IS NULL
       OR jsonb_typeof(p_structured_response->'answers') <> 'object' THEN
      RETURN false;
    END IF;

    FOR v_blank IN SELECT * FROM jsonb_array_elements(p_type_payload->'blanks') LOOP
      v_blank_id := v_blank->>'blank_id';
      v_blank_user := COALESCE(p_structured_response->'answers'->>v_blank_id, '');
      IF char_length(trim(v_blank_user)) = 0 THEN
        RETURN false;
      END IF;
      v_blank_mode := COALESCE(
        NULLIF(v_blank->>'match_mode', ''),
        CASE WHEN COALESCE((v_blank->>'case_sensitive')::boolean, false) THEN 'exact' ELSE 'case_insensitive' END
      );

      SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(v_blank->'accepted_answers', '[]'::jsonb)) AS acc_txt
        WHERE public.normalize_short_answer(v_blank_user, v_blank_mode)
              = public.normalize_short_answer(acc_txt, v_blank_mode)
          AND public.normalize_short_answer(acc_txt, v_blank_mode) <> ''
      ) INTO v_blank_ok;

      IF NOT v_blank_ok THEN
        RETURN false;
      END IF;
    END LOOP;

    RETURN true;

  -- 6. Numerical (absolute & relative tolerance + exact unit check + 0/10/100/-0.5 safety)
  ELSIF p_question_type = 'numerical' THEN
    IF p_type_payload IS NULL OR p_type_payload->>'correct_value' IS NULL THEN
      RETURN false;
    END IF;

    BEGIN
      v_target_num := (p_type_payload->>'correct_value')::numeric;
      IF p_structured_response IS NOT NULL AND p_structured_response->>'numeric_value' IS NOT NULL THEN
        v_user_num := (p_structured_response->>'numeric_value')::numeric;
      ELSE
        v_user_num_str := replace(regexp_replace(trim(COALESCE(p_structured_response->>'value', p_typed_answer, '')), '\s+', '', 'g'), ',', '.');
        IF v_user_num_str = '' THEN
          RETURN false;
        END IF;
        v_user_num := v_user_num_str::numeric;
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN false;
    END;

    v_abs_tol := GREATEST(0, COALESCE((p_type_payload->>'abs_tolerance')::numeric, 0));
    v_rel_tol := GREATEST(0, COALESCE((p_type_payload->>'rel_tolerance')::numeric, 0));
    v_max_tol := GREATEST(v_abs_tol, v_rel_tol * abs(v_target_num));

    IF abs(v_user_num - v_target_num) > v_max_tol THEN
      RETURN false;
    END IF;

    v_unit_req := COALESCE((p_type_payload->>'unit_required')::boolean, false);
    v_expected_unit := NULLIF(trim(COALESCE(p_type_payload->>'unit', '')), '');
    v_user_unit := NULLIF(trim(COALESCE(p_structured_response->>'unit', '')), '');

    IF v_unit_req OR (v_expected_unit IS NOT NULL AND v_user_unit IS NOT NULL) THEN
      IF v_user_unit IS NULL THEN
        RETURN false;
      END IF;
      v_unit_ok := (v_expected_unit IS NOT NULL AND lower(v_user_unit) = lower(v_expected_unit))
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(p_type_payload->'accepted_units', '[]'::jsonb)) AS u
          WHERE lower(trim(u)) = lower(v_user_unit)
        );
      IF NOT v_unit_ok THEN
        RETURN false;
      END IF;
    END IF;

    RETURN true;

  -- 7. Ordering (exact sequence of item IDs matching correct_position order)
  ELSIF p_question_type = 'ordering' THEN
    IF p_type_payload IS NULL OR jsonb_typeof(p_type_payload->'items') <> 'array'
       OR p_structured_response IS NULL
       OR jsonb_typeof(p_structured_response->'ordered_item_ids') <> 'array' THEN
      RETURN false;
    END IF;

    SELECT array_agg(it.val->>'id' ORDER BY COALESCE((it.val->>'correct_position')::integer, 0) ASC, (it.val->>'id') ASC)
    INTO v_expected_order
    FROM jsonb_array_elements(p_type_payload->'items') AS it(val);

    SELECT array_agg(u.val ORDER BY u.ord ASC)
    INTO v_user_order
    FROM jsonb_array_elements_text(p_structured_response->'ordered_item_ids') WITH ORDINALITY AS u(val, ord);

    RETURN v_expected_order IS NOT NULL
       AND array_length(v_expected_order, 1) > 0
       AND v_user_order = v_expected_order;

  -- 8. Matching (exact left_id -> right_id mapping for all pairs)
  ELSIF p_question_type = 'matching' THEN
    IF p_type_payload IS NULL OR jsonb_typeof(p_type_payload->'pairs') <> 'array'
       OR jsonb_array_length(p_type_payload->'pairs') = 0
       OR p_structured_response IS NULL
       OR jsonb_typeof(p_structured_response->'pairs') <> 'object' THEN
      RETURN false;
    END IF;

    FOR v_pair IN SELECT * FROM jsonb_array_elements(p_type_payload->'pairs') LOOP
      v_user_right := p_structured_response->'pairs'->>(v_pair->>'id');
      IF v_user_right IS NULL OR v_user_right <> (v_pair->>'right_id') THEN
        RETURN false;
      END IF;
    END LOOP;

    RETURN true;

  -- 9. Image Hotspot (normalized [0,1] point/rect/polygon deterministic check)
  ELSIF p_question_type = 'image_hotspot' THEN
    v_targets := p_type_payload->'target_hotspots';
    v_clicks := p_structured_response->'clicks';
    IF v_targets IS NULL OR jsonb_typeof(v_targets) <> 'array' OR jsonb_array_length(v_targets) = 0
       OR v_clicks IS NULL OR jsonb_typeof(v_clicks) <> 'array' OR jsonb_array_length(v_clicks) = 0 THEN
      RETURN false;
    END IF;

    v_req_all := COALESCE((p_type_payload->>'require_all_targets')::boolean, false);

    IF v_req_all THEN
      -- Every target must be hit AND every click must land inside at least one target
      v_all_hit := true;
      FOR v_target IN SELECT * FROM jsonb_array_elements(v_targets) LOOP
        v_hit := false;
        FOR v_click IN SELECT * FROM jsonb_array_elements(v_clicks) LOOP
          IF public.point_in_hotspot(
            (v_click->>'x')::numeric,
            (v_click->>'y')::numeric,
            v_target->>'shape',
            v_target->'geometry'
          ) THEN
            v_hit := true;
            EXIT;
          END IF;
        END LOOP;
        IF NOT v_hit THEN
          v_all_hit := false;
          EXIT;
        END IF;
      END LOOP;

      IF NOT v_all_hit THEN
        RETURN false;
      END IF;

      -- Reject click-spam outside targets
      FOR v_click IN SELECT * FROM jsonb_array_elements(v_clicks) LOOP
        v_hit := false;
        FOR v_target IN SELECT * FROM jsonb_array_elements(v_targets) LOOP
          IF public.point_in_hotspot(
            (v_click->>'x')::numeric,
            (v_click->>'y')::numeric,
            v_target->>'shape',
            v_target->'geometry'
          ) THEN
            v_hit := true;
            EXIT;
          END IF;
        END LOOP;
        IF NOT v_hit THEN
          RETURN false;
        END IF;
      END LOOP;

      RETURN true;
    ELSE
      -- Single-target mode: at least 1 click and EVERY submitted click hits a target
      FOR v_click IN SELECT * FROM jsonb_array_elements(v_clicks) LOOP
        v_hit := false;
        FOR v_target IN SELECT * FROM jsonb_array_elements(v_targets) LOOP
          IF public.point_in_hotspot(
            (v_click->>'x')::numeric,
            (v_click->>'y')::numeric,
            v_target->>'shape',
            v_target->'geometry'
          ) THEN
            v_hit := true;
            EXIT;
          END IF;
        END LOOP;
        IF NOT v_hit THEN
          RETURN false;
        END IF;
      END LOOP;
      RETURN true;
    END IF;
  END IF;

  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.grade_v3_exam_answer(text, uuid[], jsonb, jsonb, uuid[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_v3_exam_answer(text, uuid[], jsonb, jsonb, uuid[], text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Upgraded create_exam_attempt_v2 — Captures V3 Rich/Media/Passage/Diagram/Payload
--    Snapshots + Protects Snapshot Media via content_media_relations (ON DELETE RESTRICT)
--    + Strips All Pre-Submit Answer Keys Across All 12 Question Types!
-- ----------------------------------------------------------------------------
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

  -- Set-based V3 snapshot insertion strictly from DB tables
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
        qo.id,
        qo.content,
        qo.content_rich,
        qo.image_url,
        qo.media_id,
        qo.image_alt,
        qo.is_correct,
        qo.position,
        row_number() OVER (
          ORDER BY
            COALESCE(
              (
                SELECT (ord_idx - 1)
                FROM jsonb_array_elements_text(os.opt_order) WITH ORDINALITY AS u(uid, ord_idx)
                WHERE u.uid = qo.id::text
                LIMIT 1
              ),
              100000 + qo.position
            ) ASC,
            qo.position ASC,
            qo.id ASC
        )::integer AS row_ord
      FROM public.question_options qo
      WHERE qo.question_id = os.question_id
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

  -- Bind snapshot media to exam_attempt_question so ON DELETE RESTRICT protects referenced media!
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
    AND NULLIF(eaq.diagram_snapshot->>'base_media_id', '') IS NOT NULL
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
    AND NULLIF(eaq.passage_snapshot->>'audio_media_id', '') IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Build SAFE pre-submit question array (ZERO answer keys, sanitized V3 type_payload!)
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
        'type_payload_snapshot', public.sanitize_pre_submit_type_payload(q.question_type, q.type_payload_snapshot),
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

-- ----------------------------------------------------------------------------
-- 3. Upgraded save_exam_attempt_answers — Persists structured_response, confidence, hint_used
--    and computes live answered_count across all 12 V3 question types
-- ----------------------------------------------------------------------------
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
  v_sel uuid[];
  v_typed text;
  v_structured jsonb;
  v_confidence text;
  v_hint_used boolean;
  v_flagged boolean;
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

    IF NOT EXISTS (
      SELECT 1
      FROM public.exam_attempt_questions eq
      WHERE eq.id = v_q_id AND eq.attempt_id = p_attempt_id
    ) THEN
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

  SELECT count(*)::integer INTO v_answered_count
  FROM public.exam_attempt_answers a
  JOIN public.exam_attempt_questions q ON q.id = a.attempt_question_id
  WHERE a.attempt_id = p_attempt_id
    AND public.has_exam_answer(q.question_type, a.selected_option_ids, a.typed_answer, a.structured_response);

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
-- 4. Upgraded get_exam_attempt_detail — Returns Sanitized V3 Payloads Pre-Submit
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
          'type_payload_snapshot', public.sanitize_pre_submit_type_payload(q.question_type, q.type_payload_snapshot),
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
-- 5. Upgraded submit_exam_attempt — 12-Type Server Grading + Confidence Telemetry
--    (STRICT RULE: Confidence NEVER alters exam score or pass/fail!)
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

  -- Zero-temp-table set-based deterministic 12-type grading stored in jsonb (PgBouncer-safe!)
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

  -- Persist graded is_correct in ONE set-based UPDATE
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

  -- Compute aggregate totals strictly from correctness (NEVER altered by confidence!)
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

  -- Record confidence events when learner explicitly selected confidence
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

  -- Set-based SM-2 + V3 confidence/mistake/recall upsert into user_question_progress
  WITH eligible AS (
    SELECT
      g.question_id,
      g.resolved_study_set_id AS study_set_id,
      g.is_correct,
      g.confidence,
      g.hint_used,
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
  computed AS (
    SELECT
      e.question_id,
      e.study_set_id,
      e.is_correct,
      e.confidence,
      e.hint_used,
      e.prev_correct + CASE WHEN e.is_correct THEN 1 ELSE 0 END AS next_correct,
      e.prev_wrong + CASE WHEN e.is_correct THEN 0 ELSE 1 END AS next_wrong,
      CASE WHEN e.is_correct THEN e.prev_streak + 1 ELSE 0 END AS next_streak,
      CASE WHEN e.is_correct THEN 0 ELSE e.prev_wrong_streak + 1 END AS next_wrong_streak,
      CASE WHEN e.is_correct THEN e.prev_reps + 1 ELSE 0 END AS next_reps,
      CASE
        WHEN e.is_correct THEN
          CASE
            WHEN e.prev_reps = 0 THEN 1
            WHEN e.prev_reps = 1 THEN 6
            ELSE GREATEST(1, round(GREATEST(1, e.prev_interval) * e.prev_ef)::integer)
          END
        ELSE 1
      END AS next_interval,
      CASE
        WHEN e.is_correct THEN round(GREATEST(1.30, LEAST(4.00, e.prev_ef)), 2)
        ELSE round(GREATEST(1.30, e.prev_ef - 0.32), 2)
      END AS next_ef,
      CASE WHEN e.is_correct THEN e.prev_last_wrong_at ELSE v_now END AS next_last_wrong_at,
      e.prev_low_conf + CASE WHEN e.confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END AS next_low_conf,
      e.prev_high_conf_wrong + CASE WHEN NOT e.is_correct AND e.confidence = 'certain' THEN 1 ELSE 0 END AS next_high_conf_wrong,
      e.prev_guess_correct + CASE WHEN e.is_correct AND e.confidence = 'guessing' THEN 1 ELSE 0 END AS next_guess_correct,
      e.prev_indep + CASE WHEN e.is_correct AND NOT e.hint_used THEN 1 ELSE 0 END AS next_indep,
      e.prev_hints + CASE WHEN e.hint_used THEN 1 ELSE 0 END AS next_hints
    FROM eligible e
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
-- 6. Upgraded clone_study_set — Clones V3 Rich Text, Payloads, Passages, Diagrams & Hotspots
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

  -- Zero-temp-table 1:1 UUID maps in jsonb (PgBouncer-safe!)
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

  -- Clone diagram_sets & diagram_hotspots with 1:1 UUID map
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

  -- Clone questions with ranked subquery (zero window-in-aggregate!)
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
    m.new_id, v_new_set.id, q.question_type, m.new_pos, q.chapter, q.prompt, q.prompt_rich,
    q.prompt_image_url, q.back_text, q.back_rich, q.back_image_url, q.explanation,
    q.explanation_rich, q.hint, q.hint_rich, q.audio_media_id, q.audio_url, q.audio_transcript,
    pm.new_id, dm.new_id, q.type_payload, q.difficulty, q.source_metadata
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.questions q ON q.id = m.old_id
  LEFT JOIN jsonb_to_recordset(v_pmap) AS pm(old_id uuid, new_id uuid) ON pm.old_id = q.passage_id
  LEFT JOIN jsonb_to_recordset(v_dmap) AS dm(old_id uuid, new_id uuid) ON dm.old_id = q.diagram_id;

  GET DIAGNOSTICS v_copied_q = ROW_COUNT;

  INSERT INTO public.question_options (
    question_id, study_set_id, position, label, content, content_rich,
    image_url, media_id, image_alt, is_correct
  )
  SELECT
    m.new_id, v_new_set.id, o.position, o.label, o.content, o.content_rich,
    o.image_url, o.media_id, o.image_alt, o.is_correct
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.question_options o ON o.question_id = m.old_id
  ORDER BY m.new_pos ASC, o.position ASC;

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

  -- Link cloned questions, passages & diagrams to referenced media_assets cleanly
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT cmr.media_id, 'question', m.new_id, cmr.role, cmr.sort_order, cmr.alt_text, cmr.caption
  FROM jsonb_to_recordset(v_qmap) AS m(old_id uuid, new_id uuid, new_pos integer)
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question' AND cmr.entity_id = m.old_id
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
-- 7. NEW RPC: public.reset_learning_progress() — Scoped Reset, Bumps progress_generation,
--    STRICTLY PRESERVES exam_attempts History & All Study Content!
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

  -- Upsert & bump user_preferences.progress_generation so stale offline sync events get ignored cleanly
  INSERT INTO public.user_preferences (user_id, progress_generation, updated_at)
  VALUES (v_caller, 2, v_now)
  ON CONFLICT (user_id) DO UPDATE
  SET progress_generation = public.user_preferences.progress_generation + 1,
      updated_at = v_now
  RETURNING progress_generation INTO v_new_gen;

  IF p_scope = 'mode' THEN
    -- Mode-scoped reset clears ONLY checkpoints & confidence events for that mode (preserves exams & content)
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

  -- Resolve target progress rows strictly owned by v_caller
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
    DELETE FROM public.user_question_progress uqp
    USING public.study_sets s
    WHERE uqp.user_id = v_caller
      AND uqp.study_set_id = s.id
      AND lower(trim(COALESCE(s.subject, ''))) = lower(trim(p_subject))
      AND (COALESCE(p_clear_mistakes, true) OR uqp.wrong_count = 0);
    GET DIAGNOSTICS v_reset_progress = ROW_COUNT;

    IF COALESCE(p_clear_checkpoints, true) THEN
      DELETE FROM public.learning_session_checkpoints lsc
      USING public.study_sets s
      WHERE lsc.user_id = v_caller
        AND lsc.study_set_id = s.id
        AND lower(trim(COALESCE(s.subject, ''))) = lower(trim(p_subject));
      GET DIAGNOSTICS v_cleared_checkpoints = ROW_COUNT;
    END IF;

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions sq
      USING public.study_sets s
      WHERE sq.user_id = v_caller
        AND sq.study_set_id = s.id
        AND lower(trim(COALESCE(s.subject, ''))) = lower(trim(p_subject));
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

    IF COALESCE(p_clear_starred, false) THEN
      DELETE FROM public.starred_questions
      WHERE user_id = v_caller AND question_id = ANY(p_question_ids);
      GET DIAGNOSTICS v_cleared_starred = ROW_COUNT;
    END IF;
  END IF;

  -- NOTE: exam_attempts, study_sets, questions, diagrams, and user_question_notes are NEVER deleted!
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
-- 8. NEW RPC: public.global_library_search() — Deterministic Multi-Entity Search
--    Strictly enforces RLS/ownership; private notes ONLY from caller!
-- ----------------------------------------------------------------------------
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
  v_clean text;
  v_escaped text;
  v_like text;
  v_prefix_like text;
  v_limit integer;
  v_offset integer;
  v_types text[];
  v_items jsonb;
  v_counts jsonb;
  v_total integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_clean := trim(regexp_replace(COALESCE(p_query, ''), '\s+', ' ', 'g'));
  IF char_length(v_clean) < 1 THEN
    RETURN jsonb_build_object(
      'query', '',
      'items', '[]'::jsonb,
      'counts_by_type', '{}'::jsonb,
      'total', 0
    );
  END IF;

  v_clean := left(v_clean, 120);
  -- Escape LIKE metacharacters deterministically
  v_escaped := replace(replace(replace(v_clean, '\', '\\'), '%', '\%'), '_', '\_');
  v_like := '%' || v_escaped || '%';
  v_prefix_like := lower(v_escaped) || '%';
  v_limit := GREATEST(1, LEAST(50, COALESCE(p_limit, 30)));
  v_offset := GREATEST(0, COALESCE(p_offset, 0));
  v_types := CASE
    WHEN p_types IS NULL OR cardinality(p_types) = 0
    THEN ARRAY['folder', 'study_set', 'question', 'option', 'tag', 'chapter', 'note', 'diagram']
    ELSE p_types
  END;

  WITH readable_sets AS (
    SELECT s.id, s.title, s.subject, s.description, s.updated_at
    FROM public.study_sets s
    WHERE s.owner_id = v_caller
       OR EXISTS (
         SELECT 1 FROM public.study_set_members m
         WHERE m.study_set_id = s.id AND m.user_id = v_caller
       )
  ),
  raw_hits AS (
    -- 1. Folders (strictly caller's own)
    SELECT
      'folder'::text AS result_type,
      f.id,
      NULL::uuid AS study_set_id,
      f.name AS title,
      COALESCE(left(f.description, 160), '') AS snippet,
      NULL::text AS subtitle,
      '/folders/' || f.id::text AS href,
      CASE WHEN lower(f.name) = lower(v_clean) THEN 100
           WHEN lower(f.name) LIKE v_prefix_like ESCAPE '\' THEN 90
           ELSE 75 END::integer AS rank,
      f.updated_at
    FROM public.folders f
    WHERE 'folder' = ANY(v_types)
      AND f.owner_id = v_caller
      AND (f.name ILIKE v_like ESCAPE '\' OR COALESCE(f.description, '') ILIKE v_like ESCAPE '\')

    UNION ALL

    -- 2. Study Sets (owned or shared member)
    SELECT
      'study_set'::text,
      rs.id,
      rs.id,
      rs.title,
      COALESCE(left(rs.description, 160), COALESCE(rs.subject, '')),
      rs.subject,
      '/sets/' || rs.id::text,
      CASE WHEN lower(rs.title) = lower(v_clean) THEN 100
           WHEN lower(rs.title) LIKE v_prefix_like ESCAPE '\' THEN 92
           ELSE 80 END::integer,
      rs.updated_at
    FROM readable_sets rs
    WHERE 'study_set' = ANY(v_types)
      AND (
        rs.title ILIKE v_like ESCAPE '\'
        OR COALESCE(rs.subject, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(rs.description, '') ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    -- 3. Questions (prompt, back_text, explanation, source_metadata)
    SELECT
      'question'::text,
      q.id,
      q.study_set_id,
      left(COALESCE(NULLIF(trim(q.prompt), ''), '[Media Question]'), 120),
      left(COALESCE(q.explanation, q.back_text, q.prompt, ''), 180),
      rs.title || CASE WHEN q.chapter IS NOT NULL THEN ' · ' || q.chapter ELSE '' END,
      '/sets/' || q.study_set_id::text || '/edit?q=' || q.id::text,
      CASE WHEN q.prompt ILIKE v_like ESCAPE '\' THEN 78 ELSE 65 END::integer,
      q.updated_at
    FROM public.questions q
    JOIN readable_sets rs ON rs.id = q.study_set_id
    WHERE 'question' = ANY(v_types)
      AND (
        q.prompt ILIKE v_like ESCAPE '\'
        OR COALESCE(q.back_text, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(q.explanation, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(q.source_metadata::text, '') ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    -- 4. Question Options
    SELECT
      'option'::text,
      qo.id,
      qo.study_set_id,
      left(qo.content, 120),
      left(COALESCE(NULLIF(trim(q.prompt), ''), rs.title), 160),
      rs.title,
      '/sets/' || qo.study_set_id::text || '/edit?q=' || qo.question_id::text,
      62::integer,
      q.updated_at
    FROM public.question_options qo
    JOIN public.questions q ON q.id = qo.question_id
    JOIN readable_sets rs ON rs.id = qo.study_set_id
    WHERE 'option' = ANY(v_types)
      AND qo.content ILIKE v_like ESCAPE '\'

    UNION ALL

    -- 5. Tags (caller's own tags)
    SELECT
      'tag'::text,
      t.id,
      NULL::uuid,
      t.name,
      t.slug,
      NULL::text,
      '/library?tag=' || t.id::text,
      72::integer,
      t.created_at
    FROM public.tags t
    WHERE 'tag' = ANY(v_types)
      AND t.owner_id = v_caller
      AND (t.name ILIKE v_like ESCAPE '\' OR t.slug ILIKE v_like ESCAPE '\')

    UNION ALL

    -- 6. Chapters (distinct per study set)
    SELECT
      'chapter'::text,
      q.study_set_id,
      q.study_set_id,
      q.chapter,
      rs.title,
      rs.subject,
      '/sets/' || q.study_set_id::text || '?chapter=' || replace(q.chapter, ' ', '%20'),
      70::integer,
      rs.updated_at
    FROM public.questions q
    JOIN readable_sets rs ON rs.id = q.study_set_id
    WHERE 'chapter' = ANY(v_types)
      AND q.chapter IS NOT NULL
      AND q.chapter ILIKE v_like ESCAPE '\'
    GROUP BY q.study_set_id, q.chapter, rs.title, rs.subject, rs.updated_at

    UNION ALL

    -- 7. Personal Notes (STRICTLY caller's OWN notes only — ZERO cross-user leak!)
    SELECT
      'note'::text,
      n.id,
      n.study_set_id,
      left(n.content_text, 120),
      left(COALESCE(q.prompt, rs.title), 160),
      rs.title,
      '/sets/' || n.study_set_id::text || '/edit?q=' || n.question_id::text,
      82::integer,
      n.updated_at
    FROM public.user_question_notes n
    JOIN readable_sets rs ON rs.id = n.study_set_id
    LEFT JOIN public.questions q ON q.id = n.question_id
    WHERE 'note' = ANY(v_types)
      AND n.user_id = v_caller
      AND n.content_text ILIKE v_like ESCAPE '\'

    UNION ALL

    -- 8. Diagrams & Hotspot Labels
    SELECT
      'diagram'::text,
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
      ),
      rs.title,
      '/diagrams/' || ds.id::text || '/study',
      76::integer,
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
-- 9. NEW RPC: public.sync_offline_learning_events() — Idempotent Offline Queue Sync
--    Enforces event_id idempotency, progress_generation reset guard, share revocation
--    revalidation, and non-destructive note version conflict preservation!
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

    -- 1. Idempotency check on event_id
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
        -- Never disclose another user's event_id existence
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'event_id', v_event_id,
          'status', 'invalid',
          'message', 'Event ID rejected.'
        ));
      END IF;
      CONTINUE;
    END IF;

    -- 2. Resolve study_set_id from question if omitted
    IF v_set_id IS NULL AND v_q_id IS NOT NULL THEN
      SELECT q.study_set_id INTO v_set_id FROM public.questions q WHERE q.id = v_q_id;
    END IF;

    -- 3. Verify entity existence & live authorization (catches revoked shares & deleted sets/questions!)
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

    -- 4. Guard against stale progress events created BEFORE a progress reset
    IF v_status = 'applied'
       AND v_event_type IN ('answer', 'confidence', 'mistake_resolve')
       AND v_ev_gen < v_user_gen THEN
      v_status := 'ignored_stale_reset';
      v_msg := 'Event predates the latest learning progress reset.';
    END IF;

    -- 5. Apply event deterministically by event_type
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
          calc AS (
            SELECT
              pc + CASE WHEN v_is_correct THEN 1 ELSE 0 END AS nc,
              pw + CASE WHEN v_is_correct THEN 0 ELSE 1 END AS nw,
              CASE WHEN v_is_correct THEN psc + 1 ELSE 0 END AS nsc,
              CASE WHEN v_is_correct THEN 0 ELSE psw + 1 END AS nsw,
              CASE WHEN v_is_correct THEN preps + 1 ELSE 0 END AS nreps,
              CASE WHEN v_is_correct THEN
                CASE WHEN preps = 0 THEN 1 WHEN preps = 1 THEN 6
                     ELSE GREATEST(1, round(GREATEST(1, pint) * pef)::integer) END
              ELSE 1 END AS nint,
              CASE WHEN v_is_correct THEN round(GREATEST(1.30, LEAST(4.00, pef)), 2)
                   ELSE round(GREATEST(1.30, pef - 0.32), 2) END AS nef,
              CASE WHEN v_is_correct THEN plw ELSE v_client_ts END AS nlw,
              plc + CASE WHEN v_confidence IN ('unsure', 'guessing') THEN 1 ELSE 0 END AS nlc,
              phcw + CASE WHEN NOT v_is_correct AND v_confidence = 'certain' THEN 1 ELSE 0 END AS nhcw,
              pgc + CASE WHEN v_is_correct AND v_confidence = 'guessing' THEN 1 ELSE 0 END AS ngc,
              pir + CASE WHEN v_is_correct AND NOT v_hint_used THEN 1 ELSE 0 END AS nir,
              phu + CASE WHEN v_hint_used THEN 1 ELSE 0 END AS nhu
            FROM prev
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
              WHEN nsc >= 3 AND nint >= 14 THEN 'mastered'
              WHEN nsc >= 2 OR nint >= 6 THEN 'familiar'
              ELSE 'learning'
            END,
            nc, nw, nsc, nsw, nef, nint, nreps, v_client_ts, nlw,
            v_now + make_interval(days => nint), v_confidence, nlc, nhcw, ngc, nir, nhu,
            CASE WHEN NOT v_is_correct THEN 'active'
                 WHEN nw > 0 AND nsc >= 2 THEN 'resolved'
                 WHEN nw > 0 THEN 'improving'
                 ELSE 'resolved' END,
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
            -- Preserve BOTH versions by returning conflict + full server note (zero silent LWW overwrite!)
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

    -- 6. Persist idempotency ledger entry (do NOT permanently block retries on conflict)
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
