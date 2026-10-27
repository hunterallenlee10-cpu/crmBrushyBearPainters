"use client";

import * as React from "react";
import {
  Loader2,
  Mail,
  MessageSquareText,
  Phone,
  PhoneCall,
  Send,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { SmsCounter } from "@/components/leads/sms-counter";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  jobCallRecipient,
  jobContactBlockReason,
  jobSmsRecipient,
  type JobRecipient,
} from "@/lib/jobs/messaging";
import type { Option } from "@/lib/leads/service";
import { selectClass } from "@/app/(app)/leads/[id]/labels";
import { logJobCallAction, sendJobEmailAction, sendJobSmsAction } from "./actions";
import { jobCallSchema, jobEmailSchema, jobSmsSchema } from "./schemas";

type Mode = "sms" | "email" | "call";

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: "sms", label: "Text (SMS)", icon: MessageSquareText },
  { id: "email", label: "Email", icon: Mail },
  { id: "call", label: "Log call", icon: PhoneCall },
];

type Errors = Record<string, string | undefined>;

function zodErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) out[String(i.path[0] ?? "_form")] ??= i.message;
  return out;
}

function firstErrors(fieldErrors: Record<string, string[]> | undefined): Errors {
  const out: Errors = {};
  for (const [k, v] of Object.entries(fieldErrors ?? {})) out[k] = v[0];
  return out;
}

/**
 * Text / Email / Log call to the job's primary contact (SPEC §8.5 #11).
 * Sends only reach the integrations outbox ("Simulated – not sent").
 */
export function MessageComposer({
  jobId,
  contact,
  leadDisposition,
  outcomes,
  readOnly,
}: {
  jobId: string;
  contact: JobRecipient | null;
  leadDisposition: string | null;
  outcomes: Option[];
  readOnly: boolean;
}) {
  const [mode, setMode] = React.useState<Mode>("sms");
  const [sms, setSms] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [emailBody, setEmailBody] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [callNotes, setCallNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, startTransition] = React.useTransition();

  const reason = (ch: Mode) => jobContactBlockReason(contact, ch, { leadDisposition });
  const blocked = mode === "call" ? null : reason(mode);
  const callWarning = mode === "call" ? reason("call") : null;
  const readOnlyReason = readOnly
    ? "You're viewing as another user. Exit View as user to send or log anything."
    : null;
  const disabled = Boolean(readOnlyReason || blocked) || pending;
  const callDisabled = Boolean(readOnlyReason) || pending;
  const smsTo = jobSmsRecipient(contact);
  const callTo = jobCallRecipient(contact);

  function run(
    action: () => Promise<
      | { ok: true }
      | { ok: false; error: { message: string; fieldErrors?: Record<string, string[]> } }
    >,
    success: string,
    reset: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        setErrors({});
        reset();
      } else {
        setErrors(firstErrors(result.error.fieldErrors));
        toast.error(result.error.message);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "sms") {
      if (disabled) return;
      const input = { job_id: jobId, body: sms };
      const parsed = jobSmsSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        () => sendJobSmsAction(input),
        "Text recorded in the outbox (simulated, not sent).",
        () => setSms(""),
      );
    } else if (mode === "email") {
      if (disabled) return;
      const input = { job_id: jobId, subject, body: emailBody };
      const parsed = jobEmailSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        () => sendJobEmailAction(input),
        "Email recorded in the outbox (simulated, not sent).",
        () => {
          setSubject("");
          setEmailBody("");
        },
      );
    } else {
      if (callDisabled) return;
      const input = { job_id: jobId, outcome, duration_minutes: minutes, notes: callNotes };
      const parsed = jobCallSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        () => logJobCallAction(input),
        "Call logged.",
        () => {
          setOutcome("");
          setMinutes("");
          setCallNotes("");
        },
      );
    }
  }

  return (
    <section aria-labelledby="job-composer-title" className="rounded-2xl border bg-card p-4 sm:p-5">
      <h2 id="job-composer-title" className="mb-1 text-base font-semibold">
        Message the customer
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        To:{" "}
        <span className="font-medium text-foreground">
          {contact ? contact.name : "no primary contact"}
        </span>
      </p>
      <div role="group" aria-label="Message type" className="mb-4 flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <Button
            key={m.id}
            type="button"
            size="sm"
            variant={mode === m.id ? "default" : "outline"}
            aria-pressed={mode === m.id}
            onClick={() => {
              setMode(m.id);
              setErrors({});
            }}
          >
            <m.icon aria-hidden />
            {m.label}
          </Button>
        ))}
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        {mode !== "call" && (
          <Field id="job-composer-template" label="Template">
            <select id="job-composer-template" className={selectClass} disabled>
              <option>Templates arrive in Phase 8</option>
            </select>
          </Field>
        )}

        {(readOnlyReason || blocked) && (
          <p role="status" className="flex items-start gap-1.5 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {readOnlyReason ?? blocked}
          </p>
        )}

        {mode === "sms" && (
          <>
            <p className="text-sm text-muted-foreground">
              Mobile:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {smsTo ? formatPhone(smsTo) : "none on file"}
              </span>
            </p>
            <Field id="job-composer-sms" label="Text message" error={errors.body}>
              <Textarea
                value={sms}
                onChange={(e) => setSms(e.target.value)}
                rows={4}
                maxLength={1600}
                disabled={disabled}
                {...fieldAria("job-composer-sms", errors.body)}
                aria-describedby={
                  errors.body
                    ? "job-composer-sms-error job-composer-sms-count"
                    : "job-composer-sms-count"
                }
              />
            </Field>
            <SmsCounter text={sms} id="job-composer-sms-count" />
          </>
        )}

        {mode === "email" && (
          <>
            <p className="text-sm break-all text-muted-foreground">
              Email:{" "}
              <span className="font-medium text-foreground">
                {contact?.email ?? "none on file"}
              </span>
            </p>
            <Field id="job-composer-subject" label="Subject" error={errors.subject}>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={disabled}
                {...fieldAria("job-composer-subject", errors.subject)}
              />
            </Field>
            <Field id="job-composer-email" label="Message" error={errors.body}>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={6}
                disabled={disabled}
                {...fieldAria("job-composer-email", errors.body)}
              />
            </Field>
          </>
        )}

        {mode === "call" && (
          <>
            {callTo && !callWarning && (
              <Button asChild variant="outline" size="sm" className="self-start">
                <a href={`tel:${callTo}`}>
                  <Phone aria-hidden />
                  Dial {formatPhone(callTo)} from your phone
                </a>
              </Button>
            )}
            {callWarning && !readOnlyReason && (
              <p role="status" className="flex items-start gap-1.5 text-sm text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {callWarning} You can still log a call that already happened.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Calling from the CRM arrives when a phone provider is connected. For now, call from
              your phone and log the outcome here.
            </p>
            <Field id="job-composer-outcome" label="Outcome" required error={errors.outcome}>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className={selectClass}
                disabled={callDisabled}
                {...fieldAria("job-composer-outcome", errors.outcome)}
              >
                <option value="">Pick an outcome…</option>
                {outcomes
                  .filter((o) => o.active !== false)
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              id="job-composer-minutes"
              label="Duration (minutes)"
              error={errors.duration_minutes}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                disabled={callDisabled}
                className="w-32"
                {...fieldAria("job-composer-minutes", errors.duration_minutes)}
              />
            </Field>
            <Field id="job-composer-call-notes" label="Call notes" error={errors.notes}>
              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
                disabled={callDisabled}
                {...fieldAria("job-composer-call-notes", errors.notes)}
              />
            </Field>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">
            {mode === "call"
              ? "Logged calls show in this job's message history."
              : "Nothing is sent in this build: it's recorded in the outbox as simulated."}
          </p>
          <Button type="submit" variant="cta" disabled={mode === "call" ? callDisabled : disabled}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {mode === "sms" ? "Send text" : mode === "email" ? "Send email" : "Log call"}
          </Button>
        </div>
      </form>
    </section>
  );
}
