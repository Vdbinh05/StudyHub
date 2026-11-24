import { describe, expect, it } from "vitest";
import {
  gradeWriteAnswer,
  isLongOpenAnswer,
  normalizeWriteText,
} from "@/lib/learning/write-grader";

describe("Deterministic Write Mode Grader (write-grader.ts)", () => {
  it("supports multiple pre-defined accepted answers", () => {
    const accepted = [
      { answer_text: "Hà Nội", match_mode: "case_insensitive" as const },
      { answer_text: "Thủ đô Hà Nội", match_mode: "case_insensitive" as const },
    ];

    expect(gradeWriteAnswer("hà nội", accepted, { strict: false }).isCorrect).toBe(true);
    expect(gradeWriteAnswer("Thủ đô Hà Nội", accepted, { strict: false }).isCorrect).toBe(true);
    expect(gradeWriteAnswer("Đà Nẵng", accepted, { strict: false }).isCorrect).toBe(false);
  });

  it("enforces strict mode (case-sensitive & punctuation-sensitive) vs flexible mode", () => {
    const accepted = [{ answer_text: "HyperText Markup Language.", match_mode: "case_insensitive" as const }];

    // Strict mode rejects casing/punctuation mismatch
    expect(
      gradeWriteAnswer("hypertext markup language", accepted, { strict: true }).isCorrect,
    ).toBe(false);
    expect(
      gradeWriteAnswer("HyperText Markup Language.", accepted, { strict: true }).isCorrect,
    ).toBe(true);

    // Flexible mode ignores case, collapses whitespace, ignores punctuation
    expect(
      gradeWriteAnswer("  hypertext   markup language  ", accepted, {
        strict: false,
        ignoreCase: true,
        collapseWhitespace: true,
        ignorePunctuation: true,
      }).isCorrect,
    ).toBe(true);
  });

  it("handles Vietnamese diacritics strictly by default and optionally ignores them when configured", () => {
    const accepted = [{ answer_text: "Giải tích", match_mode: "case_insensitive" as const }];

    // Default flexible does NOT drop diacritics (no arbitrary fuzzy matching!)
    expect(
      gradeWriteAnswer("giai tich", accepted, {
        strict: false,
        ignoreDiacritics: false,
      }).isCorrect,
    ).toBe(false);

    // Explicit ignoreDiacritics flag or match_mode: 'ignore_diacritics' matches deterministically (including đ -> d)
    expect(
      gradeWriteAnswer("giai tich", accepted, {
        strict: false,
        ignoreDiacritics: true,
      }).isCorrect,
    ).toBe(true);

    const acceptedWithD = [{ answer_text: "Định lý", match_mode: "ignore_diacritics" as const }];
    expect(gradeWriteAnswer("dinh ly", acceptedWithD, { strict: false }).isCorrect).toBe(true);
  });

  it("NEVER performs arbitrary fuzzy/Levenshtein matching on typos", () => {
    const accepted = [{ answer_text: "mitochondria", match_mode: "case_insensitive" as const }];
    // 1-character typo MUST still be marked wrong deterministically
    expect(gradeWriteAnswer("mitochondra", accepted, { strict: false }).isCorrect).toBe(false);
  });

  it("supports deterministic numeric matching", () => {
    const accepted = [{ answer_text: "3.5", match_mode: "numeric" as const }];
    expect(gradeWriteAnswer("3.50", accepted, { strict: false }).isCorrect).toBe(true);
    expect(gradeWriteAnswer(" 3.5 ", accepted, { strict: false }).isCorrect).toBe(true);
    expect(gradeWriteAnswer("3.51", accepted, { strict: false }).isCorrect).toBe(false);
  });

  it("detects long/open-ended answers that should offer self-assessment", () => {
    expect(isLongOpenAnswer(["H2O"])).toBe(false);
    expect(isLongOpenAnswer(["Quang hợp"])).toBe(false);
    expect(
      isLongOpenAnswer([
        "Quá trình quang hợp là quá trình thực vật sử dụng ánh sáng mặt trời để tổng hợp chất hữu cơ từ CO2 và nước.",
      ]),
    ).toBe(true);
    expect(isLongOpenAnswer(["Line 1\nLine 2"])).toBe(true);
  });

  it("normalizes strings predictably", () => {
    expect(
      normalizeWriteText("  Độc   lập, Tự do! ", {
        ignoreCase: true,
        collapseWhitespace: true,
        ignorePunctuation: true,
        ignoreDiacritics: true,
      }),
    ).toBe("doc lap tu do");
  });
});
