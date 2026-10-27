import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure } from "@/lib/actions/errors";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import { plainTextToHtml } from "@/lib/leads/messaging";
import {
  jobContactBlockReason,
  sendJobEmail,
  sendJobSms,
  type JobRecipient,
  type MessagingJob,
} from "@/lib/jobs/messaging";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * System notices for production (Publish, rain delays, daily updates):
 * customer messages go through the same outbox path as people's messages
 * (consent and Do Not Contact apply; logged on the job's Messages), signed by
 * the job's point of contact; crew notices go to the crew lead's phone or
 * email through the outbox, plus an in-app notification. Nothing is sent.
 * Service client: callers have checked permissions.
 */

async function connectionStatus(service: Db, orgId: string, domain: "sms_voice" | "email") {
  const { data } = await service
    .from("integration_connections")
    .select("status")
    .eq("org_id", orgId)
    .eq("domain", domain)
    .maybeSingle();
  return data?.status ?? null;
}

function context(service: Db, orgId: string, actorId: string | null): IntegrationContext {
  return { orgId, actorId, sink: createSupabaseOutboxSink(service) };
}

export async function loadRecipient(service: Db, jobId: string): Promise<MessagingJob | null> {
  const { data: job } = await service
    .from("jobs")
    .select("id, org_id, primary_contact_id, lead_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  let contact: JobRecipient | null = null;
  if (job.primary_contact_id) {
    const { data: c } = await service
      .from("contacts")
      .select("id, first_name, last_name, mobile, phone, email, do_not_contact, opted_out_at")
      .eq("id", job.primary_contact_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (c) {
      contact = {
        id: c.id,
        name: [c.first_name, c.last_name].filter(Boolean).join(" "),
        mobile: c.mobile,
        phone: c.phone,
        email: c.email,
        doNotContact: c.do_not_contact,
        optedOutAt: c.opted_out_at,
      };
    }
  }
  let leadDisposition: string | null = null;
  if (job.lead_id) {
    const { data } = await service
      .from("leads")
      .select("disposition")
      .eq("id", job.lead_id)
      .maybeSingle();
    leadDisposition = data?.disposition ?? null;
  }
  return { id: job.id, orgId: job.org_id, contact, leadDisposition };
}

export type CustomerSendResult =
  | { status: "simulated"; channel: "sms" | "email"; messageId: string; outboxId: string }
  | { status: "skipped"; reason: string };

/** Texts the customer (or emails when texting isn't possible), tagged with a template key. */
export async function sendCustomerNotice(
  service: Db,
  jobId: string,
  input: {
    sms: string;
    emailSubject: string;
    emailBody: string;
    templateKey: string;
    actorId: string | null;
  },
): Promise<CustomerSendResult> {
  const job = await loadRecipient(service, jobId);
  if (!job) return { status: "skipped", reason: "The job isn't available." };
  const smsBlock = jobContactBlockReason(job.contact, "sms", {
    leadDisposition: job.leadDisposition,
  });
  const emailBlock = jobContactBlockReason(job.contact, "email", {
    leadDisposition: job.leadDisposition,
  });
  const ic = context(service, job.orgId, input.actorId);
  try {
    if (!smsBlock) {
      const provider = getSmsProvider(ic, {
        connectionStatus: await connectionStatus(service, job.orgId, "sms_voice"),
        envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
      });
      const r = await sendJobSms(service, provider, job, input.sms, {
        templateKey: input.templateKey,
      });
      return { status: "simulated", channel: "sms", ...r };
    }
    if (!emailBlock) {
      const provider = getEmailProvider(ic, {
        connectionStatus: await connectionStatus(service, job.orgId, "email"),
        envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
      });
      const r = await sendJobEmail(
        service,
        provider,
        job,
        { subject: input.emailSubject, body: input.emailBody },
        { templateKey: input.templateKey },
      );
      return { status: "simulated", channel: "email", ...r };
    }
  } catch (e) {
    if (e instanceof ActionFailure) return { status: "skipped", reason: e.error.message };
    throw e;
  }
  return { status: "skipped", reason: smsBlock ?? emailBlock ?? "No way to reach the customer." };
}

/** Crew notice to the crew lead (text, else email) through the outbox, plus in-app notifications. */
export async function sendCrewNotice(
  service: Db,
  input: {
    orgId: string;
    crewId: string;
    subject: string;
    body: string;
    link: string;
    related: { type: string; id: string };
    actorId: string | null;
  },
): Promise<{ outboxId: string | null; notified: number }> {
  const { data: crew } = await service
    .from("crews")
    .select("id, name, lead_user_id, members:crew_members(user_id, active)")
    .eq("id", input.crewId)
    .maybeSingle();
  if (!crew) return { outboxId: null, notified: 0 };
  const ic = context(service, input.orgId, input.actorId);
  let outboxId: string | null = null;
  if (crew.lead_user_id) {
    const { data: lead } = await service
      .from("profiles")
      .select("phone, email, is_active")
      .eq("id", crew.lead_user_id)
      .maybeSingle();
    try {
      if (lead?.is_active && lead.phone && /^\+[1-9]\d{7,14}$/.test(lead.phone)) {
        const sms = getSmsProvider(ic, {
          connectionStatus: await connectionStatus(service, input.orgId, "sms_voice"),
          envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
        });
        const r = await sms.send({
          to: lead.phone,
          body: `${input.subject}\n${input.body}`.slice(0, 1500),
          related: input.related,
          messageType: "transactional",
        });
        outboxId = r.outboxId ?? null;
      } else if (lead?.is_active && lead.email) {
        const email = getEmailProvider(ic, {
          connectionStatus: await connectionStatus(service, input.orgId, "email"),
          envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
        });
        const r = await email.send({
          to: lead.email,
          subject: input.subject,
          html: plainTextToHtml(input.body),
          text: input.body,
          related: input.related,
          messageType: "transactional",
        });
        outboxId = r.outboxId ?? null;
      }
    } catch (e) {
      logError("production.crew_notice", e);
    }
  }
  const users = new Set<string>();
  if (crew.lead_user_id) users.add(crew.lead_user_id);
  for (const m of crew.members ?? []) if (m.active && m.user_id) users.add(m.user_id);
  if (input.actorId) users.delete(input.actorId);
  if (users.size) {
    const { error } = await service.from("notifications").insert(
      [...users].map((user_id) => ({
        org_id: input.orgId,
        user_id,
        type: "schedule",
        title: input.subject.slice(0, 200),
        body: input.body.slice(0, 1000),
        link: input.link,
      })),
    );
    if (error) logError("production.crew_notice.notify", error);
  }
  return { outboxId, notified: users.size };
}

/** First name of the job's point of contact (the signature), else the company. */
export async function signerName(service: Db, jobId: string, fallback: string): Promise<string> {
  const { data } = await service
    .from("jobs")
    .select(
      "poc:profiles!jobs_point_of_contact_id_fkey(full_name), owner:profiles!jobs_owner_id_fkey(full_name)",
    )
    .eq("id", jobId)
    .maybeSingle();
  return data?.poc?.full_name ?? data?.owner?.full_name ?? fallback;
}
