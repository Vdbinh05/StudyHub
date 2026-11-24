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
import { normalizeAnswerText, slugifyTag } from "@/lib/security/sanitize";
import { chunkArray } from "@/lib/supabase/query-helpers";
import { consumeTempUploadBytes } from "@/lib/supabase/temp-storage";
import { restoreAccountBackupSchema } from "@/lib/validation/profile";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BACKUP_BYTES = 12 * 1024 * 1024; // 12 MB cap
const INSERT_BATCH_SIZE = 200;

const stagedRestoreSchema = z.object({
  storagePath: z.string().trim().min(1).max(300),
  mode: z.enum(["merge", "append"]).optional(),
});

/**
 * Restores a StudyHub JSON account backup exported via `GET /api/account/data` (SH-033).
 * Supports both direct JSON payloads (`<= 3.5 MB`) and `{ storagePath, mode? }` referencing
 * a temporary JSON backup uploaded to the private `study-temp` bucket (for backups `> 3.5 MB`).
 * Creates clean user-owned copies with fresh UUIDs, preserving folder hierarchy, study sets,
 * questions, options, accepted answers, tags, and optional preferences.
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

    const input = restoreAccountBackupSchema.parse(backupPayload);

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

    // Insert roots first, then children cleanly (avoiding FK ordering violations)
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

    // 4. Restore questions mapped to new set IDs
    const questionIdMap = new Map<string, { newId: string; newSetId: string }>();
    const questionsInput = input.questions ?? [];
    let restoredQuestions = 0;

    const validQuestions = questionsInput
      .map((q, idx) => {
        const newSetId = setIdMap.get(q.study_set_id);
        if (!newSetId) return null;
        const newId = randomUUID();
        if (q.id) questionIdMap.set(q.id, { newId, newSetId });
        return {
          id: newId,
          study_set_id: newSetId,
          question_type: q.question_type ?? "single_choice",
          position: q.position ?? idx,
          chapter: q.chapter ?? null,
          prompt: q.prompt,
          prompt_image_url: q.prompt_image_url ?? null,
          back_text: q.back_text ?? null,
          back_image_url: q.back_image_url ?? null,
          explanation: q.explanation ?? null,
          hint: q.hint ?? null,
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

    // 5. Restore options, accepted answers & question_tags in safe batches
    let restoredOptions = 0;
    const validOptions = (input.question_options ?? [])
      .map((o, idx) => {
        const mapped = questionIdMap.get(o.question_id);
        if (!mapped) return null;
        return {
          question_id: mapped.newId,
          study_set_id: mapped.newSetId,
          position: o.position ?? idx,
          label: o.label,
          content: o.content,
          image_url: o.image_url ?? null,
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

    return apiSuccess(
      {
        restored: {
          preferences: preferencesRestored,
          folders: restoredFolders,
          study_sets: restoredSets,
          questions: restoredQuestions,
          options: restoredOptions,
          accepted_answers: restoredAccepted,
          tags: restoredTags,
        },
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
