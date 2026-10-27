import * as React from "react";
import { cn } from "@/lib/utils";

/** 44px tall on phones, compact on desktop (SPEC §16 touch targets). */
export const TOUCH = "h-11 sm:h-9";

/** A native <select>: fast and accessible on tablets and phones. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-card px-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive sm:text-sm",
        TOUCH,
        className,
      )}
      {...props}
    />
  );
}
