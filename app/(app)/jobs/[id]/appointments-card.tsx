"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  APPOINTMENT_DEFAULT_MINUTES,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  BOOKABLE_APPOINTMENT_TYPES,
  WALKTHROUGH_RESULTS,
  WALKTHROUGH_RESULT_LABELS,
  type AppointmentStatus,
  type AppointmentType,
  type WalkthroughResult,
} from "@/lib/domain/jobs/constants";
import { bookAppointmentSchema } from "@/lib/validation/jobs";
import { formatAppointment, pacificIsoDate } from "@/lib/format/dates";
import { bookAppointment, setAppointmentStatus } from "./actions";
import type { AppointmentItem } from "./types";

const OPEN: readonly AppointmentStatus[] = ["tentative", "scheduled", "confirmed", "in_progress"];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none aria-invalid:border-destructive";

const STATUS_VARIANT: Record<AppointmentStatus, "info" | "success" | "warning" | "neutral"> = {
  tentative: "neutral",
  scheduled: "info",
  confirmed: "success",
  in_progress: "info",
  completed: "success",
  no_show: "warning",
  rescheduled: "neutral",
  canceled: "neutral",
};

/**
 * Overview → Schedule card: the job's appointments with Book appointment and
 * per-appointment Confirm / Mark completed (walkthrough result) / No-show / Cancel.
 */
export function AppointmentsCard({
  jobId,
  appointments,
  users,
  defaultAssignee,
  canManage,
  readOnly,
}: {
  jobId: string;
  appointments: AppointmentItem[];
  users: Option[];
  defaultAssignee: string;
  canManage: boolean;
  readOnly: boolean;
}) {
  const [booking, setBooking] = React.useState(false);
  const [completing, setCompleting] = React.useState<AppointmentItem | null>(null);
  const [canceling, setCanceling] = React.useState<AppointmentItem | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [now] = React.useState(() => Date.now());

  const open = appointments.filter((a) => OPEN.includes(a.status));
  const closed = appointments.filter((a) => !OPEN.includes(a.status)).reverse();
  const today = pacificIsoDate();

  // ?result=walkthrough (the "Result Walkthrough" shortcut) opens the result dialog.
  const wantsResult = useSearchParams().get("result") === "walkthrough";
  React.useEffect(() => {
    if (!wantsResult) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("result");
    window.history.replaceState(window.history.state, "", url);
    const walk = appointments.find((a) => a.type === "walkthrough" && OPEN.includes(a.status));
    if (walk && canManage) setCompleting(walk);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the shortcut only
  }, [wantsResult]);

  const setStatus = (a: AppointmentItem, status: AppointmentStatus, message: string) =>
    startTransition(async () => {
      // Only walkthroughs carry a result; other visits complete without one.
      const r = await setAppointmentStatus({ id: a.id, status, result: null });
      if (r.ok) toast.success(message);
      else toast.error(r.error.message);
    });

  const manageReason = readOnly
    ? "You're viewing as another user. Exit View as user to make changes."
    : !canManage
      ? "You don't have permission to book appointments."
      : null;

  return (
    <section className="rounded-2xl border bg-card p-5" aria-labelledby="job-schedule-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="job-schedule-title" className="text-base font-semibold">
          Schedule
        </h3>
        <ReasonButton
          size="sm"
          variant="outline"
          disabledReason={manageReason}
          onClick={() => setBooking(true)}
        >
          <CalendarPlus aria-hidden />
          Book appointment
        </ReasonButton>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No upcoming appointments. Book the next visit so the customer knows what&apos;s next.
        </p>
      ) : (
        <ul className="flex flex-col divide-y" aria-label="Upcoming appointments">
          {open.map((a) => {
            const isToday = pacificIsoDate(a.startsAt) === today;
            const past = new Date(a.startsAt).getTime() < now;
            return (
              <li key={a.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {APPOINTMENT_TYPE_LABELS[a.type]}
                    <Badge variant={STATUS_VARIANT[a.status]}>
                      {APPOINTMENT_STATUS_LABELS[a.status]}
                    </Badge>
                    {isToday && <Badge variant="sample">Today</Badge>}
                    {past && !isToday && <Badge variant="warning">Past due</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatAppointment(a.startsAt)}
                    {a.assignees.length > 0 && ` · ${a.assignees.map((u) => u.name).join(", ")}`}
                  </p>
                </div>
                {canManage && !readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {a.status !== "confirmed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setStatus(a, "confirmed", "Appointment confirmed.")}
                      >
                        <CalendarCheck aria-hidden />
                        Confirm
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        a.type === "walkthrough"
                          ? setCompleting(a)
                          : setStatus(a, "completed", "Marked completed.")
                      }
                    >
                      <CheckCircle2 aria-hidden />
                      Mark completed
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={`More actions for ${APPOINTMENT_TYPE_LABELS[a.type]} on ${formatAppointment(a.startsAt)}`}
                        >
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => setStatus(a, "no_show", "Marked as a no-show.")}
                        >
                          <UserX aria-hidden />
                          No-show
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setCanceling(a)}>
                          <CalendarX aria-hidden />
                          Cancel appointment…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {closed.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Earlier appointments ({closed.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {closed.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span>{APPOINTMENT_TYPE_LABELS[a.type]}</span>
                <Badge variant={STATUS_VARIANT[a.status]}>
                  {APPOINTMENT_STATUS_LABELS[a.status]}
                  {a.result ? ` · ${WALKTHROUGH_RESULT_LABELS[a.result]}` : ""}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatAppointment(a.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canManage && !readOnly && (
        <>
          <BookDialog
            open={booking}
            onOpenChange={setBooking}
            jobId={jobId}
            users={users}
            defaultAssignee={defaultAssignee}
          />
          <CompleteWalkthroughDialog
            appointment={completing}
            onOpenChange={(o) => !o && setCompleting(null)}
          />
          <CancelDialog appointment={canceling} onOpenChange={(o) => !o && setCanceling(null)} />
        </>
      )}
    </section>
  );
}

function BookDialog({
  open,
  onOpenChange,
  jobId,
  users,
  defaultAssignee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  users: Option[];
  defaultAssignee: string;
}) {
  const [type, setType] = React.useState<AppointmentType>("walkthrough");
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("10:00");
  const [duration, setDuration] = React.useState(String(APPOINTMENT_DEFAULT_MINUTES.walkthrough));
  const [assignees, setAssignees] = React.useState<string[]>([defaultAssignee]);
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setType("walkthrough");
    setDate("");
    setTime("10:00");
    setDuration(String(APPOINTMENT_DEFAULT_MINUTES.walkthrough));
    setAssignees([defaultAssignee]);
    setNotes("");
    setErrors({});
  }, [open, defaultAssignee]);

  const submit = () => {
    const input = {
      job_id: jobId,
      type,
      date,
      time,
      duration_minutes: duration,
      assigned_user_ids: assignees,
      notes,
    };
    const parsed = bookAppointmentSchema.safeParse(input);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
      return setErrors(e);
    }
    setErrors({});
    startTransition(async () => {
      const r = await bookAppointment(input);
      if (r.ok) {
        toast.success(`${APPOINTMENT_TYPE_LABELS[type]} booked.`);
        onOpenChange(false);
      } else {
        const e: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(r.error.fieldErrors ?? {})) e[k] = v[0];
        setErrors(e);
        toast.error(r.error.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription>
            Times are Pacific. Production days are booked on the Master Schedule.
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
          <Field id="appt-type" label="Type" required error={errors.type}>
            <select
              className={selectClass}
              value={type}
              onChange={(e) => {
                const t = e.target.value as AppointmentType;
                setType(t);
                setDuration(String(APPOINTMENT_DEFAULT_MINUTES[t]));
              }}
              {...fieldAria("appt-type", errors.type)}
            >
              {BOOKABLE_APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {APPOINTMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="appt-date" label="Date" required error={errors.date}>
              <Input
                type="date"
                min={pacificIsoDate()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                {...fieldAria("appt-date", errors.date)}
              />
            </Field>
            <Field id="appt-time" label="Time (Pacific)" required error={errors.time}>
              <Input
                type="time"
                step={900}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                {...fieldAria("appt-time", errors.time)}
              />
            </Field>
            <Field id="appt-duration" label="Minutes" required error={errors.duration_minutes}>
              <Input
                type="number"
                min={15}
                max={720}
                step={15}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                {...fieldAria("appt-duration", errors.duration_minutes)}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Who&apos;s going</legend>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {users.map((u) => (
                <label key={u.value} className="flex min-h-8 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-bb-forest"
                    checked={assignees.includes(u.value)}
                    onChange={(e) =>
                      setAssignees((cur) =>
                        e.target.checked ? [...cur, u.value] : cur.filter((x) => x !== u.value),
                      )
                    }
                  />
                  {u.label}
                </label>
              ))}
            </div>
            {errors.assigned_user_ids && (
              <p role="alert" className="text-xs text-danger">
                {errors.assigned_user_ids}
              </p>
            )}
          </fieldset>
          <Field id="appt-notes" label="Notes" error={errors.notes}>
            <Textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              {...fieldAria("appt-notes", errors.notes)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Book appointment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Completing a walkthrough needs its result; "Measured" moves the job forward. */
function CompleteWalkthroughDialog({
  appointment,
  onOpenChange,
}: {
  appointment: AppointmentItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = React.useState<WalkthroughResult | "">("");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (appointment) {
      setResult("");
      setError(undefined);
    }
  }, [appointment]);

  return (
    <Dialog open={appointment !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Result the walkthrough</DialogTitle>
          <DialogDescription>
            {appointment ? formatAppointment(appointment.startsAt) : ""}. Choosing “Measured” moves
            the job to Walkthrough Complete.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!appointment) return;
            if (!result) return setError("Pick the walkthrough result.");
            setError(undefined);
            startTransition(async () => {
              const r = await setAppointmentStatus({
                id: appointment.id,
                status: "completed",
                result,
              });
              if (!r.ok) {
                setError(r.error.fieldErrors?.result?.[0]);
                toast.error(r.error.message);
                return;
              }
              if (r.data.advanced)
                toast.success("Walkthrough completed. Job moved to Walkthrough Complete.");
              else if (r.data.advanceError)
                toast.warning(`Walkthrough completed. ${r.data.advanceError}`);
              else toast.success("Walkthrough completed.");
              onOpenChange(false);
            });
          }}
        >
          <fieldset
            className="flex flex-col gap-2"
            aria-describedby={error ? "walkthrough-result-error" : undefined}
          >
            <legend className="mb-1 text-sm font-medium">
              Result
              <span className="text-danger" aria-hidden>
                *
              </span>
            </legend>
            {WALKTHROUGH_RESULTS.map((r) => (
              <label key={r} className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="walkthrough-result"
                  value={r}
                  className="size-4 accent-bb-forest"
                  checked={result === r}
                  onChange={() => setResult(r)}
                />
                {WALKTHROUGH_RESULT_LABELS[r]}
              </label>
            ))}
            {error && (
              <p id="walkthrough-result-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Save result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({
  appointment,
  onOpenChange,
}: {
  appointment: AppointmentItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    if (appointment) setNote("");
  }, [appointment]);
  return (
    <Dialog open={appointment !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this appointment?</DialogTitle>
          <DialogDescription>
            {appointment
              ? `${APPOINTMENT_TYPE_LABELS[appointment.type]} · ${formatAppointment(appointment.startsAt)}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!appointment) return;
            startTransition(async () => {
              const r = await setAppointmentStatus({
                id: appointment.id,
                status: "canceled",
                note,
              });
              if (r.ok) {
                toast.success("Appointment canceled.");
                onOpenChange(false);
              } else toast.error(r.error.message);
            });
          }}
        >
          <Field id="cancel-note" label="Reason (optional)">
            <Textarea
              id="cancel-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Cancel appointment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
