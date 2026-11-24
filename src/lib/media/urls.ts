import { isSafeHttpOrStorageUrl, isValidStudyMediaPath } from "@/lib/security/sanitize";
import type { ContentMediaRelation, MediaAsset, MediaKind } from "@/types/v3";

export interface MediaDisplayItem {
  id: string;
  media_id?: string | null;
  kind: MediaKind;
  url: string;
  storage_path?: string | null;
  mime_type?: string | null;
  file_name?: string | null;
  alt_text?: string | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  sort_order?: number;
}

export function buildSignedProxyUrl(storagePath: string): string {
  return `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`;
}

/**
 * Resolves a safe, renderable URL for a private `study-media` asset, relation, or raw URL.
 * Rejects unsafe schemes (`javascript:`, `data:text/html`, etc.) and never uses public bucket URLs.
 */
export function resolveSafeMediaUrl(input: {
  url?: string | null;
  proxy_url?: string | null;
  storage_path?: string | null;
}): string | null {
  const candidates = [input.proxy_url, input.url];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("blob:")) {
      return trimmed;
    }
    if (isValidStudyMediaPath(trimmed)) {
      return buildSignedProxyUrl(trimmed);
    }
    if (isSafeHttpOrStorageUrl(trimmed)) {
      return trimmed;
    }
  }

  if (input.storage_path && isValidStudyMediaPath(input.storage_path)) {
    return buildSignedProxyUrl(input.storage_path);
  }

  return null;
}

export function relationToDisplayItem(
  relation: ContentMediaRelation,
): MediaDisplayItem | null {
  const asset = relation.media;
  if (!asset) return null;
  const resolved = resolveSafeMediaUrl({
    proxy_url: asset.proxy_url,
    storage_path: asset.storage_path,
  });
  if (!resolved) return null;

  return {
    id: relation.id,
    media_id: relation.media_id,
    kind: asset.kind,
    url: resolved,
    storage_path: asset.storage_path,
    mime_type: asset.mime_type,
    file_name: asset.file_name,
    alt_text: relation.alt_text ?? asset.alt_text ?? "",
    caption: relation.caption ?? asset.caption ?? null,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.duration_ms,
    sort_order: relation.sort_order,
  };
}

export function assetToDisplayItem(asset: MediaAsset): MediaDisplayItem | null {
  const resolved = resolveSafeMediaUrl({
    proxy_url: asset.proxy_url,
    storage_path: asset.storage_path,
  });
  if (!resolved) return null;

  return {
    id: asset.id,
    media_id: asset.id,
    kind: asset.kind,
    url: resolved,
    storage_path: asset.storage_path,
    mime_type: asset.mime_type,
    file_name: asset.file_name,
    alt_text: asset.alt_text ?? "",
    caption: asset.caption ?? null,
    width: asset.width,
    height: asset.height,
    duration_ms: asset.duration_ms,
  };
}
