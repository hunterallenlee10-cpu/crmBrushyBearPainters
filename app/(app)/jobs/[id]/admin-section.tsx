"use client";

import * as React from "react";
import { CheckCircle2, CirclePlay, Loader2, Shuffle, TriangleAlert } from "lucide-react";
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
import { ReasonButton } from "@/components/leads/reason-button";
import {
  MILESTONE_FIELDS,
  ON_TIME_STATUSES,
  ON_TIME_STATUS_LABELS,
  type MilestoneField,
  type OnTimeStatus,
} from "@/lib/domain/jobs/constants";
import type { GateContext } from "@/lib/domain/jobs/gates";
import type { JobStageId } from "@/lib/domain/stages";
import { formatDateTime } from "@/lib/format/dates";
import {
  releaseAllHolds,
  setContractBaseline,
  setMilestone,
  setOnTimeStatus,
  setPromisedStart,
} from "./actions";
import { parseDollarInput, releaseAllHoldsSchema } from "./schemas";
import { OverrideDialog } from "./stage-controls";
import { pacificLocalToUtcIso, utcToPacificLocal } from "./utils";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * Admin (owner-only, SPEC §8.5 #16): milestone dates, contract baseline,
 * on-time guarantee and status overrides. Every change saves immediately and
 * is audit-logged by the database.
 */
export function AdminSection({
  jobId,
  stage,
  gate,
  milestones,
  promisedStartDate,
  contractCents,
  canSeeMoney,
  onTimeStatus,
  activeHoldCount,
  canEdit,
}: {
  jobId: string;
  stage: JobStageId;
  gate: GateContext;
  milestones: Record<MilestoneField, string | null>;
  promisedStartDate: string | null;
  contractCents: number | null;
  canSeeMoney: boolean;
  onTimeStatus: OnTimeStatus;
  activeHoldCount: number;
  canEdit: boolean;
}) {
  const [moving, setMoving] = React.useState(false);
  const [releasing, setReleasing] = React.useState(false);
  const readOnlyReason = canEdit
    ? null
    : "You're viewing as another user. Exit View as user to make changes.";

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-bb-ink"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong>Changes here save immediately and are audit-logged.</strong> Use them to fix dates
          or move a job when the normal steps don&apos;t fit.
        </p>
      </div>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="admin-dates-title">
        <h3 id="admin-dates-title" className="text-base font-semibold">
          Dates &amp; timestamps
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Times are Pacific. Stage changes fill these in; edit one only to correct it.
        </p>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
          <PromisedStartRow jobId={jobId} value={promisedStartDate} disabled={!canEdit} />
          {MILESTONE_FIELDS.map(([field, label]) => (
            <MilestoneRow
              key={field}
              jobId={jobId}
              field={field}
              label={label}
              value={milestones[field]}
              disabled={!canEdit}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {canSeeMoney && (
          <ContractBaseline jobId={jobId} cents={contractCents} disabled={!canEdit} />
        )}
        <section className="rounded-2xl border bg-card p-5" aria-labelledby="admin-ontime-title">
          <h3 id="admin-ontime-title" className="text-base font-semibold">
            On-time guarantee
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Whether the promised start was met, and any credit owed.
          </p>
          <OnTimeSelect jobId={jobId} value={onTimeStatus} disabled={!canEdit} />
        </section>
      </div>

      <section className="rounded-2xl border bg-card p-5" aria-labelledby="admin-overrides-title">
        <h3 id="admin-overrides-title" className="text-base font-semibold">
          Status overrides
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Each one needs a reason and is saved in the stage history.
        </p>
        <div className="flex flex-wrap gap-2">
          <ReasonButton
            variant="outline"
            size="sm"
            disabledReason={readOnlyReason}
            onClick={() => setMoving(true)}
          >
            <Shuffle aria-hidden />
            Move to any stage…
          </ReasonButton>
          <ReasonButton
            variant="outline"
            size="sm"
            disabledReason={
              readOnlyReason ?? (activeHoldCount === 0 ? "There are no active holds." : null)
            }
            onClick={() => setReleasing(true)}
          >
            <CirclePlay aria-hidden />
            Release all holds{activeHoldCount > 0 ? ` (${activeHoldCount})` : ""}…
          </ReasonButton>
        </div>
      </section>

      {canEdit && (
        <>
          <OverrideDialog
            open={moving}
            onOpenChange={setMoving}
            jobId={jobId}
            from={stage}
            initialTarget={null}
            gate={gate}
          />
          <ReleaseAllDialog open={releasing} onOpenChange={setReleasing} jobId={jobId} />
        </>
      )}
    </div>
  );
}

function SavedMark({ show }: { show: boolean }) {
  return show ? (
    <span className="inline-flex items-center gap-1 text-xs text-success" role="status">
      <CheckCircle2 className="size-3" aria-hidden />
      Saved
    </span>
  ) : null;
}

function MilestoneRow({
  jobId,
  field,
  label,
  value,
  disabled,
}: {
  jobId: string;
  field: MilestoneField;
  label: string;
  value: string | null;
  disabled: boolean;
}) {
  const saved = utcToPacificLocal(value);
  const [local, setLocal] = React.useState(saved);
  const [justSaved, setJustSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => setLocal(saved), [saved]);
  const id = `ms-${field}`;

  const save = (next: string) => {
    if (next === saved) return;
    startTransition(async () => {
      const r = await setMilestone({ id: jobId, field, value: pacificLocalToUtcIso(next) });
      if (r.ok) {
        setJustSaved(true);
        toast.success(`${label} saved.`);
      } else {
        setLocal(saved);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="flex items-center gap-2">
          {pending && <Loader2 className="size-3 animate-spin" aria-label="Saving" />}
          <SavedMark show={justSaved && !pending} />
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type="datetime-local"
          value={local}
          disabled={disabled || pending}
          onChange={(e) => {
            setJustSaved(false);
            setLocal(e.target.value);
          }}
          onBlur={(e) => save(e.target.value)}
          aria-describedby={`${id}-current`}
        />
        {local && !disabled && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setLocal("");
              save("");
            }}
          >
            Clear<span className="sr-only"> {label}</span>
          </Button>
        )}
      </div>
      <p id={`${id}-current`} className="text-xs text-muted-foreground">
        {value ? `Saved: ${formatDateTime(value)}` : "Not set"}
      </p>
    </div>
  );
}

function PromisedStartRow({
  jobId,
  value,
  disabled,
}: {
  jobId: string;
  value: string | null;
  disabled: boolean;
}) {
  const saved = value ?? "";
  const [local, setLocal] = React.useState(saved);
  const [justSaved, setJustSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => setLocal(saved), [saved]);

  const save = (next: string) => {
    if (next === saved) return;
    startTransition(async () => {
      const r = await setPromisedStart({ id: jobId, value: next });
      if (r.ok) {
        setJustSaved(true);
        toast.success("Promised start saved.");
      } else {
        setLocal(saved);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="ms-promised_start_date" className="text-sm font-medium">
          Promised start date
        </label>
        <span className="flex items-center gap-2">
          {pending && <Loader2 className="size-3 animate-spin" aria-label="Saving" />}
          <SavedMark show={justSaved && !pending} />
        </span>
      </div>
      <Input
        id="ms-promised_start_date"
        type="date"
        value={local}
        disabled={disabled || pending}
        onChange={(e) => {
          setJustSaved(false);
          setLocal(e.target.value);
        }}
        onBlur={(e) => save(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">The date the customer was promised.</p>
    </div>
  );
}

function ContractBaseline({
  jobId,
  cents,
  disabled,
}: {
  jobId: string;
  cents: number | null;
  disabled: boolean;
}) {
  const initial = cents === null ? "" : (cents / 100).toFixed(2);
  const [value, setValue] = React.useState(initial);
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => setValue(initial), [initial]);

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="admin-contract-title">
      <h3 id="admin-contract-title" className="text-base font-semibold">
        Contract baseline
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        The contract amount until estimates arrive (Phase 4). Only people who see financials can
        read it.
      </p>
      <form
        noValidate
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = parseDollarInput(value);
          if (amount === "invalid")
            return setError("Enter a dollar amount like 12500 or 12,500.00.");
          setError(undefined);
          startTransition(async () => {
            const r = await setContractBaseline({ id: jobId, amount_cents: amount });
            if (r.ok) toast.success("Contract baseline saved.");
            else {
              setError(r.error.fieldErrors?.amount_cents?.[0]);
              toast.error(r.error.message);
            }
          });
        }}
      >
        <Field id="contract-baseline" label="Amount (USD)" error={error} className="flex-1">
          <Input
            inputMode="decimal"
            placeholder="12,500.00"
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            {...fieldAria("contract-baseline", error)}
          />
        </Field>
        <Button type="submit" variant="cta" className="sm:mt-6" disabled={disabled || pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Save amount
        </Button>
      </form>
    </section>
  );
}

function OnTimeSelect({
  jobId,
  value,
  disabled,
}: {
  jobId: string;
  value: OnTimeStatus;
  disabled: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Field id="on-time-status" label="Status">
      <select
        id="on-time-status"
        className={selectClass}
        defaultValue={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const status = e.target.value as OnTimeStatus;
          startTransition(async () => {
            const r = await setOnTimeStatus({ id: jobId, status });
            if (r.ok) toast.success("On-time guarantee status saved.");
            else toast.error(r.error.message);
          });
        }}
      >
        {ON_TIME_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ON_TIME_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </Field>
  );
}

function ReleaseAllDialog({
  open,
  onOpenChange,
  jobId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
}) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (open) {
      setNote("");
      setError(undefined);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release all holds?</DialogTitle>
          <DialogDescription>
            Every active hold is released with your note. Scheduling is no longer blocked.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { job_id: jobId, note };
            const parsed = releaseAllHoldsSchema.safeParse(input);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(undefined);
            startTransition(async () => {
              const r = await releaseAllHolds(input);
              if (r.ok) {
                toast.success(
                  `${r.data.released} hold${r.data.released === 1 ? "" : "s"} released.`,
                );
                onOpenChange(false);
              } else {
                setError(r.error.fieldErrors?.note?.[0]);
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="release-all-note" label="Why?" required error={error}>
            <Textarea
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria("release-all-note", error)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Release all
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
