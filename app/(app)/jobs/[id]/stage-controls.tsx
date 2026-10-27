"use client";

import * as React from "react";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  Loader2,
  OctagonX,
  ShieldAlert,
  Shuffle,
  UserCheck,
  XCircle,
} from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, fieldAria } from "@/components/forms/field";
import { ReasonButton } from "@/components/leads/reason-button";
import type { Option } from "@/lib/leads/service";
import {
  OVERRIDE_REASON_MIN,
  checkTransition,
  isTerminal,
  nextStage,
  type GateContext,
} from "@/lib/domain/jobs/gates";
import { JOB_STAGES, getStage, type JobStageId } from "@/lib/domain/stages";
import { advanceStageSchema, requestOverrideSchema } from "@/lib/validation/jobs";
import { formatDateTime } from "@/lib/format/dates";
import { advanceStage, cancelOverrideRequest, requestOverride } from "./actions";
import type { PendingApproval } from "./types";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive";

type DialogState =
  | { kind: "override"; target: JobStageId | null }
  | { kind: "request"; target: JobStageId }
  | { kind: "lost" }
  | null;

/**
 * The Advance button and its friends (SPEC §6.2): advance when the gate
 * passes, owner override with a reason, "Ask an owner" for everyone else,
 * Close as lost with a reason, and (owners) Move to any stage.
 */
export function StageControls({
  jobId,
  stage,
  gate,
  can,
  readOnly,
  pendingApproval,
  lostReasons,
}: {
  jobId: string;
  stage: JobStageId;
  gate: GateContext;
  can: { advance: boolean; override: boolean };
  readOnly: boolean;
  pendingApproval: PendingApproval | null;
  lostReasons: Option[];
}) {
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [pending, startTransition] = React.useTransition();
  const next = nextStage(stage);
  const check = next ? checkTransition(stage, next, gate) : null;
  const noRights = readOnly
    ? "You're viewing as another user. Exit View as user to make changes."
    : !can.advance
      ? "You don't have permission to move job stages."
      : null;

  const advance = (to: JobStageId) =>
    startTransition(async () => {
      const r = await advanceStage({ id: jobId, to_stage: to });
      if (r.ok) toast.success(`Moved to ${getStage(to).label}.`);
      else toast.error(r.error.message);
    });

  const cancelRequest = (id: string) =>
    startTransition(async () => {
      const r = await cancelOverrideRequest({ id });
      if (r.ok) toast.success("Request canceled.");
      else toast.error(r.error.message);
    });

  let primary: React.ReactNode = null;
  if (next && check) {
    const label = `Advance to ${getStage(next).label}`;
    if (noRights) {
      primary = (
        <ReasonButton variant="cta" size="sm" disabledReason={noRights}>
          {label}
          <ArrowRight aria-hidden />
        </ReasonButton>
      );
    } else if (check.allowed) {
      primary = (
        <Button variant="cta" size="sm" disabled={pending} onClick={() => advance(next)}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {label}
          <ArrowRight aria-hidden />
        </Button>
      );
    } else if (check.blockedByHolds) {
      primary = (
        <ReasonButton variant="cta" size="sm" disabledReason={check.reasons.join(" ")}>
          {label}
          <ArrowRight aria-hidden />
        </ReasonButton>
      );
    } else if (check.overridable && can.override) {
      primary = (
        <Button
          variant="cta"
          size="sm"
          onClick={() => setDialog({ kind: "override", target: next })}
        >
          <ShieldAlert aria-hidden />
          Override…
        </Button>
      );
    } else if (check.overridable && !pendingApproval) {
      primary = (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialog({ kind: "request", target: next })}
        >
          <UserCheck aria-hidden />
          Ask an owner to override
        </Button>
      );
    }
  }

  const canCloseLost =
    !noRights && stage !== "closed_lost" && (stage !== "closed_won" || can.override);
  const showMenu = canCloseLost || (can.override && !readOnly);

  return (
    <div className="flex flex-col gap-3">
      {next && check && !check.allowed && (
        <ul
          className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm"
          aria-label="Why the job can't move yet"
        >
          {check.reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {pendingApproval && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-info/30 bg-info-bg px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <span>
              <strong>Waiting for an owner:</strong> move to{" "}
              {getStage(pendingApproval.toStage).label}. “{pendingApproval.reason}”
              <span className="block text-xs text-muted-foreground">
                Asked by {pendingApproval.requestedByName ?? "a teammate"} on{" "}
                {formatDateTime(pendingApproval.requestedAt)}
              </span>
            </span>
          </p>
          {pendingApproval.mine && !readOnly && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => cancelRequest(pendingApproval.id)}
            >
              <XCircle aria-hidden />
              Cancel request
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {primary}
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                More stage actions
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {canCloseLost && (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "lost" })}>
                  <OctagonX aria-hidden />
                  Close as lost…
                </DropdownMenuItem>
              )}
              {can.override && !readOnly && (
                <DropdownMenuItem onSelect={() => setDialog({ kind: "override", target: null })}>
                  <Shuffle aria-hidden />
                  Move to stage…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <OverrideDialog
        open={dialog?.kind === "override"}
        onOpenChange={(o) => !o && setDialog(null)}
        jobId={jobId}
        from={stage}
        initialTarget={dialog?.kind === "override" ? dialog.target : null}
        gate={gate}
      />
      <RequestDialog
        open={dialog?.kind === "request"}
        onOpenChange={(o) => !o && setDialog(null)}
        jobId={jobId}
        from={stage}
        target={dialog?.kind === "request" ? dialog.target : (next ?? stage)}
        gate={gate}
      />
      <LostDialog
        open={dialog?.kind === "lost"}
        onOpenChange={(o) => !o && setDialog(null)}
        jobId={jobId}
        from={stage}
        lostReasons={lostReasons}
      />
    </div>
  );
}

/** Owner override (or Move to stage…): reason required whenever a gate is skipped. */
export function OverrideDialog({
  open,
  onOpenChange,
  jobId,
  from,
  initialTarget,
  gate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  from: JobStageId;
  /** Fixed target (Override…) or null to pick one (Move to stage…). */
  initialTarget: JobStageId | null;
  gate: GateContext;
}) {
  const choices = JOB_STAGES.filter((s) => s.id !== from && s.id !== "closed_lost");
  const [target, setTarget] = React.useState<JobStageId>(initialTarget ?? choices[0]!.id);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setTarget(initialTarget ?? nextStage(from) ?? choices[0]!.id);
    setReason("");
    setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const check = checkTransition(from, target, gate);
  const needsOverride = !check.allowed;
  const picking = initialTarget === null;

  const submit = () => {
    const input = { id: jobId, to_stage: target, override: needsOverride, reason };
    const parsed = advanceStageSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues.find((i) => i.path[0] === "reason")?.message);
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const r = await advanceStage(input);
      if (r.ok) {
        toast.success(`Moved to ${getStage(target).label}.`);
        onOpenChange(false);
      } else {
        setError(r.error.fieldErrors?.reason?.[0]);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {picking ? "Move to another stage" : `Override: move to ${getStage(target).label}`}
          </DialogTitle>
          <DialogDescription>
            Overrides skip a stage&apos;s gate. They&apos;re saved in the stage history and the
            audit log with your reason.
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
          {picking && (
            <Field id="override-stage" label="Move to">
              <select
                id="override-stage"
                className={selectClass}
                value={target}
                onChange={(e) => setTarget(e.target.value as JobStageId)}
              >
                {choices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {check.reasons.length > 0 && (
            <div className="rounded-lg bg-muted px-3 py-2 text-sm">
              <p className="mb-1 font-medium">
                {check.blockedByHolds ? "This move is blocked:" : "What the gate is waiting on:"}
              </p>
              <ul className="list-disc pl-5">
                {check.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {!check.blockedByHolds && (
            <Field
              id="override-reason"
              label={needsOverride ? "Why are you overriding?" : "Note (optional)"}
              required={needsOverride}
              error={error}
              description={
                needsOverride
                  ? `At least ${OVERRIDE_REASON_MIN} characters. The team sees this in the job's history.`
                  : "The gate passes, so no override is needed."
              }
            >
              <Textarea
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                {...fieldAria("override-reason", error, true)}
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {check.blockedByHolds ? (
              <ReasonButton type="button" variant="cta" disabledReason={check.reasons.join(" ")}>
                Move job
              </ReasonButton>
            ) : (
              <Button type="submit" variant="cta" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {needsOverride ? "Override and move" : "Move job"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Non-owners: ask an owner to override the gate (one pending request per job). */
function RequestDialog({
  open,
  onOpenChange,
  jobId,
  from,
  target,
  gate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  from: JobStageId;
  target: JobStageId;
  gate: GateContext;
}) {
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(undefined);
    }
  }, [open]);
  const check = checkTransition(from, target, gate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask an owner to move this job to {getStage(target).label}</DialogTitle>
          <DialogDescription>
            An owner sees your request in Approvals and can approve or reject it.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = { id: jobId, to_stage: target, reason };
            const parsed = requestOverrideSchema.safeParse(input);
            if (!parsed.success) return setError(parsed.error.issues[0]?.message);
            setError(undefined);
            startTransition(async () => {
              const r = await requestOverride(input);
              if (r.ok) {
                toast.success("Sent to an owner for approval.");
                onOpenChange(false);
              } else {
                setError(r.error.fieldErrors?.reason?.[0]);
                toast.error(r.error.message);
              }
            });
          }}
        >
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            <p className="mb-1 font-medium">What the gate is waiting on:</p>
            <ul className="list-disc pl-5">
              {check.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <Field
            id="request-reason"
            label="Why should it move?"
            required
            error={error}
            description={`At least ${OVERRIDE_REASON_MIN} characters.`}
          >
            <Textarea
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...fieldAria("request-reason", error, true)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Close as lost: a lost reason is required (no override, except reopening a won job). */
function LostDialog({
  open,
  onOpenChange,
  jobId,
  from,
  lostReasons,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  from: JobStageId;
  lostReasons: Option[];
}) {
  const [lostReason, setLostReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ lost?: string; note?: string }>({});
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (open) {
      setLostReason("");
      setNote("");
      setErrors({});
    }
  }, [open]);
  const needsOverride = isTerminal(from) && from === "closed_won";
  const choices = lostReasons.filter((o) => o.active !== false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close this job as lost</DialogTitle>
          <DialogDescription>
            The job leaves the open pipeline. An owner can reopen it later.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = {
              id: jobId,
              to_stage: "closed_lost",
              lost_reason: lostReason || null,
              override: needsOverride,
              reason: note,
            };
            const parsed = advanceStageSchema.safeParse(input);
            if (!parsed.success) {
              const issue = (k: string) =>
                parsed.error.issues.find((i) => i.path[0] === k)?.message;
              return setErrors({ lost: issue("lost_reason"), note: issue("reason") });
            }
            setErrors({});
            startTransition(async () => {
              const r = await advanceStage(input);
              if (r.ok) {
                toast.success("Job closed as lost.");
                onOpenChange(false);
              } else {
                setErrors({
                  lost: r.error.fieldErrors?.lost_reason?.[0],
                  note: r.error.fieldErrors?.reason?.[0],
                });
                toast.error(r.error.message);
              }
            });
          }}
        >
          <Field id="lost-reason" label="Lost reason" required error={errors.lost}>
            <select
              className={selectClass}
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              {...fieldAria("lost-reason", errors.lost)}
            >
              <option value="">Pick a reason…</option>
              {choices.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="lost-note"
            label={needsOverride ? "Why are you reopening a won job?" : "Note (optional)"}
            required={needsOverride}
            error={errors.note}
          >
            <Textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...fieldAria("lost-note", errors.note)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep it open
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Close as lost
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
