"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * A button that can be unavailable for a stated reason. Instead of the native
 * `disabled` (which hides it from keyboards and screen readers), it stays
 * focusable with aria-disabled, shows the reason in a tooltip and repeats it
 * in a toast when pressed.
 */
export function ReasonButton({
  disabledReason,
  onClick,
  children,
  className,
  ...props
}: ButtonProps & { disabledReason?: string | null }) {
  if (!disabledReason) {
    return (
      <Button onClick={onClick} className={className} {...props}>
        {children}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...props}
          aria-disabled="true"
          className={`cursor-not-allowed opacity-50 ${className ?? ""}`}
          onClick={(e) => {
            e.preventDefault();
            toast.info(disabledReason);
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
