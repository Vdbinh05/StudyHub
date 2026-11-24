import crypto from "node:crypto";
import { z } from "zod";
import {
  chunkArray,
  computeQuestionDuplicateFingerprint,
  normalizeForComparison,
  sanitizeFileName,
  validateParsedQuestion,
} from "@/lib/import";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiError,
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  isSafeHttpOrStorageUrl,
  normalizeAnswerText,
  slugifyTag,
} from "@/lib/security/sanitize";
import type { Database, Json } from "@/types/database";
import type { ParsedQuestion } from "@/types/import";
import { fetchExistingQuestionFingerprints } from "../_existing-fingerprints";

const MAX_COMMIT_JSON_BYTES = 12 * 1024 * 1024; // 12 MB cap per commit chunk (SEC-021)
const NEW_IMPORT_JOB_RATE_LIMIT = {
  id: "import_commit_new_job",
  limit: 20,
  windowMs: 5 * 60 * 1000,
} as const;
const IN_DELETE_CHUNK_SIZE = 120;

const CommitOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1).max(16),
  content: z.string().max(4000),
  isCorrect: z.boolean(),
  imageUrl: z.string().max(2048).nullable().optional(),
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
  ]),
  prompt: z.string().max(8000),
  promptImageUrl: z.string().max(2048).nullable().optional(),
  backText: z.string().max(8000).nullable().optional(),
  backImageUrl: z.string().max(2048).nullable().optional(),
  explanation: z.string().max(8000).nullable().optional(),
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
  sourceFormat: z
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

function safeUrlOrNull(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // Never persist temporary unuploaded DOCX preview paths as broken 404 image links
  if (trimmed.startsWith("/docx-media/")) return null;
  return trimmed && isSafeHttpOrStorageUrl(trimmed) ? trimmed : null;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuth();

    // High chunk ceiling (120 chunks / 5m = up to 60,000 questions across a single job)
    // so multi-chunk 10k-20k imports never falsely trip 429 at chunk 21 (SH-025).
    const chunkRateLimited = enforceRateLimit(
      request,
      RATE_LIMITS.IMPORT_COMMIT,
      user.id,
    );
    if (chunkRateLimited) return chunkRateLimited;

    const rawBody = await parseJsonBody(request, MAX_COMMIT_JSON_BYTES);
    const body = ImportCommitBodySchema.parse(rawBody);

    await requireStudySetAccess(supabase, body.studySetId, user.id, "edit");

    // Enforce stricter job-start rate limit on new imports, and verify active job ownership on continuation chunks
    if (body.isFirstChunk || !body.importJobId) {
      const newJobLimited = enforceRateLimit(
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

    // 1. Idempotency check: if this chunk's idempotencyKey already committed rows, replay cleanly!
    const { data: existingIdemRows } = await supabase
      .from("questions")
      .select("id")
      .eq("study_set_id", body.studySetId)
      .contains("source_metadata", { import_idempotency_key: body.idempotencyKey })
      .limit(1);

    if (existingIdemRows && existingIdemRows.length > 0) {
      const { count: totalSetQuestions } = await supabase
        .from("questions")
        .select("id", { count: "exact", head: true })
        .eq("study_set_id", body.studySetId);

      return apiSuccess({
        importJobId: body.importJobId ?? null,
        importedCount: 0,
        skippedCount: body.questions.length,
        replacedCount: 0,
        totalSetQuestions: totalSetQuestions ?? 0,
        idempotentReplay: true,
      });
    }

    // 2. Server-side re-validation (Commit Integrity Rule: never insert broken rows)
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
          backText: q.backText?.trim() || null,
          backImageUrl: safeUrlOrNull(q.backImageUrl),
          explanation: q.explanation?.trim() || null,
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

    // 3. Create or fetch import_jobs audit record
    let importJobId = body.importJobId ?? null;
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

    // 4. Handle mode === "replace" (on first chunk only)
    if (body.mode === "replace" && body.isFirstChunk) {
      const { error: delErr } = await supabase
        .from("questions")
        .delete()
        .eq("study_set_id", body.studySetId);
      if (delErr) throw delErr;
    }

    // 5. Handle duplicate policy ("skip" | "keep_both" | "replace") using paginated,
    // chunked full-fingerprint matching (prompt + sorted options + correct answers) (SH-005 & SH-017)
    let questionsToInsert = validQuestions;
    let skippedCount = body.questions.length - validQuestions.length;
    let replacedCount = 0;

    if (body.duplicatePolicy !== "keep_both" && validQuestions.length > 0) {
      const candidateNormalizedPrompts = new Set(
        validQuestions
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
        const filtered: ParsedQuestion[] = [];
        for (const q of validQuestions) {
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
        questionsToInsert = filtered;
      } else if (body.duplicatePolicy === "replace") {
        const idsToDelete: string[] = [];
        for (const q of validQuestions) {
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

    // 6. Determine starting position for appended rows
    const { data: maxPosRow } = await supabase
      .from("questions")
      .select("position")
      .eq("study_set_id", body.studySetId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextPosition = maxPosRow ? maxPosRow.position + 1 : 0;

    // 7. Upsert unique tags for owner in batch
    const allTagNames = Array.from(
      new Set(questionsToInsert.flatMap((q) => q.tags).filter(Boolean)),
    );
    const tagSlugToId = new Map<string, string>();

    if (allTagNames.length > 0) {
      const tagInserts = allTagNames.map((name) => ({
        owner_id: user.id,
        name,
        slug: slugifyTag(name),
      }));

      // Deduplicate by slug
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
    }

    // 8. Chunked 500-row batch inserts into questions, question_options, question_accepted_answers, question_tags
    let importedCount = 0;

    for (const qChunk of chunkArray(questionsToInsert, 500)) {
      const questionRows: Database["public"]["Tables"]["questions"]["Insert"][] = [];
      const optionRows: Database["public"]["Tables"]["question_options"]["Insert"][] = [];
      const acceptedRows: Database["public"]["Tables"]["question_accepted_answers"]["Insert"][] = [];
      const questionTagRows: Database["public"]["Tables"]["question_tags"]["Insert"][] = [];

      for (const q of qChunk) {
        const questionId = crypto.randomUUID();
        questionRows.push({
          id: questionId,
          study_set_id: body.studySetId,
          question_type: q.questionType,
          position: nextPosition,
          chapter: q.chapter ?? null,
          prompt: q.prompt,
          prompt_image_url: q.promptImageUrl ?? null,
          back_text: q.backText ?? null,
          back_image_url: q.backImageUrl ?? null,
          explanation: q.explanation ?? null,
          hint: q.hint ?? null,
          difficulty: q.difficulty,
          source_metadata: {
            import_job_id: importJobId,
            import_idempotency_key: body.idempotencyKey,
            source_format: body.sourceFormat,
            detected_by: q.detectedBy,
          } as Json,
        });
        nextPosition += 1;

        q.options.forEach((opt, optIdx) => {
          optionRows.push({
            id: crypto.randomUUID(),
            question_id: questionId,
            study_set_id: body.studySetId,
            position: optIdx,
            label: opt.label,
            content: opt.content,
            image_url: opt.imageUrl ?? null,
            is_correct: opt.isCorrect,
          });
        });

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

      if (optionRows.length > 0) {
        for (const optChunk of chunkArray(optionRows, 1000)) {
          const { error: optErr } = await supabase
            .from("question_options")
            .insert(optChunk);
          if (optErr) throw optErr;
        }
      }

      if (acceptedRows.length > 0) {
        for (const accChunk of chunkArray(acceptedRows, 1000)) {
          const { error: accErr } = await supabase
            .from("question_accepted_answers")
            .insert(accChunk);
          if (accErr) throw accErr;
        }
      }

      if (questionTagRows.length > 0) {
        for (const qtChunk of chunkArray(questionTagRows, 1000)) {
          const { error: qtErr } = await supabase
            .from("question_tags")
            .insert(qtChunk);
          if (qtErr) throw qtErr;
        }
      }

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
  }
}
