import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { MAX_IMAGE_FILE_BYTES, validateImageUpload } from "@/lib/security/upload";
import { uuidSchema } from "@/lib/validation/common";

const ALLOWED_PURPOSES = new Set(["avatar", "question", "option"]);
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Server-side validated raster image upload into private `study-media` bucket (SH-019 / SEC-011).
 * Validates PNG/JPEG/WebP/GIF magic bytes, blocks SVG, enforces 5 MB cap, uses canonical
 * RLS-compliant object paths, and returns both canonical `path` and short-lived `signedUrl`.
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

    const rawPurpose = String(formData.get("purpose") ?? "question").trim().toLowerCase();
    if (!ALLOWED_PURPOSES.has(rawPurpose)) {
      throw new AppError(
        "VALIDATION_ERROR",
        'Invalid purpose. Expected "avatar", "question", or "option".',
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
    if (rawPurpose === "avatar") {
      storagePath = `avatars/${user.id}/${randomUUID()}.${validation.extension}`;
    } else {
      const rawSetId = String(formData.get("studySetId") ?? "").trim();
      const studySetId = uuidSchema.parse(rawSetId);
      const access = await requireStudySetAccess(
        supabase,
        studySetId,
        user.id,
        "edit",
      );
      // Canonical owner-scoped path matching Storage RLS `can_access_study_media_path`
      storagePath = `${access.studySet.owner_id}/${studySetId}/${randomUUID()}.${validation.extension}`;
    }

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
        path: storagePath,
        proxyUrl,
        signedUrl: signedData.signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        mimeType: validation.detectedMime,
        size: validation.sizeBytes,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
