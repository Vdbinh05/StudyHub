import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { fetchExistingQuestionFingerprints } from "@/app/api/import/_existing-fingerprints";
import { exportStudySet, sanitizeCsvCell } from "@/lib/export";
import {
  compactPreviewForTransport,
  computeQuestionDuplicateFingerprint,
  deduplicateHeaders,
  normalizeForComparison,
  parseImportInput,
  parseQuestionTypeValue,
  suggestColumnMapping,
} from "@/lib/import";
import type { Database } from "@/types/database";
import type { Question, StudySet } from "@/types/domain";
import { buildDocxFixture, SAMPLE_PNG_BYTES } from "../../fixtures/fixture-builders";

/**
 * Helper: build a synthetic institutional 2-row merged Vietnamese XLSX workbook
 * matching the structural schema (A1:E2 + H1:H2 vertical merges; F1:G1, I1:J1..O1:P1
 * horizontal merges with Row-2 "Nội dung" / "Giải thích" subheaders).
 * Uses 100% synthetic physics/geography questions — zero real external bank content.
 */
async function buildSyntheticInstitutionalXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");

  ws.addRow([
    "Mã câu hỏi\n(Theo quy định)",
    "Tên Kho",
    "Dạng câu hỏi",
    "Mã Kho",
    "Loại kiến thức (Chuyên môn/nghiệp vụ)",
    "Nội dung câu hỏi",
    "",
    "Đáp án",
    "Phương án lựa chọn 1",
    "",
    "Phương án lựa chọn 2",
    "",
    "Phương án lựa chọn 3",
    "",
    "Phương án lựa chọn 4",
    "",
  ]);

  ws.addRow([
    "",
    "",
    "",
    "",
    "",
    "Nội dung",
    "Giải thích",
    "",
    "Nội dung",
    "Giải thích",
    "Nội dung",
    "Giải thích",
    "Nội dung",
    "Giải thích",
    "Nội dung",
    "Giải thích",
  ]);

  ws.mergeCells("A1:A2");
  ws.mergeCells("B1:B2");
  ws.mergeCells("C1:C2");
  ws.mergeCells("D1:D2");
  ws.mergeCells("E1:E2");
  ws.mergeCells("F1:G1");
  ws.mergeCells("H1:H2");
  ws.mergeCells("I1:J1");
  ws.mergeCells("K1:L1");
  ws.mergeCells("M1:N1");
  ws.mergeCells("O1:P1");

  // Row 3: SC with interior U+FEFF and leading number/letter prefixes + technical units
  ws.addRow([
    "",
    "",
    "SC",
    "",
    "",
    "1. At standard sea level, which pressure corresponds to ISA?",
    "ISA standard sea-level pressure is 1013.25 hPa.",
    3,
    "a) 980 hPa",
    "",
    "b) 1000 hPa",
    "",
    "c) 1013.25 hPa\uFEFF",
    "",
    "d) 1050 hPa",
    "",
  ]);

  // Row 4: MC (multi-select) with "1,4"
  ws.addRow([
    "",
    "",
    "MC",
    "",
    "",
    "2. Which units measure temperature or altitude in standard charts?",
    "Both °C and FL 300 are standard notations.",
    "1, 4",
    "a) °C",
    "",
    "b) Ohm",
    "",
    "c) Lumen",
    "",
    "d) FL 300",
    "",
  ]);

  // Row 5: Shared short stem with different options & answer (must NOT be flagged duplicate!)
  ws.addRow([
    "",
    "",
    "SC",
    "",
    "",
    "3. Select the correct statement:",
    "",
    2,
    "a) Water boils at 50°C at sea level.",
    "",
    "b) Water freezes at 0°C at sea level.",
    "",
    "c) Ice melts at -40°C.",
    "",
    "d) Steam condenses at 200°C.",
    "",
  ]);

  // Row 6: Same short stem as Row 5, completely different options & answer
  ws.addRow([
    "",
    "",
    "SC",
    "",
    "",
    "4. Select the correct statement:",
    "",
    1,
    "a) Earth orbits the Sun.",
    "",
    "b) The Sun orbits the Moon.",
    "",
    "c) Mars has rings like Saturn.",
    "",
    "d) Venus is farther than Jupiter.",
    "",
  ]);

  // Row 7: TF type
  ws.addRow([
    "",
    "",
    "TF",
    "",
    "",
    "5. Sound travels faster in steel than in air.",
    "",
    1,
    "a) True",
    "",
    "b) False",
    "",
    "",
    "",
    "",
    "",
  ]);

  const arr = await wb.xlsx.writeBuffer();
  return new Uint8Array(arr as ArrayBuffer);
}

describe("Wave 2 Import & Export Regression Suite", () => {
  it("parses institutional 2-row merged XLSX headers with 100% accuracy, unique column names, SC/MC/TF codes, and clean prefix/BOM stripping (SH-003, SH-004, SH-018)", async () => {
    const bytes = await buildSyntheticInstitutionalXlsx();
    const res = await parseImportInput({
      fileBytes: bytes,
      fileName: "institutional_merged_2row.xlsx",
    });

    expect(res.format).toBe("xlsx_generic");
    expect(res.headerRowCount).toBe(2);
    expect(res.detectedColumns).toHaveLength(16);
    // Every detected column name must be globally unique (fixes React <SelectItem> duplicate key crash)
    expect(new Set(res.detectedColumns).size).toBe(16);

    // Smart auto-mapping: prefers Nội dung over Giải thích, never maps Mã câu hỏi / Dạng câu hỏi to prompt/options
    expect(res.suggestedMapping?.prompt).toBe("Nội dung câu hỏi — Nội dung");
    expect(res.suggestedMapping?.questionType).toBe("Dạng câu hỏi");
    expect(res.suggestedMapping?.optionA).toBe("Phương án lựa chọn 1 — Nội dung");
    expect(res.suggestedMapping?.optionB).toBe("Phương án lựa chọn 2 — Nội dung");
    expect(res.suggestedMapping?.optionC).toBe("Phương án lựa chọn 3 — Nội dung");
    expect(res.suggestedMapping?.optionD).toBe("Phương án lựa chọn 4 — Nội dung");
    expect(res.suggestedMapping?.optionE).toBeNull();
    expect(res.suggestedMapping?.optionF).toBeNull();
    expect(res.suggestedMapping?.correctAnswer).toBe("Đáp án");
    expect(res.suggestedMapping?.explanation).toBe("Nội dung câu hỏi — Giải thích");

    // Row 2 subheaders must NOT leak as Question #1
    expect(res.questions).toHaveLength(5);
    expect(res.summary.validCount).toBe(5);
    expect(res.summary.errorCount).toBe(0);
    expect(res.summary.duplicateCount).toBe(0);

    // Q1: SC -> single_choice, interior U+FEFF & prefixes stripped, technical units preserved
    const q1 = res.questions[0];
    expect(q1.questionType).toBe("single_choice");
    expect(q1.prompt).toBe("At standard sea level, which pressure corresponds to ISA?");
    expect(q1.options.map((o) => o.content)).toEqual([
      "980 hPa",
      "1000 hPa",
      "1013.25 hPa",
      "1050 hPa",
    ]);
    expect(q1.options[2].content.includes("\uFEFF")).toBe(false);
    expect(q1.options[2].isCorrect).toBe(true);
    expect(q1.explanation).toBe("ISA standard sea-level pressure is 1013.25 hPa.");

    // Q2: MC -> multiple_choice
    const q2 = res.questions[1];
    expect(q2.questionType).toBe("multiple_choice");
    expect(q2.options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "D"]);
    expect(q2.options[0].content).toBe("°C");
    expect(q2.options[3].content).toBe("FL 300");

    // Q3 & Q4: identical short stem with distinct options -> NEITHER flagged duplicate
    expect(res.questions[2].isDuplicate).toBe(false);
    expect(res.questions[3].isDuplicate).toBe(false);

    // Q5: TF -> true_false
    expect(res.questions[4].questionType).toBe("true_false");
    expect(res.questions[4].options.find((o) => o.isCorrect)?.label).toBe("A");
  });

  it("prevents single-letter substring mis-mapping, deduplicates colliding headers, and recognizes all institutional questionType codes (SH-004, SH-018)", () => {
    const rawHeaders = [
      "Mã câu hỏi",
      "Dạng câu hỏi",
      "Giải thích",
      "Giải thích",
      "Phương án 1",
      "Phương án 2",
      "Đáp án",
    ];
    const unique = deduplicateHeaders(rawHeaders);
    expect(new Set(unique).size).toBe(rawHeaders.length);
    expect(unique[2]).toBe("Giải thích [C]");
    expect(unique[3]).toBe("Giải thích [D]");

    const mapping = suggestColumnMapping([
      "Mã câu hỏi (Theo quy định)",
      "Dạng câu hỏi",
      "Loại kiến thức",
      "Câu hỏi",
      "Lựa chọn 1",
      "Lựa chọn 2",
      "Đáp án",
    ]);
    expect(mapping.prompt).toBe("Câu hỏi");
    expect(mapping.questionType).toBe("Dạng câu hỏi");
    expect(mapping.optionA).toBe("Lựa chọn 1");
    expect(mapping.optionB).toBe("Lựa chọn 2");
    expect(mapping.optionC).toBeNull();
    expect(mapping.optionD).toBeNull();
    expect(mapping.optionE).toBeNull();
    expect(mapping.correctAnswer).toBe("Đáp án");

    expect(parseQuestionTypeValue("SC")).toBe("single_choice");
    expect(parseQuestionTypeValue("MC")).toBe("multiple_choice");
    expect(parseQuestionTypeValue("TF")).toBe("true_false");
    expect(parseQuestionTypeValue("SA")).toBe("short_answer");
    expect(parseQuestionTypeValue("SHORT")).toBe("short_answer");
    expect(parseQuestionTypeValue("FC")).toBe("flashcard");
    expect(parseQuestionTypeValue("FLASHCARD")).toBe("flashcard");
  });

  it("uses prompt + sorted options + correct answers for duplicate fingerprinting (SH-017)", async () => {
    const txt = `Câu 1: Choose the valid statement:
*A. Red is a primary color
B. Triangle has 4 sides
C. Ice is hotter than steam
D. Water has formula CO2

Câu 2: Choose the valid statement:
A. Earth has 3 moons
*B. Pacific is the largest ocean
C. Gold has symbol Ag
D. Nitrogen is a metal

Câu 3: Choose the valid statement:
C. Ice is hotter than steam
*A. Red is a primary color
D. Water has formula CO2
B. Triangle has 4 sides`;

    const res = await parseImportInput({ rawText: txt, fileName: "dedup_check.txt" });
    expect(res.questions).toHaveLength(3);
    // Q2 shares the prompt with Q1, but has completely different options & answer -> NOT duplicate
    expect(res.questions[1].isDuplicate).toBe(false);
    // Q3 has the exact same prompt, same options (re-ordered), and same correct answer as Q1 -> genuine duplicate
    expect(res.questions[2].isDuplicate).toBe(true);
    expect(res.summary.duplicateCount).toBe(1);

    // Fingerprint differs if only the correct answer differs
    const fpA = computeQuestionDuplicateFingerprint({
      prompt: "Same stem?",
      options: [
        { content: "Alpha", isCorrect: true },
        { content: "Beta", isCorrect: false },
      ],
    });
    const fpB = computeQuestionDuplicateFingerprint({
      prompt: "Same stem?",
      options: [
        { content: "Alpha", isCorrect: false },
        { content: "Beta", isCorrect: true },
      ],
    });
    expect(fpA).not.toBe(fpB);

    // Existing fingerprints check matches exact duplicate without false-flagging different-options question
    const resAgainstDb = await parseImportInput({
      rawText: txt,
      existingFingerprints: [
        computeQuestionDuplicateFingerprint({
          prompt: "Choose the valid statement:",
          options: [
            { content: "Earth has 3 moons", isCorrect: false },
            { content: "Pacific is the largest ocean", isCorrect: true },
            { content: "Gold has symbol Ag", isCorrect: false },
            { content: "Nitrogen is a metal", isCorrect: false },
          ],
        }),
      ],
    });
    expect(resAgainstDb.questions[0].isDuplicate).toBe(false);
    expect(resAgainstDb.questions[1].isDuplicate).toBe(true);
  });

  it("ignores stale pPr/rPr bold on non-bold runs, splits <w:br/> line breaks preserving formatting, and strips dead /docx-media/ URLs with EMBEDDED_IMAGE_SKIPPED warning (SH-018)", async () => {
    const rawDocumentXmlOverride = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <!-- Q1: Option A has stale pPr/rPr bold ONLY (run is plain); Option B has actual bold on w:r/w:rPr -->
    <w:p><w:r><w:t>1. Which option is genuinely bold?</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:rPr><w:b/></w:rPr></w:pPr>
      <w:r><w:t>a) Stale paragraph-mark bold only</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/></w:rPr><w:t>b) Actually bold option</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t>c) Plain option C</w:t></w:r></w:p>
    <w:p><w:r><w:t>d) Plain option D</w:t></w:r></w:p>

    <!-- Q2: Single paragraph split with <w:br/> Shift+Enter breaks, with bold on C and embedded PNG -->
    <w:p>
      <w:r><w:t>2. Line break separated question?</w:t><w:br/></w:r>
      <w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>
      <w:r><w:t>A. First line</w:t><w:br/></w:r>
      <w:r><w:t>B. Second line</w:t><w:br/></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>C. Bold third line</w:t><w:br/></w:r>
      <w:r><w:t>D. Fourth line</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

    const docxBytes = await buildDocxFixture({
      body: [],
      rawDocumentXmlOverride,
      media: [{ rId: "rIdImg1", fileName: "chart.png", bytes: SAMPLE_PNG_BYTES }],
    });

    const parsed = await parseImportInput({
      fileBytes: docxBytes,
      fileName: "ppr_br_media.docx",
    });

    expect(parsed.questions).toHaveLength(2);
    expect(parsed.summary.errorCount).toBe(0);

    // Q1: Only B is marked correct (stale pPr/rPr on A does NOT trigger bold)
    expect(parsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);

    // Q2: <w:br/> split cleanly into 4 options with C bold, and dead /docx-media/ URL stripped + warning emitted
    const q2 = parsed.questions[1];
    expect(q2.prompt).toBe("Line break separated question?");
    expect(q2.options).toHaveLength(4);
    expect(q2.options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["C"]);
    expect(q2.promptImageUrl).toBeNull();
    expect(q2.issues.some((i) => i.code === "EMBEDDED_IMAGE_SKIPPED")).toBe(true);

    // compactPreviewForTransport strips rawSource & formatting bloat cleanly
    const compacted = compactPreviewForTransport(parsed);
    expect(compacted.questions[0].rawSource).toBeUndefined();
    expect(compacted.questions[0].options[0].formatting).toBeUndefined();
  });

  it("blocks XLSX XXE declarations, XLSX ZIP bombs, and forged Central Directory uncompressedSize bombs before ExcelJS loads (SEC-010 / SH-031)", async () => {
    // 1. XLSX with XXE DOCTYPE inside xl/sharedStrings.xml
    const xxeZip = new JSZip();
    xxeZip.file("[Content_Types].xml", "<Types/>");
    xxeZip.file("xl/workbook.xml", "<workbook/>");
    xxeZip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><sst><si><t>&xxe;</t></si></sst>`,
    );
    const xxeXlsxBytes = await xxeZip.generateAsync({ type: "uint8array" });
    await expect(
      parseImportInput({ fileBytes: xxeXlsxBytes, fileName: "xxe.xlsx" }),
    ).rejects.toMatchObject({ code: "XXE_FORBIDDEN" });

    // 2. XLSX with forged Central Directory uncompressedSize spoofing a >100:1 bomb!
    const forgedZip = new JSZip();
    forgedZip.file("[Content_Types].xml", "<Types/>");
    forgedZip.file("xl/workbook.xml", "<workbook/>");
    forgedZip.file("xl/worksheets/sheet1.xml", "A".repeat(512 * 1024));
    const realBombBytes = await forgedZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    // Tamper the ZIP Central Directory uncompressedSize field for sheet1.xml down to 100 bytes
    // so header-only inspection would be fooled, proving streaming guard catches it!
    const tampered = new Uint8Array(realBombBytes);
    const view = new DataView(tampered.buffer, tampered.byteOffset, tampered.byteLength);
    let eocdOffset = -1;
    for (let i = tampered.byteLength - 22; i >= Math.max(0, tampered.byteLength - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    expect(eocdOffset).toBeGreaterThan(0);
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let cursor = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder();
    for (let i = 0; i < totalEntries; i += 1) {
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const name = decoder.decode(tampered.subarray(cursor + 46, cursor + 46 + nameLen));
      if (name === "xl/worksheets/sheet1.xml") {
        // Forge Central Directory uncompressedSize = 100 bytes!
        view.setUint32(cursor + 24, 100, true);
      }
      cursor += 46 + nameLen + extraLen + commentLen;
    }

    await expect(
      parseImportInput({ fileBytes: tampered, fileName: "forged_bomb.xlsx" }),
    ).rejects.toMatchObject({ code: "ZIP_RATIO_BOMB_DETECTED" });
  });

  it("neutralizes OWASP CSV formula injection triggers while preserving plain negative numbers (SEC-019 / SH-043)", async () => {
    expect(sanitizeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
    expect(sanitizeCsvCell("+1+1")).toBe("'+1+1");
    expect(sanitizeCsvCell("-1+cmd|' /C calc'!A0")).toBe("'-1+cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("-SUM(A1:A2)")).toBe("'-SUM(A1:A2)");
    expect(sanitizeCsvCell("@SUM(1+1)")).toBe("'@SUM(1+1)");
    expect(sanitizeCsvCell("\t=1+1")).toBe("'\t=1+1");
    expect(sanitizeCsvCell("\r=1+1")).toBe("'\r=1+1");
    // Pure negative numeric literals stay clean
    expect(sanitizeCsvCell("-40")).toBe("-40");
    expect(sanitizeCsvCell("-273.15")).toBe("-273.15");

    const now = new Date().toISOString();
    const studySet: Pick<StudySet, "id" | "title" | "description" | "subject" | "set_type"> = {
      id: "set-sec",
      title: "Formula Injection Test",
      description: null,
      subject: "Security",
      set_type: "multiple_choice",
    };
    const questions: Question[] = [
      {
        id: "q-sec-1",
        study_set_id: "set-sec",
        question_type: "single_choice",
        position: 0,
        chapter: "=HYPERLINK(\"https://evil.example\")",
        prompt: "+1+1?",
        prompt_image_url: null,
        back_text: null,
        back_image_url: null,
        explanation: "@SUM(A1:A2)",
        hint: "\t=2+2",
        difficulty: "medium",
        source_metadata: {},
        created_at: now,
        updated_at: now,
        options: [
          { id: "o-1", question_id: "q-sec-1", study_set_id: "set-sec", position: 0, label: "A", content: "-273.15", image_url: null, is_correct: true, created_at: now },
          { id: "o-2", question_id: "q-sec-1", study_set_id: "set-sec", position: 1, label: "B", content: "-1+cmd", image_url: null, is_correct: false, created_at: now },
        ],
        tags: [],
      },
    ];

    const exported = await exportStudySet(studySet, questions, { format: "csv" });
    const csvStr = new TextDecoder().decode(exported.content).replace(/^\uFEFF/, "");
    const parsedCsv = Papa.parse<string[]>(csvStr, { header: false }).data;
    const row = parsedCsv[1];

    expect(row[0]).toBe(`'=HYPERLINK("https://evil.example")`);
    expect(row[2]).toBe("'+1+1?");
    expect(row[3]).toBe("-273.15");
    expect(row[4]).toBe("'-1+cmd");
    expect(row[11]).toBe("'@SUM(A1:A2)");
    expect(row[12]).toBe("'\t=2+2");
  });

  it("prefilters existing questions by candidateNormalizedPrompts before fetching options/answers (fixes O(N²) 10k chunked commit queries)", async () => {
    const existingQuestions = Array.from({ length: 1_200 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      prompt: `Existing question #${i + 1}`,
      back_text: null as string | null,
    }));
    const targetId = existingQuestions[1_050].id;

    let questionQueries = 0;
    let optionQueries = 0;
    let acceptedQueries = 0;
    const optionQueryIds: string[][] = [];

    const mockSupabase = {
      from(table: string) {
        if (table === "questions") {
          return {
            select() { return this; },
            eq() { return this; },
            order() { return this; },
            async range(from: number, to: number) {
              questionQueries += 1;
              return { data: existingQuestions.slice(from, to + 1), error: null };
            },
          };
        }
        if (table === "question_options") {
          return {
            select() { return this; },
            eq() { return this; },
            async in(_col: string, ids: string[]) {
              optionQueries += 1;
              optionQueryIds.push(ids);
              return {
                data: ids.includes(targetId)
                  ? [
                      { question_id: targetId, content: "Opt A", is_correct: true },
                      { question_id: targetId, content: "Opt B", is_correct: false },
                    ]
                  : [],
                error: null,
              };
            },
          };
        }
        if (table === "question_accepted_answers") {
          return {
            select() { return this; },
            eq() { return this; },
            async in() {
              acceptedQueries += 1;
              return { data: [], error: null };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    // Case 1: Distinct incoming prompts -> 0 option/accepted queries across 1,200 existing rows!
    const distinctRes = await fetchExistingQuestionFingerprints(
      mockSupabase,
      "set-1",
      new Set([normalizeForComparison("Brand new question?")]),
    );
    expect(questionQueries).toBe(2); // 1000 + 200
    expect(optionQueries).toBe(0);
    expect(acceptedQueries).toBe(0);
    expect(distinctRes.fingerprints).toEqual([]);

    // Case 2: One prompt matches past row 1,000 -> fetches options ONLY for that 1 matching UUID!
    const matchedRes = await fetchExistingQuestionFingerprints(
      mockSupabase,
      "set-1",
      new Set([normalizeForComparison("Existing question #1051")]),
    );
    expect(optionQueries).toBe(1);
    expect(acceptedQueries).toBe(1);
    expect(optionQueryIds).toEqual([[targetId]]);
    const expectedFp = computeQuestionDuplicateFingerprint({
      prompt: "Existing question #1051",
      options: [
        { content: "Opt A", isCorrect: true },
        { content: "Opt B", isCorrect: false },
      ],
    });
    expect(matchedRes.fingerprints).toEqual([expectedFp]);
    expect(matchedRes.fingerprintToIds.get(expectedFp)).toEqual([targetId]);
  });
});
