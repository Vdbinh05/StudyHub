"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "motion/react";

/**
 * StudyHub Motion Design Constants
 * Strictly GPU-composited properties (transform, opacity) and restrained academic timing budgets.
 */
export const MOTION_EASE = [0.2, 0, 0, 1] as const;

export const MOTION_TIMINGS = {
  micro: 0.16,
  panel: 0.22,
  flip: 0.32,
} as const;

interface FadeInProps extends HTMLMotionProps<"div"> {
  delay?: number;
  yOffset?: number;
}

export function FadeIn({
  children,
  delay = 0,
  yOffset = 8,
  className,
  ...props
}: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: yOffset }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION_TIMINGS.panel, delay, ease: MOTION_EASE }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface ScaleInProps extends HTMLMotionProps<"div"> {
  delay?: number;
}

export function ScaleIn({
  children,
  delay = 0,
  className,
  ...props
}: ScaleInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: MOTION_TIMINGS.micro, delay, ease: MOTION_EASE }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface StaggerListProps extends HTMLMotionProps<"div"> {
  staggerDelay?: number;
}

export function StaggerList({
  children,
  staggerDelay = 0.035,
  className,
  ...props
}: StaggerListProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  ...props
}: HTMLMotionProps<"div">) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: MOTION_TIMINGS.micro, ease: MOTION_EASE },
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
