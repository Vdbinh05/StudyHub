"use client";

import * as React from "react";
import { ZoomIn } from "lucide-react";
import { ImageLightbox } from "@/components/media/ImageLightbox";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
import { isSafeDisplayImageUrl } from "@/lib/learning/api-client";
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
 * Accessible zoomable image with built-in safe-URL guard and lightbox modal.
 */
export function ZoomableImage({
  src,
  alt = "",
  caption,
  className,
  lazy = false,
}: ZoomableImageProps) {
  const [open, setOpen] = React.useState(false);

  if (!isSafeDisplayImageUrl(src)) return null;

  return (
    <>
      <figure className="inline-block max-w-full">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={alt ? `${alt} (phóng to)` : "Phóng to hình ảnh"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            loading={lazy ? "lazy" : undefined}
            className={cn(
              "max-h-64 w-auto rounded-lg object-contain transition-transform duration-200 group-hover:scale-[1.01]",
              className,
            )}
          />
          <span className="pointer-events-none absolute right-2 bottom-2 inline-flex size-7 items-center justify-center rounded-md bg-background/85 text-foreground shadow-xs backdrop-blur-xs">
            <ZoomIn className="size-3.5" aria-hidden="true" />
          </span>
        </button>
        {caption ? (
          <figcaption className="mt-1 text-xs text-muted-foreground">
            {caption}
          </figcaption>
        ) : null}
      </figure>

      <ImageLightbox
        open={open}
        onOpenChange={setOpen}
        src={src}
        alt={alt}
        caption={caption}
      />
    </>
  );
}
