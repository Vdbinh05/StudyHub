import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { sanitizePostgrestSearch } from "@/lib/security/sanitize";
import { verifyPresetSourcesAccess } from "@/lib/supabase/coverage-helper";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import {
  createExamPresetSchema,
  listExamPresetsQuerySchema,
} from "@/lib/validation/exams";
import type { Json } from "@/types/database";
import type { ExamPreset, ExamPresetSource } from "@/types/domain";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listExamPresetsQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("exam_presets")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.favoritesOnly) {
      dbQuery = dbQuery.eq("is_favorite", true);
    }
    if (query.search) {
      const clean = sanitizePostgrestSearch(query.search);
      if (clean.length > 0) {
        dbQuery = dbQuery.or(`name.ilike.%${clean}%,description.ilike.%${clean}%`);
      }
    }

    const { data: presets, count, error } = await dbQuery
      .order("is_favorite", { ascending: false })
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const presetRows = presets ?? [];
    const presetIds = presetRows.map((p) => p.id);

    const sourcesByPreset = new Map<string, ExamPresetSource[]>();
    if (presetIds.length > 0) {
      const sourceRows = await fetchInChunks(
        presetIds,
        async (chunk) =>
          supabase
            .from("exam_preset_sources")
            .select("*")
            .in("preset_id", chunk)
            .order("sort_order", { ascending: true }),
        SAFE_IN_CHUNK_SIZE,
      );

      const setIds = Array.from(
        new Set(
          sourceRows
            .map((s) => s.study_set_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const folderIds = Array.from(
        new Set(
          sourceRows
            .map((s) => s.folder_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const [sets, folders] = await Promise.all([
        fetchInChunks(
          setIds,
          async (chunk) =>
            supabase.from("study_sets").select("id, title").in("id", chunk),
          SAFE_IN_CHUNK_SIZE,
        ),
        fetchInChunks(
          folderIds,
          async (chunk) =>
            supabase.from("folders").select("id, name").in("id", chunk),
          SAFE_IN_CHUNK_SIZE,
        ),
      ]);

      const setTitleMap = new Map(sets.map((s) => [s.id, s.title]));
      const folderNameMap = new Map(folders.map((f) => [f.id, f.name]));

      for (const s of sourceRows) {
        const enriched: ExamPresetSource = {
          ...s,
          title:
            s.source_type === "study_set"
              ? (s.study_set_id ? setTitleMap.get(s.study_set_id) : null) ?? null
              : (s.folder_id ? folderNameMap.get(s.folder_id) : null) ?? null,
        };
        const arr = sourcesByPreset.get(s.preset_id) ?? [];
        arr.push(enriched);
        sourcesByPreset.set(s.preset_id, arr);
      }
    }

    const enriched: ExamPreset[] = presetRows.map((p) => ({
      ...p,
      filters: (p.filters ?? {}) as ExamPreset["filters"],
      sources: sourcesByPreset.get(p.id) ?? [],
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = createExamPresetSchema.parse(body);

    await verifyPresetSourcesAccess(supabase, user.id, input.sources);

    const { data: preset, error: createErr } = await supabase
      .from("exam_presets")
      .insert({
        user_id: user.id,
        name: input.name,
        description: input.description ?? null,
        is_favorite: input.is_favorite,
        requested_question_count: input.requested_question_count ?? null,
        allocation_strategy: input.allocation_strategy,
        selection_policy: input.selection_policy,
        full_coverage_mode: input.full_coverage_mode,
        duration_limit_seconds: input.duration_limit_seconds ?? null,
        pass_threshold: input.pass_threshold,
        shuffle_questions: input.shuffle_questions,
        shuffle_options: input.shuffle_options,
        show_subject_names: input.show_subject_names,
        show_chapter_names: input.show_chapter_names,
        allow_navigation: input.allow_navigation,
        allow_mark_for_review: input.allow_mark_for_review,
        auto_submit_on_expire: input.auto_submit_on_expire,
        show_review_after_submit: input.show_review_after_submit,
        filters: input.filters as unknown as Json,
      })
      .select("*")
      .single();

    if (createErr) throw createErr;

    // Deduplicate source targets by (source_type, id)
    const seenKeys = new Set<string>();
    const sourceInserts = input.sources
      .filter((s) => {
        const key = `${s.source_type}:${s.id}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      })
      .map((s, idx) => ({
        preset_id: preset.id,
        source_type: s.source_type,
        study_set_id: s.source_type === "study_set" ? s.id : null,
        folder_id: s.source_type === "folder" ? s.id : null,
        include_subfolders: s.include_subfolders ?? true,
        custom_count: s.custom_count ?? null,
        custom_percentage: s.custom_percentage ?? null,
        sort_order: idx,
      }));

    const { data: createdSources, error: srcErr } = await supabase
      .from("exam_preset_sources")
      .insert(sourceInserts)
      .select("*");

    if (srcErr) {
      await supabase.from("exam_presets").delete().eq("id", preset.id);
      throw srcErr;
    }

    const result: ExamPreset = {
      ...preset,
      filters: (preset.filters ?? {}) as ExamPreset["filters"],
      sources: (createdSources ?? []) as ExamPresetSource[],
    };

    return apiSuccess(result, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
