import { apiFetch } from "@/components/layout/api-client";
import type {
  ContentMediaRelation,
  MediaAsset,
  MediaAttachmentRole,
  MediaEntityType,
  MediaKind,
} from "@/types/v3";

export interface ListMediaAssetsParams {
  studySetId?: string;
  kind?: MediaKind;
  page?: number;
  pageSize?: number;
}

export interface AttachMediaRelationInput {
  media_id: string;
  entity_type: Exclude<MediaEntityType, "exam_attempt_question">;
  entity_id: string;
  role: MediaAttachmentRole;
  sort_order?: number;
  alt_text?: string | null;
  caption?: string | null;
}

export interface UpdateMediaAssetInput {
  alt_text?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
}

export async function listMediaAssets(
  params: ListMediaAssetsParams = {},
): Promise<{ items: MediaAsset[]; total: number; hasMore: boolean }> {
  const sp = new URLSearchParams();
  if (params.studySetId) sp.set("studySetId", params.studySetId);
  if (params.kind) sp.set("kind", params.kind);
  if (params.page) sp.set("page", String(params.page));
  if (params.pageSize) sp.set("pageSize", String(params.pageSize));
  const qs = sp.toString();
  const res = await apiFetch<MediaAsset[]>(`/api/media${qs ? `?${qs}` : ""}`);
  return {
    items: Array.isArray(res.data) ? res.data : [],
    total: Number(res.meta?.total ?? (Array.isArray(res.data) ? res.data.length : 0)),
    hasMore: Boolean(res.meta?.hasMore),
  };
}

export async function attachMediaRelation(
  input: AttachMediaRelationInput,
): Promise<ContentMediaRelation> {
  const res = await apiFetch<ContentMediaRelation>("/api/media", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function updateMediaAssetMeta(
  mediaId: string,
  input: UpdateMediaAssetInput,
): Promise<MediaAsset> {
  const res = await apiFetch<MediaAsset>(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return res.data;
}

export async function deleteMediaAsset(
  mediaId: string,
): Promise<{ deleted: boolean; id: string }> {
  const res = await apiFetch<{ deleted: boolean; id: string }>(
    `/api/media/${encodeURIComponent(mediaId)}`,
    {
      method: "DELETE",
    },
  );
  return res.data;
}
