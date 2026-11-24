import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { fetchAllPages } from "@/lib/supabase/query-helpers";
import { uuidSchema } from "@/lib/validation/common";
import { updateStudySetSchema } from "@/lib/validation/sets";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    const access = await requireStudySetAccess(supabase, setId, user.id, "read");

    // SH-005 / BUG-016: Paginate chapter & progress scans so >1,000Q banks never truncate!
    const [chapterRows, progressRows, { count: starredCount, error: starError }, { data: ownerProfile }] =
      await Promise.all([
        fetchAllPages(async (from, to) =>
          supabase
            .from("questions")
            .select("chapter, question_type")
            .eq("study_set_id", setId)
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("user_question_progress")
            .select("mastery_level, wrong_count, next_review_at")
            .eq("user_id", user.id)
            .eq("study_set_id", setId)
            .range(from, to),
        ),
        supabase
          .from("starred_questions")
          .select("question_id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("study_set_id", setId),
        supabase
          .from("profiles")
          .select("id, display_name, username, avatar_url")
          .eq("id", access.studySet.owner_id)
          .maybeSingle(),
      ]);

    if (starError) throw starError;

    const chapterCounts = new Map<string, number>();
    const typeCounts: Record<string, number> = {};
    for (const q of chapterRows) {
      if (q.chapter) {
        chapterCounts.set(q.chapter, (chapterCounts.get(q.chapter) ?? 0) + 1);
      }
      typeCounts[q.question_type] = (typeCounts[q.question_type] ?? 0) + 1;
    }

    const mastery = {
      new: 0,
      learning: 0,
      familiar: 0,
      mastered: 0,
      due: 0,
      mistakes: 0,
    };
    const nowIso = new Date().toISOString();
    for (const p of progressRows) {
      mastery[p.mastery_level] += 1;
      if (p.next_review_at && p.next_review_at <= nowIso) {
        mastery.due += 1;
      }
      if (p.wrong_count > 0 && p.mastery_level !== "mastered") {
        mastery.mistakes += 1;
      }
    }
    const trackedCount = progressRows.length;
    mastery.new = Math.max(0, access.studySet.question_count - trackedCount) + mastery.new;

    return apiSuccess({
      ...access.studySet,
      role: access.role,
      can_edit: access.canEdit,
      is_owner: access.isOwner,
      can_clone: access.canClone,
      owner: ownerProfile ?? null,
      chapters: Array.from(chapterCounts.entries()).map(([name, count]) => ({
        name,
        count,
      })),
      question_type_counts: typeCounts,
      mastery_summary: mastery,
      starred_count: starredCount ?? 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);
    const body = await parseJsonBody(request);
    const input = updateStudySetSchema.parse(body);

    const access = await requireStudySetAccess(supabase, setId, user.id, "edit");

    // SH-001 & SH-033: Only owner may change visibility, folder, archive, or favorite state
    if (
      !access.isOwner &&
      (input.visibility !== undefined ||
        input.folder_id !== undefined ||
        input.is_archived !== undefined ||
        input.is_favorite !== undefined)
    ) {
      throw new AppError(
        "FORBIDDEN",
        "Only the study set owner can change visibility, folder, archive, or favorite status.",
        403,
      );
    }

    if (input.folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", input.folder_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!folder) {
        throw new AppError("NOT_FOUND", "Target folder not found.", 404);
      }
    }

    const { data, error } = await supabase
      .from("study_sets")
      .update(input)
      .eq("id", setId)
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data);
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
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    const { error } = await supabase
      .from("study_sets")
      .delete()
      .eq("id", setId)
      .eq("owner_id", user.id);

    if (error) throw error;

    return apiSuccess({ deleted: true, id: setId });
  } catch (err) {
    return handleApiError(err);
  }
}
