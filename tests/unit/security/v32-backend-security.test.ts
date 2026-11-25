import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CoverageCycle } from "@/types/domain";
import { apiError, apiSuccess } from "@/lib/security/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  streamBinaryResponse,
  streamJsonResponse,
} from "@/lib/security/stream-response";
import {
  sanitizePreSubmitTypePayload,
  stripPreSubmitQuestions,
} from "@/lib/supabase/exam-engine";
import {
  computeLiveCoverageMetrics,
  issueNextExamForCycle,
} from "@/lib/supabase/coverage-helper";
import { V3_BACKUP_SCOPE } from "@/lib/supabase/backup-scope";

function readRepoFile(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

describe("StudyHub V3.2 Backend Security, Reliability & Performance Regressions", () => {
  // -------------------------------------------------------------------------
  // V32-008 (SEC-04 / SEC-09): Private API caching defaults & short signed URLs
  // -------------------------------------------------------------------------
  describe("V32-008: API Cache-Control & Vary defaults + signed-url TTL hardening", () => {
    it("apiSuccess and apiError emit private, no-store and Vary: Cookie by default", () => {
      const okRes = apiSuccess({ hello: "world" });
      expect(okRes.headers.get("cache-control")).toBe("private, no-store");
      expect(okRes.headers.get("vary")).toBe("Cookie");

      const errRes = apiError("FORBIDDEN", "Access denied", 403);
      expect(errRes.headers.get("cache-control")).toBe("private, no-store");
      expect(errRes.headers.get("vary")).toBe("Cookie");
    });

    it("apiSuccess preserves explicit opt-in Cache-Control (e.g. static import templates) and merges Vary", () => {
      const staticRes = apiSuccess(
        { template: "csv" },
        undefined,
        {
          headers: {
            "Cache-Control": "public, max-age=3600",
            Vary: "Accept-Encoding",
          },
        },
      );
      expect(staticRes.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(staticRes.headers.get("vary")).toBe("Accept-Encoding, Cookie");
    });

    it("streamBinaryResponse and streamJsonResponse default to private, no-store and Vary: Cookie", () => {
      const binRes = streamBinaryResponse(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="sample.bin"',
        },
      });
      expect(binRes.headers.get("cache-control")).toBe("private, no-store");
      expect(binRes.headers.get("vary")).toBe("Cookie");

      const jsonRes = streamJsonResponse(
        { backup: true },
        {
          headers: {
            "Content-Disposition": 'attachment; filename="backup.json"',
          },
        },
      );
      expect(jsonRes.headers.get("cache-control")).toBe("private, no-store");
      expect(jsonRes.headers.get("vary")).toBe("Cookie");
    });

    it("signed-url enforces 5-minute TTL (300s), 60s revalidated private redirect cache, and no-store JSON", () => {
      const src = readRepoFile("src/app/api/uploads/signed-url/route.ts");
      expect(src).toContain("const SIGNED_URL_TTL_SECONDS = 300;");
      expect(src).toContain('"private, max-age=60, must-revalidate"');
      expect(src).toContain('"private, no-store"');
      expect(src).toContain('"Vary", "Cookie"');
      expect(src).not.toContain("max-age=1800");
    });
  });

  // -------------------------------------------------------------------------
  // V32-022 (FUNC-10c) & V32-051 (SEC-15): Pre-submit payload sanitization
  // -------------------------------------------------------------------------
  describe("V32-022 & V32-051: Pre-submit type_payload unit handling & deterministic md5 shuffling", () => {
    it("preserves numerical unit when unit_required is false, and strips unit when unit_required is true", () => {
      const optionalUnit = sanitizePreSubmitTypePayload(
        "numerical",
        {
          type: "numerical",
          correct_value: 9.81,
          tolerance: 0.05,
          tolerance_mode: "absolute",
          unit: "m/s^2",
          unit_required: false,
          significant_figures: 3,
        },
        "q-num-1",
      );
      expect(optionalUnit).toEqual({
        type: "numerical",
        unit_required: false,
        unit: "m/s^2",
        significant_figures: 3,
      });
      expect(optionalUnit).not.toHaveProperty("correct_value");
      expect(optionalUnit).not.toHaveProperty("tolerance");

      const requiredUnit = sanitizePreSubmitTypePayload(
        "numerical",
        {
          type: "numerical",
          correct_value: 9.81,
          tolerance: 0.05,
          tolerance_mode: "absolute",
          unit: "m/s^2",
          unit_required: true,
          significant_figures: 3,
        },
        "q-num-2",
      );
      expect(requiredUnit).toEqual({
        type: "numerical",
        unit_required: true,
        significant_figures: 3,
      });
      expect(requiredUnit).not.toHaveProperty("unit");
      expect(requiredUnit).not.toHaveProperty("correct_value");
    });

    it("deterministically permutes ordering items via md5(seed:id) defeating sequential item-1..item-N leak", () => {
      const sequentialItems = [
        { id: "item-1", text: "Step 1", correct_position: 0 },
        { id: "item-2", text: "Step 2", correct_position: 1 },
        { id: "item-3", text: "Step 3", correct_position: 2 },
        { id: "item-4", text: "Step 4", correct_position: 3 },
        { id: "item-5", text: "Step 5", correct_position: 4 },
        { id: "item-6", text: "Step 6", correct_position: 5 },
      ];

      const run1 = sanitizePreSubmitTypePayload(
        "ordering",
        { type: "ordering", allow_partial_credit: true, items: sequentialItems },
        "attempt-q-seed-alpha",
      ) as { items: Array<Record<string, unknown>> };
      const run2 = sanitizePreSubmitTypePayload(
        "ordering",
        { type: "ordering", allow_partial_credit: true, items: sequentialItems },
        "attempt-q-seed-alpha",
      ) as { items: Array<Record<string, unknown>> };
      const otherSeed = sanitizePreSubmitTypePayload(
        "ordering",
        { type: "ordering", allow_partial_credit: true, items: sequentialItems },
        "attempt-q-seed-beta",
      ) as { items: Array<Record<string, unknown>> };

      const idsRun1 = run1.items.map((item) => item.id);
      const idsRun2 = run2.items.map((item) => item.id);
      const idsOther = otherSeed.items.map((item) => item.id);

      // Deterministic for same seed
      expect(idsRun1).toEqual(idsRun2);
      // Not trivial ascending ID order
      expect(idsRun1).not.toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]);
      // Different seed produces different permutation
      expect(idsRun1).not.toEqual(idsOther);
      // Never leaks correct_position
      for (const item of run1.items) {
        expect(item).not.toHaveProperty("correct_position");
      }
    });

    it("strips matching pairs and deterministically permutes right_items across seeds", () => {
      const pairs = [
        { id: "l-1", left_text: "A", right_id: "r-1", right_text: "1" },
        { id: "l-2", left_text: "B", right_id: "r-2", right_text: "2" },
        { id: "l-3", left_text: "C", right_id: "r-3", right_text: "3" },
        { id: "l-4", left_text: "D", right_id: "r-4", right_text: "4" },
        { id: "l-5", left_text: "E", right_id: "r-5", right_text: "5" },
      ];

      const sanitized = sanitizePreSubmitTypePayload(
        "matching",
        { type: "matching", pairs, distractors: [{ right_id: "r-6", right_text: "6" }] },
        "match-seed-1",
      ) as {
        left_items: Array<Record<string, unknown>>;
        right_items: Array<Record<string, unknown>>;
      };

      expect(sanitized).not.toHaveProperty("pairs");
      expect(sanitized.left_items).toHaveLength(5);
      expect(sanitized.right_items).toHaveLength(6);
      expect(sanitized.right_items.map((r) => r.right_id)).not.toEqual([
        "r-1",
        "r-2",
        "r-3",
        "r-4",
        "r-5",
        "r-6",
      ]);
    });

    it("stripPreSubmitQuestions never leaks grading keys while passing question ID as seed", () => {
      const stripped = stripPreSubmitQuestions([
        {
          id: "eaq-uuid-123",
          attempt_id: "att-1",
          question_id: "q-1",
          source_study_set_id: "set-1",
          source_subject_title: "Physics",
          position: 0,
          question_type: "numerical",
          chapter_snapshot: "Mechanics",
          prompt_snapshot: "What is g?",
          prompt_rich_snapshot: null,
          prompt_image_url_snapshot: null,
          options_snapshot: [],
          correct_option_ids: [],
          accepted_answers_snapshot: [
            {
              answer_text: "9.81",
              normalized_answer: "9.81",
              match_mode: "exact",
            },
          ],
          explanation_snapshot: "Gravity near Earth",
          explanation_rich_snapshot: null,
          type_payload_snapshot: {
            type: "numerical",
            correct_value: 9.81,
            abs_tolerance: 0.05,
            unit: "m/s^2",
            unit_required: false,
          },
          audio_url_snapshot: null,
          passage_snapshot: null,
          diagram_snapshot: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]);

      expect(stripped).toHaveLength(1);
      const q = stripped[0] as unknown as Record<string, unknown>;
      expect(q).not.toHaveProperty("correct_option_ids");
      expect(q).not.toHaveProperty("accepted_answers_snapshot");
      expect(q).not.toHaveProperty("explanation_snapshot");
      expect(q).not.toHaveProperty("explanation_rich_snapshot");
      expect(q.type_payload_snapshot).toEqual({
        type: "numerical",
        unit_required: false,
        unit: "m/s^2",
        significant_figures: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // V32-002 (FUNC-01 / SEC-07): In-progress exam reload restores structured answers
  // -------------------------------------------------------------------------
  describe("V32-002: Pre-submit exam answer restoration without leaking grading keys", () => {
    it("GET /api/exams/[attemptId] maps structured_response, confidence, hint_used and never is_correct while in_progress", () => {
      const attemptRouteSrc = readRepoFile("src/app/api/exams/[attemptId]/route.ts");
      const inProgressBlockMatch = attemptRouteSrc.match(
        /answers:\s*detail\.answers\.map\([\s\S]*?\}\)\),/,
      );
      expect(inProgressBlockMatch).not.toBeNull();
      const inProgressBlock = inProgressBlockMatch?.[0] ?? "";

      expect(inProgressBlock).toContain("structured_response: a.structured_response ?? null");
      expect(inProgressBlock).toContain("confidence: a.confidence ?? null");
      expect(inProgressBlock).toContain("hint_used: a.hint_used ?? false");
      expect(inProgressBlock).not.toContain("is_correct");

      // Fallback breakdowns count structured_response as answered in both GET and POST submit
      expect(attemptRouteSrc).toContain("Boolean(ans.structured_response)");
      const submitRouteSrc = readRepoFile("src/app/api/exams/[attemptId]/submit/route.ts");
      expect(submitRouteSrc).toContain("Boolean(ans.structured_response)");
    });
  });

  // -------------------------------------------------------------------------
  // V32-006 (FUNC-05): StudyHub V3 backup export & restore completeness
  // -------------------------------------------------------------------------
  describe("V32-006: V3 backup export/restore schema completeness & honest scope", () => {
    it("declares honest V3_BACKUP_SCOPE distinguishing restored vs export-only entities", () => {
      expect(V3_BACKUP_SCOPE.restored_entities).toEqual(
        expect.arrayContaining([
          "preferences",
          "folders",
          "study_sets",
          "shared_passages",
          "diagram_sets",
          "diagram_hotspots",
          "questions",
          "question_options",
          "tags",
          "user_question_notes",
        ]),
      );
      expect(V3_BACKUP_SCOPE.export_only_entities).toEqual(
        expect.arrayContaining([
          "media_assets",
          "learning_session_checkpoints",
          "learning_confidence_events",
          "question_reports",
        ]),
      );
      expect(V3_BACKUP_SCOPE.excluded_note.length).toBeGreaterThan(20);
    });

    it("GET /api/account/data exports studyhub-v3 schema with all V3 entities", () => {
      const dataSrc = readRepoFile("src/app/api/account/data/route.ts");
      expect(dataSrc).toContain('schema_version: "studyhub-v3"');
      expect(dataSrc).toContain("backup_scope: V3_BACKUP_SCOPE");
      for (const table of [
        '"shared_passages"',
        '"diagram_sets"',
        '"diagram_hotspots"',
        '"user_question_notes"',
        '"media_assets"',
        '"learning_session_checkpoints"',
        '"learning_confidence_events"',
        '"question_reports"',
      ]) {
        expect(dataSrc).toContain(table);
      }
    });

    it("POST /api/account/restore supports 15 MB cap, v2+v3 schemas, V3 columns, passages, diagrams, and user_question_notes", () => {
      const restoreSrc = readRepoFile("src/app/api/account/restore/route.ts");
      expect(restoreSrc).toContain("const MAX_BACKUP_BYTES = 15 * 1024 * 1024;");
      expect(restoreSrc).toContain("shared_passages");
      expect(restoreSrc).toContain("diagram_sets");
      expect(restoreSrc).toContain("diagram_hotspots");
      expect(restoreSrc).toContain("user_question_notes");
      for (const col of [
        "type_payload",
        "prompt_rich",
        "back_rich",
        "explanation_rich",
        "audio_url",
        "audio_transcript",
        "passage_id",
        "diagram_id",
        "content_rich",
        "image_alt",
      ]) {
        expect(restoreSrc).toContain(col);
      }
      // Remaps diagram_id / passage_id and enforces user.id ownership on notes
      expect(restoreSrc).toContain("passageIdMap");
      expect(restoreSrc).toContain("diagramIdMap");
      expect(restoreSrc).toContain("user_id: user.id");
    });
  });

  // -------------------------------------------------------------------------
  // V32-009 (SEC-05 / SEC-06): Cross-tenant media isolation on delete & clone
  // -------------------------------------------------------------------------
  describe("V32-009: Reference-checked account media deletion & copy-on-clone isolation", () => {
    it("DELETE /api/account/data protects cross-tenant pinned media_assets instead of blind userId/* wipe", () => {
      const dataSrc = readRepoFile("src/app/api/account/data/route.ts");
      expect(dataSrc).toContain("protectedStoragePaths");
      expect(dataSrc).toContain("content_media_relations");
      expect(dataSrc).toContain(
        "purgeUserStorageFolder(bucket, user.id, protectedStoragePaths)",
      );
      expect(dataSrc).toContain("preserved_shared_media_count");
    });

    it("POST /api/sets/[id]/duplicate performs copy-on-clone Storage isolation and caller-owned media_assets remap", () => {
      const dupSrc = readRepoFile("src/app/api/sets/[id]/duplicate/route.ts");
      expect(dupSrc).toContain("isolateClonedStudySetMedia");
      expect(dupSrc).toContain("copyStorageBlob");
      expect(dupSrc).toContain("`${userId}/${clonedSetId}/${newMediaId}.${ext}`");
      expect(dupSrc).toContain('.from("media_assets")');
      expect(dupSrc).toContain('.from("content_media_relations")');
      expect(dupSrc).toContain("owner_id: userId");
    });
  });

  // -------------------------------------------------------------------------
  // V32-010 (FUNC-07): Full Coverage mid-cycle deletion auto-completion
  // -------------------------------------------------------------------------
  describe("V32-010: Full Coverage cycle recovery when remaining questions are deleted mid-cycle", () => {
    it("computeLiveCoverageMetrics transitions a wedged active cycle with 0 live unassigned/assigned items to completed", async () => {
      const eqUserMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const eqIdMock = vi.fn().mockReturnValue({ eq: eqUserMock });
      const updateMock = vi.fn().mockReturnValue({ eq: eqIdMock });
      const fromMock = vi.fn().mockReturnValue({ update: updateMock });
      const fakeSupabase = { from: fromMock } as unknown as SupabaseClient<Database>;

      const result = await computeLiveCoverageMetrics(
        fakeSupabase,
        "user-1",
        {
          id: "cycle-1",
          status: "active",
          total_questions: 10,
          completed_count: 7,
          assigned_count: 0,
          active_attempt_id: null,
          completed_at: null,
        },
        [
          {
            study_set_id: "set-1",
            subject_title: "Biology",
            total: 7,
            completed: 7,
            assigned: 0,
            remaining: 0, // 3 deleted rows excluded by SQL `question_id IS NOT NULL`
          },
        ],
        false,
      );

      expect(result.status).toBe("completed");
      expect(result.remaining_count).toBe(0);
      expect(result.progress_percent).toBe(100);
      expect(result.completed_at).not.toBeNull();
      expect(fromMock).toHaveBeenCalledWith("coverage_cycles");
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "completed",
          assigned_count: 0,
          active_attempt_id: null,
        }),
      );
    });

    it("computeLiveCoverageMetrics keeps cycle active when live unassigned questions remain", async () => {
      const fromMock = vi.fn();
      const fakeSupabase = { from: fromMock } as unknown as SupabaseClient<Database>;

      const result = await computeLiveCoverageMetrics(
        fakeSupabase,
        "user-1",
        {
          id: "cycle-2",
          status: "active",
          total_questions: 10,
          completed_count: 5,
          assigned_count: 0,
          active_attempt_id: null,
          completed_at: null,
        },
        [
          {
            study_set_id: "set-1",
            subject_title: "Chemistry",
            total: 8,
            completed: 5,
            assigned: 0,
            remaining: 3,
          },
        ],
        false,
      );

      expect(result.status).toBe("active");
      expect(result.remaining_count).toBe(3);
      expect(result.progress_percent).toBe(62.5);
      expect(fromMock).not.toHaveBeenCalled();
    });

    it("issueNextExamForCycle transitions wedged active cycle to completed when 0 live unassigned items remain", async () => {
      const updateEqUserMock = vi.fn().mockResolvedValue({ data: null, error: null });
      const updateEqIdMock = vi.fn().mockReturnValue({ eq: updateEqUserMock });
      const updateMock = vi.fn().mockReturnValue({ eq: updateEqIdMock });

      // Simulate `coverage_cycle_questions` returning empty list (all unassigned questions deleted)
      const rangeMock = vi.fn().mockResolvedValue({ data: [], error: null });
      const orderMock = vi.fn().mockReturnValue({ range: rangeMock });
      const notNullMock = vi.fn().mockReturnValue({ order: orderMock });
      const eqStateMock = vi.fn().mockReturnValue({ not: notNullMock });
      const eqCycleMock = vi.fn().mockReturnValue({ eq: eqStateMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqCycleMock });

      const fromMock = vi.fn((table: string) => {
        if (table === "coverage_cycle_questions") {
          return { select: selectMock };
        }
        if (table === "coverage_cycles") {
          return { update: updateMock };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const fakeSupabase = { from: fromMock } as unknown as SupabaseClient<Database>;
      const fakeCycle: CoverageCycle = {
        id: "cycle-wedged",
        user_id: "user-1",
        preset_id: null,
        title: "Midterm Coverage",
        status: "active",
        source_snapshot: [],
        filter_snapshot: {},
        allocation_strategy: "proportional",
        questions_per_exam: 20,
        total_questions: 10,
        assigned_count: 0,
        answered_count: 8,
        completed_count: 8,
        active_attempt_id: null,
        cycle_number: 1,
        started_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };

      await expect(
        issueNextExamForCycle(fakeSupabase, "user-1", fakeCycle),
      ).rejects.toMatchObject({
        code: "CYCLE_ALREADY_COMPLETED",
        status: 409,
      });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "completed",
          assigned_count: 0,
          active_attempt_id: null,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // V32-011 (DB-01 / DB-02), V32-012 (DB-04..DB-07, DB-11), V32-037
  // -------------------------------------------------------------------------
  describe("V32-011, V32-012 & V32-037: Atomic RPC wiring, hot-path optimization & content_version", () => {
    it("wires atomic RPCs into starred, progress, preferences, diagrams, and question CRUD", () => {
      expect(readRepoFile("src/app/api/starred/route.ts")).toContain(
        "rpcToggleStarredQuestion",
      );
      expect(readRepoFile("src/app/api/progress/route.ts")).toContain(
        "rpcRecordProgressAnswer",
      );
      expect(readRepoFile("src/lib/supabase/progress-helper.ts")).toContain(
        "rpcRecordProgressAnswer",
      );
      expect(readRepoFile("src/app/api/preferences/route.ts")).toContain(
        "rpcPatchUserPreferences",
      );
      expect(readRepoFile("src/app/api/diagrams/[id]/route.ts")).toContain(
        "rpcSaveDiagramPatch",
      );
      expect(readRepoFile("src/app/api/sets/[id]/questions/route.ts")).toContain(
        "rpcAllocateQuestionPosition",
      );
      expect(readRepoFile("src/app/api/sets/[id]/questions/[questionId]/route.ts")).toContain(
        "rpcBumpStudySetContentVersion",
      );
    });

    it("PUT /api/notes maps unique violation 23505 cleanly to 409 NOTE_CONFLICT with server_note", () => {
      const notesSrc = readRepoFile("src/app/api/notes/route.ts");
      expect(notesSrc).toContain('"23505"');
      expect(notesSrc).toContain('"NOTE_CONFLICT"');
      expect(notesSrc).toContain("server_note");
    });

    it("bulk questions PATCH and DELETE atomically bump content_version (V32-037)", () => {
      const bulkSrc = readRepoFile("src/app/api/sets/[id]/questions/bulk/route.ts");
      expect(bulkSrc).toContain("rpcBumpStudySetContentVersion");
      const calls = bulkSrc.match(/await bumpContentVersionSafe\(supabase,\s*setId\)/g) ?? [];
      // Called in POST, PATCH, and DELETE
      expect(calls.length).toBe(3);
    });

    it("GET /api/sets uses single-RTT rpcListAccessibleStudySets with favoritesOnly and zero 100-set truncation", () => {
      const setsSrc = readRepoFile("src/app/api/sets/route.ts");
      expect(setsSrc).toContain("rpcListAccessibleStudySets");
      expect(setsSrc).toContain("favoritesOnly");
      expect(setsSrc).not.toContain(".slice(0, 100)");
    });

    it("GET /api/sets/[id]/questions uses single-RTT RPC and strips heavy TipTap/explanation columns in summary mode", () => {
      const qSrc = readRepoFile("src/app/api/sets/[id]/questions/route.ts");
      expect(qSrc).toContain("rpcGetStudySetQuestionsPage");

      const summaryMatch = qSrc.match(
        /const QUESTION_SUMMARY_COLUMNS\s*=\s*"([^"]+)";/,
      );
      expect(summaryMatch).not.toBeNull();
      const summaryCols = (summaryMatch?.[1] ?? "")
        .split(",")
        .map((c) => c.trim());
      for (const heavyCol of [
        "prompt_rich",
        "back_rich",
        "explanation",
        "explanation_rich",
        "hint",
        "content_rich",
      ]) {
        expect(summaryCols).not.toContain(heavyCol);
      }
    });

    it("GET /api/statistics and GET /api/mistakes use bounded SQL RPCs eliminating full-table scans", () => {
      expect(readRepoFile("src/app/api/statistics/route.ts")).toContain(
        "rpcGetUserStatisticsSummary",
      );
      expect(readRepoFile("src/app/api/mistakes/route.ts")).toContain(
        "rpcGetUserMistakesPage",
      );
    });
  });

  // -------------------------------------------------------------------------
  // V32-044 (SEC-13 / SEC-14), V32-045 (DB-10), V32-047 (DB-14)
  // -------------------------------------------------------------------------
  describe("V32-044, V32-045 & V32-047: Rate limits, static RPC errors, exam hot path & orphan media reaping", () => {
    it("registers and enforces distributed rate limits on account/data, bulk questions, exam submit, and cycle restart", () => {
      expect(RATE_LIMITS.ACCOUNT_DATA).toBeDefined();
      expect(RATE_LIMITS.BULK_QUESTIONS).toBeDefined();
      expect(RATE_LIMITS.EXAM_SUBMIT).toBeDefined();
      expect(RATE_LIMITS.CYCLE_RESTART).toBeDefined();

      expect(readRepoFile("src/app/api/account/data/route.ts")).toContain(
        "RATE_LIMITS.ACCOUNT_DATA",
      );
      expect(readRepoFile("src/app/api/sets/[id]/questions/bulk/route.ts")).toContain(
        "RATE_LIMITS.BULK_QUESTIONS",
      );
      expect(readRepoFile("src/app/api/exams/[attemptId]/submit/route.ts")).toContain(
        "RATE_LIMITS.EXAM_SUBMIT",
      );
      expect(readRepoFile("src/app/api/coverage-cycles/[id]/restart/route.ts")).toContain(
        "RATE_LIMITS.CYCLE_RESTART",
      );
    });

    it("maps P0002 and 22023 to static safe messages in POST /api/sessions/[sessionId]/answers", () => {
      const sessionAnswersSrc = readRepoFile(
        "src/app/api/sessions/[sessionId]/answers/route.ts",
      );
      expect(sessionAnswersSrc).toContain('rpcErr.code === "P0002"');
      expect(sessionAnswersSrc).toContain('rpcErr.code === "22023"');
      expect(sessionAnswersSrc).not.toContain("rpcErr.message ||");
    });

    it("POST /api/exams uses backward-compatible 18-arg create_exam_attempt_v2 reading shuffle_options from p_config without extra question_options query", () => {
      const examsSrc = readRepoFile("src/app/api/exams/route.ts");
      expect(examsSrc).toContain("shuffle_options: input.shuffle_options");
      expect(examsSrc).not.toContain("p_shuffle_options");
      expect(examsSrc).not.toContain('.from("question_options")');
    });

    it("POST /api/starred fallback handles 23505 idempotently and PATCH /api/diagrams/[id] batches hotspot upserts + atomic content_version bump", () => {
      const starredSrc = readRepoFile("src/app/api/starred/route.ts");
      expect(starredSrc).toContain('insErr.code === "23505"');

      const diagSrc = readRepoFile("src/app/api/diagrams/[id]/route.ts");
      expect(diagSrc).toContain(".upsert(upsertRows");
      expect(diagSrc).toContain("rpcBumpStudySetContentVersion");
    });

    it("POST /api/sync/events deduplicates in-batch event_ids and normalizes rejected_revoked/rejected_deleted into opaque rejected_inaccessible (SEC-10)", () => {
      const syncSrc = readRepoFile("src/app/api/sync/events/route.ts");
      expect(syncSrc).toContain("seenEventIds");
      expect(syncSrc).toContain('"duplicate_ignored"');
      expect(syncSrc).toContain('"rejected_inaccessible"');
      expect(syncSrc).toContain("OPAQUE_INACCESSIBLE_MESSAGE");
    });

    it("POST /auth/signout emits relative Location: /login on 303 and private, no-store on JSON (V32-013)", () => {
      const signoutSrc = readRepoFile("src/app/auth/signout/route.ts");
      expect(signoutSrc).toContain('Location: "/login"');
      expect(signoutSrc).not.toContain('new URL("/login"');
      expect(signoutSrc).toContain('"private, no-store"');
      expect(signoutSrc).toContain('"Vary"');
      expect(signoutSrc).toContain("ok: true");
    });

    it("DELETE /api/sets/[id] safely marks and reaps only unpinned orphan media_assets (DB-14)", () => {
      const setIdSrc = readRepoFile("src/app/api/sets/[id]/route.ts");
      expect(setIdSrc).toContain("content_media_relations");
      expect(setIdSrc).toContain("is_orphaned: true");
      expect(setIdSrc).toContain("unpinnedIds");
    });
  });
});
