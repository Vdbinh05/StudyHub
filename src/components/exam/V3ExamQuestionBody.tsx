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
  ZoomIn,
} from "lucide-react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ImageLightbox } from "@/components/media/ImageLightbox";
import { lText } from "@/components/learning/learning-copy";
import { SafeRichText, ZoomableImage } from "@/components/learning/SafeRichText";
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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { isSafeDisplayImageUrl } from "@/lib/learning/api-client";
import { normalizeMatchingExamPayload } from "@/lib/learning/exam-scoring";
import { indexToOptionLabel } from "@/lib/learning/shuffle";
import type {
  ExamSnapshotQuestion,
  NormalizedPoint,
  StructuredAnswerResponse,
} from "@/types/domain";
import { cn } from "@/lib/utils";

export interface ExamAnswerRecordLike {
  selectedOptionIds: string[];
  typedAnswer: string;
  structuredResponse?: StructuredAnswerResponse | null;
}

/**
 * Determine whether any V1/V2/V3 exam question has an active non-empty response.
 */
export function hasExamQuestionAnswer(
  question: ExamSnapshotQuestion,
  record?: ExamAnswerRecordLike | null,
): boolean {
  if (!record) return false;
  if (record.selectedOptionIds.length > 0) return true;
  if (record.typedAnswer.trim().length > 0) return true;

  const sr = record.structuredResponse;
  if (!sr) return false;

  switch (sr.kind) {
    case "options":
      return sr.selected_option_ids.length > 0;
    case "text":
      return sr.value.trim().length > 0;
    case "blanks":
      return Object.values(sr.answers).some((v) => v.trim().length > 0);
    case "numerical":
      return sr.value.trim().length > 0;
    case "ordering":
      return sr.ordered_item_ids.length > 0;
    case "matching":
      return Object.values(sr.pairs).some((v) => Boolean(v));
    case "hotspot":
      return (
        sr.clicks.length > 0 || (sr.selected_hotspot_ids?.length ?? 0) > 0
      );
    default:
      return false;
  }
}

export interface V3ExamQuestionBodyProps {
  question: ExamSnapshotQuestion;
  record: ExamAnswerRecordLike;
  onSelectOption: (optionId: string) => void;
  onChangeTyped: (value: string) => void;
  onChangeStructured: (
    response: StructuredAnswerResponse,
    mirrorTyped?: string,
  ) => void;
}

function V3ExamQuestionBodyInner({
  question,
  record,
  onSelectOption,
  onChangeTyped,
  onChangeStructured,
}: V3ExamQuestionBodyProps) {
  const { locale, t } = useI18n();
  const [optionLightbox, setOptionLightbox] = React.useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [kbPoint, setKbPoint] = React.useState<NormalizedPoint>({
    x: 0.5,
    y: 0.5,
  });

  const payload = question.type_payload_snapshot ?? null;

  // Prompt media images from media_snapshot
  const promptMediaImages = React.useMemo(
    () =>
      (question.media_snapshot ?? []).filter(
        (m) =>
          (m.role === "prompt" || m.role === "passage" || m.role === "diagram_base") &&
          m.mime_type.startsWith("image/") &&
          isSafeDisplayImageUrl(m.proxy_url),
      ),
    [question.media_snapshot],
  );

  // Reading passage context (never detached from question!)
  const passageText =
    question.passage_snapshot?.content_text ??
    (payload?.type === "reading_passage" ? payload.passage_text : null) ??
    null;
  const passageRich =
    question.passage_snapshot?.content_rich ??
    (payload?.type === "reading_passage" ? payload.passage_rich : null) ??
    null;
  const passageTitle =
    question.passage_snapshot?.title ??
    (payload?.type === "reading_passage" ? payload.passage_title : null) ??
    null;

  // Listening audio source (strictly hides transcript pre-submit!)
  const listeningAudioUrl =
    question.audio_url_snapshot ??
    (payload?.type === "listening" ? payload.audio_url : null) ??
    question.media_snapshot?.find((m) => m.role === "audio")?.proxy_url ??
    null;
  const listeningMaxReplays =
    payload?.type === "listening" ? (payload.max_replays ?? null) : null;

  const isMultipleChoice =
    question.question_type === "multiple_choice" ||
    (payload?.type === "image_choice" && payload.selection_mode === "multiple") ||
    (payload?.type === "reading_passage" &&
      payload.sub_answer_kind === "multiple_choice") ||
    (payload?.type === "listening" &&
      payload.sub_answer_kind === "multiple_choice");

  // Ordering current sequence
  const currentOrderedIds = React.useMemo(() => {
    if (payload?.type !== "ordering") return [];
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (
      record.structuredResponse?.kind === "ordering" &&
      record.structuredResponse.ordered_item_ids.length === items.length
    ) {
      return record.structuredResponse.ordered_item_ids;
    }
    return items.map((it) => it.id);
  }, [payload, record.structuredResponse]);

  const moveOrderingItem = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= currentOrderedIds.length) return;
    const next = [...currentOrderedIds];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onChangeStructured({ kind: "ordering", ordered_item_ids: next });
  };

  // Matching current map
  const currentMatchingPairs: Record<string, string> =
    record.structuredResponse?.kind === "matching"
      ? record.structuredResponse.pairs
      : {};

  // Fill-in-blank current map
  const currentBlankAnswers: Record<string, string> =
    record.structuredResponse?.kind === "blanks"
      ? record.structuredResponse.answers
      : {};

  // Numerical current values
  const currentNumValue =
    record.structuredResponse?.kind === "numerical"
      ? record.structuredResponse.value
      : record.typedAnswer;
  const currentNumUnit =
    record.structuredResponse?.kind === "numerical"
      ? (record.structuredResponse.unit ?? "")
      : "";

  // Hotspot clicks
  const currentHotspotClicks: NormalizedPoint[] =
    record.structuredResponse?.kind === "hotspot"
      ? record.structuredResponse.clicks
      : [];

  const renderChoiceOptions = (asImageGrid: boolean) => (
    <div
      role={isMultipleChoice ? "group" : "radiogroup"}
      aria-label={lText(locale, "Các phương án", "Answer choices")}
      className={cn(
        asImageGrid ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "space-y-2.5",
      )}
    >
      {question.options_snapshot.map((opt, optIdx) => {
        const isSelected = record.selectedOptionIds.includes(opt.id);
        const displayLetter = indexToOptionLabel(optIdx);
        const hasOptImage = isSafeDisplayImageUrl(opt.image_url);

        return (
          <div
            key={opt.id}
            className={cn(
              "relative flex flex-col rounded-lg border transition-colors",
              isSelected
                ? "border-2 border-primary bg-accent text-accent-foreground"
                : "border-input bg-card text-foreground hover:bg-secondary/60",
            )}
          >
            <button
              type="button"
              role={isMultipleChoice ? "checkbox" : "radio"}
              aria-checked={isSelected}
              onClick={() => onSelectOption(opt.id)}
              className="flex min-h-[52px] w-full flex-col gap-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-lg"
            >
              <div className="flex w-full items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-secondary text-secondary-foreground",
                  )}
                >
                  {displayLetter}
                </span>
                <div className="flex-1 text-sm sm:text-base leading-relaxed">
                  {opt.content || opt.content_rich ? (
                    <SafeRichText
                      rich={opt.content_rich}
                      fallbackText={opt.content}
                    />
                  ) : hasOptImage ? (
                    <span className="text-xs text-muted-foreground">
                      {lText(
                        locale,
                        `Hình phương án ${displayLetter}`,
                        `Option ${displayLetter} image`,
                      )}
                    </span>
                  ) : null}
                </div>
                {isSelected ? (
                  <Check
                    className="mt-1 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              {hasOptImage ? (
                <div className="flex min-h-24 w-full items-center justify-center pt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={opt.image_url ?? ""}
                    alt={
                      opt.image_alt ||
                      opt.content ||
                      `Option ${displayLetter}`
                    }
                    loading="lazy"
                    decoding="async"
                    className="mx-auto max-h-44 w-auto rounded-md border border-border object-contain"
                  />
                </div>
              ) : null}
            </button>

            {hasOptImage ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-2 bottom-2 size-8 opacity-90 shadow-xs"
                aria-label={lText(
                  locale,
                  `Phóng to hình phương án ${displayLetter}`,
                  `Zoom option ${displayLetter} image`,
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setOptionLightbox({
                    src: opt.image_url!,
                    alt:
                      opt.image_alt ||
                      opt.content ||
                      `Option ${displayLetter}`,
                  });
                }}
              >
                <ZoomIn className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Grouped Reading Passage (never detached from question!) */}
      {(passageText || passageRich) ? (
        <section
          aria-label={lText(locale, "Đoạn văn đọc hiểu", "Reading passage")}
          className="rounded-xl border border-border bg-secondary/35 p-4 text-sm"
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
            <BookOpen className="size-3.5" aria-hidden="true" />
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

      {/* Listening Audio Player (transcript strictly hidden pre-submit!) */}
      {listeningAudioUrl && isSafeDisplayImageUrl(listeningAudioUrl) ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Headphones className="size-3.5 text-primary" aria-hidden="true" />
            <span>
              {lText(locale, "Âm thanh câu hỏi", "Question Audio")}
              {listeningMaxReplays
                ? ` · ${lText(locale, `Tối đa ${listeningMaxReplays} lượt nghe`, `Max ${listeningMaxReplays} plays`)}`
                : ""}
            </span>
          </div>
          <AudioPlayer
            src={listeningAudioUrl}
            maxReplays={listeningMaxReplays}
            preload="metadata"
            hideTranscriptToggle
          />
        </div>
      ) : null}

      {/* Question Prompt & Multimedia Images */}
      <div className="space-y-3">
        <div className="max-w-[68ch] text-base sm:text-lg font-medium leading-relaxed text-foreground">
          <SafeRichText
            rich={question.prompt_rich_snapshot}
            fallbackText={question.prompt_snapshot}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <ZoomableImage
            src={question.prompt_image_url_snapshot}
            alt={lText(locale, "Hình ảnh câu hỏi", "Question illustration")}
          />
          {promptMediaImages.map((m) => (
            <ZoomableImage
              key={m.media_id}
              src={m.proxy_url}
              alt={m.alt_text ?? ""}
              caption={m.caption}
              className="max-h-56"
            />
          ))}
        </div>
      </div>

      {/* Type-Specific Interactive Answer Area (ALL 12 Exam Question Types) */}
      {question.question_type === "image_choice" ? (
        renderChoiceOptions(true)
      ) : question.question_type === "numerical" &&
        payload?.type === "numerical" ? (
        <div className="space-y-2 rounded-xl border border-border bg-secondary/20 p-4">
          <Label htmlFor={`exam-num-${question.id}`} className="text-sm">
            {lText(locale, "Nhập giá trị số:", "Enter numerical value:")}
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`exam-num-${question.id}`}
              type="text"
              inputMode="decimal"
              value={currentNumValue}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = Number(raw.trim().replace(",", "."));
                onChangeStructured(
                  {
                    kind: "numerical",
                    value: raw,
                    numeric_value:
                      raw.trim() !== "" && Number.isFinite(parsed)
                        ? parsed
                        : null,
                    unit: currentNumUnit || payload.unit || null,
                  },
                  raw,
                );
              }}
              placeholder={lText(locale, "Ví dụ: 1013.25", "e.g., 1013.25")}
              className="w-48 tabular-nums text-base sm:text-sm"
            />
            {payload.unit_required || payload.unit ? (
              payload.unit_required ? (
                <Input
                  aria-label={lText(locale, "Đơn vị đo", "Unit")}
                  value={currentNumUnit}
                  onChange={(e) => {
                    const u = e.target.value;
                    const parsed = Number(
                      currentNumValue.trim().replace(",", "."),
                    );
                    onChangeStructured(
                      {
                        kind: "numerical",
                        value: currentNumValue,
                        numeric_value:
                          currentNumValue.trim() !== "" && Number.isFinite(parsed)
                            ? parsed
                            : null,
                        unit: u || null,
                      },
                      `${currentNumValue} ${u}`.trim(),
                    );
                  }}
                  placeholder={
                    payload.unit
                      ? lText(
                          locale,
                          `Đơn vị (bắt buộc, vd: ${payload.unit})`,
                          `Unit (required, e.g., ${payload.unit})`,
                        )
                      : lText(
                          locale,
                          "Nhập đơn vị đo (bắt buộc)",
                          "Enter unit (required)",
                        )
                  }
                  className="w-44 text-base sm:text-sm"
                />
              ) : (
                <Badge variant="secondary" className="h-9 px-3 text-sm font-mono">
                  {payload.unit}
                </Badge>
              )
            ) : null}
          </div>
        </div>
      ) : (question.question_type === "fill_in_blank" ||
          (payload?.type === "listening" &&
            payload.sub_answer_kind === "fill_in_blank")) &&
        payload?.type === "fill_in_blank" ? (
        <div className="space-y-3 rounded-xl border border-border bg-secondary/20 p-4">
          {payload.template_text ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {payload.template_text}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {(Array.isArray(payload.blanks) ? payload.blanks : []).map((blank, idx) => (
              <div key={blank.blank_id} className="space-y-1">
                <Label
                  htmlFor={`exam-blank-${question.id}-${blank.blank_id}`}
                  className="text-xs font-medium"
                >
                  {lText(locale, `Chỗ trống #${idx + 1}`, `Blank #${idx + 1}`)}
                  {blank.hint ? ` — ${blank.hint}` : ""}
                </Label>
                <Input
                  id={`exam-blank-${question.id}-${blank.blank_id}`}
                  value={currentBlankAnswers[blank.blank_id] ?? ""}
                  onChange={(e) => {
                    const nextAnswers = {
                      ...currentBlankAnswers,
                      [blank.blank_id]: e.target.value,
                    };
                    onChangeStructured(
                      { kind: "blanks", answers: nextAnswers },
                      Object.values(nextAnswers).join(" | "),
                    );
                  }}
                  placeholder={lText(locale, "Điền đáp án...", "Fill answer...")}
                  className="text-base sm:text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      ) : question.question_type === "ordering" &&
        payload?.type === "ordering" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {lText(
              locale,
              "Kéo thả hoặc dùng nút Lên / Xuống để sắp xếp đúng thứ tự từ trên xuống dưới:",
              "Drag or use Up / Down buttons to arrange items in the correct order:",
            )}
          </p>
          <div className="space-y-2">
            {currentOrderedIds.map((itemId, idx) => {
              const orderingItems = Array.isArray(payload.items)
                ? payload.items
                : [];
              const item = orderingItems.find((it) => it.id === itemId);
              if (!item) return null;
              return (
                <div
                  key={itemId}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== idx) {
                      moveOrderingItem(dragIndex, idx);
                    }
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 shadow-2xs"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <GripVertical
                      className="size-4 shrink-0 cursor-grab text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {idx + 1}
                    </Badge>
                    <div className="min-w-0 text-sm">
                      <SafeRichText
                        rich={item.rich_text}
                        fallbackText={item.text}
                      />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9"
                      disabled={idx === 0}
                      aria-label={lText(
                        locale,
                        `Di chuyển mục ${idx + 1} lên`,
                        `Move item ${idx + 1} up`,
                      )}
                      onClick={() => moveOrderingItem(idx, idx - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9"
                      disabled={idx === currentOrderedIds.length - 1}
                      aria-label={lText(
                        locale,
                        `Di chuyển mục ${idx + 1} xuống`,
                        `Move item ${idx + 1} down`,
                      )}
                      onClick={() => moveOrderingItem(idx, idx + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : question.question_type === "matching" &&
        payload?.type === "matching" ? (() => {
        const { leftItems, rightItems } = normalizeMatchingExamPayload(payload);
        return (
          <div className="space-y-2.5">
            <p className="text-xs text-muted-foreground">
              {lText(
                locale,
                "Chọn phương án ghép cặp tương ứng ở cột bên phải cho từng mục:",
                "Select the corresponding match from the right column for each item:",
              )}
            </p>
            {leftItems.map((leftItem, idx) => (
              <div
                key={leftItem.id}
                className="grid items-center gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2"
              >
                <div className="flex items-start gap-2 text-sm font-medium">
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    {idx + 1}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SafeRichText
                      rich={leftItem.left_rich_text}
                      fallbackText={leftItem.left_text}
                    />
                    {leftItem.left_image_url ? (
                      <ZoomableImage
                        src={leftItem.left_image_url}
                        alt={leftItem.left_text}
                        className="max-h-28"
                      />
                    ) : null}
                  </div>
                </div>
                <Select
                  value={currentMatchingPairs[leftItem.id] ?? ""}
                  onValueChange={(rightId) => {
                    onChangeStructured({
                      kind: "matching",
                      pairs: {
                        ...currentMatchingPairs,
                        [leftItem.id]: rightId,
                      },
                    });
                  }}
                >
                  <SelectTrigger aria-label={leftItem.left_text}>
                    <SelectValue
                      placeholder={lText(
                        locale,
                        "Chọn cặp tương ứng...",
                        "Choose matching option...",
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {rightItems.map((rc) => (
                      <SelectItem key={rc.right_id} value={rc.right_id}>
                        {rc.right_text}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        );
      })() : question.question_type === "image_hotspot" &&
        payload?.type === "image_hotspot" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {lText(
                locale,
                "Nhấp/chạm trực tiếp lên vị trí đúng trên hình ảnh, hoặc dùng bảng điều khiển bàn phím bên dưới:",
                "Click or tap the target position on the image, or use keyboard crosshair controls below:",
              )}
            </p>
            {currentHotspotClicks.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs"
                onClick={() =>
                  onChangeStructured({ kind: "hotspot", clicks: [] })
                }
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                {lText(locale, "Xóa điểm chọn", "Clear marker")}
              </Button>
            ) : null}
          </div>

          {isSafeDisplayImageUrl(
            payload.image_url || question.prompt_image_url_snapshot,
          ) ? (
            <div className="relative inline-flex min-h-48 max-w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={
                  payload.image_url || question.prompt_image_url_snapshot || ""
                }
                alt={lText(locale, "Sơ đồ điểm đánh dấu", "Hotspot diagram")}
                loading="lazy"
                decoding="async"
                className="max-h-[420px] w-auto cursor-crosshair object-contain select-none"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  );
                  const y = Math.max(
                    0,
                    Math.min(1, (e.clientY - rect.top) / rect.height),
                  );
                  const pt = {
                    x: Math.round(x * 10000) / 10000,
                    y: Math.round(y * 10000) / 10000,
                  };
                  setKbPoint(pt);
                  onChangeStructured({
                    kind: "hotspot",
                    clicks: payload.require_all_targets
                      ? [...currentHotspotClicks, pt]
                      : [pt],
                  });
                }}
              />
              {currentHotspotClicks.map((pt, i) => (
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

          {/* Accessible Keyboard Crosshair Placement Alternative */}
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
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setKbPoint((p) => ({ ...p, x: Math.max(0, p.x - 0.05) }))
                }
              >
                ←
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setKbPoint((p) => ({ ...p, x: Math.min(1, p.x + 0.05) }))
                }
              >
                →
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setKbPoint((p) => ({ ...p, y: Math.max(0, p.y - 0.05) }))
                }
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setKbPoint((p) => ({ ...p, y: Math.min(1, p.y + 0.05) }))
                }
              >
                ↓
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() =>
                  onChangeStructured({
                    kind: "hotspot",
                    clicks: payload.require_all_targets
                      ? [...currentHotspotClicks, kbPoint]
                      : [kbPoint],
                  })
                }
              >
                {lText(locale, "Đặt điểm", "Place pin")}
              </Button>
            </div>
          </div>
        </div>
      ) : question.question_type === "short_answer" ||
        question.options_snapshot.length === 0 ? (
        <div className="space-y-2">
          <Label htmlFor="exam-short-answer">{t("study.yourAnswer")}</Label>
          <Textarea
            id="exam-short-answer"
            rows={3}
            value={record.typedAnswer}
            onChange={(e) => onChangeTyped(e.target.value)}
            placeholder={lText(
              locale,
              "Nhập câu trả lời của bạn...",
              "Type your answer...",
            )}
            className="text-base sm:text-sm"
          />
        </div>
      ) : (
        renderChoiceOptions(false)
      )}

      {/* Lightbox for option images */}
      {optionLightbox ? (
        <ImageLightbox
          open={Boolean(optionLightbox)}
          onOpenChange={(open) => {
            if (!open) setOptionLightbox(null);
          }}
          src={optionLightbox.src}
          alt={optionLightbox.alt}
        />
      ) : null}
    </div>
  );
}

export const V3ExamQuestionBody = React.memo(V3ExamQuestionBodyInner);
