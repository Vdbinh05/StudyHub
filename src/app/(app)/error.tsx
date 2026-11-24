"use client";

import * as React from "react";
import { ErrorBoundaryView } from "@/components/layout/error-view";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryView reset={reset} />;
}
