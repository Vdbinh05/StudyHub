"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useResilientImage } from "@/components/media/use-resilient-image";
import { Button } from "@/components/ui/button";
import {
  clampViewportTransform,
  zoomAtViewportPoint,
  type ViewportTransform,
} from "@/lib/diagram/geometry";
import { useOptionalI18n } from "@/lib/i18n";
import { isSafeHttpOrStorageUrl } from "@/lib/security/sanitize";
import { cn } from "@/lib/utils";

export interface LightboxImageItem {
  id?: string;
  src: string;
  alt?: string;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src?: string;
  alt?: string;
  caption?: string | null;
  images?: readonly LightboxImageItem[];
  initialIndex?: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.5;

function isRenderableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("blob:")) return true;
  return isSafeHttpOrStorageUrl(trimmed);
}

export function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
  caption,
  images,
  initialIndex = 0,
}: ImageLightboxProps) {
  const i18n = useOptionalI18n();
  const vi = (i18n?.locale ?? "vi") === "vi";

  const items = React.useMemo<LightboxImageItem[]>(() => {
    if (images && images.length > 0) {
      return images.filter((item) => isRenderableImageUrl(item.src));
    }
    if (src && isRenderableImageUrl(src)) {
      return [{ src, alt, caption }];
    }
    return [];
  }, [images, src, alt, caption]);

  const safeInitialIndex = Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1));
  const sessionKey = `${open ? "open" : "closed"}:${safeInitialIndex}:${items.length}:${items[safeInitialIndex]?.src ?? ""}`;

  const [viewState, setViewState] = React.useState<{
    sessionKey: string;
    activeIndex: number;
    transform: ViewportTransform;
  }>({
    sessionKey,
    activeIndex: safeInitialIndex,
    transform: { scale: 1, translateX: 0, translateY: 0 },
  });

  const activeIndex =
    viewState.sessionKey === sessionKey ? viewState.activeIndex : safeInitialIndex;
  const transform =
    viewState.sessionKey === sessionKey
      ? viewState.transform
      : { scale: 1, translateX: 0, translateY: 0 };

  const setTransform = React.useCallback(
    (updater: ViewportTransform | ((prev: ViewportTransform) => ViewportTransform)) => {
      setViewState((prev) => {
        const currentTransform =
          prev.sessionKey === sessionKey
            ? prev.transform
            : { scale: 1, translateX: 0, translateY: 0 };
        const currentIndex =
          prev.sessionKey === sessionKey ? prev.activeIndex : safeInitialIndex;
        const nextTransform =
          typeof updater === "function" ? updater(currentTransform) : updater;
        return {
          sessionKey,
          activeIndex: currentIndex,
          transform: nextTransform,
        };
      });
    },
    [sessionKey, safeInitialIndex],
  );

  const setActiveIndex = React.useCallback(
    (updater: number | ((prev: number) => number)) => {
      setViewState((prev) => {
        const currentIndex =
          prev.sessionKey === sessionKey ? prev.activeIndex : safeInitialIndex;
        const nextIndex = typeof updater === "function" ? updater(currentIndex) : updater;
        return {
          sessionKey,
          activeIndex: nextIndex,
          transform: { scale: 1, translateX: 0, translateY: 0 },
        };
      });
    },
    [sessionKey, safeInitialIndex],
  );

  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);

  const dialogContainerRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const activePointersRef = React.useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = React.useRef<{
    initialDistance: number;
    initialScale: number;
  } | null>(null);
  const dragOriginRef = React.useRef<{
    pointerX: number;
    pointerY: number;
    translateX: number;
    translateY: number;
  } | null>(null);
  const lastTapRef = React.useRef<{ time: number; x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (open) {
      activePointersRef.current.clear();
      pinchStateRef.current = null;
      dragOriginRef.current = null;
    }
  }, [open, safeInitialIndex, items.length]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
    };
  }, []);

  const currentItem = items[activeIndex] ?? items[0] ?? null;
  const stageImage = useResilientImage(currentItem?.src ?? "");

  const getStageBounds = React.useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      containerWidth: rect?.width ?? 800,
      containerHeight: rect?.height ?? 600,
    };
  }, []);

  const resetZoom = React.useCallback(() => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  }, [setTransform]);

  const zoomBy = React.useCallback(
    (delta: number, focalPoint?: { x: number; y: number }) => {
      const bounds = getStageBounds();
      const focal = focalPoint ?? {
        x: bounds.containerWidth / 2,
        y: bounds.containerHeight / 2,
      };
      setTransform((prev) =>
        zoomAtViewportPoint(prev, prev.scale + delta, focal, bounds),
      );
    },
    [getStageBounds, setTransform],
  );

  const toggleFullscreen = React.useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (dialogContainerRef.current?.requestFullscreen) {
        await dialogContainerRef.current.requestFullscreen();
      }
    } catch {
      // Fullscreen API may be disallowed in embedded frames
    }
  }, []);

  const goPrevious = React.useCallback(() => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
  }, [items.length, setActiveIndex]);

  const goNext = React.useCallback(() => {
    if (items.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % items.length);
  }, [items.length, setActiveIndex]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      } else if (event.key === "ArrowLeft" && items.length > 1) {
        event.preventDefault();
        goPrevious();
      } else if (event.key === "ArrowRight" && items.length > 1) {
        event.preventDefault();
        goNext();
      } else if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, zoomBy, resetZoom, goPrevious, goNext, toggleFullscreen, items.length]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const stage = stageRef.current;
    if (!stage) return;

    stage.setPointerCapture?.(event.pointerId);
    const rect = stage.getBoundingClientRect();
    const localPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    activePointersRef.current.set(event.pointerId, localPoint);

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStateRef.current = {
        initialDistance: Math.max(10, dist),
        initialScale: transform.scale,
      };
      dragOriginRef.current = null;
      setIsDragging(false);
      return;
    }

    // Double-tap / double-click zoom toggle
    const now = Date.now();
    const lastTap = lastTapRef.current;
    if (
      lastTap &&
      now - lastTap.time < 300 &&
      Math.hypot(localPoint.x - lastTap.x, localPoint.y - lastTap.y) < 32
    ) {
      lastTapRef.current = null;
      const bounds = getStageBounds();
      setTransform((prev) =>
        prev.scale > 1.1
          ? { scale: 1, translateX: 0, translateY: 0 }
          : zoomAtViewportPoint(prev, 2.25, localPoint, bounds),
      );
      return;
    }
    lastTapRef.current = { time: now, x: localPoint.x, y: localPoint.y };

    if (transform.scale > 1) {
      dragOriginRef.current = {
        pointerX: localPoint.x,
        pointerY: localPoint.y,
        translateX: transform.translateX,
        translateY: transform.translateY,
      };
      setIsDragging(true);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    const localPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    activePointersRef.current.set(event.pointerId, localPoint);

    if (activePointersRef.current.size === 2 && pinchStateRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const midpoint = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      const nextScale =
        pinchStateRef.current.initialScale * (dist / pinchStateRef.current.initialDistance);
      const bounds = getStageBounds();
      setTransform((prev) => zoomAtViewportPoint(prev, nextScale, midpoint, bounds));
      return;
    }

    if (activePointersRef.current.size === 1 && dragOriginRef.current) {
      const dx = localPoint.x - dragOriginRef.current.pointerX;
      const dy = localPoint.y - dragOriginRef.current.pointerY;
      const bounds = getStageBounds();
      setTransform((prev) =>
        clampViewportTransform(
          {
            scale: prev.scale,
            translateX: dragOriginRef.current!.translateX + dx,
            translateY: dragOriginRef.current!.translateY + dy,
          },
          bounds,
        ),
      );
    }
  };

  const releasePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      dragOriginRef.current = null;
      setIsDragging(false);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const delta = event.deltaY < 0 ? 0.35 : -0.35;
    zoomBy(delta, focal);
  };

  if (!currentItem) {
    return null;
  }

  const zoomPercent = Math.round(transform.scale * 100);
  const titleText =
    currentItem.alt?.trim() ||
    (vi ? "Xem ảnh phóng to" : "Image viewer");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="sh-overlay-in fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-[2px]" />

          <DialogPrimitive.Content
            ref={dialogContainerRef}
            aria-describedby={currentItem.caption ? undefined : undefined}
            className="sh-scale-in fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl sm:inset-4 md:inset-6"
          >
                {/* Header & Zoom Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <DialogPrimitive.Title className="truncate text-sm font-semibold text-foreground sm:text-base">
                      {titleText}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="text-xs text-muted-foreground">
                      {items.length > 1
                        ? vi
                          ? `Ảnh ${activeIndex + 1} / ${items.length} · Phím +/- thu phóng, 0 đặt lại, Esc đóng`
                          : `Image ${activeIndex + 1} of ${items.length} · Keys +/- zoom, 0 reset, Esc close`
                        : vi
                          ? "Kéo để di chuyển khi phóng to · Phím +/- thu phóng, 0 đặt lại, Esc đóng"
                          : "Drag to pan when zoomed · Keys +/- zoom, 0 reset, Esc close"}
                    </DialogPrimitive.Description>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => zoomBy(-ZOOM_STEP)}
                      disabled={transform.scale <= MIN_SCALE}
                      aria-label={vi ? "Thu nhỏ (-)" : "Zoom out (-)"}
                      className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    >
                      <ZoomOut className="size-4" aria-hidden="true" />
                    </Button>
                    <span
                      className="min-w-14 text-center text-xs font-medium tabular-nums text-foreground"
                      aria-live="polite"
                    >
                      {zoomPercent}%
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => zoomBy(ZOOM_STEP)}
                      disabled={transform.scale >= MAX_SCALE}
                      aria-label={vi ? "Phóng to (+)" : "Zoom in (+)"}
                      className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    >
                      <ZoomIn className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={resetZoom}
                      disabled={transform.scale === 1 && transform.translateX === 0 && transform.translateY === 0}
                      aria-label={vi ? "Đặt lại thu phóng (0)" : "Reset zoom (0)"}
                      className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void toggleFullscreen()}
                      aria-label={
                        isFullscreen
                          ? vi
                            ? "Thoát toàn màn hình"
                            : "Exit fullscreen"
                          : vi
                            ? "Toàn màn hình (F)"
                            : "Fullscreen (F)"
                      }
                      className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="size-4" aria-hidden="true" />
                      ) : (
                        <Maximize2 className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                    <DialogPrimitive.Close asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={vi ? "Đóng hộp thoại ảnh (Esc)" : "Close image viewer (Esc)"}
                        className="min-h-11 gap-1.5 px-3 sm:min-h-9"
                      >
                        <X className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{vi ? "Đóng" : "Close"}</span>
                      </Button>
                    </DialogPrimitive.Close>
                  </div>
                </div>

                {/* Interactive Pan & Pinch-to-Zoom Stage (Pointer Events + touch-action: none) */}
                <div
                  ref={stageRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={releasePointer}
                  onPointerCancel={releasePointer}
                  onWheel={handleWheel}
                  style={{ touchAction: "none" }}
                  className={cn(
                    "relative flex-1 overflow-hidden bg-muted/40 select-none",
                    transform.scale > 1
                      ? isDragging
                        ? "cursor-grabbing"
                        : "cursor-grab"
                      : "cursor-zoom-in",
                  )}
                >
                  <div
                    style={{
                      transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scale})`,
                      transformOrigin: "0 0",
                    }}
                    className="flex h-full w-full items-center justify-center p-4"
                  >
                    {stageImage.hasError ? (
                      <div
                        role="status"
                        onPointerDown={(e) => e.stopPropagation()}
                        className="flex max-w-sm flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-card/95 px-6 py-6 text-center shadow-sm"
                      >
                        <ImageOff className="size-8 text-destructive/80" aria-hidden="true" />
                        <p className="text-sm font-medium text-foreground">
                          {vi ? "Không thể tải hình ảnh" : "Unable to load image"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {vi
                            ? "Liên kết ảnh có thể đã hết hạn hoặc mất kết nối tạm thời."
                            : "The image link may have expired or encountered a temporary network issue."}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={stageImage.retry}
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" />
                          <span>{vi ? "Thử lại" : "Retry"}</span>
                        </Button>
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={stageImage.resolvedSrc}
                        alt={currentItem.alt ?? ""}
                        draggable={false}
                        onLoad={stageImage.handleLoad}
                        onError={stageImage.handleError}
                        className="max-h-full max-w-full object-contain pointer-events-none"
                      />
                    )}
                  </div>

                  {items.length > 1 && (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={goPrevious}
                        aria-label={vi ? "Ảnh trước" : "Previous image"}
                        className="absolute top-1/2 left-3 min-h-11 min-w-11 -translate-y-1/2 rounded-full shadow-md"
                      >
                        <ChevronLeft className="size-5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        onClick={goNext}
                        aria-label={vi ? "Ảnh tiếp theo" : "Next image"}
                        className="absolute top-1/2 right-3 min-h-11 min-w-11 -translate-y-1/2 rounded-full shadow-md"
                      >
                        <ChevronRight className="size-5" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Optional Caption Footer */}
                {currentItem.caption && (
                  <div className="border-t border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                    {currentItem.caption}
                  </div>
                )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}

export interface ZoomableImageProps {
  src: string | null | undefined;
  alt?: string;
  caption?: string | null;
  className?: string;
  imgClassName?: string;
  aspectClassName?: string;
  lazy?: boolean;
  stopPropagation?: boolean;
}

/**
 * Click/tap-to-enlarge image wrapper with preserved aspect ratio, resilient retry, and accessible trigger.
 */
export function ZoomableImage({
  src,
  alt = "",
  caption,
  className,
  imgClassName,
  aspectClassName = "max-h-72",
  lazy = true,
  stopPropagation = false,
}: ZoomableImageProps) {
  const [open, setOpen] = React.useState(false);
  const i18n = useOptionalI18n();
  const vi = (i18n?.locale ?? "vi") === "vi";
  const safeSrc = typeof src === "string" ? src : "";
  const imageState = useResilientImage(safeSrc);

  if (!isRenderableImageUrl(safeSrc)) {
    return null;
  }

  return (
    <figure className={cn("inline-flex max-w-full flex-col gap-1.5", className)}>
      {imageState.hasError ? (
        <div
          role="status"
          className="inline-flex min-h-28 min-w-44 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-center"
        >
          <ImageOff className="size-5 text-destructive/80" aria-hidden="true" />
          <span className="text-xs font-medium text-foreground">
            {vi ? "Không thể tải hình ảnh" : "Unable to load image"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={(event) => {
              if (stopPropagation) event.stopPropagation();
              imageState.retry();
            }}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            <span>{vi ? "Thử lại" : "Retry"}</span>
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            if (stopPropagation) event.stopPropagation();
            setOpen(true);
          }}
          aria-label={
            vi
              ? `Phóng to ảnh${alt ? `: ${alt}` : ""}`
              : `Enlarge image${alt ? `: ${alt}` : ""}`
          }
          className="group relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageState.resolvedSrc}
            alt={alt}
            loading={lazy ? "lazy" : undefined}
            decoding="async"
            onLoad={imageState.handleLoad}
            onError={imageState.handleError}
            className={cn("max-w-full object-contain", aspectClassName, imgClassName)}
          />
          <span
            aria-hidden="true"
            className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm border border-border opacity-90 transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="size-3.5" />
            <span className="hidden sm:inline">{vi ? "Phóng to" : "Zoom"}</span>
          </span>
        </button>
      )}
      {caption && (
        <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
      )}
      {open ? (
        <ImageLightbox
          open={open}
          onOpenChange={setOpen}
          src={safeSrc}
          alt={alt}
          caption={caption}
        />
      ) : null}
    </figure>
  );
}
