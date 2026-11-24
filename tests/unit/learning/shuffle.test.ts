import { describe, expect, it } from "vitest";
import {
  createSeededRng,
  fisherYatesShuffle,
  gradeChoiceSelection,
  indexToOptionLabel,
  shuffleOptions,
  shuffleQuestions,
} from "@/lib/learning/shuffle";

describe("Deterministic Shuffle & UUID Option Grading (shuffle.ts)", () => {
  it("produces deterministic permutations with the same seed and preserves all elements", () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const run1 = fisherYatesShuffle(source, createSeededRng("exam-seed-42"));
    const run2 = fisherYatesShuffle(source, createSeededRng("exam-seed-42"));
    const run3 = fisherYatesShuffle(source, createSeededRng("exam-seed-99"));

    expect(run1).toEqual(run2);
    expect(run1).not.toEqual(run3);
    expect([...run1].sort((a, b) => a - b)).toEqual(source);
    // Original array is never mutated
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("re-labels shuffled options A/B/C/D by rendered position while preserving stable option UUIDs", () => {
    const options = [
      { id: "opt-uuid-1", label: "A", content: "Paris", is_correct: false },
      { id: "opt-uuid-2", label: "B", content: "Hanoi", is_correct: true },
      { id: "opt-uuid-3", label: "C", content: "Tokyo", is_correct: false },
      { id: "opt-uuid-4", label: "D", content: "Seoul", is_correct: false },
    ];

    const shuffled = shuffleOptions(options, createSeededRng("opt-seed-7"));
    expect(shuffled.map((o) => o.displayLabel)).toEqual(["A", "B", "C", "D"]);
    expect(shuffled.map((o) => o.id).sort()).toEqual([
      "opt-uuid-1",
      "opt-uuid-2",
      "opt-uuid-3",
      "opt-uuid-4",
    ]);

    // Find Hanoi after shuffle — its UUID is still opt-uuid-2 regardless of its new display letter!
    const hanoi = shuffled.find((o) => o.content === "Hanoi");
    expect(hanoi?.id).toBe("opt-uuid-2");

    // Grading by UUID succeeds regardless of where Hanoi landed
    expect(gradeChoiceSelection([hanoi!.id], ["opt-uuid-2"])).toBe(true);
    // Selecting whatever is now at index 1 (old position of B) fails if it's not opt-uuid-2
    const atOldBIndex = shuffled[1];
    if (atOldBIndex.id !== "opt-uuid-2") {
      expect(gradeChoiceSelection([atOldBIndex.id], ["opt-uuid-2"])).toBe(false);
    }
  });

  it("grades multi-choice questions strictly by UUID set equality (order & duplicate insensitive)", () => {
    const correctIds = ["uuid-b", "uuid-d"];

    expect(gradeChoiceSelection(["uuid-d", "uuid-b"], correctIds)).toBe(true);
    expect(gradeChoiceSelection(["uuid-b", "uuid-b", "uuid-d"], correctIds)).toBe(true);
    expect(gradeChoiceSelection(["uuid-b"], correctIds)).toBe(false);
    expect(gradeChoiceSelection(["uuid-b", "uuid-d", "uuid-a"], correctIds)).toBe(false);
    expect(gradeChoiceSelection([], correctIds)).toBe(false);
  });

  it("shuffles questions cleanly without mutating the source list", () => {
    const questions = [{ id: "q1" }, { id: "q2" }, { id: "q3" }, { id: "q4" }];
    const shuffled = shuffleQuestions(questions, createSeededRng("q-seed"));
    expect(shuffled).toHaveLength(4);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("maps option indices to uppercase alphabetical labels", () => {
    expect(indexToOptionLabel(0)).toBe("A");
    expect(indexToOptionLabel(1)).toBe("B");
    expect(indexToOptionLabel(3)).toBe("D");
    expect(indexToOptionLabel(5)).toBe("F");
  });
});
