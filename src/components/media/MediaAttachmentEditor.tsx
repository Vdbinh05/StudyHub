"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Crop,
  Eye,
  FileAudio,
  ImagePlus,
  Loader2,
  Mic,
  RefreshCw,
  RotateCw,
  Trash2,
  Upload,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import {
  AudioRecorderControl,
  type UploadedAudioPayload,
} from "@/components/audio/AudioRecorderControl";
import { ApiError, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { ImageLightbox } from "@/components/media/ImageLightbox";
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
import { resolveSafeMediaUrl } from "@/lib/media/urls";
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
  helperText?: string;
  disabled?: boolean;
  className?: string;
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

function formatFileSize(bytes: number): string {
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

export function MediaAttachmentEditor({
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
  helperText,
  disabled = false,
  className,
  onUploadFile,
}: MediaAttachmentEditorProps) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const baseId = React.useId();

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const replaceInputRef = React.useRef<HTMLInputElement>(null);
  const replaceIndexRef = React.useRef<number | null>(null);
  const localFilesCacheRef = React.useRef<Map<string, File>>(new Map());

  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [preserveOriginal, setPreserveOriginal] = React.useState(defaultPreserveOriginal);
  const [showRecorder, setShowRecorder] = React.useState(false);
  const [previewLightbox, setPreviewLightbox] = React.useState<{
    open: boolean;
    src: string;
    alt: string;
    caption: string;
  }>({ open: false, src: "", alt: "", caption: "" });
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

  const acceptAttr = React.useMemo(() => {
    const parts: string[] = [];
    if (allowImages) parts.push("image/png", "image/jpeg", "image/webp", "image/gif");
    if (allowAudio) parts.push("audio/mpeg", "audio/wav", "audio/mp4", "audio/webm", "audio/ogg");
    return parts.join(",");
  }, [allowImages, allowAudio]);

  const uploadSingleFile = React.useCallback(
    async (
      rawFile: File,
      replaceAtIndex: number | null,
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
            proxy_url: typeof d.proxyUrl === "string" ? d.proxyUrl : typeof d.proxy_url === "string" ? d.proxy_url : null,
            storage_path: storagePath,
          }) ?? "";

        uploaded = {
          media_id:
            typeof d.mediaId === "string"
              ? d.mediaId
              : typeof d.id === "string"
                ? d.id
                : null,
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

      const existing = replaceAtIndex !== null ? value[replaceAtIndex] : undefined;
      const localId = existing?.localId ?? makeLocalId();
      if (validation.kind === "image") {
        localFilesCacheRef.current.set(localId, fileToUpload);
      }

      return {
        ...uploaded,
        localId,
        alt_text: existing?.alt_text ?? "",
        caption: existing?.caption ?? "",
        sort_order: replaceAtIndex ?? value.length,
      };
    },
    [allowImages, allowAudio, preserveOriginal, role, onUploadFile, studySetId, value],
  );

  const handleFiles = async (files: FileList | File[], replaceAtIndex: number | null = null) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setErrorMsg(null);
    setIsUploading(true);
    try {
      const nextList = [...value];

      if (replaceAtIndex !== null) {
        const result = await uploadSingleFile(fileArray[0], replaceAtIndex);
        if (result) {
          nextList[replaceAtIndex] = result;
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
        for (const f of batch) {
          const result = await uploadSingleFile(f, null);
          if (result) {
            nextList.push(result);
          }
        }
      }

      onChange(nextList.map((item, idx) => ({ ...item, sort_order: idx })));
    } catch (err) {
      setErrorMsg(
        getFriendlyErrorMessage(
          err,
          locale,
          vi ? "Không thể tải tệp lên. Vui lòng thử lại." : "Upload failed. Please try again.",
        ),
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled || !allowImages) return;
    // Do NOT hijack normal text paste inside inputs or textareas
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }

    const items = event.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i];
      if (entry.kind === "file" && entry.type.startsWith("image/")) {
        const f = entry.getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void handleFiles(pastedFiles, null);
    }
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
    const next = value.filter((_, i) => i !== index).map((item, idx) => ({ ...item, sort_order: idx }));
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
        const res = await fetch(item.url, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Failed to load image for editing");
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

  return (
    <div onPaste={handlePaste} className={cn("space-y-3", className)}>
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
        aria-label={vi ? "Chọn tệp đa phương tiện" : "Choose media files"}
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

      {/* Dropzone & Quick Controls */}
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
            "rounded-lg border border-dashed transition-colors",
            isDragOver
              ? "border-primary bg-accent/60"
              : "border-border bg-muted/20 hover:border-primary/40",
            compact ? "p-2.5" : "p-4",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
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
                  {isUploading
                    ? vi
                      ? "Đang kiểm tra và tải tệp lên…"
                      : "Validating and uploading…"
                    : compact
                      ? vi
                        ? "Kéo thả, dán ảnh (Ctrl+V) hoặc chọn tệp"
                        : "Drop, paste image (Ctrl+V), or browse"
                      : vi
                        ? "Kéo thả tệp vào đây, dán ảnh từ clipboard (Ctrl+V), hoặc nhấn chọn tệp"
                        : "Drag & drop files here, paste screenshot (Ctrl+V), or choose files"}
                </p>
                {!compact && (
                  <p className="mt-0.5">
                    {helperText ||
                      (allowImages && allowAudio
                        ? vi
                          ? "Ảnh PNG/JPG/WebP/GIF (<=5MB, chặn SVG) · Âm thanh MP3/WAV/M4A/WebM/OGG (<=10MB)"
                          : "Images PNG/JPG/WebP/GIF (<=5MB, no SVG) · Audio MP3/WAV/M4A/WebM/OGG (<=10MB)"
                        : allowImages
                          ? vi
                            ? "Hỗ trợ PNG, JPEG, WebP, GIF tối đa 5 MB (chặn SVG để đảm bảo an toàn)."
                            : "Supports PNG, JPEG, WebP, GIF up to 5 MB (SVG blocked for safety)."
                          : vi
                            ? "Hỗ trợ MP3, WAV, M4A, WebM, OGG tối đa 10 MB."
                            : "Supports MP3, WAV, M4A, WebM, OGG up to 10 MB.")}
                  </p>
                )}
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
                <span>{vi ? "Chọn tệp" : "Choose file"}</span>
              </Button>

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

          {allowImages && !compact && (
            <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2.5">
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

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Existing Attachments List (Reorderable via drag + accessible buttons) */}
      {value.length > 0 && (
        <ul className="space-y-2.5" aria-label={vi ? "Danh sách tệp đính kèm" : "Media attachments"}>
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
              className="rounded-lg border border-border bg-card p-3 space-y-2.5"
            >
              <div className="flex flex-wrap items-start gap-3">
                {/* Thumbnail or Audio badge */}
                {item.kind === "image" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewLightbox({
                        open: true,
                        src: item.url,
                        alt: item.alt_text || item.file_name,
                        caption: item.caption,
                      })
                    }
                    aria-label={vi ? "Xem trước ảnh phóng to" : "Preview enlarged image"}
                    className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.alt_text || item.file_name}
                      className="max-h-full max-w-full object-contain"
                    />
                  </button>
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
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatFileSize(item.size_bytes)}
                        {item.width && item.height ? ` · ${item.width}×${item.height}px` : ""}
                      </p>
                    </div>

                    {/* Action buttons (all keyboard-accessible) */}
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
                            onClick={() =>
                              setPreviewLightbox({
                                open: true,
                                src: item.url,
                                alt: item.alt_text || item.file_name,
                                caption: item.caption,
                              })
                            }
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

                  {/* Accessible Alt Text & Caption Fields */}
                  <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
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
                        className="h-9 text-xs"
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
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Lightbox Preview */}
      <ImageLightbox
        open={previewLightbox.open}
        onOpenChange={(open) => setPreviewLightbox((prev) => ({ ...prev, open }))}
        src={previewLightbox.src}
        alt={previewLightbox.alt}
        caption={previewLightbox.caption}
      />

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
                  {/* Visual crop rectangle overlay */}
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
}
