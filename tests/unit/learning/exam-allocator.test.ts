import { describe, expect, it } from "vitest";
import {
  computeExamAllocation,
  normalizeAllocationStrategy,
  sampleGlobalRandomPool,
  suggestCustomCounts,
  suggestEqualWeights,
  toApiAllocationStrategy,
  validateQuestionCount,
} from "@/lib/learning/exam-allocator";
import { createSeededRng } from "@/lib/learning/shuffle";

describe("V2.0 Exam Allocator Engine (exam-allocator.ts)", () => {
  describe("validateQuestionCount (strict — never silently reduces)", () => {
    it("accepts valid integers within 1..min(available, maxTechnicalLimit)", () => {
      expect(validateQuestionCount(1, 500)).toMatchObject({
        valid: true,
        value: 1,
      });
      expect(validateQuestionCount(250, 859)).toMatchObject({
        valid: true,
        value: 250,
      });
      expect(validateQuestionCount("133", 133)).toMatchObject({
        valid: true,
        value: 133,
      });
    });

    it("rejects 0, negative, decimals, NaN/text, >available, and >maxTechnicalLimit", () => {
      expect(validateQuestionCount(0, 100)).toMatchObject({
        valid: false,
        code: "NON_POSITIVE",
      });
      expect(validateQuestionCount(-10, 100)).toMatchObject({
        valid: false,
        code: "NON_POSITIVE",
      });
      expect(validateQuestionCount(12.5, 100)).toMatchObject({
        valid: false,
        code: "NON_INTEGER",
      });
      expect(validateQuestionCount("12.5", 100)).toMatchObject({
        valid: false,
        code: "NON_INTEGER",
      });
      expect(validateQuestionCount(Number.NaN, 100)).toMatchObject({
        valid: false,
        code: "INVALID_NUMBER",
      });
      expect(validateQuestionCount("abc", 100)).toMatchObject({
        valid: false,
        code: "INVALID_NUMBER",
      });
      expect(validateQuestionCount("", 100)).toMatchObject({
        valid: false,
        code: "INVALID_NUMBER",
      });
      expect(validateQuestionCount(251, 250)).toMatchObject({
        valid: false,
        code: "EXCEEDS_AVAILABLE",
      });
      expect(validateQuestionCount(5001, 10000, 5000)).toMatchObject({
        valid: false,
        code: "EXCEEDS_MAX_LIMIT",
      });
      expect(validateQuestionCount(10, 0)).toMatchObject({
        valid: false,
        code: "NO_ELIGIBLE_QUESTIONS",
      });
    });
  });

  describe("Strategy A: global_random", () => {
    it("never fakes fixed per-subject preview quotas before sampling", () => {
      const res = computeExamAllocation({
        strategy: "global_random",
        requestedCount: 250,
        subjects: [
          { subjectId: "s1", title: "Flight", availableCount: 500 },
          { subjectId: "s2", title: "Met", availableCount: 226 },
          { subjectId: "s3", title: "Nav", availableCount: 133 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.isDynamicSampling).toBe(true);
      expect(res.totalAllocated).toBe(250);
      for (const a of res.allocations) {
        expect(a.allocatedCount).toBeNull();
        expect(a.minPossible).toBeGreaterThanOrEqual(0);
        expect(a.maxPossible).toBeLessThanOrEqual(a.availableCount);
      }
    });

    it("samples uniformly without replacement from a deduplicated combined pool", () => {
      const pool = [
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `q-a-${i}`,
          subjectId: "A",
        })),
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `q-b-${i}`,
          subjectId: "B",
        })),
        // Duplicate question ID from overlapping folder+set selection
        { id: "q-a-0", subjectId: "A" },
      ];

      const { selected, realizedCountsBySubject } = sampleGlobalRandomPool(
        pool,
        50,
        createSeededRng("global-random-seed"),
      );

      expect(selected).toHaveLength(50);
      expect(new Set(selected.map((x) => x.id)).size).toBe(50);
      expect(
        (realizedCountsBySubject.A ?? 0) + (realizedCountsBySubject.B ?? 0),
      ).toBe(50);
    });
  });

  describe("Strategy B: equal", () => {
    it("splits 250 across 3 subjects as 84 / 83 / 83 (sum 250)", () => {
      const res = computeExamAllocation({
        strategy: "equal",
        requestedCount: 250,
        subjects: [
          { subjectId: "s1", title: "Sub 1", availableCount: 500 },
          { subjectId: "s2", title: "Sub 2", availableCount: 226 },
          { subjectId: "s3", title: "Sub 3", availableCount: 133 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.wasRedistributed).toBe(false);
      expect(res.totalAllocated).toBe(250);
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([84, 83, 83]);
    });

    it("iteratively redistributes shortfall when small subjects have fewer than equal share", () => {
      const res = computeExamAllocation({
        strategy: "equal",
        requestedCount: 100,
        subjects: [
          { subjectId: "small", title: "Small", availableCount: 10 },
          { subjectId: "med", title: "Med", availableCount: 35 },
          { subjectId: "big", title: "Big", availableCount: 200 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.wasRedistributed).toBe(true);
      expect(res.totalAllocated).toBe(100);
      // Pass 1 caps small at 10 -> remaining 90 / 2 = 45; Pass 2 caps med at 35 -> remaining 55 -> big gets 55
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([10, 35, 55]);
    });
  });

  describe("Strategy C: proportional (Hamilton / Largest Remainder)", () => {
    it("allocates 500 / 226 / 133 for N=250 as exact 145 / 66 / 39 (sum 250)", () => {
      const res = computeExamAllocation({
        strategy: "proportional",
        requestedCount: 250,
        subjects: [
          { subjectId: "pof", title: "Principles of Flight", availableCount: 500 },
          { subjectId: "met", title: "Meteorology", availableCount: 226 },
          { subjectId: "nav", title: "Navigation", availableCount: 133 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.totalAllocated).toBe(250);
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([145, 66, 39]);
      expect(
        res.allocations.reduce((sum, a) => sum + (a.allocatedCount ?? 0), 0),
      ).toBe(250);
    });

    it("handles full pool selection without exceeding any subject capacity", () => {
      const res = computeExamAllocation({
        strategy: "proportional",
        requestedCount: 859,
        subjects: [
          { subjectId: "s1", availableCount: 500 },
          { subjectId: "s2", availableCount: 226 },
          { subjectId: "s3", availableCount: 133 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([500, 226, 133]);
    });
  });

  describe("Strategy D: custom", () => {
    it("accepts exact valid per-subject counts summing to N", () => {
      const res = computeExamAllocation({
        strategy: "custom",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", availableCount: 60, customCount: 50 },
          { subjectId: "s2", availableCount: 40, customCount: 30 },
          { subjectId: "s3", availableCount: 20, customCount: 20 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.remainingUnallocated).toBe(0);
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([50, 30, 20]);
    });

    it("rejects mismatched sum, negative/decimal counts, and counts exceeding subject availability", () => {
      const under = computeExamAllocation({
        strategy: "custom",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", availableCount: 60, customCount: 40 },
          { subjectId: "s2", availableCount: 60, customCount: 45 },
        ],
      });
      expect(under.valid).toBe(false);
      expect(under.remainingUnallocated).toBe(15);
      expect(under.errors.some((e) => e.code === "CUSTOM_SUM_MISMATCH")).toBe(true);

      const overCap = computeExamAllocation({
        strategy: "custom",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", availableCount: 20, customCount: 50 },
          { subjectId: "s2", availableCount: 100, customCount: 50 },
        ],
      });
      expect(overCap.valid).toBe(false);
      expect(
        overCap.errors.some(
          (e) => e.code === "CUSTOM_EXCEEDS_AVAILABLE" && e.subjectId === "s1",
        ),
      ).toBe(true);

      const badFloat = computeExamAllocation({
        strategy: "custom",
        requestedCount: 10,
        subjects: [
          { subjectId: "s1", availableCount: 20, customCount: 4.5 },
          { subjectId: "s2", availableCount: 20, customCount: 5.5 },
        ],
      });
      expect(badFloat.valid).toBe(false);
      expect(badFloat.errors.some((e) => e.code === "CUSTOM_INVALID_COUNT")).toBe(
        true,
      );
    });
  });

  describe("Strategy E: weighted", () => {
    it("strictly requires percentage weights to sum to 100%", () => {
      const invalid = computeExamAllocation({
        strategy: "weighted",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", availableCount: 100, weightPercent: 60 },
          { subjectId: "s2", availableCount: 100, weightPercent: 39 },
        ],
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.weightSumPercent).toBe(99);
      expect(invalid.errors.some((e) => e.code === "WEIGHTS_SUM_NOT_100")).toBe(
        true,
      );
    });

    it("computes exact largest-remainder quotas with zero floating-point drift (33.33/33.33/33.34)", () => {
      const weights = suggestEqualWeights(["s1", "s2", "s3"]);
      const res = computeExamAllocation({
        strategy: "weighted",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", availableCount: 100, weightPercent: weights.s1 },
          { subjectId: "s2", availableCount: 100, weightPercent: weights.s2 },
          { subjectId: "s3", availableCount: 100, weightPercent: weights.s3 },
        ],
      });
      expect(res.valid).toBe(true);
      expect(res.wasRedistributed).toBe(false);
      expect(res.requiresConfirmation).toBe(false);
      expect(res.totalAllocated).toBe(100);
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([34, 33, 33]);
    });

    it("redistributes excess when weighted subject hits capacity cap and flags requiresConfirmation", () => {
      const res = computeExamAllocation({
        strategy: "weighted",
        requestedCount: 100,
        subjects: [
          { subjectId: "s1", title: "Small", availableCount: 20, weightPercent: 50 },
          { subjectId: "s2", title: "Mid", availableCount: 100, weightPercent: 30 },
          { subjectId: "s3", title: "Other", availableCount: 100, weightPercent: 20 },
        ],
      });

      expect(res.valid).toBe(true);
      expect(res.wasRedistributed).toBe(true);
      expect(res.requiresConfirmation).toBe(true);
      expect(res.totalAllocated).toBe(100);
      // s1 capped at 20 (ideal 50); remaining 80 split 30:20 (3:2) -> 48 & 32
      expect(res.allocations.map((a) => a.allocatedCount)).toEqual([20, 48, 32]);
      expect(res.allocations[0].wasCapped).toBe(true);
      expect(res.allocations[0].idealCount).toBe(50);
    });
  });

  describe("Helpers & enum mapping", () => {
    it("normalizes API aliases and generates balanced suggestions", () => {
      expect(normalizeAllocationStrategy("unweighted_random")).toBe("global_random");
      expect(normalizeAllocationStrategy("custom_counts")).toBe("custom");
      expect(normalizeAllocationStrategy("custom_percentages")).toBe("weighted");
      expect(toApiAllocationStrategy("global_random")).toBe("unweighted_random");

      const suggested = suggestCustomCounts(
        [
          { subjectId: "a", availableCount: 500 },
          { subjectId: "b", availableCount: 226 },
          { subjectId: "c", availableCount: 133 },
        ],
        250,
      );
      expect(suggested).toEqual({ a: 145, b: 66, c: 39 });
    });
  });
});
