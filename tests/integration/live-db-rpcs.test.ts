// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  rpcCloneStudySet,
  rpcCreateCoverageCycle,
  rpcCreateExamAttemptV2,
  rpcDiscardCoverageCycleActiveExam,
  rpcGetCoverageCycleSubjectProgress,
  rpcGetExamAttemptDetail,
  rpcGetExamEligiblePool,
  rpcGetMyProfile,
  rpcGetPracticeQuestionPool,
  rpcIssueCoverageCycleNextExam,
  rpcResolveDedupedStudySets,
  rpcRestartCoverageCycle,
  rpcSaveExamAttemptAnswers,
  rpcSubmitExamAttempt,
} from "@/lib/supabase/rpc";
import type { Database } from "@/types/database";

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
 * Loads `.env.local` into memory WITHOUT ever printing or logging any key/secret.
 * Returns null if live Supabase credentials are unavailable so offline runs skip cleanly.
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

describe.skipIf(!liveConfig)(
  "Live Supabase Cloud PostgreSQL 17.12 — Triggers, Constraints & V2.0/V2.1 RPCs",
  () => {
    let admin: SupabaseClient<Database>;
    let userClient: SupabaseClient<Database>;
    let userId = "";
    let testEmail = "";
    const testPassword = `StudyHub!Db_${randomUUID().slice(0, 12)}`;

    // Shared fixtures created across tests and fully cleaned up in afterAll
    let parentFolderId = "";
    let childFolderId = "";
    let setAId = "";
    let setBId = "";
    let setCovAId = "";
    let setCovBId = "";

    // Track exact seeded question IDs & option keys for deterministic assertions
    const setAMcqSingleId = randomUUID();
    const setAMcqMultiId = randomUUID();
    const setATfId = randomUUID();
    const setAShortNumZeroId = randomUUID();
    const setAShortNumTenId = randomUUID();
    const setAShortNumHundredId = randomUUID();
    const setAShortNumDecimalId = randomUUID();
    const setAShortViId = randomUUID();
    const setAFlashcardId = randomUUID();
    const setBMcqId = randomUUID();
    const setBShortCaseId = randomUUID();

    const optCorrectByQuestion = new Map<string, string[]>();
    const optWrongByQuestion = new Map<string, string[]>();
    let covAQuestionIds: string[] = [];
    let covBQuestionIds: string[] = [];

    beforeAll(async () => {
      if (!liveConfig) return;

      admin = createClient<Database>(liveConfig.url, liveConfig.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      userClient = createClient<Database>(
        liveConfig.url,
        liveConfig.publishableKey,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        },
      );

      const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
      testEmail = `v21-db-${stamp}@studyhub-test.local`;

      const { data: createdUser, error: createErr } =
        await admin.auth.admin.createUser({
          email: testEmail,
          password: testPassword,
          email_confirm: true,
          user_metadata: { display_name: "V2.1 Live DB Auditor" },
        });

      if (createErr || !createdUser.user) {
        throw new Error(
          `Failed to provision disposable test user: ${createErr?.message ?? "unknown"}`,
        );
      }

      userId = createdUser.user.id;

      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

      if (signInErr) {
        throw new Error(
          `Failed to sign in disposable test user: ${signInErr.message}`,
        );
      }
    }, 60_000);

    afterAll(async () => {
      if (!liveConfig || !admin || !userId) return;

      try {
        await admin.from("coverage_cycles").delete().eq("user_id", userId);
        await admin.from("exam_presets").delete().eq("user_id", userId);
        await admin.from("exam_attempts").delete().eq("user_id", userId);
        await admin.from("study_sessions").delete().eq("user_id", userId);
        await admin
          .from("user_question_progress")
          .delete()
          .eq("user_id", userId);
        await admin.from("starred_questions").delete().eq("user_id", userId);
        await admin.from("study_sets").delete().eq("owner_id", userId);
        await admin.from("folders").delete().eq("owner_id", userId);
        await admin.from("tags").delete().eq("owner_id", userId);
      } finally {
        await userClient?.auth.signOut().catch(() => {});
        const { error: delErr } = await admin.auth.admin.deleteUser(userId);
        if (delErr) {
          throw new Error(
            `CRITICAL TEARDOWN FAILURE: could not delete disposable user ${userId}: ${delErr.message}`,
          );
        }
        const { data: leftoverProfile } = await admin
          .from("profiles")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        expect(leftoverProfile).toBeNull();
      }
    }, 60_000);

    it(
      "1. handle_new_user() trigger creates profiles + user_preferences and get_my_profile() returns caller email",
      async () => {
        const { data: myProfile, error: profErr } =
          await rpcGetMyProfile(userClient);
        expect(profErr).toBeNull();
        expect(myProfile).not.toBeNull();
        expect(myProfile?.id).toBe(userId);
        expect(myProfile?.email).toBe(testEmail);
        expect(myProfile?.display_name).toBe("V2.1 Live DB Auditor");

        const { data: prefs, error: prefErr } = await userClient
          .from("user_preferences")
          .select("*")
          .eq("user_id", userId)
          .single();

        expect(prefErr).toBeNull();
        expect(prefs?.user_id).toBe(userId);
        expect(prefs?.language).toBe("vi");
        expect(prefs?.daily_goal).toBe(20);
      },
      30_000,
    );

    it(
      "2. Statement-level trg_sync_study_set_question_count_ins/_del stays exact across 500-row batch insert & delete",
      async () => {
        const { data: countSet, error: setErr } = await userClient
          .from("study_sets")
          .insert({
            owner_id: userId,
            title: "Live Trigger 500Q Count Test",
            set_type: "multiple_choice",
            visibility: "private",
          })
          .select("*")
          .single();

        expect(setErr).toBeNull();
        expect(countSet?.question_count).toBe(0);

        const batch500 = Array.from({ length: 500 }, (_, i) => ({
          study_set_id: countSet!.id,
          question_type: "single_choice" as const,
          position: i,
          prompt: `Batch count test question #${i + 1}`,
          difficulty: "medium" as const,
        }));

        const { error: insErr } = await userClient
          .from("questions")
          .insert(batch500);
        expect(insErr).toBeNull();

        const { data: afterInsert } = await userClient
          .from("study_sets")
          .select("question_count")
          .eq("id", countSet!.id)
          .single();
        expect(afterInsert?.question_count).toBe(500);

        // Batch-delete 200 questions in a single statement
        const { error: del200Err } = await userClient
          .from("questions")
          .delete()
          .eq("study_set_id", countSet!.id)
          .gte("position", 300);
        expect(del200Err).toBeNull();

        const { data: afterDel200 } = await userClient
          .from("study_sets")
          .select("question_count")
          .eq("id", countSet!.id)
          .single();
        expect(afterDel200?.question_count).toBe(300);

        // Delete remaining 300 questions in a single statement
        const { error: del300Err } = await userClient
          .from("questions")
          .delete()
          .eq("study_set_id", countSet!.id);
        expect(del300Err).toBeNull();

        const { data: afterDelAll } = await userClient
          .from("study_sets")
          .select("question_count")
          .eq("id", countSet!.id)
          .single();
        expect(afterDelAll?.question_count).toBe(0);

        // Cleanup helper set
        await userClient.from("study_sets").delete().eq("id", countSet!.id);
      },
      45_000,
    );

    it(
      "3. normalize_short_answer() LIVE on PG 17.12 preserves numeric 0/10/100/1.5 and Vietnamese + bracket regex (SH-007 & W3-DB-1)",
      async () => {
        const callNorm = async (p_input: string, p_mode: string) => {
          const { data, error } = await (
            admin.rpc as unknown as (
              fn: string,
              args: Record<string, unknown>,
            ) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>
          )("normalize_short_answer", { p_input, p_mode });
          expect(error, `normalize_short_answer(${p_input}, ${p_mode})`).toBeNull();
          return data;
        };

        expect(await callNorm("0", "numeric")).toBe("0");
        expect(await callNorm("0.00", "numeric")).toBe("0");
        expect(await callNorm("-0", "numeric")).toBe("0");
        expect(await callNorm("10", "numeric")).toBe("10");
        expect(await callNorm("100.00", "numeric")).toBe("100");
        expect(await callNorm("1,50", "numeric")).toBe("1.5");
        expect(await callNorm("Hà Nội, Việt Nam!", "ignore_diacritics")).toBe(
          "ha noi viet nam",
        );
        expect(await callNorm("  [Đáp án]: {A}! ", "ignore_diacritics")).toBe(
          "dap an a",
        );
        expect(await callNorm('  "[Hello World!]"  ', "case_insensitive")).toBe(
          "hello world",
        );
        expect(await callNorm("  Exact   Case  ", "exact")).toBe("Exact Case");
      },
      30_000,
    );

    it(
      "4. resolve_deduped_study_sets & get_exam_eligible_pool deduplicate folder+set overlap and retain chapter/tag facets (W3-DB-7)",
      async () => {
        // Seed nested folders + 2 rich sets (Set A in parentFolder, Set B in childFolder)
        const { data: parentFolder, error: pfErr } = await userClient
          .from("folders")
          .insert({
            owner_id: userId,
            name: "Live DB Parent Folder",
          })
          .select("*")
          .single();
        expect(pfErr).toBeNull();
        parentFolderId = parentFolder!.id;

        const { data: childFolder, error: cfErr } = await userClient
          .from("folders")
          .insert({
            owner_id: userId,
            parent_id: parentFolderId,
            name: "Live DB Child Folder",
          })
          .select("*")
          .single();
        expect(cfErr).toBeNull();
        childFolderId = childFolder!.id;

        // Also test multi-hop folder cycle guard trigger (P2-2)
        const { error: cycleErr } = await userClient
          .from("folders")
          .update({ parent_id: childFolderId })
          .eq("id", parentFolderId);
        expect(cycleErr).not.toBeNull();
        expect(cycleErr?.code).toBe("22023");

        const { data: createdSets, error: setsErr } = await userClient
          .from("study_sets")
          .insert([
            {
              owner_id: userId,
              folder_id: parentFolderId,
              title: "Subject A — Physics",
              subject: "Physics",
              set_type: "mixed",
              visibility: "private",
            },
            {
              owner_id: userId,
              folder_id: childFolderId,
              title: "Subject B — Chemistry",
              subject: "Chemistry",
              set_type: "mixed",
              visibility: "private",
            },
          ])
          .select("*")
          .order("title", { ascending: true });
        expect(setsErr).toBeNull();
        setAId = createdSets![0].id;
        setBId = createdSets![1].id;

        // Insert rich questions (deliberately including duplicate position=1 in Set A to also test clone_study_set!)
        const { error: qInsErr } = await userClient.from("questions").insert([
          {
            id: setAMcqSingleId,
            study_set_id: setAId,
            question_type: "single_choice",
            position: 0,
            chapter: "Ch1-Kinematics",
            prompt: "Unit of force?",
            explanation: "Newton (N).",
            difficulty: "easy",
          },
          {
            id: setAMcqMultiId,
            study_set_id: setAId,
            question_type: "multiple_choice",
            position: 1, // Duplicate position intentional for clone test!
            chapter: "Ch1-Kinematics",
            prompt: "Select vector quantities.",
            explanation: "Velocity and Force.",
            difficulty: "medium",
          },
          {
            id: setATfId,
            study_set_id: setAId,
            question_type: "true_false",
            position: 1, // Duplicate position intentional for clone test!
            chapter: "Ch2-Optics",
            prompt: "Light travels faster in vacuum than in glass.",
            explanation: "Refractive index of glass > 1.",
            difficulty: "easy",
          },
          {
            id: setAShortNumZeroId,
            study_set_id: setAId,
            question_type: "short_answer",
            position: 3,
            chapter: "Ch2-Optics",
            prompt: "Net force at equilibrium (N)?",
            difficulty: "medium",
          },
          {
            id: setAShortNumTenId,
            study_set_id: setAId,
            question_type: "short_answer",
            position: 4,
            chapter: "Ch2-Optics",
            prompt: "Approx g on Earth (m/s^2)?",
            difficulty: "easy",
          },
          {
            id: setAShortNumHundredId,
            study_set_id: setAId,
            question_type: "short_answer",
            position: 5,
            chapter: "Ch2-Optics",
            prompt: "Boiling point of water at 1 atm (C)?",
            difficulty: "easy",
          },
          {
            id: setAShortNumDecimalId,
            study_set_id: setAId,
            question_type: "short_answer",
            position: 6,
            chapter: "Ch2-Optics",
            prompt: "Refractive index of crown glass?",
            difficulty: "hard",
          },
          {
            id: setAShortViId,
            study_set_id: setAId,
            question_type: "short_answer",
            position: 7,
            chapter: "Ch2-Optics",
            prompt: "Thủ đô của Việt Nam?",
            difficulty: "easy",
          },
          {
            id: setAFlashcardId,
            study_set_id: setAId,
            question_type: "flashcard",
            position: 8,
            chapter: "Ch1-Kinematics",
            prompt: "F = m * a",
            back_text: "Newton's Second Law",
            difficulty: "easy",
          },
          {
            id: setBMcqId,
            study_set_id: setBId,
            question_type: "single_choice",
            position: 0,
            chapter: "Ch3-Stoichiometry",
            prompt: "Atomic number of Carbon?",
            explanation: "Carbon has 6 protons.",
            difficulty: "easy",
          },
          {
            id: setBShortCaseId,
            study_set_id: setBId,
            question_type: "short_answer",
            position: 1,
            chapter: "Ch3-Stoichiometry",
            prompt: "Chemical formula of water?",
            difficulty: "easy",
          },
        ]);
        expect(qInsErr).toBeNull();

        // Insert choice options with explicit UUIDs
        const mkOpt = (
          qId: string,
          sId: string,
          pos: number,
          label: string,
          content: string,
          isCorrect: boolean,
        ) => {
          const id = randomUUID();
          if (isCorrect) {
            optCorrectByQuestion.set(qId, [
              ...(optCorrectByQuestion.get(qId) ?? []),
              id,
            ]);
          } else {
            optWrongByQuestion.set(qId, [
              ...(optWrongByQuestion.get(qId) ?? []),
              id,
            ]);
          }
          return {
            id,
            question_id: qId,
            study_set_id: sId,
            position: pos,
            label,
            content,
            is_correct: isCorrect,
          };
        };

        const { error: optErr } = await userClient
          .from("question_options")
          .insert([
            mkOpt(setAMcqSingleId, setAId, 0, "A", "Newton", true),
            mkOpt(setAMcqSingleId, setAId, 1, "B", "Joule", false),
            mkOpt(setAMcqSingleId, setAId, 2, "C", "Watt", false),
            mkOpt(setAMcqSingleId, setAId, 3, "D", "Pascal", false),
            mkOpt(setAMcqMultiId, setAId, 0, "A", "Velocity", true),
            mkOpt(setAMcqMultiId, setAId, 1, "B", "Force", true),
            mkOpt(setAMcqMultiId, setAId, 2, "C", "Mass", false),
            mkOpt(setAMcqMultiId, setAId, 3, "D", "Temperature", false),
            mkOpt(setATfId, setAId, 0, "A", "True", true),
            mkOpt(setATfId, setAId, 1, "B", "False", false),
            mkOpt(setBMcqId, setBId, 0, "A", "6", true),
            mkOpt(setBMcqId, setBId, 1, "B", "12", false),
            mkOpt(setBMcqId, setBId, 2, "C", "8", false),
            mkOpt(setBMcqId, setBId, 3, "D", "14", false),
          ]);
        expect(optErr).toBeNull();

        const { error: accErr } = await userClient
          .from("question_accepted_answers")
          .insert([
            {
              question_id: setAShortNumZeroId,
              study_set_id: setAId,
              answer_text: "0",
              normalized_answer: "0",
              match_mode: "numeric",
            },
            {
              question_id: setAShortNumTenId,
              study_set_id: setAId,
              answer_text: "10",
              normalized_answer: "10",
              match_mode: "numeric",
            },
            {
              question_id: setAShortNumHundredId,
              study_set_id: setAId,
              answer_text: "100",
              normalized_answer: "100",
              match_mode: "numeric",
            },
            {
              question_id: setAShortNumDecimalId,
              study_set_id: setAId,
              answer_text: "1.50",
              normalized_answer: "1.5",
              match_mode: "numeric",
            },
            {
              question_id: setAShortViId,
              study_set_id: setAId,
              answer_text: "Hà Nội",
              normalized_answer: "ha noi",
              match_mode: "ignore_diacritics",
            },
            {
              question_id: setBShortCaseId,
              study_set_id: setBId,
              answer_text: "H2O",
              normalized_answer: "h2o",
              match_mode: "case_insensitive",
            },
          ]);
        expect(accErr).toBeNull();

        // Create tags and link to Set A & Set B questions
        const { data: tags, error: tagErr } = await userClient
          .from("tags")
          .insert([
            { owner_id: userId, name: "Mechanics", slug: "mechanics" },
            { owner_id: userId, name: "Optics", slug: "optics" },
            { owner_id: userId, name: "Atoms", slug: "atoms" },
          ])
          .select("*")
          .order("slug", { ascending: true });
        expect(tagErr).toBeNull();

        const tagBySlug = new Map(tags!.map((t) => [t.slug, t.id]));
        const { error: qtErr } = await userClient.from("question_tags").insert([
          {
            question_id: setAMcqSingleId,
            tag_id: tagBySlug.get("mechanics")!,
            study_set_id: setAId,
          },
          {
            question_id: setAMcqMultiId,
            tag_id: tagBySlug.get("mechanics")!,
            study_set_id: setAId,
          },
          {
            question_id: setATfId,
            tag_id: tagBySlug.get("optics")!,
            study_set_id: setAId,
          },
          {
            question_id: setBMcqId,
            tag_id: tagBySlug.get("atoms")!,
            study_set_id: setBId,
          },
        ]);
        expect(qtErr).toBeNull();

        // Test resolve_deduped_study_sets with overlapping parentFolder + explicit setA + explicit setB
        const { data: deduped, error: dedupErr } =
          await rpcResolveDedupedStudySets(userClient, {
            p_folder_ids: [parentFolderId],
            p_study_set_ids: [setAId, setBId],
            p_include_subfolders: true,
          });
        expect(dedupErr).toBeNull();
        expect(deduped).toHaveLength(2);
        expect(new Set(deduped.map((d) => d.study_set_id))).toEqual(
          new Set([setAId, setBId]),
        );

        // Test get_exam_eligible_pool WITHOUT chapter filter:
        // Set A has 8 exam Qs (9 minus 1 flashcard), Set B has 2 exam Qs -> total = 10
        const { data: fullPool, error: poolErr } = await rpcGetExamEligiblePool(
          userClient,
          {
            p_folder_ids: [parentFolderId],
            p_study_set_ids: [setAId],
            p_include_subfolders: true,
            p_filters: {},
            p_selection_policy: "random",
          },
        );
        expect(poolErr).toBeNull();
        expect(fullPool?.deduplicated_set_count).toBe(2);
        expect(fullPool?.total_eligible).toBe(10);
        expect(fullPool?.chapters.map((c) => c.chapter)).toEqual([
          "Ch1-Kinematics",
          "Ch2-Optics",
          "Ch3-Stoichiometry",
        ]);
        expect(fullPool?.tags.length).toBe(3);

        // Test get_exam_eligible_pool WITH chapter filter = ["Ch1-Kinematics"]:
        // total_eligible narrows to 2, BUT chapter/tag facets MUST remain visible (W3-DB-7)!
        const { data: filteredPool, error: filtErr } =
          await rpcGetExamEligiblePool(userClient, {
            p_folder_ids: [parentFolderId],
            p_study_set_ids: [],
            p_include_subfolders: true,
            p_filters: { chapters: ["Ch1-Kinematics"] },
            p_selection_policy: "random",
          });
        expect(filtErr).toBeNull();
        expect(filteredPool?.total_eligible).toBe(2);
        expect(filteredPool?.chapters.map((c) => c.chapter)).toEqual([
          "Ch1-Kinematics",
          "Ch2-Optics",
          "Ch3-Stoichiometry",
        ]);
        expect(filteredPool?.tags.length).toBe(3);
      },
      45_000,
    );

    it(
      "5. Full Multi-Subject Exam Lifecycle LIVE (zero leak, live answered_count, client_seq, concurrent saves, short-answer 0/10/100/1.5/VI, SM-2 source_study_set_id, idempotency, unlimited time, P0003 expiry)",
      async () => {
        const examQuestionIds = [
          setAMcqSingleId,
          setAMcqMultiId,
          setATfId,
          setAShortNumZeroId,
          setAShortNumTenId,
          setAShortNumHundredId,
          setAShortNumDecimalId,
          setAShortViId,
          setBMcqId,
          setBShortCaseId,
        ];

        // 5a. Create multi-subject timed exam across Set A + Set B
        const { data: created, error: createErr } = await rpcCreateExamAttemptV2(
          userClient,
          {
            p_title_snapshot: "Live Multi-Subject Physics + Chemistry",
            p_primary_study_set_id: null,
            p_sources: [
              {
                source_type: "study_set",
                study_set_id: setAId,
                subject_title_snapshot: "Subject A — Physics",
                eligible_count: 8,
                allocated_count: 8,
              },
              {
                source_type: "study_set",
                study_set_id: setBId,
                subject_title_snapshot: "Subject B — Chemistry",
                eligible_count: 2,
                allocated_count: 2,
              },
            ],
            p_selected_items: examQuestionIds.map((id) => ({
              question_id: id,
            })),
            p_config: { mode: "custom_v2" },
            p_duration_limit_seconds: 1800,
            p_pass_threshold: 70,
            p_allocation_strategy: "proportional",
            p_selection_policy: "random",
            p_requested_question_count: 10,
          },
        );

        expect(createErr).toBeNull();
        expect(created).not.toBeNull();
        expect(created!.attempt.study_set_id).toBeNull();
        expect(created!.attempt.is_multi_subject).toBe(true);
        expect(created!.attempt.expires_at).not.toBeNull();
        expect(created!.questions).toHaveLength(10);
        expect(created!.sources).toHaveLength(2);

        // Verify ZERO answer key / explanation leakage pre-submit
        for (const q of created!.questions) {
          const rec = q as unknown as Record<string, unknown>;
          expect(rec.correct_option_ids).toBeUndefined();
          expect(rec.accepted_answers_snapshot).toBeUndefined();
          expect(rec.explanation_snapshot).toBeUndefined();
          for (const opt of q.options_snapshot) {
            expect(
              (opt as unknown as Record<string, unknown>).is_correct,
            ).toBeUndefined();
          }
        }

        const attemptId = created!.attempt.id;

        // Also verify get_exam_attempt_detail pre-submit leaks zero answer keys
        const { data: preDetail, error: preDetErr } =
          await rpcGetExamAttemptDetail(userClient, attemptId);
        expect(preDetErr).toBeNull();
        for (const q of preDetail!.questions) {
          const rec = q as unknown as Record<string, unknown>;
          expect(rec.correct_option_ids).toBeUndefined();
          expect(rec.accepted_answers_snapshot).toBeUndefined();
          expect(rec.explanation_snapshot).toBeUndefined();
        }

        const attemptQByOrigId = new Map(
          created!.questions.map((q) => [q.question_id!, q.id]),
        );

        // Test save_exam_attempt_answers live answered_count + monotonic client_seq guard
        const q1AttemptId = attemptQByOrigId.get(setAMcqSingleId)!;
        const q2AttemptId = attemptQByOrigId.get(setAMcqMultiId)!;

        const { data: save1, error: save1Err } = await rpcSaveExamAttemptAnswers(
          userClient,
          attemptId,
          [
            {
              attempt_question_id: q1AttemptId,
              selected_option_ids: optCorrectByQuestion.get(setAMcqSingleId)!,
              is_flagged: false,
              client_seq: 5,
            },
            {
              attempt_question_id: q2AttemptId,
              selected_option_ids: optCorrectByQuestion.get(setAMcqMultiId)!,
              is_flagged: true,
              client_seq: 5,
            },
          ],
        );
        expect(save1Err).toBeNull();
        expect(save1?.answered_count).toBe(2);
        expect(save1?.stale_ignored_ids).toEqual([]);

        // Verify live exam_attempts.answered_count persisted in DB
        const { data: liveAttempt } = await userClient
          .from("exam_attempts")
          .select("answered_count, unanswered_count")
          .eq("id", attemptId)
          .single();
        expect(liveAttempt?.answered_count).toBe(2);
        expect(liveAttempt?.unanswered_count).toBe(8);

        // Send stale client_seq=3 AND unsequenced client_seq=0 -> BOTH MUST be ignored (W3-DB-3)
        const { data: staleSave, error: staleErr } =
          await rpcSaveExamAttemptAnswers(userClient, attemptId, [
            {
              attempt_question_id: q1AttemptId,
              selected_option_ids: [optWrongByQuestion.get(setAMcqSingleId)![0]],
              is_flagged: false,
              client_seq: 3,
            },
            {
              attempt_question_id: q2AttemptId,
              selected_option_ids: [optWrongByQuestion.get(setAMcqMultiId)![0]],
              is_flagged: false,
              client_seq: 0,
            },
          ]);
        expect(staleErr).toBeNull();
        expect(new Set(staleSave?.stale_ignored_ids ?? [])).toEqual(
          new Set([q1AttemptId, q2AttemptId]),
        );

        // Concurrent autosaves on same attempt MUST NOT deadlock (FOR NO KEY UPDATE — W3-DB-3)
        const [concA, concB] = await Promise.all([
          rpcSaveExamAttemptAnswers(userClient, attemptId, [
            {
              attempt_question_id: attemptQByOrigId.get(setATfId)!,
              selected_option_ids: optCorrectByQuestion.get(setATfId)!,
              is_flagged: false,
              client_seq: 6,
            },
            {
              attempt_question_id: attemptQByOrigId.get(setAShortNumZeroId)!,
              selected_option_ids: [],
              typed_answer: "0.00", // numeric 0 -> CORRECT
              is_flagged: false,
              client_seq: 6,
            },
            {
              attempt_question_id: attemptQByOrigId.get(setAShortNumTenId)!,
              selected_option_ids: [],
              typed_answer: "10", // numeric 10 -> CORRECT (must NOT turn into '1')
              is_flagged: false,
              client_seq: 6,
            },
          ]),
          rpcSaveExamAttemptAnswers(userClient, attemptId, [
            {
              attempt_question_id: attemptQByOrigId.get(setAShortNumHundredId)!,
              selected_option_ids: [],
              typed_answer: "100.00", // numeric 100 -> CORRECT
              is_flagged: false,
              client_seq: 7,
            },
            {
              attempt_question_id: attemptQByOrigId.get(setAShortNumDecimalId)!,
              selected_option_ids: [],
              typed_answer: "1,5", // comma decimal -> CORRECT
              is_flagged: false,
              client_seq: 7,
            },
            {
              attempt_question_id: attemptQByOrigId.get(setAShortViId)!,
              selected_option_ids: [],
              typed_answer: "[Ha Noi]!", // ignore_diacritics + bracket punctuation -> CORRECT
              is_flagged: false,
              client_seq: 7,
            },
          ]),
        ]);
        expect(concA.error).toBeNull();
        expect(concB.error).toBeNull();

        // Answer Set B: Q1 WRONG, Q2 left UNANSWERED (total: 8 correct, 1 wrong, 1 unanswered -> 80% PASSED)
        const { data: saveB, error: saveBErr } = await rpcSaveExamAttemptAnswers(
          userClient,
          attemptId,
          [
            {
              attempt_question_id: attemptQByOrigId.get(setBMcqId)!,
              selected_option_ids: [optWrongByQuestion.get(setBMcqId)![0]],
              is_flagged: false,
              client_seq: 8,
            },
          ],
        );
        expect(saveBErr).toBeNull();
        expect(saveB?.answered_count).toBe(9);

        // Submit exam attempt
        const { data: graded, error: subErr } = await rpcSubmitExamAttempt(
          userClient,
          attemptId,
        );
        expect(subErr).toBeNull();
        expect(graded).not.toBeNull();
        expect(graded!.attempt.status).toBe("submitted");
        expect(graded!.attempt.answered_count).toBe(9);
        expect(graded!.attempt.correct_count).toBe(8);
        expect(graded!.attempt.wrong_count).toBe(1);
        expect(graded!.attempt.unanswered_count).toBe(1);
        expect(Number(graded!.attempt.score_percent)).toBe(80);
        expect(graded!.attempt.passed).toBe(true);

        // Verify subject, chapter, and tag breakdowns
        expect(graded!.subject_breakdown).toHaveLength(2);
        const subjA = graded!.subject_breakdown!.find(
          (s) => s.study_set_id === setAId,
        );
        const subjB = graded!.subject_breakdown!.find(
          (s) => s.study_set_id === setBId,
        );
        expect(subjA?.total).toBe(8);
        expect(subjA?.correct).toBe(8);
        expect(subjA?.accuracy_percent).toBe(100);
        expect(subjB?.total).toBe(2);
        expect(subjB?.wrong).toBe(1);
        expect(subjB?.unanswered).toBe(1);
        expect(subjB?.accuracy_percent).toBe(0);

        expect(graded!.chapter_breakdown!.length).toBeGreaterThanOrEqual(3);
        expect(graded!.tag_breakdown!.length).toBe(3);

        // Verify SM-2 user_question_progress recorded per-question TRUE source_study_set_id (SH-006)!
        const { data: progRows, error: progErr } = await userClient
          .from("user_question_progress")
          .select("*")
          .eq("user_id", userId)
          .in("question_id", examQuestionIds);
        expect(progErr).toBeNull();
        // 9 answered questions tracked (unanswered setBShortCaseId skipped)
        expect(progRows).toHaveLength(9);
        const progByQ = new Map(progRows!.map((p) => [p.question_id, p]));
        expect(progByQ.get(setAMcqSingleId)?.study_set_id).toBe(setAId);
        expect(progByQ.get(setAMcqSingleId)?.correct_count).toBe(1);
        expect(progByQ.get(setAMcqSingleId)?.mastery_level).toBe("learning");
        expect(Number(progByQ.get(setAMcqSingleId)?.ease_factor)).toBe(2.5);
        expect(progByQ.get(setBMcqId)?.study_set_id).toBe(setBId);
        expect(progByQ.get(setBMcqId)?.wrong_count).toBe(1);
        expect(Number(progByQ.get(setBMcqId)?.ease_factor)).toBe(1.96);
        expect(progByQ.has(setBShortCaseId)).toBe(false);

        // Verify double-submit idempotency (same score/submitted_at, progress NOT double-incremented!)
        const { data: gradedAgain, error: sub2Err } = await rpcSubmitExamAttempt(
          userClient,
          attemptId,
        );
        expect(sub2Err).toBeNull();
        expect(gradedAgain!.attempt.submitted_at).toBe(
          graded!.attempt.submitted_at,
        );
        expect(Number(gradedAgain!.attempt.score_percent)).toBe(80);
        const { data: progAfterIdem } = await userClient
          .from("user_question_progress")
          .select("correct_count")
          .eq("user_id", userId)
          .eq("question_id", setAMcqSingleId)
          .single();
        expect(progAfterIdem?.correct_count).toBe(1);

        // 5b. Unlimited-time exam (`duration_limit_seconds: null` -> `expires_at IS NULL`)
        const { data: unlim, error: unlimErr } = await rpcCreateExamAttemptV2(
          userClient,
          {
            p_title_snapshot: "Unlimited Time Check",
            p_primary_study_set_id: setBId,
            p_sources: [
              {
                source_type: "study_set",
                study_set_id: setBId,
                subject_title_snapshot: "Subject B — Chemistry",
                eligible_count: 2,
                allocated_count: 1,
              },
            ],
            p_selected_items: [{ question_id: setBMcqId }],
            p_config: {},
            p_duration_limit_seconds: null,
            p_pass_threshold: 70,
          },
        );
        expect(unlimErr).toBeNull();
        expect(unlim!.attempt.duration_limit_seconds).toBeNull();
        expect(unlim!.attempt.expires_at).toBeNull();
        expect(unlim!.remaining_seconds).toBeNull();

        const { error: unlimSaveErr } = await rpcSaveExamAttemptAnswers(
          userClient,
          unlim!.attempt.id,
          [
            {
              attempt_question_id: unlim!.questions[0].id,
              selected_option_ids: optCorrectByQuestion.get(setBMcqId)!,
              is_flagged: false,
              client_seq: 1,
            },
          ],
        );
        expect(unlimSaveErr).toBeNull();
        const { data: unlimSub, error: unlimSubErr } =
          await rpcSubmitExamAttempt(userClient, unlim!.attempt.id);
        expect(unlimSubErr).toBeNull();
        expect(unlimSub!.attempt.status).toBe("submitted");
        expect(Number(unlimSub!.attempt.score_percent)).toBe(100);

        // 5c. Expired exam late-save MUST reject with SQLSTATE P0003, and submit marks 'expired'
        const { data: expExam, error: expCreateErr } =
          await rpcCreateExamAttemptV2(userClient, {
            p_title_snapshot: "Expiry Guard Check",
            p_primary_study_set_id: setBId,
            p_sources: [],
            p_selected_items: [{ question_id: setBMcqId }],
            p_config: {},
            p_duration_limit_seconds: 60,
            p_pass_threshold: 70,
          });
        expect(expCreateErr).toBeNull();

        const pastIso = new Date(Date.now() - 120_000).toISOString();
        const { error: backdateErr } = await admin
          .from("exam_attempts")
          .update({ expires_at: pastIso } as unknown as Database["public"]["Tables"]["exam_attempts"]["Update"])
          .eq("id", expExam!.attempt.id);
        expect(backdateErr).toBeNull();

        const { error: lateSaveErr } = await rpcSaveExamAttemptAnswers(
          userClient,
          expExam!.attempt.id,
          [
            {
              attempt_question_id: expExam!.questions[0].id,
              selected_option_ids: optCorrectByQuestion.get(setBMcqId)!,
              is_flagged: false,
              client_seq: 1,
            },
          ],
        );
        expect(lateSaveErr).not.toBeNull();
        expect(lateSaveErr?.code).toBe("P0003");

        const { data: expSub, error: expSubErr } = await rpcSubmitExamAttempt(
          userClient,
          expExam!.attempt.id,
        );
        expect(expSubErr).toBeNull();
        expect(expSub!.attempt.status).toBe("expired");
      },
      60_000,
    );

    it(
      "6. Full 500Q Coverage Cycle LIVE (250/exam -> discard -> Exam 1 -> Exam 2 zero overlap -> 500/500 completed -> restart cycle 2 pool_order >= 0 -> delete trigger)",
      async () => {
        // Seed 2 study sets totaling 500 MC questions (300 + 200) with 4 options each (2,000 options)
        const { data: covSets, error: covSetErr } = await userClient
          .from("study_sets")
          .insert([
            {
              owner_id: userId,
              title: "Coverage Bank A (300Q)",
              set_type: "multiple_choice",
              visibility: "private",
            },
            {
              owner_id: userId,
              title: "Coverage Bank B (200Q)",
              set_type: "multiple_choice",
              visibility: "private",
            },
          ])
          .select("*")
          .order("title", { ascending: true });
        expect(covSetErr).toBeNull();
        setCovAId = covSets![0].id;
        setCovBId = covSets![1].id;

        covAQuestionIds = Array.from({ length: 300 }, () => randomUUID());
        covBQuestionIds = Array.from({ length: 200 }, () => randomUUID());

        const allCovQRows = [
          ...covAQuestionIds.map((id, idx) => ({
            id,
            study_set_id: setCovAId,
            question_type: "single_choice" as const,
            position: idx,
            chapter: `A-Ch${(idx % 3) + 1}`,
            prompt: `Coverage A Question #${idx + 1}`,
            difficulty: "medium" as const,
          })),
          ...covBQuestionIds.map((id, idx) => ({
            id,
            study_set_id: setCovBId,
            question_type: "single_choice" as const,
            position: idx,
            chapter: `B-Ch${(idx % 2) + 1}`,
            prompt: `Coverage B Question #${idx + 1}`,
            difficulty: "medium" as const,
          })),
        ];

        const { error: covQErr } = await userClient
          .from("questions")
          .insert(allCovQRows);
        expect(covQErr).toBeNull();

        const labels = ["A", "B", "C", "D"] as const;
        const allCovOptRows = allCovQRows.flatMap((q) =>
          labels.map((lbl, idx) => ({
            question_id: q.id,
            study_set_id: q.study_set_id,
            position: idx,
            label: lbl,
            content: `${lbl} option for ${q.prompt}`,
            is_correct: idx === 0,
          })),
        );

        // Insert 2,000 options in 2 x 1,000 batches
        for (let i = 0; i < allCovOptRows.length; i += 1000) {
          const { error: oErr } = await userClient
            .from("question_options")
            .insert(allCovOptRows.slice(i, i + 1000));
          expect(oErr).toBeNull();
        }

        const all500Ids = [...covAQuestionIds, ...covBQuestionIds];

        // 6a. Create 500Q Coverage Cycle (250/exam)
        const { data: cycle, error: cycErr } = await rpcCreateCoverageCycle(
          userClient,
          {
            p_title: "Live 500Q Full Coverage Test",
            p_source_snapshot: [
              { study_set_id: setCovAId, title: "Coverage Bank A (300Q)" },
              { study_set_id: setCovBId, title: "Coverage Bank B (200Q)" },
            ],
            p_filter_snapshot: {},
            p_allocation_strategy: "proportional",
            p_questions_per_exam: 250,
            p_pool_items: all500Ids.map((id) => ({ question_id: id })),
          },
        );
        expect(cycErr).toBeNull();
        expect(cycle?.total_questions).toBe(500);
        expect(cycle?.assigned_count).toBe(0);
        expect(cycle?.completed_count).toBe(0);
        expect(cycle?.status).toBe("active");
        const cycleId = cycle!.id;

        // Verify new set-based RPC get_coverage_cycle_subject_progress(uuid[]) (W3-DB-8)
        const { data: subjProg, error: spErr } =
          await rpcGetCoverageCycleSubjectProgress(userClient, [cycleId]);
        expect(spErr).toBeNull();
        expect(subjProg).toHaveLength(2);
        expect(subjProg.reduce((sum, r) => sum + r.total, 0)).toBe(500);
        expect(subjProg.reduce((sum, r) => sum + r.remaining, 0)).toBe(500);

        const buildNextBatch = async () => {
          const { data: unassigned, error } = await userClient
            .from("coverage_cycle_questions")
            .select("question_id, source_study_set_id, source_subject_title")
            .eq("cycle_id", cycleId)
            .eq("state", "unassigned")
            .order("pool_order", { ascending: true })
            .limit(250);
          expect(error).toBeNull();
          return unassigned ?? [];
        };

        // 6b. Issue Exam 0 (250Q) -> verify P0005 active guard -> Discard -> verify 250Q reverted to unassigned
        const batch0 = await buildNextBatch();
        expect(batch0).toHaveLength(250);

        const { data: exam0, error: ex0Err } =
          await rpcIssueCoverageCycleNextExam(userClient, {
            p_cycle_id: cycleId,
            p_selected_items: batch0.map((b) => ({
              question_id: b.question_id!,
            })),
            p_sources: [
              {
                source_type: "study_set",
                study_set_id: setCovAId,
                subject_title_snapshot: "Coverage Bank A (300Q)",
                eligible_count: 300,
                allocated_count: batch0.filter(
                  (b) => b.source_study_set_id === setCovAId,
                ).length,
              },
              {
                source_type: "study_set",
                study_set_id: setCovBId,
                subject_title_snapshot: "Coverage Bank B (200Q)",
                eligible_count: 200,
                allocated_count: batch0.filter(
                  (b) => b.source_study_set_id === setCovBId,
                ).length,
              },
            ],
            p_title_snapshot: "Coverage Exam #1 (To Discard)",
            p_config: {},
            p_duration_limit_seconds: 3600,
            p_pass_threshold: 70,
          });
        expect(ex0Err).toBeNull();
        expect(exam0?.questions).toHaveLength(250);

        // Trying to issue another exam while active MUST reject with P0005
        const { error: activeBlockErr } = await rpcIssueCoverageCycleNextExam(
          userClient,
          {
            p_cycle_id: cycleId,
            p_selected_items: [{ question_id: all500Ids[499] }],
            p_sources: [],
            p_title_snapshot: "Should Fail",
            p_config: {},
            p_duration_limit_seconds: null,
            p_pass_threshold: 70,
          },
        );
        expect(activeBlockErr?.code).toBe("P0005");

        // Discard active Exam 0
        const { data: discarded, error: discErr } =
          await rpcDiscardCoverageCycleActiveExam(userClient, cycleId);
        expect(discErr).toBeNull();
        expect(discarded?.discarded_attempt_id).toBe(exam0!.attempt.id);
        expect(discarded?.reverted_questions).toBe(250);
        expect(discarded?.cycle.assigned_count).toBe(0);
        expect(discarded?.cycle.completed_count).toBe(0);
        expect(discarded?.cycle.active_attempt_id).toBeNull();

        const { data: exam0Row } = await userClient
          .from("exam_attempts")
          .select("status")
          .eq("id", exam0!.attempt.id)
          .single();
        expect(exam0Row?.status).toBe("discarded");

        // 6c. Issue Exam 1 (250Q) -> answer all 250 -> submit
        const batch1 = await buildNextBatch();
        expect(batch1).toHaveLength(250);
        const { data: exam1, error: ex1Err } =
          await rpcIssueCoverageCycleNextExam(userClient, {
            p_cycle_id: cycleId,
            p_selected_items: batch1.map((b) => ({
              question_id: b.question_id!,
            })),
            p_sources: [],
            p_title_snapshot: "Coverage Exam #1",
            p_config: {},
            p_duration_limit_seconds: 3600,
            p_pass_threshold: 70,
          });
        expect(ex1Err).toBeNull();
        expect(exam1?.questions).toHaveLength(250);

        const exam1QIds = new Set(exam1!.questions.map((q) => q.question_id!));
        expect(exam1QIds.size).toBe(250);

        // Save all 250 answers in 2 chunks of 125
        for (let i = 0; i < exam1!.questions.length; i += 125) {
          const slice = exam1!.questions.slice(i, i + 125);
          const { error: sErr } = await rpcSaveExamAttemptAnswers(
            userClient,
            exam1!.attempt.id,
            slice.map((q) => ({
              attempt_question_id: q.id,
              selected_option_ids: [q.options_snapshot[0].id],
              is_flagged: false,
              client_seq: 1,
            })),
          );
          expect(sErr).toBeNull();
        }

        const { data: sub1, error: sub1Err } = await rpcSubmitExamAttempt(
          userClient,
          exam1!.attempt.id,
        );
        expect(sub1Err).toBeNull();
        expect(sub1?.attempt.answered_count).toBe(250);
        expect(sub1?.coverage_cycle?.completed_count).toBe(250);
        expect(sub1?.coverage_cycle?.assigned_count).toBe(0);
        expect(sub1?.coverage_cycle?.status).toBe("active");

        // 6d. Issue Exam 2 (remaining 250Q) -> verify ZERO overlap with Exam 1 -> submit -> 500/500 completed!
        const batch2 = await buildNextBatch();
        expect(batch2).toHaveLength(250);
        const { data: exam2, error: ex2Err } =
          await rpcIssueCoverageCycleNextExam(userClient, {
            p_cycle_id: cycleId,
            p_selected_items: batch2.map((b) => ({
              question_id: b.question_id!,
            })),
            p_sources: [],
            p_title_snapshot: "Coverage Exam #2",
            p_config: {},
            p_duration_limit_seconds: 3600,
            p_pass_threshold: 70,
          });
        expect(ex2Err).toBeNull();
        expect(exam2?.questions).toHaveLength(250);

        const exam2QIds = new Set(exam2!.questions.map((q) => q.question_id!));
        expect(exam2QIds.size).toBe(250);

        // Strict ZERO overlap invariant across the full 500Q cycle
        const overlap = [...exam1QIds].filter((id) => exam2QIds.has(id));
        expect(overlap).toEqual([]);
        const union = new Set([...exam1QIds, ...exam2QIds]);
        expect(union.size).toBe(500);

        for (let i = 0; i < exam2!.questions.length; i += 125) {
          const slice = exam2!.questions.slice(i, i + 125);
          const { error: sErr } = await rpcSaveExamAttemptAnswers(
            userClient,
            exam2!.attempt.id,
            slice.map((q) => ({
              attempt_question_id: q.id,
              selected_option_ids: [q.options_snapshot[0].id],
              is_flagged: false,
              client_seq: 1,
            })),
          );
          expect(sErr).toBeNull();
        }

        const { data: sub2, error: sub2Err } = await rpcSubmitExamAttempt(
          userClient,
          exam2!.attempt.id,
        );
        expect(sub2Err).toBeNull();
        expect(sub2?.coverage_cycle?.status).toBe("completed");
        expect(sub2?.coverage_cycle?.completed_count).toBe(500);
        expect(sub2?.coverage_cycle?.answered_count).toBe(500);
        expect(sub2?.coverage_cycle?.assigned_count).toBe(0);
        expect(sub2?.coverage_cycle?.completed_at).not.toBeNull();

        // 6e. Restart Coverage Cycle in-place (p_new_pool_items = null -> exercises non-negative shift W3-DB-2!)
        const { data: restarted, error: restErr } = await rpcRestartCoverageCycle(
          userClient,
          {
            p_cycle_id: cycleId,
            p_new_pool_items: null,
            p_force_discard_active: false,
          },
        );
        expect(restErr).toBeNull();
        expect(restarted?.cycle_number).toBe(2);
        expect(restarted?.status).toBe("active");
        expect(restarted?.total_questions).toBe(500);
        expect(restarted?.completed_count).toBe(0);
        expect(restarted?.assigned_count).toBe(0);

        const { data: cycleQOrders, error: ordErr } = await userClient
          .from("coverage_cycle_questions")
          .select("pool_order, state")
          .eq("cycle_id", cycleId)
          .order("pool_order", { ascending: true });
        expect(ordErr).toBeNull();
        expect(cycleQOrders).toHaveLength(500);
        expect(cycleQOrders![0].pool_order).toBe(0);
        expect(cycleQOrders![499].pool_order).toBe(499);
        expect(
          cycleQOrders!.every((r) => r.pool_order >= 0 && r.state === "unassigned"),
        ).toBe(true);

        // 6f. Verify BEFORE DELETE trigger releases assigned coverage questions on direct exam delete (W3-DB-5)
        const batchC2 = await buildNextBatch();
        const { data: examToDelete, error: exDelCreateErr } =
          await rpcIssueCoverageCycleNextExam(userClient, {
            p_cycle_id: cycleId,
            p_selected_items: batchC2.slice(0, 10).map((b) => ({
              question_id: b.question_id!,
            })),
            p_sources: [],
            p_title_snapshot: "Cycle 2 Direct Delete Trigger Check",
            p_config: {},
            p_duration_limit_seconds: null,
            p_pass_threshold: 70,
          });
        expect(exDelCreateErr).toBeNull();

        const { error: directDelErr } = await userClient
          .from("exam_attempts")
          .delete()
          .eq("id", examToDelete!.attempt.id);
        expect(directDelErr).toBeNull();

        const { data: cycleAfterDirectDel } = await userClient
          .from("coverage_cycles")
          .select("active_attempt_id, assigned_count")
          .eq("id", cycleId)
          .single();
        expect(cycleAfterDirectDel?.active_attempt_id).toBeNull();
        expect(cycleAfterDirectDel?.assigned_count).toBe(0);
      },
      120_000,
    );

    it(
      "7. clone_study_set() LIVE copies questions, options (1:1 UUID mapping even with duplicate position!), accepted answers, and tags (SH-020)",
      async () => {
        const { data: cloned, error: cloneErr } = await rpcCloneStudySet(
          userClient,
          {
            p_source_set_id: setAId,
            p_title: "Cloned Subject A — Live Proof",
            p_folder_id: parentFolderId,
          },
        );
        expect(cloneErr).toBeNull();
        expect(cloned?.copied_questions).toBe(9);
        expect(cloned?.study_set.question_count).toBe(9);
        expect(cloned?.study_set.visibility).toBe("private");

        const clonedSetId = cloned!.study_set.id;

        const [{ data: clonedQs }, { data: clonedOpts }, { data: clonedAccs }, { data: clonedTags }] =
          await Promise.all([
            userClient
              .from("questions")
              .select("id, prompt, question_type")
              .eq("study_set_id", clonedSetId),
            userClient
              .from("question_options")
              .select("question_id, content, is_correct")
              .eq("study_set_id", clonedSetId),
            userClient
              .from("question_accepted_answers")
              .select("question_id, answer_text, match_mode")
              .eq("study_set_id", clonedSetId),
            userClient
              .from("question_tags")
              .select("question_id, tag_id")
              .eq("study_set_id", clonedSetId),
          ]);

        expect(clonedQs).toHaveLength(9);
        // Duplicate-position questions in Set A (multiple_choice=4 opts, true_false=2 opts, single_choice=4 opts = 10 total)
        expect(clonedOpts).toHaveLength(10);
        const clonedMulti = clonedQs!.find(
          (q) => q.prompt === "Select vector quantities.",
        );
        const clonedTf = clonedQs!.find(
          (q) => q.prompt === "Light travels faster in vacuum than in glass.",
        );
        expect(
          clonedOpts!.filter((o) => o.question_id === clonedMulti!.id),
        ).toHaveLength(4);
        expect(
          clonedOpts!.filter((o) => o.question_id === clonedTf!.id),
        ).toHaveLength(2);
        // 5 short-answer accepted answers copied
        expect(clonedAccs).toHaveLength(5);
        // 3 question_tags copied
        expect(clonedTags).toHaveLength(3);
      },
      45_000,
    );

    it(
      "8. get_practice_question_pool() LIVE returns 500 multi-subject questions with all 2,000 options intact (zero PostgREST 1,000-row truncation)",
      async () => {
        const { data: practicePool, error: pracErr } =
          await rpcGetPracticeQuestionPool(userClient, {
            p_folder_ids: [],
            p_study_set_ids: [setCovAId, setCovBId],
            p_include_subfolders: true,
            p_filters: {},
            p_selection_policy: "random",
            p_count: 500,
            p_shuffle: true,
          });

        expect(pracErr).toBeNull();
        expect(practicePool).not.toBeNull();
        expect(practicePool!.total_eligible).toBe(500);
        expect(practicePool!.sources).toHaveLength(2);
        expect(practicePool!.questions).toHaveLength(500);
        const withAll4Opts = practicePool!.questions.filter(
          (q) => Array.isArray(q.options) && q.options.length === 4,
        );
        expect(withAll4Opts).toHaveLength(500);
      },
      60_000,
    );
  },
);
