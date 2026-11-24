import { describe, expect, it } from "vitest";
import { parseImportInput } from "@/lib/import";
import {
  buildGenericXlsxFixture,
  buildWaygroundXlsxFixture,
} from "../../fixtures/fixture-builders";

describe("XLSX parser (Wayground auto-detect & Generic custom ColumnMapping)", () => {
  it("auto-detects Wayground XLSX, resolves 1-based numeric/multi/letter answers, and strips unsafe image URLs", async () => {
    const bytes = await buildWaygroundXlsxFixture();
    const result = await parseImportInput({
      fileBytes: bytes,
      fileName: "wayground_sample.xlsx",
    });

    expect(result.format).toBe("xlsx_wayground");
    expect(result.sheetNames).toEqual(["Quiz"]);
    expect(result.questions).toHaveLength(3);
    expect(result.summary.errorCount).toBe(0);

    // Q1: numeric 2 -> Option B ("Sắt"), safe https image URL kept
    expect(result.questions[0].questionType).toBe("single_choice");
    expect(result.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(result.questions[0].promptImageUrl).toBe("https://example.com/iron.png");
    expect(result.questions[0].explanation).toContain("Ferrum");

    // Q2: numeric "1,3,5" -> Options A, C, E -> multiple_choice
    expect(result.questions[1].questionType).toBe("multiple_choice");
    expect(result.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual([
      "A",
      "C",
      "E",
    ]);

    // Q3: True/False with javascript: image URL stripped + warning emitted
    expect(result.questions[2].questionType).toBe("true_false");
    expect(result.questions[2].options.find((o) => o.isCorrect)?.label).toBe("A");
    expect(result.questions[2].promptImageUrl).toBeNull();
    expect(result.questions[2].issues.some((i) => i.code === "INVALID_FORMAT")).toBe(true);
  });

  it("parses multi-sheet Generic XLSX with custom sheetName and ColumnMapping (including text-match answers)", async () => {
    const bytes = await buildGenericXlsxFixture();
    const result = await parseImportInput({
      fileBytes: bytes,
      fileName: "generic_mapping.xlsx",
      options: {
        sheetName: "Bank",
        columnMapping: {
          chapter: "Chủ đề",
          prompt: "Nội dung câu hỏi",
          optionA: "PA1",
          optionB: "PA2",
          optionC: "PA3",
          optionD: "PA4",
          correctAnswer: "ĐA",
          explanation: "Ghi chú",
        },
      },
    });

    expect(result.format).toBe("xlsx_generic");
    expect(result.sheetNames).toEqual(["Intro", "Bank"]);
    expect(result.selectedSheet).toBe("Bank");
    expect(result.questions).toHaveLength(2);
    expect(result.summary.errorCount).toBe(0);

    // Q1 matched by exact option text "Ampe (A)" -> B
    expect(result.questions[0].chapter).toBe("Chương 1");
    expect(result.questions[0].options.find((o) => o.isCorrect)?.label).toBe("B");

    // Q2 matched by letter "A" -> A
    expect(result.questions[1].chapter).toBe("Chương 2");
    expect(result.questions[1].options.find((o) => o.isCorrect)?.label).toBe("A");
  });
});
