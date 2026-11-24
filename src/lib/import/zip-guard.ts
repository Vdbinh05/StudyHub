import JSZip from "jszip";
import { XMLParser, type X2jOptions } from "fast-xml-parser";
import { getFileExtension, normalizeText } from "./text-utils";

export const MAX_IMPORT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_RAW_TEXT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ZIP_ENTRIES_WITH_MEDIA = 2000;
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
export const MAX_COMPRESSION_RATIO = 100;
export const RATIO_CHECK_MIN_UNCOMPRESSED_BYTES = 64 * 1024; // 64 KB
export const MAX_PARSED_QUESTIONS = 50_000;

export const ALLOWED_IMPORT_EXTENSIONS = new Set([
  ".docx",
  ".xlsx",
  ".csv",
  ".tsv",
  ".txt",
  ".json",
]);

export const FORBIDDEN_MACRO_EXTENSIONS = new Set([
  ".docm",
  ".xlsm",
  ".doc",
  ".xls",
  ".pptm",
  ".exe",
  ".html",
  ".htm",
  ".svg",
  ".zip",
  ".js",
  ".mjs",
  ".bat",
  ".ps1",
  ".sh",
]);

const RASTER_MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export type ImportSecurityErrorCode =
  | "UNSUPPORTED_EXTENSION"
  | "MACRO_FILE_REJECTED"
  | "FILE_TOO_LARGE"
  | "INVALID_MAGIC_BYTES"
  | "BINARY_CONTENT_IN_TEXT"
  | "INVALID_UTF8"
  | "ENCRYPTED_ARCHIVE"
  | "ZIP_SLIP_DETECTED"
  | "ZIP_ENTRY_LIMIT_EXCEEDED"
  | "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED"
  | "ZIP_RATIO_BOMB_DETECTED"
  | "MACRO_PAYLOAD_DETECTED"
  | "CORRUPT_ARCHIVE"
  | "INVALID_OOXML_STRUCTURE"
  | "XXE_FORBIDDEN"
  | "SVG_IMAGE_REJECTED"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "QUESTION_LIMIT_EXCEEDED";

export class ImportSecurityError extends Error {
  public readonly code: ImportSecurityErrorCode;
  public readonly statusCode: number;

  constructor(code: ImportSecurityErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = "ImportSecurityError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validate import file extension against strict allowlist and macro denylist.
 */
export function validateFileExtension(fileName: string): string {
  const ext = getFileExtension(fileName);
  if (ext === ".docm" || ext === ".xlsm" || ext === ".pptm") {
    throw new ImportSecurityError(
      "MACRO_FILE_REJECTED",
      `Macro-enabled Office files (${ext}) are rejected for security. Save as .docx or .xlsx without macros.`,
      400,
    );
  }
  if (!ext || FORBIDDEN_MACRO_EXTENSIONS.has(ext) || !ALLOWED_IMPORT_EXTENSIONS.has(ext)) {
    throw new ImportSecurityError(
      "UNSUPPORTED_EXTENSION",
      `Unsupported file extension "${ext || "(none)"}". Allowed: .docx, .xlsx, .csv, .tsv, .txt, .json.`,
      400,
    );
  }
  return ext;
}

/**
 * Validate payload byte size against configured cap (15 MB files, 10 MB pasted text).
 */
export function validateFileSize(byteLength: number, isRawText = false): void {
  const cap = isRawText ? MAX_RAW_TEXT_BYTES : MAX_IMPORT_FILE_BYTES;
  if (byteLength > cap) {
    const capMb = Math.round(cap / (1024 * 1024));
    throw new ImportSecurityError(
      "FILE_TOO_LARGE",
      `Input exceeds maximum allowed size of ${capMb} MB.`,
      413,
    );
  }
}

/**
 * Check ZIP/OOXML magic bytes: PK\x03\x04 (50 4B 03 04).
 */
export function hasZipMagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Validate that text-format bytes contain no NUL bytes and are valid UTF-8.
 */
export function validateAndDecodeTextBytes(bytes: Uint8Array): string {
  validateFileSize(bytes.byteLength, false);
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x00) {
      throw new ImportSecurityError(
        "BINARY_CONTENT_IN_TEXT",
        "Binary null byte detected in text file. Please upload a valid UTF-8 text document.",
        400,
      );
    }
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return normalizeText(decoder.decode(bytes));
  } catch {
    throw new ImportSecurityError(
      "INVALID_UTF8",
      "File is not valid UTF-8 text. Please save the file with UTF-8 encoding.",
      400,
    );
  }
}

/**
 * Inspect image bytes against strict raster-only magic byte allowlist.
 * Explicitly rejects SVG (stored XSS vector).
 */
export function inspectRasterImageBytes(
  bytes: Uint8Array,
  declaredMime?: string,
): { valid: boolean; mime?: string; ext?: string; reason?: string } {
  if (declaredMime && declaredMime.toLowerCase().includes("svg")) {
    return { valid: false, reason: "SVG images are rejected to prevent script injection." };
  }
  if (bytes.byteLength > MAX_IMAGE_FILE_BYTES) {
    return { valid: false, reason: "Image exceeds 5 MB limit." };
  }
  if (bytes.byteLength < 8) {
    return { valid: false, reason: "Image file is too small or corrupt." };
  }

  // Check for text-based SVG even if MIME is spoofed
  const prefixText = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(256, bytes.length)))
    .trimStart()
    .toLowerCase();
  if (prefixText.startsWith("<svg") || prefixText.includes("<svg")) {
    return { valid: false, reason: "SVG content detected and rejected." };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { valid: true, mime: "image/png", ext: "png" };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { valid: true, mime: "image/jpeg", ext: "jpg" };
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
    return { valid: true, mime: "image/webp", ext: "webp" };
  }

  // GIF: GIF8
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return { valid: true, mime: "image/gif", ext: "gif" };
  }

  return { valid: false, reason: "Unsupported image format. Allowed: PNG, JPEG, WebP, GIF." };
}

interface ZipCentralDirectoryEntry {
  name: string;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Parse ZIP Central Directory headers directly from raw bytes BEFORE decompressing
 * anything. Catches encrypted archives, ZIP bombs (ratio > 100:1, uncompressed > 50MB),
 * and entry-count floods with zero decompression memory overhead.
 */
function inspectZipCentralDirectory(bytes: Uint8Array): ZipCentralDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocdOffset = Math.max(0, bytes.byteLength - 65557);
  let eocdOffset = -1;

  for (let i = bytes.byteLength - 22; i >= minEocdOffset; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new ImportSecurityError(
      "CORRUPT_ARCHIVE",
      "Invalid or corrupt ZIP/Office archive (missing End of Central Directory).",
      400,
    );
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (totalEntries > MAX_ZIP_ENTRIES_WITH_MEDIA) {
    throw new ImportSecurityError(
      "ZIP_ENTRY_LIMIT_EXCEEDED",
      `Archive contains ${totalEntries} entries, exceeding the hard safety limit of ${MAX_ZIP_ENTRIES_WITH_MEDIA}.`,
      400,
    );
  }

  if (cdOffset + cdSize > bytes.byteLength) {
    throw new ImportSecurityError(
      "CORRUPT_ARCHIVE",
      "Corrupt ZIP archive (central directory bounds exceed file size).",
      400,
    );
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let cursor = cdOffset;

  for (let i = 0; i < totalEntries && cursor + 46 <= bytes.byteLength; i += 1) {
    const signature = view.getUint32(cursor, true);
    if (signature !== 0x02014b50) {
      throw new ImportSecurityError(
        "CORRUPT_ARCHIVE",
        "Corrupt ZIP central directory entry signature.",
        400,
      );
    }

    const flags = view.getUint16(cursor + 8, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);

    if (cursor + 46 + nameLen > bytes.byteLength) {
      throw new ImportSecurityError(
        "CORRUPT_ARCHIVE",
        "Truncated ZIP central directory entry.",
        400,
      );
    }

    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    entries.push({ name, flags, compressedSize, uncompressedSize });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Validate path inside ZIP to block ZIP Slip traversal attacks.
 */
function assertSafeZipEntryPath(entryName: string): void {
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new ImportSecurityError(
      "ZIP_SLIP_DETECTED",
      `Unsafe archive path detected ("${entryName}"). Archive rejected.`,
      400,
    );
  }
}

export interface InspectedZipResult {
  zip: JSZip;
  entryCount: number;
  declaredUncompressedBytes: number;
  compressedSizes: Map<string, number>;
}

/**
 * Full security validation pipeline for .docx / .xlsx archives:
 * - Size cap (15 MB)
 * - Magic bytes (PK\x03\x04)
 * - Central directory inspection BEFORE decompression (encryption, ZIP Slip, macros,
 *   entry cap, 50 MB uncompressed cap, 100:1 compression ratio bomb guard)
 * - Streaming decompression budget & ratio enforcement (defeats forged ZIP headers!)
 * - Required OOXML structure & XXE verification for ALL XML parts in .xlsx before ExcelJS load
 */
export async function inspectAndLoadZip(
  bytes: Uint8Array,
  expectedType: "docx" | "xlsx",
): Promise<InspectedZipResult> {
  validateFileSize(bytes.byteLength, false);

  if (!hasZipMagicBytes(bytes)) {
    throw new ImportSecurityError(
      "INVALID_MAGIC_BYTES",
      `File does not have valid .${expectedType} (ZIP/OOXML) magic bytes.`,
      400,
    );
  }

  const cdEntries = inspectZipCentralDirectory(bytes);
  const compressedSizes = new Map<string, number>();

  let nonMediaCount = 0;
  let totalUncompressed = 0;

  for (const entry of cdEntries) {
    assertSafeZipEntryPath(entry.name);
    compressedSizes.set(entry.name, entry.compressedSize);

    // Bit 0 = encrypted entry
    if ((entry.flags & 0x01) !== 0) {
      throw new ImportSecurityError(
        "ENCRYPTED_ARCHIVE",
        "Password-protected or encrypted Office files are not supported.",
        400,
      );
    }

    const lowerName = entry.name.toLowerCase();
    if (
      lowerName.includes("vbaproject.bin") ||
      lowerName.includes("vbadata.xml") ||
      lowerName.endsWith(".vba")
    ) {
      throw new ImportSecurityError(
        "MACRO_PAYLOAD_DETECTED",
        "Macro payload (vbaProject.bin) detected inside archive. Rejected for security.",
        400,
      );
    }

    const isVerifiedWordMedia =
      expectedType === "docx" &&
      lowerName.startsWith("word/media/") &&
      RASTER_MEDIA_EXTENSIONS.has(getFileExtension(lowerName));

    if (!isVerifiedWordMedia) {
      nonMediaCount += 1;
    }

    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new ImportSecurityError(
        "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED",
        `Archive uncompressed size exceeds the 50 MB safety limit.`,
        400,
      );
    }

    if (entry.uncompressedSize > RATIO_CHECK_MIN_UNCOMPRESSED_BYTES) {
      const ratio = entry.uncompressedSize / Math.max(entry.compressedSize, 1);
      if (ratio > MAX_COMPRESSION_RATIO) {
        throw new ImportSecurityError(
          "ZIP_RATIO_BOMB_DETECTED",
          `Suspicious compression ratio (${Math.round(ratio)}:1) detected in "${entry.name}". Archive rejected.`,
          400,
        );
      }
    }
  }

  if (nonMediaCount > MAX_ZIP_ENTRIES) {
    throw new ImportSecurityError(
      "ZIP_ENTRY_LIMIT_EXCEEDED",
      `Archive has ${nonMediaCount} non-media entries, exceeding the safety limit of ${MAX_ZIP_ENTRIES}.`,
      400,
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportSecurityError(
      "CORRUPT_ARCHIVE",
      `Unable to open .${expectedType} archive. The file may be corrupted.`,
      400,
    );
  }

  // Double-check loaded JSZip paths for traversal & macros
  for (const name of Object.keys(zip.files)) {
    assertSafeZipEntryPath(name);
    const lower = name.toLowerCase();
    if (lower.includes("vbaproject.bin") || lower.includes("vbadata.xml")) {
      throw new ImportSecurityError(
        "MACRO_PAYLOAD_DETECTED",
        "Macro payload detected inside archive. Rejected for security.",
        400,
      );
    }
  }

  const inspectBudget = { remainingBytes: MAX_UNCOMPRESSED_BYTES };

  // Verify [Content_Types].xml does not declare macroEnabled content or XXE
  const contentTypesEntry = zip.file("[Content_Types].xml");
  if (contentTypesEntry) {
    const ctXml = await readSafeZipTextEntry(contentTypesEntry, inspectBudget, {
      compressedSize: compressedSizes.get("[Content_Types].xml"),
      entryName: "[Content_Types].xml",
    });
    assertNoXxeDeclarations(ctXml);
    if (ctXml.toLowerCase().includes("macroenabled")) {
      throw new ImportSecurityError(
        "MACRO_PAYLOAD_DETECTED",
        "Macro-enabled OOXML content type detected and rejected.",
        400,
      );
    }
  }

  // Verify core OOXML document part exists
  if (expectedType === "docx" && !zip.file("word/document.xml")) {
    throw new ImportSecurityError(
      "INVALID_OOXML_STRUCTURE",
      "Invalid .docx file: missing word/document.xml.",
      400,
    );
  }
  if (expectedType === "xlsx" && !zip.file("xl/workbook.xml")) {
    throw new ImportSecurityError(
      "INVALID_OOXML_STRUCTURE",
      "Invalid .xlsx file: missing xl/workbook.xml.",
      400,
    );
  }

  // For XLSX: stream-decompress ALL archive entries under the 50 MB + 100:1 caps
  // and verify EVERY XML/rels part against XXE BEFORE ExcelJS.xlsx.load() touches it!
  if (expectedType === "xlsx") {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    for (const [entryName, entry] of Object.entries(zip.files)) {
      if (entry.dir || entryName === "[Content_Types].xml") continue;
      const entryBytes = await readSafeZipEntryBytes(entry, inspectBudget, {
        compressedSize: compressedSizes.get(entryName),
        entryName,
      });
      const lower = entryName.toLowerCase();
      if (lower.endsWith(".xml") || lower.endsWith(".rels")) {
        assertNoXxeDeclarations(decoder.decode(entryBytes));
      }
    }
  }

  return {
    zip,
    entryCount: cdEntries.length,
    declaredUncompressedBytes: totalUncompressed,
    compressedSizes,
  };
}

export interface SafeZipReadOptions {
  compressedSize?: number;
  entryName?: string;
}

interface JSZipInternalStreamHelper {
  on(event: "data", cb: (chunk: Uint8Array) => void): this;
  on(event: "end", cb: () => void): this;
  on(event: "error", cb: (err: unknown) => void): this;
  pause(): this;
  resume(): this;
}

type JSZipObjectWithInternalStream = JSZip.JSZipObject & {
  internalStream?: (type: "uint8array") => JSZipInternalStreamHelper;
};

/**
 * Safely stream-decompress a JSZip entry chunk-by-chunk while enforcing cumulative
 * decompressed byte cap (50 MB) and actual compression ratio cap (100:1) BEFORE full
 * allocation — defending against forged ZIP Central Directory uncompressedSize headers (SEC-010).
 */
export async function readSafeZipEntryBytes(
  entry: JSZip.JSZipObject,
  budget: { remainingBytes: number },
  options: SafeZipReadOptions = {},
): Promise<Uint8Array> {
  const entryLabel = options.entryName ?? entry.name;
  const compressedSize = options.compressedSize;

  const chunks: Uint8Array[] = [];
  let entryBytes = 0;

  const checkChunk = (chunk: Uint8Array): ImportSecurityError | null => {
    entryBytes += chunk.byteLength;
    budget.remainingBytes -= chunk.byteLength;
    if (budget.remainingBytes < 0) {
      return new ImportSecurityError(
        "ZIP_UNCOMPRESSED_LIMIT_EXCEEDED",
        "Decompressed archive content exceeded the 50 MB safety budget.",
        400,
      );
    }
    if (
      compressedSize !== undefined &&
      entryBytes > RATIO_CHECK_MIN_UNCOMPRESSED_BYTES
    ) {
      const ratio = entryBytes / Math.max(compressedSize, 1);
      if (ratio > MAX_COMPRESSION_RATIO) {
        return new ImportSecurityError(
          "ZIP_RATIO_BOMB_DETECTED",
          `Suspicious actual compression ratio (${Math.round(ratio)}:1) detected in "${entryLabel}". Archive rejected.`,
          400,
        );
      }
    }
    return null;
  };

  const concatChunks = (): Uint8Array => {
    const out = new Uint8Array(entryBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  };

  if (typeof entry.nodeStream === "function") {
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const stream = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & {
        destroy?: () => void;
      };

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        stream.destroy?.();
        reject(err);
      };

      stream.on("data", (rawChunk: Buffer | Uint8Array) => {
        if (settled) return;
        const chunk =
          rawChunk instanceof Uint8Array
            ? new Uint8Array(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength)
            : new Uint8Array(rawChunk);
        const violation = checkChunk(chunk);
        if (violation) {
          fail(violation);
          return;
        }
        chunks.push(chunk);
      });

      stream.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(concatChunks());
      });

      stream.on("error", () => {
        fail(
          new ImportSecurityError(
            "CORRUPT_ARCHIVE",
            `Corrupt or unreadable archive entry "${entryLabel}".`,
            400,
          ),
        );
      });
    });
  }

  // Fallback for non-Node runtimes using JSZip internalStream when available
  const streamable = entry as JSZipObjectWithInternalStream;
  if (typeof streamable.internalStream === "function") {
    const internalStream = streamable.internalStream.bind(streamable);
    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const helper = internalStream("uint8array");

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        helper.pause();
        reject(err);
      };

      helper
        .on("data", (chunk: Uint8Array) => {
          if (settled) return;
          const violation = checkChunk(chunk);
          if (violation) {
            fail(violation);
            return;
          }
          chunks.push(chunk);
        })
        .on("end", () => {
          if (settled) return;
          settled = true;
          resolve(concatChunks());
        })
        .on("error", () => {
          fail(
            new ImportSecurityError(
              "CORRUPT_ARCHIVE",
              `Corrupt or unreadable archive entry "${entryLabel}".`,
              400,
            ),
          );
        })
        .resume();
    });
  }

  // Final defensive fallback if neither streaming API exists in a constrained runtime
  const fallbackBytes = await entry.async("uint8array");
  const violation = checkChunk(fallbackBytes);
  if (violation) {
    throw violation;
  }
  return fallbackBytes;
}

/**
 * Safely stream-read a UTF-8 text entry from JSZip while enforcing cumulative
 * decompressed byte budget and actual compression ratio limits.
 */
export async function readSafeZipTextEntry(
  entry: JSZip.JSZipObject,
  budget: { remainingBytes: number },
  options: SafeZipReadOptions = {},
): Promise<string> {
  const bytes = await readSafeZipEntryBytes(entry, budget, options);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Assert raw XML does not contain DOCTYPE or ENTITY declarations (XXE prevention).
 */
export function assertNoXxeDeclarations(xml: string): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new ImportSecurityError(
      "XXE_FORBIDDEN",
      "XML DOCTYPE/ENTITY declarations are forbidden for security (XXE protection).",
      400,
    );
  }
}

/**
 * Create a fast-xml-parser instance with entity expansion strictly disabled.
 */
export function createSafeXmlParser(options?: Partial<X2jOptions>): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    processEntities: false,
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    ...options,
  });
}
