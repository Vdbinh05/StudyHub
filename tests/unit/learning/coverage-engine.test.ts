import { describe, expect, it } from "vitest";
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

function makePool(count: number, subjects = 1): CoveragePoolItemInput[] {
  return Array.from({ length: count }, (_, i) => {
    const sIdx = i % subjects;
    return {
      questionId: `q-${i + 1}`,
      subjectId: `sub-${sIdx + 1}`,
      subjectTitle: `Subject ${sIdx + 1}`,
    };
  });
}

describe("V2.0 Full Coverage Mode Engine (coverage-engine.ts)", () => {
  it("plans exact non-overlapping series: 500 -> 250+250 and 500 -> 120×4+20", () => {
    const planA = planCoverageSeries(500, 250);
    expect(planA.examSizes).toEqual([250, 250]);
    expect(planA.examCount).toBe(2);
    expect(planA.hasSmallerFinalExam).toBe(false);
    expect(planA.formattedPlan).toBe("250 + 250");

    const planB = planCoverageSeries(500, 120);
    expect(planB.examSizes).toEqual([120, 120, 120, 120, 20]);
    expect(planB.examCount).toBe(5);
    expect(planB.hasSmallerFinalExam).toBe(true);
    expect(planB.formattedPlan).toBe("120 × 4 + 20");
  });

  it("covers 500 questions in 250 + 250 with ZERO overlapping question IDs", () => {
    let cycle = createCoverageCycle(makePool(500, 3), {
      id: "cyc-1",
      title: "ATPL Full Bank",
      questionsPerExam: 250,
      allocationStrategy: "proportional",
      seed: "cov-500-seed",
    });

    const exam1 = issueNextCoverageExam(cycle, "att-1");
    cycle = exam1.cycle;
    expect(exam1.selectedQuestionIds).toHaveLength(250);
    expect(cycle.assignedCount).toBe(250);
    expect(cycle.completedCount).toBe(0);
    expect(cycle.remainingCount).toBe(250);

    // Guard: cannot issue Exam #2 while Exam #1 is still in progress
    expect(() => issueNextCoverageExam(cycle, "att-2")).toThrowError(
      CoverageCycleError,
    );

    // Complete Exam #1 with all 250 answered
    cycle = completeCoverageExam(
      cycle,
      "att-1",
      exam1.selectedQuestionIds.map((id, i) => ({
        questionId: id,
        wasAnswered: true,
        isCorrect: i % 5 !== 0,
      })),
    );
    expect(cycle.completedCount).toBe(250);
    expect(cycle.assignedCount).toBe(0);
    expect(cycle.remainingCount).toBe(250);
    expect(cycle.status).toBe("active");

    // Issue Exam #2
    const exam2 = issueNextCoverageExam(cycle, "att-2");
    cycle = exam2.cycle;
    expect(exam2.selectedQuestionIds).toHaveLength(250);

    // Verify ZERO overlap between Exam #1 and Exam #2
    const set1 = new Set(exam1.selectedQuestionIds);
    for (const qId of exam2.selectedQuestionIds) {
      expect(set1.has(qId)).toBe(false);
    }

    // Complete Exam #2 -> cycle completes at 100%
    cycle = completeCoverageExam(
      cycle,
      "att-2",
      exam2.selectedQuestionIds.map((id) => ({
        questionId: id,
        wasAnswered: true,
        isCorrect: true,
      })),
    );
    expect(cycle.completedCount).toBe(500);
    expect(cycle.remainingCount).toBe(0);
    expect(cycle.status).toBe("completed");
  });

  it("handles smaller final exam (500 in 120×4 + 20) without discarding remaining 20 questions", () => {
    let cycle = createCoverageCycle(makePool(500), {
      id: "cyc-120",
      title: "120-Q Series",
      questionsPerExam: 120,
      seed: "cov-120",
    });

    const seenAll = new Set<string>();
    const sizes: number[] = [];

    for (let i = 1; i <= 5; i++) {
      const issued = issueNextCoverageExam(cycle, `att-${i}`);
      sizes.push(issued.selectedQuestionIds.length);
      for (const id of issued.selectedQuestionIds) {
        expect(seenAll.has(id)).toBe(false);
        seenAll.add(id);
      }
      cycle = completeCoverageExam(
        issued.cycle,
        `att-${i}`,
        issued.selectedQuestionIds.map((id) => ({
          questionId: id,
          wasAnswered: true,
          isCorrect: true,
        })),
      );
    }

    expect(sizes).toEqual([120, 120, 120, 120, 20]);
    expect(seenAll.size).toBe(500);
    expect(cycle.status).toBe("completed");
  });

  it("tracks assigned vs answered vs completed separately; discarding returns questions without marking completed", () => {
    let cycle = createCoverageCycle(makePool(100), {
      id: "cyc-discard",
      title: "Discard Integrity Test",
      questionsPerExam: 40,
      seed: "discard-seed",
    });

    // Issue Exam #1 (40 assigned)
    const e1 = issueNextCoverageExam(cycle, "att-abandoned");
    cycle = e1.cycle;
    expect(cycle.assignedCount).toBe(40);
    expect(cycle.completedCount).toBe(0);
    expect(cycle.remainingCount).toBe(60);

    // Discard Exam #1 -> all 40 revert to unassigned; 0 marked completed!
    cycle = discardActiveCoverageExam(cycle);
    expect(cycle.activeAttemptId).toBeNull();
    expect(cycle.assignedCount).toBe(0);
    expect(cycle.completedCount).toBe(0);
    expect(cycle.answeredCount).toBe(0);
    expect(cycle.remainingCount).toBe(100);
    expect(cycle.attempts[0].status).toBe("discarded");

    // Issue Exam #2 and submit with only 30 answered + 10 unanswered
    const e2 = issueNextCoverageExam(cycle, "att-partial");
    cycle = completeCoverageExam(
      e2.cycle,
      "att-partial",
      e2.selectedQuestionIds.map((id, idx) => ({
        questionId: id,
        wasAnswered: idx < 30,
        isCorrect: idx < 20,
      })),
    );

    // Only the 30 answered become completed; the 10 unanswered return to remaining pool (60 + 10 = 70)!
    expect(cycle.completedCount).toBe(30);
    expect(cycle.answeredCount).toBe(30);
    expect(cycle.assignedCount).toBe(0);
    expect(cycle.remainingCount).toBe(70);

    const summary = getCoverageProgressSummary(cycle);
    expect(summary.completedPercent).toBe(30);
    expect(summary.remainingPercent).toBe(70);
    expect(summary.mistakeQuestionIds).toHaveLength(10);
  });

  it("restarts cycle cleanly incrementing cycleNumber while keeping attempt history", () => {
    let cycle = createCoverageCycle(makePool(20), {
      id: "cyc-restart",
      title: "Restart Test",
      questionsPerExam: 20,
      seed: "r-1",
    });

    const e1 = issueNextCoverageExam(cycle, "att-1");
    cycle = completeCoverageExam(
      e1.cycle,
      "att-1",
      e1.selectedQuestionIds.map((id) => ({
        questionId: id,
        wasAnswered: true,
        isCorrect: true,
      })),
    );
    expect(cycle.status).toBe("completed");

    const restarted = restartCoverageCycle(cycle, { seed: "r-2" });
    expect(restarted.cycleNumber).toBe(2);
    expect(restarted.status).toBe("active");
    expect(restarted.completedCount).toBe(0);
    expect(restarted.remainingCount).toBe(20);
    expect(restarted.attempts).toHaveLength(1);
  });
});
