import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { normalizeAnswerText, slugifyTag } from "@/lib/security/sanitize";
import {
  chunkArray,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
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

    // Assign deterministic UUIDs upfront for 1:1 option/answer/tag mapping
    const preparedIds = questions.map(() => randomUUID());

    const questionRows = questions.map((q, idx) => ({
      id: preparedIds[idx],
      study_set_id: setId,
      question_type: q.question_type,
      position: q.position ?? basePos + idx,
      chapter: q.chapter ?? null,
      prompt: q.prompt,
      prompt_rich: (q.prompt_rich ?? null) as Json | null,
      prompt_image_url: q.prompt_image_url ?? null,
      back_text: q.back_text ?? null,
      back_rich: (q.back_rich ?? null) as Json | null,
      back_image_url: q.back_image_url ?? null,
      explanation: q.explanation ?? null,
      explanation_rich: (q.explanation_rich ?? null) as Json | null,
      hint: q.hint ?? null,
      hint_rich: (q.hint_rich ?? null) as Json | null,
      audio_media_id: q.audio_media_id ?? null,
      audio_url: q.audio_url ?? null,
      audio_transcript: q.audio_transcript ?? null,
      passage_id: q.passage_id ?? null,
      diagram_id: q.diagram_id ?? null,
      type_payload: (q.type_payload ?? null) as Json | null,
      difficulty: q.difficulty,
      source_metadata: (q.source_metadata ?? {}) as Json,
    }));

    for (const batch of chunkArray(questionRows, 200)) {
      const { error: insErr } = await supabase.from("questions").insert(batch);
      if (insErr) throw insErr;
    }

    const optionsToInsert: Array<{
      question_id: string;
      study_set_id: string;
      position: number;
      label: string;
      content: string;
      content_rich: Json | null;
      image_url: string | null;
      media_id: string | null;
      image_alt: string | null;
      is_correct: boolean;
    }> = [];

    const acceptedToInsert: Array<{
      question_id: string;
      study_set_id: string;
      answer_text: string;
      normalized_answer: string;
      match_mode: "exact" | "case_insensitive" | "ignore_diacritics" | "numeric";
    }> = [];

    const allTagSlugs = new Map<string, string>();
    const questionSlugLinks: Array<{ question_id: string; slug: string }> = [];

    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      const createdId = preparedIds[i];

      for (let oIdx = 0; oIdx < (q.options ?? []).length; oIdx += 1) {
        const opt = q.options![oIdx];
        optionsToInsert.push({
          question_id: createdId,
          study_set_id: setId,
          position: opt.position ?? oIdx,
          label: opt.label,
          content: opt.content,
          content_rich: (opt.content_rich ?? null) as Json | null,
          image_url: opt.image_url ?? null,
          media_id: opt.media_id ?? null,
          image_alt: opt.image_alt ?? null,
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

      for (const tagName of q.tags ?? []) {
        const slug = slugifyTag(tagName);
        allTagSlugs.set(slug, tagName.trim());
        questionSlugLinks.push({ question_id: createdId, slug });
      }
    }

    for (const batch of chunkArray(optionsToInsert, 400)) {
      const { error: optErr } = await supabase
        .from("question_options")
        .insert(batch);
      if (optErr) throw optErr;
    }

    for (const batch of chunkArray(acceptedToInsert, 400)) {
      const { error: accErr } = await supabase
        .from("question_accepted_answers")
        .insert(batch);
      if (accErr) throw accErr;
    }

    if (allTagSlugs.size > 0) {
      const { data: savedTags, error: tagErr } = await supabase
        .from("tags")
        .upsert(
          Array.from(allTagSlugs.entries()).map(([slug, name]) => ({
            owner_id: user.id,
            name,
            slug,
          })),
          { onConflict: "owner_id,slug" },
        )
        .select("id, slug");
      if (tagErr) throw tagErr;

      const slugToId = new Map((savedTags ?? []).map((t) => [t.slug, t.id]));
      const qtRows = questionSlugLinks
        .map((link) => {
          const tagId = slugToId.get(link.slug);
          if (!tagId) return null;
          return {
            question_id: link.question_id,
            tag_id: tagId,
            study_set_id: setId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      for (const batch of chunkArray(qtRows, 400)) {
        const { error: qtErr } = await supabase
          .from("question_tags")
          .upsert(batch, { onConflict: "question_id,tag_id", ignoreDuplicates: true });
        if (qtErr) throw qtErr;
      }
    }

    const { data: setVer } = await supabase
      .from("study_sets")
      .select("content_version")
      .eq("id", setId)
      .maybeSingle();
    if (setVer) {
      await supabase
        .from("study_sets")
        .update({ content_version: (setVer.content_version ?? 1) + 1 })
        .eq("id", setId);
    }

    return apiSuccess(
      {
        inserted_count: preparedIds.length,
        question_ids: preparedIds,
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

    const uniqueRequestedIds = Array.from(new Set(input.question_ids));

    // SH-012 / SEC-003 + SH-005: Verify EVERY question_id actually belongs to `setId` in safe chunks!
    const verifiedRows = await fetchInChunks(
      uniqueRequestedIds,
      async (chunk) =>
        supabase
          .from("questions")
          .select("id")
          .eq("study_set_id", setId)
          .in("id", chunk),
      SAFE_IN_CHUNK_SIZE,
    );

    const verifiedIds = verifiedRows.map((r) => r.id);
    if (verifiedIds.length !== uniqueRequestedIds.length) {
      throw new AppError(
        "INVALID_REFERENCE",
        "One or more question IDs do not belong to this study set.",
        400,
      );
    }

    const updates: TablesUpdate<"questions"> = {};
    if (input.chapter !== undefined) updates.chapter = input.chapter;
    if (input.difficulty !== undefined) updates.difficulty = input.difficulty;

    if (Object.keys(updates).length > 0) {
      for (const chunk of chunkArray(verifiedIds, SAFE_IN_CHUNK_SIZE)) {
        const { error: updErr } = await supabase
          .from("questions")
          .update(updates)
          .eq("study_set_id", setId)
          .in("id", chunk);
        if (updErr) throw updErr;
      }
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
      for (const qId of verifiedIds) {
        for (const t of tags ?? []) {
          joinRows.push({ question_id: qId, tag_id: t.id, study_set_id: setId });
        }
      }
      for (const batch of chunkArray(joinRows, 400)) {
        const { error: qtErr } = await supabase
          .from("question_tags")
          .upsert(batch, { onConflict: "question_id,tag_id" });
        if (qtErr) throw qtErr;
      }
    }

    if (input.remove_tag_ids && input.remove_tag_ids.length > 0) {
      for (const chunk of chunkArray(verifiedIds, SAFE_IN_CHUNK_SIZE)) {
        const { error: remErr } = await supabase
          .from("question_tags")
          .delete()
          .eq("study_set_id", setId)
          .in("question_id", chunk)
          .in("tag_id", input.remove_tag_ids);
        if (remErr) throw remErr;
      }
    }

    return apiSuccess({
      updated_count: verifiedIds.length,
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
    const uniqueIds = Array.from(new Set(question_ids));

    // SH-005: Chunk bulk deletes <= 100 UUIDs to avoid HTTP 414
    let deletedCount = 0;
    for (const chunk of chunkArray(uniqueIds, SAFE_IN_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("questions")
        .delete()
        .eq("study_set_id", setId)
        .in("id", chunk)
        .select("id");

      if (error) throw error;
      deletedCount += (data ?? []).length;
    }

    return apiSuccess({
      deleted_count: deletedCount,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
