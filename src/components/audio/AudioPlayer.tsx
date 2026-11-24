"use client";

import * as React from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Gauge,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOptionalI18n } from "@/lib/i18n";
import { isSafeHttpOrStorageUrl } from "@/lib/security/sanitize";
import { cn } from "@/lib/utils";

export const AUDIO_PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface AudioPlayerProps {
  src: string;
  title?: string | null;
  transcript?: string | null;
  mimeType?: string | null;
  /** Optional replay limit (e.g., for Listening exam/study questions). Null/undefined = unlimited. */
  maxReplays?: number | null;
  /** Defaults to "metadata" (or "none" when lazy=true) for bandwidth efficiency. */
  preload?: "none" | "metadata" | "auto";
  lazy?: boolean;
  compact?: boolean;
  defaultShowTranscript?: boolean;
  hideTranscriptToggle?: boolean;
  onReplayCountChange?: (count: number) => void;
  className?: string;
}

function isRenderableAudioUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("blob:")) return true;
  return isSafeHttpOrStorageUrl(trimmed);
}

export function AudioPlayer({
  src,
  title,
  transcript,
  mimeType,
  maxReplays = null,
  preload,
  lazy = false,
  compact = false,
  defaultShowTranscript = false,
  hideTranscriptToggle = false,
  onReplayCountChange,
  className,
}: AudioPlayerProps) {
  const i18n = useOptionalI18n();
  const vi = (i18n?.locale ?? "vi") === "vi";
  const transcriptId = React.useId();
  const speedSelectId = React.useId();

  const audioRef = React.useRef<HTMLAudioElement>(null);
  const hasCountedCurrentPlayRef = React.useRef(false);
  const countedSrcRef = React.useRef<string>(src);

  const [speed, setSpeed] = React.useState<number>(1);
  const [playbackMeta, setPlaybackMeta] = React.useState<{
    src: string;
    replayCount: number;
    hasError: boolean;
  }>({ src, replayCount: 0, hasError: false });
  const [showTranscript, setShowTranscript] = React.useState(defaultShowTranscript);

  const replayCount = playbackMeta.src === src ? playbackMeta.replayCount : 0;
  const hasError = playbackMeta.src === src ? playbackMeta.hasError : false;

  React.useEffect(() => {
    countedSrcRef.current = src;
    hasCountedCurrentPlayRef.current = false;
  }, [src]);

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  if (!isRenderableAudioUrl(src)) {
    return null;
  }

  const effectivePreload = preload ?? (lazy ? "none" : "metadata");
  const replaysExhausted =
    typeof maxReplays === "number" && maxReplays > 0 && replayCount >= maxReplays;

  const handlePlay = () => {
    const el = audioRef.current;
    if (!el) return;

    if (countedSrcRef.current !== src) {
      countedSrcRef.current = src;
      hasCountedCurrentPlayRef.current = false;
    }

    if (replaysExhausted && !hasCountedCurrentPlayRef.current) {
      el.pause();
      el.currentTime = 0;
      return;
    }

    el.playbackRate = speed;

    if (!hasCountedCurrentPlayRef.current) {
      hasCountedCurrentPlayRef.current = true;
      setPlaybackMeta((prev) => {
        const base = prev.src === src ? prev.replayCount : 0;
        const next = base + 1;
        onReplayCountChange?.(next);
        return { src, replayCount: next, hasError: false };
      });
    }
  };

  const handleEnded = () => {
    hasCountedCurrentPlayRef.current = false;
  };

  const handleReplayFromStart = () => {
    const el = audioRef.current;
    if (!el || replaysExhausted) return;
    hasCountedCurrentPlayRef.current = false;
    el.currentTime = 0;
    el.playbackRate = speed;
    void el.play().catch(() => {
      // Browser autoplay restriction or decode failure
    });
  };

  const handleSpeedChange = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        compact ? "p-2.5 space-y-2" : "p-3.5 space-y-3",
        className,
      )}
    >
      {/* Top bar: Title + Replay badge + Speed selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Volume2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-foreground">
            {title?.trim() || (vi ? "Âm thanh đính kèm" : "Attached audio")}
          </span>
          <Badge variant="secondary" className="shrink-0 tabular-nums text-xs">
            {typeof maxReplays === "number" && maxReplays > 0
              ? vi
                ? `Đã nghe ${replayCount}/${maxReplays}`
                : `Plays ${replayCount}/${maxReplays}`
              : vi
                ? `Lượt nghe: ${replayCount}`
                : `Replays: ${replayCount}`}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1">
            <label
              htmlFor={speedSelectId}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <Gauge className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{vi ? "Tốc độ phát" : "Playback speed"}</span>
            </label>
            <select
              id={speedSelectId}
              value={String(speed)}
              onChange={(event) => handleSpeedChange(Number(event.target.value))}
              aria-label={vi ? "Tốc độ phát âm thanh" : "Audio playback speed"}
              className="h-9 rounded-md border border-input bg-background px-2 text-xs font-medium tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {AUDIO_PLAYBACK_SPEEDS.map((rate) => (
                <option key={rate} value={String(rate)}>
                  {rate}x
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReplayFromStart}
            disabled={replaysExhausted || hasError}
            aria-label={vi ? "Phát lại từ đầu" : "Replay from start"}
            className="min-h-9 gap-1.5 px-2.5 text-xs"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{vi ? "Nghe lại" : "Replay"}</span>
          </Button>
        </div>
      </div>

      {/* Native accessible <audio controls> element */}
      {hasError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive-subtle-foreground"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {vi
              ? "Không thể tải hoặc phát tệp âm thanh này trên trình duyệt hiện tại."
              : "Unable to load or play this audio file in the current browser."}
          </span>
        </div>
      ) : (
        <audio
          ref={audioRef}
          controls
          preload={effectivePreload}
          onPlay={handlePlay}
          onEnded={handleEnded}
          onLoadedMetadata={() => {
            if (audioRef.current) {
              audioRef.current.playbackRate = speed;
            }
          }}
          onError={() =>
            setPlaybackMeta((prev) => ({
              src,
              replayCount: prev.src === src ? prev.replayCount : 0,
              hasError: true,
            }))
          }
          className="w-full"
        >
          <source src={src} type={mimeType ?? undefined} />
          {vi
            ? "Trình duyệt của bạn không hỗ trợ phát âm thanh HTML5."
            : "Your browser does not support HTML5 audio playback."}
        </audio>
      )}

      {replaysExhausted && (
        <p className="text-xs font-medium text-warning-subtle-foreground">
          {vi
            ? "Bạn đã dùng hết số lượt nghe cho câu hỏi này."
            : "You have reached the maximum replay count for this item."}
        </p>
      )}

      {/* Accessible Transcript Toggle */}
      {transcript && transcript.trim().length > 0 && !hideTranscriptToggle && (
        <div className="border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showTranscript}
            aria-controls={transcriptId}
            onClick={() => setShowTranscript((prev) => !prev)}
            className="min-h-9 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <FileText className="size-3.5" aria-hidden="true" />
            <span>
              {showTranscript
                ? vi
                  ? "Ẩn bản ghi lời thoại"
                  : "Hide transcript"
                : vi
                  ? "Xem bản ghi lời thoại"
                  : "Show transcript"}
            </span>
            {showTranscript ? (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </Button>
          {showTranscript && (
            <div
              id={transcriptId}
              className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap"
            >
              {transcript}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
