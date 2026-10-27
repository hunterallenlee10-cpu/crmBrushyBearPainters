import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import type { MetricDelta } from "@/lib/metrics/registry";
import { cn } from "@/lib/utils";

/** "▲ +3 vs last month" beside a KPI number. The numbers come from the registry. */
export function DeltaBadge({ delta, prior }: { delta: MetricDelta | null; prior: string }) {
  if (!delta) return null;
  const Icon =
    delta.direction === "up"
      ? ArrowUpRight
      : delta.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const words =
    delta.direction === "flat"
      ? `No change from ${prior} (${delta.previousDisplay})`
      : `${delta.direction === "up" ? "Up" : "Down"} ${delta.display.slice(1)} from ${prior} (${delta.previousDisplay})`;
  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 align-middle text-xs font-semibold",
        delta.direction === "up" && "bg-success-bg text-success",
        delta.direction === "down" && "bg-warning-bg text-warning",
        delta.direction === "flat" && "bg-neutral-bg text-neutral",
      )}
      title={words}
    >
      <Icon className="size-3" aria-hidden />
      <span aria-hidden>
        {delta.display}
        {delta.direction !== "flat" && ` vs ${prior}`}
      </span>
      <span className="sr-only">{words}</span>
    </span>
  );
}
