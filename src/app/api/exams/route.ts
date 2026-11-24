import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { rpcCreateExamAttempt } from "@/lib/supabase/rpc";
import { createExamSchema, listExamsQuerySchema } from "@/lib/validation/exams";
import type {
  ExamAcceptedAnswerSnapshot,
  ExamQuestionType,
  ExamSnapshotOption,
  ExamSnapshotQuestion,
} from "@/types/domain";

const EXAM_ELIGIBLE_TYPES: ExamQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
];

function cryptoShuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Defense-in-depth sanitizer: strips all answer keys and explanations before
 * returning an in-progress exam payload to the client.
 */
function sanitizeInProgressQuestions(
  questions: ExamSnapshotQuestion[],
): ExamSnapshotQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    attempt_id: q.attempt_id,
    question_id: q.question_id,
    position: q.position,
    question_type: q.question_type,
    chapter_snapshot: q.chapter_snapshot,
    prompt_snapshot: q.prompt_snapshot,
    prompt_image_url_snapshot: q.prompt_image_url_snapshot,
    options_snapshot: (q.options_snapshot ?? []).map((opt) => ({
      id: opt.id,
      label: opt.label,
      content: opt.content,
      image_url: opt.image_url ?? null,
      position: opt.position,
    })),
    created_at: q.created_at,
  }));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listExamsQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("exam_attempts")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.status) {
      dbQuery = dbQuery.eq("status", query.status);
    }

    const { data, count, error } = await dbQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    const total = count ?? rows.length;

    return apiSuccess(rows, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + rows.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.EXAM_START, user.id);
    if (limited) return limited;

    const body = await parseJsonBody(request);
    const input = createExamSchema.parse(body);

    const primaryAccess = await requireStudySetAccess(
      supabase,
      input.study_set_id,
      user.id,
      "read",
    );

    const setIds = Array.from(
      new Set([input.study_set_id, ...(input.additional_study_set_ids ?? [])]),
    );

    for (const extraId of setIds) {
      if (extraId !== input.study_set_id) {
        await requireStudySetAccess(supabase, extraId, user.id, "read");
      }
    }

    const allowedTypes: ExamQuestionType[] =
      input.question_types && input.question_types.length > 0
        ? input.question_types
        : EXAM_ELIGIBLE_TYPES;

    let qQuery = supabase
      .from("questions")
      .select("*")
      .in("study_set_id", setIds)
      .in("question_type", allowedTypes);

    if (input.chapters && input.chapters.length > 0) {
      qQuery = qQuery.in("chapter", input.chapters);
    }
    if (input.difficulties && input.difficulties.length > 0) {
      qQuery = qQuery.in("difficulty", input.difficulties);
    }
    if (input.question_ids && input.question_ids.length > 0) {
      qQuery = qQuery.in("id", input.question_ids);
    }

    const { data: candidates, error: qErr } = await qQuery.order("position", {
      ascending: true,
    });
    if (qErr) throw qErr;

    let pool = candidates ?? [];

    if (pool.length > 0 && input.tag_ids && input.tag_ids.length > 0) {
      const { data: tagRows, error: tagErr } = await supabase
        .from("question_tags")
        .select("question_id")
        .in("study_set_id", setIds)
        .in("tag_id", input.tag_ids);
      if (tagErr) throw tagErr;
      const taggedSet = new Set((tagRows ?? []).map((r) => r.question_id));
      pool = pool.filter((q) => taggedSet.has(q.id));
    }

    if (pool.length > 0 && input.only_starred) {
      const { data: starRows, error: starErr } = await supabase
        .from("starred_questions")
        .select("question_id")
        .eq("user_id", user.id)
        .in("study_set_id", setIds);
      if (starErr) throw starErr;
      const starSet = new Set((starRows ?? []).map((r) => r.question_id));
      pool = pool.filter((q) => starSet.has(q.id));
    }

    if (pool.length > 0 && (input.only_unmastered || input.only_mistakes)) {
      const { data: progRows, error: progErr } = await supabase
        .from("user_question_progress")
        .select("question_id, mastery_level, wrong_count")
        .eq("user_id", user.id)
        .in("study_set_id", setIds);
      if (progErr) throw progErr;

      const progMap = new Map((progRows ?? []).map((p) => [p.question_id, p]));
      if (input.only_unmastered) {
        pool = pool.filter((q) => progMap.get(q.id)?.mastery_level !== "mastered");
      }
      if (input.only_mistakes) {
        pool = pool.filter((q) => {
          const p = progMap.get(q.id);
          return p !== undefined && p.wrong_count > 0 && p.mastery_level !== "mastered";
        });
      }
    }

    if (pool.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "No exam-eligible questions matched the selected filters.",
        400,
      );
    }

    const ordered = input.shuffle_questions ? cryptoShuffle(pool) : pool;
    const selected = ordered.slice(0, Math.min(input.question_count, ordered.length));
    const selectedIds = selected.map((q) => q.id);

    const [
      { data: options, error: optErr },
      { data: accepted, error: accErr },
    ] = await Promise.all([
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", selectedIds)
        .order("position", { ascending: true }),
      supabase
        .from("question_accepted_answers")
        .select("*")
        .in("question_id", selectedIds),
    ]);

    if (optErr) throw optErr;
    if (accErr) throw accErr;

    const optionsMap = new Map<string, typeof options>();
    for (const o of options ?? []) {
      const list = optionsMap.get(o.question_id) ?? [];
      list.push(o);
      optionsMap.set(o.question_id, list);
    }

    const acceptedMap = new Map<string, typeof accepted>();
    for (const a of accepted ?? []) {
      const list = acceptedMap.get(a.question_id) ?? [];
      list.push(a);
      acceptedMap.set(a.question_id, list);
    }

    const displayLabels = ["A", "B", "C", "D", "E", "F", "G", "H"];

    const snapshotQuestions = selected.map((q) => {
      const rawOpts = optionsMap.get(q.id) ?? [];
      const arrangedOpts = input.shuffle_options
        ? cryptoShuffle(rawOpts)
        : rawOpts;

      const optionsSnapshot: ExamSnapshotOption[] = arrangedOpts.map((opt, idx) => ({
        id: opt.id,
        label: displayLabels[idx] ?? opt.label,
        content: opt.content,
        image_url: opt.image_url ?? null,
        position: idx,
      }));

      const correctOptionIds = rawOpts
        .filter((opt) => opt.is_correct)
        .map((opt) => opt.id);

      const acceptedSnapshot: ExamAcceptedAnswerSnapshot[] = (
        acceptedMap.get(q.id) ?? []
      ).map((acc) => ({
        answer_text: acc.answer_text,
        normalized_answer: acc.normalized_answer,
        match_mode: acc.match_mode,
      }));

      return {
        question_id: q.id,
        question_type: q.question_type,
        chapter_snapshot: q.chapter,
        prompt_snapshot: q.prompt,
        prompt_image_url_snapshot: q.prompt_image_url,
        explanation_snapshot: q.explanation,
        options_snapshot: optionsSnapshot,
        correct_option_ids: correctOptionIds,
        accepted_answers_snapshot: acceptedSnapshot,
      };
    });

    const durationLimitSeconds =
      input.duration_limit_seconds !== undefined
        ? input.duration_limit_seconds
        : primaryAccess.studySet.default_exam_duration_minutes * 60;

    const passThreshold =
      input.pass_threshold ?? primaryAccess.studySet.default_pass_threshold;

    const titleSnapshot = input.title ?? primaryAccess.studySet.title;

    const examConfig = {
      question_count: snapshotQuestions.length,
      duration_limit_seconds: durationLimitSeconds,
      shuffle_questions: input.shuffle_questions,
      shuffle_options: input.shuffle_options,
      pass_threshold: passThreshold,
      chapters: input.chapters,
      tag_ids: input.tag_ids,
      difficulties: input.difficulties,
      only_starred: input.only_starred,
      only_unmastered: input.only_unmastered,
      only_mistakes: input.only_mistakes,
    };

    const { data: created, error: rpcErr } = await rpcCreateExamAttempt(supabase, {
      p_study_set_id: input.study_set_id,
      p_title_snapshot: titleSnapshot,
      p_config: examConfig,
      p_duration_limit_seconds: durationLimitSeconds,
      p_pass_threshold: passThreshold,
      p_questions: snapshotQuestions,
    });

    if (rpcErr) throw rpcErr;
    if (!created) {
      throw new AppError("INTERNAL_ERROR", "Failed to create exam attempt.", 500);
    }

    const serverNow = created.server_now ?? new Date().toISOString();
    const remainingSeconds = created.attempt.expires_at
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(created.attempt.expires_at) - Date.parse(serverNow)) /
              1000,
          ),
        )
      : null;

    return apiSuccess(
      {
        attempt: created.attempt,
        questions: sanitizeInProgressQuestions(created.questions),
        answers: [],
        server_now: serverNow,
        remaining_seconds: remainingSeconds,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
