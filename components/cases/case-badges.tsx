import { Badge } from "@/components/ui/badge";
import {
  CASE_STATUS_LABELS,
  CASE_TYPE_LABELS,
  isOpenCase,
  type CaseStatus,
  type CaseType,
} from "@/lib/domain/cases";

const STATUS_VARIANT: Record<CaseStatus, "info" | "warning" | "success" | "neutral"> = {
  new: "info",
  in_progress: "info",
  scheduled: "warning",
  waiting_on_customer: "neutral",
  resolved: "success",
  closed: "neutral",
};

export function CaseStatusBadge({ status }: { status: string }) {
  const s = status as CaseStatus;
  return <Badge variant={STATUS_VARIANT[s] ?? "neutral"}>{CASE_STATUS_LABELS[s] ?? status}</Badge>;
}

export function CaseTypeLabel({ type }: { type: string }) {
  return <>{CASE_TYPE_LABELS[type as CaseType] ?? type}</>;
}

export function CasePriorityBadge({ priority }: { priority: string }) {
  if (priority === "urgent") return <Badge variant="danger">Urgent</Badge>;
  if (priority === "high") return <Badge variant="warning">High</Badge>;
  return null;
}

export function CaseSlaBadge({
  status,
  slaDueAt,
  now,
}: {
  status: string;
  slaDueAt: string;
  now: Date;
}) {
  if (!isOpenCase(status)) return null;
  return new Date(slaDueAt).getTime() <= now.getTime() ? (
    <Badge variant="danger">Past SLA</Badge>
  ) : null;
}
