"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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
import { deleteLead } from "./actions";
import { deleteLeadSchema } from "./schemas";

/** Soft delete with a required reason (SPEC §8 detail pages); restorable in Admin → Deleted Records. */
export function DeleteLeadDialog({
  open,
  onOpenChange,
  leadId,
  leadName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(undefined);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {leadName}?</DialogTitle>
          <DialogDescription>
            The lead leaves every list. An owner can restore it from Admin → Deleted Records.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { id: leadId, reason };
            const parsed = deleteLeadSchema.safeParse(input);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(undefined);
            startTransition(async () => {
              const r = await deleteLead(input);
              if (r.ok) {
                toast.success("Lead deleted.");
                onOpenChange(false);
                router.push("/leads/list");
              } else {
                setError(r.error.fieldErrors?.reason?.[0]);
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="delete-reason" label="Reason" required error={error}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Duplicate of another lead, test entry…"
              {...fieldAria("delete-reason", error)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep lead
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
