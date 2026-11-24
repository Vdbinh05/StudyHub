import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  computeSha256Hex,
  MAX_IMAGE_FILE_BYTES,
  validateImageUpload,
} from "@/lib/security/upload";
import { consumeTempUploadBytes } from "@/lib/supabase/temp-storage";
import { uuidSchema } from "@/lib/validation/common";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const jsonUploadSchema = z.object({
  storagePath: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(240).optional(),
  contentType: z.string().trim().max(120).optional(),
  mimeType: z.string().trim().max(120).optional(),
  purpose: z.string().trim().min(1).max(40).default("question"),
  studySetId: uuidSchema.optional(),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  altText: z.string().trim().max(300).optional(),
  caption: z.string().trim().max(500).optional(),
});

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
 * Supports both direct `multipart/form-data` (`<= 3.5 MB`) and JSON `{ storagePath }` finalize
 * from the private `study-temp` bucket (for files `> 3.5 MB` on Vercel Hobby).
 * Validates PNG/JPEG/WebP/GIF magic bytes, blocks SVG, enforces 5 MB cap, registers `media_assets`
 * with SHA-256 hash, and returns canonical `id`/`mediaId`, `path`, `proxyUrl`, and `signedUrl`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let cleanupTemp: (() => Promise<void>) | null = null;
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.UPLOAD,
      user.id,
    );
    if (limited) return limited;

    const reqContentType = (request.headers.get("content-type") ?? "").toLowerCase();
    const isJsonMode = reqContentType.includes("application/json");

    let bytes: Uint8Array;
    let fileName: string;
    let declaredMime: string;
    let rawPurpose: string;
    let rawSetId: string;
    let width: number | null;
    let height: number | null;

    if (isJsonMode) {
      const body = jsonUploadSchema.parse(await parseJsonBody(request, 64 * 1024));
      const staged = await consumeTempUploadBytes(supabase, {
        userId: user.id,
        storagePath: body.storagePath,
        expectedPurpose: "image",
        maxBytes: MAX_IMAGE_FILE_BYTES,
      });
      cleanupTemp = staged.cleanup;
      bytes = staged.bytes;
      fileName =
        body.fileName ??
        body.storagePath.split("/").pop() ??
        "image.png";
      declaredMime = body.contentType ?? body.mimeType ?? "";
      rawPurpose = body.purpose.trim().toLowerCase();
      rawSetId = body.studySetId ?? "";
      width = body.width ?? null;
      height = body.height ?? null;
    } else {
      const formData = await request.formData().catch(() => {
        throw new AppError("BAD_REQUEST", "Expected multipart/form-data payload.", 400);
      });

      const fileEntry = formData.get("file");
      if (!(fileEntry instanceof File)) {
        throw new AppError("VALIDATION_ERROR", "Image file is required.", 400);
      }

      rawPurpose = String(formData.get("purpose") ?? "question")
        .trim()
        .toLowerCase();

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

      bytes = new Uint8Array(await fileEntry.arrayBuffer());
      fileName = fileEntry.name;
      declaredMime = fileEntry.type;
      rawSetId = String(formData.get("studySetId") ?? "").trim();
      width = parseOptionalPositiveInt(formData.get("width"), 20_000);
      height = parseOptionalPositiveInt(formData.get("height"), 20_000);
    }

    if (!ALLOWED_PURPOSES.has(rawPurpose)) {
      throw new AppError(
        "VALIDATION_ERROR",
        'Invalid purpose. Expected "avatar", "question", "option", "diagram", "explanation", "passage", or "attachment".',
        400,
      );
    }

    const validation = validateImageUpload(bytes, fileName, declaredMime);

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
  } finally {
    if (cleanupTemp) {
      await cleanupTemp();
    }
  }
}
