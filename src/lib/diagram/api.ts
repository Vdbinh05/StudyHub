import { apiFetch } from "@/components/layout/api-client";
import type { DiagramHotspot, DiagramSet, HotspotGeometry, HotspotShape } from "@/types/v3";

export interface UpsertDiagramHotspotInput {
  id?: string;
  label: string;
  accepted_alternatives: string[];
  description: string | null;
  hint: string | null;
  shape: HotspotShape;
  geometry: HotspotGeometry;
  sort_order: number;
}

export interface CreateDiagramInput {
  study_set_id: string;
  title: string;
  description: string | null;
  base_media_id?: string | null;
  base_image_url: string;
  image_width?: number | null;
  image_height?: number | null;
  hotspots?: UpsertDiagramHotspotInput[];
}

export interface UpdateDiagramInput {
  title?: string;
  description?: string | null;
  base_media_id?: string | null;
  base_image_url?: string;
  image_width?: number | null;
  image_height?: number | null;
  hotspots?: UpsertDiagramHotspotInput[];
}

export async function listStudySetDiagrams(studySetId: string): Promise<DiagramSet[]> {
  const res = await apiFetch<DiagramSet[] | { diagrams: DiagramSet[] }>(
    `/api/sets/${encodeURIComponent(studySetId)}/diagrams`,
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && Array.isArray(res.data.diagrams)) return res.data.diagrams;
  return [];
}

export async function getDiagramDetail(diagramId: string): Promise<DiagramSet> {
  const res = await apiFetch<DiagramSet | { diagram: DiagramSet }>(
    `/api/diagrams/${encodeURIComponent(diagramId)}`,
  );
  if (res.data && "diagram" in res.data && res.data.diagram) {
    return res.data.diagram;
  }
  return res.data as DiagramSet;
}

export async function createDiagram(input: CreateDiagramInput): Promise<DiagramSet> {
  const res = await apiFetch<DiagramSet | { diagram: DiagramSet }>("/api/diagrams", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.data && "diagram" in res.data && res.data.diagram) {
    return res.data.diagram;
  }
  return res.data as DiagramSet;
}

export async function updateDiagram(
  diagramId: string,
  input: UpdateDiagramInput,
): Promise<DiagramSet> {
  const res = await apiFetch<DiagramSet | { diagram: DiagramSet }>(
    `/api/diagrams/${encodeURIComponent(diagramId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  if (res.data && "diagram" in res.data && res.data.diagram) {
    return res.data.diagram;
  }
  return res.data as DiagramSet;
}

export async function deleteDiagram(diagramId: string): Promise<void> {
  await apiFetch<unknown>(`/api/diagrams/${encodeURIComponent(diagramId)}`, {
    method: "DELETE",
  });
}

export function normalizeDiagramHotspots(diagram: DiagramSet): DiagramHotspot[] {
  return [...(diagram.hotspots ?? [])].sort((a, b) => a.sort_order - b.sort_order);
}
