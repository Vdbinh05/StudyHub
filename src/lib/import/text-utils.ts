export const OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/**
 * Strip UTF-8 BOM (\uFEFF) if present at the start of text.
 */
export function stripUtf8Bom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * Normalize line endings (\r\n and \r -> \n), strip BOM, and apply Unicode NFC
 * so Vietnamese diacritics are canonically composed.
 */
export function normalizeText(text: string): string {
  return stripUtf8Bom(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .normalize("NFC");
}

/**
 * Normalize text for deterministic duplicate comparison (NFC, trim, collapse whitespace, lowercase).
 */
export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Generate a stable UUID v4 for temporary parsed questions and options.
 */
export function generateStableId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Convert 0-based option index to uppercase letter label ("A".."H").
 */
export function indexToOptionLabel(index: number): string {
  if (index >= 0 && index < OPTION_LABELS.length) {
    return OPTION_LABELS[index];
  }
  return String.fromCharCode(65 + (index % 26));
}

/**
 * Convert option letter ("A".."H", case-insensitive) to 0-based index, or -1 if invalid.
 */
export function optionLabelToIndex(label: string): number {
  const clean = label.trim().toUpperCase();
  if (clean.length !== 1) return -1;
  const code = clean.charCodeAt(0) - 65;
  return code >= 0 && code < OPTION_LABELS.length ? code : -1;
}

/**
 * Validate that a URL is safe to store and render (https:// or safe relative / path).
 * Explicitly rejects javascript:, data:, vbscript:, protocol-relative //, etc.
 */
export function isSafeHttpOrStorageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return !/[\x00-\x1f]/.test(trimmed);
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Sanitize uploaded file names before saving into import_jobs.file_name.
 */
export function sanitizeFileName(name: string): string {
  const base = name
    .replace(/\\/g, "/")
    .split("/")
    .pop() ?? "import.txt";
  const cleaned = base
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "import.txt";
}

const CHAPTER_KEYWORD_REGEX =
  /^(?:Chương|Chuong|CHƯƠNG|CHUONG|Phần|Phan|PHẦN|PHAN|Bài|Bai|BÀI|BAI|Chủ đề|Chu de|Part|PART|Chapter|CHAPTER|Unit|UNIT|Module|MODULE|Section|SECTION)\s+[\dIVXLCDM]+(?:[\s:.\-–—].*)?$/i;

const MARKDOWN_CHAPTER_REGEX = /^#{1,3}\s+(.+)$/;

/**
 * Detect whether a standalone line is a chapter / section heading.
 * Returns normalized chapter title or null.
 */
export function matchChapterHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 160) return null;

  const mdMatch = MARKDOWN_CHAPTER_REGEX.exec(trimmed);
  if (mdMatch) {
    const title = mdMatch[1].trim();
    return title.length > 0 ? title : null;
  }

  if (CHAPTER_KEYWORD_REGEX.test(trimmed)) {
    return trimmed;
  }

  return null;
}

const EXPLANATION_LINE_REGEX =
  /^(?:Giải\s*thích|Giai\s*thich|Hướng\s*dẫn|Huong\s*dan|Explanation|Note|Ghi\s*chú|Ghi\s*chu|Lời\s*giải|Loi\s*giai)\s*[:\-–—]\s*(.+)$/i;

const HINT_LINE_REGEX = /^(?:Gợi\s*ý|Goi\s*y|Hint)\s*[:\-–—]\s*(.+)$/i;

/**
 * Match an inline explanation line and extract its content.
 */
export function matchExplanationLine(line: string): string | null {
  const match = EXPLANATION_LINE_REGEX.exec(line.trim());
  return match ? match[1].trim() : null;
}

/**
 * Match an inline hint line and extract its content.
 */
export function matchHintLine(line: string): string | null {
  const match = HINT_LINE_REGEX.exec(line.trim());
  return match ? match[1].trim() : null;
}

/**
 * Split an array into deterministic chunks of size `chunkSize` (default 500).
 */
export function chunkArray<T>(items: readonly T[], chunkSize = 500): T[][] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Extract lowercase file extension including the leading dot (e.g. ".docx"), or "".
 */
export function getFileExtension(fileName: string): string {
  const clean = fileName.trim().toLowerCase();
  const dotIdx = clean.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === clean.length - 1) return "";
  return clean.slice(dotIdx);
}
