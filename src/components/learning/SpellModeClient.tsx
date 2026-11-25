"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Headphones,
  HelpCircle,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Settings2,
  Square,
  Star,
  Volume2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { MediaGallery } from "@/components/media/MediaGallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  detectSpeechLanguage,
  filterVoicesByLanguage,
  getDefaultTtsController,
  selectBestVoice,
  type TtsStateSnapshot,
  type TtsVoiceInfo,
} from "@/lib/audio/tts";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createStudySession,
  deleteCheckpoint,
  isSafeDisplayImageUrl,
  listCheckpoints,
  recordStudySessionAnswer,
  updateStudySession,
  upsertCheckpoint,
  upsertCheckpointKeepalive,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import {
  loadLocalCheckpoint,
  makeCheckpointSessionKey,
  pickNewestCheckpoint,
  reconcileCheckpointQuestions,
  saveLocalCheckpoint,
  clearLocalCheckpoint,
} from "@/lib/learning/checkpoints";
import { applyConfidenceToSm2 } from "@/lib/learning/confidence";
import {
  getQuestionExplanationDisplayItems,
  getQuestionPromptDisplayItems,
} from "@/lib/learning/media-helpers";
import {
  createSpellQueueState,
  extractSpellTarget,
  generateSpellHint,
  gradeSpellingAnswer,
  recordSpellQueueAttempt,
  type SpellGradeResult,
  type SpellGradingOptions,
  type SpellHintLevel,
  type SpellQueueState,
  type SpellTargetDescriptor,
} from "@/lib/learning/spell";
import { invalidateLearningCaches } from "@/lib/query-keys";
import type {
  ConfidenceLevel,
  LearningSessionCheckpoint,
  Question,
} from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { ConfidenceSelector } from "./ConfidenceSelector";
import { ContextualQuestionEditorModal } from "./ContextualQuestionEditorModal";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { ResetProgressDialog } from "./ResetProgressDialog";
import { ResumeSessionBanner } from "./ResumeSessionBanner";
import { SafeRichText } from "./SafeRichText";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useAuthenticatedUserId,
  useStudySetBundle,
} from "./useStudySetBundle";

const SPEED_OPTIONS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5] as const;
const LANG_OPTIONS = [
  { value: "auto", vi: "Tự động theo nội dung thẻ", en: "Auto-detect from text" },
  { value: "vi-VN", vi: "Tiếng Việt (vi-VN)", en: "Vietnamese (vi-VN)" },
  { value: "en-US", vi: "Tiếng Anh - Mỹ (en-US)", en: "English - US (en-US)" },
  { value: "en-GB", vi: "Tiếng Anh - Anh (en-GB)", en: "English - UK (en-GB)" },
  { value: "fr-FR", vi: "Tiếng Pháp (fr-FR)", en: "French (fr-FR)" },
  { value: "de-DE", vi: "Tiếng Đức (de-DE)", en: "German (de-DE)" },
  { value: "ja-JP", vi: "Tiếng Nhật (ja-JP)", en: "Japanese (ja-JP)" },
  { value: "ko-KR", vi: "Tiếng Hàn (ko-KR)", en: "Korean (ko-KR)" },
  { value: "zh-CN", vi: "Tiếng Trung (zh-CN)", en: "Chinese (zh-CN)" },
] as const;

function computeSpellProgressMetrics(queue: SpellQueueState): {
  progressedCount: number;
  currentIndex: number;
  progressPercent: number;
} {
  const total = Math.max(0, queue.totalItems);
  if (total === 0) {
    return { progressedCount: 0, currentIndex: 0, progressPercent: 0 };
  }
  if (queue.sessionCompleted) {
    return {
      progressedCount: total,
      currentIndex: Math.max(0, total - 1),
      progressPercent: 100,
    };
  }
  const completedCount = queue.completedIds.length;
  const progressedCount = Math.min(
    total,
    Math.max(completedCount, Math.min(total, queue.totalAttempts)),
  );
  const partialOnly = Math.max(0, progressedCount - completedCount);
  const weightedPct = Math.round(
    ((completedCount + partialOnly * 0.45) / total) * 100,
  );
  const progressPercent =
    progressedCount > 0 ? Math.max(1, Math.min(99, weightedPct)) : 0;
  const currentIndex =
    progressedCount > 0 ? Math.min(Math.max(0, total - 1), progressedCount) : 0;
  return { progressedCount, currentIndex, progressPercent };
}

export interface SpellModeClientProps {
  setId: string;
}

export function SpellModeClient({ setId }: SpellModeClientProps) {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isFreshLaunch = searchParams.get("fresh") === "1";
  const { preferences, playFeedbackSound } = useUserPreferences();
  const authenticatedUserId = useAuthenticatedUserId();
  const spellPrefs = preferences.mode_preferences?.spell;
  const prefersReducedMotion = useReducedMotion() || preferences.reduced_motion;

  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
    canEdit,
    toggleStar,
    updateLocalProgress,
    updateLocalQuestion,
  } = useStudySetBundle(setId);
  const [editingQuestionId, setEditingQuestionId] = React.useState<string | null>(
    null,
  );

  // Filters & sensitivity controls hydrated from mode_preferences.spell (V32-025 / RU-05)
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [preferUploadedAudio, setPreferUploadedAudio] = React.useState(true);
  const [speechRate, setSpeechRate] = React.useState<number>(
    () => spellPrefs?.speech_rate ?? 1.0,
  );
  const [speechLang, setSpeechLang] = React.useState<string>(() => {
    const prefLang = spellPrefs?.preferred_lang;
    // Default to text-aware auto-detection unless user explicitly selected a non-default language (RU-05)
    if (prefLang && prefLang !== "auto" && prefLang !== "vi-VN") {
      return prefLang;
    }
    return "auto";
  });
  const [selectedVoiceURI, setSelectedVoiceURI] = React.useState<string>(
    () => spellPrefs?.preferred_voice || "auto",
  );
  const [autoPlayAudio, setAutoPlayAudio] = React.useState<boolean>(
    () => spellPrefs?.auto_play_prompt ?? false,
  );
  const [repeatLoop, setRepeatLoop] = React.useState<boolean>(false);
  const [confidenceOverride, setConfidenceOverride] = React.useState<
    boolean | null
  >(null);
  const confidenceEnabled =
    confidenceOverride ?? Boolean(preferences.confidence_enabled);
  const setConfidenceEnabled = React.useCallback((next: boolean) => {
    setConfidenceOverride(next);
  }, []);

  // Spelling sensitivity (preserves Vietnamese diacritics by default; respects strict_diacritics pref)
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = React.useState(true);
  const [ignorePunctuation, setIgnorePunctuation] = React.useState(true);
  const [ignoreAccents, setIgnoreAccents] = React.useState<boolean>(
    () => spellPrefs?.strict_diacritics === false,
  );
  const showHintLetters = spellPrefs?.show_hint_letters !== false;

  // Audio / TTS state
  const ttsRef = React.useRef(getDefaultTtsController());
  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const [voices, setVoices] = React.useState<TtsVoiceInfo[]>([]);
  const [ttsState, setTtsState] = React.useState<TtsStateSnapshot>(() =>
    getDefaultTtsController().getState(),
  );
  const [audioPlaying, setAudioPlaying] = React.useState(false);

  // Active Spell session state
  const [rawQueueState, setQueueState] =
    React.useState<SpellQueueState | null>(null);
  const [typedInput, setTypedInput] = React.useState("");
  const [hintLevel, setHintLevel] = React.useState<SpellHintLevel>(0);
  const [selectedConfidence, setSelectedConfidence] =
    React.useState<ConfidenceLevel | null>(null);
  const [feedback, setFeedback] = React.useState<SpellGradeResult | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
  const [completedDurationSeconds, setCompletedDurationSeconds] = React.useState(1);

  // Checkpoint resume state
  const sessionKey = React.useMemo(
    () => makeCheckpointSessionKey("spell", setId, selectedChapter),
    [selectedChapter, setId],
  );
  const [pendingResume, setPendingResume] = React.useState<{
    checkpointId: string | null;
    source: "remote" | "local";
    currentIndex: number;
    totalItems: number;
    progressPercent: number;
    updatedAt: string | null;
    removedCount: number;
    restoredQueue: SpellQueueState;
  } | null>(null);

  const sessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef<number>(0);
  const initializedKeyRef = React.useRef<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Load TTS voices asynchronously + subscribe to state
  React.useEffect(() => {
    const controller = ttsRef.current;
    let active = true;
    const unsubState = controller.subscribeState((snap) => {
      if (active) setTtsState(snap);
    });
    const unsubVoices = controller.subscribeVoices((list) => {
      if (active) setVoices(list);
    });
    void controller.loadVoices(1500).then((list) => {
      if (active) setVoices(list);
    });

    return () => {
      active = false;
      unsubState();
      unsubVoices();
      controller.stop();
    };
  }, []);

  const stopAllAudio = React.useCallback(() => {
    ttsRef.current.stop();
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setAudioPlaying(false);
  }, []);

  // Build spellable target map
  const bundleQuestions = bundle?.questions;
  const spellTargets = React.useMemo(() => {
    const list = bundleQuestions ?? [];
    const filtered =
      selectedChapter === "all"
        ? list
        : list.filter((q) => (q.chapter?.trim() || "") === selectedChapter);
    return filtered
      .map((q) => ({ question: q, target: extractSpellTarget(q) }))
      .filter((entry) => entry.target.isSpellable);
  }, [bundleQuestions, selectedChapter]);

  const targetMap = React.useMemo(() => {
    const map = new Map<string, { question: Question; target: SpellTargetDescriptor }>();
    for (const entry of spellTargets) {
      map.set(entry.question.id, entry);
    }
    return map;
  }, [spellTargets]);

  // Initialize queue once per (setId, chapter) + check remote/local checkpoint (V32-015 / FUNC-17 / RU-06)
  React.useEffect(() => {
    if (!bundle) return;
    const initKey = `${setId}:${selectedChapter}:${spellTargets.length > 0 ? "ready" : "empty"}`;
    if (initializedKeyRef.current === initKey) return;
    initializedKeyRef.current = initKey;

    const freshIds = spellTargets.map((e) => e.question.id);
    setQueueState(createSpellQueueState(freshIds));
    setTypedInput("");
    setHintLevel(0);
    setSelectedConfidence(null);
    setFeedback(null);
    startedAtRef.current = Date.now();
    sessionIdRef.current = null;

    if (freshIds.length > 0) {
      void createStudySession({
        study_set_id: setId,
        mode: "spell",
        config: { chapter: selectedChapter },
        total_items: freshIds.length,
      })
        .then((s) => {
          sessionIdRef.current = s.id;
        })
        .catch(() => {});

      // Honor ?fresh=1 (FUNC-17)
      if (isFreshLaunch) {
        if (authenticatedUserId) {
          clearLocalCheckpoint(authenticatedUserId, sessionKey);
        }
        void deleteCheckpoint({ sessionKey }).catch(() => {});
        return;
      }

      // Inspect checkpoints keyed by authenticatedUserId (NEVER bundle.studySet.owner_id — FUNC-17!)
      const liveSet = new Set(freshIds);
      const localCp = authenticatedUserId
        ? loadLocalCheckpoint(authenticatedUserId, sessionKey)
        : null;
      void listCheckpoints({ studySetId: setId, mode: "spell", sessionKey })
        .then((remotes: LearningSessionCheckpoint[]) => {
          const remote = remotes[0] ?? null;
          const picked = pickNewestCheckpoint(remote, localCp);
          if (picked.source === "none" || picked.totalItems <= 0) {
            setPendingResume(null);
            return;
          }
          const savedState = picked.stateJson as {
            remainingIds?: string[];
            completedIds?: string[];
            missedIds?: string[];
            totalAttempts?: number;
          };
          const savedRemaining = Array.isArray(savedState.remainingIds)
            ? savedState.remainingIds
            : freshIds;
          const rec = reconcileCheckpointQuestions(
            savedRemaining,
            liveSet,
            0,
          );
          if (rec.validIds.length === 0 || picked.progressPercent >= 100) {
            setPendingResume(null);
            return;
          }
          const restored: SpellQueueState = {
            ...createSpellQueueState(rec.validIds),
            completedIds: (savedState.completedIds ?? []).filter((id) =>
              liveSet.has(id),
            ),
            missedIds: (savedState.missedIds ?? []).filter((id) =>
              liveSet.has(id),
            ),
            totalAttempts:
              typeof savedState.totalAttempts === "number"
                ? savedState.totalAttempts
                : (savedState.completedIds ?? []).length,
            totalItems: freshIds.length,
          };
          const metrics = computeSpellProgressMetrics(restored);
          setPendingResume({
            checkpointId: picked.checkpointId,
            source: picked.source,
            currentIndex: Math.max(picked.currentIndex, metrics.currentIndex),
            totalItems: freshIds.length,
            progressPercent: Math.max(
              picked.progressPercent,
              metrics.progressPercent,
            ),
            updatedAt: picked.updatedAt,
            removedCount: rec.removedIds.length,
            restoredQueue: restored,
          });
        })
        .catch(() => {});
    }
  }, [
    authenticatedUserId,
    bundle,
    isFreshLaunch,
    selectedChapter,
    sessionKey,
    setId,
    spellTargets,
  ]);

  // Progressive background streaming append (100% pure derived state — V32-015):
  // Appends Pages 2..N spellable items without resetting queue[0] or calling setState in useEffect.
  const queueState = React.useMemo(() => {
    if (!rawQueueState) return null;
    if (spellTargets.length === 0) return rawQueueState;
    const existingIds = new Set<string>([
      ...rawQueueState.queue.map((i) => i.questionId),
      ...rawQueueState.completedIds,
    ]);
    const addedItems = spellTargets
      .filter((e) => !existingIds.has(e.question.id))
      .map((e) => ({
        questionId: e.question.id,
        requiredCleanPasses: 1,
        cleanPasses: 0,
        missedCount: 0,
        usedReveal: false,
      }));
    if (addedItems.length === 0) return rawQueueState;
    return {
      ...rawQueueState,
      queue: [...rawQueueState.queue, ...addedItems],
      totalItems: rawQueueState.totalItems + addedItems.length,
      sessionCompleted: false,
    };
  }, [rawQueueState, spellTargets]);

  const currentQueueItem = queueState?.queue[0] ?? null;
  const currentEntry = currentQueueItem
    ? targetMap.get(currentQueueItem.questionId) ?? null
    : null;

  // Auto-detect TTS language from card text (English words -> en-US, Vietnamese -> vi-VN — V32-031 / RU-05!)
  const effectiveLang = React.useMemo(() => {
    if (speechLang !== "auto") return speechLang;
    const fallbackLang = locale === "vi" ? "vi-VN" : "en-US";
    return detectSpeechLanguage(
      currentEntry?.target.speakText ?? "",
      fallbackLang,
    );
  }, [currentEntry?.target.speakText, locale, speechLang]);

  const filteredVoices = React.useMemo(
    () =>
      speechLang === "auto"
        ? voices
        : filterVoicesByLanguage(voices, effectiveLang),
    [effectiveLang, speechLang, voices],
  );

  const activeVoiceInfo = React.useMemo(() => {
    if (selectedVoiceURI !== "auto") {
      return voices.find((v) => v.voiceURI === selectedVoiceURI) ?? null;
    }
    return selectBestVoice(voices, effectiveLang, true);
  }, [effectiveLang, selectedVoiceURI, voices]);

  const hasUploadedAudio = Boolean(
    currentEntry?.target.uploadedAudioUrl &&
      isSafeDisplayImageUrl(currentEntry.target.uploadedAudioUrl),
  );
  const usingUploadedAudio = hasUploadedAudio && preferUploadedAudio;

  // Play current prompt audio (uploaded takes precedence when enabled)
  const handlePlayPrompt = React.useCallback(
    (overrideRate?: number) => {
      if (!currentEntry) return;
      const rateToUse = overrideRate ?? speechRate;

      if (usingUploadedAudio && audioElRef.current) {
        ttsRef.current.stop();
        const el = audioElRef.current;
        el.playbackRate = rateToUse;
        el.loop = repeatLoop;
        el.currentTime = 0;
        void el
          .play()
          .then(() => setAudioPlaying(true))
          .catch(() => {
            toast.error(
              lText(
                locale,
                "Không thể phát tệp âm thanh. Hãy thử chuyển sang giọng đọc trình duyệt (TTS).",
                "Could not play uploaded audio. Try switching to browser TTS.",
              ),
            );
          });
        return;
      }

      if (audioElRef.current) {
        audioElRef.current.pause();
      }
      const res = ttsRef.current.speak({
        text: currentEntry.target.speakText,
        lang: effectiveLang,
        voiceURI: selectedVoiceURI === "auto" ? null : selectedVoiceURI,
        preferLocal: true,
        rate: rateToUse,
      });
      if (!res.ok && res.reason === "unsupported") {
        toast.error(
          lText(
            locale,
            "Trình duyệt này chưa hỗ trợ đọc văn bản (Web Speech API).",
            "This browser does not support Web Speech synthesis.",
          ),
        );
      }
    },
    [
      currentEntry,
      effectiveLang,
      locale,
      repeatLoop,
      selectedVoiceURI,
      speechRate,
      usingUploadedAudio,
    ],
  );

  // Stop stale speech on card transition + optional auto-play (NEVER gated by prefersReducedMotion — V32-025!)
  React.useEffect(() => {
    ttsRef.current.stop();
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    if (autoPlayAudio && currentEntry && !feedback) {
      const timer = window.setTimeout(() => {
        handlePlayPrompt();
      }, 150);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [autoPlayAudio, currentEntry, feedback, handlePlayPrompt]);

  const saveCheckpointSnapshot = React.useCallback(
    (nextQueue: SpellQueueState, keepalive: boolean = false) => {
      if (!bundle) return;

      if (nextQueue.sessionCompleted) {
        if (authenticatedUserId) {
          clearLocalCheckpoint(authenticatedUserId, sessionKey);
        }
        void deleteCheckpoint({ sessionKey }).catch(() => {});
        return;
      }

      const metrics = computeSpellProgressMetrics(nextQueue);
      const stateJson = {
        remainingIds: nextQueue.queue.map((i) => i.questionId),
        completedIds: nextQueue.completedIds,
        missedIds: nextQueue.missedIds,
        totalAttempts: nextQueue.totalAttempts,
      };
      if (authenticatedUserId) {
        saveLocalCheckpoint({
          version: 1,
          userId: authenticatedUserId,
          studySetId: setId,
          mode: "spell",
          sessionKey,
          currentIndex: metrics.currentIndex,
          totalItems: nextQueue.totalItems,
          progressPercent: metrics.progressPercent,
          stateJson,
          committedEventKeys: [],
          updatedAt: new Date().toISOString(),
        });
      }
      const remotePayload = {
        study_set_id: setId,
        mode: "spell" as const,
        session_key: sessionKey,
        state_json: stateJson,
        progress_percent: metrics.progressPercent,
        current_index: metrics.currentIndex,
        total_items: nextQueue.totalItems,
      };
      if (keepalive) {
        upsertCheckpointKeepalive(remotePayload);
      } else {
        void upsertCheckpoint(remotePayload).catch(() => {});
      }
    },
    [authenticatedUserId, bundle, sessionKey, setId],
  );

  // Flush Spell checkpoint on pagehide / visibilitychange so progress is never dropped (V32-027)
  const latestSpellQueueRef = React.useRef<SpellQueueState | null>(null);
  React.useEffect(() => {
    latestSpellQueueRef.current = queueState;
  }, [queueState]);

  React.useEffect(() => {
    const flushNow = () => {
      const q = latestSpellQueueRef.current;
      if (!q || q.sessionCompleted || q.totalAttempts === 0) return;
      saveCheckpointSnapshot(q, true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveCheckpointSnapshot]);

  const gradingOptions: SpellGradingOptions = React.useMemo(
    () => ({
      caseSensitive,
      ignoreWhitespace,
      ignorePunctuation,
      ignoreAccents,
    }),
    [caseSensitive, ignoreAccents, ignorePunctuation, ignoreWhitespace],
  );

  const currentHintOutput = React.useMemo(() => {
    if (!currentEntry) return null;
    return generateSpellHint(
      currentEntry.target.speakText,
      hintLevel,
      currentEntry.target.definitionClue,
    );
  }, [currentEntry, hintLevel]);

  const handleCheckSpelling = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!currentEntry || !queueState || feedback) return;
      if (!typedInput.trim() && hintLevel < 4) return;

      const result = gradeSpellingAnswer(
        typedInput,
        currentEntry.target.acceptedAnswers,
        gradingOptions,
      );
      const revealedAnswer = hintLevel === 4;
      const usedHint = hintLevel > 0;
      const effectiveCorrect = result.isCorrect && !revealedAnswer;

      setFeedback(result);
      playFeedbackSound(effectiveCorrect ? "correct" : "wrong");

      // Deterministic SM-2 + Confidence integration
      const prevProgress =
        bundle?.progressMap.get(currentEntry.question.id) ?? null;
      const sm2Outcome = applyConfidenceToSm2({
        previous: prevProgress ?? undefined,
        isCorrect: effectiveCorrect,
        confidence: confidenceEnabled ? selectedConfidence : null,
        usedHint,
      });

      updateLocalProgress({
        ...(prevProgress ?? {
          id: `local-${currentEntry.question.id}`,
          user_id: "",
          study_set_id: setId,
          question_id: currentEntry.question.id,
          updated_at: new Date().toISOString(),
        }),
        ...sm2Outcome.next,
        updated_at: new Date().toISOString(),
      });

      // Persist checkpoint immediately so counter & Resume never lose an answered item even before clicking Next (RU-06 / RU-18)
      const previewNextQueue = recordSpellQueueAttempt(queueState, {
        isCorrect: result.isCorrect,
        usedHint,
        revealedAnswer,
      });
      latestSpellQueueRef.current = previewNextQueue;
      saveCheckpointSnapshot(previewNextQueue);

      if (sessionIdRef.current) {
        void recordStudySessionAnswer(sessionIdRef.current, {
          question_id: currentEntry.question.id,
          typed_answer: typedInput.trim(),
          confidence: confidenceEnabled ? selectedConfidence : null,
          hint_used: usedHint,
          is_correct: effectiveCorrect,
          update_progress: true,
        }).catch(() => {});
      } else {
        void upsertQuestionProgress({
          study_set_id: setId,
          question_id: currentEntry.question.id,
          is_correct: effectiveCorrect,
          confidence: confidenceEnabled ? selectedConfidence : null,
          hint_used: usedHint,
          ...sm2Outcome.next,
        }).catch(() => {});
      }
    },
    [
      bundle?.progressMap,
      confidenceEnabled,
      currentEntry,
      feedback,
      gradingOptions,
      hintLevel,
      playFeedbackSound,
      queueState,
      saveCheckpointSnapshot,
      selectedConfidence,
      setId,
      typedInput,
      updateLocalProgress,
    ],
  );

  const handleAdvanceCard = React.useCallback(() => {
    if (!queueState || !feedback) return;
    stopAllAudio();
    const revealedAnswer = hintLevel === 4;
    const usedHint = hintLevel > 0;
    const nextQueue = recordSpellQueueAttempt(queueState, {
      isCorrect: feedback.isCorrect,
      usedHint,
      revealedAnswer,
    });
    setQueueState(nextQueue);
    setTypedInput("");
    setHintLevel(0);
    setSelectedConfidence(null);
    setFeedback(null);
    saveCheckpointSnapshot(nextQueue);

    if (nextQueue.sessionCompleted) {
      const dur = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      setCompletedDurationSeconds(dur);
      playFeedbackSound("complete");
      if (sessionIdRef.current) {
        void updateStudySession(sessionIdRef.current, {
          status: "completed",
          total_items: nextQueue.totalItems,
          completed_items: nextQueue.completedIds.length,
          correct_items: nextQueue.correctAttempts,
          duration_seconds: dur,
        })
          .then(() => {
            invalidateLearningCaches(queryClient, setId);
          })
          .catch(() => {});
      } else {
        invalidateLearningCaches(queryClient, setId);
      }
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [
    feedback,
    hintLevel,
    playFeedbackSound,
    queryClient,
    queueState,
    saveCheckpointSnapshot,
    setId,
    stopAllAudio,
  ]);

  const handleRestartFresh = React.useCallback(() => {
    stopAllAudio();
    const freshIds = spellTargets.map((e) => e.question.id);
    setQueueState(createSpellQueueState(freshIds));
    setTypedInput("");
    setHintLevel(0);
    setSelectedConfidence(null);
    setFeedback(null);
    setPendingResume(null);
    startedAtRef.current = Date.now();
    if (authenticatedUserId) {
      clearLocalCheckpoint(authenticatedUserId, sessionKey);
    }
    void deleteCheckpoint({ sessionKey }).catch(() => {});
  }, [authenticatedUserId, sessionKey, spellTargets, stopAllAudio]);

  if (isLoading) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        studySetId={setId}
        activeMode="spell"
        title={lText(locale, "Nghe & Gõ (Spell)", "Spell Mode")}
      >
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        studySetId={setId}
        activeMode="spell"
        title={lText(locale, "Nghe & Gõ (Spell)", "Spell Mode")}
      >
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  const chapters = Array.from(
    new Set(
      bundle.questions
        .map((q) => q.chapter?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  );

  if (spellTargets.length === 0) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        studySetId={setId}
        activeMode="spell"
        title={bundle.studySet.title}
        subtitle={lText(locale, "Nghe & Gõ (Spell)", "Spell Mode")}
      >
        <StudyEmptyState
          setId={setId}
          title={lText(
            locale,
            "Chưa có câu hỏi phù hợp chế độ Nghe & Gõ",
            "No Spell-Compatible Questions",
          )}
          description={lText(
            locale,
            "Chế độ Nghe & Gõ hỗ trợ thẻ ghi nhớ, câu trả lời ngắn, câu nghe hiểu hoặc câu trắc nghiệm văn bản ngắn.",
            "Spell Mode works with flashcards, short-answer, listening, or concise text questions.",
          )}
        />
      </FocusModeShell>
    );
  }

  const totalCount = queueState?.totalItems ?? spellTargets.length;
  const spellProgress = queueState
    ? computeSpellProgressMetrics(queueState)
    : { progressedCount: 0, currentIndex: 0, progressPercent: 0 };
  // Increment header progress immediately when feedback is confirmed (V32-041 RU-18!)
  const displayedProgressCount = Math.min(
    totalCount,
    spellProgress.progressedCount + (feedback ? 1 : 0),
  );

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      studySetId={setId}
      activeMode="spell"
      title={bundle.studySet.title}
      subtitle={lText(locale, "Nghe & Gõ (Spell)", "Spell — Listen & Type")}
      progressCurrent={displayedProgressCount}
      progressTotal={totalCount}
      headerRight={
        <div className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
              >
                <Settings2 className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {lText(locale, "Tùy chỉnh", "Options")}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">
                  {lText(locale, "Cài đặt chấm chính tả", "Spelling Sensitivity")}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-diacritics" className="cursor-pointer">
                    {lText(
                      locale,
                      "Bắt buộc đúng dấu tiếng Việt",
                      "Require Vietnamese diacritics",
                    )}
                  </Label>
                  <Switch
                    id="spell-diacritics"
                    checked={!ignoreAccents}
                    onCheckedChange={(v) => setIgnoreAccents(!v)}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-case" className="cursor-pointer">
                    {lText(locale, "Phân biệt chữ HOA / thường", "Case sensitive")}
                  </Label>
                  <Switch
                    id="spell-case"
                    checked={caseSensitive}
                    onCheckedChange={setCaseSensitive}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-punct" className="cursor-pointer">
                    {lText(locale, "Bỏ qua dấu câu", "Ignore punctuation")}
                  </Label>
                  <Switch
                    id="spell-punct"
                    checked={ignorePunctuation}
                    onCheckedChange={setIgnorePunctuation}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-ws" className="cursor-pointer">
                    {lText(locale, "Bỏ qua khoảng trắng thừa", "Ignore extra spaces")}
                  </Label>
                  <Switch
                    id="spell-ws"
                    checked={ignoreWhitespace}
                    onCheckedChange={setIgnoreWhitespace}
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold text-foreground">
                  {lText(locale, "Âm thanh & Trợ giúp", "Audio & Confidence")}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-upload-first" className="cursor-pointer">
                    {lText(
                      locale,
                      "Ưu tiên âm thanh đã tải lên",
                      "Prefer uploaded audio",
                    )}
                  </Label>
                  <Switch
                    id="spell-upload-first"
                    checked={preferUploadedAudio}
                    onCheckedChange={setPreferUploadedAudio}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-autoplay" className="cursor-pointer">
                    {lText(locale, "Tự động phát khi sang câu", "Auto-play next item")}
                  </Label>
                  <Switch
                    id="spell-autoplay"
                    checked={autoPlayAudio}
                    onCheckedChange={setAutoPlayAudio}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="spell-conf" className="cursor-pointer">
                    {lText(
                      locale,
                      "Hỏi mức độ tự tin trước khi kiểm tra",
                      "Ask confidence before checking",
                    )}
                  </Label>
                  <Switch
                    id="spell-conf"
                    checked={confidenceEnabled}
                    onCheckedChange={setConfidenceEnabled}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive"
                  onClick={() => setResetDialogOpen(true)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {lText(locale, "Đặt lại tiến độ học...", "Reset Learning Progress...")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Chapter filter when set has chapters */}
        {chapters.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select value={selectedChapter} onValueChange={setSelectedChapter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {lText(locale, "Tất cả chương", "All chapters")}
                </SelectItem>
                {chapters.map((ch) => (
                  <SelectItem key={ch} value={ch}>
                    {ch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {/* Resume Checkpoint Banner */}
        {!isFreshLaunch && pendingResume ? (
          <ResumeSessionBanner
            modeLabel={lText(locale, "Nghe & Gõ (Spell)", "Spell Mode")}
            currentIndex={pendingResume.currentIndex}
            totalItems={pendingResume.totalItems}
            progressPercent={pendingResume.progressPercent}
            updatedAt={pendingResume.updatedAt}
            source={pendingResume.source}
            removedQuestionsCount={pendingResume.removedCount}
            onContinue={() => {
              setQueueState(pendingResume.restoredQueue);
              setPendingResume(null);
            }}
            onRestart={handleRestartFresh}
            onDiscard={() => {
              setPendingResume(null);
              if (authenticatedUserId) {
                clearLocalCheckpoint(authenticatedUserId, sessionKey);
              }
              void deleteCheckpoint({ sessionKey }).catch(() => {});
            }}
          />
        ) : null}

        {/* Completed Screen */}
        {queueState?.sessionCompleted ? (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                <CheckCircle2 className="size-7" aria-hidden="true" />
              </div>
              <CardTitle className="text-2xl">
                {lText(locale, "Hoàn thành phiên Nghe & Gõ!", "Spell Session Complete!")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {lText(
                  locale,
                  `Bạn đã hoàn thành ${queueState.totalItems} mục trong ${formatDuration(completedDurationSeconds)}.`,
                  `Completed ${queueState.totalItems} items in ${formatDuration(completedDurationSeconds)}.`,
                )}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    {lText(locale, "Lượt gõ", "Attempts")}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {queueState.totalAttempts}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-success-subtle/60 p-3">
                  <p className="text-xs text-success-subtle-foreground">
                    {lText(locale, "Độc lập (không gợi ý)", "Independent")}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {queueState.cleanIndependentAttempts}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-destructive-subtle/60 p-3">
                  <p className="text-xs text-destructive-subtle-foreground">
                    {lText(locale, "Cần ôn lại", "Missed")}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {queueState.missedIds.length}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                <Button type="button" onClick={handleRestartFresh}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {lText(locale, "Luyện lại từ đầu", "Practice Again")}
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/sets/${setId}`}>
                    {lText(locale, "Về học phần", "Back to Study Set")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : currentEntry ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${currentEntry.question.id}-${queueState?.totalAttempts ?? 0}`}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.14 }}
            >
              <Card>
                <CardContent className="space-y-5 p-5 sm:p-6">
                  {/* Top metadata + Star */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        <Headphones className="size-3" aria-hidden="true" />
                        {usingUploadedAudio
                          ? lText(locale, "Âm thanh tải lên", "Uploaded Audio")
                          : lText(locale, "Giọng đọc trình duyệt (TTS)", "Browser TTS")}
                      </Badge>
                      {currentEntry.target.chapter ? (
                        <Badge variant="outline">
                          {currentEntry.target.chapter}
                        </Badge>
                      ) : null}
                      {currentQueueItem && currentQueueItem.missedCount > 0 ? (
                        <Badge variant="destructive" className="text-[11px]">
                          {lText(locale, "Ôn lại lỗi sai", "Retry Missed")}
                        </Badge>
                      ) : null}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={lText(locale, "Gắn sao câu này", "Toggle star")}
                      aria-pressed={bundle.starredIds.has(currentEntry.question.id)}
                      onClick={() => void toggleStar(currentEntry.question.id)}
                    >
                      <Star
                        className={cn(
                          "size-4",
                          bundle.starredIds.has(currentEntry.question.id)
                            ? "fill-warning text-warning"
                            : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </div>

                  {/* Audio Player & TTS Controls Panel */}
                  <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={() => handlePlayPrompt()}
                        className="min-h-11 gap-2"
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {lText(locale, "Nghe phát âm", "Play Audio")}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handlePlayPrompt(0.7)}
                        className="min-h-11"
                      >
                        <Volume2 className="size-4" aria-hidden="true" />
                        {lText(locale, "Nghe chậm (0.7×)", "Slow (0.7×)")}
                      </Button>

                      {ttsState.status === "speaking" || audioPlaying ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            if (usingUploadedAudio && audioElRef.current) {
                              audioElRef.current.pause();
                              setAudioPlaying(false);
                            } else {
                              ttsRef.current.pause();
                            }
                          }}
                          className="min-h-11"
                        >
                          <Pause className="size-4" aria-hidden="true" />
                          {lText(locale, "Tạm dừng", "Pause")}
                        </Button>
                      ) : ttsState.status === "paused" ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => ttsRef.current.resume()}
                          className="min-h-11"
                        >
                          <Play className="size-4" aria-hidden="true" />
                          {lText(locale, "Tiếp tục", "Resume")}
                        </Button>
                      ) : null}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={lText(locale, "Dừng phát", "Stop audio")}
                        onClick={stopAllAudio}
                      >
                        <Square className="size-4" aria-hidden="true" />
                      </Button>

                      <Button
                        type="button"
                        variant={repeatLoop ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={repeatLoop}
                        onClick={() => setRepeatLoop((v) => !v)}
                        className="min-h-10"
                      >
                        <Repeat className="size-4" aria-hidden="true" />
                        {lText(locale, "Lặp", "Repeat")}
                      </Button>
                    </div>

                    {/* Uploaded audio native controls (eager above-the-fold, preload="metadata") */}
                    {usingUploadedAudio && currentEntry.target.uploadedAudioUrl ? (
                      <audio
                        ref={audioElRef}
                        controls
                        preload="metadata"
                        src={currentEntry.target.uploadedAudioUrl}
                        onPlay={() => setAudioPlaying(true)}
                        onPause={() => setAudioPlaying(false)}
                        onEnded={() => setAudioPlaying(false)}
                        className="w-full"
                      />
                    ) : null}

                    {/* Speed, Language & Voice Picker with Honest Local vs Network Disclosure */}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label htmlFor="spell-speed" className="text-[11px] text-muted-foreground">
                          {lText(locale, "Tốc độ", "Speed")}
                        </Label>
                        <Select
                          value={String(speechRate)}
                          onValueChange={(v) => setSpeechRate(Number(v))}
                        >
                          <SelectTrigger id="spell-speed" className="h-9 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SPEED_OPTIONS.map((r) => (
                              <SelectItem key={r} value={String(r)}>
                                {r}×
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {!usingUploadedAudio ? (
                        <>
                          <div className="space-y-1">
                            <Label htmlFor="spell-lang" className="text-[11px] text-muted-foreground">
                              {lText(locale, "Ngôn ngữ đọc", "TTS Language")}
                            </Label>
                            <Select value={speechLang} onValueChange={setSpeechLang}>
                              <SelectTrigger id="spell-lang" className="h-9 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {LANG_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {lText(locale, opt.vi, opt.en)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="spell-voice" className="text-[11px] text-muted-foreground">
                              {lText(locale, "Giọng đọc", "Voice")}
                            </Label>
                            <Select
                              value={selectedVoiceURI}
                              onValueChange={setSelectedVoiceURI}
                            >
                              <SelectTrigger id="spell-voice" className="h-9 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  {lText(locale, "Tự chọn (ưu tiên nội bộ)", "Auto (prefer local)")}
                                </SelectItem>
                                {filteredVoices.map((v) => (
                                  <SelectItem key={v.voiceURI} value={v.voiceURI}>
                                    {v.name} ({v.privacyScope === "local" ? lText(locale, "Nội bộ", "Local") : lText(locale, "Mạng", "Network")})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : null}
                    </div>

                    {!usingUploadedAudio && activeVoiceInfo ? (
                      <p className="text-[11px] text-muted-foreground">
                        {activeVoiceInfo.privacyScope === "local"
                          ? lText(
                              locale,
                              `Giọng đọc hiện tại: ${activeVoiceInfo.name} · Chạy nội bộ trên thiết bị (hoạt động ngoại tuyến).`,
                              `Active voice: ${activeVoiceInfo.name} · On-device local voice (works offline).`,
                            )
                          : lText(
                              locale,
                              `Giọng đọc hiện tại: ${activeVoiceInfo.name} · Giọng đọc qua mạng của trình duyệt (cần Internet).`,
                              `Active voice: ${activeVoiceInfo.name} · Browser network speech service (requires Internet).`,
                            )}
                      </p>
                    ) : null}
                  </div>

                  {/* Prompt visual cues (images attached to the prompt) */}
                  {(() => {
                    const spellPromptImages = getQuestionPromptDisplayItems(
                      currentEntry.question,
                      lText(locale, "Hình ảnh minh họa", "Visual clue"),
                    );
                    if (spellPromptImages.length === 0) return null;
                    return (
                      <MediaGallery
                        items={spellPromptImages}
                        variant="compact"
                      />
                    );
                  })()}

                  {/* 5-Level Hint Ladder (NEVER leaks full spelling upfront!) */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        {lText(locale, "Gợi ý từng bước:", "Hint Ladder:")}
                      </span>
                      {(
                        [
                          { lvl: 1 as SpellHintLevel, vi: "Nghĩa", en: "Definition" },
                          ...(showHintLetters
                            ? [
                                {
                                  lvl: 2 as SpellHintLevel,
                                  vi: "Chữ cái đầu",
                                  en: "First Letter",
                                },
                                {
                                  lvl: 3 as SpellHintLevel,
                                  vi: "Độ dài từ",
                                  en: "Word Length",
                                },
                              ]
                            : []),
                          { lvl: 4 as SpellHintLevel, vi: "Hiện đáp án", en: "Reveal" },
                        ] as const
                      ).map((item) => (
                        <Button
                          key={item.lvl}
                          type="button"
                          size="sm"
                          variant={hintLevel === item.lvl ? "secondary" : "outline"}
                          disabled={Boolean(feedback)}
                          className="min-h-11 text-xs sm:min-h-8"
                          onClick={() => setHintLevel(item.lvl)}
                        >
                          {item.lvl === 4 ? (
                            <Eye className="size-3.5" aria-hidden="true" />
                          ) : (
                            <HelpCircle className="size-3.5" aria-hidden="true" />
                          )}
                          {lText(locale, item.vi, item.en)}
                        </Button>
                      ))}
                    </div>

                    {currentHintOutput && currentHintOutput.level > 0 ? (
                      <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">
                          {lText(
                            locale,
                            currentHintOutput.viLabel,
                            currentHintOutput.enLabel,
                          )}
                        </p>
                        <p className="mt-1 font-mono text-sm font-medium text-foreground">
                          {currentHintOutput.level === 3
                            ? lText(
                                locale,
                                `${currentHintOutput.wordCount} từ · ${currentHintOutput.charCount} ký tự`,
                                `${currentHintOutput.wordCount} word(s) · ${currentHintOutput.charCount} characters`,
                              )
                            : currentHintOutput.hintText ||
                              lText(
                                locale,
                                "Câu này chưa có mô tả/nghĩa đi kèm.",
                                "No definition clue attached to this item.",
                              )}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {/* Pre-Reveal Confidence Selector (optional) */}
                  <ConfidenceSelector
                    enabled={confidenceEnabled}
                    disabled={Boolean(feedback)}
                    value={selectedConfidence}
                    onChange={setSelectedConfidence}
                    keyboardMode="none"
                  />

                  {/* Typing Form (IME-safe Enter submit!) */}
                  <form onSubmit={handleCheckSpelling} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="spell-answer-input">
                        {lText(
                          locale,
                          "Gõ lại chính xác những gì bạn nghe được:",
                          "Type exactly what you hear:",
                        )}
                      </Label>
                      <Input
                        ref={inputRef}
                        id="spell-answer-input"
                        value={typedInput}
                        readOnly={Boolean(feedback)}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => {
                          if (!feedback) setTypedInput(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229
                          ) {
                            e.preventDefault();
                            if (feedback) {
                              handleAdvanceCard();
                            } else {
                              handleCheckSpelling();
                            }
                          }
                        }}
                        placeholder={lText(
                          locale,
                          "Nhập chính tả tại đây...",
                          "Type spelling here...",
                        )}
                        className="min-h-12 text-base"
                      />
                    </div>

                    {!feedback ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="submit"
                          disabled={!typedInput.trim() && hintLevel < 4}
                          className="min-h-11"
                        >
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          {lText(locale, "Kiểm tra chính tả", "Check Spelling")}
                        </Button>
                      </div>
                    ) : null}
                  </form>

                  {/* Character-Level Diff Feedback */}
                  {feedback ? (
                    <div
                      role="status"
                      className={cn(
                        "space-y-3 rounded-xl border p-4",
                        feedback.isCorrect && hintLevel < 4
                          ? "border-success/50 bg-success-subtle/60"
                          : "border-destructive/50 bg-destructive-subtle/50",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold">
                          {feedback.isCorrect && hintLevel < 4 ? (
                            <>
                              <CheckCircle2
                                className="size-5 text-success"
                                aria-hidden="true"
                              />
                              <span className="text-success-subtle-foreground">
                                {hintLevel > 0
                                  ? lText(
                                      locale,
                                      "Đúng (có dùng gợi ý)!",
                                      "Correct (with hint)!",
                                    )
                                  : lText(locale, "Chính xác hoàn toàn!", "Exact Match!")}
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle
                                className="size-5 text-destructive"
                                aria-hidden="true"
                              />
                              <span className="text-destructive-subtle-foreground">
                                {hintLevel === 4
                                  ? lText(
                                      locale,
                                      "Đã xem đáp án — câu này sẽ quay lại để bạn tự gõ lại",
                                      "Answer revealed — this item will return for independent recall",
                                    )
                                  : lText(
                                      locale,
                                      `Chưa chính xác (khớp ${feedback.similarityPercent}%)`,
                                      `Not quite (${feedback.similarityPercent}% match)`,
                                    )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Character diff visual display */}
                      {!feedback.isCorrect ? (
                        <div className="space-y-2 text-sm">
                          <div className="flex flex-wrap items-baseline gap-1 font-mono text-base">
                            {feedback.diff.map((seg, idx) => {
                              if (seg.kind === "equal") {
                                return (
                                  <span key={idx} className="text-foreground">
                                    {seg.actual}
                                  </span>
                                );
                              }
                              if (seg.kind === "delete") {
                                return (
                                  <span
                                    key={idx}
                                    className="rounded bg-success-subtle px-1 font-bold text-success-subtle-foreground underline"
                                    title={lText(locale, "Ký tự bị thiếu", "Missing characters")}
                                  >
                                    {seg.expected}
                                  </span>
                                );
                              }
                              if (seg.kind === "insert") {
                                return (
                                  <span
                                    key={idx}
                                    className="rounded bg-destructive-subtle px-1 text-destructive-subtle-foreground line-through"
                                    title={lText(locale, "Ký tự thừa", "Extra characters")}
                                  >
                                    {seg.actual}
                                  </span>
                                );
                              }
                              return (
                                <span
                                  key={idx}
                                  className="inline-flex items-baseline gap-0.5 rounded bg-warning-subtle px-1"
                                  title={lText(locale, "Ký tự sai", "Substituted characters")}
                                >
                                  <span className="text-destructive-subtle-foreground line-through">
                                    {seg.actual}
                                  </span>
                                  <span className="font-bold text-success-subtle-foreground">
                                    {seg.expected}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                          <p className="text-xs text-foreground">
                            <span className="font-semibold">
                              {lText(locale, "Đáp án chuẩn: ", "Correct spelling: ")}
                            </span>
                            {currentEntry.target.acceptedAnswers.join(" / ")}
                          </p>
                        </div>
                      ) : null}

                      {currentEntry.target.definitionClue ? (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-semibold">
                            {lText(locale, "Nghĩa / Câu hỏi: ", "Clue / Prompt: ")}
                          </span>
                          {currentEntry.target.definitionClue}
                        </p>
                      ) : null}

                      {(() => {
                        const spellExpImages = getQuestionExplanationDisplayItems(
                          currentEntry.question,
                          lText(locale, "Hình ảnh giải thích", "Explanation image"),
                        );
                        if (
                          !currentEntry.question.explanation &&
                          !currentEntry.question.explanation_rich &&
                          spellExpImages.length === 0
                        ) {
                          return null;
                        }
                        return (
                          <div className="space-y-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
                            {currentEntry.question.explanation ||
                            currentEntry.question.explanation_rich ? (
                              <div>
                                <span className="font-semibold text-foreground">
                                  {lText(locale, "Giải thích: ", "Explanation: ")}
                                </span>
                                <SafeRichText
                                  rich={currentEntry.question.explanation_rich}
                                  fallbackText={currentEntry.question.explanation}
                                  inline
                                />
                              </div>
                            ) : (
                              <span className="block font-semibold text-foreground">
                                {lText(locale, "Giải thích:", "Explanation:")}
                              </span>
                            )}
                            {spellExpImages.length > 0 ? (
                              <MediaGallery
                                items={spellExpImages}
                                variant="compact"
                              />
                            ) : null}
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <QuestionNotesAndReportBar
                          studySetId={setId}
                          questionId={currentEntry.question.id}
                          compact
                          canEdit={canEdit}
                          onEditQuestion={() =>
                            setEditingQuestionId(currentEntry.question.id)
                          }
                        />
                        <Button
                          type="button"
                          onClick={handleAdvanceCard}
                          className="min-h-10"
                        >
                          {lText(locale, "Câu tiếp theo", "Next Item")}
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        ) : null}
      </div>

      <ContextualQuestionEditorModal
        open={Boolean(editingQuestionId) && canEdit}
        onOpenChange={(open) => {
          if (!open) setEditingQuestionId(null);
        }}
        studySetId={setId}
        questionId={editingQuestionId}
        initialQuestion={
          editingQuestionId
            ? (bundle.questions.find((q) => q.id === editingQuestionId) ?? null)
            : null
        }
        chapters={chapters}
        onSaved={(saved) => updateLocalQuestion(saved)}
      />

      <ResetProgressDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        defaultScope="study_set"
        studySetId={setId}
        studySetTitle={bundle.studySet.title}
        subject={bundle.studySet.subject ?? undefined}
        chapters={chapters}
        mode="spell"
        userId={authenticatedUserId ?? ""}
        onResetComplete={() => {
          void refetch();
          handleRestartFresh();
        }}
      />
    </FocusModeShell>
  );
}
