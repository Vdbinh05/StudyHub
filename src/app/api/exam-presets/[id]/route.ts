import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { verifyPresetSourcesAccess } from "@/lib/supabase/coverage-helper";
import { rpcGetExamEligiblePool } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { updateExamPresetSchema } from "@/lib/validation/exams";
import type { Json, TablesUpdate } from "@/types/database";
import type { ExamPreset, ExamPresetSource } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data: preset, error } = await supabase
      .from("exam_presets")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!preset) {
      throw new AppError("NOT_FOUND", "Exam preset not found.", 404);
    }

    const { data: sources, error: srcErr } = await supabase
      .from("exam_preset_sources")
      .select("*")
      .eq("preset_id", id)
      .order("sort_order", { ascending: true });

    if (srcErr) throw srcErr;

    const folderIds = (sources ?? [])
      .map((s) => s.folder_id)
      .filter((fid): fid is string => Boolean(fid));
    const studySetIds = (sources ?? [])
      .map((s) => s.study_set_id)
      .filter((sid): sid is string => Boolean(sid));

    let currentEligibleCount = 0;
    if (folderIds.length > 0 || studySetIds.length > 0) {
      const { data: pool } = await rpcGetExamEligiblePool(supabase, {
        p_folder_ids: folderIds,
        p_study_set_ids: studySetIds,
        p_include_subfolders: (sources ?? []).some((s) => s.include_subfolders),
        p_filters: (preset.filters ?? {}) as Record<string, unknown>,
        p_selection_policy: preset.selection_policy,
      });
      currentEligibleCount = pool?.total_eligible ?? 0;
    }

    const result: ExamPreset = {
      ...preset,
      filters: (preset.filters ?? {}) as ExamPreset["filters"],
      sources: (sources ?? []) as ExamPresetSource[],
      current_eligible_count: currentEligibleCount,
    };

    return apiSuccess(result);
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
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data: existing, error: fetchErr } = await supabase
      .from("exam_presets")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Exam preset not found.", 404);
    }

    const body = await parseJsonBody(request);
    const input = updateExamPresetSchema.parse(body);

    if (input.sources) {
      await verifyPresetSourcesAccess(supabase, user.id, input.sources);
    }

    const updatePayload: TablesUpdate<"exam_presets"> = {};
    if (input.name !== undefined) updatePayload.name = input.name;
    if (input.description !== undefined) updatePayload.description = input.description;
    if (input.is_favorite !== undefined) updatePayload.is_favorite = input.is_favorite;
    if (input.requested_question_count !== undefined)
      updatePayload.requested_question_count = input.requested_question_count;
    if (input.allocation_strategy !== undefined)
      updatePayload.allocation_strategy = input.allocation_strategy;
    if (input.selection_policy !== undefined)
      updatePayload.selection_policy = input.selection_policy;
    if (input.full_coverage_mode !== undefined)
      updatePayload.full_coverage_mode = input.full_coverage_mode;
    if (input.duration_limit_seconds !== undefined)
      updatePayload.duration_limit_seconds = input.duration_limit_seconds;
    if (input.pass_threshold !== undefined)
      updatePayload.pass_threshold = input.pass_threshold;
    if (input.shuffle_questions !== undefined)
      updatePayload.shuffle_questions = input.shuffle_questions;
    if (input.shuffle_options !== undefined)
      updatePayload.shuffle_options = input.shuffle_options;
    if (input.show_subject_names !== undefined)
      updatePayload.show_subject_names = input.show_subject_names;
    if (input.show_chapter_names !== undefined)
      updatePayload.show_chapter_names = input.show_chapter_names;
    if (input.allow_navigation !== undefined)
      updatePayload.allow_navigation = input.allow_navigation;
    if (input.allow_mark_for_review !== undefined)
      updatePayload.allow_mark_for_review = input.allow_mark_for_review;
    if (input.auto_submit_on_expire !== undefined)
      updatePayload.auto_submit_on_expire = input.auto_submit_on_expire;
    if (input.show_review_after_submit !== undefined)
      updatePayload.show_review_after_submit = input.show_review_after_submit;
    if (input.filters !== undefined) {
      updatePayload.filters = input.filters as unknown as Json;
    }

    let updatedPreset;
    if (Object.keys(updatePayload).length > 0) {
      const { data, error: updErr } = await supabase
        .from("exam_presets")
        .update(updatePayload)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single();
      if (updErr) throw updErr;
      updatedPreset = data;
    } else {
      const { data, error: reErr } = await supabase
        .from("exam_presets")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (reErr) throw reErr;
      updatedPreset = data;
    }

    if (input.sources) {
      const { error: delErr } = await supabase
        .from("exam_preset_sources")
        .delete()
        .eq("preset_id", id);
      if (delErr) throw delErr;

      const seenKeys = new Set<string>();
      const sourceInserts = input.sources
        .filter((s) => {
          const key = `${s.source_type}:${s.id}`;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        })
        .map((s, idx) => ({
          preset_id: id,
          source_type: s.source_type,
          study_set_id: s.source_type === "study_set" ? s.id : null,
          folder_id: s.source_type === "folder" ? s.id : null,
          include_subfolders: s.include_subfolders ?? true,
          custom_count: s.custom_count ?? null,
          custom_percentage: s.custom_percentage ?? null,
          sort_order: idx,
        }));

      if (sourceInserts.length > 0) {
        const { error: insErr } = await supabase
          .from("exam_preset_sources")
          .insert(sourceInserts);
        if (insErr) throw insErr;
      }
    }

    const { data: sources, error: srcErr } = await supabase
      .from("exam_preset_sources")
      .select("*")
      .eq("preset_id", id)
      .order("sort_order", { ascending: true });

    if (srcErr) throw srcErr;

    const result: ExamPreset = {
      ...updatedPreset,
      filters: (updatedPreset.filters ?? {}) as ExamPreset["filters"],
      sources: (sources ?? []) as ExamPresetSource[],
    };

    return apiSuccess(result);
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
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data, error } = await supabase
      .from("exam_presets")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Exam preset not found.", 404);
    }

    return apiSuccess({ deleted: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}
