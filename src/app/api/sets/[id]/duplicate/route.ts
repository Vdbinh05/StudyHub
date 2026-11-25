import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseOptionalJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { isValidStudyMediaPath } from "@/lib/security/sanitize";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  fetchAllPages,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { rpcCloneStudySet } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { duplicateStudySetSchema } from "@/lib/validation/sets";
import type { Database, Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CLONE_MEDIA_CONCURRENCY = 6;

function extractStudyMediaPathFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isValidStudyMediaPath(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/[?&]path=([^&]+)/i);
  if (match?.[1]) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (isValidStudyMediaPath(decoded)) {
        return decoded;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function getSafeExtension(storagePath: string, mimeType?: string | null): string {
  const match = storagePath.match(/\.([a-z0-9]{2,5})$/i);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    default:
      return "bin";
  }
}

function rewritePathReferencesInString(
  raw: string | null,
  pathMap: ReadonlyMap<string, string>,
): string | null {
  if (!raw || pathMap.size === 0) return raw;
  let updated = raw;
  for (const [oldPath, newPath] of pathMap.entries()) {
    if (updated.includes(oldPath)) {
      updated = updated.split(oldPath).join(newPath);
    }
    const oldEncoded = encodeURIComponent(oldPath);
    if (updated.includes(oldEncoded)) {
      updated = updated.split(oldEncoded).join(encodeURIComponent(newPath));
    }
    const oldSlashEncoded = oldPath.replace(/\//g, "%2F");
    if (updated.includes(oldSlashEncoded)) {
      updated = updated
        .split(oldSlashEncoded)
        .join(newPath.replace(/\//g, "%2F"));
    }
  }
  return updated;
}

function rewriteJsonReferences(
  value: unknown,
  mediaIdMap: ReadonlyMap<string, string>,
  pathMap: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    if (mediaIdMap.has(value)) {
      return mediaIdMap.get(value);
    }
    return rewritePathReferencesInString(value, pathMap);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonReferences(item, mediaIdMap, pathMap));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = rewriteJsonReferences(v, mediaIdMap, pathMap);
    }
    return out;
  }
  return value;
}

function collectMediaRefsFromJson(
  value: unknown,
  mediaIds: Set<string>,
  storagePaths: Set<string>,
): void {
  if (typeof value === "string") {
    const path = extractStudyMediaPathFromUrl(value);
    if (path) storagePaths.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaRefsFromJson(item, mediaIds, storagePaths);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        (k === "media_id" ||
          k === "image_media_id" ||
          k === "audio_media_id" ||
          k === "base_media_id") &&
        typeof v === "string" &&
        uuidSchema.safeParse(v).success
      ) {
        mediaIds.add(v);
      } else {
        collectMediaRefsFromJson(v, mediaIds, storagePaths);
      }
    }
  }
}

async function copyStorageBlob(
  readerClient: SupabaseClient<Database>,
  writerClient: SupabaseClient<Database>,
  oldPath: string,
  newPath: string,
  mimeType?: string | null,
): Promise<boolean> {
  // Fast path: server-side Storage copy (0 bytes transferred through Vercel)
  const copyRes = await writerClient.storage
    .from("study-media")
    .copy(oldPath, newPath);
  if (!copyRes.error) {
    return true;
  }

  // Fallback: download from authorized source and upload into caller's cloned set folder
  const dlRes = await readerClient.storage.from("study-media").download(oldPath);
  if (dlRes.error || !dlRes.data) {
    return false;
  }
  const bytes = new Uint8Array(await dlRes.data.arrayBuffer());
  const upRes = await writerClient.storage
    .from("study-media")
    .upload(newPath, bytes, {
      contentType: mimeType || dlRes.data.type || "application/octet-stream",
      upsert: false,
    });
  return !upRes.error;
}

/**
 * V32-009 / SEC-06: Copies all referenced Storage blobs into `{callerUserId}/{clonedSetId}/...`,
 * creates caller-owned `media_assets`, and remaps `content_media_relations` & entity URLs/IDs
 * so cloned study sets are 100% tenant-isolated and survive share revocation or source deletion.
 */
async function isolateClonedStudySetMedia(
  supabase: SupabaseClient<Database>,
  userId: string,
  clonedSetId: string,
): Promise<void> {
  const [questions, options, passages, diagrams] = await Promise.all([
    fetchAllPages(async (from, to) =>
      supabase
        .from("questions")
        .select(
          "id, prompt_image_url, back_image_url, audio_media_id, audio_url, type_payload, prompt_rich, back_rich, explanation_rich, hint_rich",
        )
        .eq("study_set_id", clonedSetId)
        .range(from, to),
    ),
    fetchAllPages(async (from, to) =>
      supabase
        .from("question_options")
        .select("id, image_url, media_id, content_rich")
        .eq("study_set_id", clonedSetId)
        .range(from, to),
    ),
    fetchAllPages(async (from, to) =>
      supabase
        .from("shared_passages")
        .select("id, audio_media_id, content_rich")
        .eq("study_set_id", clonedSetId)
        .range(from, to),
    ),
    fetchAllPages(async (from, to) =>
      supabase
        .from("diagram_sets")
        .select("id, base_media_id, base_image_url")
        .eq("study_set_id", clonedSetId)
        .range(from, to),
    ),
  ]);

  const entityIdsByType: Array<{
    entityType: "question" | "question_option" | "shared_passage" | "diagram_set";
    ids: string[];
  }> = [
    { entityType: "question", ids: questions.map((q) => q.id) },
    { entityType: "question_option", ids: options.map((o) => o.id) },
    { entityType: "shared_passage", ids: passages.map((p) => p.id) },
    { entityType: "diagram_set", ids: diagrams.map((d) => d.id) },
  ];

  const admin = tryCreateAdminClient();
  const dbReadClient = admin ?? supabase;

  const relationRows: Array<
    Database["public"]["Tables"]["content_media_relations"]["Row"]
  > = [];
  for (const group of entityIdsByType) {
    if (group.ids.length === 0) continue;
    const rows = await fetchInChunks(
      group.ids,
      async (chunk) =>
        dbReadClient
          .from("content_media_relations")
          .select("*")
          .eq("entity_type", group.entityType)
          .in("entity_id", chunk),
      SAFE_IN_CHUNK_SIZE,
    );
    relationRows.push(...rows);
  }

  const referencedMediaIds = new Set<string>();
  const referencedPaths = new Set<string>();

  for (const rel of relationRows) {
    referencedMediaIds.add(rel.media_id);
  }
  for (const q of questions) {
    if (q.audio_media_id) referencedMediaIds.add(q.audio_media_id);
    for (const url of [q.prompt_image_url, q.back_image_url, q.audio_url]) {
      const p = extractStudyMediaPathFromUrl(url);
      if (p) referencedPaths.add(p);
    }
    collectMediaRefsFromJson(q.type_payload, referencedMediaIds, referencedPaths);
    collectMediaRefsFromJson(q.prompt_rich, referencedMediaIds, referencedPaths);
    collectMediaRefsFromJson(q.back_rich, referencedMediaIds, referencedPaths);
    collectMediaRefsFromJson(q.explanation_rich, referencedMediaIds, referencedPaths);
    collectMediaRefsFromJson(q.hint_rich, referencedMediaIds, referencedPaths);
  }
  for (const o of options) {
    if (o.media_id) referencedMediaIds.add(o.media_id);
    const p = extractStudyMediaPathFromUrl(o.image_url);
    if (p) referencedPaths.add(p);
    collectMediaRefsFromJson(o.content_rich, referencedMediaIds, referencedPaths);
  }
  for (const sp of passages) {
    if (sp.audio_media_id) referencedMediaIds.add(sp.audio_media_id);
    collectMediaRefsFromJson(sp.content_rich, referencedMediaIds, referencedPaths);
  }
  for (const ds of diagrams) {
    if (ds.base_media_id) referencedMediaIds.add(ds.base_media_id);
    const p = extractStudyMediaPathFromUrl(ds.base_image_url);
    if (p) referencedPaths.add(p);
  }

  if (referencedMediaIds.size === 0 && referencedPaths.size === 0) {
    return;
  }

  // Fetch source media_assets rows by ID and by storage_path
  const [assetsById, assetsByPath] = await Promise.all([
    referencedMediaIds.size > 0
      ? fetchInChunks(
          Array.from(referencedMediaIds),
          async (chunk) =>
            dbReadClient.from("media_assets").select("*").in("id", chunk),
          SAFE_IN_CHUNK_SIZE,
        )
      : Promise.resolve([]),
    referencedPaths.size > 0
      ? fetchInChunks(
          Array.from(referencedPaths),
          async (chunk) =>
            dbReadClient
              .from("media_assets")
              .select("*")
              .eq("storage_bucket", "study-media")
              .in("storage_path", chunk),
          SAFE_IN_CHUNK_SIZE,
        )
      : Promise.resolve([]),
  ]);

  const sourceAssetById = new Map<
    string,
    Database["public"]["Tables"]["media_assets"]["Row"]
  >();
  const indexedPaths = new Set<string>();
  for (const asset of [...assetsById, ...assetsByPath]) {
    if (asset.storage_bucket !== "study-media") continue;
    if (asset.study_set_id === clonedSetId && asset.owner_id === userId) continue;
    sourceAssetById.set(asset.id, asset);
    indexedPaths.add(asset.storage_path);
  }

  const mediaIdMap = new Map<string, string>();
  const pathMap = new Map<string, string>();
  const storageClient = admin ?? supabase;

  // Bounded-concurrency copy of indexed media_assets into `{userId}/{clonedSetId}/...`
  const assetsToCopy = Array.from(sourceAssetById.values());
  const newMediaRows: Array<
    Database["public"]["Tables"]["media_assets"]["Insert"]
  > = [];

  for (let i = 0; i < assetsToCopy.length; i += CLONE_MEDIA_CONCURRENCY) {
    const batch = assetsToCopy.slice(i, i + CLONE_MEDIA_CONCURRENCY);
    await Promise.all(
      batch.map(async (asset) => {
        const ext = getSafeExtension(asset.storage_path, asset.mime_type);
        const newMediaId = randomUUID();
        const newPath = `${userId}/${clonedSetId}/${newMediaId}.${ext}`;
        const copied = await copyStorageBlob(
          supabase,
          storageClient,
          asset.storage_path,
          newPath,
          asset.mime_type,
        );
        if (!copied) return;

        mediaIdMap.set(asset.id, newMediaId);
        pathMap.set(asset.storage_path, newPath);
        newMediaRows.push({
          id: newMediaId,
          owner_id: userId,
          study_set_id: clonedSetId,
          kind: asset.kind,
          storage_bucket: "study-media",
          storage_path: newPath,
          mime_type: asset.mime_type,
          file_name: asset.file_name,
          size_bytes: asset.size_bytes,
          sha256_hash: asset.sha256_hash,
          width: asset.width,
          height: asset.height,
          duration_ms: asset.duration_ms,
          alt_text: asset.alt_text,
          caption: asset.caption,
          is_orphaned: false,
        });
      }),
    );
  }

  // Copy any unindexed legacy study-media paths (e.g. V1 uploads without media_assets row)
  const unindexedPaths = Array.from(referencedPaths).filter(
    (p) => !indexedPaths.has(p) && !p.startsWith(`${userId}/${clonedSetId}/`),
  );
  for (let i = 0; i < unindexedPaths.length; i += CLONE_MEDIA_CONCURRENCY) {
    const batch = unindexedPaths.slice(i, i + CLONE_MEDIA_CONCURRENCY);
    await Promise.all(
      batch.map(async (oldPath) => {
        const ext = getSafeExtension(oldPath);
        const newPath = `${userId}/${clonedSetId}/${randomUUID()}.${ext}`;
        const copied = await copyStorageBlob(
          supabase,
          storageClient,
          oldPath,
          newPath,
        );
        if (copied) {
          pathMap.set(oldPath, newPath);
        }
      }),
    );
  }

  if (mediaIdMap.size === 0 && pathMap.size === 0) {
    return;
  }

  if (newMediaRows.length > 0) {
    for (let i = 0; i < newMediaRows.length; i += SAFE_IN_CHUNK_SIZE) {
      const { error: insErr } = await dbReadClient
        .from("media_assets")
        .insert(newMediaRows.slice(i, i + SAFE_IN_CHUNK_SIZE));
      if (insErr) throw insErr;
    }
  }

  // Remap content_media_relations on cloned entities to caller-owned media_assets
  // and remove old cross-tenant relations pointing to source owner's media_id!
  const remappedRelations: Array<
    Database["public"]["Tables"]["content_media_relations"]["Insert"]
  > = [];
  const oldRelationIdsToDelete: string[] = [];

  for (const rel of relationRows) {
    const mappedMediaId = mediaIdMap.get(rel.media_id);
    if (!mappedMediaId) continue;
    remappedRelations.push({
      media_id: mappedMediaId,
      entity_type: rel.entity_type,
      entity_id: rel.entity_id,
      role: rel.role,
      sort_order: rel.sort_order,
      alt_text: rel.alt_text,
      caption: rel.caption,
    });
    oldRelationIdsToDelete.push(rel.id);
  }

  if (remappedRelations.length > 0) {
    for (let i = 0; i < remappedRelations.length; i += SAFE_IN_CHUNK_SIZE) {
      const { error: relInsErr } = await dbReadClient
        .from("content_media_relations")
        .upsert(remappedRelations.slice(i, i + SAFE_IN_CHUNK_SIZE), {
          onConflict: "media_id,entity_type,entity_id,role",
          ignoreDuplicates: true,
        });
      if (relInsErr) throw relInsErr;
    }
  }

  if (oldRelationIdsToDelete.length > 0) {
    for (let i = 0; i < oldRelationIdsToDelete.length; i += SAFE_IN_CHUNK_SIZE) {
      await dbReadClient
        .from("content_media_relations")
        .delete()
        .in("id", oldRelationIdsToDelete.slice(i, i + SAFE_IN_CHUNK_SIZE));
    }
  }

  // Remap entity columns across cloned questions, options, passages, and diagrams
  const updateTasks: Array<() => Promise<void>> = [];

  for (const q of questions) {
    const nextAudioMediaId = q.audio_media_id
      ? (mediaIdMap.get(q.audio_media_id) ?? q.audio_media_id)
      : null;
    const nextPromptImg = rewritePathReferencesInString(q.prompt_image_url, pathMap);
    const nextBackImg = rewritePathReferencesInString(q.back_image_url, pathMap);
    const nextAudioUrl = rewritePathReferencesInString(q.audio_url, pathMap);
    const nextPayload = q.type_payload
      ? (rewriteJsonReferences(q.type_payload, mediaIdMap, pathMap) as Json)
      : null;
    const nextPromptRich = q.prompt_rich
      ? (rewriteJsonReferences(q.prompt_rich, mediaIdMap, pathMap) as Json)
      : null;
    const nextBackRich = q.back_rich
      ? (rewriteJsonReferences(q.back_rich, mediaIdMap, pathMap) as Json)
      : null;
    const nextExplRich = q.explanation_rich
      ? (rewriteJsonReferences(q.explanation_rich, mediaIdMap, pathMap) as Json)
      : null;
    const nextHintRich = q.hint_rich
      ? (rewriteJsonReferences(q.hint_rich, mediaIdMap, pathMap) as Json)
      : null;

    if (
      nextAudioMediaId !== q.audio_media_id ||
      nextPromptImg !== q.prompt_image_url ||
      nextBackImg !== q.back_image_url ||
      nextAudioUrl !== q.audio_url ||
      JSON.stringify(nextPayload) !== JSON.stringify(q.type_payload) ||
      JSON.stringify(nextPromptRich) !== JSON.stringify(q.prompt_rich) ||
      JSON.stringify(nextBackRich) !== JSON.stringify(q.back_rich) ||
      JSON.stringify(nextExplRich) !== JSON.stringify(q.explanation_rich) ||
      JSON.stringify(nextHintRich) !== JSON.stringify(q.hint_rich)
    ) {
      updateTasks.push(async () => {
        const { error } = await dbReadClient
          .from("questions")
          .update({
            audio_media_id: nextAudioMediaId,
            prompt_image_url: nextPromptImg,
            back_image_url: nextBackImg,
            audio_url: nextAudioUrl,
            type_payload: nextPayload,
            prompt_rich: nextPromptRich,
            back_rich: nextBackRich,
            explanation_rich: nextExplRich,
            hint_rich: nextHintRich,
          })
          .eq("id", q.id)
          .eq("study_set_id", clonedSetId);
        if (error) throw error;
      });
    }
  }

  for (const o of options) {
    const nextMediaId = o.media_id ? (mediaIdMap.get(o.media_id) ?? o.media_id) : null;
    const nextImg = rewritePathReferencesInString(o.image_url, pathMap);
    const nextRich = o.content_rich
      ? (rewriteJsonReferences(o.content_rich, mediaIdMap, pathMap) as Json)
      : null;
    if (
      nextMediaId !== o.media_id ||
      nextImg !== o.image_url ||
      JSON.stringify(nextRich) !== JSON.stringify(o.content_rich)
    ) {
      updateTasks.push(async () => {
        const { error } = await dbReadClient
          .from("question_options")
          .update({
            media_id: nextMediaId,
            image_url: nextImg,
            content_rich: nextRich,
          })
          .eq("id", o.id)
          .eq("study_set_id", clonedSetId);
        if (error) throw error;
      });
    }
  }

  for (const sp of passages) {
    const nextMediaId = sp.audio_media_id
      ? (mediaIdMap.get(sp.audio_media_id) ?? sp.audio_media_id)
      : null;
    const nextRich = sp.content_rich
      ? (rewriteJsonReferences(sp.content_rich, mediaIdMap, pathMap) as Json)
      : null;
    if (
      nextMediaId !== sp.audio_media_id ||
      JSON.stringify(nextRich) !== JSON.stringify(sp.content_rich)
    ) {
      updateTasks.push(async () => {
        const { error } = await dbReadClient
          .from("shared_passages")
          .update({
            audio_media_id: nextMediaId,
            content_rich: nextRich,
          })
          .eq("id", sp.id)
          .eq("study_set_id", clonedSetId);
        if (error) throw error;
      });
    }
  }

  for (const ds of diagrams) {
    const nextMediaId = ds.base_media_id
      ? (mediaIdMap.get(ds.base_media_id) ?? ds.base_media_id)
      : null;
    const nextBaseUrl =
      rewritePathReferencesInString(ds.base_image_url, pathMap) ??
      ds.base_image_url;
    if (nextMediaId !== ds.base_media_id || nextBaseUrl !== ds.base_image_url) {
      updateTasks.push(async () => {
        const { error } = await dbReadClient
          .from("diagram_sets")
          .update({
            base_media_id: nextMediaId,
            base_image_url: nextBaseUrl,
          })
          .eq("id", ds.id)
          .eq("study_set_id", clonedSetId);
        if (error) throw error;
      });
    }
  }

  for (let i = 0; i < updateTasks.length; i += CLONE_MEDIA_CONCURRENCY) {
    await Promise.all(
      updateTasks.slice(i, i + CLONE_MEDIA_CONCURRENCY).map((fn) => fn()),
    );
  }
}

/**
 * Duplicates a study set atomically inside PostgreSQL via `clone_study_set()` RPC
 * and isolates all referenced Storage media blobs into `{callerUserId}/{clonedSetId}/...`
 * (fixes V32-009 / SEC-06 cross-tenant media coupling).
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.SET_CLONE,
      user.id,
    );
    if (limited) return limited;

    const { id } = await context.params;
    const sourceSetId = uuidSchema.parse(id);

    let parsedBody: { title?: string; folder_id?: string | null } | undefined;
    const body = await parseOptionalJsonBody(request);
    if (body !== undefined) {
      parsedBody = duplicateStudySetSchema.parse(body);
    }

    const access = await requireStudySetAccess(
      supabase,
      sourceSetId,
      user.id,
      "read",
    );

    if (!access.canClone) {
      throw new AppError(
        "FORBIDDEN",
        "Cloning is disabled for this shared study set.",
        403,
      );
    }

    if (parsedBody?.folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", parsedBody.folder_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!folder) {
        throw new AppError("NOT_FOUND", "Target folder not found.", 404);
      }
    }

    const { data, error } = await rpcCloneStudySet(supabase, {
      p_source_set_id: sourceSetId,
      p_title: parsedBody?.title ?? null,
      p_folder_id: parsedBody?.folder_id ?? null,
    });

    if (error) throw error;
    if (!data?.study_set) {
      throw new AppError("INTERNAL_ERROR", "Failed to duplicate study set.", 500);
    }

    // Isolate cloned set media blobs into caller-owned storage folder & media_assets
    await isolateClonedStudySetMedia(supabase, user.id, data.study_set.id);

    return apiSuccess(
      data.study_set,
      { copied_questions: data.copied_questions },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
