import { describe, expect, it } from "vitest";
import { parseDocxBuffer, parseImportInput } from "@/lib/import";
import {
  buildDocxFixture,
  SAMPLE_PNG_BYTES,
  type DocxBodyItem,
} from "../../fixtures/fixture-builders";

describe("DOCX OOXML deterministic formatting parser", () => {
  it("detects Bold, Yellow Highlight, Red Font Color, Underline, and applies Baseline Bold Subtraction", async () => {
    const body: DocxBodyItem[] = [
      { type: "p", para: { runs: [{ text: "Chương 1: Kiểm tra định dạng OOXML", bold: true }] } },

      // Q1: Option B is Bold
      { type: "p", para: { runs: [{ text: "Câu 1: Định dạng in đậm đánh dấu đáp án nào?", bold: true }] } },
      { type: "p", para: { runs: [{ text: "A. Lựa chọn thường" }] } },
      { type: "p", para: { runs: [{ text: "B. Lựa chọn in đậm", bold: true }] } },
      { type: "p", para: { runs: [{ text: "C. Lựa chọn thường khác" }] } },
      { type: "p", para: { runs: [{ text: "D. Không đậm" }] } },

      // Q2: Option C is Yellow Highlighted
      { type: "p", para: { runs: [{ text: "Câu 2: Định dạng tô sáng đánh dấu đáp án nào?" }] } },
      { type: "p", para: { runs: [{ text: "A. Không tô" }] } },
      { type: "p", para: { runs: [{ text: "B. Bình thường" }] } },
      { type: "p", para: { runs: [{ text: "C. Đáp án được tô vàng", highlight: "yellow" }] } },
      { type: "p", para: { runs: [{ text: "D. Bình thường khác" }] } },

      // Q3: Option D has Red Font Color (FF0000)
      { type: "p", para: { runs: [{ text: "Câu 3: Màu chữ đỏ đánh dấu đáp án nào?" }] } },
      { type: "p", para: { runs: [{ text: "A. Chữ đen" }] } },
      { type: "p", para: { runs: [{ text: "B. Chữ đen" }] } },
      { type: "p", para: { runs: [{ text: "C. Chữ đen" }] } },
      { type: "p", para: { runs: [{ text: "D. Đáp án màu đỏ", color: "FF0000" }] } },

      // Q4: Option A is Underlined
      { type: "p", para: { runs: [{ text: "Câu 4: Gạch chân đánh dấu đáp án nào?" }] } },
      { type: "p", para: { runs: [{ text: "A. Đáp án gạch chân", underline: true }] } },
      { type: "p", para: { runs: [{ text: "B. Không gạch chân" }] } },
      { type: "p", para: { runs: [{ text: "C. Không gạch chân" }] } },
      { type: "p", para: { runs: [{ text: "D. Không gạch chân" }] } },

      // Q5: Baseline Bold Subtraction — ALL options are bold, ONLY C is shaded green!
      { type: "p", para: { runs: [{ text: "Câu 5: Khi TẤT CẢ đáp án đều in đậm thì không được nhận nhầm!" }] } },
      { type: "p", para: { runs: [{ text: "A. Đậm nhưng sai", bold: true }] } },
      { type: "p", para: { runs: [{ text: "B. Đậm nhưng sai", bold: true }] } },
      { type: "p", para: { runs: [{ text: "C. Đậm và có nền xanh", bold: true, shading: "92D050" }] } },
      { type: "p", para: { runs: [{ text: "D. Đậm nhưng sai", bold: true }] } },

      // Q6: ALL options bold and NO other signal -> must NOT mark all 4 correct; must flag NO_CORRECT_ANSWER!
      { type: "p", para: { runs: [{ text: "Câu 6: Tất cả đáp án đều đậm và không có tín hiệu khác?" }] } },
      { type: "p", para: { runs: [{ text: "A. Đậm 1", bold: true }] } },
      { type: "p", para: { runs: [{ text: "B. Đậm 2", bold: true }] } },
      { type: "p", para: { runs: [{ text: "C. Đậm 3", bold: true }] } },
      { type: "p", para: { runs: [{ text: "D. Đậm 4", bold: true }] } },
    ];

    const bytes = await buildDocxFixture({ body });
    const result = await parseImportInput({
      fileBytes: bytes,
      fileName: "formatted_answers.docx",
    });

    expect(result.format).toBe("docx_ooxml");
    expect(result.questions).toHaveLength(6);

    // Q1 -> B via docx_bold
    expect(result.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(result.questions[0].detectedBy).toEqual(["docx_bold"]);

    // Q2 -> C via docx_highlight
    expect(result.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["C"]);
    expect(result.questions[1].detectedBy).toEqual(["docx_highlight"]);

    // Q3 -> D via docx_font_color
    expect(result.questions[2].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["D"]);
    expect(result.questions[2].detectedBy).toEqual(["docx_font_color"]);

    // Q4 -> A via docx_underline
    expect(result.questions[3].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A"]);
    expect(result.questions[3].detectedBy).toEqual(["docx_underline"]);

    // Q5 -> C via docx_highlight (bold subtracted cleanly, NO false conflict!)
    expect(result.questions[4].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["C"]);
    expect(result.questions[4].detectedBy).toEqual(["docx_highlight"]);
    expect(result.questions[4].issues.some((i) => i.code === "ANSWER_SIGNAL_CONFLICT")).toBe(false);

    // Q6 -> 0 correct answers (NOT all 4!) -> NO_CORRECT_ANSWER
    expect(result.questions[5].options.filter((o) => o.isCorrect)).toHaveLength(0);
    expect(result.questions[5].issues.some((i) => i.code === "NO_CORRECT_ANSWER")).toBe(true);
  });

  it("flags ANSWER_SIGNAL_CONFLICT when Option A is bold while Option C is red, and respects explicit AnswerRule", async () => {
    const body: DocxBodyItem[] = [
      { type: "p", para: { runs: [{ text: "Câu 1: Xung đột tín hiệu giữa in đậm và màu chữ đỏ?" }] } },
      { type: "p", para: { runs: [{ text: "A. Lựa chọn in đậm", bold: true }] } },
      { type: "p", para: { runs: [{ text: "B. Lựa chọn thường" }] } },
      { type: "p", para: { runs: [{ text: "C. Lựa chọn màu đỏ", color: "C00000" }] } },
      { type: "p", para: { runs: [{ text: "D. Lựa chọn thường khác" }] } },
    ];

    const bytes = await buildDocxFixture({ body });

    // Auto mode detects conflict between docx_font_color (C) and docx_bold (A)
    const autoResult = await parseImportInput({
      fileBytes: bytes,
      fileName: "conflict_answers.docx",
    });
    expect(autoResult.questions).toHaveLength(1);
    expect(autoResult.summary.conflictCount).toBe(1);
    expect(autoResult.questions[0].issues.some((i) => i.code === "ANSWER_SIGNAL_CONFLICT")).toBe(true);
    // Priority: docx_font_color > docx_bold -> provisional answer is C
    expect(autoResult.questions[0].options.find((o) => o.isCorrect)?.label).toBe("C");

    // Explicit rule: only docx_bold -> selects A with ZERO conflict!
    const boldOnlyResult = await parseImportInput({
      fileBytes: bytes,
      fileName: "conflict_answers.docx",
      options: { answerRule: { mode: "docx_bold" } },
    });
    expect(boldOnlyResult.summary.conflictCount).toBe(0);
    expect(boldOnlyResult.questions[0].options.find((o) => o.isCorrect)?.label).toBe("A");
    expect(boldOnlyResult.questions[0].detectedBy).toEqual(["docx_bold"]);
  });

  it("parses Word tables (2x2 option layout + answer-key table) and extracts embedded PNG image while skipping SVG", async () => {
    const fakeSvgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const body: DocxBodyItem[] = [
      {
        type: "p",
        para: {
          runs: [
            { text: "Câu 1: Quan sát hình vẽ dưới đây và chọn đáp án đúng:" },
            { text: "", imageRId: "rIdImg1" },
          ],
        },
      },
      // 2x2 Word table holding options with bold on option B
      {
        type: "tbl",
        table: {
          rows: [
            [
              [{ runs: [{ text: "A. Tam giác đều" }] }],
              [{ runs: [{ text: "B. Hình vuông", bold: true }] }],
            ],
            [
              [{ runs: [{ text: "C. Hình tròn" }] }],
              [{ runs: [{ text: "D. Hình thang" }] }],
            ],
          ],
        },
      },
      { type: "p", para: { runs: [{ text: "Câu 2: Dữ liệu nằm trong bảng đáp án cuối bài:" }] } },
      { type: "p", para: { runs: [{ text: "A. Giá trị 10" }] } },
      { type: "p", para: { runs: [{ text: "B. Giá trị 20" }] } },
      { type: "p", para: { runs: [{ text: "C. Giá trị 30" }] } },
      { type: "p", para: { runs: [{ text: "D. Giá trị 40" }] } },
      // Answer key table at the end
      {
        type: "tbl",
        table: {
          rows: [
            [[{ runs: [{ text: "2" }] }], [{ runs: [{ text: "C" }] }]],
          ],
        },
      },
    ];

    const bytes = await buildDocxFixture({
      body,
      media: [
        { rId: "rIdImg1", fileName: "diagram1.png", bytes: SAMPLE_PNG_BYTES },
        { rId: "rIdBadSvg", fileName: "evil.svg", bytes: fakeSvgBytes },
      ],
    });

    const out = await parseDocxBuffer(bytes);
    expect(out.questions).toHaveLength(2);

    // Q1 from 2x2 table + embedded PNG
    expect(out.questions[0].promptImageUrl).toBe("/docx-media/diagram1.png");
    expect(out.questions[0].options).toHaveLength(4);
    expect(out.questions[0].options.find((o) => o.isCorrect)?.label).toBe("B");
    expect(out.extractedMedia).toHaveLength(1);
    expect(out.extractedMedia[0].mimeType).toBe("image/png");

    // SVG was rejected with warning
    expect(out.issues.some((i) => i.message.includes("evil.svg"))).toBe(true);

    // Q2 resolved from answer-key table
    expect(out.questions[1].options.find((o) => o.isCorrect)?.label).toBe("C");
    expect(out.questions[1].detectedBy).toEqual(["end_answer_key"]);
  });

  it("reconstructs Word auto-numbered lists from word/numbering.xml", async () => {
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%2."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="10"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

    const body: DocxBodyItem[] = [
      { type: "p", para: { numId: "10", ilvl: 0, runs: [{ text: "Ngôn ngữ nào chạy trên trình duyệt?" }] } },
      { type: "p", para: { numId: "10", ilvl: 1, runs: [{ text: "JavaScript", highlight: "yellow" }] } },
      { type: "p", para: { numId: "10", ilvl: 1, runs: [{ text: "COBOL" }] } },
      { type: "p", para: { numId: "10", ilvl: 1, runs: [{ text: "Fortran" }] } },
    ];

    const bytes = await buildDocxFixture({ body, numberingXml });
    const out = await parseDocxBuffer(bytes);

    expect(out.questions).toHaveLength(1);
    expect(out.questions[0].prompt).toBe("Ngôn ngữ nào chạy trên trình duyệt?");
    expect(out.questions[0].options.map((o) => o.label)).toEqual(["A", "B", "C"]);
    expect(out.questions[0].options[0].isCorrect).toBe(true);
  });
});
