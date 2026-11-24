// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  exportStudySetToPdf,
  type PdfExportMode,
  type PdfExportQuestion,
} from "@/lib/export/pdf-exporter";

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

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const chunks: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      chunks.push(
        tc.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .join(" "),
      );
    }
    return chunks.join("\n");
  } finally {
    await task.destroy();
  }
}

const SAMPLE_QUESTIONS: PdfExportQuestion[] = [
  {
    id: "q-1",
    questionType: "single_choice",
    chapter: "Chương 1: Khí quyển",
    prompt: "Độ ẩm tương đối đạt 100% khi không khí ở trạng thái nào? Công thức $T = T_d$.",
    explanation: "Khi nhiệt độ bằng điểm sương (T = Td), không khí bão hòa hơi nước.",
    promptImages: [{ bytes: VALID_1X1_PNG, mimeType: "image/png", alt: "Sơ đồ ẩm kế" }],
    options: [
      { id: "o-1a", label: "A", content: "Khô hoàn toàn", isCorrect: false },
      { id: "o-1b", label: "B", content: "Bão hòa hơi nước", isCorrect: true },
      { id: "o-1c", label: "C", content: "Áp suất bằng không", isCorrect: false },
      { id: "o-1d", label: "D", content: "Nhiệt độ âm tuyệt đối", isCorrect: false },
    ],
    userResponseText: "A",
    wasCorrect: false,
  },
  {
    id: "q-2",
    questionType: "listening",
    prompt: "Nghe thông báo đường băng và chọn hướng hạ cánh:",
    audioTranscript: "Đường băng 25 phải, gió 240 độ 10 hải lý.",
    options: [
      { id: "o-2a", label: "A", content: "Đường băng 07", isCorrect: false },
      { id: "o-2b", label: "B", content: "Đường băng 25 phải", isCorrect: true },
    ],
    wasCorrect: true,
  },
  {
    id: "q-3",
    questionType: "numerical",
    prompt: "Áp suất khí quyển tiêu chuẩn ISA ở mực nước biển là bao nhiêu?",
    typePayload: {
      type: "numerical",
      correct_value: 1013.25,
      abs_tolerance: 0.25,
      unit: "hPa",
      unit_required: true,
    },
    options: [],
    wasCorrect: false,
  },
];

describe("V3 Deterministic Vietnamese PDF Exam & Answer Key Exporter", () => {
  it("generates valid %PDF- binaries with 100% Vietnamese diacritics roundtrip across all 5 export modes", async () => {
    const modes: PdfExportMode[] = [
      "question_paper",
      "paper_and_key",
      "paper_with_explanations",
      "incorrect_review",
      "flashcard_sheets",
    ];

    for (const mode of modes) {
      const res = await exportStudySetToPdf(SAMPLE_QUESTIONS, {
        mode,
        locale: "vi",
        title: "Đề kiểm tra Tiếng Việt — Khí tượng học",
        subject: "Khoa học Trái Đất",
        includeStudentInfo: true,
        includeAudioTranscript: true,
      });

      // Valid PDF magic header
      const header = new TextDecoder().decode(res.bytes.subarray(0, 5));
      expect(header).toBe("%PDF-");
      expect(res.pageCount).toBeGreaterThanOrEqual(1);

      const text = await extractPdfText(res.bytes);
      expect(text).toContain("Đề kiểm tra Tiếng Việt");
      expect(text).toContain("Độ ẩm tương đối");

      if (mode === "question_paper") {
        expect(text).not.toContain("BẢNG ĐÁP ÁN");
        expect(text).toContain("âm thanh không thể phát trên bản in giấy");
        expect(text).toContain("Đường băng 25 phải");
      }
      if (mode === "paper_and_key") {
        expect(res.pageCount).toBeGreaterThanOrEqual(2);
        expect(text).toContain("BẢNG ĐÁP ÁN");
      }
      if (mode === "paper_with_explanations") {
        expect(text).toContain("Bão hòa hơi nước");
        expect(text).toContain("điểm sương");
      }
      if (mode === "incorrect_review") {
        // Only the 2 incorrect questions (q-1 and q-3) are exported
        expect(res.questionCount).toBe(2);
        expect(text).toContain("1013.25 hPa");
      }
    }
  }, 20_000);

  it("produces 100% mathematically accurate post-shuffle answer keys when shuffling questions & options", async () => {
    const res = await exportStudySetToPdf(SAMPLE_QUESTIONS, {
      mode: "paper_and_key",
      locale: "vi",
      title: "Đề trộn ngẫu nhiên",
      examCode: "MÃ 204",
      shuffleQuestions: true,
      shuffleOptions: true,
      shuffleSeed: "deterministic-seed-2026",
    });

    expect(res.answerKey).toHaveLength(3);
    const extracted = await extractPdfText(res.bytes);

    // Every single entry in `answerKey` must match the exact printed post-shuffle option label on the paper!
    for (const entry of res.answerKey) {
      if (entry.questionId === "q-1") {
        const correctLetter = entry.correctLabels[0];
        expect(correctLetter).toMatch(/^[A-D]$/);
        // Verify printed option with that letter is actually "Bão hòa hơi nước"
        expect(extracted).toContain(`${correctLetter}. Bão hòa hơi nước`);
        // Verify answer key page prints `<qNum>. <correctLetter>`
        expect(extracted).toContain(`${entry.questionNumber}. ${correctLetter}`);
      }
      if (entry.questionId === "q-2") {
        const correctLetter = entry.correctLabels[0];
        expect(correctLetter).toMatch(/^[A-B]$/);
        expect(extracted).toContain(`${correctLetter}. Đường băng 25 phải`);
        expect(extracted).toContain(`${entry.questionNumber}. ${correctLetter}`);
      }
    }
  });

  it("handles 250-question paper export smoothly with accurate pagination & answer key count", async () => {
    const bulkQuestions: PdfExportQuestion[] = Array.from({ length: 250 }, (_, idx) => ({
      id: `bulk-${idx + 1}`,
      questionType: "single_choice",
      prompt: `Câu hỏi tổng hợp số ${idx + 1}: Đâu là giá trị chính xác của phép đo thứ ${idx + 1}?`,
      options: [
        { id: `b-${idx}-a`, label: "A", content: `Phương án A-${idx + 1}`, isCorrect: idx % 4 === 0 },
        { id: `b-${idx}-b`, label: "B", content: `Phương án B-${idx + 1}`, isCorrect: idx % 4 === 1 },
        { id: `b-${idx}-c`, label: "C", content: `Phương án C-${idx + 1}`, isCorrect: idx % 4 === 2 },
        { id: `b-${idx}-d`, label: "D", content: `Phương án D-${idx + 1}`, isCorrect: idx % 4 === 3 },
      ],
    }));

    const start = performance.now();
    const res = await exportStudySetToPdf(bulkQuestions, {
      mode: "paper_and_key",
      locale: "vi",
      title: "Đề thi tổng hợp 250 câu",
      shuffleQuestions: true,
      shuffleOptions: true,
      shuffleSeed: "scale-250",
    });
    const elapsedMs = performance.now() - start;

    expect(res.questionCount).toBe(250);
    expect(res.answerKey).toHaveLength(250);
    expect(res.pageCount).toBeGreaterThan(10);
    expect(elapsedMs).toBeLessThan(15_000);
  }, 20_000);
});
