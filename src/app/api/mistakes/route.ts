import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  fetchAllPages,
  fetchInChunks,
  fetchQuestionRelationsChunked,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { listMistakesQuerySchema } from "@/lib/validation/learning";

/**
 * Advanced Mistake Bank (V3.0 — supports all 15 deterministic filters + V2.1 backward compatibility).
 * Filters: subject, studySetId, chapter, tagId, questionType, days (last_wrong_at/last_reviewed_at),
 * minWrongCount, minConsecutiveWrong, examAttemptId / recentExamOnly, confidence, lowConfidence,
 * highConfWrong, guessCorrect, dueOnly, starredOnly, masteryLevel, mistakeStatus / tab.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listMistakesQuerySchema.parse(rawParams);

    const lowConfFlag = Boolean(query.lowConfidence || query.lowConfidenceOnly);
    const highConfWrongFlag = Boolean(query.highConfWrong || query.highConfWrongOnly);
    const guessCorrectFlag = Boolean(query.guessCorrect || query.guessCorrectOnly);
    const nowIso = new Date().toISOString();
    const cutoffIso = query.days
      ? new Date(Date.now() - query.days * 86_400_000).toISOString()
      : null;

    // Effective mistakeStatus filter combining `mistakeStatus`, `tab`, and V2 `includeResolved`
    const effectiveTab = query.mistakeStatus ?? query.tab;

    // 1. Paginate caller's progress rows (allow wrong_count >= 0 if guessCorrectFlag is explicitly requested)
    const minWrong = guessCorrectFlag && !rawParams.minWrongCount ? 0 : query.minWrongCount;

    const allProgress = await fetchAllPages(async (from, to) => {
      let dbQuery = supabase
        .from("user_question_progress")
        .select("*")
        .eq("user_id", user.id)
        .gte("wrong_count", minWrong);

      if (query.studySetId) {
        dbQuery = dbQuery.eq("study_set_id", query.studySetId);
      }
      if (query.minConsecutiveWrong) {
        dbQuery = dbQuery.gte("consecutive_wrong", query.minConsecutiveWrong);
      }
      if (query.confidence) {
        dbQuery = dbQuery.eq("last_confidence", query.confidence);
      }
      if (lowConfFlag) {
        dbQuery = dbQuery.gt("low_confidence_count", 0);
      }
      if (highConfWrongFlag) {
        dbQuery = dbQuery.gt("high_conf_wrong_count", 0);
      }
      if (guessCorrectFlag) {
        dbQuery = dbQuery.gt("guess_correct_count", 0);
      }
      if (query.dueOnly) {
        dbQuery = dbQuery.lte("next_review_at", nowIso);
      }
      if (query.masteryLevel) {
        dbQuery = dbQuery.eq("mastery_level", query.masteryLevel);
      }

      if (effectiveTab === "active") {
        dbQuery = dbQuery.eq("mistake_status", "active");
      } else if (effectiveTab === "improving") {
        dbQuery = dbQuery.eq("mistake_status", "improving");
      } else if (effectiveTab === "resolved") {
        dbQuery = dbQuery.eq("mistake_status", "resolved");
      } else if (effectiveTab === "unresolved") {
        dbQuery = dbQuery.neq("mistake_status", "resolved");
      } else if (!query.includeResolved && effectiveTab !== "all" && !guessCorrectFlag) {
        dbQuery = dbQuery.neq("mastery_level", "mastered").neq("mistake_status", "resolved");
      }

      if (cutoffIso) {
        dbQuery = dbQuery.or(
          `last_wrong_at.gte.${cutoffIso},last_reviewed_at.gte.${cutoffIso}`,
        );
      }

      return dbQuery
        .order("wrong_count", { ascending: false })
        .order("last_reviewed_at", { ascending: false })
        .range(from, to);
    });

    if (allProgress.length === 0) {
      return apiSuccess([], {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    let workingProgress = allProgress;

    // 2. Subject filter (resolve study_sets upfront when needed)
    if (query.subject) {
      const candidateSetIds = Array.from(
        new Set(workingProgress.map((p) => p.study_set_id)),
      );
      const setRows = await fetchInChunks(
        candidateSetIds,
        async (chunk) =>
          supabase.from("study_sets").select("id, subject").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      const targetSubject = query.subject.trim().toLowerCase();
      const matchingSets = new Set(
        setRows
          .filter((s) => (s.subject ?? "").trim().toLowerCase() === targetSubject)
          .map((s) => s.id),
      );
      workingProgress = workingProgress.filter((p) =>
        matchingSets.has(p.study_set_id),
      );
      if (workingProgress.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    // 3. Starred-only filter
    if (query.starredOnly) {
      const qIds = workingProgress.map((p) => p.question_id);
      const starredFilterRows = await fetchInChunks(
        qIds,
        async (chunk) =>
          supabase
            .from("starred_questions")
            .select("question_id")
            .eq("user_id", user.id)
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      const starredIds = new Set(starredFilterRows.map((r) => r.question_id));
      workingProgress = workingProgress.filter((p) => starredIds.has(p.question_id));
      if (workingProgress.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    // 4. Tag filter
    if (query.tagId) {
      const qIds = workingProgress.map((p) => p.question_id);
      const taggedRows = await fetchInChunks(
        qIds,
        async (chunk) =>
          supabase
            .from("question_tags")
            .select("question_id")
            .eq("tag_id", query.tagId!)
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      const taggedIds = new Set(taggedRows.map((r) => r.question_id));
      workingProgress = workingProgress.filter((p) => taggedIds.has(p.question_id));
      if (workingProgress.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    // 5. Recent exam / specific examAttemptId wrong-only filter
    if (query.examAttemptId || query.recentExamOnly) {
      let targetAttemptIds: string[] = [];
      if (query.examAttemptId) {
        targetAttemptIds = [query.examAttemptId];
      } else {
        const { data: recentExams } = await supabase
          .from("exam_attempts")
          .select("id")
          .eq("user_id", user.id)
          .in("status", ["submitted", "expired"])
          .order("submitted_at", { ascending: false })
          .limit(5);
        targetAttemptIds = (recentExams ?? []).map((e) => e.id);
      }

      if (targetAttemptIds.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }

      const wrongAnswersInExams = await fetchAllPages(async (from, to) =>
        supabase
          .from("exam_attempt_answers")
          .select("attempt_question_id")
          .eq("user_id", user.id)
          .eq("is_correct", false)
          .in("attempt_id", targetAttemptIds)
          .range(from, to),
      );

      const wrongAttemptQIds = wrongAnswersInExams.map((a) => a.attempt_question_id);
      if (wrongAttemptQIds.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }

      const snapRows = await fetchInChunks(
        wrongAttemptQIds,
        async (chunk) =>
          supabase
            .from("exam_attempt_questions")
            .select("question_id")
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );

      const examWrongQIds = new Set(
        snapRows.map((r) => r.question_id).filter((id): id is string => Boolean(id)),
      );
      workingProgress = workingProgress.filter((p) => examWrongQIds.has(p.question_id));
      if (workingProgress.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    // 6. V3.1 P2-1: Filter chapter/questionType using ONLY narrow metadata columns before paging,
    //    and fetch full `questions.*` ONLY for the current page's IDs (max 20-50 rows)!
    const allQuestionIds = workingProgress.map((p) => p.question_id);
    const metaRows = await fetchInChunks(
      allQuestionIds,
      async (chunk) => {
        let qQuery = supabase
          .from("questions")
          .select("id")
          .in("id", chunk);
        if (query.chapter) {
          qQuery = qQuery.eq("chapter", query.chapter);
        }
        if (query.questionType) {
          qQuery = qQuery.eq("question_type", query.questionType);
        }
        return qQuery;
      },
      SAFE_IN_CHUNK_SIZE,
    );

    const existingQIds = new Set(metaRows.map((q) => q.id));
    const filteredProgress = workingProgress.filter((p) =>
      existingQIds.has(p.question_id),
    );

    // Deterministic sort according to query.sort
    filteredProgress.sort((a, b) => {
      switch (query.sort) {
        case "recent_wrong": {
          const aTs = a.last_wrong_at ?? a.last_reviewed_at ?? "";
          const bTs = b.last_wrong_at ?? b.last_reviewed_at ?? "";
          return bTs.localeCompare(aTs);
        }
        case "consecutive_wrong":
          return (
            (b.consecutive_wrong ?? 0) - (a.consecutive_wrong ?? 0) ||
            b.wrong_count - a.wrong_count
          );
        case "high_conf_wrong":
          return (
            (b.high_conf_wrong_count ?? 0) - (a.high_conf_wrong_count ?? 0) ||
            b.wrong_count - a.wrong_count
          );
        case "due_first": {
          const aDue = a.next_review_at ?? "9999-12-31T00:00:00Z";
          const bDue = b.next_review_at ?? "9999-12-31T00:00:00Z";
          return aDue.localeCompare(bDue);
        }
        default:
          return (
            b.wrong_count - a.wrong_count ||
            (b.last_reviewed_at ?? "").localeCompare(a.last_reviewed_at ?? "")
          );
      }
    });

    const total = filteredProgress.length;
    const from = (query.page - 1) * query.pageSize;
    const pagedProgress = filteredProgress.slice(from, from + query.pageSize);

    if (pagedProgress.length === 0) {
      return apiSuccess([], {
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const pageQIds = pagedProgress.map((p) => p.question_id);
    const pageSetIds = Array.from(new Set(pagedProgress.map((p) => p.study_set_id)));

    const [
      pageQuestions,
      relations,
      sets,
      sessionWrongRows,
      examWrongQuestions,
      starredRows,
    ] = await Promise.all([
      fetchInChunks(
        pageQIds,
        async (chunk) => supabase.from("questions").select("*").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchQuestionRelationsChunked(supabase, pageQIds),
      fetchInChunks(
        pageSetIds,
        async (chunk) =>
          supabase
            .from("study_sets")
            .select("id, title, subject")
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("study_session_answers")
            .select("question_id, selected_option_ids, typed_answer, answered_at")
            .eq("user_id", user.id)
            .eq("is_correct", false)
            .in("question_id", chunk)
            .order("answered_at", { ascending: false }),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("exam_attempt_questions")
            .select("id, attempt_id, question_id")
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("starred_questions")
            .select("question_id")
            .eq("user_id", user.id)
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
    ]);

    const qMap = new Map(pageQuestions.map((q) => [q.id, q]));

    const attemptQMeta = new Map<string, { questionId: string; attemptId: string }>();
    const attemptQIds: string[] = [];
    for (const eq of examWrongQuestions) {
      if (eq.question_id) {
        attemptQMeta.set(eq.id, {
          questionId: eq.question_id,
          attemptId: eq.attempt_id,
        });
        attemptQIds.push(eq.id);
      }
    }

    const examWrongAnswers =
      attemptQIds.length > 0
        ? await fetchInChunks(
            attemptQIds,
            async (chunk) =>
              supabase
                .from("exam_attempt_answers")
                .select(
                  "attempt_question_id, selected_option_ids, typed_answer, updated_at",
                )
                .eq("user_id", user.id)
                .eq("is_correct", false)
                .in("attempt_question_id", chunk)
                .order("updated_at", { ascending: false }),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const setMap = new Map(sets.map((s) => [s.id, s]));
    const starredSet = new Set(starredRows.map((s) => s.question_id));

    const lastWrongMap = new Map<
      string,
      {
        selected_option_ids: string[];
        typed_answer: string | null;
        answered_at: string;
        source: "session" | "exam";
        attempt_id?: string | null;
      }
    >();

    for (const ans of sessionWrongRows) {
      const prev = lastWrongMap.get(ans.question_id);
      if (!prev || ans.answered_at > prev.answered_at) {
        lastWrongMap.set(ans.question_id, {
          selected_option_ids: ans.selected_option_ids,
          typed_answer: ans.typed_answer,
          answered_at: ans.answered_at,
          source: "session",
          attempt_id: null,
        });
      }
    }

    for (const ans of examWrongAnswers) {
      const meta = attemptQMeta.get(ans.attempt_question_id);
      if (!meta) continue;
      const prev = lastWrongMap.get(meta.questionId);
      if (!prev || ans.updated_at > prev.answered_at) {
        lastWrongMap.set(meta.questionId, {
          selected_option_ids: ans.selected_option_ids,
          typed_answer: ans.typed_answer,
          answered_at: ans.updated_at,
          source: "exam",
          attempt_id: meta.attemptId,
        });
      }
    }

    const combined = pagedProgress
      .map((prog) => {
        const q = qMap.get(prog.question_id);
        if (!q) return null;
        const resolved =
          prog.mistake_status === "resolved" || prog.mastery_level === "mastered";
        return {
          progress: prog,
          resolved,
          is_starred: starredSet.has(q.id),
          last_wrong_answer: lastWrongMap.get(q.id) ?? null,
          study_set: setMap.get(prog.study_set_id) ?? null,
          question: {
            ...q,
            options: relations.optionsByQ.get(q.id) ?? [],
            accepted_answers: relations.answersByQ.get(q.id) ?? [],
            tags: relations.tagsByQ.get(q.id) ?? [],
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return apiSuccess(combined, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + combined.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
