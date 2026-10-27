"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";

const RESOLVE_NOTE_MIN = 3;
const RESOLVE_NOTE_MAX = 1000;

/**
 * Resolve with a required note (≥ 3 characters, checked again by the
 * database). Resolved by hand, an item stays closed while the problem lasts.
 */
export function ResolveDialog({
  open,
  onOpenChange,
  itemTitle,
  onResolve,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemTitle: string;
  /** Returns an error message to show, or null on success. */
  onResolve: (note: string) => Promise<string | null>;
}) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [pending, setPending] = React.useState(false);
  const id = React.useId();
  const noteId = `${id}-note`;

  React.useEffect(() => {
    if (open) {
      setNote("");
      setError(undefined);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < RESOLVE_NOTE_MIN) {
      setError("Add a short note saying how it was resolved.");
      return;
    }
    if (trimmed.length > RESOLVE_NOTE_MAX) {
      setError("Keep the note under 1,000 characters.");
      return;
    }
    setPending(true);
    const message = await onResolve(trimmed);
    setPending(false);
    if (message) setError(message);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resolve item</DialogTitle>
          <DialogDescription>
            {itemTitle}. Say what was done so the team knows. It won&apos;t reopen while the same
            problem is still there.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field
            id={noteId}
            label="How was it resolved?"
            required
            error={error}
            description="For example: “Called and booked a walkthrough for Friday.”"
          >
            <Textarea
              {...fieldAria(noteId, error, true)}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={RESOLVE_NOTE_MAX}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:h-9" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Resolve item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
