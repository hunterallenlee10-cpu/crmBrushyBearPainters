import { AlertTriangle, CirclePause, HeartPulse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { healthLabel } from "@/lib/domain/jobs/health";
import {
  JOB_PRIORITY_LABELS,
  JOB_STATUS_LABELS,
  type JobPriority,
  type JobStatus,
} from "@/lib/domain/jobs/constants";
import { cn } from "@/lib/utils";

/** Job status, hold, priority and health badges used across job screens. */

const STATUS_VARIANT: Record<JobStatus, "info" | "success" | "warning" | "danger" | "neutral"> = {
  open: "info",
  on_hold: "warning",
  won: "success",
  lost: "neutral",
};

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={cn("whitespace-nowrap", className)}>
      {JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

/** "HOA Hold" pill shown beside the stage (holds overlay the stage; SPEC §6.2). */
export function HoldPill({
  label,
  blocks = true,
  className,
}: {
  label: string;
  blocks?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="warning"
      className={cn("gap-1 whitespace-nowrap", className)}
      title={blocks ? "Blocks scheduling" : "Doesn't block scheduling"}
    >
      <CirclePause className="size-3" aria-hidden />
      {label.replace(/\s+hold$/i, "").trim() || label} Hold
    </Badge>
  );
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: JobPriority;
  className?: string;
}) {
  if (priority === "normal") return null;
  return (
    <Badge
      variant={priority === "urgent" ? "danger" : "warning"}
      className={cn("gap-1 whitespace-nowrap", className)}
    >
      <AlertTriangle className="size-3" aria-hidden />
      {JOB_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

/** Health score chip: "Health 82 · Needs attention". */
export function HealthBadge({ score, className }: { score: number | null; className?: string }) {
  if (score == null) return null;
  const variant = score >= 85 ? "success" : score >= 60 ? "warning" : "danger";
  return (
    <Badge
      variant={variant}
      className={cn("gap-1 whitespace-nowrap", className)}
      aria-label={`Job health ${score} out of 100, ${healthLabel(score)}`}
    >
      <HeartPulse className="size-3" aria-hidden />
      {score} · {healthLabel(score)}
    </Badge>
  );
}
