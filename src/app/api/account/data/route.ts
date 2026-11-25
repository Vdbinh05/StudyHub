import { type NextRequest, type NextResponse } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { streamJsonResponse } from "@/lib/security/stream-response";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  fetchAllPages,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { rpcGetMyProfile } from "@/lib/supabase/rpc";
import { V3_BACKUP_SCOPE } from "@/lib/supabase/backup-scope";
import { TEMP_STORAGE_BUCKET } from "@/lib/supabase/temp-storage";
import { deleteAccountDataSchema } from "@/lib/validation/profile";
import type { Database } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Exports all personal StudyHub V3 data belonging to the authenticated user as JSON (`studyhub-v3`).
 * Paginated cleanly across all tables so large accounts (10,000+ Qs) are never truncated,
 * and streamed without `Content-Length` to bypass Vercel Hobby's 4.5 MB buffered response cap.
 */
export async function GET(request?: NextRequest): Promise<Response> {
  try {
    const { supabase, user } = await requireAuth();
    const rateLimitReq =
      request ?? new Request("https://studyhub.local/api/account/data");
    const limited = await enforceDistributedRateLimit(
      rateLimitReq,
      RATE_LIMITS.ACCOUNT_DATA,
      user.id,
    );
    if (limited) return limited;

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
      userNotes,
      mediaAssets,
      checkpoints,
      confidenceEvents,
      questionReports,
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
      fetchAllPages(async (from, to) =>
        supabase
          .from("user_question_notes")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("media_assets")
          .select(
            "id, study_set_id, kind, storage_bucket, storage_path, mime_type, file_name, size_bytes, sha256_hash, width, height, duration_ms, alt_text, caption, created_at, updated_at",
          )
          .eq("owner_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("learning_session_checkpoints")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("learning_confidence_events")
          .select("*")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("question_reports")
          .select("*")
          .eq("reporter_id", user.id)
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
    const [options, accepted, questionTags, sharedPassages, diagramSets] =
      await Promise.all([
        questionIds.length > 0
          ? fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_options")
                  .select("*")
                  .in("question_id", chunk)
                  .order("position", { ascending: true }),
              SAFE_IN_CHUNK_SIZE,
            )
          : Promise.resolve([]),
        questionIds.length > 0
          ? fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_accepted_answers")
                  .select("*")
                  .in("question_id", chunk),
              SAFE_IN_CHUNK_SIZE,
            )
          : Promise.resolve([]),
        questionIds.length > 0
          ? fetchInChunks(
              questionIds,
              async (chunk) =>
                supabase
                  .from("question_tags")
                  .select("*")
                  .in("question_id", chunk),
              SAFE_IN_CHUNK_SIZE,
            )
          : Promise.resolve([]),
        ownedSetIds.length > 0
          ? fetchInChunks(
              ownedSetIds,
              async (chunk) =>
                supabase
                  .from("shared_passages")
                  .select("*")
                  .in("study_set_id", chunk)
                  .order("sort_order", { ascending: true }),
              SAFE_IN_CHUNK_SIZE,
            )
          : Promise.resolve([]),
        ownedSetIds.length > 0
          ? fetchInChunks(
              ownedSetIds,
              async (chunk) =>
                supabase
                  .from("diagram_sets")
                  .select("*")
                  .in("study_set_id", chunk)
                  .order("created_at", { ascending: true }),
              SAFE_IN_CHUNK_SIZE,
            )
          : Promise.resolve([]),
      ]);

    const diagramIds = diagramSets.map((d) => d.id);
    const presetIds = presets.map((p) => p.id);
    const [diagramHotspots, presetSources] = await Promise.all([
      diagramIds.length > 0
        ? fetchInChunks(
            diagramIds,
            async (chunk) =>
              supabase
                .from("diagram_hotspots")
                .select("*")
                .in("diagram_id", chunk)
                .order("sort_order", { ascending: true }),
            SAFE_IN_CHUNK_SIZE,
          )
        : Promise.resolve([]),
      presetIds.length > 0
        ? fetchInChunks(
            presetIds,
            async (chunk) =>
              supabase
                .from("exam_preset_sources")
                .select("*")
                .in("preset_id", chunk),
            SAFE_IN_CHUNK_SIZE,
          )
        : Promise.resolve([]),
    ]);

    const exportPayload = {
      exported_at: new Date().toISOString(),
      schema_version: "studyhub-v3",
      backup_scope: V3_BACKUP_SCOPE,
      profile: profile ? { ...profile, email: profile.email || user.email || "" } : null,
      preferences: preferences ?? null,
      folders,
      study_sets: studySets,
      shared_passages: sharedPassages,
      diagram_sets: diagramSets,
      diagram_hotspots: diagramHotspots,
      questions,
      question_options: options,
      question_accepted_answers: accepted,
      tags,
      question_tags: questionTags,
      user_question_notes: userNotes,
      media_assets: mediaAssets,
      learning_session_checkpoints: checkpoints,
      learning_confidence_events: confidenceEvents,
      question_reports: questionReports,
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

    return streamJsonResponse(exportPayload, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="studyhub-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

async function purgeUserStorageFolder(
  storage: ReturnType<NonNullable<ReturnType<typeof tryCreateAdminClient>>["storage"]["from"]>,
  prefix: string,
  protectedPaths?: ReadonlySet<string>,
): Promise<void> {
  const { data: items } = await storage.list(prefix, { limit: 1000 });
  if (!items || items.length === 0) return;

  const filePaths: string[] = [];
  for (const item of items) {
    const fullPath = `${prefix}/${item.name}`;
    if (item.id === null) {
      await purgeUserStorageFolder(storage, fullPath, protectedPaths);
    } else if (!protectedPaths || !protectedPaths.has(fullPath)) {
      filePaths.push(fullPath);
    }
  }
  if (filePaths.length > 0) {
    await storage.remove(filePaths);
  }
}

/**
 * Deletes the authenticated user's study data (or full auth account if `scope === "account"`
 * and server admin client is configured). Checks every deletion error strictly (SH-043 / SEC-020)
 * and NEVER deletes Storage blobs or media relations pinned by other users' exam snapshots or clones (V32-009 / SEC-05).
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.ACCOUNT_DATA,
      user.id,
    );
    if (limited) return limited;

    const body = await parseJsonBody(request);
    const input = deleteAccountDataSchema.parse(body);

    // Order child/independent deletes cleanly and assert ZERO errors (including all V3 tables!)
    const deleteOps = [
      supabase.from("learning_sync_events").delete().eq("user_id", user.id),
      supabase.from("learning_confidence_events").delete().eq("user_id", user.id),
      supabase.from("learning_session_checkpoints").delete().eq("user_id", user.id),
      supabase.from("user_question_notes").delete().eq("user_id", user.id),
      supabase.from("question_reports").delete().eq("reporter_id", user.id),
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

    const admin = tryCreateAdminClient();
    const protectedStoragePaths = new Set<string>();
    const unreferencedMediaIds: string[] = [];
    const unreferencedStoragePaths: string[] = [];

    // V32-009 / SEC-05: Query caller's media_assets and check cross-tenant content_media_relations
    // BEFORE removing any Storage object or media_assets row!
    if (admin) {
      const ownedMedia = await fetchAllPages(async (from, to) =>
        admin
          .from("media_assets")
          .select("id, storage_bucket, storage_path")
          .eq("owner_id", user.id)
          .range(from, to),
      );

      if (ownedMedia.length > 0) {
        const mediaIds = ownedMedia.map((m) => m.id);
        const remainingRelations = await fetchInChunks(
          mediaIds,
          async (chunk) =>
            admin
              .from("content_media_relations")
              .select("media_id")
              .in("media_id", chunk),
          SAFE_IN_CHUNK_SIZE,
        );
        const pinnedIds = new Set(remainingRelations.map((r) => r.media_id));

        for (const asset of ownedMedia) {
          if (pinnedIds.has(asset.id)) {
            protectedStoragePaths.add(asset.storage_path);
          } else {
            unreferencedMediaIds.push(asset.id);
            if (asset.storage_bucket === "study-media") {
              unreferencedStoragePaths.push(asset.storage_path);
            }
          }
        }

        if (unreferencedMediaIds.length > 0) {
          for (let i = 0; i < unreferencedMediaIds.length; i += SAFE_IN_CHUNK_SIZE) {
            const chunk = unreferencedMediaIds.slice(i, i + SAFE_IN_CHUNK_SIZE);
            await admin
              .from("media_assets")
              .delete()
              .eq("owner_id", user.id)
              .in("id", chunk);
          }
        }
      }
    } else {
      // Without admin client, rely strictly on DB ON DELETE RESTRICT for unreferenced rows only
      await supabase.from("media_assets").delete().eq("owner_id", user.id);
    }

    let accountDeleted = false;
    let storagePurged = false;
    if (input.scope === "account") {
      if (admin) {
        try {
          const bucket = admin.storage.from("study-media");
          await purgeUserStorageFolder(bucket, `avatars/${user.id}`);
          if (unreferencedStoragePaths.length > 0) {
            for (let i = 0; i < unreferencedStoragePaths.length; i += SAFE_IN_CHUNK_SIZE) {
              await bucket.remove(
                unreferencedStoragePaths.slice(i, i + SAFE_IN_CHUNK_SIZE),
              );
            }
          }
          // Walk legacy/unindexed objects under {user.id}/* while strictly skipping any protected pinned paths!
          await purgeUserStorageFolder(bucket, user.id, protectedStoragePaths);
          const tempBucket = admin.storage.from(TEMP_STORAGE_BUCKET);
          await purgeUserStorageFolder(tempBucket, user.id);
          storagePurged = true;
        } catch {
          // Non-fatal if bucket is empty or storage unavailable
        }
        const { error: delAuthErr } = await admin.auth.admin.deleteUser(user.id);
        if (delAuthErr) throw delAuthErr;
        accountDeleted = true;
      }
      await supabase.auth.signOut();
    } else if (admin && unreferencedStoragePaths.length > 0) {
      try {
        const bucket = admin.storage.from("study-media");
        for (let i = 0; i < unreferencedStoragePaths.length; i += SAFE_IN_CHUNK_SIZE) {
          await bucket.remove(
            unreferencedStoragePaths.slice(i, i + SAFE_IN_CHUNK_SIZE),
          );
        }
      } catch {
        // Non-fatal storage cleanup
      }
    }

    return apiSuccess({
      cleared: true,
      scope: input.scope,
      account_deleted: accountDeleted,
      storage_purged: storagePurged,
      preserved_shared_media_count: protectedStoragePaths.size,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
