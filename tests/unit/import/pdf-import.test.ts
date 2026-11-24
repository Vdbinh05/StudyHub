// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  ImportSecurityError,
  parseImportInput,
  parsePdfBuffer,
  parsePdfPageRange,
} from "@/lib/import";

const FONT_PATH = path.resolve(process.cwd(), "src/assets/fonts/NotoSans-Regular.ttf");
const NOTO_REGULAR_BYTES = fs.readFileSync(FONT_PATH);

async function buildVietnamesePdf(
  pages: Array<{
    lines?: Array<{ text: string; x?: number; y: number }>;
  }>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(NOTO_REGULAR_BYTES);

  for (const pageSpec of pages) {
    const page = doc.addPage([595, 842]);
    for (const line of pageSpec.lines ?? []) {
      page.drawText(line.text, {
        x: line.x ?? 50,
        y: line.y,
        size: 11,
        font,
      });
    }
  }

  return doc.save();
}

describe("V3 Deterministic Selectable-Text PDF Importer", () => {
  it("parses page range strings deterministically", () => {
    expect(parsePdfPageRange("1-3, 5, 2", 10)).toEqual([1, 2, 3, 5]);
    expect(parsePdfPageRange("2-4", 3)).toEqual([2, 3]);
    expect(parsePdfPageRange(undefined, 3)).toEqual([1, 2, 3]);
  });

  it("extracts multi-page Vietnamese MCQs, strips repeating headers/footers, handles cross-page continuation, and maps end-of-doc answer key", async () => {
    const pdfBytes = await buildVietnamesePdf([
      {
        lines: [
          { text: "TRƯỜNG ĐẠI HỌC KHOA HỌC - ĐỀ ÔN TẬP", y: 810 },
          { text: "Câu 1: Đơn vị chuẩn của áp suất khí quyển là gì?", y: 740 },
          { text: "A. Mét trên giây", y: 718 },
          { text: "B. Hectopascal (hPa)", y: 696 },
          { text: "C. Độ Kelvin", y: 674 },
          { text: "D. Hải lý", y: 652 },
          // Cross-page continuation: Q2 prompt starts at bottom of page 1!
          { text: "Câu 2: Tầng khí quyển nào nằm sát mặt đất nhất?", y: 120 },
          { text: "Trang 1 / 3", y: 30 },
        ],
      },
      {
        lines: [
          { text: "TRƯỜNG ĐẠI HỌC KHOA HỌC - ĐỀ ÔN TẬP", y: 810 },
          { text: "A. Tầng đối lưu", y: 740 },
          { text: "B. Tầng bình lưu", y: 718 },
          { text: "C. Tầng trung lưu", y: 696 },
          { text: "D. Tầng nhiệt", y: 674 },
          { text: "Câu 3: Điểm đóng băng của nước tinh khiết ở 1 atm là bao nhiêu?", y: 620 },
          { text: "A. -10 độ C", y: 598 },
          { text: "B. 0 độ C", y: 576 },
          { text: "C. 10 độ C", y: 554 },
          { text: "D. 100 độ C", y: 532 },
          { text: "Trang 2 / 3", y: 30 },
        ],
      },
      {
        lines: [
          { text: "TRƯỜNG ĐẠI HỌC KHOA HỌC - ĐỀ ÔN TẬP", y: 810 },
          { text: "BẢNG ĐÁP ÁN", y: 740 },
          { text: "1. B   2. A   3. B", y: 715 },
          { text: "Trang 3 / 3", y: 30 },
        ],
      },
    ]);

    const result = await parseImportInput({
      fileBytes: pdfBytes,
      fileName: "de-on-tap.pdf",
    });

    expect(result.format).toBe("pdf_text");
    expect(result.isScannedPdf).toBe(false);
    expect(result.pdfPageCount).toBe(3);
    expect(result.questions).toHaveLength(3);
    expect(result.summary.validCount).toBe(3);
    expect(result.summary.errorCount).toBe(0);

    // Repeating header & footer must not pollute prompts/options
    expect(result.questions[0].prompt).toContain("áp suất khí quyển");
    expect(result.questions[0].prompt).not.toContain("TRƯỜNG ĐẠI HỌC");
    expect(result.questions[0].options.find((o) => o.isCorrect)?.label).toBe("B");

    // Cross-page question 2 stitched cleanly across page 1 -> page 2
    expect(result.questions[1].prompt).toContain("Tầng khí quyển nào nằm sát mặt đất");
    expect(result.questions[1].options).toHaveLength(4);
    expect(result.questions[1].options.find((o) => o.isCorrect)?.label).toBe("A");

    expect(result.questions[2].options.find((o) => o.isCorrect)?.label).toBe("B");
  });

  it("supports deterministic two-column reading order and page range filtering", async () => {
    const pdfBytes = await buildVietnamesePdf([
      {
        lines: [
          // Left column (x=40)
          { text: "Câu 1: Thủ đô của Việt Nam?", x: 40, y: 750 },
          { text: "*A. Hà Nội", x: 40, y: 728 },
          { text: "B. Đà Nẵng", x: 40, y: 706 },
          // Right column (x=320)
          { text: "Câu 2: Hành tinh gần Mặt Trời nhất?", x: 320, y: 750 },
          { text: "A. Sao Kim", x: 320, y: 728 },
          { text: "*B. Sao Thủy", x: 320, y: 706 },
        ],
      },
      {
        lines: [
          { text: "Câu 3: Câu hỏi ở trang 2 bị loại theo pageRange?", x: 40, y: 750 },
          { text: "*A. Đúng", x: 40, y: 728 },
          { text: "B. Sai", x: 40, y: 706 },
        ],
      },
    ]);

    const out = await parsePdfBuffer(pdfBytes, {
      twoColumn: true,
      pageRange: "1",
    });

    expect(out.extractedPages).toBe(1);
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].prompt).toContain("Thủ đô");
    expect(out.questions[0].options.find((o) => o.isCorrect)?.label).toBe("A");
    expect(out.questions[1].prompt).toContain("Hành tinh");
    expect(out.questions[1].options.find((o) => o.isCorrect)?.label).toBe("B");
  });

  it("detects scanned / image-only PDFs with no text layer honestly and emits SCANNED_PDF_DETECTED without fabricating questions", async () => {
    const blankPdf = await buildVietnamesePdf([{ lines: [] }, { lines: [] }]);
    const out = await parsePdfBuffer(blankPdf);

    expect(out.isScannedPdf).toBe(true);
    expect(out.questions).toHaveLength(0);
    expect(out.issues.some((i) => i.code === "SCANNED_PDF_DETECTED")).toBe(true);
  });

  it("rejects non-PDF / malformed binaries cleanly with ImportSecurityError", async () => {
    const fakeBytes = new TextEncoder().encode("NOT A REAL PDF FILE");
    await expect(parsePdfBuffer(fakeBytes)).rejects.toThrow(ImportSecurityError);

    const corruptPdf = new TextEncoder().encode("%PDF-1.7\nCORRUPT GARBAGE %%EOF");
    await expect(parsePdfBuffer(corruptPdf)).rejects.toThrow(ImportSecurityError);
  });
});
