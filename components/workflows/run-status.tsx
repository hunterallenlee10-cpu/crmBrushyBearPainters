import { Badge } from "@/components/ui/badge";

const TONES: Record<string, "success" | "info" | "warning" | "danger" | "neutral"> = {
  completed: "success",
  running: "info",
  waiting: "info",
  skipped: "neutral",
  canceled: "neutral",
  failed: "danger",
  dry_run: "warning",
};

const LABELS: Record<string, string> = {
  completed: "Completed",
  running: "Running",
  waiting: "Waiting",
  skipped: "Skipped (off)",
  canceled: "Stopped",
  failed: "Failed",
  dry_run: "Test run",
};

export function RunStatusBadge({ status }: { status: string }) {
  return <Badge variant={TONES[status] ?? "neutral"}>{LABELS[status] ?? status}</Badge>;
}

const STEP_TONES: Record<string, "success" | "info" | "warning" | "danger" | "neutral"> = {
  done: "success",
  would_run: "success",
  waiting: "info",
  would_wait: "info",
  deferred: "info",
  skipped: "neutral",
  blocked: "warning",
  failed: "danger",
};

const STEP_LABELS: Record<string, string> = {
  done: "Done",
  would_run: "Would run",
  waiting: "Waiting",
  would_wait: "Would wait",
  deferred: "Quiet hours",
  skipped: "Skipped",
  blocked: "Not sent",
  failed: "Failed",
};

export function StepOutcomeBadge({ outcome }: { outcome: string }) {
  return (
    <Badge variant={STEP_TONES[outcome] ?? "neutral"}>{STEP_LABELS[outcome] ?? outcome}</Badge>
  );
}
