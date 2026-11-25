"use client";

import * as React from "react";
import { ZoomableImage as MediaZoomableImage } from "@/components/media/ImageLightbox";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
import { resolveSafeMediaUrl } from "@/lib/media/urls";
import type { RichTextDoc } from "@/types/domain";
import { cn } from "@/lib/utils";

export interface SafeRichTextProps {
  rich?: RichTextDoc | null;
  fallbackText?: string | null;
  inline?: boolean;
  className?: string;
}

/**
 * Canonical XSS-safe Rich Text + KaTeX renderer adapter delegating to leaf `RichContentRenderer`.
 */
export function SafeRichText({
  rich,
  fallbackText,
  inline = false,
  className,
}: SafeRichTextProps) {
  return (
    <RichContentRenderer
      richDoc={rich ?? null}
      plainText={fallbackText ?? ""}
      inline={inline}
      enableMathInPlainText
      className={className}
    />
  );
}

export interface ZoomableImageProps {
  src: string | null | undefined;
  alt?: string;
  caption?: string | null;
  className?: string;
  lazy?: boolean;
}

/**
 * Accessible zoomable image with resilient signed-URL retry + lightbox modal
 * (delegates to canonical `ZoomableImage` in `@/components/media/ImageLightbox`).
 */
export function ZoomableImage({
  src,
  alt = "",
  caption,
  className,
}: ZoomableImageProps) {
  const safeUrl = resolveSafeMediaUrl({ url: src });
  if (!safeUrl) return null;

  return (
    <MediaZoomableImage
      src={safeUrl}
      alt={alt}
      caption={caption}
      aspectClassName="max-h-64"
      imgClassName={cn("w-auto rounded-lg object-contain", className)}
    />
  );
}
