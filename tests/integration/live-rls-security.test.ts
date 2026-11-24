// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface LiveSupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

const PLACEHOLDER_MARKERS = [
  "your-project-ref.supabase.co",
  "your-supabase-",
  "your-publishable-key",
  "your-anon-key",
  "your-secret-key",
  "your-service-role-key",
  "placeholder",
];

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function isPlaceholder(val: string): boolean {
  const lower = val.toLowerCase();
  return !val || PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

function loadLiveSupabaseConfig(): LiveSupabaseConfig | null {
  const fileEnv = parseDotEnvFile(path.resolve(process.cwd(), ".env.local"));
  const getVar = (name: string): string =>
    (process.env[name]?.trim() || fileEnv[name]?.trim() || "").trim();

  const url = getVar("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey =
    getVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    getVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey =
    getVar("SUPABASE_SECRET_KEY") || getVar("SUPABASE_SERVICE_ROLE_KEY");

  if (
    isPlaceholder(url) ||
    isPlaceholder(publishableKey) ||
    isPlaceholder(secretKey)
  ) {
    return null;
  }
  return { url, publishableKey, secretKey };
}

const LIVE_CONFIG = loadLiveSupabaseConfig();
const LIVE_API_BASE_URL = (process.env.LIVE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

async function mintSsrCookieHeader(
  cfg: LiveSupabaseConfig,
  email: string,
  password: string,
): Promise<string> {
  const jar = new Map<string, string>();
  const ssrClient = createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const { error } = await ssrClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(`SSR cookie sign-in failed: ${error.message}`);
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

// Minimal valid 1x1 transparent PNG (67 bytes)
const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const EVIL_SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf8",
);

const runLive = LIVE_CONFIG ? describe : describe.skip;

runLive(
  "Live Supabase Cloud Security & 2-Account Negative RLS Verification (V2.1)",
  () => {
    let admin: SupabaseClient;
    let anonClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    let userAId = "";
    let userBId = "";
    let emailA = "";
    let emailB = "";
    let testPassword = "";
    let cookieA = "";
    let cookieB = "";

    let folderAId = "";
    let setASharedId = "";
    let setAPrivateId = "";
    let setBId = "";
    let qASharedMcId = "";
    let qASharedShortId = "";
    let qAPrivateId = "";
    let qASharedOptCorrectId = "";
    let attemptAId = "";
    let presetAId = "";
    let presetBOnPrivateId = "";
    let cycleAId = "";
    let sessionAId = "";

    const uploadedStoragePaths: string[] = [];

    beforeAll(async () => {
      if (!LIVE_CONFIG) return;

      const clientOpts = {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      };

      admin = createClient(LIVE_CONFIG.url, LIVE_CONFIG.secretKey, clientOpts);
      anonClient = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );
      clientA = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );
      clientB = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );

      const ts = `${Date.now()}-${randomBytes(3).toString("hex")}`;
      emailA = `v21-sec-a-${ts}@studyhub-test.local`;
      emailB = `v21-sec-b-${ts}@studyhub-test.local`;
      testPassword = `Sh!Sec_${randomBytes(12).toString("base64url")}9a`;
      const password = testPassword;

      const [resA, resB] = await Promise.all([
        admin.auth.admin.createUser({
          email: emailA,
          password,
          email_confirm: true,
          user_metadata: { display_name: "Sec Audit A" },
        }),
        admin.auth.admin.createUser({
          email: emailB,
          password,
          email_confirm: true,
          user_metadata: { display_name: "Sec Audit B" },
        }),
      ]);

      if (resA.error || !resA.data.user) {
        throw new Error(`Failed to provision disposable User A: ${resA.error?.message}`);
      }
      if (resB.error || !resB.data.user) {
        throw new Error(`Failed to provision disposable User B: ${resB.error?.message}`);
      }

      userAId = resA.data.user.id;
      userBId = resB.data.user.id;

      const [signA, signB] = await Promise.all([
        clientA.auth.signInWithPassword({ email: emailA, password }),
        clientB.auth.signInWithPassword({ email: emailB, password }),
      ]);
      if (signA.error || !signA.data.session) {
        throw new Error(`User A sign-in failed: ${signA.error?.message}`);
      }
      if (signB.error || !signB.data.session) {
        throw new Error(`User B sign-in failed: ${signB.error?.message}`);
      }

      // Seed User A folder + shared set + private set + User B own set
      const { data: fA, error: fAErr } = await clientA
        .from("folders")
        .insert({ owner_id: userAId, name: "Sec Folder A" })
        .select("id")
        .single();
      if (fAErr || !fA) throw new Error(`Seed folder A failed: ${fAErr?.message}`);
      folderAId = fA.id;

      const { data: sShared, error: sSharedErr } = await clientA
        .from("study_sets")
        .insert({
          owner_id: userAId,
          folder_id: folderAId,
          title: "Sec Shared Set A",
          visibility: "shared",
          set_type: "multiple_choice",
        })
        .select("id")
        .single();
      if (sSharedErr || !sShared) {
        throw new Error(`Seed shared set A failed: ${sSharedErr?.message}`);
      }
      setASharedId = sShared.id;

      const { data: sPriv, error: sPrivErr } = await clientA
        .from("study_sets")
        .insert({
          owner_id: userAId,
          folder_id: folderAId,
          title: "Sec Private Set A",
          visibility: "private",
          set_type: "multiple_choice",
        })
        .select("id")
        .single();
      if (sPrivErr || !sPriv) {
        throw new Error(`Seed private set A failed: ${sPrivErr?.message}`);
      }
      setAPrivateId = sPriv.id;

      const { data: sB, error: sBErr } = await clientB
        .from("study_sets")
        .insert({
          owner_id: userBId,
          title: "Sec Set B",
          visibility: "private",
          set_type: "multiple_choice",
        })
        .select("id")
        .single();
      if (sBErr || !sB) throw new Error(`Seed set B failed: ${sBErr?.message}`);
      setBId = sB.id;

      // Grant User B 'editor' membership on setASharedId
      const { error: memErr } = await clientA.from("study_set_members").insert({
        study_set_id: setASharedId,
        user_id: userBId,
        role: "editor",
        invited_by: userAId,
      });
      if (memErr) throw new Error(`Seed editor membership failed: ${memErr.message}`);

      // Add questions to setASharedId and setAPrivateId
      const { data: qsA, error: qsAErr } = await clientA
        .from("questions")
        .insert([
          {
            study_set_id: setASharedId,
            question_type: "single_choice",
            position: 0,
            prompt: "Live sec MC question?",
            explanation: "Secret explanation text",
            difficulty: "medium",
          },
          {
            study_set_id: setASharedId,
            question_type: "short_answer",
            position: 1,
            prompt: "Live sec numeric question?",
            explanation: "Zero explanation",
            difficulty: "easy",
          },
        ])
        .select("id, question_type");
      if (qsAErr || !qsA || qsA.length !== 2) {
        throw new Error(`Seed shared questions failed: ${qsAErr?.message}`);
      }
      qASharedMcId = qsA.find((q) => q.question_type === "single_choice")!.id;
      qASharedShortId = qsA.find((q) => q.question_type === "short_answer")!.id;

      const { data: optsA, error: optsAErr } = await clientA
        .from("question_options")
        .insert([
          {
            question_id: qASharedMcId,
            study_set_id: setASharedId,
            position: 0,
            label: "A",
            content: "Correct Option",
            is_correct: true,
          },
          {
            question_id: qASharedMcId,
            study_set_id: setASharedId,
            position: 1,
            label: "B",
            content: "Wrong Option",
            is_correct: false,
          },
        ])
        .select("id, is_correct");
      if (optsAErr || !optsA) {
        throw new Error(`Seed options failed: ${optsAErr?.message}`);
      }
      qASharedOptCorrectId = optsA.find((o) => o.is_correct)!.id;

      const { error: accErr } = await clientA
        .from("question_accepted_answers")
        .insert({
          question_id: qASharedShortId,
          study_set_id: setASharedId,
          answer_text: "0",
          normalized_answer: "0",
          match_mode: "numeric",
        });
      if (accErr) throw new Error(`Seed accepted answer failed: ${accErr.message}`);

      const { data: qPriv, error: qPrivErr } = await clientA
        .from("questions")
        .insert({
          study_set_id: setAPrivateId,
          question_type: "single_choice",
          position: 0,
          prompt: "Private question A?",
          difficulty: "hard",
        })
        .select("id")
        .single();
      if (qPrivErr || !qPriv) {
        throw new Error(`Seed private question failed: ${qPrivErr?.message}`);
      }
      qAPrivateId = qPriv.id;

      const { error: qPrivOptErr } = await clientA
        .from("question_options")
        .insert([
          {
            question_id: qAPrivateId,
            study_set_id: setAPrivateId,
            position: 0,
            label: "A",
            content: "Secret Answer",
            is_correct: true,
          },
          {
            question_id: qAPrivateId,
            study_set_id: setAPrivateId,
            position: 1,
            label: "B",
            content: "Distractor",
            is_correct: false,
          },
        ]);
      if (qPrivOptErr) {
        throw new Error(`Seed private options failed: ${qPrivOptErr.message}`);
      }

      // Seed User A progress, starred, study_session, exam_preset, and coverage_cycle
      await clientA.from("user_question_progress").insert({
        user_id: userAId,
        study_set_id: setAPrivateId,
        question_id: qAPrivateId,
        mastery_level: "learning",
        correct_count: 1,
        wrong_count: 0,
      });

      await clientA.from("starred_questions").insert({
        user_id: userAId,
        study_set_id: setAPrivateId,
        question_id: qAPrivateId,
      });

      const { data: sessA, error: sessAErr } = await clientA
        .from("study_sessions")
        .insert({
          user_id: userAId,
          study_set_id: setAPrivateId,
          source_study_set_ids: [setAPrivateId],
          mode: "practice",
          total_items: 1,
        })
        .select("id")
        .single();
      if (sessAErr || !sessA) {
        throw new Error(`Seed session A failed: ${sessAErr?.message}`);
      }
      sessionAId = sessA.id;

      const { data: preA, error: preAErr } = await clientA
        .from("exam_presets")
        .insert({
          user_id: userAId,
          name: "Private Preset A",
          requested_question_count: 1,
          allocation_strategy: "proportional",
          selection_policy: "random",
        })
        .select("id")
        .single();
      if (preAErr || !preA) {
        throw new Error(`Seed preset A failed: ${preAErr?.message}`);
      }
      presetAId = preA.id;

      await clientA.from("exam_preset_sources").insert({
        preset_id: presetAId,
        source_type: "study_set",
        study_set_id: setAPrivateId,
        sort_order: 0,
      });

      const { data: cycA, error: cycAErr } = await clientA.rpc(
        "create_coverage_cycle",
        {
          p_title: "Private Cycle A",
          p_source_snapshot: [{ study_set_id: setAPrivateId, title: "Sec Private Set A" }],
          p_filter_snapshot: {},
          p_allocation_strategy: "proportional",
          p_questions_per_exam: 1,
          p_pool_items: [{ question_id: qAPrivateId }],
          p_preset_id: presetAId,
        },
      );
      if (cycAErr || !cycA) {
        throw new Error(`Seed cycle A failed: ${cycAErr?.message}`);
      }
      cycleAId = (cycA as { id: string }).id;
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      try {
        // 1. Purge all uploaded storage objects & any user prefix leftovers
        const bucket = admin.storage.from("study-media");
        const toRemove = new Set<string>(uploadedStoragePaths);

        for (const prefix of [
          `avatars/${userAId}`,
          `avatars/${userBId}`,
          `${userAId}/${setAPrivateId}`,
          `${userAId}/${setASharedId}`,
          `${userBId}/${setBId}`,
        ]) {
          if (!prefix || prefix.includes("//")) continue;
          const { data: list } = await bucket.list(prefix, { limit: 100 });
          for (const item of list ?? []) {
            if (item.name) toRemove.add(`${prefix}/${item.name}`);
          }
        }
        if (toRemove.size > 0) {
          await bucket.remove(Array.from(toRemove));
        }
      } finally {
        // 2. Always delete BOTH disposable accounts (cascades all DB rows via 0011 FK SET NULL fix)
        const delErrors: string[] = [];
        if (userAId) {
          const rA = await admin.auth.admin.deleteUser(userAId);
          if (rA.error) delErrors.push(`User A delete failed: ${rA.error.message}`);
        }
        if (userBId) {
          const rB = await admin.auth.admin.deleteUser(userBId);
          if (rB.error) delErrors.push(`User B delete failed: ${rB.error.message}`);
        }
        if (delErrors.length > 0) {
          throw new Error(delErrors.join("; "));
        }
      }
    }, 60_000);

    it("SH-001 (SEC-001 & SEC-023): blocks Editor B ownership hijack, visibility/archive/favorite escalation, and direct question_count tampering", async () => {
      // 1. Editor B attempts owner_id hijack
      const hijack = await clientB
        .from("study_sets")
        .update({ owner_id: userBId })
        .eq("id", setASharedId);
      expect(hijack.error).not.toBeNull();

      // 2. Editor B attempts visibility change
      const visEsc = await clientB
        .from("study_sets")
        .update({ visibility: "public" })
        .eq("id", setASharedId);
      expect(visEsc.error).not.toBeNull();

      // 3. Editor B attempts is_archived / is_favorite tampering
      const archEsc = await clientB
        .from("study_sets")
        .update({ is_archived: true })
        .eq("id", setASharedId);
      expect(archEsc.error).not.toBeNull();

      const favEsc = await clientB
        .from("study_sets")
        .update({ is_favorite: true })
        .eq("id", setASharedId);
      expect(favEsc.error).not.toBeNull();

      // 4. Direct question_count tamper blocked for BOTH editor and owner
      const qCountB = await clientB
        .from("study_sets")
        .update({ question_count: 9999 })
        .eq("id", setASharedId);
      expect(qCountB.error).not.toBeNull();

      const qCountA = await clientA
        .from("study_sets")
        .update({ question_count: 9999 })
        .eq("id", setASharedId);
      expect(qCountA.error).not.toBeNull();

      // 5. Legitimate editor metadata update still works
      const legitEdit = await clientB
        .from("study_sets")
        .update({ description: "Updated by authorized editor" })
        .eq("id", setASharedId)
        .select("owner_id, visibility, is_archived, is_favorite, question_count, description")
        .single();
      expect(legitEdit.error).toBeNull();
      expect(legitEdit.data).toMatchObject({
        owner_id: userAId,
        visibility: "shared",
        is_archived: false,
        is_favorite: false,
        question_count: 2,
        description: "Updated by authorized editor",
      });
    }, 30_000);

    it("SH-002 (SEC-002 & SEC-006): blocks forged friendship acceptance, participant swap, and blocked-user block deletion/unblock", async () => {
      // User A sends friend request to User B
      const { data: reqRow, error: reqErr } = await clientA
        .from("friendships")
        .insert({
          requester_id: userAId,
          addressee_id: userBId,
          status: "pending",
        })
        .select("id, status")
        .single();
      expect(reqErr).toBeNull();
      const friendshipId = reqRow!.id;

      // Requester A tries to self-accept
      const selfAccept = await clientA
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", friendshipId)
        .select("id");
      expect(selfAccept.error !== null || (selfAccept.data?.length ?? 0) === 0).toBe(true);

      // Requester A tries swapping requester_id/addressee_id to bypass trigger
      const swapAttempt = await clientA
        .from("friendships")
        .update({ requester_id: userBId, addressee_id: userAId, status: "accepted" })
        .eq("id", friendshipId)
        .select("id");
      expect(swapAttempt.error !== null || (swapAttempt.data?.length ?? 0) === 0).toBe(true);

      // Verify status is STILL pending
      const { data: stillPending } = await admin
        .from("friendships")
        .select("status, requester_id, addressee_id")
        .eq("id", friendshipId)
        .single();
      expect(stillPending).toMatchObject({
        status: "pending",
        requester_id: userAId,
        addressee_id: userBId,
      });

      // Addressee B accepts legitimately
      const acceptRes = await clientB
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", friendshipId)
        .select("status")
        .single();
      expect(acceptRes.error).toBeNull();
      expect(acceptRes.data?.status).toBe("accepted");

      // User A blocks User B
      const blockRes = await clientA
        .from("friendships")
        .update({ status: "blocked", blocked_by: userAId })
        .eq("id", friendshipId)
        .select("status, blocked_by")
        .single();
      expect(blockRes.error).toBeNull();
      expect(blockRes.data).toMatchObject({
        status: "blocked",
        blocked_by: userAId,
      });

      // Blocked User B tries to un-block via UPDATE -> MUST FAIL
      const unblockByVictim = await clientB
        .from("friendships")
        .update({ status: "accepted" })
        .eq("id", friendshipId)
        .select("id");
      expect(
        unblockByVictim.error !== null || (unblockByVictim.data?.length ?? 0) === 0,
      ).toBe(true);

      // Blocked User B tries to hijack blocked_by -> MUST FAIL
      const hijackBlock = await clientB
        .from("friendships")
        .update({ blocked_by: userBId })
        .eq("id", friendshipId)
        .select("id");
      expect(
        hijackBlock.error !== null || (hijackBlock.data?.length ?? 0) === 0,
      ).toBe(true);

      // Blocked User B tries to DELETE the block row -> MUST FAIL (0 rows deleted)
      const deleteByVictim = await clientB
        .from("friendships")
        .delete()
        .eq("id", friendshipId)
        .select("id");
      expect(deleteByVictim.data?.length ?? 0).toBe(0);

      // Confirm row still exists and remains blocked by A
      const { data: stillBlocked } = await admin
        .from("friendships")
        .select("status, blocked_by")
        .eq("id", friendshipId)
        .single();
      expect(stillBlocked).toMatchObject({
        status: "blocked",
        blocked_by: userAId,
      });

      // Blocker A cleans up (unblocks) so subsequent profile/storage tests are isolated
      const cleanupBlock = await clientA
        .from("friendships")
        .delete()
        .eq("id", friendshipId)
        .select("id");
      expect(cleanupBlock.error).toBeNull();
      expect(cleanupBlock.data?.length).toBe(1);
    }, 30_000);

    it("SH-012 (SEC-003): blocks cross-tenant mismatched (study_set_id, question_id) composite FK injection", async () => {
      // User B supplies their own study_set_id (setBId) paired with User A's private question_id (qAPrivateId)
      const optInject = await clientB.from("question_options").insert({
        study_set_id: setBId,
        question_id: qAPrivateId,
        position: 9,
        label: "Z",
        content: "Injected option",
        is_correct: true,
      });
      expect(optInject.error).not.toBeNull();
      expect(optInject.error?.code).toBe("23503");

      const accInject = await clientB.from("question_accepted_answers").insert({
        study_set_id: setBId,
        question_id: qAPrivateId,
        answer_text: "injected",
        normalized_answer: "injected",
        match_mode: "exact",
      });
      expect(accInject.error).not.toBeNull();
      expect(accInject.error?.code).toBe("23503");

      const starInject = await clientB.from("starred_questions").insert({
        user_id: userBId,
        study_set_id: setBId,
        question_id: qAPrivateId,
      });
      expect(starInject.error).not.toBeNull();
      expect(starInject.error?.code).toBe("23503");

      const progInject = await clientB.from("user_question_progress").insert({
        user_id: userBId,
        study_set_id: setBId,
        question_id: qAPrivateId,
        mastery_level: "mastered",
      });
      expect(progInject.error).not.toBeNull();
      expect(progInject.error?.code).toBe("23503");
    }, 30_000);

    it("SH-013 (SEC-004) & Exam Integrity: revokes V1 create_exam_attempt, blocks answer-key SELECT, blocks direct score tampering, and enforces server-side grading", async () => {
      // 1. Revoked V1 create_exam_attempt MUST FAIL for authenticated caller
      const legacyRpc = await clientA.rpc("create_exam_attempt", {
        p_study_set_id: setASharedId,
        p_title_snapshot: "Forged",
        p_config: {},
        p_duration_limit_seconds: 600,
        p_pass_threshold: 70,
        p_questions: [],
      });
      expect(legacyRpc.error).not.toBeNull();

      // 2. Duplicate question_id stuffing in create_exam_attempt_v2 MUST FAIL
      const dupStuff = await clientA.rpc("create_exam_attempt_v2", {
        p_title_snapshot: "Dup Attempt",
        p_primary_study_set_id: setASharedId,
        p_sources: [{ source_type: "study_set", study_set_id: setASharedId }],
        p_selected_items: [
          { question_id: qASharedMcId },
          { question_id: qASharedMcId },
        ],
        p_config: {},
        p_duration_limit_seconds: 600,
        p_pass_threshold: 70,
      });
      expect(dupStuff.error).not.toBeNull();

      // 3. Unauthorized p_sources probe by User B referencing User A's private set/folder MUST FAIL
      const probeSources = await clientB.rpc("create_exam_attempt_v2", {
        p_title_snapshot: "Probe Sources",
        p_primary_study_set_id: setASharedId,
        p_sources: [{ source_type: "study_set", study_set_id: setAPrivateId }],
        p_selected_items: [{ question_id: qASharedMcId }],
        p_config: {},
        p_duration_limit_seconds: 600,
        p_pass_threshold: 70,
      });
      expect(probeSources.error).not.toBeNull();

      // 4. Legitimate create_exam_attempt_v2 by User A
      const created = await clientA.rpc("create_exam_attempt_v2", {
        p_title_snapshot: "Live Sec Exam",
        p_primary_study_set_id: setASharedId,
        p_sources: [
          {
            source_type: "study_set",
            study_set_id: setASharedId,
            subject_title_snapshot: "Sec Shared Set A",
            eligible_count: 2,
            allocated_count: 2,
          },
        ],
        p_selected_items: [
          { question_id: qASharedMcId },
          { question_id: qASharedShortId },
        ],
        p_config: {},
        p_duration_limit_seconds: 600,
        p_pass_threshold: 70,
      });
      expect(created.error).toBeNull();
      const payload = created.data as {
        attempt: { id: string; status: string };
        questions: Array<Record<string, unknown>>;
      };
      attemptAId = payload.attempt.id;
      expect(payload.attempt.status).toBe("in_progress");
      expect(payload.questions).toHaveLength(2);

      // Verify ZERO answer keys or explanations in pre-submit RPC payload
      for (const q of payload.questions) {
        expect(q).not.toHaveProperty("correct_option_ids");
        expect(q).not.toHaveProperty("accepted_answers_snapshot");
        expect(q).not.toHaveProperty("explanation_snapshot");
        const opts = (q.options_snapshot ?? []) as Array<Record<string, unknown>>;
        for (const o of opts) {
          expect(o).not.toHaveProperty("is_correct");
        }
      }

      // 5. Direct PostgREST SELECT of sensitive columns on exam_attempt_questions MUST FAIL (42501)
      const directSecretSelect = await clientA
        .from("exam_attempt_questions")
        .select("id, correct_option_ids, accepted_answers_snapshot, explanation_snapshot")
        .eq("attempt_id", attemptAId);
      expect(directSecretSelect.error).not.toBeNull();
      expect(directSecretSelect.error?.code).toBe("42501");

      // Safe columns SELECT works (and still contains zero answer keys)
      const safeSelect = await clientA
        .from("exam_attempt_questions")
        .select("id, prompt_snapshot, options_snapshot")
        .eq("attempt_id", attemptAId);
      expect(safeSelect.error).toBeNull();
      expect(safeSelect.data).toHaveLength(2);

      // 6. Pre-submit get_exam_attempt_detail MUST strip answer keys
      const preDetail = await clientA.rpc("get_exam_attempt_detail", {
        p_attempt_id: attemptAId,
      });
      expect(preDetail.error).toBeNull();
      const preQuestions = (preDetail.data as { questions: Array<Record<string, unknown>> })
        .questions;
      for (const q of preQuestions) {
        expect(q).not.toHaveProperty("correct_option_ids");
        expect(q).not.toHaveProperty("accepted_answers_snapshot");
        expect(q).not.toHaveProperty("explanation_snapshot");
      }

      // 7. Direct UPDATE exam_attempts SET score_percent = 100 MUST FAIL (no UPDATE policy!)
      const tamperScore = await clientA
        .from("exam_attempts")
        .update({ score_percent: 100, passed: true, status: "submitted" })
        .eq("id", attemptAId)
        .select("id");
      expect(
        tamperScore.error !== null || (tamperScore.data?.length ?? 0) === 0,
      ).toBe(true);

      // Confirm status is STILL in_progress with score_percent = 0
      const { data: checkAttempt } = await admin
        .from("exam_attempts")
        .select("status, score_percent")
        .eq("id", attemptAId)
        .single();
      expect(checkAttempt?.status).toBe("in_progress");
      expect(Number(checkAttempt?.score_percent)).toBe(0);

      // 8. Cross-user exam access, autosave, & submit by User B MUST leak zero data / fail
      const crossDetail = await clientB.rpc("get_exam_attempt_detail", {
        p_attempt_id: attemptAId,
      });
      expect(crossDetail.data).toBeNull();

      const crossSave = await clientB.rpc("save_exam_attempt_answers", {
        p_attempt_id: attemptAId,
        p_answers: [],
      });
      expect(crossSave.error).not.toBeNull();

      const crossSubmit = await clientB.rpc("submit_exam_attempt", {
        p_attempt_id: attemptAId,
      });
      expect(crossSubmit.error).not.toBeNull();

      // 9. Save valid answers & submit (verifies numeric '0' + idempotent double submit!)
      const mcAttemptQ = payload.questions.find(
        (q) => q.question_id === qASharedMcId,
      )!;
      const shortAttemptQ = payload.questions.find(
        (q) => q.question_id === qASharedShortId,
      )!;

      const saveRes = await clientA.rpc("save_exam_attempt_answers", {
        p_attempt_id: attemptAId,
        p_answers: [
          {
            attempt_question_id: mcAttemptQ.id,
            selected_option_ids: [qASharedOptCorrectId],
            typed_answer: null,
            is_flagged: false,
            client_seq: 1,
          },
          {
            attempt_question_id: shortAttemptQ.id,
            selected_option_ids: [],
            typed_answer: "0",
            is_flagged: false,
            client_seq: 1,
          },
        ],
      });
      expect(saveRes.error).toBeNull();

      const sub1 = await clientA.rpc("submit_exam_attempt", {
        p_attempt_id: attemptAId,
      });
      expect(sub1.error).toBeNull();
      const sub1Attempt = (sub1.data as { attempt: { score_percent: number; status: string; correct_count: number } }).attempt;
      expect(sub1Attempt.status).toBe("submitted");
      expect(sub1Attempt.correct_count).toBe(2);
      expect(Number(sub1Attempt.score_percent)).toBe(100);

      // Double-submit idempotency: score and progress counts remain identical
      const { data: progBefore } = await admin
        .from("user_question_progress")
        .select("correct_count")
        .eq("user_id", userAId)
        .eq("question_id", qASharedMcId)
        .single();

      const sub2 = await clientA.rpc("submit_exam_attempt", {
        p_attempt_id: attemptAId,
      });
      expect(sub2.error).toBeNull();

      const { data: progAfter } = await admin
        .from("user_question_progress")
        .select("correct_count")
        .eq("user_id", userAId)
        .eq("question_id", qASharedMcId)
        .single();
      expect(progAfter?.correct_count).toBe(progBefore?.correct_count);

      // 10. Migration 0011: snapshot content stays 100% immutable even for admin/service_role
      const mutateSnap = await admin
        .from("exam_attempt_questions")
        .update({ prompt_snapshot: "Tampered prompt" })
        .eq("id", mcAttemptQ.id);
      expect(mutateSnap.error).not.toBeNull();
    }, 30_000);

    it("SH-014 (SEC-005 & SEC-013): revokes profiles.email column SELECT, scopes get_my_profile() to self, and enforces URL CHECKs", async () => {
      // 1. Collaborator B cannot SELECT email or * from profiles
      const selectEmail = await clientB
        .from("profiles")
        .select("id, email")
        .eq("id", userAId);
      expect(selectEmail.error).not.toBeNull();
      expect(selectEmail.error?.code).toBe("42501");

      const selectStar = await clientB
        .from("profiles")
        .select("*")
        .eq("id", userAId);
      expect(selectStar.error).not.toBeNull();
      expect(selectStar.error?.code).toBe("42501");

      // 2. Safe non-email projection works for collaborator
      const safeProj = await clientB
        .from("profiles")
        .select("id, display_name, username, avatar_url, bio")
        .eq("id", userAId)
        .single();
      expect(safeProj.error).toBeNull();
      expect(safeProj.data?.id).toBe(userAId);
      expect(safeProj.data).not.toHaveProperty("email");

      // 3. get_my_profile() returns ONLY caller's email
      const myProfA = await clientA.rpc("get_my_profile");
      expect(myProfA.error).toBeNull();
      const profRowA = Array.isArray(myProfA.data) ? myProfA.data[0] : myProfA.data;
      expect(profRowA.id).toBe(userAId);
      expect(profRowA.email).toBe(emailA);

      const myProfB = await clientB.rpc("get_my_profile");
      expect(myProfB.error).toBeNull();
      const profRowB = Array.isArray(myProfB.data) ? myProfB.data[0] : myProfB.data;
      expect(profRowB.id).toBe(userBId);
      expect(profRowB.email).toBe(emailB);

      // 4. Direct profiles.email tamper & unsafe avatar_url schemes blocked
      const emailTamper = await clientA
        .from("profiles")
        .update({ email: "spoofed@evil.example" })
        .eq("id", userAId);
      expect(emailTamper.error).not.toBeNull();

      for (const badUrl of [
        "javascript:alert(1)",
        "//evil.example/a.png",
        "/\\evil.example/a.png",
      ]) {
        const badAvatar = await clientA
          .from("profiles")
          .update({ avatar_url: badUrl })
          .eq("id", userAId);
        expect(badAvatar.error, `Expected CHECK rejection for ${badUrl}`).not.toBeNull();
      }
    }, 30_000);

    it("SH-015 (SEC-007) & SEC-009: blocks 'unlisted' enumeration and blocks cross-user RLS helper oracle probing live on PG 17.12", async () => {
      // Switch setAPrivateId temporarily to 'unlisted'
      const setUnlisted = await clientA
        .from("study_sets")
        .update({ visibility: "unlisted" })
        .eq("id", setAPrivateId);
      expect(setUnlisted.error).toBeNull();

      // Neither anon nor User B can read 'unlisted' set via PostgREST table scan
      const anonScan = await anonClient
        .from("study_sets")
        .select("id")
        .eq("id", setAPrivateId);
      expect(anonScan.error).toBeNull();
      expect(anonScan.data ?? []).toHaveLength(0);

      const userBScan = await clientB
        .from("study_sets")
        .select("id")
        .eq("id", setAPrivateId);
      expect(userBScan.error).toBeNull();
      expect(userBScan.data ?? []).toHaveLength(0);

      // Restore visibility back to 'private'
      await clientA
        .from("study_sets")
        .update({ visibility: "private" })
        .eq("id", setAPrivateId);

      // SEC-009 Live PG 17.12 Oracle Check: User B passing User A's UUID MUST get false!
      const oracleRead = await clientB.rpc("can_read_study_set", {
        p_set_id: setAPrivateId,
        p_user_id: userAId,
      });
      expect(oracleRead.error).toBeNull();
      expect(oracleRead.data).toBe(false);

      const oracleOwner = await clientB.rpc("is_study_set_owner", {
        p_set_id: setAPrivateId,
        p_user_id: userAId,
      });
      expect(oracleOwner.error).toBeNull();
      expect(oracleOwner.data).toBe(false);

      const oracleEdit = await clientB.rpc("can_edit_study_set", {
        p_set_id: setAPrivateId,
        p_user_id: userAId,
      });
      expect(oracleEdit.error).toBeNull();
      expect(oracleEdit.data).toBe(false);

      const oracleProf = await clientB.rpc("can_view_profile", {
        p_profile_id: userAId,
        p_viewer_id: userAId,
      });
      expect(oracleProf.error).toBeNull();
      expect(oracleProf.data).toBe(false);

      // Anon probing User A's private set with User A's UUID MUST also return false!
      const anonOracle = await anonClient.rpc("can_read_study_set", {
        p_set_id: setAPrivateId,
        p_user_id: userAId,
      });
      expect(anonOracle.error).toBeNull();
      expect(anonOracle.data).toBe(false);

      // 0007 folders RLS & is_folder_owner() live verification:
      // 1. User A can create nested subfolder under folderAId (no 42P17 recursion!)
      const childFolderA = await clientA
        .from("folders")
        .insert({ owner_id: userAId, parent_id: folderAId, name: "Child Folder A" })
        .select("id")
        .single();
      expect(childFolderA.error).toBeNull();

      // 2. User B cannot create a folder parented under User A's folder
      const hijackParentB = await clientB
        .from("folders")
        .insert({ owner_id: userBId, parent_id: folderAId, name: "Hijack Child" })
        .select("id");
      expect(hijackParentB.error).not.toBeNull();

      // 3. User B cannot probe is_folder_owner(folderAId, userAId) oracle
      const oracleFolder = await clientB.rpc("is_folder_owner", {
        p_folder_id: folderAId,
        p_user_id: userAId,
      });
      expect(oracleFolder.error).toBeNull();
      expect(oracleFolder.data).toBe(false);

      // 4. Anon cannot execute is_folder_owner
      const anonFolder = await anonClient.rpc("is_folder_owner", {
        p_folder_id: folderAId,
        p_user_id: userAId,
      });
      expect(anonFolder.error).not.toBeNull();
      expect(anonFolder.error?.code).toBe("42501");

      // 0009 tags <-> question_tags mutual-recursion fix & can_read_tag() live verification:
      const { data: tagA, error: tagAErr } = await clientA
        .from("tags")
        .insert({ owner_id: userAId, name: "Private Tag A", slug: "private-tag-a" })
        .select("id")
        .single();
      expect(tagAErr).toBeNull();

      const linkTagA = await clientA.from("question_tags").insert({
        study_set_id: setAPrivateId,
        question_id: qAPrivateId,
        tag_id: tagA!.id,
      });
      expect(linkTagA.error).toBeNull();

      // User B cannot read User A's private tag or probe can_read_tag(tagA, userA) oracle
      const readTagB = await clientB.from("tags").select("id").eq("id", tagA!.id);
      expect(readTagB.error).toBeNull();
      expect(readTagB.data ?? []).toHaveLength(0);

      const oracleTag = await clientB.rpc("can_read_tag", {
        p_tag_id: tagA!.id,
        p_user_id: userAId,
      });
      expect(oracleTag.error).toBeNull();
      expect(oracleTag.data).toBe(false);

      const anonTag = await anonClient.rpc("can_read_tag", {
        p_tag_id: tagA!.id,
        p_user_id: userAId,
      });
      expect(anonTag.error).not.toBeNull();
      expect(anonTag.error?.code).toBe("42501");
    }, 30_000);

    it("SH-019 (SEC-011): enforces private study-media Storage RLS, allows real PNG for owner, and rejects SVG & cross-user access", async () => {
      const avatarPathA = `avatars/${userAId}/${randomUUID()}.png`;
      const privateMediaPathA = `${userAId}/${setAPrivateId}/${randomUUID()}.png`;
      const svgPathA = `avatars/${userAId}/${randomUUID()}.svg`;
      const unauthorizedUploadByB = `${userAId}/${setAPrivateId}/${randomUUID()}.png`;
      const unauthorizedAvatarByB = `avatars/${userAId}/${randomUUID()}.png`;

      // 1. User A uploads valid PNG to own avatar & own private set -> SUCCEEDS
      const upAvatar = await clientA.storage
        .from("study-media")
        .upload(avatarPathA, VALID_PNG_BYTES, { contentType: "image/png" });
      expect(upAvatar.error).toBeNull();
      uploadedStoragePaths.push(avatarPathA);

      const upPriv = await clientA.storage
        .from("study-media")
        .upload(privateMediaPathA, VALID_PNG_BYTES, { contentType: "image/png" });
      expect(upPriv.error).toBeNull();
      uploadedStoragePaths.push(privateMediaPathA);

      // 2. Bucket rejects image/svg+xml (XSS vector)
      const upSvg = await clientA.storage
        .from("study-media")
        .upload(svgPathA, EVIL_SVG_BYTES, { contentType: "image/svg+xml" });
      expect(upSvg.error).not.toBeNull();

      // 3. User B cannot download or mint signed URL for User A's private set media
      const dlPrivByB = await clientB.storage
        .from("study-media")
        .download(privateMediaPathA);
      expect(dlPrivByB.error).not.toBeNull();

      const signPrivByB = await clientB.storage
        .from("study-media")
        .createSignedUrl(privateMediaPathA, 60);
      expect(signPrivByB.error).not.toBeNull();

      // 4. User B cannot upload into User A's private set or User A's avatar prefix
      const injectSetByB = await clientB.storage
        .from("study-media")
        .upload(unauthorizedUploadByB, VALID_PNG_BYTES, { contentType: "image/png" });
      expect(injectSetByB.error).not.toBeNull();

      const injectAvatarByB = await clientB.storage
        .from("study-media")
        .upload(unauthorizedAvatarByB, VALID_PNG_BYTES, { contentType: "image/png" });
      expect(injectAvatarByB.error).not.toBeNull();

      // 5. Anon cannot download User A's private avatar or study media
      const dlAnon = await anonClient.storage
        .from("study-media")
        .download(avatarPathA);
      expect(dlAnon.error).not.toBeNull();
    }, 30_000);

    it("SH-020 (SEC-012) & Revocation Safety: enforces allow_clone = false, share link revocation, and immediate post-revocation preset/access lockdown", async () => {
      const shareToken = randomBytes(24).toString("base64url");
      const { data: linkRow, error: linkErr } = await clientA
        .from("study_set_share_links")
        .insert({
          study_set_id: setAPrivateId,
          created_by: userAId,
          token: shareToken,
          permission: "viewer",
          allow_clone: false,
        })
        .select("id")
        .single();
      expect(linkErr).toBeNull();

      // User B redeems the viewer / allow_clone=false share link
      const redeemRes = await clientB.rpc("redeem_share_link", {
        p_token: shareToken,
      });
      expect(redeemRes.error).toBeNull();
      expect(redeemRes.data).toMatchObject({
        study_set_id: setAPrivateId,
        role: "viewer",
        allow_clone: false,
      });

      // User B tries cloning -> MUST FAIL with 42501
      const cloneAttempt = await clientB.rpc("clone_study_set", {
        p_source_set_id: setAPrivateId,
      });
      expect(cloneAttempt.error).not.toBeNull();
      expect(cloneAttempt.error?.code).toBe("42501");

      // User B saves a preset referencing setAPrivateId while they still have viewer access
      const { data: pB, error: pBErr } = await clientB
        .from("exam_presets")
        .insert({
          user_id: userBId,
          name: "B Preset on A Private",
          requested_question_count: 1,
        })
        .select("id")
        .single();
      expect(pBErr).toBeNull();
      presetBOnPrivateId = pB!.id;

      const { error: pBSrcErr } = await clientB.from("exam_preset_sources").insert({
        preset_id: presetBOnPrivateId,
        source_type: "study_set",
        study_set_id: setAPrivateId,
        sort_order: 0,
      });
      expect(pBSrcErr).toBeNull();

      // User A revokes the share link AND removes User B's membership
      await clientA
        .from("study_set_share_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", linkRow!.id);

      await clientA
        .from("study_set_members")
        .delete()
        .eq("study_set_id", setAPrivateId)
        .eq("user_id", userBId);

      // Re-redeeming revoked share link returns error_code: REVOKED
      const revokedRedeem = await clientB.rpc("redeem_share_link", {
        p_token: shareToken,
      });
      expect(revokedRedeem.error).toBeNull();
      expect(revokedRedeem.data).toMatchObject({ error_code: "REVOKED" });

      // Post-revocation: User B's saved preset CANNOT read any questions from setAPrivateId
      const poolAfterRevoke = await clientB.rpc("get_exam_eligible_pool", {
        p_folder_ids: [],
        p_study_set_ids: [setAPrivateId],
        p_include_subfolders: true,
        p_filters: {},
        p_selection_policy: "random",
      });
      expect(poolAfterRevoke.error).toBeNull();
      expect((poolAfterRevoke.data as { total_eligible: number }).total_eligible).toBe(0);
    }, 30_000);

    it("Cross-Account Isolation & Multi-Subject Session RLS: User B reads 0 rows of User A's private/V2.0 records", async () => {
      const checks = await Promise.all([
        clientB.from("folders").select("id").eq("id", folderAId),
        clientB.from("user_question_progress").select("id").eq("user_id", userAId),
        clientB.from("starred_questions").select("question_id").eq("user_id", userAId),
        clientB.from("study_sessions").select("id").eq("id", sessionAId),
        clientB.from("exam_attempts").select("id").eq("id", attemptAId),
        clientB.from("exam_attempt_sources").select("id").eq("attempt_id", attemptAId),
        clientB.from("exam_presets").select("id").eq("id", presetAId),
        clientB.from("exam_preset_sources").select("id").eq("preset_id", presetAId),
        clientB.from("coverage_cycles").select("id").eq("id", cycleAId),
        clientB.from("coverage_cycle_questions").select("id").eq("cycle_id", cycleAId),
        clientB.from("coverage_cycle_attempts").select("id").eq("cycle_id", cycleAId),
      ]);

      for (const res of checks) {
        expect(res.error).toBeNull();
        expect(res.data ?? []).toHaveLength(0);
      }

      // User B cannot attach User A's private set inside study_sessions.source_study_set_ids
      const badSess = await clientB.from("study_sessions").insert({
        user_id: userBId,
        study_set_id: setBId,
        source_study_set_ids: [setBId, setAPrivateId],
        mode: "practice",
        total_items: 1,
      });
      expect(badSess.error).not.toBeNull();
      expect(badSess.error?.code).toBe("42501");

      // User B calling get_coverage_cycle_subject_progress with User A's cycleId returns 0 rows
      const cycleProg = await clientB.rpc("get_coverage_cycle_subject_progress", {
        p_cycle_ids: [cycleAId],
      });
      expect(cycleProg.error).toBeNull();
      expect(cycleProg.data ?? []).toHaveLength(0);
    }, 30_000);

    it("Migration 0006 Lockdown: blocks anon from executing all revoked SECURITY DEFINER RPCs", async () => {
      const dummyUuid = randomUUID();
      const revokedAnonCalls = [
        anonClient.rpc("get_my_profile"),
        anonClient.rpc("submit_exam_attempt", { p_attempt_id: dummyUuid }),
        anonClient.rpc("get_exam_attempt_detail", { p_attempt_id: dummyUuid }),
        anonClient.rpc("save_exam_attempt_answers", {
          p_attempt_id: dummyUuid,
          p_answers: [],
        }),
        anonClient.rpc("create_exam_attempt", {
          p_study_set_id: dummyUuid,
          p_title_snapshot: "x",
          p_config: {},
          p_duration_limit_seconds: 60,
          p_pass_threshold: 70,
          p_questions: [],
        }),
        anonClient.rpc("create_exam_attempt_v2", {
          p_title_snapshot: "x",
          p_primary_study_set_id: null,
          p_sources: [],
          p_selected_items: [],
          p_config: {},
          p_duration_limit_seconds: 60,
          p_pass_threshold: 70,
        }),
        anonClient.rpc("resolve_deduped_study_sets", {
          p_folder_ids: [],
          p_study_set_ids: [],
          p_include_subfolders: true,
        }),
        anonClient.rpc("get_exam_eligible_pool", {
          p_folder_ids: [],
          p_study_set_ids: [],
          p_include_subfolders: true,
          p_filters: {},
          p_selection_policy: "random",
        }),
        anonClient.rpc("create_coverage_cycle", {
          p_title: "x",
          p_source_snapshot: [],
          p_filter_snapshot: {},
          p_allocation_strategy: "proportional",
          p_questions_per_exam: 1,
          p_pool_items: [],
        }),
        anonClient.rpc("discard_coverage_cycle_active_exam", {
          p_cycle_id: dummyUuid,
        }),
        anonClient.rpc("restart_coverage_cycle", { p_cycle_id: dummyUuid }),
        anonClient.rpc("get_coverage_cycle_subject_progress", {
          p_cycle_ids: [dummyUuid],
        }),
        anonClient.rpc("clone_study_set", { p_source_set_id: dummyUuid }),
        anonClient.rpc("redeem_share_link", { p_token: "invalid-token-value" }),
        anonClient.rpc("find_profile_by_username_or_email", {
          p_query: "nobody@example.com",
        }),
        anonClient.rpc("get_practice_question_pool", {
          p_folder_ids: [],
          p_study_set_ids: [],
          p_include_subfolders: true,
          p_filters: {},
          p_selection_policy: "random",
          p_count: 10,
          p_shuffle: false,
        }),
      ];

      const results = await Promise.all(revokedAnonCalls);
      for (let i = 0; i < results.length; i += 1) {
        const res = results[i];
        expect(
          res.error,
          `Expected anon RPC call #${i} to be denied with 42501`,
        ).not.toBeNull();
        expect(res.error?.code).toBe("42501");
      }
    }, 30_000);

    const runLiveHttp = LIVE_API_BASE_URL ? it : it.skip;

    runLiveHttp(
      "Live HTTP API Security: enforces 401 guards, prod CSP/HSTS, open-redirect blocks, SVG/size upload caps, signed-url proxy, allow_clone=false 403, no email leaks, and exam anti-leak",
      async () => {
        if (!LIVE_CONFIG || !LIVE_API_BASE_URL) return;

        // 1. Unauthenticated API guards & proxy redirect checks
        for (const ep of [
          "/api/sets",
          "/api/exams",
          "/api/exam-presets",
          "/api/coverage-cycles",
          "/api/account/data",
        ]) {
          const r = await fetch(`${LIVE_API_BASE_URL}${ep}`, {
            redirect: "manual",
          });
          expect(r.status, `Expected 401 on ${ep}`).toBe(401);
        }

        const dashRedirect = await fetch(`${LIVE_API_BASE_URL}/dashboard`, {
          redirect: "manual",
        });
        expect(dashRedirect.status).toBe(307);
        const dashLoc = dashRedirect.headers.get("location") ?? "";
        expect(dashLoc).toContain("/login");
        expect(dashLoc).not.toContain("setup=1");

        // Open-redirect guard on /auth/callback and /auth/confirm
        for (const authUrl of [
          "/auth/callback?next=//evil.example",
          "/auth/confirm?next=/\\evil.example",
        ]) {
          const r = await fetch(`${LIVE_API_BASE_URL}${authUrl}`, {
            redirect: "manual",
          });
          expect([302, 303, 307]).toContain(r.status);
          const loc = r.headers.get("location") ?? "";
          expect(loc).not.toContain("evil.example");
        }

        // Production security headers on /
        const homeRes = await fetch(`${LIVE_API_BASE_URL}/`);
        expect(homeRes.status).toBe(200);
        const csp = homeRes.headers.get("content-security-policy") ?? "";
        expect(csp).not.toContain("unsafe-eval");
        expect(csp).not.toContain("127.0.0.1");
        expect(csp).not.toContain("localhost");
        expect(homeRes.headers.get("strict-transport-security")).toContain(
          "max-age=63072000",
        );
        expect(homeRes.headers.get("x-frame-options")).toBe("DENY");
        expect(homeRes.headers.get("x-content-type-options")).toBe("nosniff");

        // Mint real @supabase/ssr auth cookie headers for User A & User B
        [cookieA, cookieB] = await Promise.all([
          mintSsrCookieHeader(LIVE_CONFIG, emailA, testPassword),
          mintSsrCookieHeader(LIVE_CONFIG, emailB, testPassword),
        ]);

        // 2. POST /api/uploads/image: valid PNG succeeds; SVG, spoofed SVG-as-PNG, >5MB, & cross-user fail
        const pngForm = new FormData();
        pngForm.append(
          "file",
          new File([VALID_PNG_BYTES], "avatar.png", { type: "image/png" }),
        );
        pngForm.append("purpose", "avatar");
        const upOk = await fetch(`${LIVE_API_BASE_URL}/api/uploads/image`, {
          method: "POST",
          headers: { Cookie: cookieA },
          body: pngForm,
        });
        expect(upOk.status).toBe(201);
        const upOkJson = (await upOk.json()) as {
          data: { path: string; proxyUrl: string; signedUrl: string };
        };
        uploadedStoragePaths.push(upOkJson.data.path);
        expect(upOkJson.data.proxyUrl).toMatch(
          /^\/api\/uploads\/signed-url\?path=.*&redirect=1$/,
        );

        // Private set media upload as User A
        const qForm = new FormData();
        qForm.append(
          "file",
          new File([VALID_PNG_BYTES], "q.png", { type: "image/png" }),
        );
        qForm.append("purpose", "question");
        qForm.append("studySetId", setAPrivateId);
        const upQOk = await fetch(`${LIVE_API_BASE_URL}/api/uploads/image`, {
          method: "POST",
          headers: { Cookie: cookieA },
          body: qForm,
        });
        expect(upQOk.status).toBe(201);
        const upQJson = (await upQOk.json()) as {
          data: { path: string; proxyUrl: string };
        };
        uploadedStoragePaths.push(upQJson.data.path);

        // SVG & spoofed SVG-as-PNG rejected (415)
        for (const [fname, mime] of [
          ["xss.svg", "image/svg+xml"],
          ["spoofed.png", "image/png"],
        ] as const) {
          const svgForm = new FormData();
          svgForm.append("file", new File([EVIL_SVG_BYTES], fname, { type: mime }));
          svgForm.append("purpose", "avatar");
          const upSvg = await fetch(`${LIVE_API_BASE_URL}/api/uploads/image`, {
            method: "POST",
            headers: { Cookie: cookieA },
            body: svgForm,
          });
          expect(upSvg.status).toBe(415);
        }

        // >5 MB image rejected with 413
        const bigForm = new FormData();
        bigForm.append(
          "file",
          new File([new Uint8Array(5 * 1024 * 1024 + 128)], "huge.png", {
            type: "image/png",
          }),
        );
        bigForm.append("purpose", "avatar");
        const upBig = await fetch(`${LIVE_API_BASE_URL}/api/uploads/image`, {
          method: "POST",
          headers: { Cookie: cookieA },
          body: bigForm,
        });
        expect(upBig.status).toBe(413);

        // User B uploading to User A's private set -> 403
        const crossUploadForm = new FormData();
        crossUploadForm.append(
          "file",
          new File([VALID_PNG_BYTES], "x.png", { type: "image/png" }),
        );
        crossUploadForm.append("purpose", "question");
        crossUploadForm.append("studySetId", setAPrivateId);
        const crossUp = await fetch(`${LIVE_API_BASE_URL}/api/uploads/image`, {
          method: "POST",
          headers: { Cookie: cookieB },
          body: crossUploadForm,
        });
        expect([403, 404]).toContain(crossUp.status);

        // 3. GET /api/uploads/signed-url?redirect=1
        const signedA = await fetch(`${LIVE_API_BASE_URL}${upQJson.data.proxyUrl}`, {
          headers: { Cookie: cookieA },
          redirect: "manual",
        });
        expect(signedA.status).toBe(302);
        expect(signedA.headers.get("cache-control")).toContain("private");
        expect(signedA.headers.get("vary")).toContain("Cookie");

        const signedB = await fetch(`${LIVE_API_BASE_URL}${upQJson.data.proxyUrl}`, {
          headers: { Cookie: cookieB },
          redirect: "manual",
        });
        expect(signedB.status).toBe(404);

        const traversal = await fetch(
          `${LIVE_API_BASE_URL}/api/uploads/signed-url?path=${encodeURIComponent("avatars/../../../etc/passwd")}`,
          { headers: { Cookie: cookieA } },
        );
        expect(traversal.status).toBe(400);

        // 4. GET /api/sets/[id]/members: zero email field in JSON
        const memRes = await fetch(
          `${LIVE_API_BASE_URL}/api/sets/${setASharedId}/members`,
          { headers: { Cookie: cookieB } },
        );
        expect(memRes.status).toBe(200);
        const memText = await memRes.text();
        expect(memText).not.toContain(emailA);
        expect(memText).not.toContain('"email"');

        // 5. allow_clone = false blocks HTTP /duplicate & /export with 403 + share link revoke returns 410
        const linkRes = await fetch(
          `${LIVE_API_BASE_URL}/api/sets/${setAPrivateId}/share-links`,
          {
            method: "POST",
            headers: {
              Cookie: cookieA,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ permission: "viewer", allow_clone: false }),
          },
        );
        expect(linkRes.status).toBe(201);
        const linkJson = (await linkRes.json()) as {
          data: { id: string; token: string };
        };

        const redeemHttp = await fetch(
          `${LIVE_API_BASE_URL}/api/share-links/${linkJson.data.token}/redeem`,
          { method: "POST", headers: { Cookie: cookieB } },
        );
        expect(redeemHttp.status).toBe(200);

        const dupDenied = await fetch(
          `${LIVE_API_BASE_URL}/api/sets/${setAPrivateId}/duplicate`,
          { method: "POST", headers: { Cookie: cookieB } },
        );
        expect(dupDenied.status).toBe(403);

        const expDenied = await fetch(
          `${LIVE_API_BASE_URL}/api/sets/${setAPrivateId}/export?format=json`,
          { headers: { Cookie: cookieB } },
        );
        expect(expDenied.status).toBe(403);

        // Revoke share link -> subsequent redeem returns 410
        const revokeHttp = await fetch(
          `${LIVE_API_BASE_URL}/api/sets/${setAPrivateId}/share-links/${linkJson.data.id}`,
          { method: "DELETE", headers: { Cookie: cookieA } },
        );
        expect(revokeHttp.status).toBe(200);

        const redeemAfterRevoke = await fetch(
          `${LIVE_API_BASE_URL}/api/share-links/${linkJson.data.token}/redeem`,
          { method: "POST", headers: { Cookie: cookieB } },
        );
        expect(redeemAfterRevoke.status).toBe(410);

        // 6. Live HTTP Exam Start & Pre-Submit Anti-Leak + Cross-User Isolation
        const startExam = await fetch(`${LIVE_API_BASE_URL}/api/exams`, {
          method: "POST",
          headers: {
            Cookie: cookieA,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            study_set_id: setASharedId,
            question_count: 2,
            duration_limit_seconds: 600,
          }),
        });
        expect(startExam.status).toBe(201);
        const startExamText = await startExam.text();
        expect(startExamText).not.toContain("correct_option_ids");
        expect(startExamText).not.toContain("accepted_answers_snapshot");
        expect(startExamText).not.toContain("explanation_snapshot");
        expect(startExamText).not.toContain('"is_correct"');
        const startExamJson = JSON.parse(startExamText) as {
          data: { attempt: { id: string } };
        };

        const crossExamGet = await fetch(
          `${LIVE_API_BASE_URL}/api/exams/${startExamJson.data.attempt.id}`,
          { headers: { Cookie: cookieB } },
        );
        expect([403, 404]).toContain(crossExamGet.status);

        // 7. Account backup export + restore round-trip
        const exportAcc = await fetch(`${LIVE_API_BASE_URL}/api/account/data`, {
          headers: { Cookie: cookieA },
        });
        expect(exportAcc.status).toBe(200);
        const accBackup = await exportAcc.json();
        const restoreAcc = await fetch(`${LIVE_API_BASE_URL}/api/account/restore`, {
          method: "POST",
          headers: {
            Cookie: cookieA,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(accBackup),
        });
        expect([200, 201]).toContain(restoreAcc.status);

        // 8. Signout endpoint clears session cleanly
        const signOutRes = await fetch(`${LIVE_API_BASE_URL}/auth/signout`, {
          method: "POST",
          headers: { Cookie: cookieA, Accept: "application/json" },
        });
        expect(signOutRes.status).toBe(200);
      },
      60_000,
    );
  },
);
