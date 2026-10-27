"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  LEAD_STATUS_LABELS,
  MANUAL_STATUS_CHOICES,
  type LeadStatus,
} from "@/lib/domain/leads/constants";
import { leadStatusSchema, type LeadStatusInput } from "@/lib/validation/leads";
import { choices, selectClass } from "./labels";
import { changeLeadStatus } from "./actions";
import type { LeadDetailData } from "./types";

const HELP: Partial<Record<LeadStatus, string>> = {
  new: "Not reached yet.",
  contacted: "You've talked, texted or emailed with them.",
  nurture: "Not ready yet. Choose when to reach out again.",
  unqualified: "Not a fit (outside the area, wrong service…).",
  lost: "They went another way. Pick a reason.",
};

function defaultsFor(data: LeadDetailData): LeadStatusInput {
  const s = data.lead.status;
  return {
    id: data.lead.id,
    status: MANUAL_STATUS_CHOICES.includes(s) ? s : "contacted",
    disposition: data.lead.disposition ?? "",
    lost_reason: data.lead.lostReason ?? "",
    nurture_until: data.lead.nurtureUntil ?? "",
  };
}

export function StatusDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LeadDetailData;
}) {
  const form = useForm<LeadStatusInput>({
    resolver: zodResolver(leadStatusSchema),
    defaultValues: defaultsFor(data),
  });
  const {
    register,
    handleSubmit,
    watch,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = form;
  React.useEffect(() => {
    if (open) reset(defaultsFor(data));
  }, [open, data, reset]);

  const status = watch("status");
  const err = (k: keyof LeadStatusInput) => errors[k]?.message;

  async function onSubmit() {
    const result = await changeLeadStatus(form.getValues());
    if (result.ok) {
      toast.success("Status updated.");
      onOpenChange(false);
      return;
    }
    for (const [key, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(key as keyof LeadStatusInput, { message: messages[0] });
    }
    toast.error(result.error.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            Walkthrough Scheduled comes from booking a walkthrough, and Converted from Convert to
            Job.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          <Field
            id="status-status"
            label="Status"
            required
            error={err("status")}
            description={HELP[status as LeadStatus]}
          >
            <select
              {...register("status")}
              className={selectClass}
              {...fieldAria("status-status", err("status"), Boolean(HELP[status as LeadStatus]))}
            >
              {MANUAL_STATUS_CHOICES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="status-disposition" label="Disposition" error={err("disposition")}>
            <select
              {...register("disposition")}
              className={selectClass}
              {...fieldAria("status-disposition", err("disposition"))}
            >
              <option value="">—</option>
              {choices(data.options, "lead_disposition", data.lead.disposition).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {status === "lost" && (
            <Field id="status-lost_reason" label="Lost reason" required error={err("lost_reason")}>
              <select
                {...register("lost_reason")}
                className={selectClass}
                {...fieldAria("status-lost_reason", err("lost_reason"))}
              >
                <option value="">Pick a reason…</option>
                {choices(data.options, "lost_reason", data.lead.lostReason).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {status === "nurture" && (
            <Field
              id="status-nurture_until"
              label="Check back on"
              required
              error={err("nurture_until")}
            >
              <Input
                type="date"
                min={pacificIsoDate()}
                {...register("nurture_until")}
                {...fieldAria("status-nurture_until", err("nurture_until"))}
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              Save status
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
