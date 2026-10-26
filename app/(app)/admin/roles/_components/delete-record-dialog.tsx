"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, fieldAria } from "@/components/forms/field";
import { Textarea } from "@/components/ui/textarea";
import { deleteRoleRecord } from "../actions";

const COPY = {
  role_templates: {
    noun: "template",
    body: "Users can't be on a deleted template, so move everyone to another template first. An owner can restore it from Deleted Records.",
  },
  permission_packs: {
    noun: "pack",
    body: "Templates that include this pack lose its permissions right away. An owner can restore it from Deleted Records.",
  },
} as const;

/** Soft delete with a required reason; shows the database's message when it refuses. */
export function DeleteRecordDialog({
  table,
  id,
  name,
  redirectTo,
  size = "sm",
}: {
  table: keyof typeof COPY;
  id: string;
  name: string;
  /** Where to go after deleting; stays on the page (refreshing it) when omitted. */
  redirectTo?: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const copy = COPY[table];
  const fieldId = `delete-reason-${id}`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reason.trim().length < 3) {
      setError("Give a short reason (at least 3 characters).");
      return;
    }
    startTransition(async () => {
      const result = await deleteRoleRecord({ table, id, reason });
      if (!result.ok) {
        setError(result.error.fieldErrors?.reason?.[0] ?? result.error.message);
        return;
      }
      toast.success(`Deleted ${copy.noun} “${name}”.`);
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size={size} aria-label={`Delete ${copy.noun} ${name}`}>
          <Trash2 aria-hidden /> Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              Delete {copy.noun} “{name}”?
            </DialogTitle>
            <DialogDescription>{copy.body}</DialogDescription>
          </DialogHeader>
          <Field id={fieldId} label="Reason" required error={error ?? undefined}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Why is this being deleted?"
              {...fieldAria(fieldId, error ?? undefined)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete {copy.noun}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
