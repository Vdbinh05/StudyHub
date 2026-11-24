import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  computeSha256Hex,
  MAX_IMAGE_FILE_BYTES,
  validateImageUpload,
} from "@/lib/security/upload";
import { uuidSchema } from "@/lib/validation/common";

const ALLOWED_PURPOSES = new Set([
  "avatar",
  "question",
  "option",
  "diagram",
  "explanation",
  "passage",
  "attachment",
]);
const SIGNED_URL_TTL_SECONDS = 3600;

function parseOptionalPositiveInt(
  raw: FormDataEntryValue | null,
  max: number,
): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/**
 * Server-side validated raster image upload into private `study-media` bucket (SH-019 / V3.0).
 * Validates PNG/JPEG/WebP/GIF magic bytes, blocks SVG, enforces 5 MB cap, registers `media_assets`
 * with SHA-256 hash, and returns canonical `id`/`mediaId`, `path`, `proxyUrl`, and `signedUrl`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.UPLOAD, user.id);
    if (limited) return limited;

    const formData = await request.formData().catch(() => {
      throw new AppError("BAD_REQUEST", "Expected multipart/form-data payload.", 400);
    });

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      throw new AppError("VALIDATION_ERROR", "Image file is required.", 400);
    }

    const rawPurpose = String(formData.get("purpose") ?? "question")
      .trim()
      .toLowerCase();
    if (!ALLOWED_PURPOSES.has(rawPurpose)) {
      throw new AppError(
        "VALIDATION_ERROR",
        'Invalid purpose. Expected "avatar", "question", "option", "diagram", "explanation", "passage", or "attachment".',
        400,
      );
    }

    if (fileEntry.size === 0) {
      throw new AppError("VALIDATION_ERROR", "Uploaded image file is empty.", 400);
    }
    if (fileEntry.size > MAX_IMAGE_FILE_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `Image exceeds maximum size (${Math.round(MAX_IMAGE_FILE_BYTES / (1024 * 1024))} MB).`,
        413,
      );
    }

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());
    const validation = validateImageUpload(bytes, fileEntry.name, fileEntry.type);

    if (!validation.valid) {
      throw new AppError(
        validation.code === "FILE_TOO_LARGE"
          ? "PAYLOAD_TOO_LARGE"
          : validation.status === 415
            ? "UNSUPPORTED_MEDIA_TYPE"
            : "VALIDATION_ERROR",
        validation.message,
        validation.status,
      );
    }

    let storagePath: string;
    let studySetId: string | null = null;
    if (rawPurpose === "avatar") {
      storagePath = `avatars/${user.id}/${randomUUID()}.${validation.extension}`;
    } else {
      const rawSetId = String(formData.get("studySetId") ?? "").trim();
      studySetId = uuidSchema.parse(rawSetId);
      const access = await requireStudySetAccess(
        supabase,
        studySetId,
        user.id,
        "edit",
      );
      storagePath = `${access.studySet.owner_id}/${studySetId}/${randomUUID()}.${validation.extension}`;
    }

    const sha256 = computeSha256Hex(bytes);
    const width = parseOptionalPositiveInt(formData.get("width"), 20_000);
    const height = parseOptionalPositiveInt(formData.get("height"), 20_000);

    const { error: uploadErr } = await supabase.storage
      .from("study-media")
      .upload(storagePath, bytes, {
        contentType: validation.detectedMime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadErr) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to upload image to storage.",
        500,
      );
    }

    const { data: assetRow, error: assetErr } = await supabase
      .from("media_assets")
      .insert({
        owner_id: user.id,
        study_set_id: studySetId,
        kind: "image",
        storage_bucket: "study-media",
        storage_path: storagePath,
        mime_type: validation.detectedMime,
        file_name: validation.sanitizedFileName,
        size_bytes: validation.sizeBytes,
        sha256_hash: sha256,
        width,
        height,
      })
      .select("id")
      .single();

    if (assetErr) {
      await supabase.storage.from("study-media").remove([storagePath]).catch(() => {});
      throw assetErr;
    }

    const { data: signedData, error: signErr } = await supabase.storage
      .from("study-media")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signedData?.signedUrl) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Image uploaded, but failed to generate a signed view URL.",
        500,
      );
    }

    const proxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`;

    return apiSuccess(
      {
        id: assetRow.id,
        mediaId: assetRow.id,
        kind: "image" as const,
        path: storagePath,
        proxyUrl,
        signedUrl: signedData.signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        mimeType: validation.detectedMime,
        size: validation.sizeBytes,
        sha256,
        width,
        height,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
