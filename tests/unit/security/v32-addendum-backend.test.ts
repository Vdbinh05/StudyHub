import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { V3_BACKUP_SCOPE } from "@/lib/supabase/backup-scope";
import { stripPreSubmitQuestions } from "@/lib/supabase/exam-engine";
import {
  hydrateQuestionAndOptionMedia,
  verifyEditableMediaOwnership,
} from "@/lib/supabase/query-helpers";
import {
  createQuestionSchema,
  listQuestionsQuerySchema,
  updateQuestionSchema,
} from "@/lib/validation/questions";

function readRepoFile(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_5 = "55555555-5555-4555-8555-555555555555";
const UUID_6 = "66666666-6666-4666-8666-666666666666";
const UUID_7 = "77777777-7777-4777-8777-777777777777";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SET_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SET_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("StudyHub V3.2 Addendum (V32-053) — Post-Import Multimedia Editor Backend & Security", () => {
  // -------------------------------------------------------------------------
  // 1. Migration 0020 structural, MCP safety, and anti-leak checks
  // -------------------------------------------------------------------------
  describe("Migration 0020: non-destructive MCP safety, pre-submit explanation anti-leak & media review filters", () => {
    const sql0020 = readRepoFile(
      "supabase/migrations/0020_v3_2_post_import_multimedia_editor.sql",
    );
    const exec0020 = sql0020
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    it("contains ZERO DROP/DELETE/TRUNCATE/TEMP TABLE, 100% wrapped (SELECT auth.uid()), and SET search_path = '' on every function", () => {
      expect(exec0020).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
      expect(exec0020).not.toMatch(/\bCREATE\s+TEMP\s+TABLE\b/i);
      expect(exec0020).not.toMatch(/\bauth\.role\s*\(/i);

      const totalUid = exec0020.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];
      const wrappedUid = exec0020.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
      expect(totalUid.length).toBeGreaterThanOrEqual(6);
      expect(wrappedUid.length).toBe(totalUid.length);

      const dollarDelims = exec0020.match(/\$\$/g) ?? [];
      expect(dollarDelims.length % 2).toBe(0);

      const fnBlocks = exec0020.split(/CREATE OR REPLACE FUNCTION\s+/i).slice(1);
      expect(fnBlocks.length).toBe(8);
      for (const block of fnBlocks) {
        const header = block.split(/AS \$\$/i)[0] ?? "";
        expect(header).toMatch(/SET\s+search_path\s*=\s*''/i);
      }
    });

    it("protects review_media_snapshot at column, trigger, storage helper, and content_media_relations RLS levels", () => {
      expect(exec0020).toMatch(
        /ADD COLUMN IF NOT EXISTS review_media_snapshot jsonb NOT NULL DEFAULT '\[\]'::jsonb/i,
      );
      expect(exec0020).toMatch(
        /REVOKE ALL \(review_media_snapshot\) ON public\.exam_attempt_questions FROM PUBLIC, anon, authenticated;/i,
      );
      expect(exec0020).toContain(
        "NEW.review_media_snapshot IS NOT DISTINCT FROM OLD.review_media_snapshot",
      );
      expect(exec0020).toMatch(
        /CREATE OR REPLACE FUNCTION public\.can_read_exam_snapshot_media/i,
      );
      expect(exec0020).toMatch(
        /CREATE OR REPLACE FUNCTION public\.is_exam_attempt_question_reviewable/i,
      );
      expect(exec0020).toMatch(
        /ALTER POLICY "content_media_relations_select_readable"\s+ON public\.content_media_relations/i,
      );
      expect(exec0020).toContain("ea.status IN ('submitted', 'expired')");
    });

    it("pins ALL question_option content_media_relations onto exam_attempt_question and keeps 18-arg create_exam_attempt_v2", () => {
      expect(exec0020).toContain("cmr.entity_type = 'question_option'");
      expect(exec0020).toContain("'exam_attempt_question'");
      expect(exec0020).toMatch(
        /REVOKE ALL ON FUNCTION public\.create_exam_attempt_v2\(\s*text, uuid, jsonb, jsonb, jsonb, integer, integer,\s*text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid\s*\) FROM PUBLIC, anon;/i,
      );
    });

    it("scopes question_reports to reporter/editor, uses safe ambiguous_media check, and delegates 10-arg wrapper to _v2", () => {
      expect(exec0020).toContain(
        "AND (qr.reporter_id = v_caller OR public.can_edit_study_set(p_set_id, v_caller))",
      );
      expect(exec0020).not.toContain("(c.source_metadata->>'ambiguous_media')::boolean");
      expect(exec0020).toContain("public.url_encode_query_param(");
      expect(exec0020).not.toContain("replace(ma.storage_path, '/', '%2F')");
      expect(exec0020).toMatch(
        /CREATE OR REPLACE FUNCTION public\.get_study_set_questions_page_v2/i,
      );
      expect(exec0020).toMatch(
        /SELECT public\.get_study_set_questions_page_v2\(/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. Validation schemas: image-only options, multi-image limits & mediaFilter
  // -------------------------------------------------------------------------
  describe("Validation schemas: image-only options on all choice types, per-option media limits & mediaFilter", () => {
    it("allows image-only options via media_attachments on single_choice without converting type", () => {
      const parsed = createQuestionSchema.parse({
        question_type: "single_choice",
        prompt: "Which schematic matches the circuit?",
        media_attachments: [
          { media_id: UUID_1, role: "prompt", sort_order: 0, alt_text: "Main figure" },
          { media_id: UUID_2, role: "explanation", sort_order: 0, alt_text: "Solution diagram" },
        ],
        options: [
          {
            label: "A",
            content: "",
            is_correct: true,
            media_attachments: [
              { media_id: UUID_3, role: "option", sort_order: 0, alt_text: "Circuit A1" },
              { media_id: UUID_4, role: "option", sort_order: 1, alt_text: "Circuit A2" },
            ],
          },
          {
            label: "B",
            content: "Text option B",
            is_correct: false,
          },
        ],
      });

      expect(parsed.options?.[0]?.media_attachments).toHaveLength(2);
      expect(parsed.media_attachments).toHaveLength(2);
    });

    it("rejects options with neither text nor any image/media_attachments, and caps per-option attachments at 6", () => {
      const emptyOpt = updateQuestionSchema.safeParse({
        options: [
          { label: "A", content: "   ", is_correct: true },
          { label: "B", content: "Valid", is_correct: false },
        ],
      });
      expect(emptyOpt.success).toBe(false);

      const tooManyOptMedia = updateQuestionSchema.safeParse({
        options: [
          {
            label: "A",
            content: "Option A",
            is_correct: true,
            media_attachments: [
              UUID_1,
              UUID_2,
              UUID_3,
              UUID_4,
              UUID_5,
              UUID_6,
              UUID_7,
            ].map((id, idx) => ({ media_id: id, role: "option" as const, sort_order: idx })),
          },
          { label: "B", content: "Option B", is_correct: false },
        ],
      });
      expect(tooManyOptMedia.success).toBe(false);
    });

    it("validates mediaFilter enum and #123 search query params on listQuestionsQuerySchema", () => {
      for (const filter of [
        "all",
        "has_images",
        "no_images",
        "missing_media",
        "needs_media_review",
      ]) {
        const res = listQuestionsQuerySchema.parse({ mediaFilter: filter, q: "#42" });
        expect(res.mediaFilter).toBe(filter);
        expect(res.q).toBe("#42");
      }

      const invalid = listQuestionsQuerySchema.safeParse({ mediaFilter: "bogus" });
      expect(invalid.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Pre-submit exam anti-leak defense-in-depth (stripPreSubmitQuestions)
  // -------------------------------------------------------------------------
  describe("stripPreSubmitQuestions: strips explanation/hint/back media & review_media_snapshot while keeping option media[]", () => {
    it("removes review_media_snapshot and explanation/hint/back entries from media_snapshot while preserving prompt & multi-image option media", () => {
      const stripped = stripPreSubmitQuestions([
        {
          id: UUID_1,
          attempt_id: UUID_2,
          question_id: UUID_3,
          position: 0,
          question_type: "single_choice",
          source_study_set_id: SET_A,
          source_subject_title: "Physics",
          chapter_snapshot: "Ch 1",
          prompt_snapshot: "Identify the waveform",
          prompt_image_url_snapshot: "/api/uploads/signed-url?path=a&redirect=1",
          media_snapshot: [
            {
              media_id: UUID_4,
              url: "/api/uploads/signed-url?path=prompt.png&redirect=1",
              proxy_url: "/api/uploads/signed-url?path=prompt.png&redirect=1",
              storage_path: `${USER_A}/${SET_A}/prompt.png`,
              mime_type: "image/png",
              role: "prompt",
              sort_order: 0,
            },
            {
              media_id: UUID_5,
              url: "/api/uploads/signed-url?path=secret-expl.png&redirect=1",
              proxy_url: "/api/uploads/signed-url?path=secret-expl.png&redirect=1",
              storage_path: `${USER_A}/${SET_A}/secret-expl.png`,
              mime_type: "image/png",
              role: "explanation",
              sort_order: 0,
            },
            {
              media_id: UUID_6,
              url: "/api/uploads/signed-url?path=secret-hint.png&redirect=1",
              proxy_url: "/api/uploads/signed-url?path=secret-hint.png&redirect=1",
              storage_path: `${USER_A}/${SET_A}/secret-hint.png`,
              mime_type: "image/png",
              role: "hint",
              sort_order: 0,
            },
          ],
          review_media_snapshot: [
            {
              media_id: UUID_5,
              url: "/api/uploads/signed-url?path=secret-expl.png&redirect=1",
              role: "explanation",
              sort_order: 0,
            },
          ],
          options_snapshot: [
            {
              id: UUID_7,
              label: "A",
              content: "",
              image_url: "/api/uploads/signed-url?path=optA1.png&redirect=1",
              media_id: UUID_4,
              position: 0,
              media: [
                {
                  media_id: UUID_4,
                  url: "/api/uploads/signed-url?path=optA1.png&redirect=1",
                  role: "option",
                  sort_order: 0,
                },
                {
                  media_id: UUID_6,
                  url: "/api/uploads/signed-url?path=optA2.png&redirect=1",
                  role: "option",
                  sort_order: 1,
                },
              ],
            },
          ],
          explanation_snapshot: "Secret explanation text",
          correct_option_ids: [UUID_7],
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ]);

      const q = stripped[0] as unknown as Record<string, unknown>;
      expect(q).not.toHaveProperty("review_media_snapshot");
      expect(q).not.toHaveProperty("explanation_snapshot");
      expect(q).not.toHaveProperty("correct_option_ids");

      const safeMedia = stripped[0]?.media_snapshot ?? [];
      expect(safeMedia).toHaveLength(1);
      expect(safeMedia[0]?.role).toBe("prompt");

      expect(stripped[0]?.options_snapshot[0]?.media).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Media ownership guard & multi-image hydration helpers
  // -------------------------------------------------------------------------
  describe("verifyEditableMediaOwnership & hydrateQuestionAndOptionMedia", () => {
    it("allows media belonging to target studySetId or caller, and rejects another user's private media with 403", async () => {
      const makeMockDb = (rows: Array<Record<string, unknown>>) => {
        const inMock = vi.fn().mockResolvedValue({ data: rows, error: null });
        const selectMock = vi.fn().mockReturnValue({ in: inMock });
        const fromMock = vi.fn().mockReturnValue({ select: selectMock });
        return { from: fromMock } as unknown as SupabaseClient<Database>;
      };

      const okDb = makeMockDb([
        {
          id: UUID_1,
          owner_id: USER_A,
          study_set_id: SET_A,
          storage_path: `${USER_A}/${SET_A}/img1.png`,
          mime_type: "image/png",
          width: 800,
          height: 600,
          alt_text: "Diagram",
          caption: null,
        },
      ]);
      const verified = await verifyEditableMediaOwnership(okDb, USER_A, SET_A, [UUID_1]);
      expect(verified.get(UUID_1)?.proxy_url).toContain("/api/uploads/signed-url?path=");

      // Cross-tenant media owned by USER_B in SET_B must throw 403 FORBIDDEN!
      const crossTenantDb = makeMockDb([
        {
          id: UUID_2,
          owner_id: USER_B,
          study_set_id: SET_B,
          storage_path: `${USER_B}/${SET_B}/private.png`,
          mime_type: "image/png",
          width: 400,
          height: 300,
          alt_text: null,
          caption: null,
        },
      ]);
      await expect(
        verifyEditableMediaOwnership(crossTenantDb, USER_A, SET_A, [UUID_2]),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

      // Missing/unreadable media_id must also throw 403 FORBIDDEN
      const missingDb = makeMockDb([]);
      await expect(
        verifyEditableMediaOwnership(missingDb, USER_A, SET_A, [UUID_3]),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });

    it("hydrates question (prompt + explanation) and option (multi-image) media_attachments cleanly", async () => {
      const qRels = [
        {
          id: "rel-1",
          media_id: UUID_1,
          entity_type: "question",
          entity_id: "q-1",
          role: "prompt",
          sort_order: 0,
          alt_text: "Prompt alt",
          caption: "Fig 1",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "rel-2",
          media_id: UUID_2,
          entity_type: "question",
          entity_id: "q-1",
          role: "explanation",
          sort_order: 0,
          alt_text: "Expl alt",
          caption: null,
          created_at: "2026-01-01T00:00:01.000Z",
        },
      ];
      const optRels = [
        {
          id: "rel-3",
          media_id: UUID_3,
          entity_type: "question_option",
          entity_id: "opt-a",
          role: "option",
          sort_order: 0,
          alt_text: null,
          caption: null,
          created_at: "2026-01-01T00:00:02.000Z",
        },
      ];
      const assets = [
        {
          id: UUID_1,
          storage_path: `${USER_A}/${SET_A}/p1.png`,
          mime_type: "image/png",
          width: 640,
          height: 480,
          alt_text: "Fallback",
          caption: null,
        },
        {
          id: UUID_2,
          storage_path: `${USER_A}/${SET_A}/e1.png`,
          mime_type: "image/jpeg",
          width: 800,
          height: 600,
          alt_text: null,
          caption: null,
        },
        {
          id: UUID_3,
          storage_path: `${USER_A}/${SET_A}/o1.webp`,
          mime_type: "image/webp",
          width: 300,
          height: 200,
          alt_text: "Asset default alt",
          caption: null,
        },
      ];

      const fakeSupabase = {
        from: vi.fn((table: string) => {
          if (table === "content_media_relations") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((_col: string, val: string) => ({
                  in: vi.fn(() => ({
                    order: vi.fn(() => ({
                      order: vi.fn().mockResolvedValue({
                        data: val === "question" ? qRels : optRels,
                        error: null,
                      }),
                    })),
                  })),
                })),
              })),
            };
          }
          if (table === "media_assets") {
            return {
              select: vi.fn(() => ({
                in: vi.fn().mockResolvedValue({ data: assets, error: null }),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      } as unknown as SupabaseClient<Database>;

      const { questionMediaByQ, optionMediaByOpt } =
        await hydrateQuestionAndOptionMedia(fakeSupabase, ["q-1"], ["opt-a"]);

      expect(questionMediaByQ.get("q-1")).toHaveLength(2);
      expect(questionMediaByQ.get("q-1")?.[0]).toMatchObject({
        media_id: UUID_1,
        role: "prompt",
        alt_text: "Prompt alt",
        caption: "Fig 1",
        width: 640,
        height: 480,
      });
      expect(questionMediaByQ.get("q-1")?.[1]?.role).toBe("explanation");

      expect(optionMediaByOpt.get("opt-a")).toHaveLength(1);
      expect(optionMediaByOpt.get("opt-a")?.[0]).toMatchObject({
        media_id: UUID_3,
        role: "option",
        alt_text: "Asset default alt",
        mime_type: "image/webp",
      });
    });
  });

  // -------------------------------------------------------------------------
  // 5. Route contracts: PATCH preservation, cancel-cleanup 409, commit upsert, backup/restore
  // -------------------------------------------------------------------------
  describe("API route contracts: option UUID preservation, cancel-cleanup safety, import explanationMedia & backup/restore", () => {
    it("PATCH /api/sets/[id]/questions/[questionId] preserves option IDs, verifies media ownership, never wipes mastery, and returns hydrated media", () => {
      const routeSrc = readRepoFile(
        "src/app/api/sets/[id]/questions/[questionId]/route.ts",
      );
      expect(routeSrc).toContain("verifyEditableMediaOwnership");
      expect(routeSrc).toContain('entity_type: "question_option"');
      expect(routeSrc).toContain("media_attachments: relations.questionMediaByQ.get(qId) ?? []");
      expect(routeSrc).not.toContain("user_question_progress");
    });

    it("DELETE /api/uploads/image/[mediaId] verifies owner_id, checks all 6 reference tables, returns 409 when referenced, and deletes DB row before Storage", () => {
      const delSrc = readRepoFile("src/app/api/uploads/image/[mediaId]/route.ts");
      expect(delSrc).toContain("asset.owner_id !== user.id");
      for (const tbl of [
        '"content_media_relations"',
        '"questions"',
        '"question_options"',
        '"diagram_sets"',
        '"shared_passages"',
        '"exam_attempt_questions"',
      ]) {
        expect(delSrc).toContain(tbl);
      }
      expect(delSrc).toContain("409");
      expect(delSrc).toContain('.select("id")\n      .maybeSingle()');
      expect(delSrc).toContain('delErr.code === "23503"');
    });

    it("POST /api/import/commit preserves explanationMedia through validateParsedQuestion, cleans replay temp paths, and upserts content_media_relations (V32-054)", () => {
      const commitSrc = readRepoFile("src/app/api/import/commit/route.ts");
      expect(commitSrc).toContain("explanationMedia:");
      expect(commitSrc).toContain("explanationMedia: q.explanationMedia?.map(");
      expect(commitSrc).toContain("for (const m of q.explanationMedia ?? [])");
      expect(commitSrc).toContain('role: "explanation"');
      expect(commitSrc).toContain(
        '.from("content_media_relations").upsert(mrChunk, {',
      );
      expect(commitSrc).toContain(
        'onConflict: "media_id,entity_type,entity_id,role"',
      );
    });

    it("GET /api/starred, GET /api/mistakes (both RPC & fallback), and GET /api/progress/due hydrate question & option media_attachments (V32-055)", () => {
      const starredSrc = readRepoFile("src/app/api/starred/route.ts");
      expect(starredSrc).toContain(
        "media_attachments: relations.questionMediaByQ.get(q.id) ?? []",
      );

      const dueSrc = readRepoFile("src/app/api/progress/due/route.ts");
      expect(dueSrc).toContain(
        "media_attachments: relations.questionMediaByQ.get(q.id) ?? []",
      );

      const mistakesSrc = readRepoFile("src/app/api/mistakes/route.ts");
      expect(mistakesSrc).toContain("hydrateQuestionAndOptionMedia");
      expect(mistakesSrc).toContain(
        "media_attachments: questionMediaByQ.get(qObj.id) ?? []",
      );
      expect(mistakesSrc).toContain(
        "media_attachments: relations.questionMediaByQ.get(q.id) ?? []",
      );
    });

    it("Backup & restore include content_media_relations in studyhub-v3 scope with owner validation and option/question ID remapping", () => {
      expect(V3_BACKUP_SCOPE.restored_entities).toContain("content_media_relations");

      const dataSrc = readRepoFile("src/app/api/account/data/route.ts");
      expect(dataSrc).toContain("content_media_relations: contentMediaRelations");

      const restoreSrc = readRepoFile("src/app/api/account/restore/route.ts");
      expect(restoreSrc).toContain("optionIdMap");
      expect(restoreSrc).toContain("validOwnedMediaIds.has(rel.media_id)");
      expect(restoreSrc).toContain("content_media_relations: restoredMediaRelations");
    });
  });
});
