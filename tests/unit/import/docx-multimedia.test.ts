import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseDocxBuffer } from "@/lib/import/docx-ooxml-parser";
import { parseImportInput, validateImportBatch } from "@/lib/import";

// Minimal valid 1x1 PNG buffers with distinct pixel bytes
const PNG_IMG_1 = new Uint8Array([
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

const JPEG_IMG_2 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

function inlineDrawingXml(rId: string, descr: string): string {
  return `<w:drawing><wp:inline><wp:docPr id="1" name="${descr}" descr="${descr}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function floatingAnchorDrawingXml(rId: string, descr: string): string {
  return `<w:drawing><wp:anchor><wp:docPr id="2" name="${descr}" descr="${descr}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
}

async function buildMultimediaDocx(
  bodyXml: string,
  mediaEntries: Array<{ rId: string; fileName: string; bytes: Uint8Array }>,
): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  const relsLines = mediaEntries.map(
    (m) =>
      `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.fileName}"/>`,
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${relsLines.join("\n")}
</Relationships>`,
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`,
  );

  for (const m of mediaEntries) {
    zip.file(`word/media/${m.fileName}`, m.bytes);
  }

  return zip.generateAsync({ type: "uint8array" });
}

describe("V3 DOCX Multimedia Parser (inline multi-image, image-only options, tables, floating anchor warnings)", () => {
  it("extracts multiple prompt images, 4 image-only options (B highlighted correct), table images, floating anchor warning, and 2 chapters with repeated numbering", async () => {
    const bodyXml = `
      <w:p><w:r><w:t>Chương 1: Quang học &amp; Hình ảnh</w:t></w:r></w:p>

      <!-- Q1: Prompt with 2 inline images + 4 image-only options where B is highlighted yellow -->
      <w:p>
        <w:r><w:t>Câu 1: Quan sát hai sơ đồ sau và chọn hình biểu diễn đúng:</w:t></w:r>
        <w:r>${inlineDrawingXml("rId1", "Sơ đồ 1")}</w:r>
      </w:p>
      <w:p>
        <w:r>${inlineDrawingXml("rId2", "Sơ đồ 2")}</w:r>
      </w:p>
      <w:p><w:r><w:t>A. </w:t></w:r><w:r>${inlineDrawingXml("rId3", "Hình A")}</w:r></w:p>
      <w:p><w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t>B. </w:t></w:r><w:r>${inlineDrawingXml("rId4", "Hình B")}</w:r></w:p>
      <w:p><w:r><w:t>C. </w:t></w:r><w:r>${inlineDrawingXml("rId5", "Hình C")}</w:r></w:p>
      <w:p><w:r><w:t>D. </w:t></w:r><w:r>${inlineDrawingXml("rId6", "Hình D")}</w:r></w:p>

      <!-- Q2: Floating wp:anchor image flagged as ambiguous -->
      <w:p>
        <w:r><w:t>Câu 2: Hình nổi dưới đây minh họa hiện tượng gì?</w:t></w:r>
        <w:r>${floatingAnchorDrawingXml("rId7", "Floating figure")}</w:r>
      </w:p>
      <w:p><w:r><w:t>A. Khúc xạ</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>B. Phản xạ toàn phần</w:t></w:r></w:p>

      <w:p><w:r><w:t>Chương 2: Bảng có hình ảnh</w:t></w:r></w:p>

      <!-- Q1 in Chapter 2 (repeated number!) inside a layout table containing an inline diagram -->
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p>
              <w:r><w:t>Câu 1: Biểu đồ trong bảng cho biết trạng thái nào?</w:t></w:r>
              <w:r>${inlineDrawingXml("rId8", "Biểu đồ bảng")}</w:r>
            </w:p>
          </w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A. Ổn định</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>B. Bất ổn định</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `;

    const bytes = await buildMultimediaDocx(bodyXml, [
      { rId: "rId1", fileName: "prompt1.png", bytes: PNG_IMG_1 },
      { rId: "rId2", fileName: "prompt2.jpg", bytes: JPEG_IMG_2 },
      { rId: "rId3", fileName: "optA.png", bytes: PNG_IMG_1 },
      { rId: "rId4", fileName: "optB.png", bytes: PNG_IMG_1 },
      { rId: "rId5", fileName: "optC.png", bytes: PNG_IMG_1 },
      { rId: "rId6", fileName: "optD.png", bytes: PNG_IMG_1 },
      { rId: "rId7", fileName: "floating.png", bytes: PNG_IMG_1 },
      { rId: "rId8", fileName: "table_chart.jpg", bytes: JPEG_IMG_2 },
    ]);

    // 1. Direct parseDocxBuffer with V3 preview dataUrls enabled
    const out = await parseDocxBuffer(bytes, { preservePreviewDataUrls: true });
    expect(out.questions).toHaveLength(3);

    // Q1: 2 inline prompt images + 4 image-only options -> promoted to image_choice, B is correct!
    const q1 = out.questions[0];
    expect(q1.chapter).toContain("Chương 1");
    expect(q1.questionType).toBe("image_choice");
    expect(q1.promptImageUrl).toBeNull(); // raw /docx-media/* never leaked into DB field
    expect(q1.promptMedia).toHaveLength(2);
    expect(q1.promptMedia?.[0]?.fileName).toBe("prompt1.png");
    expect(q1.promptMedia?.[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(q1.promptMedia?.[0]?.anchorType).toBe("inline");
    expect(q1.promptMedia?.[0]?.alt).toBe("Sơ đồ 1");
    expect(q1.promptMedia?.[1]?.fileName).toBe("prompt2.jpg");
    expect(q1.promptMedia?.[1]?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);

    expect(q1.options).toHaveLength(4);
    expect(q1.options.every((o) => (o.media?.length ?? 0) === 1)).toBe(true);
    expect(q1.options.find((o) => o.isCorrect)?.label).toBe("B");
    expect(q1.ambiguousMedia).toBeUndefined();

    // Validator must mark image-only options valid (0 errors!)
    const validated = validateImportBatch(out.questions);
    expect(validated.summary.errorCount).toBe(0);
    expect(validated.summary.validCount).toBe(3);

    // Q2: Floating wp:anchor image flagged as ambiguousMedia + AMBIGUOUS_MEDIA_MAPPING warning
    const q2 = out.questions[1];
    expect(q2.ambiguousMedia).toBe(true);
    expect(q2.promptMedia?.[0]?.anchorType).toBe("floating");
    expect(q2.promptMedia?.[0]?.ambiguous).toBe(true);
    expect(q2.issues.some((i) => i.code === "AMBIGUOUS_MEDIA_MAPPING")).toBe(true);
    expect(q2.options.find((o) => o.isCorrect)?.label).toBe("B");

    // Q3: Chapter 2, repeated Câu 1 inside table with image + red font color correct answer
    const q3 = out.questions[2];
    expect(q3.chapter).toContain("Chương 2");
    expect(q3.localQuestionNumber).toBe(1);
    expect(q3.promptMedia).toHaveLength(1);
    expect(q3.promptMedia?.[0]?.fileName).toBe("table_chart.jpg");
    expect(q3.options.find((o) => o.isCorrect)?.label).toBe("B");

    // 2. Full orchestrator (`parseImportInput`) with V3 multimedia preview enabled reports `docx_multimedia` and 3/3 valid
    const preview = await parseImportInput({
      fileBytes: bytes,
      fileName: "multimedia-quiz.docx",
      options: { preserveMediaPreviews: true },
    });
    expect(preview.format).toBe("docx_multimedia");
    expect(preview.summary.validCount).toBe(3);
    expect(preview.summary.errorCount).toBe(0);
  });
});
