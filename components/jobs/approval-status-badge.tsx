import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Approval request status pill (SPEC §8.5 Approvals). */

const LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  canceled: "Canceled",
};

const VARIANT: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  canceled: "neutral",
};

export function ApprovalStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={VARIANT[status] ?? "neutral"} className={cn("whitespace-nowrap", className)}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
