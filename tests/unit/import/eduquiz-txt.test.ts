import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectImportFormat,
  parseImportInput,
  validateImportBatch,
} from "@/lib/import";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

describe("EduQuiz TXT deterministic parser", () => {
  it("auto-detects eduquiz_txt and parses single/multi correct, chapters, multiline stem/options, Vietnamese & math symbols", async () => {
    const raw = fs.readFileSync(
      path.join(FIXTURES_DIR, "eduquiz_sample.txt"),
      "utf-8",
    );
    // Prefix UTF-8 BOM to verify BOM stripping
    const withBom = "\uFEFF" + raw;

    expect(detectImportFormat({ textContent: withBom })).toBe("eduquiz_txt");

    const result = await parseImportInput({
      rawText: withBom,
      fileName: "eduquiz_sample.txt",
    });

    expect(result.format).toBe("eduquiz_txt");
    expect(result.questions).toHaveLength(4);
    expect(result.summary.errorCount).toBe(0);
    expect(result.summary.validCount).toBe(4);
    expect(result.detectedChapters).toEqual([
      "Chương 1: Kiến thức Lịch sử & Địa lý Việt Nam",
      "Chương 2: Toán học & Ký hiệu Khoa học",
    ]);

    // Q1: multiline stem + multiline option B marked with *
    const q1 = result.questions[0];
    expect(q1.chapter).toBe("Chương 1: Kiến thức Lịch sử & Địa lý Việt Nam");
    expect(q1.questionType).toBe("single_choice");
    expect(q1.prompt).toContain("Thủ đô của nước Cộng hòa Xã hội Chủ nghĩa Việt Nam");
    expect(q1.prompt).toContain("Dòng tiếp theo của câu hỏi nhiều dòng");
    expect(q1.options).toHaveLength(4);
    expect(q1.options[1].isCorrect).toBe(true);
    expect(q1.options[1].content).toContain("Hà Nội");
    expect(q1.options[1].content).toContain("1000 năm văn hiến");
    expect(q1.detectedBy).toEqual(["asterisk_prefix"]);
    expect(q1.explanation).toContain("1945");
    expect(q1.hint).toBe("Nằm bên sông Hồng.");

    // Q2: multiple * markers -> multiple_choice
    const q2 = result.questions[1];
    expect(q2.questionType).toBe("multiple_choice");
    expect(q2.options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual([
      "A",
      "C",
      "D",
    ]);

    // Q3: numbered "1." + lowercase "a)" + math symbols preserved cleanly
    const q3 = result.questions[2];
    expect(q3.chapter).toBe("Chương 2: Toán học & Ký hiệu Khoa học");
    expect(q3.prompt).toContain("∫₀¹ 2x dx + √16 − π⁰");
    expect(q3.options.find((o) => o.isCorrect)?.label).toBe("B");

    // Q4: "2)" + "A)" + math inequality symbols
    const q4 = result.questions[3];
    expect(q4.options.find((o) => o.isCorrect)?.content).toBe("x² ≥ 0 ∀x ∈ ℝ");
  });

  it("flags missing correct answer, too few options, and batch/existing duplicates cleanly", async () => {
    const sample = `Câu 1: Câu hỏi thiếu đáp án đúng?
A. Lựa chọn 1
B. Lựa chọn 2

Câu 2: Câu hỏi chỉ có 1 lựa chọn?
*A. Duy nhất

Câu 3: Câu hỏi trùng lặp trong batch?
*A. Đúng
B. Sai

Câu 4: Câu hỏi trùng lặp trong batch?
*A. Đúng
B. Sai

Câu 5: Câu đã tồn tại trong học phần?
*A. Có
B. Không`;

    const result = await parseImportInput({
      rawText: sample,
      existingPrompts: ["Câu đã tồn tại trong học phần?"],
    });

    expect(result.questions).toHaveLength(5);
    expect(result.questions[0].issues.some((i) => i.code === "NO_CORRECT_ANSWER")).toBe(true);
    expect(result.questions[1].issues.some((i) => i.code === "TOO_FEW_OPTIONS")).toBe(true);
    expect(result.questions[3].isDuplicate).toBe(true);
    expect(result.questions[4].isDuplicate).toBe(true);
    expect(result.summary.duplicateCount).toBe(2);
    expect(result.summary.missingAnswerCount).toBe(1);
    expect(result.summary.errorCount).toBe(2);
    expect(result.summary.validCount).toBe(3);

    // Re-validating after fixing Q1 inline clears its error idempotently
    const fixedQuestions = result.questions.map((q, idx) =>
      idx === 0
        ? {
            ...q,
            options: q.options.map((o, oi) => ({ ...o, isCorrect: oi === 0 })),
          }
        : q,
    );
    const revalidated = validateImportBatch(fixedQuestions, {
      existingPrompts: ["Câu đã tồn tại trong học phần?"],
    });
    expect(revalidated.summary.missingAnswerCount).toBe(0);
    expect(revalidated.summary.errorCount).toBe(1);
  });
});
