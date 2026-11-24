import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Lists all interactive diagrams (with nested hotspots) belonging to a study set.
 * Used by Study Set Diagrams Hub and the V3 Offline Download Manager.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const studySetId = uuidSchema.parse(id);

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
  } catch (err) {
    return handleApiError(err);
  }
}
