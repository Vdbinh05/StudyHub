import { z } from "zod";
import {
  ImportSecurityError,
  MAX_IMPORT_FILE_BYTES,
  parseImportInput,
} from "@/lib/import";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiError, apiSuccess, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import type { ImportOptions } from "@/types/import";

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
        "xlsx_wayground",
        "xlsx_generic",
        "quizlet_tsv",
        "csv",
        "json",
        "txt_generic",
      ])
      .optional(),
    sheetName: z.string().max(120).optional(),
    hasHeaderRow: z.boolean().optional(),
    answerRule: AnswerRuleSchema.optional(),
    columnMapping: ColumnMappingSchema.optional(),
    csvDelimiter: z.string().max(5).optional(),
    termDelimiter: z.string().max(16).optional(),
    cardDelimiter: z.string().max(16).optional(),
    defaultQuestionType: z
      .enum([
        "single_choice",
        "multiple_choice",
        "true_false",
        "flashcard",
        "short_answer",
      ])
      .optional(),
    defaultChapter: z.string().max(200).optional(),
    defaultTags: z.array(z.string().max(50)).max(20).optional(),
  })
  .optional();

const JsonParseBodySchema = z.object({
  rawText: z.string().min(1, "Please provide text content to parse."),
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
      const rawBody: unknown = await request.json();
      const parsed = JsonParseBodySchema.parse(rawBody);
      rawText = parsed.rawText;
      fileName = parsed.fileName ?? "pasted-input.txt";
      studySetId = parsed.studySetId;
      options = parsed.options;
    }

    // Optional duplicate check against existing questions in the target study set
    let existingPrompts: string[] = [];
    if (studySetId) {
      await requireStudySetAccess(supabase, studySetId, user.id, "edit");
      const { data: existingRows } = await supabase
        .from("questions")
        .select("prompt")
        .eq("study_set_id", studySetId)
        .limit(10_000);
      if (existingRows) {
        existingPrompts = existingRows.map((r) => r.prompt);
      }
    }

    const preview = await parseImportInput({
      fileBytes,
      fileName,
      rawText,
      options,
      existingPrompts,
    });

    return apiSuccess(preview);
  } catch (err) {
    if (err instanceof ImportSecurityError) {
      return apiError(err.code, err.message, err.statusCode);
    }
    return handleApiError(err);
  }
}
