"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOfflineSync } from "@/components/offline/offline-sync";
import { DailyLogForm, type DailyLogJob } from "@/components/production/daily-log-form";

/** "New Daily Log" on the job page; refreshes the timeline when the queue uploads it. */
export function NewDailyLogButton({ job, today }: { job: DailyLogJob; today: string }) {
  const router = useRouter();
  const sync = useOfflineSync();
  const [open, setOpen] = React.useState(false);
  React.useEffect(
    () =>
      sync.onSynced((jobIds) => {
        if (jobIds.includes(job.id)) router.refresh();
      }),
    [sync, job.id, router],
  );
  return (
    <>
      <Button
        className="h-11 bg-bb-honey text-bb-ink hover:bg-bb-honey/90"
        onClick={() => setOpen(true)}
      >
        <NotebookPen aria-hidden /> New Daily Log
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New daily log</DialogTitle>
            <DialogDescription>
              What got done, what&apos;s next, and the cleanup photo. The customer update is
              recorded (simulated) and signed by the job&apos;s point of contact.
            </DialogDescription>
          </DialogHeader>
          <DailyLogForm
            jobs={[job]}
            defaultJobId={job.id}
            today={today}
            onQueued={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
