"use client";

import { useRouter } from "next/navigation";
import { Ban, Pause, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/forms/use-run-action";
import { allowedTransitions, type CampaignStatus } from "@/lib/domain/campaigns";
import { setCampaignStatus } from "./actions";

/** Pause, resume, cancel, or take a scheduled campaign back to draft. */
export function CampaignStatusControls({
  id,
  status,
  readOnly,
}: {
  id: string;
  status: CampaignStatus;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const next = allowedTransitions(status);
  const go = (s: "draft" | "paused" | "canceled" | "scheduled", msg: string) =>
    run(() => setCampaignStatus({ id, status: s }), { success: msg, onOk: () => router.refresh() });
  const disabled = pending || readOnly;
  return (
    <div className="flex flex-wrap gap-2">
      {next.includes("draft") && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => go("draft", "Back to draft.")}
        >
          <Pencil className="size-4" aria-hidden /> Back to draft
        </Button>
      )}
      {next.includes("paused") && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => go("paused", "Paused.")}
        >
          <Pause className="size-4" aria-hidden /> Pause
        </Button>
      )}
      {status === "paused" && (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => go("scheduled", "Resumed.")}
        >
          <Play className="size-4" aria-hidden /> Resume
        </Button>
      )}
      {next.includes("canceled") && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => go("canceled", "Canceled.")}
        >
          <Ban className="size-4" aria-hidden /> Cancel campaign
        </Button>
      )}
    </div>
  );
}
