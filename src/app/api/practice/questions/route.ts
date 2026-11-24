import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { extractSourceIds } from "@/lib/supabase/exam-engine";
import { rpcGetPracticeQuestionPool } from "@/lib/supabase/rpc";
import { practiceQuestionsRequestSchema } from "@/lib/validation/exams";
import type { Json } from "@/types/database";
import type { PracticePoolResponse, StudySession } from "@/types/domain";

/**
 * V2.0 Custom Subset & Multi-Subject Practice Endpoint.
 * Loads questions with options, accepted answers, tags, starred status, and SM-2 progress
 * cleanly across single or multiple sets/folders without PostgREST 1,000-row truncation.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = practiceQuestionsRequestSchema.parse(body);

    const { folderIds, studySetIds, includeSubfolders } = extractSourceIds(
      input.sources,
    );

    const { data: pool, error: rpcErr } = await rpcGetPracticeQuestionPool(
      supabase,
      {
        p_folder_ids: folderIds,
        p_study_set_ids: studySetIds,
        p_include_subfolders: includeSubfolders,
        p_filters: (input.filters ?? {}) as Record<string, unknown>,
        p_selection_policy: input.selection_policy,
        p_count: input.count ?? null,
        p_shuffle: input.shuffle_questions,
      },
    );

    if (rpcErr) throw rpcErr;
    if (!pool) {
      throw new AppError("INTERNAL_ERROR", "Failed to load practice pool.", 500);
    }

    let session: StudySession | null = null;
    if (input.create_session && pool.questions.length > 0) {
      const resolvedSetIds = pool.sources.map((s) => s.study_set_id);
      const singleSetId = resolvedSetIds.length === 1 ? resolvedSetIds[0] : null;

      const { data: createdSession, error: sessErr } = await supabase
        .from("study_sessions")
        .insert({
          user_id: user.id,
          study_set_id: singleSetId,
          source_study_set_ids: resolvedSetIds,
          mode: input.mode,
          status: "in_progress",
          config: {
            sources: input.sources,
            filters: input.filters ?? {},
            selection_policy: input.selection_policy,
            shuffle_questions: input.shuffle_questions,
            requested_count: input.count ?? null,
          } as unknown as Json,
          total_items: pool.questions.length,
        })
        .select("*")
        .single();

      if (sessErr) throw sessErr;
      session = createdSession as StudySession;
    }

    const response: PracticePoolResponse = {
      session,
      total_eligible: pool.total_eligible,
      sources: pool.sources,
      questions: pool.questions,
    };

    return apiSuccess(response);
  } catch (err) {
    return handleApiError(err);
  }
}
