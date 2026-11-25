// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  exportStudySetToPdf,
  formatStructuredExamResponseForPdf,
  type PdfExportQuestion,
} from "@/lib/export/pdf-exporter";
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
});
