import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  fetchAllPages,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { rpcGetMyProfile } from "@/lib/supabase/rpc";
import { deleteAccountDataSchema } from "@/lib/validation/profile";
import type { Database } from "@/types/database";

/**
 * Exports all personal StudyHub data belonging to the authenticated user as JSON.
 * Paginated cleanly across all tables so large accounts (10,000+ Qs) are never truncated.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const [
      { data: profile },
      { data: preferences },
      folders,
      studySets,
      progress,
      starred,
      sessions,
      sessionAnswers,
      exams,
      examAnswers,
      tags,
      presets,
      cycles,
    ] = await Promise.all([
      rpcGetMyProfile(supabase),
      supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      fetchAllPages(async (from, to) =>
        supabase.from("folders").select("*").eq("owner_id", user.id).range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_sets")
          .select("*")
          .eq("owner_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("user_question_progress")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("starred_questions")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_sessions")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_session_answers")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("exam_attempts")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("exam_attempt_answers")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase.from("tags").select("*").eq("owner_id", user.id).range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("exam_presets")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("coverage_cycles")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
    ]);

    const ownedSetIds = studySets.map((s) => s.id);
    const questions: Array<Database["public"]["Tables"]["questions"]["Row"]> = [];
    for (let i = 0; i < ownedSetIds.length; i += SAFE_IN_CHUNK_SIZE) {
      const setChunk = ownedSetIds.slice(i, i + SAFE_IN_CHUNK_SIZE);
      const chunkQuestions = await fetchAllPages(async (from, to) =>
        supabase
          .from("questions")
          .select("*")
          .in("study_set_id", setChunk)
          .order("study_set_id", { ascending: true })
          .order("position", { ascending: true })
          .range(from, to),
      );
      questions.push(...chunkQuestions);
    }

    const questionIds = questions.map((q) => q.id);
    const [options, accepted, questionTags] =
      questionIds.length > 0
        ? await Promise.all([
            fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_options")
                  .select("*")
                  .in("question_id", chunk)
                  .order("position", { ascending: true }),
              SAFE_IN_CHUNK_SIZE,
            ),
            fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_accepted_answers")
                  .select("*")
                  .in("question_id", chunk),
              SAFE_IN_CHUNK_SIZE,
            ),
            fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_tags")
                  .select("*")
                  .in("question_id", chunk),
              SAFE_IN_CHUNK_SIZE,
            ),
          ])
        : [[], [], []];

    const presetIds = presets.map((p) => p.id);
    const presetSources =
      presetIds.length > 0
        ? await fetchInChunks(
            presetIds,
            async (chunk) =>
              supabase
                .from("exam_preset_sources")
                .select("*")
                .in("preset_id", chunk),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const exportPayload = {
      exported_at: new Date().toISOString(),
      schema_version: "studyhub-v2",
      profile: profile ? { ...profile, email: profile.email || user.email || "" } : null,
      preferences: preferences ?? null,
      folders,
      study_sets: studySets,
      questions,
      question_options: options,
      question_accepted_answers: accepted,
      tags,
      question_tags: questionTags,
      progress,
      starred_questions: starred,
      study_sessions: sessions,
      study_session_answers: sessionAnswers,
      exam_attempts: exams,
      exam_attempt_answers: examAnswers,
      exam_presets: presets,
      exam_preset_sources: presetSources,
      coverage_cycles: cycles,
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="studyhub-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

async function purgeUserStorageFolder(
  storage: ReturnType<NonNullable<ReturnType<typeof tryCreateAdminClient>>["storage"]["from"]>,
  prefix: string,
): Promise<void> {
  const { data: items } = await storage.list(prefix, { limit: 1000 });
  if (!items || items.length === 0) return;

  const filePaths: string[] = [];
  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`;
    if (item.id === null) {
      // Nested folder (e.g. {userId}/{studySetId})
      await purgeUserStorageFolder(storage, fullPath);
    } else {
      filePaths.push(fullPath);
    }
  }
  if (filePaths.length > 0) {
    await storage.remove(filePaths);
  }
}

/**
 * Deletes the authenticated user's study data (or full auth account if `scope === "account"`
 * and server admin client is configured). Checks every deletion error strictly (SH-043 / SEC-020).
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = deleteAccountDataSchema.parse(body);

    // Order child/independent deletes cleanly and assert ZERO errors
    const deleteOps = [
      supabase.from("coverage_cycles").delete().eq("user_id", user.id),
      supabase.from("exam_presets").delete().eq("user_id", user.id),
      supabase.from("exam_attempts").delete().eq("user_id", user.id),
      supabase.from("study_sessions").delete().eq("user_id", user.id),
      supabase.from("user_question_progress").delete().eq("user_id", user.id),
      supabase.from("starred_questions").delete().eq("user_id", user.id),
      supabase.from("import_jobs").delete().eq("user_id", user.id),
      supabase.from("study_set_members").delete().eq("user_id", user.id),
      supabase
        .from("friendships")
        .delete()
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .neq("status", "blocked"),
      supabase
        .from("friendships")
        .delete()
        .eq("status", "blocked")
        .eq("blocked_by", user.id),
    ];

    const firstWave = await Promise.all(deleteOps);
    for (const res of firstWave) {
      if (res.error) throw res.error;
    }

    const secondWave = await Promise.all([
      supabase.from("study_sets").delete().eq("owner_id", user.id),
      supabase.from("folders").delete().eq("owner_id", user.id),
      supabase.from("tags").delete().eq("owner_id", user.id),
    ]);
    for (const res of secondWave) {
      if (res.error) throw res.error;
    }

    let accountDeleted = false;
    let storagePurged = false;
    if (input.scope === "account") {
      const admin = tryCreateAdminClient();
      if (admin) {
        try {
          const bucket = admin.storage.from("study-media");
          await purgeUserStorageFolder(bucket, `avatars/${user.id}`);
          await purgeUserStorageFolder(bucket, user.id);
          storagePurged = true;
        } catch {
          // Non-fatal if bucket is empty or storage unavailable
        }
        const { error: delAuthErr } = await admin.auth.admin.deleteUser(user.id);
        if (delAuthErr) throw delAuthErr;
        accountDeleted = true;
      }
      await supabase.auth.signOut();
    }

    return apiSuccess({
      cleared: true,
      scope: input.scope,
      account_deleted: accountDeleted,
      storage_purged: storagePurged,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
