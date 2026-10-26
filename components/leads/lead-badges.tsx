import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  LEAD_STATUS_LABELS,
  TEMPERATURE_LABELS,
  type Grade,
  type LeadStatus,
  type Temperature,
} from "@/lib/domain/leads/constants";

/** Lead status, grade and temperature badges used across lead screens. */

const STATUS_VARIANT: Record<LeadStatus, "info" | "success" | "warning" | "danger" | "neutral"> = {
  new: "info",
  contacted: "warning",
  walkthrough_scheduled: "success",
  nurture: "neutral",
  unqualified: "neutral",
  converted: "success",
  lost: "danger",
};

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn("whitespace-nowrap", className)}>
      {LEAD_STATUS_LABELS[status]}
    </Badge>
  );
}

const GRADE_CLASS: Record<Grade, string> = {
  A: "bg-success text-white border-success",
  B: "bg-info text-white border-info",
  C: "bg-warning-bg text-warning border-warning/30",
  D: "bg-neutral-bg text-neutral border-neutral/30",
  F: "bg-danger-bg text-danger border-danger/30",
};

/** "B · 72" grade badge (SPEC §6.6). */
export function GradeBadge({
  grade,
  score,
  className,
}: {
  grade: Grade | null;
  score: number | null;
  className?: string;
}) {
  if (!grade || score === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        GRADE_CLASS[grade],
        className,
      )}
      aria-label={`Grade ${grade}, score ${score} out of 100`}
    >
      {grade}
      <span aria-hidden className="font-normal">
        · {score}
      </span>
    </span>
  );
}

export function HotIcon({ temperature }: { temperature: Temperature | null }) {
  if (temperature !== "hot") return null;
  return (
    <Flame className="size-4 shrink-0 text-danger" aria-label={`${TEMPERATURE_LABELS.hot} lead`} />
  );
}

export function TemperatureLabel({ temperature }: { temperature: Temperature | null }) {
  if (!temperature) return null;
  return <span>{TEMPERATURE_LABELS[temperature]} Lead</span>;
}
