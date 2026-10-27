import { Check } from "lucide-react";
import { formatJobDate } from "./format";
import { cn } from "@/lib/utils";

export type StepperStep = {
  id: string;
  label: string;
  state: "done" | "current" | "upcoming";
  date: string | null;
};

/**
 * The six-step Milestones stepper (SPEC §6.3): Lead → Estimate → Sold →
 * In Progress → Completed → Closed, each with its date; the current step is
 * highlighted. Wraps to a vertical list on phones.
 */
export function MilestonesStepper({ steps }: { steps: StepperStep[] }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Milestones">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={s.state === "current" ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2",
            s.state === "current" && "border-bb-forest bg-bb-forest/5 ring-1 ring-bb-forest",
            s.state === "done" && "bg-muted/60",
          )}
        >
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums",
              s.state === "done" && "border-bb-forest bg-bb-forest text-white",
              s.state === "current" && "border-bb-forest bg-white text-bb-forest",
              s.state === "upcoming" && "border-border bg-white text-muted-foreground",
            )}
            aria-hidden
          >
            {s.state === "done" ? <Check className="size-4" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                "block text-sm",
                s.state === "current" ? "font-semibold text-bb-forest" : "font-medium",
              )}
            >
              {s.label}
              <span className="sr-only">
                {s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : ""}
              </span>
            </span>
            <span className="block text-xs text-muted-foreground tabular-nums">
              {formatJobDate(s.date)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
