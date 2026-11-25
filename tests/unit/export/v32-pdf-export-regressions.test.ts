// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  exportStudySetToPdf,
  formatStructuredExamResponseForPdf,
  type PdfExportQuestion,
} from "@/lib/export/pdf-exporter";
import { stripPreSubmitQuestions } from "@/lib/supabase/exam-engine";
import type { ExamSnapshotQuestion } from "@/types/domain";
import type { QuestionTypePayload } from "@/types/v3";

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

describe("V3.2 PDF Export Regressions (V32-030 / FUNC-21)", () => {
  describe("formatStructuredExamResponseForPdf", () => {
    it("formats all V3 structured response kinds accurately", () => {
      // 1. options
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "options", selected_option_ids: ["opt-2", "opt-3"] },
          null,
          [
            { id: "opt-1", label: "A" },
            { id: "opt-2", label: "B" },
            { id: "opt-3", label: "C" },
          ],
          true,
        ),
      ).toBe("B, C");

      // 2. text
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "text", value: "  Ha Noi  " },
          null,
          [],
          true,
        ),
      ).toBe("Ha Noi");

      // 3. fill_in_blank
      const fibPayload: QuestionTypePayload = {
        type: "fill_in_blank",
        blanks: [
          { blank_id: "b1", accepted_answers: ["Ha Noi"] },
          { blank_id: "b2", accepted_answers: ["Viet Nam"] },
        ],
      };
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "blanks", answers: { b1: "Ha Noi", b2: "Viet Nam" } },
          fibPayload,
          [],
          true,
        ),
      ).toBe("(1) Ha Noi; (2) Viet Nam");

      // 4. numerical
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "numerical", value: "1013.25", numeric_value: 1013.25, unit: "hPa" },
          { type: "numerical", correct_value: 1013.25, unit: "hPa" },
          [],
          true,
        ),
      ).toBe("1013.25 hPa");

      // 5. ordering
      const ordPayload: QuestionTypePayload = {
        type: "ordering",
        items: [
          { id: "i1", text: "Khởi động", correct_position: 1 },
          { id: "i2", text: "Cất cánh", correct_position: 2 },
        ],
      };
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "ordering", ordered_item_ids: ["i2", "i1"] },
          ordPayload,
          [],
          true,
        ),
      ).toBe("1. Cất cánh → 2. Khởi động");

      // 6. matching
      const matchPayload: QuestionTypePayload = {
        type: "matching",
        pairs: [
          { id: "p1", left_text: "H2O", right_id: "r1", right_text: "Nước" },
          { id: "p2", left_text: "NaCl", right_id: "r2", right_text: "Muối" },
        ],
        distractors: [{ right_id: "d1", right_text: "Oxy" }],
      };
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "matching", pairs: { p1: "d1", p2: "r2" } },
          matchPayload,
          [],
          true,
        ),
      ).toBe("1-Oxy; 2-Muối");

      // 7. image_hotspot (selected IDs + raw click fallback)
      const hsPayload: QuestionTypePayload = {
        type: "image_hotspot",
        image_url: "/api/uploads/signed-url?path=a.png&redirect=1",
        target_hotspots: [
          { id: "h1", label: "Altimeter", shape: "point", geometry: { shape: "point", x: 0.5, y: 0.5 } },
        ],
      };
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "hotspot", clicks: [{ x: 0.5, y: 0.5 }], selected_hotspot_ids: ["h1"] },
          hsPayload,
          [],
          true,
        ),
      ).toBe("Altimeter");
      expect(
        formatStructuredExamResponseForPdf(
          { kind: "hotspot", clicks: [{ x: 0.25, y: 0.75 }] },
          hsPayload,
          [],
          true,
        ),
      ).toBe("Điểm chọn: (25%, 75%)");
    });
  });

  it("renders explicit inline caption for legacy WebP/GIF images and displays V3 userResponseText in review PDFs", async () => {
    const questions: PdfExportQuestion[] = [
      {
        id: "q-webp",
        questionType: "numerical",
        prompt: "Quan sát sơ đồ và nhập áp suất tiêu chuẩn:",
        typePayload: { type: "numerical", correct_value: 1013.25, unit: "hPa" },
        options: [],
        promptImages: [
          {
            bytes: new Uint8Array(0),
            mimeType: "image/webp",
            unsupportedFormatNote: true,
          },
        ],
        userResponseText: "990 hPa",
        wasCorrect: false,
      },
    ];

    // Vietnamese incorrect_review -> explicit WebP/GIF caption + user response
    const viPdf = await exportStudySetToPdf(questions, {
      mode: "incorrect_review",
      locale: "vi",
      title: "Ôn tập khí tượng",
    });
    const viText = await extractPdfText(viPdf.bytes);
    expect(viText).toContain("[Hình ảnh định dạng WebP/GIF — xem trên StudyHub]");
    expect(viText).toContain("Câu trả lời của bạn: 990 hPa");

    // English paper_with_explanations -> explicit EN caption + user response also shown!
    const enPdf = await exportStudySetToPdf(questions, {
      mode: "paper_with_explanations",
      locale: "en",
      title: "Meteorology Review",
    });
    const enText = await extractPdfText(enPdf.bytes);
    expect(enText).toContain("[WebP/GIF image — view on StudyHub]");
    expect(enText).toContain("Your answer: 990 hPa");
  });

  it("exports valid question_paper PDF without 500 or answer leakage on stripped in_progress exams containing fill_in_blank, matching, image_hotspot, numerical, and ordering (V32-030 / FUNC-21b)", async () => {
    const rawSnapshots: ExamSnapshotQuestion[] = [
      {
        id: "aq-fib",
        attempt_id: "att-1",
        question_id: "q-fib",
        position: 1,
        question_type: "fill_in_blank",
        chapter_snapshot: "Chương 1",
        prompt_snapshot: "Thủ đô của Việt Nam là {{b1}}.",
        prompt_image_url_snapshot: null,
        options_snapshot: [],
        explanation_snapshot: "SECRET_EXPLANATION_FIB",
        type_payload_snapshot: {
          type: "fill_in_blank",
          blanks: [
            { blank_id: "b1", accepted_answers: ["SECRET_HANOI_ANSWER"], hint: "Bắt đầu bằng H" },
          ],
          require_all_blanks: true,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: "aq-match",
        attempt_id: "att-1",
        question_id: "q-match",
        position: 2,
        question_type: "matching",
        chapter_snapshot: "Chương 2",
        prompt_snapshot: "Ghép công thức hóa học với tên gọi:",
        prompt_image_url_snapshot: null,
        options_snapshot: [],
        explanation_snapshot: "SECRET_EXPLANATION_MATCH",
        type_payload_snapshot: {
          type: "matching",
          pairs: [
            { id: "p1", left_text: "H2O", right_id: "r1", right_text: "Nước" },
            { id: "p2", left_text: "NaCl", right_id: "r2", right_text: "Muối ăn" },
          ],
          distractors: [{ right_id: "d1", right_text: "Oxy" }],
        },
        created_at: new Date().toISOString(),
      },
      {
        id: "aq-hotspot",
        attempt_id: "att-1",
        question_id: "q-hotspot",
        position: 3,
        question_type: "image_hotspot",
        chapter_snapshot: "Chương 3",
        prompt_snapshot: "Chọn vị trí đồng hồ đo độ cao trên bảng điều khiển:",
        prompt_image_url_snapshot: null,
        options_snapshot: [],
        explanation_snapshot: "SECRET_EXPLANATION_HOTSPOT",
        type_payload_snapshot: {
          type: "image_hotspot",
          image_url: "/api/uploads/signed-url?path=panel.png&redirect=1",
          target_hotspots: [
            {
              id: "hs-1",
              label: "SECRET_ALTIMETER_LABEL",
              shape: "point",
              geometry: { shape: "point", x: 0.42, y: 0.63, radius: 0.05 },
            },
          ],
          require_all_targets: true,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: "aq-num",
        attempt_id: "att-1",
        question_id: "q-num",
        position: 4,
        question_type: "numerical",
        chapter_snapshot: "Chương 4",
        prompt_snapshot: "Gia tốc trọng trường tiêu chuẩn là bao nhiêu?",
        prompt_image_url_snapshot: null,
        options_snapshot: [],
        explanation_snapshot: "SECRET_EXPLANATION_NUM",
        type_payload_snapshot: {
          type: "numerical",
          correct_value: 9.80665,
          abs_tolerance: 0.05,
          unit: "m/s2",
          unit_required: true,
        },
        created_at: new Date().toISOString(),
      },
      {
        id: "aq-ord",
        attempt_id: "att-1",
        question_id: "q-ord",
        position: 5,
        question_type: "ordering",
        chapter_snapshot: "Chương 5",
        prompt_snapshot: "Sắp xếp quy trình cất cánh:",
        prompt_image_url_snapshot: null,
        options_snapshot: [],
        explanation_snapshot: "SECRET_EXPLANATION_ORD",
        type_payload_snapshot: {
          type: "ordering",
          items: [
            { id: "o1", text: "Kiểm tra trước bay", correct_position: 1 },
            { id: "o2", text: "Lăn ra đường băng", correct_position: 2 },
          ],
        },
        created_at: new Date().toISOString(),
      },
    ];

    // Real pre-submit sanitization mirror (strips accepted_answers, pairs, target_hotspots, correct_value, correct_position!)
    const strippedSnapshots = stripPreSubmitQuestions(rawSnapshots);

    const exportQuestions: PdfExportQuestion[] = strippedSnapshots.map((row) => ({
      id: row.id,
      questionType: row.question_type,
      chapter: row.chapter_snapshot,
      prompt: row.prompt_snapshot,
      explanation: null,
      typePayload: (row.type_payload_snapshot as QuestionTypePayload | null) ?? null,
      options: [],
      acceptedAnswers: [],
      promptImages: [],
      userResponseText: null,
      wasCorrect: null,
    }));

    // 1. question_paper mode MUST produce valid %PDF- bytes, empty answerKey, and ZERO secret leakage
    const pdf = await exportStudySetToPdf(exportQuestions, {
      mode: "question_paper",
      locale: "vi",
      title: "Đề thi đang làm",
    });

    expect(pdf.bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(pdf.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(pdf.questionCount).toBe(5);
    expect(pdf.answerKey).toEqual([]);

    const extractedText = await extractPdfText(pdf.bytes);
    // Question stems & matching left/right items render cleanly
    expect(extractedText).toContain("Thủ đô của Việt Nam");
    expect(extractedText).toContain("H2O");
    expect(extractedText).toContain("Nước");
    expect(extractedText).toContain("Oxy");
    expect(extractedText).toContain("Kiểm tra trước bay");

    // Zero answer leakage
    expect(extractedText).not.toContain("SECRET_HANOI_ANSWER");
    expect(extractedText).not.toContain("SECRET_EXPLANATION");
    expect(extractedText).not.toContain("9.80665");
    expect(extractedText).not.toContain("m/s2");

    // 2. Defensive check: even if paper_and_key or formatStructuredExamResponseForPdf receives stripped payloads, it never throws
    const defensivePdf = await exportStudySetToPdf(exportQuestions, {
      mode: "paper_and_key",
      locale: "vi",
      title: "Defensive Key Check",
    });
    expect(new TextDecoder().decode(defensivePdf.bytes.subarray(0, 5))).toBe("%PDF-");

    expect(
      formatStructuredExamResponseForPdf(
        { kind: "matching", pairs: { p1: "r1" } },
        exportQuestions[1].typePayload,
        [],
        true,
      ),
    ).toBe("1-Nước");
    expect(
      formatStructuredExamResponseForPdf(
        { kind: "hotspot", clicks: [{ x: 0.4, y: 0.6 }], selected_hotspot_ids: ["hs-1"] },
        exportQuestions[2].typePayload,
        [],
        true,
      ),
    ).toBe("SECRET_ALTIMETER_LABEL");
  });

  it("renders multi-image prompt, multi-image options, and explanationImages in paper_with_explanations while omitting explanationImages in question_paper (V32-053)", async () => {
    // Valid 1x1 red PNG
    const tinyPng = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );

    const multiImageQuestion: PdfExportQuestion = {
      id: "q-multi-img",
      questionType: "single_choice",
      prompt: "Quan sát hai biểu đồ và chọn đáp án đúng:",
      explanation: "Giải thích kèm hình minh họa:",
      promptImages: [
        { bytes: tinyPng, mimeType: "image/png" },
        { bytes: tinyPng, mimeType: "image/png" },
      ],
      explanationImages: [{ bytes: tinyPng, mimeType: "image/png" }],
      options: [
        {
          id: "opt-a",
          label: "A",
          content: "",
          isCorrect: true,
          image: { bytes: tinyPng, mimeType: "image/png" },
          images: [
            { bytes: tinyPng, mimeType: "image/png" },
            { bytes: tinyPng, mimeType: "image/png" },
          ],
        },
        {
          id: "opt-b",
          label: "B",
          content: "Đáp án văn bản",
          isCorrect: false,
          image: null,
          images: [],
        },
      ],
    };

    const paperOnly = await exportStudySetToPdf([multiImageQuestion], {
      mode: "question_paper",
      locale: "vi",
      title: "Đề đa ảnh",
    });
    const withExplanations = await exportStudySetToPdf([multiImageQuestion], {
      mode: "paper_with_explanations",
      locale: "vi",
      title: "Đề đa ảnh có lời giải",
    });

    expect(new TextDecoder().decode(paperOnly.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(new TextDecoder().decode(withExplanations.bytes.subarray(0, 5))).toBe("%PDF-");

    const paperText = await extractPdfText(paperOnly.bytes);
    const expText = await extractPdfText(withExplanations.bytes);

    expect(paperText).toContain("A. [Hình ảnh]");
    expect(paperText).not.toContain("Giải thích kèm hình minh họa");
    expect(expText).toContain("Giải thích kèm hình minh họa");
    // Embedding explanation image + inline answer block makes paper_with_explanations strictly larger
    expect(withExplanations.bytes.byteLength).toBeGreaterThan(paperOnly.bytes.byteLength);
  });
});
