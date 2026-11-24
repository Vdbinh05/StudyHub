import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { normalizeAnswerText, slugifyTag } from "@/lib/security/sanitize";
import { fetchQuestionRelationsChunked } from "@/lib/supabase/query-helpers";
import { uuidSchema } from "@/lib/validation/common";
import { updateQuestionSchema } from "@/lib/validation/questions";
import type { Json, TablesUpdate } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string; questionId: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id, questionId } = await context.params;
    const setId = uuidSchema.parse(id);
    const qId = uuidSchema.parse(questionId);

    await requireStudySetAccess(supabase, setId, user.id, "read");

    const [{ data: question, error: qErr }, relations, { data: starred }] =
      await Promise.all([
        supabase
          .from("questions")
          .select("*")
          .eq("id", qId)
          .eq("study_set_id", setId)
          .maybeSingle(),
        fetchQuestionRelationsChunked(supabase, [qId], setId),
        supabase
          .from("starred_questions")
          .select("question_id")
          .eq("user_id", user.id)
          .eq("question_id", qId)
          .maybeSingle(),
      ]);

    if (qErr) throw qErr;
    if (!question) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    return apiSuccess({
      ...question,
      options: relations.optionsByQ.get(qId) ?? [],
      accepted_answers: relations.answersByQ.get(qId) ?? [],
      tags: relations.tagsByQ.get(qId) ?? [],
      is_starred: Boolean(starred),
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
    const { id, questionId } = await context.params;
    const setId = uuidSchema.parse(id);
    const qId = uuidSchema.parse(questionId);

    await requireStudySetAccess(supabase, setId, user.id, "edit");

    const body = await parseJsonBody(request);
    const input = updateQuestionSchema.parse(body);

    const { data: existing, error: existingErr } = await supabase
      .from("questions")
      .select("id, question_type, back_text")
      .eq("id", qId)
      .eq("study_set_id", setId)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    // SH-025: Validate effective merged question_type + options/back_text integrity!
    const effectiveType = input.question_type ?? existing.question_type;
    const isChoiceType =
      effectiveType === "single_choice" ||
      effectiveType === "multiple_choice" ||
      effectiveType === "true_false";

    if (isChoiceType && input.options !== undefined) {
      if (input.options.length < 2) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Choice questions require at least 2 options.",
          400,
        );
      }
      const correctCount = input.options.filter((o) => o.is_correct).length;
      if (correctCount < 1) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Choice questions require at least 1 correct option.",
          400,
        );
      }
      if (
        (effectiveType === "single_choice" || effectiveType === "true_false") &&
        correctCount > 1
      ) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Single-choice and true/false questions must have exactly 1 correct option.",
          400,
        );
      }
    }

    if (effectiveType === "flashcard") {
      const effectiveBack =
        input.back_text !== undefined ? input.back_text : existing.back_text;
      if (!effectiveBack || effectiveBack.trim().length === 0) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Flashcards require non-empty back_text.",
          400,
        );
      }
    }

    const updatePayload: TablesUpdate<"questions"> = {};
    if (input.question_type !== undefined) updatePayload.question_type = input.question_type;
    if (input.position !== undefined) updatePayload.position = input.position;
    if (input.chapter !== undefined) updatePayload.chapter = input.chapter;
    if (input.prompt !== undefined) updatePayload.prompt = input.prompt;
    if (input.prompt_image_url !== undefined) updatePayload.prompt_image_url = input.prompt_image_url;
    if (input.back_text !== undefined) updatePayload.back_text = input.back_text;
    if (input.back_image_url !== undefined) updatePayload.back_image_url = input.back_image_url;
    if (input.explanation !== undefined) updatePayload.explanation = input.explanation;
    if (input.hint !== undefined) updatePayload.hint = input.hint;
    if (input.difficulty !== undefined) updatePayload.difficulty = input.difficulty;
    if (input.source_metadata !== undefined) updatePayload.source_metadata = input.source_metadata as Json;

    if (Object.keys(updatePayload).length > 0) {
      const { error: updErr } = await supabase
        .from("questions")
        .update(updatePayload)
        .eq("id", qId)
        .eq("study_set_id", setId);
      if (updErr) throw updErr;
    }

    // Update options in batched operations while preserving stable option UUIDs
    if (input.options !== undefined) {
      const { data: existingOpts, error: exOptErr } = await supabase
        .from("question_options")
        .select("id")
        .eq("question_id", qId)
        .eq("study_set_id", setId);
      if (exOptErr) throw exOptErr;

      const existingIds = new Set((existingOpts ?? []).map((o) => o.id));
      const keptIds = new Set<string>();
      const toUpdate: Array<{
        id: string;
        position: number;
        label: string;
        content: string;
        image_url: string | null;
        is_correct: boolean;
      }> = [];
      const toInsert: Array<{
        question_id: string;
        study_set_id: string;
        position: number;
        label: string;
        content: string;
        image_url: string | null;
        is_correct: boolean;
      }> = [];

      for (let idx = 0; idx < input.options.length; idx += 1) {
        const opt = input.options[idx];
        if (opt.id && existingIds.has(opt.id)) {
          keptIds.add(opt.id);
          toUpdate.push({
            id: opt.id,
            position: opt.position ?? idx,
            label: opt.label,
            content: opt.content,
            image_url: opt.image_url ?? null,
            is_correct: opt.is_correct,
          });
        } else {
          toInsert.push({
            question_id: qId,
            study_set_id: setId,
            position: opt.position ?? idx,
            label: opt.label,
            content: opt.content,
            image_url: opt.image_url ?? null,
            is_correct: opt.is_correct,
          });
        }
      }

      const toDelete = Array.from(existingIds).filter((oid) => !keptIds.has(oid));

      await Promise.all([
        ...toUpdate.map(async (u) => {
          const { error: optUpdErr } = await supabase
            .from("question_options")
            .update({
              position: u.position,
              label: u.label,
              content: u.content,
              image_url: u.image_url,
              is_correct: u.is_correct,
            })
            .eq("id", u.id)
            .eq("question_id", qId)
            .eq("study_set_id", setId);
          if (optUpdErr) throw optUpdErr;
        }),
        toInsert.length > 0
          ? supabase
              .from("question_options")
              .insert(toInsert)
              .then(({ error: insErr }) => {
                if (insErr) throw insErr;
              })
          : Promise.resolve(),
        toDelete.length > 0
          ? supabase
              .from("question_options")
              .delete()
              .in("id", toDelete)
              .eq("question_id", qId)
              .eq("study_set_id", setId)
              .then(({ error: delErr }) => {
                if (delErr) throw delErr;
              })
          : Promise.resolve(),
      ]);
    }

    if (input.accepted_answers !== undefined) {
      const { error: delAccErr } = await supabase
        .from("question_accepted_answers")
        .delete()
        .eq("question_id", qId)
        .eq("study_set_id", setId);
      if (delAccErr) throw delAccErr;

      if (input.accepted_answers.length > 0) {
        const { error: insAccErr } = await supabase
          .from("question_accepted_answers")
          .insert(
            input.accepted_answers.map((ans) => ({
              question_id: qId,
              study_set_id: setId,
              answer_text: ans.answer_text,
              normalized_answer: normalizeAnswerText(ans.answer_text, ans.match_mode),
              match_mode: ans.match_mode,
            })),
          );
        if (insAccErr) throw insAccErr;
      }
    }

    if (input.tags !== undefined) {
      const { error: delQtErr } = await supabase
        .from("question_tags")
        .delete()
        .eq("question_id", qId)
        .eq("study_set_id", setId);
      if (delQtErr) throw delQtErr;

      if (input.tags.length > 0) {
        const uniqueSlugs = new Map<string, string>();
        for (const name of input.tags) {
          uniqueSlugs.set(slugifyTag(name), name.trim());
        }
        const { data: upsertedTags, error: tagErr } = await supabase
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

        if (upsertedTags && upsertedTags.length > 0) {
          const { error: insQtErr } = await supabase.from("question_tags").insert(
            upsertedTags.map((t) => ({
              question_id: qId,
              tag_id: t.id,
              study_set_id: setId,
            })),
          );
          if (insQtErr) throw insQtErr;
        }
      }
    }

    const [{ data: updated, error: fetchErr }, relations] = await Promise.all([
      supabase.from("questions").select("*").eq("id", qId).single(),
      fetchQuestionRelationsChunked(supabase, [qId], setId),
    ]);

    if (fetchErr) throw fetchErr;

    return apiSuccess({
      ...updated,
      options: relations.optionsByQ.get(qId) ?? [],
      accepted_answers: relations.answersByQ.get(qId) ?? [],
      tags: relations.tagsByQ.get(qId) ?? [],
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
    const { id, questionId } = await context.params;
    const setId = uuidSchema.parse(id);
    const qId = uuidSchema.parse(questionId);

    await requireStudySetAccess(supabase, setId, user.id, "edit");

    const { data, error } = await supabase
      .from("questions")
      .delete()
      .eq("id", qId)
      .eq("study_set_id", setId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    return apiSuccess({ deleted: true, id: qId });
  } catch (err) {
    return handleApiError(err);
  }
}
