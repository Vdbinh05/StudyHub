"use client";

import * as React from "react";
import { appendMediaRetryParam } from "@/lib/media/urls";

export interface ResilientImageState {
  resolvedSrc: string;
  hasError: boolean;
  autoRetried: boolean;
  handleLoad: () => void;
  handleError: () => void;
  retry: () => void;
}

/**
 * Signed-URL resilient image hook (FUNC-25 / FUNC-31):
 * - Automatically retries ONCE on `onError` with a cache-busting `&_r=<timestamp>` param
 *   so expired or transiently failed 307 signed-URL redirects recover transparently.
 * - Exposes `hasError` and `retry()` so callers render an accessible fallback UI instead
 *   of a permanent broken-image icon.
 */
export function useResilientImage(src: string): ResilientImageState {
  const [state, setState] = React.useState<{
    baseSrc: string;
    resolvedSrc: string;
    hasError: boolean;
    autoRetried: boolean;
  }>({
    baseSrc: src,
    resolvedSrc: src,
    hasError: false,
    autoRetried: false,
  });

  const effective =
    state.baseSrc === src
      ? state
      : {
          baseSrc: src,
          resolvedSrc: src,
          hasError: false,
          autoRetried: false,
        };

  const handleLoad = React.useCallback(() => {
    setState((prev) => {
      const current =
        prev.baseSrc === src
          ? prev
          : {
              baseSrc: src,
              resolvedSrc: src,
              hasError: false,
              autoRetried: false,
            };
      if (!current.hasError) return current;
      return { ...current, hasError: false };
    });
  }, [src]);

  const handleError = React.useCallback(() => {
    setState((prev) => {
      const current =
        prev.baseSrc === src
          ? prev
          : {
              baseSrc: src,
              resolvedSrc: src,
              hasError: false,
              autoRetried: false,
            };
      if (
        !current.autoRetried &&
        src &&
        !src.startsWith("blob:") &&
        !src.startsWith("data:")
      ) {
        return {
          baseSrc: src,
          resolvedSrc: appendMediaRetryParam(src),
          hasError: false,
          autoRetried: true,
        };
      }
      return {
        ...current,
        hasError: true,
        autoRetried: true,
      };
    });
  }, [src]);

  const retry = React.useCallback(() => {
    if (!src) return;
    setState({
      baseSrc: src,
      resolvedSrc:
        src.startsWith("blob:") || src.startsWith("data:")
          ? src
          : appendMediaRetryParam(src),
      hasError: false,
      autoRetried: true,
    });
  }, [src]);

  return {
    resolvedSrc: effective.resolvedSrc,
    hasError: effective.hasError,
    autoRetried: effective.autoRetried,
    handleLoad,
    handleError,
    retry,
  };
}
