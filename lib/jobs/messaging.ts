import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure } from "@/lib/actions/errors";
import type { SmsProvider } from "@/lib/integrations/sms_voice/types";
import type { EmailProvider } from "@/lib/integrations/email/types";
import { DO_NOT_CONTACT, plainTextToHtml, type ContactChannel } from "@/lib/leads/messaging";

/**
 * One-to-one messaging on a job (SPEC §8.5 #11, §5.7, §13.2).
 *
 * Same rules as lead messaging (lib/leads/messaging.ts, whose segment counter
 * and HTML helper are reused): texts and emails only go through the adapters,
 * which record them in `integration_outbox` as simulated; nothing is sent.
 * The recipient is the job's primary contact, so consent comes from the
 * contact: Do Not Contact blocks every channel and a STOP reply blocks texts.
 * The pure helpers also run in the browser (disabled-state guidance).
 */

type Db = SupabaseClient<Database>;

export type JobRecipient = {
  id: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  doNotContact: boolean;
  /** Set when they replied STOP to a text. */
  optedOutAt: string | null;
};

/** Why nobody can reach the job's customer on a channel, or null when they can. */
export function jobContactBlockReason(
  contact: JobRecipient | null,
  channel: ContactChannel,
  opts: { leadDisposition?: string | null } = {},
): string | null {
  if (!contact) {
    return "This job has no primary contact you can see. Add one on the customer's account.";
  }
  if (contact.doNotContact || opts.leadDisposition === DO_NOT_CONTACT) {
    return "This customer asked not to be contacted. Change it on their contact record first if that has changed.";
  }
  if (channel === "sms") {
    if (contact.optedOutAt) {
      return "They replied STOP to texts. They have to text START before you can text them again.";
    }
    if (!contact.mobile) return "Add a mobile number before sending SMS.";
  }
  if (channel === "email" && !contact.email) return "Add an email address before sending email.";
  if (channel === "call" && !contact.mobile && !contact.phone) return "Add a phone number to call.";
  return null;
}

/** Texts go to the contact's mobile only (a landline can't receive them). */
export function jobSmsRecipient(contact: Pick<JobRecipient, "mobile"> | null): string | null {
  return contact?.mobile ?? null;
}

export function jobCallRecipient(
  contact: Pick<JobRecipient, "mobile" | "phone"> | null,
): string | null {
  return contact?.mobile ?? contact?.phone ?? null;
}

// --- Sends (server side; the caller passes the user client and the provider) -----

export type MessagingJob = {
  id: string;
  orgId: string;
  contact: JobRecipient | null;
  /** Disposition of the lead this job came from (Do Not Contact carries over). */
  leadDisposition: string | null;
};

export type SentJobMessage = { messageId: string; outboxId: string };

function refuse(message: string): never {
  throw new ActionFailure({ code: "forbidden", message });
}

function requireOutbox(provider: { provider: string }): void {
  // Belt and braces: this build only ever records to the outbox (SPEC §2.1).
  if (provider.provider !== "outbox") refuse("Messages only go to the outbox in this build.");
}

function blocked(job: MessagingJob, channel: ContactChannel): void {
  const reason = jobContactBlockReason(job.contact, channel, {
    leadDisposition: job.leadDisposition,
  });
  if (reason) refuse(reason);
}

async function insertMessage(
  db: Db,
  row: Database["public"]["Tables"]["messages"]["Insert"],
): Promise<string> {
  const { data, error } = await db.from("messages").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/** Records a text in the outbox ("Simulated – not sent") and logs it on the job. */
export async function sendJobSms(
  db: Db,
  provider: SmsProvider,
  job: MessagingJob,
  body: string,
): Promise<SentJobMessage> {
  blocked(job, "sms");
  requireOutbox(provider);
  const contact = job.contact as JobRecipient;
  const to = jobSmsRecipient(contact) as string;
  const result = await provider.send({
    to,
    body,
    related: { type: "job", id: job.id },
    messageType: "transactional",
  });
  if (!result.outboxId) throw new Error("The SMS outbox did not return an entry id.");
  const messageId = await insertMessage(db, {
    org_id: job.orgId,
    channel: "sms",
    direction: "outbound",
    subject_type: "job",
    subject_id: job.id,
    contact_id: contact.id,
    to_address: to,
    body,
    status: result.status === "simulated" ? "simulated" : "queued",
    simulated: true,
    outbox_id: result.outboxId,
  });
  return { messageId, outboxId: result.outboxId };
}

/** Records an email in the outbox ("Simulated – not sent") and logs it on the job. */
export async function sendJobEmail(
  db: Db,
  provider: EmailProvider,
  job: MessagingJob,
  input: { subject: string; body: string },
): Promise<SentJobMessage> {
  blocked(job, "email");
  requireOutbox(provider);
  const contact = job.contact as JobRecipient;
  const to = contact.email as string;
  const result = await provider.send({
    to,
    subject: input.subject,
    html: plainTextToHtml(input.body),
    text: input.body,
    related: { type: "job", id: job.id },
    messageType: "transactional",
  });
  if (!result.outboxId) throw new Error("The email outbox did not return an entry id.");
  const messageId = await insertMessage(db, {
    org_id: job.orgId,
    channel: "email",
    direction: "outbound",
    subject_type: "job",
    subject_id: job.id,
    contact_id: contact.id,
    to_address: to,
    email_subject: input.subject,
    body: input.body,
    status: result.status === "simulated" ? "simulated" : "queued",
    simulated: true,
    outbox_id: result.outboxId,
  });
  return { messageId, outboxId: result.outboxId };
}

/** Logs a phone call someone made (no call is placed). Allowed even under Do Not Contact. */
export async function logJobCall(
  db: Db,
  job: MessagingJob,
  input: { outcome: string; durationSeconds: number | null; notes: string | null },
): Promise<{ messageId: string }> {
  const messageId = await insertMessage(db, {
    org_id: job.orgId,
    channel: "call",
    direction: "outbound",
    subject_type: "job",
    subject_id: job.id,
    contact_id: job.contact?.id ?? null,
    to_address: jobCallRecipient(job.contact),
    body: input.notes,
    call_outcome: input.outcome,
    call_duration_seconds: input.durationSeconds,
    status: "logged",
    simulated: false,
  });
  return { messageId };
}
