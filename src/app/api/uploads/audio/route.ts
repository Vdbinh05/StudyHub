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
  MAX_AUDIO_FILE_BYTES,
  validateAudioUpload,
} from "@/lib/security/upload";
import { consumeTempUploadBytes } from "@/lib/supabase/temp-storage";
import { uuidSchema } from "@/lib/validation/common";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_AUDIO_PURPOSES = new Set([
  "question",
  "listening",
  "passage",
  "flashcard",
  "audio",
  "option",
]);
const SIGNED_URL_TTL_SECONDS = 3600;

const jsonAudioUploadSchema = z.object({
  storagePath: z.string().trim().min(1).max(300),
  fileName: z.string().trim().min(1).max(240).optional(),
  contentType: z.string().trim().max(120).optional(),
  mimeType: z.string().trim().max(120).optional(),
  studySetId: uuidSchema,
  purpose: z.string().trim().min(1).max(40).default("question"),
  durationMs: z.number().int().min(0).max(3_600_000).nullable().optional(),
});

function parseOptionalNonNegInt(raw: FormDataEntryValue | null, max: number): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

/**
 * Server-side validated audio upload into private `study-media` bucket (V3.0).
 * Supports both direct `multipart/form-data` (`<= 3.5 MB`) and JSON `{ storagePath }` finalize
 * from the private `study-temp` bucket (for files `> 3.5 MB` on Vercel Hobby).
 * Validates MP3/WAV/M4A/AAC/WebM/OGG magic bytes, rejects SVG/HTML/executables,
 * enforces 10 MB cap, registers `media_assets`, and returns canonical proxy + signed URLs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let cleanupTemp: (() => Promise<void>) | null = null;
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.AUDIO_UPLOAD,
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
    let durationMs: number | null;

    if (isJsonMode) {
      const body = jsonAudioUploadSchema.parse(
        await parseJsonBody(request, 64 * 1024),
      );
      const staged = await consumeTempUploadBytes(supabase, {
        userId: user.id,
        storagePath: body.storagePath,
        expectedPurpose: "audio",
        maxBytes: MAX_AUDIO_FILE_BYTES,
      });
      cleanupTemp = staged.cleanup;
      bytes = staged.bytes;
      fileName =
        body.fileName ??
        body.storagePath.split("/").pop() ??
        "recording.webm";
      declaredMime = body.contentType ?? body.mimeType ?? "";
      rawPurpose = body.purpose.trim().toLowerCase();
      rawSetId = body.studySetId;
      durationMs = body.durationMs ?? null;
    } else {
      const formData = await request.formData().catch(() => {
        throw new AppError("BAD_REQUEST", "Expected multipart/form-data payload.", 400);
      });

      const fileEntry = formData.get("file");
      if (!(fileEntry instanceof File)) {
        throw new AppError("VALIDATION_ERROR", "Audio file is required.", 400);
      }

      rawPurpose = String(formData.get("purpose") ?? "question")
        .trim()
        .toLowerCase();

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

      rawSetId = String(formData.get("studySetId") ?? "").trim();
      bytes = new Uint8Array(await fileEntry.arrayBuffer());
      fileName = fileEntry.name;
      declaredMime = fileEntry.type;
      durationMs = parseOptionalNonNegInt(formData.get("durationMs"), 3_600_000);
    }

    if (!ALLOWED_AUDIO_PURPOSES.has(rawPurpose)) {
      throw new AppError("VALIDATION_ERROR", "Invalid audio upload purpose.", 400);
    }

    const studySetId = uuidSchema.parse(rawSetId);
    const access = await requireStudySetAccess(supabase, studySetId, user.id, "edit");

    const validation = validateAudioUpload(bytes, fileName, declaredMime);

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

    // Content-hash deduplication (DB-13 / V32-048): reuse active identical audio blob within the same study set
    const { data: existingAsset } = await supabase
      .from("media_assets")
      .select("id, storage_path, mime_type, size_bytes, duration_ms")
      .eq("owner_id", user.id)
      .eq("study_set_id", studySetId)
      .eq("kind", "audio")
      .eq("sha256_hash", sha256)
      .eq("is_orphaned", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingAsset?.storage_path) {
      const { data: existingSigned, error: existingSignErr } = await supabase.storage
        .from("study-media")
        .createSignedUrl(existingAsset.storage_path, SIGNED_URL_TTL_SECONDS);

      if (!existingSignErr && existingSigned?.signedUrl) {
        const proxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(existingAsset.storage_path)}&redirect=1`;
        return apiSuccess(
          {
            id: existingAsset.id,
            mediaId: existingAsset.id,
            kind: "audio" as const,
            path: existingAsset.storage_path,
            proxyUrl,
            signedUrl: existingSigned.signedUrl,
            expiresIn: SIGNED_URL_TTL_SECONDS,
            mimeType: existingAsset.mime_type,
            size: existingAsset.size_bytes,
            sha256,
            durationMs: existingAsset.duration_ms ?? durationMs,
            deduplicated: true,
          },
          undefined,
          { status: 201 },
        );
      }
    }

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
  } finally {
    if (cleanupTemp) {
      await cleanupTemp();
    }
  }
}
