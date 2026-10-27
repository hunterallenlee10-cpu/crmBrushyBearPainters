"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/forms/use-run-action";
import { toggleWorkflow } from "@/app/(app)/admin/workflows/actions";

/** On/off switch for a system workflow; turning it off asks why (audit-logged). */
export function WorkflowSwitch({
  workflowKey,
  name,
  enabled,
  readOnly,
}: {
  workflowKey: string;
  name: string;
  enabled: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [asking, setAsking] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const apply = (on: boolean, why?: string) =>
    run(() => toggleWorkflow({ key: workflowKey, enabled: on, reason: why ?? null }), {
      success: on ? `${name} is on.` : `${name} is off. Nothing it sends will go out.`,
      onOk: () => {
        setAsking(false);
        setReason("");
        router.refresh();
      },
      onError: (e) => setError(e.fieldErrors?.reason?.[0] ?? e.message),
    });

  return (
    <>
      <Switch
        checked={enabled}
        disabled={readOnly || pending}
        aria-label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
        onCheckedChange={(on) => (on ? apply(true) : setAsking(true))}
      />
      <Dialog open={asking} onOpenChange={(o) => !o && setAsking(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off “{name}”?</DialogTitle>
            <DialogDescription>
              While it's off, the events it listens to are logged as skipped and nothing is sent.
              Turning it back on doesn't replay them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`reason-${workflowKey}`}>Why?</Label>
            <Textarea
              id={`reason-${workflowKey}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? `reason-${workflowKey}-error` : undefined}
            />
            {error && (
              <p id={`reason-${workflowKey}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)}>
              Keep it on
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => apply(false, reason)}>
              Turn off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
