import type { AnswerMatchMode } from "@/types/domain";
import type {
  RichTextDoc,
  RichTextMark,
  RichTextMarkType,
  RichTextNode,
  RichTextNodeType,
} from "@/types/v3";

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_PATH_REGEX =
  /^(?:avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-zA-Z0-9._-]+)$/i;

export function isStrictUuid(value: string | null | undefined): boolean {
  return Boolean(value && STRICT_UUID_REGEX.test(value.trim()));
}

/**
 * Validates whether a string is a canonical private `study-media` Storage object path.
 */
export function isValidStudyMediaPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const trimmed = path.trim();
  if (trimmed.includes("..") || trimmed.includes("\\")) return false;
  return STORAGE_PATH_REGEX.test(trimmed);
}

/**
 * Validates that a URL is safe for storage or rendering (`https://`, local relative `/`,
 * or validated Supabase Storage object path). Explicitly rejects `javascript:`, `data:`,
 * `vbscript:`, protocol-relative `//`, and control characters.
 */
export function isSafeHttpOrStorageUrl(url: string | null | undefined): boolean {
  if (!url) {
    return true;
  }
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) {
    return false;
  }
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:") ||
    lower.startsWith("//")
  ) {
    return false;
  }

  if (trimmed.startsWith("/")) {
    return !trimmed.startsWith("/\\") && !trimmed.includes("..");
  }

  if (STORAGE_PATH_REGEX.test(trimmed)) {
    return !trimmed.includes("..");
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") {
      return true;
    }
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

/**
 * Strips PostgREST filter syntax metacharacters (`%`, `_`, `,`, `(`, `)`, `"`, `\`, `.`, `*`)
 * before embedding a search query inside `.or()` `ilike` expressions (fixes SH-043 / SEC-018).
 */
export function sanitizePostgrestSearch(input: string, maxLength = 200): string {
  return input
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[%_,()."\\*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Strips path traversal sequences, directory separators, null bytes, and control characters
 * from an uploaded filename before persisting it to `import_jobs.file_name`.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/[<>:"|?*]/g, "_")
    .trim();

  if (!base || base === "." || base === "_") {
    return "upload";
  }

  return base.slice(0, 180);
}

/**
 * Removes null bytes and non-printable control chars (preserving `\n`, `\r`, `\t`)
 * and normalizes line breaks to `\n`.
 */
export function sanitizeText(input: string, maxLength?: number): string {
  const cleaned = input
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();

  if (typeof maxLength === "number" && cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }

  return cleaned;
}

/**
 * Strips Vietnamese and Latin combining diacritics deterministically.
 */
export function stripDiacritics(input: string): string {
  return input
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Deterministic text normalization for short-answer / Write mode comparison.
 * Strictly aligned 1:1 with PostgreSQL `public.normalize_short_answer()` (Migration 0005).
 */
export function normalizeAnswerText(
  text: string,
  mode: AnswerMatchMode = "case_insensitive",
): string {
  const collapsed = text.trim().replace(/\s+/g, " ");

  switch (mode) {
    case "exact":
      return collapsed;
    case "case_insensitive":
      return collapsed
        .toLowerCase()
        .replace(/^[.,;:!?'"()\[\]{}]+|[.,;:!?'"()\[\]{}]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    case "ignore_diacritics":
      return stripDiacritics(collapsed)
        .toLowerCase()
        .replace(/[.,;:!?'"()\[\]{}]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    case "numeric": {
      const compact = collapsed.replace(/\s+/g, "").replace(/,/g, ".");
      const num = Number(compact);
      if (Number.isFinite(num) && compact.length > 0) {
        return Object.is(num, -0) || num === 0 ? "0" : String(num);
      }
      return collapsed.toLowerCase();
    }
  }
}

/**
 * Deterministically converts a tag display name into a lowercase URL/DB-safe slug.
 */
export function slugifyTag(name: string): string {
  const slug = stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "tag";
}

const ALLOWED_RICHTEXT_NODES = new Set<RichTextNodeType>([
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

const ALLOWED_RICHTEXT_MARKS = new Set<RichTextMarkType>([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "superscript",
  "subscript",
  "link",
]);

const MAX_RICHTEXT_DEPTH = 12;
const MAX_RICHTEXT_NODES = 1500;

function sanitizeRichTextMarks(
  rawMarks: unknown,
): RichTextMark[] | undefined {
  if (!Array.isArray(rawMarks)) return undefined;
  const out: RichTextMark[] = [];
  for (const m of rawMarks) {
    if (!m || typeof m !== "object") continue;
    const rec = m as Record<string, unknown>;
    const rawType = typeof rec.type === "string" ? rec.type : "";
    if (!ALLOWED_RICHTEXT_MARKS.has(rawType as RichTextMarkType)) continue;
    const type = rawType as RichTextMarkType;

    if (type === "link") {
      const attrs =
        rec.attrs && typeof rec.attrs === "object"
          ? (rec.attrs as Record<string, unknown>)
          : {};
      const href = typeof attrs.href === "string" ? attrs.href.trim() : "";
      if (!href || !isSafeHttpOrStorageUrl(href)) continue;
      out.push({
        type: "link",
        attrs: {
          href,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
        },
      });
    } else {
      out.push({ type });
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeRichTextAttrs(
  nodeType: RichTextNodeType,
  rawAttrs: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (!rawAttrs || typeof rawAttrs !== "object") return undefined;
  const src = rawAttrs as Record<string, unknown>;

  switch (nodeType) {
    case "heading": {
      const lvl = Number(src.level);
      return { level: Number.isInteger(lvl) && lvl >= 1 && lvl <= 4 ? lvl : 2 };
    }
    case "codeBlock": {
      const lang =
        typeof src.language === "string"
          ? src.language.replace(/[^a-zA-Z0-9_+-]/g, "").slice(0, 30)
          : null;
      return lang ? { language: lang } : undefined;
    }
    case "inlineMath":
    case "blockMath": {
      const latex =
        typeof src.latex === "string" ? sanitizeText(src.latex, 2000) : "";
      return { latex };
    }
    case "image": {
      const url = typeof src.src === "string" ? src.src.trim() : "";
      if (!url || !isSafeHttpOrStorageUrl(url)) return undefined;
      return {
        src: url,
        alt: typeof src.alt === "string" ? sanitizeText(src.alt, 500) : "",
        media_id:
          typeof src.media_id === "string" && isStrictUuid(src.media_id)
            ? src.media_id
            : null,
      };
    }
    case "tableCell":
    case "tableHeader": {
      const colspan = Number(src.colspan);
      const rowspan = Number(src.rowspan);
      const attrs: Record<string, string | number | boolean | null> = {};
      if (Number.isInteger(colspan) && colspan >= 1 && colspan <= 12) {
        attrs.colspan = colspan;
      }
      if (Number.isInteger(rowspan) && rowspan >= 1 && rowspan <= 12) {
        attrs.rowspan = rowspan;
      }
      return Object.keys(attrs).length > 0 ? attrs : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Deterministically sanitizes a TipTap/ProseMirror-compatible `RichTextDoc` JSON AST.
 * Strips unknown node/mark types, unsafe URLs (`javascript:`, `data:`, `vbscript:`),
 * arbitrary HTML attributes, and enforces depth/node caps to prevent DoS & stored XSS.
 */
export function sanitizeRichTextDoc(input: unknown): RichTextDoc | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  if (root.type !== "doc" || !Array.isArray(root.content)) return null;

  let visited = 0;

  const walk = (rawNode: unknown, depth: number): RichTextNode | null => {
    if (depth > MAX_RICHTEXT_DEPTH || visited >= MAX_RICHTEXT_NODES) {
      return null;
    }
    if (!rawNode || typeof rawNode !== "object") return null;
    const rec = rawNode as Record<string, unknown>;
    const rawType = typeof rec.type === "string" ? rec.type : "";
    if (!ALLOWED_RICHTEXT_NODES.has(rawType as RichTextNodeType) || rawType === "doc") {
      return null;
    }
    const type = rawType as RichTextNodeType;

    visited += 1;
    const node: RichTextNode = { type };

    if (type === "text") {
      if (typeof rec.text !== "string") return null;
      node.text = rec.text
        .replace(/\r\n?/g, "\n")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .slice(0, 10_000);
      const marks = sanitizeRichTextMarks(rec.marks);
      if (marks) node.marks = marks;
      return node;
    }

    const attrs = sanitizeRichTextAttrs(type, rec.attrs);
    if (type === "image" && !attrs) return null;
    if (attrs) node.attrs = attrs;

    if (Array.isArray(rec.content)) {
      const children: RichTextNode[] = [];
      for (const child of rec.content) {
        const cleanChild = walk(child, depth + 1);
        if (cleanChild) children.push(cleanChild);
      }
      if (children.length > 0) node.content = children;
    }

    return node;
  };

  const content: RichTextNode[] = [];
  for (const child of root.content) {
    const clean = walk(child, 1);
    if (clean) content.push(clean);
  }

  return {
    type: "doc",
    version: 1,
    content,
  };
}
