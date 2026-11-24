"use client";

import * as React from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Ear,
  Grid2x2,
  Image as ImageIcon,
  Keyboard,
  Layers,
  ListChecks,
  RotateCcw,
  Star,
  StickyNote,
  Volume2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalI18n } from "@/lib/i18n";
import { selectMatchTile, type MatchBoardState } from "@/lib/learning/match-engine";
import {
  clearOfflineCheckpoint,
  createOfflineMatchSession,
  evaluateOfflineDiagramHit,
  getOfflineAvailableModes,
  gradeOfflineAnswer,
  loadOfflineCheckpoint,
  loadOfflineStudyBundle,
  recordOfflineStudyAction,
  resolveOfflineSpellAudio,
  saveOfflineCheckpoint,
  saveOfflineNote,
  toggleOfflineStar,
  type OfflineCapableMode,
  type OfflineSpellAudioResolution,
  type OfflineStudyBundle,
} from "@/lib/offline/offline-session";
import type { ConfidenceLevel } from "@/types/v3";
import { cn } from "@/lib/utils";
import { useOptionalPwa } from "./PwaProvider";

export interface OfflineStudyRunnerProps {
  userId: string;
  setId: string;
  initialMode?: OfflineCapableMode;
  onExit: () => void;
}

const CONFIDENCE_OPTIONS: Array<{
  value: ConfidenceLevel;
  labelVi: string;
  labelEn: string;
}> = [
  { value: "certain", labelVi: "Chắc chắn", labelEn: "Certain" },
  { value: "unsure", labelVi: "Phân vân", labelEn: "Unsure" },
  { value: "guessing", labelVi: "Đoán mò", labelEn: "Guessing" },
];

export function OfflineStudyRunner({
  userId,
  setId,
  initialMode = "flashcards",
  onExit,
}: OfflineStudyRunnerProps) {
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  const [bundle, setBundle] = React.useState<OfflineStudyBundle | null>(null);
  const [loadedBundleKey, setLoadedBundleKey] = React.useState<string | null>(
    null,
  );
  const expectedBundleKey = `${userId}:${setId}`;
  const loading = loadedBundleKey !== expectedBundleKey;
  const [mode, setMode] = React.useState<OfflineCapableMode>(initialMode);
  const [index, setIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [selectedOptionIds, setSelectedOptionIds] = React.useState<string[]>([]);
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const [confidence, setConfidence] = React.useState<ConfidenceLevel | null>(null);
  const [feedback, setFeedback] = React.useState<{
    checked: boolean;
    isCorrect: boolean;
  }>({ checked: false, isCorrect: false });
  const [correctCount, setCorrectCount] = React.useState(0);
  const [restoredBanner, setRestoredBanner] = React.useState(false);

  // Media blob URLs for active item
  const [promptImageSrc, setPromptImageSrc] = React.useState<string | null>(null);
  const [backImageSrc, setBackImageSrc] = React.useState<string | null>(null);
  const [diagramImageSrc, setDiagramImageSrc] = React.useState<string | null>(null);
  const [spellAudio, setSpellAudio] =
    React.useState<OfflineSpellAudioResolution | null>(null);

  // Match board & Diagram hotspot state
  const [matchBoard, setMatchBoard] = React.useState<MatchBoardState | null>(null);
  const [diagramHotspotIndex, setDiagramHotspotIndex] = React.useState(0);
  const [diagramFeedback, setDiagramFeedback] = React.useState<string | null>(null);

  // Personal note drawer
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [noteText, setNoteText] = React.useState("");
  const [noteSavedNotice, setNoteSavedNotice] = React.useState(false);
  const [starredIds, setStarredIds] = React.useState<Set<string>>(new Set());

  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const lastCompositionEndRef = React.useRef<number>(0);

  React.useEffect(() => {
    let active = true;
    let loadedBundle: OfflineStudyBundle | null = null;

    void (async () => {
      try {
        const nextBundle = await loadOfflineStudyBundle(userId, setId);
        if (!active) {
          nextBundle?.revokeAllMediaUrls();
          return;
        }
        loadedBundle = nextBundle;
        setBundle(nextBundle);

        if (nextBundle) {
          setStarredIds(
            new Set(
              nextBundle.questions
                .filter((q) => q.is_starred)
                .map((q) => q.id),
            ),
          );
          const cp = await loadOfflineCheckpoint(userId, setId, initialMode, "offline");
          if (active && cp && cp.current_index > 0 && cp.current_index < nextBundle.questions.length) {
            setIndex(cp.current_index);
            const savedCorrect = Number(cp.state_json.correctCount ?? 0);
            setCorrectCount(Number.isFinite(savedCorrect) ? savedCorrect : 0);
            setRestoredBanner(true);
          }
        }
      } finally {
        if (active) setLoadedBundleKey(`${userId}:${setId}`);
      }
    })();

    return () => {
      active = false;
      loadedBundle?.revokeAllMediaUrls();
    };
  }, [userId, setId, initialMode]);

  const currentQuestion = bundle?.questions[index] ?? null;
  const currentDiagram = bundle?.diagrams[0] ?? null;
  const totalQuestions = bundle?.questions.length ?? 0;

  // Load media URLs & local note whenever active question / mode changes
  React.useEffect(() => {
    if (!bundle) return;
    let active = true;

    void (async () => {
      if (currentQuestion) {
        const [pImg, bImg] = await Promise.all([
          bundle.resolveMediaUrl(currentQuestion.prompt_image_url),
          bundle.resolveMediaUrl(currentQuestion.back_image_url),
        ]);
        if (!active) return;
        setPromptImageSrc(pImg);
        setBackImageSrc(bImg);

        const existingNote = bundle.notesByQuestionId.get(currentQuestion.id);
        setNoteText(existingNote?.content_text ?? "");
        setNoteSavedNotice(false);

        if (mode === "spell") {
          const resolved = await resolveOfflineSpellAudio(
            userId,
            currentQuestion,
            bundle.resolveMediaUrl,
          );
          if (active) setSpellAudio(resolved);
        } else {
          setSpellAudio(null);
        }
      }

      if (mode === "diagram" && currentDiagram) {
        const dImg = await bundle.resolveMediaUrl(currentDiagram.base_image_url);
        if (active) setDiagramImageSrc(dImg);
      }
    })();

    return () => {
      active = false;
    };
  }, [bundle, currentQuestion, currentDiagram, mode, userId]);

  const switchMode = async (nextMode: OfflineCapableMode) => {
    setMode(nextMode);
    setFlipped(false);
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setFeedback({ checked: false, isCorrect: false });
    setDiagramFeedback(null);
    setRestoredBanner(false);

    if (nextMode === "match" && bundle) {
      setMatchBoard(createOfflineMatchSession(bundle.questions, { pairCount: 6 }));
      return;
    }

    const cp = await loadOfflineCheckpoint(userId, setId, nextMode, "offline");
    if (cp && bundle && cp.current_index > 0 && cp.current_index < bundle.questions.length) {
      setIndex(cp.current_index);
      setRestoredBanner(true);
    } else {
      setIndex(0);
    }
  };

  const advanceQuestion = async (wasCorrect: boolean) => {
    if (!bundle) return;
    const nextCorrect = wasCorrect ? correctCount + 1 : correctCount;
    setCorrectCount(nextCorrect);

    const nextIdx = index + 1;
    setFlipped(false);
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setConfidence(null);
    setFeedback({ checked: false, isCorrect: false });

    if (nextIdx < bundle.questions.length) {
      setIndex(nextIdx);
      await saveOfflineCheckpoint(userId, {
        study_set_id: setId,
        mode,
        session_key: "offline",
        current_index: nextIdx,
        total_items: bundle.questions.length,
        state_json: { correctCount: nextCorrect },
      });
    } else {
      setIndex(bundle.questions.length);
      await clearOfflineCheckpoint(userId, setId, mode, "offline");
    }
    await pwa?.refreshOfflineState();
  };

  const handleFlashcardRate = async (
    rating: "again" | "hard" | "good" | "easy",
  ) => {
    if (!currentQuestion) return;
    const isCorrect = rating !== "again";
    await recordOfflineStudyAction(userId, {
      study_set_id: setId,
      question_id: currentQuestion.id,
      mode: "flashcards",
      is_correct: isCorrect,
      self_rating: rating,
      confidence,
    });
    await advanceQuestion(isCorrect);
  };

  const handleCheckAnswer = async () => {
    if (!currentQuestion) return;
    let isCorrect = false;
    if (
      mode === "write" ||
      mode === "spell" ||
      !currentQuestion.options ||
      currentQuestion.options.length === 0
    ) {
      if (currentQuestion.question_type === "numerical") {
        isCorrect = gradeOfflineAnswer(currentQuestion, {
          kind: "numerical",
          value: typedAnswer,
          unit:
            currentQuestion.type_payload?.type === "numerical"
              ? currentQuestion.type_payload.unit
              : null,
        }).isCorrect;
      } else {
        isCorrect = gradeOfflineAnswer(currentQuestion, {
          kind: "text",
          value: typedAnswer,
        }).isCorrect;
      }
    } else {
      isCorrect = gradeOfflineAnswer(currentQuestion, {
        kind: "options",
        selected_option_ids: selectedOptionIds,
      }).isCorrect;
    }

    setFeedback({ checked: true, isCorrect });

    await recordOfflineStudyAction(userId, {
      study_set_id: setId,
      question_id: currentQuestion.id,
      mode,
      is_correct: isCorrect,
      selected_option_ids: selectedOptionIds,
      typed_answer: typedAnswer || null,
      confidence,
    });
    await pwa?.refreshOfflineState();
  };

  const handleToggleStar = async () => {
    if (!currentQuestion) return;
    const nextStarred = !starredIds.has(currentQuestion.id);
    setStarredIds((prev) => {
      const copy = new Set(prev);
      if (nextStarred) copy.add(currentQuestion.id);
      else copy.delete(currentQuestion.id);
      return copy;
    });
    await toggleOfflineStar(userId, setId, currentQuestion.id, nextStarred);
    await pwa?.refreshOfflineState();
  };

  const handleSaveNote = async () => {
    if (!currentQuestion || !bundle) return;
    const saved = await saveOfflineNote(userId, setId, currentQuestion.id, noteText);
    bundle.notesByQuestionId.set(currentQuestion.id, saved);
    setNoteSavedNotice(true);
    await pwa?.refreshOfflineState();
  };

  const handlePlaySpellAudio = () => {
    if (!spellAudio) return;
    if (spellAudio.source === "downloaded_audio" && audioElRef.current) {
      audioElRef.current.currentTime = 0;
      void audioElRef.current.play().catch(() => undefined);
      return;
    }
    if (
      spellAudio.source === "local_tts" &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spellAudio.speechText);
      utterance.lang = spellAudio.lang;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleDiagramClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!currentDiagram || !currentDiagram.hotspots?.length) return;
    const target = currentDiagram.hotspots[diagramHotspotIndex];
    if (!target) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const point = {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
    const hit = evaluateOfflineDiagramHit(target, point);
    setDiagramFeedback(
      hit
        ? vi
          ? `Chính xác: ${target.label}`
          : `Correct: ${target.label}`
        : vi
          ? `Chưa trúng "${target.label}". Hãy thử bấm lại.`
          : `Missed "${target.label}". Try tapping again.`,
    );
    if (hit) {
      setDiagramHotspotIndex((prev) =>
        (prev + 1) % (currentDiagram.hotspots?.length ?? 1),
      );
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {vi ? "Đang nạp học phần từ bộ nhớ cục bộ..." : "Loading downloaded set..."}
        </CardContent>
      </Card>
    );
  }

  if (!bundle) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-muted-foreground">
            {vi
              ? "Không tìm thấy dữ liệu ngoại tuyến cho học phần này."
              : "Offline data for this study set was not found."}
          </p>
          <Button variant="outline" size="sm" onClick={onExit}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {vi ? "Quay lại danh sách" : "Back to list"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const availableModes = getOfflineAvailableModes(bundle.questions, bundle.diagrams);
  const modeButtons: Array<{
    id: OfflineCapableMode;
    labelVi: string;
    labelEn: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "flashcards", labelVi: "Flashcards", labelEn: "Flashcards", icon: Layers },
    { id: "practice", labelVi: "Luyện tập", labelEn: "Practice", icon: ListChecks },
    { id: "learn", labelVi: "Học sâu", labelEn: "Learn", icon: BookOpen },
    { id: "write", labelVi: "Gõ đáp án", labelEn: "Write", icon: Keyboard },
    { id: "spell", labelVi: "Nghe & Gõ", labelEn: "Spell", icon: Ear },
    { id: "match", labelVi: "Ghép thẻ", labelEn: "Match", icon: Grid2x2 },
    { id: "diagram", labelVi: "Sơ đồ", labelEn: "Diagram", icon: ImageIcon },
  ];

  const isFinished =
    mode !== "match" && mode !== "diagram" && index >= totalQuestions;
  const progressPct =
    totalQuestions > 0 ? Math.min(100, Math.round((index / totalQuestions) * 100)) : 0;

  return (
    <div className="space-y-4" data-testid="offline-study-runner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExit}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {vi ? "Quay lại" : "Back"}
          </Button>
          <h2 className="truncate text-base font-semibold">{bundle.set.title}</h2>
        </div>
        <Badge variant="accent">
          {vi ? "Chế độ học ngoại tuyến" : "Offline Study Session"}
        </Badge>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={vi ? "Chế độ học ngoại tuyến" : "Offline study modes"}>
        {modeButtons.map((item) => {
          const Icon = item.icon;
          const avail = availableModes[item.id];
          return (
            <Button
              key={item.id}
              size="sm"
              variant={mode === item.id ? "default" : "outline"}
              disabled={!avail.available}
              onClick={() => void switchMode(item.id)}
              role="tab"
              aria-selected={mode === item.id}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {vi ? item.labelVi : item.labelEn}
            </Button>
          );
        })}
      </div>

      {restoredBanner && (
        <div className="bg-accent text-accent-foreground border-primary/20 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
          <span>
            {vi
              ? `Đã khôi phục tiến độ học ngoại tuyến tại câu ${index + 1}/${totalQuestions}.`
              : `Restored your offline session at item ${index + 1}/${totalQuestions}.`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIndex(0);
              setCorrectCount(0);
              setRestoredBanner(false);
              void clearOfflineCheckpoint(userId, setId, mode, "offline");
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {vi ? "Học lại từ đầu" : "Restart"}
          </Button>
        </div>
      )}

      {/* Match Mode Offline */}
      {mode === "match" && matchBoard ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {vi ? "Ghép thẻ ngoại tuyến" : "Offline Match"}
            </CardTitle>
            <span className="text-muted-foreground text-xs tabular-nums">
              {matchBoard.matchedPairIds.length}/{matchBoard.pairs.length}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            {matchBoard.isCompleted ? (
              <div className="space-y-3 py-4 text-center">
                <CheckCircle2
                  className="text-success mx-auto size-8"
                  aria-hidden="true"
                />
                <p className="font-medium">
                  {vi ? "Hoàn thành vòng ghép thẻ!" : "Match round complete!"}
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    setMatchBoard(
                      createOfflineMatchSession(bundle.questions, { pairCount: 6 }),
                    )
                  }
                >
                  {vi ? "Chơi vòng mới" : "Play again"}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {matchBoard.tiles.map((tile) => {
                  const matched = matchBoard.matchedPairIds.includes(tile.pairId);
                  const selected = matchBoard.selectedTileId === tile.tileId;
                  return (
                    <button
                      key={tile.tileId}
                      type="button"
                      disabled={matched}
                      onClick={() =>
                        setMatchBoard((prev) =>
                          prev ? selectMatchTile(prev, tile.tileId) : prev,
                        )
                      }
                      className={cn(
                        "min-h-20 rounded-lg border p-3 text-left text-xs transition-colors sm:text-sm",
                        matched && "border-success/30 bg-success-subtle opacity-50",
                        selected && "border-primary bg-accent ring-2 ring-primary/40",
                        !matched && !selected && "border-border bg-card hover:bg-secondary",
                      )}
                    >
                      <span className="line-clamp-3">{tile.text}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : mode === "diagram" && currentDiagram ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{currentDiagram.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentDiagram.hotspots && currentDiagram.hotspots.length > 0 && (
              <p className="text-sm font-medium">
                {vi
                  ? `Chọn vị trí: ${currentDiagram.hotspots[diagramHotspotIndex]?.label ?? ""}`
                  : `Locate: ${currentDiagram.hotspots[diagramHotspotIndex]?.label ?? ""}`}
              </p>
            )}
            {diagramImageSrc ? (
              <div
                onClick={handleDiagramClick}
                className="border-border relative cursor-crosshair overflow-hidden rounded-lg border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={diagramImageSrc}
                  alt={currentDiagram.title}
                  className="block h-auto w-full select-none"
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {vi
                  ? "Ảnh sơ đồ chưa có trong bộ nhớ đệm ngoại tuyến."
                  : "Diagram base image is not cached offline."}
              </p>
            )}
            {/* Accessible keyboard hotspot fallback */}
            <div className="flex flex-wrap gap-2">
              {(currentDiagram.hotspots ?? []).map((hs, hsIdx) => (
                <Button
                  key={hs.id}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const target = currentDiagram.hotspots?.[diagramHotspotIndex];
                    const isHit = target?.id === hs.id;
                    setDiagramFeedback(
                      isHit
                        ? vi
                          ? `Chính xác: ${hs.label}`
                          : `Correct: ${hs.label}`
                        : vi
                          ? `Vị trí đó là "${hs.label}".`
                          : `That point is "${hs.label}".`,
                    );
                    if (isHit) {
                      setDiagramHotspotIndex(
                        (hsIdx + 1) % (currentDiagram.hotspots?.length ?? 1),
                      );
                    }
                  }}
                >
                  {hsIdx + 1}. {hs.label}
                </Button>
              ))}
            </div>
            {diagramFeedback && (
              <p role="status" className="text-sm font-medium">
                {diagramFeedback}
              </p>
            )}
          </CardContent>
        </Card>
      ) : isFinished ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <CheckCircle2
              className="text-success mx-auto size-9"
              aria-hidden="true"
            />
            <h3 className="text-lg font-semibold">
              {vi ? "Hoàn thành phiên học ngoại tuyến!" : "Offline study session complete!"}
            </h3>
            <p className="text-muted-foreground text-sm tabular-nums">
              {vi
                ? `Kết quả: ${correctCount}/${totalQuestions} câu đúng. Tiến độ đã được lưu vào hàng đợi và sẽ tự đồng bộ khi có mạng.`
                : `Score: ${correctCount}/${totalQuestions} correct. Progress is queued locally and will sync automatically once online.`}
            </p>
            <Button
              onClick={() => {
                setIndex(0);
                setCorrectCount(0);
              }}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {vi ? "Ôn lại vòng mới" : "Study again"}
            </Button>
          </CardContent>
        </Card>
      ) : currentQuestion ? (
        <Card>
          <CardHeader className="space-y-2 pb-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
              <span>
                {index + 1} / {totalQuestions}
                {currentQuestion.chapter ? ` · ${currentQuestion.chapter}` : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={handleToggleStar}
                  aria-label={vi ? "Đánh dấu sao" : "Toggle star"}
                >
                  <Star
                    className={cn(
                      "size-4",
                      starredIds.has(currentQuestion.id) &&
                        "fill-warning text-warning",
                    )}
                    aria-hidden="true"
                  />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setNoteOpen((o) => !o)}
                  aria-label={vi ? "Ghi chú cá nhân" : "Personal note"}
                >
                  <StickyNote className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <Progress value={progressPct} />
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Spell audio control */}
            {mode === "spell" && spellAudio && (
              <div className="bg-secondary/60 border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs sm:text-sm">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePlaySpellAudio}
                    disabled={
                      spellAudio.source === "unavailable" ||
                      spellAudio.source === "network_tts_unavailable_offline"
                    }
                  >
                    <Volume2 className="size-4" aria-hidden="true" />
                    {vi ? "Nghe phát âm" : "Play audio"}
                  </Button>
                  {spellAudio.source === "downloaded_audio" && spellAudio.blobUrl && (
                    <audio
                      ref={audioElRef}
                      src={spellAudio.blobUrl}
                      controls
                      className="h-8 max-w-52"
                    />
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {spellAudio.source === "downloaded_audio"
                    ? vi
                      ? "Đang dùng tệp âm thanh đã tải ngoại tuyến"
                      : "Using downloaded offline audio"
                    : spellAudio.source === "local_tts"
                      ? vi
                        ? `Giọng đọc thiết bị cục bộ (${spellAudio.voiceName ?? spellAudio.lang})`
                        : `Local device TTS (${spellAudio.voiceName ?? spellAudio.lang})`
                      : vi
                        ? "Không có giọng đọc cục bộ ngoại tuyến; hiển thị gợi ý văn bản."
                        : "Local offline TTS unavailable; using text prompt fallback."}
                </span>
              </div>
            )}

            {/* Question Prompt & Cached Image */}
            <div className="space-y-3">
              {currentQuestion.prompt.trim().length > 0 && (
                <p className="text-base font-medium leading-relaxed">
                  {currentQuestion.prompt}
                </p>
              )}
              {promptImageSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={promptImageSrc}
                  alt={vi ? "Hình ảnh câu hỏi" : "Question illustration"}
                  className="border-border max-h-72 rounded-lg border object-contain"
                />
              )}
            </div>

            {/* Confidence Selector */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">
                {vi ? "Mức độ tự tin:" : "Confidence:"}
              </span>
              {CONFIDENCE_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant={confidence === opt.value ? "default" : "outline"}
                  onClick={() =>
                    setConfidence((prev) => (prev === opt.value ? null : opt.value))
                  }
                >
                  {vi ? opt.labelVi : opt.labelEn}
                </Button>
              ))}
            </div>

            {/* Flashcards Mode */}
            {mode === "flashcards" ? (
              <div className="space-y-4">
                {flipped ? (
                  <div className="bg-secondary/50 border-border space-y-2 rounded-lg border p-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      {vi ? "Đáp án / Mặt sau" : "Answer / Back"}
                    </p>
                    <p className="text-sm font-medium sm:text-base">
                      {currentQuestion.back_text ||
                        currentQuestion.options
                          ?.filter((o) => o.is_correct)
                          .map((o) => o.content)
                          .join("; ") ||
                        currentQuestion.accepted_answers?.[0]?.answer_text ||
                        "—"}
                    </p>
                    {backImageSrc && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={backImageSrc}
                        alt={vi ? "Hình ảnh mặt sau" : "Back illustration"}
                        className="border-border max-h-60 rounded-lg border object-contain"
                      />
                    )}
                    {currentQuestion.explanation && (
                      <p className="text-muted-foreground text-xs sm:text-sm">
                        {currentQuestion.explanation}
                      </p>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setFlipped(true)}
                  >
                    {vi ? "Lật thẻ xem đáp án" : "Flip card"}
                  </Button>
                )}

                {flipped && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Button
                      variant="outline"
                      onClick={() => void handleFlashcardRate("again")}
                    >
                      {vi ? "Học lại" : "Again"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleFlashcardRate("hard")}
                    >
                      {vi ? "Khó" : "Hard"}
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => void handleFlashcardRate("good")}
                    >
                      {vi ? "Tốt" : "Good"}
                    </Button>
                    <Button
                      variant="success"
                      onClick={() => void handleFlashcardRate("easy")}
                    >
                      {vi ? "Dễ" : "Easy"}
                    </Button>
                  </div>
                )}
              </div>
            ) : mode === "write" ||
              mode === "spell" ||
              !currentQuestion.options ||
              currentQuestion.options.length === 0 ? (
              <div className="space-y-3">
                <Input
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onCompositionEnd={() => {
                    lastCompositionEndRef.current = performance.now();
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229 &&
                      performance.now() - lastCompositionEndRef.current >= 50
                    ) {
                      e.preventDefault();
                      if (!feedback.checked) {
                        void handleCheckAnswer();
                      } else {
                        void advanceQuestion(feedback.isCorrect);
                      }
                    }
                  }}
                  disabled={feedback.checked}
                  placeholder={
                    vi ? "Nhập câu trả lời của bạn..." : "Type your answer..."
                  }
                />
                {!feedback.checked ? (
                  <Button onClick={() => void handleCheckAnswer()}>
                    {vi ? "Kiểm tra" : "Check answer"}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div
                      role="status"
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-3 text-sm",
                        feedback.isCorrect
                          ? "border-success/30 bg-success-subtle text-success-subtle-foreground"
                          : "border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground",
                      )}
                    >
                      {feedback.isCorrect ? (
                        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-4 shrink-0" aria-hidden="true" />
                      )}
                      <span>
                        {feedback.isCorrect
                          ? vi
                            ? "Chính xác!"
                            : "Correct!"
                          : vi
                            ? `Đáp án đúng: ${currentQuestion.back_text || currentQuestion.accepted_answers?.[0]?.answer_text || currentQuestion.options?.find((o) => o.is_correct)?.content || ""}`
                            : `Correct answer: ${currentQuestion.back_text || currentQuestion.accepted_answers?.[0]?.answer_text || currentQuestion.options?.find((o) => o.is_correct)?.content || ""}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next item"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* Multiple / Single choice offline */
              <div className="space-y-3">
                <div className="space-y-2">
                  {currentQuestion.options.map((opt) => {
                    const isMulti =
                      currentQuestion.question_type === "multiple_choice";
                    const selected = selectedOptionIds.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={feedback.checked}
                        onClick={() => {
                          setSelectedOptionIds((prev) => {
                            if (!isMulti) return [opt.id];
                            return prev.includes(opt.id)
                              ? prev.filter((id) => id !== opt.id)
                              : [...prev, opt.id];
                          });
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                          selected &&
                            !feedback.checked &&
                            "border-primary bg-accent ring-1 ring-primary",
                          feedback.checked &&
                            opt.is_correct &&
                            "border-success bg-success-subtle text-success-subtle-foreground",
                          feedback.checked &&
                            selected &&
                            !opt.is_correct &&
                            "border-destructive bg-destructive-subtle text-destructive-subtle-foreground",
                          !selected && !feedback.checked && "border-border hover:bg-secondary",
                        )}
                      >
                        <span className="font-semibold">{opt.label}.</span>
                        <span className="min-w-0 flex-1">{opt.content}</span>
                      </button>
                    );
                  })}
                </div>

                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={selectedOptionIds.length === 0}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    {currentQuestion.explanation && (
                      <p className="text-muted-foreground bg-secondary/50 rounded-lg p-3 text-xs sm:text-sm">
                        {currentQuestion.explanation}
                      </p>
                    )}
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next question"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Personal Note Editor (Queued offline) */}
            {noteOpen && (
              <div className="border-border space-y-2 border-t pt-3">
                <p className="text-xs font-medium">
                  {vi
                    ? "Ghi chú riêng tư (lưu cục bộ & đồng bộ khi có mạng)"
                    : "Private note (saved locally & queued for sync)"}
                </p>
                <Textarea
                  value={noteText}
                  onChange={(e) => {
                    setNoteText(e.target.value);
                    setNoteSavedNotice(false);
                  }}
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={handleSaveNote}>
                    {vi ? "Lưu ghi chú ngoại tuyến" : "Save offline note"}
                  </Button>
                  {noteSavedNotice && (
                    <span className="text-success text-xs">
                      {vi ? "Đã lưu cục bộ." : "Saved locally."}
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
