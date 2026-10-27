"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  type Frequency,
} from "@/lib/domain/reports/schedule";
import { deleteSchedule, saveSchedule } from "../actions";

type Opt = { value: string; label: string };
const selectClass =
  "h-9 min-w-0 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

export function ScheduleForm({
  reports,
  people,
  defaultReport,
  defaultRecipient,
  readOnly,
}: {
  reports: Opt[];
  people: Opt[];
  defaultReport: string | null;
  defaultRecipient: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [report, setReport] = React.useState(defaultReport ?? reports[0]?.value ?? "");
  const [frequency, setFrequency] = React.useState<Frequency>("weekly");
  const [weekday, setWeekday] = React.useState(1);
  const [monthDay, setMonthDay] = React.useState(1);
  const [hour, setHour] = React.useState(7);
  const [recipients, setRecipients] = React.useState<string[]>([defaultRecipient]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveSchedule({
        report_id: report,
        frequency,
        weekday: frequency === "weekly" ? weekday : null,
        month_day: frequency === "monthly" ? monthDay : null,
        hour,
        recipient_ids: recipients,
        active: true,
      });
      if (!res.ok) {
        setError(
          res.error.fieldErrors
            ? (Object.values(res.error.fieldErrors).flat()[0] ?? res.error.message)
            : res.error.message,
        );
        return;
      }
      toast.success("Delivery scheduled.");
      router.refresh();
    });
  }

  if (reports.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        Save a report first, then schedule it here.
      </p>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      aria-label="New scheduled delivery"
    >
      <fieldset disabled={readOnly || pending} className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">New scheduled delivery</legend>
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-report" className="text-xs font-medium text-muted-foreground">
            Report
          </label>
          <select
            id="sf-report"
            className={selectClass}
            value={report}
            onChange={(e) => setReport(e.target.value)}
          >
            {reports.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-frequency" className="text-xs font-medium text-muted-foreground">
            How often
          </label>
          <select
            id="sf-frequency"
            className={selectClass}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        {frequency === "weekly" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="sf-weekday" className="text-xs font-medium text-muted-foreground">
              On
            </label>
            <select
              id="sf-weekday"
              className={selectClass}
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
            >
              {WEEKDAY_LABELS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        {frequency === "monthly" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="sf-day" className="text-xs font-medium text-muted-foreground">
              Day of month
            </label>
            <select
              id="sf-day"
              className={selectClass}
              value={monthDay}
              onChange={(e) => setMonthDay(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="sf-hour" className="text-xs font-medium text-muted-foreground">
            At (Pacific)
          </label>
          <select
            id="sf-hour"
            className={selectClass}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-48 flex-col gap-1">
          <label htmlFor="sf-recipients" className="text-xs font-medium text-muted-foreground">
            Recipients
          </label>
          <select
            id="sf-recipients"
            multiple
            className={`${selectClass} h-24`}
            value={recipients}
            onChange={(e) =>
              setRecipients(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
          >
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="cta" disabled={!report || recipients.length === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Schedule
        </Button>
      </fieldset>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function ScheduleRowActions({
  schedule,
  readOnly,
}: {
  schedule: {
    id: string;
    report_id: string;
    frequency: Frequency;
    weekday: number | null;
    month_day: number | null;
    hour: number;
    recipient_ids: string[];
    active: boolean;
  };
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error?.message ?? "Something went wrong.");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={readOnly || pending}
        aria-label={schedule.active ? "Pause delivery" : "Resume delivery"}
        onClick={() =>
          run(
            () => saveSchedule({ ...schedule, active: !schedule.active }),
            schedule.active ? "Paused." : "Resumed.",
          )
        }
      >
        {schedule.active ? <Pause aria-hidden /> : <Play aria-hidden />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={readOnly || pending}
        aria-label="Delete delivery"
        onClick={() => run(() => deleteSchedule({ id: schedule.id }), "Deleted.")}
      >
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
