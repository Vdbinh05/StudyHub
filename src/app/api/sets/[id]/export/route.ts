import { NextResponse } from "next/server";
import { z } from "zod";
import { exportStudySet, type StudySetExportFormat } from "@/lib/export";
import { chunkArray } from "@/lib/import";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiError, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import type {
  Question,
  QuestionAcceptedAnswer,
  QuestionOption,
  Tag,
} from "@/types/domain";

const EXPORT_QUESTION_PAGE_SIZE = 500;
const EXPORT_IN_CHUNK_SIZE = 120;

const ExportQuerySchema = z.object({
  format: z.enum(["json", "csv", "txt", "xlsx"]).default("json"),
  txtStyle: z.enum(["eduquiz", "answer_key"]).default("eduquiz"),
  xlsxStyle: z.enum(["standard", "wayground"]).default("standard"),
  includeExplanations: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  includeTags: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  includeDifficulty: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
  includeChapters: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const studySetId = z.string().uuid("Invalid study set ID.").parse(id);

    const url = new URL(request.url);
    const query = ExportQuerySchema.parse({
      format: url.searchParams.get("format") ?? "json",
      txtStyle: url.searchParams.get("txtStyle") ?? "eduquiz",
      xlsxStyle: url.searchParams.get("xlsxStyle") ?? "standard",
      includeExplanations: url.searchParams.get("includeExplanations") ?? undefined,
      includeTags: url.searchParams.get("includeTags") ?? undefined,
      includeDifficulty: url.searchParams.get("includeDifficulty") ?? undefined,
      includeChapters: url.searchParams.get("includeChapters") ?? undefined,
    });

    const { supabase, user } = await requireAuth();

    // Enforce export rate limit (SEC-014)
    const rateLimited = enforceRateLimit(request, RATE_LIMITS.EXPORT, user.id);
    if (rateLimited) return rateLimited;

    const access = await requireStudySetAccess(
      supabase,
      studySetId,
      user.id,
      "read",
    );

    // Enforce share-link allow_clone restriction on non-public sets (SEC-012)
    if (!access.isOwner && !access.canClone) {
      return apiError(
        "FORBIDDEN",
        "Exporting and copying are disabled by the owner of this study set.",
        403,
      );
    }

    const { studySet } = access;

    // Fetch all questions in 500-row pages and chunk .in() batches to <= 120 UUIDs
    // so 10,000+ question sets never hit PostgREST 1,000-row truncation or HTTP 414 (SH-005).
    const allQuestions: Question[] = [];
    const tagCache = new Map<string, Tag>();
    let offset = 0;

    while (true) {
      const { data: qRows, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("study_set_id", studySetId)
        .order("position", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + EXPORT_QUESTION_PAGE_SIZE - 1);

      if (qErr) throw qErr;
      if (!qRows || qRows.length === 0) break;

      const qIds = qRows.map((q) => q.id);
      const optionsByQ = new Map<string, QuestionOption[]>();
      const accByQ = new Map<string, QuestionAcceptedAnswer[]>();
      const tagIdsByQ = new Map<string, string[]>();
      const missingTagIds = new Set<string>();

      for (const idChunk of chunkArray(qIds, EXPORT_IN_CHUNK_SIZE)) {
        const [optRes, accRes, qtRes] = await Promise.all([
          supabase
            .from("question_options")
            .select("*")
            .eq("study_set_id", studySetId)
            .in("question_id", idChunk)
            .order("position", { ascending: true }),
          supabase
            .from("question_accepted_answers")
            .select("*")
            .eq("study_set_id", studySetId)
            .in("question_id", idChunk),
          supabase
            .from("question_tags")
            .select("question_id, tag_id")
            .eq("study_set_id", studySetId)
            .in("question_id", idChunk),
        ]);

        if (optRes.error) throw optRes.error;
        if (accRes.error) throw accRes.error;
        if (qtRes.error) throw qtRes.error;

        for (const opt of optRes.data ?? []) {
          const list = optionsByQ.get(opt.question_id);
          if (list) list.push(opt as QuestionOption);
          else optionsByQ.set(opt.question_id, [opt as QuestionOption]);
        }

        for (const acc of accRes.data ?? []) {
          const list = accByQ.get(acc.question_id);
          if (list) list.push(acc as QuestionAcceptedAnswer);
          else accByQ.set(acc.question_id, [acc as QuestionAcceptedAnswer]);
        }

        for (const qt of qtRes.data ?? []) {
          const list = tagIdsByQ.get(qt.question_id);
          if (list) list.push(qt.tag_id);
          else tagIdsByQ.set(qt.question_id, [qt.tag_id]);
          if (!tagCache.has(qt.tag_id)) {
            missingTagIds.add(qt.tag_id);
          }
        }
      }

      // Resolve any newly seen tags in <= 120-UUID chunks
      if (missingTagIds.size > 0) {
        for (const tagChunk of chunkArray(Array.from(missingTagIds), EXPORT_IN_CHUNK_SIZE)) {
          const { data: tagRows, error: tagErr } = await supabase
            .from("tags")
            .select("*")
            .in("id", tagChunk);
          if (tagErr) throw tagErr;
          for (const t of tagRows ?? []) {
            tagCache.set(t.id, t as Tag);
          }
        }
      }

      for (const q of qRows) {
        const qTagIds = tagIdsByQ.get(q.id) ?? [];
        const qTags: Tag[] = [];
        for (const tid of qTagIds) {
          const tag = tagCache.get(tid);
          if (tag) qTags.push(tag);
        }

        allQuestions.push({
          ...(q as unknown as Question),
          options: optionsByQ.get(q.id) ?? [],
          accepted_answers: accByQ.get(q.id) ?? [],
          tags: qTags,
        });
      }

      if (qRows.length < EXPORT_QUESTION_PAGE_SIZE) break;
      offset += EXPORT_QUESTION_PAGE_SIZE;
    }

    const exported = await exportStudySet(studySet, allQuestions, {
      format: query.format as StudySetExportFormat,
      txtStyle: query.txtStyle,
      xlsxStyle: query.xlsxStyle,
      includeExplanations: query.includeExplanations,
      includeTags: query.includeTags,
      includeDifficulty: query.includeDifficulty,
      includeChapters: query.includeChapters,
    });

    const asciiFallbackName = exported.fileName.replace(/[^\x20-\x7E]/g, "_");
    const encodedUtf8Name = encodeURIComponent(exported.fileName);

    return new NextResponse(Buffer.from(exported.content), {
      status: 200,
      headers: {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodedUtf8Name}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return apiError(
        "VALIDATION_ERROR",
        "Invalid export parameters.",
        400,
        err.issues,
      );
    }
    return handleApiError(err);
  }
}
