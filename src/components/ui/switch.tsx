"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group peer -my-2 inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 sm:my-0 sm:h-5 sm:w-9 sm:min-h-0 sm:min-w-0",
        className,
      )}
      {...props}
    >
      <span className="inline-flex h-5 w-9 items-center rounded-full border-2 border-transparent transition-colors group-data-[state=checked]:bg-primary group-data-[state=unchecked]:bg-input">
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="bg-card pointer-events-none block size-4 rounded-full shadow-xs ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
        />
      </span>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
