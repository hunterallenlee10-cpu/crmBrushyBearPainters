"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Printer, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, fieldAria } from "@/components/forms/field";
import { deleteJobSchema } from "@/lib/validation/jobs";
import { deleteJob } from "./actions";

/** Header kebab: Print, Delete (soft delete with a reason; restorable by an owner). */
export function JobKebab({
  jobId,
  jobLabel,
  canDelete,
}: {
  jobId: string;
  jobLabel: string;
  canDelete: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label="More job actions">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => window.print()}>
            <Printer aria-hidden />
            Print
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen(true)}>
                <Trash2 aria-hidden />
                Delete job…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <DeleteJobDialog open={open} onOpenChange={setOpen} jobId={jobId} jobLabel={jobLabel} />
      )}
    </>
  );
}

function DeleteJobDialog({
  open,
  onOpenChange,
  jobId,
  jobLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobLabel: string;
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
          <DialogTitle>Delete {jobLabel}?</DialogTitle>
          <DialogDescription>
            The job leaves every list. An owner can restore it from Admin → Deleted Records.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { id: jobId, reason };
            const parsed = deleteJobSchema.safeParse(input);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(undefined);
            startTransition(async () => {
              const r = await deleteJob(input);
              if (r.ok) {
                toast.success("Job deleted.");
                onOpenChange(false);
                router.push("/jobs/list");
              } else {
                setError(r.error.fieldErrors?.reason?.[0]);
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="delete-job-reason" label="Reason" required error={error}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Duplicate of another job, test entry…"
              {...fieldAria("delete-job-reason", error)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep job
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
