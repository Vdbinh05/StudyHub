import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import {
  computeSha256Hex,
  MAX_AUDIO_FILE_BYTES,
  validateAudioUpload,
} from "@/lib/security/upload";
import { uuidSchema } from "@/lib/validation/common";

const ALLOWED_AUDIO_PURPOSES = new Set([
  "question",
  "listening",
  "passage",
  "flashcard",
  "audio",
  "option",
]);
const SIGNED_URL_TTL_SECONDS = 3600;

function parseOptionalNonNegInt(raw: FormDataEntryValue | null, max: number): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

/**
 * Server-side validated audio upload into private `study-media` bucket (V3.0).
 * Validates MP3/WAV/M4A/AAC/WebM/OGG magic bytes, rejects SVG/HTML/executables,
 * enforces 10 MB cap, registers `media_assets`, and returns canonical proxy + signed URLs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.AUDIO_UPLOAD, user.id);
    if (limited) return limited;

    const formData = await request.formData().catch(() => {
      throw new AppError("BAD_REQUEST", "Expected multipart/form-data payload.", 400);
    });

    const fileEntry = formData.get("file");
    if (!(fileEntry instanceof File)) {
      throw new AppError("VALIDATION_ERROR", "Audio file is required.", 400);
    }

    const rawPurpose = String(formData.get("purpose") ?? "question")
      .trim()
      .toLowerCase();
    if (!ALLOWED_AUDIO_PURPOSES.has(rawPurpose)) {
      throw new AppError("VALIDATION_ERROR", "Invalid audio upload purpose.", 400);
    }

    if (fileEntry.size === 0) {
      throw new AppError("VALIDATION_ERROR", "Uploaded audio file is empty.", 400);
    }
    if (fileEntry.size > MAX_AUDIO_FILE_BYTES) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `Audio file exceeds maximum size (${Math.round(MAX_AUDIO_FILE_BYTES / (1024 * 1024))} MB).`,
        413,
      );
    }

    const rawSetId = String(formData.get("studySetId") ?? "").trim();
    const studySetId = uuidSchema.parse(rawSetId);
    const access = await requireStudySetAccess(supabase, studySetId, user.id, "edit");

    const bytes = new Uint8Array(await fileEntry.arrayBuffer());
    const validation = validateAudioUpload(bytes, fileEntry.name, fileEntry.type);

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

    const sha256 = computeSha256Hex(bytes);
    const durationMs = parseOptionalNonNegInt(formData.get("durationMs"), 3_600_000);
    const storagePath = `${access.studySet.owner_id}/${studySetId}/audio-${randomUUID()}.${validation.extension}`;

    const { error: uploadErr } = await supabase.storage
      .from("study-media")
      .upload(storagePath, bytes, {
        contentType: validation.detectedMime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadErr) {
      throw new AppError("INTERNAL_ERROR", "Failed to upload audio to storage.", 500);
    }

    const { data: assetRow, error: assetErr } = await supabase
      .from("media_assets")
      .insert({
        owner_id: user.id,
        study_set_id: studySetId,
        kind: "audio",
        storage_bucket: "study-media",
        storage_path: storagePath,
        mime_type: validation.detectedMime,
        file_name: validation.sanitizedFileName,
        size_bytes: validation.sizeBytes,
        sha256_hash: sha256,
        duration_ms: durationMs,
      })
      .select("id")
      .single();

    if (assetErr) {
      // Roll back storage object if DB catalog insert fails
      await supabase.storage.from("study-media").remove([storagePath]).catch(() => {});
      throw assetErr;
    }

    const { data: signedData, error: signErr } = await supabase.storage
      .from("study-media")
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signedData?.signedUrl) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Audio uploaded, but failed to generate a signed playback URL.",
        500,
      );
    }

    const proxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`;

    return apiSuccess(
      {
        id: assetRow.id,
        mediaId: assetRow.id,
        kind: "audio" as const,
        path: storagePath,
        proxyUrl,
        signedUrl: signedData.signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
        mimeType: validation.detectedMime,
        size: validation.sizeBytes,
        sha256,
        durationMs,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
