import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { uuidSchema } from "@/lib/validation/common";
import { duplicateStudySetSchema } from "@/lib/validation/sets";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CHUNK_SIZE = 250;

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.SET_CLONE, user.id);
    if (limited) return limited;

    const { id } = await context.params;
    const sourceSetId = uuidSchema.parse(id);

    const rawBody = await request.text();
    const parsedBody = rawBody.trim()
      ? duplicateStudySetSchema.parse(await parseJsonBody(new Request(request.url, { method: "POST", body: rawBody })))
      : undefined;

    const access = await requireStudySetAccess(
      supabase,
      sourceSetId,
      user.id,
      "read",
    );

    if (parsedBody?.folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", parsedBody.folder_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!folder) {
        throw new AppError("NOT_FOUND", "Target folder not found.", 404);
      }
    }

    const newTitle =
      parsedBody?.title ??
      `${access.studySet.title} (Copy)`.slice(0, 200);

    const { data: clonedSet, error: createSetError } = await supabase
      .from("study_sets")
      .insert({
        owner_id: user.id,
        folder_id: parsedBody?.folder_id ?? null,
        title: newTitle,
        description: access.studySet.description,
        subject: access.studySet.subject,
        set_type: access.studySet.set_type,
        visibility: "private",
        source_language: access.studySet.source_language,
        default_exam_duration_minutes:
          access.studySet.default_exam_duration_minutes,
        default_pass_threshold: access.studySet.default_pass_threshold,
      })
      .select("*")
      .single();

    if (createSetError) throw createSetError;

    // Fetch source questions, options, and accepted answers
    const [
      { data: questions, error: qErr },
      { data: options, error: optErr },
      { data: accepted, error: accErr },
    ] = await Promise.all([
      supabase
        .from("questions")
        .select("*")
        .eq("study_set_id", sourceSetId)
        .order("position", { ascending: true }),
      supabase
        .from("question_options")
        .select("*")
        .eq("study_set_id", sourceSetId)
        .order("position", { ascending: true }),
      supabase
        .from("question_accepted_answers")
        .select("*")
        .eq("study_set_id", sourceSetId),
    ]);

    if (qErr) throw qErr;
    if (optErr) throw optErr;
    if (accErr) throw accErr;

    const optionsByQuestion = new Map<string, typeof options>();
    for (const opt of options ?? []) {
      const list = optionsByQuestion.get(opt.question_id) ?? [];
      list.push(opt);
      optionsByQuestion.set(opt.question_id, list);
    }

    const acceptedByQuestion = new Map<string, typeof accepted>();
    for (const acc of accepted ?? []) {
      const list = acceptedByQuestion.get(acc.question_id) ?? [];
      list.push(acc);
      acceptedByQuestion.set(acc.question_id, list);
    }

    const sourceQuestions = questions ?? [];

    for (let i = 0; i < sourceQuestions.length; i += CHUNK_SIZE) {
      const chunk = sourceQuestions.slice(i, i + CHUNK_SIZE);

      const { data: insertedQuestions, error: insQErr } = await supabase
        .from("questions")
        .insert(
          chunk.map((q) => ({
            study_set_id: clonedSet.id,
            question_type: q.question_type,
            position: q.position,
            chapter: q.chapter,
            prompt: q.prompt,
            prompt_image_url: q.prompt_image_url,
            back_text: q.back_text,
            back_image_url: q.back_image_url,
            explanation: q.explanation,
            hint: q.hint,
            difficulty: q.difficulty,
            source_metadata: q.source_metadata,
          })),
        )
        .select("id, position");

      if (insQErr) throw insQErr;

      const newIdByPos = new Map<number, string>();
      for (const iq of insertedQuestions ?? []) {
        newIdByPos.set(iq.position, iq.id);
      }

      const newOptions: Array<{
        question_id: string;
        study_set_id: string;
        position: number;
        label: string;
        content: string;
        image_url: string | null;
        is_correct: boolean;
      }> = [];

      const newAccepted: Array<{
        question_id: string;
        study_set_id: string;
        answer_text: string;
        normalized_answer: string;
        match_mode: "exact" | "case_insensitive" | "ignore_diacritics" | "numeric";
      }> = [];

      for (const oldQ of chunk) {
        const newQId = newIdByPos.get(oldQ.position);
        if (!newQId) continue;

        for (const opt of optionsByQuestion.get(oldQ.id) ?? []) {
          newOptions.push({
            question_id: newQId,
            study_set_id: clonedSet.id,
            position: opt.position,
            label: opt.label,
            content: opt.content,
            image_url: opt.image_url,
            is_correct: opt.is_correct,
          });
        }

        for (const acc of acceptedByQuestion.get(oldQ.id) ?? []) {
          newAccepted.push({
            question_id: newQId,
            study_set_id: clonedSet.id,
            answer_text: acc.answer_text,
            normalized_answer: acc.normalized_answer,
            match_mode: acc.match_mode,
          });
        }
      }

      if (newOptions.length > 0) {
        const { error: insOptErr } = await supabase
          .from("question_options")
          .insert(newOptions);
        if (insOptErr) throw insOptErr;
      }

      if (newAccepted.length > 0) {
        const { error: insAccErr } = await supabase
          .from("question_accepted_answers")
          .insert(newAccepted);
        if (insAccErr) throw insAccErr;
      }
    }

    const { data: refreshedSet } = await supabase
      .from("study_sets")
      .select("*")
      .eq("id", clonedSet.id)
      .single();

    return apiSuccess(refreshedSet ?? clonedSet, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
