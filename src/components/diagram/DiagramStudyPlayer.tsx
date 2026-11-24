"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  CheckCircle2,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  HelpCircle,
  Keyboard,
  ListChecks,
  Maximize2,
  Minimize2,
  PenLine,
  RotateCcw,
  RotateCw,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ImageLightbox } from "@/components/media/ImageLightbox";
import { MOTION_EASE, MOTION_TIMINGS } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  clampViewportTransform,
  fromDiagramHotspot,
  getHotspotCentroid,
  viewportToNormalized,
  zoomAtViewportPoint,
  type ImageViewportMetrics,
  type NormalizedPoint,
  type ViewportTransform,
} from "@/lib/diagram/geometry";
import {
  buildDiagramMcChoices,
  createDiagramStudyQueue,
  gradeDiagramIdentifyClick,
  gradeDiagramNameAnswer,
} from "@/lib/diagram/study-engine";
import { useOptionalI18n } from "@/lib/i18n";
import { resolveSafeMediaUrl } from "@/lib/media/urls";
import { cn } from "@/lib/utils";
import type { DiagramHotspot, DiagramSet, DiagramStudyMode } from "@/types/v3";

export interface DiagramStudyPlayerProps {
  diagram: DiagramSet;
  initialMode?: DiagramStudyMode;
  previewOnly?: boolean;
  backHref?: string;
  onAttemptRecord?: (event: {
    mode: DiagramStudyMode;
    hotspotId: string;
    isCorrect: boolean;
  }) => void;
  className?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

const MODE_DEFINITIONS: Array<{
  id: DiagramStudyMode;
  vi: string;
  en: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "explore", vi: "Khám phá", en: "Explore", icon: Compass },
  { id: "identify_location", vi: "Chỉ vị trí", en: "Identify Location", icon: Crosshair },
  { id: "name_location", vi: "Gọi tên", en: "Name Location", icon: PenLine },
  { id: "multiple_choice", vi: "Trắc nghiệm", en: "Multiple Choice", icon: ListChecks },
  { id: "hidden_labels", vi: "Ẩn nhãn", en: "Hidden Labels", icon: EyeOff },
  { id: "review_incorrect", vi: "Ôn vị trí sai", en: "Review Incorrect", icon: RotateCw },
];

function describeSpatialQuadrant(pt: NormalizedPoint, vi: boolean): string {
  const vertical = pt.y < 0.33 ? (vi ? "trên" : "top") : pt.y > 0.66 ? (vi ? "dưới" : "bottom") : vi ? "giữa" : "middle";
  const horizontal = pt.x < 0.33 ? (vi ? "trái" : "left") : pt.x > 0.66 ? (vi ? "phải" : "right") : vi ? "giữa" : "center";
  return vi ? `khu vực ${vertical}-${horizontal}` : `${vertical}-${horizontal} region`;
}

function renderHotspotSvgShape(
  hotspot: DiagramHotspot,
  stateClass: string,
): React.ReactNode {
  const geom = fromDiagramHotspot(hotspot);
  if (geom.shape_type === "point") {
    return (
      <circle
        cx={geom.x * 1000}
        cy={geom.y * 1000}
        r={geom.radius * 1000}
        vectorEffect="non-scaling-stroke"
        className={stateClass}
      />
    );
  }
  if (geom.shape_type === "rect") {
    return (
      <rect
        x={geom.x * 1000}
        y={geom.y * 1000}
        width={geom.width * 1000}
        height={geom.height * 1000}
        rx={4}
        vectorEffect="non-scaling-stroke"
        className={stateClass}
      />
    );
  }
  const pointsAttr = geom.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ");
  return (
    <polygon
      points={pointsAttr}
      vectorEffect="non-scaling-stroke"
      className={stateClass}
    />
  );
}

export function DiagramStudyPlayer({
  diagram,
  initialMode = "explore",
  previewOnly = false,
  backHref,
  onAttemptRecord,
  className,
}: DiagramStudyPlayerProps) {
  const i18n = useOptionalI18n();
  const vi = (i18n?.locale ?? "vi") === "vi";
  const prefersReduced = useReducedMotion();
  const baseId = React.useId();

  const hotspots = React.useMemo(
    () => [...(diagram.hotspots ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [diagram.hotspots],
  );

  const imageUrl = React.useMemo(
    () =>
      resolveSafeMediaUrl({
        url: diagram.base_image_url,
        proxy_url: diagram.base_media?.proxy_url,
        storage_path: diagram.base_media?.storage_path,
      }),
    [diagram.base_image_url, diagram.base_media],
  );

  const [mode, setMode] = React.useState<DiagramStudyMode>(initialMode);
  const [shuffleSeed, setShuffleSeed] = React.useState(1);
  const [incorrectIds, setIncorrectIds] = React.useState<string[]>([]);
  const [selectedExploreId, setSelectedExploreId] = React.useState<string | null>(
    hotspots[0]?.id ?? null,
  );
  const [revealedHiddenIds, setRevealedHiddenIds] = React.useState<Record<string, boolean>>({});
  const [hiddenMasteredIds, setHiddenMasteredIds] = React.useState<Record<string, "known" | "missed">>({});

  // Quiz state for identify_location / name_location / multiple_choice / review_incorrect
  const [queueIndex, setQueueIndex] = React.useState(0);
  const [scoreStats, setScoreStats] = React.useState({ correct: 0, wrong: 0 });
  const [showHint, setShowHint] = React.useState(false);
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const [strictDiacritics, setStrictDiacritics] = React.useState(false);
  const [selectedMcId, setSelectedMcId] = React.useState<string | null>(null);
  const [lastClickPoint, setLastClickPoint] = React.useState<NormalizedPoint | null>(null);
  const [feedback, setFeedback] = React.useState<{
    isCorrect: boolean;
    message: string;
    detail?: string | null;
  } | null>(null);
  const [showKeyboardSelector, setShowKeyboardSelector] = React.useState(false);
  const [reviewSubMode, setReviewSubMode] = React.useState<"identify_location" | "name_location">(
    "identify_location",
  );

  // Zoom / Pan / Fullscreen / Lightbox
  const [transform, setTransform] = React.useState<ViewportTransform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [lightboxOpen, setLightboxOpen] = React.useState(false);

  const playerShellRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const activePointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = React.useRef<{ initialDist: number; initialScale: number } | null>(null);
  const pointerDownInfoRef = React.useRef<{
    id: number;
    startX: number;
    startY: number;
    translateX: number;
    translateY: number;
    moved: boolean;
  } | null>(null);

  const queue = React.useMemo(
    () => createDiagramStudyQueue(hotspots, mode, incorrectIds, shuffleSeed),
    [hotspots, mode, incorrectIds, shuffleSeed],
  );

  const activeHotspot: DiagramHotspot | null =
    mode === "explore"
      ? hotspots.find((h) => h.id === selectedExploreId) ?? hotspots[0] ?? null
      : queue[queueIndex] ?? null;

  const effectiveQuizMode: DiagramStudyMode =
    mode === "review_incorrect" ? reviewSubMode : mode;

  const isQuizMode =
    mode === "identify_location" ||
    mode === "name_location" ||
    mode === "multiple_choice" ||
    mode === "review_incorrect";

  const isQueueFinished = isQuizMode && queue.length > 0 && queueIndex >= queue.length;

  const mcChoices = React.useMemo(() => {
    if (mode !== "multiple_choice" || !activeHotspot) return [];
    return buildDiagramMcChoices(activeHotspot, hotspots, 4, shuffleSeed + queueIndex * 31);
  }, [mode, activeHotspot, hotspots, shuffleSeed, queueIndex]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const resetItemInteraction = React.useCallback(() => {
    setFeedback(null);
    setTypedAnswer("");
    setSelectedMcId(null);
    setLastClickPoint(null);
    setShowHint(false);
  }, []);

  const switchMode = (nextMode: DiagramStudyMode) => {
    setMode(nextMode);
    setQueueIndex(0);
    setScoreStats({ correct: 0, wrong: 0 });
    resetItemInteraction();
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
    if (nextMode !== "review_incorrect") {
      setShuffleSeed((s) => s + 1);
    }
  };

  const restartCurrentMode = () => {
    setQueueIndex(0);
    setScoreStats({ correct: 0, wrong: 0 });
    resetItemInteraction();
    setShuffleSeed((s) => s + 1);
    if (mode === "hidden_labels") {
      setRevealedHiddenIds({});
      setHiddenMasteredIds({});
    }
  };

  const recordOutcome = React.useCallback(
    (hotspot: DiagramHotspot, isCorrect: boolean) => {
      setScoreStats((prev) => ({
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
      }));
      setIncorrectIds((prev) => {
        if (isCorrect) {
          return mode === "review_incorrect" ? prev.filter((id) => id !== hotspot.id) : prev;
        }
        return prev.includes(hotspot.id) ? prev : [...prev, hotspot.id];
      });
      onAttemptRecord?.({ mode, hotspotId: hotspot.id, isCorrect });
    },
    [mode, onAttemptRecord],
  );

  const computeStageMetrics = React.useCallback((): ImageViewportMetrics | null => {
    const stage = stageRef.current;
    const img = imageRef.current;
    if (!stage || !img) return null;

    const stageRect = stage.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    if (stageRect.width <= 0 || stageRect.height <= 0 || imgRect.width <= 0 || imgRect.height <= 0) {
      return null;
    }

    // Derive scale-1 image metrics from current transformed bounding box
    const baseImageWidth = imgRect.width / transform.scale;
    const baseImageHeight = imgRect.height / transform.scale;
    const baseOffsetX = (imgRect.left - stageRect.left - transform.translateX) / transform.scale;
    const baseOffsetY = (imgRect.top - stageRect.top - transform.translateY) / transform.scale;

    return {
      containerWidth: stageRect.width,
      containerHeight: stageRect.height,
      baseImageWidth,
      baseImageHeight,
      baseOffsetX,
      baseOffsetY,
    };
  }, [transform]);

  const zoomBy = React.useCallback((delta: number) => {
    const stage = stageRef.current;
    const cw = stage?.clientWidth ?? 800;
    const ch = stage?.clientHeight ?? 500;
    setTransform((prev) =>
      zoomAtViewportPoint(
        prev,
        prev.scale + delta,
        { x: cw / 2, y: ch / 2 },
        { minScale: MIN_SCALE, maxScale: MAX_SCALE, containerWidth: cw, containerHeight: ch },
      ),
    );
  }, []);

  const resetZoom = React.useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (playerShellRef.current?.requestFullscreen) {
        await playerShellRef.current.requestFullscreen();
      }
    } catch {
      // Ignore if fullscreen blocked
    }
  }, []);

  const evaluateIdentifyPoint = (clickNorm: NormalizedPoint) => {
    if (!activeHotspot || feedback) return;
    setLastClickPoint(clickNorm);
    const result = gradeDiagramIdentifyClick(clickNorm, activeHotspot, hotspots);
    recordOutcome(activeHotspot, result.isCorrect);

    if (result.isCorrect) {
      setFeedback({
        isCorrect: true,
        message: vi ? `Chính xác: ${activeHotspot.label}` : `Correct: ${activeHotspot.label}`,
        detail: activeHotspot.description,
      });
    } else {
      setFeedback({
        isCorrect: false,
        message: result.clickedHotspotLabel
          ? vi
            ? `Chưa đúng — bạn vừa chọn "${result.clickedHotspotLabel}". Đáp án đúng là "${activeHotspot.label}".`
            : `Not quite — you tapped "${result.clickedHotspotLabel}". Target is "${activeHotspot.label}".`
          : vi
            ? `Chưa đúng vị trí. Hãy xem vùng được đánh dấu cho "${activeHotspot.label}".`
            : `Missed target area. See the highlighted region for "${activeHotspot.label}".`,
        detail: activeHotspot.description,
      });
    }
  };

  const handleKeyboardSelectHotspot = (chosen: DiagramHotspot) => {
    if (!activeHotspot || feedback) return;
    const centroid = getHotspotCentroid(fromDiagramHotspot(chosen));
    evaluateIdentifyPoint(centroid);
  };

  const handleSubmitNameAnswer = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!activeHotspot || feedback) return;
    const res = gradeDiagramNameAnswer(typedAnswer, activeHotspot, strictDiacritics);
    recordOutcome(activeHotspot, res.isCorrect);
    setFeedback({
      isCorrect: res.isCorrect,
      message: res.isCorrect
        ? vi
          ? `Chính xác! (${res.matchedLabel})`
          : `Correct! (${res.matchedLabel})`
        : vi
          ? `Chưa đúng. Đáp án đúng là: ${activeHotspot.label}`
          : `Incorrect. Correct label: ${activeHotspot.label}`,
      detail: activeHotspot.description,
    });
  };

  const handleSelectMcChoice = (choiceHotspotId: string) => {
    if (!activeHotspot || feedback) return;
    setSelectedMcId(choiceHotspotId);
    const isCorrect = choiceHotspotId === activeHotspot.id;
    recordOutcome(activeHotspot, isCorrect);
    setFeedback({
      isCorrect,
      message: isCorrect
        ? vi
          ? `Chính xác: ${activeHotspot.label}`
          : `Correct: ${activeHotspot.label}`
        : vi
          ? `Chưa đúng. Đáp án đúng là: ${activeHotspot.label}`
          : `Incorrect. Correct answer: ${activeHotspot.label}`,
      detail: activeHotspot.description,
    });
  };

  const handleAdvance = () => {
    resetItemInteraction();
    if (mode === "review_incorrect") {
      // Queue may shrink when an item is mastered; keep index clamped
      setQueueIndex((prev) => (prev + 1 >= queue.length ? 0 : prev + 1));
    } else {
      setQueueIndex((prev) => prev + 1);
    }
  };

  const handleStageTap = (localViewportPoint: { x: number; y: number }) => {
    const metrics = computeStageMetrics();
    if (!metrics) return;
    const projected = viewportToNormalized(localViewportPoint, metrics, transform);
    if (!projected.isInsideImage) return;

    if (mode === "explore") {
      const hit = gradeDiagramIdentifyClick(projected.clamped, hotspots[0], hotspots);
      if (hit.clickedHotspotId) {
        setSelectedExploreId(hit.clickedHotspotId);
      }
      return;
    }

    if (mode === "hidden_labels") {
      const hit = gradeDiagramIdentifyClick(projected.clamped, hotspots[0], hotspots);
      if (hit.clickedHotspotId) {
        setRevealedHiddenIds((prev) => ({
          ...prev,
          [hit.clickedHotspotId!]: !prev[hit.clickedHotspotId!],
        }));
      }
      return;
    }

    if (effectiveQuizMode === "identify_location" && activeHotspot && !feedback) {
      evaluateIdentifyPoint(projected.clamped);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture?.(event.pointerId);
    const rect = stage.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    activePointersRef.current.set(event.pointerId, local);

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      pinchRef.current = {
        initialDist: Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
        initialScale: transform.scale,
      };
      pointerDownInfoRef.current = null;
      return;
    }

    pointerDownInfoRef.current = {
      id: event.pointerId,
      startX: local.x,
      startY: local.y,
      translateX: transform.translateX,
      translateY: transform.translateY,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    activePointersRef.current.set(event.pointerId, local);

    if (activePointersRef.current.size === 2 && pinchRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midpoint = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const nextScale = pinchRef.current.initialScale * (dist / pinchRef.current.initialDist);
      setTransform((prev) =>
        zoomAtViewportPoint(prev, nextScale, midpoint, {
          minScale: MIN_SCALE,
          maxScale: MAX_SCALE,
          containerWidth: rect.width,
          containerHeight: rect.height,
        }),
      );
      return;
    }

    const down = pointerDownInfoRef.current;
    if (down && down.id === event.pointerId) {
      const dx = local.x - down.startX;
      const dy = local.y - down.startY;
      if (Math.hypot(dx, dy) > 8) {
        down.moved = true;
      }
      if (down.moved && transform.scale > 1) {
        setTransform((prev) =>
          clampViewportTransform(
            {
              scale: prev.scale,
              translateX: down.translateX + dx,
              translateY: down.translateY + dy,
            },
            {
              minScale: MIN_SCALE,
              maxScale: MAX_SCALE,
              containerWidth: rect.width,
              containerHeight: rect.height,
            },
          ),
        );
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const down = pointerDownInfoRef.current;
    const local = activePointersRef.current.get(event.pointerId);
    activePointersRef.current.delete(event.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    if (down && down.id === event.pointerId) {
      if (!down.moved && local) {
        handleStageTap(local);
      }
      pointerDownInfoRef.current = null;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && transform.scale === 1) {
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const delta = event.deltaY < 0 ? 0.35 : -0.35;
    setTransform((prev) =>
      zoomAtViewportPoint(prev, prev.scale + delta, focal, {
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
        containerWidth: rect.width,
        containerHeight: rect.height,
      }),
    );
  };

  if (hotspots.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Compass className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            {vi
              ? "Sơ đồ này chưa có nhãn vị trí nào để luyện tập."
              : "This diagram has no labeled hotspots yet."}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            {vi
              ? "Hãy thêm ít nhất một điểm, vùng chữ nhật hoặc đa giác trong trình biên tập sơ đồ."
              : "Add at least one point, rectangle, or polygon hotspot in the diagram editor."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div ref={playerShellRef} className={cn("space-y-4 bg-background", className)}>
      {/* Top Bar */}
      {!previewOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {backHref && (
              <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5 sm:min-h-9">
                <Link href={backHref}>
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span>{vi ? "Quay lại" : "Back"}</span>
                </Link>
              </Button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-foreground sm:text-xl">
                {diagram.title}
              </h1>
              {diagram.description && (
                <p className="truncate text-xs text-muted-foreground">{diagram.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              {vi ? `${hotspots.length} vị trí` : `${hotspots.length} hotspots`}
            </Badge>
            {incorrectIds.length > 0 && (
              <Badge variant="destructive" className="tabular-nums">
                {vi ? `${incorrectIds.length} cần ôn` : `${incorrectIds.length} missed`}
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* 6-Mode Switcher */}
      <div
        role="tablist"
        aria-label={vi ? "Chọn chế độ học sơ đồ" : "Select diagram study mode"}
        className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-1.5"
      >
        {MODE_DEFINITIONS.map((def) => {
          const Icon = def.icon;
          const active = mode === def.id;
          return (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchMode(def.id)}
              className={cn(
                "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:flex-none",
                active
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{vi ? def.vi : def.en}</span>
              {def.id === "review_incorrect" && incorrectIds.length > 0 && (
                <span className="ml-0.5 rounded-full bg-background/20 px-1.5 py-0.5 text-[11px] tabular-nums">
                  {incorrectIds.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Split Workspace: Interactive Canvas + Controls/Question Card */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Interactive Diagram Viewport */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {effectiveQuizMode === "identify_location" && !isQueueFinished
                ? vi
                  ? "Nhấn trực tiếp vào vị trí đúng trên sơ đồ (hoặc thu phóng bằng 2 ngón / nút bên phải)"
                  : "Tap or click the target location on the diagram (pinch or use buttons to zoom)"
                : vi
                  ? "Kéo để di chuyển khi phóng to · Chạm vào nhãn để xem chi tiết"
                  : "Drag to pan when zoomed · Click hotspots to inspect"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => zoomBy(-0.5)}
                disabled={transform.scale <= MIN_SCALE}
                aria-label={vi ? "Thu nhỏ sơ đồ" : "Zoom out diagram"}
                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
              >
                <ZoomOut className="size-3.5" aria-hidden="true" />
              </Button>
              <span className="min-w-12 text-center text-xs font-medium tabular-nums">
                {Math.round(transform.scale * 100)}%
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => zoomBy(0.5)}
                disabled={transform.scale >= MAX_SCALE}
                aria-label={vi ? "Phóng to sơ đồ" : "Zoom in diagram"}
                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
              >
                <ZoomIn className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={resetZoom}
                disabled={transform.scale === 1 && transform.translateX === 0 && transform.translateY === 0}
                aria-label={vi ? "Đặt lại thu phóng" : "Reset zoom"}
                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setLightboxOpen(true)}
                aria-label={vi ? "Xem ảnh gốc phóng lớn" : "Open image lightbox"}
                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
              >
                <Eye className="size-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? (vi ? "Thoát toàn màn hình" : "Exit fullscreen") : (vi ? "Toàn màn hình" : "Fullscreen")}
                className="min-h-10 min-w-10 sm:min-h-8 sm:min-w-8"
              >
                {isFullscreen ? (
                  <Minimize2 className="size-3.5" aria-hidden="true" />
                ) : (
                  <Maximize2 className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>

          <div
            ref={stageRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            style={{ touchAction: "none" }}
            className={cn(
              "relative flex min-h-[320px] max-h-[68vh] items-center justify-center overflow-hidden bg-muted/35 select-none sm:min-h-[420px]",
              effectiveQuizMode === "identify_location" && !feedback
                ? "cursor-crosshair"
                : transform.scale > 1
                  ? "cursor-grab"
                  : "cursor-default",
            )}
          >
            {imageUrl ? (
              <div
                style={{
                  transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`,
                  transformOrigin: "0 0",
                }}
                className="relative inline-flex max-h-full max-w-full items-center justify-center p-2"
              >
                <div className="relative inline-block max-h-[64vh] max-w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt={diagram.title}
                    draggable={false}
                    className="block max-h-[64vh] max-w-full object-contain pointer-events-none rounded-md"
                  />

                  {/* Normalized [0, 1] -> 1000x1000 Interactive SVG Overlay */}
                  <svg
                    viewBox="0 0 1000 1000"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                  >
                    {hotspots.map((hotspot) => {
                      const isTarget = activeHotspot?.id === hotspot.id;

                      // Hide shapes in Identify Location BEFORE user answers so we don't give away the answer!
                      if (
                        effectiveQuizMode === "identify_location" &&
                        !feedback &&
                        !isQueueFinished
                      ) {
                        return null;
                      }

                      // In Name / MC mode, highlight ONLY the active target hotspot
                      if (
                        (effectiveQuizMode === "name_location" ||
                          effectiveQuizMode === "multiple_choice") &&
                        !isTarget
                      ) {
                        return null;
                      }

                      let shapeClass =
                        "fill-primary/20 stroke-primary stroke-[2.5] transition-colors";
                      if (feedback && isTarget) {
                        shapeClass = feedback.isCorrect
                          ? "fill-success/25 stroke-success stroke-[3]"
                          : "fill-warning/30 stroke-warning stroke-[3]";
                      } else if (isTarget) {
                        shapeClass = "fill-primary/30 stroke-primary stroke-[3]";
                      } else if (mode === "hidden_labels") {
                        const status = hiddenMasteredIds[hotspot.id];
                        shapeClass =
                          status === "known"
                            ? "fill-success/20 stroke-success stroke-[2]"
                            : status === "missed"
                              ? "fill-destructive/20 stroke-destructive stroke-[2]"
                              : "fill-accent-solid/20 stroke-accent-solid stroke-[2]";
                      }

                      return (
                        <g key={hotspot.id}>
                          {renderHotspotSvgShape(hotspot, shapeClass)}
                        </g>
                      );
                    })}

                    {/* User's clicked marker in Identify Location */}
                    {lastClickPoint && effectiveQuizMode === "identify_location" && (
                      <g>
                        <circle
                          cx={lastClickPoint.x * 1000}
                          cy={lastClickPoint.y * 1000}
                          r={14}
                          vectorEffect="non-scaling-stroke"
                          className={
                            feedback?.isCorrect
                              ? "fill-success stroke-white stroke-[2.5]"
                              : "fill-destructive stroke-white stroke-[2.5]"
                          }
                        />
                      </g>
                    )}
                  </svg>

                  {/* Numbered Pins for Explore / Hidden Labels / Post-Feedback Reveal */}
                  {(mode === "explore" ||
                    mode === "hidden_labels" ||
                    effectiveQuizMode === "name_location" ||
                    effectiveQuizMode === "multiple_choice" ||
                    (effectiveQuizMode === "identify_location" && Boolean(feedback))) &&
                    hotspots.map((hotspot, idx) => {
                      const isTarget = activeHotspot?.id === hotspot.id;
                      if (
                        (effectiveQuizMode === "name_location" ||
                          effectiveQuizMode === "multiple_choice" ||
                          effectiveQuizMode === "identify_location") &&
                        !isTarget
                      ) {
                        return null;
                      }

                      const centroid = getHotspotCentroid(fromDiagramHotspot(hotspot));
                      const revealed =
                        mode === "explore" ||
                        Boolean(feedback) ||
                        (mode === "hidden_labels" && Boolean(revealedHiddenIds[hotspot.id]));

                      return (
                        <button
                          key={hotspot.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mode === "explore") {
                              setSelectedExploreId(hotspot.id);
                            } else if (mode === "hidden_labels") {
                              setRevealedHiddenIds((prev) => ({
                                ...prev,
                                [hotspot.id]: !prev[hotspot.id],
                              }));
                            }
                          }}
                          style={{
                            left: `${centroid.x * 100}%`,
                            top: `${centroid.y * 100}%`,
                          }}
                          aria-label={
                            revealed
                              ? `${idx + 1}. ${hotspot.label}`
                              : vi
                                ? `Vị trí số ${idx + 1} (đang ẩn nhãn)`
                                : `Location #${idx + 1} (label hidden)`
                          }
                          className={cn(
                            "absolute z-10 inline-flex min-h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 px-1.5 text-xs font-bold shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            isTarget
                              ? "scale-110 border-white bg-primary text-primary-foreground"
                              : mode === "hidden_labels" && hiddenMasteredIds[hotspot.id] === "known"
                                ? "border-white bg-success text-success-foreground"
                                : mode === "hidden_labels" && hiddenMasteredIds[hotspot.id] === "missed"
                                  ? "border-white bg-destructive text-destructive-foreground"
                                  : "border-white bg-slate-900/90 text-white dark:bg-slate-100 dark:text-slate-950",
                          )}
                        >
                          <span>{idx + 1}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {vi ? "Không thể tải ảnh sơ đồ." : "Diagram image unavailable."}
              </p>
            )}
          </div>
        </Card>

        {/* Right Side Interaction & Study Panel */}
        <Card className="flex flex-col">
          <CardHeader className="border-b border-border pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">
                {vi
                  ? MODE_DEFINITIONS.find((m) => m.id === mode)?.vi
                  : MODE_DEFINITIONS.find((m) => m.id === mode)?.en}
              </CardTitle>
              {isQuizMode && queue.length > 0 && !isQueueFinished && (
                <Badge variant="outline" className="tabular-nums">
                  {Math.min(queueIndex + 1, queue.length)} / {queue.length}
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col gap-4 pt-4">
            {/* MODE 1: EXPLORE */}
            {mode === "explore" && (
              <div className="space-y-3">
                {activeHotspot && (
                  <div className="rounded-lg border border-primary/30 bg-accent/50 p-3.5 space-y-1.5">
                    <p className="text-sm font-semibold text-foreground">{activeHotspot.label}</p>
                    {activeHotspot.description && (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {activeHotspot.description}
                      </p>
                    )}
                    {activeHotspot.accepted_alternatives.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {vi ? "Tên gọi khác: " : "Also accepted: "}
                        </span>
                        {activeHotspot.accepted_alternatives.join(", ")}
                      </p>
                    )}
                    {activeHotspot.hint && (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {vi ? "Gợi ý: " : "Hint: "}
                        </span>
                        {activeHotspot.hint}
                      </p>
                    )}
                  </div>
                )}

                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {hotspots.map((h, idx) => {
                    const selected = h.id === activeHotspot?.id;
                    return (
                      <li key={h.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedExploreId(h.id)}
                          className={cn(
                            "flex w-full min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors sm:min-h-9",
                            selected
                              ? "border-primary bg-accent text-foreground font-medium"
                              : "border-border bg-card text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                          )}
                        >
                          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold tabular-nums text-primary">
                            {idx + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{h.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* MODE 5: HIDDEN LABELS */}
            {mode === "hidden_labels" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const all: Record<string, boolean> = {};
                      for (const h of hotspots) all[h.id] = true;
                      setRevealedHiddenIds(all);
                    }}
                    className="min-h-9 gap-1.5"
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Hiện tất cả" : "Reveal all"}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRevealedHiddenIds({})}
                    className="min-h-9 gap-1.5"
                  >
                    <EyeOff className="size-3.5" aria-hidden="true" />
                    <span>{vi ? "Ẩn tất cả" : "Hide all"}</span>
                  </Button>
                </div>

                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {hotspots.map((h, idx) => {
                    const isOpen = Boolean(revealedHiddenIds[h.id]);
                    const mark = hiddenMasteredIds[h.id];
                    return (
                      <li
                        key={h.id}
                        className="rounded-lg border border-border bg-card p-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRevealedHiddenIds((prev) => ({ ...prev, [h.id]: !prev[h.id] }))
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground"
                          >
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular-nums">
                              {idx + 1}
                            </span>
                            <span className="truncate">
                              {isOpen
                                ? h.label
                                : vi
                                  ? "Nhấn để lật nhãn…"
                                  : "Click to reveal label…"}
                            </span>
                          </button>
                          {mark && (
                            <Badge variant={mark === "known" ? "secondary" : "destructive"}>
                              {mark === "known"
                                ? vi
                                  ? "Đã thuộc"
                                  : "Known"
                                : vi
                                  ? "Chưa nhớ"
                                  : "Missed"}
                            </Badge>
                          )}
                        </div>
                        {isOpen && (
                          <div className="space-y-2 border-t border-border/60 pt-2">
                            {h.description && (
                              <p className="text-xs text-muted-foreground">{h.description}</p>
                            )}
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant={mark === "known" ? "default" : "outline"}
                                onClick={() => {
                                  setHiddenMasteredIds((prev) => ({ ...prev, [h.id]: "known" }));
                                  setIncorrectIds((prev) => prev.filter((id) => id !== h.id));
                                }}
                                className="min-h-9 flex-1 gap-1 text-xs"
                              >
                                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                <span>{vi ? "Đã thuộc" : "Know it"}</span>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant={mark === "missed" ? "destructive" : "outline"}
                                onClick={() => {
                                  setHiddenMasteredIds((prev) => ({ ...prev, [h.id]: "missed" }));
                                  setIncorrectIds((prev) =>
                                    prev.includes(h.id) ? prev : [...prev, h.id],
                                  );
                                }}
                                className="min-h-9 flex-1 gap-1 text-xs"
                              >
                                <XCircle className="size-3.5" aria-hidden="true" />
                                <span>{vi ? "Chưa nhớ" : "Missed"}</span>
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* MODE 6: EMPTY REVIEW INCORRECT */}
            {mode === "review_incorrect" && queue.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
                <p className="text-sm font-semibold text-foreground">
                  {vi
                    ? "Không còn vị trí sai nào cần ôn lại!"
                    : "No missed locations left to review!"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vi
                    ? "Các vị trí bạn chọn sai ở các chế độ luyện tập sẽ tự động xuất hiện tại đây."
                    : "Any hotspot missed during study modes will automatically appear here for focused review."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => switchMode("identify_location")}
                  className="min-h-10"
                >
                  {vi ? "Luyện chỉ vị trí" : "Practice Identify Location"}
                </Button>
              </div>
            )}

            {/* SESSION COMPLETED SUMMARY */}
            {isQueueFinished && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
                <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-base font-semibold text-foreground">
                    {vi ? "Hoàn thành lượt học sơ đồ!" : "Diagram round complete!"}
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {vi
                      ? `Đúng ${scoreStats.correct} · Sai ${scoreStats.wrong} (${Math.round(
                          (scoreStats.correct / Math.max(1, scoreStats.correct + scoreStats.wrong)) *
                            100,
                        )}%)`
                      : `Correct ${scoreStats.correct} · Missed ${scoreStats.wrong} (${Math.round(
                          (scoreStats.correct / Math.max(1, scoreStats.correct + scoreStats.wrong)) *
                            100,
                        )}%)`}
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" onClick={restartCurrentMode} className="min-h-10">
                    {vi ? "Luyện lại" : "Practice again"}
                  </Button>
                  {incorrectIds.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => switchMode("review_incorrect")}
                      className="min-h-10"
                    >
                      {vi
                        ? `Ôn ${incorrectIds.length} vị trí sai`
                        : `Review ${incorrectIds.length} missed`}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* ACTIVE QUIZ MODES (Identify / Name / MC / Review Incorrect) */}
            {isQuizMode && !isQueueFinished && activeHotspot && (
              <div className="space-y-4">
                {mode === "review_incorrect" && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setReviewSubMode("identify_location");
                        resetItemInteraction();
                      }}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
                        reviewSubMode === "identify_location"
                          ? "bg-card text-foreground shadow-xs"
                          : "text-muted-foreground",
                      )}
                    >
                      {vi ? "Chỉ vị trí" : "Identify"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewSubMode("name_location");
                        resetItemInteraction();
                      }}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1.5 text-xs font-medium",
                        reviewSubMode === "name_location"
                          ? "bg-card text-foreground shadow-xs"
                          : "text-muted-foreground",
                      )}
                    >
                      {vi ? "Gọi tên" : "Name it"}
                    </button>
                  </div>
                )}

                {/* IDENTIFY LOCATION PROMPT + KEYBOARD ALTERNATIVE */}
                {effectiveQuizMode === "identify_location" && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-primary/25 bg-accent/50 p-3.5">
                      <p className="text-xs text-muted-foreground">
                        {vi ? "Hãy chỉ trên sơ đồ vị trí:" : "Locate on the diagram:"}
                      </p>
                      <p className="mt-1 text-base font-semibold text-foreground">
                        {activeHotspot.label}
                      </p>
                    </div>

                    {/* Accessible Keyboard Alternative with clear disclosure */}
                    <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={showKeyboardSelector}
                        aria-controls={`${baseId}-kbd-alt`}
                        onClick={() => setShowKeyboardSelector((prev) => !prev)}
                        className="min-h-9 w-full justify-between px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Keyboard className="size-3.5" aria-hidden="true" />
                          <span>
                            {vi
                              ? "Thay thế bằng bàn phím (Trợ năng)"
                              : "Keyboard alternative (Accessibility)"}
                          </span>
                        </span>
                        <span>{showKeyboardSelector ? "−" : "+"}</span>
                      </Button>

                      {showKeyboardSelector && (
                        <div id={`${baseId}-kbd-alt`} className="space-y-2 pt-1">
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {vi
                              ? "Chế độ hỗ trợ bàn phím và trình đọc màn hình: chọn vị trí theo số thứ tự và tọa độ vùng mà không cần dùng chuột."
                              : "Keyboard & screen-reader accessible mode: pick a hotspot by numbered region without pointer input."}
                          </p>
                          <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto">
                            {hotspots.map((candidate, idx) => {
                              const c = getHotspotCentroid(fromDiagramHotspot(candidate));
                              return (
                                <Button
                                  key={candidate.id}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={Boolean(feedback)}
                                  onClick={() => handleKeyboardSelectHotspot(candidate)}
                                  className="min-h-10 justify-start text-xs font-normal sm:min-h-9"
                                >
                                  <span className="font-semibold tabular-nums mr-1.5">
                                    #{idx + 1}
                                  </span>
                                  <span>
                                    ({Math.round(c.x * 100)}%, {Math.round(c.y * 100)}%) —{" "}
                                    {describeSpatialQuadrant(c, vi)}
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* NAME THE LOCATION INPUT */}
                {effectiveQuizMode === "name_location" && (
                  <form onSubmit={handleSubmitNameAnswer} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${baseId}-name-input`}>
                        {vi
                          ? "Nhập tên của vị trí đang được đánh dấu trên sơ đồ:"
                          : "Type the name of the highlighted location:"}
                      </Label>
                      <Input
                        id={`${baseId}-name-input`}
                        value={typedAnswer}
                        disabled={Boolean(feedback)}
                        onChange={(e) => setTypedAnswer(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                        }}
                        placeholder={vi ? "Gõ tên vị trí…" : "Type location name…"}
                        autoComplete="off"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${baseId}-strict-diacritics`}
                        checked={strictDiacritics}
                        onCheckedChange={setStrictDiacritics}
                        disabled={Boolean(feedback)}
                      />
                      <Label
                        htmlFor={`${baseId}-strict-diacritics`}
                        className="cursor-pointer text-xs font-normal text-muted-foreground"
                      >
                        {vi ? "Bắt buộc gõ đúng dấu tiếng Việt" : "Require exact diacritics"}
                      </Label>
                    </div>

                    {!feedback && (
                      <Button
                        type="submit"
                        disabled={!typedAnswer.trim()}
                        className="min-h-11 w-full sm:min-h-10"
                      >
                        {vi ? "Kiểm tra đáp án" : "Check answer"}
                      </Button>
                    )}
                  </form>
                )}

                {/* MULTIPLE CHOICE DIAGRAM */}
                {effectiveQuizMode === "multiple_choice" && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {vi
                        ? "Chọn tên đúng cho vị trí đang được đánh dấu:"
                        : "Choose the correct label for the highlighted location:"}
                    </p>
                    <div className="space-y-2">
                      {mcChoices.map((choice, idx) => {
                        const isPicked = selectedMcId === choice.hotspotId;
                        const revealCorrect = Boolean(feedback) && choice.isCorrect;
                        const revealWrong = Boolean(feedback) && isPicked && !choice.isCorrect;

                        return (
                          <button
                            key={choice.hotspotId}
                            type="button"
                            disabled={Boolean(feedback)}
                            onClick={() => handleSelectMcChoice(choice.hotspotId)}
                            className={cn(
                              "flex w-full min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              revealCorrect
                                ? "border-success bg-success-subtle text-success-subtle-foreground font-medium"
                                : revealWrong
                                  ? "border-destructive bg-destructive-subtle text-destructive-subtle-foreground"
                                  : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-secondary/50",
                            )}
                          >
                            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold tabular-nums">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="min-w-0 flex-1">{choice.label}</span>
                            {revealCorrect && (
                              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                            )}
                            {revealWrong && (
                              <XCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Optional Hint Toggle */}
                {activeHotspot.hint && !feedback && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHint((prev) => !prev)}
                      className="min-h-9 gap-1.5 px-2 text-xs text-muted-foreground"
                    >
                      <HelpCircle className="size-3.5" aria-hidden="true" />
                      <span>{showHint ? (vi ? "Ẩn gợi ý" : "Hide hint") : (vi ? "Xem gợi ý" : "Show hint")}</span>
                    </Button>
                    {showHint && (
                      <p className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
                        {activeHotspot.hint}
                      </p>
                    )}
                  </div>
                )}

                {/* Deterministic Feedback Banner */}
                <AnimatePresence mode="wait">
                  {feedback && (
                    <motion.div
                      key={activeHotspot.id}
                      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReduced ? { opacity: 0 } : { opacity: 0 }}
                      transition={{ duration: MOTION_TIMINGS.micro, ease: MOTION_EASE }}
                      role="status"
                      aria-live="polite"
                      className={cn(
                        "rounded-lg border p-3.5 space-y-2",
                        feedback.isCorrect
                          ? "border-success/40 bg-success-subtle text-success-subtle-foreground"
                          : "border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {feedback.isCorrect ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        ) : (
                          <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold">{feedback.message}</p>
                          {feedback.detail && (
                            <p className="text-xs opacity-90 leading-relaxed">{feedback.detail}</p>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        onClick={handleAdvance}
                        className="min-h-11 w-full sm:min-h-9"
                      >
                        {vi ? "Vị trí tiếp theo" : "Next location"}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lightbox for full-res raw diagram inspection */}
      {imageUrl && (
        <ImageLightbox
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
          src={imageUrl}
          alt={diagram.title}
          caption={diagram.description}
        />
      )}
    </div>
  );
}
