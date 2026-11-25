import crypto from "node:crypto";
import { z } from "zod";
import {
  chunkArray,
  mapWithConcurrency,
  normalizeForComparison,
  sanitizeFileName,
} from "@/lib/import/text-utils";
import {
  computeQuestionDuplicateFingerprint,
  validateParsedQuestion,
} from "@/lib/import/validator";
import {
  inspectRasterImageBytes,
  MAX_IMAGE_FILE_BYTES,
} from "@/lib/import/zip-guard";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  isSafeHttpOrStorageUrl,
  normalizeAnswerText,
  slugifyTag,
} from "@/lib/security/sanitize";
import {
  cleanupTempObjects,
  consumeTempUploadBytes,
  isOwnedTempStoragePath,
} from "@/lib/supabase/temp-storage";
import type { Database, Json } from "@/types/database";
import type { ParsedQuestion } from "@/types/import";
import { fetchExistingQuestionFingerprints } from "../_existing-fingerprints";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_COMMIT_JSON_BYTES = 12 * 1024 * 1024; // 12 MB cap per commit chunk (SEC-021)
const NEW_IMPORT_JOB_RATE_LIMIT = {
  id: "import_commit_new_job",
  limit: 20,
  windowMs: 5 * 60 * 1000,
} as const;
const IN_DELETE_CHUNK_SIZE = 120;
const SUB_BATCH_SIZE = 500;
const MEDIA_CONCURRENCY = 6;
const MEDIA_LOOKUP_CHUNK_SIZE = 120;

const CommitMediaAttachmentSchema = z.object({
  id: z.string().max(128).optional(),
  rId: z.string().max(128).optional(),
  fileName: z.string().max(240),
  mimeType: z.string().max(64).optional(),
  ext: z.string().max(16).optional(),
  byteLength: z.number().int().min(0).max(5 * 1024 * 1024).optional(),
  previewPath: z.string().max(2048).optional(),
  previewUrl: z.string().max(2048).optional(),
  dataUrl: z.string().max(7_000_000).optional(),
  tempStoragePath: z.string().max(320).optional(),
  anchorType: z.enum(["inline", "floating"]).default("inline"),
  ambiguous: z.boolean().optional(),
  alt: z.string().max(300).optional(),
});

const CommitOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(16),
  content: z.string().max(4000),
  isCorrect: z.boolean(),
  imageUrl: z.string().max(2048).nullable().optional(),
  media: z.array(CommitMediaAttachmentSchema).max(6).optional(),
  detectedBy: z
    .array(
      z.enum([
        "asterisk_prefix",
        "inline_answer_key",
        "end_answer_key",
        "docx_bold",
        "docx_highlight",
        "docx_font_color",
        "docx_underline",
        "column_mapping",
        "json_explicit",
        "manual",
        "none",
      ]),
    )
    .default(["manual"]),
});

const CommitAcceptedAnswerSchema = z.object({
  answerText: z.string().min(1).max(2000),
  matchMode: z
    .enum(["exact", "case_insensitive", "ignore_diacritics", "numeric"])
    .default("case_insensitive"),
});

const CommitQuestionSchema = z.object({
  tempId: z.string().optional(),
  index: z.number().int().min(0).default(0),
  chapter: z.string().max(200).nullable().optional(),
  questionType: z.enum([
    "single_choice",
    "multiple_choice",
    "true_false",
    "flashcard",
    "short_answer",
    "fill_in_blank",
    "numerical",
    "image_choice",
    "ordering",
    "matching",
    "image_hotspot",
    "reading_passage",
    "listening",
  ]),
  prompt: z.string().max(8000),
  promptImageUrl: z.string().max(2048).nullable().optional(),
  promptMedia: z.array(CommitMediaAttachmentSchema).max(10).optional(),
  backText: z.string().max(8000).nullable().optional(),
  backImageUrl: z.string().max(2048).nullable().optional(),
  explanation: z.string().max(8000).nullable().optional(),
  explanationMedia: z.array(CommitMediaAttachmentSchema).max(6).optional(),
  hint: z.string().max(2000).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  tags: z.array(z.string().max(60)).max(20).default([]),
  options: z.array(CommitOptionSchema).max(8).default([]),
  acceptedAnswers: z.array(CommitAcceptedAnswerSchema).max(20).optional(),
  detectedBy: z
    .array(
      z.enum([
        "asterisk_prefix",
        "inline_answer_key",
        "end_answer_key",
        "docx_bold",
        "docx_highlight",
        "docx_font_color",
        "docx_underline",
        "column_mapping",
        "json_explicit",
        "manual",
        "none",
      ]),
    )
    .default(["manual"]),
  excluded: z.boolean().optional(),
});

const ImportCommitBodySchema = z.object({
  studySetId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128),
  importJobId: z.string().uuid().optional(),
  isFirstChunk: z.boolean().default(true),
  isFinalChunk: z.boolean().default(true),
  tempMediaPathsToCleanup: z.array(z.string().max(320)).max(2000).optional(),
  sourceFormat: z
    .enum([
      "eduquiz_txt",
      "word_answer_key",
      "docx_ooxml",
      "docx_multimedia",
      "xlsx_wayground",
      "xlsx_generic",
      "quizlet_tsv",
      "csv",
      "json",
      "txt_generic",
      "pdf_text",
    ])
    .default("txt_generic"),
  fileName: z.string().max(240).default("import.txt"),
  fileSizeBytes: z.number().int().min(0).default(0),
  answerRule: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(["append", "replace"]).default("append"),
  duplicatePolicy: z.enum(["skip", "keep_both", "replace"]).default("skip"),
  skipInvalidRows: z.boolean().default(false),
  defaultChapter: z.string().max(200).optional(),
  defaultTags: z.array(z.string().max(60)).max(20).optional(),
  totalDetectedOverall: z.number().int().min(0).optional(),
  questions: z.array(CommitQuestionSchema).min(1).max(2500),
});

function buildSubBatchIdempotencyKey(baseKey: string, subBatchIndex: number): string {
  return subBatchIndex === 0 ? baseKey : `${baseKey}:sub-${subBatchIndex}`;
}

function extractStoredImportJobId(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const candidate = (meta as Record<string, unknown>).import_job_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function safeUrlOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // Never persist temporary unuploaded DOCX preview paths or raw data: URLs into DB columns
  if (trimmed.startsWith("/docx-media/") || trimmed.toLowerCase().startsWith("data:")) {
    return null;
  }
  return trimmed && isSafeHttpOrStorageUrl(trimmed) ? trimmed : null;
}

const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

interface UploadedImportMedia {
  mediaId: string | null;
  storagePath: string;
  proxyUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  alt?: string;
}

function decodeSafeRasterDataUrl(
  dataUrl: string,
): { bytes: Uint8Array; mime: string; ext: string } | null {
  const match = SAFE_DATA_IMAGE_RE.exec(dataUrl.trim());
  if (!match) return null;
  try {
    const buf = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const inspected = inspectRasterImageBytes(bytes);
    if (!inspected.valid || !inspected.mime || !inspected.ext) return null;
    return { bytes, mime: inspected.mime, ext: inspected.ext };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let supabaseRef: Awaited<ReturnType<typeof requireAuth>>["supabase"] | null = null;
  const tempMediaPathsToCleanup = new Set<string>();
  let shouldCleanupTempMedia = false;
  try {
    const { supabase, user } = await requireAuth();
    supabaseRef = supabase;

    // High chunk ceiling (120 chunks / 5m = up to 60,000 questions across a single job)
    // so multi-chunk 10k-20k imports never falsely trip 429 at chunk 21 (SH-025).
    const chunkRateLimited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.IMPORT_COMMIT,
      user.id,
    );
    if (chunkRateLimited) return chunkRateLimited;

    const rawBody = await parseJsonBody(request, MAX_COMMIT_JSON_BYTES);
    const body = ImportCommitBodySchema.parse(rawBody);

    const access = await requireStudySetAccess(
      supabase,
      body.studySetId,
      user.id,
      "edit",
    );
    const mediaOwnerId = access.studySet.owner_id || user.id;

    // Collect validated owned temp media paths from final chunk cleanup list (SEC-12)
    if (body.isFinalChunk && body.tempMediaPathsToCleanup?.length) {
      for (const p of body.tempMediaPathsToCleanup) {
        if (isOwnedTempStoragePath(p, user.id, "import-media")) {
          tempMediaPathsToCleanup.add(p.trim());
        }
      }
    }

    // Enforce stricter job-start rate limit on new imports, and verify active job ownership on continuation chunks
    if (body.isFirstChunk || !body.importJobId) {
      const newJobLimited = await enforceDistributedRateLimit(
        request,
        NEW_IMPORT_JOB_RATE_LIMIT,
        user.id,
      );
      if (newJobLimited) return newJobLimited;
    } else {
      const { data: activeJob, error: activeJobErr } = await supabase
        .from("import_jobs")
        .select("id, status")
        .eq("id", body.importJobId)
        .eq("user_id", user.id)
        .eq("study_set_id", body.studySetId)
        .maybeSingle();

      if (activeJobErr) throw activeJobErr;
      if (!activeJob || activeJob.status !== "importing") {
        return apiError(
          "BAD_REQUEST",
          "Invalid or inactive import job for continuation chunk.",
          400,
        );
      }
    }

    // 1. Server-side re-validation first (pure CPU) so sub-batch count is exact for DB-05 / FUNC-13
    const activeIncoming = body.questions.filter((q) => !q.excluded);
    const validatedList: ParsedQuestion[] = activeIncoming.map((q, idx) =>
      validateParsedQuestion(
        {
          tempId: q.tempId ?? crypto.randomUUID(),
          index: idx,
          chapter: q.chapter ?? body.defaultChapter ?? null,
          questionType: q.questionType,
          prompt: q.prompt.trim(),
          promptImageUrl: safeUrlOrNull(q.promptImageUrl),
          promptMedia: q.promptMedia?.map((m) => ({
            id: m.id ?? crypto.randomUUID(),
            rId: m.rId ?? "import",
            fileName: sanitizeFileName(m.fileName),
            mimeType: m.mimeType ?? "image/png",
            ext: m.ext ?? "png",
            byteLength: m.byteLength ?? 0,
            previewPath: m.previewPath ?? `/docx-media/${sanitizeFileName(m.fileName)}`,
            dataUrl: m.dataUrl,
            tempStoragePath: m.tempStoragePath,
            anchorType: m.anchorType,
            ambiguous: m.ambiguous,
            alt: m.alt,
          })),
          backText: q.backText?.trim() || null,
          backImageUrl: safeUrlOrNull(q.backImageUrl),
          explanation: q.explanation?.trim() || null,
          explanationMedia: q.explanationMedia?.map((m) => ({
            id: m.id ?? crypto.randomUUID(),
            rId: m.rId ?? "import",
            fileName: sanitizeFileName(m.fileName),
            mimeType: m.mimeType ?? "image/png",
            ext: m.ext ?? "png",
            byteLength: m.byteLength ?? 0,
            previewPath: m.previewPath ?? `/docx-media/${sanitizeFileName(m.fileName)}`,
            dataUrl: m.dataUrl,
            tempStoragePath: m.tempStoragePath,
            anchorType: m.anchorType,
            ambiguous: m.ambiguous,
            alt: m.alt,
          })),
          hint: q.hint?.trim() || null,
          difficulty: q.difficulty,
          tags: Array.from(
            new Set([
              ...(body.defaultTags ?? []),
              ...q.tags.map((t) => t.trim()).filter(Boolean),
            ]),
          ),
          options: q.options.map((o) => ({
            id: o.id ?? crypto.randomUUID(),
            label: o.label.trim().toUpperCase(),
            content: o.content.trim(),
            isCorrect: o.isCorrect,
            imageUrl: safeUrlOrNull(o.imageUrl),
            media: o.media?.map((m) => ({
              id: m.id ?? crypto.randomUUID(),
              rId: m.rId ?? "import",
              fileName: sanitizeFileName(m.fileName),
              mimeType: m.mimeType ?? "image/png",
              ext: m.ext ?? "png",
              byteLength: m.byteLength ?? 0,
              previewPath: m.previewPath ?? `/docx-media/${sanitizeFileName(m.fileName)}`,
              dataUrl: m.dataUrl,
              tempStoragePath: m.tempStoragePath,
              anchorType: m.anchorType,
              ambiguous: m.ambiguous,
              alt: m.alt,
            })),
            detectedBy: o.detectedBy,
          })),
          acceptedAnswers: q.acceptedAnswers,
          detectedBy: q.detectedBy,
          issues: [],
        },
        idx,
      ),
    );

    const invalidQuestions = validatedList.filter((q) =>
      q.issues.some((i) => i.severity === "error"),
    );

    if (invalidQuestions.length > 0 && !body.skipInvalidRows) {
      return apiError(
        "VALIDATION_ERROR",
        `${invalidQuestions.length} question(s) still have validation errors. Fix them inline or enable "Skip invalid rows".`,
        400,
        {
          invalidCount: invalidQuestions.length,
          sampleIssues: invalidQuestions.slice(0, 10).flatMap((q) => q.issues),
        },
      );
    }

    const validQuestions = validatedList.filter(
      (q) => !q.issues.some((i) => i.severity === "error"),
    );

    // 2. Indexed per-sub-batch idempotency check (DB-05 + FUNC-13)
    // Uses `source_metadata->>import_idempotency_key` matching Migration 0019's partial index,
    // scopes keys per <=500-row sub-batch so sub-batch 2+ is never dropped on retry,
    // and recovers stored `importJobId` on idempotentReplay so subsequent chunks finalize cleanly!
    const validSubBatches = chunkArray(validQuestions, SUB_BATCH_SIZE);
    const subBatchKeysToCheck =
      validSubBatches.length > 0
        ? validSubBatches.map((_, idx) =>
            buildSubBatchIdempotencyKey(body.idempotencyKey, idx),
          )
        : [body.idempotencyKey];

    const subBatchChecks = await Promise.all(
      subBatchKeysToCheck.map(async (subKey) => {
        const { data: rows } = await supabase
          .from("questions")
          .select("id, source_metadata")
          .eq("study_set_id", body.studySetId)
          .eq("source_metadata->>import_idempotency_key", subKey)
          .limit(1);
        const first = rows && rows.length > 0 ? rows[0] : null;
        return {
          subKey,
          exists: Boolean(first),
          importJobId: first ? extractStoredImportJobId(first.source_metadata) : null,
        };
      }),
    );

    const committedSubKeySet = new Set(
      subBatchChecks.filter((c) => c.exists).map((c) => c.subKey),
    );
    const recoveredImportJobId =
      subBatchChecks.find((c) => c.importJobId)?.importJobId ?? null;
    const allSubBatchesCommitted =
      subBatchChecks.length > 0 && subBatchChecks.every((c) => c.exists);

    if (allSubBatchesCommitted) {
      const resolvedImportJobId = body.importJobId ?? recoveredImportJobId ?? null;

      if (body.isFinalChunk && resolvedImportJobId) {
        await supabase
          .from("import_jobs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", resolvedImportJobId)
          .eq("user_id", user.id)
          .eq("study_set_id", body.studySetId)
          .eq("status", "importing");
      }

      const { count: totalSetQuestions } = await supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("study_set_id", body.studySetId);

      // Collect any chunk temp media paths for final cleanup
      if (body.isFinalChunk) {
        for (const q of body.questions) {
          for (const m of q.promptMedia ?? []) {
            if (m.tempStoragePath && isOwnedTempStoragePath(m.tempStoragePath, user.id, "import-media")) {
              tempMediaPathsToCleanup.add(m.tempStoragePath.trim());
            }
          }
          for (const m of q.explanationMedia ?? []) {
            if (m.tempStoragePath && isOwnedTempStoragePath(m.tempStoragePath, user.id, "import-media")) {
              tempMediaPathsToCleanup.add(m.tempStoragePath.trim());
            }
          }
          for (const o of q.options) {
            for (const m of o.media ?? []) {
              if (m.tempStoragePath && isOwnedTempStoragePath(m.tempStoragePath, user.id, "import-media")) {
                tempMediaPathsToCleanup.add(m.tempStoragePath.trim());
              }
            }
          }
        }
        shouldCleanupTempMedia = true;
      }

      return apiSuccess({
        importJobId: resolvedImportJobId,
        importedCount: 0,
        skippedCount: body.questions.length,
        replacedCount: 0,
        totalSetQuestions: totalSetQuestions ?? 0,
        idempotentReplay: true,
      });
    }

    const isPartialSubBatchRetry = committedSubKeySet.size > 0;

    // 3. Create or reuse import_jobs audit record
    let importJobId = body.importJobId ?? recoveredImportJobId ?? null;
    if (body.isFirstChunk && !importJobId) {
      const { data: jobRow, error: jobErr } = await supabase
        .from("import_jobs")
        .insert({
          user_id: user.id,
          study_set_id: body.studySetId,
          source_format: body.sourceFormat,
          file_name: sanitizeFileName(body.fileName),
          file_size_bytes: body.fileSizeBytes,
          status: "importing",
          total_detected: body.totalDetectedOverall ?? body.questions.length,
          valid_count: validQuestions.length,
          warning_count: validQuestions.filter((q) =>
            q.issues.some((i) => i.severity === "warning"),
          ).length,
          error_count: invalidQuestions.length,
          imported_count: 0,
          answer_rule: (body.answerRule ?? { mode: "auto" }) as Json,
          diagnostics: [] as Json,
        })
        .select("id")
        .single();

      if (jobErr) throw jobErr;
      importJobId = jobRow.id;
    }

    // 4. Handle mode === "replace" (on first chunk only, NEVER on partial sub-batch retry!)
    if (body.mode === "replace" && body.isFirstChunk && !isPartialSubBatchRetry) {
      const { error: delErr } = await supabase
        .from("questions")
        .delete()
        .eq("study_set_id", body.studySetId);
      if (delErr) throw delErr;
    }

    // Filter down to only uncommitted sub-batches while preserving each question's deterministic sub-batch key
    const uncommittedSubBatches: Array<{
      subKey: string;
      questions: ParsedQuestion[];
    }> = [];
    let skippedCount = body.questions.length - validQuestions.length;

    for (let sIdx = 0; sIdx < validSubBatches.length; sIdx += 1) {
      const subKey = buildSubBatchIdempotencyKey(body.idempotencyKey, sIdx);
      if (committedSubKeySet.has(subKey)) {
        skippedCount += validSubBatches[sIdx].length;
        continue;
      }
      uncommittedSubBatches.push({ subKey, questions: validSubBatches[sIdx] });
    }

    // 5. Handle duplicate policy ("skip" | "keep_both" | "replace") across uncommitted questions
    const remainingValidQuestions = uncommittedSubBatches.flatMap((b) => b.questions);
    let replacedCount = 0;

    if (body.duplicatePolicy !== "keep_both" && remainingValidQuestions.length > 0) {
      const candidateNormalizedPrompts = new Set(
        remainingValidQuestions
          .map((q) => normalizeForComparison(q.prompt))
          .filter(Boolean),
      );
      const { fingerprintToIds: existingMap } =
        await fetchExistingQuestionFingerprints(
          supabase,
          body.studySetId,
          candidateNormalizedPrompts,
        );

      if (body.duplicatePolicy === "skip") {
        const seenBatch = new Set<string>();
        for (const batch of uncommittedSubBatches) {
          const filtered: ParsedQuestion[] = [];
          for (const q of batch.questions) {
            const fp = computeQuestionDuplicateFingerprint({
              prompt: q.prompt,
              backText: q.backText,
              options: q.options,
              acceptedAnswers: q.acceptedAnswers,
            });
            if (fp && (existingMap.has(fp) || seenBatch.has(fp))) {
              skippedCount += 1;
              continue;
            }
            if (fp) seenBatch.add(fp);
            filtered.push(q);
          }
          batch.questions = filtered;
        }
      } else if (body.duplicatePolicy === "replace") {
        const idsToDelete: string[] = [];
        for (const q of remainingValidQuestions) {
          const fp = computeQuestionDuplicateFingerprint({
            prompt: q.prompt,
            backText: q.backText,
            options: q.options,
            acceptedAnswers: q.acceptedAnswers,
          });
          const matchedIds = fp ? existingMap.get(fp) : undefined;
          if (matchedIds && matchedIds.length > 0) {
            idsToDelete.push(...matchedIds);
            existingMap.delete(fp);
          }
        }
        if (idsToDelete.length > 0) {
          for (const delChunk of chunkArray(idsToDelete, IN_DELETE_CHUNK_SIZE)) {
            const { error: delDupErr } = await supabase
              .from("questions")
              .delete()
              .in("id", delChunk)
              .eq("study_set_id", body.studySetId);
            if (delDupErr) throw delDupErr;
          }
          replacedCount = idsToDelete.length;
        }
      }
    }

    const questionsToInsert = uncommittedSubBatches.flatMap((b) => b.questions);

    // 6, 7 & 7b. Run max-position lookup, batch tag upsert, and bounded-concurrent deduplicated
    // media staging/upload in parallel (PERF-05 + DB-10) so 133Q+ multimedia DOCX imports finish fast!
    type RawImportAttachment = NonNullable<ParsedQuestion["promptMedia"]>[number];

    const allTagNames = Array.from(
      new Set(questionsToInsert.flatMap((q) => q.tags).filter(Boolean)),
    );
    const tagSlugToId = new Map<string, string>();
    const uploadedByHash = new Map<string, UploadedImportMedia>();
    const sha256ByTempPath = new Map<string, string>();
    const sha256ByDataUrl = new Map<string, string>();

    const allAttachments: RawImportAttachment[] = [];
    for (const q of questionsToInsert) {
      for (const att of q.promptMedia ?? []) allAttachments.push(att);
      for (const att of q.explanationMedia ?? []) allAttachments.push(att);
      for (const opt of q.options) {
        for (const att of opt.media ?? []) allAttachments.push(att);
      }
    }

    const fetchMaxPosPromise = supabase
      .from("questions")
      .select("position")
      .eq("study_set_id", body.studySetId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const upsertTagsPromise = (async (): Promise<void> => {
      if (allTagNames.length === 0) return;
      const tagInserts = allTagNames.map((name) => ({
        owner_id: user.id,
        name,
        slug: slugifyTag(name),
      }));
      const uniqueTagRows = Array.from(
        new Map(tagInserts.map((t) => [t.slug, t])).values(),
      );
      const { data: upsertedTags, error: tagErr } = await supabase
        .from("tags")
        .upsert(uniqueTagRows, { onConflict: "owner_id,slug" })
        .select("id, slug");

      if (tagErr) throw tagErr;
      for (const row of upsertedTags ?? []) {
        tagSlugToId.set(row.slug, row.id);
      }
    })();

    const processUniqueMediaPromise = (async (): Promise<void> => {
      if (allAttachments.length === 0) return;

      interface DecodedUniqueMedia {
        sha256: string;
        bytes: Uint8Array;
        mime: string;
        ext: string;
        fileName: string;
        alt?: string;
        storagePath: string;
        proxyUrl: string;
      }

      const decodedBySha256 = new Map<string, DecodedUniqueMedia>();
      const uniqueTempEntries = new Map<string, { fileName: string; alt?: string }>();

      // Phase A: Decode inline base64 dataUrls synchronously & collect unique tempStoragePaths
      for (const att of allAttachments) {
        if (att.tempStoragePath) {
          const cleanPath = att.tempStoragePath.trim();
          if (cleanPath && !uniqueTempEntries.has(cleanPath)) {
            uniqueTempEntries.set(cleanPath, {
              fileName: sanitizeFileName(att.fileName),
              alt: att.alt,
            });
          }
          continue;
        }
        if (att.dataUrl) {
          if (sha256ByDataUrl.has(att.dataUrl)) continue;
          const decoded = decodeSafeRasterDataUrl(att.dataUrl);
          if (!decoded) continue;
          const sha256 = crypto.createHash("sha256").update(decoded.bytes).digest("hex");
          sha256ByDataUrl.set(att.dataUrl, sha256);
          if (!decodedBySha256.has(sha256)) {
            const storagePath = `${mediaOwnerId}/${body.studySetId}/import-${sha256.slice(0, 24)}.${decoded.ext}`;
            decodedBySha256.set(sha256, {
              sha256,
              bytes: decoded.bytes,
              mime: decoded.mime,
              ext: decoded.ext,
              fileName: sanitizeFileName(att.fileName),
              alt: att.alt,
              storagePath,
              proxyUrl: `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`,
            });
          }
        }
      }

      // Phase B: Download unique staged `study-temp` images concurrently (concurrency = 6)
      const tempList = Array.from(uniqueTempEntries.entries());
      if (tempList.length > 0) {
        await mapWithConcurrency(tempList, MEDIA_CONCURRENCY, async ([tempPath, meta]) => {
          try {
            const consumed = await consumeTempUploadBytes(supabase, {
              userId: user.id,
              storagePath: tempPath,
              expectedPurpose: "import-media",
              maxBytes: MAX_IMAGE_FILE_BYTES,
            });
            tempMediaPathsToCleanup.add(tempPath);
            const inspected = inspectRasterImageBytes(consumed.bytes);
            if (!inspected.valid || !inspected.mime || !inspected.ext) return;
            const sha256 = crypto.createHash("sha256").update(consumed.bytes).digest("hex");
            sha256ByTempPath.set(tempPath, sha256);
            if (!decodedBySha256.has(sha256)) {
              const storagePath = `${mediaOwnerId}/${body.studySetId}/import-${sha256.slice(0, 24)}.${inspected.ext}`;
              decodedBySha256.set(sha256, {
                sha256,
                bytes: consumed.bytes,
                mime: inspected.mime,
                ext: inspected.ext,
                fileName: meta.fileName,
                alt: meta.alt,
                storagePath,
                proxyUrl: `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`,
              });
            }
          } catch {
            // Skip unreadable temp media cleanly
          }
        });
      }

      const uniqueItems = Array.from(decodedBySha256.values());
      if (uniqueItems.length === 0) return;

      // Phase C: Single batched `media_assets` lookup across all unique content-addressed storage paths
      const existingAssetsByPath = new Map<string, { id: string; isOrphaned: boolean }>();
      try {
        const pathChunks = chunkArray(
          uniqueItems.map((u) => u.storagePath),
          MEDIA_LOOKUP_CHUNK_SIZE,
        );
        const lookupResults = await mapWithConcurrency(
          pathChunks,
          MEDIA_CONCURRENCY,
          async (paths) => {
            const { data } = await supabase
              .from("media_assets")
              .select("id, storage_path, is_orphaned")
              .eq("owner_id", user.id)
              .in("storage_path", paths);
            return data ?? [];
          },
        );
        for (const rows of lookupResults) {
          for (const row of rows) {
            existingAssetsByPath.set(row.storage_path, {
              id: row.id,
              isOrphaned: Boolean(row.is_orphaned),
            });
          }
        }
      } catch {
        // Best-effort registry lookup (graceful if media_assets is unavailable)
      }

      // Phase D: Bounded-concurrent Storage uploads (concurrency = 6) for unique media not yet active
      const uploadedItems: DecodedUniqueMedia[] = [];
      await mapWithConcurrency(uniqueItems, MEDIA_CONCURRENCY, async (item) => {
        const existing = existingAssetsByPath.get(item.storagePath);
        if (existing && !existing.isOrphaned) {
          uploadedItems.push(item);
          return;
        }
        const { error: uploadErr } = await supabase.storage
          .from("study-media")
          .upload(item.storagePath, item.bytes, {
            contentType: item.mime,
            upsert: true,
          });
        if (!uploadErr) {
          uploadedItems.push(item);
        }
      });

      // Phase E: Single batched `media_assets` insert for newly uploaded unique assets
      const newlyUploadedForRegistry = uploadedItems.filter(
        (item) => !existingAssetsByPath.has(item.storagePath),
      );
      if (newlyUploadedForRegistry.length > 0) {
        try {
          const assetInsertRows: Database["public"]["Tables"]["media_assets"]["Insert"][] =
            newlyUploadedForRegistry.map((item) => ({
              owner_id: user.id,
              study_set_id: body.studySetId,
              kind: "image",
              storage_bucket: "study-media",
              storage_path: item.storagePath,
              mime_type: item.mime,
              file_name: item.fileName,
              size_bytes: item.bytes.byteLength,
              sha256_hash: item.sha256,
              alt_text: item.alt ?? null,
              is_orphaned: false,
            }));

          const insertChunks = chunkArray(assetInsertRows, MEDIA_LOOKUP_CHUNK_SIZE);
          const insertedResults = await mapWithConcurrency(
            insertChunks,
            MEDIA_CONCURRENCY,
            async (rowsChunk) => {
              const { data, error } = await supabase
                .from("media_assets")
                .insert(rowsChunk)
                .select("id, storage_path");
              if (error) {
                // Concurrent race fallback: re-select already inserted rows
                const { data: fallbackRows } = await supabase
                  .from("media_assets")
                  .select("id, storage_path")
                  .eq("owner_id", user.id)
                  .in(
                    "storage_path",
                    rowsChunk.map((r) => r.storage_path),
                  );
                return fallbackRows ?? [];
              }
              return data ?? [];
            },
          );
          for (const rows of insertedResults) {
            for (const row of rows) {
              existingAssetsByPath.set(row.storage_path, {
                id: row.id,
                isOrphaned: false,
              });
            }
          }
        } catch {
          // Graceful fallback if media_assets write fails
        }
      }

      for (const item of uploadedItems) {
        const assetEntry = existingAssetsByPath.get(item.storagePath);
        uploadedByHash.set(item.sha256, {
          mediaId: assetEntry?.id ?? null,
          storagePath: item.storagePath,
          proxyUrl: item.proxyUrl,
          fileName: item.fileName,
          mimeType: item.mime,
          sizeBytes: item.bytes.byteLength,
          sha256: item.sha256,
          alt: item.alt,
        });
      }
    })();

    const [{ data: maxPosRow }] = await Promise.all([
      fetchMaxPosPromise,
      upsertTagsPromise,
      processUniqueMediaPromise,
    ]);

    let nextPosition = maxPosRow ? maxPosRow.position + 1 : 0;

    const resolveUploadedAttachment = (
      att: RawImportAttachment,
    ): UploadedImportMedia | null => {
      const sha256 = att.tempStoragePath
        ? sha256ByTempPath.get(att.tempStoragePath.trim())
        : att.dataUrl
          ? sha256ByDataUrl.get(att.dataUrl)
          : undefined;
      if (!sha256) return null;
      const uploaded = uploadedByHash.get(sha256);
      if (!uploaded) return null;
      return { ...uploaded, alt: att.alt ?? uploaded.alt };
    };

    // 8. Sub-batch <=500-row inserts into questions, followed by CONCURRENT child table inserts (PERF-05)
    let importedCount = 0;

    for (const { subKey, questions: qChunk } of uncommittedSubBatches) {
      if (qChunk.length === 0) continue;

      const questionRows: Database["public"]["Tables"]["questions"]["Insert"][] = [];
      const optionRows: Database["public"]["Tables"]["question_options"]["Insert"][] = [];
      const acceptedRows: Database["public"]["Tables"]["question_accepted_answers"]["Insert"][] = [];
      const questionTagRows: Database["public"]["Tables"]["question_tags"]["Insert"][] = [];
      const mediaRelationRows: Database["public"]["Tables"]["content_media_relations"]["Insert"][] = [];

      for (const q of qChunk) {
        const questionId = crypto.randomUUID();
        const uploadedPromptMedia: UploadedImportMedia[] = [];
        for (const att of q.promptMedia ?? []) {
          const uploaded = resolveUploadedAttachment(att);
          if (uploaded) uploadedPromptMedia.push(uploaded);
        }

        const resolvedPromptImageUrl =
          q.promptImageUrl ?? uploadedPromptMedia[0]?.proxyUrl ?? null;

        uploadedPromptMedia.forEach((m, sortOrder) => {
          if (m.mediaId) {
            mediaRelationRows.push({
              media_id: m.mediaId,
              entity_type: "question",
              entity_id: questionId,
              role: "prompt",
              sort_order: sortOrder,
              alt_text: m.alt ?? null,
            });
          }
        });

        const uploadedExplanationMedia: UploadedImportMedia[] = [];
        for (const att of q.explanationMedia ?? []) {
          const uploaded = resolveUploadedAttachment(att);
          if (uploaded) uploadedExplanationMedia.push(uploaded);
        }
        uploadedExplanationMedia.forEach((m, sortOrder) => {
          if (m.mediaId) {
            mediaRelationRows.push({
              media_id: m.mediaId,
              entity_type: "question",
              entity_id: questionId,
              role: "explanation",
              sort_order: sortOrder,
              alt_text: m.alt ?? null,
            });
          }
        });

        questionRows.push({
          id: questionId,
          study_set_id: body.studySetId,
          question_type: q.questionType,
          position: nextPosition,
          chapter: q.chapter ?? null,
          prompt: q.prompt,
          prompt_image_url: resolvedPromptImageUrl,
          back_text: q.backText ?? null,
          back_image_url: q.backImageUrl ?? null,
          explanation: q.explanation ?? null,
          hint: q.hint ?? null,
          difficulty: q.difficulty,
          source_metadata: {
            import_job_id: importJobId,
            import_idempotency_key: subKey,
            source_format: body.sourceFormat,
            detected_by: q.detectedBy,
            ...(uploadedPromptMedia.length > 0
              ? {
                  uploaded_prompt_media_urls: uploadedPromptMedia.map((m) => m.proxyUrl),
                }
              : {}),
          } as Json,
        });
        nextPosition += 1;

        for (let optIdx = 0; optIdx < q.options.length; optIdx += 1) {
          const opt = q.options[optIdx];
          const optionId = crypto.randomUUID();
          const uploadedOptMedia: UploadedImportMedia[] = [];
          for (const att of opt.media ?? []) {
            const uploaded = resolveUploadedAttachment(att);
            if (uploaded) uploadedOptMedia.push(uploaded);
          }

          uploadedOptMedia.forEach((m, sortOrder) => {
            if (m.mediaId) {
              mediaRelationRows.push({
                media_id: m.mediaId,
                entity_type: "question_option",
                entity_id: optionId,
                role: "option",
                sort_order: sortOrder,
                alt_text: m.alt ?? null,
              });
            }
          });

          optionRows.push({
            id: optionId,
            question_id: questionId,
            study_set_id: body.studySetId,
            position: optIdx,
            label: opt.label,
            content: opt.content,
            image_url: opt.imageUrl ?? uploadedOptMedia[0]?.proxyUrl ?? null,
            media_id: uploadedOptMedia[0]?.mediaId ?? null,
            image_alt: uploadedOptMedia[0]?.alt ?? null,
            is_correct: opt.isCorrect,
          });
        }

        const acceptedSource =
          q.acceptedAnswers && q.acceptedAnswers.length > 0
            ? q.acceptedAnswers
            : q.questionType === "flashcard" && q.backText
              ? [{ answerText: q.backText, matchMode: "case_insensitive" as const }]
              : [];

        for (const ans of acceptedSource) {
          acceptedRows.push({
            id: crypto.randomUUID(),
            question_id: questionId,
            study_set_id: body.studySetId,
            answer_text: ans.answerText,
            normalized_answer: normalizeAnswerText(ans.answerText, ans.matchMode),
            match_mode: ans.matchMode,
          });
        }

        const seenTagIds = new Set<string>();
        for (const tagName of q.tags) {
          const tagId = tagSlugToId.get(slugifyTag(tagName));
          if (tagId && !seenTagIds.has(tagId)) {
            seenTagIds.add(tagId);
            questionTagRows.push({
              question_id: questionId,
              tag_id: tagId,
              study_set_id: body.studySetId,
            });
          }
        }
      }

      const { error: qErr } = await supabase
        .from("questions")
        .insert(questionRows);
      if (qErr) throw qErr;

      // Insert independent child tables concurrently via Promise.all after questions succeed
      await Promise.all([
        (async () => {
          for (const optChunk of chunkArray(optionRows, 1000)) {
            const { error: optErr } = await supabase
              .from("question_options")
              .insert(optChunk);
            if (optErr) throw optErr;
          }
        })(),
        (async () => {
          for (const accChunk of chunkArray(acceptedRows, 1000)) {
            const { error: accErr } = await supabase
              .from("question_accepted_answers")
              .insert(accChunk);
            if (accErr) throw accErr;
          }
        })(),
        (async () => {
          for (const qtChunk of chunkArray(questionTagRows, 1000)) {
            const { error: qtErr } = await supabase
              .from("question_tags")
              .insert(qtChunk);
            if (qtErr) throw qtErr;
          }
        })(),
        (async () => {
          if (mediaRelationRows.length === 0) return;
          try {
            for (const mrChunk of chunkArray(mediaRelationRows, 500)) {
              await supabase.from("content_media_relations").upsert(mrChunk, {
                onConflict: "media_id,entity_type,entity_id,role",
              });
            }
          } catch {
            // Graceful fallback if content_media_relations is unavailable
          }
        })(),
      ]);

      importedCount += questionRows.length;
    }

    // 9. Update import_jobs progress (study_sets.question_count is maintained automatically by DB trigger)
    const { count: totalSetQuestions } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("study_set_id", body.studySetId);

    if (importJobId) {
      const { data: currentJob } = await supabase
        .from("import_jobs")
        .select("imported_count")
        .eq("id", importJobId)
        .eq("user_id", user.id)
        .eq("study_set_id", body.studySetId)
        .maybeSingle();

      const nextImportedTotal = (currentJob?.imported_count ?? 0) + importedCount;

      await supabase
        .from("import_jobs")
        .update({
          imported_count: nextImportedTotal,
          status: body.isFinalChunk ? "completed" : "importing",
          completed_at: body.isFinalChunk ? new Date().toISOString() : null,
        })
        .eq("id", importJobId)
        .eq("user_id", user.id)
        .eq("study_set_id", body.studySetId);
    }

    // SEC-12: Only delete shared staged `tempStoragePath` objects when the FINAL chunk succeeds!
    shouldCleanupTempMedia = body.isFinalChunk;

    return apiSuccess({
      importJobId,
      importedCount,
      skippedCount,
      replacedCount,
      totalSetQuestions: totalSetQuestions ?? 0,
      idempotentReplay: false,
    });
  } catch (err) {
    return handleApiError(err);
  } finally {
    if (supabaseRef && shouldCleanupTempMedia && tempMediaPathsToCleanup.size > 0) {
      await cleanupTempObjects(supabaseRef, Array.from(tempMediaPathsToCleanup));
    }
  }
}
