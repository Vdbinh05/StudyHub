import type {
  RichTextDoc,
  RichTextMark,
  RichTextMarkType,
  RichTextNode,
  RichTextNodeType,
} from "@/types/v3";

export interface SanitizeRichTextOptions {
  /** Allow empty doc `{ version: 1, type: "doc", content: [] }` instead of returning `null`. */
  allowEmptyDoc?: boolean;
  /**
   * Allow safe raster `data:image/(png|jpeg|jpg|webp|gif);base64,...` URLs.
   * Keep `false` for persisted DB documents; enable ONLY for transient import preview UI.
   */
  allowDataImagePreview?: boolean;
}

const ALLOWED_NODE_TYPES: ReadonlySet<RichTextNodeType> = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "inlineMath",
  "blockMath",
  "image",
]);

const ALLOWED_MARK_TYPES: ReadonlySet<RichTextMarkType> = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "superscript",
  "subscript",
  "link",
]);

const MAX_DEPTH = 24;
const MAX_NODES = 5000;
const MAX_LATEX_LENGTH = 2000;
const MAX_TEXT_LENGTH = 50_000;

const SAFE_RASTER_DATA_URI_RE =
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates href URLs for rich text links.
 * Explicitly blocks javascript:, vbscript:, data:, file:, protocol-relative //, and control characters.
 */
export function isSafeRichUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  // Strip/reject control chars and whitespace obfuscation inside schemes
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;

  // Allow safe root-relative internal paths like `/sets/123` or `/api/uploads/signed-url?...`
  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//") && !trimmed.startsWith("/\\");
  }

  // Allow anchor links `#section`
  if (trimmed.startsWith("#")) {
    return trimmed.length <= 256;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    if (parsed.protocol === "mailto:") {
      return /^mailto:[^\s<>()]+@[^\s<>()]+$/i.test(trimmed);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates image src URLs for rich text `image` nodes.
 * Rejects SVG data URIs, `data:text/html`, `javascript:`, and arbitrary schemes.
 */
export function isSafeRichImageUrl(
  rawUrl: string,
  allowDataImagePreview = false,
): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;

  if (allowDataImagePreview && SAFE_RASTER_DATA_URI_RE.test(trimmed)) {
    // Reject oversized inline preview data URIs (> 7MB base64)
    return trimmed.length <= 7_000_000;
  }

  if (trimmed.length > 2048) return false;

  // Reject explicit SVG URLs (defense-in-depth anti-XSS)
  const withoutQuery = trimmed.split(/[?#]/)[0]?.toLowerCase() ?? "";
  if (withoutQuery.endsWith(".svg") || withoutQuery.endsWith(".svgz")) {
    return false;
  }

  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("//") && !trimmed.startsWith("/\\");
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sanitizeMarks(rawMarks: unknown): RichTextMark[] | undefined {
  if (!Array.isArray(rawMarks) || rawMarks.length === 0) return undefined;

  const result: RichTextMark[] = [];
  const seen = new Set<string>();

  for (const item of rawMarks) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (!ALLOWED_MARK_TYPES.has(item.type as RichTextMarkType)) continue;

    const markType = item.type as RichTextMarkType;
    if (markType === "link") {
      const attrs = isRecord(item.attrs) ? item.attrs : null;
      const href = typeof attrs?.href === "string" ? attrs.href.trim() : "";
      if (!isSafeRichUrl(href)) continue;

      const isExternal = href.startsWith("https://") || href.startsWith("http://");
      const key = `link:${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        type: "link",
        attrs: isExternal
          ? { href, target: "_blank", rel: "noopener noreferrer" }
          : { href, target: null, rel: null },
      });
      continue;
    }

    if (seen.has(markType)) continue;
    seen.add(markType);
    result.push({ type: markType });
  }

  return result.length > 0 ? result : undefined;
}

function sanitizeNodeAttrs(
  type: RichTextNodeType,
  rawAttrs: unknown,
  allowDataImagePreview: boolean,
): Record<string, string | number | boolean | null> | undefined {
  const attrs = isRecord(rawAttrs) ? rawAttrs : null;

  switch (type) {
    case "heading": {
      const rawLevel = typeof attrs?.level === "number" ? Math.round(attrs.level) : 2;
      const level = Math.min(4, Math.max(1, rawLevel));
      return { level };
    }
    case "orderedList": {
      const rawStart = typeof attrs?.start === "number" ? Math.round(attrs.start) : 1;
      const start = Math.min(9999, Math.max(1, rawStart));
      return start === 1 ? undefined : { start };
    }
    case "codeBlock": {
      const lang = typeof attrs?.language === "string" ? attrs.language.trim() : "";
      if (lang && /^[a-zA-Z0-9_+#.-]{1,32}$/.test(lang)) {
        return { language: lang };
      }
      return undefined;
    }
    case "tableHeader":
    case "tableCell": {
      const out: Record<string, number> = {};
      if (typeof attrs?.colspan === "number" && Number.isFinite(attrs.colspan)) {
        const colspan = Math.min(50, Math.max(1, Math.round(attrs.colspan)));
        if (colspan > 1) out.colspan = colspan;
      }
      if (typeof attrs?.rowspan === "number" && Number.isFinite(attrs.rowspan)) {
        const rowspan = Math.min(50, Math.max(1, Math.round(attrs.rowspan)));
        if (rowspan > 1) out.rowspan = rowspan;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
    case "inlineMath":
    case "blockMath": {
      const latex =
        typeof attrs?.latex === "string"
          ? attrs.latex.trim().slice(0, MAX_LATEX_LENGTH)
          : "";
      return { latex };
    }
    case "image": {
      const src = typeof attrs?.src === "string" ? attrs.src.trim() : "";
      if (!isSafeRichImageUrl(src, allowDataImagePreview)) {
        return undefined;
      }
      const alt =
        typeof attrs?.alt === "string" ? attrs.alt.trim().slice(0, 500) : "";
      const title =
        typeof attrs?.title === "string" && attrs.title.trim()
          ? attrs.title.trim().slice(0, 200)
          : null;
      const mediaId =
        typeof attrs?.mediaId === "string" && attrs.mediaId.trim()
          ? attrs.mediaId.trim().slice(0, 128)
          : null;
      return { src, alt, title, mediaId };
    }
    default:
      return undefined;
  }
}

function sanitizeNode(
  raw: unknown,
  depth: number,
  counter: { count: number },
  allowDataImagePreview: boolean,
): RichTextNode | null {
  if (depth > MAX_DEPTH || counter.count >= MAX_NODES) return null;
  if (!isRecord(raw) || typeof raw.type !== "string") return null;

  const type = raw.type as RichTextNodeType;
  if (!ALLOWED_NODE_TYPES.has(type) || type === "doc") return null;

  counter.count += 1;

  if (type === "text") {
    if (typeof raw.text !== "string" || raw.text.length === 0) return null;
    const text = raw.text.slice(0, MAX_TEXT_LENGTH);
    const marks = sanitizeMarks(raw.marks);
    return marks ? { type: "text", text, marks } : { type: "text", text };
  }

  if (type === "hardBreak") {
    return { type: "hardBreak" };
  }

  if (type === "inlineMath" || type === "blockMath") {
    const attrs = sanitizeNodeAttrs(type, raw.attrs, allowDataImagePreview);
    const latex = typeof attrs?.latex === "string" ? attrs.latex : "";
    if (!latex) return null;
    return { type, attrs: { latex } };
  }

  if (type === "image") {
    const attrs = sanitizeNodeAttrs("image", raw.attrs, allowDataImagePreview);
    if (!attrs) return null;
    return { type: "image", attrs };
  }

  const attrs = sanitizeNodeAttrs(type, raw.attrs, allowDataImagePreview);
  const children: RichTextNode[] = [];
  if (Array.isArray(raw.content)) {
    for (const child of raw.content) {
      const cleanChild = sanitizeNode(child, depth + 1, counter, allowDataImagePreview);
      if (cleanChild) children.push(cleanChild);
    }
  }

  const node: RichTextNode = { type };
  if (attrs) node.attrs = attrs;
  if (children.length > 0) node.content = children;
  return node;
}

/**
 * Sanitizes an untrusted JSON payload into a strict canonical `RichTextDoc` (v1).
 * Strips disallowed node types, event attributes, and unsafe URL schemes.
 */
export function sanitizeRichTextDoc(
  input: unknown,
  options: SanitizeRichTextOptions = {},
): RichTextDoc | null {
  if (!isRecord(input)) return null;
  if (input.type !== "doc") return null;

  const rawContent = Array.isArray(input.content) ? input.content : [];
  const counter = { count: 0 };
  const allowDataImagePreview = options.allowDataImagePreview ?? false;

  const cleanContent: RichTextNode[] = [];
  for (const child of rawContent) {
    const clean = sanitizeNode(child, 1, counter, allowDataImagePreview);
    if (clean) cleanContent.push(clean);
  }

  const doc: RichTextDoc = {
    version: 1,
    type: "doc",
    content: cleanContent,
  };

  if (!options.allowEmptyDoc && !hasRichTextContent(doc)) {
    return null;
  }

  return doc;
}

function nodeHasVisibleContent(node: RichTextNode): boolean {
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.trim().length > 0;
  }
  if (node.type === "inlineMath" || node.type === "blockMath") {
    return typeof node.attrs?.latex === "string" && node.attrs.latex.trim().length > 0;
  }
  if (node.type === "image") {
    return typeof node.attrs?.src === "string" && node.attrs.src.trim().length > 0;
  }
  if (Array.isArray(node.content)) {
    return node.content.some(nodeHasVisibleContent);
  }
  return false;
}

export function hasRichTextContent(doc: RichTextDoc | null | undefined): boolean {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return false;
  return doc.content.some(nodeHasVisibleContent);
}

function projectNodeToPlainText(node: RichTextNode): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "inlineMath": {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex.trim() : "";
      return latex ? `$${latex}$` : "";
    }
    case "blockMath": {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex.trim() : "";
      return latex ? `$$${latex}$$` : "";
    }
    case "image": {
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
      return alt ? `[${alt}]` : "";
    }
    case "tableRow":
      return (node.content ?? []).map(projectNodeToPlainText).filter(Boolean).join(" | ");
    case "table":
      return (node.content ?? []).map(projectNodeToPlainText).filter(Boolean).join("\n");
    case "bulletList":
      return (node.content ?? [])
        .map((item) => `- ${projectNodeToPlainText(item).trim()}`)
        .filter((line) => line !== "-")
        .join("\n");
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
      return (node.content ?? [])
        .map((item, idx) => `${start + idx}. ${projectNodeToPlainText(item).trim()}`)
        .join("\n");
    }
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
    case "listItem":
    case "tableHeader":
    case "tableCell":
      return (node.content ?? []).map(projectNodeToPlainText).join("");
    default:
      return (node.content ?? []).map(projectNodeToPlainText).join("");
  }
}

/**
 * Deterministically projects a `RichTextDoc` to plain text for search indexing,
 * TTS fallback, duplicate fingerprinting, and PDF export.
 */
export function richTextToPlainText(
  doc: RichTextDoc | null | undefined,
  fallbackPlainText?: string | null,
): string {
  if (doc && doc.type === "doc" && Array.isArray(doc.content) && doc.content.length > 0) {
    const blocks = doc.content
      .map((node) => projectNodeToPlainText(node))
      .filter((text) => text.length > 0);
    const joined = blocks.join("\n").trim();
    if (joined.length > 0) return joined;
  }
  return (fallbackPlainText ?? "").trim();
}

export interface MathTextToken {
  type: "text" | "inlineMath" | "blockMath";
  value: string;
}

/**
 * Deterministically tokenizes plain text containing `$$...$$`, `\[...\]`, `\(...\)`,
 * and `$...$` math delimiters while leaving currency like `$5` or `$100` untouched.
 */
export function tokenizePlainTextWithMath(text: string): MathTextToken[] {
  if (!text) return [];

  const tokens: MathTextToken[] = [];
  let buffer = "";
  let i = 0;

  const flushBuffer = (): void => {
    if (buffer.length > 0) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (i < text.length) {
    // Escaped dollar sign `\$` -> literal `$`
    if (text[i] === "\\" && text[i + 1] === "$") {
      buffer += "$";
      i += 2;
      continue;
    }

    // Block math: $$...$$
    if (text[i] === "$" && text[i + 1] === "$") {
      const closeIdx = text.indexOf("$$", i + 2);
      if (closeIdx !== -1) {
        const latex = text.slice(i + 2, closeIdx).trim();
        if (latex.length > 0) {
          flushBuffer();
          tokens.push({ type: "blockMath", value: latex });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Block math: \[...\]
    if (text[i] === "\\" && text[i + 1] === "[") {
      const closeIdx = text.indexOf("\\]", i + 2);
      if (closeIdx !== -1) {
        const latex = text.slice(i + 2, closeIdx).trim();
        if (latex.length > 0) {
          flushBuffer();
          tokens.push({ type: "blockMath", value: latex });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Inline math: \(...\)
    if (text[i] === "\\" && text[i + 1] === "(") {
      const closeIdx = text.indexOf("\\)", i + 2);
      if (closeIdx !== -1 && !text.slice(i + 2, closeIdx).includes("\n\n")) {
        const latex = text.slice(i + 2, closeIdx).trim();
        if (latex.length > 0) {
          flushBuffer();
          tokens.push({ type: "inlineMath", value: latex });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // Inline math: $...$ (single line, no leading/trailing space right inside delimiters)
    if (text[i] === "$" && text[i + 1] !== "$" && text[i + 1] !== " " && text[i + 1] !== "\t") {
      let closeIdx = -1;
      for (let j = i + 1; j < text.length; j += 1) {
        if (text[j] === "\n") break;
        if (text[j] === "\\" && text[j + 1] === "$") {
          j += 1;
          continue;
        }
        if (text[j] === "$") {
          // Ensure previous char isn't whitespace and next char isn't a digit (e.g. "$5 and $10")
          if (text[j - 1] !== " " && text[j - 1] !== "\t" && !/\d/.test(text[j + 1] ?? "")) {
            closeIdx = j;
          }
          break;
        }
      }

      if (closeIdx !== -1) {
        const candidate = text.slice(i + 1, closeIdx);
        // Avoid misreading prose between two currency amounts like "$5 and $10"
        const looksLikeCurrencyRange = /^\d+(?:[.,]\d+)?\s+[a-zA-Z]/.test(candidate);
        if (candidate.trim().length > 0 && !looksLikeCurrencyRange) {
          flushBuffer();
          tokens.push({ type: "inlineMath", value: candidate.trim() });
          i = closeIdx + 1;
          continue;
        }
      }
    }

    buffer += text[i];
    i += 1;
  }

  flushBuffer();
  return tokens;
}

/**
 * Converts legacy plain text (with optional `$...$` / `$$...$$` math) into a canonical `RichTextDoc` v1.
 */
export function plainTextToRichTextDoc(
  text: string,
  options: { parseMath?: boolean } = {},
): RichTextDoc {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  const parseMath = options.parseMath ?? true;
  const paragraphs = normalized.split(/\n{2,}/);
  const content: RichTextNode[] = [];

  for (const para of paragraphs) {
    const tokens = parseMath
      ? tokenizePlainTextWithMath(para)
      : [{ type: "text" as const, value: para }];

    let inlineBuf: RichTextNode[] = [];

    const flushParagraph = (): void => {
      if (inlineBuf.length > 0) {
        content.push({ type: "paragraph", content: inlineBuf });
        inlineBuf = [];
      }
    };

    for (const token of tokens) {
      if (token.type === "blockMath") {
        flushParagraph();
        content.push({ type: "blockMath", attrs: { latex: token.value } });
        continue;
      }
      if (token.type === "inlineMath") {
        inlineBuf.push({ type: "inlineMath", attrs: { latex: token.value } });
        continue;
      }
      const lines = token.value.split("\n");
      lines.forEach((line, idx) => {
        if (line.length > 0) {
          inlineBuf.push({ type: "text", text: line });
        }
        if (idx < lines.length - 1) {
          inlineBuf.push({ type: "hardBreak" });
        }
      });
    }

    flushParagraph();
  }

  return {
    version: 1,
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
}
