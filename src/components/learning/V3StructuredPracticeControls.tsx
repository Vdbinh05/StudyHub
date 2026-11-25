"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Crosshair,
  GripVertical,
  Headphones,
  RotateCcw,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { isSafeDisplayImageUrl } from "@/lib/learning/api-client";
import { QUESTION_TYPE_REGISTRY } from "@/lib/questions/registry";
import type {
  FillInBlankSpec,
  NormalizedPoint,
  Question,
  StructuredAnswerResponse,
} from "@/types/domain";
import { lText } from "./learning-copy";
import { SafeRichText, ZoomableImage } from "./SafeRichText";

/**
 * Deterministic Fisher-Yates shuffle seeded by a string (e.g., question ID)
 * so Matching right-column choices and Ordering items are never given away in 1:1 answer order.
 */
export function deterministicShuffleBySeed<T>(
  items: readonly T[],
  seedStr: string,
): T[] {
  const arr = [...items];
  if (arr.length <= 1) return arr;

  // FNV-1a 32-bit hash -> mulberry32 PRNG
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i += 1) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  const nextRand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  // If shuffling 2+ items happened to preserve identical order, rotate by 1 so it's never a trivial giveaway
  if (arr.length >= 2 && arr.every((val, idx) => val === items[idx])) {
    const first = arr.shift()!;
    arr.push(first);
  }

  return arr;
}

/**
 * Return true when a Question uses structured V3 interactive controls
 * (rather than standard option buttons or plain short-answer text input).
 */
export function isStructuredV3Question(question: Question): boolean {
  const qt = question.question_type;
  const payload = question.type_payload;

  if (
    qt === "ordering" ||
    qt === "matching" ||
    qt === "fill_in_blank" ||
    qt === "numerical" ||
    qt === "image_hotspot"
  ) {
    return Boolean(payload && payload.type === qt);
  }

  if (
    qt === "listening" &&
    payload?.type === "listening" &&
    payload.sub_answer_kind === "fill_in_blank"
  ) {
    return true;
  }

  return false;
}

/**
 * Grade any V3 structured study question using the canonical `QUESTION_TYPE_REGISTRY`.
 */
export function gradeStructuredStudyQuestion(
  question: Question,
  response: StructuredAnswerResponse,
): boolean {
  const descriptor = QUESTION_TYPE_REGISTRY[question.question_type];
  if (!descriptor) return false;
  return descriptor.gradeResponse(question, response).isCorrect;
}

/**
 * Renders Reading Passage context AND Listening Audio player for any study question
 * (`reading_passage` or `listening`, fixing `FUNC-08`).
 */
export function QuestionContextMedia({ question }: { question: Question }) {
  const { locale } = useI18n();
  const payload = question.type_payload ?? null;

  const passageTitle =
    question.passage?.title ??
    (payload?.type === "reading_passage" ? payload.passage_title : null) ??
    null;
  const passageText =
    question.passage?.content_text ??
    (payload?.type === "reading_passage" ? payload.passage_text : null) ??
    null;
  const passageRich =
    question.passage?.content_rich ??
    (payload?.type === "reading_passage" ? payload.passage_rich : null) ??
    null;

  const listeningAudioUrl =
    question.audio_url ??
    (payload?.type === "listening" ? payload.audio_url : null) ??
    question.passage?.audio_media?.proxy_url ??
    null;
  const listeningTranscript =
    question.audio_transcript ??
    (payload?.type === "listening" ? payload.transcript : null) ??
    question.passage?.transcript ??
    null;

  return (
    <>
      {passageText || passageRich ? (
        <section
          aria-label={lText(locale, "Đoạn văn đọc hiểu", "Reading passage")}
          className="rounded-xl border border-border bg-secondary/35 p-4 text-sm"
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
            <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {passageTitle ||
                lText(locale, "Đoạn văn tham khảo", "Reference Passage")}
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto pr-1">
            <SafeRichText rich={passageRich} fallbackText={passageText} />
          </div>
        </section>
      ) : null}

      {listeningAudioUrl && isSafeDisplayImageUrl(listeningAudioUrl) ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Headphones className="size-3.5 text-primary" aria-hidden="true" />
            <span>{lText(locale, "Âm thanh câu hỏi", "Question Audio")}</span>
          </div>
          <AudioPlayer
            src={listeningAudioUrl}
            transcript={listeningTranscript}
            compact
            preload="metadata"
          />
        </div>
      ) : null}
    </>
  );
}

export interface V3StructuredPracticeControlsProps {
  question: Question;
  disabled: boolean;
  value: StructuredAnswerResponse | null;
  onChange: (response: StructuredAnswerResponse) => void;
  onSubmit: (response: StructuredAnswerResponse) => void;
}

export function V3StructuredPracticeControls({
  question,
  disabled,
  value,
  onChange,
  onSubmit,
}: V3StructuredPracticeControlsProps) {
  const { locale, t } = useI18n();
  const payload = question.type_payload ?? null;
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [kbPoint, setKbPoint] = React.useState<NormalizedPoint>({ x: 0.5, y: 0.5 });

  // Deterministic initial ordering items (shuffled by question.id so it's not pre-solved!)
  const initialOrderedIds = React.useMemo(() => {
    if (payload?.type !== "ordering") return [];
    const items = Array.isArray(payload.items) ? payload.items : [];
    const sorted = [...items].sort((a, b) => a.correct_position - b.correct_position);
    return deterministicShuffleBySeed(
      sorted.map((it) => it.id),
      `ord:${question.id}`,
    );
  }, [payload, question.id]);

  // Deterministic shuffled right items for matching (fixes giveaway order!)
  const shuffledMatchingRight = React.useMemo(() => {
    if (payload?.type !== "matching") return [];
    const allRight = [
      ...(payload.pairs ?? []).map((p) => ({
        right_id: p.right_id,
        right_text: p.right_text,
      })),
      ...(payload.distractors ?? []).map((d) => ({
        right_id: d.right_id,
        right_text: d.right_text,
      })),
    ];
    return deterministicShuffleBySeed(allRight, `match:${question.id}`);
  }, [payload, question.id]);

  // Fill-in-blank specs for both `fill_in_blank` and `listening + fill_in_blank`
  const fibView = React.useMemo((): {
    templateText?: string;
    blanks: FillInBlankSpec[];
  } | null => {
    if (question.question_type === "fill_in_blank" && payload?.type === "fill_in_blank") {
      return {
        templateText: payload.template_text,
        blanks: Array.isArray(payload.blanks) ? payload.blanks : [],
      };
    }
    if (
      question.question_type === "listening" &&
      payload?.type === "listening" &&
      payload.sub_answer_kind === "fill_in_blank"
    ) {
      const ext = payload as typeof payload & {
        template_text?: string;
        blanks?: FillInBlankSpec[];
      };
      const blanks: FillInBlankSpec[] =
        Array.isArray(ext.blanks) && ext.blanks.length > 0
          ? ext.blanks
          : [{ blank_id: "b1", accepted_answers: [] }];
      return {
        templateText: ext.template_text,
        blanks,
      };
    }
    return null;
  }, [payload, question.question_type]);

  // 1. NUMERICAL
  if (question.question_type === "numerical" && payload?.type === "numerical") {
    const numVal = value?.kind === "numerical" ? value.value : "";
    const unitVal = value?.kind === "numerical" ? (value.unit ?? "") : "";

    const buildNumResponse = (
      rawVal: string,
      rawUnit: string,
    ): StructuredAnswerResponse => {
      const parsed = Number(rawVal.trim().replace(",", "."));
      return {
        kind: "numerical",
        value: rawVal,
        numeric_value:
          rawVal.trim() !== "" && Number.isFinite(parsed) ? parsed : null,
        unit: payload.unit_required ? rawUnit || null : payload.unit ?? null,
      };
    };

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled || !numVal.trim()) return;
          onSubmit(buildNumResponse(numVal, unitVal));
        }}
        className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4"
      >
        <Label htmlFor={`practice-num-${question.id}`} className="text-sm">
          {lText(locale, "Nhập giá trị số:", "Enter numerical value:")}
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`practice-num-${question.id}`}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={numVal}
            onChange={(e) => onChange(buildNumResponse(e.target.value, unitVal))}
            placeholder={lText(locale, "Ví dụ: 9.8", "e.g., 9.8")}
            className="h-11 sm:h-10 w-44 tabular-nums text-base sm:text-sm"
          />
          {payload.unit_required ? (
            <Input
              aria-label={lText(locale, "Đơn vị đo", "Unit")}
              disabled={disabled}
              value={unitVal}
              onChange={(e) => onChange(buildNumResponse(numVal, e.target.value))}
              placeholder={lText(locale, "Nhập đơn vị đo...", "Enter unit...")}
              className="h-11 sm:h-10 w-40 text-base sm:text-sm"
            />
          ) : payload.unit ? (
            <Badge variant="secondary" className="h-9 px-3 font-mono text-sm">
              {payload.unit}
            </Badge>
          ) : null}
        </div>
        {!disabled ? (
          <Button
            type="submit"
            className="min-h-11"
            disabled={!numVal.trim() || (payload.unit_required && !unitVal.trim())}
          >
            {t("study.checkAnswer")}
          </Button>
        ) : null}
      </form>
    );
  }

  // 2. FILL IN BLANK (including Listening + Fill in Blank)
  if (fibView) {
    const currentAnswers = value?.kind === "blanks" ? value.answers : {};
    const hasAnyValue = Object.values(currentAnswers).some((v) => v.trim().length > 0);
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (disabled || !hasAnyValue) return;
          onSubmit({ kind: "blanks", answers: currentAnswers });
        }}
        className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4"
      >
        {fibView.templateText ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {fibView.templateText}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {fibView.blanks.map((blank, idx) => (
            <div key={`${blank.blank_id}-${idx}`} className="space-y-1">
              <Label
                htmlFor={`practice-blank-${question.id}-${blank.blank_id}`}
                className="text-xs font-medium"
              >
                {lText(locale, `Chỗ trống #${idx + 1}`, `Blank #${idx + 1}`)}
                {blank.hint ? ` — ${blank.hint}` : ""}
              </Label>
              <Input
                id={`practice-blank-${question.id}-${blank.blank_id}`}
                disabled={disabled}
                value={currentAnswers[blank.blank_id] ?? ""}
                onChange={(e) =>
                  onChange({
                    kind: "blanks",
                    answers: {
                      ...currentAnswers,
                      [blank.blank_id]: e.target.value,
                    },
                  })
                }
                placeholder={lText(locale, "Điền đáp án...", "Fill answer...")}
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </div>
          ))}
        </div>
        {!disabled ? (
          <Button type="submit" className="min-h-11" disabled={!hasAnyValue}>
            {t("study.checkAnswer")}
          </Button>
        ) : null}
      </form>
    );
  }

  // 3. ORDERING
  if (question.question_type === "ordering" && payload?.type === "ordering") {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const orderedIds =
      value?.kind === "ordering" && value.ordered_item_ids.length === items.length
        ? value.ordered_item_ids
        : initialOrderedIds;

    const moveItem = (fromIdx: number, toIdx: number) => {
      if (disabled || toIdx < 0 || toIdx >= orderedIds.length) return;
      const next = [...orderedIds];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      onChange({ kind: "ordering", ordered_item_ids: next });
    };

    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {lText(
            locale,
            "Kéo thả hoặc dùng nút Lên / Xuống để sắp xếp đúng thứ tự:",
            "Drag or use Up / Down buttons to arrange in the correct order:",
          )}
        </p>
        <div className="space-y-2">
          {orderedIds.map((itemId, idx) => {
            const item = items.find((it) => it.id === itemId);
            if (!item) return null;
            return (
              <div
                key={itemId}
                draggable={!disabled}
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== idx) {
                    moveItem(dragIndex, idx);
                  }
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <GripVertical
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {idx + 1}
                  </Badge>
                  <div className="min-w-0 text-sm">
                    <SafeRichText rich={item.rich_text} fallbackText={item.text} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 sm:size-9"
                    disabled={disabled || idx === 0}
                    aria-label={lText(
                      locale,
                      `Di chuyển mục ${idx + 1} lên`,
                      `Move item ${idx + 1} up`,
                    )}
                    onClick={() => moveItem(idx, idx - 1)}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 sm:size-9"
                    disabled={disabled || idx === orderedIds.length - 1}
                    aria-label={lText(
                      locale,
                      `Di chuyển mục ${idx + 1} xuống`,
                      `Move item ${idx + 1} down`,
                    )}
                    onClick={() => moveItem(idx, idx + 1)}
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {!disabled ? (
          <Button
            type="button"
            className="min-h-11 gap-1.5"
            onClick={() =>
              onSubmit({ kind: "ordering", ordered_item_ids: [...orderedIds] })
            }
          >
            <Check className="size-4" aria-hidden="true" />
            {lText(locale, "Kiểm tra thứ tự", "Check Order")}
          </Button>
        ) : null}
      </div>
    );
  }

  // 4. MATCHING
  if (question.question_type === "matching" && payload?.type === "matching") {
    const pairs = payload.pairs ?? [];
    const currentPairs = value?.kind === "matching" ? value.pairs : {};
    const allMatched =
      pairs.length > 0 && pairs.every((p) => Boolean(currentPairs[p.id]));

    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {lText(
            locale,
            "Chọn phương án ghép cặp tương ứng ở cột bên phải:",
            "Select the matching option from the right column for each item:",
          )}
        </p>
        <div className="space-y-2.5">
          {pairs.map((pair, idx) => (
            <div
              key={pair.id}
              className="grid items-center gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2"
            >
              <div className="flex items-start gap-2 text-sm font-medium">
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {idx + 1}
                </Badge>
                <div className="min-w-0 flex-1 space-y-1">
                  <SafeRichText
                    rich={pair.left_rich_text}
                    fallbackText={pair.left_text}
                  />
                  {pair.left_image_url ? (
                    <ZoomableImage
                      src={pair.left_image_url}
                      alt={pair.left_text}
                      className="max-h-28"
                    />
                  ) : null}
                </div>
              </div>
              <Select
                disabled={disabled}
                value={currentPairs[pair.id] ?? ""}
                onValueChange={(rightId) =>
                  onChange({
                    kind: "matching",
                    pairs: { ...currentPairs, [pair.id]: rightId },
                  })
                }
              >
                <SelectTrigger aria-label={pair.left_text} className="min-h-11 sm:min-h-9">
                  <SelectValue
                    placeholder={lText(
                      locale,
                      "Chọn cặp tương ứng...",
                      "Choose matching option...",
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  {shuffledMatchingRight.map((rc) => (
                    <SelectItem key={rc.right_id} value={rc.right_id}>
                      {rc.right_text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        {!disabled ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={!allMatched}
            onClick={() => onSubmit({ kind: "matching", pairs: currentPairs })}
          >
            {lText(locale, "Kiểm tra ghép cặp", "Check Matches")}
          </Button>
        ) : null}
      </div>
    );
  }

  // 5. IMAGE HOTSPOT (tight inline-block wrapper + multi-target + keyboard fallback — FUNC-08 & FUNC-25)
  if (question.question_type === "image_hotspot" && payload?.type === "image_hotspot") {
    const clicks: NormalizedPoint[] = value?.kind === "hotspot" ? value.clicks : [];
    const imgSrc = payload.image_url || question.prompt_image_url || "";
    const targetCount = payload.target_hotspots?.length ?? 1;

    const addClickPoint = (pt: NormalizedPoint) => {
      if (disabled) return;
      const nextClicks = payload.require_all_targets ? [...clicks, pt] : [pt];
      onChange({ kind: "hotspot", clicks: nextClicks });
    };

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {payload.require_all_targets && targetCount > 1
              ? lText(
                  locale,
                  `Chạm lên hình để đánh dấu đủ ${targetCount} vị trí mục tiêu (đã chọn ${clicks.length}):`,
                  `Tap the image to mark all ${targetCount} target locations (${clicks.length} placed):`,
                )
              : lText(
                  locale,
                  "Nhấp/chạm trực tiếp lên vị trí đúng trên hình ảnh:",
                  "Click or tap the target location on the image:",
                )}
          </p>
          {clicks.length > 0 && !disabled ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11 sm:min-h-8 text-xs"
              onClick={() => onChange({ kind: "hotspot", clicks: [] })}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {lText(locale, "Xóa điểm chọn", "Clear markers")}
            </Button>
          ) : null}
        </div>

        {isSafeDisplayImageUrl(imgSrc) ? (
          <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt={lText(locale, "Sơ đồ điểm đánh dấu", "Hotspot diagram")}
              loading="lazy"
              decoding="async"
              className="block max-h-[420px] max-w-full h-auto w-auto cursor-crosshair select-none"
              onClick={(e) => {
                if (disabled) return;
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                const pt = {
                  x: Math.round(x * 10000) / 10000,
                  y: Math.round(y * 10000) / 10000,
                };
                setKbPoint(pt);
                addClickPoint(pt);
              }}
            />
            {clicks.map((pt, i) => (
              <span
                key={i}
                style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-full border-2 border-white bg-primary text-[10px] font-bold text-primary-foreground shadow"
              >
                {i + 1}
              </span>
            ))}
          </div>
        ) : null}

        {!disabled ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs">
            <Crosshair className="size-3.5 text-primary" aria-hidden="true" />
            <span className="font-medium">
              {lText(locale, "Đặt điểm bằng bàn phím:", "Keyboard placement:")}
            </span>
            <span className="font-mono tabular-nums text-muted-foreground">
              X={Math.round(kbPoint.x * 100)}% · Y={Math.round(kbPoint.y * 100)}%
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-7 px-2.5 text-xs"
                onClick={() => setKbPoint((p) => ({ ...p, x: Math.max(0, p.x - 0.05) }))}
              >
                ←
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-7 px-2.5 text-xs"
                onClick={() => setKbPoint((p) => ({ ...p, x: Math.min(1, p.x + 0.05) }))}
              >
                →
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-7 px-2.5 text-xs"
                onClick={() => setKbPoint((p) => ({ ...p, y: Math.max(0, p.y - 0.05) }))}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 sm:h-7 px-2.5 text-xs"
                onClick={() => setKbPoint((p) => ({ ...p, y: Math.min(1, p.y + 0.05) }))}
              >
                ↓
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-9 sm:h-7 px-2.5 text-xs"
                onClick={() => addClickPoint(kbPoint)}
              >
                {lText(locale, "Đặt điểm", "Place pin")}
              </Button>
            </div>
          </div>
        ) : null}

        {!disabled ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={clicks.length === 0}
            onClick={() => onSubmit({ kind: "hotspot", clicks })}
          >
            {lText(locale, "Kiểm tra vị trí", "Check Position")}
          </Button>
        ) : null}
      </div>
    );
  }

  return null;
}
