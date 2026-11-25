// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapWithConcurrency,
  stripLeadingOptionPrefix,
} from "@/lib/import/text-utils";
import {
  clearPendingImportFile,
  consumePendingImportFile,
  setPendingImportFile,
} from "@/lib/import/pending-file-handoff";

const VALID_1X1_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const mockRequireAuth = vi.fn();
const mockRequireStudySetAccess = vi.fn();
const mockEnforceRateLimit = vi.fn();
const mockConsumeTempUploadBytes = vi.fn();
const mockCleanupTempObjects = vi.fn();
const mockFetchExistingFingerprints = vi.fn();

vi.mock("@/lib/security/authz", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requireStudySetAccess: (...args: unknown[]) => mockRequireStudySetAccess(...args),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceDistributedRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
  RATE_LIMITS: { IMPORT: { id: "import", limit: 30, windowMs: 60_000 } },
}));

vi.mock("@/lib/supabase/temp-storage", () => ({
  consumeTempUploadBytes: (...args: unknown[]) => mockConsumeTempUploadBytes(...args),
  cleanupTempObjects: (...args: unknown[]) => mockCleanupTempObjects(...args),
  isOwnedTempStoragePath: (p: string, uid: string, purpose: string) =>
    p.startsWith(`${uid}/${purpose}/`),
}));

vi.mock("@/app/api/import/_existing-fingerprints", () => ({
  fetchExistingQuestionFingerprints: (...args: unknown[]) =>
    mockFetchExistingFingerprints(...args),
}));

import { POST as commitPost } from "@/app/api/import/commit/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";

function makeSampleQuestion(idx = 1, tempPath?: string) {
  return {
    tempId: `tmp-${idx}`,
    sourceIndex: idx,
    questionType: "single_choice" as const,
    prompt: `Question ${idx}: What is 2 + 2?`,
    promptMedia: tempPath
      ? [
          {
            fileName: "fig1.png",
            mimeType: "image/png",
            tempStoragePath: tempPath,
          },
        ]
      : [],
    options: [
      { label: "A", content: "3", isCorrect: false, media: [] },
      { label: "B", content: "4", isCorrect: true, media: [] },
    ],
    acceptedAnswers: [],
    tags: [],
    difficulty: "medium" as const,
    issues: [],
  };
}

describe("V3.2 Import Utilities & Pending File Handoff", () => {
  afterEach(() => {
    clearPendingImportFile();
  });

  it("mapWithConcurrency enforces bounded concurrency and preserves order", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const inputs = Array.from({ length: 18 }, (_, i) => i + 1);

    const results = await mapWithConcurrency(inputs, 6, async (value) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, (19 - value) % 5));
      inFlight -= 1;
      return value * 10;
    });

    expect(peakInFlight).toBeLessThanOrEqual(6);
    expect(peakInFlight).toBeGreaterThanOrEqual(2);
    expect(results).toEqual(inputs.map((v) => v * 10));
  });

  it("stripLeadingOptionPrefix removes duplicated prefixes without touching normal prose (RU-14)", () => {
    expect(stripLeadingOptionPrefix("A. Hanoi")).toBe("Hanoi");
    expect(stripLeadingOptionPrefix("(A) Hanoi")).toBe("Hanoi");
    expect(stripLeadingOptionPrefix("(A) A. Hanoi")).toBe("Hanoi");
    expect(stripLeadingOptionPrefix("B) Ho Chi Minh City")).toBe("Ho Chi Minh City");
    expect(stripLeadingOptionPrefix("[C] Da Nang")).toBe("Da Nang");
    expect(stripLeadingOptionPrefix("A plane flies east")).toBe("A plane flies east");
    expect(stripLeadingOptionPrefix("A-level physics")).toBe("A-level physics");
  });

  it("pending-file-handoff delivers picked File once per matching studySetId (RU-13)", () => {
    const file = new File(["hello"], "exam.pdf", { type: "application/pdf" });
    setPendingImportFile(SET_ID, file);

    expect(consumePendingImportFile("99999999-9999-4999-8999-999999999999")).toBeNull();
    expect(consumePendingImportFile(SET_ID)).toBe(file);
    // Consumed once -> second call returns null
    expect(consumePendingImportFile(SET_ID)).toBeNull();
  });
});

describe("V3.2 POST /api/import/commit regressions (DB-05, FUNC-13, SEC-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
    mockFetchExistingFingerprints.mockResolvedValue({
      fingerprintToIds: new Map<string, string[]>(),
    });
    mockCleanupTempObjects.mockResolvedValue(undefined);
    mockRequireStudySetAccess.mockResolvedValue({
      studySet: { id: SET_ID, owner_id: USER_ID, title: "Set A" },
      role: "owner",
      canRead: true,
      canEdit: true,
      isOwner: true,
      canClone: true,
    });
  });

  it("queries source_metadata->>import_idempotency_key (DB-05) and returns stored importJobId + finalizes import_jobs on idempotent replay (FUNC-13)", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const containsCalls: unknown[] = [];
    const importJobsUpdateCalls: unknown[] = [];

    const mockSupabase = {
      from: (table: string) => {
        if (table === "questions") {
          return {
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: async () => ({ count: 25, error: null }),
                };
              }
              return {
                eq: (col1: string, val1: unknown) => {
                  eqCalls.push([col1, val1]);
                  return {
                    eq: (col2: string, val2: unknown) => {
                      eqCalls.push([col2, val2]);
                      return {
                        limit: async () => ({
                          data: [
                            {
                              id: "q-existing-1",
                              source_metadata: {
                                import_idempotency_key: "chunk-key-1234",
                                import_job_id: JOB_ID,
                              },
                            },
                          ],
                          error: null,
                        }),
                      };
                    },
                    contains: (...args: unknown[]) => {
                      containsCalls.push(args);
                      return { limit: async () => ({ data: [], error: null }) };
                    },
                  };
                },
              };
            },
          };
        }
        if (table === "import_jobs") {
          return {
            update: (payload: Record<string, unknown>) => {
              importJobsUpdateCalls.push(payload);
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };

    mockRequireAuth.mockResolvedValue({
      supabase: mockSupabase,
      user: { id: USER_ID },
    });

    const tempPath = `${USER_ID}/import-media/img-1.png`;
    const req = new Request("http://localhost/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studySetId: SET_ID,
        sourceFormat: "docx_multimedia",
        fileName: "test.docx",
        fileSizeBytes: 1024,
        mode: "append",
        idempotencyKey: "chunk-key-1234",
        isFirstChunk: true,
        isFinalChunk: true,
        questions: [makeSampleQuestion(1, tempPath)],
      }),
    });

    const res = await commitPost(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        importJobId: string | null;
        idempotentReplay: boolean;
        totalSetQuestions: number;
      };
    };

    // DB-05: Uses exact JSON text extraction matching Migration 0019 partial index (NEVER .contains)
    expect(containsCalls).toHaveLength(0);
    expect(eqCalls).toContainEqual([
      "source_metadata->>import_idempotency_key",
      "chunk-key-1234",
    ]);

    // FUNC-13: Replayed chunk returns persisted importJobId and finalizes import_jobs on isFinalChunk=true
    expect(json.data.idempotentReplay).toBe(true);
    expect(json.data.importJobId).toBe(JOB_ID);
    expect(json.data.totalSetQuestions).toBe(25);
    expect(importJobsUpdateCalls).toHaveLength(1);
    expect(importJobsUpdateCalls[0]).toMatchObject({ status: "completed" });

    // SEC-12: Final chunk cleans up temp media
    expect(mockCleanupTempObjects).toHaveBeenCalledWith(mockSupabase, [tempPath]);
  });

  it("preserves shared tempStoragePath objects during intermediate chunks (isFinalChunk: false) and deletes on final chunk (SEC-12)", async () => {
    const tempPath = `${USER_ID}/import-media/shared-diagram.png`;
    mockConsumeTempUploadBytes.mockResolvedValue({
      bytes: VALID_1X1_PNG,
      cleanup: async () => {},
    });

    const storageUploadMock = vi.fn().mockResolvedValue({ error: null });

    const createCommitSupabase = () => ({
      storage: {
        from: () => ({
          upload: storageUploadMock,
        }),
      },
      from: (table: string) => {
        if (table === "questions") {
          return {
            select: (cols: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: async () => ({ count: 1, error: null }),
                };
              }
              if (cols === "position") {
                return {
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: { position: 0 }, error: null }),
                      }),
                    }),
                  }),
                };
              }
              return {
                eq: () => ({
                  eq: () => ({
                    limit: async () => ({ data: [], error: null }),
                  }),
                }),
              };
            },
            insert: () => ({
              select: async () => ({
                data: [{ id: "44444444-4444-4444-8444-444444444444", position: 1 }],
                error: null,
              }),
            }),
          };
        }
        if (table === "import_jobs") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: JOB_ID }, error: null }),
              }),
            }),
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: JOB_ID, status: "importing", imported_count: 1 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "media_assets") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: [], error: null }),
              }),
            }),
            insert: () => ({
              select: async () => ({
                data: [
                  {
                    id: "55555555-5555-4555-8555-555555555555",
                    storage_path: `${USER_ID}/${SET_ID}/import-mock.png`,
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        if (
          table === "question_options" ||
          table === "question_accepted_answers" ||
          table === "question_tags" ||
          table === "content_media_relations"
        ) {
          return {
            insert: async () => ({ data: null, error: null }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    });

    // Chunk 1 (isFinalChunk: false) -> MUST NOT delete shared tempStoragePath
    mockRequireAuth.mockResolvedValue({
      supabase: createCommitSupabase(),
      user: { id: USER_ID },
    });

    const chunk1Res = await commitPost(
      new Request("http://localhost/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studySetId: SET_ID,
          sourceFormat: "docx_multimedia",
          fileName: "multi-chunk.docx",
          fileSizeBytes: 2048,
          mode: "append",
          idempotencyKey: "multi-chunk-01",
          isFirstChunk: true,
          isFinalChunk: false,
          questions: [makeSampleQuestion(1, tempPath)],
        }),
      }),
    );
    expect(chunk1Res.status).toBe(200);
    expect(mockCleanupTempObjects).not.toHaveBeenCalled();

    // Chunk 2 (isFinalChunk: true) -> MUST clean up shared tempStoragePath
    const sb2 = createCommitSupabase();
    mockRequireAuth.mockResolvedValue({
      supabase: sb2,
      user: { id: USER_ID },
    });

    const chunk2Res = await commitPost(
      new Request("http://localhost/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studySetId: SET_ID,
          sourceFormat: "docx_multimedia",
          fileName: "multi-chunk.docx",
          fileSizeBytes: 2048,
          mode: "append",
          importJobId: JOB_ID,
          idempotencyKey: "multi-chunk-02",
          isFirstChunk: false,
          isFinalChunk: true,
          tempMediaPathsToCleanup: [tempPath],
          questions: [makeSampleQuestion(2)],
        }),
      }),
    );
    expect(chunk2Res.status).toBe(200);
    expect(mockCleanupTempObjects).toHaveBeenCalledTimes(1);
    expect(mockCleanupTempObjects).toHaveBeenCalledWith(sb2, [tempPath]);
  });
});
