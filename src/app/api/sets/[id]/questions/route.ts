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
  createQuestionSchema,
  listQuestionsQuerySchema,
} from "@/lib/validation/questions";
import type { Json } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "read");

    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listQuestionsQuerySchema.parse(rawParams);

    let filterIds: string[] | null = null;

    if (query.starredOnly) {
      const { data: starredRows, error: starErr } = await supabase
        .from("starred_questions")
        .select("question_id")
        .eq("user_id", user.id)
        .eq("study_set_id", setId);
      if (starErr) throw starErr;
      filterIds = (starredRows ?? []).map((r) => r.question_id);
      if (filterIds.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    if (query.tagId) {
      const { data: tagRows, error: tagErr } = await supabase
        .from("question_tags")
        .select("question_id")
        .eq("study_set_id", setId)
        .eq("tag_id", query.tagId);
      if (tagErr) throw tagErr;
      const taggedIds = (tagRows ?? []).map((r) => r.question_id);
      if (filterIds === null) {
        filterIds = taggedIds;
      } else {
        const setA = new Set(taggedIds);
        filterIds = filterIds.filter((qId) => setA.has(qId));
      }
      if (filterIds.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }
    }

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let qQuery = supabase
      .from("questions")
      .select("*", { count: "exact" })
      .eq("study_set_id", setId);

    if (filterIds !== null) {
      qQuery = qQuery.in("id", filterIds);
    }
    if (query.chapter) {
      qQuery = qQuery.eq("chapter", query.chapter);
    }
    if (query.difficulty) {
      qQuery = qQuery.eq("difficulty", query.difficulty);
    }
    if (query.questionType) {
      qQuery = qQuery.eq("question_type", query.questionType);
    }
    if (query.search) {
      const escaped = query.search.replace(/[%_,]/g, "");
      if (escaped) {
        qQuery = qQuery.or(
          `prompt.ilike.%${escaped}%,back_text.ilike.%${escaped}%,explanation.ilike.%${escaped}%`,
        );
      }
    }

    const { data: questions, count, error } = await qQuery
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = questions ?? [];
    const questionIds = rows.map((q) => q.id);

    if (questionIds.length === 0) {
      return apiSuccess([], {
        total: count ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const [
      { data: options, error: optErr },
      { data: accepted, error: accErr },
      { data: qTags, error: qtErr },
      { data: starred, error: starErr },
      { data: progress, error: progErr },
    ] = await Promise.all([
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", questionIds)
        .order("position", { ascending: true }),
      supabase
        .from("question_accepted_answers")
        .select("*")
        .in("question_id", questionIds),
      supabase
        .from("question_tags")
        .select("question_id, tag_id")
        .in("question_id", questionIds),
      supabase
        .from("starred_questions")
        .select("question_id")
        .eq("user_id", user.id)
        .in("question_id", questionIds),
      supabase
        .from("user_question_progress")
        .select("question_id, mastery_level, correct_count, wrong_count, next_review_at")
        .eq("user_id", user.id)
        .in("question_id", questionIds),
    ]);

    if (optErr) throw optErr;
    if (accErr) throw accErr;
    if (qtErr) throw qtErr;
    if (starErr) throw starErr;
    if (progErr) throw progErr;

    const tagIds = Array.from(new Set((qTags ?? []).map((t) => t.tag_id)));
    const { data: tags } =
      tagIds.length > 0
        ? await supabase.from("tags").select("*").in("id", tagIds)
        : { data: [] };

    const tagMap = new Map((tags ?? []).map((t) => [t.id, t]));
    const optionsMap = new Map<string, typeof options>();
    for (const o of options ?? []) {
      const list = optionsMap.get(o.question_id) ?? [];
      list.push(o);
      optionsMap.set(o.question_id, list);
    }

    const acceptedMap = new Map<string, typeof accepted>();
    for (const a of accepted ?? []) {
      const list = acceptedMap.get(a.question_id) ?? [];
      list.push(a);
      acceptedMap.set(a.question_id, list);
    }

    const tagsByQuestion = new Map<string, Array<NonNullable<typeof tags>[number]>>();
    for (const qt of qTags ?? []) {
      const tag = tagMap.get(qt.tag_id);
      if (!tag) continue;
      const list = tagsByQuestion.get(qt.question_id) ?? [];
      list.push(tag);
      tagsByQuestion.set(qt.question_id, list);
    }

    const starredSet = new Set((starred ?? []).map((s) => s.question_id));
    const progressMap = new Map((progress ?? []).map((p) => [p.question_id, p]));

    const enriched = rows.map((q) => ({
      ...q,
      options: optionsMap.get(q.id) ?? [],
      accepted_answers: acceptedMap.get(q.id) ?? [],
      tags: tagsByQuestion.get(q.id) ?? [],
      is_starred: starredSet.has(q.id),
      progress: progressMap.get(q.id) ?? null,
    }));

    const total = count ?? enriched.length;
    return apiSuccess(enriched, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + enriched.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
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
    const input = createQuestionSchema.parse(body);

    let position = input.position;
    if (position === undefined) {
      const { data: lastQ } = await supabase
        .from("questions")
        .select("position")
        .eq("study_set_id", setId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      position = lastQ ? lastQ.position + 1 : 0;
    }

    const { data: created, error: createErr } = await supabase
      .from("questions")
      .insert({
        study_set_id: setId,
        question_type: input.question_type,
        position,
        chapter: input.chapter ?? null,
        prompt: input.prompt,
        prompt_image_url: input.prompt_image_url ?? null,
        back_text: input.back_text ?? null,
        back_image_url: input.back_image_url ?? null,
        explanation: input.explanation ?? null,
        hint: input.hint ?? null,
        difficulty: input.difficulty,
        source_metadata: (input.source_metadata ?? {}) as Json,
      })
      .select("*")
      .single();

    if (createErr) throw createErr;

    let insertedOptions: unknown[] = [];
    if (input.options && input.options.length > 0) {
      const { data: opts, error: optErr } = await supabase
        .from("question_options")
        .insert(
          input.options.map((opt, idx) => ({
            question_id: created.id,
            study_set_id: setId,
            position: opt.position ?? idx,
            label: opt.label,
            content: opt.content,
            image_url: opt.image_url ?? null,
            is_correct: opt.is_correct,
          })),
        )
        .select("*")
        .order("position", { ascending: true });

      if (optErr) throw optErr;
      insertedOptions = opts ?? [];
    }

    let insertedAccepted: unknown[] = [];
    if (input.accepted_answers && input.accepted_answers.length > 0) {
      const { data: accs, error: accErr } = await supabase
        .from("question_accepted_answers")
        .insert(
          input.accepted_answers.map((ans) => ({
            question_id: created.id,
            study_set_id: setId,
            answer_text: ans.answer_text,
            normalized_answer: normalizeAnswerText(ans.answer_text, ans.match_mode),
            match_mode: ans.match_mode,
          })),
        )
        .select("*");

      if (accErr) throw accErr;
      insertedAccepted = accs ?? [];
    }

    const attachedTags: unknown[] = [];
    if (input.tags && input.tags.length > 0) {
      const uniqueSlugs = new Map<string, string>();
      for (const name of input.tags) {
        uniqueSlugs.set(slugifyTag(name), name.trim());
      }

      const tagRows = Array.from(uniqueSlugs.entries()).map(([slug, name]) => ({
        owner_id: user.id,
        name,
        slug,
      }));

      const { data: upsertedTags, error: tagErr } = await supabase
        .from("tags")
        .upsert(tagRows, { onConflict: "owner_id,slug" })
        .select("*");

      if (tagErr) throw tagErr;

      if (upsertedTags && upsertedTags.length > 0) {
        const { error: qtErr } = await supabase.from("question_tags").upsert(
          upsertedTags.map((t) => ({
            question_id: created.id,
            tag_id: t.id,
            study_set_id: setId,
          })),
          { onConflict: "question_id,tag_id" },
        );
        if (qtErr) throw qtErr;
        attachedTags.push(...upsertedTags);
      }
    }

    return apiSuccess(
      {
        ...created,
        options: insertedOptions,
        accepted_answers: insertedAccepted,
        tags: attachedTags,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
