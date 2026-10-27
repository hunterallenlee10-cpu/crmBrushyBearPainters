"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { ReasonButton } from "@/components/leads/reason-button";
import { cancelApproval, decideApproval } from "./actions";

type Mode = "approve" | "reject" | "cancel" | null;

/** Approve / Reject (owners) and Cancel (the requester) for one pending request. */
export function ApprovalActions({
  id,
  jobLabel,
  moveLabel,
  canDecide,
  canCancel,
  staleReason = null,
}: {
  id: string;
  /** "BB-2026-0001 · Smith – Kirkland – Interior" */
  jobLabel: string;
  /** "Estimate Sent → Sold" */
  moveLabel: string;
  canDecide: boolean;
  canCancel: boolean;
  /** Set when the job already left the request's "from" stage: approving would fail. */
  staleReason?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(null);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  /** The approval failed because the job moved: offer to reject it as out of date. */
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const noteId = `approval-note-${id}`;

  const open = (m: Mode, prefill = "") => {
    setNote(prefill);
    setError(null);
    setConflict(null);
    setMode(m);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "reject" && note.trim().length === 0) {
      setError("Say why you're rejecting it.");
      return;
    }
    startTransition(async () => {
      const result =
        mode === "cancel"
          ? await cancelApproval({ id })
          : await decideApproval({
              id,
              decision: mode === "approve" ? "approved" : "rejected",
              note: note.trim() || null,
            });
      if (!result.ok) {
        const fieldError = result.error.fieldErrors?.note?.[0];
        setError(fieldError ?? result.error.message);
        toast.error(fieldError ?? result.error.message);
        if (mode === "approve" && result.error.code === "conflict") {
          setConflict(result.error.message);
        }
        return;
      }
      toast.success(
        mode === "approve"
          ? `Approved. ${jobLabel} moved: ${moveLabel}.`
          : mode === "reject"
            ? "Request rejected. The requester will be notified."
            : "Request canceled.",
      );
      setMode(null);
      router.refresh();
    });
  }

  const title =
    mode === "approve"
      ? "Approve override"
      : mode === "reject"
        ? "Reject request"
        : "Cancel your request";

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Decide on ${jobLabel}`}>
        {canDecide && (
          <>
            <ReasonButton size="sm" disabledReason={staleReason} onClick={() => open("approve")}>
              <Check aria-hidden />
              Approve
            </ReasonButton>
            <Button
              size="sm"
              variant="outline"
              onClick={() => open("reject", staleReason ? `Out of date: ${staleReason}` : "")}
            >
              <X aria-hidden />
              Reject
            </Button>
          </>
        )}
        {canCancel && (
          <Button size="sm" variant="outline" onClick={() => open("cancel")}>
            <Undo2 aria-hidden />
            Cancel request
          </Button>
        )}
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {mode === "approve"
                ? `Moves ${jobLabel} (${moveLabel}) as an owner override. The request's reason and your name go in the stage history.`
                : mode === "reject"
                  ? `The job stays where it is. ${jobLabel} (${moveLabel}).`
                  : `Withdraws your request for ${jobLabel} (${moveLabel}).`}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            {mode !== "cancel" && (
              <Field
                id={noteId}
                label={mode === "reject" ? "Why are you rejecting it?" : "Note (optional)"}
                required={mode === "reject"}
                error={error ?? undefined}
                description={
                  mode === "reject" ? "The requester sees this note." : "Saved with the decision."
                }
              >
                <Textarea
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setError(null);
                  }}
                  {...fieldAria(noteId, error ?? undefined, true)}
                />
              </Field>
            )}
            {mode === "approve" && conflict && (
              <div className="flex flex-col gap-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-bb-ink">
                <p>This request is out of date. Reject it so the requester can ask again.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => open("reject", `Out of date: ${conflict}`.slice(0, 1000))}
                >
                  <X aria-hidden />
                  Reject as out of date
                </Button>
              </div>
            )}
            {mode === "cancel" && error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setMode(null)}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant={mode === "reject" ? "destructive" : "default"}
                disabled={pending}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {mode === "approve"
                  ? "Approve and move job"
                  : mode === "reject"
                    ? "Reject request"
                    : "Cancel request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
