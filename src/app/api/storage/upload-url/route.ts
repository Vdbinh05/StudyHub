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
import { sanitizeFilename } from "@/lib/security/sanitize";
import {
  FORBIDDEN_EXTENSIONS,
  MAX_AUDIO_FILE_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMPORT_FILE_BYTES,
} from "@/lib/security/upload";
import { TEMP_STORAGE_BUCKET } from "@/lib/supabase/temp-storage";
import { uuidSchema } from "@/lib/validation/common";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RESTORE_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

const PURPOSE_MAX_BYTES = {
  import: MAX_IMPORT_FILE_BYTES, // 15 MB
  image: MAX_IMAGE_FILE_BYTES, // 5 MB
  audio: MAX_AUDIO_FILE_BYTES, // 10 MB
  restore: MAX_RESTORE_FILE_BYTES, // 12 MB
} as const;

const ALLOWED_EXT_BY_PURPOSE: Record<
  keyof typeof PURPOSE_MAX_BYTES,
  ReadonlySet<string>
> = {
  import: new Set(["docx", "xlsx", "pdf", "csv", "tsv", "txt", "json"]),
  image: new Set(["png", "jpg", "jpeg", "webp", "gif"]),
  audio: new Set(["mp3", "wav", "m4a", "mp4", "aac", "webm", "ogg"]),
  restore: new Set(["json"]),
};

const requestSchema = z.object({
  purpose: z.enum(["import", "image", "audio", "restore"]),
  fileName: z.string().trim().min(1).max(240),
  fileSize: z.number().int().min(1).max(20 * 1024 * 1024),
  contentType: z.string().trim().max(120).optional(),
  studySetId: uuidSchema.optional(),
  imagePurpose: z
    .enum([
      "avatar",
      "question",
      "option",
      "diagram",
      "explanation",
      "passage",
      "attachment",
    ])
    .optional(),
});

function extractExtension(fileName: string): string {
  const safe = sanitizeFilename(fileName);
  const dot = safe.lastIndexOf(".");
  if (dot <= 0 || dot === safe.length - 1) return "";
  return safe.slice(dot + 1).toLowerCase();
}

/**
 * Mints a short-lived Supabase Storage signed upload URL into the private `study-temp`
 * bucket (`{userId}/{purpose}/{uuid}.{ext}`) so files > 3.5 MB upload directly from the
 * browser without hitting Vercel Hobby's 4.5 MB serverless body limit.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.STORAGE_SIGN,
      user.id,
    );
    if (limited) return limited;

    const body = requestSchema.parse(await parseJsonBody(request));
    const maxBytes = PURPOSE_MAX_BYTES[body.purpose];

    if (body.fileSize > maxBytes) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `File exceeds the maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB) for "${body.purpose}".`,
        413,
      );
    }

    const lowerMime = body.contentType?.toLowerCase() ?? "";
    if (lowerMime.includes("svg") || lowerMime.includes("html")) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "SVG and HTML files are not permitted for security reasons.",
        415,
      );
    }

    const ext = extractExtension(body.fileName);
    if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(`.${ext}`)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        `File extension ".${ext}" is not permitted for security reasons.`,
        415,
      );
    }

    const allowedExts = ALLOWED_EXT_BY_PURPOSE[body.purpose];
    if (!ext || !allowedExts.has(ext)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        `Unsupported file extension ".${ext || "(none)"}" for "${body.purpose}".`,
        415,
      );
    }

    // Authorize study set edit access upfront when required
    if (body.purpose === "audio") {
      if (!body.studySetId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "studySetId is required for audio uploads.",
          400,
        );
      }
      await requireStudySetAccess(supabase, body.studySetId, user.id, "edit");
    } else if (body.purpose === "image" && body.imagePurpose !== "avatar") {
      if (!body.studySetId) {
        throw new AppError(
          "VALIDATION_ERROR",
          "studySetId is required for non-avatar image uploads.",
          400,
        );
      }
      await requireStudySetAccess(supabase, body.studySetId, user.id, "edit");
    } else if (body.studySetId) {
      await requireStudySetAccess(supabase, body.studySetId, user.id, "edit");
    }

    const storagePath = `${user.id}/${body.purpose}/${randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage
      .from(TEMP_STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl || !data?.token) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to generate a temporary storage upload URL.",
        500,
      );
    }

    return apiSuccess(
      {
        bucket: TEMP_STORAGE_BUCKET,
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
        maxBytes,
        expiresIn: 7200,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
