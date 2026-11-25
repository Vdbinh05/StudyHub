/**
 * StudyHub V3.0 — Deterministic Offline Study Set Download Manager.
 *
 * Features:
 * - Download full study set or selected chapters (`chapters?: string[] | null`).
 * - Extracts and caches all required image & audio blobs in IndexedDB `media_blobs`.
 * - Text-only media guard: strictly blocks text-only download (`includeMedia: false`)
 *   when the set contains image-only questions/options, `image_choice`, `image_hotspot`,
 *   `listening`, or diagrams.
 * - Real-time progress reporting, `AbortController` pause/cancel, failed-item retry,
 *   `content_version` update check, `navigator.storage.estimate()` quota pre-check,
 *   and safe reference-counted deletion.
 */

import { resolveSafeMediaUrl } from "@/lib/media/urls";
import type { StudySet } from "@/types/domain";
import type { DiagramSet, QuestionMediaAttachment, SharedPassage } from "@/types/v3";
import {
  deleteDownloadedSetRecords,
  getDownloadedSet,
  getMediaBlob,
  getStorageEstimate,
  normalizeOfflineStorageError,
  OfflineStorageError,
  putDiagramsForSet,
  putDownloadedSet,
  putMediaBlob,
  putQuestionsForSet,
} from "./db";
import type {
  DownloadProgress,
  OfflineDiagramRecord,
  OfflineDownloadedSetRecord,
  OfflineMediaRequirement,
  OfflineQuestionRecord,
  SetMediaAnalysis,
} from "./types";

const ESTIMATED_IMAGE_BYTES = 240 * 1024;
const ESTIMATED_AUDIO_BYTES = 480 * 1024;
const MEDIA_DOWNLOAD_CONCURRENCY = 4;
const QUESTION_PAGE_SIZE = 100;
const MAX_DOWNLOAD_QUESTIONS = 10_000;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isSafeDownloadableMediaUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//");
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function resolveAttachmentDownloadUrl(att: QuestionMediaAttachment): string | null {
  const safe = resolveSafeMediaUrl({
    url: att.url,
    proxy_url: att.proxy_url ?? att.media?.proxy_url,
    storage_path: att.storage_path ?? att.media?.storage_path,
  });
  return isSafeDownloadableMediaUrl(safe) ? safe : null;
}

function isAudioAttachment(att: QuestionMediaAttachment): boolean {
  return (
    att.role === "audio" ||
    att.media?.kind === "audio" ||
    Boolean(att.mime_type?.toLowerCase().startsWith("audio/")) ||
    Boolean(att.media?.mime_type?.toLowerCase().startsWith("audio/"))
  );
}

function attachmentReasonForQuestion(
  att: QuestionMediaAttachment,
  isAudio: boolean,
): OfflineMediaRequirement["reason"] {
  if (isAudio) return "listening_audio";
  switch (att.role) {
    case "back":
      return "back_image";
    case "explanation":
      return "explanation_image";
    case "hint":
      return "hint_image";
    case "option":
      return "option_image";
    case "diagram_base":
      return "diagram_base";
    default:
      return "prompt_image";
  }
}

function estimateUtf8Bytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(json).byteLength;
  }
  return json.length * 2;
}

/**
 * Inspect questions, diagrams, and passages to compute required media URLs,
 * estimated storage footprint, and whether text-only download must be blocked.
 */
export function analyzeSetMediaRequirements(
  questions: readonly OfflineQuestionRecord[],
  diagrams: readonly OfflineDiagramRecord[] = [],
  passages: readonly SharedPassage[] = [],
): SetMediaAnalysis {
  const mediaByUrl = new Map<string, OfflineMediaRequirement>();
  const blockingReasonsSet = new Set<string>();

  const addMedia = (
    url: string | null | undefined,
    kind: "image" | "audio",
    reason: OfflineMediaRequirement["reason"],
    mediaId?: string | null,
    knownBytes?: number | null,
  ): void => {
    const resolved =
      resolveSafeMediaUrl({ url }) ?? (typeof url === "string" ? url.trim() : null);
    if (!isSafeDownloadableMediaUrl(resolved)) return;
    const existing = mediaByUrl.get(resolved);
    if (existing) {
      if (!existing.media_id && mediaId) {
        existing.media_id = mediaId;
      }
      if (typeof knownBytes === "number" && knownBytes > 0) {
        existing.estimatedBytes = knownBytes;
      }
      return;
    }
    mediaByUrl.set(resolved, {
      url: resolved,
      media_id: mediaId ?? null,
      kind,
      reason,
      estimatedBytes:
        typeof knownBytes === "number" && knownBytes > 0
          ? knownBytes
          : kind === "audio"
            ? ESTIMATED_AUDIO_BYTES
            : ESTIMATED_IMAGE_BYTES,
    });
  };

  for (const q of questions) {
    const promptEmpty = q.prompt.trim().length === 0;

    if (q.prompt_image_url) {
      addMedia(q.prompt_image_url, "image", "prompt_image");
      if (promptEmpty) {
        blockingReasonsSet.add("image_only_question");
      }
    }

    if (q.back_image_url) {
      addMedia(q.back_image_url, "image", "back_image");
    }

    if (q.audio_url) {
      addMedia(q.audio_url, "audio", "listening_audio", q.audio_media_id);
    }

    for (const att of q.media_attachments ?? []) {
      const attUrl = resolveAttachmentDownloadUrl(att);
      if (!attUrl) continue;
      const isAudio = isAudioAttachment(att);
      addMedia(
        attUrl,
        isAudio ? "audio" : "image",
        attachmentReasonForQuestion(att, isAudio),
        att.media_id || null,
        att.media?.size_bytes,
      );
      if (!isAudio && att.role === "prompt" && promptEmpty) {
        blockingReasonsSet.add("image_only_question");
      }
    }

    if (q.question_type === "image_choice") {
      blockingReasonsSet.add("image_choice");
    }
    if (q.question_type === "image_hotspot") {
      blockingReasonsSet.add("image_hotspot");
    }
    if (q.question_type === "listening") {
      blockingReasonsSet.add("listening");
    }

    for (const opt of q.options ?? []) {
      if (opt.image_url) {
        addMedia(opt.image_url, "image", "option_image", opt.media_id);
        if (opt.content.trim().length === 0) {
          blockingReasonsSet.add("image_only_option");
        }
      }
      for (const att of opt.media_attachments ?? []) {
        const attUrl = resolveAttachmentDownloadUrl(att);
        if (!attUrl) continue;
        const isAudio = isAudioAttachment(att);
        addMedia(
          attUrl,
          isAudio ? "audio" : "image",
          isAudio ? "listening_audio" : "option_image",
          att.media_id || opt.media_id || null,
          att.media?.size_bytes,
        );
        if (!isAudio && opt.content.trim().length === 0) {
          blockingReasonsSet.add("image_only_option");
        }
      }
    }

    const payload = q.type_payload;
    if (payload) {
      if (payload.type === "listening") {
        addMedia(
          payload.audio_url,
          "audio",
          "listening_audio",
          payload.audio_media_id,
        );
      } else if (payload.type === "image_hotspot") {
        addMedia(
          payload.image_url,
          "image",
          "hotspot_image",
          payload.image_media_id,
        );
      } else if (payload.type === "ordering") {
        for (const item of payload.items) {
          addMedia(item.image_url, "image", "ordering_image", item.media_id);
        }
      } else if (payload.type === "matching") {
        for (const pair of payload.pairs) {
          addMedia(pair.left_image_url, "image", "matching_image");
          addMedia(pair.right_image_url, "image", "matching_image");
        }
        for (const d of payload.distractors ?? []) {
          addMedia(d.right_image_url, "image", "matching_image");
        }
      }
    }
  }

  for (const diagram of diagrams) {
    blockingReasonsSet.add("diagram");
    addMedia(
      diagram.base_image_url,
      "image",
      "diagram_base",
      diagram.base_media_id,
      diagram.base_media?.size_bytes,
    );
  }

  for (const passage of passages) {
    if (passage.audio_media?.proxy_url) {
      addMedia(
        passage.audio_media.proxy_url,
        "audio",
        "passage_audio",
        passage.audio_media_id,
        passage.audio_media.size_bytes,
      );
    }
  }

  const requiredMedia = Array.from(mediaByUrl.values());
  const estimatedTextBytes =
    estimateUtf8Bytes(questions) +
    estimateUtf8Bytes(diagrams) +
    estimateUtf8Bytes(passages);
  const estimatedMediaBytes = requiredMedia.reduce(
    (sum, item) => sum + item.estimatedBytes,
    0,
  );
  const blockingReasons = Array.from(blockingReasonsSet);

  return {
    totalQuestions: questions.length,
    totalDiagrams: diagrams.length,
    requiredMedia,
    requiresMediaForCorrectness: blockingReasons.length > 0,
    blockingReasons,
    estimatedTextBytes,
    estimatedMediaBytes,
    estimatedTotalBytes: estimatedTextBytes + estimatedMediaBytes,
  };
}

/**
 * Guard: blocks text-only download (`includeMedia: false`) when set contains
 * media-dependent questions (`image_choice`, `image_hotspot`, `listening`, image-only, diagrams).
 */
export function validateDownloadOptions(
  analysis: SetMediaAnalysis,
  options: { includeMedia?: boolean },
): void {
  const includeMedia = options.includeMedia ?? true;
  if (!includeMedia && analysis.requiresMediaForCorrectness) {
    throw new OfflineStorageError(
      "MEDIA_REQUIRED_FOR_SET",
      "Text-only download is disabled for this study set because it contains image-only, diagram, or listening questions that require media to study accurately.",
      {
        blockingReasons: analysis.blockingReasons,
        requiredMediaCount: analysis.requiredMedia.length,
      },
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OfflineStorageError("ABORTED", "Download cancelled by user.");
  }
}

interface RawStudySetResponse {
  set?: StudySet & { content_version?: number; passages?: SharedPassage[] };
  passages?: SharedPassage[];
}

async function fetchJsonOrThrow<T>(
  fetcher: FetchLike,
  url: string,
  signal?: AbortSignal,
): Promise<{ data: T; meta?: { total?: number; page?: number; pageSize?: number } }> {
  throwIfAborted(signal);
  let res: Response;
  try {
    res = await fetcher(url, { credentials: "same-origin", signal });
  } catch (err) {
    if (signal?.aborted) {
      throw new OfflineStorageError("ABORTED", "Download cancelled by user.");
    }
    throw new OfflineStorageError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network request failed.",
    );
  }

  if (res.status === 401) {
    throw new OfflineStorageError(
      "AUTH_REQUIRED",
      "Sign in again to download this study set for offline study.",
    );
  }
  if (!res.ok) {
    throw new OfflineStorageError(
      "NETWORK_ERROR",
      `Failed to fetch ${url} (HTTP ${res.status}).`,
      { status: res.status, url },
    );
  }

  const parsed = (await res.json()) as
    | { data: T; meta?: { total?: number; page?: number; pageSize?: number } }
    | T;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return parsed as {
      data: T;
      meta?: { total?: number; page?: number; pageSize?: number };
    };
  }
  return { data: parsed as T };
}

async function fetchAllQuestionsForDownload(
  fetcher: FetchLike,
  userId: string,
  setId: string,
  signal?: AbortSignal,
  onPageLoaded?: (loaded: number, total: number) => void,
): Promise<OfflineQuestionRecord[]> {
  const all: OfflineQuestionRecord[] = [];
  let page = 1;
  const maxPages = Math.ceil(MAX_DOWNLOAD_QUESTIONS / QUESTION_PAGE_SIZE) + 1;
  const cachedAt = new Date().toISOString();

  while (all.length < MAX_DOWNLOAD_QUESTIONS && page <= maxPages) {
    throwIfAborted(signal);
    const res = await fetchJsonOrThrow<
      OfflineQuestionRecord[] | { questions: OfflineQuestionRecord[] }
    >(
      fetcher,
      `/api/sets/${encodeURIComponent(setId)}/questions?page=${page}&pageSize=${QUESTION_PAGE_SIZE}`,
      signal,
    );

    const rawItems = Array.isArray(res.data)
      ? res.data
      : res.data && typeof res.data === "object" && "questions" in res.data
        ? res.data.questions
        : [];

    for (const item of rawItems) {
      all.push({
        ...item,
        user_id: userId,
        study_set_id: setId,
        cached_at: cachedAt,
      });
    }

    const total = res.meta?.total ?? all.length;
    onPageLoaded?.(all.length, Math.max(total, all.length));

    if (
      rawItems.length < QUESTION_PAGE_SIZE ||
      (typeof res.meta?.total === "number" && all.length >= res.meta.total)
    ) {
      break;
    }
    page += 1;
  }

  return all;
}

async function fetchDiagramsForDownload(
  fetcher: FetchLike,
  userId: string,
  setId: string,
  signal?: AbortSignal,
): Promise<OfflineDiagramRecord[]> {
  throwIfAborted(signal);
  try {
    const res = await fetcher(`/api/sets/${encodeURIComponent(setId)}/diagrams`, {
      credentials: "same-origin",
      signal,
    });
    if (res.status === 404 || res.status === 405) {
      return [];
    }
    if (!res.ok) {
      return [];
    }
    const parsed = (await res.json()) as
      | { data?: DiagramSet[] | { diagrams?: DiagramSet[] } }
      | DiagramSet[];
    const list: DiagramSet[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.data)
        ? parsed.data
        : parsed.data &&
            typeof parsed.data === "object" &&
            "diagrams" in parsed.data &&
            Array.isArray(parsed.data.diagrams)
          ? parsed.data.diagrams
          : [];
    const cachedAt = new Date().toISOString();
    return list.map((d) => ({
      ...d,
      user_id: userId,
      study_set_id: setId,
      cached_at: cachedAt,
    }));
  } catch {
    if (signal?.aborted) {
      throw new OfflineStorageError("ABORTED", "Download cancelled by user.");
    }
    return [];
  }
}

export interface DownloadStudySetOptions {
  userId: string;
  setId: string;
  /** Optional chapter filter; `null` / `undefined` / empty downloads all chapters */
  chapters?: string[] | null;
  includeMedia?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
  fetcher?: FetchLike;
}

async function downloadMediaItems(params: {
  userId: string;
  setId: string;
  items: readonly OfflineMediaRequirement[];
  fetcher: FetchLike;
  signal?: AbortSignal;
  estimatedTotalBytes: number;
  baseCompletedBytes: number;
  onProgress?: (progress: DownloadProgress) => void;
}): Promise<{ downloadedCount: number; downloadedBytes: number; failedUrls: string[] }> {
  const {
    userId,
    setId,
    items,
    fetcher,
    signal,
    estimatedTotalBytes,
    baseCompletedBytes,
    onProgress,
  } = params;

  const failedUrls: string[] = [];
  let completed = 0;
  let downloadedCount = 0;
  let downloadedBytes = 0;
  let cursor = 0;
  let fatalError: OfflineStorageError | null = null;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      if (fatalError) return;
      if (signal?.aborted) {
        fatalError = new OfflineStorageError("ABORTED", "Download cancelled by user.");
        return;
      }

      const item = items[cursor]!;
      cursor += 1;

      try {
        // Skip network fetch if blob already exists in this user's IndexedDB; just attach set_id ref
        const existing = await getMediaBlob(userId, item.url);
        if (existing) {
          await putMediaBlob(userId, {
            ...existing,
            set_ids: Array.from(new Set([...existing.set_ids, setId])),
          });
          downloadedCount += 1;
          downloadedBytes += existing.size_bytes;
        } else {
          const response = await fetcher(item.url, {
            credentials: "same-origin",
            signal,
          });
          if (!response.ok) {
            failedUrls.push(item.url);
          } else {
            const blob = await response.blob();
            const mimeType =
              blob.type ||
              response.headers.get("content-type") ||
              (item.kind === "audio" ? "audio/mpeg" : "image/png");
            await putMediaBlob(userId, {
              url: item.url,
              user_id: userId,
              media_id: item.media_id,
              kind: item.kind,
              mime_type: mimeType,
              size_bytes: blob.size,
              blob,
              set_ids: [setId],
              downloaded_at: new Date().toISOString(),
            });
            downloadedCount += 1;
            downloadedBytes += blob.size;
          }
        }
      } catch (err) {
        const normalized = normalizeOfflineStorageError(err);
        if (normalized.code === "QUOTA_EXCEEDED" || normalized.code === "ABORTED") {
          fatalError = normalized;
          return;
        }
        failedUrls.push(item.url);
      }

      completed += 1;
      onProgress?.({
        phase: "downloading_media",
        completedItems: completed,
        totalItems: items.length,
        downloadedBytes: baseCompletedBytes + downloadedBytes,
        estimatedTotalBytes: Math.max(
          estimatedTotalBytes,
          baseCompletedBytes + downloadedBytes,
        ),
        failedUrls: [...failedUrls],
      });
    }
  };

  const workerCount = Math.min(MEDIA_DOWNLOAD_CONCURRENCY, Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (fatalError) {
    throw fatalError;
  }

  return { downloadedCount, downloadedBytes, failedUrls };
}

/**
 * Download a study set (or selected chapters) + diagrams + required media blobs into IndexedDB.
 */
export async function downloadStudySetOffline(
  options: DownloadStudySetOptions,
): Promise<OfflineDownloadedSetRecord> {
  const fetcher: FetchLike = options.fetcher ?? ((i, init) => fetch(i, init));
  const includeMedia = options.includeMedia ?? true;
  const chapterList =
    options.chapters && options.chapters.length > 0
      ? Array.from(new Set(options.chapters))
      : null;

  options.onProgress?.({
    phase: "fetching_metadata",
    completedItems: 0,
    totalItems: 1,
    downloadedBytes: 0,
    estimatedTotalBytes: 0,
    failedUrls: [],
  });

  const setEnvelope = await fetchJsonOrThrow<
    (StudySet & { content_version?: number; passages?: SharedPassage[] }) | RawStudySetResponse
  >(fetcher, `/api/sets/${encodeURIComponent(options.setId)}`, options.signal);

  const rawData = setEnvelope.data;
  const setMeta: StudySet & { content_version?: number; passages?: SharedPassage[] } =
    rawData && typeof rawData === "object" && "set" in rawData && rawData.set
      ? rawData.set
      : (rawData as StudySet & { content_version?: number; passages?: SharedPassage[] });

  const passages: SharedPassage[] =
    (rawData && typeof rawData === "object" && "passages" in rawData && Array.isArray(rawData.passages)
      ? rawData.passages
      : setMeta.passages) ?? [];

  throwIfAborted(options.signal);

  const [allQuestions, diagrams] = await Promise.all([
    fetchAllQuestionsForDownload(
      fetcher,
      options.userId,
      options.setId,
      options.signal,
      (loaded, total) => {
        options.onProgress?.({
          phase: "fetching_questions",
          completedItems: loaded,
          totalItems: total,
          downloadedBytes: 0,
          estimatedTotalBytes: 0,
          failedUrls: [],
        });
      },
    ),
    fetchDiagramsForDownload(fetcher, options.userId, options.setId, options.signal),
  ]);

  throwIfAborted(options.signal);

  const filteredQuestions = chapterList
    ? allQuestions.filter((q) => q.chapter !== null && chapterList.includes(q.chapter))
    : allQuestions;

  const analysis = analyzeSetMediaRequirements(
    filteredQuestions,
    chapterList ? [] : diagrams,
    passages,
  );

  // Enforce strict text-only guard for media-dependent study sets
  validateDownloadOptions(analysis, { includeMedia });

  const plannedTotalBytes = includeMedia
    ? analysis.estimatedTotalBytes
    : analysis.estimatedTextBytes;

  // Proactive storage quota check before writing large blobs
  const estimate = await getStorageEstimate();
  if (
    estimate.supported &&
    estimate.availableBytes !== null &&
    plannedTotalBytes > estimate.availableBytes
  ) {
    throw new OfflineStorageError(
      "QUOTA_EXCEEDED",
      "Not enough local storage space to download this study set. Delete unused offline sets and retry.",
      {
        requiredBytes: plannedTotalBytes,
        availableBytes: estimate.availableBytes,
      },
    );
  }

  options.onProgress?.({
    phase: "saving_content",
    completedItems: 0,
    totalItems: Math.max(1, filteredQuestions.length),
    downloadedBytes: analysis.estimatedTextBytes,
    estimatedTotalBytes: plannedTotalBytes,
    failedUrls: [],
  });

  const downloadedDiagrams = chapterList ? [] : diagrams;
  await putQuestionsForSet(options.userId, options.setId, filteredQuestions, true);
  await putDiagramsForSet(options.userId, options.setId, downloadedDiagrams, true);

  const nowIso = new Date().toISOString();
  const contentVersion =
    typeof setMeta.content_version === "number" && Number.isFinite(setMeta.content_version)
      ? setMeta.content_version
      : 1;

  const initialRecord: OfflineDownloadedSetRecord = {
    user_id: options.userId,
    set_id: options.setId,
    title: setMeta.title,
    subject: setMeta.subject ?? null,
    description: setMeta.description ?? null,
    set_type: setMeta.set_type ?? "mixed",
    visibility: setMeta.visibility ?? "private",
    source_language: setMeta.source_language ?? "vi",
    content_version: contentVersion,
    server_updated_at: setMeta.updated_at ?? nowIso,
    downloaded_at: nowIso,
    downloaded_chapters: chapterList,
    question_count: filteredQuestions.length,
    diagram_count: downloadedDiagrams.length,
    media_count: 0,
    media_bytes: 0,
    estimated_total_bytes: analysis.estimatedTextBytes,
    include_media: includeMedia,
    status: "updating",
    failed_media_urls: [],
    last_error: null,
    passages,
  };

  await putDownloadedSet(options.userId, initialRecord);

  let mediaCount = 0;
  let mediaBytes = 0;
  let failedUrls: string[] = [];

  if (includeMedia && analysis.requiredMedia.length > 0) {
    const mediaResult = await downloadMediaItems({
      userId: options.userId,
      setId: options.setId,
      items: analysis.requiredMedia,
      fetcher,
      signal: options.signal,
      estimatedTotalBytes: plannedTotalBytes,
      baseCompletedBytes: analysis.estimatedTextBytes,
      onProgress: options.onProgress,
    });
    mediaCount = mediaResult.downloadedCount;
    mediaBytes = mediaResult.downloadedBytes;
    failedUrls = mediaResult.failedUrls;
  }

  const finalRecord: OfflineDownloadedSetRecord = {
    ...initialRecord,
    downloaded_at: new Date().toISOString(),
    media_count: mediaCount,
    media_bytes: mediaBytes,
    estimated_total_bytes: analysis.estimatedTextBytes + mediaBytes,
    status: failedUrls.length > 0 ? "partial" : "ready",
    failed_media_urls: failedUrls,
    last_error:
      failedUrls.length > 0
        ? `${failedUrls.length} media file(s) failed to download.`
        : null,
  };

  await putDownloadedSet(options.userId, finalRecord);

  options.onProgress?.({
    phase: "complete",
    completedItems: analysis.requiredMedia.length,
    totalItems: analysis.requiredMedia.length,
    downloadedBytes: finalRecord.estimated_total_bytes,
    estimatedTotalBytes: finalRecord.estimated_total_bytes,
    failedUrls,
  });

  return finalRecord;
}

/**
 * Retry only the failed media URLs of a partial offline study set download.
 */
export async function retryFailedMediaDownloads(
  userId: string,
  setId: string,
  options: {
    fetcher?: FetchLike;
    signal?: AbortSignal;
    onProgress?: (progress: DownloadProgress) => void;
  } = {},
): Promise<OfflineDownloadedSetRecord> {
  const existing = await getDownloadedSet(userId, setId);
  if (!existing) {
    throw new OfflineStorageError(
      "UNKNOWN",
      "Downloaded study set record not found for retry.",
    );
  }
  if (existing.failed_media_urls.length === 0) {
    return existing;
  }

  const fetcher: FetchLike = options.fetcher ?? ((i, init) => fetch(i, init));
  const retryItems: OfflineMediaRequirement[] = existing.failed_media_urls.map(
    (url) => ({
      url,
      media_id: null,
      kind: url.toLowerCase().includes("audio") ? "audio" : "image",
      reason: url.toLowerCase().includes("audio") ? "listening_audio" : "prompt_image",
      estimatedBytes: ESTIMATED_IMAGE_BYTES,
    }),
  );

  const result = await downloadMediaItems({
    userId,
    setId,
    items: retryItems,
    fetcher,
    signal: options.signal,
    estimatedTotalBytes: existing.estimated_total_bytes,
    baseCompletedBytes: existing.estimated_total_bytes,
    onProgress: options.onProgress,
  });

  const updated: OfflineDownloadedSetRecord = {
    ...existing,
    media_count: existing.media_count + result.downloadedCount,
    media_bytes: existing.media_bytes + result.downloadedBytes,
    estimated_total_bytes: existing.estimated_total_bytes + result.downloadedBytes,
    failed_media_urls: result.failedUrls,
    status: result.failedUrls.length > 0 ? "partial" : "ready",
    last_error:
      result.failedUrls.length > 0
        ? `${result.failedUrls.length} media file(s) still failed to download.`
        : null,
  };

  await putDownloadedSet(userId, updated);
  return updated;
}

export interface StudySetUpdateCheckResult {
  setId: string;
  isDownloaded: boolean;
  hasUpdate: boolean;
  localVersion: number | null;
  serverVersion: number | null;
  localUpdatedAt: string | null;
  serverUpdatedAt: string | null;
  revoked: boolean;
  deleted: boolean;
}

/**
 * Compare local downloaded `content_version` / `server_updated_at` against server metadata.
 */
export async function checkStudySetUpdateStatus(
  userId: string,
  setId: string,
  fetcher: FetchLike = (i, init) => fetch(i, init),
): Promise<StudySetUpdateCheckResult> {
  const local = await getDownloadedSet(userId, setId);
  if (!local) {
    return {
      setId,
      isDownloaded: false,
      hasUpdate: false,
      localVersion: null,
      serverVersion: null,
      localUpdatedAt: null,
      serverUpdatedAt: null,
      revoked: false,
      deleted: false,
    };
  }

  const res = await fetcher(`/api/sets/${encodeURIComponent(setId)}`, {
    credentials: "same-origin",
  });

  if (res.status === 403) {
    return {
      setId,
      isDownloaded: true,
      hasUpdate: false,
      localVersion: local.content_version,
      serverVersion: null,
      localUpdatedAt: local.server_updated_at,
      serverUpdatedAt: null,
      revoked: true,
      deleted: false,
    };
  }

  if (res.status === 404) {
    return {
      setId,
      isDownloaded: true,
      hasUpdate: false,
      localVersion: local.content_version,
      serverVersion: null,
      localUpdatedAt: local.server_updated_at,
      serverUpdatedAt: null,
      revoked: false,
      deleted: true,
    };
  }

  if (!res.ok) {
    throw new OfflineStorageError(
      "NETWORK_ERROR",
      `Unable to check update status (HTTP ${res.status}).`,
    );
  }

  const parsed = (await res.json()) as {
    data?:
      | { set?: { content_version?: number; updated_at?: string } }
      | { content_version?: number; updated_at?: string };
  };
  const payload = parsed.data;
  const setObj =
    payload && "set" in payload && payload.set
      ? payload.set
      : (payload as { content_version?: number; updated_at?: string } | undefined);

  const serverVersion =
    typeof setObj?.content_version === "number" ? setObj.content_version : local.content_version;
  const serverUpdatedAt = setObj?.updated_at ?? local.server_updated_at;

  const hasUpdate =
    serverVersion > local.content_version ||
    (Boolean(serverUpdatedAt) && serverUpdatedAt > local.server_updated_at);

  return {
    setId,
    isDownloaded: true,
    hasUpdate,
    localVersion: local.content_version,
    serverVersion,
    localUpdatedAt: local.server_updated_at,
    serverUpdatedAt,
    revoked: false,
    deleted: false,
  };
}

/**
 * Remove a downloaded study set and garbage-collect any unreferenced media blobs.
 */
export async function deleteDownloadedStudySet(
  userId: string,
  setId: string,
): Promise<void> {
  await deleteDownloadedSetRecords(userId, setId);
}
