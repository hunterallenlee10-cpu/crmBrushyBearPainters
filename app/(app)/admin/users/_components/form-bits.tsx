import * as React from "react";
import { type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { cn } from "@/lib/utils";
import { type ActionError } from "@/lib/actions/errors";

/**
 * Small shared pieces for the Users and Settings screens. Native <select>s keep
 * long grouped lists (permissions) accessible and fast on phones.
 */

/** 44px tall on phones, compact on desktop (SPEC §16 touch targets). */
export const TOUCH = "h-11 sm:h-9";

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

/** Copies server-side field errors onto the form. */
export function applyFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: ActionError,
): void {
  for (const [key, messages] of Object.entries(error.fieldErrors ?? {})) {
    if (messages[0]) setError(key as Path<T>, { message: messages[0] });
  }
}

/** Card section in the Company Settings look. */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  headingId,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section
      className={cn("rounded-2xl border bg-card p-5", className)}
      aria-labelledby={headingId}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
