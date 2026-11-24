import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  chunkArray,
  ImportSecurityError,
  inspectRasterImageBytes,
  MAX_IMPORT_FILE_BYTES,
  parseImportInput,
} from "@/lib/import";
import { buildDocxFixture } from "../../fixtures/fixture-builders";

describe("Upload security guards (magic bytes, macros, ZIP bombs, XXE, SVG)", () => {
  it("rejects fake .docx magic bytes, .docm/.xlsm macro extensions, and vbaProject.bin inside .docx", async () => {
    // 1. Fake .docx (plain text pretending to be docx)
    const fakeDocx = new TextEncoder().encode("Not a zip file at all");
    await expect(
      parseImportInput({ fileBytes: fakeDocx, fileName: "fake.docx" }),
    ).rejects.toMatchObject({ code: "INVALID_MAGIC_BYTES" });

    // 2. Macro extensions rejected immediately
    await expect(
      parseImportInput({ fileBytes: fakeDocx, fileName: "evil.docm" }),
    ).rejects.toMatchObject({ code: "MACRO_FILE_REJECTED" });
    await expect(
      parseImportInput({ fileBytes: fakeDocx, fileName: "evil.xlsm" }),
    ).rejects.toMatchObject({ code: "MACRO_FILE_REJECTED" });

    // 3. Embedded vbaProject.bin inside .docx rejected
    const macroDocx = await buildDocxFixture({
      body: [{ type: "p", para: { runs: [{ text: "Câu 1: Test" }] } }],
      extraEntries: {
        "word/vbaProject.bin": new Uint8Array([0x01, 0x02, 0x03]),
      },
    });
    await expect(
      parseImportInput({ fileBytes: macroDocx, fileName: "macro.docx" }),
    ).rejects.toMatchObject({ code: "MACRO_PAYLOAD_DETECTED" });
  });

  it("rejects ZIP ratio bombs (>100:1), excessive ZIP entries (>500), ZIP Slip, and XXE DOCTYPE", async () => {
    // 1. Synthetic ZIP ratio bomb: 512 KB of repeated zeros compresses to ~600 bytes (> 800:1 ratio!)
    const bombZip = new JSZip();
    bombZip.file("word/document.xml", "<w:document><w:body/></w:document>");
    bombZip.file("word/bomb.txt", "0".repeat(512 * 1024));
    const bombBytes = await bombZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    await expect(
      parseImportInput({ fileBytes: bombBytes, fileName: "bomb.docx" }),
    ).rejects.toMatchObject({ code: "ZIP_RATIO_BOMB_DETECTED" });

    // 2. Excessive ZIP entry count (> 500 non-media entries)
    const manyZip = new JSZip();
    manyZip.file("word/document.xml", "<w:document><w:body/></w:document>");
    for (let i = 0; i < 505; i += 1) {
      manyZip.file(`word/junk_${i}.txt`, "x");
    }
    const manyBytes = await manyZip.generateAsync({ type: "uint8array" });
    await expect(
      parseImportInput({ fileBytes: manyBytes, fileName: "many.docx" }),
    ).rejects.toMatchObject({ code: "ZIP_ENTRY_LIMIT_EXCEEDED" });

    // 3. ZIP Slip path traversal
    const slipZip = new JSZip();
    slipZip.file("word/document.xml", "<w:document><w:body/></w:document>");
    slipZip.file("../../etc/passwd", "root:x:0:0");
    const slipBytes = await slipZip.generateAsync({ type: "uint8array" });
    await expect(
      parseImportInput({ fileBytes: slipBytes, fileName: "slip.docx" }),
    ).rejects.toMatchObject({ code: "ZIP_SLIP_DETECTED" });

    // 4. XXE DOCTYPE/ENTITY injection in word/document.xml
    const xxeDocx = await buildDocxFixture({
      body: [],
      rawDocumentXmlOverride: `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body></w:document>`,
    });
    await expect(
      parseImportInput({ fileBytes: xxeDocx, fileName: "xxe.docx" }),
    ).rejects.toMatchObject({ code: "XXE_FORBIDDEN" });
  });

  it("rejects files exceeding 15 MB, binary NUL in text files, and SVG image uploads", async () => {
    // 1. Oversized file (> 15 MB)
    const oversized = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    await expect(
      parseImportInput({ fileBytes: oversized, fileName: "huge.txt" }),
    ).rejects.toThrow(ImportSecurityError);

    // 2. Binary NUL byte in .txt file
    const nulText = new Uint8Array([0x41, 0x00, 0x42]);
    await expect(
      parseImportInput({ fileBytes: nulText, fileName: "binary.txt" }),
    ).rejects.toMatchObject({ code: "BINARY_CONTENT_IN_TEXT" });

    // 3. SVG image rejected even if MIME is omitted or spoofed
    const svgBytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    expect(inspectRasterImageBytes(svgBytes, "image/svg+xml").valid).toBe(false);
    expect(inspectRasterImageBytes(svgBytes, "image/png").valid).toBe(false);
  });
});

describe("Large-scale deterministic stress benchmarks (600 & 10,000 questions)", () => {
  function generateEduQuizBatch(count: number): string {
    const blocks: string[] = [];
    const letters = ["A", "B", "C", "D"];
    for (let i = 1; i <= count; i += 1) {
      if ((i - 1) % 200 === 0) {
        blocks.push(`Chương ${Math.floor((i - 1) / 200) + 1}: Chủ đề tổng hợp`);
      }
      const correctIdx = (i - 1) % 4;
      blocks.push(`Câu ${i}: Câu hỏi kiểm tra hiệu năng số ${i} về thuật toán & cơ sở dữ liệu?`);
      for (let o = 0; o < 4; o += 1) {
        const prefix = o === correctIdx ? "*" : "";
        blocks.push(`${prefix}${letters[o]}. Phương án ${letters[o]} cho câu ${i}`);
      }
    }
    return blocks.join("\n");
  }

  it("parses and validates 600 questions in < 500ms with 100% accuracy and 0 drops", async () => {
    const text = generateEduQuizBatch(600);
    const start = performance.now();
    const result = await parseImportInput({
      rawText: text,
      fileName: "batch-600.txt",
    });
    const elapsedMs = performance.now() - start;

    expect(result.questions).toHaveLength(600);
    expect(result.summary.validCount).toBe(600);
    expect(result.summary.errorCount).toBe(0);
    expect(result.detectedChapters).toHaveLength(3);
    expect(elapsedMs).toBeLessThan(500);

    // Spot-check answer accuracy across all 600 questions
    const letters = ["A", "B", "C", "D"];
    for (let i = 0; i < 600; i += 1) {
      const correct = result.questions[i].options.filter((o) => o.isCorrect);
      expect(correct).toHaveLength(1);
      expect(correct[0].label).toBe(letters[i % 4]);
    }
  });

  it("parses and validates 10,000 questions in < 5,000ms and chunks cleanly into 20 x 500 batches", async () => {
    const text = generateEduQuizBatch(10_000);
    const start = performance.now();
    const result = await parseImportInput({
      rawText: text,
      fileName: "stress-10000.txt",
    });
    const elapsedMs = performance.now() - start;

    expect(result.questions).toHaveLength(10_000);
    expect(result.summary.validCount).toBe(10_000);
    expect(result.summary.errorCount).toBe(0);
    expect(result.detectedChapters).toHaveLength(50);
    expect(elapsedMs).toBeLessThan(5_000);

    const chunks = chunkArray(result.questions, 500);
    expect(chunks).toHaveLength(20);
    expect(chunks.every((c) => c.length === 500)).toBe(true);
  });
});
