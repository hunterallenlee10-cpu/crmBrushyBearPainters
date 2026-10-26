import * as React from "react";
import { type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { cn } from "@/lib/utils";
import { type ActionError } from "@/lib/actions/errors";

/** Small form pieces for the account and contact screens. */

/** 44px tall on phones, compact on desktop (SPEC §16 touch targets). */
export const TOUCH = "h-11 sm:h-9";

export type PickOption = { value: string; label: string; active?: boolean };

export type AccountFormOptions = {
  users: PickOption[];
  propertyTypes: PickOption[];
  sidingTypes: PickOption[];
};

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

/** Checkbox with its label (and optional hint) as one 44px tap target. */
export function CheckboxRow({
  id,
  label,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "id"> & {
  id: string;
  label: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-[var(--bb-forest)] sm:size-4"
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      <div className="flex min-w-0 flex-col">
        <label htmlFor={id} className="text-sm leading-5 font-medium">
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

/** Copies server-side field errors onto the form. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: ActionError,
): void {
  for (const [key, messages] of Object.entries(error.fieldErrors ?? {})) {
    if (messages[0]) setError(key as Path<T>, { message: messages[0] });
  }
}

/** Active options, plus the current value if it has since been turned off. */
export function visibleOptions(options: readonly PickOption[], current?: string | null) {
  return options.filter((o) => o.active !== false || o.value === current);
}
