import { NextResponse } from "next/server";
import { z } from "zod";
import { exportStudySet, type StudySetExportFormat } from "@/lib/export";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiError, handleApiError } from "@/lib/security/errors";
import type {
  Question,
  QuestionAcceptedAnswer,
  QuestionOption,
  Tag,
} from "@/types/domain";

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
    const { studySet } = await requireStudySetAccess(
      supabase,
      studySetId,
      user.id,
      "read",
    );

    // Fetch all questions in 1,000-row pages so large 10,000+ sets export completely
    const allQuestions: Question[] = [];
    const PAGE_SIZE = 1000;
    let offset = 0;

    while (true) {
      const { data: qRows, error: qErr } = await supabase
        .from("questions")
        .select("*")
        .eq("study_set_id", studySetId)
        .order("position", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (qErr) throw qErr;
      if (!qRows || qRows.length === 0) break;

      const qIds = qRows.map((q) => q.id);

      const [optRes, accRes, qtRes] = await Promise.all([
        supabase
          .from("question_options")
          .select("*")
          .in("question_id", qIds)
          .order("position", { ascending: true }),
        supabase
          .from("question_accepted_answers")
          .select("*")
          .in("question_id", qIds),
        supabase
          .from("question_tags")
          .select("question_id, tag_id")
          .in("question_id", qIds),
      ]);

      if (optRes.error) throw optRes.error;
      if (accRes.error) throw accRes.error;
      if (qtRes.error) throw qtRes.error;

      const optionsByQ = new Map<string, QuestionOption[]>();
      for (const opt of optRes.data ?? []) {
        const list = optionsByQ.get(opt.question_id);
        if (list) list.push(opt as QuestionOption);
        else optionsByQ.set(opt.question_id, [opt as QuestionOption]);
      }

      const accByQ = new Map<string, QuestionAcceptedAnswer[]>();
      for (const acc of accRes.data ?? []) {
        const list = accByQ.get(acc.question_id);
        if (list) list.push(acc as QuestionAcceptedAnswer);
        else accByQ.set(acc.question_id, [acc as QuestionAcceptedAnswer]);
      }

      // Resolve tag records if any exist
      const uniqueTagIds = Array.from(
        new Set((qtRes.data ?? []).map((r) => r.tag_id)),
      );
      const tagMap = new Map<string, Tag>();
      if (uniqueTagIds.length > 0) {
        const { data: tagRows, error: tagErr } = await supabase
          .from("tags")
          .select("*")
          .in("id", uniqueTagIds);
        if (tagErr) throw tagErr;
        for (const t of tagRows ?? []) {
          tagMap.set(t.id, t as Tag);
        }
      }

      const tagsByQ = new Map<string, Tag[]>();
      for (const qt of qtRes.data ?? []) {
        const tag = tagMap.get(qt.tag_id);
        if (!tag) continue;
        const list = tagsByQ.get(qt.question_id);
        if (list) list.push(tag);
        else tagsByQ.set(qt.question_id, [tag]);
      }

      for (const q of qRows) {
        allQuestions.push({
          ...(q as unknown as Question),
          options: optionsByQ.get(q.id) ?? [],
          accepted_answers: accByQ.get(q.id) ?? [],
          tags: tagsByQ.get(q.id) ?? [],
        });
      }

      if (qRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
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
