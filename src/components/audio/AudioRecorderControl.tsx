"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mic,
  RefreshCw,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { ApiError, apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AudioRecorderController,
  MAX_RECORDING_DURATION_SECONDS,
  type RecorderErrorCode,
  type RecorderSnapshot,
} from "@/lib/audio/recorder";
import { useOptionalI18n } from "@/lib/i18n";
import { uploadAudioSmart } from "@/lib/media/direct-upload";
import { cn } from "@/lib/utils";

export interface UploadedAudioPayload {
  mediaId?: string;
  path: string;
  proxyUrl: string;
  signedUrl?: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
}

export interface AudioRecorderControlProps {
  maxDurationSeconds?: number;
  studySetId?: string;
  /** Optional API endpoint to upload recorded audio directly (default `/api/uploads/audio`). */
  uploadEndpoint?: string;
  /** Callback invoked with local `File` when user confirms/saves without auto-uploading. */
  onRecordedFile?: (file: File, meta: { durationSeconds: number; mimeType: string }) => void;
  /** Callback invoked after successful upload to backend storage. */
  onUploadComplete?: (uploaded: UploadedAudioPayload) => void;
  disabled?: boolean;
  className?: string;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getRecorderErrorText(code: RecorderErrorCode, vi: boolean): string {
  switch (code) {
    case "UNSUPPORTED":
      return vi
        ? "Trình duyệt hiện tại không hỗ trợ ghi âm trực tiếp (MediaRecorder). Bạn vẫn có thể tải lên tệp MP3/WAV/M4A/OGG."
        : "Your browser does not support direct audio recording (MediaRecorder). You can still upload MP3/WAV/M4A/OGG files.";
    case "PERMISSION_DENIED":
      return vi
        ? "Quyền truy cập micro đã bị từ chối. Hãy cho phép micro trong cài đặt trình duyệt rồi thử lại."
        : "Microphone permission was denied. Allow microphone access in browser settings and try again.";
    case "NO_MICROPHONE":
      return vi
        ? "Không tìm thấy thiết bị micro trên máy tính hoặc điện thoại của bạn."
        : "No microphone device was found on your system.";
    case "DEVICE_BUSY":
      return vi
        ? "Micro đang được sử dụng bởi ứng dụng khác. Hãy đóng ứng dụng đó và thử lại."
        : "The microphone is currently busy in another application.";
    case "EMPTY_RECORDING":
      return vi
        ? "Bản ghi âm không có dữ liệu âm thanh. Hãy thử ghi lại."
        : "The recording captured no audio data. Please try again.";
    default:
      return vi
        ? "Không thể hoàn tất ghi âm. Vui lòng thử lại."
        : "Could not complete audio recording. Please try again.";
  }
}

export function AudioRecorderControl({
  maxDurationSeconds = MAX_RECORDING_DURATION_SECONDS,
  studySetId,
  uploadEndpoint = "/api/uploads/audio",
  onRecordedFile,
  onUploadComplete,
  disabled = false,
  className,
}: AudioRecorderControlProps) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  const [controller] = React.useState(
    () => new AudioRecorderController({ maxDurationSeconds }),
  );
  const [snapshot, setSnapshot] = React.useState<RecorderSnapshot>(() =>
    controller.getSnapshot(),
  );
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadedSuccess, setUploadedSuccess] = React.useState(false);

  React.useEffect(() => {
    const unsub = controller.subscribe((next) => {
      setSnapshot(next);
    });
    return () => {
      unsub();
      controller.deleteRecording();
    };
  }, [controller]);

  const handleStart = async () => {
    setUploadError(null);
    setUploadedSuccess(false);
    await controller.start();
  };

  const handleStop = () => {
    controller.stop();
  };

  const handleDelete = () => {
    setUploadError(null);
    setUploadedSuccess(false);
    controller.deleteRecording();
  };

  const handleUseRecording = async () => {
    const file = controller.toUploadFile(`recording-${Date.now()}`);
    if (!file) return;

    setUploadError(null);

    if (onRecordedFile && !onUploadComplete) {
      onRecordedFile(file, {
        durationSeconds: snapshot.elapsedSeconds,
        mimeType: file.type,
      });
      setUploadedSuccess(true);
      return;
    }

    if (!studySetId && uploadEndpoint === "/api/uploads/audio") {
      setUploadError(
        vi
          ? "Thiếu mã học phần để lưu tệp âm thanh."
          : "Missing study set context required for audio upload.",
      );
      return;
    }

    setIsUploading(true);
    try {
      const durationMs = Math.max(0, Math.round(snapshot.elapsedSeconds * 1000));
      let d: Record<string, unknown>;

      if (uploadEndpoint === "/api/uploads/audio" && studySetId) {
        const response = await uploadAudioSmart({
          file,
          fileName: file.name,
          studySetId,
          purpose: "audio",
          durationMs,
        });
        const contentType = response.headers.get("content-type") ?? "";
        const parsed = contentType.includes("application/json")
          ? ((await response.json().catch(() => null)) as
              | {
                  data?: Record<string, unknown>;
                  error?: { code?: string; message?: string; details?: unknown };
                  message?: string;
                }
              | null)
          : null;
        if (!response.ok) {
          if (parsed?.error) {
            throw new ApiError(
              parsed.error.code ?? "API_ERROR",
              parsed.error.message ?? response.statusText,
              response.status,
              parsed.error.details,
            );
          }
          throw new ApiError(
            "HTTP_ERROR",
            parsed?.message ?? (response.statusText || "Upload failed"),
            response.status,
          );
        }
        d = (parsed?.data ?? parsed ?? {}) as Record<string, unknown>;
      } else {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("purpose", "audio");
        if (studySetId) {
          formData.append("studySetId", studySetId);
        }
        formData.append("durationMs", String(durationMs));

        const res = await apiFetch<Record<string, unknown>>(uploadEndpoint, {
          method: "POST",
          body: formData,
        });
        d = res.data;
      }

      const uploaded: UploadedAudioPayload = {
        mediaId: typeof d.mediaId === "string" ? d.mediaId : typeof d.id === "string" ? d.id : undefined,
        path: String(d.path ?? d.storage_path ?? ""),
        proxyUrl: String(d.proxyUrl ?? d.proxy_url ?? ""),
        signedUrl: typeof d.signedUrl === "string" ? d.signedUrl : undefined,
        mimeType: String(d.mimeType ?? d.mime_type ?? file.type),
        sizeBytes: Number(d.size ?? d.size_bytes ?? file.size),
        durationSeconds: snapshot.elapsedSeconds,
      };

      onRecordedFile?.(file, {
        durationSeconds: snapshot.elapsedSeconds,
        mimeType: file.type,
      });
      onUploadComplete?.(uploaded);
      setUploadedSuccess(true);
    } catch (err) {
      setUploadError(
        getFriendlyErrorMessage(
          err,
          locale,
          vi ? "Không thể tải lên bản ghi âm." : "Failed to upload audio recording.",
        ),
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3.5 text-card-foreground space-y-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mic
            className={cn(
              "size-4 shrink-0",
              snapshot.status === "recording" ? "text-destructive" : "text-primary",
            )}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-foreground">
            {vi ? "Ghi âm trực tiếp" : "Voice recorder"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span>
            {formatClock(snapshot.elapsedSeconds)} / {formatClock(snapshot.maxDurationSeconds)}
          </span>
          {snapshot.sizeBytes > 0 && (
            <Badge variant="outline" className="tabular-nums text-xs">
              {formatBytes(snapshot.sizeBytes)}
            </Badge>
          )}
        </div>
      </div>

      {snapshot.status === "unsupported" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{getRecorderErrorText("UNSUPPORTED", vi)}</span>
        </div>
      )}

      {snapshot.status === "error" && snapshot.errorCode && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle p-2.5 text-xs text-destructive-subtle-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{getRecorderErrorText(snapshot.errorCode, vi)}</span>
        </div>
      )}

      {uploadError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-subtle p-2.5 text-xs text-destructive-subtle-foreground"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Explicit user-initiated controls */}
      {(snapshot.status === "idle" || snapshot.status === "error") && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !snapshot.supported}
            onClick={() => void handleStart()}
            className="min-h-11 gap-2 sm:min-h-9"
          >
            <Mic className="size-4 text-destructive" aria-hidden="true" />
            <span>{vi ? "Bắt đầu ghi âm" : "Start recording"}</span>
          </Button>
          <span className="text-xs text-muted-foreground">
            {vi
              ? `Tối đa ${snapshot.maxDurationSeconds}s · Micro chỉ bật khi bạn nhấn nút.`
              : `Max ${snapshot.maxDurationSeconds}s · Microphone activates only on click.`}
          </span>
        </div>
      )}

      {snapshot.status === "requesting_permission" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span>
            {vi
              ? "Đang xin quyền truy cập micro từ trình duyệt…"
              : "Requesting microphone permission from your browser…"}
          </span>
        </div>
      )}

      {snapshot.status === "recording" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive-subtle/60 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-destructive-subtle-foreground">
            <span
              className="size-2.5 rounded-full bg-destructive animate-pulse"
              aria-hidden="true"
            />
            <span>{vi ? "Đang ghi âm…" : "Recording…"}</span>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleStop}
            className="min-h-11 gap-1.5 sm:min-h-9"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
            <span>{vi ? "Dừng ghi âm" : "Stop recording"}</span>
          </Button>
        </div>
      )}

      {snapshot.status === "preview" && snapshot.previewUrl && (
        <div className="space-y-2.5">
          {snapshot.stopReason === "duration_limit" && (
            <p className="text-xs text-warning-subtle-foreground">
              {vi
                ? `Đã tự động dừng khi đạt giới hạn ${snapshot.maxDurationSeconds} giây.`
                : `Recording stopped automatically at the ${snapshot.maxDurationSeconds}s limit.`}
            </p>
          )}
          {snapshot.stopReason === "size_limit" && (
            <p className="text-xs text-warning-subtle-foreground">
              {vi
                ? "Đã tự động dừng khi đạt giới hạn dung lượng tệp âm thanh."
                : "Recording stopped automatically at the audio size limit."}
            </p>
          )}

          <audio controls src={snapshot.previewUrl} preload="metadata" className="w-full">
            {vi
              ? "Trình duyệt của bạn không hỗ trợ phát lại bản ghi âm."
              : "Your browser cannot preview this recording."}
          </audio>

          <div className="flex flex-wrap items-center gap-2">
            {(onUploadComplete || onRecordedFile) && (
              <Button
                type="button"
                size="sm"
                disabled={disabled || isUploading}
                onClick={() => void handleUseRecording()}
                className="min-h-11 gap-1.5 sm:min-h-9"
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : uploadedSuccess ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                <span>
                  {isUploading
                    ? vi
                      ? "Đang lưu…"
                      : "Saving…"
                    : uploadedSuccess
                      ? vi
                        ? "Đã đính kèm"
                        : "Attached"
                      : vi
                        ? "Dùng bản ghi này"
                        : "Use this recording"}
                </span>
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || isUploading}
              onClick={() => void handleStart()}
              className="min-h-11 gap-1.5 sm:min-h-9"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>{vi ? "Ghi lại" : "Replace"}</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || isUploading}
              onClick={handleDelete}
              className="min-h-11 gap-1.5 text-destructive hover:text-destructive sm:min-h-9"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>{vi ? "Xóa" : "Delete"}</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
