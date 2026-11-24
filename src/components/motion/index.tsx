import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * StudyHub Motion Design Constants
 * Strictly GPU-composited properties (transform, opacity) and restrained academic timing budgets.
 * Zero Framer Motion runtime cost — animations are pure CSS keyframes respecting both
 * `prefers-reduced-motion: reduce` and `html[data-reduced-motion="true"]`.
 */
export const MOTION_EASE = [0.2, 0, 0, 1] as const;

export const MOTION_TIMINGS = {
  micro: 0.16,
  panel: 0.22,
  flip: 0.32,
} as const;

export interface FadeInProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  delay?: number;
  yOffset?: number;
  /** Keep SSR initial paint visible (opacity: 1) for above-the-fold heroes to protect LCP. */
  aboveFold?: boolean;
}

export function FadeIn({
  children,
  delay = 0,
  yOffset = 8,
  aboveFold = false,
  className,
  style,
  ...props
}: FadeInProps) {
  if (aboveFold) {
    return (
      <div className={className} style={style} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn("sh-fade-in", className)}
      style={
        {
          ...style,
          "--sh-enter-y": `${yOffset}px`,
          animationDelay: delay > 0 ? `${delay}s` : undefined,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </div>
  );
}

export interface ScaleInProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  delay?: number;
}

export function ScaleIn({
  children,
  delay = 0,
  className,
  style,
  ...props
}: ScaleInProps) {
  return (
    <div
      className={cn("sh-scale-in", className)}
      style={{
        ...style,
        animationDelay: delay > 0 ? `${delay}s` : undefined,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export interface StaggerListProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  staggerDelay?: number;
}

export function StaggerList({
  children,
  staggerDelay: _staggerDelay,
  className,
  ...props
}: StaggerListProps) {
  void _staggerDelay;
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

export interface StaggerItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function StaggerItem({
  children,
  className,
  ...props
}: StaggerItemProps) {
  return (
    <div className={cn("sh-fade-in", className)} {...props}>
      {children}
    </div>
  );
}
