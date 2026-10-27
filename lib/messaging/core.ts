import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import { plainTextToHtml } from "@/lib/leads/messaging";
import type { MergeContext } from "@/lib/domain/templates/merge";
import type { EngineSettings, TemplateLookup, TemplateRecord } from "@/lib/domain/workflows/types";
import type { FooterSettings } from "@/lib/domain/workflows/plan";

type Db = SupabaseClient<Database>;

/**
 * Shared server side of automated messaging (workflows, drips, campaigns,
 * inbound replies): company merge fields, messaging settings, the template
 * lookup, and the one send path that records a simulated message in
 * `integration_outbox` and, for customers, on the record's thread in
 * `messages` (transactional vs marketing, workflow run or campaign). Service
 * client only: callers decide who may send. Nothing is ever really sent
 * (SPEC §2.1); a real provider would also refuse unapproved templates.
 */

export type MessagingSettings = {
  engine: EngineSettings;
  footer: FooterSettings;
  customerThreadHours: number;
  caseSlaBusinessDays: number;
};

export async function loadMessagingSettings(
  service: Db,
  orgId: string,
): Promise<MessagingSettings> {
  const { data } = await service
    .from("messaging_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  return {
    engine: {
      quietHours: {
        enabled: data?.quiet_hours_enabled ?? true,
        start: (data?.quiet_hours_start ?? "20:00").slice(0, 5),
        end: (data?.quiet_hours_end ?? "08:00").slice(0, 5),
      },
      reviewDelayDays: data?.review_delay_days ?? 2,
      referralInviteDelayDays: data?.referral_invite_delay_days ?? 14,
    },
    footer: {
      smsOptOutText: data?.sms_opt_out_text ?? "Reply STOP to opt out.",
      emailFooter: data?.email_footer ?? "Brushy Bear Painters · [MAILING_ADDRESS]",
    },
    customerThreadHours: data?.customer_thread_hours ?? 24,
    caseSlaBusinessDays: data?.case_sla_business_days ?? 2,
  };
}

/** Company merge fields (placeholders stay placeholders). */
export async function loadCompanyMerge(service: Db, orgId: string): Promise<MergeContext> {
  const { data } = await service
    .from("company_settings")
    .select(
      "company_name, phone, email, hours_text, website_url, review_link, referral_reward_cents",
    )
    .eq("org_id", orgId)
    .maybeSingle();
  return {
    name: data?.company_name ?? "Brushy Bear Painters",
    phone: data?.phone ?? "[PHONE]",
    email: data?.email ?? "[EMAIL]",
    hours: data?.hours_text ?? "[HOURS]",
    website: data?.website_url ?? "brushybear.vercel.app",
    review_link: data?.review_link ?? null,
    referral_reward_cents: data?.referral_reward_cents ?? null,
  };
}

export type TemplateRow = Database["public"]["Tables"]["message_templates"]["Row"];

export function toTemplateRecord(t: TemplateRow): TemplateRecord {
  return {
    key: t.key,
    channel: t.channel === "email" ? "email" : "sms",
    subject: t.subject,
    body: t.body,
    active: t.active,
    status: t.status === "approved" ? "approved" : "draft",
    messageType: t.message_type === "marketing" ? "marketing" : "transactional",
  };
}

/** Every template of the company, as a lookup (one query). */
export async function loadTemplateLookup(service: Db, orgId: string): Promise<TemplateLookup> {
  const { data, error } = await service.from("message_templates").select("*").eq("org_id", orgId);
  if (error) throw error;
  const map = new Map<string, TemplateRecord>();
  for (const t of data ?? []) map.set(`${t.key}:${t.channel}`, toTemplateRecord(t));
  return (key, channel) => map.get(`${key}:${channel}`) ?? null;
}

async function connectionStatus(service: Db, orgId: string, domain: "sms_voice" | "email") {
  const { data } = await service
    .from("integration_connections")
    .select("status")
    .eq("org_id", orgId)
    .eq("domain", domain)
    .maybeSingle();
  return data?.status ?? null;
}

export function appUrl(path: string): string {
  return `${serverEnv().APP_URL.replace(/\/+$/, "")}${path}`;
}

export type OutboundMessage = {
  orgId: string;
  channel: "sms" | "email";
  to: string;
  subject?: string | null;
  body: string;
  messageType: "transactional" | "marketing";
  /** The record the message is about (outbox `related`). */
  related: { type: string; id: string };
  /**
   * Log it on a customer thread (messages + thread). Omit for staff and
   * subcontractor notices, which only go to the outbox.
   */
  thread?: {
    subjectType: "lead" | "job" | "account" | "contact";
    subjectId: string;
    contactId: string | null;
  };
  templateKey?: string | null;
  templateStatus?: "draft" | "approved" | null;
  workflowRunId?: string | null;
  campaignId?: string | null;
  actorId?: string | null;
};

export type SentMessage = { outboxId: string; messageId: string | null };

/** Records one simulated message: outbox row (+ message on the thread for customers). */
export async function recordOutbound(service: Db, m: OutboundMessage): Promise<SentMessage> {
  const ic: IntegrationContext = {
    orgId: m.orgId,
    actorId: m.actorId ?? null,
    sink: createSupabaseOutboxSink(service),
  };
  let outboxId: string | undefined;
  if (m.channel === "sms") {
    // No `fetch` is passed: even a wrongly chosen real provider could not make a request.
    const provider = getSmsProvider(ic, {
      connectionStatus: await connectionStatus(service, m.orgId, "sms_voice"),
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    if (provider.provider !== "outbox")
      throw new Error("Messages only go to the outbox in this build.");
    const r = await provider.send({
      to: m.to,
      body: m.body,
      related: m.related,
      messageType: m.messageType,
    });
    outboxId = r.outboxId;
  } else {
    const provider = getEmailProvider(ic, {
      connectionStatus: await connectionStatus(service, m.orgId, "email"),
      envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
    });
    if (provider.provider !== "outbox")
      throw new Error("Messages only go to the outbox in this build.");
    const r = await provider.send({
      to: m.to,
      subject: m.subject ?? "",
      html: plainTextToHtml(m.body),
      text: m.body,
      related: m.related,
      messageType: m.messageType,
    });
    outboxId = r.outboxId;
  }
  if (!outboxId) throw new Error("The outbox did not return an entry id.");
  if (m.templateKey || m.workflowRunId || m.campaignId) {
    // Show where the message came from on the outbox row (best effort).
    const { data: row } = await service
      .from("integration_outbox")
      .select("payload")
      .eq("id", outboxId)
      .maybeSingle();
    const payload =
      row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? row.payload
        : {};
    await service
      .from("integration_outbox")
      .update({
        payload: {
          ...payload,
          template_key: m.templateKey ?? null,
          template_status: m.templateStatus ?? null,
          workflow_run_id: m.workflowRunId ?? null,
          campaign_id: m.campaignId ?? null,
        },
      })
      .eq("id", outboxId);
  }
  let messageId: string | null = null;
  if (m.thread) {
    const { data, error } = await service
      .from("messages")
      .insert({
        org_id: m.orgId,
        channel: m.channel,
        direction: "outbound",
        subject_type: m.thread.subjectType,
        subject_id: m.thread.subjectId,
        contact_id: m.thread.contactId,
        to_address: m.to,
        email_subject: m.channel === "email" ? (m.subject ?? null) : null,
        body: m.body,
        status: "simulated",
        simulated: true,
        outbox_id: outboxId,
        template_key: m.templateKey ?? null,
        message_type: m.messageType,
        workflow_run_id: m.workflowRunId ?? null,
        campaign_id: m.campaignId ?? null,
        sent_by: m.actorId ?? null,
      })
      .select("id")
      .single();
    if (error) throw error;
    messageId = data.id;
  }
  return { outboxId, messageId };
}
