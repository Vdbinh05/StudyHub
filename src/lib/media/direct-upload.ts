/**
 * Vercel Hobby-safe client direct-upload transport (`<= 3.5 MB` direct multipart,
 * `> 3.5 MB` 2-step signed PUT to private `study-temp` bucket -> JSON finalize).
 *
 * Strictly client-safe with ZERO `@supabase/supabase-js` import to prevent
 * landing/editor bundle regressions (`V3-PERF-03`).
 */

export const VERCEL_SAFE_DIRECT_PAYLOAD_BYTES = 3_500_000;

export type DirectTempUploadPurpose = "import" | "image" | "audio" | "restore";

export interface UploadToTempStorageInput {
  file: Blob;
  fileName: string;
  purpose: DirectTempUploadPurpose;
  contentType?: string;
  studySetId?: string;
  imagePurpose?: string;
}

export interface UploadToTempStorageResult {
  storagePath: string;
  fileName: string;
  contentType: string;
}

interface SignedUploadUrlResponse {
  data?: {
    bucket: string;
    storagePath: string;
    signedUrl: string;
    token?: string;
    maxBytes?: number;
    expiresIn?: number;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export interface UploadImageSmartInput {
  file: Blob;
  fileName?: string;
  purpose: string;
  studySetId?: string;
  width?: number;
  height?: number;
  altText?: string;
  caption?: string;
}

export interface UploadAudioSmartInput {
  file: Blob;
  fileName?: string;
  studySetId: string;
  purpose?: string;
  durationMs?: number;
}

function resolveFileName(file: Blob, explicitName: string | undefined, fallback: string): string {
  if (explicitName && explicitName.trim().length > 0) return explicitName.trim();
  if (typeof File !== "undefined" && file instanceof File && file.name.trim().length > 0) {
    return file.name.trim();
  }
  return fallback;
}

function resolveContentType(file: Blob, explicitType?: string): string {
  const candidate = (explicitType ?? file.type ?? "").trim();
  return candidate.length > 0 ? candidate : "application/octet-stream";
}

/**
 * Mints a one-time signed upload URL via `POST /api/storage/upload-url` and PUTs
 * the file bytes directly to the private `study-temp` bucket using plain `fetch`.
 */
export async function uploadFileToTempStorage(
  input: UploadToTempStorageInput,
): Promise<UploadToTempStorageResult> {
  const fileName = resolveFileName(input.file, input.fileName, "upload.bin");
  const contentType = resolveContentType(input.file, input.contentType);

  const signRes = await fetch("/api/storage/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      purpose: input.purpose,
      fileName,
      fileSize: input.file.size,
      contentType,
      studySetId: input.studySetId,
      imagePurpose: input.imagePurpose,
    }),
  });

  let signPayload: SignedUploadUrlResponse | null = null;
  try {
    signPayload = (await signRes.json()) as SignedUploadUrlResponse;
  } catch {
    signPayload = null;
  }

  if (!signRes.ok || !signPayload?.data?.signedUrl || !signPayload.data.storagePath) {
    throw new Error(
      signPayload?.error?.message ??
        `Could not prepare direct upload (${signRes.status}).`,
    );
  }

  const { signedUrl, storagePath } = signPayload.data;

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: input.file,
  });

  if (!putRes.ok) {
    throw new Error(
      `Direct upload to temporary storage failed (${putRes.status}). Please try again.`,
    );
  }

  return {
    storagePath,
    fileName,
    contentType,
  };
}

/**
 * Uploads an image via direct multipart `POST /api/uploads/image` when `<= 3.5 MB`,
 * or transparently stages to `study-temp` and finalizes via JSON when `> 3.5 MB`.
 */
export async function uploadImageSmart(input: UploadImageSmartInput): Promise<Response> {
  const fileName = resolveFileName(input.file, input.fileName, "image.png");
  const contentType = resolveContentType(input.file);

  if (input.file.size <= VERCEL_SAFE_DIRECT_PAYLOAD_BYTES) {
    const formData = new FormData();
    formData.append("file", input.file, fileName);
    formData.append("purpose", input.purpose);
    if (input.studySetId) formData.append("studySetId", input.studySetId);
    if (typeof input.width === "number" && Number.isFinite(input.width)) {
      formData.append("width", String(Math.round(input.width)));
    }
    if (typeof input.height === "number" && Number.isFinite(input.height)) {
      formData.append("height", String(Math.round(input.height)));
    }
    if (input.altText) formData.append("altText", input.altText);
    if (input.caption) formData.append("caption", input.caption);

    return fetch("/api/uploads/image", {
      method: "POST",
      body: formData,
    });
  }

  const staged = await uploadFileToTempStorage({
    file: input.file,
    fileName,
    purpose: "image",
    contentType,
    studySetId: input.studySetId,
    imagePurpose: input.purpose,
  });

  return fetch("/api/uploads/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storagePath: staged.storagePath,
      fileName: staged.fileName,
      contentType: staged.contentType,
      purpose: input.purpose,
      studySetId: input.studySetId,
      width:
        typeof input.width === "number" && Number.isFinite(input.width)
          ? Math.round(input.width)
          : undefined,
      height:
        typeof input.height === "number" && Number.isFinite(input.height)
          ? Math.round(input.height)
          : undefined,
      altText: input.altText,
      caption: input.caption,
    }),
  });
}

/**
 * Uploads audio via direct multipart `POST /api/uploads/audio` when `<= 3.5 MB`,
 * or transparently stages to `study-temp` and finalizes via JSON when `> 3.5 MB`.
 */
export async function uploadAudioSmart(input: UploadAudioSmartInput): Promise<Response> {
  const fileName = resolveFileName(input.file, input.fileName, "recording.webm");
  const contentType = resolveContentType(input.file);

  if (input.file.size <= VERCEL_SAFE_DIRECT_PAYLOAD_BYTES) {
    const formData = new FormData();
    formData.append("file", input.file, fileName);
    formData.append("studySetId", input.studySetId);
    if (input.purpose) formData.append("purpose", input.purpose);
    if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
      formData.append("durationMs", String(Math.round(input.durationMs)));
    }

    return fetch("/api/uploads/audio", {
      method: "POST",
      body: formData,
    });
  }

  const staged = await uploadFileToTempStorage({
    file: input.file,
    fileName,
    purpose: "audio",
    contentType,
    studySetId: input.studySetId,
  });

  return fetch("/api/uploads/audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storagePath: staged.storagePath,
      fileName: staged.fileName,
      contentType: staged.contentType,
      studySetId: input.studySetId,
      purpose: input.purpose,
      durationMs:
        typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
          ? Math.round(input.durationMs)
          : undefined,
    }),
  });
}
