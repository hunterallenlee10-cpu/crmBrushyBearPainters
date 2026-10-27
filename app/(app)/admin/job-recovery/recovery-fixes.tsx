"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/forms/use-run-action";
import type { RecoveryFix } from "@/lib/domain/jobs/recovery";
import { recoverMilestone, recoverStage } from "./actions";

const TZ = "America/Los_Angeles";

export function RecoveryFixes({
  jobId,
  fixes,
  readOnly,
}: {
  jobId: string;
  fixes: RecoveryFix[];
  readOnly: boolean;
}) {
  const [open, setOpen] = React.useState<RecoveryFix | null>(null);
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {fixes.map((f, i) =>
        f.kind === "open_job" ? (
          <Button key={i} size="sm" variant="ghost" asChild>
            <Link href={`/jobs/${jobId}${f.section === "overview" ? "" : `?section=${f.section}`}`}>
              {f.label}
            </Link>
          </Button>
        ) : (
          <Button
            key={i}
            size="sm"
            variant="outline"
            disabled={readOnly}
            onClick={() => setOpen(f)}
          >
            {f.label}
          </Button>
        ),
      )}
      {open && open.kind !== "open_job" && (
        <FixDialog jobId={jobId} fix={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function FixDialog({
  jobId,
  fix,
  onClose,
}: {
  jobId: string;
  fix: Exclude<RecoveryFix, { kind: "open_job" }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  const [when, setWhen] = React.useState(
    fix.kind === "set_milestone" && fix.suggested
      ? formatInTimeZone(new Date(fix.suggested), TZ, "yyyy-MM-dd'T'HH:mm")
      : "",
  );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (fix.kind === "move_stage") {
      run(() => recoverStage({ job_id: jobId, to: fix.to, reason }), {
        success: "Stage changed with an owner override.",
        onOk: () => {
          onClose();
          router.refresh();
        },
      });
    } else {
      run(
        () =>
          recoverMilestone({
            job_id: jobId,
            field: fix.field,
            value: when ? fromZonedTime(when, TZ).toISOString() : null,
            reason,
          }),
        {
          success: "Milestone saved.",
          onOk: () => {
            onClose();
            router.refresh();
          },
        },
      );
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{fix.label}</DialogTitle>
            <DialogDescription>
              {fix.kind === "move_stage"
                ? "This is an owner override: the stage history records you and your reason."
                : "The date is in Pacific time. The change and your reason go on the job's timeline."}
            </DialogDescription>
          </DialogHeader>
          {fix.kind === "set_milestone" && (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Date and time
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reason
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What happened and why this fixes it"
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 10}>
              Save fix
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
