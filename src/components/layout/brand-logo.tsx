import * as React from "react";
import { BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  collapsed?: boolean;
  className?: string;
}

export function BrandLogo({ collapsed = false, className }: BrandLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg shadow-xs"
        aria-hidden="true"
      >
        <BookOpenCheck className="size-4" aria-hidden="true" />
      </span>
      {!collapsed && (
        <span className="text-foreground text-base font-bold tracking-tight">
          StudyHub
        </span>
      )}
    </span>
  );
}
