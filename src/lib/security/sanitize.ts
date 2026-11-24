import type { AnswerMatchMode } from "@/types/domain";

const STORAGE_PATH_REGEX =
  /^(?:avatars\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+|[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+)$/i;

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
      return collapsed.toLowerCase();
    case "ignore_diacritics":
      return stripDiacritics(collapsed)
        .toLowerCase()
        .replace(/^[.,;:!?'"()\[\]{}]+|[.,;:!?'"()\[\]{}]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
    case "numeric": {
      const compact = collapsed.replace(/\s+/g, "").replace(/,/g, ".");
      const num = Number(compact);
      if (Number.isFinite(num) && compact.length > 0) {
        return String(num);
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
