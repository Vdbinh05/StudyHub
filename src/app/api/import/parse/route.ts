import crypto from "node:crypto";
import { z } from "zod";
import {
  compactPreviewForTransport,
  parseImportInput,
  type ExtendedImportPreviewResult,
} from "@/lib/import/index";
import { normalizeForComparison } from "@/lib/import/text-utils";
import { validateImportBatch } from "@/lib/import/validator";
import {
  ImportSecurityError,
  inspectRasterImageBytes,
  MAX_IMPORT_FILE_BYTES,
  MAX_RAW_TEXT_BYTES,
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
import { streamJsonResponse } from "@/lib/security/stream-response";
import {
  consumeTempUploadBytes,
  stageTempImportMedia,
} from "@/lib/supabase/temp-storage";
import type { ImportOptions } from "@/types/import";
import { fetchExistingQuestionFingerprints } from "../_existing-fingerprints";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PARSE_JSON_BYTES = MAX_RAW_TEXT_BYTES + 1024 * 1024; // 11 MB cap for JSON rawText + options
const STAGE_PREVIEW_MEDIA_THRESHOLD_BYTES = 1_500_000; // 1.5 MB inline base64 cap before staging to study-temp
const STREAM_JSON_THRESHOLD_BYTES = 2_000_000; // 2 MB outbound threshold -> chunked streaming
const SAFE_DATA_IMAGE_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

const AnswerRuleSchema = z.object({
  mode: z.enum([
    "auto",
    "asterisk_prefix",
    "inline_answer_key",
    "end_answer_key",
    "docx_bold",
    "docx_highlight",
    "docx_font_color",
    "docx_underline",
  ]),
  enabledSignals: z
    .array(
      z.enum([
        "asterisk_prefix",
        "inline_answer_key",
        "end_answer_key",
        "docx_bold",
        "docx_highlight",
        "docx_font_color",
        "docx_underline",
      ]),
    )
    .optional(),
  priorityOrder: z
    .array(
      z.enum([
        "asterisk_prefix",
        "inline_answer_key",
        "end_answer_key",
        "docx_bold",
        "docx_highlight",
        "docx_font_color",
        "docx_underline",
      ]),
    )
    .optional(),
  targetFontColors: z.array(z.string().max(16)).optional(),
  targetHighlightColors: z.array(z.string().max(32)).optional(),
});

const ColumnMappingSchema = z.object({
  prompt: z.string().nullable(),
  questionType: z.string().nullable().optional(),
  chapter: z.string().nullable().optional(),
  optionA: z.string().nullable().optional(),
  optionB: z.string().nullable().optional(),
  optionC: z.string().nullable().optional(),
  optionD: z.string().nullable().optional(),
  optionE: z.string().nullable().optional(),
  optionF: z.string().nullable().optional(),
  optionsColumn: z.string().nullable().optional(),
  correctAnswer: z.string().nullable(),
  backText: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
});

const ImportOptionsSchema = z
  .object({
    formatOverride: z
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
      .optional(),
    sheetName: z.string().max(120).optional(),
    hasHeaderRow: z.boolean().optional(),
    headerRowCount: z.union([z.literal(1), z.literal(2)]).optional(),
    answerRule: AnswerRuleSchema.optional(),
    columnMapping: ColumnMappingSchema.optional(),
    csvDelimiter: z.string().max(5).optional(),
    termDelimiter: z.string().max(16).optional(),
    cardDelimiter: z.string().max(16).optional(),
    pdfPageRange: z.string().max(100).optional(),
    pdfTwoColumn: z.boolean().optional(),
    preserveMediaPreviews: z.boolean().optional(),
    defaultQuestionType: z
      .enum([
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
      ])
      .optional(),
    defaultChapter: z.string().max(200).optional(),
    defaultTags: z.array(z.string().max(50)).max(20).optional(),
  })
  .optional();

const JsonParseBodySchema = z
  .object({
    rawText: z
      .string()
      .min(1, "Please provide text content to parse.")
      .max(MAX_RAW_TEXT_BYTES, "Pasted text exceeds the 10 MB maximum limit.")
      .optional(),
    storagePath: z.string().min(3).max(320).optional(),
    fileName: z.string().max(200).optional(),
    fileSizeBytes: z.number().int().min(0).max(MAX_IMPORT_FILE_BYTES).optional(),
    studySetId: z.string().uuid().optional(),
    options: ImportOptionsSchema,
  })
  .refine((v) => Boolean(v.rawText || v.storagePath), {
    message: "Please provide text content or a staged storagePath to parse.",
  });

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
  let tempCleanup: (() => Promise<void>) | null = null;
  try {
    const { supabase, user } = await requireAuth();

    const rateLimited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.IMPORT_PARSE,
      user.id,
    );
    if (rateLimited) return rateLimited;

    const contentType = request.headers.get("content-type") ?? "";
    let fileBytes: Uint8Array | undefined;
    let fileName: string | undefined;
    let rawText: string | undefined;
    let storagePath: string | undefined;
    let studySetId: string | undefined;
    let options: ImportOptions | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileField = formData.get("file");
      const rawTextField = formData.get("rawText");
      const studySetIdField = formData.get("studySetId");
      const optionsField = formData.get("options");

      if (typeof studySetIdField === "string" && studySetIdField.trim()) {
        studySetId = z.string().uuid().parse(studySetIdField.trim());
      }

      if (typeof optionsField === "string" && optionsField.trim()) {
        const parsedOpts: unknown = JSON.parse(optionsField);
        options = ImportOptionsSchema.parse(parsedOpts);
      }

      if (fileField instanceof File && fileField.size > 0) {
        if (fileField.size > MAX_IMPORT_FILE_BYTES) {
          return apiError(
            "PAYLOAD_TOO_LARGE",
            "Uploaded file exceeds the 15 MB maximum limit.",
            413,
          );
        }
        const arr = await fileField.arrayBuffer();
        fileBytes = new Uint8Array(arr);
        fileName = fileField.name;
      } else if (typeof rawTextField === "string" && rawTextField.trim().length > 0) {
        rawText = rawTextField;
        const nameField = formData.get("fileName");
        fileName = typeof nameField === "string" ? nameField : "pasted-input.txt";
      } else {
        return apiError(
          "BAD_REQUEST",
          "Upload a file or paste text content to parse.",
          400,
        );
      }
    } else {
      const rawBody = await parseJsonBody(request, MAX_PARSE_JSON_BYTES);
      const parsed = JsonParseBodySchema.parse(rawBody);
      rawText = parsed.rawText;
      storagePath = parsed.storagePath;
      fileName = parsed.fileName ?? "pasted-input.txt";
      studySetId = parsed.studySetId;
      options = parsed.options;
    }

    // Authorize study set access BEFORE downloading/parsing untrusted files
    if (studySetId) {
      await requireStudySetAccess(supabase, studySetId, user.id, "edit");
    }

    // Dual-mode Vercel Hobby direct-upload ingestion (> 3.5 MB files staged in `study-temp`)
    if (storagePath) {
      const consumed = await consumeTempUploadBytes(supabase, {
        userId: user.id,
        storagePath,
        expectedPurpose: "import",
        maxBytes: MAX_IMPORT_FILE_BYTES,
      });
      fileBytes = consumed.bytes;
      tempCleanup = consumed.cleanup;
    }

    const preview = await parseImportInput({
      fileBytes,
      fileName,
      rawText,
      options: {
        preserveMediaPreviews: true,
        ...options,
      },
    });

    // Paginated, prompt-prefiltered full-fingerprint duplicate check beyond 1,000 existing rows
    let finalPreview: ExtendedImportPreviewResult = preview;
    if (studySetId && preview.questions.length > 0) {
      const candidateNormalizedPrompts = new Set(
        preview.questions
          .map((q) => normalizeForComparison(q.prompt))
          .filter(Boolean),
      );
      const existing = await fetchExistingQuestionFingerprints(
        supabase,
        studySetId,
        candidateNormalizedPrompts,
      );
      if (existing.fingerprints.length > 0) {
        const globalOnlyIssues = preview.issues.filter(
          (i) => i.questionIndex === undefined,
        );
        const revalidated = validateImportBatch(preview.questions, {
          existingFingerprints: existing.fingerprints,
          globalIssues: globalOnlyIssues,
        });
        finalPreview = {
          ...preview,
          questions: revalidated.questions,
          issues: revalidated.issues,
          summary: revalidated.summary,
          detectedChapters: revalidated.detectedChapters,
        };
      }
    }

    // Stage extracted DOCX media to `study-temp/{userId}/import-media/{sha256}.{ext}`
    // when total preview media exceeds 1.5 MB so outbound preview JSON stays lean on Vercel Hobby.
    // Small previews (<= 1.5 MB) remain inline so existing tests & fast thumbnails stay untouched.
    const uniqueDataUrlByRId = new Map<string, string>();
    for (const q of finalPreview.questions) {
      for (const m of q.promptMedia ?? []) {
        if (m.dataUrl && !uniqueDataUrlByRId.has(m.rId)) {
          uniqueDataUrlByRId.set(m.rId, m.dataUrl);
        }
      }
      for (const o of q.options) {
        for (const m of o.media ?? []) {
          if (m.dataUrl && !uniqueDataUrlByRId.has(m.rId)) {
            uniqueDataUrlByRId.set(m.rId, m.dataUrl);
          }
        }
      }
    }

    let totalInlineMediaChars = 0;
    for (const url of uniqueDataUrlByRId.values()) {
      totalInlineMediaChars += url.length;
    }

    if (totalInlineMediaChars > STAGE_PREVIEW_MEDIA_THRESHOLD_BYTES) {
      const stagedPathByRId = new Map<string, string>();
      for (const [rId, dataUrl] of uniqueDataUrlByRId.entries()) {
        const decoded = decodeSafeRasterDataUrl(dataUrl);
        if (!decoded) continue;
        const sha256 = crypto.createHash("sha256").update(decoded.bytes).digest("hex");
        try {
          const { storagePath: stagedMediaPath } = await stageTempImportMedia(supabase, {
            userId: user.id,
            sha256,
            extension: decoded.ext,
            mimeType: decoded.mime,
            bytes: decoded.bytes,
          });
          stagedPathByRId.set(rId, stagedMediaPath);
        } catch {
          // Graceful fallback if study-temp bucket is unavailable in local dev
        }
      }

      if (stagedPathByRId.size > 0) {
        finalPreview = {
          ...finalPreview,
          questions: finalPreview.questions.map((q) => ({
            ...q,
            promptMedia: q.promptMedia?.map((m) => {
              const staged = stagedPathByRId.get(m.rId);
              if (!staged) return m;
              const { dataUrl: _removed, ...rest } = m;
              void _removed;
              return { ...rest, tempStoragePath: staged };
            }),
            options: q.options.map((o) => ({
              ...o,
              media: o.media?.map((m) => {
                const staged = stagedPathByRId.get(m.rId);
                if (!staged) return m;
                const { dataUrl: _removed, ...rest } = m;
                void _removed;
                return { ...rest, tempStoragePath: staged };
              }),
            })),
          })),
          extractedMedia: finalPreview.extractedMedia?.map((m) => {
            const staged = stagedPathByRId.get(m.rId);
            if (!staged) return m;
            const { dataUrl: _removed, ...rest } = m;
            void _removed;
            return { ...rest, tempStoragePath: staged };
          }),
        };
      }
    }

    // Strip unused rawSource, option formatting, and duplicated extractedMedia dataUrls
    const compacted = compactPreviewForTransport(finalPreview);
    const envelope = { data: compacted };
    const approxByteLength = Buffer.byteLength(JSON.stringify(envelope), "utf8");

    if (approxByteLength > STREAM_JSON_THRESHOLD_BYTES) {
      return streamJsonResponse(envelope, {
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    return apiSuccess(compacted);
  } catch (err) {
    if (err instanceof ImportSecurityError) {
      return apiError(err.code, err.message, err.statusCode);
    }
    return handleApiError(err);
  } finally {
    if (tempCleanup) {
      await tempCleanup();
    }
  }
}
