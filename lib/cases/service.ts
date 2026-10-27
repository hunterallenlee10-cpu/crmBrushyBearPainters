import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { firstWord } from "@/lib/domain/templates/words";
import type { MergeContext } from "@/lib/domain/templates/merge";
import { planSend, renderSend } from "@/lib/domain/workflows/plan";
import type { Recipient, RunContext } from "@/lib/domain/workflows/types";
import {
  loadCompanyMerge,
  loadMessagingSettings,
  loadTemplateLookup,
  recordOutbound,
} from "@/lib/messaging/core";
import { contactRecipient, loadRunContext } from "@/lib/workflows/context";

type Db = SupabaseClient<Database>;

/**
 * Case messages (SPEC §8.16): "We got your request" and "Warranty visit
 * booked", sent by a person from the case page. Same rules as every send:
 * consent and Do Not Contact block it, the template's wording is used and
 * the message only reaches the outbox ("Simulated – not sent"). One-to-one
 * sends a person starts aren't held for quiet hours (DECISIONS, Phase 3).
 */

export type CaseMessageResult =
  { sent: true; channel: "sms" | "email"; to: string } | { sent: false; reason: string };

export async function sendCaseMessage(
  service: Db,
  opts: {
    orgId: string;
    caseId: string;
    key: "case_received" | "case_visit_booked";
    channel: "sms" | "email";
    actor: { id: string; name: string };
    appointmentId?: string | null;
    now?: Date;
  },
): Promise<CaseMessageResult> {
  const now = opts.now ?? new Date();
  const { data: c } = await service
    .from("cases")
    .select("id, org_id, case_number, title, type, job_id, account_id, contact_id, sla_due_at")
    .eq("id", opts.caseId)
    .eq("org_id", opts.orgId)
    .maybeSingle();
  if (!c) return { sent: false, reason: "That case isn't available." };
  const settings = await loadMessagingSettings(service, opts.orgId);

  let ctx: RunContext | null = null;
  let thread: {
    subjectType: "job" | "lead" | "account";
    subjectId: string;
    contactId: string | null;
  } | null = null;
  if (c.job_id) {
    const run = await loadRunContext(
      service,
      opts.orgId,
      { type: "job", id: c.job_id },
      { type: "case.message", payload: {} },
      { now, customerThreadHours: settings.customerThreadHours, dryRun: false },
    );
    if (run) {
      ctx = run;
      thread = run.thread;
    }
  }
  if (!ctx) {
    // A customer-level case: the case's contact (or the account's primary one).
    let contactId = c.contact_id;
    if (!contactId && c.account_id) {
      const { data: a } = await service
        .from("accounts")
        .select("primary_contact_id")
        .eq("id", c.account_id)
        .maybeSingle();
      contactId = a?.primary_contact_id ?? null;
    }
    const { data: contact } = contactId
      ? await service.from("contacts").select("*").eq("id", contactId).maybeSingle()
      : { data: null };
    const recipient: Recipient | null = contact ? contactRecipient(contact, false) : null;
    const company = await loadCompanyMerge(service, opts.orgId);
    ctx = {
      merge: {
        company,
        contact: contact
          ? {
              first_name: contact.first_name,
              last_name: contact.last_name,
              full_name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
            }
          : null,
      },
      facts: {},
      recipients: { customer: recipient, crew_lead: null, subcontractor: null },
      people: {},
      customerInitiated: false,
    };
    thread = c.account_id
      ? { subjectType: "account", subjectId: c.account_id, contactId: contact?.id ?? null }
      : null;
  }

  let appointment: MergeContext | null = null;
  if (opts.key === "case_visit_booked") {
    const { data: a } = await service
      .from("appointments")
      .select("id, starts_at, ends_at, location")
      .eq("case_id", c.id)
      .is("deleted_at", null)
      .neq("status", "canceled")
      .order(opts.appointmentId ? "created_at" : "starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!a) return { sent: false, reason: "Schedule the visit first." };
    appointment = { id: a.id, start: a.starts_at, end: a.ends_at, location: a.location };
  }

  const merge: MergeContext = {
    ...ctx.merge,
    case: { number: c.case_number, title: c.title, type: c.type, sla_due_at: c.sla_due_at },
    ...(appointment ? { appointment } : {}),
    // The person sending signs it when the job has no point of contact.
    poc:
      ctx.merge.poc && typeof ctx.merge.poc === "object" && !Array.isArray(ctx.merge.poc)
        ? ctx.merge.poc
        : { first_name: firstWord(opts.actor.name), full_name: opts.actor.name },
  };
  const templates = await loadTemplateLookup(service, opts.orgId);
  const [plan] = planSend(
    {
      id: "case",
      label: "Case message",
      kind: "send",
      template: opts.key,
      channel: opts.channel,
      to: "customer",
    },
    { ...ctx, merge },
    templates,
    now,
    { ...settings.engine, quietHours: { ...settings.engine.quietHours, enabled: false } },
  );
  if (!plan) return { sent: false, reason: "Nothing to send." };
  if (plan.blocked) return { sent: false, reason: plan.blocked };
  const to = plan.channel === "sms" ? plan.recipient?.mobile : plan.recipient?.email;
  if (!to) return { sent: false, reason: "No address on file." };
  const rendered = renderSend(plan, merge, settings.footer);
  await recordOutbound(service, {
    orgId: opts.orgId,
    channel: plan.channel,
    to,
    subject: rendered.subject,
    body: rendered.body,
    messageType: plan.messageType,
    related: { type: "case", id: c.id },
    thread: thread ?? undefined,
    templateKey: opts.key,
    templateStatus: plan.template?.status ?? null,
    actorId: opts.actor.id,
  });
  return { sent: true, channel: plan.channel, to };
}
