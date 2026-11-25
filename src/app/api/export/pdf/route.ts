import { z } from "zod";
import {
  exportStudySetToPdf,
  formatStructuredExamResponseForPdf,
  type PdfEmbeddedImage,
  type PdfExportOption,
  type PdfExportQuestion,
} from "@/lib/export/pdf-exporter";
import {
  chunkArray,
  mapWithConcurrency,
  sanitizeFileName,
} from "@/lib/import/text-utils";
import { inspectRasterImageBytes } from "@/lib/import/zip-guard";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiError, handleApiError, parseJsonBody } from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { streamBinaryResponse } from "@/lib/security/stream-response";
import { stripPreSubmitQuestions } from "@/lib/supabase/exam-engine";
import { rpcGetExamAttemptDetail } from "@/lib/supabase/rpc";
import type { QuestionType } from "@/types/domain";
import type {
  QuestionTypePayload,
  RichTextDoc,
  StructuredAnswerResponse,
} from "@/types/v3";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PDF_REQUEST_BYTES = 256 * 1024;
const PAGE_SIZE = 1000;
const IN_QUERY_CHUNK_SIZE = 120;
const MAX_TOTAL_EMBED_IMAGE_BYTES = 14 * 1024 * 1024;
const PDF_CONCURRENCY_LIMIT = 6;

const ExportPdfBodySchema = z
  .object({
    studySetId: z.string().uuid().optional(),
    attemptId: z.string().uuid().optional(),
    questionIds: z.array(z.string().uuid()).max(2000).optional(),
    chapter: z.string().max(200).optional(),
    mode: z
      .enum([
        "question_paper",
        "paper_and_key",
        "paper_with_explanations",
        "incorrect_review",
        "flashcard_sheets",
      ])
      .default("paper_and_key"),
    locale: z.enum(["vi", "en"]).default("vi"),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    title: z.string().max(200).optional(),
    subject: z.string().max(120).optional(),
    examCode: z.string().max(40).optional(),
    includeStudentInfo: z.boolean().default(true),
    headerText: z.string().max(160).optional(),
    footerText: z.string().max(160).optional(),
    shuffleQuestions: z.boolean().default(false),
    shuffleOptions: z.boolean().default(false),
    shuffleSeed: z.string().max(64).optional(),
    fontSize: z.number().min(9).max(14).default(10.5),
    grayscale: z.boolean().default(true),
    includeAudioTranscript: z.boolean().default(false),
    includeImages: z.boolean().default(true),
  })
  .refine((v) => Boolean(v.studySetId || v.attemptId), {
    message: "Either studySetId or attemptId is required.",
  });

function extractSafeStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/uploads/signed-url")) {
    try {
      const parsed = new URL(trimmed, "http://localhost");
      const storagePath = parsed.searchParams.get("path");
      if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) {
        return null;
      }
      return storagePath;
    } catch {
      return null;
    }
  }
  return null;
}

function buildPdfContentDisposition(utf8FileName: string): string {
  const asciiBase = utf8FileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  const asciiFallback = asciiBase.endsWith(".pdf")
    ? asciiBase
    : `${asciiBase || "studyhub-export"}.pdf`;
  const encodedUtf8 = encodeURIComponent(utf8FileName).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAuth();

    const rateLimited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.EXPORT,
      user.id,
    );
    if (rateLimited) return rateLimited;

    const rawBody = await parseJsonBody(request, MAX_PDF_REQUEST_BYTES);
    const body = ExportPdfBodySchema.parse(rawBody);

    let embeddedImageBytesTotal = 0;
    const imageCache = new Map<string, PdfEmbeddedImage | null>();

    /**
     * Bound-parallelized Storage image loader (`concurrency = 6`, DB-10) with
     * deterministic document-order byte budget enforcement and explicit WebP/GIF
     * caption markers so legacy images never silently disappear (FUNC-21).
     */
    const preloadStorageImages = async (
      urls: readonly (string | null | undefined)[],
    ): Promise<void> => {
      if (!body.includeImages || urls.length === 0) return;

      const uniquePaths: string[] = [];
      const seenPaths = new Set<string>();
      for (const url of urls) {
        const storagePath = extractSafeStoragePath(url);
        if (!storagePath || imageCache.has(storagePath) || seenPaths.has(storagePath)) {
          continue;
        }
        seenPaths.add(storagePath);
        uniquePaths.push(storagePath);
      }

      if (uniquePaths.length === 0) return;

      const downloaded = await mapWithConcurrency(
        uniquePaths,
        PDF_CONCURRENCY_LIMIT,
        async (
          storagePath,
        ): Promise<{ storagePath: string; entry: PdfEmbeddedImage | null }> => {
          try {
            const { data: blob, error } = await supabase.storage
              .from("study-media")
              .download(storagePath);
            if (error || !blob) {
              return { storagePath, entry: null };
            }
            const ab = await blob.arrayBuffer();
            const bytes = new Uint8Array(ab);
            const check = inspectRasterImageBytes(bytes);
            if (!check.valid) {
              return { storagePath, entry: null };
            }
            if (check.mime === "image/webp" || check.mime === "image/gif") {
              return {
                storagePath,
                entry: {
                  bytes: new Uint8Array(0),
                  mimeType: check.mime,
                  unsupportedFormatNote: true,
                },
              };
            }
            if (check.mime === "image/png" || check.mime === "image/jpeg") {
              return {
                storagePath,
                entry: {
                  bytes,
                  mimeType: check.mime,
                },
              };
            }
            return { storagePath, entry: null };
          } catch {
            return { storagePath, entry: null };
          }
        },
      );

      for (const { storagePath, entry } of downloaded) {
        if (!entry) {
          imageCache.set(storagePath, null);
          continue;
        }
        if (entry.unsupportedFormatNote) {
          imageCache.set(storagePath, entry);
          continue;
        }
        if (embeddedImageBytesTotal + entry.bytes.byteLength > MAX_TOTAL_EMBED_IMAGE_BYTES) {
          imageCache.set(storagePath, null);
          continue;
        }
        embeddedImageBytesTotal += entry.bytes.byteLength;
        imageCache.set(storagePath, entry);
      }
    };

    const getCachedEmbeddedImage = (
      url: string | null | undefined,
    ): PdfEmbeddedImage | null => {
      if (!body.includeImages || !url) return null;
      const storagePath = extractSafeStoragePath(url);
      if (!storagePath) return null;
      return imageCache.get(storagePath) ?? null;
    };

    let exportTitle = body.title?.trim() ?? "";
    let exportSubject = body.subject?.trim();
    const exportQuestions: PdfExportQuestion[] = [];
    let effectiveShuffleQuestions = body.shuffleQuestions;
    let effectiveShuffleOptions = body.shuffleOptions;

    if (body.attemptId) {
      // --- Export from an authorized Exam Attempt Snapshot via SECURITY DEFINER RPC (V3-SEC-01) ---
      // Never directly SELECT revoked answer-key columns from `exam_attempt_questions` (PG 42501).
      const { data: attemptDetail, error: detailErr } = await rpcGetExamAttemptDetail(
        supabase,
        body.attemptId,
      );
      if (detailErr) {
        if (detailErr.code === "P0001" || /not found/i.test(detailErr.message)) {
          return apiError("NOT_FOUND", "Exam attempt not found.", 404);
        }
        throw detailErr;
      }
      if (!attemptDetail?.attempt || attemptDetail.attempt.user_id !== user.id) {
        return apiError("NOT_FOUND", "Exam attempt not found.", 404);
      }

      const attempt = attemptDetail.attempt;
      const isUnsubmitted =
        attempt.status === "in_progress" || attempt.status === "discarded";

      // Exam Anti-Leak Guard: NEVER export answer keys/explanations for in-progress or discarded attempts!
      if (isUnsubmitted && body.mode !== "question_paper") {
        return apiError(
          "FORBIDDEN",
          "Answer keys and explanations cannot be exported for an unsubmitted or discarded exam attempt.",
          403,
        );
      }

      exportTitle = exportTitle || attempt.study_set_title_snapshot || "Exam Paper";
      effectiveShuffleQuestions = false;
      effectiveShuffleOptions = false;

      const answersByAttemptQId = new Map(
        (attemptDetail.answers ?? []).map((a) => [a.attempt_question_id, a]),
      );

      const snapshotQuestions = isUnsubmitted
        ? stripPreSubmitQuestions(attemptDetail.questions ?? [])
        : [...(attemptDetail.questions ?? [])].sort((a, b) => a.position - b.position);

      // Bound-parallel preload of all unique Storage images referenced by attempt snapshots (DB-10)
      const attemptImageUrls: Array<string | null | undefined> = [];
      for (const row of snapshotQuestions) {
        const typePayload = (row.type_payload_snapshot as QuestionTypePayload | null) ?? null;
        attemptImageUrls.push(row.prompt_image_url_snapshot);
        if (
          !row.prompt_image_url_snapshot &&
          typePayload?.type === "image_hotspot" &&
          typePayload.image_url
        ) {
          attemptImageUrls.push(typePayload.image_url);
        }
        const rawOpts = Array.isArray(row.options_snapshot) ? row.options_snapshot : [];
        for (const opt of rawOpts) {
          attemptImageUrls.push(opt.image_url);
        }
      }
      await preloadStorageImages(attemptImageUrls);

      for (const row of snapshotQuestions) {
        const rawOpts = Array.isArray(row.options_snapshot) ? row.options_snapshot : [];
        const correctIdSet = new Set(
          isUnsubmitted ? [] : (row.correct_option_ids ?? []),
        );
        const mappedOptions: PdfExportOption[] = rawOpts.map((opt, i) => ({
          id: opt.id,
          label: opt.label || String.fromCharCode(65 + i),
          content: opt.content ?? "",
          contentRich: (opt.content_rich as RichTextDoc | null | undefined) ?? null,
          isCorrect: isUnsubmitted ? false : correctIdSet.has(opt.id),
          image: getCachedEmbeddedImage(opt.image_url),
        }));

        const typePayload = (row.type_payload_snapshot as QuestionTypePayload | null) ?? null;
        const primaryImageUrl =
          row.prompt_image_url_snapshot ||
          (typePayload?.type === "image_hotspot" ? typePayload.image_url : null);
        const promptImg = getCachedEmbeddedImage(primaryImageUrl);
        const accepted =
          !isUnsubmitted && Array.isArray(row.accepted_answers_snapshot)
            ? row.accepted_answers_snapshot
                .map((a) => a.answer_text ?? "")
                .filter(Boolean)
            : [];

        const userAnswer = answersByAttemptQId.get(row.id);
        const selectedLabels =
          userAnswer && userAnswer.selected_option_ids.length > 0
            ? mappedOptions
                .filter((o) => userAnswer.selected_option_ids.includes(o.id))
                .map((o) => o.label)
                .join(", ")
            : null;
        const structuredText = formatStructuredExamResponseForPdf(
          (userAnswer?.structured_response as StructuredAnswerResponse | null | undefined) ?? null,
          typePayload,
          mappedOptions,
          body.locale === "vi",
        );

        const passageObj = row.passage_snapshot ?? null;

        exportQuestions.push({
          id: row.id,
          questionType: row.question_type,
          chapter: row.chapter_snapshot,
          prompt: row.prompt_snapshot,
          promptRich: (row.prompt_rich_snapshot as RichTextDoc | null) ?? null,
          explanation: isUnsubmitted ? null : (row.explanation_snapshot ?? null),
          explanationRich: isUnsubmitted
            ? null
            : ((row.explanation_rich_snapshot as RichTextDoc | null) ?? null),
          passageId: passageObj?.id ?? null,
          passageTitle: passageObj?.title ?? null,
          passageContent: passageObj?.content_text ?? null,
          typePayload,
          options: mappedOptions,
          acceptedAnswers: accepted,
          promptImages: promptImg ? [promptImg] : [],
          userResponseText: isUnsubmitted
            ? null
            : selectedLabels || userAnswer?.typed_answer?.trim() || structuredText || null,
          wasCorrect: isUnsubmitted ? null : (userAnswer?.is_correct ?? null),
        });
      }
    } else if (body.studySetId) {
      // --- Export from an authorized Study Set (SEC-012 allow_clone enforced!) ---
      const access = await requireStudySetAccess(
        supabase,
        body.studySetId,
        user.id,
        "read",
      );
      if (!access.isOwner && !access.canClone) {
        return apiError(
          "FORBIDDEN",
          "The owner of this study set has disabled exporting and cloning.",
          403,
        );
      }

      exportTitle = exportTitle || access.studySet.title;
      exportSubject = exportSubject || access.studySet.subject || undefined;

      const selectedIdSet = body.questionIds ? new Set(body.questionIds) : null;

      type QuestionRow = {
        id: string;
        question_type: QuestionType;
        position: number;
        chapter: string | null;
        prompt: string;
        prompt_rich: unknown;
        prompt_image_url: string | null;
        back_text: string | null;
        back_rich: unknown;
        explanation: string | null;
        explanation_rich: unknown;
        hint: string | null;
        audio_transcript: string | null;
        passage_id: string | null;
        type_payload: unknown;
      };

      const rawQuestions: QuestionRow[] = [];
      let offset = 0;
      while (true) {
        let query = supabase
          .from("questions")
          .select(
            "id, question_type, position, chapter, prompt, prompt_rich, prompt_image_url, back_text, back_rich, explanation, explanation_rich, hint, audio_transcript, passage_id, type_payload",
          )
          .eq("study_set_id", body.studySetId)
          .order("position", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (body.chapter?.trim()) {
          query = query.eq("chapter", body.chapter.trim());
        }

        const { data: pageRows, error: qErr } = await query;
        if (qErr) throw qErr;
        if (!pageRows || pageRows.length === 0) break;
        rawQuestions.push(...pageRows);
        if (pageRows.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      const filteredQuestions = selectedIdSet
        ? rawQuestions.filter((q) => selectedIdSet.has(q.id))
        : rawQuestions;

      const qIds = filteredQuestions.map((q) => q.id);

      // Bound-parallel chunked passage, option & accepted-answer fetches (<= 120 UUIDs per .in(), concurrency = 6)
      type RawOptionRow = {
        id: string;
        question_id: string;
        position: number;
        label: string;
        content: string;
        content_rich: unknown;
        image_url: string | null;
        is_correct: boolean;
      };

      const uniquePassageIds = Array.from(
        new Set(filteredQuestions.map((q) => q.passage_id).filter((id): id is string => Boolean(id))),
      );
      const qIdChunks = chunkArray(qIds, IN_QUERY_CHUNK_SIZE);

      const [passageChunks, optionChunks, acceptedChunks] = await Promise.all([
        mapWithConcurrency(
          chunkArray(uniquePassageIds, IN_QUERY_CHUNK_SIZE),
          PDF_CONCURRENCY_LIMIT,
          async (pChunk) => {
            const { data: pRows, error: pErr } = await supabase
              .from("shared_passages")
              .select("id, title, content_text")
              .in("id", pChunk);
            if (pErr) throw pErr;
            return pRows ?? [];
          },
        ),
        mapWithConcurrency(qIdChunks, PDF_CONCURRENCY_LIMIT, async (idChunk) => {
          const { data: optRows, error: optErr } = await supabase
            .from("question_options")
            .select("id, question_id, position, label, content, content_rich, image_url, is_correct")
            .in("question_id", idChunk)
            .order("position", { ascending: true });
          if (optErr) throw optErr;
          return (optRows ?? []) as RawOptionRow[];
        }),
        mapWithConcurrency(qIdChunks, PDF_CONCURRENCY_LIMIT, async (idChunk) => {
          const { data: accRows, error: accErr } = await supabase
            .from("question_accepted_answers")
            .select("question_id, answer_text")
            .in("question_id", idChunk);
          if (accErr) throw accErr;
          return accRows ?? [];
        }),
      ]);

      const passagesById = new Map<string, { title: string | null; content: string }>();
      for (const pRows of passageChunks) {
        for (const p of pRows) {
          passagesById.set(p.id, { title: p.title, content: p.content_text });
        }
      }

      const rawOptionsByQ = new Map<string, RawOptionRow[]>();
      for (const optRows of optionChunks) {
        for (const opt of optRows) {
          const list = rawOptionsByQ.get(opt.question_id) ?? [];
          list.push(opt);
          rawOptionsByQ.set(opt.question_id, list);
        }
      }

      const acceptedByQ = new Map<string, string[]>();
      for (const accRows of acceptedChunks) {
        for (const acc of accRows) {
          const list = acceptedByQ.get(acc.question_id) ?? [];
          list.push(acc.answer_text);
          acceptedByQ.set(acc.question_id, list);
        }
      }

      // Collect all unique Storage image URLs in document order and preload with concurrency = 6 (DB-10)
      const setImageUrls: Array<string | null | undefined> = [];
      for (const q of filteredQuestions) {
        const typePayload = (q.type_payload as QuestionTypePayload | null) ?? null;
        setImageUrls.push(q.prompt_image_url);
        if (
          !q.prompt_image_url &&
          typePayload?.type === "image_hotspot" &&
          typePayload.image_url
        ) {
          setImageUrls.push(typePayload.image_url);
        }
        for (const opt of rawOptionsByQ.get(q.id) ?? []) {
          setImageUrls.push(opt.image_url);
        }
      }
      await preloadStorageImages(setImageUrls);

      for (const q of filteredQuestions) {
        const typePayload = (q.type_payload as QuestionTypePayload | null) ?? null;
        const primaryImageUrl =
          q.prompt_image_url ||
          (typePayload?.type === "image_hotspot" ? typePayload.image_url : null);
        const promptImg = getCachedEmbeddedImage(primaryImageUrl);
        const passage = q.passage_id ? passagesById.get(q.passage_id) : undefined;
        const mappedOptions: PdfExportOption[] = (rawOptionsByQ.get(q.id) ?? []).map((opt) => ({
          id: opt.id,
          label: opt.label,
          content: opt.content,
          contentRich: (opt.content_rich as RichTextDoc | null) ?? null,
          isCorrect: opt.is_correct,
          image: getCachedEmbeddedImage(opt.image_url),
        }));

        exportQuestions.push({
          id: q.id,
          questionType: q.question_type,
          chapter: q.chapter,
          prompt: q.prompt,
          promptRich: (q.prompt_rich as RichTextDoc | null) ?? null,
          backText: q.back_text,
          backRich: (q.back_rich as RichTextDoc | null) ?? null,
          explanation: q.explanation,
          explanationRich: (q.explanation_rich as RichTextDoc | null) ?? null,
          hint: q.hint,
          passageId: q.passage_id,
          passageTitle: passage?.title ?? null,
          passageContent: passage?.content ?? null,
          audioTranscript: q.audio_transcript,
          typePayload,
          options: mappedOptions,
          acceptedAnswers: acceptedByQ.get(q.id) ?? [],
          promptImages: promptImg ? [promptImg] : [],
        });
      }
    }

    if (exportQuestions.length === 0) {
      return apiError(
        "BAD_REQUEST",
        "No questions available to export into PDF.",
        400,
      );
    }

    const pdf = await exportStudySetToPdf(exportQuestions, {
      mode: body.mode,
      locale: body.locale,
      orientation: body.orientation,
      title: exportTitle || "StudyHub Export",
      subject: exportSubject,
      examCode: body.examCode,
      includeStudentInfo: body.includeStudentInfo,
      headerText: body.headerText,
      footerText: body.footerText,
      shuffleQuestions: effectiveShuffleQuestions,
      shuffleOptions: effectiveShuffleOptions,
      shuffleSeed: body.shuffleSeed,
      fontSize: body.fontSize,
      grayscale: body.grayscale,
      includeAudioTranscript: body.includeAudioTranscript,
    });

    const safeFileBase = sanitizeFileName(exportTitle || "studyhub-export").replace(
      /\.[^.]+$/,
      "",
    );
    const fileName = `${safeFileBase}-${body.mode}.pdf`;

    return streamBinaryResponse(pdf.bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": buildPdfContentDisposition(fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-StudyHub-Page-Count": String(pdf.pageCount),
        "X-StudyHub-Question-Count": String(pdf.questionCount),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
