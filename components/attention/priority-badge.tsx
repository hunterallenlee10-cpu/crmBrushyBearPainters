import { Badge } from "@/components/ui/badge";
import { PRIORITY_LABELS, type AttentionPriority } from "@/lib/domain/attention/rules";
import { cn } from "@/lib/utils";

const VARIANT: Record<AttentionPriority, "danger" | "warning" | "info" | "neutral"> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};

/** Attention item priority (Critical red, High amber, Medium blue, Low gray). */
export function AttentionPriorityBadge({
  priority,
  className,
}: {
  priority: AttentionPriority;
  className?: string;
}) {
  return (
    <Badge
      variant={VARIANT[priority]}
      className={cn("whitespace-nowrap", className)}
      data-priority={priority}
    >
      {PRIORITY_LABELS[priority]}
      <span className="sr-only"> priority</span>
    </Badge>
  );
}
