import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  fetchInChunks,
  fetchQuestionRelationsChunked,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { listDueQuerySchema } from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listDueQuerySchema.parse(rawParams);

    const nowIso = new Date().toISOString();

    let dbQuery = supabase
      .from("user_question_progress")
      .select("*")
      .eq("user_id", user.id)
      .lte("next_review_at", nowIso);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }

    const { data: dueProgress, error } = await dbQuery
      .order("next_review_at", { ascending: true })
      .limit(query.limit);

    if (error) throw error;

    const rows = dueProgress ?? [];
    const questionIds = rows.map((r) => r.question_id);

    if (questionIds.length === 0) {
      return apiSuccess([], { total: 0 });
    }

    // SH-005: Chunk all relation queries safely (<= 100 Qs/batch)
    const [questions, relations] = await Promise.all([
      fetchInChunks(
        questionIds,
        async (chunk) => supabase.from("questions").select("*").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchQuestionRelationsChunked(supabase, questionIds),
    ]);

    const qMap = new Map(questions.map((q) => [q.id, q]));

    const items = rows
      .map((prog) => {
        const q = qMap.get(prog.question_id);
        if (!q) return null;
        return {
          progress: prog,
          question: {
            ...q,
            media_attachments: relations.questionMediaByQ.get(q.id) ?? [],
            options: relations.optionsByQ.get(q.id) ?? [],
            accepted_answers: relations.answersByQ.get(q.id) ?? [],
            tags: relations.tagsByQ.get(q.id) ?? [],
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return apiSuccess(items, { total: items.length });
  } catch (err) {
    return handleApiError(err);
  }
}
