"use client";

import * as React from "react";
import { Loader2, Pencil } from "lucide-react";
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
import type { JobOptions } from "@/lib/jobs/options";
import { JOB_PRIORITIES, JOB_PRIORITY_LABELS, type JobPriority } from "@/lib/domain/jobs/constants";
import { jobUpdateSchema, type JobUpdateInput } from "@/lib/validation/jobs";
import { updateJob } from "./actions";
import type { JobRecord } from "./types";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

type Form = {
  name: string;
  work_types: string[];
  owner_id: string;
  point_of_contact_id: string;
  project_manager_id: string;
  priority: JobPriority;
  priority_reason: string;
  target_season: string;
  promised_start_date: string;
  estimated_duration_days: string;
  estimated_completion_date: string;
  tags: string;
};

function defaultsFor(job: JobRecord): Form {
  return {
    name: job.name,
    work_types: job.workTypes,
    owner_id: job.ownerId ?? "",
    point_of_contact_id: job.pocId ?? "",
    project_manager_id: job.pmId ?? "",
    priority: job.priority,
    priority_reason: job.priorityReason ?? "",
    target_season: job.targetSeason ? String(job.targetSeason) : "",
    promised_start_date: job.promisedStartDate ?? "",
    estimated_duration_days: job.estimatedDurationDays ? String(job.estimatedDurationDays) : "",
    estimated_completion_date: job.estimatedCompletionDate ?? "",
    tags: job.tags.join(", "),
  };
}

/** Job Details → Edit (SPEC §8.5). Stage, money and milestones aren't edited here. */
export function EditJobButton({
  job,
  options,
  canAssign,
}: {
  job: JobRecord;
  options: JobOptions;
  canAssign: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<Form>(() => defaultsFor(job));
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (open) {
      setForm(defaultsFor(job));
      setErrors({});
    }
  }, [open, job]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const workTypes = options.picklists.work_type.filter(
    (o) => o.active !== false || job.workTypes.includes(o.value),
  );
  const userChoices = (current: string | null, name: string | null) => {
    const known = options.users.some((u) => u.value === current);
    return [
      ...(current && !known ? [{ value: current, label: name ?? "Current person" }] : []),
      ...options.users,
    ];
  };

  const submit = () => {
    const input: JobUpdateInput = {
      id: job.id,
      name: form.name,
      work_types: form.work_types,
      property_id: job.propertyId,
      primary_contact_id: job.contactId,
      owner_id: form.owner_id,
      point_of_contact_id: form.point_of_contact_id,
      project_manager_id: form.project_manager_id,
      priority: form.priority,
      priority_reason: form.priority_reason,
      target_season: form.target_season === "" ? null : form.target_season,
      promised_start_date: form.promised_start_date,
      estimated_duration_days:
        form.estimated_duration_days === "" ? null : form.estimated_duration_days,
      estimated_completion_date: form.estimated_completion_date,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    const parsed = jobUpdateSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      return setErrors(e);
    }
    setErrors({});
    startTransition(async () => {
      const r = await updateJob(input);
      if (r.ok) {
        toast.success("Job details saved.");
        setOpen(false);
      } else {
        const e: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(r.error.fieldErrors ?? {})) e[k] = v[0];
        setErrors(e);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit job details</DialogTitle>
            <DialogDescription>
              Stage changes use Advance; milestone dates and the contract live in Admin.
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field id="job-name" label="Job name" required error={errors.name}>
              <Input
                value={form.name}
                maxLength={200}
                onChange={(e) => set("name", e.target.value)}
                {...fieldAria("job-name", errors.name)}
              />
            </Field>
            <fieldset aria-describedby={errors.work_types ? "job-work-types-error" : undefined}>
              <legend className="mb-1.5 text-sm font-medium">
                Work types
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {workTypes.map((o) => (
                  <label key={o.value} className="flex min-h-8 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-bb-forest"
                      checked={form.work_types.includes(o.value)}
                      onChange={(e) =>
                        set(
                          "work_types",
                          e.target.checked
                            ? [...form.work_types, o.value]
                            : form.work_types.filter((w) => w !== o.value),
                        )
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              {errors.work_types && (
                <p id="job-work-types-error" role="alert" className="text-xs text-danger">
                  {errors.work_types}
                </p>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                id="job-owner"
                label="Estimator / owner"
                error={errors.owner_id}
                description={
                  canAssign ? undefined : "Only office managers and owners can change this."
                }
              >
                <select
                  className={selectClass}
                  value={form.owner_id}
                  disabled={!canAssign}
                  onChange={(e) => set("owner_id", e.target.value)}
                  {...fieldAria("job-owner", errors.owner_id, !canAssign)}
                >
                  <option value="">Unassigned</option>
                  {userChoices(job.ownerId, job.ownerName).map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="job-poc" label="Point of contact" error={errors.point_of_contact_id}>
                <select
                  className={selectClass}
                  value={form.point_of_contact_id}
                  onChange={(e) => set("point_of_contact_id", e.target.value)}
                  {...fieldAria("job-poc", errors.point_of_contact_id)}
                >
                  <option value="">Unassigned</option>
                  {userChoices(job.pocId, job.pocName).map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="job-pm" label="Project manager" error={errors.project_manager_id}>
                <select
                  className={selectClass}
                  value={form.project_manager_id}
                  onChange={(e) => set("project_manager_id", e.target.value)}
                  {...fieldAria("job-pm", errors.project_manager_id)}
                >
                  <option value="">Unassigned</option>
                  {userChoices(job.pmId, job.pmName).map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="job-priority" label="Priority" error={errors.priority}>
                <select
                  className={selectClass}
                  value={form.priority}
                  onChange={(e) => set("priority", e.target.value as JobPriority)}
                  {...fieldAria("job-priority", errors.priority)}
                >
                  {JOB_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {JOB_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id="job-priority-reason"
                label="Priority reason"
                required={form.priority !== "normal"}
                error={errors.priority_reason}
                className="sm:col-span-2"
              >
                <Textarea
                  rows={1}
                  maxLength={500}
                  value={form.priority_reason}
                  onChange={(e) => set("priority_reason", e.target.value)}
                  {...fieldAria("job-priority-reason", errors.priority_reason)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="job-season" label="Target season (year)" error={errors.target_season}>
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  value={form.target_season}
                  onChange={(e) => set("target_season", e.target.value)}
                  {...fieldAria("job-season", errors.target_season)}
                />
              </Field>
              <Field id="job-promised" label="Projected start" error={errors.promised_start_date}>
                <Input
                  type="date"
                  value={form.promised_start_date}
                  onChange={(e) => set("promised_start_date", e.target.value)}
                  {...fieldAria("job-promised", errors.promised_start_date)}
                />
              </Field>
              <Field
                id="job-duration"
                label="Estimated duration (days)"
                error={errors.estimated_duration_days}
              >
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={form.estimated_duration_days}
                  onChange={(e) => set("estimated_duration_days", e.target.value)}
                  {...fieldAria("job-duration", errors.estimated_duration_days)}
                />
              </Field>
              <Field
                id="job-completion"
                label="Estimated completion"
                error={errors.estimated_completion_date}
              >
                <Input
                  type="date"
                  value={form.estimated_completion_date}
                  onChange={(e) => set("estimated_completion_date", e.target.value)}
                  {...fieldAria("job-completion", errors.estimated_completion_date)}
                />
              </Field>
            </div>
            <Field
              id="job-tags"
              label="Tags"
              error={errors.tags}
              description="Separate tags with commas."
            >
              <Input
                value={form.tags}
                onChange={(e) => set("tags", e.target.value)}
                {...fieldAria("job-tags", errors.tags, true)}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="cta" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                Save details
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
