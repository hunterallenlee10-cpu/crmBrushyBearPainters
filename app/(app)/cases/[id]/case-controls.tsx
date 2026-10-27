"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Mail, MessageSquareText, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/forms/native-select";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { CASE_STATUSES, CASE_STATUS_LABELS, CASE_PRIORITIES } from "@/lib/domain/cases";
import { caseVisitSchema, updateCaseSchema } from "@/lib/validation/cases";
import { scheduleCaseVisit, sendCaseMessageAction, updateCase } from "../actions";

type Opt = { value: string; label: string };

function issues(list: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of list) out[String(i.path[0] ?? "_form")] ??= i.message;
  return out;
}

/** Status, priority, owner, link to a job, and the resolution note. */
export function CaseControls({
  id,
  status,
  priority,
  ownerId,
  users,
  jobs,
  hasJob,
}: {
  id: string;
  status: string;
  priority: string;
  ownerId: string | null;
  users: Opt[];
  jobs: Opt[];
  hasJob: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [next, setNext] = React.useState(status);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const resolving =
    next !== status && (next === "resolved" || (next === "closed" && status !== "resolved"));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => {
      const v = f.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const parsed = updateCaseSchema.safeParse({
      id,
      status: next !== status ? s("status") : undefined,
      priority: s("priority"),
      ownerId: s("ownerId") ?? null,
      jobId: s("jobId"),
      resolution: s("resolution") ?? "",
    });
    if (!parsed.success) {
      setErrors(issues(parsed.error.issues));
      return;
    }
    setErrors({});
    run(() => updateCase(parsed.data), {
      success: "Case updated.",
      onOk: () => router.refresh(),
      onError: (err) => setErrors(firstErrors(err)),
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="case-controls"
      className="flex flex-col gap-3 rounded-2xl border bg-card p-5"
    >
      <h2 id="case-controls" className="text-base font-semibold">
        Work the case
      </h2>
      <Field id="case-status" label="Status">
        <NativeSelect
          id="case-status"
          name="status"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={pending}
        >
          {CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CASE_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {resolving && (
        <Field id="case-resolution" label="What was done" error={errors.resolution}>
          <Textarea
            id="case-resolution"
            name="resolution"
            rows={3}
            maxLength={5000}
            disabled={pending}
          />
        </Field>
      )}
      <Field id="case-priority-edit" label="Priority">
        <NativeSelect
          id="case-priority-edit"
          name="priority"
          defaultValue={priority}
          disabled={pending}
        >
          {CASE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p === "normal" ? "Normal" : p === "high" ? "High" : "Urgent"}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="case-owner-edit" label="Owner">
        <NativeSelect
          id="case-owner-edit"
          name="ownerId"
          defaultValue={ownerId ?? ""}
          disabled={pending}
        >
          <option value="">Nobody</option>
          {users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {!hasJob && jobs.length > 0 && (
        <Field id="case-link-job" label="Link to a job">
          <NativeSelect id="case-link-job" name="jobId" defaultValue="" disabled={pending}>
            <option value="">Leave unlinked</option>
            {jobs.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        <Save className="size-4" aria-hidden /> Save
      </Button>
    </form>
  );
}

/** Book a warranty visit on the case's job. */
export function CaseVisitForm({
  caseId,
  users,
  canMessage,
}: {
  caseId: string;
  users: Opt[];
  canMessage: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => {
      const v = f.get(k);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const who = s("assignee");
    const parsed = caseVisitSchema.safeParse({
      caseId,
      date: s("date") ?? "",
      time: s("time") ?? "",
      durationMinutes: s("duration") ?? "60",
      assignedUserIds: who ? [who] : [],
      notes: s("notes") ?? "",
      confirm: s("confirm") ?? "none",
    });
    if (!parsed.success) {
      setErrors(issues(parsed.error.issues));
      return;
    }
    setErrors({});
    run(() => scheduleCaseVisit(parsed.data), {
      success: "Warranty visit booked.",
      onOk: (r) => {
        if (r.confirmProblem) toast.warning(`The confirmation didn't go: ${r.confirmProblem}`);
        form.reset();
        router.refresh();
      },
      onError: (err) => setErrors(firstErrors(err)),
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Schedule a warranty visit</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="visit-date" label="Date" error={errors.date}>
          <Input id="visit-date" name="date" type="date" disabled={pending} />
        </Field>
        <Field id="visit-time" label="Time" error={errors.time}>
          <Input id="visit-time" name="time" type="time" defaultValue="09:00" disabled={pending} />
        </Field>
        <Field id="visit-duration" label="Minutes" error={errors.durationMinutes}>
          <Input
            id="visit-duration"
            name="duration"
            type="number"
            min={15}
            max={480}
            defaultValue={60}
            disabled={pending}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="visit-assignee" label="Who goes">
          <NativeSelect id="visit-assignee" name="assignee" defaultValue="" disabled={pending}>
            <option value="">The job owner</option>
            {users.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {canMessage && (
          <Field id="visit-confirm" label="Confirm with the customer">
            <NativeSelect id="visit-confirm" name="confirm" defaultValue="none" disabled={pending}>
              <option value="none">Don&apos;t send anything</option>
              <option value="sms">Text the visit time</option>
              <option value="email">Email the visit time</option>
            </NativeSelect>
          </Field>
        )}
      </div>
      <Field id="visit-notes" label="Notes for the visit (optional)">
        <Textarea id="visit-notes" name="notes" rows={2} maxLength={2000} disabled={pending} />
      </Field>
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <Button type="submit" disabled={pending} className="self-start">
        <CalendarPlus className="size-4" aria-hidden /> Book visit
      </Button>
    </form>
  );
}

/** Send "We got your request" or "Warranty visit booked" (simulated). */
export function CaseMessages({ caseId, hasVisit }: { caseId: string; hasVisit: boolean }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const send = (key: "case_received" | "case_visit_booked", channel: "sms" | "email") =>
    run(() => sendCaseMessageAction({ caseId, key, channel }), {
      success: (r) => (r.sent ? `Recorded for ${r.to} (Simulated – not sent).` : "Not sent."),
      onOk: () => router.refresh(),
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => send("case_received", "sms")}
        >
          <MessageSquareText className="size-4" aria-hidden /> Text “We got it”
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => send("case_received", "email")}
        >
          <Mail className="size-4" aria-hidden /> Email “We got it”
        </Button>
      </div>
      {hasVisit && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => send("case_visit_booked", "sms")}
          >
            <MessageSquareText className="size-4" aria-hidden /> Text the visit time
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => send("case_visit_booked", "email")}
          >
            <Mail className="size-4" aria-hidden /> Email the visit time
          </Button>
        </div>
      )}
    </div>
  );
}
