"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/forms/use-run-action";
import { retryWorkflowRun } from "@/app/(app)/admin/workflows/actions";

export function RetryRunButton({ runId, disabled }: { runId: string; disabled: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      variant="outline"
      disabled={disabled || pending}
      onClick={() =>
        run(() => retryWorkflowRun({ runId }), {
          success: "Queued: the worker retries it from the failed step within a minute.",
          onOk: () => router.refresh(),
        })
      }
    >
      <RotateCcw className="size-4" aria-hidden /> Retry from the failed step
    </Button>
  );
}
