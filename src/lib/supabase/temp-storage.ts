import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/security/errors";
import { isStrictUuid } from "@/lib/security/sanitize";
import type { Database } from "@/types/database";

export const TEMP_STORAGE_BUCKET = "study-temp" as const;

export type TempUploadPurpose =
  | "import"
  | "import-media"
  | "image"
  | "audio"
  | "restore";

const ALLOWED_PURPOSES = new Set<TempUploadPurpose>([
  "import",
  "import-media",
  "image",
  "audio",
  "restore",
]);

const TEMP_FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}\.[a-z0-9]{1,10}$/i;

/**
 * Strictly verifies that `storagePath` is a canonical user-owned path inside `study-temp`:
 * `{userId}/{purpose}/{fileName}` with zero traversal segments and optional purpose check.
 */
export function isOwnedTempStoragePath(
  storagePath: string | null | undefined,
  userId: string,
  expectedPurpose?: TempUploadPurpose,
): boolean {
  if (!storagePath || !isStrictUuid(userId)) {
    return false;
  }
  const trimmed = storagePath.trim();
  if (
    !trimmed ||
    trimmed.length > 320 ||
    trimmed.includes("..") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/") ||
    /[\x00-\x1F\x7F]/.test(trimmed)
  ) {
    return false;
  }

  const segments = trimmed.split("/");
  if (segments.length !== 3) {
    return false;
  }

  const [ownerSegment, purposeSegment, fileSegment] = segments;
  if (ownerSegment.toLowerCase() !== userId.toLowerCase()) {
    return false;
  }

  if (!ALLOWED_PURPOSES.has(purposeSegment as TempUploadPurpose)) {
    return false;
  }

  if (expectedPurpose && purposeSegment !== expectedPurpose) {
    return false;
  }

  return TEMP_FILENAME_RE.test(fileSegment);
}

/**
 * Downloads bytes from the private `study-temp` bucket under the caller's RLS-enforced
 * session, verifies path ownership and byte-length bounds, and returns an idempotent
 * `cleanup()` callback that MUST be invoked in a `finally` block.
 */
export async function consumeTempUploadBytes(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    storagePath: string;
    expectedPurpose: TempUploadPurpose;
    maxBytes: number;
  },
): Promise<{ bytes: Uint8Array; cleanup: () => Promise<void> }> {
  const { userId, storagePath, expectedPurpose, maxBytes } = params;
  const normalizedPath = storagePath.trim();

  if (!isOwnedTempStoragePath(normalizedPath, userId, expectedPurpose)) {
    throw new AppError(
      "FORBIDDEN",
      "Invalid or unauthorized temporary storage path.",
      403,
    );
  }

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await cleanupTempObjects(supabase, [normalizedPath]);
  };

  const { data: blob, error } = await supabase.storage
    .from(TEMP_STORAGE_BUCKET)
    .download(normalizedPath);

  if (error || !blob) {
    throw new AppError(
      "NOT_FOUND",
      "Temporary uploaded file was not found or has expired. Please upload again.",
      404,
    );
  }

  if (blob.size === 0) {
    await cleanup();
    throw new AppError("VALIDATION_ERROR", "Uploaded file is empty.", 400);
  }

  if (blob.size > maxBytes) {
    await cleanup();
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `Uploaded file exceeds the maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`,
      413,
    );
  }

  const arrayBuf = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  if (bytes.byteLength === 0) {
    await cleanup();
    throw new AppError("VALIDATION_ERROR", "Uploaded file is empty.", 400);
  }

  if (bytes.byteLength > maxBytes) {
    await cleanup();
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `Uploaded file exceeds the maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`,
      413,
    );
  }

  return { bytes, cleanup };
}

/**
 * Stages a validated raster image extracted from a multimedia DOCX into the caller's
 * private `study-temp/{userId}/import-media/` namespace (deduplicated by SHA-256) so large
 * previews never exceed Vercel's 4.5 MB outbound/inbound payload limits.
 */
export async function stageTempImportMedia(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    sha256: string;
    extension: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<{ storagePath: string }> {
  const { userId, sha256, extension, mimeType, bytes } = params;
  const cleanHash = sha256.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 32);
  const cleanExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "png";
  const storagePath = `${userId}/import-media/img-${cleanHash}.${cleanExt}`;

  if (!isOwnedTempStoragePath(storagePath, userId, "import-media")) {
    throw new AppError("INTERNAL_ERROR", "Failed to construct temporary media path.", 500);
  }

  const { error } = await supabase.storage
    .from(TEMP_STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      cacheControl: "1800",
      upsert: true,
    });

  if (error) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Failed to stage extracted import image in temporary storage.",
      500,
    );
  }

  return { storagePath };
}

/**
 * Best-effort batched removal of temporary objects from `study-temp`.
 * Never throws so `finally` blocks stay safe.
 */
export async function cleanupTempObjects(
  supabase: SupabaseClient<Database>,
  storagePaths: string[],
): Promise<void> {
  const uniquePaths = Array.from(
    new Set(storagePaths.map((p) => p.trim()).filter(Boolean)),
  );
  if (uniquePaths.length === 0) return;

  for (let i = 0; i < uniquePaths.length; i += 100) {
    const chunk = uniquePaths.slice(i, i + 100);
    await supabase.storage
      .from(TEMP_STORAGE_BUCKET)
      .remove(chunk)
      .catch(() => {});
  }
}
