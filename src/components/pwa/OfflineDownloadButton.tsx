"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useOptionalI18n } from "@/lib/i18n";
import {
  getDownloadedSet,
  getStorageEstimate,
  OfflineStorageError,
} from "@/lib/offline/db";
import {
  checkStudySetUpdateStatus,
  deleteDownloadedStudySet,
  downloadStudySetOffline,
  retryFailedMediaDownloads,
  type StudySetUpdateCheckResult,
} from "@/lib/offline/download-manager";
import type {
  DownloadProgress,
  OfflineDownloadedSetRecord,
  StorageEstimateInfo,
} from "@/lib/offline/types";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format-bytes";
import { useOptionalPwa } from "./PwaProvider";

function subscribeFallbackOnline(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getFallbackOnlineSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export interface OfflineDownloadButtonProps {
  setId: string;
  setTitle: string;
  chapters?: string[];
  questionCount?: number;
  estimatedMediaCount?: number;
  /** Set true if known upfront that the set contains image-only/diagram/listening items */
  hasRequiredMedia?: boolean;
  /** Optional explicit userId (defaults to active user from PwaProvider) */
  userId?: string | null;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

export function OfflineDownloadButton({
  setId,
  setTitle,
  chapters = [],
  questionCount = 0,
  estimatedMediaCount = 0,
  hasRequiredMedia = false,
  userId: explicitUserId,
  variant = "outline",
  size = "sm",
  className,
}: OfflineDownloadButtonProps) {
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  const fallbackOnline = React.useSyncExternalStore(
    subscribeFallbackOnline,
    getFallbackOnlineSnapshot,
    () => true,
  );
  const effectiveUserId = explicitUserId ?? pwa?.activeUserId ?? null;
  const isOnline = pwa ? pwa.isOnline : fallbackOnline;

  const [open, setOpen] = React.useState(false);
  const [record, setRecord] = React.useState<OfflineDownloadedSetRecord | null>(
    null,
  );
  const [storageInfo, setStorageInfo] =
    React.useState<StorageEstimateInfo | null>(null);
  const [updateStatus, setUpdateStatus] =
    React.useState<StudySetUpdateCheckResult | null>(null);

  const [scope, setScope] = React.useState<"all" | "chapters">("all");
  const [selectedChapters, setSelectedChapters] = React.useState<string[]>([]);
  const [includeMedia, setIncludeMedia] = React.useState(true);

  const [downloading, setDownloading] = React.useState(false);
  const [checkingUpdate, setCheckingUpdate] = React.useState(false);
  const [progress, setProgress] = React.useState<DownloadProgress | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false);

  // Synchronous ref locks preventing rapid double-click download/check/remove races (`FUNC-31`)
  const downloadingRef = React.useRef(false);
  const checkingUpdateRef = React.useRef(false);
  const removingRef = React.useRef(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const includeMediaId = React.useId();

  React.useEffect(() => {
    let active = true;
    void (async () => {
      if (!effectiveUserId) {
        if (active) setRecord(null);
        return;
      }
      try {
        const [existing, est] = await Promise.all([
          getDownloadedSet(effectiveUserId, setId),
          getStorageEstimate(),
        ]);
        if (!active) return;
        setRecord(existing);
        setStorageInfo(est);
        if (
          existing?.downloaded_chapters &&
          existing.downloaded_chapters.length > 0
        ) {
          setScope("chapters");
          setSelectedChapters(existing.downloaded_chapters);
        }
      } catch {
        // Ignore restricted IDB environments
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveUserId, setId, pwa?.offlineRevision]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const toggleChapter = (chapter: string) => {
    setSelectedChapters((prev) =>
      prev.includes(chapter)
        ? prev.filter((c) => c !== chapter)
        : [...prev, chapter],
    );
  };

  const describeOfflineError = (err: unknown): string => {
    if (err instanceof OfflineStorageError) {
      if (err.code === "MEDIA_REQUIRED_FOR_SET") {
        return i18n
          ? i18n.t("pwa.textOnlyBlockedMedia")
          : vi
            ? "Học phần này chứa câu hỏi hình ảnh/sơ đồ/âm thanh bắt buộc — cần tải kèm tệp phương tiện để học chính xác ngoại tuyến."
            : "This study set contains required image, diagram, or listening questions — media download is required for accurate offline study.";
      }
      if (err.code === "QUOTA_EXCEEDED") {
        return vi
          ? "Bộ nhớ cục bộ trên trình duyệt đã đầy. Vui lòng xóa bớt học phần ngoại tuyến cũ rồi thử lại."
          : "Browser local storage quota is full. Remove unused offline sets and try again.";
      }
      if (err.code === "PRIVATE_BROWSING" || err.code === "IDB_UNAVAILABLE") {
        return vi
          ? "Trình duyệt đang chặn lưu trữ ngoại tuyến (ví dụ chế độ Ẩn danh). Hãy mở ở cửa sổ thường để tải ngoại tuyến."
          : "Offline storage is unavailable in this browser session (such as Private Browsing).";
      }
      if (err.code === "ABORTED") {
        return vi ? "Đã hủy quá trình tải xuống." : "Download cancelled.";
      }
      if (err.code === "AUTH_REQUIRED") {
        return vi
          ? "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại trước khi tải."
          : "Your session expired. Sign in again to download this study set.";
      }
      return err.message;
    }
    return vi
      ? "Không thể tải học phần ngoại tuyến. Vui lòng kiểm tra kết nối mạng và thử lại."
      : "Unable to download this study set offline. Check your connection and try again.";
  };

  const handleStartDownload = async () => {
    if (downloadingRef.current) return;
    if (!effectiveUserId) {
      setErrorMessage(
        vi
          ? "Bạn cần đăng nhập để tải học phần về thiết bị."
          : "Please sign in to download study sets for offline use.",
      );
      return;
    }
    if (scope === "chapters" && selectedChapters.length === 0) {
      setErrorMessage(
        vi
          ? "Vui lòng chọn ít nhất 1 chương để tải xuống."
          : "Select at least one chapter to download.",
      );
      return;
    }

    downloadingRef.current = true;
    setErrorMessage(null);
    setDownloading(true);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const saved = await downloadStudySetOffline({
        userId: effectiveUserId,
        setId,
        chapters: scope === "chapters" ? selectedChapters : null,
        includeMedia: hasRequiredMedia ? true : includeMedia,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setRecord(saved);
      setUpdateStatus(null);
      await pwa?.refreshOfflineState();
    } catch (err) {
      setErrorMessage(describeOfflineError(err));
    } finally {
      abortRef.current = null;
      downloadingRef.current = false;
      setDownloading(false);
    }
  };

  const handleCancelDownload = () => {
    abortRef.current?.abort();
  };

  const handleRetryFailed = async () => {
    if (!effectiveUserId || downloadingRef.current) return;
    downloadingRef.current = true;
    setErrorMessage(null);
    setDownloading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const updated = await retryFailedMediaDownloads(effectiveUserId, setId, {
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setRecord(updated);
      await pwa?.refreshOfflineState();
    } catch (err) {
      setErrorMessage(describeOfflineError(err));
    } finally {
      abortRef.current = null;
      downloadingRef.current = false;
      setDownloading(false);
    }
  };

  const handleCheckUpdate = async () => {
    if (!effectiveUserId || !isOnline || checkingUpdateRef.current) return;
    checkingUpdateRef.current = true;
    setCheckingUpdate(true);
    setErrorMessage(null);
    try {
      const status = await checkStudySetUpdateStatus(effectiveUserId, setId);
      setUpdateStatus(status);
      if (status.revoked) {
        setErrorMessage(
          i18n
            ? i18n.t("pwa.revokedAccessNotice")
            : vi
              ? "Quyền truy cập học phần này đã thay đổi; bản ngoại tuyến đã bị vô hiệu hóa."
              : "Access to this study set was revoked; offline copy is no longer authorized.",
        );
      }
    } catch (err) {
      setErrorMessage(describeOfflineError(err));
    } finally {
      checkingUpdateRef.current = false;
      setCheckingUpdate(false);
    }
  };

  const handleRemoveDownload = async () => {
    if (!effectiveUserId || removingRef.current) return;
    removingRef.current = true;
    try {
      await deleteDownloadedStudySet(effectiveUserId, setId);
      setRecord(null);
      setUpdateStatus(null);
      setProgress(null);
      setConfirmRemoveOpen(false);
      await pwa?.refreshOfflineState();
    } finally {
      removingRef.current = false;
    }
  };

  const isDownloaded = record !== null && record.status !== "revoked";
  const isPartial = record?.status === "partial";
  const canOneClickDownload =
    !isDownloaded &&
    !downloading &&
    chapters.length === 0 &&
    !hasRequiredMedia &&
    isOnline &&
    Boolean(effectiveUserId);

  const handleTriggerClick = () => {
    if (canOneClickDownload) {
      setOpen(true);
      void handleStartDownload();
    }
  };
  const progressPct =
    progress && progress.totalItems > 0
      ? Math.min(100, Math.round((progress.completedItems / progress.totalItems) * 100))
      : progress?.phase === "complete"
        ? 100
        : 10;

  const estimatedTextBytes = Math.max(1, questionCount) * 1600;
  const estimatedMediaBytes = includeMedia ? estimatedMediaCount * 240 * 1024 : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant={isDownloaded ? "secondary" : variant}
            size={size}
            className={cn("gap-1.5", className)}
            data-testid="offline-download-trigger"
            onClick={handleTriggerClick}
          >
            {downloading ? (
              <Loader2
                className="text-primary size-4 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : isDownloaded ? (
              <CheckCircle2
                className="text-success size-4 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <CloudDownload className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {downloading
                ? vi
                  ? `Đang tải (${progressPct}%)`
                  : `Downloading (${progressPct}%)`
                : isPartial
                  ? vi
                    ? "Tải chưa đủ"
                    : "Partial offline"
                  : isDownloaded
                    ? i18n
                      ? i18n.t("pwa.downloaded")
                      : vi
                        ? "Đã sẵn sàng ngoại tuyến"
                        : "Available offline"
                    : i18n
                      ? i18n.t("pwa.downloadOffline")
                      : vi
                        ? "Tải ngoại tuyến"
                        : "Download offline"}
            </span>
          </Button>
        </DialogTrigger>

        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-8">
              <CloudDownload
                className="text-primary size-5 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">
                {vi ? "Tải học phần ngoại tuyến" : "Download for Offline Study"}
              </span>
            </DialogTitle>
            <DialogDescription className="truncate">
              {setTitle}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Status summary */}
            <div className="bg-secondary/60 border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs sm:text-sm">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {vi ? "Trạng thái hiện tại:" : "Current status:"}
                  </span>
                  {record?.status === "ready" ? (
                    <Badge variant="success">
                      {vi ? "Đã tải đầy đủ" : "Ready offline"}
                    </Badge>
                  ) : record?.status === "partial" ? (
                    <Badge variant="warning">
                      {vi
                        ? `Thiếu ${record.failed_media_urls.length} tệp`
                        : `${record.failed_media_urls.length} media failed`}
                    </Badge>
                  ) : record?.status === "revoked" ? (
                    <Badge variant="destructive">
                      {vi ? "Quyền bị thu hồi" : "Access revoked"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {vi ? "Chưa tải xuống" : "Not downloaded"}
                    </Badge>
                  )}
                </div>
                {record && record.status !== "revoked" && (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {vi
                      ? `${record.question_count} câu hỏi · ${record.media_count} tệp phương tiện · ${formatBytes(record.estimated_total_bytes)}`
                      : `${record.question_count} questions · ${record.media_count} media files · ${formatBytes(record.estimated_total_bytes)}`}
                  </p>
                )}
              </div>

              {isDownloaded && isOnline && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate || downloading}
                >
                  <RefreshCw
                    className={cn("size-3.5", checkingUpdate && "animate-spin")}
                    aria-hidden="true"
                  />
                  {vi ? "Kiểm tra cập nhật" : "Check updates"}
                </Button>
              )}
            </div>

            {updateStatus?.hasUpdate && (
              <div className="border-primary/30 bg-accent text-accent-foreground rounded-lg border p-3 text-xs sm:text-sm">
                <p className="font-medium">
                  {vi
                    ? "Học phần trên máy chủ có nội dung mới hơn bản đã tải."
                    : "A newer version of this study set is available on the server."}
                </p>
              </div>
            )}

            {/* Scope selection (Full set vs Selected Chapters) */}
            {chapters.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {vi ? "Phạm vi tải xuống" : "Download scope"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={scope === "all" ? "default" : "outline"}
                    onClick={() => setScope("all")}
                    disabled={downloading}
                  >
                    {vi ? "Toàn bộ học phần" : "Entire study set"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={scope === "chapters" ? "default" : "outline"}
                    onClick={() => setScope("chapters")}
                    disabled={downloading}
                  >
                    {vi ? "Chọn theo chương" : "Select chapters"}
                  </Button>
                </div>

                {scope === "chapters" && (
                  <div className="border-border max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {chapters.map((chapter) => {
                      const checked = selectedChapters.includes(chapter);
                      return (
                        <label
                          key={chapter}
                          className="flex cursor-pointer items-center gap-2.5 text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleChapter(chapter)}
                            disabled={downloading}
                          />
                          <span className="min-w-0 truncate">{chapter}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Media inclusion option with mandatory media guard */}
            <div className="border-border space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label
                    htmlFor={includeMediaId}
                    className="text-sm font-medium"
                  >
                    {vi
                      ? "Tải kèm hình ảnh, sơ đồ & âm thanh"
                      : "Include images, diagrams & audio"}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {vi
                      ? "Cần thiết cho câu hỏi hình ảnh, chế độ Sơ đồ và Nghe & Gõ ngoại tuyến."
                      : "Required for visual questions, Diagram mode, and offline Listening/Spell."}
                  </p>
                </div>
                <Switch
                  id={includeMediaId}
                  checked={hasRequiredMedia ? true : includeMedia}
                  onCheckedChange={setIncludeMedia}
                  disabled={hasRequiredMedia || downloading}
                />
              </div>
              {hasRequiredMedia && (
                <p
                  data-testid="text-only-guard-notice"
                  className="text-warning-subtle-foreground bg-warning-subtle flex items-start gap-2 rounded-md p-2 text-xs"
                >
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {i18n
                      ? i18n.t("pwa.textOnlyBlockedMedia")
                      : vi
                        ? "Học phần này chứa câu hỏi hình ảnh/sơ đồ/âm thanh bắt buộc — cần tải kèm tệp phương tiện để học chính xác ngoại tuyến."
                        : "This study set requires media for accurate offline study; text-only mode is disabled."}
                  </span>
                </p>
              )}
            </div>

            {/* Estimated footprint & browser storage quota */}
            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <HardDrive className="size-3.5" aria-hidden="true" />
                {vi
                  ? `Ước tính: ${questionCount} câu (~${formatBytes(estimatedTextBytes + estimatedMediaBytes)})`
                  : `Estimate: ${questionCount} items (~${formatBytes(estimatedTextBytes + estimatedMediaBytes)})`}
              </span>
              {storageInfo?.supported && storageInfo.availableBytes !== null && (
                <span>
                  {vi
                    ? `Còn trống: ${formatBytes(storageInfo.availableBytes)}`
                    : `Available: ${formatBytes(storageInfo.availableBytes)}`}
                </span>
              )}
            </div>

            {/* Active progress bar */}
            {downloading && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2
                      className="text-primary size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    {progress?.phase === "downloading_media"
                      ? vi
                        ? "Đang tải hình ảnh & âm thanh..."
                        : "Downloading media files..."
                      : progress?.phase === "saving_content"
                        ? vi
                          ? "Đang lưu vào bộ nhớ thiết bị..."
                          : "Saving to device storage..."
                        : vi
                          ? "Đang tải câu hỏi..."
                          : "Fetching questions..."}
                  </span>
                  <span className="tabular-nums">{progressPct}%</span>
                </div>
                <Progress value={progressPct} />
                {progress && (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatBytes(progress.downloadedBytes)}
                    {progress.totalItems > 0
                      ? ` · ${progress.completedItems}/${progress.totalItems}`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {/* Error display */}
            {errorMessage && (
              <div
                role="alert"
                className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-start gap-2 rounded-lg border p-3 text-xs sm:text-sm"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2 pt-2">
            {downloading ? (
              <Button variant="outline" onClick={handleCancelDownload}>
                <X className="size-4" aria-hidden="true" />
                {vi ? "Hủy tải xuống" : "Cancel download"}
              </Button>
            ) : (
              <>
                {isDownloaded && (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmRemoveOpen(true)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {i18n
                      ? i18n.t("pwa.removeDownload")
                      : vi
                        ? "Xóa bản ngoại tuyến"
                        : "Remove offline"}
                  </Button>
                )}
                {isPartial && isOnline && (
                  <Button variant="secondary" onClick={handleRetryFailed}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {vi ? "Thử tải lại tệp lỗi" : "Retry failed files"}
                  </Button>
                )}
                <Button
                  onClick={handleStartDownload}
                  disabled={!isOnline || !effectiveUserId}
                >
                  <CloudDownload className="size-4" aria-hidden="true" />
                  {isDownloaded
                    ? i18n
                      ? i18n.t("pwa.updateDownload")
                      : vi
                        ? "Cập nhật bản tải"
                        : "Update download"
                    : i18n
                      ? i18n.t("pwa.downloadOffline")
                      : vi
                        ? "Tải về học ngoại tuyến"
                        : "Download offline"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Xóa bản tải ngoại tuyến?" : "Remove offline copy?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Bản lưu cục bộ của học phần này và các tệp phương tiện chỉ thuộc học phần này sẽ bị xóa khỏi trình duyệt. Dữ liệu trên máy chủ không bị ảnh hưởng."
                : "This removes the local offline copy and unshared media from this browser. Your server data stays untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {vi ? "Hủy" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemoveDownload}
            >
              {vi ? "Xóa bản ngoại tuyến" : "Remove offline copy"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
