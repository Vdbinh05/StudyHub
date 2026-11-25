/**
 * StudyHub V3.0 — Offline Study Session Adapter.
 *
 * Powers all 7 offline-capable learning modes seamlessly using IndexedDB:
 * - Flashcards
 * - Multiple Choice Practice
 * - Adaptive Learn
 * - Write
 * - Spell (downloaded audio blob first, local browser TTS fallback, honest unavailable notice)
 * - Match
 * - Diagram (normalized [0,1] point/rect/polygon hit testing + cached base image)
 *
 * Strictly guards timed Mock Exams offline (exams require server clock + anti-leak protection).
 * Always grades choice questions by stable option UUID, never by display index or letter.
 */

import { canonicalizeMediaUrlKey } from "@/lib/media/question-media";
import { resolveSafeMediaUrl, type MediaDisplayItem } from "@/lib/media/urls";
import type { Question } from "@/types/domain";
import type {
  DiagramHotspot,
  HotspotGeometry,
  NormalizedPoint,
  QuestionMediaAttachment,
  RichTextDoc,
  SharedPassage,
  StructuredAnswerResponse,
  V3StudyMode,
} from "@/types/v3";
import {
  createMatchBoard,
  questionsToMatchCandidates,
  type MatchBoardState,
  type MatchRoundOptions,
} from "@/lib/learning/match-engine";
import { calculateNextReview } from "@/lib/learning/sm2";
import {
  getExpectedWriteAnswers,
  gradeWriteAnswer,
} from "@/lib/learning/write-grader";
import {
  deleteLocalCheckpoint,
  getDiagramsForSet,
  getDownloadedSet,
  getLocalCheckpoint,
  getLocalNote,
  getMediaBlob,
  getQuestionById,
  getQuestionsForSet,
  listLocalNotes,
  putLocalCheckpoint,
  putLocalNote,
  putQuestion,
} from "./db";
import { enqueueOfflineEvent } from "./sync-queue";
import type {
  OfflineDiagramRecord,
  OfflineDownloadedSetRecord,
  OfflineLocalCheckpointRecord,
  OfflineLocalNoteRecord,
  OfflineQuestionRecord,
  OfflineStudyActionInput,
} from "./types";

export type OfflineCapableMode =
  | "flashcards"
  | "practice"
  | "learn"
  | "write"
  | "spell"
  | "match"
  | "diagram";

const OFFLINE_SUPPORTED_MODES = new Set<string>([
  "flashcards",
  "practice",
  "learn",
  "write",
  "spell",
  "match",
  "diagram",
]);

/**
 * Check whether a mode is supported offline.
 * Server-authoritative timed exams (`"exam"`) are explicitly blocked offline.
 */
export function isOfflineModeSupported(
  mode: V3StudyMode | "exam",
): mode is OfflineCapableMode {
  return OFFLINE_SUPPORTED_MODES.has(mode);
}

export interface OfflineModeAvailability {
  available: boolean;
  eligibleCount: number;
  reason?: string;
}

export type OfflineModesAvailabilityMap = Record<
  OfflineCapableMode,
  OfflineModeAvailability
>;

function hasSpellableTarget(q: OfflineQuestionRecord): boolean {
  if (q.audio_url) return true;
  if (q.type_payload?.type === "listening" && q.type_payload.audio_url) return true;
  if (
    (q.media_attachments ?? []).some(
      (att) =>
        att.role === "audio" ||
        att.media?.kind === "audio" ||
        Boolean(att.mime_type?.toLowerCase().startsWith("audio/")),
    )
  ) {
    return true;
  }
  if (q.back_text && q.back_text.trim().length > 0) return true;
  if ((q.accepted_answers ?? []).some((a) => a.answer_text.trim().length > 0)) return true;
  if ((q.options ?? []).some((o) => o.is_correct && o.content.trim().length > 0)) return true;
  return q.prompt.trim().length > 0;
}

function hasChoiceOptions(q: OfflineQuestionRecord): boolean {
  return (q.options?.length ?? 0) >= 2;
}

/**
 * Compute compatibility across all 7 offline study modes for a downloaded study set.
 */
export function getOfflineAvailableModes(
  questions: readonly OfflineQuestionRecord[],
  diagrams: readonly OfflineDiagramRecord[],
): OfflineModesAvailabilityMap {
  const total = questions.length;
  const choiceEligible = questions.filter(
    (q) =>
      hasChoiceOptions(q) ||
      q.question_type === "numerical" ||
      q.question_type === "short_answer" ||
      q.question_type === "fill_in_blank" ||
      q.question_type === "ordering" ||
      q.question_type === "matching" ||
      q.question_type === "image_hotspot",
  ).length;
  const writeEligible = questions.filter(
    (q) =>
      q.question_type === "short_answer" ||
      q.question_type === "fill_in_blank" ||
      q.question_type === "numerical" ||
      (q.back_text && q.back_text.trim().length > 0) ||
      (q.options ?? []).some((o) => o.is_correct && o.content.trim().length > 0),
  ).length;
  const spellEligible = questions.filter(hasSpellableTarget).length;
  const matchCandidates = questionsToMatchCandidates(
    questions as unknown as readonly Question[],
  );
  const diagramEligible = diagrams.filter((d) => (d.hotspots?.length ?? 0) > 0).length;

  return {
    flashcards: {
      available: total > 0,
      eligibleCount: total,
      reason: total === 0 ? "no_questions" : undefined,
    },
    practice: {
      available: choiceEligible > 0,
      eligibleCount: choiceEligible,
      reason: choiceEligible === 0 ? "no_gradable_questions" : undefined,
    },
    learn: {
      available: total > 0,
      eligibleCount: total,
      reason: total === 0 ? "no_questions" : undefined,
    },
    write: {
      available: writeEligible > 0,
      eligibleCount: writeEligible,
      reason: writeEligible === 0 ? "no_text_answers" : undefined,
    },
    spell: {
      available: spellEligible > 0,
      eligibleCount: spellEligible,
      reason: spellEligible === 0 ? "no_spellable_items" : undefined,
    },
    match: {
      available: matchCandidates.length >= 2,
      eligibleCount: matchCandidates.length,
      reason: matchCandidates.length < 2 ? "need_at_least_2_pairs" : undefined,
    },
    diagram: {
      available: diagramEligible > 0,
      eligibleCount: diagramEligible,
      reason: diagramEligible === 0 ? "no_diagrams" : undefined,
    },
  };
}

export interface OfflineStudyBundle {
  set: OfflineDownloadedSetRecord;
  questions: OfflineQuestionRecord[];
  diagrams: OfflineDiagramRecord[];
  passages: SharedPassage[];
  notesByQuestionId: Map<string, OfflineLocalNoteRecord>;
  resolveMediaUrl: (url: string | null | undefined) => Promise<string | null>;
  revokeAllMediaUrls: () => void;
}

/**
 * Load a downloaded study set bundle from IndexedDB with lazy media object-URL resolution.
 * Call `bundle.revokeAllMediaUrls()` on unmount to prevent blob URL memory leaks.
 */
export async function loadOfflineStudyBundle(
  userId: string,
  setId: string,
  options: { chapters?: string[] | null } = {},
): Promise<OfflineStudyBundle | null> {
  const set = await getDownloadedSet(userId, setId);
  if (!set || set.status === "revoked" || set.status === "deleted") {
    return null;
  }

  const [allQuestions, diagrams, notes] = await Promise.all([
    getQuestionsForSet(userId, setId),
    getDiagramsForSet(userId, setId),
    listLocalNotes(userId, setId),
  ]);

  const chapterFilter =
    options.chapters && options.chapters.length > 0
      ? new Set(options.chapters)
      : null;

  const questions = chapterFilter
    ? allQuestions.filter((q) => q.chapter !== null && chapterFilter.has(q.chapter))
    : allQuestions;

  const notesByQuestionId = new Map(notes.map((n) => [n.question_id, n]));
  const createdUrls = new Map<string, string>();

  const resolveMediaUrl = async (
    url: string | null | undefined,
  ): Promise<string | null> => {
    if (!url) return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    const canonical = resolveSafeMediaUrl({ url: trimmed }) ?? trimmed;
    const cachedObjUrl = createdUrls.get(canonical);
    if (cachedObjUrl) return cachedObjUrl;

    const blobRecord =
      (await getMediaBlob(userId, canonical)) ??
      (canonical !== trimmed ? await getMediaBlob(userId, trimmed) : null);
    if (!blobRecord || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return null;
    }
    const objUrl = URL.createObjectURL(blobRecord.blob);
    createdUrls.set(canonical, objUrl);
    return objUrl;
  };

  const revokeAllMediaUrls = (): void => {
    if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
      createdUrls.clear();
      return;
    }
    for (const objUrl of createdUrls.values()) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch {
        // Ignore already-revoked object URLs
      }
    }
    createdUrls.clear();
  };

  return {
    set,
    questions,
    diagrams,
    passages: set.passages ?? [],
    notesByQuestionId,
    resolveMediaUrl,
    revokeAllMediaUrls,
  };
}

// ============================================================================
// Multi-Image Offline Media Resolution Helpers (V32-053)
// ============================================================================

/**
 * Resolve the canonical safe URL for a `QuestionMediaAttachment` so download
 * caching and offline IndexedDB lookup always share the exact same key.
 */
export function resolveOfflineAttachmentUrl(
  att: Partial<QuestionMediaAttachment> | null | undefined,
): string | null {
  if (!att) return null;
  return resolveSafeMediaUrl({
    url: att.url,
    proxy_url: att.proxy_url ?? att.media?.proxy_url,
    storage_path: att.storage_path ?? att.media?.storage_path,
  });
}

/**
 * Collect every unique safe media URL referenced by an offline question across
 * legacy fields, `question.media_attachments` (prompt/back/explanation/hint/audio),
 * `option.image_url` + `option.media_attachments`, and V3 `type_payload` fields.
 */
export function collectOfflineQuestionMediaUrls(
  question: OfflineQuestionRecord,
): string[] {
  const urls = new Set<string>();
  const addRaw = (raw: string | null | undefined): void => {
    if (!raw) return;
    const safe = resolveSafeMediaUrl({ url: raw });
    if (safe) {
      urls.add(safe);
    }
  };
  const addAttachment = (att: QuestionMediaAttachment): void => {
    const safe = resolveOfflineAttachmentUrl(att);
    if (safe) {
      urls.add(safe);
    }
  };

  addRaw(question.prompt_image_url);
  addRaw(question.back_image_url);
  addRaw(question.audio_url);

  for (const att of question.media_attachments ?? []) {
    addAttachment(att);
  }

  for (const opt of question.options ?? []) {
    addRaw(opt.image_url);
    for (const att of opt.media_attachments ?? []) {
      addAttachment(att);
    }
  }

  const payload = question.type_payload;
  if (payload) {
    if (payload.type === "listening") {
      addRaw(payload.audio_url);
    } else if (payload.type === "image_hotspot") {
      addRaw(payload.image_url);
    } else if (payload.type === "ordering") {
      for (const item of payload.items) {
        addRaw(item.image_url);
      }
    } else if (payload.type === "matching") {
      for (const pair of payload.pairs) {
        addRaw(pair.left_image_url);
        addRaw(pair.right_image_url);
      }
      for (const dist of payload.distractors ?? []) {
        addRaw(dist.right_image_url);
      }
    }
  }

  return Array.from(urls);
}

/**
 * Resolve all media URLs for an offline question into `{ [canonicalUrl]: blobUrl }`.
 * Every created object URL is tracked inside `bundle` and released by `bundle.revokeAllMediaUrls()`.
 */
export async function resolveOfflineQuestionMediaMap(
  bundle: Pick<OfflineStudyBundle, "resolveMediaUrl">,
  question: OfflineQuestionRecord,
): Promise<Record<string, string>> {
  const urls = collectOfflineQuestionMediaUrls(question);
  const resolvedEntries = await Promise.all(
    urls.map(async (url) => {
      const blobUrl = await bundle.resolveMediaUrl(url);
      return [url, blobUrl] as const;
    }),
  );

  const map: Record<string, string> = {};
  for (const [rawUrl, blobUrl] of resolvedEntries) {
    if (blobUrl) {
      map[rawUrl] = blobUrl;
    }
  }
  return map;
}

export interface MappedOfflineMediaResult {
  items: MediaDisplayItem[];
  missingOfflineCount: number;
}

/**
 * Map normalized `QuestionMediaAttachment[]` onto `MediaDisplayItem[]` backed by
 * cached offline `blob:` URLs (or original URL when online). Uncached attachments
 * while offline are counted in `missingOfflineCount` rather than rendering broken images.
 */
export function mapOfflineMediaAttachments(
  attachments: readonly QuestionMediaAttachment[],
  mediaSrcMap: Readonly<Record<string, string>>,
  options: { isOnline?: boolean; fallbackAlt?: string } = {},
): MappedOfflineMediaResult {
  const isOnline = options.isOnline ?? false;
  const seenCanonical = new Set<string>();
  const canonicalSrcMap = new Map<string, string>();
  for (const [rawKey, blobUrl] of Object.entries(mediaSrcMap)) {
    const canonKey = canonicalizeMediaUrlKey(rawKey);
    if (canonKey && !canonicalSrcMap.has(canonKey)) {
      canonicalSrcMap.set(canonKey, blobUrl);
    }
  }

  const items: MediaDisplayItem[] = [];
  let missingOfflineCount = 0;

  attachments.forEach((att, idx) => {
    const rawUrl = resolveOfflineAttachmentUrl(att);
    if (!rawUrl) return;
    const canonKey = canonicalizeMediaUrlKey(rawUrl) || rawUrl;
    if (seenCanonical.has(canonKey)) return;
    seenCanonical.add(canonKey);

    const cachedBlobUrl =
      mediaSrcMap[rawUrl] ?? canonicalSrcMap.get(canonKey) ?? null;
    const renderUrl = cachedBlobUrl ?? (isOnline ? rawUrl : null);
    if (!renderUrl) {
      missingOfflineCount += 1;
      return;
    }

    const isAudio =
      att.role === "audio" ||
      att.media?.kind === "audio" ||
      Boolean(att.mime_type?.toLowerCase().startsWith("audio/"));

    items.push({
      id: att.id || att.media_id || `${att.role}-${att.sort_order}-${idx}`,
      media_id: att.media_id || null,
      kind: isAudio ? "audio" : "image",
      url: renderUrl,
      storage_path: att.storage_path ?? att.media?.storage_path ?? null,
      mime_type: att.mime_type ?? att.media?.mime_type ?? null,
      file_name: att.media?.file_name ?? null,
      alt_text: att.alt_text ?? att.media?.alt_text ?? options.fallbackAlt ?? "",
      caption: att.caption ?? att.media?.caption ?? null,
      width: att.width ?? att.media?.width ?? null,
      height: att.height ?? att.media?.height ?? null,
      duration_ms: att.media?.duration_ms ?? null,
      sort_order: att.sort_order,
    });
  });

  return { items, missingOfflineCount };
}

// ============================================================================
// Deterministic Geometry & All-Type Offline Grading
// ============================================================================

function pointOnSegment(
  p: NormalizedPoint,
  a: NormalizedPoint,
  b: NormalizedPoint,
  epsilon = 1e-6,
): boolean {
  const cross = Math.abs((p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y));
  if (cross > epsilon) return false;
  const minX = Math.min(a.x, b.x) - epsilon;
  const maxX = Math.max(a.x, b.x) + epsilon;
  const minY = Math.min(a.y, b.y) - epsilon;
  const maxY = Math.max(a.y, b.y) + epsilon;
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

export function isPointInsideHotspotGeometry(
  geometry: HotspotGeometry,
  point: NormalizedPoint,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return false;
  }

  if (geometry.shape === "point") {
    const radius =
      typeof geometry.radius === "number" && geometry.radius > 0
        ? geometry.radius
        : 0.04;
    const dist = Math.hypot(point.x - geometry.x, point.y - geometry.y);
    return dist <= radius + 1e-9;
  }

  if (geometry.shape === "rect") {
    return (
      point.x >= geometry.x - 1e-9 &&
      point.x <= geometry.x + geometry.width + 1e-9 &&
      point.y >= geometry.y - 1e-9 &&
      point.y <= geometry.y + geometry.height + 1e-9
    );
  }

  // Polygon ray-casting + boundary check
  const pts = geometry.points;
  if (pts.length < 3) return false;

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (pointOnSegment(point, a, b)) {
      return true;
    }
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

export function evaluateOfflineDiagramHit(
  hotspot: Pick<DiagramHotspot, "geometry">,
  point: NormalizedPoint,
): boolean {
  return isPointInsideHotspotGeometry(hotspot.geometry, point);
}

export function gradeOfflineDiagramLabel(
  hotspot: Pick<DiagramHotspot, "label" | "accepted_alternatives">,
  typedAnswer: string,
  ignoreDiacritics: boolean = true,
): boolean {
  const accepted = [hotspot.label, ...(hotspot.accepted_alternatives ?? [])]
    .filter((s) => s.trim().length > 0)
    .map((answer_text) => ({
      answer_text,
      match_mode: ignoreDiacritics
        ? ("ignore_diacritics" as const)
        : ("case_insensitive" as const),
    }));
  return gradeWriteAnswer(typedAnswer, accepted, { ignoreDiacritics }).isCorrect;
}

function parseStrictFiniteNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(/,/g, ".");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
    return null;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Object.is(n, -0) ? 0 : n;
}

export interface OfflineGradeResult {
  isCorrect: boolean;
  details?: string;
}

/**
 * 100% deterministic offline answer grader supporting all 13 V3 question types.
 * Choice questions are ALWAYS graded by stable option UUID, never by display index or letter.
 */
export function gradeOfflineAnswer(
  question: OfflineQuestionRecord,
  response: StructuredAnswerResponse,
): OfflineGradeResult {
  const payload = question.type_payload;

  // 1. Choice-based grading (UUID exact set equality)
  if (response.kind === "options") {
    const correctIds = (question.options ?? [])
      .filter((o) => o.is_correct)
      .map((o) => o.id)
      .sort();
    const selectedIds = Array.from(new Set(response.selected_option_ids)).sort();
    if (correctIds.length === 0 || correctIds.length !== selectedIds.length) {
      return { isCorrect: false };
    }
    const isCorrect = correctIds.every((id, idx) => id === selectedIds[idx]);
    return { isCorrect };
  }

  // 2. Numerical grading (tolerance + unit)
  if (response.kind === "numerical" && payload?.type === "numerical") {
    const numericVal =
      typeof response.numeric_value === "number" &&
      Number.isFinite(response.numeric_value)
        ? response.numeric_value
        : parseStrictFiniteNumber(response.value);

    if (numericVal === null) {
      return { isCorrect: false, details: "invalid_number" };
    }

    if (payload.unit_required && payload.unit) {
      const providedUnit = (response.unit ?? "").trim().toLowerCase();
      const allowedUnits = [payload.unit, ...(payload.accepted_units ?? [])]
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
      if (!providedUnit || !allowedUnits.includes(providedUnit)) {
        return { isCorrect: false, details: "unit_mismatch" };
      }
    }

    const diff = Math.abs(numericVal - payload.correct_value);
    const absTol =
      typeof payload.abs_tolerance === "number" && payload.abs_tolerance >= 0
        ? payload.abs_tolerance
        : 0;
    const relTol =
      typeof payload.rel_tolerance === "number" && payload.rel_tolerance >= 0
        ? Math.abs(payload.correct_value) * payload.rel_tolerance
        : 0;
    const effectiveTol = Math.max(absTol, relTol, 1e-9);

    return { isCorrect: diff <= effectiveTol };
  }

  // 3. Fill-in-the-blank multi-blank grading
  if (response.kind === "blanks" && payload?.type === "fill_in_blank") {
    if (payload.blanks.length === 0) return { isCorrect: false };
    const allMatch = payload.blanks.every((blank) => {
      const userVal = response.answers[blank.blank_id] ?? "";
      const accepted = blank.accepted_answers.map((answer_text) => ({
        answer_text,
        match_mode: blank.match_mode ?? ("case_insensitive" as const),
      }));
      return gradeWriteAnswer(userVal, accepted, {
        strict: blank.case_sensitive ?? false,
      }).isCorrect;
    });
    return { isCorrect: allMatch };
  }

  // 4. Ordering exact UUID sequence
  if (response.kind === "ordering" && payload?.type === "ordering") {
    const expectedIds = [...payload.items]
      .sort((a, b) => a.correct_position - b.correct_position)
      .map((item) => item.id);
    if (expectedIds.length === 0 || expectedIds.length !== response.ordered_item_ids.length) {
      return { isCorrect: false };
    }
    const isCorrect = expectedIds.every(
      (id, idx) => id === response.ordered_item_ids[idx],
    );
    return { isCorrect };
  }

  // 5. Matching exact (left_id -> right_id) mapping
  if (response.kind === "matching" && payload?.type === "matching") {
    if (payload.pairs.length === 0) return { isCorrect: false };
    const isCorrect = payload.pairs.every(
      (pair) => response.pairs[pair.id] === pair.right_id,
    );
    return { isCorrect };
  }

  // 6. Image hotspot normalized [0,1] check
  if (response.kind === "hotspot" && payload?.type === "image_hotspot") {
    if (payload.target_hotspots.length === 0 || response.clicks.length === 0) {
      return { isCorrect: false };
    }
    if (payload.require_all_targets) {
      const allHit = payload.target_hotspots.every((target) =>
        response.clicks.some((click) =>
          isPointInsideHotspotGeometry(target.geometry, click),
        ),
      );
      return { isCorrect: allHit };
    }
    const anyHit = response.clicks.some((click) =>
      payload.target_hotspots.some((target) =>
        isPointInsideHotspotGeometry(target.geometry, click),
      ),
    );
    return { isCorrect: anyHit };
  }

  // 7. Short text / Write / Flashcard / Listening short answer
  if (response.kind === "text") {
    const expected = getExpectedWriteAnswers(question as unknown as Question);
    const graded = gradeWriteAnswer(response.value, expected);
    return { isCorrect: graded.isCorrect };
  }

  return { isCorrect: false };
}

// ============================================================================
// Spell Audio & Match Board Offline Helpers
// ============================================================================

export interface OfflineSpellAudioResolution {
  source:
    | "downloaded_audio"
    | "local_tts"
    | "network_tts_unavailable_offline"
    | "unavailable";
  blobUrl: string | null;
  speechText: string;
  lang: string;
  voiceName: string | null;
  offlineGuaranteed: boolean;
}

/**
 * Resolve offline audio for Spell mode:
 * 1. Prefer downloaded audio blob in IndexedDB (`media_blobs`).
 * 2. Fall back to a local OS `speechSynthesis` voice (`voice.localService === true`).
 * 3. Honestly disclose when only network TTS or no speech engine is available offline.
 */
export async function resolveOfflineSpellAudio(
  userId: string,
  question: OfflineQuestionRecord,
  resolveMediaUrl?: (url: string | null | undefined) => Promise<string | null>,
): Promise<OfflineSpellAudioResolution> {
  const audioAttachmentUrl = resolveOfflineAttachmentUrl(
    question.media_attachments?.find(
      (att) =>
        att.role === "audio" ||
        att.media?.kind === "audio" ||
        Boolean(att.mime_type?.toLowerCase().startsWith("audio/")),
    ),
  );
  const audioUrl =
    question.audio_url ??
    (question.type_payload?.type === "listening"
      ? question.type_payload.audio_url
      : null) ??
    audioAttachmentUrl;
  const lang =
    (question.type_payload?.type === "listening"
      ? question.type_payload.language
      : null) ?? "en-US";
  const speechText =
    question.back_text?.trim() ||
    question.accepted_answers?.[0]?.answer_text?.trim() ||
    question.options?.find((o) => o.is_correct)?.content?.trim() ||
    question.prompt.trim();

  if (audioUrl) {
    let blobUrl: string | null = null;
    if (resolveMediaUrl) {
      blobUrl = await resolveMediaUrl(audioUrl);
    } else {
      const blobRec = await getMediaBlob(userId, audioUrl);
      if (
        blobRec &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function"
      ) {
        blobUrl = URL.createObjectURL(blobRec.blob);
      }
    }
    if (blobUrl) {
      return {
        source: "downloaded_audio",
        blobUrl,
        speechText,
        lang,
        voiceName: null,
        offlineGuaranteed: true,
      };
    }
  }

  if (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.speechSynthesis?.getVoices === "function"
  ) {
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = lang.toLowerCase().split("-")[0] ?? "";
    const localMatch =
      voices.find(
        (v) => v.localService && v.lang.toLowerCase().startsWith(langPrefix),
      ) ?? voices.find((v) => v.localService);

    if (localMatch) {
      return {
        source: "local_tts",
        blobUrl: null,
        speechText,
        lang: localMatch.lang || lang,
        voiceName: localMatch.name,
        offlineGuaranteed: true,
      };
    }

    if (voices.length > 0) {
      return {
        source: "network_tts_unavailable_offline",
        blobUrl: null,
        speechText,
        lang,
        voiceName: null,
        offlineGuaranteed: false,
      };
    }
  }

  return {
    source: "unavailable",
    blobUrl: null,
    speechText,
    lang,
    voiceName: null,
    offlineGuaranteed: false,
  };
}

export function createOfflineMatchSession(
  questions: readonly OfflineQuestionRecord[],
  options: MatchRoundOptions = {},
): MatchBoardState {
  const candidates = questionsToMatchCandidates(
    questions as unknown as readonly Question[],
  );
  return createMatchBoard(candidates, options);
}

// ============================================================================
// Offline Persistence: Checkpoints, Study Actions, Stars, Notes
// ============================================================================

export function buildCheckpointKey(
  studySetId: string | null,
  mode: V3StudyMode,
  sessionKey: string = "default",
): string {
  return `${studySetId ?? "global"}:${mode}:${sessionKey}`;
}

export interface SaveOfflineCheckpointInput {
  study_set_id: string | null;
  mode: V3StudyMode;
  session_key?: string;
  current_index: number;
  total_items: number;
  state_json: Record<string, unknown>;
  enqueueSync?: boolean;
}

export async function saveOfflineCheckpoint(
  userId: string,
  input: SaveOfflineCheckpointInput,
): Promise<OfflineLocalCheckpointRecord> {
  const sessionKey = input.session_key ?? "default";
  const checkpointKey = buildCheckpointKey(
    input.study_set_id,
    input.mode,
    sessionKey,
  );
  const nowIso = new Date().toISOString();
  const safeTotal = Math.max(0, Math.floor(input.total_items));
  const safeIndex = Math.max(0, Math.min(safeTotal, Math.floor(input.current_index)));
  const progressPercent =
    safeTotal > 0 ? Math.min(100, Math.round((safeIndex / safeTotal) * 100)) : 0;

  const record: OfflineLocalCheckpointRecord = {
    checkpoint_key: checkpointKey,
    user_id: userId,
    study_set_id: input.study_set_id,
    mode: input.mode,
    session_key: sessionKey,
    state_json: input.state_json,
    progress_percent: progressPercent,
    current_index: safeIndex,
    total_items: safeTotal,
    updated_at: nowIso,
    synced: false,
  };

  await putLocalCheckpoint(userId, record);

  if (input.enqueueSync !== false) {
    await enqueueOfflineEvent(userId, {
      event_type: "checkpoint_upsert",
      study_set_id: input.study_set_id,
      payload: {
        mode: input.mode,
        // Use full compound checkpointKey so `(user_id, session_key)` never collides across sets/modes
        session_key: checkpointKey,
        state_json: input.state_json,
        progress_percent: progressPercent,
        current_index: safeIndex,
        total_items: safeTotal,
      },
    });
  }

  return record;
}

export async function loadOfflineCheckpoint(
  userId: string,
  studySetId: string | null,
  mode: V3StudyMode,
  sessionKey: string = "default",
): Promise<OfflineLocalCheckpointRecord | null> {
  const key = buildCheckpointKey(studySetId, mode, sessionKey);
  return getLocalCheckpoint(userId, key);
}

export async function clearOfflineCheckpoint(
  userId: string,
  studySetId: string | null,
  mode: V3StudyMode,
  sessionKey: string = "default",
): Promise<void> {
  const key = buildCheckpointKey(studySetId, mode, sessionKey);
  await deleteLocalCheckpoint(userId, key);
}

/**
 * Record an offline answer + SM-2 progress update + optional confidence tag and enqueue for sync.
 */
export async function recordOfflineStudyAction(
  userId: string,
  action: OfflineStudyActionInput,
): Promise<void> {
  const question = await getQuestionById(userId, action.question_id);
  const outcome = action.self_rating ?? action.is_correct;
  const nextSm2 = calculateNextReview(question?.local_progress, outcome);

  if (question) {
    await putQuestion(userId, {
      ...question,
      local_progress: {
        ...nextSm2,
        last_confidence:
          action.confidence ?? question.local_progress?.last_confidence ?? null,
      },
    });
  }

  // Note: `sync_offline_learning_events` atomically logs confidence + updates calibration counters
  // when `confidence` is attached to an `answer` event (preventing duplicate confidence rows).
  await enqueueOfflineEvent(userId, {
    event_type: "answer",
    study_set_id: action.study_set_id,
    question_id: action.question_id,
    payload: {
      mode: action.mode,
      is_correct: action.is_correct,
      self_rating: action.self_rating ?? null,
      selected_option_ids: action.selected_option_ids ?? [],
      typed_answer: action.typed_answer ?? null,
      structured_response: action.structured_response ?? null,
      confidence: action.confidence ?? null,
      hint_used: action.hint_used ?? false,
      response_time_ms: action.response_time_ms ?? null,
      sm2: nextSm2,
    },
  });
}

export async function toggleOfflineStar(
  userId: string,
  studySetId: string,
  questionId: string,
  starred: boolean,
): Promise<void> {
  const question = await getQuestionById(userId, questionId);
  if (question) {
    await putQuestion(userId, {
      ...question,
      is_starred: starred,
    });
  }

  await enqueueOfflineEvent(userId, {
    event_type: "star",
    study_set_id: studySetId,
    question_id: questionId,
    payload: { starred },
  });
}

export async function saveOfflineNote(
  userId: string,
  studySetId: string,
  questionId: string,
  contentText: string,
  contentRich: RichTextDoc | null = null,
): Promise<OfflineLocalNoteRecord> {
  const existing = await getLocalNote(userId, questionId);
  const nowIso = new Date().toISOString();
  const baseVersion = existing?.base_version ?? existing?.version ?? null;
  const nextVersion = (existing?.version ?? 0) + 1;

  const updated: OfflineLocalNoteRecord = {
    question_id: questionId,
    study_set_id: studySetId,
    user_id: userId,
    content_text: contentText,
    content_rich: contentRich,
    version: nextVersion,
    base_version: baseVersion,
    dirty: true,
    updated_at: nowIso,
    conflict: existing?.conflict ?? null,
  };

  await putLocalNote(userId, updated);

  await enqueueOfflineEvent(userId, {
    event_type: "note_upsert",
    study_set_id: studySetId,
    question_id: questionId,
    base_version: baseVersion,
    payload: {
      content_text: contentText,
      content_rich: contentRich,
    },
  });

  return updated;
}

// ============================================================================
// Active Offline Session Persistence (Survives F5 Reload Offline — RU-19)
// ============================================================================

const ACTIVE_OFFLINE_SESSION_KEY = "studyhub-offline-active-session-v1";

export interface ActiveOfflineSessionState {
  userId: string;
  setId: string;
  mode: OfflineCapableMode;
  questionIndex: number;
}

export function parseOfflineSessionHash(
  hash: string | null | undefined,
): Omit<ActiveOfflineSessionState, "userId"> | null {
  if (!hash) return null;
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!cleaned) return null;
  try {
    const params = new URLSearchParams(cleaned);
    const setId = params.get("set")?.trim() || "";
    if (!setId) return null;
    const rawMode = params.get("mode")?.trim() || "flashcards";
    const mode: OfflineCapableMode = OFFLINE_SUPPORTED_MODES.has(rawMode)
      ? (rawMode as OfflineCapableMode)
      : "flashcards";
    const rawQ = Number(params.get("q") ?? "0");
    const questionIndex =
      Number.isFinite(rawQ) && rawQ >= 0 ? Math.floor(rawQ) : 0;
    return { setId, mode, questionIndex };
  } catch {
    return null;
  }
}

export function formatOfflineSessionHash(
  state: Omit<ActiveOfflineSessionState, "userId">,
): string {
  const params = new URLSearchParams();
  params.set("set", state.setId);
  params.set("mode", state.mode);
  params.set("q", String(Math.max(0, Math.floor(state.questionIndex))));
  return `#${params.toString()}`;
}

export function saveActiveOfflineSessionState(
  state: ActiveOfflineSessionState,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ACTIVE_OFFLINE_SESSION_KEY,
      JSON.stringify({
        userId: state.userId,
        setId: state.setId,
        mode: state.mode,
        questionIndex: Math.max(0, Math.floor(state.questionIndex)),
      }),
    );
  } catch {
    // Ignore restricted sessionStorage
  }
  try {
    const nextHash = formatOfflineSessionHash({
      setId: state.setId,
      mode: state.mode,
      questionIndex: state.questionIndex,
    });
    if (window.location.hash !== nextHash) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${nextHash}`,
      );
    }
  } catch {
    // Ignore history API restrictions
  }
}

export function loadActiveOfflineSessionState(
  userId: string,
): Omit<ActiveOfflineSessionState, "userId"> | null {
  if (typeof window === "undefined" || !userId.trim()) return null;

  const fromHash = parseOfflineSessionHash(window.location.hash);
  if (fromHash) {
    return fromHash;
  }

  try {
    const raw = window.sessionStorage.getItem(ACTIVE_OFFLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveOfflineSessionState>;
    if (
      parsed.userId !== userId ||
      typeof parsed.setId !== "string" ||
      parsed.setId.trim().length === 0
    ) {
      return null;
    }
    const mode: OfflineCapableMode =
      typeof parsed.mode === "string" && OFFLINE_SUPPORTED_MODES.has(parsed.mode)
        ? (parsed.mode as OfflineCapableMode)
        : "flashcards";
    const questionIndex =
      typeof parsed.questionIndex === "number" &&
      Number.isFinite(parsed.questionIndex) &&
      parsed.questionIndex >= 0
        ? Math.floor(parsed.questionIndex)
        : 0;
    return {
      setId: parsed.setId.trim(),
      mode,
      questionIndex,
    };
  } catch {
    return null;
  }
}

export function clearActiveOfflineSessionState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACTIVE_OFFLINE_SESSION_KEY);
  } catch {
    // Ignore restricted sessionStorage
  }
  try {
    if (window.location.hash || window.location.search.includes("setId=")) {
      const nextUrl = new URL(window.location.href);
      nextUrl.hash = "";
      nextUrl.searchParams.delete("setId");
      window.history.replaceState(
        null,
        "",
        `${nextUrl.pathname}${nextUrl.search}`,
      );
    }
  } catch {
    // Ignore history API restrictions
  }
}
