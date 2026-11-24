import type {
  AnswerDetectionSource,
  AnswerRule,
  AnswerRuleMode,
  ImportValidationIssue,
  OptionFormattingMeta,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import {
  matchInlineAnswerLine,
  matchOptionLine,
  matchQuestionHeader,
} from "./eduquiz-parser";
import { mapTabularRowsToQuestions, suggestColumnMapping } from "./tabular-mapper";
import {
  generateStableId,
  indexToOptionLabel,
  matchChapterHeader,
  matchExplanationLine,
  matchHintLine,
  normalizeText,
  optionLabelToIndex,
  sanitizeFileName,
} from "./text-utils";
import {
  applyEndAnswerKeyToQuestions,
  END_ANSWER_KEY_HEADER_REGEX,
  parseEndAnswerKeyBlock,
} from "./word-answer-key-parser";
import {
  assertNoXxeDeclarations,
  createSafeXmlParser,
  inspectAndLoadZip,
  inspectRasterImageBytes,
  MAX_UNCOMPRESSED_BYTES,
  readSafeZipTextEntry,
} from "./zip-guard";

type XmlNode = Record<string, unknown>;

export interface ExtractedDocxMedia {
  rId: string;
  fileName: string;
  mimeType: string;
  ext: string;
  byteLength: number;
  bytes: Uint8Array;
  previewPath: string;
}

export interface DocxParserConfig {
  answerRule?: AnswerRule;
  defaultChapter?: string;
  defaultTags?: string[];
}

export interface DocxParseOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  extractedMedia: ExtractedDocxMedia[];
  ruleUsed: AnswerRule;
}

interface RunFormat {
  bold: boolean;
  underline: boolean;
  highlight: string | null;
  shading: string | null;
  fontColor: string | null;
}

interface DocxRun {
  text: string;
  format: RunFormat;
}

interface DocxParagraph {
  text: string;
  runs: DocxRun[];
  mediaRefs: string[];
  paragraphShading: string | null;
  numId: string | null;
  ilvl: number;
}

interface StyleDef {
  styleId: string;
  basedOn: string | null;
  rPr: Partial<RunFormat>;
  pShading: string | null;
}

interface NumberingLevelDef {
  numFmt: string;
  lvlText: string;
  start: number;
}

interface NumberingCatalog {
  abstractLevels: Map<string, Map<number, NumberingLevelDef>>;
  numToAbstract: Map<string, string>;
  numStartOverrides: Map<string, Map<number, number>>;
}

const DEFAULT_PRIORITY_ORDER: Exclude<AnswerRuleMode, "auto">[] = [
  "inline_answer_key",
  "end_answer_key",
  "asterisk_prefix",
  "docx_highlight",
  "docx_font_color",
  "docx_bold",
  "docx_underline",
];

// --- Preserve-Order XML Helpers ---

function getTagName(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ":@" && key !== "#text") {
      return key;
    }
  }
  return null;
}

function getChildren(node: XmlNode, tagName?: string): XmlNode[] {
  const key = tagName ?? getTagName(node);
  if (!key) return [];
  const val = node[key];
  return Array.isArray(val) ? (val as XmlNode[]) : [];
}

function getAttrs(node: XmlNode): Record<string, string> {
  const raw = node[":@"];
  if (raw && typeof raw === "object") {
    return raw as Record<string, string>;
  }
  return {};
}

function findFirstChild(children: XmlNode[], tagName: string): XmlNode | undefined {
  return children.find((child) => Object.prototype.hasOwnProperty.call(child, tagName));
}

function findAllChildren(children: XmlNode[], tagName: string): XmlNode[] {
  return children.filter((child) => Object.prototype.hasOwnProperty.call(child, tagName));
}

function normalizeHexColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^#/, "").toUpperCase();
  if (
    !cleaned ||
    cleaned === "AUTO" ||
    cleaned === "NONE" ||
    cleaned === "000000" ||
    cleaned === "000001"
  ) {
    return null;
  }
  if (/^[0-9A-F]{6}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function normalizeShadingFill(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^#/, "").toUpperCase();
  if (
    !cleaned ||
    cleaned === "AUTO" ||
    cleaned === "NONE" ||
    cleaned === "FFFFFF" ||
    cleaned === "000000"
  ) {
    return null;
  }
  if (/^[0-9A-F]{6}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function parseRunProperties(rPrNode: XmlNode | undefined): Partial<RunFormat> {
  const fmt: Partial<RunFormat> = {};
  if (!rPrNode) return fmt;
  const children = getChildren(rPrNode, "w:rPr");

  // Bold: <w:b/> or <w:b w:val="true|1"/> vs <w:b w:val="0|false"/>
  const bNode = findFirstChild(children, "w:b");
  if (bNode) {
    const val = getAttrs(bNode)["@_w:val"];
    if (val === "0" || val === "false" || val === "off") {
      fmt.bold = false;
    } else {
      fmt.bold = true;
    }
  }

  // Underline: <w:u w:val="single|double|thick|..."/> vs <w:u w:val="none"/>
  const uNode = findFirstChild(children, "w:u");
  if (uNode) {
    const val = (getAttrs(uNode)["@_w:val"] ?? "single").toLowerCase();
    fmt.underline = val !== "none" && val !== "false" && val !== "0";
  }

  // Highlight: <w:highlight w:val="yellow|green|..."/>
  const hlNode = findFirstChild(children, "w:highlight");
  if (hlNode) {
    const val = (getAttrs(hlNode)["@_w:val"] ?? "").toLowerCase();
    fmt.highlight = val && val !== "none" ? val : null;
  }

  // Run shading: <w:shd w:fill="FFFF00"/>
  const shdNode = findFirstChild(children, "w:shd");
  if (shdNode) {
    fmt.shading = normalizeShadingFill(getAttrs(shdNode)["@_w:fill"]);
  }

  // Font color: <w:color w:val="FF0000"/>
  const colorNode = findFirstChild(children, "w:color");
  if (colorNode) {
    fmt.fontColor = normalizeHexColor(getAttrs(colorNode)["@_w:val"]);
  }

  return fmt;
}

function parseStylesXml(xml: string | null): {
  docDefaults: RunFormat;
  styles: Map<string, StyleDef>;
} {
  const docDefaults: RunFormat = {
    bold: false,
    underline: false,
    highlight: null,
    shading: null,
    fontColor: null,
  };
  const styles = new Map<string, StyleDef>();
  if (!xml) return { docDefaults, styles };

  assertNoXxeDeclarations(xml);
  const parser = createSafeXmlParser({ preserveOrder: true });
  const parsed = parser.parse(xml) as XmlNode[];

  const stylesRoot = findFirstChild(parsed, "w:styles");
  if (!stylesRoot) return { docDefaults, styles };
  const rootChildren = getChildren(stylesRoot, "w:styles");

  // Parse docDefaults
  const docDefaultsNode = findFirstChild(rootChildren, "w:docDefaults");
  if (docDefaultsNode) {
    const rPrDefault = findFirstChild(
      getChildren(docDefaultsNode, "w:docDefaults"),
      "w:rPrDefault",
    );
    if (rPrDefault) {
      const rPr = findFirstChild(getChildren(rPrDefault, "w:rPrDefault"), "w:rPr");
      Object.assign(docDefaults, parseRunProperties(rPr));
    }
  }

  for (const styleNode of findAllChildren(rootChildren, "w:style")) {
    const attrs = getAttrs(styleNode);
    const styleId = attrs["@_w:styleId"];
    if (!styleId) continue;

    const children = getChildren(styleNode, "w:style");
    const basedOnNode = findFirstChild(children, "w:basedOn");
    const basedOn = basedOnNode ? (getAttrs(basedOnNode)["@_w:val"] ?? null) : null;

    const rPrNode = findFirstChild(children, "w:rPr");
    const pPrNode = findFirstChild(children, "w:pPr");
    let pShading: string | null = null;
    if (pPrNode) {
      const shdNode = findFirstChild(getChildren(pPrNode, "w:pPr"), "w:shd");
      if (shdNode) {
        pShading = normalizeShadingFill(getAttrs(shdNode)["@_w:fill"]);
      }
    }

    styles.set(styleId, {
      styleId,
      basedOn,
      rPr: parseRunProperties(rPrNode),
      pShading,
    });
  }

  return { docDefaults, styles };
}

function resolveStyleFormat(
  styleId: string | null,
  styles: Map<string, StyleDef>,
  base: RunFormat,
): { format: RunFormat; pShading: string | null } {
  const chain: StyleDef[] = [];
  const visited = new Set<string>();
  let currentId = styleId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const def = styles.get(currentId);
    if (!def) break;
    chain.unshift(def);
    currentId = def.basedOn;
  }

  const format: RunFormat = { ...base };
  let pShading: string | null = null;
  for (const def of chain) {
    if (def.rPr.bold !== undefined) format.bold = def.rPr.bold;
    if (def.rPr.underline !== undefined) format.underline = def.rPr.underline;
    if (def.rPr.highlight !== undefined) format.highlight = def.rPr.highlight;
    if (def.rPr.shading !== undefined) format.shading = def.rPr.shading;
    if (def.rPr.fontColor !== undefined) format.fontColor = def.rPr.fontColor;
    if (def.pShading !== null) pShading = def.pShading;
  }
  return { format, pShading };
}

function parseNumberingXml(xml: string | null): NumberingCatalog {
  const catalog: NumberingCatalog = {
    abstractLevels: new Map(),
    numToAbstract: new Map(),
    numStartOverrides: new Map(),
  };
  if (!xml) return catalog;

  assertNoXxeDeclarations(xml);
  const parser = createSafeXmlParser({ preserveOrder: true });
  const parsed = parser.parse(xml) as XmlNode[];
  const numRoot = findFirstChild(parsed, "w:numbering");
  if (!numRoot) return catalog;
  const rootChildren = getChildren(numRoot, "w:numbering");

  for (const absNode of findAllChildren(rootChildren, "w:abstractNum")) {
    const absId = getAttrs(absNode)["@_w:abstractNumId"];
    if (!absId) continue;
    const lvlMap = new Map<number, NumberingLevelDef>();
    for (const lvlNode of findAllChildren(getChildren(absNode, "w:abstractNum"), "w:lvl")) {
      const ilvl = Number.parseInt(getAttrs(lvlNode)["@_w:ilvl"] ?? "0", 10);
      const lvlChildren = getChildren(lvlNode, "w:lvl");
      const numFmtNode = findFirstChild(lvlChildren, "w:numFmt");
      const lvlTextNode = findFirstChild(lvlChildren, "w:lvlText");
      const startNode = findFirstChild(lvlChildren, "w:start");
      lvlMap.set(ilvl, {
        numFmt: numFmtNode ? (getAttrs(numFmtNode)["@_w:val"] ?? "decimal") : "decimal",
        lvlText: lvlTextNode ? (getAttrs(lvlTextNode)["@_w:val"] ?? "%1.") : "%1.",
        start: startNode ? Number.parseInt(getAttrs(startNode)["@_w:val"] ?? "1", 10) : 1,
      });
    }
    catalog.abstractLevels.set(absId, lvlMap);
  }

  for (const numNode of findAllChildren(rootChildren, "w:num")) {
    const numId = getAttrs(numNode)["@_w:numId"];
    if (!numId) continue;
    const numChildren = getChildren(numNode, "w:num");
    const absRef = findFirstChild(numChildren, "w:abstractNumId");
    if (absRef) {
      const absId = getAttrs(absRef)["@_w:val"];
      if (absId) catalog.numToAbstract.set(numId, absId);
    }
    const overrides = new Map<number, number>();
    for (const ov of findAllChildren(numChildren, "w:lvlOverride")) {
      const ilvl = Number.parseInt(getAttrs(ov)["@_w:ilvl"] ?? "0", 10);
      const startOv = findFirstChild(getChildren(ov, "w:lvlOverride"), "w:startOverride");
      if (startOv) {
        const startVal = Number.parseInt(getAttrs(startOv)["@_w:val"] ?? "1", 10);
        if (!Number.isNaN(startVal)) overrides.set(ilvl, startVal);
      }
    }
    if (overrides.size > 0) {
      catalog.numStartOverrides.set(numId, overrides);
    }
  }

  return catalog;
}

function formatNumberingValue(value: number, numFmt: string): string {
  switch (numFmt) {
    case "upperLetter":
      return String.fromCharCode(65 + ((value - 1) % 26));
    case "lowerLetter":
      return String.fromCharCode(97 + ((value - 1) % 26));
    case "bullet":
      return "";
    default:
      return String(value);
  }
}

function parseRelationshipsXml(xml: string | null): Map<string, string> {
  const rels = new Map<string, string>();
  if (!xml) return rels;

  assertNoXxeDeclarations(xml);
  const parser = createSafeXmlParser({ preserveOrder: true });
  const parsed = parser.parse(xml) as XmlNode[];
  const root = findFirstChild(parsed, "Relationships");
  if (!root) return rels;

  for (const relNode of findAllChildren(getChildren(root, "Relationships"), "Relationship")) {
    const attrs = getAttrs(relNode);
    const id = attrs["@_Id"];
    const target = attrs["@_Target"];
    if (id && target) {
      rels.set(id, target);
    }
  }
  return rels;
}

/**
 * Recursively find embedded image relationship IDs (`<a:blip r:embed="rIdX"/>`
 * or `<v:imagedata r:id="rIdX"/>`) inside a run or drawing subtree.
 */
function extractImageRIds(nodes: XmlNode[], acc: string[]): void {
  for (const node of nodes) {
    const tag = getTagName(node);
    if (!tag) continue;
    const attrs = getAttrs(node);
    if (tag === "a:blip") {
      const embed = attrs["@_r:embed"] ?? attrs["@_r:link"];
      if (embed) acc.push(embed);
    } else if (tag === "v:imagedata") {
      const rid = attrs["@_r:id"];
      if (rid) acc.push(rid);
    }
    const children = getChildren(node, tag);
    if (children.length > 0) {
      extractImageRIds(children, acc);
    }
  }
}

function mergeFormat(base: RunFormat, override: Partial<RunFormat>): RunFormat {
  return {
    bold: override.bold !== undefined ? override.bold : base.bold,
    underline: override.underline !== undefined ? override.underline : base.underline,
    highlight: override.highlight !== undefined ? override.highlight : base.highlight,
    shading: override.shading !== undefined ? override.shading : base.shading,
    fontColor: override.fontColor !== undefined ? override.fontColor : base.fontColor,
  };
}

function extractParagraphRuns(
  nodes: XmlNode[],
  paragraphBaseFmt: RunFormat,
  styles: Map<string, StyleDef>,
  runs: DocxRun[],
  rIds: string[],
): void {
  for (const node of nodes) {
    const tag = getTagName(node);
    if (!tag) continue;
    if (tag === "w:r") {
      const rChildren = getChildren(node, "w:r");
      const rPrNode = findFirstChild(rChildren, "w:rPr");
      let runFmt = paragraphBaseFmt;

      if (rPrNode) {
        const rPrChildren = getChildren(rPrNode, "w:rPr");
        const rStyleNode = findFirstChild(rPrChildren, "w:rStyle");
        if (rStyleNode) {
          const rStyleId = getAttrs(rStyleNode)["@_w:val"] ?? null;
          runFmt = resolveStyleFormat(rStyleId, styles, runFmt).format;
        }
        runFmt = mergeFormat(runFmt, parseRunProperties(rPrNode));
      }

      let runText = "";
      for (const rc of rChildren) {
        const rcTag = getTagName(rc);
        if (!rcTag) continue;
        if (rcTag === "w:t") {
          for (const tChild of getChildren(rc, "w:t")) {
            if (typeof tChild["#text"] === "string") {
              runText += tChild["#text"];
            }
          }
        } else if (rcTag === "w:tab") {
          runText += "\t";
        } else if (rcTag === "w:br" || rcTag === "w:cr") {
          runText += "\n";
        } else if (rcTag === "w:drawing" || rcTag === "w:pict") {
          extractImageRIds(getChildren(rc, rcTag), rIds);
        }
      }

      if (runText.length > 0) {
        runs.push({ text: runText.normalize("NFC"), format: runFmt });
      }
    } else if (
      tag === "w:hyperlink" ||
      tag === "w:ins" ||
      tag === "w:smartTag" ||
      tag === "w:sdt" ||
      tag === "w:sdtContent"
    ) {
      extractParagraphRuns(
        getChildren(node, tag),
        paragraphBaseFmt,
        styles,
        runs,
        rIds,
      );
    }
  }
}

function parseParagraphNode(
  pNode: XmlNode,
  docDefaults: RunFormat,
  styles: Map<string, StyleDef>,
  numbering: NumberingCatalog,
  numCounters: Map<string, number>,
  rIdToPreviewPath: Map<string, string>,
): DocxParagraph {
  const pChildren = getChildren(pNode, "w:p");
  const pPrNode = findFirstChild(pChildren, "w:pPr");

  let pStyleId: string | null = null;
  let pShading: string | null = null;
  let numId: string | null = null;
  let ilvl = 0;
  let pPrRunOverride: Partial<RunFormat> = {};

  if (pPrNode) {
    const pPrChildren = getChildren(pPrNode, "w:pPr");
    const pStyleNode = findFirstChild(pPrChildren, "w:pStyle");
    if (pStyleNode) pStyleId = getAttrs(pStyleNode)["@_w:val"] ?? null;

    const shdNode = findFirstChild(pPrChildren, "w:shd");
    if (shdNode) pShading = normalizeShadingFill(getAttrs(shdNode)["@_w:fill"]);

    const numPrNode = findFirstChild(pPrChildren, "w:numPr");
    if (numPrNode) {
      const numPrChildren = getChildren(numPrNode, "w:numPr");
      const ilvlNode = findFirstChild(numPrChildren, "w:ilvl");
      const numIdNode = findFirstChild(numPrChildren, "w:numId");
      if (ilvlNode) ilvl = Number.parseInt(getAttrs(ilvlNode)["@_w:val"] ?? "0", 10) || 0;
      if (numIdNode) numId = getAttrs(numIdNode)["@_w:val"] ?? null;
    }

    const pRPrNode = findFirstChild(pPrChildren, "w:rPr");
    if (pRPrNode) {
      pPrRunOverride = parseRunProperties(pRPrNode);
    }
  }

  const resolvedStyle = resolveStyleFormat(pStyleId, styles, docDefaults);
  const paragraphBaseFmt = mergeFormat(resolvedStyle.format, pPrRunOverride);
  const finalPShading = pShading ?? resolvedStyle.pShading;

  const runs: DocxRun[] = [];
  const rIds: string[] = [];
  extractParagraphRuns(pChildren, paragraphBaseFmt, styles, runs, rIds);

  // Resolve auto-numbering prefix if present and literal text doesn't already have it
  let rawText = runs.map((r) => r.text).join("");
  if (numId && rawText.trim().length > 0) {
    const absId = numbering.numToAbstract.get(numId);
    const lvlDef = absId ? numbering.abstractLevels.get(absId)?.get(ilvl) : undefined;
    if (lvlDef && lvlDef.numFmt !== "bullet") {
      // Reset deeper level counters under this numId
      for (const key of numCounters.keys()) {
        if (key.startsWith(`${numId}:`)) {
          const lvl = Number.parseInt(key.split(":")[1], 10);
          if (lvl > ilvl) numCounters.delete(key);
        }
      }
      const counterKey = `${numId}:${ilvl}`;
      const startVal =
        numbering.numStartOverrides.get(numId)?.get(ilvl) ?? lvlDef.start;
      const nextVal = numCounters.has(counterKey)
        ? numCounters.get(counterKey)! + 1
        : startVal;
      numCounters.set(counterKey, nextVal);

      const formattedNum = formatNumberingValue(nextVal, lvlDef.numFmt);
      if (formattedNum) {
        const prefix = lvlDef.lvlText.replace(/%\d+/g, formattedNum).trim() + " ";
        const alreadyHasPrefix =
          rawText.trimStart().startsWith(prefix.trim()) ||
          matchOptionLine(rawText.trimStart()) !== null ||
          matchQuestionHeader(rawText.trimStart()) !== null;
        if (!alreadyHasPrefix) {
          runs.unshift({ text: prefix, format: paragraphBaseFmt });
          rawText = prefix + rawText;
        }
      }
    }
  }

  const mediaRefs = rIds
    .map((id) => rIdToPreviewPath.get(id))
    .filter((p): p is string => Boolean(p));

  return {
    text: normalizeText(rawText),
    runs,
    mediaRefs,
    paragraphShading: finalPShading,
    numId,
    ilvl,
  };
}

interface OptionFormattingAnalysis {
  meta: OptionFormattingMeta;
  /** Whether the option's content body (>=55% of non-space chars after label) is bold */
  bodyBold: boolean;
  /** Whether any non-whitespace run (including label) is bold */
  anyBold: boolean;
  /** Highlight or shading present on any non-whitespace run or paragraph */
  hasHighlight: boolean;
  highlightColor: string | null;
  /** Non-default font color present on non-whitespace runs */
  fontColor: string | null;
  /** Underline present on non-whitespace runs */
  hasUnderline: boolean;
}

function analyzeOptionFormatting(
  runs: readonly DocxRun[],
  paragraphShading: string | null,
): OptionFormattingAnalysis {
  let totalChars = 0;
  let boldChars = 0;
  let bodyTotalChars = 0;
  let bodyBoldChars = 0;
  let underlineChars = 0;

  let firstHighlight: string | null = null;
  let firstShading: string | null = paragraphShading;
  const colorCharCounts = new Map<string, number>();

  // Find character offset where the option label prefix ends (e.g. "A. " or "*B) ")
  const fullText = runs.map((r) => r.text).join("");
  const labelPrefixMatch = /^\s*(?:\*\s*)?(?:\([A-Ha-h]\)|[A-Ha-h]\s*[.)\]:\-])\s*/.exec(
    fullText,
  );
  const bodyStartOffset = labelPrefixMatch ? labelPrefixMatch[0].length : 0;

  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    cursor += run.text.length;

    const nonWsCount = run.text.replace(/\s+/g, "").length;
    if (nonWsCount === 0) continue;

    totalChars += nonWsCount;
    if (run.format.bold) boldChars += nonWsCount;
    if (run.format.underline) underlineChars += nonWsCount;
    if (!firstHighlight && run.format.highlight) firstHighlight = run.format.highlight;
    if (!firstShading && run.format.shading) firstShading = run.format.shading;
    if (run.format.fontColor) {
      colorCharCounts.set(
        run.format.fontColor,
        (colorCharCounts.get(run.format.fontColor) ?? 0) + nonWsCount,
      );
    }

    // Compute portion of run inside option body
    const overlapStart = Math.max(runStart, bodyStartOffset);
    if (overlapStart < cursor) {
      const bodySlice = run.text.slice(overlapStart - runStart);
      const bodyNonWs = bodySlice.replace(/\s+/g, "").length;
      if (bodyNonWs > 0) {
        bodyTotalChars += bodyNonWs;
        if (run.format.bold) bodyBoldChars += bodyNonWs;
      }
    }
  }

  // Pick dominant non-default font color if any
  let dominantColor: string | null = null;
  let maxColorChars = 0;
  for (const [hex, count] of colorCharCounts.entries()) {
    if (count > maxColorChars) {
      maxColorChars = count;
      dominantColor = hex;
    }
  }

  const bodyBold = bodyTotalChars > 0 && bodyBoldChars / bodyTotalChars >= 0.55;
  const anyBold = totalChars > 0 && boldChars > 0;
  const hasHighlight = Boolean(firstHighlight || firstShading);
  const hasUnderline = totalChars > 0 && underlineChars > 0;

  return {
    meta: {
      bold: bodyBold || anyBold,
      underline: hasUnderline,
      highlight: firstHighlight,
      shading: firstShading,
      fontColor: dominantColor,
    },
    bodyBold,
    anyBold,
    hasHighlight,
    highlightColor: firstHighlight ?? firstShading,
    fontColor: dominantColor,
    hasUnderline,
  };
}

interface DraftDocxOption {
  label: string;
  contentLines: string[];
  hasAsterisk: boolean;
  runs: DocxRun[];
  paragraphShading: string | null;
  imageUrl: string | null;
}

interface DraftDocxQuestion {
  chapter: string | null;
  chapterIndex: number;
  localQuestionNumber: number | null;
  promptLines: string[];
  promptImageUrl: string | null;
  options: DraftDocxOption[];
  inlineAnswerLetters: string[];
  explanationLines: string[];
  hintLines: string[];
  rawLines: string[];
}

function finalizeDocxQuestion(
  draft: DraftDocxQuestion,
  globalIndex: number,
  rule: AnswerRule,
  config: DocxParserConfig,
): ParsedQuestion {
  const issues: ImportValidationIssue[] = [];
  const prompt = draft.promptLines.join("\n").trim();

  // Analyze formatting for each option
  const analyses = draft.options.map((opt) =>
    analyzeOptionFormatting(opt.runs, opt.paragraphShading),
  );

  // --- Baseline Subtraction ---
  // 1. Bold: check bodyBold first; if ALL options have bodyBold, subtract bold.
  //    If NO options have bodyBold, fall back to anyBold (e.g. only label "B." bolded) unless ALL have anyBold.
  const optionCount = draft.options.length;
  const bodyBoldCount = analyses.filter((a) => a.bodyBold).length;
  const anyBoldCount = analyses.filter((a) => a.anyBold).length;

  const boldLabels = new Set<string>();
  if (optionCount > 1) {
    if (bodyBoldCount > 0 && bodyBoldCount < optionCount) {
      analyses.forEach((a, i) => {
        if (a.bodyBold) boldLabels.add(draft.options[i].label);
      });
    } else if (bodyBoldCount === 0 && anyBoldCount > 0 && anyBoldCount < optionCount) {
      analyses.forEach((a, i) => {
        if (a.anyBold) boldLabels.add(draft.options[i].label);
      });
    }
    // If bodyBoldCount === optionCount (all options bold), boldLabels stays empty!
  }

  // 2. Highlight / Shading (with baseline subtraction & optional targetHighlightColors)
  const targetHighlights = rule.targetHighlightColors?.map((c) => c.toLowerCase());
  const matchingHighlightFlags = analyses.map((a) => {
    if (!a.hasHighlight) return false;
    if (!targetHighlights || targetHighlights.length === 0) return true;
    const hl = (a.meta.highlight ?? "").toLowerCase();
    const shd = (a.meta.shading ?? "").toLowerCase();
    return targetHighlights.includes(hl) || targetHighlights.includes(shd);
  });
  const highlightCount = matchingHighlightFlags.filter(Boolean).length;
  const highlightLabels = new Set<string>();
  if (optionCount > 1 && highlightCount > 0 && highlightCount < optionCount) {
    matchingHighlightFlags.forEach((flag, i) => {
      if (flag) highlightLabels.add(draft.options[i].label);
    });
  }

  // 3. Font Color (with baseline majority color subtraction & optional targetFontColors)
  const targetColors = rule.targetFontColors?.map((c) =>
    c.replace(/^#/, "").toUpperCase(),
  );
  const colorFreq = new Map<string, number>();
  for (const a of analyses) {
    const key = a.fontColor ?? "__DEFAULT__";
    colorFreq.set(key, (colorFreq.get(key) ?? 0) + 1);
  }
  // Baseline color is the majority color (if >= 50% of options share a color, ignore that color)
  let baselineColor = "__DEFAULT__";
  let maxFreq = 0;
  for (const [colorKey, freq] of colorFreq.entries()) {
    if (freq > maxFreq) {
      maxFreq = freq;
      baselineColor = colorKey;
    }
  }
  const colorLabels = new Set<string>();
  if (optionCount > 1 && maxFreq < optionCount) {
    analyses.forEach((a, i) => {
      const hex = a.fontColor;
      if (!hex) return;
      if (hex === baselineColor) return;
      if (targetColors && targetColors.length > 0 && !targetColors.includes(hex)) {
        return;
      }
      colorLabels.add(draft.options[i].label);
    });
  }

  // 4. Underline (with baseline subtraction)
  const underlineCount = analyses.filter((a) => a.hasUnderline).length;
  const underlineLabels = new Set<string>();
  if (optionCount > 1 && underlineCount > 0 && underlineCount < optionCount) {
    analyses.forEach((a, i) => {
      if (a.hasUnderline) underlineLabels.add(draft.options[i].label);
    });
  }

  // 5. Asterisk & Inline Answer Key
  const asteriskLabels = new Set<string>();
  for (const opt of draft.options) {
    if (opt.hasAsterisk) asteriskLabels.add(opt.label);
  }
  const inlineLabels = new Set<string>(draft.inlineAnswerLetters);

  // Collect enabled signals per AnswerRule
  const priorityOrder = rule.priorityOrder ?? DEFAULT_PRIORITY_ORDER;
  const enabledSignals: Exclude<AnswerRuleMode, "auto">[] =
    rule.mode === "auto"
      ? (rule.enabledSignals ?? DEFAULT_PRIORITY_ORDER)
      : [rule.mode];

  const signalSets = new Map<Exclude<AnswerRuleMode, "auto">, Set<string>>([
    ["inline_answer_key", inlineLabels],
    ["asterisk_prefix", asteriskLabels],
    ["docx_highlight", highlightLabels],
    ["docx_font_color", colorLabels],
    ["docx_bold", boldLabels],
    ["docx_underline", underlineLabels],
  ]);

  // Evaluate all enabled signals that produced >= 1 candidate
  const activeSignals: Array<{
    signal: Exclude<AnswerRuleMode, "auto">;
    labels: string[];
    signature: string;
  }> = [];

  for (const sig of priorityOrder) {
    if (!enabledSignals.includes(sig)) continue;
    const set = signalSets.get(sig);
    if (set && set.size > 0) {
      const sorted = Array.from(set).sort();
      activeSignals.push({
        signal: sig,
        labels: sorted,
        signature: sorted.join(","),
      });
    }
  }

  // Detect conflicts between enabled signals!
  let finalLabels = new Set<string>();
  const detectedBy: AnswerDetectionSource[] = [];

  if (activeSignals.length > 0) {
    const winner = activeSignals[0];
    finalLabels = new Set(winner.labels);
    detectedBy.push(winner.signal);

    const conflicting: string[] = [];
    for (let i = 1; i < activeSignals.length; i += 1) {
      const other = activeSignals[i];
      if (other.signature === winner.signature) {
        detectedBy.push(other.signal);
      } else {
        conflicting.push(`${other.signal}=[${other.signature}]`);
      }
    }

    if (conflicting.length > 0) {
      issues.push({
        id: generateStableId(),
        code: "ANSWER_SIGNAL_CONFLICT",
        severity: "warning",
        questionIndex: globalIndex,
        message: `Conflicting answer signals detected: ${winner.signal} (${winner.signature}) disagrees with ${conflicting.join(", ")}. Review and confirm the correct option.`,
        details: `${winner.signal}=[${winner.signature}] vs ${conflicting.join(", ")}`,
      });
    }
  }

  // Validate inline answer letters exist
  if (inlineLabels.size > 0 && draft.options.length > 0) {
    const labelSet = new Set(draft.options.map((o) => o.label));
    for (const letter of inlineLabels) {
      if (!labelSet.has(letter)) {
        const idx = optionLabelToIndex(letter);
        if (idx < 0 || idx >= draft.options.length) {
          issues.push({
            id: generateStableId(),
            code: "INVALID_CORRECT_ANSWER",
            severity: "error",
            questionIndex: globalIndex,
            message: `Inline answer key references non-existent option "${letter}".`,
          });
        }
      }
    }
  }

  const options: ParsedOption[] = draft.options.map((opt, idx) => {
    const label = opt.label || indexToOptionLabel(idx);
    const isCorrect = finalLabels.has(label);
    const optSources: AnswerDetectionSource[] = [];
    if (isCorrect) {
      for (const act of activeSignals) {
        if (act.labels.includes(label)) {
          optSources.push(act.signal);
        }
      }
    }
    return {
      id: generateStableId(),
      label,
      content: opt.contentLines.join("\n").trim(),
      isCorrect,
      imageUrl: opt.imageUrl,
      detectedBy: optSources,
      formatting: analyses[idx]?.meta,
    };
  });

  const correctCount = options.filter((o) => o.isCorrect).length;
  const questionType = correctCount > 1 ? "multiple_choice" : "single_choice";

  return {
    tempId: generateStableId(),
    index: globalIndex,
    chapter: draft.chapter ?? config.defaultChapter ?? null,
    chapterIndex: draft.chapterIndex,
    localQuestionNumber: draft.localQuestionNumber,
    questionType,
    prompt,
    promptImageUrl: draft.promptImageUrl,
    explanation:
      draft.explanationLines.length > 0
        ? draft.explanationLines.join("\n").trim()
        : null,
    hint:
      draft.hintLines.length > 0 ? draft.hintLines.join("\n").trim() : null,
    difficulty: "medium",
    tags: config.defaultTags ? [...config.defaultTags] : [],
    options,
    detectedBy: detectedBy.length > 0 ? detectedBy : ["none"],
    rawSource: draft.rawLines.join("\n"),
    issues,
  };
}

/**
 * Check if a Word table has standard structured Q&A column headers (Question | A | B | C | D | Answer).
 */
function isStructuredQaTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const header = rows[0];
  if (header.length < 3) return false;
  const mapping = suggestColumnMapping(header);
  return Boolean(mapping.prompt && (mapping.optionA || mapping.backText));
}

/**
 * Check if a Word table is an answer-key grid (cells alternating question numbers and letters,
 * or header containing "Câu" / "Đáp án" / "Question" / "Answer").
 */
function isAnswerKeyTable(rows: string[][]): boolean {
  if (rows.length === 0) return false;
  let pairHits = 0;
  let totalPairs = 0;
  for (const row of rows) {
    if (row.length >= 2 && row.length % 2 === 0) {
      for (let c = 0; c < row.length; c += 2) {
        const left = row[c].trim();
        const right = row[c + 1].trim();
        if (!left && !right) continue;
        totalPairs += 1;
        if (
          /^(?:(?:Câu|Cau|Q)\s*)?\d{1,6}\.?$/i.test(left) &&
          /^[A-Ha-h](?:\s*[,;&/]\s*[A-Ha-h])*$/.test(right)
        ) {
          pairHits += 1;
        }
      }
    }
  }
  return totalPairs > 0 && pairHits / totalPairs >= 0.7;
}

/**
 * Full deterministic OOXML `.docx` parser using `jszip` + `fast-xml-parser` (XXE disabled).
 * Inspects `word/document.xml`, `word/styles.xml`, `word/numbering.xml`,
 * `word/_rels/document.xml.rels`, and `word/media/*`.
 */
export async function parseDocxBuffer(
  bytes: Uint8Array,
  config: DocxParserConfig = {},
): Promise<DocxParseOutput> {
  const ruleUsed: AnswerRule = config.answerRule ?? { mode: "auto" };
  const { zip } = await inspectAndLoadZip(bytes, "docx");

  const budget = { remainingBytes: MAX_UNCOMPRESSED_BYTES };

  const docEntry = zip.file("word/document.xml")!;
  const documentXml = await readSafeZipTextEntry(docEntry, budget);
  assertNoXxeDeclarations(documentXml);

  const stylesEntry = zip.file("word/styles.xml");
  const stylesXml = stylesEntry
    ? await readSafeZipTextEntry(stylesEntry, budget)
    : null;

  const numberingEntry = zip.file("word/numbering.xml");
  const numberingXml = numberingEntry
    ? await readSafeZipTextEntry(numberingEntry, budget)
    : null;

  const relsEntry = zip.file("word/_rels/document.xml.rels");
  const relsXml = relsEntry
    ? await readSafeZipTextEntry(relsEntry, budget)
    : null;

  const { docDefaults, styles } = parseStylesXml(stylesXml);
  const numbering = parseNumberingXml(numberingXml);
  const rels = parseRelationshipsXml(relsXml);

  // Extract and validate safe raster embedded images from word/media/*
  const extractedMedia: ExtractedDocxMedia[] = [];
  const rIdToPreviewPath = new Map<string, string>();
  const globalIssues: ImportValidationIssue[] = [];

  for (const [rId, target] of rels.entries()) {
    const normalizedTarget = target.replace(/\\/g, "/").replace(/^\/+/, "");
    const zipPath = normalizedTarget.startsWith("word/")
      ? normalizedTarget
      : `word/${normalizedTarget}`;
    if (!zipPath.toLowerCase().startsWith("word/media/")) continue;

    const mediaEntry = zip.file(zipPath);
    if (!mediaEntry) continue;

    const mediaBytes = await mediaEntry.async("uint8array");
    budget.remainingBytes -= mediaBytes.byteLength;
    if (budget.remainingBytes < 0) {
      globalIssues.push({
        id: generateStableId(),
        code: "INVALID_FORMAT",
        severity: "warning",
        message: "Embedded media exceeded 50 MB budget; remaining media skipped.",
      });
      break;
    }

    const check = inspectRasterImageBytes(mediaBytes);
    if (!check.valid || !check.mime || !check.ext) {
      globalIssues.push({
        id: generateStableId(),
        code: "INVALID_FORMAT",
        severity: "warning",
        message: `Skipped unsafe or unsupported embedded image "${zipPath}": ${check.reason ?? "unsupported format"}.`,
      });
      continue;
    }

    const safeFileName = sanitizeFileName(zipPath.split("/").pop() ?? `${rId}.${check.ext}`);
    const previewPath = `/docx-media/${safeFileName}`;
    extractedMedia.push({
      rId,
      fileName: safeFileName,
      mimeType: check.mime,
      ext: check.ext,
      byteLength: mediaBytes.byteLength,
      bytes: mediaBytes,
      previewPath,
    });
    rIdToPreviewPath.set(rId, previewPath);
  }

  // Parse word/document.xml preserving exact body order (paragraphs + tables)
  const xmlParser = createSafeXmlParser({ preserveOrder: true });
  const parsedDoc = xmlParser.parse(documentXml) as XmlNode[];
  const docRoot = findFirstChild(parsedDoc, "w:document");
  const bodyNode = docRoot
    ? findFirstChild(getChildren(docRoot, "w:document"), "w:body")
    : undefined;

  if (!bodyNode) {
    return {
      questions: [],
      issues: [
        {
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "error",
          message: "DOCX document.xml is missing <w:body>.",
        },
      ],
      extractedMedia,
      ruleUsed,
    };
  }

  const bodyChildren = getChildren(bodyNode, "w:body");
  const numCounters = new Map<string, number>();

  const questions: ParsedQuestion[] = [];
  const endKeyLines: string[] = [];
  let inEndKeySection = false;
  let currentChapter: string | null = config.defaultChapter ?? null;
  let chapterIndex = 0;
  let current: DraftDocxQuestion | null = null;
  let state: "idle" | "prompt" | "options" | "explanation" | "hint" = "idle";
  let sawBlankParagraph = false;

  const flushCurrent = (): void => {
    if (!current) return;
    const hasPrompt = current.promptLines.join("").trim().length > 0;
    const hasOptions = current.options.length > 0;
    if (hasPrompt || hasOptions) {
      questions.push(
        finalizeDocxQuestion(current, questions.length, ruleUsed, config),
      );
    }
    current = null;
    state = "idle";
  };

  const processParagraph = (para: DocxParagraph): void => {
    // Handle paragraphs that contain internal line breaks (<w:br/>)
    // If a paragraph has no internal newlines, process directly preserving run formatting.
    const trimmed = para.text.trim();
    if (!trimmed && para.mediaRefs.length === 0) {
      sawBlankParagraph = true;
      return;
    }

    // Image-only paragraph attaches to active question prompt or last option
    if (!trimmed && para.mediaRefs.length > 0) {
      if (current) {
        if (state === "options" && current.options.length > 0) {
          const lastOpt = current.options[current.options.length - 1];
          if (!lastOpt.imageUrl) lastOpt.imageUrl = para.mediaRefs[0];
        } else if (!current.promptImageUrl) {
          current.promptImageUrl = para.mediaRefs[0];
        }
      }
      return;
    }

    // End-of-document answer key section detection
    if (
      END_ANSWER_KEY_HEADER_REGEX.test(trimmed) &&
      (questions.length > 0 || current !== null)
    ) {
      flushCurrent();
      inEndKeySection = true;
      return;
    }

    if (inEndKeySection) {
      endKeyLines.push(trimmed);
      return;
    }

    // Chapter heading detection
    const chapterMatch = matchChapterHeader(trimmed);
    if (
      chapterMatch &&
      (state === "idle" ||
        state === "options" ||
        state === "explanation" ||
        state === "hint" ||
        sawBlankParagraph)
    ) {
      flushCurrent();
      currentChapter = chapterMatch;
      chapterIndex += 1;
      sawBlankParagraph = false;
      return;
    }

    // Inline answer line
    if (current && current.options.length > 0) {
      const inlineAns = matchInlineAnswerLine(trimmed);
      if (inlineAns) {
        current.inlineAnswerLetters.push(...inlineAns);
        current.rawLines.push(para.text);
        state = "options";
        sawBlankParagraph = false;
        return;
      }
    }

    // Explanation / Hint lines
    if (current && current.options.length > 0) {
      const exp = matchExplanationLine(trimmed);
      if (exp !== null) {
        current.explanationLines.push(exp);
        current.rawLines.push(para.text);
        state = "explanation";
        sawBlankParagraph = false;
        return;
      }
      const hint = matchHintLine(trimmed);
      if (hint !== null) {
        current.hintLines.push(hint);
        current.rawLines.push(para.text);
        state = "hint";
        sawBlankParagraph = false;
        return;
      }
    }

    // Option line
    const optMatch = matchOptionLine(trimmed);
    if (optMatch && current) {
      current.options.push({
        label: optMatch.label,
        contentLines: optMatch.content ? [optMatch.content] : [],
        hasAsterisk: optMatch.hasAsterisk,
        runs: para.runs,
        paragraphShading: para.paragraphShading,
        imageUrl: para.mediaRefs[0] ?? null,
      });
      current.rawLines.push(para.text);
      state = "options";
      sawBlankParagraph = false;
      return;
    }

    // Question header
    const qHeader = matchQuestionHeader(trimmed);
    if (qHeader) {
      const shouldStartNew =
        !current ||
        qHeader.isExplicitPrefix ||
        current.options.length >= 2 ||
        sawBlankParagraph;

      if (shouldStartNew) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: qHeader.localQuestionNumber,
          promptLines: qHeader.promptStart ? [qHeader.promptStart] : [],
          promptImageUrl: para.mediaRefs[0] ?? null,
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [para.text],
        };
        state = "prompt";
        sawBlankParagraph = false;
        return;
      }
    }

    // Unnumbered start or continuation
    if (!current) {
      current = {
        chapter: currentChapter,
        chapterIndex,
        localQuestionNumber: null,
        promptLines: [trimmed],
        promptImageUrl: para.mediaRefs[0] ?? null,
        options: [],
        inlineAnswerLetters: [],
        explanationLines: [],
        hintLines: [],
        rawLines: [para.text],
      };
      state = "prompt";
      sawBlankParagraph = false;
      return;
    }

    if (state === "prompt") {
      current.promptLines.push(trimmed);
      if (!current.promptImageUrl && para.mediaRefs[0]) {
        current.promptImageUrl = para.mediaRefs[0];
      }
      current.rawLines.push(para.text);
      sawBlankParagraph = false;
      return;
    }

    if (state === "explanation") {
      if (sawBlankParagraph) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          promptImageUrl: para.mediaRefs[0] ?? null,
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [para.text],
        };
        state = "prompt";
      } else {
        current.explanationLines.push(trimmed);
        current.rawLines.push(para.text);
      }
      sawBlankParagraph = false;
      return;
    }

    if (state === "hint") {
      if (sawBlankParagraph) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          promptImageUrl: para.mediaRefs[0] ?? null,
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [para.text],
        };
        state = "prompt";
      } else {
        current.hintLines.push(trimmed);
        current.rawLines.push(para.text);
      }
      sawBlankParagraph = false;
      return;
    }

    if (state === "options") {
      if (sawBlankParagraph && current.options.length >= 2) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          promptImageUrl: para.mediaRefs[0] ?? null,
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [para.text],
        };
        state = "prompt";
      } else if (current.options.length > 0) {
        const lastOpt = current.options[current.options.length - 1];
        lastOpt.contentLines.push(trimmed);
        lastOpt.runs = [...lastOpt.runs, ...para.runs];
        if (!lastOpt.imageUrl && para.mediaRefs[0]) {
          lastOpt.imageUrl = para.mediaRefs[0];
        }
        current.rawLines.push(para.text);
      }
      sawBlankParagraph = false;
    }
  };

  // Walk w:body children in exact document order
  for (const child of bodyChildren) {
    const tag = getTagName(child);
    if (!tag) continue;

    if (tag === "w:p") {
      const para = parseParagraphNode(
        child,
        docDefaults,
        styles,
        numbering,
        numCounters,
        rIdToPreviewPath,
      );
      processParagraph(para);
    } else if (tag === "w:tbl") {
      const tableRowsParas: DocxParagraph[][][] = [];
      const tableTextRows: string[][] = [];

      for (const trNode of findAllChildren(getChildren(child, "w:tbl"), "w:tr")) {
        const rowParas: DocxParagraph[][] = [];
        const rowTexts: string[] = [];
        for (const tcNode of findAllChildren(getChildren(trNode, "w:tr"), "w:tc")) {
          const cellParas = findAllChildren(getChildren(tcNode, "w:tc"), "w:p").map(
            (p) =>
              parseParagraphNode(
                p,
                docDefaults,
                styles,
                numbering,
                numCounters,
                rIdToPreviewPath,
              ),
          );
          rowParas.push(cellParas);
          rowTexts.push(
            cellParas
              .map((p) => p.text.trim())
              .filter(Boolean)
              .join("\n"),
          );
        }
        if (rowTexts.some((t) => t.length > 0)) {
          tableRowsParas.push(rowParas);
          tableTextRows.push(rowTexts);
        }
      }

      if (tableTextRows.length === 0) continue;

      // Case 1: Answer-key table (inside end key section or matching (num | letter) grid)
      if (inEndKeySection || (questions.length > 0 && isAnswerKeyTable(tableTextRows))) {
        flushCurrent();
        inEndKeySection = true;
        for (const row of tableTextRows) {
          if (row.length >= 2 && row.length % 2 === 0) {
            const pairStrs: string[] = [];
            for (let c = 0; c < row.length; c += 2) {
              const left = row[c].trim();
              const right = row[c + 1].trim();
              if (left && right) {
                pairStrs.push(`${left}: ${right}`);
              }
            }
            if (pairStrs.length > 0) endKeyLines.push(pairStrs.join("  "));
          } else {
            endKeyLines.push(row.join(" "));
          }
        }
        continue;
      }

      // Case 2: Structured Q&A table (e.g. header row: Question | Option A | Option B | ... | Answer)
      if (isStructuredQaTable(tableTextRows)) {
        flushCurrent();
        const mapped = mapTabularRowsToQuestions({
          headers: tableTextRows[0],
          rows: tableTextRows.slice(1),
          defaultChapter: currentChapter ?? config.defaultChapter,
          defaultTags: config.defaultTags,
        });
        for (const q of mapped.questions) {
          q.index = questions.length;
          q.chapterIndex = chapterIndex;
          questions.push(q);
        }
        globalIssues.push(...mapped.issues);
        continue;
      }

      // Case 3: Document layout table (e.g. questions or 2x2 option grids in cells)
      // Flatten cell paragraphs in reading order preserving all run formatting & images!
      for (const rowCells of tableRowsParas) {
        for (const cellParas of rowCells) {
          for (const para of cellParas) {
            processParagraph(para);
          }
        }
      }
    }
  }

  flushCurrent();

  // Apply end-of-document answer key if collected and allowed by rule
  const allowEndKey =
    ruleUsed.mode === "auto" ||
    ruleUsed.mode === "end_answer_key" ||
    Boolean(ruleUsed.enabledSignals?.includes("end_answer_key"));

  if (allowEndKey && endKeyLines.length > 0) {
    const firstChapterIndex =
      questions.length > 0 ? (questions[0].chapterIndex ?? 0) : 0;
    const { entries, issues: keyIssues } = parseEndAnswerKeyBlock(
      endKeyLines,
      firstChapterIndex,
    );
    globalIssues.push(...keyIssues);
    const mapIssues = applyEndAnswerKeyToQuestions(
      questions,
      entries,
      ruleUsed.mode,
    );
    globalIssues.push(...mapIssues);
  }

  return {
    questions,
    issues: globalIssues,
    extractedMedia,
    ruleUsed,
  };
}
