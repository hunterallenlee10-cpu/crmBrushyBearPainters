"use client";

import * as React from "react";
import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Completion } from "./completion";
import type { WizardStep } from "./helpers";
import type { DuplicateNotice } from "./actions";

/** Presentational pieces of the New Lead wizard. */

/** 44px on phones, compact on desktop (SPEC §16 touch targets). */
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

export const STEP_TITLES: Record<WizardStep, { short: string; heading: string }> = {
  1: { short: "Info", heading: "Who is it?" },
  2: { short: "Property", heading: "The property" },
  3: { short: "Qualify", heading: "What they need" },
};

export function StepIndicator({
  step,
  onGoTo,
}: {
  step: WizardStep;
  onGoTo: (step: WizardStep) => void;
}) {
  return (
    <nav aria-label="New lead steps">
      <ol className="flex items-center gap-2">
        {([1, 2, 3] as const).map((n, i) => {
          const done = n < step;
          const current = n === step;
          const content = (
            <>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  current && "border-bb-forest bg-bb-forest text-white",
                  done && "border-bb-forest bg-bb-cream text-bb-forest",
                  !current && !done && "border-border bg-card text-muted-foreground",
                )}
                aria-hidden
              >
                {done ? <Check className="size-3.5" /> : n}
              </span>
              <span className={cn("text-sm", current ? "font-semibold" : "text-muted-foreground")}>
                <span className="sr-only">Step {n}: </span>
                {STEP_TITLES[n].short}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </>
          );
          return (
            <li key={n} className="flex min-w-0 items-center gap-2">
              {done ? (
                <button
                  type="button"
                  onClick={() => onGoTo(n)}
                  className="flex min-h-11 items-center gap-2 rounded-md px-1 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-9"
                >
                  {content}
                </button>
              ) : (
                <span
                  className="flex min-h-11 items-center gap-2 px-1 sm:min-h-9"
                  aria-current={current ? "step" : undefined}
                >
                  {content}
                </span>
              )}
              {i < 2 && <span className="h-px w-4 bg-border sm:w-10" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function CompletionMeter({ completion }: { completion: Completion }) {
  const next = completion.missing.slice(0, 3).join(", ");
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id="completion-label" className="font-medium">
          Completion
        </span>
        <span className="font-semibold tabular-nums" data-testid="completion-percent">
          {completion.percent}%
        </span>
      </div>
      <div
        role="meter"
        aria-labelledby="completion-label"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={completion.percent}
        aria-valuetext={`${completion.percent}% complete`}
        className="h-2 w-full overflow-hidden rounded-full bg-bb-cream"
      >
        <div
          className="h-full rounded-full bg-bb-forest transition-[width]"
          style={{ width: `${completion.percent}%` }}
        />
      </div>
      {next && (
        <p className="text-xs text-muted-foreground">
          Still useful: {next}
          {completion.missing.length > 3 ? "…" : ""}
        </p>
      )}
    </div>
  );
}

export function DuplicateBanner({ hits }: { hits: DuplicateNotice[] }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {hits.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning-bg p-3 text-sm"
          data-testid="duplicate-banner"
        >
          {hits.slice(0, 3).map((h) => (
            <div key={h.key} className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1 break-words">
                <span className="font-semibold">Possible duplicate:</span> {h.name} · {h.status} ·{" "}
                {h.ownerName ? `owned by ${h.ownerName}` : "no owner yet"} ({h.reason})
                {!h.canOpen && (
                  <span className="block text-muted-foreground">
                    It&apos;s owned by someone else, so you can&apos;t open it.{" "}
                    {h.ownerName
                      ? `Ask ${h.ownerName} before adding a new lead.`
                      : "Ask an office manager before adding a new lead."}
                  </span>
                )}
              </p>
              {h.canOpen && h.id && (
                <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
                  <Link href={`/leads/${h.id}`}>Open existing</Link>
                </Button>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            You can still save this lead if it&apos;s someone new.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A button that looks disabled but stays focusable so its tooltip explains
 * why (a truly disabled button can't show a tooltip to keyboard users).
 */
export function UnavailableButton({
  children,
  reason,
  className,
}: {
  children: React.ReactNode;
  reason: string;
  className?: string;
}) {
  const id = React.useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-disabled="true"
          aria-describedby={id}
          onClick={(e) => e.preventDefault()}
          className={cn("cursor-not-allowed opacity-50", TOUCH, className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </Tooltip>
  );
}

/** Segmented radio choices (stories, HOA, home built). Native radios: arrow keys work. */
export function ChoiceGroup<V extends string>({
  name,
  legend,
  choices,
  value,
  onChange,
  description,
}: {
  name: string;
  legend: string;
  choices: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (value: V) => void;
  description?: React.ReactNode;
}) {
  const descId = `${name}-description`;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1.5"
      aria-describedby={description ? descId : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <label
            key={c.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center rounded-md border bg-card px-3 text-sm sm:min-h-9",
              "has-[:checked]:border-bb-forest has-[:checked]:bg-bb-forest has-[:checked]:text-white",
              "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={value === c.value}
              onChange={() => onChange(c.value)}
              className="sr-only"
            />
            {c.label}
          </label>
        ))}
      </div>
      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </fieldset>
  );
}
