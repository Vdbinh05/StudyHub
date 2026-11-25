"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster({ offset, mobileOffset, ...props }: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={offset ?? { bottom: 24, right: 20 }}
      mobileOffset={mobileOffset ?? { top: 12, left: 12, right: 12 }}
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-card text-card-foreground border border-border shadow-md rounded-lg",
          description: "text-muted-foreground text-xs",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
