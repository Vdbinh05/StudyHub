import ExcelJS from "exceljs";
import JSZip from "jszip";

export interface DocxRunSpec {
  text: string;
  bold?: boolean;
  boldOff?: boolean;
  underline?: boolean;
  highlight?: string;
  shading?: string;
  color?: string;
  rStyle?: string;
  imageRId?: string;
}

export interface DocxParagraphSpec {
  runs: DocxRunSpec[];
  pStyle?: string;
  pShading?: string;
  numId?: string;
  ilvl?: number;
}

export interface DocxTableSpec {
  rows: Array<Array<DocxParagraphSpec[]>>;
}

export type DocxBodyItem =
  | { type: "p"; para: DocxParagraphSpec }
  | { type: "tbl"; table: DocxTableSpec };

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildParagraphXml(para: DocxParagraphSpec): string {
  const pPrParts: string[] = [];
  if (para.pStyle) {
    pPrParts.push(`<w:pStyle w:val="${escapeXml(para.pStyle)}"/>`);
  }
  if (para.pShading) {
    pPrParts.push(`<w:shd w:val="clear" w:fill="${escapeXml(para.pShading)}"/>`);
  }
  if (para.numId) {
    pPrParts.push(
      `<w:numPr><w:ilvl w:val="${para.ilvl ?? 0}"/><w:numId w:val="${escapeXml(para.numId)}"/></w:numPr>`,
    );
  }
  const pPrXml = pPrParts.length > 0 ? `<w:pPr>${pPrParts.join("")}</w:pPr>` : "";

  const runsXml = para.runs
    .map((run) => {
      const rPrParts: string[] = [];
      if (run.rStyle) rPrParts.push(`<w:rStyle w:val="${escapeXml(run.rStyle)}"/>`);
      if (run.bold) rPrParts.push("<w:b/>");
      if (run.boldOff) rPrParts.push('<w:b w:val="0"/>');
      if (run.underline) rPrParts.push('<w:u w:val="single"/>');
      if (run.highlight) {
        rPrParts.push(`<w:highlight w:val="${escapeXml(run.highlight)}"/>`);
      }
      if (run.shading) {
        rPrParts.push(`<w:shd w:val="clear" w:fill="${escapeXml(run.shading)}"/>`);
      }
      if (run.color) {
        rPrParts.push(`<w:color w:val="${escapeXml(run.color)}"/>`);
      }
      const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join("")}</w:rPr>` : "";
      const drawing = run.imageRId
        ? `<w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${escapeXml(run.imageRId)}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
        : "";
      const textXml = run.text
        ? `<w:t xml:space="preserve">${escapeXml(run.text)}</w:t>`
        : "";
      return `<w:r>${rPr}${textXml}${drawing}</w:r>`;
    })
    .join("");

  return `<w:p>${pPrXml}${runsXml}</w:p>`;
}

function buildTableXml(table: DocxTableSpec): string {
  const rowsXml = table.rows
    .map((row) => {
      const cellsXml = row
        .map((cellParas) => `<w:tc>${cellParas.map(buildParagraphXml).join("")}</w:tc>`)
        .join("");
      return `<w:tr>${cellsXml}</w:tr>`;
    })
    .join("");
  return `<w:tbl>${rowsXml}</w:tbl>`;
}

/**
 * Valid 1x1 transparent PNG bytes for testing embedded DOCX raster images.
 */
export const SAMPLE_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

/**
 * Programmatically generate a real, spec-compliant OOXML `.docx` buffer using JSZip.
 */
export async function buildDocxFixture(options: {
  body: DocxBodyItem[];
  stylesXml?: string;
  numberingXml?: string;
  media?: Array<{ rId: string; fileName: string; bytes: Uint8Array }>;
  extraEntries?: Record<string, string | Uint8Array>;
  rawDocumentXmlOverride?: string;
}): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const bodyXml = options.body
    .map((item) =>
      item.type === "p" ? buildParagraphXml(item.para) : buildTableXml(item.table),
    )
    .join("\n");

  const documentXml =
    options.rawDocumentXmlOverride ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`;

  zip.file("word/document.xml", documentXml);

  if (options.stylesXml) {
    zip.file("word/styles.xml", options.stylesXml);
  }
  if (options.numberingXml) {
    zip.file("word/numbering.xml", options.numberingXml);
  }

  if (options.media && options.media.length > 0) {
    const rels = options.media
      .map(
        (m) =>
          `<Relationship Id="${escapeXml(m.rId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(m.fileName)}"/>`,
      )
      .join("\n");
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels}
</Relationships>`,
    );
    for (const m of options.media) {
      zip.file(`word/media/${m.fileName}`, m.bytes);
    }
  }

  if (options.extraEntries) {
    for (const [entryPath, content] of Object.entries(options.extraEntries)) {
      zip.file(entryPath, content);
    }
  }

  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return buf;
}

/**
 * Programmatically generate a real Wayground XLSX buffer via ExcelJS.
 */
export async function buildWaygroundXlsxFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quiz");
  ws.addRow([
    "Question Text",
    "Question Type",
    "Option 1",
    "Option 2",
    "Option 3",
    "Option 4",
    "Option 5",
    "Correct Answer",
    "Time in seconds",
    "Image Link",
    "Answer Explanation",
  ]);
  ws.addRow([
    "Nguyên tố hóa học nào có ký hiệu là Fe?",
    "Multiple Choice",
    "Đồng",
    "Sắt",
    "Kẽm",
    "Bạc",
    "",
    2,
    30,
    "https://example.com/iron.png",
    "Fe bắt nguồn từ tiếng Latinh Ferrum (Sắt).",
  ]);
  ws.addRow([
    "Chọn tất cả các số chẵn nguyên tố hoặc chia hết cho 4:",
    "Checkbox",
    "2",
    "3",
    "4",
    "5",
    "8",
    "1,3,5",
    45,
    "",
    "2 là số nguyên tố chẵn; 4 và 8 chia hết cho 4.",
  ]);
  ws.addRow([
    "Trái Đất quay quanh Mặt Trời?",
    "Multiple Choice",
    "Đúng",
    "Sai",
    "",
    "",
    "",
    "A",
    20,
    "javascript:alert(1)",
    "URL không an toàn sẽ bị loại bỏ.",
  ]);
  const arr = await wb.xlsx.writeBuffer();
  return new Uint8Array(arr as ArrayBuffer);
}

/**
 * Programmatically generate a generic multi-sheet XLSX buffer for custom ColumnMapping tests.
 */
export async function buildGenericXlsxFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const sheet1 = wb.addWorksheet("Intro");
  sheet1.addRow(["Notes"]);
  sheet1.addRow(["Metadata sheet"]);

  const sheet2 = wb.addWorksheet("Bank");
  sheet2.addRow([
    "Chủ đề",
    "Nội dung câu hỏi",
    "PA1",
    "PA2",
    "PA3",
    "PA4",
    "ĐA",
    "Ghi chú",
  ]);
  sheet2.addRow([
    "Chương 1",
    "Đơn vị đo cường độ dòng điện là gì?",
    "Vôn (V)",
    "Ampe (A)",
    "Ôm (Ω)",
    "Oát (W)",
    "Ampe (A)",
    "Đơn vị SI là Ampe.",
  ]);
  sheet2.addRow([
    "Chương 2",
    "Công thức định luật Ôm là gì?",
    "I = U / R",
    "I = U * R",
    "U = I / R",
    "R = U * I",
    "A",
    "Cường độ dòng điện tỉ lệ thuận với hiệu điện thế.",
  ]);

  const arr = await wb.xlsx.writeBuffer();
  return new Uint8Array(arr as ArrayBuffer);
}
