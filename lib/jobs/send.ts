import "server-only";
import type { ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, check } from "@/lib/actions/errors";
import { serverEnv } from "@/lib/env";
import { type IntegrationContext } from "@/lib/integrations/core";
import { getEmailProvider, type EmailSendInput } from "@/lib/integrations/email";
import { createSupabaseOutboxSink } from "@/lib/integrations/outbox-sink";
import { getSmsProvider } from "@/lib/integrations/sms_voice";
import {
  sendJobEmail,
  sendJobSms,
  type JobRecipient,
  type MessagingJob,
  type SentJobMessage,
} from "@/lib/jobs/messaging";

/**
 * Server side of job messaging for actions: loads the job's recipient through
 * the person's own client (row security), picks the outbox providers, and
 * sends (simulated). Shared by Messages, Onboarding requests and photo sharing.
 */

const NOT_FOUND = new ActionFailure({ code: "not_found", message: "That job isn't available." });

export async function loadMessagingJob(ctx: ActionContext, jobId: string): Promise<MessagingJob> {
  const job = check(
    await ctx.supabase
      .from("jobs")
      .select("id, org_id, primary_contact_id, lead_id")
      .eq("id", jobId)
      .maybeSingle(),
  );
  if (!job) throw NOT_FOUND;
  let contact: JobRecipient | null = null;
  if (job.primary_contact_id) {
    // Row security: a contact the person can't see can't be messaged either.
    const c = check(
      await ctx.supabase
        .from("contacts")
        .select("id, first_name, last_name, mobile, phone, email, do_not_contact, opted_out_at")
        .eq("id", job.primary_contact_id)
        .maybeSingle(),
    );
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
  // Do Not Contact on the original lead still applies, even to people who
  // can't open the lead (read with the service client after the job check).
  let leadDisposition: string | null = null;
  if (job.lead_id) {
    const svc = await ctx.service();
    const { data } = await svc
      .from("leads")
      .select("disposition")
      .eq("id", job.lead_id)
      .maybeSingle();
    leadDisposition = data?.disposition ?? null;
  }
  return { id: job.id, orgId: job.org_id, contact, leadDisposition };
}

export async function integrationContext(ctx: ActionContext, domain: "sms_voice" | "email") {
  const connection = check(
    await ctx.supabase
      .from("integration_connections")
      .select("status")
      .eq("org_id", ctx.viewer.orgId)
      .eq("domain", domain)
      .maybeSingle(),
  );
  const ic: IntegrationContext = {
    orgId: ctx.viewer.orgId,
    actorId: ctx.viewer.id,
    sink: createSupabaseOutboxSink(await ctx.service()),
  };
  return { ic, connectionStatus: connection?.status ?? null };
}

/** Sends one customer message on a job through the outbox (simulated), tagged with a template key. */
export async function sendJobMessage(
  ctx: ActionContext,
  jobId: string,
  input: {
    channel: "sms" | "email";
    subject?: string;
    body: string;
    templateKey?: string;
    attachments?: EmailSendInput["attachments"];
  },
): Promise<SentJobMessage> {
  const job = await loadMessagingJob(ctx, jobId);
  if (input.channel === "sms") {
    const { ic, connectionStatus } = await integrationContext(ctx, "sms_voice");
    // No `fetch` is passed: even a wrongly chosen real provider could not make a request.
    const provider = getSmsProvider(ic, {
      connectionStatus,
      envProvider: serverEnv().INTEGRATION_SMS_PROVIDER,
    });
    return sendJobSms(ctx.supabase, provider, job, input.body, { templateKey: input.templateKey });
  }
  const { ic, connectionStatus } = await integrationContext(ctx, "email");
  const provider = getEmailProvider(ic, {
    connectionStatus,
    envProvider: serverEnv().INTEGRATION_EMAIL_PROVIDER,
  });
  return sendJobEmail(
    ctx.supabase,
    provider,
    job,
    { subject: input.subject ?? "", body: input.body },
    { templateKey: input.templateKey, attachments: input.attachments },
  );
}
