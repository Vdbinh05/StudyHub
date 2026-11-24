import { createHash } from "node:crypto";
import JSZip from "jszip";
import { sanitizeFilename } from "./sanitize";

export const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ZIP_ENTRIES_WITH_MEDIA = 2_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_ZIP_COMPRESSION_RATIO = 100;
export const RATIO_CHECK_MIN_UNCOMPRESSED_BYTES = 64 * 1024; // 64 KB
export const MAX_PARSED_QUESTIONS = 50_000;

export const ALLOWED_IMPORT_EXTENSIONS = [
  ".docx",
  ".xlsx",
  ".csv",
  ".tsv",
  ".txt",
  ".json",
] as const;

export type AllowedImportExtension = (typeof ALLOWED_IMPORT_EXTENSIONS)[number];

export const FORBIDDEN_EXTENSIONS = [
  ".docm",
  ".xlsm",
  ".doc",
  ".xls",
  ".exe",
  ".html",
  ".htm",
  ".svg",
  ".zip",
  ".js",
  ".mjs",
  ".cjs",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".dll",
] as const;

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
] as const;

export type AllowedAudioMimeType = (typeof ALLOWED_AUDIO_MIME_TYPES)[number];

export type UploadValidationErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "FORBIDDEN_EXTENSION"
  | "UNSUPPORTED_EXTENSION"
  | "INVALID_MAGIC_BYTES"
  | "INVALID_UTF8"
  | "ZIP_SLIP_DETECTED"
  | "ZIP_BOMB_ENTRIES"
  | "ZIP_BOMB_SIZE"
  | "ZIP_BOMB_RATIO"
  | "MACRO_OR_ENCRYPTED_ARCHIVE"
  | "CORRUPT_ARCHIVE"
  | "SVG_FORBIDDEN"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "UNSUPPORTED_AUDIO_FORMAT";

export type ImportFileValidationResult =
  | {
      valid: true;
      extension: AllowedImportExtension;
      sanitizedFileName: string;
      sizeBytes: number;
    }
  | {
      valid: false;
      code: UploadValidationErrorCode;
      message: string;
      status: number;
    };

export type ImageValidationResult =
  | {
      valid: true;
      detectedMime: AllowedImageMimeType;
      extension: "png" | "jpg" | "webp" | "gif";
      sanitizedFileName: string;
      sizeBytes: number;
    }
  | {
      valid: false;
      code: UploadValidationErrorCode;
      message: string;
      status: number;
    };

export type AudioValidationResult =
  | {
      valid: true;
      detectedMime: AllowedAudioMimeType;
      extension: "mp3" | "wav" | "m4a" | "aac" | "webm" | "ogg";
      sanitizedFileName: string;
      sizeBytes: number;
    }
  | {
      valid: false;
      code: UploadValidationErrorCode;
      message: string;
      status: number;
    };

export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function getExtension(fileName: string): string {
  const sanitized = sanitizeFilename(fileName);
  const dot = sanitized.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return sanitized.slice(dot).toLowerCase();
}

function hasPkZipMagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function isMediaArchiveEntry(entryName: string): boolean {
  return /^(?:word|xl)\/media\/[^/]+$/i.test(entryName);
}

function hasUnsafeZipPath(entryName: string): boolean {
  if (
    entryName.startsWith("/") ||
    entryName.startsWith("\\") ||
    /^[a-zA-Z]:/.test(entryName)
  ) {
    return true;
  }
  const normalized = entryName.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments.some((segment) => segment === "..");
}

interface InternalZipEntryData {
  uncompressedSize?: number;
  compressedSize?: number;
}

/**
 * Validates an uploaded import file (`.docx`, `.xlsx`, `.csv`, `.tsv`, `.txt`, `.json`)
 * against extension allowlists, size limits, magic bytes, UTF-8 integrity,
 * macro/encryption bans, ZIP Slip traversal, and ZIP decompression bombs.
 */
export async function validateImportFile(
  buffer: Uint8Array,
  fileName: string,
): Promise<ImportFileValidationResult> {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getExtension(sanitizedFileName);

  if (
    (FORBIDDEN_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return {
      valid: false,
      code: "FORBIDDEN_EXTENSION",
      message: `File type "${ext}" is not permitted for security reasons (macros, executables, and legacy binary formats are blocked).`,
      status: 415,
    };
  }

  if (
    !(ALLOWED_IMPORT_EXTENSIONS as readonly string[]).includes(ext)
  ) {
    return {
      valid: false,
      code: "UNSUPPORTED_EXTENSION",
      message: `Unsupported file extension "${ext || "(none)"}". Allowed formats: .docx, .xlsx, .csv, .tsv, .txt, .json.`,
      status: 415,
    };
  }

  if (buffer.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded file is empty.",
      status: 400,
    };
  }

  if (buffer.byteLength > MAX_IMPORT_FILE_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "File exceeds the maximum allowed size of 15 MB.",
      status: 413,
    };
  }

  const typedExt = ext as AllowedImportExtension;

  if (typedExt === ".docx" || typedExt === ".xlsx") {
    if (!hasPkZipMagicBytes(buffer)) {
      return {
        valid: false,
        code: "INVALID_MAGIC_BYTES",
        message: `File does not have a valid OOXML (${typedExt}) signature.`,
        status: 400,
      };
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
    } catch {
      return {
        valid: false,
        code: "CORRUPT_ARCHIVE",
        message: "Archive could not be read or appears corrupted/encrypted.",
        status: 400,
      };
    }

    const entries = Object.values(zip.files);
    const nonMediaCount = entries.filter(
      (entry) => !isMediaArchiveEntry(entry.name),
    ).length;

    if (
      entries.length > MAX_ZIP_ENTRIES_WITH_MEDIA ||
      nonMediaCount > MAX_ZIP_ENTRIES
    ) {
      return {
        valid: false,
        code: "ZIP_BOMB_ENTRIES",
        message: "Archive contains too many entries and was rejected.",
        status: 400,
      };
    }

    let totalUncompressedBytes = 0;

    for (const entry of entries) {
      if (hasUnsafeZipPath(entry.name)) {
        return {
          valid: false,
          code: "ZIP_SLIP_DETECTED",
          message: "Archive contains an unsafe file path.",
          status: 400,
        };
      }

      const lowerName = entry.name.toLowerCase();
      if (
        lowerName.includes("vbaproject.bin") ||
        lowerName.endsWith("encryptioninfo") ||
        lowerName.endsWith("encryptedpackage")
      ) {
        return {
          valid: false,
          code: "MACRO_OR_ENCRYPTED_ARCHIVE",
          message:
            "Macro-enabled or password-encrypted Office files are not supported.",
          status: 415,
        };
      }

      if (entry.dir) {
        continue;
      }

      const internalData = (entry as unknown as { _data?: InternalZipEntryData })
        ._data;
      const reportedUncompressed = internalData?.uncompressedSize ?? 0;
      const reportedCompressed = internalData?.compressedSize ?? 0;

      if (reportedUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
        return {
          valid: false,
          code: "ZIP_BOMB_SIZE",
          message: "Archive exceeds maximum safe uncompressed size (50 MB).",
          status: 413,
        };
      }

      if (
        reportedUncompressed >= RATIO_CHECK_MIN_UNCOMPRESSED_BYTES &&
        reportedUncompressed / Math.max(reportedCompressed, 1) >
          MAX_ZIP_COMPRESSION_RATIO
      ) {
        return {
          valid: false,
          code: "ZIP_BOMB_RATIO",
          message: "Archive failed compression ratio safety check.",
          status: 400,
        };
      }

      // Inspect actual decompressed byte length for XML/text entries and non-media entries
      // (also covers forged ZIP headers that lie about uncompressedSize).
      const shouldVerifyStream =
        reportedUncompressed === 0 || !isMediaArchiveEntry(entry.name);

      if (shouldVerifyStream) {
        const content = await entry.async("uint8array");
        const actualSize = content.byteLength;
        totalUncompressedBytes += actualSize;

        if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          return {
            valid: false,
            code: "ZIP_BOMB_SIZE",
            message: "Archive exceeds maximum safe uncompressed size (50 MB).",
            status: 413,
          };
        }

        if (
          actualSize >= RATIO_CHECK_MIN_UNCOMPRESSED_BYTES &&
          reportedCompressed > 0 &&
          actualSize / reportedCompressed > MAX_ZIP_COMPRESSION_RATIO
        ) {
          return {
            valid: false,
            code: "ZIP_BOMB_RATIO",
            message: "Archive failed compression ratio safety check.",
            status: 400,
          };
        }
      } else {
        totalUncompressedBytes += reportedUncompressed;
        if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          return {
            valid: false,
            code: "ZIP_BOMB_SIZE",
            message: "Archive exceeds maximum safe uncompressed size (50 MB).",
            status: 413,
          };
        }
      }
    }

    return {
      valid: true,
      extension: typedExt,
      sanitizedFileName,
      sizeBytes: buffer.byteLength,
    };
  }

  // Plain-text formats (.txt, .csv, .tsv, .json): reject null bytes & verify valid UTF-8
  for (let i = 0; i < buffer.byteLength; i += 1) {
    if (buffer[i] === 0x00) {
      return {
        valid: false,
        code: "INVALID_UTF8",
        message: "Text file contains binary null bytes and was rejected.",
        status: 400,
      };
    }
  }

  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buffer);
  } catch {
    return {
      valid: false,
      code: "INVALID_UTF8",
      message: "Text file is not valid UTF-8.",
      status: 400,
    };
  }

  return {
    valid: true,
    extension: typedExt,
    sanitizedFileName,
    sizeBytes: buffer.byteLength,
  };
}

function detectImageMagicBytes(
  bytes: Uint8Array,
): { mime: AllowedImageMimeType; ext: "png" | "jpg" | "webp" | "gif" } | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: "image/jpeg", ext: "jpg" };
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: "image/gif", ext: "gif" };
  }

  return null;
}

/**
 * Validates raster image uploads (PNG, JPEG, WebP, GIF up to 5 MB).
 * Explicitly rejects `image/svg+xml` and `.svg` to prevent stored XSS.
 */
export function validateImageUpload(
  buffer: Uint8Array,
  fileName: string,
  mimeType?: string,
): ImageValidationResult {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getExtension(sanitizedFileName);

  if (ext === ".svg" || mimeType?.toLowerCase().includes("svg")) {
    return {
      valid: false,
      code: "SVG_FORBIDDEN",
      message: "SVG images are not permitted for security reasons.",
      status: 415,
    };
  }

  if (buffer.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded image is empty.",
      status: 400,
    };
  }

  if (buffer.byteLength > MAX_IMAGE_FILE_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "Image exceeds the maximum allowed size of 5 MB.",
      status: 413,
    };
  }

  const detected = detectImageMagicBytes(buffer);
  if (!detected) {
    return {
      valid: false,
      code: "UNSUPPORTED_IMAGE_FORMAT",
      message:
        "Unsupported image format. Only PNG, JPEG, WebP, and GIF images are allowed.",
      status: 415,
    };
  }

  return {
    valid: true,
    detectedMime: detected.mime,
    extension: detected.ext,
    sanitizedFileName,
    sizeBytes: buffer.byteLength,
  };
}

function looksLikeTextMarkup(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.length, 256);
  let text = "";
  for (let i = 0; i < sampleLen; i += 1) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  const lower = text.trimStart().toLowerCase();
  return (
    lower.startsWith("<svg") ||
    lower.startsWith("<!doctype") ||
    lower.startsWith("<html") ||
    lower.startsWith("<script") ||
    lower.startsWith("<?xml")
  );
}

function detectAudioMagicBytes(
  bytes: Uint8Array,
): {
  mime: AllowedAudioMimeType;
  ext: "mp3" | "wav" | "m4a" | "aac" | "webm" | "ogg";
} | null {
  if (bytes.length < 4 || looksLikeTextMarkup(bytes)) {
    return null;
  }

  // WAV: RIFF....WAVE
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return { mime: "audio/wav", ext: "wav" };
  }

  // OGG: OggS
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return { mime: "audio/ogg", ext: "ogg" };
  }

  // WebM / Matroska EBML header: 1A 45 DF A3
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { mime: "audio/webm", ext: "webm" };
  }

  // MP4 / M4A container: ....ftyp<brand>
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0,
    ).toLowerCase();
    const allowedBrands = [
      "m4a ",
      "m4b ",
      "mp42",
      "mp41",
      "isom",
      "iso2",
      "dash",
      "3gp4",
      "3gp5",
      "qt  ",
    ];
    if (allowedBrands.includes(brand)) {
      return { mime: "audio/mp4", ext: "m4a" };
    }
  }

  // MP3 with ID3v2 tag: "ID3"
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }

  // Raw ADTS AAC frame sync: 0xFF 0xF1 or 0xFF 0xF9 (12-bit sync + layer bits == 00)
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return { mime: "audio/aac", ext: "aac" };
  }

  // Raw MPEG Audio frame sync (MP3): 11-bit sync 0xFFE + valid version != 01 + valid layer != 00
  if (
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x18) !== 0x08 &&
    (bytes[1] & 0x06) !== 0x00
  ) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }

  return null;
}

/**
 * Validates audio uploads (MP3, WAV, M4A/MP4, AAC, WebM, OGG up to 10 MB)
 * strictly by magic bytes, rejecting SVG/HTML/executables.
 */
export function validateAudioUpload(
  buffer: Uint8Array,
  fileName: string,
  mimeType?: string,
): AudioValidationResult {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getExtension(sanitizedFileName);

  if (
    ext === ".svg" ||
    ext === ".html" ||
    ext === ".htm" ||
    mimeType?.toLowerCase().includes("svg") ||
    mimeType?.toLowerCase().includes("html")
  ) {
    return {
      valid: false,
      code: "FORBIDDEN_EXTENSION",
      message: "Markup and SVG files are not permitted as audio uploads.",
      status: 415,
    };
  }

  if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      valid: false,
      code: "FORBIDDEN_EXTENSION",
      message: `File type "${ext}" is not permitted for security reasons.`,
      status: 415,
    };
  }

  if (buffer.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded audio file is empty.",
      status: 400,
    };
  }

  if (buffer.byteLength > MAX_AUDIO_FILE_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "Audio file exceeds the maximum allowed size of 10 MB.",
      status: 413,
    };
  }

  const detected = detectAudioMagicBytes(buffer);
  if (!detected) {
    return {
      valid: false,
      code: "UNSUPPORTED_AUDIO_FORMAT",
      message:
        "Unsupported audio format. Only MP3, WAV, M4A, AAC, WebM, and OGG audio files are allowed.",
      status: 415,
    };
  }

  return {
    valid: true,
    detectedMime: detected.mime,
    extension: detected.ext,
    sanitizedFileName,
    sizeBytes: buffer.byteLength,
  };
}
