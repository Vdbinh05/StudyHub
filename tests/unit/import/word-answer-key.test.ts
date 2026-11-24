import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportInput } from "@/lib/import";

const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

describe("Word Answer-Key parser (inline & multi-chapter end-of-document)", () => {
  it("parses inline ANSWER:, Correct answer:, and Vietnamese multi-select Đáp án đúng:", async () => {
    const raw = fs.readFileSync(
      path.join(FIXTURES_DIR, "word_inline_key.txt"),
      "utf-8",
    );
    const result = await parseImportInput({ rawText: raw });

    expect(result.format).toBe("word_answer_key");
    expect(result.questions).toHaveLength(3);
    expect(result.summary.errorCount).toBe(0);

    expect(result.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["C"]);
    expect(result.questions[0].detectedBy).toEqual(["inline_answer_key"]);
    expect(result.questions[0].explanation).toContain("aging");

    expect(result.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);

    expect(result.questions[2].questionType).toBe("multiple_choice");
    expect(result.questions[2].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "B", "D"]);
  });

  it("handles separate end-of-document answer key with multi-chapter numbering reset (Ch1: 1..3, Ch2: 1..3)", async () => {
    const raw = fs.readFileSync(
      path.join(FIXTURES_DIR, "word_end_key_multichapter.txt"),
      "utf-8",
    );
    const result = await parseImportInput({ rawText: raw });

    expect(result.format).toBe("word_answer_key");
    expect(result.questions).toHaveLength(6);
    expect(result.summary.errorCount).toBe(0);
    expect(result.summary.conflictCount).toBe(0);

    // Chapter 1 answers: 1.D, 2.B, 3.A
    expect(result.questions[0].chapter).toBe("Chương 1: Mạng máy tính");
    expect(result.questions[0].options.find((o) => o.isCorrect)?.label).toBe("D");
    expect(result.questions[1].options.find((o) => o.isCorrect)?.label).toBe("B");
    expect(result.questions[2].options.find((o) => o.isCorrect)?.label).toBe("A");

    // Chapter 2 answers (numbering reset 1..3!): 1.B, 2.C, 3.B (MUST NOT overwrite Chapter 1!)
    expect(result.questions[3].chapter).toBe("Chương 2: Cơ sở dữ liệu");
    expect(result.questions[3].options.find((o) => o.isCorrect)?.label).toBe("B");
    expect(result.questions[4].options.find((o) => o.isCorrect)?.label).toBe("C");
    expect(result.questions[5].options.find((o) => o.isCorrect)?.label).toBe("B");

    for (const q of result.questions) {
      expect(q.detectedBy).toEqual(["end_answer_key"]);
    }
  });

  it("flags ANSWER_SIGNAL_CONFLICT when inline answer key disagrees with asterisk marker", async () => {
    const raw = `Câu 1: 2 + 2 bằng mấy?
*A. 3
B. 4
C. 5
D. 6
ANSWER: B`;

    const result = await parseImportInput({
      rawText: raw,
      options: { formatOverride: "word_answer_key" },
    });

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].issues.some((i) => i.code === "ANSWER_SIGNAL_CONFLICT")).toBe(true);
    expect(result.summary.conflictCount).toBe(1);
    // Inline key has priority over asterisk in auto mode
    expect(result.questions[0].options.find((o) => o.isCorrect)?.label).toBe("B");
  });

  it("handles large 2-chapter numbering reset (Ch1: 1..50, Ch2: 1..50) with 100% accuracy", async () => {
    const lines: string[] = [];
    const keyCh1: string[] = [];
    const keyCh2: string[] = [];
    const letters = ["A", "B", "C", "D"];

    lines.push("Chương 1: Đại số");
    for (let i = 1; i <= 50; i += 1) {
      lines.push(`Câu ${i}: Ch1 Question ${i}?`);
      lines.push("A. Opt A");
      lines.push("B. Opt B");
      lines.push("C. Opt C");
      lines.push("D. Opt D");
      keyCh1.push(`${i}.${letters[(i - 1) % 4]}`);
    }

    lines.push("");
    lines.push("Chương 2: Giải tích");
    for (let i = 1; i <= 50; i += 1) {
      lines.push(`Câu ${i}: Ch2 Question ${i}?`);
      lines.push("A. Opt A");
      lines.push("B. Opt B");
      lines.push("C. Opt C");
      lines.push("D. Opt D");
      // Shift pattern so Ch2 differs from Ch1 on every single question
      keyCh2.push(`${i}.${letters[(i + 1) % 4]}`);
    }

    lines.push("");
    lines.push("BẢNG ĐÁP ÁN");
    lines.push(keyCh1.join("  "));
    lines.push(keyCh2.join("  "));

    const result = await parseImportInput({ rawText: lines.join("\n") });
    expect(result.questions).toHaveLength(100);
    expect(result.summary.validCount).toBe(100);
    expect(result.summary.errorCount).toBe(0);

    for (let i = 0; i < 50; i += 1) {
      expect(result.questions[i].options.find((o) => o.isCorrect)?.label).toBe(letters[i % 4]);
    }
    for (let i = 0; i < 50; i += 1) {
      expect(result.questions[50 + i].options.find((o) => o.isCorrect)?.label).toBe(
        letters[(i + 2) % 4],
      );
    }
  });
});
