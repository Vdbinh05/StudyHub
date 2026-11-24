import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { normalizeAnswerText, slugifyTag } from "@/lib/security/sanitize";
import { uuidSchema } from "@/lib/validation/common";
import {
  bulkDeleteQuestionsSchema,
  bulkInsertQuestionsSchema,
  bulkUpdateQuestionsSchema,
} from "@/lib/validation/questions";
import type { Json, TablesUpdate } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "edit");

    const body = await parseJsonBody(request);
    const { questions } = bulkInsertQuestionsSchema.parse(body);

    const { data: lastQ } = await supabase
      .from("questions")
      .select("position")
      .eq("study_set_id", setId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const basePos = lastQ ? lastQ.position + 1 : 0;

    const questionRows = questions.map((q, idx) => ({
      study_set_id: setId,
      question_type: q.question_type,
      position: q.position ?? basePos + idx,
      chapter: q.chapter ?? null,
      prompt: q.prompt,
      prompt_image_url: q.prompt_image_url ?? null,
      back_text: q.back_text ?? null,
      back_image_url: q.back_image_url ?? null,
      explanation: q.explanation ?? null,
      hint: q.hint ?? null,
      difficulty: q.difficulty,
      source_metadata: (q.source_metadata ?? {}) as Json,
    }));

    const { data: inserted, error: insErr } = await supabase
      .from("questions")
      .insert(questionRows)
      .select("id, position");

    if (insErr) throw insErr;

    const insertedList = inserted ?? [];
    const optionsToInsert: Array<{
      question_id: string;
      study_set_id: string;
      position: number;
      label: string;
      content: string;
      image_url: string | null;
      is_correct: boolean;
    }> = [];

    const acceptedToInsert: Array<{
      question_id: string;
      study_set_id: string;
      answer_text: string;
      normalized_answer: string;
      match_mode: "exact" | "case_insensitive" | "ignore_diacritics" | "numeric";
    }> = [];

    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const createdId = insertedList[i]?.id;
      if (!createdId) continue;

      for (let oIdx = 0; oIdx < (q.options ?? []).length; oIdx += 1) {
        const opt = q.options![oIdx];
        optionsToInsert.push({
          question_id: createdId,
          study_set_id: setId,
          position: opt.position ?? oIdx,
          label: opt.label,
          content: opt.content,
          image_url: opt.image_url ?? null,
          is_correct: opt.is_correct,
        });
      }

      for (const acc of q.accepted_answers ?? []) {
        acceptedToInsert.push({
          question_id: createdId,
          study_set_id: setId,
          answer_text: acc.answer_text,
          normalized_answer: normalizeAnswerText(acc.answer_text, acc.match_mode),
          match_mode: acc.match_mode,
        });
      }
    }

    if (optionsToInsert.length > 0) {
      const { error: optErr } = await supabase
        .from("question_options")
        .insert(optionsToInsert);
      if (optErr) throw optErr;
    }

    if (acceptedToInsert.length > 0) {
      const { error: accErr } = await supabase
        .from("question_accepted_answers")
        .insert(acceptedToInsert);
      if (accErr) throw accErr;
    }

    return apiSuccess(
      {
        inserted_count: insertedList.length,
        question_ids: insertedList.map((q) => q.id),
      },
      undefined,
      { status: 201 },
    );
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

    await requireStudySetAccess(supabase, setId, user.id, "edit");

    const body = await parseJsonBody(request);
    const input = bulkUpdateQuestionsSchema.parse(body);

    const updates: TablesUpdate<"questions"> = {};
    if (input.chapter !== undefined) updates.chapter = input.chapter;
    if (input.difficulty !== undefined) updates.difficulty = input.difficulty;

    if (Object.keys(updates).length > 0) {
      const { error: updErr } = await supabase
        .from("questions")
        .update(updates)
        .eq("study_set_id", setId)
        .in("id", input.question_ids);
      if (updErr) throw updErr;
    }

    if (input.add_tags && input.add_tags.length > 0) {
      const uniqueSlugs = new Map<string, string>();
      for (const name of input.add_tags) {
        uniqueSlugs.set(slugifyTag(name), name.trim());
      }
      const { data: tags, error: tagErr } = await supabase
        .from("tags")
        .upsert(
          Array.from(uniqueSlugs.entries()).map(([slug, name]) => ({
            owner_id: user.id,
            name,
            slug,
          })),
          { onConflict: "owner_id,slug" },
        )
        .select("id");
      if (tagErr) throw tagErr;

      const joinRows: Array<{
        question_id: string;
        tag_id: string;
        study_set_id: string;
      }> = [];
      for (const qId of input.question_ids) {
        for (const t of tags ?? []) {
          joinRows.push({ question_id: qId, tag_id: t.id, study_set_id: setId });
        }
      }
      if (joinRows.length > 0) {
        const { error: qtErr } = await supabase
          .from("question_tags")
          .upsert(joinRows, { onConflict: "question_id,tag_id" });
        if (qtErr) throw qtErr;
      }
    }

    if (input.remove_tag_ids && input.remove_tag_ids.length > 0) {
      const { error: remErr } = await supabase
        .from("question_tags")
        .delete()
        .eq("study_set_id", setId)
        .in("question_id", input.question_ids)
        .in("tag_id", input.remove_tag_ids);
      if (remErr) throw remErr;
    }

    return apiSuccess({
      updated_count: input.question_ids.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "edit");

    const body = await parseJsonBody(request);
    const { question_ids } = bulkDeleteQuestionsSchema.parse(body);

    const { data, error } = await supabase
      .from("questions")
      .delete()
      .eq("study_set_id", setId)
      .in("id", question_ids)
      .select("id");

    if (error) throw error;

    return apiSuccess({
      deleted_count: (data ?? []).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
