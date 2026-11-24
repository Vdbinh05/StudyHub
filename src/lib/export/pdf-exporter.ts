import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { richTextToPlainText } from "@/lib/richtext";
import type { Locale, QuestionType } from "@/types/domain";
import type { QuestionTypePayload, RichTextDoc } from "@/types/v3";

export type PdfExportMode =
  | "question_paper"
  | "paper_and_key"
  | "paper_with_explanations"
  | "incorrect_review"
  | "flashcard_sheets";

export type PdfOrientation = "portrait" | "landscape";

export interface PdfEmbeddedImage {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  alt?: string;
}

export interface PdfExportOption {
  id: string;
  label: string;
  content: string;
  contentRich?: RichTextDoc | null;
  isCorrect: boolean;
  image?: PdfEmbeddedImage | null;
}

export interface PdfExportQuestion {
  id: string;
  questionType: QuestionType;
  chapter?: string | null;
  prompt: string;
  promptRich?: RichTextDoc | null;
  backText?: string | null;
  backRich?: RichTextDoc | null;
  explanation?: string | null;
  explanationRich?: RichTextDoc | null;
  hint?: string | null;
  passageId?: string | null;
  passageTitle?: string | null;
  passageContent?: string | null;
  audioTranscript?: string | null;
  typePayload?: QuestionTypePayload | null;
  options: PdfExportOption[];
  acceptedAnswers?: string[];
  promptImages?: PdfEmbeddedImage[];
  /** Optional learner response summary (used in `incorrect_review` mode) */
  userResponseText?: string | null;
  wasCorrect?: boolean | null;
}

export interface PdfExportOptions {
  mode: PdfExportMode;
  locale?: Locale;
  orientation?: PdfOrientation;
  title: string;
  subject?: string;
  examCode?: string;
  includeStudentInfo?: boolean;
  headerText?: string;
  footerText?: string;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  shuffleSeed?: string;
  fontSize?: number;
  grayscale?: boolean;
  includeAudioTranscript?: boolean;
}

export interface PdfAnswerKeyEntry {
  questionNumber: number;
  questionId: string;
  answerText: string;
  correctLabels: string[];
}

export interface PdfExportResult {
  bytes: Uint8Array;
  pageCount: number;
  questionCount: number;
  answerKey: PdfAnswerKeyEntry[];
  seedUsed?: string;
}

// Cached bundled NotoSans OFL Vietnamese TTF font bytes
let cachedRegularFontBytes: Uint8Array | null = null;
let cachedBoldFontBytes: Uint8Array | null = null;

function loadBundledFonts(): { regular: Uint8Array; bold: Uint8Array } {
  if (!cachedRegularFontBytes || !cachedBoldFontBytes) {
    const fontsDir = path.resolve(process.cwd(), "src/assets/fonts");
    const regBuf = fs.readFileSync(path.join(fontsDir, "NotoSans-Regular.ttf"));
    const boldBuf = fs.readFileSync(path.join(fontsDir, "NotoSans-Bold.ttf"));
    // Always wrap into clean Uint8Array for Node/jsdom cross-realm safety
    cachedRegularFontBytes = new Uint8Array(
      regBuf.buffer,
      regBuf.byteOffset,
      regBuf.byteLength,
    ).slice();
    cachedBoldFontBytes = new Uint8Array(
      boldBuf.buffer,
      boldBuf.byteOffset,
      boldBuf.byteLength,
    ).slice();
  }
  return { regular: cachedRegularFontBytes, bold: cachedBoldFontBytes };
}

/**
 * Deterministic PRNG (Mulberry32 seeded from SHA-256 of `seed`) for reproducible
 * question/option shuffling and 100% matching post-shuffle answer keys.
 */
function createSeededRng(seed: string): () => number {
  const hash = crypto.createHash("sha256").update(seed).digest();
  let state = hash.readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const LATEX_TO_UNICODE_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)"],
  [/\\sqrt\{([^{}]+)\}/g, "√($1)"],
  [/\\text\{([^{}]+)\}/g, "$1"],
  [/\^\{\\circ\}/g, "°"],
  [/\\circ/g, "°"],
  [/\\pm/g, "±"],
  [/\\times/g, "×"],
  [/\\div/g, "÷"],
  [/\\cdot/g, "·"],
  [/\\le(?:q)?\b/g, "≤"],
  [/\\ge(?:q)?\b/g, "≥"],
  [/\\ne(?:q)?\b/g, "≠"],
  [/\\approx\b/g, "≈"],
  [/\\infty\b/g, "∞"],
  [/\\rightarrow|\\to\b/g, "→"],
  [/\\leftarrow\b/g, "←"],
  [/\\rightleftharpoons\b/g, "⇌"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\gamma\b/g, "γ"],
  [/\\Delta\b/g, "Δ"],
  [/\\delta\b/g, "δ"],
  [/\\theta\b/g, "θ"],
  [/\\lambda\b/g, "λ"],
  [/\\mu\b/g, "μ"],
  [/\\pi\b/g, "π"],
  [/\\rho\b/g, "ρ"],
  [/\\sigma\b/g, "σ"],
  [/\\Omega\b/g, "Ω"],
  [/\\sum\b/g, "∑"],
  [/\\int\b/g, "∫"],
  [/\^2\b|\^\{2\}/g, "²"],
  [/\^3\b|\^\{3\}/g, "³"],
];

function formatAcademicTextForPdf(
  richDoc: RichTextDoc | null | undefined,
  plainText: string | null | undefined,
): string {
  let text = richTextToPlainText(richDoc, plainText).replace(/\r\n?/g, "\n");
  // Convert inline/block LaTeX tokens into crisp readable Unicode math expressions
  text = text.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/g, (_full, block, inline) => {
    let expr = String(block ?? inline ?? "").trim();
    for (const [re, rep] of LATEX_TO_UNICODE_REPLACEMENTS) {
      expr = expr.replace(re, rep);
    }
    return expr.replace(/\\([a-zA-Z]+)/g, "$1").replace(/[{}]/g, "");
  });
  return text.normalize("NFC");
}

/**
 * Strips any control characters or glyphs outside the embedded font's glyph table
 * so `pdf-lib` never crashes on unsupported emojis or exotic Unicode symbols.
 */
function sanitizeForFont(text: string, font: PDFFont): string {
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFEFF]/g, "");
  try {
    font.encodeText(cleaned);
    return cleaned;
  } catch {
    let safe = "";
    for (const ch of cleaned) {
      if (ch === "\n") {
        safe += ch;
        continue;
      }
      try {
        font.encodeText(ch);
        safe += ch;
      } catch {
        safe += " ";
      }
    }
    return safe;
  }
}

function wrapTextLines(
  rawText: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const safeText = sanitizeForFont(rawText, font);
  const paragraphs = safeText.split("\n");
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }

    const words = para.split(/\s+/);
    let currentLine = "";

    for (const word of words) {
      if (!word) continue;
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        // Break overly long unbroken tokens (URLs / long formulas) cleanly by character
        if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
          currentLine = word;
        } else {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) <= maxWidth) {
              chunk += ch;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function computeAnswerSummary(
  q: PdfExportQuestion,
  isVi: boolean,
): { answerText: string; correctLabels: string[] } {
  const choiceTypes = new Set<QuestionType>([
    "single_choice",
    "multiple_choice",
    "true_false",
    "image_choice",
  ]);

  if (
    choiceTypes.has(q.questionType) ||
    ((q.questionType === "reading_passage" || q.questionType === "listening") &&
      q.options.length > 0)
  ) {
    const correctLabels = q.options.filter((o) => o.isCorrect).map((o) => o.label);
    return {
      answerText: correctLabels.length > 0 ? correctLabels.join(", ") : "—",
      correctLabels,
    };
  }

  if (q.questionType === "fill_in_blank" && q.typePayload?.type === "fill_in_blank") {
    const parts = q.typePayload.blanks.map(
      (b, idx) => `(${idx + 1}) ${b.accepted_answers[0] ?? "—"}`,
    );
    return { answerText: parts.join("; "), correctLabels: [] };
  }

  if (q.questionType === "numerical" && q.typePayload?.type === "numerical") {
    const unit = q.typePayload.unit ? ` ${q.typePayload.unit}` : "";
    const tol =
      typeof q.typePayload.abs_tolerance === "number" &&
      q.typePayload.abs_tolerance > 0
        ? ` (±${q.typePayload.abs_tolerance})`
        : "";
    return {
      answerText: `${q.typePayload.correct_value}${unit}${tol}`,
      correctLabels: [],
    };
  }

  if (q.questionType === "ordering" && q.typePayload?.type === "ordering") {
    const ordered = [...q.typePayload.items]
      .sort((a, b) => a.correct_position - b.correct_position)
      .map((item, idx) => `${idx + 1}. ${item.text}`);
    return { answerText: ordered.join(" → "), correctLabels: [] };
  }

  if (q.questionType === "matching" && q.typePayload?.type === "matching") {
    const pairs = q.typePayload.pairs.map(
      (p, idx) => `${idx + 1}-${p.right_text}`,
    );
    return { answerText: pairs.join("; "), correctLabels: [] };
  }

  if (q.questionType === "image_hotspot" && q.typePayload?.type === "image_hotspot") {
    const labels = q.typePayload.target_hotspots.map((h) => h.label).filter(Boolean);
    return {
      answerText: labels.length > 0 ? labels.join(", ") : isVi ? "(Điểm nóng trên hình)" : "(Image hotspot)",
      correctLabels: [],
    };
  }

  if (q.questionType === "flashcard") {
    const back = formatAcademicTextForPdf(q.backRich, q.backText);
    return { answerText: back || "—", correctLabels: [] };
  }

  const accepted = (q.acceptedAnswers ?? []).filter(Boolean);
  if (accepted.length > 0) {
    return { answerText: accepted.join(" / "), correctLabels: [] };
  }

  const fallbackBack = formatAcademicTextForPdf(q.backRich, q.backText);
  return { answerText: fallbackBack || "—", correctLabels: [] };
}

interface Palette {
  text: RGB;
  muted: RGB;
  primary: RGB;
  success: RGB;
  danger: RGB;
  border: RGB;
  surface: RGB;
}

function getPalette(grayscale: boolean): Palette {
  if (grayscale) {
    return {
      text: rgb(0.08, 0.09, 0.11),
      muted: rgb(0.36, 0.39, 0.44),
      primary: rgb(0.12, 0.14, 0.18),
      success: rgb(0.12, 0.14, 0.18),
      danger: rgb(0.22, 0.24, 0.28),
      border: rgb(0.75, 0.77, 0.8),
      surface: rgb(0.95, 0.96, 0.97),
    };
  }
  return {
    text: rgb(0.08, 0.1, 0.16),
    muted: rgb(0.38, 0.43, 0.51),
    primary: rgb(0.26, 0.28, 0.78), // Academic Indigo
    success: rgb(0.09, 0.5, 0.26), // Crisp Green
    danger: rgb(0.73, 0.14, 0.16), // Crisp Red
    border: rgb(0.81, 0.84, 0.89),
    surface: rgb(0.96, 0.97, 0.99),
  };
}

/**
 * Generates a print-ready, deterministic A4 Vietnamese/English PDF with bundled NotoSans
 * fonts, zero AI dependencies, safe image embedding, and 100% accurate post-shuffle answer keys.
 */
export async function exportStudySetToPdf(
  questionsInput: readonly PdfExportQuestion[],
  options: PdfExportOptions,
): Promise<PdfExportResult> {
  const isVi = (options.locale ?? "vi") === "vi";
  const orientation: PdfOrientation = options.orientation ?? "portrait";
  const pageWidth = orientation === "landscape" ? 841.89 : 595.28;
  const pageHeight = orientation === "landscape" ? 595.28 : 841.89;
  const marginX = 44;
  const marginTop = 52;
  const marginBottom = 48;
  const contentWidth = pageWidth - marginX * 2;
  const fontSize = Math.min(14, Math.max(9, options.fontSize ?? 10.5));
  const lineHeight = fontSize * 1.42;
  const palette = getPalette(options.grayscale ?? true);

  // Filter for incorrect_review mode if `wasCorrect` metadata is present
  let workingQuestions =
    options.mode === "incorrect_review" &&
    questionsInput.some((q) => q.wasCorrect === false)
      ? questionsInput.filter((q) => q.wasCorrect === false)
      : questionsInput.slice();

  // Deterministic shuffle with reproducible seed
  const seedUsed =
    options.shuffleQuestions || options.shuffleOptions
      ? (options.shuffleSeed ?? crypto.randomBytes(6).toString("hex"))
      : undefined;
  const rng = seedUsed ? createSeededRng(seedUsed) : null;

  if (options.shuffleQuestions && rng) {
    workingQuestions = deterministicShuffle(workingQuestions, rng);
  }

  // Shuffle options per question & deterministically relabel A, B, C, D...
  const preparedQuestions: PdfExportQuestion[] = workingQuestions.map((q) => {
    const shouldShuffleOpts =
      Boolean(options.shuffleOptions && rng) &&
      q.options.length > 1 &&
      q.questionType !== "true_false";
    const orderedOpts =
      shouldShuffleOpts && rng ? deterministicShuffle(q.options, rng) : q.options;
    return {
      ...q,
      options: orderedOpts.map((opt, idx) => ({
        ...opt,
        label: String.fromCharCode(65 + idx),
      })),
    };
  });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  pdfDoc.setTitle(options.title || "StudyHub Export");
  pdfDoc.setCreator("StudyHub V3.0 Deterministic PDF Exporter");

  const { regular: regularBytes, bold: boldBytes } = loadBundledFonts();
  // Disable OpenType `ccmp` / `liga` GSUB decomposition so precomposed NFC Vietnamese
  // glyphs (`ọ`, `ệ`, `ư`, `ă`, `đ`, etc.) preserve exact visual glyphs AND 100% accurate ToUnicode CMap!
  const fontRegular = await pdfDoc.embedFont(regularBytes, {
    features: { ccmp: false, liga: false },
  });
  const fontBold = await pdfDoc.embedFont(boldBytes, {
    features: { ccmp: false, liga: false },
  });

  const pages: PDFPage[] = [];
  let page: PDFPage = pdfDoc.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let cursorY = pageHeight - marginTop;

  const startNewPage = (): void => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    pages.push(page);
    cursorY = pageHeight - marginTop;
  };

  const ensureSpace = (neededHeight: number): void => {
    if (cursorY - neededHeight < marginBottom) {
      startNewPage();
    }
  };

  const drawWrapped = (
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: RGB;
      indent?: number;
      maxW?: number;
      lineGap?: number;
    } = {},
  ): void => {
    const f = opts.font ?? fontRegular;
    const sz = opts.size ?? fontSize;
    const col = opts.color ?? palette.text;
    const indent = opts.indent ?? 0;
    const maxW = opts.maxW ?? contentWidth - indent;
    const lh = opts.lineGap ?? sz * 1.4;
    const lines = wrapTextLines(text, f, sz, maxW);

    for (const line of lines) {
      ensureSpace(lh);
      if (line.length > 0) {
        page.drawText(line, {
          x: marginX + indent,
          y: cursorY - sz,
          size: sz,
          font: f,
          color: col,
        });
      }
      cursorY -= lh;
    }
  };

  const embedImageSafe = async (
    img: PdfEmbeddedImage,
  ): Promise<PDFImage | null> => {
    try {
      const safeBytes = new Uint8Array(
        img.bytes.buffer,
        img.bytes.byteOffset,
        img.bytes.byteLength,
      );
      if (img.mimeType === "image/png") {
        return await pdfDoc.embedPng(safeBytes);
      }
      return await pdfDoc.embedJpg(safeBytes);
    } catch {
      return null;
    }
  };

  const drawEmbeddedImage = async (
    img: PdfEmbeddedImage,
    indent: number,
    maxW: number,
    maxH: number,
  ): Promise<void> => {
    const embedded = await embedImageSafe(img);
    if (!embedded) return;
    const dims = embedded.scale(1);
    const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
    const drawW = dims.width * scale;
    const drawH = dims.height * scale;

    ensureSpace(drawH + 10);
    page.drawImage(embedded, {
      x: marginX + indent,
      y: cursorY - drawH - 2,
      width: drawW,
      height: drawH,
    });
    cursorY -= drawH + 8;
  };

  // --- Title Header Banner ---
  const titleText = sanitizeForFont(options.title || "StudyHub", fontBold);
  drawWrapped(titleText, {
    font: fontBold,
    size: fontSize + 5,
    color: palette.primary,
    lineGap: (fontSize + 5) * 1.3,
  });

  const subtitleParts: string[] = [];
  if (options.subject?.trim()) subtitleParts.push(options.subject.trim());
  const modeLabels: Record<PdfExportMode, { vi: string; en: string }> = {
    question_paper: { vi: "Đề thi / Phiếu bài tập", en: "Question Paper" },
    paper_and_key: { vi: "Đề thi + Bảng đáp án", en: "Question Paper & Answer Key" },
    paper_with_explanations: {
      vi: "Đề thi kèm đáp án & giải thích",
      en: "Paper with Answers & Explanations",
    },
    incorrect_review: { vi: "Phiếu ôn tập câu làm sai", en: "Incorrect Questions Review" },
    flashcard_sheets: { vi: "Phiếu thẻ ghi nhớ (Flashcards)", en: "Printable Flashcard Sheets" },
  };
  subtitleParts.push(isVi ? modeLabels[options.mode].vi : modeLabels[options.mode].en);
  subtitleParts.push(
    isVi
      ? `${preparedQuestions.length} câu hỏi`
      : `${preparedQuestions.length} questions`,
  );
  if (options.examCode?.trim()) {
    subtitleParts.push(
      isVi ? `Mã đề: ${options.examCode.trim()}` : `Exam Code: ${options.examCode.trim()}`,
    );
  }
  drawWrapped(subtitleParts.join("  •  "), {
    font: fontRegular,
    size: fontSize - 1,
    color: palette.muted,
  });

  // Student info header box
  if (options.includeStudentInfo && options.mode !== "flashcard_sheets") {
    cursorY -= 4;
    const boxH = 42;
    ensureSpace(boxH + 8);
    page.drawRectangle({
      x: marginX,
      y: cursorY - boxH,
      width: contentWidth,
      height: boxH,
      borderColor: palette.border,
      borderWidth: 0.75,
      color: palette.surface,
    });
    const infoSize = Math.max(8.5, fontSize - 1);
    page.drawText(
      sanitizeForFont(
        isVi
          ? "Họ và tên: ......................................................   Lớp / Mã SV: .............................."
          : "Full Name: .....................................................   ID / Class: .................................",
        fontRegular,
      ),
      {
        x: marginX + 10,
        y: cursorY - 16,
        size: infoSize,
        font: fontRegular,
        color: palette.text,
      },
    );
    page.drawText(
      sanitizeForFont(
        isVi
          ? "Ngày: ....../....../20......   Thời gian: ............ phút   Điểm: ............"
          : "Date: ....../....../20......   Duration: ............ min   Score: ............",
        fontRegular,
      ),
      {
        x: marginX + 10,
        y: cursorY - 33,
        size: infoSize,
        font: fontRegular,
        color: palette.text,
      },
    );
    cursorY -= boxH + 10;
  } else {
    cursorY -= 6;
    page.drawLine({
      start: { x: marginX, y: cursorY },
      end: { x: pageWidth - marginX, y: cursorY },
      thickness: 0.75,
      color: palette.border,
    });
    cursorY -= 12;
  }

  // --- Mode 5: Printable Flashcard Sheets (2-column grid) ---
  const answerKey: PdfAnswerKeyEntry[] = [];

  if (options.mode === "flashcard_sheets") {
    const gap = 14;
    const colW = (contentWidth - gap) / 2;
    const cardPadding = 10;
    const innerW = colW - cardPadding * 2;
    const cardFontSize = Math.max(9, fontSize - 0.5);
    const cardLH = cardFontSize * 1.35;

    for (let i = 0; i < preparedQuestions.length; i += 2) {
      const pair = preparedQuestions.slice(i, i + 2);
      const renderedCards = pair.map((q, idx) => {
        const qNum = i + idx + 1;
        const frontText = formatAcademicTextForPdf(q.promptRich, q.prompt);
        const ans = computeAnswerSummary(q, isVi);
        const backText =
          q.questionType === "flashcard"
            ? formatAcademicTextForPdf(q.backRich, q.backText) || ans.answerText
            : ans.answerText;
        answerKey.push({
          questionNumber: qNum,
          questionId: q.id,
          answerText: backText,
          correctLabels: ans.correctLabels,
        });

        const frontLines = wrapTextLines(frontText, fontBold, cardFontSize, innerW).slice(0, 6);
        const backLines = wrapTextLines(backText, fontRegular, cardFontSize, innerW).slice(0, 6);
        const height =
          cardPadding * 2 +
          14 +
          frontLines.length * cardLH +
          10 +
          backLines.length * cardLH +
          8;
        return { qNum, frontLines, backLines, height: Math.max(96, height) };
      });

      const rowH = Math.max(...renderedCards.map((c) => c.height));
      ensureSpace(rowH + 10);

      renderedCards.forEach((card, colIdx) => {
        const x = marginX + colIdx * (colW + gap);
        const topY = cursorY;

        page.drawRectangle({
          x,
          y: topY - rowH,
          width: colW,
          height: rowH,
          borderColor: palette.border,
          borderWidth: 0.75,
          borderDashArray: [3, 2],
        });

        let y = topY - cardPadding;
        page.drawText(
          sanitizeForFont(
            isVi ? `Thẻ #${card.qNum} — Mặt trước` : `Card #${card.qNum} — Front`,
            fontBold,
          ),
          {
            x: x + cardPadding,
            y: y - 8,
            size: 8,
            font: fontBold,
            color: palette.muted,
          },
        );
        y -= 14;

        for (const line of card.frontLines) {
          page.drawText(line, {
            x: x + cardPadding,
            y: y - cardFontSize,
            size: cardFontSize,
            font: fontBold,
            color: palette.text,
          });
          y -= cardLH;
        }

        y -= 4;
        page.drawLine({
          start: { x: x + cardPadding, y },
          end: { x: x + colW - cardPadding, y },
          thickness: 0.5,
          color: palette.border,
        });
        y -= 8;

        for (const line of card.backLines) {
          page.drawText(line, {
            x: x + cardPadding,
            y: y - cardFontSize,
            size: cardFontSize,
            font: fontRegular,
            color: palette.muted,
          });
          y -= cardLH;
        }
      });

      cursorY -= rowH + 10;
    }
  } else {
    // --- Standard Paper / Explanations / Incorrect Review Modes ---
    const renderedPassageIds = new Set<string>();
    const showInlineAnswers =
      options.mode === "paper_with_explanations" ||
      options.mode === "incorrect_review";

    for (let idx = 0; idx < preparedQuestions.length; idx += 1) {
      const q = preparedQuestions[idx];
      const qNum = idx + 1;
      const ans = computeAnswerSummary(q, isVi);
      answerKey.push({
        questionNumber: qNum,
        questionId: q.id,
        answerText: ans.answerText,
        correctLabels: ans.correctLabels,
      });

      // Render shared reading passage once before its first referencing question
      const passageBody =
        q.passageContent ??
        (q.typePayload?.type === "reading_passage" ? q.typePayload.passage_text : null);
      const passageKey = q.passageId ?? (passageBody ? `inline-${q.id}` : null);
      if (passageBody && passageKey && !renderedPassageIds.has(passageKey)) {
        renderedPassageIds.add(passageKey);
        const passageTitle =
          q.passageTitle ??
          (q.typePayload?.type === "reading_passage" ? q.typePayload.passage_title : null) ??
          (isVi ? "Đoạn văn đọc hiểu" : "Reading Passage");
        const passageLines = wrapTextLines(
          passageBody,
          fontRegular,
          fontSize - 0.5,
          contentWidth - 20,
        );
        const boxHeight = Math.min(
          pageHeight - marginTop - marginBottom - 20,
          24 + passageLines.length * (fontSize * 1.35) + 10,
        );
        ensureSpace(Math.min(boxHeight, 120));
        drawWrapped(`[${passageTitle}]`, {
          font: fontBold,
          size: fontSize,
          color: palette.primary,
        });
        drawWrapped(passageBody, {
          font: fontRegular,
          size: fontSize - 0.5,
          indent: 10,
          color: palette.text,
        });
        cursorY -= 6;
      }

      // Prevent orphaned question header at bottom of page
      ensureSpace(lineHeight * 3.5);

      const promptText = formatAcademicTextForPdf(q.promptRich, q.prompt);
      const chapterTag = q.chapter ? ` [${q.chapter}]` : "";
      const prefix = isVi ? `Câu ${qNum}: ` : `Q${qNum}. `;
      drawWrapped(`${prefix}${promptText}${chapterTag}`, {
        font: fontBold,
        size: fontSize,
        color: palette.text,
      });

      // Honest audio-on-paper disclosure for listening questions
      if (q.questionType === "listening") {
        drawWrapped(
          isVi
            ? "[Lưu ý: Câu hỏi Nghe hiểu — âm thanh không thể phát trên bản in giấy.]"
            : "[Notice: Listening question — audio cannot be played on printed paper.]",
          {
            font: fontRegular,
            size: fontSize - 1,
            indent: 12,
            color: palette.muted,
          },
        );
        const transcript =
          q.audioTranscript ??
          (q.typePayload?.type === "listening" ? q.typePayload.transcript : null);
        if (options.includeAudioTranscript && transcript?.trim()) {
          drawWrapped(
            `${isVi ? "Bản chép lời" : "Transcript"}: ${transcript.trim()}`,
            {
              font: fontRegular,
              size: fontSize - 1,
              indent: 12,
              color: palette.muted,
            },
          );
        }
      }

      // Prompt embedded raster images
      for (const img of q.promptImages ?? []) {
        await drawEmbeddedImage(img, 12, Math.min(contentWidth - 24, 340), 180);
      }

      // Render question-type-specific body
      if (q.options.length > 0) {
        for (const opt of q.options) {
          const optText = formatAcademicTextForPdf(opt.contentRich, opt.content);
          const marker =
            showInlineAnswers && opt.isCorrect ? " [✓]" : "";
          drawWrapped(`${opt.label}. ${optText}${marker}`, {
            font: showInlineAnswers && opt.isCorrect ? fontBold : fontRegular,
            size: fontSize,
            indent: 16,
            color: showInlineAnswers && opt.isCorrect ? palette.success : palette.text,
          });
          if (opt.image) {
            await drawEmbeddedImage(opt.image, 28, Math.min(contentWidth - 48, 220), 110);
          }
        }
      } else if (q.questionType === "ordering" && q.typePayload?.type === "ordering") {
        const displayItems =
          options.shuffleOptions && rng
            ? deterministicShuffle(q.typePayload.items, rng)
            : q.typePayload.items;
        displayItems.forEach((item, i) => {
          drawWrapped(`[   ] ${i + 1}. ${item.text}`, {
            indent: 16,
            size: fontSize,
          });
        });
      } else if (q.questionType === "matching" && q.typePayload?.type === "matching") {
        const rightItems =
          options.shuffleOptions && rng
            ? deterministicShuffle(
                q.typePayload.pairs.map((p) => p.right_text),
                rng,
              )
            : q.typePayload.pairs.map((p) => p.right_text);
        q.typePayload.pairs.forEach((pair, i) => {
          const rightLabel = String.fromCharCode(65 + i);
          const rightVal = rightItems[i] ?? "";
          drawWrapped(`${i + 1}. ${pair.left_text}   |   ${rightLabel}. ${rightVal}`, {
            indent: 16,
            size: fontSize,
          });
        });
      } else if (
        q.questionType === "short_answer" ||
        q.questionType === "numerical" ||
        q.questionType === "fill_in_blank"
      ) {
        const unitSuffix =
          q.questionType === "numerical" && q.typePayload?.type === "numerical" && q.typePayload.unit
            ? ` (${q.typePayload.unit})`
            : "";
        drawWrapped(
          `${isVi ? "Trả lời" : "Answer"}: ________________________________________${unitSuffix}`,
          {
            indent: 16,
            size: fontSize,
            color: palette.muted,
          },
        );
      }

      // Inline review / answer + explanation lines
      if (showInlineAnswers) {
        if (options.mode === "incorrect_review" && q.userResponseText) {
          drawWrapped(
            `${isVi ? "Câu trả lời của bạn" : "Your answer"}: ${q.userResponseText}`,
            {
              font: fontRegular,
              size: fontSize - 0.5,
              indent: 12,
              color: palette.danger,
            },
          );
        }
        drawWrapped(
          `${isVi ? "Đáp án đúng" : "Correct Answer"}: ${ans.answerText}`,
          {
            font: fontBold,
            size: fontSize - 0.5,
            indent: 12,
            color: palette.success,
          },
        );
        const expText = formatAcademicTextForPdf(q.explanationRich, q.explanation);
        if (expText) {
          drawWrapped(`${isVi ? "Giải thích" : "Explanation"}: ${expText}`, {
            font: fontRegular,
            size: fontSize - 0.5,
            indent: 12,
            color: palette.muted,
          });
        }
      }

      cursorY -= 8;
    }

    // --- Separate Answer Key Page for `paper_and_key` mode ---
    if (options.mode === "paper_and_key" && answerKey.length > 0) {
      startNewPage();
      drawWrapped(
        isVi ? "BẢNG ĐÁP ÁN" : "ANSWER KEY",
        {
          font: fontBold,
          size: fontSize + 4,
          color: palette.primary,
          lineGap: (fontSize + 4) * 1.4,
        },
      );
      if (options.examCode?.trim()) {
        drawWrapped(
          isVi
            ? `Mã đề: ${options.examCode.trim()}`
            : `Exam Code: ${options.examCode.trim()}`,
          { font: fontRegular, size: fontSize - 1, color: palette.muted },
        );
      }
      cursorY -= 6;

      // Render crisp multi-column answer key grid (4 cols portrait / 6 cols landscape for short keys)
      const allShortKeys = answerKey.every((k) => k.answerText.length <= 10);
      if (allShortKeys) {
        const cols = orientation === "landscape" ? 6 : 4;
        const cellW = contentWidth / cols;
        const rowH = lineHeight + 4;

        for (let i = 0; i < answerKey.length; i += cols) {
          ensureSpace(rowH + 4);
          const rowItems = answerKey.slice(i, i + cols);
          rowItems.forEach((entry, colIdx) => {
            const cellX = marginX + colIdx * cellW;
            page.drawRectangle({
              x: cellX,
              y: cursorY - rowH,
              width: cellW,
              height: rowH,
              borderColor: palette.border,
              borderWidth: 0.5,
            });
            const label = sanitizeForFont(
              `${entry.questionNumber}. ${entry.answerText}`,
              fontBold,
            );
            page.drawText(label, {
              x: cellX + 8,
              y: cursorY - rowH + (rowH - fontSize) / 2 + 1,
              size: fontSize,
              font: fontBold,
              color: palette.text,
            });
          });
          cursorY -= rowH;
        }
      } else {
        for (const entry of answerKey) {
          drawWrapped(`${entry.questionNumber}. ${entry.answerText}`, {
            font: fontRegular,
            size: fontSize,
          });
        }
      }
    }
  }

  // --- Stamp Running Header, Footer & Page Numbers ("Trang X / Y") across ALL pages ---
  const totalPages = pages.length;
  const metaFontSize = 8.5;
  const headerStr = options.headerText?.trim()
    ? sanitizeForFont(options.headerText.trim(), fontRegular)
    : "";
  const footerStr = options.footerText?.trim()
    ? sanitizeForFont(options.footerText.trim(), fontRegular)
    : sanitizeForFont(options.title || "StudyHub", fontRegular);

  pages.forEach((p, idx) => {
    const pageNumStr = sanitizeForFont(
      isVi ? `Trang ${idx + 1} / ${totalPages}` : `Page ${idx + 1} / ${totalPages}`,
      fontRegular,
    );

    if (headerStr) {
      p.drawText(headerStr, {
        x: marginX,
        y: pageHeight - 28,
        size: metaFontSize,
        font: fontRegular,
        color: palette.muted,
      });
    }

    p.drawLine({
      start: { x: marginX, y: 34 },
      end: { x: pageWidth - marginX, y: 34 },
      thickness: 0.5,
      color: palette.border,
    });

    if (footerStr) {
      p.drawText(footerStr.slice(0, 90), {
        x: marginX,
        y: 20,
        size: metaFontSize,
        font: fontRegular,
        color: palette.muted,
      });
    }

    const pageNumW = fontRegular.widthOfTextAtSize(pageNumStr, metaFontSize);
    p.drawText(pageNumStr, {
      x: pageWidth - marginX - pageNumW,
      y: 20,
      size: metaFontSize,
      font: fontRegular,
      color: palette.muted,
    });
  });

  const savedBytes = await pdfDoc.save();

  return {
    bytes: new Uint8Array(savedBytes),
    pageCount: totalPages,
    questionCount: preparedQuestions.length,
    answerKey,
    seedUsed,
  };
}
