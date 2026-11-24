// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  rpcCloneStudySet,
  rpcCreateExamAttemptV2,
  rpcGetExamAttemptDetail,
  rpcGlobalLibrarySearch,
  rpcResetLearningProgress,
  rpcSaveExamAttemptAnswers,
  rpcSubmitExamAttempt,
  rpcSyncOfflineLearningEvents,
} from "@/lib/supabase/rpc";
import type { Database, Json } from "@/types/database";
import type {
  ExamSnapshotQuestion,
  RichTextDoc,
  StructuredAnswerResponse,
} from "@/types/domain";

interface LiveSupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

const PLACEHOLDER_MARKERS = [
  "your-project-ref",
  "your-supabase-",
  "your-publishable-key",
  "your-anon-key",
  "your-secret-key",
  "your-service-role-key",
  "placeholder",
  "example.supabase.co",
];

function isRealValue(val: string | undefined): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return !PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

/**
 * Loads `.env.local` into memory WITHOUT printing or logging any secret.
 * Returns null if live Supabase credentials are absent so offline runs skip cleanly.
 */
function loadLiveSupabaseConfig(): LiveSupabaseConfig | null {
  const envMap: Record<string, string> = {};
  const envPath = path.resolve(process.cwd(), ".env.local");

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      envMap[key] = val;
    }
  }

  const pick = (k: string): string | undefined => process.env[k] ?? envMap[k];

  const url = pick("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey =
    pick("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    pick("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey =
    pick("SUPABASE_SECRET_KEY") || pick("SUPABASE_SERVICE_ROLE_KEY");

  if (
    !isRealValue(url) ||
    !isRealValue(publishableKey) ||
    !isRealValue(secretKey)
  ) {
    return null;
  }

  return {
    url: url.trim(),
    publishableKey: publishableKey.trim(),
    secretKey: secretKey.trim(),
  };
}

const liveConfig = loadLiveSupabaseConfig();

function makeRichDoc(text: string): RichTextDoc {
  return {
    version: 1,
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

describe.skipIf(!liveConfig)(
  "Live Supabase Cloud PostgreSQL 17.12 — StudyHub V3.0 Migrations (0013-0015), 12-Type Grading & RPCs",
  () => {
    let admin: SupabaseClient<Database>;
    let userA: SupabaseClient<Database>;
    let userB: SupabaseClient<Database>;

    let userAId = "";
    let userBId = "";
    const trackedUserIds: string[] = [];

    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const passA = `StudyHub!V3A_${randomUUID().slice(0, 12)}`;
    const passB = `StudyHub!V3B_${randomUUID().slice(0, 12)}`;

    // Shared V3 study set fixtures owned by userA
    let v3SetId = "";
    let imgMediaId = "";
    let optImgMediaId = "";
    let audioMediaId = "";
    let diagramMediaId = "";
    let passageId = "";
    let diagramId = "";

    // Track seeded question IDs across all 12 exam-compatible types
    const qIds: Record<string, string> = {};
    const optCorrectByQ = new Map<string, string[]>();
    const optWrongByQ = new Map<string, string[]>();
    const orderItemIds = {
      first: randomUUID(),
      second: randomUUID(),
      third: randomUUID(),
    };
    const matchIds = {
      left1: randomUUID(),
      right1: randomUUID(),
      left2: randomUUID(),
      right2: randomUUID(),
      distractor: randomUUID(),
    };

    beforeAll(async () => {
      if (!liveConfig) return;

      admin = createClient<Database>(liveConfig.url, liveConfig.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      userA = createClient<Database>(liveConfig.url, liveConfig.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      userB = createClient<Database>(liveConfig.url, liveConfig.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const emailA = `v3-db-a-${stamp}@studyhub-test.local`;
      const emailB = `v3-db-b-${stamp}@studyhub-test.local`;

      const [resA, resB] = await Promise.all([
        admin.auth.admin.createUser({
          email: emailA,
          password: passA,
          email_confirm: true,
          user_metadata: { display_name: "V3 Live DB Auditor A" },
        }),
        admin.auth.admin.createUser({
          email: emailB,
          password: passB,
          email_confirm: true,
          user_metadata: { display_name: "V3 Live DB Auditor B" },
        }),
      ]);

      if (resA.error || !resA.data.user) {
        throw new Error(`Failed to provision userA: ${resA.error?.message}`);
      }
      if (resB.error || !resB.data.user) {
        throw new Error(`Failed to provision userB: ${resB.error?.message}`);
      }

      userAId = resA.data.user.id;
      userBId = resB.data.user.id;
      trackedUserIds.push(userAId, userBId);

      const [signA, signB] = await Promise.all([
        userA.auth.signInWithPassword({ email: emailA, password: passA }),
        userB.auth.signInWithPassword({ email: emailB, password: passB }),
      ]);

      if (signA.error) {
        throw new Error(`Failed to sign in userA: ${signA.error.message}`);
      }
      if (signB.error) {
        throw new Error(`Failed to sign in userB: ${signB.error.message}`);
      }
    }, 60_000);

    afterAll(async () => {
      if (!liveConfig || !admin || trackedUserIds.length === 0) return;

      // STRICT LIVE DATA PRESERVATION: delete ONLY rows owned by trackedUserIds!
      try {
        await userA?.auth.signOut().catch(() => {});
        await userB?.auth.signOut().catch(() => {});

        for (const uid of trackedUserIds) {
          await admin.from("coverage_cycles").delete().eq("user_id", uid);
          await admin.from("exam_presets").delete().eq("user_id", uid);
          await admin.from("exam_attempts").delete().eq("user_id", uid);
          await admin.from("study_sessions").delete().eq("user_id", uid);
          await admin.from("learning_sync_events").delete().eq("user_id", uid);
          await admin.from("learning_confidence_events").delete().eq("user_id", uid);
          await admin.from("learning_session_checkpoints").delete().eq("user_id", uid);
          await admin.from("user_question_notes").delete().eq("user_id", uid);
          await admin.from("question_reports").delete().eq("reporter_id", uid);
          await admin.from("user_question_progress").delete().eq("user_id", uid);
          await admin.from("starred_questions").delete().eq("user_id", uid);
          await admin.from("study_sets").delete().eq("owner_id", uid);
          await admin.from("media_assets").delete().eq("owner_id", uid);
          await admin.from("folders").delete().eq("owner_id", uid);
          await admin.from("tags").delete().eq("owner_id", uid);
        }
      } finally {
        for (const uid of trackedUserIds) {
          // Verify whether auth user still exists before deleting (Test 8 deletes userC itself)
          const { data: existing } = await admin.auth.admin.getUserById(uid);
          if (existing?.user) {
            const { error: delErr } = await admin.auth.admin.deleteUser(uid);
            if (delErr) {
              throw new Error(
                `CRITICAL TEARDOWN FAILURE: could not delete tracked user ${uid}: ${delErr.message}`,
              );
            }
          }
        }

        // Assert zero leftover rows strictly for our tracked test users (never blanket-checking real users!)
        const [
          leftoverProfiles,
          leftoverSets,
          leftoverMedia,
          leftoverAttempts,
          leftoverNotes,
          leftoverReports,
          leftoverCheckpoints,
          leftoverConf,
          leftoverSync,
        ] = await Promise.all([
          admin.from("profiles").select("id").in("id", trackedUserIds),
          admin.from("study_sets").select("id").in("owner_id", trackedUserIds),
          admin.from("media_assets").select("id").in("owner_id", trackedUserIds),
          admin.from("exam_attempts").select("id").in("user_id", trackedUserIds),
          admin.from("user_question_notes").select("id").in("user_id", trackedUserIds),
          admin.from("question_reports").select("id").in("reporter_id", trackedUserIds),
          admin.from("learning_session_checkpoints").select("id").in("user_id", trackedUserIds),
          admin.from("learning_confidence_events").select("id").in("user_id", trackedUserIds),
          admin.from("learning_sync_events").select("event_id").in("user_id", trackedUserIds),
        ]);

        const trackedRemaining =
          (leftoverProfiles.data?.length ?? 0) +
          (leftoverSets.data?.length ?? 0) +
          (leftoverMedia.data?.length ?? 0) +
          (leftoverAttempts.data?.length ?? 0) +
          (leftoverNotes.data?.length ?? 0) +
          (leftoverReports.data?.length ?? 0) +
          (leftoverCheckpoints.data?.length ?? 0) +
          (leftoverConf.data?.length ?? 0) +
          (leftoverSync.data?.length ?? 0);

        expect(trackedRemaining).toBe(0);
      }
    }, 90_000);

    it(
      "1. All 10 V3 tables, widened CHECK constraints, image-only prompt & image-only options work cleanly on PG 17.12",
      async () => {
        // Create V3 study set
        const { data: setRow, error: setErr } = await userA
          .from("study_sets")
          .insert({
            owner_id: userAId,
            title: `V3 Multimedia Bank ${stamp}`,
            subject: "Aviation V3",
            set_type: "mixed",
          })
          .select("*")
          .single();
        expect(setErr).toBeNull();
        expect(setRow?.content_version).toBe(1);
        v3SetId = setRow!.id;

        // 1a. media_assets: image (<=5MB) + audio (<=10MB) + CHECK rejections (SVG & oversized image)
        const basePath = `${userAId}/${v3SetId}`;
        const { data: imgAsset, error: imgErr } = await userA
          .from("media_assets")
          .insert({
            owner_id: userAId,
            study_set_id: v3SetId,
            kind: "image",
            storage_bucket: "study-media",
            storage_path: `${basePath}/prompt-${stamp}.png`,
            mime_type: "image/png",
            file_name: "prompt.png",
            size_bytes: 2048,
            sha256_hash: "a".repeat(64),
            width: 800,
            height: 600,
            alt_text: "Cockpit altimeter diagram",
          })
          .select("*")
          .single();
        expect(imgErr).toBeNull();
        imgMediaId = imgAsset!.id;

        const { data: optImgAsset, error: optImgErr } = await userA
          .from("media_assets")
          .insert({
            owner_id: userAId,
            study_set_id: v3SetId,
            kind: "image",
            storage_bucket: "study-media",
            storage_path: `${basePath}/opt-${stamp}.webp`,
            mime_type: "image/webp",
            file_name: "opt.webp",
            size_bytes: 1024,
            width: 300,
            height: 200,
          })
          .select("*")
          .single();
        expect(optImgErr).toBeNull();
        optImgMediaId = optImgAsset!.id;

        const { data: audAsset, error: audErr } = await userA
          .from("media_assets")
          .insert({
            owner_id: userAId,
            study_set_id: v3SetId,
            kind: "audio",
            storage_bucket: "study-media",
            storage_path: `${basePath}/listen-${stamp}.mp3`,
            mime_type: "audio/mpeg",
            file_name: "listen.mp3",
            size_bytes: 7_500_000, // >5MB valid for audio (<=10MB)
            duration_ms: 45_000,
          })
          .select("*")
          .single();
        expect(audErr).toBeNull();
        audioMediaId = audAsset!.id;

        const { data: dgmAsset, error: dgmMediaErr } = await userA
          .from("media_assets")
          .insert({
            owner_id: userAId,
            study_set_id: v3SetId,
            kind: "image",
            storage_bucket: "study-media",
            storage_path: `${basePath}/diagram-${stamp}.png`,
            mime_type: "image/png",
            file_name: "aircraft-diagram.png",
            size_bytes: 4096,
            width: 1200,
            height: 900,
          })
          .select("*")
          .single();
        expect(dgmMediaErr).toBeNull();
        diagramMediaId = dgmAsset!.id;

        // Negative DB CHECK checks: SVG rejected & >5MB image rejected
        const { error: svgErr } = await userA.from("media_assets").insert({
          owner_id: userAId,
          study_set_id: v3SetId,
          kind: "image",
          storage_bucket: "study-media",
          storage_path: `${basePath}/evil-${stamp}.svg`,
          mime_type: "image/svg+xml",
          file_name: "evil.svg",
          size_bytes: 512,
        });
        expect(svgErr).not.toBeNull();
        expect(svgErr?.code).toBe("23514");

        const { error: bigImgErr } = await userA.from("media_assets").insert({
          owner_id: userAId,
          study_set_id: v3SetId,
          kind: "image",
          storage_bucket: "study-media",
          storage_path: `${basePath}/huge-${stamp}.png`,
          mime_type: "image/png",
          file_name: "huge.png",
          size_bytes: 6_000_000, // > 5MB cap for images
        });
        expect(bigImgErr).not.toBeNull();
        expect(bigImgErr?.code).toBe("23514");

        // 1b. shared_passages
        const { data: passRow, error: passErr } = await userA
          .from("shared_passages")
          .insert({
            study_set_id: v3SetId,
            owner_id: userAId,
            title: "METAR Weather Briefing Passage",
            content_text:
              "METAR VVTS 120000Z 24012KT 9999 FEW020 31/24 Q1010 NOSIG",
            content_rich: makeRichDoc(
              "METAR VVTS 120000Z 24012KT 9999 FEW020 31/24 Q1010 NOSIG",
            ) as unknown as Json,
            audio_media_id: audioMediaId,
            transcript: "Tan Son Nhat weather briefing at zero zero zero zero Zulu.",
            source_reference: "ICAO Annex 3",
          })
          .select("*")
          .single();
        expect(passErr).toBeNull();
        passageId = passRow!.id;

        // 1c. diagram_sets & diagram_hotspots (point, rect, polygon)
        const { data: dgmRow, error: dgmErr } = await userA
          .from("diagram_sets")
          .insert({
            study_set_id: v3SetId,
            owner_id: userAId,
            title: "Boeing 787 Flight Control Surfaces",
            description: "Primary & secondary aerodynamic control surfaces",
            base_media_id: diagramMediaId,
            base_image_url: `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/diagram-${stamp}.png`)}&redirect=1`,
            image_width: 1200,
            image_height: 900,
          })
          .select("*")
          .single();
        expect(dgmErr).toBeNull();
        diagramId = dgmRow!.id;

        const { data: hotspots, error: hsErr } = await userA
          .from("diagram_hotspots")
          .insert([
            {
              diagram_id: diagramId,
              study_set_id: v3SetId,
              label: "Pitot Tube",
              accepted_alternatives: ["Pitot probe"],
              shape: "point",
              geometry: { shape: "point", x: 0.5, y: 0.5, radius: 0.05 },
              sort_order: 0,
            },
            {
              diagram_id: diagramId,
              study_set_id: v3SetId,
              label: "Left Aileron",
              accepted_alternatives: ["Aileron"],
              shape: "rect",
              geometry: {
                shape: "rect",
                x: 0.2,
                y: 0.2,
                width: 0.3,
                height: 0.3,
              },
              sort_order: 1,
            },
            {
              diagram_id: diagramId,
              study_set_id: v3SetId,
              label: "Vertical Stabilizer",
              accepted_alternatives: ["Tail fin"],
              shape: "polygon",
              geometry: {
                shape: "polygon",
                points: [
                  { x: 0.1, y: 0.1 },
                  { x: 0.9, y: 0.1 },
                  { x: 0.5, y: 0.9 },
                ],
              },
              sort_order: 2,
            },
          ])
          .select("*");
        expect(hsErr).toBeNull();
        expect(hotspots?.length).toBe(3);

        // 1d. Image-only question prompt & image-only answer option + negative empty CHECKs
        const { data: imgOnlyQ, error: imgOnlyQErr } = await userA
          .from("questions")
          .insert({
            study_set_id: v3SetId,
            question_type: "image_choice",
            position: 0,
            chapter: "Instruments",
            prompt: "", // Empty text prompt allowed when prompt_image_url is set!
            prompt_image_url: `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/prompt-${stamp}.png`)}&redirect=1`,
            type_payload: { type: "image_choice", selection_mode: "single" },
          })
          .select("*")
          .single();
        expect(imgOnlyQErr).toBeNull();
        expect(imgOnlyQ?.prompt).toBe("");

        // Negative: blank prompt with ZERO media columns MUST fail CHECK 23514
        const { error: emptyQErr } = await userA.from("questions").insert({
          study_set_id: v3SetId,
          question_type: "single_choice",
          position: 99,
          prompt: "   ",
        });
        expect(emptyQErr).not.toBeNull();
        expect(emptyQErr?.code).toBe("23514");

        // Image-only option (content = "", media_id populated) MUST succeed
        const { data: imgOnlyOpts, error: imgOnlyOptErr } = await userA
          .from("question_options")
          .insert([
            {
              question_id: imgOnlyQ!.id,
              study_set_id: v3SetId,
              position: 0,
              label: "A",
              content: "",
              media_id: optImgMediaId,
              image_url: `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/opt-${stamp}.webp`)}&redirect=1`,
              image_alt: "Correct gauge reading",
              is_correct: true,
            },
            {
              question_id: imgOnlyQ!.id,
              study_set_id: v3SetId,
              position: 1,
              label: "B",
              content: "",
              media_id: imgMediaId,
              image_url: `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/prompt-${stamp}.png`)}&redirect=1`,
              image_alt: "Wrong gauge reading",
              is_correct: false,
            },
          ])
          .select("*");
        expect(imgOnlyOptErr).toBeNull();
        expect(imgOnlyOpts?.length).toBe(2);
        qIds.image_choice = imgOnlyQ!.id;
        optCorrectByQ.set(imgOnlyQ!.id, [imgOnlyOpts![0].id]);
        optWrongByQ.set(imgOnlyQ!.id, [imgOnlyOpts![1].id]);

        // Negative: blank option with no image_url and no media_id MUST fail CHECK 23514
        const { error: emptyOptErr } = await userA
          .from("question_options")
          .insert({
            question_id: imgOnlyQ!.id,
            study_set_id: v3SetId,
            position: 2,
            label: "C",
            content: "  ",
            is_correct: false,
          });
        expect(emptyOptErr).not.toBeNull();
        expect(emptyOptErr?.code).toBe("23514");

        // 1e. content_media_relations on question, passage, diagram
        const { error: cmrErr } = await userA
          .from("content_media_relations")
          .insert([
            {
              media_id: imgMediaId,
              entity_type: "question",
              entity_id: imgOnlyQ!.id,
              role: "prompt",
              sort_order: 0,
            },
            {
              media_id: audioMediaId,
              entity_type: "shared_passage",
              entity_id: passageId,
              role: "audio",
              sort_order: 0,
            },
            {
              media_id: diagramMediaId,
              entity_type: "diagram_set",
              entity_id: diagramId,
              role: "diagram_base",
              sort_order: 0,
            },
          ]);
        expect(cmrErr).toBeNull();

        // 1f. Widened study_sessions.mode ('spell', 'diagram', 'custom_practice') & import_jobs.source_format ('pdf_text', 'docx_multimedia')
        for (const mode of ["spell", "diagram", "custom_practice"] as const) {
          const { error: sessErr } = await userA.from("study_sessions").insert({
            user_id: userAId,
            study_set_id: v3SetId,
            mode,
            total_items: 1,
          });
          expect(sessErr).toBeNull();
        }

        for (const fmt of ["pdf_text", "docx_multimedia"] as const) {
          const { error: impErr } = await userA.from("import_jobs").insert({
            user_id: userAId,
            study_set_id: v3SetId,
            source_format: fmt,
            file_name: `test.${fmt === "pdf_text" ? "pdf" : "docx"}`,
            file_size_bytes: 1024,
            status: "completed",
            total_detected: 1,
            valid_count: 1,
          });
          expect(impErr).toBeNull();
        }

        // 1g. user_question_notes (strict private RLS), question_reports (viewer insert, owner resolve, viewer cannot resolve),
        //     learning_session_checkpoints, learning_confidence_events, learning_sync_events (direct insert blocked!)
        const { error: shareErr } = await admin.from("study_set_members").insert({
          study_set_id: v3SetId,
          user_id: userBId,
          role: "viewer",
          allow_clone: true,
        });
        expect(shareErr).toBeNull();

        const { data: noteA, error: noteAErr } = await userA
          .from("user_question_notes")
          .insert({
            user_id: userAId,
            study_set_id: v3SetId,
            question_id: imgOnlyQ!.id,
            content_text: "Owner private mnemonic for altimeter",
            content_rich: makeRichDoc("Owner private mnemonic") as unknown as Json,
          })
          .select("*")
          .single();
        expect(noteAErr).toBeNull();
        expect(noteA?.version).toBe(1);

        // User B (viewer on shared set) MUST see 0 rows in user_question_notes!
        const { data: bSeesNotes, error: bNoteErr } = await userB
          .from("user_question_notes")
          .select("*")
          .eq("question_id", imgOnlyQ!.id);
        expect(bNoteErr).toBeNull();
        expect(bSeesNotes).toEqual([]);

        // User B submits a question report; User B cannot resolve it; User A resolves it
        const { data: repB, error: repBErr } = await userB
          .from("question_reports")
          .insert({
            study_set_id: v3SetId,
            question_id: imgOnlyQ!.id,
            reporter_id: userBId,
            category: "missing_media",
            description: "Diagram scale label looks blurry on mobile.",
          })
          .select("*")
          .single();
        expect(repBErr).toBeNull();
        expect(repB?.status).toBe("open");

        const { data: bResolveAttempt } = await userB
          .from("question_reports")
          .update({ status: "resolved", resolved_by: userBId })
          .eq("id", repB!.id)
          .select("*");
        expect(bResolveAttempt ?? []).toHaveLength(0);

        const { data: aResolved, error: aResErr } = await userA
          .from("question_reports")
          .update({
            status: "resolved",
            resolved_by: userAId,
            resolution_note: "Uploaded higher-resolution PNG.",
          })
          .eq("id", repB!.id)
          .select("*")
          .single();
        expect(aResErr).toBeNull();
        expect(aResolved?.status).toBe("resolved");

        // Checkpoint & confidence event insert
        const { data: cpRow, error: cpErr } = await userA
          .from("learning_session_checkpoints")
          .insert({
            user_id: userAId,
            study_set_id: v3SetId,
            mode: "spell",
            session_key: `spell:${v3SetId}`,
            state_json: { index: 0, queue: [imgOnlyQ!.id] },
            progress_percent: 25,
            current_index: 0,
            total_items: 4,
          })
          .select("*")
          .single();
        expect(cpErr).toBeNull();
        expect(cpRow?.mode).toBe("spell");

        const { error: confErr } = await userA
          .from("learning_confidence_events")
          .insert({
            user_id: userAId,
            study_set_id: v3SetId,
            question_id: imgOnlyQ!.id,
            mode: "spell",
            confidence: "certain",
            is_correct: true,
            hint_used: false,
            response_time_ms: 1450,
          });
        expect(confErr).toBeNull();

        // Direct INSERT into learning_sync_events must be blocked by RLS (RPC-only writes!)
        const { error: directSyncErr } = await userA
          .from("learning_sync_events")
          .insert({
            event_id: randomUUID(),
            user_id: userAId,
            event_type: "star",
            client_timestamp: new Date().toISOString(),
          });
        expect(directSyncErr).not.toBeNull();
        expect(directSyncErr?.code).toBe("42501");

        // Clean up temporary share before next tests (will re-share in Tests 6 & 7)
        await admin
          .from("study_set_members")
          .delete()
          .eq("study_set_id", v3SetId)
          .eq("user_id", userBId);
      },
      45_000,
    );

    it(
      "2. All 12 exam-compatible V3 question types: pre-submit anti-leak, column REVOKE 42501, immutability & live server grading",
      async () => {
        const basePath = `${userAId}/${v3SetId}`;
        const audioProxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/listen-${stamp}.mp3`)}&redirect=1`;
        const diagramProxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(`${basePath}/diagram-${stamp}.png`)}&redirect=1`;

        // Seed remaining 11 exam-compatible question types + numerical & hotspot edge cases into v3SetId
        const questionSpecs: Array<{
          key: string;
          row: Database["public"]["Tables"]["questions"]["Insert"];
          options?: Array<{ content: string; is_correct: boolean }>;
          accepted?: Array<{
            answer_text: string;
            normalized_answer: string;
            match_mode: "exact" | "case_insensitive" | "ignore_diacritics";
          }>;
        }> = [
          {
            key: "single_choice",
            row: {
              study_set_id: v3SetId,
              question_type: "single_choice",
              position: 1,
              chapter: "Ch1-Core",
              prompt: "Standard sea-level pressure in hPa?",
              prompt_rich: makeRichDoc(
                "Standard sea-level pressure in hPa?",
              ) as unknown as Json,
              explanation: "ISA sea-level pressure is 1013.25 hPa.",
              explanation_rich: makeRichDoc(
                "ISA sea-level pressure is 1013.25 hPa.",
              ) as unknown as Json,
            },
            options: [
              { content: "1013.25 hPa", is_correct: true },
              { content: "990.00 hPa", is_correct: false },
            ],
          },
          {
            key: "multiple_choice",
            row: {
              study_set_id: v3SetId,
              question_type: "multiple_choice",
              position: 2,
              chapter: "Ch1-Core",
              prompt: "Select all primary flight controls:",
            },
            options: [
              { content: "Ailerons", is_correct: true },
              { content: "Elevator", is_correct: true },
              { content: "Flaps", is_correct: false },
            ],
          },
          {
            key: "true_false",
            row: {
              study_set_id: v3SetId,
              question_type: "true_false",
              position: 3,
              chapter: "Ch1-Core",
              prompt: "Air density decreases with increasing altitude.",
            },
            options: [
              { content: "True", is_correct: true },
              { content: "False", is_correct: false },
            ],
          },
          {
            key: "short_answer",
            row: {
              study_set_id: v3SetId,
              question_type: "short_answer",
              position: 4,
              chapter: "Ch1-Core",
              prompt: "Thủ đô của Việt Nam là gì?",
            },
            accepted: [
              {
                answer_text: "Hà Nội",
                normalized_answer: "ha noi",
                match_mode: "ignore_diacritics",
              },
            ],
          },
          {
            key: "fill_in_blank",
            row: {
              study_set_id: v3SetId,
              question_type: "fill_in_blank",
              position: 5,
              chapter: "Ch2-V3",
              prompt: "Complete the Bernoulli law blanks:",
              type_payload: {
                type: "fill_in_blank",
                template_text: "As velocity {{b1}}, static pressure {{b2}}.",
                require_all_blanks: true,
                blanks: [
                  {
                    blank_id: "b1",
                    accepted_answers: ["increases", "rises"],
                    match_mode: "case_insensitive",
                    hint: "goes up",
                  },
                  {
                    blank_id: "b2",
                    accepted_answers: ["DECREASES"],
                    case_sensitive: true,
                    hint: "UPPERCASE",
                  },
                ],
              },
            },
          },
          {
            key: "num_zero",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 6,
              chapter: "Ch2-V3",
              prompt: "Freezing point of water in Celsius?",
              type_payload: { type: "numerical", correct_value: 0 },
            },
          },
          {
            key: "num_ten",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 7,
              chapter: "Ch2-V3",
              prompt: "Value of 2 * 5?",
              type_payload: { type: "numerical", correct_value: 10 },
            },
          },
          {
            key: "num_hundred",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 8,
              chapter: "Ch2-V3",
              prompt: "Boiling point of water in Celsius?",
              type_payload: { type: "numerical", correct_value: 100 },
            },
          },
          {
            key: "num_neg_tol",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 9,
              chapter: "Ch2-V3",
              prompt: "Compute -1/2 within +/- 0.05 tolerance:",
              type_payload: {
                type: "numerical",
                correct_value: -0.5,
                abs_tolerance: 0.05,
              },
            },
          },
          {
            key: "num_unit_ok",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 10,
              chapter: "Ch2-V3",
              prompt: "Wind speed in knots (accepted unit):",
              type_payload: {
                type: "numerical",
                correct_value: 25,
                unit: "kt",
                accepted_units: ["kts", "knots"],
                unit_required: true,
              },
            },
          },
          {
            key: "num_unit_wrong",
            row: {
              study_set_id: v3SetId,
              question_type: "numerical",
              position: 11,
              chapter: "Ch2-V3",
              prompt: "Wind speed in knots (tested with wrong unit):",
              type_payload: {
                type: "numerical",
                correct_value: 25,
                unit: "kt",
                accepted_units: ["kts", "knots"],
                unit_required: true,
              },
            },
          },
          {
            key: "ordering",
            row: {
              study_set_id: v3SetId,
              question_type: "ordering",
              position: 12,
              chapter: "Ch2-V3",
              prompt: "Order the flight phases chronologically:",
              type_payload: {
                type: "ordering",
                allow_partial_credit: false,
                items: [
                  {
                    id: orderItemIds.third,
                    text: "Landing",
                    correct_position: 2,
                  },
                  {
                    id: orderItemIds.first,
                    text: "Takeoff",
                    correct_position: 0,
                  },
                  {
                    id: orderItemIds.second,
                    text: "Cruise",
                    correct_position: 1,
                  },
                ],
              },
            },
          },
          {
            key: "matching",
            row: {
              study_set_id: v3SetId,
              question_type: "matching",
              position: 13,
              chapter: "Ch2-V3",
              prompt: "Match each instrument to its pressure source:",
              type_payload: {
                type: "matching",
                pairs: [
                  {
                    id: matchIds.left1,
                    left_text: "Altimeter",
                    right_id: matchIds.right1,
                    right_text: "Static Port",
                  },
                  {
                    id: matchIds.left2,
                    left_text: "VSI",
                    right_id: matchIds.right2,
                    right_text: "Static Port", // Duplicate right label disambiguated by right_id!
                  },
                ],
                distractors: [
                  {
                    right_id: matchIds.distractor,
                    right_text: "Pitot Only",
                  },
                ],
              },
            },
          },
          {
            key: "hotspot_point",
            row: {
              study_set_id: v3SetId,
              question_type: "image_hotspot",
              position: 14,
              chapter: "Ch3-Media",
              prompt: "Tap the Pitot Tube (point hotspot):",
              diagram_id: diagramId,
              type_payload: {
                type: "image_hotspot",
                diagram_id: diagramId,
                image_url: diagramProxyUrl,
                image_media_id: diagramMediaId,
                require_all_targets: false,
                target_hotspots: [
                  {
                    id: "hs-pt",
                    label: "Pitot Tube",
                    shape: "point",
                    geometry: { shape: "point", x: 0.5, y: 0.5, radius: 0.05 },
                  },
                ],
              },
            },
          },
          {
            key: "hotspot_rect",
            row: {
              study_set_id: v3SetId,
              question_type: "image_hotspot",
              position: 15,
              chapter: "Ch3-Media",
              prompt: "Tap the Left Aileron (rect hotspot):",
              diagram_id: diagramId,
              type_payload: {
                type: "image_hotspot",
                diagram_id: diagramId,
                image_url: diagramProxyUrl,
                image_media_id: diagramMediaId,
                require_all_targets: false,
                target_hotspots: [
                  {
                    id: "hs-rect",
                    label: "Left Aileron",
                    shape: "rect",
                    geometry: {
                      shape: "rect",
                      x: 0.2,
                      y: 0.2,
                      width: 0.3,
                      height: 0.3,
                    },
                  },
                ],
              },
            },
          },
          {
            key: "hotspot_polygon_miss",
            row: {
              study_set_id: v3SetId,
              question_type: "image_hotspot",
              position: 16,
              chapter: "Ch3-Media",
              prompt: "Tap inside the Vertical Stabilizer triangle (polygon):",
              diagram_id: diagramId,
              type_payload: {
                type: "image_hotspot",
                diagram_id: diagramId,
                image_url: diagramProxyUrl,
                image_media_id: diagramMediaId,
                require_all_targets: false,
                target_hotspots: [
                  {
                    id: "hs-poly",
                    label: "Vertical Stabilizer",
                    shape: "polygon",
                    geometry: {
                      shape: "polygon",
                      points: [
                        { x: 0.1, y: 0.1 },
                        { x: 0.9, y: 0.1 },
                        { x: 0.5, y: 0.9 },
                      ],
                    },
                  },
                ],
              },
            },
          },
          {
            key: "reading_passage",
            row: {
              study_set_id: v3SetId,
              question_type: "reading_passage",
              position: 17,
              chapter: "Ch3-Media",
              prompt: "What is the wind direction in the METAR passage?",
              passage_id: passageId,
              type_payload: {
                type: "reading_passage",
                passage_id: passageId,
                passage_title: "METAR Weather Briefing Passage",
                passage_text:
                  "METAR VVTS 120000Z 24012KT 9999 FEW020 31/24 Q1010 NOSIG",
                sub_answer_kind: "single_choice",
              },
            },
            options: [
              { content: "240 degrees", is_correct: true },
              { content: "120 degrees", is_correct: false },
            ],
          },
          {
            key: "listening",
            row: {
              study_set_id: v3SetId,
              question_type: "listening",
              position: 18,
              chapter: "Ch3-Media",
              prompt: "", // Audio-only prompt!
              audio_media_id: audioMediaId,
              audio_url: audioProxyUrl,
              audio_transcript: "SECRET_TRANSCRIPT_999",
              type_payload: {
                type: "listening",
                audio_media_id: audioMediaId,
                audio_url: audioProxyUrl,
                transcript: "SECRET_TRANSCRIPT_999",
                show_transcript_after_submit: true,
                max_replays: 2,
                language: "en-US",
                sub_answer_kind: "short_answer",
              },
            },
            accepted: [
              {
                answer_text: "Cleared for takeoff",
                normalized_answer: "cleared for takeoff",
                match_mode: "case_insensitive",
              },
            ],
          },
        ];

        for (const spec of questionSpecs) {
          const { data: qRow, error: qErr } = await userA
            .from("questions")
            .insert(spec.row)
            .select("id")
            .single();
          expect(qErr, `insert failed for ${spec.key}`).toBeNull();
          qIds[spec.key] = qRow!.id;

          if (spec.options && spec.options.length > 0) {
            const { data: opts, error: optErr } = await userA
              .from("question_options")
              .insert(
                spec.options.map((o, idx) => ({
                  question_id: qRow!.id,
                  study_set_id: v3SetId,
                  position: idx,
                  label: String.fromCharCode(65 + idx),
                  content: o.content,
                  is_correct: o.is_correct,
                })),
              )
              .select("id, is_correct");
            expect(optErr, `options failed for ${spec.key}`).toBeNull();
            optCorrectByQ.set(
              qRow!.id,
              (opts ?? []).filter((o) => o.is_correct).map((o) => o.id),
            );
            optWrongByQ.set(
              qRow!.id,
              (opts ?? []).filter((o) => !o.is_correct).map((o) => o.id),
            );
          }

          if (spec.accepted && spec.accepted.length > 0) {
            const { error: accErr } = await userA
              .from("question_accepted_answers")
              .insert(
                spec.accepted.map((a) => ({
                  question_id: qRow!.id,
                  study_set_id: v3SetId,
                  answer_text: a.answer_text,
                  normalized_answer: a.normalized_answer,
                  match_mode: a.match_mode,
                })),
              );
            expect(accErr, `accepted failed for ${spec.key}`).toBeNull();
          }
        }

        const allQuestionKeys = [
          "image_choice",
          ...questionSpecs.map((s) => s.key),
        ];
        expect(allQuestionKeys.length).toBe(19);

        // Shuffle image_choice option order deliberately to prove UUID grading
        const imgOptCorrect = optCorrectByQ.get(qIds.image_choice)![0];
        const imgOptWrong = optWrongByQ.get(qIds.image_choice)![0];

        const { data: created, error: createErr } = await rpcCreateExamAttemptV2(
          userA,
          {
            p_title_snapshot: "V3 12-Type Comprehensive Exam",
            p_primary_study_set_id: v3SetId,
            p_sources: [
              {
                source_type: "study_set",
                study_set_id: v3SetId,
                subject_title_snapshot: `V3 Multimedia Bank ${stamp}`,
                eligible_count: 19,
                allocated_count: 19,
              },
            ],
            p_selected_items: allQuestionKeys.map((k) => ({
              question_id: qIds[k],
              ...(k === "image_choice"
                ? { option_ids_order: [imgOptWrong, imgOptCorrect] }
                : {}),
            })),
            p_config: { v3_audit: true },
            p_duration_limit_seconds: 1800,
            p_pass_threshold: 70,
          },
        );
        expect(createErr).toBeNull();
        expect(created).not.toBeNull();
        expect(created!.questions.length).toBe(19);

        const attemptId = created!.attempt.id;

        // 2a. PRE-SUBMIT ANTI-LEAK CHECK on create_exam_attempt_v2 & get_exam_attempt_detail
        const verifyPreSubmitSanitized = (qs: ExamSnapshotQuestion[]) => {
          const serialized = JSON.stringify(qs);
          expect(serialized).not.toContain("SECRET_TRANSCRIPT_999");
          expect(serialized).not.toContain("correct_option_ids");
          expect(serialized).not.toContain("accepted_answers_snapshot");
          expect(serialized).not.toContain("explanation_snapshot");
          expect(serialized).not.toContain("explanation_rich_snapshot");
          expect(serialized).not.toContain("correct_value");
          expect(serialized).not.toContain("correct_position");
          expect(serialized).not.toContain("target_hotspots");

          const byQid = new Map(qs.map((q) => [q.question_id, q]));
          const fibPayload = byQid.get(qIds.fill_in_blank)
            ?.type_payload_snapshot as unknown as Record<string, unknown>;
          expect(JSON.stringify(fibPayload)).not.toContain("increases");
          expect(JSON.stringify(fibPayload)).not.toContain("DECREASES");

          const matchPayload = byQid.get(qIds.matching)
            ?.type_payload_snapshot as unknown as Record<string, unknown>;
          expect(matchPayload).toHaveProperty("left_items");
          expect(matchPayload).toHaveProperty("right_items");
          expect(matchPayload).not.toHaveProperty("pairs");

          const hsPayload = byQid.get(qIds.hotspot_point)
            ?.type_payload_snapshot as unknown as Record<string, unknown>;
          expect(hsPayload).toHaveProperty("target_labels");
          expect(hsPayload).not.toHaveProperty("target_hotspots");

          const listenPayload = byQid.get(qIds.listening)
            ?.type_payload_snapshot as unknown as Record<string, unknown>;
          expect(listenPayload?.transcript).toBeNull();
        };

        verifyPreSubmitSanitized(created!.questions);

        const { data: detailPre, error: detailPreErr } =
          await rpcGetExamAttemptDetail(userA, attemptId);
        expect(detailPreErr).toBeNull();
        verifyPreSubmitSanitized(detailPre!.questions);

        // 2b. DIRECT POSTGREST COLUMN-LEVEL ANTI-LEAK (42501 on secret V3 snapshot columns!)
        const { error: colLeakErr1 } = await userA
          .from("exam_attempt_questions")
          .select("id, type_payload_snapshot")
          .eq("attempt_id", attemptId);
        expect(colLeakErr1).not.toBeNull();
        expect(colLeakErr1?.code).toBe("42501");

        const { error: colLeakErr2 } = await userA
          .from("exam_attempt_questions")
          .select("id, explanation_rich_snapshot")
          .eq("attempt_id", attemptId);
        expect(colLeakErr2).not.toBeNull();
        expect(colLeakErr2?.code).toBe("42501");

        // Safe pre-submit V3 columns ARE selectable by authenticated owner
        const { data: safeCols, error: safeColErr } = await userA
          .from("exam_attempt_questions")
          .select(
            "id, prompt_rich_snapshot, audio_media_id_snapshot, audio_url_snapshot, passage_snapshot, diagram_snapshot, media_snapshot",
          )
          .eq("attempt_id", attemptId);
        expect(safeColErr).toBeNull();
        expect(safeCols?.length).toBe(19);

        // 2c. IMMUTABILITY TRIGGER prevent_exam_snapshot_update() freezes V3 snapshot columns!
        const firstAqId = created!.questions[0].id;
        const { error: mutErr } = await admin
          .from("exam_attempt_questions")
          .update({
            prompt_rich_snapshot: makeRichDoc("TAMPERED") as unknown as Json,
          } as unknown as never)
          .eq("id", firstAqId);
        expect(mutErr).not.toBeNull();
        expect(mutErr?.message).toContain("immutable");

        // 2d. SAVE ANSWERS FOR ALL 19 QUESTIONS (17 expected correct, 2 intentional wrong)
        const aqByQid = new Map(created!.questions.map((q) => [q.question_id!, q.id]));

        const answersPayload: Array<{
          attempt_question_id: string;
          selected_option_ids: string[];
          typed_answer?: string | null;
          structured_response?: StructuredAnswerResponse | null;
          confidence?: "certain" | "unsure" | "guessing" | null;
          hint_used?: boolean;
          client_seq?: number;
        }> = [
          {
            attempt_question_id: aqByQid.get(qIds.image_choice)!,
            selected_option_ids: [imgOptCorrect],
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.single_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.single_choice)!,
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.multiple_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.multiple_choice)!,
            confidence: "unsure",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.true_false)!,
            selected_option_ids: optCorrectByQ.get(qIds.true_false)!,
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.short_answer)!,
            selected_option_ids: [],
            typed_answer: "ha noi",
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.fill_in_blank)!,
            selected_option_ids: [],
            structured_response: {
              kind: "blanks",
              answers: { b1: "RISES", b2: "DECREASES" },
            },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.num_zero)!,
            selected_option_ids: [],
            structured_response: { kind: "numerical", value: "0", numeric_value: 0 },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.num_ten)!,
            selected_option_ids: [],
            structured_response: { kind: "numerical", value: "10" },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.num_hundred)!,
            selected_option_ids: [],
            structured_response: { kind: "numerical", value: "100" },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.num_neg_tol)!,
            selected_option_ids: [],
            structured_response: { kind: "numerical", value: "-0.48" },
            confidence: "unsure",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.num_unit_ok)!,
            selected_option_ids: [],
            structured_response: {
              kind: "numerical",
              value: "25",
              unit: "knots",
            },
            confidence: "certain",
            client_seq: 1,
          },
          // Intentional WRONG #1: dimensionally wrong unit ("km/h" vs "kt")
          {
            attempt_question_id: aqByQid.get(qIds.num_unit_wrong)!,
            selected_option_ids: [],
            structured_response: {
              kind: "numerical",
              value: "25",
              unit: "km/h",
            },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.ordering)!,
            selected_option_ids: [],
            structured_response: {
              kind: "ordering",
              ordered_item_ids: [
                orderItemIds.first,
                orderItemIds.second,
                orderItemIds.third,
              ],
            },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.matching)!,
            selected_option_ids: [],
            structured_response: {
              kind: "matching",
              pairs: {
                [matchIds.left1]: matchIds.right1,
                [matchIds.left2]: matchIds.right2,
              },
            },
            confidence: "guessing",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.hotspot_point)!,
            selected_option_ids: [],
            structured_response: {
              kind: "hotspot",
              clicks: [{ x: 0.52, y: 0.51 }], // distance ~0.022 <= 0.05 -> HIT
            },
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.hotspot_rect)!,
            selected_option_ids: [],
            structured_response: {
              kind: "hotspot",
              clicks: [{ x: 0.35, y: 0.35 }], // inside [0.2, 0.5] x [0.2, 0.5] -> HIT
            },
            confidence: "certain",
            client_seq: 1,
          },
          // Intentional WRONG #2: outside polygon triangle
          {
            attempt_question_id: aqByQid.get(qIds.hotspot_polygon_miss)!,
            selected_option_ids: [],
            structured_response: {
              kind: "hotspot",
              clicks: [{ x: 0.1, y: 0.85 }], // outside triangle -> MISS
            },
            confidence: "unsure",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.reading_passage)!,
            selected_option_ids: optCorrectByQ.get(qIds.reading_passage)!,
            confidence: "certain",
            client_seq: 1,
          },
          {
            attempt_question_id: aqByQid.get(qIds.listening)!,
            selected_option_ids: [],
            typed_answer: "cleared for takeoff",
            confidence: "certain",
            client_seq: 1,
          },
        ];

        const { data: saveRes, error: saveErr } = await rpcSaveExamAttemptAnswers(
          userA,
          attemptId,
          answersPayload,
        );
        expect(saveErr).toBeNull();
        expect(saveRes?.answered_count).toBe(19);
        expect(saveRes?.stale_ignored_ids).toEqual([]);

        // 2e. SUBMIT & VERIFY EXACT 12-TYPE SERVER GRADING + POST-SUBMIT REVEAL + IDEMPOTENCY
        const { data: submitted, error: subErr } = await rpcSubmitExamAttempt(
          userA,
          attemptId,
        );
        expect(subErr).toBeNull();
        expect(submitted).not.toBeNull();
        expect(submitted!.attempt.status).toBe("submitted");
        expect(submitted!.attempt.answered_count).toBe(19);
        expect(submitted!.attempt.correct_count).toBe(17);
        expect(submitted!.attempt.wrong_count).toBe(2);
        expect(Number(submitted!.attempt.score_percent)).toBe(89.47);
        expect(submitted!.attempt.passed).toBe(true);

        const ansByAq = new Map(
          submitted!.answers.map((a) => [a.attempt_question_id, a]),
        );
        expect(ansByAq.get(aqByQid.get(qIds.num_unit_ok)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.num_unit_wrong)!)?.is_correct).toBe(false);
        expect(ansByAq.get(aqByQid.get(qIds.hotspot_point)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.hotspot_rect)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.hotspot_polygon_miss)!)?.is_correct).toBe(false);
        expect(ansByAq.get(aqByQid.get(qIds.image_choice)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.ordering)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.matching)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.fill_in_blank)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.reading_passage)!)?.is_correct).toBe(true);
        expect(ansByAq.get(aqByQid.get(qIds.listening)!)?.is_correct).toBe(true);

        // Post-submit reveals listening transcript & explanations
        const listenPost = submitted!.questions.find(
          (q) => q.question_id === qIds.listening,
        );
        expect(
          (listenPost?.type_payload_snapshot as unknown as Record<string, unknown>)
            ?.transcript,
        ).toBe("SECRET_TRANSCRIPT_999");

        // Verify confidence telemetry recorded for all 19 exam answers
        const { count: confBeforeIdem } = await userA
          .from("learning_confidence_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userAId)
          .eq("mode", "exam");
        expect(confBeforeIdem).toBe(19);

        // Idempotent second submit must return identical score & NOT duplicate confidence events
        const { data: submitted2, error: subErr2 } = await rpcSubmitExamAttempt(
          userA,
          attemptId,
        );
        expect(subErr2).toBeNull();
        expect(Number(submitted2!.attempt.score_percent)).toBe(89.47);
        const { count: confAfterIdem } = await userA
          .from("learning_confidence_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userAId)
          .eq("mode", "exam");
        expect(confAfterIdem).toBe(19);
      },
      60_000,
    );

    it(
      "3. P0 Confidence Exam Score Neutrality + Confidence SM-2 Mastery Guard live verification",
      async () => {
        const fourQIds = [
          qIds.single_choice,
          qIds.multiple_choice,
          qIds.true_false,
          qIds.image_choice,
        ];

        // Exam A: confidence disabled (all null) — 2 right, 2 wrong -> 50.00%
        const { data: ex1, error: ex1Err } = await rpcCreateExamAttemptV2(userA, {
          p_title_snapshot: "Confidence Neutrality Baseline",
          p_primary_study_set_id: v3SetId,
          p_sources: [],
          p_selected_items: fourQIds.map((id) => ({ question_id: id })),
          p_config: {},
          p_duration_limit_seconds: null,
          p_pass_threshold: 70,
        });
        expect(ex1Err).toBeNull();
        const map1 = new Map(ex1!.questions.map((q) => [q.question_id!, q.id]));

        await rpcSaveExamAttemptAnswers(userA, ex1!.attempt.id, [
          {
            attempt_question_id: map1.get(qIds.single_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.single_choice)!,
            confidence: null,
          },
          {
            attempt_question_id: map1.get(qIds.multiple_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.multiple_choice)!,
            confidence: null,
          },
          {
            attempt_question_id: map1.get(qIds.true_false)!,
            selected_option_ids: optWrongByQ.get(qIds.true_false)!,
            confidence: null,
          },
          {
            attempt_question_id: map1.get(qIds.image_choice)!,
            selected_option_ids: optWrongByQ.get(qIds.image_choice)!,
            confidence: null,
          },
        ]);
        const { data: res1 } = await rpcSubmitExamAttempt(userA, ex1!.attempt.id);

        // Exam B: exact same 2 right + 2 wrong, tagged guessing / unsure / certain / guessing
        const { data: ex2, error: ex2Err } = await rpcCreateExamAttemptV2(userA, {
          p_title_snapshot: "Confidence Neutrality Tagged",
          p_primary_study_set_id: v3SetId,
          p_sources: [],
          p_selected_items: fourQIds.map((id) => ({ question_id: id })),
          p_config: {},
          p_duration_limit_seconds: null,
          p_pass_threshold: 70,
        });
        expect(ex2Err).toBeNull();
        const map2 = new Map(ex2!.questions.map((q) => [q.question_id!, q.id]));

        await rpcSaveExamAttemptAnswers(userA, ex2!.attempt.id, [
          {
            attempt_question_id: map2.get(qIds.single_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.single_choice)!,
            confidence: "guessing",
          },
          {
            attempt_question_id: map2.get(qIds.multiple_choice)!,
            selected_option_ids: optCorrectByQ.get(qIds.multiple_choice)!,
            confidence: "unsure",
          },
          {
            attempt_question_id: map2.get(qIds.true_false)!,
            selected_option_ids: optWrongByQ.get(qIds.true_false)!,
            confidence: "certain",
          },
          {
            attempt_question_id: map2.get(qIds.image_choice)!,
            selected_option_ids: optWrongByQ.get(qIds.image_choice)!,
            confidence: "guessing",
          },
        ]);
        const { data: res2 } = await rpcSubmitExamAttempt(userA, ex2!.attempt.id);

        // P0 INVARIANT: Confidence NEVER changes exam score or pass/fail!
        expect(Number(res1!.attempt.score_percent)).toBe(50);
        expect(Number(res2!.attempt.score_percent)).toBe(50);
        expect(res1!.attempt.correct_count).toBe(res2!.attempt.correct_count);
        expect(res1!.attempt.wrong_count).toBe(res2!.attempt.wrong_count);
        expect(res1!.attempt.passed).toBe(res2!.attempt.passed);

        // Check telemetry counters updated on user_question_progress
        const { data: progGuess } = await userA
          .from("user_question_progress")
          .select("guess_correct_count, low_confidence_count")
          .eq("user_id", userAId)
          .eq("question_id", qIds.single_choice)
          .single();
        expect(progGuess!.guess_correct_count).toBeGreaterThanOrEqual(1);

        const { data: progMisconception } = await userA
          .from("user_question_progress")
          .select("high_conf_wrong_count")
          .eq("user_id", userAId)
          .eq("question_id", qIds.true_false)
          .single();
        expect(progMisconception!.high_conf_wrong_count).toBeGreaterThanOrEqual(1);

        // AUDIT CHECK: Guessing-correct MUST NOT promote familiar (streak=2, interval=6) -> mastered!
        await admin.from("user_question_progress").upsert(
          {
            user_id: userAId,
            study_set_id: v3SetId,
            question_id: qIds.num_zero,
            mastery_level: "familiar",
            correct_count: 2,
            wrong_count: 0,
            consecutive_correct: 2,
            consecutive_wrong: 0,
            ease_factor: 2.5,
            interval_days: 6,
            repetitions: 2,
            mistake_status: "resolved",
            progress_generation: 1,
          },
          { onConflict: "user_id,question_id" },
        );

        const { data: syncGuessRes, error: syncGuessErr } =
          await rpcSyncOfflineLearningEvents(userA, [
            {
              event_id: randomUUID(),
              event_type: "answer",
              study_set_id: v3SetId,
              question_id: qIds.num_zero,
              client_timestamp: new Date().toISOString(),
              progress_generation: 1,
              payload: {
                is_correct: true,
                confidence: "guessing",
                hint_used: false,
                mode: "practice",
              },
            },
          ]);
        expect(syncGuessErr).toBeNull();
        expect(syncGuessRes?.results[0]?.status).toBe("applied");

        const { data: afterGuess } = await userA
          .from("user_question_progress")
          .select("mastery_level, interval_days, guess_correct_count, independent_recall_count")
          .eq("user_id", userAId)
          .eq("question_id", qIds.num_zero)
          .single();
        expect(afterGuess?.guess_correct_count).toBeGreaterThanOrEqual(1);
        // Spec §15/§20 (V3-DB-03): `correct + guessing` MUST NOT advance to `mastered` & caps interval_days = 1!
        expect(afterGuess?.mastery_level).not.toBe("mastered");
        expect(afterGuess?.interval_days).toBe(1);
      },
      45_000,
    );

    it(
      "4. clone_study_set() V3 clones passages, diagrams, hotspots, rich text, payloads & media relations independently",
      async () => {
        const { data: cloned, error: cloneErr } = await rpcCloneStudySet(userA, {
          p_source_set_id: v3SetId,
          p_title: `V3 Cloned Set ${stamp}`,
        });
        expect(cloneErr).toBeNull();
        expect(cloned).not.toBeNull();
        expect(cloned!.copied_questions).toBe(19);

        const clonedSetId = cloned!.study_set.id;
        expect(clonedSetId).not.toBe(v3SetId);

        const [
          { data: clonedPassages },
          { data: clonedDiagrams },
          { data: clonedHotspots },
          { data: clonedQuestions },
        ] = await Promise.all([
          userA.from("shared_passages").select("*").eq("study_set_id", clonedSetId),
          userA.from("diagram_sets").select("*").eq("study_set_id", clonedSetId),
          userA.from("diagram_hotspots").select("*").eq("study_set_id", clonedSetId),
          userA.from("questions").select("*").eq("study_set_id", clonedSetId),
        ]);

        expect(clonedPassages?.length).toBe(1);
        expect(clonedPassages![0].id).not.toBe(passageId);
        expect(clonedPassages![0].audio_media_id).toBe(audioMediaId);

        expect(clonedDiagrams?.length).toBe(1);
        expect(clonedDiagrams![0].id).not.toBe(diagramId);
        expect(clonedDiagrams![0].base_media_id).toBe(diagramMediaId);

        expect(clonedHotspots?.length).toBe(3);
        expect(
          clonedHotspots!.every((h) => h.diagram_id === clonedDiagrams![0].id),
        ).toBe(true);

        expect(clonedQuestions?.length).toBe(19);
        const clonedReading = clonedQuestions!.find(
          (q) => q.question_type === "reading_passage",
        );
        expect(clonedReading?.passage_id).toBe(clonedPassages![0].id);
        expect(
          (clonedReading?.type_payload as Record<string, unknown> | null)
            ?.passage_id,
        ).toBe(clonedPassages![0].id);

        const clonedHotspotQ = clonedQuestions!.find(
          (q) => q.question_type === "image_hotspot",
        );
        expect(clonedHotspotQ?.diagram_id).toBe(clonedDiagrams![0].id);
        expect(
          (clonedHotspotQ?.type_payload as Record<string, unknown> | null)
            ?.diagram_id,
        ).toBe(clonedDiagrams![0].id);

        const clonedSingle = clonedQuestions!.find(
          (q) => q.question_type === "single_choice",
        );
        expect(clonedSingle?.prompt_rich).not.toBeNull();
        expect(clonedSingle?.explanation_rich).not.toBeNull();

        // Cloned content_media_relations exist for cloned question, passage, and diagram
        const clonedImgChoice = clonedQuestions!.find(
          (q) => q.question_type === "image_choice",
        );
        const { data: clonedRels } = await userA
          .from("content_media_relations")
          .select("entity_type, entity_id, media_id")
          .in("entity_id", [
            clonedImgChoice!.id,
            clonedPassages![0].id,
            clonedDiagrams![0].id,
          ]);
        expect(clonedRels?.length).toBe(3);
      },
      45_000,
    );

    it(
      "5. reset_learning_progress() across scopes (question, chapter, mode, study_set, subject, all) bumps progress_generation & preserves exam_attempts",
      async () => {
        // Seed a second set with a distinct subject so subject & all scopes are independently verifiable
        const { data: physSet, error: physErr } = await userA
          .from("study_sets")
          .insert({
            owner_id: userAId,
            title: `Physics Set ${stamp}`,
            subject: `Physics-${stamp}`,
            set_type: "mixed",
          })
          .select("id")
          .single();
        expect(physErr).toBeNull();

        const { data: physQ } = await userA
          .from("questions")
          .insert({
            study_set_id: physSet!.id,
            question_type: "short_answer",
            position: 0,
            chapter: "Kinematics",
            prompt: "SI unit of force?",
          })
          .select("id")
          .single();

        // Seed progress + starred + checkpoints across both sets
        await admin.from("user_question_progress").upsert(
          [
            {
              user_id: userAId,
              study_set_id: v3SetId,
              question_id: qIds.single_choice,
              mastery_level: "familiar",
              correct_count: 2,
              wrong_count: 1,
            },
            {
              user_id: userAId,
              study_set_id: v3SetId,
              question_id: qIds.fill_in_blank,
              mastery_level: "learning",
              correct_count: 1,
              wrong_count: 1,
            },
            {
              user_id: userAId,
              study_set_id: physSet!.id,
              question_id: physQ!.id,
              mastery_level: "familiar",
              correct_count: 2,
              wrong_count: 0,
            },
          ],
          { onConflict: "user_id,question_id" },
        );

        await userA.from("starred_questions").upsert(
          [
            {
              user_id: userAId,
              study_set_id: v3SetId,
              question_id: qIds.single_choice,
            },
            {
              user_id: userAId,
              study_set_id: physSet!.id,
              question_id: physQ!.id,
            },
          ],
          { onConflict: "user_id,question_id" },
        );

        await userA.from("learning_session_checkpoints").upsert(
          [
            {
              user_id: userAId,
              study_set_id: v3SetId,
              mode: "learn",
              session_key: `learn:${v3SetId}`,
              progress_percent: 40,
              current_index: 2,
              total_items: 5,
            },
            {
              user_id: userAId,
              study_set_id: v3SetId,
              mode: "spell",
              session_key: `spell:${v3SetId}`,
              progress_percent: 50,
              current_index: 1,
              total_items: 2,
            },
            {
              user_id: userAId,
              study_set_id: physSet!.id,
              mode: "practice",
              session_key: `practice:${physSet!.id}`,
              progress_percent: 30,
              current_index: 0,
              total_items: 1,
            },
          ],
          { onConflict: "user_id,session_key" },
        );

        const { count: examCountBefore } = await userA
          .from("exam_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userAId);
        expect(examCountBefore).toBeGreaterThanOrEqual(3);

        // 5a. question scope
        const { data: rQ, error: rQErr } = await rpcResetLearningProgress(userA, {
          scope: "question",
          question_ids: [qIds.single_choice],
          clear_mistakes: true,
          clear_starred: false,
        });
        expect(rQErr).toBeNull();
        expect(rQ!.reset_progress_count).toBe(1);
        expect(rQ!.new_progress_generation).toBeGreaterThanOrEqual(2);
        const genAfterQ = rQ!.new_progress_generation;

        // 5b. chapter scope (Ch2-V3)
        const { data: rCh, error: rChErr } = await rpcResetLearningProgress(
          userA,
          {
            scope: "chapter",
            study_set_id: v3SetId,
            chapter: "Ch2-V3",
            clear_mistakes: true,
          },
        );
        expect(rChErr).toBeNull();
        expect(rCh!.reset_progress_count).toBeGreaterThanOrEqual(1);
        expect(rCh!.new_progress_generation).toBe(genAfterQ + 1);

        // 5c. mode scope (spell only — must preserve learn checkpoint!)
        const { data: rMode, error: rModeErr } = await rpcResetLearningProgress(
          userA,
          {
            scope: "mode",
            study_set_id: v3SetId,
            mode: "spell",
            clear_checkpoints: true,
          },
        );
        expect(rModeErr).toBeNull();
        expect(rMode!.cleared_checkpoints_count).toBe(1);
        expect(rMode!.new_progress_generation).toBe(genAfterQ + 2);

        const { data: learnCpStill } = await userA
          .from("learning_session_checkpoints")
          .select("id")
          .eq("session_key", `learn:${v3SetId}`)
          .maybeSingle();
        expect(learnCpStill).not.toBeNull();

        // 5d. study_set scope (clear_starred = true)
        const { data: rSet, error: rSetErr } = await rpcResetLearningProgress(
          userA,
          {
            scope: "study_set",
            study_set_id: v3SetId,
            clear_mistakes: true,
            clear_starred: true,
            clear_checkpoints: true,
          },
        );
        expect(rSetErr).toBeNull();
        expect(rSet!.cleared_checkpoints_count).toBeGreaterThanOrEqual(1);
        expect(rSet!.cleared_starred_count).toBeGreaterThanOrEqual(1);
        expect(rSet!.new_progress_generation).toBe(genAfterQ + 3);

        // 5e. subject scope (Physics)
        const { data: rSubj, error: rSubjErr } = await rpcResetLearningProgress(
          userA,
          {
            scope: "subject",
            subject: `Physics-${stamp}`,
            clear_mistakes: true,
            clear_checkpoints: true,
          },
        );
        expect(rSubjErr).toBeNull();
        expect(rSubj!.reset_progress_count).toBe(1);
        expect(rSubj!.cleared_checkpoints_count).toBe(1);
        expect(rSubj!.new_progress_generation).toBe(genAfterQ + 4);

        // 5f. all scope — MUST strictly preserve exam_attempts, study_sets, questions, notes!
        const { data: rAll, error: rAllErr } = await rpcResetLearningProgress(
          userA,
          {
            scope: "all",
            clear_mistakes: true,
            clear_starred: true,
            clear_checkpoints: true,
          },
        );
        expect(rAllErr).toBeNull();
        expect(rAll!.new_progress_generation).toBe(genAfterQ + 5);

        const [
          { count: examCountAfter },
          { count: qCountAfter },
          { count: noteCountAfter },
        ] = await Promise.all([
          userA
            .from("exam_attempts")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userAId),
          userA
            .from("questions")
            .select("id", { count: "exact", head: true })
            .eq("study_set_id", v3SetId),
          userA
            .from("user_question_notes")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userAId),
        ]);

        expect(examCountAfter).toBe(examCountBefore);
        expect(qCountAfter).toBe(19);
        expect(noteCountAfter).toBeGreaterThanOrEqual(1);
      },
      45_000,
    );

    it(
      "6. global_library_search() indexes all 8 entity types, paginates cleanly, escapes LIKE wildcards & isolates private notes",
      async () => {
        const token = `v3srch${randomUUID().replace(/-/g, "").slice(0, 10)}`;
        const privateNoteSecret = `secretNote${randomUUID().replace(/-/g, "").slice(0, 10)}`;

        // Seed all 8 searchable entity types containing `token`
        const { data: folder } = await userA
          .from("folders")
          .insert({
            owner_id: userAId,
            name: `Folder ${token}`,
            description: "Search audit folder",
          })
          .select("id")
          .single();
        expect(folder).not.toBeNull();

        const { data: srchSet } = await userA
          .from("study_sets")
          .insert({
            owner_id: userAId,
            folder_id: folder!.id,
            title: `Set ${token}`,
            subject: "Search Audit",
            set_type: "mixed",
          })
          .select("id")
          .single();
        expect(srchSet).not.toBeNull();

        const { data: srchQ } = await userA
          .from("questions")
          .insert({
            study_set_id: srchSet!.id,
            question_type: "single_choice",
            position: 0,
            chapter: `Chapter ${token}`,
            prompt: `Question prompt ${token}`,
          })
          .select("id")
          .single();
        expect(srchQ).not.toBeNull();

        await userA.from("question_options").insert({
          question_id: srchQ!.id,
          study_set_id: srchSet!.id,
          position: 0,
          label: "A",
          content: `Option body ${token}`,
          is_correct: true,
        });

        await userA.from("tags").insert({
          owner_id: userAId,
          name: `Tag ${token}`,
          slug: `tag-${token.toLowerCase()}`,
        });

        await userA.from("user_question_notes").insert({
          user_id: userAId,
          study_set_id: srchSet!.id,
          question_id: srchQ!.id,
          content_text: `My personal note ${token} ${privateNoteSecret}`,
        });

        await userA.from("diagram_sets").insert({
          study_set_id: srchSet!.id,
          owner_id: userAId,
          title: `Diagram ${token}`,
          base_image_url: `/api/uploads/signed-url?path=${encodeURIComponent(`${userAId}/${srchSet!.id}/d.png`)}&redirect=1`,
        });

        // 6a. Search all 8 types
        const { data: fullRes, error: fullErr } = await rpcGlobalLibrarySearch(
          userA,
          { query: token, limit: 30, offset: 0 },
        );
        expect(fullErr).toBeNull();
        expect(fullRes!.total).toBe(8);
        for (const t of [
          "folder",
          "study_set",
          "question",
          "option",
          "tag",
          "chapter",
          "note",
          "diagram",
        ] as const) {
          expect(fullRes!.counts_by_type[t], `missing type ${t}`).toBe(1);
        }

        // 6b. Bounded pagination (limit=3, offset=0 vs offset=3 -> disjoint)
        const [{ data: page1 }, { data: page2 }] = await Promise.all([
          rpcGlobalLibrarySearch(userA, { query: token, limit: 3, offset: 0 }),
          rpcGlobalLibrarySearch(userA, { query: token, limit: 3, offset: 3 }),
        ]);
        expect(page1!.items.length).toBe(3);
        expect(page2!.items.length).toBe(3);
        const page1Keys = new Set(
          page1!.items.map((i) => `${i.result_type}:${i.id}`),
        );
        for (const item of page2!.items) {
          expect(page1Keys.has(`${item.result_type}:${item.id}`)).toBe(false);
        }

        // 6c. LIKE metacharacter escaping (`%%%` must NOT match everything!)
        const { data: wildcardRes, error: wildcardErr } =
          await rpcGlobalLibrarySearch(userA, { query: "%%%", limit: 10 });
        expect(wildcardErr).toBeNull();
        expect(wildcardRes!.total).toBe(0);

        // 6d. Cross-user private note isolation in global_library_search!
        await admin.from("study_set_members").insert({
          study_set_id: srchSet!.id,
          user_id: userBId,
          role: "viewer",
          allow_clone: false,
        });

        const { data: bNoteSearch, error: bNoteSearchErr } =
          await rpcGlobalLibrarySearch(userB, { query: privateNoteSecret });
        expect(bNoteSearchErr).toBeNull();
        expect(bNoteSearch!.total).toBe(0);
        expect(bNoteSearch!.items).toEqual([]);
      },
      45_000,
    );

    it(
      "7. sync_offline_learning_events() enforces idempotency, stale-reset guard, revocation, deletion & lossless note conflict",
      async () => {
        // Read userA's current progress_generation (already bumped in Test 5)
        const { data: prefRow } = await userA
          .from("user_preferences")
          .select("progress_generation")
          .eq("user_id", userAId)
          .single();
        const curGen = prefRow!.progress_generation;
        expect(curGen).toBeGreaterThanOrEqual(2);

        const evAnswerId = randomUUID();
        const evStarId = randomUUID();
        const evCpId = randomUUID();
        const evNoteCreateId = randomUUID();
        const nowIso = new Date().toISOString();

        // 7a. Initial batch applied cleanly
        const { data: batch1, error: b1Err } =
          await rpcSyncOfflineLearningEvents(userA, [
            {
              event_id: evAnswerId,
              event_type: "answer",
              study_set_id: v3SetId,
              question_id: qIds.true_false,
              client_timestamp: nowIso,
              progress_generation: curGen,
              payload: {
                is_correct: true,
                confidence: "certain",
                hint_used: false,
                mode: "practice",
              },
            },
            {
              event_id: evStarId,
              event_type: "star",
              study_set_id: v3SetId,
              question_id: qIds.true_false,
              client_timestamp: nowIso,
              progress_generation: curGen,
              payload: { starred: true },
            },
            {
              event_id: evCpId,
              event_type: "checkpoint_upsert",
              study_set_id: v3SetId,
              client_timestamp: nowIso,
              progress_generation: curGen,
              payload: {
                session_key: `offline-sync:${v3SetId}`,
                mode: "flashcards",
                state_json: { index: 3 },
                progress_percent: 60,
                current_index: 3,
                total_items: 5,
              },
            },
            {
              event_id: evNoteCreateId,
              event_type: "note_upsert",
              study_set_id: v3SetId,
              question_id: qIds.true_false,
              client_timestamp: nowIso,
              progress_generation: curGen,
              payload: { content_text: "Offline note v1" },
            },
          ]);
        expect(b1Err).toBeNull();
        expect(batch1!.results.map((r) => r.status)).toEqual([
          "applied",
          "applied",
          "applied",
          "applied",
        ]);
        expect(batch1!.results[3].server_version).toBe(1);

        // 7b. Exact replay by userA -> duplicate_ignored (zero double increment!)
        const { data: progBeforeReplay } = await userA
          .from("user_question_progress")
          .select("correct_count")
          .eq("user_id", userAId)
          .eq("question_id", qIds.true_false)
          .single();

        const { data: replayRes } = await rpcSyncOfflineLearningEvents(userA, [
          {
            event_id: evAnswerId,
            event_type: "answer",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: curGen,
            payload: { is_correct: true, mode: "practice" },
          },
        ]);
        expect(replayRes!.results[0].status).toBe("duplicate_ignored");

        const { data: progAfterReplay } = await userA
          .from("user_question_progress")
          .select("correct_count")
          .eq("user_id", userAId)
          .eq("question_id", qIds.true_false)
          .single();
        expect(progAfterReplay!.correct_count).toBe(
          progBeforeReplay!.correct_count,
        );

        // 7c. Cross-user event_id replay by userB -> 'invalid' (zero oracle!)
        const { data: bReplay } = await rpcSyncOfflineLearningEvents(userB, [
          {
            event_id: evAnswerId,
            event_type: "answer",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: 1,
            payload: { is_correct: true },
          },
        ]);
        expect(bReplay!.results[0].status).toBe("invalid");

        // 7d. ignored_stale_reset (progress_generation < current generation)
        const { data: resetRes } = await rpcResetLearningProgress(userA, {
          scope: "question",
          question_ids: [qIds.true_false],
          clear_mistakes: true,
        });
        const newGen = resetRes!.new_progress_generation;
        expect(newGen).toBe(curGen + 1);

        const { data: staleRes } = await rpcSyncOfflineLearningEvents(userA, [
          {
            event_id: randomUUID(),
            event_type: "answer",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: curGen, // Stale! Predates reset
            payload: { is_correct: true, mode: "practice" },
          },
          {
            event_id: randomUUID(),
            event_type: "checkpoint_upsert",
            study_set_id: v3SetId,
            client_timestamp: nowIso,
            progress_generation: curGen, // Stale checkpoint! Predates reset (V3-DB-05)
            payload: {
              session_key: `stale-cp:${v3SetId}`,
              mode: "practice",
              state_json: { index: 1 },
              progress_percent: 20,
              current_index: 1,
              total_items: 5,
            },
          },
        ]);
        expect(staleRes!.results[0].status).toBe("ignored_stale_reset");
        expect(staleRes!.results[1].status).toBe("ignored_stale_reset");

        const { data: resurrectedProg } = await userA
          .from("user_question_progress")
          .select("id")
          .eq("user_id", userAId)
          .eq("question_id", qIds.true_false)
          .maybeSingle();
        expect(resurrectedProg).toBeNull();

        // 7e. Lossless note conflict (online v2 vs offline stale base_version=1 -> returns server_data & does NOT poison retry!)
        const { data: noteV2, error: noteV2Err } = await userA
          .from("user_question_notes")
          .update({ content_text: "Server edited v2", version: 2 })
          .eq("user_id", userAId)
          .eq("question_id", qIds.true_false)
          .select("*")
          .single();
        expect(noteV2Err).toBeNull();
        expect(noteV2!.version).toBe(2);

        const conflictEventId = randomUUID();
        const { data: conflictRes } = await rpcSyncOfflineLearningEvents(userA, [
          {
            event_id: conflictEventId,
            event_type: "note_upsert",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: newGen,
            base_version: 1, // Stale! Server is at v2
            payload: { content_text: "Offline conflicting edit" },
          },
        ]);
        expect(conflictRes!.results[0].status).toBe("conflict");
        expect(conflictRes!.results[0].server_version).toBe(2);
        expect(
          (conflictRes!.results[0].server_data as Record<string, unknown>)
            ?.content_text,
        ).toBe("Server edited v2");

        // Retrying the SAME conflictEventId after merging with base_version=2 MUST succeed!
        const { data: resolvedRes } = await rpcSyncOfflineLearningEvents(userA, [
          {
            event_id: conflictEventId,
            event_type: "note_upsert",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: newGen,
            base_version: 2,
            payload: { content_text: "Merged v2 + offline edit" },
          },
        ]);
        expect(resolvedRes!.results[0].status).toBe("applied");
        expect(resolvedRes!.results[0].server_version).toBe(3);

        // 7f. rejected_revoked (userB had access, then share is revoked)
        await admin.from("study_set_members").insert({
          study_set_id: v3SetId,
          user_id: userBId,
          role: "viewer",
          allow_clone: false,
        });
        await admin
          .from("study_set_members")
          .delete()
          .eq("study_set_id", v3SetId)
          .eq("user_id", userBId);

        const { data: revokedRes } = await rpcSyncOfflineLearningEvents(userB, [
          {
            event_id: randomUUID(),
            event_type: "answer",
            study_set_id: v3SetId,
            question_id: qIds.true_false,
            client_timestamp: nowIso,
            progress_generation: 1,
            payload: { is_correct: true, mode: "practice" },
          },
        ]);
        expect(revokedRes!.results[0].status).toBe("rejected_revoked");

        // 7g. rejected_deleted (deleted question & deleted study set)
        const { data: tempQ } = await userA
          .from("questions")
          .insert({
            study_set_id: v3SetId,
            question_type: "short_answer",
            position: 99,
            prompt: "Temp question to delete",
          })
          .select("id")
          .single();
        await userA.from("questions").delete().eq("id", tempQ!.id);

        const { data: delRes } = await rpcSyncOfflineLearningEvents(userA, [
          {
            event_id: randomUUID(),
            event_type: "answer",
            study_set_id: v3SetId,
            question_id: tempQ!.id,
            client_timestamp: nowIso,
            progress_generation: newGen,
            payload: { is_correct: true, mode: "practice" },
          },
          {
            event_id: randomUUID(),
            event_type: "answer",
            study_set_id: randomUUID(), // Non-existent set
            question_id: randomUUID(),
            client_timestamp: nowIso,
            progress_generation: newGen,
            payload: { is_correct: true, mode: "practice" },
          },
        ]);
        expect(delRes!.results[0].status).toBe("rejected_deleted");
        expect(delRes!.results[1].status).toBe("rejected_deleted");
      },
      45_000,
    );

    it(
      "8. content_media_relations ON DELETE RESTRICT protects exam snapshots & polymorphic triggers clean up on exam delete + account delete",
      async () => {
        // Provision disposable User C solely to verify live auth.users -> profiles cascade with exam-referenced media!
        const emailC = `v3-db-c-${stamp}@studyhub-test.local`;
        const passC = `StudyHub!V3C_${randomUUID().slice(0, 12)}`;
        const { data: createdC, error: errC } =
          await admin.auth.admin.createUser({
            email: emailC,
            password: passC,
            email_confirm: true,
            user_metadata: { display_name: "V3 Live DB Auditor C" },
          });
        expect(errC).toBeNull();
        const userCId = createdC!.user!.id;
        trackedUserIds.push(userCId);

        const userC = createClient<Database>(
          liveConfig!.url,
          liveConfig!.publishableKey,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { error: signCErr } = await userC.auth.signInWithPassword({
          email: emailC,
          password: passC,
        });
        expect(signCErr).toBeNull();

        const { data: setC } = await userC
          .from("study_sets")
          .insert({
            owner_id: userCId,
            title: `Media Restrict Set ${stamp}`,
            set_type: "mixed",
          })
          .select("id")
          .single();

        // Create 2 media assets: mediaExam1 (deleted via exam delete) & mediaExam2 (deleted via account delete)
        const { data: media1 } = await userC
          .from("media_assets")
          .insert({
            owner_id: userCId,
            study_set_id: setC!.id,
            kind: "image",
            storage_bucket: "study-media",
            storage_path: `${userCId}/${setC!.id}/m1-${stamp}.png`,
            mime_type: "image/png",
            file_name: "m1.png",
            size_bytes: 1024,
          })
          .select("id")
          .single();

        const { data: media2 } = await userC
          .from("media_assets")
          .insert({
            owner_id: userCId,
            study_set_id: setC!.id,
            kind: "image",
            storage_bucket: "study-media",
            storage_path: `${userCId}/${setC!.id}/m2-${stamp}.png`,
            mime_type: "image/png",
            file_name: "m2.png",
            size_bytes: 1024,
          })
          .select("id")
          .single();

        const { data: q1 } = await userC
          .from("questions")
          .insert({
            study_set_id: setC!.id,
            question_type: "single_choice",
            position: 0,
            prompt: "Protected media Q1",
          })
          .select("id")
          .single();

        const { data: q2 } = await userC
          .from("questions")
          .insert({
            study_set_id: setC!.id,
            question_type: "single_choice",
            position: 1,
            prompt: "Protected media Q2",
          })
          .select("id")
          .single();

        await userC.from("content_media_relations").insert([
          {
            media_id: media1!.id,
            entity_type: "question",
            entity_id: q1!.id,
            role: "prompt",
          },
          {
            media_id: media2!.id,
            entity_type: "question",
            entity_id: q2!.id,
            role: "prompt",
          },
        ]);

        // Create 2 separate exams capturing exam_attempt_question media relations
        const { data: exam1 } = await rpcCreateExamAttemptV2(userC, {
          p_title_snapshot: "Restrict Test Exam 1",
          p_primary_study_set_id: setC!.id,
          p_sources: [],
          p_selected_items: [{ question_id: q1!.id }],
          p_config: {},
          p_duration_limit_seconds: null,
          p_pass_threshold: 70,
        });
        const { data: exam2 } = await rpcCreateExamAttemptV2(userC, {
          p_title_snapshot: "Restrict Test Exam 2",
          p_primary_study_set_id: setC!.id,
          p_sources: [],
          p_selected_items: [{ question_id: q2!.id }],
          p_config: {},
          p_duration_limit_seconds: null,
          p_pass_threshold: 70,
        });
        expect(exam1).not.toBeNull();
        expect(exam2).not.toBeNull();

        // Delete source question q1 -> trigger cleans up 'question' relation, but 'exam_attempt_question' relation STILL PROTECTS media1!
        const { error: delQ1Err } = await userC
          .from("questions")
          .delete()
          .eq("id", q1!.id);
        expect(delQ1Err).toBeNull();

        const { error: restrictErr } = await userC
          .from("media_assets")
          .delete()
          .eq("id", media1!.id);
        expect(restrictErr).not.toBeNull();
        expect(restrictErr?.code).toBe("23503");

        // Now delete exam1 -> trigger trg_cleanup_media_rel_exam_q removes snapshot relation -> media1 deletion now SUCCEEDS!
        const { error: delExam1Err } = await admin
          .from("exam_attempts")
          .delete()
          .eq("id", exam1!.attempt.id);
        expect(delExam1Err).toBeNull();

        const { error: delMedia1AfterErr } = await userC
          .from("media_assets")
          .delete()
          .eq("id", media1!.id);
        expect(delMedia1AfterErr).toBeNull();

        // Finally: delete User C account directly WHILE exam2 still references media2 ->
        // trg_cleanup_media_rel_profile MUST allow clean account deletion with ZERO 23503 error!
        await userC.auth.signOut().catch(() => {});
        const { error: delUserCErr } = await admin.auth.admin.deleteUser(userCId);
        expect(delUserCErr).toBeNull();

        const { data: leftoverC } = await admin
          .from("media_assets")
          .select("id")
          .eq("owner_id", userCId);
        expect(leftoverC).toEqual([]);
      },
      60_000,
    );
  },
);
