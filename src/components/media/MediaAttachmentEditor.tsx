"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Crop,
  Eye,
  FileAudio,
  ImageOff,
  ImagePlus,
  Loader2,
  Mic,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import {
  AudioRecorderControl,
  type UploadedAudioPayload,
} from "@/components/audio/AudioRecorderControl";
import { ApiError, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { ImageLightbox, type LightboxImageItem } from "@/components/media/ImageLightbox";
import { useResilientImage } from "@/components/media/use-resilient-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOptionalI18n } from "@/lib/i18n";
import { uploadAudioSmart, uploadImageSmart } from "@/lib/media/direct-upload";
import type { QuestionMediaAttachment } from "@/lib/media/question-media";
import { appendMediaRetryParam, resolveSafeMediaUrl } from "@/lib/media/urls";
import {
  cropAndRotateImageFile,
  extractImageDimensionsFromBytes,
  optimizeImageForUpload,
  validateAudioUpload,
  validateMediaUpload,
  validateRasterImage,
  type NormalizedCropRect,
} from "@/lib/media/validation";
import { cn } from "@/lib/utils";
import type { MediaAttachmentRole, MediaKind } from "@/types/v3";

export interface EditableMediaAttachment {
  /** Local stable key or persisted relation ID. */
  localId: string;
  media_id?: string | null;
  kind: MediaKind;
  storage_path: string;
  url: string;
  mime_type: string;
  file_name: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  alt_text: string;
  caption: string;
  sort_order: number;
}

export interface MediaAttachmentEditorHandle {
  pasteFiles: (files: File[]) => void;
  focusZone: () => void;
}

export interface MediaAttachmentEditorProps {
  studySetId: string;
  /** Target slot: supports question prompts, back, explanations, AND individual answer options (including image-only options). */
  role?: MediaAttachmentRole;
  value: EditableMediaAttachment[];
  onChange: (next: EditableMediaAttachment[]) => void;
  allowImages?: boolean;
  allowAudio?: boolean;
  allowVoiceRecording?: boolean;
  maxItems?: number;
  compact?: boolean;
  /** Default true for technical diagrams so lines/labels stay sharp. */
  defaultPreserveOriginal?: boolean;
  label?: string;
  addButtonLabel?: string;
  zoneName?: string;
  helperText?: string;
  disabled?: boolean;
  className?: string;
  /** Fires whenever a brand-new `media_id` is uploaded in this editor session (for safe cancel cleanup). */
  onMediaUploaded?: (mediaId: string) => void;
  /** Optional custom uploader override (for testing or specialized routes). */
  onUploadFile?: (
    file: File,
    kind: MediaKind,
  ) => Promise<Omit<EditableMediaAttachment, "localId" | "alt_text" | "caption" | "sort_order">>;
}

interface CropSessionState {
  index: number;
  sourceFile: File;
  previewUrl: string;
  rotation: 0 | 90 | 180 | 270;
  crop: NormalizedCropRect;
}

function makeLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Extracts image File objects from a ClipboardEvent DataTransfer without interfering
 * with normal text paste operations.
 */
export function extractClipboardImageFiles(
  clipboardData: DataTransfer | null | undefined,
): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const entry = clipboardData.items[i];
      if (entry.kind === "file" && entry.type.startsWith("image/")) {
        const f = entry.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  if (files.length === 0 && clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const f = clipboardData.files[i];
      if (f && f.type.startsWith("image/")) {
        files.push(f);
      }
    }
  }
  return files;
}

/**
 * Converts hydrated `QuestionMediaAttachment[]` into `EditableMediaAttachment[]` for editing.
 */
export function questionMediaAttachmentsToEditable(
  attachments: readonly QuestionMediaAttachment[],
): EditableMediaAttachment[] {
  return attachments.map((att, idx) => {
    const isSyntheticId = !att.media_id || att.media_id.startsWith("legacy:");
    const mime = att.mime_type || att.media?.mime_type || "image/png";
    const fileName =
      att.media?.file_name ||
      att.alt_text?.trim() ||
      (mime.includes("jpeg") ? `image-${idx + 1}.jpg` : `image-${idx + 1}.png`);
    return {
      localId: att.id || (isSyntheticId ? `legacy-${idx}-${att.url}` : att.media_id),
      media_id: isSyntheticId ? null : att.media_id,
      kind: mime.toLowerCase().startsWith("audio/") || att.role === "audio" ? "audio" : "image",
      storage_path: att.storage_path || att.media?.storage_path || "",
      url: att.url,
      mime_type: mime,
      file_name: fileName,
      size_bytes: att.media?.size_bytes ?? 0,
      width: att.width ?? att.media?.width ?? null,
      height: att.height ?? att.media?.height ?? null,
      duration_ms: att.media?.duration_ms ?? null,
      alt_text: att.alt_text ?? "",
      caption: att.caption ?? "",
      sort_order: idx,
    };
  });
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function parseSmartUploadResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson
    ? ((await response.json().catch(() => null)) as
        | {
            data?: Record<string, unknown>;
            error?: { code?: string; message?: string; details?: unknown };
            message?: string;
          }
        | null)
    : null;

  if (!response.ok) {
    if (payload?.error) {
      throw new ApiError(
        payload.error.code ?? "API_ERROR",
        payload.error.message ?? response.statusText,
        response.status,
        payload.error.details,
      );
    }
    if (payload?.message) {
      throw new ApiError("API_ERROR", payload.message, response.status);
    }
    throw new ApiError("HTTP_ERROR", response.statusText || "Upload failed", response.status);
  }

  return (payload?.data ?? payload ?? {}) as Record<string, unknown>;
}

function AttachmentImageThumbnail({
  url,
  alt,
  vi,
  size = "default",
  onPreview,
}: {
  url: string;
  alt: string;
  vi: boolean;
  size?: "default" | "compact";
  onPreview: () => void;
}) {
  const { resolvedSrc, hasError, handleLoad, handleError, retry } = useResilientImage(url);
  const boxCls = size === "compact" ? "size-16" : "size-20";

  if (hasError) {
    return (
      <div
        className={cn(
          "flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-1 text-center",
          boxCls,
        )}
      >
        <ImageOff className="size-4 text-destructive/80" aria-hidden="true" />
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className="size-2.5" aria-hidden="true" />
          <span>{vi ? "Thử lại" : "Retry"}</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPreview}
      aria-label={vi ? "Xem trước ảnh phóng to" : "Preview enlarged image"}
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        boxCls,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolvedSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className="max-h-full max-w-full object-contain"
      />
    </button>
  );
}

export const MediaAttachmentEditor = React.forwardRef<
  MediaAttachmentEditorHandle,
  MediaAttachmentEditorProps
>(function MediaAttachmentEditor(
  {
    studySetId,
    role = "prompt",
    value,
    onChange,
    allowImages = true,
    allowAudio = false,
    allowVoiceRecording = false,
    maxItems = 8,
    compact = false,
    defaultPreserveOriginal = false,
    label,
    addButtonLabel,
    zoneName,
    helperText,
    disabled = false,
    className,
    onMediaUploaded,
    onUploadFile,
  },
  ref,
) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const baseId = React.useId();

  const zoneRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const replaceInputRef = React.useRef<HTMLInputElement>(null);
  const replaceIndexRef = React.useRef<number | null>(null);
  const localFilesCacheRef = React.useRef<Map<string, File>>(new Map());
  const latestValueRef = React.useRef(value);
  React.useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<{
    current: number;
    total: number;
    fileName: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [pasteHintMsg, setPasteHintMsg] = React.useState<string | null>(null);
  const [failedFiles, setFailedFiles] = React.useState<File[]>([]);
  const [preserveOriginal, setPreserveOriginal] = React.useState(defaultPreserveOriginal);
  const [showRecorder, setShowRecorder] = React.useState(false);
  const [editingAltId, setEditingAltId] = React.useState<string | null>(null);
  const [previewLightbox, setPreviewLightbox] = React.useState<{
    open: boolean;
    index: number;
  }>({ open: false, index: 0 });
  const [dragReorderIdx, setDragReorderIdx] = React.useState<number | null>(null);
  const [cropSession, setCropSession] = React.useState<CropSessionState | null>(null);
  const [isApplyingCrop, setIsApplyingCrop] = React.useState(false);

  React.useEffect(() => {
    return () => {
      if (cropSession?.previewUrl) {
        URL.revokeObjectURL(cropSession.previewUrl);
      }
    };
  }, [cropSession]);

  // Mobile-friendly camera/gallery accept while magic-byte validation strictly rejects SVG/invalid files
  const acceptAttr = React.useMemo(() => {
    const parts: string[] = [];
    if (allowImages) parts.push("image/*");
    if (allowAudio) parts.push("audio/*");
    return parts.join(",");
  }, [allowImages, allowAudio]);

  const uploadSingleFile = React.useCallback(
    async (
      rawFile: File,
      replaceAtIndex: number | null,
      baseLength: number,
    ): Promise<EditableMediaAttachment | null> => {
      const bytes = new Uint8Array(await rawFile.arrayBuffer());
      const validation =
        allowImages && allowAudio
          ? validateMediaUpload(bytes, rawFile.name, rawFile.type)
          : allowImages
            ? validateRasterImage(bytes, rawFile.name, rawFile.type)
            : validateAudioUpload(bytes, rawFile.name, rawFile.type);

      if (!validation.valid) {
        setErrorMsg(validation.message);
        return null;
      }

      let fileToUpload = rawFile;
      let width: number | null = null;
      let height: number | null = null;

      if (validation.kind === "image") {
        const dims = extractImageDimensionsFromBytes(bytes);
        width = dims?.width ?? null;
        height = dims?.height ?? null;

        try {
          const optimized = await optimizeImageForUpload(rawFile, {
            preserveOriginal,
            diagramMode: role === "diagram_base",
          });
          fileToUpload = optimized.file;
          width = optimized.width ?? width;
          height = optimized.height ?? height;
        } catch {
          // Keep validated original if canvas decode fails (e.g., non-browser test env)
        }
      }

      let uploaded: Omit<
        EditableMediaAttachment,
        "localId" | "alt_text" | "caption" | "sort_order"
      >;

      if (onUploadFile) {
        uploaded = await onUploadFile(fileToUpload, validation.kind);
      } else {
        const response =
          validation.kind === "audio"
            ? await uploadAudioSmart({
                file: fileToUpload,
                fileName: fileToUpload.name,
                studySetId,
                purpose:
                  role === "option"
                    ? "option"
                    : role === "passage"
                      ? "passage"
                      : role === "audio"
                        ? "audio"
                        : "question",
              })
            : await uploadImageSmart({
                file: fileToUpload,
                fileName: fileToUpload.name,
                studySetId,
                purpose:
                  role === "option"
                    ? "option"
                    : role === "diagram_base"
                      ? "diagram"
                      : role === "explanation"
                        ? "explanation"
                        : role === "passage"
                          ? "passage"
                          : "question",
                width: width && width > 0 ? Math.round(width) : undefined,
                height: height && height > 0 ? Math.round(height) : undefined,
              });

        const d = await parseSmartUploadResponse(response);
        const storagePath = String(d.path ?? d.storage_path ?? "");
        const resolvedUrl =
          resolveSafeMediaUrl({
            proxy_url:
              typeof d.proxyUrl === "string"
                ? d.proxyUrl
                : typeof d.proxy_url === "string"
                  ? d.proxy_url
                  : null,
            storage_path: storagePath,
          }) ?? "";

        const uploadedMediaId =
          typeof d.mediaId === "string"
            ? d.mediaId
            : typeof d.id === "string"
              ? d.id
              : null;

        uploaded = {
          media_id: uploadedMediaId,
          kind: validation.kind,
          storage_path: storagePath,
          url: resolvedUrl,
          mime_type: String(d.mimeType ?? d.mime_type ?? validation.detectedMime),
          file_name: fileToUpload.name,
          size_bytes: Number(d.size ?? d.size_bytes ?? fileToUpload.size),
          width,
          height,
          duration_ms: typeof d.durationMs === "number" ? d.durationMs : null,
        };
      }

      if (uploaded.media_id && onMediaUploaded) {
        onMediaUploaded(uploaded.media_id);
      }

      const currentItems = latestValueRef.current;
      const existing = replaceAtIndex !== null ? currentItems[replaceAtIndex] : undefined;
      const localId = existing?.localId ?? makeLocalId();
      if (validation.kind === "image") {
        localFilesCacheRef.current.set(localId, fileToUpload);
      }

      return {
        ...uploaded,
        localId,
        alt_text: existing?.alt_text ?? "",
        caption: existing?.caption ?? "",
        sort_order: replaceAtIndex ?? baseLength,
      };
    },
    [allowImages, allowAudio, preserveOriginal, role, onUploadFile, studySetId, onMediaUploaded],
  );

  const handleFiles = React.useCallback(
    async (files: FileList | File[], replaceAtIndex: number | null = null) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0 || disabled) return;

      setErrorMsg(null);
      setPasteHintMsg(null);
      setFailedFiles([]);
      setIsUploading(true);

      const nextList = [...latestValueRef.current];
      const newlyFailed: File[] = [];

      try {
        if (replaceAtIndex !== null) {
          setUploadProgress({ current: 1, total: 1, fileName: fileArray[0].name });
          try {
            const result = await uploadSingleFile(fileArray[0], replaceAtIndex, nextList.length);
            if (result) {
              nextList[replaceAtIndex] = result;
            }
          } catch (err) {
            newlyFailed.push(fileArray[0]);
            setErrorMsg(
              getFriendlyErrorMessage(
                err,
                locale,
                vi ? "Không thể tải tệp lên. Vui lòng thử lại." : "Upload failed. Please try again.",
              ),
            );
          }
        } else {
          const remainingSlots = Math.max(0, maxItems - nextList.length);
          const batch = fileArray.slice(0, remainingSlots);
          if (fileArray.length > remainingSlots) {
            setErrorMsg(
              vi
                ? `Chỉ có thể đính kèm tối đa ${maxItems} tệp cho mục này.`
                : `Maximum of ${maxItems} media attachment(s) allowed here.`,
            );
          }

          for (let i = 0; i < batch.length; i += 1) {
            const f = batch[i];
            setUploadProgress({ current: i + 1, total: batch.length, fileName: f.name });
            try {
              const result = await uploadSingleFile(f, null, nextList.length);
              if (result) {
                nextList.push(result);
              }
            } catch (err) {
              newlyFailed.push(f);
              setErrorMsg(
                getFriendlyErrorMessage(
                  err,
                  locale,
                  vi ? "Không thể tải tệp lên. Vui lòng thử lại." : "Upload failed. Please try again.",
                ),
              );
            }
          }
        }

        if (newlyFailed.length > 0) {
          setFailedFiles(newlyFailed);
        }

        onChange(nextList.map((item, idx) => ({ ...item, sort_order: idx })));
      } finally {
        setIsUploading(false);
        setUploadProgress(null);
      }
    },
    [disabled, locale, maxItems, onChange, uploadSingleFile, vi],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      pasteFiles: (files: File[]) => {
        if (files.length > 0 && allowImages && !disabled) {
          void handleFiles(files, null);
        }
      },
      focusZone: () => {
        zoneRef.current?.focus();
      },
    }),
    [allowImages, disabled, handleFiles],
  );

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled || !allowImages) return;
    const pastedFiles = extractClipboardImageFiles(event.clipboardData);
    // Only intercept when clipboard actually holds image files — normal text paste stays 100% intact!
    if (pastedFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void handleFiles(pastedFiles, null);
    }
  };

  const handlePasteButtonClick = async () => {
    if (disabled || !allowImages || isUploading) return;
    setErrorMsg(null);
    setPasteHintMsg(null);

    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.read === "function"
    ) {
      try {
        const clipboardItems = await navigator.clipboard.read();
        const extracted: File[] = [];
        for (const item of clipboardItems) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const ext = imageType.split("/")[1]?.replace("jpeg", "jpg") || "png";
            extracted.push(
              new File([blob], `pasted-${Date.now()}-${extracted.length + 1}.${ext}`, {
                type: imageType,
              }),
            );
          }
        }
        if (extracted.length > 0) {
          await handleFiles(extracted, null);
          return;
        }
        setPasteHintMsg(
          vi
            ? "Không tìm thấy ảnh trong clipboard. Hãy chụp/chép ảnh rồi nhấn Ctrl+V tại mục này."
            : "No image found in clipboard. Copy a screenshot and press Ctrl+V here.",
        );
        zoneRef.current?.focus();
        return;
      } catch {
        // Browser denied clipboard.read() permission -> guide keyboard paste cleanly
      }
    }

    zoneRef.current?.focus();
    setPasteHintMsg(
      vi
        ? "Nhấn Ctrl+V (hoặc Cmd+V) để dán ảnh trực tiếp vào mục này."
        : "Press Ctrl+V (or Cmd+V) to paste an image directly into this section.",
    );
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= value.length || fromIndex === toIndex) return;
    const next = [...value];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next.map((item, idx) => ({ ...item, sort_order: idx })));
  };

  const removeItem = (index: number) => {
    const target = value[index];
    if (target) {
      localFilesCacheRef.current.delete(target.localId);
    }
    const next = value
      .filter((_, i) => i !== index)
      .map((item, idx) => ({ ...item, sort_order: idx }));
    onChange(next);
  };

  const updateMeta = (index: number, field: "alt_text" | "caption", nextVal: string) => {
    const next = value.map((item, i) => (i === index ? { ...item, [field]: nextVal } : item));
    onChange(next);
  };

  const openCropDialog = async (index: number) => {
    const item = value[index];
    if (!item || item.kind !== "image") return;
    setErrorMsg(null);

    try {
      let sourceFile = localFilesCacheRef.current.get(item.localId);
      if (!sourceFile) {
        let res: Response | null = null;
        try {
          res = await fetch(item.url, { credentials: "same-origin" });
        } catch {
          res = null;
        }
        if (
          (!res || !res.ok) &&
          !item.url.startsWith("blob:") &&
          !item.url.startsWith("data:")
        ) {
          res = await fetch(appendMediaRetryParam(item.url), {
            credentials: "same-origin",
            cache: "no-store",
          });
        }
        if (!res || !res.ok) throw new Error("Failed to load image for editing");
        const blob = await res.blob();
        sourceFile = new File([blob], item.file_name || "image.png", {
          type: blob.type || item.mime_type || "image/png",
        });
        localFilesCacheRef.current.set(item.localId, sourceFile);
      }

      const previewUrl = URL.createObjectURL(sourceFile);
      setCropSession({
        index,
        sourceFile,
        previewUrl,
        rotation: 0,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      });
    } catch {
      setErrorMsg(
        vi
          ? "Không thể mở công cụ cắt/xoay cho ảnh này. Bạn có thể thay thế ảnh trực tiếp."
          : "Could not open crop/rotate editor for this image. You can replace it directly.",
      );
    }
  };

  const applyCropAndRotate = async () => {
    if (!cropSession) return;
    setIsApplyingCrop(true);
    setErrorMsg(null);
    try {
      const editedFile = await cropAndRotateImageFile(
        cropSession.sourceFile,
        cropSession.crop,
        cropSession.rotation,
      );
      await handleFiles([editedFile], cropSession.index);
      URL.revokeObjectURL(cropSession.previewUrl);
      setCropSession(null);
    } catch (err) {
      setErrorMsg(
        getFriendlyErrorMessage(
          err,
          locale,
          vi ? "Không thể áp dụng cắt/xoay ảnh." : "Could not apply image crop/rotate.",
        ),
      );
    } finally {
      setIsApplyingCrop(false);
    }
  };

  const handleRecordedUploadComplete = (uploaded: UploadedAudioPayload) => {
    if (value.length >= maxItems) return;
    if (uploaded.mediaId && onMediaUploaded) {
      onMediaUploaded(uploaded.mediaId);
    }
    const nextItem: EditableMediaAttachment = {
      localId: makeLocalId(),
      media_id: uploaded.mediaId ?? null,
      kind: "audio",
      storage_path: uploaded.path,
      url: uploaded.proxyUrl || resolveSafeMediaUrl({ storage_path: uploaded.path }) || "",
      mime_type: uploaded.mimeType,
      file_name: `recording-${Date.now()}.webm`,
      size_bytes: uploaded.sizeBytes,
      duration_ms:
        typeof uploaded.durationSeconds === "number" ? uploaded.durationSeconds * 1000 : null,
      alt_text: "",
      caption: "",
      sort_order: value.length,
    };
    onChange([...value, nextItem]);
    setShowRecorder(false);
  };

  const canAddMore = value.length < maxItems && !disabled;

  const lightboxImages = React.useMemo<LightboxImageItem[]>(
    () =>
      value
        .filter((item) => item.kind === "image")
        .map((item) => ({
          id: item.localId,
          src: item.url,
          alt: item.alt_text || item.file_name,
          caption: item.caption || null,
          width: item.width,
          height: item.height,
        })),
    [value],
  );

  const openLightboxForItem = (itemLocalId: string) => {
    const idx = lightboxImages.findIndex((img) => img.id === itemLocalId);
    setPreviewLightbox({ open: true, index: Math.max(0, idx) });
  };

  const defaultAddLabel =
    addButtonLabel ||
    (role === "option"
      ? vi
        ? "Thêm ảnh"
        : "Add image"
      : role === "explanation"
        ? vi
          ? "Thêm ảnh giải thích"
          : "Add explanation image"
        : allowImages
          ? vi
            ? "Thêm ảnh câu hỏi"
            : "Add question image"
          : vi
            ? "Chọn tệp"
            : "Choose file");

  return (
    <div
      ref={zoneRef}
      tabIndex={-1}
      onPaste={handlePaste}
      aria-label={zoneName || label || defaultAddLabel}
      className={cn("space-y-2.5 outline-none", className)}
    >
      {label && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-sm font-medium text-foreground">{label}</Label>
          <Badge variant="outline" className="tabular-nums text-xs">
            {value.length} / {maxItems}
          </Badge>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptAttr}
        multiple={maxItems > 1}
        disabled={disabled || isUploading}
        onChange={(e) => {
          if (e.target.files) {
            void handleFiles(e.target.files, null);
          }
          e.target.value = "";
        }}
        className="sr-only"
        aria-label={defaultAddLabel}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={acceptAttr}
        disabled={disabled || isUploading}
        onChange={(e) => {
          if (e.target.files && replaceIndexRef.current !== null) {
            void handleFiles(e.target.files, replaceIndexRef.current);
          }
          replaceIndexRef.current = null;
          e.target.value = "";
        }}
        className="sr-only"
        aria-label={vi ? "Chọn tệp thay thế" : "Choose replacement file"}
      />

      {/* Compact Variant (per-option inline strip: multi-image thumbnails + explicit Add/Paste buttons) */}
      {compact ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (!disabled && e.dataTransfer.files?.length) {
              void handleFiles(e.dataTransfer.files, null);
            }
          }}
          className={cn(
            "space-y-2 rounded-lg border border-dashed p-2 transition-colors",
            isDragOver
              ? "border-primary bg-accent/60"
              : "border-border/80 bg-muted/15",
          )}
        >
          {value.length > 0 && (
            <div className="flex flex-wrap items-start gap-2">
              {value.map((item, index) => (
                <div
                  key={item.localId}
                  draggable={!disabled && value.length > 1}
                  onDragStart={() => setDragReorderIdx(index)}
                  onDragOver={(e) => {
                    if (dragReorderIdx !== null && dragReorderIdx !== index) {
                      e.preventDefault();
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragReorderIdx !== null && dragReorderIdx !== index) {
                      moveItem(dragReorderIdx, index);
                    }
                    setDragReorderIdx(null);
                  }}
                  onDragEnd={() => setDragReorderIdx(null)}
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-1.5"
                >
                  <div className="flex items-start gap-1.5">
                    <AttachmentImageThumbnail
                      url={item.url}
                      alt={item.alt_text || item.file_name}
                      vi={vi}
                      size="compact"
                      onPreview={() => openLightboxForItem(item.localId)}
                    />
                    <div className="flex flex-col gap-0.5">
                      {value.length > 1 && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled || index === 0}
                            onClick={() => moveItem(index, index - 1)}
                            aria-label={vi ? "Sang trái" : "Move left"}
                            className="size-7"
                          >
                            <ArrowLeft className="size-3" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled || index === value.length - 1}
                            onClick={() => moveItem(index, index + 1)}
                            aria-label={vi ? "Sang phải" : "Move right"}
                            className="size-7"
                          >
                            <ArrowRight className="size-3" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled}
                          onClick={() => void openCropDialog(index)}
                          aria-label={vi ? "Cắt hoặc xoay ảnh" : "Crop or rotate image"}
                          className="size-7"
                        >
                          <Crop className="size-3" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled || isUploading}
                          onClick={() => {
                            replaceIndexRef.current = index;
                            replaceInputRef.current?.click();
                          }}
                          aria-label={vi ? "Thay thế ảnh" : "Replace image"}
                          className="size-7"
                        >
                          <RefreshCw className="size-3" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant={editingAltId === item.localId ? "secondary" : "ghost"}
                          size="icon"
                          disabled={disabled}
                          onClick={() =>
                            setEditingAltId((cur) =>
                              cur === item.localId ? null : item.localId,
                            )
                          }
                          aria-label={vi ? "Chỉnh sửa mô tả ảnh (Alt)" : "Edit image alt text"}
                          className="size-7"
                        >
                          <Tag className="size-3" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={disabled}
                          onClick={() => removeItem(index)}
                          aria-label={vi ? "Gỡ ảnh" : "Remove image"}
                          className="size-7 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {editingAltId === item.localId && (
                    <Input
                      value={item.alt_text}
                      disabled={disabled}
                      onChange={(e) => updateMeta(index, "alt_text", e.target.value)}
                      placeholder={vi ? "Mô tả ảnh (Alt text)..." : "Alt text..."}
                      aria-label={vi ? "Mô tả thay thế (Alt text)" : "Alt text"}
                      className="h-7 w-44 text-[11px]"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {canAddMore && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-10 gap-1.5 text-xs sm:min-h-8"
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ImagePlus className="size-3.5" aria-hidden="true" />
                )}
                <span>
                  {isUploading && uploadProgress
                    ? `${uploadProgress.current}/${uploadProgress.total}…`
                    : defaultAddLabel}
                </span>
              </Button>

              {allowImages && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || isUploading}
                  onClick={() => void handlePasteButtonClick()}
                  className="min-h-10 gap-1 text-xs text-muted-foreground hover:text-foreground sm:min-h-8"
                  title={vi ? "Dán ảnh từ clipboard (Ctrl+V)" : "Paste image from clipboard (Ctrl+V)"}
                >
                  <ClipboardPaste className="size-3.5" aria-hidden="true" />
                  <span>{vi ? "Dán (Ctrl+V)" : "Paste"}</span>
                </Button>
              )}

              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                {value.length}/{maxItems}
              </span>
            </div>
          )}
        </div>
      ) : (
        /* Full Dropzone & Quick Controls (Question Prompt / Explanation / Back) */
        <>
          {canAddMore && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!disabled) setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (!disabled && e.dataTransfer.files?.length) {
                  void handleFiles(e.dataTransfer.files, null);
                }
              }}
              className={cn(
                "rounded-lg border border-dashed p-3.5 transition-colors",
                isDragOver
                  ? "border-primary bg-accent/60"
                  : "border-border bg-muted/20 hover:border-primary/40",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  {isUploading ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  ) : allowImages ? (
                    <ImagePlus className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  ) : (
                    <FileAudio className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  )}
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {isUploading && uploadProgress
                        ? vi
                          ? `Đang tải tệp ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.fileName}…`
                          : `Uploading ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.fileName}…`
                        : vi
                          ? "Kéo thả ảnh vào đây, dán từ clipboard (Ctrl+V) hoặc chọn tệp"
                          : "Drag & drop images here, paste screenshot (Ctrl+V), or browse"}
                    </p>
                    <p className="mt-0.5">
                      {helperText ||
                        (allowImages && allowAudio
                          ? vi
                            ? "Ảnh PNG/JPG/WebP/GIF (<=5MB, chặn SVG) · Âm thanh MP3/WAV/M4A/WebM/OGG (<=10MB)"
                            : "Images PNG/JPG/WebP/GIF (<=5MB, no SVG) · Audio MP3/WAV/M4A/WebM/OGG (<=10MB)"
                          : allowImages
                            ? vi
                              ? "Hỗ trợ nhiều ảnh PNG, JPG, WebP, GIF tối đa 5 MB mỗi ảnh."
                              : "Supports multiple PNG, JPEG, WebP, GIF images up to 5 MB each."
                            : vi
                              ? "Hỗ trợ MP3, WAV, M4A, WebM, OGG tối đa 10 MB."
                              : "Supports MP3, WAV, M4A, WebM, OGG up to 10 MB.")}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-11 gap-1.5 sm:min-h-9"
                  >
                    <Upload className="size-3.5" aria-hidden="true" />
                    <span>{defaultAddLabel}</span>
                  </Button>

                  {allowImages && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || isUploading}
                      onClick={() => void handlePasteButtonClick()}
                      className="min-h-11 gap-1.5 sm:min-h-9"
                    >
                      <ClipboardPaste className="size-3.5" aria-hidden="true" />
                      <span>{vi ? "Dán ảnh" : "Paste image"}</span>
                    </Button>
                  )}

                  {allowAudio && allowVoiceRecording && (
                    <Button
                      type="button"
                      variant={showRecorder ? "secondary" : "outline"}
                      size="sm"
                      disabled={disabled || isUploading}
                      onClick={() => setShowRecorder((prev) => !prev)}
                      className="min-h-11 gap-1.5 sm:min-h-9"
                    >
                      <Mic className="size-3.5" aria-hidden="true" />
                      <span>{vi ? "Ghi âm" : "Record"}</span>
                    </Button>
                  )}
                </div>
              </div>

              {allowImages && (
                <div className="mt-2.5 flex items-center gap-2 border-t border-border/60 pt-2">
                  <Switch
                    id={`${baseId}-preserve-original`}
                    checked={preserveOriginal}
                    onCheckedChange={setPreserveOriginal}
                    disabled={disabled}
                  />
                  <Label
                    htmlFor={`${baseId}-preserve-original`}
                    className="cursor-pointer text-xs font-normal text-muted-foreground"
                  >
                    {vi
                      ? "Giữ chất lượng gốc không nén (khuyên dùng cho sơ đồ kỹ thuật & chữ nhỏ)"
                      : "Preserve original lossless quality (recommended for technical diagrams & fine labels)"}
                  </Label>
                </div>
              )}
            </div>
          )}

          {showRecorder && allowAudio && allowVoiceRecording && (
            <AudioRecorderControl
              studySetId={studySetId}
              disabled={disabled}
              onUploadComplete={handleRecordedUploadComplete}
            />
          )}

          {/* Existing Attachments List (Reorderable via drag + accessible buttons) */}
          {value.length > 0 && (
            <ul className="space-y-2" aria-label={vi ? "Danh sách tệp đính kèm" : "Media attachments"}>
              {value.map((item, index) => (
                <li
                  key={item.localId}
                  draggable={!disabled && value.length > 1}
                  onDragStart={() => setDragReorderIdx(index)}
                  onDragOver={(e) => {
                    if (dragReorderIdx !== null && dragReorderIdx !== index) {
                      e.preventDefault();
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragReorderIdx !== null && dragReorderIdx !== index) {
                      moveItem(dragReorderIdx, index);
                    }
                    setDragReorderIdx(null);
                  }}
                  onDragEnd={() => setDragReorderIdx(null)}
                  className="space-y-2 rounded-lg border border-border bg-card p-2.5"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    {item.kind === "image" ? (
                      <AttachmentImageThumbnail
                        url={item.url}
                        alt={item.alt_text || item.file_name}
                        vi={vi}
                        onPreview={() => openLightboxForItem(item.localId)}
                      />
                    ) : (
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 text-primary">
                        <FileAudio className="size-5" aria-hidden="true" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {item.file_name}
                          </p>
                          {(item.size_bytes > 0 || (item.width && item.height)) && (
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {[
                                formatFileSize(item.size_bytes),
                                item.width && item.height ? `${item.width}×${item.height}px` : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          {value.length > 1 && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={disabled || index === 0}
                                onClick={() => moveItem(index, index - 1)}
                                aria-label={vi ? "Di chuyển lên" : "Move up"}
                                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                              >
                                <ArrowUp className="size-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={disabled || index === value.length - 1}
                                onClick={() => moveItem(index, index + 1)}
                                aria-label={vi ? "Di chuyển xuống" : "Move down"}
                                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                              >
                                <ArrowDown className="size-3.5" aria-hidden="true" />
                              </Button>
                            </>
                          )}

                          {item.kind === "image" && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => openLightboxForItem(item.localId)}
                                aria-label={vi ? "Xem ảnh" : "Preview image"}
                                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                              >
                                <Eye className="size-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={disabled}
                                onClick={() => void openCropDialog(index)}
                                aria-label={vi ? "Cắt hoặc xoay ảnh" : "Crop or rotate image"}
                                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                              >
                                <Crop className="size-3.5" aria-hidden="true" />
                              </Button>
                            </>
                          )}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled || isUploading}
                            onClick={() => {
                              replaceIndexRef.current = index;
                              replaceInputRef.current?.click();
                            }}
                            aria-label={vi ? "Thay thế tệp" : "Replace file"}
                            className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
                          >
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={disabled}
                            onClick={() => removeItem(index)}
                            aria-label={vi ? "Gỡ tệp đính kèm" : "Remove attachment"}
                            className="min-h-10 min-w-10 text-destructive hover:text-destructive sm:min-h-8 sm:min-w-8"
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>

                      {item.kind === "audio" && (
                        <AudioPlayer
                          src={item.url}
                          title={item.caption || item.file_name}
                          mimeType={item.mime_type}
                          compact
                        />
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label
                            htmlFor={`${baseId}-alt-${item.localId}`}
                            className="text-xs text-muted-foreground"
                          >
                            {vi ? "Mô tả thay thế (Alt text)" : "Alt text (accessibility)"}
                          </Label>
                          <Input
                            id={`${baseId}-alt-${item.localId}`}
                            value={item.alt_text}
                            disabled={disabled}
                            onChange={(e) => updateMeta(index, "alt_text", e.target.value)}
                            placeholder={
                              vi ? "VD: Biểu đồ khí áp mực nước biển" : "e.g., Sea-level isobar chart"
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor={`${baseId}-cap-${item.localId}`}
                            className="text-xs text-muted-foreground"
                          >
                            {vi ? "Chú thích hiển thị" : "Caption"}
                          </Label>
                          <Input
                            id={`${baseId}-cap-${item.localId}`}
                            value={item.caption}
                            disabled={disabled}
                            onChange={(e) => updateMeta(index, "caption", e.target.value)}
                            placeholder={vi ? "Chú thích tùy chọn…" : "Optional caption…"}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {pasteHintMsg && (
        <p role="status" className="text-xs text-muted-foreground">
          {pasteHintMsg}
        </p>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
          {failedFiles.length > 0 && !isUploading && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => void handleFiles(failedFiles, null)}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>{vi ? "Thử lại tải lên" : "Retry upload"}</span>
            </Button>
          )}
        </div>
      )}

      {/* Lightbox Preview */}
      {previewLightbox.open && lightboxImages.length > 0 && (
        <ImageLightbox
          open={previewLightbox.open}
          onOpenChange={(open) => setPreviewLightbox((prev) => ({ ...prev, open }))}
          images={lightboxImages}
          initialIndex={previewLightbox.index}
        />
      )}

      {/* Crop & Rotate Dialog */}
      <Dialog
        open={Boolean(cropSession)}
        onOpenChange={(open) => {
          if (!open && cropSession) {
            URL.revokeObjectURL(cropSession.previewUrl);
            setCropSession(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{vi ? "Cắt & Xoay ảnh" : "Crop & Rotate Image"}</DialogTitle>
            <DialogDescription>
              {vi
                ? "Xoay ảnh theo bước 90° hoặc điều chỉnh vùng cắt theo tỷ lệ phần trăm, giữ nguyên độ sắc nét của sơ đồ."
                : "Rotate in 90° increments or trim margins while preserving diagram clarity."}
            </DialogDescription>
          </DialogHeader>

          {cropSession && (
            <div className="space-y-4">
              <div className="relative flex max-h-72 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40 p-3">
                <div
                  className="relative inline-block overflow-hidden"
                  style={{ transform: `rotate(${cropSession.rotation}deg)` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cropSession.previewUrl}
                    alt={vi ? "Xem trước cắt ảnh" : "Crop preview"}
                    className="max-h-60 max-w-full object-contain"
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      left: `${cropSession.crop.x * 100}%`,
                      top: `${cropSession.crop.y * 100}%`,
                      width: `${cropSession.crop.width * 100}%`,
                      height: `${cropSession.crop.height * 100}%`,
                    }}
                    className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCropSession((prev) =>
                      prev
                        ? {
                            ...prev,
                            rotation: ((prev.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                          }
                        : null,
                    )
                  }
                  className="min-h-9 gap-1.5"
                >
                  <RotateCw className="size-4" aria-hidden="true" />
                  <span>
                    {vi ? `Xoay 90° (${cropSession.rotation}°)` : `Rotate 90° (${cropSession.rotation}°)`}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCropSession((prev) =>
                      prev
                        ? { ...prev, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } }
                        : null,
                    )
                  }
                  className="min-h-9"
                >
                  {vi ? "Đặt lại" : "Reset"}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <Label htmlFor={`${baseId}-crop-left`}>
                    {vi ? "Lề trái" : "Left trim"} ({Math.round(cropSession.crop.x * 100)}%)
                  </Label>
                  <input
                    id={`${baseId}-crop-left`}
                    type="range"
                    min={0}
                    max={40}
                    value={Math.round(cropSession.crop.x * 100)}
                    onChange={(e) => {
                      const nextX = Number(e.target.value) / 100;
                      setCropSession((prev) =>
                        prev
                          ? {
                              ...prev,
                              crop: {
                                ...prev.crop,
                                x: nextX,
                                width: Math.max(0.2, Math.min(prev.crop.width, 1 - nextX)),
                              },
                            }
                          : null,
                      );
                    }}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${baseId}-crop-width`}>
                    {vi ? "Chiều rộng" : "Width"} ({Math.round(cropSession.crop.width * 100)}%)
                  </Label>
                  <input
                    id={`${baseId}-crop-width`}
                    type="range"
                    min={20}
                    max={Math.round((1 - cropSession.crop.x) * 100)}
                    value={Math.round(cropSession.crop.width * 100)}
                    onChange={(e) => {
                      const nextW = Number(e.target.value) / 100;
                      setCropSession((prev) =>
                        prev ? { ...prev, crop: { ...prev.crop, width: nextW } } : null,
                      );
                    }}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${baseId}-crop-top`}>
                    {vi ? "Lề trên" : "Top trim"} ({Math.round(cropSession.crop.y * 100)}%)
                  </Label>
                  <input
                    id={`${baseId}-crop-top`}
                    type="range"
                    min={0}
                    max={40}
                    value={Math.round(cropSession.crop.y * 100)}
                    onChange={(e) => {
                      const nextY = Number(e.target.value) / 100;
                      setCropSession((prev) =>
                        prev
                          ? {
                              ...prev,
                              crop: {
                                ...prev.crop,
                                y: nextY,
                                height: Math.max(0.2, Math.min(prev.crop.height, 1 - nextY)),
                              },
                            }
                          : null,
                      );
                    }}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${baseId}-crop-height`}>
                    {vi ? "Chiều cao" : "Height"} ({Math.round(cropSession.crop.height * 100)}%)
                  </Label>
                  <input
                    id={`${baseId}-crop-height`}
                    type="range"
                    min={20}
                    max={Math.round((1 - cropSession.crop.y) * 100)}
                    value={Math.round(cropSession.crop.height * 100)}
                    onChange={(e) => {
                      const nextH = Number(e.target.value) / 100;
                      setCropSession((prev) =>
                        prev ? { ...prev, crop: { ...prev.crop, height: nextH } } : null,
                      );
                    }}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isApplyingCrop}
              onClick={() => {
                if (cropSession) URL.revokeObjectURL(cropSession.previewUrl);
                setCropSession(null);
              }}
            >
              {vi ? "Hủy" : "Cancel"}
            </Button>
            <Button
              type="button"
              disabled={isApplyingCrop}
              onClick={() => void applyCropAndRotate()}
              className="gap-1.5"
            >
              {isApplyingCrop && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{vi ? "Lưu ảnh đã cắt" : "Save edited image"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
