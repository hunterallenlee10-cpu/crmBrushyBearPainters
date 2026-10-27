"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { parseAccess } from "@/lib/auth/access";
import { hasPermission } from "@/lib/permissions";
import type { Service } from "@/lib/domain/leads/constants";
import { convertLead } from "./actions";
import type { LeadDetailData } from "./types";

type Option = { value: string; label: string };

export type ConversionInfo = {
  /** Still loading the viewer's permission and the work type list. */
  loading: boolean;
  canCreateJobs: boolean;
  workTypes: Option[];
  /** The job this lead became (null until loaded, or when the viewer can't open it). */
  job: { id: string; number: string } | null;
};

/** Work types from the lead's services: "other" becomes Add-on Only (same as the database). */
export function defaultWorkTypes(
  services: readonly Service[],
  options: readonly Option[],
): string[] {
  const wanted = new Set<string>(services.map((s) => (s === "other" ? "add_on_only" : s)));
  return options.map((o) => o.value).filter((v) => wanted.has(v));
}

/** "BB-2026-0001" for a job the viewer can open, else null (row security applies). */
export async function jobNumberFor(jobId: string): Promise<string | null> {
  try {
    const { data } = await createSupabaseBrowserClient()
      .from("jobs")
      .select("job_number")
      .eq("id", jobId)
      .maybeSingle();
    return data?.job_number ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads what the Convert to Job button and the converted banner need with the
 * person's own session: whether they may create jobs, the work type picklist,
 * and (for a converted lead) the job it became.
 */
export function useConversionInfo(leadId: string, converted: boolean): ConversionInfo {
  const [info, setInfo] = React.useState<ConversionInfo>({
    loading: true,
    canCreateJobs: false,
    workTypes: [],
    job: null,
  });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const [access, lists, lead] = await Promise.all([
        supabase.rpc("my_access"),
        supabase
          .from("picklists")
          .select("key, picklist_values(value, label, active, sort_order)")
          .eq("key", "work_type")
          .maybeSingle(),
        converted
          ? supabase.from("leads").select("converted_job_id").eq("id", leadId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      const parsed = parseAccess(access.data);
      const canCreateJobs = parsed ? hasPermission(parsed.permissions, "jobs:create") : false;
      const workTypes = [...(lists.data?.picklist_values ?? [])]
        .filter((v) => v.active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((v) => ({ value: v.value, label: v.label }));
      let job: ConversionInfo["job"] = null;
      const jobId = lead.data?.converted_job_id ?? null;
      if (jobId) {
        const number = await jobNumberFor(jobId);
        if (number) job = { id: jobId, number };
      }
      if (alive) setInfo({ loading: false, canCreateJobs, workTypes, job });
    })().catch(() => {
      if (alive) setInfo((i) => ({ ...i, loading: false }));
    });
    return () => {
      alive = false;
    };
  }, [leadId, converted]);

  return info;
}

/** Convert to Job (SPEC §6.1): confirm the work types, then open the new job. */
export function ConvertDialog({
  open,
  onOpenChange,
  data,
  workTypes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: LeadDetailData;
  workTypes: Option[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Fill the defaults each time the dialog opens (not on later re-renders, so a
  // late refresh of the work type list never undoes what the person picked).
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(defaultWorkTypes(data.lead.services, workTypes));
      setError(null);
    }
    wasOpen.current = open;
  }, [open, data.lead.services, workTypes]);

  const toggle = (value: string, on: boolean) => {
    setError(null);
    setSelected((prev) =>
      on
        ? workTypes.map((w) => w.value).filter((v) => v === value || prev.includes(v))
        : prev.filter((v) => v !== value),
    );
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      setError("Pick at least one work type.");
      return;
    }
    setSaving(true);
    const result = await convertLead({ id: data.lead.id, work_types: selected });
    if (!result.ok) {
      setSaving(false);
      setError(result.error.message);
      toast.error(result.error.message);
      return;
    }
    const number = await jobNumberFor(result.data.jobId);
    toast.success(number ? `Converted to job ${number}.` : "Converted to a job.");
    router.push(`/jobs/${result.data.jobId}`);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="size-5 text-bb-forest" aria-hidden />
            Convert to Job
          </DialogTitle>
          <DialogDescription>
            Creates a job for {data.lead.name} at Walkthrough Scheduled. The customer, contact and
            property are reused when they already exist; notes, comments, tasks and the walkthrough
            move to the job. The lead stays linked and becomes read-only.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <fieldset aria-describedby={error ? "convert-error" : "convert-help"}>
            <legend className="mb-2 text-sm font-medium">
              Work types
              <span className="text-danger" aria-hidden>
                *
              </span>
            </legend>
            <div className="grid grid-cols-2 gap-2.5">
              {workTypes.map((w) => (
                <div key={w.value} className="flex min-h-6 items-center gap-2">
                  <Checkbox
                    id={`convert-wt-${w.value}`}
                    checked={selected.includes(w.value)}
                    onCheckedChange={(v) => toggle(w.value, v === true)}
                  />
                  <Label htmlFor={`convert-wt-${w.value}`} className="font-normal">
                    {w.label}
                  </Label>
                </div>
              ))}
            </div>
            {error ? (
              <p id="convert-error" role="alert" className="mt-2 text-xs text-danger">
                {error}
              </p>
            ) : (
              <p id="convert-help" className="mt-2 text-xs text-muted-foreground">
                Picked from the lead&apos;s services. “Something else” becomes Add-on Only.
              </p>
            )}
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Convert to Job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
