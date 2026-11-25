import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  isMissingRpcError,
  rpcBumpStudySetContentVersion,
  rpcSaveDiagramPatch,
} from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { updateDiagramSchema } from "@/lib/validation/v3";
import type { Json, TablesInsert, TablesUpdate } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const diagramId = uuidSchema.parse(id);

    const { data: diagram, error } = await supabase
      .from("diagram_sets")
      .select("*")
      .eq("id", diagramId)
      .maybeSingle();

    if (error) throw error;
    if (!diagram) {
      throw new AppError("NOT_FOUND", "Diagram not found.", 404);
    }

    await requireStudySetAccess(supabase, diagram.study_set_id, user.id, "read");

    const { data: hotspots, error: hsErr } = await supabase
      .from("diagram_hotspots")
      .select("*")
      .eq("diagram_id", diagramId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (hsErr) throw hsErr;

    return apiSuccess({
      diagram: {
        ...diagram,
        hotspots: hotspots ?? [],
      },
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
    const diagramId = uuidSchema.parse(id);
    const body = updateDiagramSchema.parse(await parseJsonBody(request));

    // DB-02 & DB-10 (Migration 0019): Single-RTT atomic diagram update + batched hotspot upsert/delete
    // + atomic content_version increments on both diagram_sets and study_sets
    const rpcPatchPayload: Record<string, unknown> = {};
    if (body.title !== undefined) rpcPatchPayload.title = body.title;
    if (body.description !== undefined) rpcPatchPayload.description = body.description;
    if (body.base_media_id !== undefined) rpcPatchPayload.base_media_id = body.base_media_id;
    if (body.base_image_url !== undefined) rpcPatchPayload.base_image_url = body.base_image_url;
    if (body.image_width !== undefined) rpcPatchPayload.image_width = body.image_width;
    if (body.image_height !== undefined) rpcPatchPayload.image_height = body.image_height;

    const { data: rpcResult, error: rpcErr } = await rpcSaveDiagramPatch(
      supabase,
      {
        p_diagram_id: diagramId,
        p_patch: rpcPatchPayload,
        p_hotspots:
          body.hotspots !== undefined
            ? (body.hotspots as unknown as Array<Record<string, unknown>>)
            : null,
        p_replace_hotspots: body.hotspots !== undefined,
      },
    );
    if (!rpcErr && rpcResult) {
      return apiSuccess(rpcResult);
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      if (rpcErr.code === "P0002") {
        throw new AppError("NOT_FOUND", "Diagram not found.", 404);
      }
      if (rpcErr.code === "42501") {
        throw new AppError("FORBIDDEN", "You do not have permission to edit this diagram.", 403);
      }
      throw rpcErr;
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("diagram_sets")
      .select("*")
      .eq("id", diagramId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Diagram not found.", 404);
    }

    await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");

    const patch: TablesUpdate<"diagram_sets"> = {
      content_version: (existing.content_version ?? 1) + 1,
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.base_media_id !== undefined) patch.base_media_id = body.base_media_id;
    if (body.base_image_url !== undefined) patch.base_image_url = body.base_image_url;
    if (body.image_width !== undefined) patch.image_width = body.image_width;
    if (body.image_height !== undefined) patch.image_height = body.image_height;

    const { data: updated, error: updErr } = await supabase
      .from("diagram_sets")
      .update(patch)
      .eq("id", diagramId)
      .select("*")
      .single();

    if (updErr) throw updErr;

    if (body.base_media_id !== undefined) {
      await supabase
        .from("content_media_relations")
        .delete()
        .eq("entity_type", "diagram_set")
        .eq("entity_id", diagramId)
        .eq("role", "diagram_base");

      if (body.base_media_id) {
        await supabase.from("content_media_relations").insert({
          media_id: body.base_media_id,
          entity_type: "diagram_set",
          entity_id: diagramId,
          role: "diagram_base",
          sort_order: 0,
        });
      }
    }

    if (body.hotspots !== undefined) {
      // Preserve existing hotspot UUIDs where supplied, batch upserts & delete removed ones
      const { data: prevHotspots } = await supabase
        .from("diagram_hotspots")
        .select("id")
        .eq("diagram_id", diagramId);

      const prevIds = new Set((prevHotspots ?? []).map((h) => h.id));
      const keptIds = new Set<string>();
      const upsertRows: TablesInsert<"diagram_hotspots">[] = [];
      const insertRows: TablesInsert<"diagram_hotspots">[] = [];

      for (let i = 0; i < body.hotspots.length; i += 1) {
        const hs = body.hotspots[i];
        const commonData = {
          diagram_id: diagramId,
          study_set_id: existing.study_set_id,
          label: hs.label,
          accepted_alternatives: hs.accepted_alternatives,
          description: hs.description ?? null,
          hint: hs.hint ?? null,
          shape: hs.shape,
          geometry: hs.geometry as Json,
          sort_order: hs.sort_order ?? i,
        };

        if (hs.id && prevIds.has(hs.id)) {
          keptIds.add(hs.id);
          upsertRows.push({ id: hs.id, ...commonData });
        } else {
          insertRows.push(commonData);
        }
      }

      if (upsertRows.length > 0) {
        const { error: hsUpsertErr } = await supabase
          .from("diagram_hotspots")
          .upsert(upsertRows, { onConflict: "id" });
        if (hsUpsertErr) throw hsUpsertErr;
      }

      if (insertRows.length > 0) {
        const { data: insertedRows, error: hsInsErr } = await supabase
          .from("diagram_hotspots")
          .insert(insertRows)
          .select("id");
        if (hsInsErr) throw hsInsErr;
        for (const row of insertedRows ?? []) {
          if (row.id) keptIds.add(row.id);
        }
      }

      const toDelete = Array.from(prevIds).filter((oldId) => !keptIds.has(oldId));
      if (toDelete.length > 0) {
        const { error: hsDelErr } = await supabase
          .from("diagram_hotspots")
          .delete()
          .eq("diagram_id", diagramId)
          .in("id", toDelete);
        if (hsDelErr) throw hsDelErr;
      }
    }

    const { data: hotspots, error: hsErr } = await supabase
      .from("diagram_hotspots")
      .select("*")
      .eq("diagram_id", diagramId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (hsErr) throw hsErr;

    // DB-02: Atomic SQL increment of study_sets.content_version (with read-modify-write fallback)
    const { error: bumpErr } = await rpcBumpStudySetContentVersion(
      supabase,
      existing.study_set_id,
    );
    if (bumpErr && isMissingRpcError(bumpErr)) {
      const { data: setRow } = await supabase
        .from("study_sets")
        .select("content_version")
        .eq("id", existing.study_set_id)
        .maybeSingle();
      if (setRow) {
        await supabase
          .from("study_sets")
          .update({ content_version: (setRow.content_version ?? 1) + 1 })
          .eq("id", existing.study_set_id);
      }
    }

    return apiSuccess({
      diagram: {
        ...updated,
        hotspots: hotspots ?? [],
      },
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
    const { id } = await context.params;
    const diagramId = uuidSchema.parse(id);

    const { data: existing, error: fetchErr } = await supabase
      .from("diagram_sets")
      .select("id, study_set_id")
      .eq("id", diagramId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Diagram not found.", 404);
    }

    await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");

    const { error } = await supabase
      .from("diagram_sets")
      .delete()
      .eq("id", diagramId);

    if (error) throw error;
    return apiSuccess({ deleted: true, id: diagramId });
  } catch (err) {
    return handleApiError(err);
  }
}
