"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  ExternalLink,
  MessageSquareText,
  Phone,
  PhoneCall,
  SkipForward,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/forms/field";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { SmsCounter } from "@/components/leads/sms-counter";
import { TemplatePicker, type TemplateOption } from "@/components/messaging/template-picker";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { nextInQueue, type DispositionGroup } from "@/lib/domain/follow-ups";
import { formatDateTime } from "@/lib/format/dates";
import type { QueueItem } from "@/lib/follow-ups/lists";
import { cn } from "@/lib/utils";
import { sendSms } from "@/app/(app)/leads/[id]/actions";
import { sendJobSmsAction } from "@/app/(app)/jobs/[id]/_sections/actions";
import { logDisposition, placeFollowUpCall } from "../actions";

type Disposition = {
  key: string;
  label: string;
  group: DispositionGroup;
  requiresCallback: boolean;
  setsDoNotContact: boolean;
};

const GROUP_TONE: Record<DispositionGroup, string> = {
  positive: "border-success/40 data-[on=true]:bg-success data-[on=true]:text-white",
  won: "border-success/40 data-[on=true]:bg-bb-forest data-[on=true]:text-white",
  callback: "border-warning/40 data-[on=true]:bg-warning data-[on=true]:text-white",
  no_contact: "border-neutral/40 data-[on=true]:bg-neutral data-[on=true]:text-white",
  negative: "border-danger/40 data-[on=true]:bg-danger data-[on=true]:text-white",
};

/**
 * Power dialer (SPEC §11.4): one record at a time with the script, Call
 * (recorded to the outbox; tel: link on phones), Text from a template, and
 * the outcome grouped Positive / Negative / Callback / No Contact / Won.
 * Saving moves to the next record.
 */
export function PowerDialer({
  listKey,
  script,
  queue: initial,
  groups,
  templates,
  canSend,
}: {
  listKey: string;
  script: string;
  queue: QueueItem[];
  groups: { group: DispositionGroup; label: string; items: Disposition[] }[];
  templates: TemplateOption[];
  canSend: boolean;
}) {
  const [queue, setQueue] = React.useState(initial);
  const [currentKey, setCurrentKey] = React.useState<string | null>(initial[0]?.key ?? null);
  const [done, setDone] = React.useState(0);
  const current = queue.find((q) => q.key === currentKey) ?? null;

  const advance = (remove: boolean) => {
    if (!current) return;
    const next = nextInQueue(
      queue.map((q) => ({ ...q, id: q.key })),
      current.key,
    );
    if (remove) {
      setQueue((q) => q.filter((x) => x.key !== current.key));
      setDone((n) => n + 1);
    }
    setCurrentKey(next?.key ?? (remove ? null : (queue[0]?.key ?? null)));
  };

  if (!queue.length) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <p className="text-lg font-semibold">All caught up!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {done
            ? `You worked ${done} record${done === 1 ? "" : "s"}. They'll come back after the cooldown or at their callback time.`
            : "Nobody is due on this list right now."}
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/follow-ups">Back to all lists</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,20rem)]">
      <nav aria-label="Queue" className="order-3 rounded-2xl border bg-card lg:order-1">
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {queue.length} to go{done ? ` · ${done} done` : ""}
        </p>
        <ol className="max-h-[32rem] overflow-y-auto">
          {queue.map((q, i) => (
            <li key={q.key}>
              <button
                type="button"
                onClick={() => setCurrentKey(q.key)}
                aria-current={q.key === currentKey ? "true" : undefined}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/50",
                  q.key === currentKey && "bg-muted",
                )}
              >
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{q.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{q.reason}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {current && (
        <DialerCard
          key={current.key}
          item={current}
          listKey={listKey}
          groups={groups}
          templates={templates}
          canSend={canSend}
          onSaved={() => advance(true)}
          onSkip={() => advance(false)}
        />
      )}

      <aside
        aria-labelledby="dialer-script"
        className="order-2 rounded-2xl border bg-card p-4 lg:order-3"
      >
        <h2 id="dialer-script" className="mb-2 text-sm font-semibold">
          Script
        </h2>
        <p className="text-sm whitespace-pre-wrap">{script}</p>
      </aside>
    </div>
  );
}

function DialerCard({
  item,
  listKey,
  groups,
  templates,
  canSend,
  onSaved,
  onSkip,
}: {
  item: QueueItem;
  listKey: string;
  groups: { group: DispositionGroup; label: string; items: Disposition[] }[];
  templates: TemplateOption[];
  canSend: boolean;
  onSaved: () => void;
  onSkip: () => void;
}) {
  const { pending, run } = useRunAction();
  const [disposition, setDisposition] = React.useState<Disposition | null>(null);
  const [callbackAt, setCallbackAt] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [channel, setChannel] = React.useState<"call" | "sms" | "none">("call");
  const [texting, setTexting] = React.useState(false);
  const [sms, setSms] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const subject = item.messageSubject;

  const call = () =>
    run(
      () =>
        placeFollowUpCall({
          listKey,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          messageSubject: item.messageSubject,
        }),
      {
        success: (r) => `Call to ${formatPhone(r.to)} recorded (Simulated – not placed).`,
        onOk: () => setChannel("call"),
      },
    );

  const sendText = () => {
    if (!subject) return;
    run(
      () =>
        subject.type === "lead"
          ? sendSms({ lead_id: subject.id, body: sms })
          : sendJobSmsAction({ job_id: subject.id, body: sms }),
      {
        success: "Text recorded (Simulated – not sent).",
        onOk: () => {
          setTexting(false);
          setSms("");
          setChannel("sms");
        },
      },
    );
  };

  const save = () => {
    if (!disposition) {
      setErrors({ disposition: "Pick what happened." });
      return;
    }
    if (disposition.requiresCallback && !callbackAt) {
      setErrors({ callbackAt: "Pick when to call back." });
      return;
    }
    setErrors({});
    run(
      () =>
        logDisposition({
          listKey,
          subjectType: item.subjectType,
          subjectId: item.subjectId,
          messageSubject: item.messageSubject,
          dispositionKey: disposition.key,
          channel,
          notes,
          callbackAt,
        }),
      {
        success: (r) => `Logged: ${r.disposition}.`,
        onOk: onSaved,
        onError: (e) => setErrors(firstErrors(e)),
      },
    );
  };

  return (
    <section
      aria-labelledby="dialer-current"
      className="order-1 flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-5 lg:order-2"
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 id="dialer-current" className="text-lg font-semibold">
            {item.name}
          </h2>
          <Link
            href={item.href}
            className="inline-flex items-center gap-1 text-sm text-bb-forest underline"
          >
            Open record <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">{item.reason}</p>
        <p className="mt-2 text-sm">
          {item.phone ? (
            <span className="font-medium tabular-nums">{formatPhone(item.phone)}</span>
          ) : (
            <span className="text-muted-foreground">No phone on file</span>
          )}
          {item.email ? <span className="text-muted-foreground"> · {item.email}</span> : null}
        </p>
        {item.lastAttempt && (
          <p className="mt-2 rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            Last: {item.lastAttempt.disposition.replaceAll("_", " ")} ·{" "}
            {formatDateTime(item.lastAttempt.at)}
            {item.lastAttempt.notes ? ` — ${item.lastAttempt.notes}` : ""}
          </p>
        )}
      </div>

      {canSend && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={call} disabled={pending || !item.phone}>
            <PhoneCall className="size-4" aria-hidden /> Call
          </Button>
          {item.phone && (
            <Button asChild variant="outline" className="sm:hidden">
              <a href={`tel:${item.phone}`}>
                <Phone className="size-4" aria-hidden /> Dial on this phone
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => setTexting((t) => !t)}
            disabled={pending || !subject}
            aria-expanded={texting}
          >
            <MessageSquareText className="size-4" aria-hidden /> Text
          </Button>
        </div>
      )}

      {texting && subject && (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <TemplatePicker
            subjectType={subject.type}
            subjectId={subject.id}
            channel="sms"
            templates={templates}
            idPrefix="dialer-template"
            onPick={(t) => setSms(t.body)}
          />
          <Field id="dialer-sms" label="Text message">
            <Textarea
              id="dialer-sms"
              value={sms}
              onChange={(e) => setSms(e.target.value)}
              rows={3}
              maxLength={1600}
              aria-describedby="dialer-sms-count"
            />
          </Field>
          <SmsCounter text={sms} id="dialer-sms-count" />
          <Button
            type="button"
            size="sm"
            onClick={sendText}
            disabled={pending || !sms.trim()}
            className="self-start"
          >
            Send text
          </Button>
        </div>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">What happened?</legend>
        {groups.map((g) => (
          <div key={g.group} role="group" aria-label={g.label} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{g.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {g.items.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  data-on={disposition?.key === d.key}
                  aria-pressed={disposition?.key === d.key}
                  onClick={() => setDisposition(d)}
                  className={cn("rounded-full border px-3 py-1 text-sm", GROUP_TONE[g.group])}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {errors.disposition && (
          <p role="alert" className="text-xs text-danger">
            {errors.disposition}
          </p>
        )}
      </fieldset>
      {disposition?.setsDoNotContact && (
        <p className="text-sm text-danger" role="status">
          This marks them Do Not Contact: no more texts, emails or follow-up calls.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="dialer-callback"
          label={disposition?.requiresCallback ? "Call back at" : "Call back at (optional)"}
          error={errors.callbackAt}
        >
          <Input
            id="dialer-callback"
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        </Field>
        <Field id="dialer-channel" label="How you reached out">
          <select
            id="dialer-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as "call" | "sms" | "none")}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="call">Called</option>
            <option value="sms">Texted</option>
            <option value="none">Didn&apos;t reach out</option>
          </select>
        </Field>
      </div>
      <Field id="dialer-notes" label="Notes (optional)">
        <Textarea
          id="dialer-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending || !canSend}>
          Save &amp; next <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" onClick={onSkip} disabled={pending}>
          <SkipForward className="size-4" aria-hidden /> Skip
        </Button>
        {!canSend && (
          <Badge variant="neutral">Logging outcomes needs “Send customer messages”.</Badge>
        )}
      </div>
    </section>
  );
}
