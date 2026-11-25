import * as React from "react";
import { cn } from "@/lib/utils";

export type BrandLogoVariant = "horizontal" | "icon" | "main" | "full";
export type BrandLogoSize = "sm" | "md" | "lg";

interface BrandLogoProps {
  /** Layout variant: compact horizontal lockup (headers/sidebar), icon-only, main vertical (no slogan), or full (with slogan). */
  variant?: BrandLogoVariant;
  /** Compact icon-only state for the collapsed desktop sidebar. */
  collapsed?: boolean;
  /** Visual size preset. */
  size?: BrandLogoSize;
  /**
   * Image priority hint (Modern Web Guidance `optimize-image-priority`):
   * - `"high"` for above-the-fold LCP hero logo (`fetchPriority="high"`, eager decode)
   * - `"lazy"` for below-the-fold footer/secondary logos (`loading="lazy"` only)
   * - omitted for normal top-bar header priority
   */
  priority?: "high" | "lazy";
  className?: string;
}

const ICON_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  sm: "size-7",
  md: "size-8",
  lg: "size-11",
};

const WORDMARK_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  sm: "text-[15px]",
  md: "text-base",
  lg: "text-xl",
};

const STACKED_SIZE_CLASSES: Record<BrandLogoSize, string> = {
  sm: "h-16 w-auto",
  md: "h-24 sm:h-28 w-auto",
  lg: "h-32 sm:h-40 w-auto",
};

export function BrandLogo({
  variant = "horizontal",
  collapsed = false,
  size = "md",
  priority,
  className,
}: BrandLogoProps) {
  const effectiveVariant: BrandLogoVariant = collapsed ? "icon" : variant;
  const imgPriorityProps: Pick<
    React.ImgHTMLAttributes<HTMLImageElement>,
    "fetchPriority" | "loading" | "decoding"
  > =
    priority === "high"
      ? { fetchPriority: "high", decoding: "sync" }
      : priority === "lazy"
        ? { loading: "lazy", decoding: "async" }
        : { decoding: "async" };

  if (effectiveVariant === "full") {
    return (
      <span className={cn("inline-flex items-center justify-center select-none", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-full.png"
          alt="StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt"
          width={609}
          height={454}
          className={cn(
            "object-contain dark:hidden",
            STACKED_SIZE_CLASSES[size],
          )}
          {...imgPriorityProps}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-full-dark.png"
          alt="StudyHub — Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt"
          width={609}
          height={454}
          className={cn(
            "hidden object-contain dark:block",
            STACKED_SIZE_CLASSES[size],
          )}
          {...imgPriorityProps}
        />
      </span>
    );
  }

  if (effectiveVariant === "main") {
    return (
      <span className={cn("inline-flex items-center justify-center select-none", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-main.png"
          alt="StudyHub"
          width={555}
          height={415}
          className={cn(
            "object-contain dark:hidden",
            STACKED_SIZE_CLASSES[size],
          )}
          {...imgPriorityProps}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-main-dark.png"
          alt="StudyHub"
          width={555}
          height={415}
          className={cn(
            "hidden object-contain dark:block",
            STACKED_SIZE_CLASSES[size],
          )}
          {...imgPriorityProps}
        />
      </span>
    );
  }

  if (effectiveVariant === "icon") {
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center select-none", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo-icon.png"
          alt=""
          aria-hidden="true"
          width={256}
          height={256}
          className={cn("shrink-0 object-contain", ICON_SIZE_CLASSES[size])}
          {...imgPriorityProps}
        />
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-2 select-none", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo-icon.png"
        alt=""
        aria-hidden="true"
        width={256}
        height={256}
        className={cn("shrink-0 object-contain", ICON_SIZE_CLASSES[size])}
        {...imgPriorityProps}
      />
      <span
        className={cn(
          "font-extrabold leading-none tracking-tight",
          WORDMARK_SIZE_CLASSES[size],
        )}
      >
        <span className="text-brand-navy dark:text-foreground">Study</span>
        <span className="text-primary">Hub</span>
      </span>
    </span>
  );
}
