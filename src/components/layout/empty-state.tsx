import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border bg-card flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div className="border-brand-soft-blue/50 bg-primary-subtle text-primary mb-4 flex size-12 items-center justify-center rounded-xl border">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h2 className="text-foreground text-base font-semibold tracking-tight">
        {title}
      </h2>
      <p className="text-muted-foreground mt-1.5 max-w-md text-sm leading-relaxed">
        {description}
      </p>
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
