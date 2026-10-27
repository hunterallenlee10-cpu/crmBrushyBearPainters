"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/forms/use-run-action";
import { startJob } from "@/app/(app)/schedule/actions";

/** "Start job": records the actual start; Scheduled → In Progress when its gate passes. */
export function StartJobButton({
  jobId,
  className,
  disabledReason,
}: {
  jobId: string;
  className?: string;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      type="button"
      className={className}
      disabled={pending || !!disabledReason}
      title={disabledReason ?? undefined}
      onClick={() =>
        run(() => startJob({ jobId }), {
          success: "Job started.",
          onOk: () => router.refresh(),
        })
      }
    >
      <Play aria-hidden /> {pending ? "Starting…" : "Start job"}
    </Button>
  );
}
