// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as getExamAttempt } from "@/app/api/exams/[attemptId]/route";
import { POST as postExamPreview } from "@/app/api/exams/preview/route";
import {
  completeCoverageExam,
  CoverageCycleError,
  createCoverageCycle,
  discardActiveCoverageExam,
  getCoverageProgressSummary,
  issueNextCoverageExam,
  planCoverageSeries,
  restartCoverageCycle,
  type CoveragePoolItemInput,
} from "@/lib/learning/coverage-engine";
import {
  computeExamAllocation,
  sampleGlobalRandomPool,
  validateQuestionCount,
  type AllocationSubjectInput,
} from "@/lib/learning/exam-allocator";
import {
  calculateRemainingMs,
  calculateWeightedAccuracyPercent,
  gradeExamQuestion,
  isExamExpired,
  sanitizeExamQuestionsForClient,
  scoreExamAttempt,
} from "@/lib/learning/exam-scoring";
import {
  selectQuestionsByPolicy as selectQuestionsFrontend,
  type SelectableQuestionCandidate,
} from "@/lib/learning/exam-selector";
import {
  createSeededRng,
  shuffleOptions,
  shuffleQuestions,
} from "@/lib/learning/shuffle";
import { calculateNextReview } from "@/lib/learning/sm2";
import {
  gradeWriteAnswer,
  normalizeNumericCanonical,
  normalizeShortAnswerSqlCompatible,
} from "@/lib/learning/write-grader";
import * as authz from "@/lib/security/authz";
import { normalizeAnswerText } from "@/lib/security/sanitize";
import {
  buildCoverageBatchSizes,
  computeSubjectAllocations,
  extractSourceIds,
  selectQuestionsByPolicy as selectQuestionsBackend,
  stripPreSubmitQuestions,
  type EligibleCandidateRow,
} from "@/lib/supabase/exam-engine";
import { computeDeterministicSm2 } from "@/lib/supabase/progress-helper";
import * as rpc from "@/lib/supabase/rpc";
import {
  createExamSchema,
  examPreviewRequestSchema,
} from "@/lib/validation/exams";
import type {
  ExamAttemptAnswer,
  ExamSnapshotQuestion,
  QuestionOption,
  SelfRating,
} from "@/types/domain";

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Helper Builders
// ============================================================================

function makePool(
  spec: Array<{ subjectId: string; title: string; count: number }>,
): CoveragePoolItemInput[] {
  const pool: CoveragePoolItemInput[] = [];
  for (const s of spec) {
    for (let i = 1; i <= s.count; i += 1) {
      pool.push({
        questionId: `${s.subjectId}-q-${String(i).padStart(4, "0")}`,
        subjectId: s.subjectId,
        subjectTitle: s.title,
      });
    }
  }
  return pool;
}

function makeSnapshotMcQuestion(
  id: string,
  subjectId: string,
  subjectTitle: string,
  chapter: string,
  correctOptionIdx: number,
  tags: Array<{ id: string; name: string }> = [],
): ExamSnapshotQuestion {
  const opts = ["A", "B", "C", "D"].map((label, idx) => ({
    id: `${id}-opt-${idx}`,
    label,
    content: `Option ${label} for ${id}`,
    image_url: null,
    position: idx,
  }));
  return {
    id,
    attempt_id: "att-1",
    question_id: `src-${id}`,
    position: 0,
    question_type: "single_choice",
    source_study_set_id: subjectId,
    source_subject_title: subjectTitle,
    chapter_snapshot: chapter,
    tags_snapshot: tags,
    prompt_snapshot: `Prompt for ${id}`,
    prompt_image_url_snapshot: null,
    explanation_snapshot: `Secret explanation for ${id}`,
    options_snapshot: opts,
    correct_option_ids: [opts[correctOptionIdx].id],
    accepted_answers_snapshot: [],
    created_at: new Date().toISOString(),
  };
}

// ============================================================================
// 1. Section 26 — Question Sampling & Strict Validation
// ============================================================================

describe("V2.0 Section 26.1: Question Sampling, Strict Count Validation & Deduplication", () => {
  const single500Subject: AllocationSubjectInput[] = [
    { subjectId: "sub-500", title: "Bank 500", availableCount: 500 },
  ];

  it("supports exact boundary counts: 500->250, 500->1, and 500->500 without replacement", () => {
    const pool = makePool([
      { subjectId: "sub-500", title: "Bank 500", count: 500 },
    ]).map((p) => ({ id: p.questionId, subjectId: p.subjectId }));

    for (const target of [1, 250, 500]) {
      const check = validateQuestionCount(target, 500);
      expect(check.valid).toBe(true);
      expect(check.value).toBe(target);

      const alloc = computeExamAllocation({
        strategy: "global_random",
        subjects: single500Subject,
        requestedCount: target,
      });
      expect(alloc.valid).toBe(true);
      expect(alloc.totalAllocated).toBe(target);

      const sampled = sampleGlobalRandomPool(
        pool,
        target,
        createSeededRng(`seed-${target}`),
      );
      expect(sampled.selected).toHaveLength(target);
      expect(new Set(sampled.selected.map((q) => q.id)).size).toBe(target);
    }
  });

  it("strictly rejects 500->501 (NEVER silently clamps) in both frontend & backend allocators", () => {
    const feCheck = validateQuestionCount(501, 500);
    expect(feCheck.valid).toBe(false);
    expect(feCheck.code).toBe("EXCEEDS_AVAILABLE");

    const feAlloc = computeExamAllocation({
      strategy: "proportional",
      subjects: single500Subject,
      requestedCount: 501,
    });
    expect(feAlloc.valid).toBe(false);
    expect(feAlloc.errors.some((e) => e.code === "EXCEEDS_AVAILABLE")).toBe(true);

    const beAlloc = computeSubjectAllocations({
      subjects: [{ study_set_id: "sub-500", title: "Bank 500", eligible_count: 500 }],
      requestedCount: 501,
      strategy: "proportional",
    });
    expect(beAlloc.valid).toBe(false);
    expect(beAlloc.errors.some((e) => e.code === "EXCEEDS_AVAILABLE_POOL")).toBe(
      true,
    );
  });

  it("strictly rejects 0, negative, decimal, text, NaN, and Infinity inputs", () => {
    const invalidInputs: Array<{ value: unknown; expectedCodes: string[] }> = [
      { value: 0, expectedCodes: ["NON_POSITIVE"] },
      { value: -10, expectedCodes: ["NON_POSITIVE"] },
      { value: "-5", expectedCodes: ["NON_POSITIVE"] },
      { value: 12.5, expectedCodes: ["NON_INTEGER"] },
      { value: "12.5", expectedCodes: ["NON_INTEGER"] },
      { value: "abc", expectedCodes: ["INVALID_NUMBER"] },
      { value: "", expectedCodes: ["INVALID_NUMBER"] },
      { value: Number.NaN, expectedCodes: ["INVALID_NUMBER"] },
      { value: Number.POSITIVE_INFINITY, expectedCodes: ["INVALID_NUMBER"] },
      { value: null, expectedCodes: ["INVALID_NUMBER"] },
    ];

    for (const tc of invalidInputs) {
      const res = validateQuestionCount(tc.value, 500);
      expect(res.valid, `Expected invalid for ${String(tc.value)}`).toBe(false);
      expect(tc.expectedCodes).toContain(res.code);
    }

    // Zod schema validation parity
    const validSource = [
      {
        source_type: "study_set" as const,
        id: "11111111-1111-4111-8111-111111111111",
      },
    ];
    for (const bad of [0, -1, 12.5, "abc", Number.NaN]) {
      const parsed = examPreviewRequestSchema.safeParse({
        sources: validSource,
        requested_question_count: bad,
      });
      expect(parsed.success, `Zod must reject ${String(bad)}`).toBe(false);
    }
  });

  it("rejects empty subject selection and zero-question pools", () => {
    const emptyRes = computeExamAllocation({
      strategy: "proportional",
      subjects: [],
      requestedCount: 10,
    });
    expect(emptyRes.valid).toBe(false);
    expect(emptyRes.errors[0]?.code).toBe("EMPTY_SUBJECTS");

    const zeroPoolRes = computeExamAllocation({
      strategy: "equal",
      subjects: [{ subjectId: "s1", title: "Empty", availableCount: 0 }],
      requestedCount: 1,
    });
    expect(zeroPoolRes.valid).toBe(false);
    expect(zeroPoolRes.errors[0]?.code).toBe("NO_ELIGIBLE_QUESTIONS");

    const beEmpty = computeSubjectAllocations({
      subjects: [],
      requestedCount: 10,
      strategy: "equal",
    });
    expect(beEmpty.valid).toBe(false);
    expect(beEmpty.actualCount).toBe(0);
    expect(["EMPTY_ELIGIBLE_POOL", "EXCEEDS_AVAILABLE_POOL"]).toContain(
      beEmpty.errors[0]?.code,
    );

    const zodEmptySources = examPreviewRequestSchema.safeParse({
      sources: [],
      requested_question_count: 10,
    });
    expect(zodEmptySources.success).toBe(false);
  });

  it("deduplicates duplicate subjects, duplicate folder/set sources, and duplicate pool question IDs", () => {
    // 1. Duplicate subjects in allocator
    const alloc = computeExamAllocation({
      strategy: "proportional",
      subjects: [
        { subjectId: "s1", title: "Met 01", availableCount: 133 },
        { subjectId: "s1", title: "Met 01 (duplicate)", availableCount: 133 },
        { subjectId: "s2", title: "Met 05", availableCount: 24 },
      ],
      requestedCount: 50,
    });
    expect(alloc.valid).toBe(true);
    expect(alloc.totalAvailable).toBe(157);
    expect(alloc.allocations).toHaveLength(2);

    // 2. Duplicate folder & set IDs in backend extractSourceIds
    const extracted = extractSourceIds([
      { source_type: "folder", id: "f1", include_subfolders: true },
      { source_type: "folder", id: "f1", include_subfolders: true },
      { source_type: "study_set", id: "s1", include_subfolders: true },
      { source_type: "study_set", id: "s1", include_subfolders: true },
      { source_type: "study_set", id: "s2", include_subfolders: true },
    ]);
    expect(extracted.folderIds).toEqual(["f1"]);
    expect(extracted.studySetIds).toEqual(["s1", "s2"]);

    // 3. Duplicate question IDs in global random pool
    const duplicatedPool = [
      { id: "q1", subjectId: "s1" },
      { id: "q1", subjectId: "s1" },
      { id: "q2", subjectId: "s1" },
      { id: "q3", subjectId: "s2" },
      { id: "q3", subjectId: "s2" },
    ];
    const sampled = sampleGlobalRandomPool(duplicatedPool, 10, createSeededRng(42));
    expect(sampled.selected).toHaveLength(3);
    expect(new Set(sampled.selected.map((x) => x.id)).size).toBe(3);
  });
});

// ============================================================================
// 2. Section 26.2 — All 5 Multi-Subject Allocation Strategies (FE + BE Parity)
// ============================================================================

describe("V2.0 Section 26.2: All 5 Allocation Strategies (Frontend & Backend Parity)", () => {
  const threeSubjectsFe: AllocationSubjectInput[] = [
    { subjectId: "s1", title: "Subject 1 (500)", availableCount: 500 },
    { subjectId: "s2", title: "Subject 2 (226)", availableCount: 226 },
    { subjectId: "s3", title: "Subject 3 (133)", availableCount: 133 },
  ];

  const threeSubjectsBe = [
    { study_set_id: "s1", title: "Subject 1 (500)", eligible_count: 500 },
    { study_set_id: "s2", title: "Subject 2 (226)", eligible_count: 226 },
    { study_set_id: "s3", title: "Subject 3 (133)", eligible_count: 133 },
  ];

  it("Strategy A (Global Random): marks dynamic sampling and never fabricates exact pre-fixed quotas", () => {
    const fe = computeExamAllocation({
      strategy: "global_random",
      subjects: threeSubjectsFe,
      requestedCount: 250,
    });
    expect(fe.valid).toBe(true);
    expect(fe.isDynamicSampling).toBe(true);
    expect(fe.totalAllocated).toBe(250);
    expect(fe.allocations.every((a) => a.allocatedCount === null)).toBe(true);

    const be = computeSubjectAllocations({
      subjects: threeSubjectsBe,
      requestedCount: 250,
      strategy: "global_random",
    });
    expect(be.valid).toBe(true);
    expect(be.actualCount).toBe(250);
    expect(be.allocations.every((a) => a.allocated_count === 0)).toBe(true);
  });

  it("Strategy B (Equal): handles remainders cleanly and redistributes capacity shortages iteratively", () => {
    // 1. Remainder distribution without shortage: 250 / 3 = 83 rem 1 -> [84, 83, 83]
    const feRem = computeExamAllocation({
      strategy: "equal",
      subjects: threeSubjectsFe,
      requestedCount: 250,
    });
    const beRem = computeSubjectAllocations({
      subjects: threeSubjectsBe,
      requestedCount: 250,
      strategy: "equal",
    });
    expect(feRem.valid).toBe(true);
    expect(beRem.valid).toBe(true);
    expect(feRem.allocations.map((a) => a.allocatedCount)).toEqual([84, 83, 83]);
    expect(beRem.allocations.map((a) => a.allocated_count)).toEqual([84, 83, 83]);

    // 2. Capacity shortage redistribution: [500, 24, 133] for N=120 -> S2 caps at 24, rest 96 split [48, 24, 48]
    const shortageFe = computeExamAllocation({
      strategy: "equal",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 500 },
        { subjectId: "s2", title: "S2", availableCount: 24 },
        { subjectId: "s3", title: "S3", availableCount: 133 },
      ],
      requestedCount: 120,
    });
    const shortageBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "s1", title: "S1", eligible_count: 500 },
        { study_set_id: "s2", title: "S2", eligible_count: 24 },
        { study_set_id: "s3", title: "S3", eligible_count: 133 },
      ],
      requestedCount: 120,
      strategy: "equal",
    });
    expect(shortageFe.wasRedistributed).toBe(true);
    expect(shortageBe.wasRedistributed).toBe(true);
    expect(shortageFe.allocations.map((a) => a.allocatedCount)).toEqual([48, 24, 48]);
    expect(shortageBe.allocations.map((a) => a.allocated_count)).toEqual([48, 24, 48]);

    // 3. Cascading multi-shortage: [500, 24, 62] for N=180 -> [94, 24, 62]
    const cascadeFe = computeExamAllocation({
      strategy: "equal",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 500 },
        { subjectId: "s2", title: "S2", availableCount: 24 },
        { subjectId: "s3", title: "S3", availableCount: 62 },
      ],
      requestedCount: 180,
    });
    const cascadeBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "s1", title: "S1", eligible_count: 500 },
        { study_set_id: "s2", title: "S2", eligible_count: 24 },
        { study_set_id: "s3", title: "S3", eligible_count: 62 },
      ],
      requestedCount: 180,
      strategy: "equal",
    });
    expect(cascadeFe.allocations.map((a) => a.allocatedCount)).toEqual([94, 24, 62]);
    expect(cascadeBe.allocations.map((a) => a.allocated_count)).toEqual([94, 24, 62]);
  });

  it("Strategy C (Proportional): exact Hamilton largest-remainder 500/226/133 -> 145/66/39 for N=250", () => {
    const fe = computeExamAllocation({
      strategy: "proportional",
      subjects: threeSubjectsFe,
      requestedCount: 250,
    });
    const be = computeSubjectAllocations({
      subjects: threeSubjectsBe,
      requestedCount: 250,
      strategy: "proportional",
    });

    expect(fe.valid).toBe(true);
    expect(be.valid).toBe(true);
    expect(fe.allocations.map((a) => a.allocatedCount)).toEqual([145, 66, 39]);
    expect(be.allocations.map((a) => a.allocated_count)).toEqual([145, 66, 39]);
    expect(fe.totalAllocated).toBe(250);
    expect(be.actualCount).toBe(250);

    // Real aviation 3-subject pool [133, 24, 62] for N=50 -> [30, 6, 14]
    const metFe = computeExamAllocation({
      strategy: "proportional",
      subjects: [
        { subjectId: "m1", title: "Atmosphere", availableCount: 133 },
        { subjectId: "m5", title: "Precipitation", availableCount: 24 },
        { subjectId: "m8", title: "Climatology", availableCount: 62 },
      ],
      requestedCount: 50,
    });
    const metBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "m1", title: "Atmosphere", eligible_count: 133 },
        { study_set_id: "m5", title: "Precipitation", eligible_count: 24 },
        { study_set_id: "m8", title: "Climatology", eligible_count: 62 },
      ],
      requestedCount: 50,
      strategy: "proportional",
    });
    expect(metFe.allocations.map((a) => a.allocatedCount)).toEqual([30, 6, 14]);
    expect(metBe.allocations.map((a) => a.allocated_count)).toEqual([30, 6, 14]);
  });

  it("Strategy D (Custom): honors exact valid counts and rejects overflow or sum mismatch", () => {
    const validFe = computeExamAllocation({
      strategy: "custom",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 133, customCount: 30 },
        { subjectId: "s2", title: "S2", availableCount: 24, customCount: 10 },
        { subjectId: "s3", title: "S3", availableCount: 62, customCount: 20 },
      ],
      requestedCount: 60,
    });
    expect(validFe.valid).toBe(true);
    expect(validFe.allocations.map((a) => a.allocatedCount)).toEqual([30, 10, 20]);

    // Overflow subject capacity (30 > 24)
    const overflowBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "s1", title: "S1", eligible_count: 133, custom_count: 20 },
        { study_set_id: "s2", title: "S2", eligible_count: 24, custom_count: 30 },
        { study_set_id: "s3", title: "S3", eligible_count: 62, custom_count: 10 },
      ],
      requestedCount: 60,
      strategy: "custom",
    });
    expect(overflowBe.valid).toBe(false);
    expect(
      overflowBe.errors.some((e) => e.code === "CUSTOM_COUNT_EXCEEDS_ELIGIBLE"),
    ).toBe(true);

    // Sum mismatch (55 != 60)
    const mismatchFe = computeExamAllocation({
      strategy: "custom",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 133, customCount: 25 },
        { subjectId: "s2", title: "S2", availableCount: 24, customCount: 10 },
        { subjectId: "s3", title: "S3", availableCount: 62, customCount: 20 },
      ],
      requestedCount: 60,
    });
    expect(mismatchFe.valid).toBe(false);
    expect(mismatchFe.remainingUnallocated).toBe(5);
    expect(mismatchFe.errors.some((e) => e.code === "CUSTOM_SUM_MISMATCH")).toBe(
      true,
    );
  });

  it("Strategy E (Weighted): enforces 100% sum and flags redistribution confirmation on cap overflow", () => {
    // Rejects != 100%
    const badSumFe = computeExamAllocation({
      strategy: "weighted",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 133, weightPercent: 50 },
        { subjectId: "s2", title: "S2", availableCount: 24, weightPercent: 40 },
      ],
      requestedCount: 50,
    });
    expect(badSumFe.valid).toBe(false);
    expect(badSumFe.errors.some((e) => e.code === "WEIGHTS_SUM_NOT_100")).toBe(
      true,
    );

    const badSumBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "s1", title: "S1", eligible_count: 133, custom_percentage: 60 },
        { study_set_id: "s2", title: "S2", eligible_count: 24, custom_percentage: 50 },
      ],
      requestedCount: 50,
      strategy: "weighted",
    });
    expect(badSumBe.valid).toBe(false);
    expect(badSumBe.errors.some((e) => e.code === "WEIGHTS_MUST_SUM_TO_100")).toBe(
      true,
    );

    // Valid weighted cap overflow -> redistributes excess + requires explicit confirmation
    const redistFe = computeExamAllocation({
      strategy: "weighted",
      subjects: [
        { subjectId: "s1", title: "S1", availableCount: 133, weightPercent: 25 },
        { subjectId: "s2", title: "S2", availableCount: 24, weightPercent: 50 },
        { subjectId: "s3", title: "S3", availableCount: 62, weightPercent: 25 },
      ],
      requestedCount: 100,
    });
    const redistBe = computeSubjectAllocations({
      subjects: [
        { study_set_id: "s1", title: "S1", eligible_count: 133, custom_percentage: 25 },
        { study_set_id: "s2", title: "S2", eligible_count: 24, custom_percentage: 50 },
        { study_set_id: "s3", title: "S3", eligible_count: 62, custom_percentage: 25 },
      ],
      requestedCount: 100,
      strategy: "weighted",
    });
    // S2 ideal = 50, capped at 24 -> remaining 76 split 50/50 between S1 & S3 -> [38, 24, 38]
    expect(redistFe.valid).toBe(true);
    expect(redistFe.wasRedistributed).toBe(true);
    expect(redistFe.requiresConfirmation).toBe(true);
    expect(redistFe.allocations.map((a) => a.allocatedCount)).toEqual([38, 24, 38]);

    expect(redistBe.valid).toBe(true);
    expect(redistBe.wasRedistributed).toBe(true);
    expect(redistBe.warnings.some((w) => w.code === "SHORTFALL_REDISTRIBUTED")).toBe(
      true,
    );
    expect(redistBe.allocations.map((a) => a.allocated_count)).toEqual([38, 24, 38]);
  });

  it("handles requested count < number of subjects deterministically across strategies", () => {
    const fiveFe: AllocationSubjectInput[] = [
      { subjectId: "a", title: "A", availableCount: 50, weightPercent: 20 },
      { subjectId: "b", title: "B", availableCount: 40, weightPercent: 20 },
      { subjectId: "c", title: "C", availableCount: 30, weightPercent: 20 },
      { subjectId: "d", title: "D", availableCount: 20, weightPercent: 20 },
      { subjectId: "e", title: "E", availableCount: 10, weightPercent: 20 },
    ];
    const fiveBe = fiveFe.map((s) => ({
      study_set_id: s.subjectId,
      title: s.title!,
      eligible_count: s.availableCount,
      custom_percentage: s.weightPercent,
    }));

    for (const strategy of ["equal", "proportional", "weighted"] as const) {
      const fe = computeExamAllocation({
        strategy,
        subjects: fiveFe,
        requestedCount: 3,
      });
      const be = computeSubjectAllocations({
        subjects: fiveBe,
        requestedCount: 3,
        strategy,
      });
      expect(fe.valid).toBe(true);
      expect(be.valid).toBe(true);
      expect(fe.totalAllocated).toBe(3);
      expect(be.actualCount).toBe(3);
      expect(
        fe.allocations.reduce((s, a) => s + (a.allocatedCount ?? 0), 0),
      ).toBe(3);
      expect(be.allocations.reduce((s, a) => s + a.allocated_count, 0)).toBe(3);
    }
  });
});

// ============================================================================
// 3. Section 26.3 — All 8 Selection Policies (Strict Filters & Honest Anti-Repeat)
// ============================================================================

describe("V2.0 Section 26.3: All 8 Question Selection Policies", () => {
  const now = new Date("2026-11-24T12:00:00.000Z");

  function buildRichCandidates(): {
    fe: SelectableQuestionCandidate[];
    be: EligibleCandidateRow[];
  } {
    const fe: SelectableQuestionCandidate[] = [];
    const be: EligibleCandidateRow[] = [];

    for (let i = 1; i <= 30; i += 1) {
      const id = `q-${String(i).padStart(2, "0")}`;
      const isUnseen = i <= 6; // q-01..q-06 unseen
      const isMistake = i >= 7 && i <= 11; // q-07..q-11 unresolved mistakes
      const isDue = i >= 12 && i <= 16; // q-12..q-16 overdue SM-2
      const isStarred = i >= 17 && i <= 20; // q-17..q-20 starred (4 total)
      const isWeakTopic = i >= 7 && i <= 11; // Ch-Weak has 0% accuracy

      const chapter = isWeakTopic ? "Ch-Weak" : "Ch-Strong";
      const wrongCount = isMistake ? 12 - i : 0; // q-07 has 5 wrong, q-11 has 1 wrong
      const correctCount = isUnseen ? 0 : isMistake ? 0 : 4;
      const masteryLevel = isUnseen
        ? "new"
        : isMistake
          ? "learning"
          : isDue
            ? "familiar"
            : "mastered";
      const nextReviewAt = isDue
        ? new Date(now.getTime() - (20 - i) * 86_400_000).toISOString()
        : new Date(now.getTime() + 14 * 86_400_000).toISOString();
      const lastReviewedAt = isUnseen
        ? null
        : new Date(now.getTime() - i * 3600_000).toISOString();

      fe.push({
        id,
        subjectId: "s1",
        chapter,
        isStarred,
        masteryLevel,
        correctCount,
        wrongCount,
        lastReviewedAt,
        nextReviewAt,
      });

      be.push({
        id,
        study_set_id: "s1",
        chapter,
        difficulty: "medium",
        question_type: "single_choice",
        is_starred: isStarred,
        is_unseen: isUnseen,
        is_mistake: isMistake,
        is_due: isDue,
        wrong_count: wrongCount,
        correct_count: correctCount,
        last_reviewed_at: lastReviewedAt,
        next_review_at: nextReviewAt,
        mastery_level: masteryLevel,
      });
    }
    return { fe, be };
  }

  it("1. random: selects exact count uniformly without replacement", () => {
    const { fe, be } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, { policy: "random", count: 12, seed: 7 });
    const rBe = selectQuestionsBackend(be, 12, "random");
    expect(rFe.selected).toHaveLength(12);
    expect(new Set(rFe.selected.map((q) => q.id)).size).toBe(12);
    expect(rBe.selected).toHaveLength(12);
    expect(new Set(rBe.selected.map((q) => q.id)).size).toBe(12);
  });

  it("2. unseen_first: prioritizes all 6 unseen questions before seen fallback", () => {
    const { fe, be } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "unseen_first",
      count: 10,
      seed: 1,
    });
    const rBe = selectQuestionsBackend(be, 10, "unseen_first");

    const unseenIds = new Set(["q-01", "q-02", "q-03", "q-04", "q-05", "q-06"]);
    expect(rFe.selected.slice(0, 6).every((q) => unseenIds.has(q.id))).toBe(true);
    expect(rFe.disclosure).toContain("6 unseen");
    expect(rBe.selected.slice(0, 6).every((q) => unseenIds.has(q.id))).toBe(true);
  });

  it("3. mistakes_first: prioritizes unresolved mistakes ordered by wrongCount desc before rest", () => {
    const { fe, be } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "mistakes_first",
      count: 10,
      seed: 2,
    });
    const rBe = selectQuestionsBackend(be, 10, "mistakes_first");

    expect(rFe.selected.slice(0, 5).map((q) => q.id)).toEqual([
      "q-07",
      "q-08",
      "q-09",
      "q-10",
      "q-11",
    ]);
    expect(rBe.selected.slice(0, 5).map((q) => q.id)).toEqual([
      "q-07",
      "q-08",
      "q-09",
      "q-10",
      "q-11",
    ]);
  });

  it("4. weak_topics_first: prioritizes deterministic weakest chapter (Ch-Weak) first", () => {
    const { fe, be } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "weak_topics_first",
      count: 5,
      seed: 3,
    });
    const rBe = selectQuestionsBackend(be, 5, "weak_topics_first");

    expect(rFe.selected.every((q) => q.chapter === "Ch-Weak")).toBe(true);
    expect(rBe.selected.every((q) => q.chapter === "Ch-Weak")).toBe(true);
  });

  it("5. due_for_review: prioritizes all 5 overdue SM-2 questions most-overdue first", () => {
    const { fe, be } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "due_for_review",
      count: 8,
      now,
      seed: 4,
    });
    const rBe = selectQuestionsBackend(be, 8, "due_for_review");

    // q-12 is oldest due (-8d) .. q-16 (-4d)
    expect(rFe.selected.slice(0, 5).map((q) => q.id)).toEqual([
      "q-12",
      "q-13",
      "q-14",
      "q-15",
      "q-16",
    ]);
    expect(rBe.selected.slice(0, 5).map((q) => q.id)).toEqual([
      "q-12",
      "q-13",
      "q-14",
      "q-15",
      "q-16",
    ]);
  });

  it("6. starred_only: STRICT non-padding — returns ONLY 4 starred items when 15 requested", () => {
    const { fe } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "starred_only",
      count: 15,
      seed: 5,
    });
    expect(rFe.isStrictFilter).toBe(true);
    expect(rFe.selected).toHaveLength(4);
    expect(rFe.selected.every((q) => q.isStarred)).toBe(true);
    expect(rFe.shortfall).toBe(11);
    expect(rFe.disclosure).toContain("4 starred");
  });

  it("7. incorrect_only: STRICT non-padding — returns ONLY 5 missed items when 15 requested", () => {
    const { fe } = buildRichCandidates();
    const rFe = selectQuestionsFrontend(fe, {
      policy: "incorrect_only",
      count: 15,
      seed: 6,
    });
    expect(rFe.isStrictFilter).toBe(true);
    expect(rFe.selected).toHaveLength(5);
    expect(rFe.selected.every((q) => (q.wrongCount ?? 0) > 0)).toBe(true);
    expect(rFe.shortfall).toBe(10);
    expect(rFe.disclosure).toContain("5 previously missed");
  });

  it("8. anti_repeat: excludes recent questions first and honestly discloses exact repeatedCount", () => {
    const { fe, be } = buildRichCandidates();
    // 25 of 30 questions were recently completed -> only 5 fresh remain
    const recentIds = new Set(fe.slice(5).map((q) => q.id));
    const recentRanks = new Map<string, number>();
    const recentTs = new Map<string, number>();
    fe.slice(5).forEach((q, idx) => {
      recentRanks.set(q.id, idx); // 0 = most recent, 24 = oldest
      recentTs.set(q.id, now.getTime() - idx * 60_000);
    });

    const rFe = selectQuestionsFrontend(fe, {
      policy: "anti_repeat",
      count: 12,
      seed: 8,
      recentlyCompletedQuestionIds: recentIds,
      recentCompletionTimestamps: recentTs,
    });
    expect(rFe.selected).toHaveLength(12);
    expect(rFe.hasRepeats).toBe(true);
    expect(rFe.repeatedCount).toBe(7);
    expect(rFe.repeatedQuestionIds).toHaveLength(7);
    expect(rFe.disclosure).toContain("7 recently completed");
    // First 5 must be the 5 fresh questions
    expect(rFe.selected.slice(0, 5).every((q) => !recentIds.has(q.id))).toBe(true);

    const rBe = selectQuestionsBackend(be, 12, "anti_repeat", recentRanks);
    expect(rBe.selected).toHaveLength(12);
    expect(rBe.repeatedCount).toBe(7);
    expect(rBe.selected.slice(0, 5).every((q) => !recentIds.has(q.id))).toBe(true);
  });
});

// ============================================================================
// 4. Section 26.4 — Full Coverage / No-Repeat Cycles
// ============================================================================

describe("V2.0 Section 26.4: Full Coverage Cycles (Zero Overlap, Tri-State, Abandon, Snapshot)", () => {
  it("500 -> 250 + 250 covers all 500 unique questions with zero overlap", () => {
    const plan = planCoverageSeries(500, 250);
    expect(plan.examSizes).toEqual([250, 250]);
    expect(plan.formattedPlan).toBe("250 + 250");
    expect(buildCoverageBatchSizes(500, 250)).toEqual([250, 250]);

    const pool = makePool([
      { subjectId: "s1", title: "S1", count: 300 },
      { subjectId: "s2", title: "S2", count: 200 },
    ]);
    let cycle = createCoverageCycle(pool, {
      id: "cyc-250",
      title: "500 in 2",
      questionsPerExam: 250,
      allocationStrategy: "proportional",
      seed: "cov-500-250",
    });

    const issued1 = issueNextCoverageExam(cycle, "att-1", { seed: "a1" });
    expect(issued1.selectedQuestionIds).toHaveLength(250);
    cycle = completeCoverageExam(
      issued1.cycle,
      "att-1",
      issued1.selectedQuestionIds.map((qId) => ({
        questionId: qId,
        wasAnswered: true,
        isCorrect: true,
      })),
    );
    expect(cycle.completedCount).toBe(250);
    expect(cycle.remainingCount).toBe(250);
    expect(cycle.status).toBe("active");

    const issued2 = issueNextCoverageExam(cycle, "att-2", { seed: "a2" });
    expect(issued2.selectedQuestionIds).toHaveLength(250);
    cycle = completeCoverageExam(
      issued2.cycle,
      "att-2",
      issued2.selectedQuestionIds.map((qId) => ({
        questionId: qId,
        wasAnswered: true,
        isCorrect: true,
      })),
    );

    const set1 = new Set(issued1.selectedQuestionIds);
    const overlap = issued2.selectedQuestionIds.filter((id) => set1.has(id));
    expect(overlap).toHaveLength(0);

    const union = new Set([
      ...issued1.selectedQuestionIds,
      ...issued2.selectedQuestionIds,
    ]);
    expect(union.size).toBe(500);
    expect(cycle.status).toBe("completed");
    expect(cycle.completedCount).toBe(500);
    expect(cycle.remainingCount).toBe(0);
  });

  it("500 -> 120 x 4 + 20 partitions into 5 zero-overlap exams with smaller final exam", () => {
    const plan = planCoverageSeries(500, 120);
    expect(plan.examSizes).toEqual([120, 120, 120, 120, 20]);
    expect(plan.hasSmallerFinalExam).toBe(true);
    expect(plan.formattedPlan).toBe("120 × 4 + 20");
    expect(buildCoverageBatchSizes(500, 120)).toEqual([120, 120, 120, 120, 20]);

    const pool = makePool([{ subjectId: "s1", title: "ATPL", count: 500 }]);
    let cycle = createCoverageCycle(pool, {
      id: "cyc-120",
      title: "500 in 120s",
      questionsPerExam: 120,
      seed: "cov-500-120",
    });

    const seen = new Set<string>();
    const observedSizes: number[] = [];

    for (let i = 1; i <= 5; i += 1) {
      const issued = issueNextCoverageExam(cycle, `att-${i}`);
      observedSizes.push(issued.selectedQuestionIds.length);
      for (const qId of issued.selectedQuestionIds) {
        expect(seen.has(qId), `Overlap detected on ${qId}`).toBe(false);
        seen.add(qId);
      }
      cycle = completeCoverageExam(
        issued.cycle,
        `att-${i}`,
        issued.selectedQuestionIds.map((qId) => ({
          questionId: qId,
          wasAnswered: true,
          isCorrect: true,
        })),
      );
    }

    expect(observedSizes).toEqual([120, 120, 120, 120, 20]);
    expect(seen.size).toBe(500);
    expect(cycle.status).toBe("completed");
  });

  it("tracks assigned vs answered vs completed distinctly and returns unanswered/discarded items to remaining pool", () => {
    const pool = makePool([{ subjectId: "s1", title: "Met", count: 100 }]);
    let cycle = createCoverageCycle(pool, {
      id: "cyc-tri",
      title: "Tri-State",
      questionsPerExam: 40,
      seed: "tri-state",
    });

    // 1. Issue Exam #1 -> 40 assigned, 0 answered, 0 completed, 60 remaining
    const issued1 = issueNextCoverageExam(cycle, "att-1");
    cycle = issued1.cycle;
    expect(cycle.assignedCount).toBe(40);
    expect(cycle.answeredCount).toBe(0);
    expect(cycle.completedCount).toBe(0);
    expect(cycle.remainingCount).toBe(60);

    // Concurrency guard: cannot issue Exam #2 while Exam #1 is active
    expect(() => issueNextCoverageExam(cycle, "att-dup")).toThrowError(
      CoverageCycleError,
    );

    // 2. Abandon / Discard Exam #1 -> all 40 revert to remaining, 0 marked completed!
    cycle = discardActiveCoverageExam(cycle, "att-1");
    expect(cycle.activeAttemptId).toBeNull();
    expect(cycle.assignedCount).toBe(0);
    expect(cycle.completedCount).toBe(0);
    expect(cycle.remainingCount).toBe(100);
    expect(cycle.attempts[0]?.status).toBe("discarded");

    // 3. Issue Exam #2 (40Q), answer ONLY 30, leave 10 unanswered -> submit
    const issued2 = issueNextCoverageExam(cycle, "att-2");
    cycle = completeCoverageExam(
      issued2.cycle,
      "att-2",
      issued2.selectedQuestionIds.map((qId, idx) => ({
        questionId: qId,
        wasAnswered: idx < 30,
        isCorrect: idx < 25,
      })),
    );
    expect(cycle.completedCount).toBe(30);
    expect(cycle.answeredCount).toBe(30);
    expect(cycle.assignedCount).toBe(0);
    // The 10 unanswered items returned to remaining pool: 100 - 30 = 70!
    expect(cycle.remainingCount).toBe(70);

    const summary = getCoverageProgressSummary(cycle);
    expect(summary.completedPercent).toBe(30);
    expect(summary.mistakeQuestionIds).toHaveLength(5);
  });

  it("preserves original pool snapshot across restarts unless refresh_pool is explicitly provided", () => {
    const originalPool = makePool([{ subjectId: "s1", title: "Original", count: 20 }]);
    let cycle = createCoverageCycle(originalPool, {
      id: "cyc-snap",
      title: "Snap Test",
      questionsPerExam: 20,
      seed: "snap-1",
    });

    const issued = issueNextCoverageExam(cycle, "att-1");
    cycle = completeCoverageExam(
      issued.cycle,
      "att-1",
      issued.selectedQuestionIds.map((qId) => ({
        questionId: qId,
        wasAnswered: true,
        isCorrect: true,
      })),
    );
    expect(cycle.status).toBe("completed");

    // Restart WITHOUT refreshedPool -> preserves exact 20-question snapshot & attempt history
    const restartedSame = restartCoverageCycle(cycle, { seed: "snap-2" });
    expect(restartedSame.cycleNumber).toBe(2);
    expect(restartedSame.totalQuestions).toBe(20);
    expect(restartedSame.remainingCount).toBe(20);
    expect(restartedSame.attempts).toHaveLength(1);

    // Restart WITH refreshedPool (source modified to 25Q) -> adopts new 25Q pool cleanly
    const modifiedPool = makePool([{ subjectId: "s1", title: "Modified", count: 25 }]);
    const restartedRefreshed = restartCoverageCycle(restartedSame, {
      refreshedPool: modifiedPool,
      seed: "snap-3",
    });
    expect(restartedRefreshed.cycleNumber).toBe(3);
    expect(restartedRefreshed.totalQuestions).toBe(25);
    expect(restartedRefreshed.remainingCount).toBe(25);
  });
});

// ============================================================================
// 5. Section 26.5 — Exam Mechanics, Numeric 0/10/100, Weighted Accuracy, Anti-Leak & SM-2
// ============================================================================

describe("V2.0 Section 26.5: Exam Mechanics, UUID Invariance, Numeric Parity, Anti-Leak & SM-2", () => {
  it("grades choice questions strictly by stable option UUID under both question & option shuffling", () => {
    const rawOptions: QuestionOption[] = [
      {
        id: "opt-uuid-0",
        question_id: "q-1",
        study_set_id: "s-1",
        position: 0,
        label: "A",
        content: "Troposphere",
        image_url: null,
        is_correct: false,
        created_at: "",
      },
      {
        id: "opt-uuid-1",
        question_id: "q-1",
        study_set_id: "s-1",
        position: 1,
        label: "B",
        content: "Stratosphere",
        image_url: null,
        is_correct: true,
        created_at: "",
      },
      {
        id: "opt-uuid-2",
        question_id: "q-1",
        study_set_id: "s-1",
        position: 2,
        label: "C",
        content: "Mesosphere",
        image_url: null,
        is_correct: false,
        created_at: "",
      },
      {
        id: "opt-uuid-3",
        question_id: "q-1",
        study_set_id: "s-1",
        position: 3,
        label: "D",
        content: "Thermosphere",
        image_url: null,
        is_correct: false,
        created_at: "",
      },
    ];

    const shuffledOpts = shuffleOptions(rawOptions, createSeededRng("opt-seed-99"));
    const snapshotQ: ExamSnapshotQuestion = {
      id: "aq-1",
      attempt_id: "att-1",
      question_id: "q-1",
      position: 0,
      question_type: "single_choice",
      chapter_snapshot: "Ch 1",
      prompt_snapshot: "Where is the ozone layer primarily located?",
      prompt_image_url_snapshot: null,
      explanation_snapshot: "Stratosphere",
      options_snapshot: shuffledOpts.map((o, idx) => ({
        id: o.id,
        label: o.displayLabel,
        content: o.content,
        image_url: o.image_url,
        position: idx,
      })),
      correct_option_ids: ["opt-uuid-1"],
      accepted_answers_snapshot: [],
      created_at: "",
    };

    // Shuffling question array order preserves grading invariance
    const questionsShuffled = shuffleQuestions(
      [snapshotQ, makeSnapshotMcQuestion("aq-2", "s-1", "Met", "Ch 1", 2)],
      createSeededRng("q-order-7"),
    );
    expect(questionsShuffled).toHaveLength(2);

    // Selecting exact UUID passes regardless of displayed letter
    expect(
      gradeExamQuestion(snapshotQ, { selected_option_ids: ["opt-uuid-1"] }).isCorrect,
    ).toBe(true);

    // Crafted multi-UUID payload on single_choice MUST fail
    expect(
      gradeExamQuestion(snapshotQ, {
        selected_option_ids: ["opt-uuid-1", "opt-uuid-2"],
      }).isCorrect,
    ).toBe(false);
  });

  it("normalizes numeric short answers identically for 0, 10, 100, 1.50, 3,5 (fixes SH-007)", () => {
    const cases: Array<[string, string]> = [
      ["0", "0"],
      ["0.00", "0"],
      ["-0", "0"],
      ["10", "10"],
      ["10.0", "10"],
      ["100", "100"],
      ["100.00", "100"],
      ["1.50", "1.5"],
      ["3,5", "3.5"],
      ["0042.0", "42"],
      ["-12.500", "-12.5"],
    ];

    for (const [raw, expected] of cases) {
      expect(normalizeNumericCanonical(raw)).toBe(expected);
      expect(normalizeShortAnswerSqlCompatible(raw, "numeric")).toBe(expected);
      expect(normalizeAnswerText(raw, "numeric")).toBe(expected);
    }

    // Critical regression guards: 10 != 1, 100 != 1, 0 matches 0!
    const qZero: ExamSnapshotQuestion = {
      id: "aq-num-0",
      attempt_id: "att-1",
      question_id: "q-num-0",
      position: 0,
      question_type: "short_answer",
      chapter_snapshot: null,
      prompt_snapshot: "Freeze point in Celsius?",
      prompt_image_url_snapshot: null,
      explanation_snapshot: null,
      options_snapshot: [],
      correct_option_ids: [],
      accepted_answers_snapshot: [
        { answer_text: "0", normalized_answer: "0", match_mode: "numeric" },
      ],
      created_at: "",
    };
    expect(gradeExamQuestion(qZero, { typed_answer: "0" }).isCorrect).toBe(true);
    expect(gradeExamQuestion(qZero, { typed_answer: "0.0" }).isCorrect).toBe(true);
    expect(gradeExamQuestion(qZero, { typed_answer: "1" }).isCorrect).toBe(false);

    const qHundred: ExamSnapshotQuestion = {
      ...qZero,
      id: "aq-num-100",
      accepted_answers_snapshot: [
        { answer_text: "100", normalized_answer: "100", match_mode: "numeric" },
      ],
    };
    expect(gradeExamQuestion(qHundred, { typed_answer: "100" }).isCorrect).toBe(true);
    expect(gradeExamQuestion(qHundred, { typed_answer: "100.00" }).isCorrect).toBe(
      true,
    );
    expect(gradeExamQuestion(qHundred, { typed_answer: "1" }).isCorrect).toBe(false);
    expect(gradeExamQuestion(qHundred, { typed_answer: "10" }).isCorrect).toBe(false);
    expect(
      gradeWriteAnswer("10", [{ answer_text: "1", match_mode: "numeric" }]).isCorrect,
    ).toBe(false);
  });

  it("supports unlimited-time exams with null duration and no expiry deadline", () => {
    const parsed = createExamSchema.safeParse({
      sources: [
        {
          source_type: "study_set",
          id: "11111111-1111-4111-8111-111111111111",
        },
      ],
      requested_question_count: 40,
      duration_limit_seconds: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.duration_limit_seconds).toBeNull();
    }

    expect(calculateRemainingMs(null)).toBeNull();
    expect(isExamExpired(null)).toBe(false);
  });

  it("computes TRUE weighted overall accuracy across unequal subjects (never unweighted average)", () => {
    // Subject A: 100 questions, 90 correct (90%)
    // Subject B: 10 questions, 0 correct (0%)
    // True weighted overall = 90 / 110 = 81.82% (NOT unweighted (90 + 0) / 2 = 45%)
    const questions: ExamSnapshotQuestion[] = [];
    const answers: ExamAttemptAnswer[] = [];

    for (let i = 0; i < 100; i += 1) {
      const q = makeSnapshotMcQuestion(
        `qa-${i}`,
        "sub-a",
        "Subject A",
        "Ch A",
        0,
        [{ id: "tag-core", name: "Core" }],
      );
      questions.push(q);
      answers.push({
        id: `ans-a-${i}`,
        attempt_id: "att-w",
        attempt_question_id: q.id,
        user_id: "u1",
        selected_option_ids: [i < 90 ? q.options_snapshot[0].id : q.options_snapshot[1].id],
        typed_answer: null,
        is_flagged: false,
        is_correct: i < 90,
        updated_at: "",
      });
    }

    for (let i = 0; i < 10; i += 1) {
      const q = makeSnapshotMcQuestion(
        `qb-${i}`,
        "sub-b",
        "Subject B",
        "Ch B",
        0,
        [{ id: "tag-edge", name: "Edge" }],
      );
      questions.push(q);
      answers.push({
        id: `ans-b-${i}`,
        attempt_id: "att-w",
        attempt_question_id: q.id,
        user_id: "u1",
        selected_option_ids: [q.options_snapshot[1].id],
        typed_answer: null,
        is_flagged: false,
        is_correct: false,
        updated_at: "",
      });
    }

    const summary = scoreExamAttempt(questions, answers, 70);
    expect(summary.totalQuestions).toBe(110);
    expect(summary.correctCount).toBe(90);
    expect(summary.wrongCount).toBe(20);
    expect(summary.scorePercent).toBe(81.82);
    expect(calculateWeightedAccuracyPercent(90, 110)).toBe(81.82);
    expect(summary.passed).toBe(true);

    expect(summary.subjectBreakdown).toHaveLength(2);
    expect(summary.subjectBreakdown[0]?.accuracyPercent).toBe(90);
    expect(summary.subjectBreakdown[1]?.accuracyPercent).toBe(0);
    expect(summary.tagBreakdown).toHaveLength(2);
  });

  it("strips all answer keys & explanations pre-submit in pure helpers, backend helper, and GET /api/exams/[attemptId]", async () => {
    const q = makeSnapshotMcQuestion("aq-secret", "sub-1", "Atmosphere", "Ch 1", 2);

    // 1. Frontend sanitizer + display hiding
    const feSanitized = sanitizeExamQuestionsForClient([q], {
      showSubjectNames: false,
      showChapterNames: false,
    });
    const feStr = JSON.stringify(feSanitized);
    expect(feStr).not.toContain("correct_option_ids");
    expect(feStr).not.toContain("accepted_answers_snapshot");
    expect(feStr).not.toContain("explanation_snapshot");
    expect(feStr).not.toContain("Secret explanation");
    expect(feSanitized[0]?.source_subject_title).toBeNull();
    expect(feSanitized[0]?.chapter_snapshot).toBeNull();

    // 2. Backend pre-submit stripper
    const beSanitized = stripPreSubmitQuestions([q]);
    const beStr = JSON.stringify(beSanitized);
    expect(beStr).not.toContain("correct_option_ids");
    expect(beStr).not.toContain("accepted_answers_snapshot");
    expect(beStr).not.toContain("explanation_snapshot");

    // 3. Live Route Handler GET /api/exams/[attemptId] while in_progress
    vi.spyOn(authz, "requireAuth").mockResolvedValue({
      supabase: {} as never,
      user: { id: "22222222-2222-4222-8222-222222222222" } as never,
    });
    vi.spyOn(rpc, "rpcGetExamAttemptDetail").mockResolvedValue({
      data: {
        attempt: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "22222222-2222-4222-8222-222222222222",
          study_set_id: null,
          study_set_title_snapshot: "Multi-Subject Mock",
          status: "in_progress",
          config: {
            question_count: 1,
            duration_limit_seconds: null,
            shuffle_questions: true,
            shuffle_options: true,
            pass_threshold: 70,
          },
          total_questions: 1,
          answered_count: 0,
          correct_count: 0,
          wrong_count: 0,
          unanswered_count: 1,
          score_percent: 0,
          pass_threshold: 70,
          passed: false,
          duration_limit_seconds: null,
          time_spent_seconds: 0,
          started_at: new Date().toISOString(),
          expires_at: null,
          submitted_at: null,
          created_at: new Date().toISOString(),
        },
        questions: [q],
        answers: [],
        server_now: new Date().toISOString(),
        remaining_seconds: null,
      },
      error: null,
    });

    const req = new NextRequest(
      "http://localhost:3000/api/exams/11111111-1111-4111-8111-111111111111",
    );
    const res = await getExamAttempt(req, {
      params: Promise.resolve({
        attemptId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(res.status).toBe(200);
    const rawBody = await res.text();
    expect(rawBody).not.toContain("correct_option_ids");
    expect(rawBody).not.toContain("accepted_answers_snapshot");
    expect(rawBody).not.toContain("explanation_snapshot");
    expect(rawBody).not.toContain("Secret explanation");
    expect(rawBody).not.toContain('"is_correct"');
  });

  it("POST /api/exams/preview validates request and returns deterministic 500/226/133 -> 145/66/39 preview with zero question text", async () => {
    vi.spyOn(authz, "requireAuth").mockResolvedValue({
      supabase: {} as never,
      user: { id: "22222222-2222-4222-8222-222222222222" } as never,
    });
    vi.spyOn(rpc, "rpcGetExamEligiblePool").mockResolvedValue({
      data: {
        total_eligible: 859,
        deduplicated_set_count: 3,
        subjects: [
          {
            study_set_id: "11111111-1111-4111-8111-111111111111",
            title: "Subject A",
            subject: "Aviation",
            total_exam_questions: 500,
            eligible_count: 500,
            unseen_count: 500,
            mistakes_count: 0,
            unmastered_count: 500,
            due_count: 0,
            starred_count: 0,
          },
          {
            study_set_id: "22222222-2222-4222-8222-222222222222",
            title: "Subject B",
            subject: "Aviation",
            total_exam_questions: 226,
            eligible_count: 226,
            unseen_count: 226,
            mistakes_count: 0,
            unmastered_count: 226,
            due_count: 0,
            starred_count: 0,
          },
          {
            study_set_id: "33333333-3333-4333-8333-333333333333",
            title: "Subject C",
            subject: "Aviation",
            total_exam_questions: 133,
            eligible_count: 133,
            unseen_count: 133,
            mistakes_count: 0,
            unmastered_count: 133,
            due_count: 0,
            starred_count: 0,
          },
        ],
        chapters: [],
        tags: [],
        question_type_counts: { single_choice: 859 },
        difficulty_counts: { medium: 859 },
      },
      error: null,
    });

    const req = new NextRequest("http://localhost:3000/api/exams/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sources: [
          { source_type: "study_set", id: "11111111-1111-4111-8111-111111111111" },
          { source_type: "study_set", id: "22222222-2222-4222-8222-222222222222" },
          { source_type: "study_set", id: "33333333-3333-4333-8333-333333333333" },
        ],
        requested_question_count: 250,
        allocation_strategy: "proportional",
        selection_policy: "random",
        duration_limit_seconds: null,
      }),
    });

    const res = await postExamPreview(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.valid).toBe(true);
    expect(json.data.actual_question_count).toBe(250);
    expect(
      json.data.allocations.map((a: { allocated_count: number }) => a.allocated_count),
    ).toEqual([145, 66, 39]);
    expect(JSON.stringify(json)).not.toContain("prompt_snapshot");
    expect(JSON.stringify(json)).not.toContain("correct_option_ids");
  });

  it("maintains 1:1 SM-2 determinism between frontend sm2.ts and backend progress-helper.ts (SH-029)", () => {
    const fixedNow = new Date("2026-11-24T12:00:00.000Z");
    const sequence: Array<{ rating: SelfRating; isCorrect: boolean }> = [
      { rating: "good", isCorrect: true },
      { rating: "good", isCorrect: true },
      { rating: "good", isCorrect: true },
      { rating: "easy", isCorrect: true },
      { rating: "hard", isCorrect: true },
      { rating: "again", isCorrect: false },
    ];

    let feState = null as ReturnType<typeof calculateNextReview> | null;
    let beState = null as ReturnType<typeof computeDeterministicSm2> | null;

    for (const step of sequence) {
      feState = calculateNextReview(feState, step.rating, fixedNow);
      beState = computeDeterministicSm2(beState, step.isCorrect, step.rating, fixedNow);

      expect(beState.ease_factor).toBe(feState.ease_factor);
      expect(beState.interval_days).toBe(feState.interval_days);
      expect(beState.repetitions).toBe(feState.repetitions);
      expect(beState.consecutive_correct).toBe(feState.consecutive_correct);
      expect(beState.mastery_level).toBe(feState.mastery_level);
      expect(beState.correct_count).toBe(feState.correct_count);
      expect(beState.wrong_count).toBe(feState.wrong_count);
    }
  });
});
