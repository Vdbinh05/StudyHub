import type {
  AnswerRule,
  ImportValidationIssue,
  ParsedQuestion,
} from "@/types/import";
import { parseEduQuizText } from "./eduquiz-parser";
import { generateStableId, normalizeText } from "./text-utils";
import { parseWordAnswerKeyText } from "./word-answer-key-parser";
import {
  hasPdfMagicBytes,
  ImportSecurityError,
  validateFileSize,
} from "./zip-guard";

export const MAX_PDF_PAGES = 500;
export const MAX_PDF_TEXT_CHARS = 5_000_000;

export interface PdfParserConfig {
  answerRule?: AnswerRule;
  defaultChapter?: string;
  defaultTags?: string[];
  /** Optional 1-based page range selector, e.g. "1-5, 8, 10-12" */
  pageRange?: string;
  /** Enable deterministic left-then-right two-column reading order */
  twoColumn?: boolean;
}

export interface PdfParseOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  ruleUsed: AnswerRule;
  isScannedPdf: boolean;
  pageCount: number;
  extractedPages: number;
  extractedTextPreview: string;
}

interface PdfTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

interface RawPdfTextItem {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  hasEOL?: unknown;
}

/**
 * Parse a 1-based page range expression such as `"1-3, 5, 7-9"` into a sorted,
 * deduplicated list of valid page indices within `[1..totalPages]`.
 */
export function parsePdfPageRange(
  rangeExpr: string | undefined,
  totalPages: number,
): number[] {
  const safeTotal = Math.min(Math.max(0, totalPages), MAX_PDF_PAGES);
  if (safeTotal === 0) return [];
  if (!rangeExpr || !rangeExpr.trim()) {
    return Array.from({ length: safeTotal }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  const parts = rangeExpr.split(/[,;]+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const rangeMatch = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(trimmed);
    if (rangeMatch) {
      const start = Math.max(1, Number.parseInt(rangeMatch[1], 10));
      const end = Math.min(safeTotal, Number.parseInt(rangeMatch[2], 10));
      if (start <= end) {
        for (let p = start; p <= end; p += 1) {
          pages.add(p);
        }
      }
      continue;
    }
    const singleMatch = /^(\d+)$/.exec(trimmed);
    if (singleMatch) {
      const num = Number.parseInt(singleMatch[1], 10);
      if (num >= 1 && num <= safeTotal) {
        pages.add(num);
      }
    }
  }

  if (pages.size === 0) {
    return Array.from({ length: safeTotal }, (_, i) => i + 1);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function reconstructLinesFromRuns(runs: PdfTextRun[]): string[] {
  if (runs.length === 0) return [];

  // Sort top-to-bottom (higher Y first in PDF coordinate space), then left-to-right
  const sorted = [...runs].sort((a, b) => {
    const yDiff = b.y - a.y;
    const yTol = Math.max(3, Math.min(a.height, b.height) * 0.45);
    if (Math.abs(yDiff) > yTol) return yDiff;
    return a.x - b.x;
  });

  const lineBuckets: Array<{ anchorY: number; fontSize: number; items: PdfTextRun[] }> = [];

  for (const run of sorted) {
    const last = lineBuckets[lineBuckets.length - 1];
    const tol = Math.max(3, Math.max(run.height, last?.fontSize ?? 10) * 0.45);
    if (last && Math.abs(last.anchorY - run.y) <= tol) {
      last.items.push(run);
    } else {
      lineBuckets.push({
        anchorY: run.y,
        fontSize: run.height || 10,
        items: [run],
      });
    }
  }

  const lines: string[] = [];
  for (const bucket of lineBuckets) {
    bucket.items.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEndX = -Infinity;
    let prevHeight = bucket.fontSize;

    for (const item of bucket.items) {
      const str = item.str;
      if (!str) continue;
      if (line.length > 0 && prevEndX > -Infinity) {
        const gap = item.x - prevEndX;
        const spaceThreshold = Math.max(1.5, Math.min(prevHeight, item.height || prevHeight) * 0.18);
        if (gap > spaceThreshold && !line.endsWith(" ") && !str.startsWith(" ")) {
          line += " ";
        }
      }
      line += str;
      prevEndX = item.x + Math.max(0, item.width);
      if (item.height > 0) prevHeight = item.height;
    }

    const cleaned = normalizeText(line).trim();
    if (cleaned.length > 0) {
      lines.push(cleaned);
    }
  }

  return lines;
}

function reconstructPageLines(
  runs: PdfTextRun[],
  pageWidth: number,
  twoColumn: boolean,
): string[] {
  if (!twoColumn || runs.length === 0 || pageWidth <= 0) {
    return reconstructLinesFromRuns(runs);
  }

  const midX = pageWidth / 2;
  const fullWidthTop: PdfTextRun[] = [];
  const leftCol: PdfTextRun[] = [];
  const rightCol: PdfTextRun[] = [];

  for (const run of runs) {
    const center = run.x + run.width / 2;
    const spansAcrossMid =
      run.x < midX - 24 && run.x + run.width > midX + 24 && run.width > pageWidth * 0.45;
    if (spansAcrossMid) {
      fullWidthTop.push(run);
    } else if (center < midX) {
      leftCol.push(run);
    } else {
      rightCol.push(run);
    }
  }

  // If right column has almost no content, fall back to single-column reading order
  if (rightCol.length < 3 || leftCol.length < 3) {
    return reconstructLinesFromRuns(runs);
  }

  return [
    ...reconstructLinesFromRuns(fullWidthTop),
    ...reconstructLinesFromRuns(leftCol),
    ...reconstructLinesFromRuns(rightCol),
  ];
}

function normalizeHeaderFooterPattern(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ");
}

function isStandalonePageNumberLine(line: string): boolean {
  return /^(?:(?:page|trang|p\.)\s*\d+(?:\s*(?:\/|of|trên)\s*\d+)?|[-–—]?\s*\d{1,4}\s*[-–—]?)$/i.test(
    line.trim(),
  );
}

function isProtectedContentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(?:Câu|Cau|Question|Q)\s*\d+/i.test(trimmed) ||
    /^\*?\s*(?:\([A-Ha-h]\)|[A-Ha-h]\s*[.)\]:\-])/.test(trimmed) ||
    /^(?:ANSWER|ANS|ĐÁP\s*ÁN|DAP\s*AN|KEY)\b/i.test(trimmed)
  );
}

function stripRepeatingHeadersAndFooters(pageLines: string[][]): string[][] {
  if (pageLines.length < 2) return pageLines;

  // Count repeating top/bottom edge patterns across >= 3 pages
  const repeatedEdgePatterns = new Set<string>();
  if (pageLines.length >= 3) {
    const patternCounts = new Map<string, number>();
    for (const lines of pageLines) {
      const edgeCandidates = new Set<string>();
      for (const idx of [0, 1, lines.length - 2, lines.length - 1]) {
        const l = lines[idx];
        if (!l || isProtectedContentLine(l)) continue;
        edgeCandidates.add(normalizeHeaderFooterPattern(l));
      }
      for (const pat of edgeCandidates) {
        patternCounts.set(pat, (patternCounts.get(pat) ?? 0) + 1);
      }
    }
    const threshold = Math.ceil(pageLines.length * 0.6);
    for (const [pat, count] of patternCounts.entries()) {
      if (count >= threshold && pat.length <= 120) {
        repeatedEdgePatterns.add(pat);
      }
    }
  }

  return pageLines.map((lines) => {
    const result: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isEdge = i <= 1 || i >= lines.length - 2;
      if (isEdge && !isProtectedContentLine(line)) {
        if (isStandalonePageNumberLine(line)) continue;
        if (repeatedEdgePatterns.has(normalizeHeaderFooterPattern(line))) continue;
      }
      result.push(line);
    }
    return result;
  });
}

/**
 * Deterministic, 100% non-AI selectable-text PDF importer using `pdfjs-dist` (legacy Node build).
 * Enforces strict PDF magic bytes, 15 MB cap, 500-page cap, disables eval/system fonts,
 * reconstructs reading order (single or 2-column), strips repeating headers/footers,
 * detects scanned/no-text-layer PDFs honestly, and delegates clean text to StudyHub's
 * deterministic question/answer-key parser.
 */
export async function parsePdfBuffer(
  bytes: Uint8Array,
  config: PdfParserConfig = {},
): Promise<PdfParseOutput> {
  validateFileSize(bytes.byteLength, false);

  if (!hasPdfMagicBytes(bytes)) {
    throw new ImportSecurityError(
      "INVALID_PDF",
      "Invalid PDF file header. Expected a valid %PDF- document.",
      400,
    );
  }

  const ruleUsed: AnswerRule = config.answerRule ?? { mode: "auto" };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Preload pdf.worker.mjs onto globalThis.pdfjsWorker (V3-PERF-01) so pdfjs-dist's
  // #mainThreadWorkerMessageHandler short-circuits cleanly under both Turbopack-bundled
  // and external Node Next.js production servers without relative "./pdf.worker.mjs" lookup failures.
  const globalWithPdfWorker = globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler?: unknown };
  };
  if (!globalWithPdfWorker.pdfjsWorker?.WorkerMessageHandler) {
    globalWithPdfWorker.pdfjsWorker = await import(
      "pdfjs-dist/legacy/build/pdf.worker.mjs"
    );
  }

  // Defense-in-depth (V3-SEC-05): explicitly disable eval/JIT, network auto-fetch, and system fonts.
  // Note: pdfjs-dist v6 removed eval/new Function support from DocumentInitParameters,
  // so `isEvalSupported: false` is passed via narrow type intersection for backward/forward safety.
  type SafePdfDocInit = Parameters<typeof pdfjs.getDocument>[0] & {
    isEvalSupported?: boolean;
  };
  const docInit: SafePdfDocInit = {
    // Pass an isolated copy because pdfjs may transfer/detach the underlying buffer
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableAutoFetch: true,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  };
  const loadingTask = pdfjs.getDocument(docInit);

  try {
    let pdfDoc: Awaited<typeof loadingTask.promise>;
    try {
      pdfDoc = await loadingTask.promise;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const message = err instanceof Error ? err.message : "";
      if (
        name === "PasswordException" ||
        /password|encrypted/i.test(message)
      ) {
        throw new ImportSecurityError(
          "ENCRYPTED_PDF",
          "Password-protected PDF files cannot be imported. Please remove the password and upload an unlocked PDF.",
          400,
        );
      }
      throw new ImportSecurityError(
        "INVALID_PDF",
        "Malformed or corrupted PDF file could not be read.",
        400,
      );
    }

    const totalPages = pdfDoc.numPages;
    const issues: ImportValidationIssue[] = [];

    if (totalPages > MAX_PDF_PAGES) {
      issues.push({
        id: generateStableId(),
        code: "INVALID_FORMAT",
        severity: "warning",
        message: `PDF has ${totalPages} pages; only the first ${MAX_PDF_PAGES} pages are processed for safety.`,
      });
    }

    const selectedPages = parsePdfPageRange(config.pageRange, totalPages);
    const rawPageLines: string[][] = [];
    let totalExtractedChars = 0;

    for (const pageNum of selectedPages) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();

      const runs: PdfTextRun[] = [];
      for (const rawItem of textContent.items as RawPdfTextItem[]) {
        if (typeof rawItem.str !== "string") continue;
        const textStr = rawItem.str;
        if (!textStr) continue;
        const transform = Array.isArray(rawItem.transform) ? rawItem.transform : [];
        const x = typeof transform[4] === "number" ? transform[4] : 0;
        const y = typeof transform[5] === "number" ? transform[5] : 0;
        const scaleY = typeof transform[3] === "number" ? Math.abs(transform[3]) : 0;
        const height =
          typeof rawItem.height === "number" && rawItem.height > 0
            ? rawItem.height
            : scaleY || 11;
        const width = typeof rawItem.width === "number" ? rawItem.width : 0;

        runs.push({
          str: textStr,
          x,
          y,
          width,
          height,
          hasEOL: Boolean(rawItem.hasEOL),
        });
      }

      const lines = reconstructPageLines(
        runs,
        viewport.width,
        Boolean(config.twoColumn),
      );
      const pageCharCount = lines.reduce(
        (sum, l) => sum + l.replace(/\s+/g, "").length,
        0,
      );
      totalExtractedChars += pageCharCount;
      rawPageLines.push(lines);

      if (totalExtractedChars > MAX_PDF_TEXT_CHARS) {
        issues.push({
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "warning",
          message:
            "PDF text exceeded 5,000,000 characters; remaining pages were truncated for safety.",
        });
        break;
      }
    }

    const cleanedPages = stripRepeatingHeadersAndFooters(rawPageLines);
    const fullText = cleanedPages
      .map((lines) => lines.join("\n"))
      .filter((block) => block.trim().length > 0)
      .join("\n");

    const nonWsTotal = fullText.replace(/\s+/g, "").length;
    const avgCharsPerPage =
      selectedPages.length > 0 ? nonWsTotal / selectedPages.length : 0;

    // Detect scanned / image-only PDFs with no usable selectable text layer
    if (nonWsTotal < 15 || (selectedPages.length > 0 && avgCharsPerPage < 10)) {
      issues.push({
        id: generateStableId(),
        code: "SCANNED_PDF_DETECTED",
        severity: "warning",
        message:
          "This PDF has no selectable text layer (it appears to be scanned or image-only). StudyHub uses 100% deterministic parsing with zero AI OCR — please export as selectable-text PDF or Word (.docx) before importing.",
      });
      return {
        questions: [],
        issues,
        ruleUsed,
        isScannedPdf: true,
        pageCount: totalPages,
        extractedPages: selectedPages.length,
        extractedTextPreview: "",
      };
    }

    // Parse deterministically using asterisk/inline/end-answer-key engines
    const hasAsteriskPattern =
      /^\s*\*\s*(?:\(?[A-Ha-h]\)|[A-Ha-h]\s*[.)\]:\-])/m.test(fullText);

    const parsed =
      ruleUsed.mode === "asterisk_prefix" ||
      (ruleUsed.mode === "auto" && hasAsteriskPattern)
        ? parseEduQuizText(fullText, {
            answerRule: ruleUsed,
            defaultChapter: config.defaultChapter,
            defaultTags: config.defaultTags,
            allowInlineAnswerLine: true,
          })
        : parseWordAnswerKeyText(fullText, {
            answerRule: ruleUsed,
            defaultChapter: config.defaultChapter,
            defaultTags: config.defaultTags,
          });

    return {
      questions: parsed.questions,
      issues: [...issues, ...parsed.issues],
      ruleUsed,
      isScannedPdf: false,
      pageCount: totalPages,
      extractedPages: selectedPages.length,
      extractedTextPreview: fullText.slice(0, 2000),
    };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // Ignore secondary cleanup error
    }
  }
}
