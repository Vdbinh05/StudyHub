import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { createDiagramSchema } from "@/lib/validation/v3";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const rawSetId = sp.get("study_set_id") ?? sp.get("studySetId");

    if (rawSetId) {
      const studySetId = uuidSchema.parse(rawSetId);
      await requireStudySetAccess(supabase, studySetId, user.id, "read");

      const { data: diagrams, error } = await supabase
        .from("diagram_sets")
        .select("*")
        .eq("study_set_id", studySetId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const diagramIds = (diagrams ?? []).map((d) => d.id);
      const hotspotsByDiagram = new Map<string, Array<Record<string, unknown>>>();

      if (diagramIds.length > 0) {
        const { data: hotspots, error: hsErr } = await supabase
          .from("diagram_hotspots")
          .select("*")
          .in("diagram_id", diagramIds)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });

        if (hsErr) throw hsErr;
        for (const hs of hotspots ?? []) {
          const list = hotspotsByDiagram.get(hs.diagram_id) ?? [];
          list.push(hs);
          hotspotsByDiagram.set(hs.diagram_id, list);
        }
      }

      const enriched = (diagrams ?? []).map((d) => ({
        ...d,
        hotspots: hotspotsByDiagram.get(d.id) ?? [],
      }));

      return apiSuccess({ diagrams: enriched });
    }

    // List caller's own diagrams across all sets when no study_set_id is given
    const { data: diagrams, error } = await supabase
      .from("diagram_sets")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    return apiSuccess({ diagrams: diagrams ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = createDiagramSchema.parse(await parseJsonBody(request));
    await requireStudySetAccess(supabase, body.study_set_id, user.id, "edit");

    const { data: diagram, error: createErr } = await supabase
      .from("diagram_sets")
      .insert({
        study_set_id: body.study_set_id,
        owner_id: user.id,
        title: body.title,
        description: body.description ?? null,
        base_media_id: body.base_media_id ?? null,
        base_image_url: body.base_image_url,
        image_width: body.image_width ?? null,
        image_height: body.image_height ?? null,
      })
      .select("*")
      .single();

    if (createErr) throw createErr;

    if (body.base_media_id) {
      await supabase.from("content_media_relations").insert({
        media_id: body.base_media_id,
        entity_type: "diagram_set",
        entity_id: diagram.id,
        role: "diagram_base",
        sort_order: 0,
      });
    }

    let createdHotspots: Array<Record<string, unknown>> = [];
    if (body.hotspots.length > 0) {
      const hotspotRows = body.hotspots.map((hs, idx) => ({
        diagram_id: diagram.id,
        study_set_id: body.study_set_id,
        label: hs.label,
        accepted_alternatives: hs.accepted_alternatives,
        description: hs.description ?? null,
        hint: hs.hint ?? null,
        shape: hs.shape,
        geometry: hs.geometry,
        sort_order: hs.sort_order ?? idx,
      }));

      const { data: hsData, error: hsErr } = await supabase
        .from("diagram_hotspots")
        .insert(hotspotRows)
        .select("*");

      if (hsErr) {
        await supabase.from("diagram_sets").delete().eq("id", diagram.id);
        throw hsErr;
      }
      createdHotspots = (hsData ?? []).sort((a, b) => a.sort_order - b.sort_order);
    }

    // Bump study_sets.content_version for offline freshness detection
    const { data: setRow } = await supabase
      .from("study_sets")
      .select("content_version")
      .eq("id", body.study_set_id)
      .maybeSingle();
    if (setRow) {
      await supabase
        .from("study_sets")
        .update({ content_version: (setRow.content_version ?? 1) + 1 })
        .eq("id", body.study_set_id);
    }

    return apiSuccess(
      { diagram: { ...diagram, hotspots: createdHotspots } },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
