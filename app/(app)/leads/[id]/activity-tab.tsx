"use client";

import * as React from "react";
import {
  CalendarCheck,
  CircleDot,
  Loader2,
  Mail,
  MessageSquareText,
  Phone,
  PhoneCall,
  Send,
  Sparkles,
  UserRoundCog,
  Voicemail,
  Globe,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { SmsCounter } from "@/components/leads/sms-counter";
import { formatDateTime } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";
import { smsRecipient, type ContactChannel } from "@/lib/leads/messaging";
import { cn } from "@/lib/utils";
import { choices, selectClass, type Labeler } from "./labels";
import { logCall, sendEmail, sendSms } from "./actions";
import { logCallSchema, sendEmailSchema, sendSmsSchema } from "./schemas";
import type { LeadDetailData, ThreadItem } from "./types";

export type ComposerMode = "sms" | "email" | "call";

const MODES: { id: ComposerMode; label: string; icon: React.ElementType }[] = [
  { id: "sms", label: "Text (SMS)", icon: MessageSquareText },
  { id: "email", label: "Email", icon: Mail },
  { id: "call", label: "Log call", icon: PhoneCall },
];

type Errors = Record<string, string | undefined>;

function firstErrors(fieldErrors: Record<string, string[]> | undefined): Errors {
  const out: Errors = {};
  for (const [k, v] of Object.entries(fieldErrors ?? {})) out[k] = v[0];
  return out;
}

function zodErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? "_form");
    out[k] ??= i.message;
  }
  return out;
}

export function ActivityTab({
  data,
  label,
  composer,
  reasonFor,
}: {
  data: LeadDetailData;
  label: Labeler;
  composer: { mode: ComposerMode; nonce: number };
  reasonFor: (channel: ContactChannel) => string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="print:hidden">
        {data.can.send || data.readOnly ? (
          <Composer data={data} label={label} composer={composer} reasonFor={reasonFor} />
        ) : (
          <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
            You can read this lead&apos;s history but not message customers. Ask an owner for the
            &ldquo;Send customer messages&rdquo; permission.
          </p>
        )}
      </div>
      <Thread data={data} label={label} />
    </div>
  );
}

function Composer({
  data,
  label,
  composer,
  reasonFor,
}: {
  data: LeadDetailData;
  label: Labeler;
  composer: { mode: ComposerMode; nonce: number };
  reasonFor: (channel: ContactChannel) => string | null;
}) {
  const { lead } = data;
  const [mode, setMode] = React.useState<ComposerMode>(composer.mode);
  const [sms, setSms] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [emailBody, setEmailBody] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [callNotes, setCallNotes] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [pending, startTransition] = React.useTransition();
  const rootRef = React.useRef<HTMLElement>(null);
  const smsRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const outcomeRef = React.useRef<HTMLSelectElement>(null);

  // Header buttons (Call / SMS / Email) switch the mode and focus the first field.
  React.useEffect(() => {
    if (composer.nonce === 0) return;
    setMode(composer.mode);
    setErrors({});
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const target =
        composer.mode === "sms" ? smsRef : composer.mode === "email" ? subjectRef : outcomeRef;
      target.current?.focus();
    });
  }, [composer]);

  const blocked = mode === "call" ? null : reasonFor(mode);
  const callWarning = mode === "call" ? reasonFor("call") : null;
  const readOnlyReason = data.readOnly
    ? "You're viewing as another user. Exit View as user to send or log anything."
    : null;
  const disabled = Boolean(readOnlyReason || blocked) || pending;
  const smsTo = smsRecipient(lead);
  const callTo = lead.mobile ?? lead.phone;

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
    if (disabled) return;
    if (mode === "sms") {
      const input = { lead_id: lead.id, body: sms };
      const parsed = sendSmsSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        async () => sendSms(input),
        "Text recorded in the outbox (simulated, not sent).",
        () => setSms(""),
      );
    } else if (mode === "email") {
      const input = { lead_id: lead.id, subject, body: emailBody };
      const parsed = sendEmailSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        async () => sendEmail(input),
        "Email recorded in the outbox (simulated, not sent).",
        () => {
          setSubject("");
          setEmailBody("");
        },
      );
    } else {
      const input = {
        lead_id: lead.id,
        outcome,
        duration_minutes: minutes,
        notes: callNotes,
      };
      const parsed = logCallSchema.safeParse(input);
      if (!parsed.success) return setErrors(zodErrors(parsed.error.issues));
      run(
        async () => logCall(input),
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
    <section
      ref={rootRef}
      aria-labelledby="composer-title"
      className="scroll-mt-48 rounded-2xl border bg-card p-5"
    >
      <h2 id="composer-title" className="mb-3 text-base font-semibold">
        Reach out
      </h2>
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
          <Field id="composer-template" label="Template">
            <select id="composer-template" className={selectClass} disabled>
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
              To:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {smsTo ? formatPhone(smsTo) : "no number"}
              </span>
              {smsTo && smsTo === lead.mobile ? " (mobile)" : ""}
            </p>
            <Field id="composer-sms" label="Text message" error={errors.body}>
              <Textarea
                ref={smsRef}
                value={sms}
                onChange={(e) => setSms(e.target.value)}
                rows={4}
                maxLength={1600}
                disabled={disabled}
                {...fieldAria("composer-sms", errors.body)}
                aria-describedby={
                  errors.body ? "composer-sms-error composer-sms-count" : "composer-sms-count"
                }
              />
            </Field>
            <SmsCounter text={sms} id="composer-sms-count" />
          </>
        )}

        {mode === "email" && (
          <>
            <p className="text-sm text-muted-foreground">
              To: <span className="font-medium text-foreground">{lead.email ?? "no email"}</span>
            </p>
            <Field id="composer-subject" label="Subject" error={errors.subject}>
              <Input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={disabled}
                {...fieldAria("composer-subject", errors.subject)}
              />
            </Field>
            <Field id="composer-email" label="Message" error={errors.body}>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={6}
                disabled={disabled}
                {...fieldAria("composer-email", errors.body)}
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
            <Field id="composer-outcome" label="Outcome" required error={errors.outcome}>
              <select
                ref={outcomeRef}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className={selectClass}
                disabled={Boolean(readOnlyReason) || pending}
                {...fieldAria("composer-outcome", errors.outcome)}
              >
                <option value="">Pick an outcome…</option>
                {choices(data.options, "lead_disposition").map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="composer-minutes" label="Duration (minutes)" error={errors.duration_minutes}>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                disabled={Boolean(readOnlyReason) || pending}
                className="w-32"
                {...fieldAria("composer-minutes", errors.duration_minutes)}
              />
            </Field>
            <Field id="composer-call-notes" label="Call notes" error={errors.notes}>
              <Textarea
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                rows={3}
                disabled={Boolean(readOnlyReason) || pending}
                {...fieldAria("composer-call-notes", errors.notes)}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              The outcome also becomes the lead&apos;s disposition
              {lead.disposition ? ` (now: ${label("lead_disposition", lead.disposition)})` : ""}.
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">
            {mode === "call"
              ? "Logging counts as contact for speed to lead."
              : "Nothing is sent in this build: it's recorded in the outbox as simulated."}
          </p>
          <Button
            type="submit"
            variant="cta"
            disabled={mode === "call" ? Boolean(readOnlyReason) || pending : disabled}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
            {mode === "sms" ? "Send text" : mode === "email" ? "Send email" : "Log call"}
          </Button>
        </div>
      </form>
    </section>
  );
}

const EVENT_ICONS: Record<string, React.ElementType> = {
  lead_created: Sparkles,
  status_changed: CircleDot,
  owner_changed: UserRoundCog,
  walkthrough_booked: CalendarCheck,
  first_contact: PhoneCall,
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  sms: MessageSquareText,
  email: Mail,
  call: PhoneCall,
  voicemail: Voicemail,
  portal: Globe,
};

function messageTitle(m: Extract<ThreadItem, { kind: "message" }>): string {
  const to = m.to ? (m.channel === "email" ? m.to : formatPhone(m.to)) : null;
  const inbound = m.direction === "inbound";
  switch (m.channel) {
    case "sms":
      return inbound ? "Text received" : `Text${to ? ` to ${to}` : ""}`;
    case "email":
      return inbound ? "Email received" : `Email${to ? ` to ${to}` : ""}`;
    case "call":
      return inbound ? "Incoming call logged" : `Call logged${to ? ` · ${to}` : ""}`;
    case "voicemail":
      return "Voicemail";
    case "portal":
      return inbound ? "Portal message received" : "Portal message";
  }
}

function Thread({ data, label }: { data: LeadDetailData; label: Labeler }) {
  return (
    <section aria-labelledby="thread-title" className="rounded-2xl border bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="thread-title" className="text-base font-semibold">
          Activity
        </h2>
        <span className="text-xs text-muted-foreground">Newest first · Pacific time</span>
      </div>
      {!data.can.readMessages && (
        <p className="mb-3 text-xs text-muted-foreground">
          Customer messages are hidden for your role; system activity is shown.
        </p>
      )}
      {data.thread.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No activity yet. Send a text or log a call to get started.
        </p>
      ) : (
        <ol className="flex flex-col">
          {data.thread.map((item, i) => {
            const last = i === data.thread.length - 1;
            if (item.kind === "event") {
              const Icon = EVENT_ICONS[item.type] ?? CircleDot;
              return (
                <li key={`e-${item.id}`} className="relative flex gap-3 pb-4">
                  {!last && (
                    <span aria-hidden className="absolute top-7 bottom-0 left-3.5 w-px bg-border" />
                  )}
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 pt-1 text-sm">
                    <p>{item.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                      {item.byName ? ` · ${item.byName}` : " · System"}
                    </p>
                  </div>
                </li>
              );
            }
            const Icon = CHANNEL_ICONS[item.channel] ?? MessageSquareText;
            return (
              <li key={`m-${item.id}`} className="relative flex gap-3 pb-4">
                {!last && (
                  <span aria-hidden className="absolute top-7 bottom-0 left-3.5 w-px bg-border" />
                )}
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full",
                    item.direction === "inbound"
                      ? "bg-info-bg text-info"
                      : "bg-bb-forest text-white",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 rounded-xl border bg-background p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{messageTitle(item)}</span>
                    {item.status === "simulated" && (
                      <Badge variant="sample">Simulated – not sent</Badge>
                    )}
                    {item.status === "failed" && <Badge variant="danger">Failed</Badge>}
                  </div>
                  {item.channel === "call" && (
                    <p className="mt-1 text-muted-foreground">
                      Outcome: {label("lead_disposition", item.callOutcome) ?? "—"}
                      {item.callDurationSeconds
                        ? ` · ${formatDuration(item.callDurationSeconds)}`
                        : ""}
                    </p>
                  )}
                  {item.subject && <p className="mt-1 font-medium">{item.subject}</p>}
                  {item.body && <p className="mt-1 break-words whitespace-pre-wrap">{item.body}</p>}
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                    {item.byName ? ` · ${item.byName}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {data.truncated.thread && (
        <p className="mt-2 text-xs text-muted-foreground">Showing the latest 200 entries.</p>
      )}
    </section>
  );
}
