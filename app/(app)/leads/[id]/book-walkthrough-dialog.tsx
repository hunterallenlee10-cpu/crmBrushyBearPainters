"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { pacificIsoDate } from "@/lib/format/dates";
import { bookWalkthroughSchema, type BookWalkthroughInput } from "@/lib/validation/leads";
import { selectClass } from "./labels";
import { bookWalkthrough } from "./actions";
import { jobNumberFor } from "./convert-dialog";
import type { LeadDetailData } from "./types";
import { utcToPacificParts } from "./utils";

function defaultsFor(data: LeadDetailData): BookWalkthroughInput {
  const existing = utcToPacificParts(data.lead.walkthroughAt);
  return {
    id: data.lead.id,
    date: existing.date,
    time: existing.time || "10:00",
    owner_id: data.lead.ownerId ?? data.viewerId,
    notes: "",
  };
}

/**
 * Book Walkthrough (SPEC §8.4, §6.1). Saves the walkthrough appointment and the
 * owner on the lead. When Company Settings → auto-convert is on (default) and
 * the person can create jobs, the lead becomes a job and we open it; a failed
 * conversion keeps the booking and stays on the lead with a warning. Suggested
 * slots and calendar sync arrive with scheduling (Phase 6).
 */
export function BookWalkthroughDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LeadDetailData;
}) {
  const router = useRouter();
  const form = useForm<BookWalkthroughInput, unknown, z.output<typeof bookWalkthroughSchema>>({
    resolver: zodResolver(bookWalkthroughSchema),
    defaultValues: defaultsFor(data),
  });
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = form;
  React.useEffect(() => {
    if (open) reset(defaultsFor(data));
  }, [open, data, reset]);

  const err = (k: keyof BookWalkthroughInput) => errors[k]?.message;
  const ownerKnown = data.options.users.some((u) => u.value === data.lead.ownerId);

  async function onSubmit() {
    const values = form.getValues();
    const result = await bookWalkthrough({
      ...values,
      owner_id: data.can.assign ? values.owner_id : null,
    });
    if (result.ok) {
      const { jobId, conversionError } = result.data;
      if (jobId) {
        const number = await jobNumberFor(jobId);
        toast.success(
          number
            ? `Walkthrough booked. Job ${number} created.`
            : "Walkthrough booked. Job created.",
        );
        onOpenChange(false);
        router.push(`/jobs/${jobId}`);
        return;
      }
      if (conversionError) {
        toast.warning(`Walkthrough booked, but the job wasn't created: ${conversionError}`);
      } else {
        toast.success("Walkthrough booked.");
      }
      onOpenChange(false);
      router.refresh();
      return;
    }
    for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(key as keyof BookWalkthroughInput, { message: messages[0] });
    }
    toast.error(result.error.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-bb-forest" aria-hidden />
            Book walkthrough
          </DialogTitle>
          <DialogDescription>
            Saves a tentative walkthrough for {data.lead.name} and moves the lead to Walkthrough
            Scheduled. Times are Pacific.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="book-date" label="Date" required error={err("date")}>
              <Input
                type="date"
                min={pacificIsoDate()}
                {...register("date")}
                {...fieldAria("book-date", err("date"))}
              />
            </Field>
            <Field id="book-time" label="Time (Pacific)" required error={err("time")}>
              <Input
                type="time"
                step={900}
                {...register("time")}
                {...fieldAria("book-time", err("time"))}
              />
            </Field>
          </div>
          <Field
            id="book-owner"
            label="Estimator / owner"
            error={err("owner_id")}
            description={
              data.can.assign
                ? undefined
                : "Only office managers and owners can change who owns a lead."
            }
          >
            <select
              {...register("owner_id")}
              className={selectClass}
              disabled={!data.can.assign}
              {...fieldAria("book-owner", err("owner_id"), !data.can.assign)}
            >
              {!data.lead.ownerId && <option value="">Unassigned</option>}
              {data.lead.ownerId && !ownerKnown && (
                <option value={data.lead.ownerId}>{data.lead.ownerName ?? "Current owner"}</option>
              )}
              {data.options.users.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="book-notes"
            label="Notes for the walkthrough"
            error={err("notes")}
            description="Saved as a note on the lead."
          >
            <Textarea
              rows={3}
              maxLength={1000}
              {...register("notes")}
              {...fieldAria("book-notes", err("notes"), true)}
            />
          </Field>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            When auto-convert is on in Company Settings, booking also turns the lead into a job and
            opens it. Suggested time slots and calendar sync arrive with scheduling (Phase 6).
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              Book walkthrough
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
