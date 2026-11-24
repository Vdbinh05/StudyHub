import { z } from "zod";
import {
  compactPreviewForTransport,
  ImportSecurityError,
  MAX_IMPORT_FILE_BYTES,
  MAX_RAW_TEXT_BYTES,
  normalizeForComparison,
  parseImportInput,
  validateImportBatch,
} from "@/lib/import";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import type { ImportOptions } from "@/types/import";
import { fetchExistingQuestionFingerprints } from "../_existing-fingerprints";

const MAX_PARSE_JSON_BYTES = MAX_RAW_TEXT_BYTES + 1024 * 1024; // 11 MB cap for JSON rawText + options

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

const JsonParseBodySchema = z.object({
  rawText: z
    .string()
    .min(1, "Please provide text content to parse.")
    .max(MAX_RAW_TEXT_BYTES, "Pasted text exceeds the 10 MB maximum limit."),
  fileName: z.string().max(200).optional(),
  studySetId: z.string().uuid().optional(),
  options: ImportOptionsSchema,
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuth();

    const rateLimited = enforceRateLimit(
      request,
      RATE_LIMITS.IMPORT_PARSE,
      user.id,
    );
    if (rateLimited) return rateLimited;

    const contentType = request.headers.get("content-type") ?? "";
    let fileBytes: Uint8Array | undefined;
    let fileName: string | undefined;
    let rawText: string | undefined;
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
      fileName = parsed.fileName ?? "pasted-input.txt";
      studySetId = parsed.studySetId;
      options = parsed.options;
    }

    // Authorize study set access BEFORE parsing untrusted files
    if (studySetId) {
      await requireStudySetAccess(supabase, studySetId, user.id, "edit");
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
    let finalPreview = preview;
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

    // Strip unused rawSource & option formatting bloat (~38% payload reduction on DOCX)
    return apiSuccess(compactPreviewForTransport(finalPreview));
  } catch (err) {
    if (err instanceof ImportSecurityError) {
      return apiError(err.code, err.message, err.statusCode);
    }
    return handleApiError(err);
  }
}
