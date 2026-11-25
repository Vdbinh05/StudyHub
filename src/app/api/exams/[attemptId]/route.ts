import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { stripPreSubmitQuestions } from "@/lib/supabase/exam-engine";
import {
  rpcGetExamAttemptDetail,
  rpcSubmitExamAttempt,
  type ExamAttemptPayload,
} from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import type {
  ExamChapterBreakdown,
  ExamSubjectBreakdown,
  ExamTagBreakdown,
} from "@/types/domain";

interface RouteContext {
  params: Promise<{ attemptId: string }>;
}

function buildFallbackBreakdowns(payload: ExamAttemptPayload): {
  subject_breakdown: ExamSubjectBreakdown[];
  chapter_breakdown: ExamChapterBreakdown[];
  tag_breakdown: ExamTagBreakdown[];
} {
  const answerByQId = new Map(
    (payload.answers ?? []).map((a) => [a.attempt_question_id, a]),
  );

  const chapterMap = new Map<
    string,
    {
      study_set_id?: string | null;
      subject_title?: string | null;
      chapter: string;
      total: number;
      correct: number;
      wrong: number;
      unanswered: number;
    }
  >();

  const subjectMap = new Map<
    string,
    {
      study_set_id: string | null;
      subject_title: string;
      total: number;
      correct: number;
      wrong: number;
      unanswered: number;
    }
  >();

  const tagMap = new Map<
    string,
    {
      tag_id: string;
      tag_name: string;
      total: number;
      correct: number;
      wrong: number;
      unanswered: number;
    }
  >();

  for (const q of payload.questions ?? []) {
    const ans = answerByQId.get(q.id);
    const hasAns =
      ans !== undefined &&
      ((ans.selected_option_ids && ans.selected_option_ids.length > 0) ||
        Boolean(ans.typed_answer && ans.typed_answer.trim().length > 0) ||
        Boolean(ans.structured_response));
    const correct = hasAns && Boolean(ans?.is_correct);

    // Chapter breakdown (preserves exact V1 shape when source_study_set_id is absent)
    const chapName = q.chapter_snapshot?.trim() || "Uncategorized";
    const chapKey = q.source_study_set_id
      ? `${q.source_study_set_id}::${chapName}`
      : chapName;
    const chapEntry = chapterMap.get(chapKey) ?? {
      ...(q.source_study_set_id !== undefined
        ? {
            study_set_id: q.source_study_set_id,
            subject_title: q.source_subject_title ?? null,
          }
        : {}),
      chapter: chapName,
      total: 0,
      correct: 0,
      wrong: 0,
      unanswered: 0,
    };
    chapEntry.total += 1;
    if (!hasAns) chapEntry.unanswered += 1;
    else if (correct) chapEntry.correct += 1;
    else chapEntry.wrong += 1;
    chapterMap.set(chapKey, chapEntry);

    // Subject breakdown
    if (q.source_study_set_id !== undefined || q.source_subject_title !== undefined) {
      const sKey = q.source_study_set_id ?? q.source_subject_title ?? "general";
      const sEntry = subjectMap.get(sKey) ?? {
        study_set_id: q.source_study_set_id ?? null,
        subject_title: q.source_subject_title ?? payload.attempt.study_set_title_snapshot,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
      };
      sEntry.total += 1;
      if (!hasAns) sEntry.unanswered += 1;
      else if (correct) sEntry.correct += 1;
      else sEntry.wrong += 1;
      subjectMap.set(sKey, sEntry);
    }

    // Tag breakdown
    for (const tag of q.tags_snapshot ?? []) {
      const tEntry = tagMap.get(tag.id) ?? {
        tag_id: tag.id,
        tag_name: tag.name,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
      };
      tEntry.total += 1;
      if (!hasAns) tEntry.unanswered += 1;
      else if (correct) tEntry.correct += 1;
      else tEntry.wrong += 1;
      tagMap.set(tag.id, tEntry);
    }
  }

  const withPct = <T extends { total: number; correct: number }>(item: T) => ({
    ...item,
    accuracy_percent:
      item.total > 0 ? Math.round((item.correct / item.total) * 10000) / 100 : 0,
  });

  return {
    subject_breakdown: Array.from(subjectMap.values()).map(withPct),
    chapter_breakdown: Array.from(chapterMap.values()).map(withPct),
    tag_breakdown: Array.from(tagMap.values()).map(withPct),
  };
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const { data: detail, error } = await rpcGetExamAttemptDetail(supabase, id);
    if (error) throw error;
    if (!detail) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    const serverNowIso = detail.server_now ?? new Date().toISOString();
    const serverNowMs = Date.parse(serverNowIso);

    // Auto-finalize expired in-progress exams atomically via idempotent submit RPC
    if (
      detail.attempt.status === "in_progress" &&
      detail.attempt.expires_at &&
      serverNowMs > Date.parse(detail.attempt.expires_at)
    ) {
      const { data: graded, error: submitErr } = await rpcSubmitExamAttempt(
        supabase,
        id,
      );
      if (submitErr) throw submitErr;
      if (!graded) {
        throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
      }
      const fallback = buildFallbackBreakdowns(graded);
      return apiSuccess({
        ...graded,
        sources: graded.sources ?? [],
        subject_breakdown:
          graded.subject_breakdown && graded.subject_breakdown.length > 0
            ? graded.subject_breakdown
            : fallback.subject_breakdown,
        chapter_breakdown:
          graded.chapter_breakdown && graded.chapter_breakdown.length > 0
            ? graded.chapter_breakdown
            : fallback.chapter_breakdown,
        tag_breakdown:
          graded.tag_breakdown && graded.tag_breakdown.length > 0
            ? graded.tag_breakdown
            : fallback.tag_breakdown,
        server_now: new Date().toISOString(),
        remaining_seconds: 0,
      });
    }

    if (
      detail.attempt.status === "in_progress" ||
      detail.attempt.status === "discarded"
    ) {
      const remainingSeconds =
        detail.attempt.status === "in_progress" && detail.attempt.expires_at
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(detail.attempt.expires_at) - serverNowMs) / 1000,
              ),
            )
          : null;

      return apiSuccess({
        attempt: detail.attempt,
        sources: detail.sources ?? [],
        questions: stripPreSubmitQuestions(detail.questions),
        answers: detail.answers.map((a) => ({
          id: a.id,
          attempt_id: a.attempt_id,
          attempt_question_id: a.attempt_question_id,
          selected_option_ids: a.selected_option_ids,
          typed_answer: a.typed_answer,
          structured_response: a.structured_response ?? null,
          confidence: a.confidence ?? null,
          hint_used: a.hint_used ?? false,
          is_flagged: a.is_flagged,
          client_seq: a.client_seq ?? 0,
          updated_at: a.updated_at,
        })),
        server_now: serverNowIso,
        remaining_seconds: remainingSeconds,
      });
    }

    const fallback = buildFallbackBreakdowns(detail);

    return apiSuccess({
      ...detail,
      sources: detail.sources ?? [],
      subject_breakdown:
        detail.subject_breakdown && detail.subject_breakdown.length > 0
          ? detail.subject_breakdown
          : fallback.subject_breakdown,
      chapter_breakdown:
        detail.chapter_breakdown && detail.chapter_breakdown.length > 0
          ? detail.chapter_breakdown
          : fallback.chapter_breakdown,
      tag_breakdown:
        detail.tag_breakdown && detail.tag_breakdown.length > 0
          ? detail.tag_breakdown
          : fallback.tag_breakdown,
      server_now: serverNowIso,
      remaining_seconds: 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const { data, error } = await supabase
      .from("exam_attempts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    return apiSuccess({ deleted: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}
