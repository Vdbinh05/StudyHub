import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  normalizeAnswerText,
  sanitizeRichTextDoc,
  slugifyTag,
} from "@/lib/security/sanitize";
import {
  chunkArray,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { consumeTempUploadBytes } from "@/lib/supabase/temp-storage";
import {
  answerMatchModeSchema,
  difficultySchema,
  hotspotShapeSchema,
  nullableSafeUrlSchema,
  questionTypeSchema,
  studySetTypeSchema,
  visibilitySchema,
} from "@/lib/validation/common";
import { updatePreferencesSchema } from "@/lib/validation/profile";
import {
  hotspotGeometrySchema,
  nullableRichTextDocSchema,
  questionTypePayloadSchema,
} from "@/lib/validation/v3";
import { V3_BACKUP_SCOPE } from "@/lib/supabase/backup-scope";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

// V32-006 / FUNC-05: Aligned with client Settings UI 15 MB backup upload cap
const MAX_BACKUP_BYTES = 15 * 1024 * 1024; // 15 MB cap
const INSERT_BATCH_SIZE = 200;

const stagedRestoreSchema = z.object({
  storagePath: z.string().trim().min(1).max(300),
  mode: z.enum(["merge", "append"]).optional(),
});

const safeNullableMediaIdSchema = z
  .string()
  .uuid()
  .nullable()
  .optional()
  .catch(null);

const v3RestoreBackupSchema = z.object({
  schema_version: z.string().min(1).max(40).optional(),
  version: z.string().min(1).max(20).optional(),
  exported_at: z.string().optional(),
  mode: z.enum(["merge", "append"]).default("merge"),
  preferences: updatePreferencesSchema.nullable().optional(),
  folders: z
    .array(
      z.object({
        id: z.string().optional(),
        parent_id: z.string().nullable().optional(),
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).nullable().optional(),
        color: z.string().trim().max(30).optional(),
        icon: z.string().trim().max(40).optional(),
        sort_order: z.number().int().min(0).optional(),
      }),
    )
    .max(500)
    .optional(),
  study_sets: z
    .array(
      z.object({
        id: z.string().optional(),
        folder_id: z.string().nullable().optional(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        subject: z.string().trim().max(100).nullable().optional(),
        set_type: studySetTypeSchema.optional(),
        visibility: visibilitySchema.optional(),
        source_language: z.string().trim().min(2).max(20).optional(),
        default_exam_duration_minutes: z.number().int().min(1).max(300).optional(),
        default_pass_threshold: z.number().int().min(1).max(100).optional(),
        is_archived: z.boolean().optional(),
        is_favorite: z.boolean().optional(),
      }),
    )
    .max(500)
    .optional(),
  shared_passages: z
    .array(
      z.object({
        id: z.string().optional(),
        study_set_id: z.string(),
        title: z.string().trim().min(1).max(200),
        content_text: z.string().trim().min(1).max(40000),
        content_rich: nullableRichTextDocSchema,
        audio_media_id: safeNullableMediaIdSchema,
        transcript: z.string().trim().max(40000).nullable().optional(),
        source_reference: z.string().trim().max(500).nullable().optional(),
        sort_order: z.number().int().min(0).optional(),
      }),
    )
    .max(5000)
    .optional(),
  diagram_sets: z
    .array(
      z.object({
        id: z.string().optional(),
        study_set_id: z.string(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        base_media_id: safeNullableMediaIdSchema,
        base_image_url: z.string().trim().min(1).max(2000),
        image_width: z.number().int().min(1).max(20000).nullable().optional(),
        image_height: z.number().int().min(1).max(20000).nullable().optional(),
      }),
    )
    .max(2000)
    .optional(),
  diagram_hotspots: z
    .array(
      z.object({
        id: z.string().optional(),
        diagram_id: z.string(),
        study_set_id: z.string().optional(),
        label: z.string().trim().min(1).max(200),
        accepted_alternatives: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
        description: z.string().trim().max(2000).nullable().optional(),
        hint: z.string().trim().max(500).nullable().optional(),
        shape: hotspotShapeSchema,
        geometry: hotspotGeometrySchema,
        sort_order: z.number().int().min(0).optional(),
      }),
    )
    .max(50_000)
    .optional(),
  questions: z
    .array(
      z.object({
        id: z.string().optional(),
        study_set_id: z.string(),
        question_type: questionTypeSchema.optional(),
        position: z.number().int().min(0).optional(),
        chapter: z.string().trim().max(200).nullable().optional(),
        prompt: z.string().max(10000),
        prompt_rich: nullableRichTextDocSchema,
        prompt_image_url: nullableSafeUrlSchema,
        back_text: z.string().trim().max(10000).nullable().optional(),
        back_rich: nullableRichTextDocSchema,
        back_image_url: nullableSafeUrlSchema,
        explanation: z.string().trim().max(10000).nullable().optional(),
        explanation_rich: nullableRichTextDocSchema,
        hint: z.string().trim().max(2000).nullable().optional(),
        hint_rich: nullableRichTextDocSchema,
        audio_media_id: safeNullableMediaIdSchema,
        audio_url: nullableSafeUrlSchema,
        audio_transcript: z.string().trim().max(40000).nullable().optional(),
        passage_id: z.string().nullable().optional(),
        diagram_id: z.string().nullable().optional(),
        type_payload: questionTypePayloadSchema.nullable().optional(),
        difficulty: difficultySchema.optional(),
        source_metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(25_000)
    .optional(),
  question_options: z
    .array(
      z.object({
        id: z.string().optional(),
        question_id: z.string(),
        position: z.number().int().min(0).optional(),
        label: z.string().trim().min(1).max(10),
        content: z.string().max(4000),
        content_rich: nullableRichTextDocSchema,
        image_url: nullableSafeUrlSchema,
        media_id: safeNullableMediaIdSchema,
        image_alt: z.string().trim().max(500).nullable().optional(),
        is_correct: z.boolean().default(false),
      }),
    )
    .max(100_000)
    .optional(),
  question_accepted_answers: z
    .array(
      z.object({
        question_id: z.string(),
        answer_text: z.string().trim().min(1).max(1000),
        match_mode: answerMatchModeSchema.optional(),
      }),
    )
    .max(50_000)
    .optional(),
  tags: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(50),
        color: z.string().trim().max(30).optional(),
      }),
    )
    .max(1000)
    .optional(),
  question_tags: z
    .array(
      z.object({
        question_id: z.string(),
        tag_id: z.string(),
      }),
    )
    .max(100_000)
    .optional(),
  user_question_notes: z
    .array(
      z.object({
        question_id: z.string(),
        study_set_id: z.string().optional(),
        content_text: z.string().trim().max(10000),
        content_rich: nullableRichTextDocSchema,
      }),
    )
    .max(50_000)
    .optional(),
  content_media_relations: z
    .array(
      z.object({
        media_id: z.string().uuid(),
        entity_type: z.enum(["question", "question_option"]),
        entity_id: z.string(),
        role: z.enum(["prompt", "back", "option", "explanation", "hint", "audio"]),
        sort_order: z.number().int().min(0).max(100).optional(),
        alt_text: z.string().trim().max(500).nullable().optional(),
        caption: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .max(100_000)
    .optional(),
});

function remapTypePayloadIds(
  rawPayload: Record<string, unknown> | null | undefined,
  passageIdMap: ReadonlyMap<string, string>,
  diagramIdMap: ReadonlyMap<string, string>,
  validOwnedMediaIds: ReadonlySet<string>,
): Json | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const next: Record<string, unknown> = { ...rawPayload };

  if (typeof next.passage_id === "string") {
    next.passage_id = passageIdMap.get(next.passage_id) ?? null;
  }
  if (typeof next.diagram_id === "string") {
    next.diagram_id = diagramIdMap.get(next.diagram_id) ?? null;
  }
  if (typeof next.audio_media_id === "string" && !validOwnedMediaIds.has(next.audio_media_id)) {
    next.audio_media_id = null;
  }
  if (typeof next.image_media_id === "string" && !validOwnedMediaIds.has(next.image_media_id)) {
    next.image_media_id = null;
  }
  if (next.passage_rich && typeof next.passage_rich === "object") {
    next.passage_rich = sanitizeRichTextDoc(next.passage_rich);
  }
  if (Array.isArray(next.items)) {
    next.items = next.items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = { ...(item as Record<string, unknown>) };
      if (typeof rec.media_id === "string" && !validOwnedMediaIds.has(rec.media_id)) {
        rec.media_id = null;
      }
      if (rec.rich_text && typeof rec.rich_text === "object") {
        rec.rich_text = sanitizeRichTextDoc(rec.rich_text);
      }
      return rec;
    });
  }
  if (Array.isArray(next.pairs)) {
    next.pairs = next.pairs.map((pair) => {
      if (!pair || typeof pair !== "object") return pair;
      const rec = { ...(pair as Record<string, unknown>) };
      if (rec.left_rich_text && typeof rec.left_rich_text === "object") {
        rec.left_rich_text = sanitizeRichTextDoc(rec.left_rich_text);
      }
      if (rec.right_rich_text && typeof rec.right_rich_text === "object") {
        rec.right_rich_text = sanitizeRichTextDoc(rec.right_rich_text);
      }
      return rec;
    });
  }

  return next as Json;
}

/**
 * Restores a StudyHub JSON account backup (`studyhub-v3` and backward-compatible `studyhub-v2`)
 * exported via `GET /api/account/data` (V32-006 / FUNC-05).
 * Preserves ALL V3 question/option columns, shared passages, diagram sets/hotspots, and personal notes
 * with fresh UUIDs and strict `user.id` ownership.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.ACCOUNT_RESTORE,
      user.id,
    );
    if (limited) return limited;

    const rawBody = await parseJsonBody(request, MAX_BACKUP_BYTES);
    let backupPayload: unknown = rawBody;

    if (
      rawBody &&
      typeof rawBody === "object" &&
      !Array.isArray(rawBody) &&
      typeof (rawBody as Record<string, unknown>).storagePath === "string"
    ) {
      const stagedReq = stagedRestoreSchema.parse(rawBody);
      const { bytes, cleanup } = await consumeTempUploadBytes(supabase, {
        userId: user.id,
        storagePath: stagedReq.storagePath,
        expectedPurpose: "restore",
        maxBytes: MAX_BACKUP_BYTES,
      });

      try {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new AppError(
            "VALIDATION_ERROR",
            "Uploaded backup file is not valid JSON.",
            400,
          );
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new AppError(
            "VALIDATION_ERROR",
            "Uploaded backup file must be a JSON object.",
            400,
          );
        }

        const record = parsed as Record<string, unknown>;
        const unwrapped =
          record.data &&
          typeof record.data === "object" &&
          !Array.isArray(record.data)
            ? (record.data as Record<string, unknown>)
            : record;

        backupPayload = stagedReq.mode
          ? { ...unwrapped, mode: stagedReq.mode }
          : unwrapped;
      } finally {
        await cleanup();
      }
    }

    const input = v3RestoreBackupSchema.parse(backupPayload);
    const detectedVersion =
      input.schema_version ?? input.version ?? "studyhub-v2";

    // Pre-verify any referenced media_asset UUIDs belong to caller so FK inserts NEVER fail on cross-account/wiped restores
    const candidateMediaIds = new Set<string>();
    for (const sp of input.shared_passages ?? []) {
      if (sp.audio_media_id) candidateMediaIds.add(sp.audio_media_id);
    }
    for (const ds of input.diagram_sets ?? []) {
      if (ds.base_media_id) candidateMediaIds.add(ds.base_media_id);
    }
    for (const q of input.questions ?? []) {
      if (q.audio_media_id) candidateMediaIds.add(q.audio_media_id);
      const tp = q.type_payload as Record<string, unknown> | null | undefined;
      if (tp && typeof tp === "object") {
        if (typeof tp.audio_media_id === "string") candidateMediaIds.add(tp.audio_media_id);
        if (typeof tp.image_media_id === "string") candidateMediaIds.add(tp.image_media_id);
        if (Array.isArray(tp.items)) {
          for (const it of tp.items) {
            if (it && typeof it === "object" && typeof (it as Record<string, unknown>).media_id === "string") {
              candidateMediaIds.add((it as Record<string, unknown>).media_id as string);
            }
          }
        }
      }
    }
    for (const o of input.question_options ?? []) {
      if (o.media_id) candidateMediaIds.add(o.media_id);
    }
    for (const rel of input.content_media_relations ?? []) {
      if (rel.media_id) candidateMediaIds.add(rel.media_id);
    }

    const validOwnedMediaIds = new Set<string>();
    if (candidateMediaIds.size > 0) {
      const existingMedia = await fetchInChunks(
        Array.from(candidateMediaIds),
        async (chunk) =>
          supabase
            .from("media_assets")
            .select("id")
            .eq("owner_id", user.id)
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      for (const m of existingMedia) {
        validOwnedMediaIds.add(m.id);
      }
    }

    let preferencesRestored = false;
    if (input.preferences && Object.keys(input.preferences).length > 0) {
      const { error: prefErr } = await supabase
        .from("user_preferences")
        .upsert(
          { user_id: user.id, ...input.preferences },
          { onConflict: "user_id" },
        );
      if (prefErr) throw prefErr;
      preferencesRestored = true;
    }

    // 1. Restore folders preserving parent hierarchy
    const folderIdMap = new Map<string, string>();
    const foldersInput = input.folders ?? [];
    for (const f of foldersInput) {
      if (f.id) folderIdMap.set(f.id, randomUUID());
    }

    const insertedFolders = new Set<string>();
    let restoredFolders = 0;
    const pendingFolders = [...foldersInput];
    let safetyPasses = 0;

    while (pendingFolders.length > 0 && safetyPasses < 16) {
      safetyPasses += 1;
      const ready: typeof pendingFolders = [];
      const deferred: typeof pendingFolders = [];

      for (const f of pendingFolders) {
        const parentOld = f.parent_id ?? null;
        if (
          !parentOld ||
          !folderIdMap.has(parentOld) ||
          insertedFolders.has(parentOld)
        ) {
          ready.push(f);
        } else {
          deferred.push(f);
        }
      }

      const toInsert = ready.length > 0 ? ready : deferred;
      const rows = toInsert.map((f) => {
        const newId = f.id ? (folderIdMap.get(f.id) ?? randomUUID()) : randomUUID();
        if (f.id) folderIdMap.set(f.id, newId);
        const mappedParent =
          f.parent_id && insertedFolders.has(f.parent_id)
            ? (folderIdMap.get(f.parent_id) ?? null)
            : null;
        return {
          id: newId,
          owner_id: user.id,
          parent_id: mappedParent,
          name: f.name,
          description: f.description ?? null,
          color: f.color ?? "indigo",
          icon: f.icon ?? "folder",
          sort_order: f.sort_order ?? 0,
        };
      });

      if (rows.length > 0) {
        const { error: fErr } = await supabase.from("folders").insert(rows);
        if (fErr) throw fErr;
        restoredFolders += rows.length;
        for (const f of toInsert) {
          if (f.id) insertedFolders.add(f.id);
        }
      }

      if (ready.length === 0) break;
      pendingFolders.length = 0;
      pendingFolders.push(...deferred);
    }

    // 2. Restore tags (upsert into caller's namespace by slug)
    const tagIdMap = new Map<string, string>();
    let restoredTags = 0;
    const tagsInput = input.tags ?? [];
    if (tagsInput.length > 0) {
      const slugToOldIds = new Map<string, string[]>();
      const tagUpserts: Array<{
        owner_id: string;
        name: string;
        slug: string;
        color: string;
      }> = [];
      const seenSlugs = new Set<string>();

      for (const t of tagsInput) {
        const slug = slugifyTag(t.name);
        if (t.id) {
          const arr = slugToOldIds.get(slug) ?? [];
          arr.push(t.id);
          slugToOldIds.set(slug, arr);
        }
        if (!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          tagUpserts.push({
            owner_id: user.id,
            name: t.name,
            slug,
            color: t.color ?? "slate",
          });
        }
      }

      for (const batch of chunkArray(tagUpserts, INSERT_BATCH_SIZE)) {
        const { data: savedTags, error: tErr } = await supabase
          .from("tags")
          .upsert(batch, { onConflict: "owner_id,slug" })
          .select("id, slug");
        if (tErr) throw tErr;
        restoredTags += (savedTags ?? []).length;
        for (const st of savedTags ?? []) {
          for (const oldId of slugToOldIds.get(st.slug) ?? []) {
            tagIdMap.set(oldId, st.id);
          }
        }
      }
    }

    // 3. Restore study sets (always private on restore for safety)
    const setIdMap = new Map<string, string>();
    const setsInput = input.study_sets ?? [];
    let restoredSets = 0;

    if (setsInput.length > 0) {
      const setRows = setsInput.map((s) => {
        const newId = randomUUID();
        if (s.id) setIdMap.set(s.id, newId);
        return {
          id: newId,
          owner_id: user.id,
          folder_id: s.folder_id ? (folderIdMap.get(s.folder_id) ?? null) : null,
          title: s.title,
          description: s.description ?? null,
          subject: s.subject ?? null,
          set_type: s.set_type ?? "multiple_choice",
          visibility: "private" as const,
          source_language: s.source_language ?? "vi",
          default_exam_duration_minutes: s.default_exam_duration_minutes ?? 45,
          default_pass_threshold: s.default_pass_threshold ?? 70,
          is_archived: s.is_archived ?? false,
          is_favorite: s.is_favorite ?? false,
        };
      });

      for (const batch of chunkArray(setRows, INSERT_BATCH_SIZE)) {
        const { error: sErr } = await supabase.from("study_sets").insert(batch);
        if (sErr) throw sErr;
        restoredSets += batch.length;
      }
    }

    // 4a. Restore V3 shared_passages mapped to new study_set IDs
    const passageIdMap = new Map<string, string>();
    let restoredPassages = 0;
    const validPassages = (input.shared_passages ?? [])
      .map((sp, idx) => {
        const newSetId = setIdMap.get(sp.study_set_id);
        if (!newSetId) return null;
        const newId = randomUUID();
        if (sp.id) passageIdMap.set(sp.id, newId);
        return {
          id: newId,
          study_set_id: newSetId,
          owner_id: user.id,
          title: sp.title,
          content_text: sp.content_text,
          content_rich: (sp.content_rich ?? null) as Json | null,
          audio_media_id:
            sp.audio_media_id && validOwnedMediaIds.has(sp.audio_media_id)
              ? sp.audio_media_id
              : null,
          transcript: sp.transcript ?? null,
          source_reference: sp.source_reference ?? null,
          sort_order: sp.sort_order ?? idx,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validPassages, INSERT_BATCH_SIZE)) {
      const { error: spErr } = await supabase.from("shared_passages").insert(batch);
      if (spErr) throw spErr;
      restoredPassages += batch.length;
    }

    // 4b. Restore V3 diagram_sets & diagram_hotspots mapped to new study_set IDs
    const diagramIdMap = new Map<string, string>();
    const diagramSetIdByOldId = new Map<string, string>();
    let restoredDiagrams = 0;
    const validDiagrams = (input.diagram_sets ?? [])
      .map((ds) => {
        const newSetId = setIdMap.get(ds.study_set_id);
        if (!newSetId) return null;
        const newId = randomUUID();
        if (ds.id) {
          diagramIdMap.set(ds.id, newId);
          diagramSetIdByOldId.set(ds.id, newSetId);
        }
        return {
          id: newId,
          study_set_id: newSetId,
          owner_id: user.id,
          title: ds.title,
          description: ds.description ?? null,
          base_media_id:
            ds.base_media_id && validOwnedMediaIds.has(ds.base_media_id)
              ? ds.base_media_id
              : null,
          base_image_url: ds.base_image_url,
          image_width: ds.image_width ?? null,
          image_height: ds.image_height ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validDiagrams, INSERT_BATCH_SIZE)) {
      const { error: dsErr } = await supabase.from("diagram_sets").insert(batch);
      if (dsErr) throw dsErr;
      restoredDiagrams += batch.length;
    }

    let restoredHotspots = 0;
    const validHotspots = (input.diagram_hotspots ?? [])
      .map((dh, idx) => {
        const newDiagramId = diagramIdMap.get(dh.diagram_id);
        const newSetId =
          diagramSetIdByOldId.get(dh.diagram_id) ??
          (dh.study_set_id ? setIdMap.get(dh.study_set_id) : undefined);
        if (!newDiagramId || !newSetId) return null;
        return {
          diagram_id: newDiagramId,
          study_set_id: newSetId,
          label: dh.label,
          accepted_alternatives: dh.accepted_alternatives ?? [],
          description: dh.description ?? null,
          hint: dh.hint ?? null,
          shape: dh.shape,
          geometry: dh.geometry as Json,
          sort_order: dh.sort_order ?? idx,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validHotspots, INSERT_BATCH_SIZE)) {
      const { error: dhErr } = await supabase.from("diagram_hotspots").insert(batch);
      if (dhErr) throw dhErr;
      restoredHotspots += batch.length;
    }

    // 5. Restore questions preserving ALL V3 columns + remapping passage_id/diagram_id/type_payload
    const questionIdMap = new Map<string, { newId: string; newSetId: string }>();
    const questionsInput = input.questions ?? [];
    let restoredQuestions = 0;

    const validQuestions = questionsInput
      .map((q, idx) => {
        const newSetId = setIdMap.get(q.study_set_id);
        if (!newSetId) return null;

        const mappedPassageId = q.passage_id
          ? (passageIdMap.get(q.passage_id) ?? null)
          : null;
        const mappedDiagramId = q.diagram_id
          ? (diagramIdMap.get(q.diagram_id) ?? null)
          : null;
        const verifiedAudioMediaId =
          q.audio_media_id && validOwnedMediaIds.has(q.audio_media_id)
            ? q.audio_media_id
            : null;

        // Satisfy questions_prompt_or_media_v3_chk even if legacy data had whitespace-only prompt without media
        const hasMediaAnchor = Boolean(
          q.prompt_image_url ||
            verifiedAudioMediaId ||
            q.audio_url ||
            mappedDiagramId,
        );
        const normalizedPrompt =
          q.prompt.trim().length > 0 || hasMediaAnchor
            ? q.prompt
            : "[Restored question]";

        const newId = randomUUID();
        if (q.id) questionIdMap.set(q.id, { newId, newSetId });

        return {
          id: newId,
          study_set_id: newSetId,
          question_type: q.question_type ?? "single_choice",
          position: q.position ?? idx,
          chapter: q.chapter ?? null,
          prompt: normalizedPrompt,
          prompt_rich: (q.prompt_rich ?? null) as Json | null,
          prompt_image_url: q.prompt_image_url ?? null,
          back_text: q.back_text ?? null,
          back_rich: (q.back_rich ?? null) as Json | null,
          back_image_url: q.back_image_url ?? null,
          explanation: q.explanation ?? null,
          explanation_rich: (q.explanation_rich ?? null) as Json | null,
          hint: q.hint ?? null,
          hint_rich: (q.hint_rich ?? null) as Json | null,
          audio_media_id: verifiedAudioMediaId,
          audio_url: q.audio_url ?? null,
          audio_transcript: q.audio_transcript ?? null,
          passage_id: mappedPassageId,
          diagram_id: mappedDiagramId,
          type_payload: remapTypePayloadIds(
            q.type_payload as Record<string, unknown> | null | undefined,
            passageIdMap,
            diagramIdMap,
            validOwnedMediaIds,
          ),
          difficulty: q.difficulty ?? "medium",
          source_metadata: (q.source_metadata ?? {}) as Json,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validQuestions, INSERT_BATCH_SIZE)) {
      const { error: qErr } = await supabase.from("questions").insert(batch);
      if (qErr) throw qErr;
      restoredQuestions += batch.length;
    }

    // 6. Restore options (preserving V3 content_rich & image_alt & mapping IDs for option media relations),
    // accepted answers, question_tags, content_media_relations & notes
    let restoredOptions = 0;
    const optionIdMap = new Map<string, string>();
    const validOptions = (input.question_options ?? [])
      .map((o, idx) => {
        const mapped = questionIdMap.get(o.question_id);
        if (!mapped) return null;
        const newOptionId = randomUUID();
        if (o.id) optionIdMap.set(o.id, newOptionId);
        const verifiedMediaId =
          o.media_id && validOwnedMediaIds.has(o.media_id) ? o.media_id : null;
        const normalizedContent =
          o.content.trim().length > 0 || o.image_url || verifiedMediaId
            ? o.content
            : o.label;
        return {
          id: newOptionId,
          question_id: mapped.newId,
          study_set_id: mapped.newSetId,
          position: o.position ?? idx,
          label: o.label,
          content: normalizedContent,
          content_rich: (o.content_rich ?? null) as Json | null,
          image_url: o.image_url ?? null,
          media_id: verifiedMediaId,
          image_alt: o.image_alt ?? null,
          is_correct: o.is_correct,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validOptions, INSERT_BATCH_SIZE)) {
      const { error: oErr } = await supabase
        .from("question_options")
        .insert(batch);
      if (oErr) throw oErr;
      restoredOptions += batch.length;
    }

    // 6b. Restore content_media_relations for caller-owned media_assets (prompt, back, option, explanation, hint, audio)
    let restoredMediaRelations = 0;
    const validMediaRelations = (input.content_media_relations ?? [])
      .map((rel, idx) => {
        if (!validOwnedMediaIds.has(rel.media_id)) return null;
        const newEntityId =
          rel.entity_type === "question"
            ? questionIdMap.get(rel.entity_id)?.newId
            : optionIdMap.get(rel.entity_id);
        if (!newEntityId) return null;
        return {
          media_id: rel.media_id,
          entity_type: rel.entity_type,
          entity_id: newEntityId,
          role: rel.role,
          sort_order: rel.sort_order ?? idx,
          alt_text: rel.alt_text ?? null,
          caption: rel.caption ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validMediaRelations, INSERT_BATCH_SIZE)) {
      const { error: mrErr } = await supabase
        .from("content_media_relations")
        .upsert(batch, {
          onConflict: "media_id,entity_type,entity_id,role",
          ignoreDuplicates: true,
        });
      if (mrErr) throw mrErr;
      restoredMediaRelations += batch.length;
    }

    let restoredAccepted = 0;
    const validAccepted = (input.question_accepted_answers ?? [])
      .map((a) => {
        const mapped = questionIdMap.get(a.question_id);
        if (!mapped) return null;
        const mode = a.match_mode ?? "case_insensitive";
        return {
          question_id: mapped.newId,
          study_set_id: mapped.newSetId,
          answer_text: a.answer_text,
          normalized_answer: normalizeAnswerText(a.answer_text, mode),
          match_mode: mode,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validAccepted, INSERT_BATCH_SIZE)) {
      const { error: aErr } = await supabase
        .from("question_accepted_answers")
        .insert(batch);
      if (aErr) throw aErr;
      restoredAccepted += batch.length;
    }

    const validQTags = (input.question_tags ?? [])
      .map((qt) => {
        const mappedQ = questionIdMap.get(qt.question_id);
        const mappedT = tagIdMap.get(qt.tag_id);
        if (!mappedQ || !mappedT) return null;
        return {
          question_id: mappedQ.newId,
          tag_id: mappedT,
          study_set_id: mappedQ.newSetId,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validQTags, INSERT_BATCH_SIZE)) {
      const { error: qtErr } = await supabase
        .from("question_tags")
        .upsert(batch, { onConflict: "question_id,tag_id", ignoreDuplicates: true });
      if (qtErr) throw qtErr;
    }

    // 7. Restore user_question_notes strictly owned by authenticated caller
    let restoredNotes = 0;
    const seenNoteQuestions = new Set<string>();
    const validNotes = (input.user_question_notes ?? [])
      .map((n) => {
        const mappedQ = questionIdMap.get(n.question_id);
        if (!mappedQ || seenNoteQuestions.has(mappedQ.newId)) return null;
        seenNoteQuestions.add(mappedQ.newId);
        return {
          user_id: user.id,
          study_set_id: mappedQ.newSetId,
          question_id: mappedQ.newId,
          content_text: n.content_text,
          content_rich: (n.content_rich ?? null) as Json | null,
          version: 1,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    for (const batch of chunkArray(validNotes, INSERT_BATCH_SIZE)) {
      const { error: noteErr } = await supabase
        .from("user_question_notes")
        .insert(batch);
      if (noteErr) throw noteErr;
      restoredNotes += batch.length;
    }

    return apiSuccess(
      {
        schema_version_detected: detectedVersion,
        backup_scope: V3_BACKUP_SCOPE,
        restored: {
          preferences: preferencesRestored,
          folders: restoredFolders,
          study_sets: restoredSets,
          shared_passages: restoredPassages,
          diagram_sets: restoredDiagrams,
          diagram_hotspots: restoredHotspots,
          questions: restoredQuestions,
          options: restoredOptions,
          accepted_answers: restoredAccepted,
          tags: restoredTags,
          content_media_relations: restoredMediaRelations,
          user_question_notes: restoredNotes,
        },
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
