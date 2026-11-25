"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Crosshair,
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
import type { OfflineQuestionRecord } from "@/lib/offline/types";
import type {
  ConfidenceLevel,
  NormalizedPoint,
  OrderingItem,
  StructuredAnswerResponse,
} from "@/types/v3";
import { cn } from "@/lib/utils";
import { useOptionalPwa } from "./PwaProvider";

export interface OfflineStudyRunnerProps {
  userId: string;
  setId: string;
  initialMode?: OfflineCapableMode;
  /** Optional starting question index restored from URL hash / sessionStorage on offline reload */
  initialQuestionIndex?: number;
  /** Callback invoked when active study mode or card index changes (persists across F5 reload) */
  onSessionStateChange?: (state: {
    setId: string;
    mode: OfflineCapableMode;
    questionIndex: number;
  }) => void;
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

/** Deterministic FNV-1a 32-bit hash for reproducible, non-leaking item ordering */
function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isImeSafeEnterKey(
  e: React.KeyboardEvent,
  lastCompositionEndMs: number,
): boolean {
  return (
    e.key === "Enter" &&
    !e.nativeEvent.isComposing &&
    e.keyCode !== 229 &&
    performance.now() - lastCompositionEndMs >= 50
  );
}

function buildInitialOrderingIds(
  questionId: string,
  items: readonly OrderingItem[],
): string[] {
  if (items.length <= 1) return items.map((i) => i.id);
  const correctOrder = [...items]
    .sort((a, b) => a.correct_position - b.correct_position)
    .map((i) => i.id);
  const shuffled = [...items]
    .sort((a, b) => {
      const ha = stableHash(`${questionId}:${a.id}`);
      const hb = stableHash(`${questionId}:${b.id}`);
      return ha !== hb ? ha - hb : a.id.localeCompare(b.id);
    })
    .map((i) => i.id);

  // Avoid accidentally starting in exact correct order when >=2 items exist
  const sameAsCorrect = shuffled.every((id, idx) => id === correctOrder[idx]);
  if (sameAsCorrect && shuffled.length >= 2) {
    return [...shuffled.slice(1), shuffled[0]!];
  }
  return shuffled;
}

interface MatchingRightChoice {
  right_id: string;
  right_text: string;
  right_image_url?: string | null;
}

function buildShuffledMatchingChoices(
  question: OfflineQuestionRecord,
): MatchingRightChoice[] {
  if (question.type_payload?.type !== "matching") return [];
  const allChoices: MatchingRightChoice[] = [
    ...question.type_payload.pairs.map((p) => ({
      right_id: p.right_id,
      right_text: p.right_text,
      right_image_url: p.right_image_url ?? null,
    })),
    ...(question.type_payload.distractors ?? []).map((d) => ({
      right_id: d.right_id,
      right_text: d.right_text,
      right_image_url: d.right_image_url ?? null,
    })),
  ];

  // Deduplicate by right_id while preserving deterministic shuffle
  const uniqueMap = new Map<string, MatchingRightChoice>();
  for (const c of allChoices) {
    if (!uniqueMap.has(c.right_id)) uniqueMap.set(c.right_id, c);
  }
  const unique = Array.from(uniqueMap.values());
  const originalIds = unique.map((c) => c.right_id);
  const sorted = [...unique].sort((a, b) => {
    const ha = stableHash(`${question.id}:match:${a.right_id}`);
    const hb = stableHash(`${question.id}:match:${b.right_id}`);
    return ha !== hb ? ha - hb : a.right_id.localeCompare(b.right_id);
  });

  if (
    sorted.length >= 2 &&
    sorted.every((item, idx) => item.right_id === originalIds[idx])
  ) {
    return [...sorted.slice(1), sorted[0]!];
  }
  return sorted;
}

function isMultiSelectQuestion(question: OfflineQuestionRecord): boolean {
  if (question.question_type === "multiple_choice") return true;
  const correctCount = (question.options ?? []).filter((o) => o.is_correct).length;
  if (correctCount > 1) return true;
  if (
    question.type_payload?.type === "image_choice" &&
    question.type_payload.selection_mode === "multiple"
  ) {
    return true;
  }
  if (
    (question.type_payload?.type === "reading_passage" ||
      question.type_payload?.type === "listening") &&
    question.type_payload.sub_answer_kind === "multiple_choice"
  ) {
    return true;
  }
  return false;
}

function formatExpectedAnswerSummary(
  question: OfflineQuestionRecord,
  vi: boolean,
): string {
  const payload = question.type_payload;
  if (payload?.type === "numerical") {
    return `${payload.correct_value}${payload.unit ? ` ${payload.unit}` : ""}`;
  }
  if (payload?.type === "fill_in_blank" && payload.blanks.length > 0) {
    return payload.blanks
      .map((b, idx) => `#${idx + 1}: ${b.accepted_answers[0] ?? ""}`)
      .join(" · ");
  }
  if (payload?.type === "ordering" && payload.items.length > 0) {
    return [...payload.items]
      .sort((a, b) => a.correct_position - b.correct_position)
      .map((item, idx) => `${idx + 1}. ${item.text}`)
      .join(" → ");
  }
  if (payload?.type === "matching" && payload.pairs.length > 0) {
    return payload.pairs
      .map((p) => `${p.left_text} → ${p.right_text}`)
      .join(" | ");
  }
  if (payload?.type === "image_hotspot" && payload.target_hotspots.length > 0) {
    return payload.target_hotspots.map((t) => t.label).join(", ");
  }
  if (question.back_text?.trim()) return question.back_text.trim();
  const correctOpts = (question.options ?? [])
    .filter((o) => o.is_correct)
    .map((o) => (o.content.trim() ? `${o.label}. ${o.content}` : o.label));
  if (correctOpts.length > 0) return correctOpts.join("; ");
  const accepted = (question.accepted_answers ?? [])
    .map((a) => a.answer_text.trim())
    .filter(Boolean);
  if (accepted.length > 0) return accepted.join(" / ");
  return vi ? "—" : "—";
}

function collectQuestionMediaUrls(question: OfflineQuestionRecord): string[] {
  const urls = new Set<string>();
  const add = (u: string | null | undefined) => {
    if (u && u.trim().length > 0) urls.add(u);
  };

  add(question.prompt_image_url);
  add(question.back_image_url);
  add(question.audio_url);

  for (const opt of question.options ?? []) {
    add(opt.image_url);
  }

  const payload = question.type_payload;
  if (payload) {
    if (payload.type === "listening") {
      add(payload.audio_url);
    } else if (payload.type === "image_hotspot") {
      add(payload.image_url);
    } else if (payload.type === "ordering") {
      for (const item of payload.items) {
        add(item.image_url);
      }
    } else if (payload.type === "matching") {
      for (const pair of payload.pairs) {
        add(pair.left_image_url);
        add(pair.right_image_url);
      }
      for (const dist of payload.distractors ?? []) {
        add(dist.right_image_url);
      }
    }
  }

  return Array.from(urls);
}

export function OfflineStudyRunner({
  userId,
  setId,
  initialMode = "flashcards",
  initialQuestionIndex,
  onSessionStateChange,
  onExit,
}: OfflineStudyRunnerProps) {
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const isOnline = pwa?.isOnline ?? false;

  const [bundle, setBundle] = React.useState<OfflineStudyBundle | null>(null);
  const [loadedBundleKey, setLoadedBundleKey] = React.useState<string | null>(
    null,
  );
  const expectedBundleKey = `${userId}:${setId}`;
  const loading = loadedBundleKey !== expectedBundleKey;
  const [mode, setMode] = React.useState<OfflineCapableMode>(initialMode);
  const [index, setIndex] = React.useState(
    typeof initialQuestionIndex === "number" && initialQuestionIndex > 0
      ? Math.floor(initialQuestionIndex)
      : 0,
  );
  const [flipped, setFlipped] = React.useState(false);
  const [selectedOptionIds, setSelectedOptionIds] = React.useState<string[]>([]);
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const [numericalUnit, setNumericalUnit] = React.useState("");
  const [blankAnswers, setBlankAnswers] = React.useState<Record<string, string>>(
    {},
  );
  const [orderedIdsByQuestionId, setOrderedIdsByQuestionId] = React.useState<
    Record<string, string[]>
  >({});
  const [matchingPairs, setMatchingPairs] = React.useState<Record<string, string>>(
    {},
  );
  const [hotspotClicks, setHotspotClicks] = React.useState<NormalizedPoint[]>([]);
  const [keyboardPinX, setKeyboardPinX] = React.useState(50);
  const [keyboardPinY, setKeyboardPinY] = React.useState(50);

  const [confidence, setConfidence] = React.useState<ConfidenceLevel | null>(null);
  const [feedback, setFeedback] = React.useState<{
    checked: boolean;
    isCorrect: boolean;
  }>({ checked: false, isCorrect: false });
  const [correctCount, setCorrectCount] = React.useState(0);
  const [restoredBanner, setRestoredBanner] = React.useState(false);

  // Resolved cached blob media map for active item + diagram
  const [mediaSrcMap, setMediaSrcMap] = React.useState<Record<string, string>>(
    {},
  );
  const [diagramImageSrc, setDiagramImageSrc] = React.useState<string | null>(null);
  const [spellAudio, setSpellAudio] =
    React.useState<OfflineSpellAudioResolution | null>(null);

  // Match board & multi-diagram state
  const [matchBoard, setMatchBoard] = React.useState<MatchBoardState | null>(null);
  const [selectedDiagramIndex, setSelectedDiagramIndex] = React.useState(0);
  const [diagramHotspotIndex, setDiagramHotspotIndex] = React.useState(0);
  const [diagramHitCount, setDiagramHitCount] = React.useState(0);
  const [diagramAttemptCount, setDiagramAttemptCount] = React.useState(0);
  const [diagramLastClick, setDiagramLastClick] =
    React.useState<NormalizedPoint | null>(null);
  const [diagramFeedback, setDiagramFeedback] = React.useState<string | null>(null);

  // Personal note drawer
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [noteText, setNoteText] = React.useState("");
  const [noteSavedNotice, setNoteSavedNotice] = React.useState(false);
  const [starredIds, setStarredIds] = React.useState<Set<string>>(new Set());

  // Refs & synchronous race guards (`FUNC-19`)
  const audioElRef = React.useRef<HTMLAudioElement | null>(null);
  const diagramImgRef = React.useRef<HTMLImageElement | null>(null);
  const hotspotImgRef = React.useRef<HTMLImageElement | null>(null);
  const lastCompositionEndRef = React.useRef<number>(0);
  const modeSwitchSeqRef = React.useRef<number>(0);
  const lastSubmittedKeyRef = React.useRef<string | null>(null);
  const lastAdvancedKeyRef = React.useRef<string | null>(null);
  const diagramSubmittingRef = React.useRef<boolean>(false);
  const onSessionStateChangeRef = React.useRef(onSessionStateChange);

  React.useEffect(() => {
    onSessionStateChangeRef.current = onSessionStateChange;
  }, [onSessionStateChange]);

  const handleCompositionEnd = React.useCallback(() => {
    lastCompositionEndRef.current = performance.now();
  }, []);

  const resetQuestionInputs = React.useCallback(() => {
    setFlipped(false);
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setNumericalUnit("");
    setBlankAnswers({});
    setOrderedIdsByQuestionId({});
    setMatchingPairs({});
    setHotspotClicks([]);
    setKeyboardPinX(50);
    setKeyboardPinY(50);
    setConfidence(null);
    setFeedback({ checked: false, isCorrect: false });
  }, []);

  React.useEffect(() => {
    let active = true;
    let loadedBundle: OfflineStudyBundle | null = null;
    modeSwitchSeqRef.current += 1;

    void (async () => {
      try {
        const nextBundle = await loadOfflineStudyBundle(userId, setId);
        if (!active) {
          nextBundle?.revokeAllMediaUrls();
          return;
        }
        loadedBundle = nextBundle;
        setBundle(nextBundle);
        setSelectedDiagramIndex(0);
        setDiagramHotspotIndex(0);
        setDiagramHitCount(0);
        setDiagramAttemptCount(0);
        setDiagramLastClick(null);
        setDiagramFeedback(null);
        resetQuestionInputs();

        if (nextBundle) {
          setStarredIds(
            new Set(
              nextBundle.questions
                .filter((q) => q.is_starred)
                .map((q) => q.id),
            ),
          );

          if (initialMode === "match") {
            setMatchBoard(
              createOfflineMatchSession(nextBundle.questions, { pairCount: 6 }),
            );
            setIndex(0);
            setCorrectCount(0);
            return;
          }

          const cp = await loadOfflineCheckpoint(
            userId,
            setId,
            initialMode,
            "offline",
          );
          if (!active) return;

          const hasExplicitIdx =
            typeof initialQuestionIndex === "number" &&
            Number.isFinite(initialQuestionIndex) &&
            initialQuestionIndex > 0 &&
            initialQuestionIndex < nextBundle.questions.length;

          if (hasExplicitIdx) {
            const safeIdx = Math.floor(initialQuestionIndex);
            setIndex(safeIdx);
            const savedCorrect = Number(cp?.state_json.correctCount ?? 0);
            setCorrectCount(Number.isFinite(savedCorrect) ? savedCorrect : 0);
            setRestoredBanner(true);
          } else if (
            cp &&
            cp.current_index > 0 &&
            cp.current_index < nextBundle.questions.length
          ) {
            setIndex(cp.current_index);
            const savedCorrect = Number(cp.state_json.correctCount ?? 0);
            setCorrectCount(Number.isFinite(savedCorrect) ? savedCorrect : 0);
            setRestoredBanner(true);
          } else {
            setIndex(0);
            setCorrectCount(0);
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
  }, [userId, setId, initialMode, initialQuestionIndex, resetQuestionInputs]);

  const currentQuestion = bundle?.questions[index] ?? null;
  const safeDiagramIdx =
    bundle && bundle.diagrams.length > 0
      ? Math.min(selectedDiagramIndex, bundle.diagrams.length - 1)
      : 0;
  const currentDiagram = bundle?.diagrams[safeDiagramIdx] ?? null;
  const totalQuestions = bundle?.questions.length ?? 0;

  const orderedItemIds = React.useMemo(() => {
    if (currentQuestion?.type_payload?.type !== "ordering") return [];
    const override = orderedIdsByQuestionId[currentQuestion.id];
    if (override && override.length === currentQuestion.type_payload.items.length) {
      return override;
    }
    return buildInitialOrderingIds(
      currentQuestion.id,
      currentQuestion.type_payload.items,
    );
  }, [currentQuestion, orderedIdsByQuestionId]);

  // Persist active set / mode / question index to parent (URL hash + sessionStorage for F5 reload)
  React.useEffect(() => {
    if (loading || !bundle) return;
    onSessionStateChangeRef.current?.({
      setId,
      mode,
      questionIndex: index,
    });
  }, [loading, bundle, setId, mode, index]);

  // Load media blob URLs & local note whenever active question / diagram / mode changes
  React.useEffect(() => {
    if (!bundle) return;
    let active = true;

    void (async () => {
      if (currentQuestion) {
        const urls = collectQuestionMediaUrls(currentQuestion);
        const resolvedEntries = await Promise.all(
          urls.map(async (url) => {
            const blobUrl = await bundle.resolveMediaUrl(url);
            return [url, blobUrl] as const;
          }),
        );
        if (!active) return;

        const nextMap: Record<string, string> = {};
        for (const [rawUrl, blobUrl] of resolvedEntries) {
          if (blobUrl) {
            nextMap[rawUrl] = blobUrl;
          }
        }
        setMediaSrcMap(nextMap);

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
      } else {
        setMediaSrcMap({});
      }

      if (mode === "diagram" && currentDiagram) {
        const dImg = await bundle.resolveMediaUrl(currentDiagram.base_image_url);
        if (active) setDiagramImageSrc(dImg);
      } else {
        setDiagramImageSrc(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [bundle, currentQuestion, currentDiagram, mode, userId]);

  const resolveRenderableMediaSrc = React.useCallback(
    (rawUrl: string | null | undefined): string | null => {
      if (!rawUrl) return null;
      if (mediaSrcMap[rawUrl]) return mediaSrcMap[rawUrl];
      return isOnline ? rawUrl : null;
    },
    [mediaSrcMap, isOnline],
  );

  const matchingRightChoices = React.useMemo(
    () => (currentQuestion ? buildShuffledMatchingChoices(currentQuestion) : []),
    [currentQuestion],
  );

  const activeReadingPassage = React.useMemo(() => {
    if (!currentQuestion || !bundle) return null;
    const payload = currentQuestion.type_payload;
    const passageId =
      currentQuestion.passage_id ??
      (payload?.type === "reading_passage" ? payload.passage_id : null);
    const linked = passageId
      ? bundle.passages.find((p) => p.id === passageId) ?? null
      : null;

    const title =
      (payload?.type === "reading_passage" ? payload.passage_title : null) ??
      linked?.title ??
      null;
    const text =
      (payload?.type === "reading_passage" ? payload.passage_text : null) ??
      linked?.content_text ??
      null;

    if (!title && !text) return null;
    return { title, text };
  }, [currentQuestion, bundle]);

  const switchMode = async (nextMode: OfflineCapableMode) => {
    const seq = ++modeSwitchSeqRef.current;
    lastSubmittedKeyRef.current = null;
    lastAdvancedKeyRef.current = null;
    setMode(nextMode);
    resetQuestionInputs();
    setDiagramFeedback(null);
    setDiagramLastClick(null);
    setRestoredBanner(false);

    if (nextMode === "match" && bundle) {
      setMatchBoard(createOfflineMatchSession(bundle.questions, { pairCount: 6 }));
      setIndex(0);
      setCorrectCount(0);
      return;
    }

    if (nextMode === "diagram") {
      setIndex(0);
      setCorrectCount(0);
      return;
    }

    const cp = await loadOfflineCheckpoint(userId, setId, nextMode, "offline");
    // Cancel stale async mode switches so an earlier slow IDB read never overwrites the latest tab
    if (seq !== modeSwitchSeqRef.current) return;

    if (
      cp &&
      bundle &&
      cp.current_index > 0 &&
      cp.current_index < bundle.questions.length
    ) {
      const savedCorrect = Number(cp.state_json.correctCount ?? 0);
      setIndex(cp.current_index);
      setCorrectCount(Number.isFinite(savedCorrect) ? savedCorrect : 0);
      setRestoredBanner(true);
    } else {
      setIndex(0);
      setCorrectCount(0);
    }
  };

  const advanceQuestion = async (wasCorrect: boolean) => {
    if (!bundle) return;
    const advanceKey = `${mode}:${index}`;
    if (lastAdvancedKeyRef.current === advanceKey) return;
    lastAdvancedKeyRef.current = advanceKey;
    lastSubmittedKeyRef.current = null;

    const nextCorrect = wasCorrect ? correctCount + 1 : correctCount;
    setCorrectCount(nextCorrect);

    const nextIdx = index + 1;
    resetQuestionInputs();

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
    if (!currentQuestion || !bundle) return;
    const submitKey = `flashcards:${index}:${currentQuestion.id}`;
    if (lastSubmittedKeyRef.current === submitKey) return;
    lastSubmittedKeyRef.current = submitKey;

    const isCorrect = rating !== "again";
    const nextCorrect = isCorrect ? correctCount + 1 : correctCount;
    setCorrectCount(nextCorrect);
    const nextIdx = index + 1;
    resetQuestionInputs();

    if (nextIdx < bundle.questions.length) {
      setIndex(nextIdx);
    } else {
      setIndex(bundle.questions.length);
    }

    await recordOfflineStudyAction(userId, {
      study_set_id: setId,
      question_id: currentQuestion.id,
      mode: "flashcards",
      is_correct: isCorrect,
      self_rating: rating,
      confidence,
    });

    if (nextIdx < bundle.questions.length) {
      await saveOfflineCheckpoint(userId, {
        study_set_id: setId,
        mode: "flashcards",
        session_key: "offline",
        current_index: nextIdx,
        total_items: bundle.questions.length,
        state_json: { correctCount: nextCorrect },
      });
    } else {
      await clearOfflineCheckpoint(userId, setId, "flashcards", "offline");
    }
    await pwa?.refreshOfflineState();
  };

  const handleCheckAnswer = async () => {
    if (!currentQuestion || feedback.checked) return;
    const submitKey = `${mode}:${index}:${currentQuestion.id}`;
    if (lastSubmittedKeyRef.current === submitKey) return;
    lastSubmittedKeyRef.current = submitKey;

    try {
      const payload = currentQuestion.type_payload;
      let structuredResponse: StructuredAnswerResponse;
      let typedAnswerPayload: string | null = typedAnswer || null;
      let selectedIdsPayload: string[] = [];

      if (mode === "write" || mode === "spell") {
        if (payload?.type === "numerical") {
          const userUnit = payload.unit_required
            ? numericalUnit.trim() || null
            : null;
          structuredResponse = {
            kind: "numerical",
            value: typedAnswer,
            unit: userUnit,
          };
          typedAnswerPayload = userUnit
            ? `${typedAnswer.trim()} ${userUnit}`.trim()
            : typedAnswer.trim() || null;
        } else if (payload?.type === "fill_in_blank" && payload.blanks.length > 0) {
          structuredResponse = {
            kind: "blanks",
            answers: { ...blankAnswers },
          };
          typedAnswerPayload = Object.values(blankAnswers).join(" | ") || null;
        } else {
          structuredResponse = {
            kind: "text",
            value: typedAnswer,
          };
        }
      } else if (payload?.type === "ordering" && payload.items.length > 0) {
        structuredResponse = {
          kind: "ordering",
          ordered_item_ids: [...orderedItemIds],
        };
        typedAnswerPayload = null;
      } else if (payload?.type === "matching" && payload.pairs.length > 0) {
        structuredResponse = {
          kind: "matching",
          pairs: { ...matchingPairs },
        };
        typedAnswerPayload = null;
      } else if (payload?.type === "fill_in_blank" && payload.blanks.length > 0) {
        structuredResponse = {
          kind: "blanks",
          answers: { ...blankAnswers },
        };
        typedAnswerPayload = Object.values(blankAnswers).join(" | ") || null;
      } else if (payload?.type === "numerical") {
        // Strictly respect `unit_required` — NEVER auto-inject the expected unit (`FUNC-19`)
        const userUnit = payload.unit_required
          ? numericalUnit.trim() || null
          : null;
        structuredResponse = {
          kind: "numerical",
          value: typedAnswer,
          unit: userUnit,
        };
        typedAnswerPayload = userUnit
          ? `${typedAnswer.trim()} ${userUnit}`.trim()
          : typedAnswer.trim() || null;
      } else if (payload?.type === "image_hotspot") {
        structuredResponse = {
          kind: "hotspot",
          clicks: [...hotspotClicks],
        };
        typedAnswerPayload = null;
      } else if (currentQuestion.options && currentQuestion.options.length > 0) {
        structuredResponse = {
          kind: "options",
          selected_option_ids: [...selectedOptionIds],
        };
        selectedIdsPayload = [...selectedOptionIds];
        typedAnswerPayload = null;
      } else {
        structuredResponse = {
          kind: "text",
          value: typedAnswer,
        };
      }

      const isCorrect = gradeOfflineAnswer(
        currentQuestion,
        structuredResponse,
      ).isCorrect;

      setFeedback({ checked: true, isCorrect });

      await recordOfflineStudyAction(userId, {
        study_set_id: setId,
        question_id: currentQuestion.id,
        mode,
        is_correct: isCorrect,
        selected_option_ids: selectedIdsPayload,
        typed_answer: typedAnswerPayload,
        structured_response: structuredResponse,
        confidence,
      });
      await pwa?.refreshOfflineState();
    } catch {
      lastSubmittedKeyRef.current = null;
    }
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

  const recordDiagramHotspotOutcome = async (
    targetId: string,
    targetLabel: string,
    hit: boolean,
    clickedPoint: NormalizedPoint | null,
  ) => {
    if (!currentDiagram || !bundle || diagramSubmittingRef.current) return;
    diagramSubmittingRef.current = true;
    try {
      const totalHotspots = currentDiagram.hotspots?.length ?? 0;
      const nextHits = hit ? diagramHitCount + 1 : diagramHitCount;
      const nextAttempts = diagramAttemptCount + 1;
      const nextIdx =
        hit && totalHotspots > 0
          ? (diagramHotspotIndex + 1) % totalHotspots
          : diagramHotspotIndex;

      setDiagramHitCount(nextHits);
      setDiagramAttemptCount(nextAttempts);
      if (hit && totalHotspots > 0) {
        setDiagramHotspotIndex(nextIdx);
      }

      // Persist valid offline checkpoint event (syncs cleanly via `checkpoint_upsert`)
      await saveOfflineCheckpoint(userId, {
        study_set_id: setId,
        mode: "diagram",
        session_key: `offline:${currentDiagram.id}`,
        current_index: Math.min(nextHits, totalHotspots),
        total_items: totalHotspots,
        state_json: {
          diagramId: currentDiagram.id,
          diagramIndex: safeDiagramIdx,
          hotspotIndex: nextIdx,
          hits: nextHits,
          attempts: nextAttempts,
          lastHotspotId: targetId,
          lastHotspotLabel: targetLabel,
          lastHit: hit,
        },
      });

      // If a study question links directly to this diagram, record its answer action too
      const linkedHotspotQuestion = bundle.questions.find(
        (q) =>
          q.type_payload?.type === "image_hotspot" &&
          q.type_payload.diagram_id === currentDiagram.id,
      );
      if (linkedHotspotQuestion) {
        await recordOfflineStudyAction(userId, {
          study_set_id: setId,
          question_id: linkedHotspotQuestion.id,
          mode: "diagram",
          is_correct: hit,
          structured_response: clickedPoint
            ? {
                kind: "hotspot",
                clicks: [clickedPoint],
                selected_hotspot_ids: [targetId],
              }
            : {
                kind: "hotspot",
                clicks: [],
                selected_hotspot_ids: [targetId],
              },
          confidence,
        });
      }

      await pwa?.refreshOfflineState();
    } finally {
      diagramSubmittingRef.current = false;
    }
  };

  const handleDiagramImageClick = async (
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    if (!currentDiagram || !currentDiagram.hotspots?.length) return;
    const target = currentDiagram.hotspots[diagramHotspotIndex];
    if (!target) return;

    // Normalize coordinates strictly against the rendered <img> bounding rect (`FUNC-19`)
    const imgEl = diagramImgRef.current ?? event.currentTarget;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const point: NormalizedPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
    setDiagramLastClick(point);

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

    await recordDiagramHotspotOutcome(target.id, target.label, hit, point);
  };

  const handleHotspotQuestionImageClick = (
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    if (feedback.checked || currentQuestion?.type_payload?.type !== "image_hotspot") {
      return;
    }
    const imgEl = hotspotImgRef.current ?? event.currentTarget;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const point: NormalizedPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };

    const payload = currentQuestion.type_payload;
    const allowMultiple =
      Boolean(payload.require_all_targets) || payload.target_hotspots.length > 1;
    const maxPins = Math.max(1, payload.target_hotspots.length);

    setHotspotClicks((prev) => {
      if (!allowMultiple) return [point];
      if (prev.length >= maxPins) {
        return [...prev.slice(1), point];
      }
      return [...prev, point];
    });
  };

  const moveOrderingItem = (fromIndex: number, direction: -1 | 1) => {
    if (feedback.checked || !currentQuestion) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= orderedItemIds.length) return;
    const copy = [...orderedItemIds];
    const temp = copy[fromIndex]!;
    copy[fromIndex] = copy[toIndex]!;
    copy[toIndex] = temp;
    setOrderedIdsByQuestionId((prev) => ({
      ...prev,
      [currentQuestion.id]: copy,
    }));
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

  const promptImageSrc = resolveRenderableMediaSrc(
    currentQuestion?.prompt_image_url,
  );
  const backImageSrc = resolveRenderableMediaSrc(currentQuestion?.back_image_url);
  const questionAudioRawUrl =
    currentQuestion?.audio_url ??
    (currentQuestion?.type_payload?.type === "listening"
      ? currentQuestion.type_payload.audio_url
      : null);
  const questionAudioSrc = resolveRenderableMediaSrc(questionAudioRawUrl);
  const currentPayload = currentQuestion?.type_payload ?? null;
  const isChoiceMulti = currentQuestion
    ? isMultiSelectQuestion(currentQuestion)
    : false;

  const isStructuredOrdering =
    mode !== "flashcards" &&
    mode !== "write" &&
    mode !== "spell" &&
    currentPayload?.type === "ordering" &&
    currentPayload.items.length > 0;
  const isStructuredMatching =
    mode !== "flashcards" &&
    mode !== "write" &&
    mode !== "spell" &&
    currentPayload?.type === "matching" &&
    currentPayload.pairs.length > 0;
  const isStructuredBlanks =
    mode !== "flashcards" &&
    currentPayload?.type === "fill_in_blank" &&
    currentPayload.blanks.length > 0;
  const isStructuredNumerical =
    mode !== "flashcards" && currentPayload?.type === "numerical";
  const isStructuredHotspot =
    mode !== "flashcards" &&
    mode !== "write" &&
    mode !== "spell" &&
    currentPayload?.type === "image_hotspot";
  const isPlainTextInput =
    mode === "write" ||
    mode === "spell" ||
    (!isStructuredOrdering &&
      !isStructuredMatching &&
      !isStructuredBlanks &&
      !isStructuredNumerical &&
      !isStructuredHotspot &&
      (!currentQuestion?.options || currentQuestion.options.length === 0));

  const canCheckMatching =
    currentPayload?.type === "matching"
      ? currentPayload.pairs.every((p) => Boolean(matchingPairs[p.id]))
      : false;
  const canCheckBlanks =
    currentPayload?.type === "fill_in_blank"
      ? currentPayload.blanks.some(
          (b) => (blankAnswers[b.blank_id] ?? "").trim().length > 0,
        )
      : false;
  const canCheckNumerical = typedAnswer.trim().length > 0;
  const canCheckHotspot = hotspotClicks.length > 0;

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
      <div
        className="flex flex-wrap gap-1.5"
        role="tablist"
        aria-label={vi ? "Chế độ học ngoại tuyến" : "Offline study modes"}
      >
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
              lastSubmittedKeyRef.current = null;
              lastAdvancedKeyRef.current = null;
              resetQuestionInputs();
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
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{currentDiagram.title}</CardTitle>
              <span className="text-muted-foreground text-xs tabular-nums">
                {vi
                  ? `Đúng: ${diagramHitCount} / ${diagramAttemptCount} lượt`
                  : `Hits: ${diagramHitCount} / ${diagramAttemptCount}`}
              </span>
            </div>

            {/* Multi-diagram selector (`FUNC-19`) */}
            {bundle.diagrams.length > 1 && (
              <div
                className="flex flex-wrap gap-1.5"
                role="tablist"
                aria-label={vi ? "Chọn sơ đồ" : "Select diagram"}
                data-testid="offline-diagram-switcher"
              >
                {bundle.diagrams.map((diag, dIdx) => (
                  <Button
                    key={diag.id}
                    size="sm"
                    variant={dIdx === safeDiagramIdx ? "default" : "outline"}
                    role="tab"
                    aria-selected={dIdx === safeDiagramIdx}
                    onClick={() => {
                      setSelectedDiagramIndex(dIdx);
                      setDiagramHotspotIndex(0);
                      setDiagramHitCount(0);
                      setDiagramAttemptCount(0);
                      setDiagramLastClick(null);
                      setDiagramFeedback(null);
                    }}
                  >
                    {dIdx + 1}. {diag.title}
                  </Button>
                ))}
              </div>
            )}
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
              <div className="flex justify-center">
                {/* Tight `inline-block relative` wrapper so coordinates & pins align strictly with `<img>` */}
                <div className="border-border relative inline-block max-w-full overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={diagramImgRef}
                    src={diagramImageSrc}
                    alt={currentDiagram.title}
                    onClick={(e) => void handleDiagramImageClick(e)}
                    className="block max-h-[65vh] w-auto max-w-full cursor-crosshair select-none"
                    data-testid="offline-diagram-image"
                  />
                  {diagramLastClick && (
                    <span
                      aria-hidden="true"
                      className="border-background bg-primary pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-xs"
                      style={{
                        left: `${diagramLastClick.x * 100}%`,
                        top: `${diagramLastClick.y * 100}%`,
                      }}
                    />
                  )}
                </div>
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
                    if (!target) return;
                    const isHit = target.id === hs.id;
                    setDiagramFeedback(
                      isHit
                        ? vi
                          ? `Chính xác: ${hs.label}`
                          : `Correct: ${hs.label}`
                        : vi
                          ? `Vị trí đó là "${hs.label}".`
                          : `That point is "${hs.label}".`,
                    );
                    void recordDiagramHotspotOutcome(target.id, target.label, isHit, null);
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
                lastSubmittedKeyRef.current = null;
                lastAdvancedKeyRef.current = null;
                resetQuestionInputs();
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
            {/* Reading Passage Card (when present) */}
            {activeReadingPassage && (
              <div
                data-testid="offline-reading-passage"
                className="bg-secondary/50 border-border max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-3.5 text-sm"
              >
                {activeReadingPassage.title && (
                  <p className="font-semibold">{activeReadingPassage.title}</p>
                )}
                {activeReadingPassage.text && (
                  <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {activeReadingPassage.text}
                  </p>
                )}
              </div>
            )}

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
                      preload="metadata"
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

            {/* Listening / Question Audio Control (non-spell modes) */}
            {mode !== "spell" && questionAudioRawUrl && (
              <div
                data-testid="offline-listening-audio"
                className="bg-secondary/50 border-border space-y-2 rounded-lg border p-3 text-xs sm:text-sm"
              >
                {questionAudioSrc ? (
                  <audio
                    src={questionAudioSrc}
                    controls
                    preload="metadata"
                    className="h-9 w-full max-w-md"
                  />
                ) : (
                  <p className="text-muted-foreground">
                    {vi
                      ? "Tệp âm thanh chưa được lưu trong bộ nhớ ngoại tuyến."
                      : "Audio file is not cached offline."}
                  </p>
                )}
                {feedback.checked &&
                  currentPayload?.type === "listening" &&
                  currentPayload.transcript && (
                    <p className="text-muted-foreground border-border border-t pt-2 text-xs whitespace-pre-wrap">
                      {currentPayload.transcript}
                    </p>
                  )}
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
                      {formatExpectedAnswerSummary(currentQuestion, vi)}
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
            ) : isStructuredNumerical && currentPayload?.type === "numerical" ? (
              /* Numerical Question (strictly honoring `unit_required`) */
              <div className="space-y-3" data-testid="offline-numerical-input">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    inputMode="decimal"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={(e) => {
                      if (isImeSafeEnterKey(e, lastCompositionEndRef.current)) {
                        e.preventDefault();
                        if (!feedback.checked && canCheckNumerical) {
                          void handleCheckAnswer();
                        } else if (feedback.checked) {
                          void advanceQuestion(feedback.isCorrect);
                        }
                      }
                    }}
                    disabled={feedback.checked}
                    placeholder={vi ? "Nhập giá trị số..." : "Enter numeric value..."}
                    className="min-w-40 flex-1"
                    aria-label={vi ? "Giá trị số" : "Numeric value"}
                  />

                  {currentPayload.unit_required && currentPayload.unit ? (
                    <Input
                      value={numericalUnit}
                      onChange={(e) => setNumericalUnit(e.target.value)}
                      disabled={feedback.checked}
                      placeholder={vi ? "Nhập đơn vị..." : "Enter unit..."}
                      className="w-36"
                      aria-label={vi ? "Đơn vị bắt buộc" : "Required unit"}
                      data-testid="offline-numerical-unit-input"
                    />
                  ) : currentPayload.unit ? (
                    <Badge variant="outline" className="px-3 py-2 text-xs">
                      {currentPayload.unit}
                    </Badge>
                  ) : null}
                </div>

                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={!canCheckNumerical}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
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
                            ? `Đáp án đúng: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Correct answer: ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
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
            ) : isStructuredBlanks && currentPayload?.type === "fill_in_blank" ? (
              /* Fill-in-the-blank multi-blank offline */
              <div className="space-y-3" data-testid="offline-fill-in-blank">
                {currentPayload.template_text && (
                  <p className="bg-secondary/50 border-border rounded-lg border p-3 text-sm whitespace-pre-wrap">
                    {currentPayload.template_text}
                  </p>
                )}
                <div className="space-y-2">
                  {currentPayload.blanks.map((blank, bIdx) => (
                    <div key={blank.blank_id} className="space-y-1">
                      <label
                        htmlFor={`offline-blank-${currentQuestion.id}-${bIdx}`}
                        className="text-muted-foreground text-xs font-medium"
                      >
                        {vi ? `Chỗ trống #${bIdx + 1}` : `Blank #${bIdx + 1}`}
                        {blank.hint ? ` (${blank.hint})` : ""}
                      </label>
                      <Input
                        id={`offline-blank-${currentQuestion.id}-${bIdx}`}
                        value={blankAnswers[blank.blank_id] ?? ""}
                        onChange={(e) =>
                          setBlankAnswers((prev) => ({
                            ...prev,
                            [blank.blank_id]: e.target.value,
                          }))
                        }
                        onCompositionEnd={handleCompositionEnd}
                        onKeyDown={(e) => {
                          if (isImeSafeEnterKey(e, lastCompositionEndRef.current)) {
                            e.preventDefault();
                            if (!feedback.checked && canCheckBlanks) {
                              void handleCheckAnswer();
                            } else if (feedback.checked) {
                              void advanceQuestion(feedback.isCorrect);
                            }
                          }
                        }}
                        disabled={feedback.checked}
                        placeholder={
                          vi ? "Nhập nội dung chỗ trống..." : "Fill in blank..."
                        }
                      />
                    </div>
                  ))}
                </div>
                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={!canCheckBlanks}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
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
                            ? `Đáp án đúng: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Correct answer: ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next question"}
                    </Button>
                  </div>
                )}
              </div>
            ) : isStructuredOrdering && currentPayload?.type === "ordering" ? (
              /* Ordering question offline */
              <div className="space-y-3" data-testid="offline-ordering">
                <p className="text-muted-foreground text-xs">
                  {vi
                    ? "Dùng nút lên/xuống để sắp xếp đúng thứ tự, sau đó nhấn Kiểm tra đáp án."
                    : "Use the up/down buttons to arrange items in the correct order, then check your answer."}
                </p>
                <ol className="space-y-2">
                  {orderedItemIds.map((itemId, posIdx) => {
                    const item = currentPayload.items.find((i) => i.id === itemId);
                    if (!item) return null;
                    const itemImgSrc = resolveRenderableMediaSrc(item.image_url);
                    return (
                      <li
                        key={item.id}
                        className="border-border bg-card flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="text-muted-foreground w-5 shrink-0 font-semibold tabular-nums">
                            {posIdx + 1}.
                          </span>
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {item.text && <span>{item.text}</span>}
                            {itemImgSrc && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={itemImgSrc}
                                alt={item.text || `#${posIdx + 1}`}
                                className="border-border max-h-28 rounded border object-contain"
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                            disabled={feedback.checked || posIdx === 0}
                            onClick={() => moveOrderingItem(posIdx, -1)}
                            aria-label={vi ? "Di chuyển lên" : "Move up"}
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="outline"
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                            disabled={
                              feedback.checked ||
                              posIdx === orderedItemIds.length - 1
                            }
                            onClick={() => moveOrderingItem(posIdx, 1)}
                            aria-label={vi ? "Di chuyển xuống" : "Move down"}
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={orderedItemIds.length === 0}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
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
                            ? "Thứ tự chính xác!"
                            : "Correct order!"
                          : vi
                            ? `Thứ tự đúng: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Correct order: ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next question"}
                    </Button>
                  </div>
                )}
              </div>
            ) : isStructuredMatching && currentPayload?.type === "matching" ? (
              /* Matching question offline (right choices deterministically shuffled) */
              <div className="space-y-3" data-testid="offline-matching">
                <div className="space-y-2.5">
                  {currentPayload.pairs.map((pair, pIdx) => {
                    const leftImgSrc = resolveRenderableMediaSrc(
                      pair.left_image_url,
                    );
                    const selectId = `offline-match-${currentQuestion.id}-${pair.id}`;
                    return (
                      <div
                        key={pair.id}
                        className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <label
                          htmlFor={selectId}
                          className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium"
                        >
                          <span className="text-muted-foreground tabular-nums">
                            {pIdx + 1}.
                          </span>
                          <span className="min-w-0 flex-1">
                            {pair.left_text}
                          </span>
                          {leftImgSrc && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={leftImgSrc}
                              alt={pair.left_text}
                              className="border-border max-h-16 rounded border object-contain"
                            />
                          )}
                        </label>
                        <select
                          id={selectId}
                          disabled={feedback.checked}
                          value={matchingPairs[pair.id] ?? ""}
                          onChange={(e) =>
                            setMatchingPairs((prev) => ({
                              ...prev,
                              [pair.id]: e.target.value,
                            }))
                          }
                          className="border-input bg-background text-foreground focus-visible:ring-ring min-h-11 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 sm:min-h-9 sm:w-64"
                        >
                          <option value="">
                            {vi ? "-- Chọn ghép đôi --" : "-- Select match --"}
                          </option>
                          {matchingRightChoices.map((choice) => (
                            <option key={choice.right_id} value={choice.right_id}>
                              {choice.right_text}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={!canCheckMatching}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
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
                            ? "Ghép đúng tất cả các cặp!"
                            : "All pairs matched correctly!"
                          : vi
                            ? `Đáp án đúng: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Correct matches: ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next question"}
                    </Button>
                  </div>
                )}
              </div>
            ) : isStructuredHotspot && currentPayload?.type === "image_hotspot" ? (
              /* Image Hotspot question offline */
              <div className="space-y-3" data-testid="offline-image-hotspot">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {currentPayload.require_all_targets &&
                    currentPayload.target_hotspots.length > 1
                      ? vi
                        ? `Chạm vào ảnh để đặt ${currentPayload.target_hotspots.length} điểm mục tiêu (${hotspotClicks.length}/${currentPayload.target_hotspots.length}).`
                        : `Tap the image to place ${currentPayload.target_hotspots.length} target pins (${hotspotClicks.length}/${currentPayload.target_hotspots.length}).`
                      : vi
                        ? "Chạm trực tiếp vào vị trí đúng trên hình ảnh."
                        : "Tap directly on the target region of the image."}
                  </span>
                  {hotspotClicks.length > 0 && !feedback.checked && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setHotspotClicks([])}
                    >
                      {vi ? "Xóa điểm chọn" : "Clear pins"}
                    </Button>
                  )}
                </div>

                {resolveRenderableMediaSrc(currentPayload.image_url) ? (
                  <div className="flex justify-center">
                    <div className="border-border relative inline-block max-w-full overflow-hidden rounded-lg border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={hotspotImgRef}
                        src={resolveRenderableMediaSrc(currentPayload.image_url)!}
                        alt={
                          currentQuestion.prompt ||
                          (vi ? "Hình ảnh câu hỏi chọn điểm" : "Hotspot question image")
                        }
                        onClick={handleHotspotQuestionImageClick}
                        className="block max-h-[60vh] w-auto max-w-full cursor-crosshair select-none"
                        data-testid="offline-hotspot-question-image"
                      />
                      {hotspotClicks.map((pt, pinIdx) => (
                        <span
                          key={`${pt.x}-${pt.y}-${pinIdx}`}
                          aria-hidden="true"
                          className="border-background bg-primary text-primary-foreground pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[10px] font-bold shadow-xs"
                          style={{
                            left: `${pt.x * 100}%`,
                            top: `${pt.y * 100}%`,
                          }}
                        >
                          {pinIdx + 1}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {vi
                      ? "Hình ảnh câu hỏi chưa được tải vào bộ nhớ ngoại tuyến."
                      : "Hotspot image is not cached offline."}
                  </p>
                )}

                {/* Accessible keyboard pin placement without leaking answers */}
                {!feedback.checked && (
                  <div className="bg-secondary/40 border-border flex flex-wrap items-end gap-2 rounded-lg border p-2.5 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">X (%)</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={keyboardPinX}
                        onChange={(e) =>
                          setKeyboardPinX(
                            Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                          )
                        }
                        className="h-9 w-20"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Y (%)</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={keyboardPinY}
                        onChange={(e) =>
                          setKeyboardPinY(
                            Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                          )
                        }
                        className="h-9 w-20"
                      />
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const pt = { x: keyboardPinX / 100, y: keyboardPinY / 100 };
                        const allowMulti =
                          Boolean(currentPayload.require_all_targets) ||
                          currentPayload.target_hotspots.length > 1;
                        const maxPins = Math.max(
                          1,
                          currentPayload.target_hotspots.length,
                        );
                        setHotspotClicks((prev) =>
                          !allowMulti
                            ? [pt]
                            : prev.length >= maxPins
                              ? [...prev.slice(1), pt]
                              : [...prev, pt],
                        );
                      }}
                    >
                      <Crosshair className="size-3.5" aria-hidden="true" />
                      {vi ? "Đặt ghim bằng bàn phím" : "Place keyboard pin"}
                    </Button>
                  </div>
                )}

                {!feedback.checked ? (
                  <Button
                    onClick={() => void handleCheckAnswer()}
                    disabled={!canCheckHotspot}
                  >
                    {vi ? "Kiểm tra đáp án" : "Check answer"}
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
                            ? "Chọn vị trí chính xác!"
                            : "Target hotspot hit!"
                          : vi
                            ? `Vị trí cần tìm: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Target region(s): ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next question"}
                    </Button>
                  </div>
                )}
              </div>
            ) : isPlainTextInput ? (
              <div className="space-y-3">
                <Input
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(e) => {
                    if (isImeSafeEnterKey(e, lastCompositionEndRef.current)) {
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
                            ? `Đáp án đúng: ${formatExpectedAnswerSummary(currentQuestion, vi)}`
                            : `Correct answer: ${formatExpectedAnswerSummary(currentQuestion, vi)}`}
                      </span>
                    </div>
                    <Button onClick={() => void advanceQuestion(feedback.isCorrect)}>
                      {vi ? "Câu tiếp theo" : "Next item"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              /* Single / Multiple Choice & Image Choice offline */
              <div className="space-y-3">
                {isChoiceMulti && (
                  <p className="text-muted-foreground text-xs font-medium">
                    {vi
                      ? "Chọn tất cả các đáp án đúng:"
                      : "Select all correct answers:"}
                  </p>
                )}
                <div className="space-y-2">
                  {(currentQuestion.options ?? []).map((opt) => {
                    const selected = selectedOptionIds.includes(opt.id);
                    const optImgSrc = resolveRenderableMediaSrc(opt.image_url);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={feedback.checked}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedOptionIds((prev) => {
                            if (!isChoiceMulti) return [opt.id];
                            return prev.includes(opt.id)
                              ? prev.filter((id) => id !== opt.id)
                              : [...prev, opt.id];
                          });
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
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
                          !selected &&
                            !feedback.checked &&
                            "border-border hover:bg-secondary",
                        )}
                      >
                        <span className="shrink-0 pt-0.5 font-semibold">
                          {opt.label}.
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          {opt.content.trim().length > 0 && (
                            <span className="block break-words">
                              {opt.content}
                            </span>
                          )}
                          {opt.image_url &&
                            (optImgSrc ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={optImgSrc}
                                alt={
                                  opt.content.trim() ||
                                  (vi
                                    ? `Hình ảnh đáp án ${opt.label}`
                                    : `Option ${opt.label} image`)
                                }
                                className="border-border max-h-44 max-w-full rounded-md border object-contain"
                                data-testid={`offline-option-image-${opt.id}`}
                              />
                            ) : (
                              <span className="text-muted-foreground inline-block text-xs italic">
                                {vi
                                  ? "[Hình ảnh chưa lưu ngoại tuyến]"
                                  : "[Option image not cached offline]"}
                              </span>
                            ))}
                        </div>
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
