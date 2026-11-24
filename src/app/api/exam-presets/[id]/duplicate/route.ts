import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseOptionalJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { duplicateExamPresetSchema } from "@/lib/validation/exams";
import type { ExamPreset, ExamPresetSource } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    let customName: string | undefined;
    const body = await parseOptionalJsonBody(request);
    if (body !== undefined) {
      const parsed = duplicateExamPresetSchema.parse(body);
      customName = parsed?.name;
    }

    const { data: sourcePreset, error: fetchErr } = await supabase
      .from("exam_presets")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!sourcePreset) {
      throw new AppError("NOT_FOUND", "Exam preset not found.", 404);
    }

    const { data: sources, error: srcErr } = await supabase
      .from("exam_preset_sources")
      .select("*")
      .eq("preset_id", id)
      .order("sort_order", { ascending: true });

    if (srcErr) throw srcErr;

    const newName = (customName ?? `${sourcePreset.name} (Copy)`).slice(0, 160);

    const { data: cloned, error: insertErr } = await supabase
      .from("exam_presets")
      .insert({
        user_id: user.id,
        name: newName,
        description: sourcePreset.description,
        is_favorite: false,
        requested_question_count: sourcePreset.requested_question_count,
        allocation_strategy: sourcePreset.allocation_strategy,
        selection_policy: sourcePreset.selection_policy,
        full_coverage_mode: sourcePreset.full_coverage_mode,
        duration_limit_seconds: sourcePreset.duration_limit_seconds,
        pass_threshold: sourcePreset.pass_threshold,
        shuffle_questions: sourcePreset.shuffle_questions,
        shuffle_options: sourcePreset.shuffle_options,
        show_subject_names: sourcePreset.show_subject_names,
        show_chapter_names: sourcePreset.show_chapter_names,
        allow_navigation: sourcePreset.allow_navigation,
        allow_mark_for_review: sourcePreset.allow_mark_for_review,
        auto_submit_on_expire: sourcePreset.auto_submit_on_expire,
        show_review_after_submit: sourcePreset.show_review_after_submit,
        filters: sourcePreset.filters,
        use_count: 0,
        last_used_at: null,
      })
      .select("*")
      .single();

    if (insertErr) throw insertErr;

    let clonedSources: ExamPresetSource[] = [];
    if ((sources ?? []).length > 0) {
      const { data: insertedSources, error: copySrcErr } = await supabase
        .from("exam_preset_sources")
        .insert(
          (sources ?? []).map((s) => ({
            preset_id: cloned.id,
            source_type: s.source_type,
            study_set_id: s.study_set_id,
            folder_id: s.folder_id,
            include_subfolders: s.include_subfolders,
            custom_count: s.custom_count,
            custom_percentage: s.custom_percentage,
            sort_order: s.sort_order,
          })),
        )
        .select("*");

      if (copySrcErr) {
        await supabase.from("exam_presets").delete().eq("id", cloned.id);
        throw copySrcErr;
      }
      clonedSources = (insertedSources ?? []) as ExamPresetSource[];
    }

    const result: ExamPreset = {
      ...cloned,
      filters: (cloned.filters ?? {}) as ExamPreset["filters"],
      sources: clonedSources,
    };

    return apiSuccess(result, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
