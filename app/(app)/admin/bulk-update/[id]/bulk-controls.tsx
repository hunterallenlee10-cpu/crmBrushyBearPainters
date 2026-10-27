"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Play, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRunAction } from "@/components/forms/use-run-action";
import { applyBulkUpdate, cancelBulkUpdate, revertBulkUpdate } from "../actions";

export function BulkControls({
  id,
  status,
  changed,
  applied,
}: {
  id: string;
  status: string;
  changed: number;
  applied: number;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");

  if (status === "preview") {
    return (
      <div className="flex flex-wrap gap-2 rounded-2xl border bg-bb-cream-light p-4">
        <p className="flex-1 text-sm">
          Check the records below. Applying changes {changed} records, one by one, as you.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => cancelBulkUpdate({ id }), {
              success: "Canceled.",
              onOk: () => router.push("/admin/bulk-update"),
            })
          }
        >
          <X aria-hidden /> Cancel
        </Button>
        <Button
          variant="cta"
          disabled={pending || changed === 0}
          onClick={() =>
            run(() => applyBulkUpdate({ id }), {
              success: (d) => `${d.applied} changed${d.failed ? `, ${d.failed} failed` : ""}.`,
              onOk: () => router.refresh(),
            })
          }
        >
          <Play aria-hidden /> Apply {changed} changes
        </Button>
      </div>
    );
  }
  if (status === "applied" && applied > 0) {
    return (
      <form
        className="flex flex-col gap-2 rounded-2xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => revertBulkUpdate({ id, reason }), {
            success: (d) =>
              `${d.reverted} reverted${d.conflicts ? `, ${d.conflicts} left as is` : ""}.`,
            onOk: () => router.refresh(),
          });
        }}
      >
        <label htmlFor="revert-reason" className="text-sm font-medium">
          Revert this bulk update
        </label>
        <p className="text-xs text-muted-foreground">
          Records changed by someone since then are left as they are.
        </p>
        <Textarea
          id="revert-reason"
          rows={2}
          placeholder="Why are you reverting?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" variant="outline" disabled={pending || reason.trim().length < 10}>
            <Undo2 aria-hidden /> Revert
          </Button>
        </div>
      </form>
    );
  }
  return null;
}
