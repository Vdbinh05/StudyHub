/**
 * Deterministic Media Validation, SHA-256 Hashing & Client Image Optimization Utilities.
 * Enforces strict magic-byte checks for raster images (<= 5 MB, ZERO SVG/HTML) and
 * browser-compatible audio (<= 10 MB), plus diagram-safe client resize/crop/rotate helpers.
 */

import { sanitizeFilename } from "@/lib/security/sanitize";

export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];
export type AllowedImageExtension = "png" | "jpg" | "webp" | "gif";

export const ALLOWED_AUDIO_MIMES = [
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
] as const;

export type AllowedAudioMime = (typeof ALLOWED_AUDIO_MIMES)[number];
export type AllowedAudioExtension = "mp3" | "wav" | "m4a" | "webm" | "ogg";

export type MediaValidationErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "SVG_FORBIDDEN"
  | "HTML_FORBIDDEN"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "UNSUPPORTED_AUDIO_FORMAT"
  | "UNSUPPORTED_MEDIA_FORMAT";

export type RasterImageValidationResult =
  | {
      valid: true;
      kind: "image";
      detectedMime: AllowedImageMime;
      extension: AllowedImageExtension;
      sanitizedFileName: string;
      sizeBytes: number;
    }
  | {
      valid: false;
      code: MediaValidationErrorCode;
      message: string;
      status: number;
    };

export type AudioValidationResult =
  | {
      valid: true;
      kind: "audio";
      detectedMime: AllowedAudioMime;
      extension: AllowedAudioExtension;
      sanitizedFileName: string;
      sizeBytes: number;
    }
  | {
      valid: false;
      code: MediaValidationErrorCode;
      message: string;
      status: number;
    };

export type MediaUploadValidationResult =
  | Extract<RasterImageValidationResult, { valid: true }>
  | Extract<AudioValidationResult, { valid: true }>
  | {
      valid: false;
      code: MediaValidationErrorCode;
      message: string;
      status: number;
    };

export interface ImageDimensionEstimate {
  width: number;
  height: number;
}

export interface ResizePlanOptions {
  /** Keep original untouched for lossless/technical diagrams. */
  preserveOriginal?: boolean;
  /** Technical diagram mode uses higher max resolution & sharp output. */
  diagramMode?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ResizePlanResult {
  width: number;
  height: number;
  resized: boolean;
}

export interface ClientOptimizeOptions extends ResizePlanOptions {
  /** JPEG/WebP quality (0.5..1.0). Ignored in lossless PNG/preserveOriginal mode. */
  quality?: number;
  /** Prefer lossless PNG when diagramMode is enabled. */
  preferPngForDiagrams?: boolean;
}

export interface OptimizedImageResult {
  file: File;
  wasModified: boolean;
  originalBytes: number;
  outputBytes: number;
  width: number | null;
  height: number | null;
}

export interface NormalizedCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const KNOWN_MP4_AUDIO_BRANDS = new Set([
  "M4A ",
  "M4B ",
  "M4P ",
  "mp42",
  "mp41",
  "isom",
  "iso2",
  "iso5",
  "dash",
  "aac ",
  "qt  ",
  "3gp4",
  "3gp5",
]);

function getLowerExtension(fileName: string): string {
  const sanitized = sanitizeFilename(fileName);
  const dot = sanitized.lastIndexOf(".");
  if (dot <= 0) return "";
  return sanitized.slice(dot).toLowerCase();
}

function sniffLeadingAsciiText(bytes: Uint8Array, maxBytes = 1024): string {
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes));
  // Strip UTF-8 BOM if present
  let offset = 0;
  if (slice.length >= 3 && slice[0] === 0xef && slice[1] === 0xbb && slice[2] === 0xbf) {
    offset = 3;
  }
  let text = "";
  for (let i = offset; i < slice.length; i += 1) {
    const b = slice[i];
    if (b === 0) break;
    if (b >= 0x09 && b <= 0x7e) {
      text += String.fromCharCode(b);
    }
  }
  return text.trimStart().toLowerCase();
}

function detectForbiddenMarkup(
  bytes: Uint8Array,
  ext: string,
  declaredMime?: string,
): { code: "SVG_FORBIDDEN" | "HTML_FORBIDDEN"; message: string } | null {
  const mime = (declaredMime ?? "").toLowerCase();
  if (ext === ".svg" || mime.includes("svg")) {
    return {
      code: "SVG_FORBIDDEN",
      message: "SVG files are blocked for security reasons. Please upload PNG, JPEG, WebP, or GIF.",
    };
  }
  if (ext === ".html" || ext === ".htm" || ext === ".xhtml" || mime.includes("text/html")) {
    return {
      code: "HTML_FORBIDDEN",
      message: "HTML files are not permitted as media uploads.",
    };
  }

  const leading = sniffLeadingAsciiText(bytes, 1024);
  if (
    leading.startsWith("<svg") ||
    (leading.startsWith("<?xml") && leading.includes("<svg"))
  ) {
    return {
      code: "SVG_FORBIDDEN",
      message: "SVG content detected and rejected for security reasons.",
    };
  }
  if (
    leading.startsWith("<!doctype html") ||
    leading.startsWith("<html") ||
    leading.startsWith("<script") ||
    leading.startsWith("<iframe") ||
    leading.startsWith("<body")
  ) {
    return {
      code: "HTML_FORBIDDEN",
      message: "HTML/script content detected and rejected for security reasons.",
    };
  }
  return null;
}

export function detectImageMagicBytes(
  bytes: Uint8Array,
): { mime: AllowedImageMime; ext: AllowedImageExtension } | null {
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

export function detectAudioMagicBytes(
  bytes: Uint8Array,
): { mime: AllowedAudioMime; ext: AllowedAudioExtension } | null {
  if (bytes.length < 4) return null;

  // MP3 with ID3v2 header: "ID3"
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return { mime: "audio/mpeg", ext: "mp3" };
  }

  // Raw MPEG Audio frame sync: 11 sync bits (0xFF, top 3 bits 0xE0),
  // valid MPEG version (bits 4-3 != 01), valid Layer (bits 2-1 != 00).
  // Note: JPEG FF D8 has (0xD8 & 0xE0) === 0xC0 !== 0xE0 so it will never match.
  if (
    bytes[0] === 0xff &&
    (bytes[1] & 0xe0) === 0xe0 &&
    (bytes[1] & 0x18) !== 0x08 &&
    (bytes[1] & 0x06) !== 0x00
  ) {
    return { mime: "audio/mpeg", ext: "mp3" };
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

  // M4A / MP4 ISO Base Media container: offset 4 == "ftyp"
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (KNOWN_MP4_AUDIO_BRANDS.has(brand)) {
      return { mime: "audio/mp4", ext: "m4a" };
    }
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

  // OGG container: "OggS"
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return { mime: "audio/ogg", ext: "ogg" };
  }

  return null;
}

/**
 * Validates raster image uploads (PNG, JPEG, WebP, GIF up to 5 MB).
 * Rejects SVG, HTML, empty payloads, and mismatched magic bytes.
 */
export function validateRasterImage(
  bytes: Uint8Array,
  fileName: string,
  declaredMime?: string,
): RasterImageValidationResult {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getLowerExtension(sanitizedFileName);

  const forbidden = detectForbiddenMarkup(bytes, ext, declaredMime);
  if (forbidden) {
    return {
      valid: false,
      code: forbidden.code,
      message: forbidden.message,
      status: 415,
    };
  }

  if (bytes.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded image file is empty.",
      status: 400,
    };
  }

  if (bytes.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "Image exceeds maximum allowed size of 5 MB.",
      status: 413,
    };
  }

  const detected = detectImageMagicBytes(bytes);
  if (!detected) {
    return {
      valid: false,
      code: "UNSUPPORTED_IMAGE_FORMAT",
      message: "Unsupported image format. Allowed formats: PNG, JPEG, WebP, GIF.",
      status: 415,
    };
  }

  return {
    valid: true,
    kind: "image",
    detectedMime: detected.mime,
    extension: detected.ext,
    sanitizedFileName,
    sizeBytes: bytes.byteLength,
  };
}

/**
 * Validates browser-compatible audio uploads (MP3, WAV, M4A/MP4, WebM, OGG up to 10 MB).
 */
export function validateAudioUpload(
  bytes: Uint8Array,
  fileName: string,
  declaredMime?: string,
): AudioValidationResult {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getLowerExtension(sanitizedFileName);

  const forbidden = detectForbiddenMarkup(bytes, ext, declaredMime);
  if (forbidden) {
    return {
      valid: false,
      code: forbidden.code,
      message: forbidden.message,
      status: 415,
    };
  }

  if (bytes.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded audio file is empty.",
      status: 400,
    };
  }

  if (bytes.byteLength > MAX_AUDIO_UPLOAD_BYTES) {
    return {
      valid: false,
      code: "FILE_TOO_LARGE",
      message: "Audio file exceeds maximum allowed size of 10 MB.",
      status: 413,
    };
  }

  const detected = detectAudioMagicBytes(bytes);
  if (!detected) {
    return {
      valid: false,
      code: "UNSUPPORTED_AUDIO_FORMAT",
      message: "Unsupported audio format. Allowed formats: MP3, WAV, M4A/MP4, WebM, OGG.",
      status: 415,
    };
  }

  return {
    valid: true,
    kind: "audio",
    detectedMime: detected.mime,
    extension: detected.ext,
    sanitizedFileName,
    sizeBytes: bytes.byteLength,
  };
}

/**
 * Unified validator that checks forbidden markup first, then dispatches raster image vs audio.
 */
export function validateMediaUpload(
  bytes: Uint8Array,
  fileName: string,
  declaredMime?: string,
): MediaUploadValidationResult {
  const sanitizedFileName = sanitizeFilename(fileName);
  const ext = getLowerExtension(sanitizedFileName);
  const forbidden = detectForbiddenMarkup(bytes, ext, declaredMime);
  if (forbidden) {
    return {
      valid: false,
      code: forbidden.code,
      message: forbidden.message,
      status: 415,
    };
  }

  if (bytes.byteLength === 0) {
    return {
      valid: false,
      code: "EMPTY_FILE",
      message: "Uploaded file is empty.",
      status: 400,
    };
  }

  if (detectImageMagicBytes(bytes)) {
    return validateRasterImage(bytes, fileName, declaredMime);
  }
  if (detectAudioMagicBytes(bytes)) {
    return validateAudioUpload(bytes, fileName, declaredMime);
  }

  return {
    valid: false,
    code: "UNSUPPORTED_MEDIA_FORMAT",
    message:
      "Unsupported file format. Supported images: PNG, JPEG, WebP, GIF. Supported audio: MP3, WAV, M4A, WebM, OGG.",
    status: 415,
  };
}

/**
 * Computes lowercase hex SHA-256 content hash using Baseline Web Crypto (`crypto.subtle`).
 */
export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  const hashBytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < hashBytes.length; i += 1) {
    hex += hashBytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Extracts image pixel dimensions deterministically from PNG, GIF, JPEG, or WebP headers.
 */
export function extractImageDimensionsFromBytes(
  bytes: Uint8Array,
): ImageDimensionEstimate | null {
  const detected = detectImageMagicBytes(bytes);
  if (!detected) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (detected.ext === "png" && bytes.byteLength >= 24) {
    // IHDR chunk starts at offset 12, width at 16, height at 20 (big-endian)
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) return { width, height };
  }

  if (detected.ext === "gif" && bytes.byteLength >= 10) {
    const width = view.getUint16(6, true);
    const height = view.getUint16(8, true);
    if (width > 0 && height > 0) return { width, height };
  }

  if (detected.ext === "jpg" && bytes.byteLength >= 4) {
    let offset = 2;
    while (offset + 4 < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > bytes.byteLength) break;
      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;

      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 < bytes.byteLength) {
        const height = view.getUint16(offset + 3, false);
        const width = view.getUint16(offset + 5, false);
        if (width > 0 && height > 0) return { width, height };
      }
      offset += segmentLength;
    }
  }

  if (detected.ext === "webp" && bytes.byteLength >= 30) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    } else if (chunk === "VP8L" && bytes.byteLength >= 25) {
      const bits = view.getUint32(21, true);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    } else if (chunk === "VP8 " && bytes.byteLength >= 30) {
      const width = view.getUint16(26, true) & 0x3fff;
      const height = view.getUint16(28, true) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return null;
}

/**
 * Pure dimension planner for client image resizing.
 * Never upscales; uses higher resolution ceiling in `diagramMode` so labels/lines stay crisp.
 */
export function computeTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  options: ResizePlanOptions = {},
): ResizePlanResult {
  const safeW = Math.max(1, Math.round(srcWidth));
  const safeH = Math.max(1, Math.round(srcHeight));

  if (options.preserveOriginal) {
    return { width: safeW, height: safeH, resized: false };
  }

  const defaultMax = options.diagramMode ? 2560 : 1920;
  const maxWidth = Math.max(64, options.maxWidth ?? defaultMax);
  const maxHeight = Math.max(64, options.maxHeight ?? defaultMax);

  const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
  if (scale >= 1) {
    return { width: safeW, height: safeH, resized: false };
  }

  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    resized: true,
  };
}

async function loadBrowserImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image in browser."));
    };
    img.src = url;
  });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Client-side Canvas resize/compress helper preserving technical diagram readability.
 * Validates magic bytes first, preserves animated GIFs and `preserveOriginal: true` untouched,
 * and falls back cleanly on SSR or non-canvas environments.
 */
export async function optimizeImageForUpload(
  file: File,
  options: ClientOptimizeOptions = {},
): Promise<OptimizedImageResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateRasterImage(bytes, file.name, file.type);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const parsedDims = extractImageDimensionsFromBytes(bytes);

  // Preserve original lossless bytes when explicitly requested or when animated GIF
  if (
    options.preserveOriginal ||
    validation.detectedMime === "image/gif" ||
    typeof document === "undefined"
  ) {
    return {
      file,
      wasModified: false,
      originalBytes: file.size,
      outputBytes: file.size,
      width: parsedDims?.width ?? null,
      height: parsedDims?.height ?? null,
    };
  }

  const img = await loadBrowserImageFromBlob(file);
  const srcWidth = img.naturalWidth || parsedDims?.width || 1;
  const srcHeight = img.naturalHeight || parsedDims?.height || 1;
  const plan = computeTargetDimensions(srcWidth, srcHeight, options);

  // Skip re-encoding if already within size & resolution targets and diagramMode wants crisp PNG
  const alreadyCompact = !plan.resized && file.size <= 1.5 * 1024 * 1024;
  if (alreadyCompact && (options.diagramMode || validation.detectedMime === "image/png")) {
    return {
      file,
      wasModified: false,
      originalBytes: file.size,
      outputBytes: file.size,
      width: srcWidth,
      height: srcHeight,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      file,
      wasModified: false,
      originalBytes: file.size,
      outputBytes: file.size,
      width: srcWidth,
      height: srcHeight,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, plan.width, plan.height);

  const outputMime: AllowedImageMime =
    options.diagramMode && (options.preferPngForDiagrams ?? true) && validation.detectedMime === "image/png"
      ? "image/png"
      : validation.detectedMime === "image/png"
        ? "image/webp"
        : validation.detectedMime;

  const quality = Math.min(1, Math.max(0.5, options.quality ?? (options.diagramMode ? 0.94 : 0.88)));
  const blob = await canvasToBlob(canvas, outputMime, outputMime === "image/png" ? undefined : quality);

  if (!blob || (!plan.resized && blob.size >= file.size)) {
    return {
      file,
      wasModified: false,
      originalBytes: file.size,
      outputBytes: file.size,
      width: srcWidth,
      height: srcHeight,
    };
  }

  const nextExt = outputMime === "image/png" ? "png" : outputMime === "image/webp" ? "webp" : "jpg";
  const baseName = validation.sanitizedFileName.replace(/\.[^.]+$/, "");
  const optimizedFile = new File([blob], `${baseName}.${nextExt}`, {
    type: outputMime,
    lastModified: Date.now(),
  });

  return {
    file: optimizedFile,
    wasModified: true,
    originalBytes: file.size,
    outputBytes: optimizedFile.size,
    width: plan.width,
    height: plan.height,
  };
}

/**
 * Client-side crop & 90-degree rotation helper for `MediaAttachmentEditor`.
 */
export async function cropAndRotateImageFile(
  file: File,
  crop: NormalizedCropRect,
  rotationDegrees: 0 | 90 | 180 | 270 = 0,
): Promise<File> {
  if (typeof document === "undefined") {
    throw new Error("Image crop/rotate requires a browser environment.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateRasterImage(bytes, file.name, file.type);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const img = await loadBrowserImageFromBlob(file);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const sx = Math.max(0, Math.min(srcW - 1, Math.round(crop.x * srcW)));
  const sy = Math.max(0, Math.min(srcH - 1, Math.round(crop.y * srcH)));
  const sw = Math.max(1, Math.min(srcW - sx, Math.round(crop.width * srcW)));
  const sh = Math.max(1, Math.min(srcH - sy, Math.round(crop.height * srcH)));

  const swapAxes = rotationDegrees === 90 || rotationDegrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapAxes ? sh : sw;
  canvas.height = swapAxes ? sw : sh;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotationDegrees * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);

  const outMime: AllowedImageMime =
    validation.detectedMime === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvasToBlob(canvas, outMime, outMime === "image/jpeg" ? 0.92 : undefined);
  if (!blob) {
    throw new Error("Failed to export cropped image.");
  }

  const ext = outMime === "image/jpeg" ? "jpg" : "png";
  const baseName = validation.sanitizedFileName.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}-edited.${ext}`, {
    type: outMime,
    lastModified: Date.now(),
  });
}
