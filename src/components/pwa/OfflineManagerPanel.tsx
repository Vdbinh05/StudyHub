"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  CloudOff,
  HardDrive,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalI18n } from "@/lib/i18n";
import { resolveNoteConflict } from "@/lib/offline/conflict-resolver";
import {
  clearUserOfflineData,
  getAllDownloadedSets,
  getLocalOfflineBytesBreakdown,
  getStorageEstimate,
  listNoteConflicts,
} from "@/lib/offline/db";
import {
  deleteDownloadedStudySet,
  retryFailedMediaDownloads,
} from "@/lib/offline/download-manager";
import {
  clearSyncNotices,
  getSyncQueueSummary,
  syncPendingEvents,
  type SyncQueueSummary,
} from "@/lib/offline/sync-queue";
import type {
  OfflineDownloadedSetRecord,
  OfflineLocalNoteRecord,
  StorageEstimateInfo,
} from "@/lib/offline/types";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format-bytes";
import { useOptionalPwa } from "./PwaProvider";

export interface OfflineManagerPanelProps {
  /** Optional explicit userId override (defaults to active user from PwaProvider) */
  userId?: string | null;
  /** Optional callback invoked when user clicks "Study Offline" for a downloaded set */
  onStudySetOffline?: (setId: string) => void;
  className?: string;
}

function formatSyncTimestamp(iso: string | null, vi: boolean): string {
  if (!iso) return vi ? "Chưa đồng bộ" : "Never synced";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(vi ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function OfflineManagerPanel({
  userId: explicitUserId,
  onStudySetOffline,
  className,
}: OfflineManagerPanelProps) {
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  const activeUserId = explicitUserId ?? pwa?.activeUserId ?? null;
  const isOnline = pwa?.isOnline ?? true;

  const [loading, setLoading] = React.useState(true);
  const [downloadedSets, setDownloadedSets] = React.useState<
    OfflineDownloadedSetRecord[]
  >([]);
  const [conflicts, setConflicts] = React.useState<OfflineLocalNoteRecord[]>([]);
  const [syncSummary, setSyncSummary] = React.useState<SyncQueueSummary | null>(
    null,
  );
  const [storageEstimate, setStorageEstimate] =
    React.useState<StorageEstimateInfo | null>(null);
  const [localBreakdown, setLocalBreakdown] = React.useState<{
    downloadedSetsCount: number;
    questionsCount: number;
    diagramsCount: number;
    mediaCount: number;
    mediaBytes: number;
    totalEstimatedBytes: number;
    pendingSyncCount: number;
    noteConflictsCount: number;
  } | null>(null);

  const [syncing, setSyncing] = React.useState(false);
  const [busySetId, setBusySetId] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);

  // Merge editor state keyed by question_id
  const [mergeDrafts, setMergeDrafts] = React.useState<Record<string, string>>(
    {},
  );
  const [editingMergeId, setEditingMergeId] = React.useState<string | null>(
    null,
  );

  const fetchPanelData = React.useCallback(async () => {
    const est = await getStorageEstimate();
    if (!activeUserId) {
      return {
        est,
        sets: [] as OfflineDownloadedSetRecord[],
        noteConflicts: [] as OfflineLocalNoteRecord[],
        summary: null as SyncQueueSummary | null,
        breakdown: null as {
          downloadedSetsCount: number;
          questionsCount: number;
          diagramsCount: number;
          mediaCount: number;
          mediaBytes: number;
          totalEstimatedBytes: number;
          pendingSyncCount: number;
          noteConflictsCount: number;
        } | null,
      };
    }

    const [sets, noteConflicts, summary, breakdown] = await Promise.all([
      getAllDownloadedSets(activeUserId),
      listNoteConflicts(activeUserId),
      getSyncQueueSummary(activeUserId),
      getLocalOfflineBytesBreakdown(activeUserId),
    ]);

    return { est, sets, noteConflicts, summary, breakdown };
  }, [activeUserId]);

  const loadAll = React.useCallback(async () => {
    try {
      const result = await fetchPanelData();
      setStorageEstimate(result.est);
      setDownloadedSets(result.sets);
      setConflicts(result.noteConflicts);
      setSyncSummary(result.summary);
      setLocalBreakdown(result.breakdown);
    } catch {
      setStatusMessage(
        vi
          ? "Trình duyệt hiện tại hạn chế lưu trữ cục bộ (IndexedDB)."
          : "Local browser storage (IndexedDB) is restricted in this session.",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchPanelData, vi]);

  React.useEffect(() => {
    let active = true;
    void fetchPanelData()
      .then((result) => {
        if (!active) return;
        setStorageEstimate(result.est);
        setDownloadedSets(result.sets);
        setConflicts(result.noteConflicts);
        setSyncSummary(result.summary);
        setLocalBreakdown(result.breakdown);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setStatusMessage(
          vi
            ? "Trình duyệt hiện tại hạn chế lưu trữ cục bộ (IndexedDB)."
            : "Local browser storage (IndexedDB) is restricted in this session.",
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchPanelData, pwa?.offlineRevision, vi]);

  const handleSyncNow = async () => {
    if (!activeUserId || !isOnline) return;
    setSyncing(true);
    setStatusMessage(null);
    try {
      const outcome = await syncPendingEvents(activeUserId, { force: true });
      if (outcome.status === "auth_required") {
        setStatusMessage(
          vi
            ? "Phiên đăng nhập đã hết hạn. Toàn bộ tiến độ chờ đồng bộ vẫn được giữ nguyên — hãy đăng nhập lại để hoàn tất đồng bộ."
            : "Your session expired. All pending offline events are preserved safely — sign in again to finish syncing.",
        );
      } else if (outcome.conflictCount > 0) {
        setStatusMessage(
          vi
            ? `Phát hiện ${outcome.conflictCount} xung đột ghi chú cần bạn chọn phiên bản giữ lại bên dưới.`
            : `Found ${outcome.conflictCount} note conflict(s) to resolve below.`,
        );
      } else if (outcome.status === "success") {
        setStatusMessage(
          vi
            ? `Đã đồng bộ thành công (${outcome.appliedCount} sự kiện mới).`
            : `Sync complete (${outcome.appliedCount} event(s) applied).`,
        );
      }
      await loadAll();
      await pwa?.refreshOfflineState();
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveSet = async (setId: string) => {
    if (!activeUserId) return;
    setBusySetId(setId);
    try {
      await deleteDownloadedStudySet(activeUserId, setId);
      await loadAll();
      await pwa?.refreshOfflineState();
    } finally {
      setBusySetId(null);
    }
  };

  const handleRetryPartialSet = async (setId: string) => {
    if (!activeUserId || !isOnline) return;
    setBusySetId(setId);
    try {
      await retryFailedMediaDownloads(activeUserId, setId);
      await loadAll();
      await pwa?.refreshOfflineState();
    } finally {
      setBusySetId(null);
    }
  };

  const handleResolveConflict = async (
    questionId: string,
    strategy: "keep_local" | "keep_server" | "keep_merged",
  ) => {
    if (!activeUserId) return;
    const mergedText = mergeDrafts[questionId] ?? "";
    await resolveNoteConflict(
      activeUserId,
      questionId,
      strategy === "keep_merged"
        ? { strategy: "keep_merged", mergedText }
        : { strategy },
    );
    setEditingMergeId(null);
    await loadAll();
    await pwa?.refreshOfflineState();
  };

  const handleDismissNotices = async () => {
    if (!activeUserId) return;
    await clearSyncNotices(activeUserId);
    await loadAll();
  };

  const handleClearAllLocalData = async () => {
    if (!activeUserId) return;
    await clearUserOfflineData(activeUserId);
    setConfirmClearOpen(false);
    setStatusMessage(
      vi
        ? "Đã xóa toàn bộ dữ liệu ngoại tuyến của tài khoản này trên trình duyệt."
        : "Cleared all local offline data for this account on this browser.",
    );
    await loadAll();
    await pwa?.refreshOfflineState();
  };

  const allNotices = [
    ...(syncSummary?.revokedSetNotices ?? []).map((n) => ({
      ...n,
      kind: "revoked" as const,
    })),
    ...(syncSummary?.staleResetNotices ?? []).map((n) => ({
      ...n,
      kind: "reset" as const,
    })),
    ...(syncSummary?.deletedNotices ?? []).map((n) => ({
      ...n,
      kind: "deleted" as const,
    })),
  ];

  const storagePercent = storageEstimate?.usagePercent ?? 0;

  return (
    <div className={cn("space-y-4", className)} data-testid="offline-manager-panel">
      {/* Sync & Storage Overview */}
      <Card className="border-border">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HardDrive className="text-primary size-5" aria-hidden="true" />
              <CardTitle className="text-base">
                {vi ? "Quản lý học ngoại tuyến & Đồng bộ" : "Offline Storage & Sync"}
              </CardTitle>
            </div>
            <Badge variant={isOnline ? "success" : "warning"}>
              {isOnline ? (
                <Wifi className="size-3" aria-hidden="true" />
              ) : (
                <WifiOff className="size-3" aria-hidden="true" />
              )}
              {isOnline
                ? i18n
                  ? i18n.t("pwa.online")
                  : vi
                    ? "Trực tuyến"
                    : "Online"
                : i18n
                  ? i18n.t("pwa.offline")
                  : vi
                    ? "Ngoại tuyến"
                    : "Offline"}
            </Badge>
          </div>
          <CardDescription>
            {vi
              ? "Theo dõi dung lượng thiết bị, học phần đã tải, hàng đợi đồng bộ và xử lý xung đột ghi chú."
              : "Monitor device storage, downloaded sets, pending sync queue, and note conflicts."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Storage Usage Bar */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {i18n
                  ? i18n.t("pwa.storageUsed")
                  : vi
                    ? "Dung lượng đang dùng trên thiết bị"
                    : "Device storage used"}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {localBreakdown
                  ? vi
                    ? `StudyHub: ${formatBytes(localBreakdown.totalEstimatedBytes)} (${localBreakdown.downloadedSetsCount} học phần, ${localBreakdown.mediaCount} tệp)`
                    : `StudyHub: ${formatBytes(localBreakdown.totalEstimatedBytes)} (${localBreakdown.downloadedSetsCount} sets, ${localBreakdown.mediaCount} media)`
                  : "—"}
              </span>
            </div>
            <Progress value={storagePercent} />
            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
              {storageEstimate?.supported ? (
                <>
                  <span>
                    {vi
                      ? `Trình duyệt: ${formatBytes(storageEstimate.usageBytes)} / ${formatBytes(storageEstimate.quotaBytes)}`
                      : `Browser quota: ${formatBytes(storageEstimate.usageBytes)} / ${formatBytes(storageEstimate.quotaBytes)}`}
                  </span>
                  <span>{storagePercent.toFixed(1)}%</span>
                </>
              ) : (
                <span>
                  {vi
                    ? "Trình duyệt không cung cấp chỉ số hạn mức lưu trữ chi tiết."
                    : "Detailed browser quota estimation is not available in this browser."}
                </span>
              )}
            </div>
          </div>

          <Separator />

          {/* Pending Sync Status & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">
                  {vi
                    ? `${syncSummary?.pendingCount ?? 0} sự kiện chờ đồng bộ`
                    : `${syncSummary?.pendingCount ?? 0} pending sync event(s)`}
                </span>
                {(syncSummary?.authRequiredCount ?? 0) > 0 && (
                  <Badge variant="warning">
                    <Lock className="size-3" aria-hidden="true" />
                    {vi ? "Cần đăng nhập lại" : "Sign-in required"}
                  </Badge>
                )}
                {conflicts.length > 0 && (
                  <Badge variant="destructive">
                    {i18n
                      ? i18n.t("pwa.syncConflicts", { count: conflicts.length })
                      : vi
                        ? `${conflicts.length} xung đột cần xử lý`
                        : `${conflicts.length} conflict(s) to resolve`}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {i18n
                  ? i18n.t("pwa.lastSynced", {
                      time: formatSyncTimestamp(
                        syncSummary?.lastSyncedAt ?? null,
                        vi,
                      ),
                    })
                  : vi
                    ? `Đồng bộ lần cuối: ${formatSyncTimestamp(syncSummary?.lastSyncedAt ?? null, vi)}`
                    : `Last synced: ${formatSyncTimestamp(syncSummary?.lastSyncedAt ?? null, vi)}`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleSyncNow}
                disabled={!activeUserId || !isOnline || syncing}
                data-testid="sync-now-button"
              >
                <RefreshCw
                  className={cn("size-3.5", syncing && "animate-spin")}
                  aria-hidden="true"
                />
                {syncing
                  ? i18n
                    ? i18n.t("pwa.syncing")
                    : vi
                      ? "Đang đồng bộ..."
                      : "Syncing..."
                  : i18n
                    ? i18n.t("pwa.syncNow")
                    : vi
                      ? "Đồng bộ ngay"
                      : "Sync now"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmClearOpen(true)}
                disabled={!activeUserId}
                data-testid="clear-local-data-button"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {i18n
                  ? i18n.t("pwa.clearLocalData")
                  : vi
                    ? "Xóa dữ liệu ngoại tuyến"
                    : "Clear local data"}
              </Button>
            </div>
          </div>

          {statusMessage && (
            <div
              role="status"
              aria-live="polite"
              className="bg-secondary/70 border-border rounded-lg border p-3 text-xs sm:text-sm"
            >
              {statusMessage}
            </div>
          )}

          {/* Sync Notices (Reset / Revoked / Deleted) */}
          {allNotices.length > 0 && (
            <div className="border-warning/30 bg-warning-subtle space-y-2 rounded-lg border p-3 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-warning-subtle-foreground flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  {vi ? "Thông báo đồng bộ" : "Sync notices"}
                </p>
                <Button size="sm" variant="ghost" onClick={handleDismissNotices}>
                  {vi ? "Ẩn thông báo" : "Dismiss"}
                </Button>
              </div>
              <ul className="text-warning-subtle-foreground space-y-1 text-xs">
                {allNotices.slice(0, 5).map((notice) => (
                  <li key={notice.id}>• {notice.message}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Note Conflict Resolver (Lossless — never blind LWW) */}
      {conflicts.length > 0 && (
        <Card className="border-destructive/40" data-testid="note-conflicts-section">
          <CardHeader className="gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle
                className="text-destructive size-4"
                aria-hidden="true"
              />
              {vi
                ? `Xử lý xung đột ghi chú (${conflicts.length})`
                : `Resolve Note Conflicts (${conflicts.length})`}
            </CardTitle>
            <CardDescription>
              {vi
                ? "Ghi chú của bạn đã được sửa trên cả thiết bị này và máy chủ. StudyHub giữ nguyên cả 2 phiên bản để bạn chọn — không tự động ghi đè."
                : "Your note was edited both offline and on the server. Both versions are preserved so nothing is overwritten blindly."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {conflicts.map((note) => {
              const conflict = note.conflict!;
              const isMerging = editingMergeId === note.question_id;
              return (
                <div
                  key={note.question_id}
                  className="border-border space-y-3 rounded-lg border p-3.5"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="bg-secondary/50 space-y-1 rounded-md p-3">
                      <p className="text-xs font-semibold">
                        {vi ? "Phiên bản ngoại tuyến trên máy" : "Local offline version"}
                      </p>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {conflict.local_text || (vi ? "(Trống)" : "(Empty)")}
                      </p>
                    </div>
                    <div className="bg-accent/60 space-y-1 rounded-md p-3">
                      <p className="text-xs font-semibold">
                        {vi
                          ? `Phiên bản máy chủ (v${conflict.server_version})`
                          : `Server version (v${conflict.server_version})`}
                      </p>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {conflict.server_text || (vi ? "(Trống)" : "(Empty)")}
                      </p>
                    </div>
                  </div>

                  {isMerging ? (
                    <div className="space-y-2">
                      <Textarea
                        value={mergeDrafts[note.question_id] ?? ""}
                        onChange={(e) =>
                          setMergeDrafts((prev) => ({
                            ...prev,
                            [note.question_id]: e.target.value,
                          }))
                        }
                        rows={4}
                        aria-label={
                          vi ? "Nội dung ghi chú sau khi gộp" : "Merged note text"
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            handleResolveConflict(note.question_id, "keep_merged")
                          }
                        >
                          {vi ? "Lưu bản đã gộp" : "Save merged version"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingMergeId(null)}
                        >
                          {vi ? "Hủy" : "Cancel"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleResolveConflict(note.question_id, "keep_local")
                        }
                      >
                        {vi ? "Giữ bản trên máy" : "Keep local"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          handleResolveConflict(note.question_id, "keep_server")
                        }
                      >
                        {vi ? "Giữ bản máy chủ" : "Keep server"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setMergeDrafts((prev) => ({
                            ...prev,
                            [note.question_id]: [
                              conflict.local_text,
                              conflict.server_text,
                            ]
                              .filter(Boolean)
                              .join("\n---\n"),
                          }));
                          setEditingMergeId(note.question_id);
                        }}
                      >
                        {vi ? "Gộp thủ công" : "Merge manually"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Downloaded Study Sets List */}
      <Card className="border-border">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">
            {vi
              ? `Học phần đã tải xuống (${downloadedSets.length})`
              : `Downloaded Study Sets (${downloadedSets.length})`}
          </CardTitle>
          <CardDescription>
            {vi
              ? "Các học phần dưới đây có thể luyện tập ngay cả khi mất kết nối mạng."
              : "Study these downloaded sets seamlessly even without an internet connection."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">
              {vi ? "Đang kiểm tra bộ nhớ ngoại tuyến..." : "Checking offline storage..."}
            </p>
          ) : !activeUserId ? (
            <div className="bg-secondary/50 border-border rounded-lg border p-4 text-sm">
              <p className="text-muted-foreground">
                {vi
                  ? "Đăng nhập để xem và quản lý các học phần ngoại tuyến của riêng tài khoản bạn."
                  : "Sign in to view and manage offline study sets partitioned to your account."}
              </p>
            </div>
          ) : downloadedSets.length === 0 ? (
            <div className="bg-secondary/40 border-border flex flex-col items-start gap-2 rounded-lg border p-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CloudOff
                  className="text-muted-foreground size-4"
                  aria-hidden="true"
                />
                <span>
                  {vi
                    ? "Chưa có học phần nào được tải xuống"
                    : "No study sets downloaded yet"}
                </span>
              </div>
              <p className="text-muted-foreground text-xs sm:text-sm">
                {vi
                  ? 'Mở bất kỳ học phần nào trong Thư viện và chọn "Tải về học ngoại tuyến" để lưu sẵn câu hỏi, hình ảnh và âm thanh.'
                  : 'Open any study set in your Library and choose "Download offline" to store questions, diagrams, and audio locally.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {downloadedSets.map((set) => {
                const isBusy = busySetId === set.set_id;
                const isRevoked = set.status === "revoked";
                const isPartial = set.status === "partial";
                return (
                  <div
                    key={set.set_id}
                    className="border-border flex flex-col justify-between gap-3 rounded-lg border p-3.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">
                          {set.title}
                        </h3>
                        {isRevoked ? (
                          <Badge variant="destructive">
                            {vi ? "Đã thu hồi quyền" : "Revoked"}
                          </Badge>
                        ) : isPartial ? (
                          <Badge variant="warning">
                            {vi
                              ? `Thiếu ${set.failed_media_urls.length} tệp`
                              : `${set.failed_media_urls.length} media failed`}
                          </Badge>
                        ) : (
                          <Badge variant="success">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            {vi ? "Sẵn sàng" : "Ready"}
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {vi
                          ? `${set.question_count} câu hỏi · ${set.diagram_count} sơ đồ · ${set.media_count} tệp · ${formatBytes(set.estimated_total_bytes)}`
                          : `${set.question_count} questions · ${set.diagram_count} diagrams · ${set.media_count} media · ${formatBytes(set.estimated_total_bytes)}`}
                        {set.downloaded_chapters
                          ? ` · ${set.downloaded_chapters.length} ${vi ? "chương" : "chapters"}`
                          : ""}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!isRevoked &&
                        (onStudySetOffline ? (
                          <Button
                            size="sm"
                            onClick={() => onStudySetOffline(set.set_id)}
                            disabled={isBusy}
                          >
                            <BookOpen className="size-3.5" aria-hidden="true" />
                            {vi ? "Học ngoại tuyến" : "Study offline"}
                          </Button>
                        ) : (
                          <Button size="sm" asChild>
                            <Link
                              href={`/offline?setId=${encodeURIComponent(set.set_id)}`}
                            >
                              <BookOpen className="size-3.5" aria-hidden="true" />
                              {vi ? "Học ngoại tuyến" : "Study offline"}
                            </Link>
                          </Button>
                        ))}
                      {isPartial && isOnline && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleRetryPartialSet(set.set_id)}
                          disabled={isBusy}
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                          {vi ? "Thử lại" : "Retry"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemoveSet(set.set_id)}
                        disabled={isBusy}
                        aria-label={
                          vi
                            ? `Xóa bản ngoại tuyến của ${set.title}`
                            : `Remove offline copy of ${set.title}`
                        }
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        <span className="sr-only sm:not-sr-only">
                          {vi ? "Xóa" : "Remove"}
                        </span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Honest Privacy & Revocation Disclosure */}
      <div
        data-testid="offline-privacy-disclosure"
        className="bg-secondary/50 border-border flex items-start gap-3 rounded-lg border p-3.5 text-xs text-muted-foreground sm:text-sm"
      >
        <ShieldCheck
          className="text-primary mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="text-foreground font-medium">
            {vi ? "Quyền riêng tư & Phạm vi ngoại tuyến" : "Privacy & Offline Scope"}
          </p>
          <p>
            {i18n
              ? i18n.t("pwa.privacyDisclosure")
              : vi
                ? "Dữ liệu ngoại tuyến được tách biệt theo từng tài khoản và tự động xóa khi bạn đăng xuất. Nếu quyền truy cập học phần chia sẻ bị thu hồi, thay đổi ngoại tuyến sẽ không được đồng bộ."
                : "Offline storage is strictly partitioned per account and automatically cleared on sign-out. Offline edits to revoked shared sets are never applied on sync."}
          </p>
          <p>
            {vi
              ? "Lưu ý: Các bài thi thử tính giờ yêu cầu kết nối mạng để đảm bảo đồng hồ máy chủ và chống lộ đáp án; 7 chế độ tự học (Flashcards, Luyện tập, Học sâu, Gõ đáp án, Nghe & Gõ, Ghép thẻ, Sơ đồ) hoạt động đầy đủ khi ngoại tuyến."
              : "Note: Timed Mock Exams require an online connection for server clock and answer-key protection; all 7 study modes (Flashcards, Practice, Learn, Write, Spell, Match, Diagram) work offline."}
          </p>
        </div>
      </div>

      {/* Destructive Clear Local Data Confirmation */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {i18n
                ? i18n.t("pwa.clearLocalData")
                : vi
                  ? "Xóa toàn bộ dữ liệu ngoại tuyến?"
                  : "Clear all local offline data?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {i18n
                ? i18n.t("pwa.clearLocalConfirm")
                : vi
                  ? "Xóa tất cả học phần, tệp phương tiện và hàng đợi chưa đồng bộ đã lưu trên trình duyệt này? Dữ liệu trên máy chủ vẫn nguyên vẹn."
                  : "Remove all downloaded study sets, cached media, and unsynced local data from this browser? Server data stays untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {vi ? "Hủy" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearAllLocalData}
              data-testid="confirm-clear-local-data"
            >
              {vi ? "Xóa dữ liệu cục bộ" : "Clear local data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
