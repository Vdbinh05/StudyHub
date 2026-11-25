"use client";

import * as React from "react";
import { ImageOff, RotateCcw, ZoomIn } from "lucide-react";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ImageLightbox, type LightboxImageItem } from "@/components/media/ImageLightbox";
import { useResilientImage } from "@/components/media/use-resilient-image";
import { Button } from "@/components/ui/button";
import { useOptionalI18n } from "@/lib/i18n";
import {
  assetToDisplayItem,
  relationToDisplayItem,
  resolveSafeMediaUrl,
  type MediaDisplayItem,
} from "@/lib/media/urls";
import { cn } from "@/lib/utils";
import type { ContentMediaRelation, MediaAsset } from "@/types/v3";

export interface MediaGalleryProps {
  /** Direct display items, V3 `ContentMediaRelation[]`, or `MediaAsset[]`. */
  items?: readonly MediaDisplayItem[];
  relations?: readonly ContentMediaRelation[];
  assets?: readonly MediaAsset[];
  /** Legacy fallback URL (e.g. `question.prompt_image_url` or `option.image_url`). */
  fallbackImageUrl?: string | null;
  fallbackAlt?: string;
  /** Compact layout for answer options (including image-only options). */
  variant?: "default" | "compact" | "option";
  transcript?: string | null;
  maxAudioReplays?: number | null;
  className?: string;
}

function GalleryImageFigure({
  img,
  index,
  variant,
  isCompact,
  vi,
  onOpen,
}: {
  img: MediaDisplayItem;
  index: number;
  variant: "default" | "compact" | "option";
  isCompact: boolean;
  vi: boolean;
  onOpen: (index: number) => void;
}) {
  const { resolvedSrc, hasError, handleLoad, handleError, retry } =
    useResilientImage(img.url);

  const hasExplicitDims =
    typeof img.width === "number" &&
    img.width > 0 &&
    typeof img.height === "number" &&
    img.height > 0;

  return (
    <figure className="min-w-0 space-y-1.5">
      {hasError ? (
        <div
          role="status"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center",
            variant === "option"
              ? "min-h-28"
              : variant === "compact"
                ? "min-h-32"
                : "min-h-40",
          )}
        >
          <ImageOff className="size-5 text-destructive/80" aria-hidden="true" />
          <p className="text-xs font-medium text-foreground">
            {vi ? "Không thể tải hình ảnh" : "Unable to load image"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={(event) => {
              if (variant === "option") {
                event.stopPropagation();
              }
              retry();
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
            // Prevent clicking zoom button inside an answer option card from toggling selection unintentionally
            if (variant === "option") {
              event.stopPropagation();
            }
            onOpen(index);
          }}
          aria-label={
            vi
              ? `Phóng to ảnh ${index + 1}${img.alt_text ? `: ${img.alt_text}` : ""}`
              : `Enlarge image ${index + 1}${img.alt_text ? `: ${img.alt_text}` : ""}`
          }
          className={cn(
            "group relative flex w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            variant === "option"
              ? "max-h-44 min-h-28 p-1.5"
              : variant === "compact"
                ? "max-h-56 min-h-32 p-2"
                : "max-h-80 min-h-40 p-2",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolvedSrc}
            alt={img.alt_text ?? ""}
            width={hasExplicitDims ? img.width! : undefined}
            height={hasExplicitDims ? img.height! : undefined}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={handleError}
            className={cn(
              "max-w-full object-contain",
              variant === "option"
                ? "max-h-40"
                : variant === "compact"
                  ? "max-h-52"
                  : "max-h-72",
            )}
          />
          <span
            aria-hidden="true"
            className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm opacity-90 transition-opacity group-hover:opacity-100"
          >
            <ZoomIn className="size-3.5" />
            {!isCompact && <span>{vi ? "Phóng to" : "Zoom"}</span>}
          </span>
        </button>
      )}
      {img.caption && (
        <figcaption className="text-xs leading-snug text-muted-foreground">
          {img.caption}
        </figcaption>
      )}
    </figure>
  );
}

export function MediaGallery({
  items,
  relations,
  assets,
  fallbackImageUrl,
  fallbackAlt = "",
  variant = "default",
  transcript,
  maxAudioReplays,
  className,
}: MediaGalleryProps) {
  const i18n = useOptionalI18n();
  const vi = (i18n?.locale ?? "vi") === "vi";

  const normalizedItems = React.useMemo<MediaDisplayItem[]>(() => {
    const collected: MediaDisplayItem[] = [];
    const seenUrls = new Set<string>();

    const pushSafe = (item: MediaDisplayItem | null) => {
      if (!item) return;
      const safeUrl = resolveSafeMediaUrl({
        url: item.url,
        storage_path: item.storage_path,
      });
      if (!safeUrl || seenUrls.has(safeUrl)) return;
      seenUrls.add(safeUrl);
      collected.push({ ...item, url: safeUrl });
    };

    if (items && items.length > 0) {
      for (const item of items) pushSafe(item);
    }
    if (relations && relations.length > 0) {
      const sorted = [...relations].sort((a, b) => a.sort_order - b.sort_order);
      for (const rel of sorted) pushSafe(relationToDisplayItem(rel));
    }
    if (assets && assets.length > 0) {
      for (const asset of assets) pushSafe(assetToDisplayItem(asset));
    }

    if (collected.length === 0 && fallbackImageUrl) {
      const safeFallback = resolveSafeMediaUrl({ url: fallbackImageUrl });
      if (safeFallback) {
        collected.push({
          id: "legacy-image",
          kind: "image",
          url: safeFallback,
          alt_text: fallbackAlt,
        });
      }
    }

    return collected;
  }, [items, relations, assets, fallbackImageUrl, fallbackAlt]);

  const imageItems = React.useMemo(
    () => normalizedItems.filter((item) => item.kind === "image"),
    [normalizedItems],
  );
  const audioItems = React.useMemo(
    () => normalizedItems.filter((item) => item.kind === "audio"),
    [normalizedItems],
  );

  const lightboxImages = React.useMemo<LightboxImageItem[]>(
    () =>
      imageItems.map((img) => ({
        id: img.id,
        src: img.url,
        alt: img.alt_text ?? "",
        caption: img.caption ?? null,
        width: img.width,
        height: img.height,
      })),
    [imageItems],
  );

  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState(0);

  if (imageItems.length === 0 && audioItems.length === 0) {
    return null;
  }

  const openImageAt = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const isCompact = variant === "compact" || variant === "option";

  return (
    <div className={cn("space-y-3", className)}>
      {imageItems.length > 0 && (
        <div
          className={cn(
            "grid gap-3",
            imageItems.length === 1
              ? "grid-cols-1"
              : isCompact
                ? "grid-cols-2"
                : "grid-cols-1 sm:grid-cols-2",
          )}
        >
          {imageItems.map((img, index) => (
            <GalleryImageFigure
              key={img.id}
              img={img}
              index={index}
              variant={variant}
              isCompact={isCompact}
              vi={vi}
              onOpen={openImageAt}
            />
          ))}
        </div>
      )}

      {audioItems.length > 0 && (
        <div className="space-y-2">
          {audioItems.map((aud) => (
            <AudioPlayer
              key={aud.id}
              src={aud.url}
              title={aud.caption || aud.file_name || undefined}
              mimeType={aud.mime_type}
              transcript={transcript}
              maxReplays={maxAudioReplays}
              compact={isCompact}
              lazy
            />
          ))}
        </div>
      )}

      <ImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        images={lightboxImages}
        initialIndex={lightboxIndex}
      />
    </div>
  );
}
