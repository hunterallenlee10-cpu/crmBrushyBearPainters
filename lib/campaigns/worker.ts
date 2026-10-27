import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { planRecipients, type AudienceModule } from "@/lib/domain/campaigns";
import { inQuietHours, sendBlockReason } from "@/lib/domain/workflows/compliance";
import { renderSend, type SendPlan } from "@/lib/domain/workflows/plan";
import type { MergeContext } from "@/lib/domain/templates/merge";
import type { Recipient, TemplateRecord } from "@/lib/domain/workflows/types";
import { filterSchema } from "@/lib/lists/filters";
import { serverEnv } from "@/lib/env";
import { linkSecret, unsubscribeToken } from "@/lib/messaging/links";
import {
  appUrl,
  loadCompanyMerge,
  loadMessagingSettings,
  recordOutbound,
} from "@/lib/messaging/core";
import { logError } from "@/lib/log";
import { contactRecipient, leadRecipient } from "@/lib/workflows/context";
import { resolveAudience, type AudienceSpec } from "./audience";

type Db = SupabaseClient<Database>;
type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];

/**
 * Campaign worker (SPEC §8.11): a scheduled campaign whose time has come is
 * locked to "sending", its audience is frozen into campaign_recipients (with
 * the reason anyone is left out), and recipients go out in batches through
 * the outbox (simulated) with the STOP line or the footer and unsubscribe
 * link. Texts wait while quiet hours are on. Called every minute from
 * /api/cron/worker; every step is safe to repeat.
 */

export const BATCH = 100;

export function parseAudience(raw: unknown): AudienceSpec {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mod: AudienceModule = o.module === "leads" || o.module === "jobs" ? o.module : "contacts";
  const f = filterSchema.safeParse({ match: o.match, rules: o.rules });
  return { module: mod, ...(f.success ? f.data : { match: "all", rules: [] }) };
}

async function templateFor(service: Db, c: CampaignRow): Promise<TemplateRecord> {
  let status: "draft" | "approved" = "draft";
  let key = `campaign_${c.id.slice(0, 8)}`;
  let subject = c.subject;
  let body = c.body ?? "";
  if (c.template_id) {
    const { data: t } = await service
      .from("message_templates")
      .select("key, status, subject, body")
      .eq("id", c.template_id)
      .maybeSingle();
    if (t) {
      status = t.status === "approved" ? "approved" : "draft";
      key = t.key;
      // The campaign's own text wins (it starts as a copy of the template).
      if (!body.trim()) body = t.body;
      if (!subject) subject = t.subject;
    }
  }
  return {
    key,
    channel: c.channel === "email" ? "email" : "sms",
    subject,
    body,
    active: true,
    status,
    messageType: "marketing",
  };
}

/** Freezes the audience into recipients (once; later calls add nobody twice). */
export async function materializeRecipients(service: Db, c: CampaignRow): Promise<number> {
  const spec = parseAudience(c.audience);
  const { members } = await resolveAudience(service, spec, { orgId: c.org_id });
  const channel = c.channel === "email" ? "email" : "sms";
  const planned = planRecipients(members, channel);
  for (let i = 0; i < planned.length; i += 500) {
    const chunk = planned.slice(i, i + 500).map((p) => ({
      org_id: c.org_id,
      campaign_id: c.id,
      subject_type: p.subjectType,
      subject_id: p.subjectId,
      contact_id: p.subjectType === "contact" ? p.subjectId : null,
      lead_id: p.subjectType === "lead" ? p.subjectId : null,
      name: p.name.slice(0, 200),
      address: p.address?.slice(0, 320) ?? null,
      status: p.excluded ? ("excluded" as const) : ("pending" as const),
      exclusion_reason: p.excluded?.slice(0, 300) ?? null,
    }));
    const { error } = await service
      .from("campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_id,subject_type,subject_id", ignoreDuplicates: true });
    if (error) throw error;
  }
  return planned.length;
}

async function recipientNow(
  service: Db,
  r: { subject_type: string; subject_id: string },
): Promise<{
  recipient: Recipient | null;
  firstName: string;
  lastName: string | null;
  leadContactId: string | null;
}> {
  if (r.subject_type === "lead") {
    const { data: l } = await service
      .from("leads")
      .select("*")
      .eq("id", r.subject_id)
      .maybeSingle();
    if (!l) return { recipient: null, firstName: "", lastName: null, leadContactId: null };
    const { data: c } = l.contact_id
      ? await service.from("contacts").select("*").eq("id", l.contact_id).maybeSingle()
      : { data: null };
    return {
      recipient: leadRecipient(l, c ?? null),
      firstName: l.first_name,
      lastName: l.last_name,
      leadContactId: l.contact_id,
    };
  }
  const { data: c } = await service
    .from("contacts")
    .select("*")
    .eq("id", r.subject_id)
    .maybeSingle();
  if (!c) return { recipient: null, firstName: "", lastName: null, leadContactId: null };
  return {
    recipient: contactRecipient(c, false),
    firstName: c.first_name,
    lastName: c.last_name,
    leadContactId: null,
  };
}

/** Sends up to BATCH pending recipients. Returns how many went out. */
export async function sendBatch(
  service: Db,
  c: CampaignRow,
  now: Date,
): Promise<{ sent: number; left: number }> {
  const [settings, company, template] = await Promise.all([
    loadMessagingSettings(service, c.org_id),
    loadCompanyMerge(service, c.org_id),
    templateFor(service, c),
  ]);
  const channel = template.channel;
  if (channel === "sms" && inQuietHours(now, settings.engine.quietHours)) {
    return { sent: 0, left: -1 };
  }
  const { data: pending } = await service
    .from("campaign_recipients")
    .select("id, subject_type, subject_id, address")
    .eq("campaign_id", c.id)
    .eq("status", "pending")
    .order("created_at")
    .limit(BATCH);
  const secret = linkSecret(serverEnv());
  let sent = 0;
  for (const r of pending ?? []) {
    try {
      // Consent is checked again at send time (they may have opted out since).
      const who = await recipientNow(service, r);
      const plan: SendPlan = {
        channel,
        recipient: who.recipient,
        template,
        messageType: "marketing",
        blocked: null,
        deferUntil: null,
      };
      const blocked = sendBlockReason(who.recipient, channel, "marketing");
      const to = channel === "sms" ? who.recipient?.mobile : who.recipient?.email;
      if (blocked || !to) {
        await service
          .from("campaign_recipients")
          .update({
            status: "excluded",
            exclusion_reason: (blocked ?? "No address on file.").slice(0, 300),
          })
          .eq("id", r.id);
        continue;
      }
      const kind = r.subject_type === "lead" ? "lead" : "contact";
      const merge: MergeContext = {
        company,
        contact: {
          first_name: who.firstName,
          last_name: who.lastName,
          full_name: [who.firstName, who.lastName].filter(Boolean).join(" "),
        },
        unsubscribe: {
          link: secret
            ? appUrl(`/u/${unsubscribeToken({ kind, id: r.subject_id, orgId: c.org_id }, secret)}`)
            : null,
        },
      };
      const rendered = renderSend(plan, merge, settings.footer);
      const out = await recordOutbound(service, {
        orgId: c.org_id,
        channel,
        to,
        subject: rendered.subject,
        body: rendered.body,
        messageType: "marketing",
        related: { type: "campaign", id: c.id },
        thread:
          kind === "lead"
            ? { subjectType: "lead", subjectId: r.subject_id, contactId: who.leadContactId }
            : { subjectType: "contact", subjectId: r.subject_id, contactId: r.subject_id },
        templateKey: template.key,
        templateStatus: template.status,
        campaignId: c.id,
        actorId: c.created_by,
      });
      await service
        .from("campaign_recipients")
        .update({
          status: "sent",
          sent_at: now.toISOString(),
          message_id: out.messageId,
          outbox_id: out.outboxId,
          address: to.slice(0, 320),
        })
        .eq("id", r.id);
      sent++;
    } catch (e) {
      logError("campaigns.send", e);
      await service
        .from("campaign_recipients")
        .update({
          status: "failed",
          error: String(e instanceof Error ? e.message : e).slice(0, 500),
        })
        .eq("id", r.id);
    }
  }
  const { count } = await service
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", c.id)
    .eq("status", "pending");
  return { sent, left: count ?? 0 };
}

/** A copy to the person testing it (their own email or mobile), outbox only. */
export async function sendTest(
  service: Db,
  c: CampaignRow,
  to: { email: string | null; phone: string | null; firstName: string; actorId: string },
): Promise<{ to: string } | { error: string }> {
  const [settings, company, template] = await Promise.all([
    loadMessagingSettings(service, c.org_id),
    loadCompanyMerge(service, c.org_id),
    templateFor(service, c),
  ]);
  const address = template.channel === "sms" ? to.phone : to.email;
  if (!address) {
    return {
      error:
        template.channel === "sms"
          ? "Add your mobile number (+1 format) on Settings → Profile to get a test text."
          : "Your profile has no email address.",
    };
  }
  const plan: SendPlan = {
    channel: template.channel,
    recipient: null,
    template,
    messageType: "marketing",
    blocked: null,
    deferUntil: null,
  };
  const rendered = renderSend(
    plan,
    {
      company,
      contact: { first_name: to.firstName, last_name: null, full_name: to.firstName },
      unsubscribe: { link: appUrl("/u/test-link") },
    },
    settings.footer,
  );
  await recordOutbound(service, {
    orgId: c.org_id,
    channel: template.channel,
    to: address,
    subject: rendered.subject ? `[Test] ${rendered.subject}` : null,
    body: rendered.body,
    messageType: "marketing",
    related: { type: "campaign", id: c.id },
    templateKey: template.key,
    templateStatus: template.status,
    campaignId: c.id,
    actorId: to.actorId,
  });
  await service.from("campaigns").update({ last_test_at: new Date().toISOString() }).eq("id", c.id);
  return { to: address };
}

/** Marks recipients who booked or bought after the campaign reached them (90 days). */
async function sweepConversions(service: Db, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 90 * 24 * 3_600_000).toISOString();
  const { data } = await service
    .from("campaign_recipients")
    .select("id, subject_type, subject_id, sent_at")
    .eq("status", "sent")
    .is("converted_at", null)
    .gte("sent_at", since)
    .limit(500);
  let n = 0;
  for (const r of data ?? []) {
    if (!r.sent_at) continue;
    let at: string | null = null;
    if (r.subject_type === "lead") {
      const { data: l } = await service
        .from("leads")
        .select("walkthrough_at, converted_at")
        .eq("id", r.subject_id)
        .maybeSingle();
      const ts = [l?.walkthrough_at, l?.converted_at].filter(
        (x): x is string => !!x && x > r.sent_at!,
      );
      at = ts.sort()[0] ?? null;
    } else {
      const { data: j } = await service
        .from("jobs")
        .select("created_at")
        .eq("primary_contact_id", r.subject_id)
        .gt("created_at", r.sent_at)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      at = j?.created_at ?? null;
    }
    if (at) {
      await service.from("campaign_recipients").update({ converted_at: at }).eq("id", r.id);
      n++;
    }
  }
  return n;
}

export async function sweepCampaigns(service: Db, now = new Date()) {
  let campaigns = 0;
  let sent = 0;
  // Due → sending (one worker wins the update).
  const { data: due } = await service
    .from("campaigns")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .limit(10);
  for (const c of due ?? []) {
    const { data: locked } = await service
      .from("campaigns")
      .update({ status: "sending", started_at: c.started_at ?? now.toISOString() })
      .eq("id", c.id)
      .eq("status", "scheduled")
      .select("*")
      .maybeSingle();
    if (!locked) continue;
    try {
      await materializeRecipients(service, locked);
    } catch (e) {
      logError("campaigns.audience", e);
    }
  }
  const { data: sending } = await service
    .from("campaigns")
    .select("*")
    .eq("status", "sending")
    .order("started_at")
    .limit(5);
  for (const c of sending ?? []) {
    campaigns++;
    const r = await sendBatch(service, c, now);
    sent += r.sent;
    if (r.left === 0) {
      await service
        .from("campaigns")
        .update({ status: "sent", finished_at: now.toISOString() })
        .eq("id", c.id)
        .eq("status", "sending");
    }
  }
  const conversions = await sweepConversions(service, now);
  return { campaigns, sent, conversions };
}
