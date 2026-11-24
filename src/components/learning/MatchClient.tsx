"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  CheckCircle2,
  Clock,
  Play,
  RotateCcw,
  Settings2,
  Trophy,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import {
  createStudySession,
  updateStudySession,
} from "@/lib/learning/api-client";
import {
  createMatchBoard,
  questionsToMatchCandidates,
  selectMatchTile,
  type MatchBoardState,
} from "@/lib/learning/match-engine";
import { cn } from "@/lib/utils";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "./useStudySetBundle";

interface MatchClientProps {
  setId: string;
}

function formatTenths(ms: number): string {
  const safe = Math.max(0, ms);
  const seconds = Math.floor(safe / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(remSec).padStart(2, "0")}.${tenths}`;
}

export function MatchClient({ setId }: MatchClientProps) {
  const { locale, t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
  } = useStudySetBundle(setId);

  const [phase, setPhase] = React.useState<"config" | "playing" | "complete">(
    "config",
  );
  const [pairCount, setPairCount] = React.useState<number>(6);
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [showTimer, setShowTimer] = React.useState<boolean>(true);

  const [board, setBoard] = React.useState<MatchBoardState | null>(null);
  const [liveElapsedMs, setLiveElapsedMs] = React.useState<number>(0);
  const [mismatchTileIds, setMismatchTileIds] = React.useState<[string, string] | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = React.useState<string>("");

  const sessionIdRef = React.useRef<string | null>(null);
  const mismatchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const tileButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  React.useEffect(() => {
    return () => {
      if (mismatchTimeoutRef.current) clearTimeout(mismatchTimeoutRef.current);
    };
  }, []);

  const candidates = React.useMemo(() => {
    if (!bundle) return [];
    const filtered =
      selectedChapter === "all"
        ? bundle.questions
        : bundle.questions.filter(
            (q) => (q.chapter?.trim() || "") === selectedChapter,
          );
    return questionsToMatchCandidates(filtered);
  }, [bundle, selectedChapter]);

  // Live wall-clock elapsed timer (never increments a blind counter)
  React.useEffect(() => {
    if (phase !== "playing" || !board || board.isCompleted) return;
    const interval = setInterval(() => {
      setLiveElapsedMs(Math.max(0, Date.now() - board.startedAtMs));
    }, 100);
    return () => clearInterval(interval);
  }, [board, phase]);

  const startRound = React.useCallback(async () => {
    if (candidates.length === 0) return;
    if (mismatchTimeoutRef.current) clearTimeout(mismatchTimeoutRef.current);

    const newBoard = createMatchBoard(candidates, {
      pairCount,
      startedAtMs: Date.now(),
    });

    setBoard(newBoard);
    setLiveElapsedMs(0);
    setMismatchTileIds(null);
    setStatusMessage("");
    setPhase(newBoard.pairs.length > 0 ? "playing" : "config");
    sessionIdRef.current = null;

    if (newBoard.pairs.length > 0) {
      try {
        const session = await createStudySession({
          study_set_id: setId,
          mode: "match",
          config: { pairCount: newBoard.pairs.length, chapter: selectedChapter },
          total_items: newBoard.pairs.length,
        });
        sessionIdRef.current = session.id;
      } catch {
        // Non-blocking
      }
    }
  }, [candidates, pairCount, selectedChapter, setId]);

  const handleTileClick = React.useCallback(
    (tileId: string) => {
      if (!board || board.isCompleted) return;
      const nowMs = Date.now();
      const next = selectMatchTile(board, tileId, nowMs);
      setBoard(next);

      if (next.lastOutcome === "match") {
        setMismatchTileIds(null);
        setStatusMessage(lText(locale, "Ghép đúng cặp!", "Matched pair!"));
        if (next.isCompleted) {
          setLiveElapsedMs(next.elapsedMs);
          setPhase("complete");
          if (sessionIdRef.current) {
            updateStudySession(sessionIdRef.current, {
              status: "completed",
              completed_items: next.pairs.length,
              correct_items: next.pairs.length,
              duration_seconds: Math.max(1, Math.round(next.elapsedMs / 1000)),
            }).catch(() => {});
          }
        }
      } else if (next.lastOutcome === "mismatch" && next.lastPairTileIds) {
        setMismatchTileIds(next.lastPairTileIds);
        setStatusMessage(
          lText(locale, "Chưa khớp — hãy thử lại.", "Not a match — try again."),
        );
        if (mismatchTimeoutRef.current) clearTimeout(mismatchTimeoutRef.current);
        mismatchTimeoutRef.current = setTimeout(() => {
          setMismatchTileIds(null);
        }, 450);
      }
    },
    [board, locale],
  );

  // Keyboard grid arrow navigation across Match tiles
  const handleTileKeyDown = React.useCallback(
    (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!board) return;
      const total = board.tiles.length;
      const cols = total <= 8 ? 2 : 4;
      let nextIdx = -1;

      if (event.key === "ArrowRight") nextIdx = (index + 1) % total;
      else if (event.key === "ArrowLeft") nextIdx = (index - 1 + total) % total;
      else if (event.key === "ArrowDown") nextIdx = (index + cols) % total;
      else if (event.key === "ArrowUp") nextIdx = (index - cols + total) % total;

      if (nextIdx >= 0) {
        event.preventDefault();
        tileButtonRefs.current[nextIdx]?.focus();
      }
    },
    [board],
  );

  if (isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.match")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.match")}>
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={bundle.studySet.title}
      subtitle={lText(locale, "Chế độ Ghép thẻ", "Match Mode")}
      progressCurrent={
        phase === "playing" && board ? board.matchedPairIds.length : undefined
      }
      progressTotal={
        phase === "playing" && board ? board.pairs.length : undefined
      }
      headerRight={
        phase === "playing" && showTimer ? (
          <Badge variant="outline" className="gap-1.5 px-3 py-1 font-mono tabular-nums">
            <Clock className="size-3.5" aria-hidden="true" />
            <span>{formatTenths(liveElapsedMs)}</span>
          </Badge>
        ) : null
      }
    >
      {candidates.length === 0 ? (
        <StudyEmptyState
          setId={setId}
          title={lText(
            locale,
            "Chưa đủ cặp dữ liệu để ghép thẻ",
            "Not enough term-answer pairs for Match",
          )}
          onResetFilters={
            selectedChapter !== "all"
              ? () => setSelectedChapter("all")
              : undefined
          }
        />
      ) : phase === "config" ? (
        <Card className="mx-auto my-4 w-full max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings2 className="size-5 text-primary" aria-hidden="true" />
              {lText(locale, "Thiết lập vòng Ghép thẻ", "Configure Match Round")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{lText(locale, "Số cặp thẻ mỗi vòng", "Pairs per Round")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {[4, 6, 8].map((count) => (
                  <Button
                    key={count}
                    variant={pairCount === count ? "default" : "outline"}
                    className="min-h-11 tabular-nums"
                    aria-pressed={pairCount === count}
                    onClick={() => setPairCount(count)}
                  >
                    {count} {lText(locale, "cặp", "pairs")} ({count * 2}{" "}
                    {lText(locale, "thẻ", "tiles")})
                  </Button>
                ))}
              </div>
            </div>

            {bundle.chapters.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="match-chapter">
                  {lText(locale, "Chương", "Chapter")}
                </Label>
                <Select
                  value={selectedChapter}
                  onValueChange={setSelectedChapter}
                >
                  <SelectTrigger id="match-chapter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {lText(locale, "Tất cả chương", "All chapters")}
                    </SelectItem>
                    {bundle.chapters.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-4 py-3">
              <Label htmlFor="match-timer" className="cursor-pointer">
                {lText(locale, "Hiển thị đồng hồ bấm giờ", "Show live timer")}
              </Label>
              <Switch
                id="match-timer"
                checked={showTimer}
                onCheckedChange={setShowTimer}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {lText(
                locale,
                "Hệ thống tự động loại bỏ các định nghĩa trùng lặp trong cùng một vòng để đảm bảo mỗi cặp ghép là duy nhất.",
                "Duplicate definitions in the same round are automatically excluded so every pair is unambiguous.",
              )}
            </p>

            <Button size="lg" className="min-h-11 w-full" onClick={() => void startRound()}>
              <Play className="size-4" aria-hidden="true" />
              {lText(locale, "Bắt đầu ghép thẻ", "Start Matching")}
            </Button>
          </CardContent>
        </Card>
      ) : phase === "complete" && board ? (
        <Card className="mx-auto my-6 w-full max-w-xl">
          <CardContent className="space-y-6 py-8 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
              <Trophy className="size-7" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold">
                {lText(locale, "Hoàn thành ghép thẻ!", "Match Round Complete!")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {lText(
                  locale,
                  `Bạn đã ghép đúng toàn bộ ${board.pairs.length} cặp.`,
                  `You matched all ${board.pairs.length} pairs.`,
                )}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{t("study.timeSpent")}</p>
                <p className="mt-1 font-mono text-xl font-bold text-primary tabular-nums">
                  {formatTenths(board.elapsedMs)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {lText(locale, "Lượt ghép", "Attempts")}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {board.attempts}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {lText(locale, "Ghép nhầm", "Mismatches")}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {board.mismatches}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void startRound()}>
                <RotateCcw className="size-4" aria-hidden="true" />
                {lText(locale, "Chơi vòng mới", "Play New Round")}
              </Button>
              <Button variant="outline" onClick={() => setPhase("config")}>
                {lText(locale, "Đổi cấu hình", "Change Settings")}
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/sets/${setId}`}>
                  {lText(locale, "Về học phần", "Back to Set")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : board ? (
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {/* Status bar with live region */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 min-h-6"
            >
              {board.lastOutcome === "match" ? (
                <Badge variant="success">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  {statusMessage}
                </Badge>
              ) : board.lastOutcome === "mismatch" && mismatchTileIds ? (
                <Badge variant="destructive">
                  <XCircle className="size-3" aria-hidden="true" />
                  {statusMessage}
                </Badge>
              ) : (
                <span className="text-muted-foreground">
                  {lText(
                    locale,
                    "Chọn 1 thẻ Câu hỏi và 1 thẻ Đáp án tương ứng (hỗ trợ phím mũi tên & Enter).",
                    "Select a Prompt card and its matching Answer card (supports Arrow keys & Enter).",
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="tabular-nums">
                {lText(locale, "Nhầm", "Misses")}: {board.mismatches}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void startRound()}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {t("common.reset")}
              </Button>
            </div>
          </div>

          {/* Match Tile Grid */}
          <div
            className={cn(
              "grid gap-3",
              board.tiles.length <= 8
                ? "grid-cols-2 sm:grid-cols-4"
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
            )}
          >
            {board.tiles.map((tile, idx) => {
              const isMatched = board.matchedPairIds.includes(tile.pairId);
              const isSelected = board.selectedTileId === tile.tileId;
              const isMismatched = Boolean(
                mismatchTileIds && mismatchTileIds.includes(tile.tileId),
              );

              return (
                <motion.button
                  key={tile.tileId}
                  ref={(el) => {
                    tileButtonRefs.current[idx] = el;
                  }}
                  type="button"
                  disabled={isMatched}
                  aria-pressed={isSelected}
                  aria-label={`${
                    tile.side === "prompt"
                      ? lText(locale, "Câu hỏi", "Prompt")
                      : lText(locale, "Đáp án", "Answer")
                  }: ${tile.text}${
                    isMatched
                      ? ` (${lText(locale, "Đã ghép", "Matched")})`
                      : ""
                  }`}
                  onClick={() => handleTileClick(tile.tileId)}
                  onKeyDown={(e) => handleTileKeyDown(idx, e)}
                  animate={
                    isMismatched && !prefersReducedMotion
                      ? { x: [0, -6, 6, -4, 4, 0] }
                      : isMatched
                        ? { opacity: 0.35, scale: prefersReducedMotion ? 1 : 0.96 }
                        : { x: 0, opacity: 1, scale: 1 }
                  }
                  transition={{ duration: 0.22 }}
                  className={cn(
                    "flex min-h-[104px] sm:min-h-[120px] flex-col justify-between rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isMatched
                      ? "border-success/50 bg-success-subtle text-success-subtle-foreground cursor-default"
                      : isMismatched
                        ? "border-destructive bg-destructive-subtle text-destructive-subtle-foreground"
                        : isSelected
                          ? "border-primary bg-accent text-accent-foreground ring-2 ring-primary/30"
                          : "border-border bg-card text-foreground hover:bg-secondary/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-1 text-[11px] font-medium opacity-75">
                    <span>
                      {tile.side === "prompt"
                        ? lText(locale, "Câu hỏi", "Prompt")
                        : lText(locale, "Đáp án", "Answer")}
                    </span>
                    {isMatched ? (
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    ) : isMismatched ? (
                      <XCircle className="size-3.5" aria-hidden="true" />
                    ) : null}
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm font-medium leading-snug">
                    {tile.text}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </div>
      ) : null}
    </FocusModeShell>
  );
}
