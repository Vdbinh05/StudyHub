import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { listNotesQuerySchema, upsertNoteSchema } from "@/lib/validation/v3";
import type { Json } from "@/types/database";

/**
 * Private personal question notes (`user_question_notes`) — strictly caller-scoped!
 * Never visible to other users or study set owners.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const query = listNotesQuerySchema.parse({
      studySetId: sp.get("studySetId") ?? sp.get("study_set_id") ?? undefined,
      questionId: sp.get("questionId") ?? sp.get("question_id") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("user_question_notes")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.questionId) {
      dbQuery = dbQuery.eq("question_id", query.questionId);
    }

    const { data, count, error } = await dbQuery;
    if (error) throw error;

    const total = count ?? 0;
    const items = data ?? [];
    return apiSuccess(items, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + items.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = upsertNoteSchema.parse(await parseJsonBody(request));

    const { data: qRow, error: qErr } = await supabase
      .from("questions")
      .select("id, study_set_id")
      .eq("id", body.question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!qRow) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }
    if (body.study_set_id && body.study_set_id !== qRow.study_set_id) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Question does not belong to the specified study set.",
        400,
      );
    }

    // DB-02: RLS on `questions` SELECT already verified caller read access to qRow.study_set_id
    const { data: existing, error: fetchErr } = await supabase
      .from("user_question_notes")
      .select("*")
      .eq("user_id", user.id)
      .eq("question_id", body.question_id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (existing) {
      if (
        typeof body.base_version === "number" &&
        body.base_version !== existing.version
      ) {
        throw new AppError(
          "CONFLICT",
          "This personal note was updated on another device. Review both versions before saving.",
          409,
          { server_note: existing },
        );
      }

      const nextVersion = existing.version + 1;
      const { data: updated, error: updErr } = await supabase
        .from("user_question_notes")
        .update({
          content_text: body.content_text,
          content_rich: (
            body.content_rich !== undefined
              ? body.content_rich
              : existing.content_rich
          ) as Json | null,
          version: nextVersion,
        })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .eq("version", existing.version)
        .select("*")
        .maybeSingle();

      if (updErr) throw updErr;
      if (!updated) {
        const { data: latest } = await supabase
          .from("user_question_notes")
          .select("*")
          .eq("id", existing.id)
          .maybeSingle();
        throw new AppError(
          "CONFLICT",
          "Concurrent modification detected on personal note.",
          409,
          { server_note: latest ?? existing },
        );
      }

      return apiSuccess(updated);
    }

    const { data: created, error: insErr } = await supabase
      .from("user_question_notes")
      .insert({
        user_id: user.id,
        study_set_id: qRow.study_set_id,
        question_id: body.question_id,
        content_text: body.content_text,
        content_rich: (body.content_rich ?? null) as Json | null,
        version: 1,
      })
      .select("*")
      .single();

    if (insErr) {
      // DB-02: Handle concurrent first-time note creation race (23505) with 409 NOTE_CONFLICT + server_note
      if (insErr.code === "23505") {
        const { data: serverNote } = await supabase
          .from("user_question_notes")
          .select("*")
          .eq("user_id", user.id)
          .eq("question_id", body.question_id)
          .maybeSingle();

        throw new AppError(
          "NOTE_CONFLICT",
          "This personal note was created concurrently on another device. Review both versions before saving.",
          409,
          { server_note: serverNote ?? null },
        );
      }
      throw insErr;
    }
    return apiSuccess(created, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawQuestionId =
      request.nextUrl.searchParams.get("questionId") ??
      request.nextUrl.searchParams.get("question_id");
    if (!rawQuestionId) {
      throw new AppError("VALIDATION_ERROR", "questionId query parameter is required.", 400);
    }
    const questionId = uuidSchema.parse(rawQuestionId);

    const { error } = await supabase
      .from("user_question_notes")
      .delete()
      .eq("user_id", user.id)
      .eq("question_id", questionId);

    if (error) throw error;
    return apiSuccess({ deleted: true, question_id: questionId });
  } catch (err) {
    return handleApiError(err);
  }
}
