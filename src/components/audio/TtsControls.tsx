"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Cloud,
  Gauge,
  HardDrive,
  Pause,
  Play,
  Square,
  Volume2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  clampTtsRate,
  getDefaultTtsController,
  selectBestVoice,
  type TtsStateSnapshot,
  type TtsVoiceInfo,
} from "@/lib/audio/tts";
import { useOptionalI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TTS_RATES = [0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0] as const;

export interface TtsControlsProps {
  text: string;
  defaultLang?: string;
  defaultRate?: number;
  /** Changing this key immediately cancels stale speech (e.g., active questionId). */
  autoCancelKey?: string;
  compact?: boolean;
  className?: string;
  onVoiceChange?: (voice: TtsVoiceInfo | null) => void;
  onRateChange?: (rate: number) => void;
}

export function TtsControls({
  text,
  defaultLang,
  defaultRate = 1.0,
  autoCancelKey,
  compact = false,
  className,
  onVoiceChange,
  onRateChange,
}: TtsControlsProps) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const pathname = usePathname();
  const voiceSelectId = React.useId();
  const rateSelectId = React.useId();

  const controller = React.useMemo(() => getDefaultTtsController(), []);
  const [state, setState] = React.useState<TtsStateSnapshot>(() => controller.getState());
  const [voices, setVoices] = React.useState<TtsVoiceInfo[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = React.useState<string>("");
  const [rate, setRate] = React.useState<number>(() => clampTtsRate(defaultRate));

  React.useEffect(() => {
    const unsubState = controller.subscribeState(setState);
    let mounted = true;

    const applyVoices = (loaded: TtsVoiceInfo[]) => {
      if (!mounted) return;
      setVoices(loaded);
      setSelectedVoiceURI((prev) => {
        if (prev && loaded.some((v) => v.voiceURI === prev)) return prev;
        const best = selectBestVoice(loaded, defaultLang ?? (vi ? "vi-VN" : "en-US"), true);
        return best?.voiceURI ?? loaded[0]?.voiceURI ?? "";
      });
    };

    void controller.loadVoices(1500).then(applyVoices);
    const unsubVoices = controller.subscribeVoices(applyVoices);

    return () => {
      mounted = false;
      unsubState();
      unsubVoices();
      controller.stop();
    };
  }, [controller, defaultLang, vi]);

  // Cancel stale speech on route navigation or active question change
  React.useEffect(() => {
    controller.stop();
  }, [controller, pathname, autoCancelKey, text]);

  const selectedVoice = React.useMemo(
    () => voices.find((v) => v.voiceURI === selectedVoiceURI) ?? null,
    [voices, selectedVoiceURI],
  );

  const isThisTextSpeaking =
    state.status === "speaking" && state.activeText === text.trim();
  const isThisTextPaused =
    state.status === "paused" && state.activeText === text.trim();

  const handleSpeak = () => {
    controller.speak({
      text,
      lang: selectedVoice?.lang ?? defaultLang ?? (vi ? "vi-VN" : "en-US"),
      voiceURI: selectedVoiceURI || null,
      preferLocal: true,
      rate,
    });
  };

  const handlePauseResume = () => {
    if (isThisTextSpeaking) {
      controller.pause();
    } else if (isThisTextPaused) {
      controller.resume();
    } else {
      handleSpeak();
    }
  };

  const handleStop = () => {
    controller.stop();
  };

  const handleVoiceSelect = (uri: string) => {
    setSelectedVoiceURI(uri);
    const next = voices.find((v) => v.voiceURI === uri) ?? null;
    onVoiceChange?.(next);
  };

  const handleRateSelect = (nextRate: number) => {
    const clamped = clampTtsRate(nextRate);
    setRate(clamped);
    onRateChange?.(clamped);
  };

  if (!state.supported) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
          className,
        )}
      >
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>
          {vi
            ? "Trình duyệt này chưa hỗ trợ đọc văn bản tự động (Web Speech Synthesis)."
            : "Browser text-to-speech (Web Speech Synthesis) is not supported on this device."}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        compact ? "p-2.5 space-y-2" : "p-3 space-y-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={isThisTextSpeaking ? "secondary" : "default"}
          size="sm"
          disabled={!text.trim()}
          onClick={handlePauseResume}
          className="min-h-11 gap-1.5 sm:min-h-9"
        >
          {isThisTextSpeaking ? (
            <>
              <Pause className="size-4" aria-hidden="true" />
              <span>{vi ? "Tạm dừng" : "Pause"}</span>
            </>
          ) : isThisTextPaused ? (
            <>
              <Play className="size-4" aria-hidden="true" />
              <span>{vi ? "Tiếp tục" : "Resume"}</span>
            </>
          ) : (
            <>
              <Volume2 className="size-4" aria-hidden="true" />
              <span>{vi ? "Đọc văn bản" : "Read aloud"}</span>
            </>
          )}
        </Button>

        {(isThisTextSpeaking || isThisTextPaused) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStop}
            aria-label={vi ? "Dừng đọc" : "Stop speaking"}
            className="min-h-11 gap-1.5 sm:min-h-9"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
            <span>{vi ? "Dừng" : "Stop"}</span>
          </Button>
        )}

        {/* Speed Selector */}
        <div className="flex items-center gap-1">
          <label
            htmlFor={rateSelectId}
            className="inline-flex items-center text-xs text-muted-foreground"
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            <span className="sr-only">{vi ? "Tốc độ đọc" : "Speech rate"}</span>
          </label>
          <select
            id={rateSelectId}
            value={String(rate)}
            onChange={(e) => handleRateSelect(Number(e.target.value))}
            aria-label={vi ? "Tốc độ đọc văn bản" : "Speech playback rate"}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs font-medium tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {TTS_RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r}x
              </option>
            ))}
          </select>
        </div>

        {/* Honest localService vs network disclosure */}
        {selectedVoice && (
          <Badge
            variant={selectedVoice.localService ? "secondary" : "outline"}
            className="gap-1 text-xs font-normal"
          >
            {selectedVoice.localService ? (
              <>
                <HardDrive className="size-3" aria-hidden="true" />
                <span>{vi ? "Giọng nội bộ (ngoại tuyến)" : "On-device voice (offline)"}</span>
              </>
            ) : (
              <>
                <Cloud className="size-3" aria-hidden="true" />
                <span>{vi ? "Giọng mạng trình duyệt" : "Browser network voice"}</span>
              </>
            )}
          </Badge>
        )}
      </div>

      {/* Voice selector row */}
      {!compact && voices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={voiceSelectId}
            className="text-xs font-medium text-muted-foreground"
          >
            {vi ? "Giọng đọc:" : "Voice:"}
          </label>
          <select
            id={voiceSelectId}
            value={selectedVoiceURI}
            onChange={(e) => handleVoiceSelect(e.target.value)}
            className="h-9 min-w-0 max-w-full flex-1 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-xs"
          >
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang}) —{" "}
                {voice.localService
                  ? vi
                    ? "Nội bộ"
                    : "Local"
                  : vi
                    ? "Mạng"
                    : "Network"}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {vi
            ? `Lỗi bộ đọc trình duyệt (${state.error}). Hãy chọn giọng nội bộ khác hoặc tải tệp âm thanh.`
            : `Browser speech synthesis error (${state.error}). Try selecting a local voice or uploaded audio.`}
        </p>
      )}
    </div>
  );
}
