import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { renderTemplate, lookup, type MergeContext } from "@/lib/domain/templates/merge";
import { allHold, anyHolds, describeCondition, firstFailing } from "./conditions";
import {
  PACIFIC,
  quietHoursUntil,
  sendBlockReason,
  withEmailFooter,
  withSmsOptOut,
  type Channel,
} from "./compliance";
import {
  AUDIENCE_LABELS,
  type Audience,
  type Duration,
  type EngineSettings,
  type NotifyAction,
  type Person,
  type Recipient,
  type RunContext,
  type SendAction,
  type TaskAction,
  type TemplateLookup,
  type TemplateRecord,
  type WaitAction,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowTrigger,
} from "./types";

/**
 * The workflow planner (pure). The same decisions drive real runs (the server
 * executor performs the side effects) and the dry-run "Test" (simulateWorkflow
 * walks every step on a simulated clock and sends nothing).
 */

export function durationMs(d: Duration): number {
  return ((d.days ?? 0) * 24 * 60 + (d.hours ?? 0) * 60 + (d.minutes ?? 0)) * 60_000;
}

export function describeDuration(d: Duration): string {
  const parts: string[] = [];
  if (d.days) parts.push(`${d.days} day${d.days === 1 ? "" : "s"}`);
  if (d.hours) parts.push(`${d.hours} hour${d.hours === 1 ? "" : "s"}`);
  if (d.minutes) parts.push(`${d.minutes} minute${d.minutes === 1 ? "" : "s"}`);
  return parts.join(" ") || "no time";
}

// --- Triggers -------------------------------------------------------------------

export type TriggerMatch =
  { matched: true; trigger: WorkflowTrigger } | { matched: false; reason: string };

/** Does this event start the workflow? (event type + the trigger's conditions) */
export function matchTrigger(
  def: WorkflowDefinition,
  eventType: string,
  facts: MergeContext,
): TriggerMatch {
  const candidates = def.triggers.filter((t) => t.event === eventType);
  if (!candidates.length) return { matched: false, reason: `It doesn't listen to ${eventType}.` };
  for (const t of candidates) if (allHold(t.when, facts)) return { matched: true, trigger: t };
  const failing = firstFailing(candidates[0]?.when, facts);
  return {
    matched: false,
    reason: failing ? `Not started: ${describeCondition(failing)} is not true.` : "Not started.",
  };
}

/** The subject id an event refers to for this trigger. */
export function subjectIdFor(
  trigger: WorkflowTrigger,
  event: { aggregate_id: string | null; payload: Record<string, unknown> },
): string | null {
  if (!trigger.subjectFrom || trigger.subjectFrom === "aggregate") return event.aggregate_id;
  const v = event.payload[trigger.subjectFrom.payload];
  return typeof v === "string" ? v : null;
}

// --- Waits ------------------------------------------------------------------------

function pacificDateOf(at: Date): string {
  const z = toZonedTime(at, PACIFIC);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type WaitDecision =
  { kind: "until"; until: Date; description: string } | { kind: "missing"; description: string };

/** When a wait step ends (in real time), from the context and settings. */
export function waitUntil(
  action: WaitAction,
  facts: MergeContext,
  startedAt: Date,
  settings: EngineSettings,
): WaitDecision {
  const settingDays =
    action.setting === "review_delay_days"
      ? settings.reviewDelayDays
      : action.setting === "referral_invite_delay_days"
        ? settings.referralInviteDelayDays
        : null;
  if (action.until) {
    const raw = lookup(facts, action.until.field);
    if (typeof raw !== "string" || !raw) {
      return { kind: "missing", description: `${action.until.field} is empty.` };
    }
    const offset: Duration =
      settingDays !== null ? { days: settingDays } : (action.until.offset ?? {});
    const sign = action.until.before ? -1 : 1;
    let until: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const day = addDaysIso(raw, sign * (offset.days ?? 0));
      const time = action.until.atPacificTime ?? "09:00";
      until = fromZonedTime(`${day}T${time}:00`, PACIFIC);
      until = new Date(
        until.getTime() + sign * durationMs({ hours: offset.hours, minutes: offset.minutes }),
      );
    } else {
      const base = new Date(raw);
      if (Number.isNaN(base.getTime())) {
        return { kind: "missing", description: `${action.until.field} isn't a date.` };
      }
      until = new Date(base.getTime() + sign * durationMs(offset));
      if (action.until.atPacificTime) {
        until = fromZonedTime(`${pacificDateOf(until)}T${action.until.atPacificTime}:00`, PACIFIC);
      }
    }
    return { kind: "until", until, description: action.label };
  }
  const d: Duration = settingDays !== null ? { days: settingDays } : (action.for ?? {});
  return {
    kind: "until",
    until: new Date(startedAt.getTime() + durationMs(d)),
    description: `Wait ${describeDuration(d)}`,
  };
}

// --- Sends ------------------------------------------------------------------------

export type SendPlan = {
  channel: Channel;
  recipient: Recipient | null;
  template: TemplateRecord | null;
  messageType: "transactional" | "marketing";
  /** Why it can't go (consent, no address, template off). */
  blocked: string | null;
  /** Quiet hours: send at this time instead. */
  deferUntil: Date | null;
};

function channelsFor(action: SendAction): Channel[][] {
  switch (action.channel) {
    case "sms":
      return [["sms"]];
    case "email":
      return [["email"]];
    case "sms_and_email":
      return [["sms"], ["email"]];
    case "sms_or_email":
      return [["sms", "email"]];
    case "email_or_sms":
      return [["email", "sms"]];
  }
}

function planOne(
  action: SendAction,
  channel: Channel,
  ctx: RunContext,
  templates: TemplateLookup,
  now: Date,
  settings: EngineSettings,
): SendPlan {
  const recipient = ctx.recipients[action.to];
  const template = templates(action.template, channel);
  const messageType = template?.messageType ?? "transactional";
  let blocked: string | null = null;
  if (!template)
    blocked = `There's no ${channel === "sms" ? "text" : "email"} template “${action.template}”.`;
  else if (!template.active)
    blocked = `The ${channel === "sms" ? "text" : "email"} template “${action.template}” is turned off.`;
  else blocked = sendBlockReason(recipient, channel, messageType);
  const deferUntil =
    !blocked && channel === "sms"
      ? quietHoursUntil(now, settings.quietHours, { customerInitiated: ctx.customerInitiated })
      : null;
  return { channel, recipient, template, messageType, blocked, deferUntil };
}

/**
 * The messages a send step makes. "sms_or_email" texts when it can and emails
 * otherwise; "sms_and_email" makes two independent messages.
 */
export function planSend(
  action: SendAction,
  ctx: RunContext,
  templates: TemplateLookup,
  now: Date,
  settings: EngineSettings,
): SendPlan[] {
  return channelsFor(action).map((options) => {
    const plans = options.map((c) => planOne(action, c, ctx, templates, now, settings));
    return plans.find((p) => !p.blocked) ?? (plans[0] as SendPlan);
  });
}

export type RenderedSend = {
  subject: string | null;
  body: string;
  missing: string[];
  placeholders: string[];
};

export type FooterSettings = { smsOptOutText: string; emailFooter: string };

/** The message as it would go out (marketing gets the STOP line / unsubscribe footer). */
export function renderSend(
  plan: SendPlan,
  merge: MergeContext,
  footer: FooterSettings,
  opts: { missingAs?: "blank" | "marker" } = {},
): RenderedSend {
  const t = plan.template as TemplateRecord;
  const body = renderTemplate(t.body, merge, opts);
  const subject = t.subject ? renderTemplate(t.subject, merge, opts) : null;
  let text = body.text;
  if (plan.messageType === "marketing") {
    if (plan.channel === "sms") text = withSmsOptOut(text, footer.smsOptOutText);
    else {
      const link = lookup(merge, "unsubscribe.link");
      text = withEmailFooter(
        text,
        footer.emailFooter,
        typeof link === "string" ? link : "[unsubscribe link]",
      );
    }
  }
  const missing = [...new Set([...body.missing, ...(subject?.missing ?? [])])];
  const placeholders = [...new Set([...body.placeholders, ...(subject?.placeholders ?? [])])];
  return { subject: subject?.text ?? null, body: text, missing, placeholders };
}

// --- Staff notices and tasks --------------------------------------------------------

/** People for a list of audiences (deduped, first audience first). */
export function resolveAudience(
  audiences: readonly Audience[],
  people: RunContext["people"],
  opts: { exclude?: readonly string[] } = {},
): Person[] {
  const out = new Map<string, Person>();
  const exclude = new Set(opts.exclude ?? []);
  for (const a of audiences)
    for (const p of people[a] ?? []) if (!exclude.has(p.id)) out.set(p.id, p);
  return [...out.values()];
}

export function jobPeopleIds(people: RunContext["people"]): string[] {
  return [
    ...(people.job_owner ?? []),
    ...(people.point_of_contact ?? []),
    ...(people.project_manager ?? []),
  ].map((p) => p.id);
}

export type NotifyPlan = { to: Person[]; title: string; body: string; missing: string[] };

export function planNotify(
  action: NotifyAction,
  ctx: RunContext,
  templates: TemplateLookup,
): NotifyPlan | { blocked: string } {
  const email = templates(action.template, "email");
  const sms = templates(action.template, "sms");
  if (!email && !sms) return { blocked: `There's no template “${action.template}”.` };
  if (email && !email.active && sms && !sms.active) {
    return { blocked: `The template “${action.template}” is turned off.` };
  }
  const to = resolveAudience(action.audience, ctx.people, {
    exclude: action.excludeJobPeople ? jobPeopleIds(ctx.people) : [],
  });
  if (!to.length) {
    return {
      blocked: `Nobody to tell (${action.audience.map((a) => AUDIENCE_LABELS[a]).join(", ")}).`,
    };
  }
  const title = renderTemplate(email?.subject ?? sms?.body ?? action.label, ctx.merge);
  const body = renderTemplate(sms?.body ?? email?.body ?? "", ctx.merge);
  return {
    to,
    title: title.text.slice(0, 200),
    body: body.text.slice(0, 1000),
    missing: [...new Set([...title.missing, ...body.missing])],
  };
}

export type TaskPlan = {
  assignee: Person | null;
  title: string;
  dueAt: Date;
  priority: TaskAction["priority"];
};

export function planTask(action: TaskAction, ctx: RunContext, now: Date): TaskPlan {
  const assignee = resolveAudience(action.assignee, ctx.people)[0] ?? null;
  return {
    assignee,
    title: renderTemplate(action.title, ctx.merge).text.slice(0, 200),
    dueAt: new Date(now.getTime() + durationMs(action.dueIn)),
    priority: action.priority,
  };
}

// --- Exit -----------------------------------------------------------------------------

export function shouldExit(def: WorkflowDefinition, facts: MergeContext): string | null {
  if (!def.exitWhen?.length) return null;
  const hit = def.exitWhen.find((c) => anyHolds([c], facts));
  return hit ? (def.exitLabel ?? `Stopped: ${describeCondition(hit)}.`) : null;
}

// --- Dry run --------------------------------------------------------------------------

export type SimulatedSend = {
  channel: Channel;
  to: string | null;
  address: string | null;
  subject: string | null;
  body: string;
  missing: string[];
  placeholders: string[];
  templateStatus: "draft" | "approved" | null;
  messageType: "transactional" | "marketing";
  blocked: string | null;
  deferredUntil: string | null;
};

export type SimulatedStep = {
  index: number;
  actionId: string;
  kind: WorkflowAction["kind"];
  label: string;
  /** Simulated time the step runs. */
  at: string;
  outcome: "would_run" | "skipped" | "would_wait" | "blocked";
  detail: string;
  sends?: SimulatedSend[];
  task?: { title: string; assignee: string | null; dueAt: string; priority: string };
  notify?: { to: string[]; title: string; body: string };
};

export type Simulation = {
  matched: boolean;
  reason: string | null;
  steps: SimulatedStep[];
  /** When the run would finish (simulated). */
  endsAt: string;
};

export type SimulationOptions = {
  now: Date;
  settings: EngineSettings;
  templates: TemplateLookup;
  footer: FooterSettings;
  eventType?: string;
};

function sendLine(s: SimulatedSend): string {
  const ch = s.channel === "sms" ? "Text" : "Email";
  if (s.blocked) return `${ch} not sent: ${s.blocked}`;
  const when = s.deferredUntil ? ` at ${s.deferredUntil} (quiet hours)` : "";
  return `${ch} to ${s.to ?? "the recipient"}${s.address ? ` (${s.address})` : ""}${when}`;
}

/**
 * Walk the whole workflow against a record without sending anything (Admin →
 * Workflows → Test). Waits move a simulated clock forward; quiet hours, consent
 * and missing merge fields show exactly as they would on a real run. Later
 * changes to the record (an accepted estimate, a canceled walkthrough) can stop
 * a real run early; the exit rule is listed with the result.
 */
export function simulateWorkflow(
  def: WorkflowDefinition,
  ctx: RunContext,
  opts: SimulationOptions,
): Simulation {
  const eventType = opts.eventType ?? def.triggers[0]?.event ?? "";
  const match = matchTrigger(def, eventType, ctx.facts);
  if (!match.matched) {
    return { matched: false, reason: match.reason, steps: [], endsAt: opts.now.toISOString() };
  }
  let clock = new Date(opts.now);
  let skipNext = false;
  const steps: SimulatedStep[] = [];
  def.actions.forEach((action, index) => {
    const base = {
      index,
      actionId: action.id,
      kind: action.kind,
      label: action.label,
      at: clock.toISOString(),
    };
    if (skipNext) {
      skipNext = false;
      steps.push({ ...base, outcome: "skipped", detail: "Skipped: its time had already passed." });
      return;
    }
    if (!allHold(action.when, ctx.facts)) {
      const f = firstFailing(action.when, ctx.facts);
      steps.push({
        ...base,
        outcome: "skipped",
        detail: `Skipped: ${f ? describeCondition(f) : "a condition"} is not true.`,
      });
      return;
    }
    switch (action.kind) {
      case "wait": {
        const w = waitUntil(action, ctx.facts, clock, opts.settings);
        if (w.kind === "missing") {
          steps.push({ ...base, outcome: "skipped", detail: `Can't wait: ${w.description}` });
          if (action.ifPast === "skip_next") skipNext = true;
          return;
        }
        if (w.until.getTime() <= clock.getTime()) {
          steps.push({ ...base, outcome: "skipped", detail: "That time has already passed." });
          if (action.ifPast === "skip_next") skipNext = true;
          return;
        }
        steps.push({
          ...base,
          outcome: "would_wait",
          detail: `Would wait until ${w.until.toISOString()}.`,
        });
        clock = w.until;
        return;
      }
      case "send": {
        const plans = planSend(action, ctx, opts.templates, clock, opts.settings);
        const sends: SimulatedSend[] = plans.map((p) => {
          const rendered = p.template
            ? renderSend(p, ctx.merge, opts.footer, { missingAs: "marker" })
            : { subject: null, body: "", missing: [], placeholders: [] };
          const missingBlock =
            !p.blocked && rendered.missing.length
              ? `Missing ${rendered.missing.map((m) => `{{${m}}}`).join(", ")}.`
              : null;
          return {
            channel: p.channel,
            to: p.recipient?.name ?? null,
            address:
              p.channel === "sms" ? (p.recipient?.mobile ?? null) : (p.recipient?.email ?? null),
            subject: rendered.subject,
            body: rendered.body,
            missing: rendered.missing,
            placeholders: rendered.placeholders,
            templateStatus: p.template?.status ?? null,
            messageType: p.messageType,
            blocked: p.blocked ?? missingBlock,
            deferredUntil: p.deferUntil ? p.deferUntil.toISOString() : null,
          };
        });
        const ok = sends.some((s) => !s.blocked);
        steps.push({
          ...base,
          outcome: ok ? "would_run" : "blocked",
          detail: sends.map(sendLine).join(" · "),
          sends,
        });
        return;
      }
      case "notify": {
        const n = planNotify(action, ctx, opts.templates);
        if ("blocked" in n) {
          steps.push({ ...base, outcome: "blocked", detail: n.blocked });
          return;
        }
        steps.push({
          ...base,
          outcome: "would_run",
          detail: `Notify ${n.to.map((p) => p.name).join(", ")}: ${n.title}`,
          notify: { to: n.to.map((p) => p.name), title: n.title, body: n.body },
        });
        return;
      }
      case "task": {
        const t = planTask(action, ctx, clock);
        steps.push({
          ...base,
          outcome: t.assignee ? "would_run" : "blocked",
          detail: t.assignee
            ? `Task for ${t.assignee.name}: “${t.title}”, due ${t.dueAt.toISOString()}`
            : "Nobody to give the task to.",
          task: {
            title: t.title,
            assignee: t.assignee?.name ?? null,
            dueAt: t.dueAt.toISOString(),
            priority: t.priority,
          },
        });
        return;
      }
      case "webhook":
        steps.push({
          ...base,
          outcome: "blocked",
          detail: "Webhooks are turned off in this build.",
        });
        return;
      case "calendar":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: "Calendar event recorded in the outbox (calendar not connected).",
        });
        return;
      case "enroll_drip":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: `Enroll in the drip “${action.drip}”.`,
        });
        return;
      case "assign_owner":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: "Assign the next estimator for the lead's territory (round robin).",
        });
        return;
      case "hold":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: `${action.mode === "add" ? "Place" : "Release"} the ${action.holdType} hold.`,
        });
        return;
      case "set_field":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: `Set ${action.field} to ${typeof action.value === "string" ? action.value : `${action.value.days} days from now`}.`,
        });
        return;
      case "attention":
        steps.push({
          ...base,
          outcome: "would_run",
          detail: `Open an Attention item: ${action.title}`,
        });
        return;
    }
  });
  return { matched: true, reason: null, steps, endsAt: clock.toISOString() };
}
