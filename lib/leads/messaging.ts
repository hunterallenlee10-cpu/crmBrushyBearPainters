import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure } from "@/lib/actions/errors";
import type { SmsProvider } from "@/lib/integrations/sms_voice/types";
import type { EmailProvider } from "@/lib/integrations/email/types";

/**
 * One-to-one lead messaging (SPEC §8.4 Lead Detail, §5.7, §13.2).
 *
 * Texts and emails go through the integration adapters, which in this build
 * only record them in `integration_outbox` (status `simulated`): nothing is
 * sent. Calls are logged by people. The send helpers take the user-scoped
 * client and the provider as arguments, so this file holds no secrets and the
 * pure helpers (segment counter, consent check) can also run in the browser.
 */

type Db = SupabaseClient<Database>;

/** The disposition key that blocks all outbound contact (SPEC §13.2). */
export const DO_NOT_CONTACT = "do_not_contact";

// --- SMS segments ------------------------------------------------------------

/** GSM 03.38 basic character set (each counts as 1). */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
/** GSM extension table (each counts as 2: escape + char). */
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

export type SmsEncoding = "GSM-7" | "UCS-2";

export type SmsCount = {
  encoding: SmsEncoding;
  /** Characters as the carrier counts them (GSM septets or UTF-16 code units). */
  units: number;
  segments: number;
  /** Capacity of each segment for this message (160/153 for GSM-7, 70/67 for UCS-2). */
  perSegment: number;
  /** Characters left before the next segment starts. */
  remaining: number;
};

/**
 * How many SMS segments a text takes. Plain text fits 160 characters in one
 * segment (153 each once it's split); any emoji or character outside the GSM
 * alphabet switches the whole message to 70 (67 when split).
 */
export function countSms(text: string): SmsCount {
  let septets = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.has(ch)) septets += 1;
    else if (GSM_EXTENDED.has(ch)) septets += 2;
    else {
      gsm = false;
      break;
    }
  }
  const encoding: SmsEncoding = gsm ? "GSM-7" : "UCS-2";
  const units = gsm ? septets : text.length; // UTF-16 code units: emoji count as 2
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  if (units === 0) return { encoding, units, segments: 0, perSegment: single, remaining: single };
  if (units <= single) {
    return { encoding, units, segments: 1, perSegment: single, remaining: single - units };
  }
  const segments = Math.ceil(units / multi);
  return { encoding, units, segments, perSegment: multi, remaining: segments * multi - units };
}

/** "42 / 160 · 1 text" style caption for the composer. */
export function describeSmsCount(count: SmsCount): string {
  if (count.segments <= 1) {
    const extra = count.encoding === "UCS-2" ? " · emoji or special characters" : "";
    return `${count.units} / ${count.perSegment} · 1 text${extra}`;
  }
  return `${count.units} characters · ${count.segments} texts (${count.remaining} left in the last one)`;
}

// --- Consent and reachability --------------------------------------------------

export type ContactChannel = "sms" | "email" | "call";

export type ReachableLead = {
  mobile: string | null;
  phone: string | null;
  email: string | null;
  disposition: string | null;
  /** Set when they replied STOP to a text (Phase 8 inbound handler). */
  smsOptedOutAt?: string | null;
};

/** Why a person can't reach this lead on a channel, or null when they can. */
export function contactBlockReason(lead: ReachableLead, channel: ContactChannel): string | null {
  if (lead.disposition === DO_NOT_CONTACT) {
    return "This lead asked not to be contacted. Change the disposition first if that has changed.";
  }
  if (channel === "sms" && lead.smsOptedOutAt) {
    return "They replied STOP to texts. They have to text START before you can text them again.";
  }
  if (channel === "sms" && !lead.mobile && !lead.phone)
    return "Add a mobile number to send a text.";
  if (channel === "call" && !lead.mobile && !lead.phone) return "Add a phone number to call.";
  if (channel === "email" && !lead.email) return "Add an email address to send an email.";
  return null;
}

/** Texts go to the mobile number, falling back to the other phone. */
export function smsRecipient(lead: Pick<ReachableLead, "mobile" | "phone">): string | null {
  return lead.mobile ?? lead.phone ?? null;
}

export function callRecipient(lead: Pick<ReachableLead, "mobile" | "phone">): string | null {
  return lead.mobile ?? lead.phone ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain text → simple HTML email: blank lines make paragraphs, single newlines <br>. */
export function plainTextToHtml(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// --- Sends (server side; the caller passes the user client and the provider) -----

export type MessagingLead = ReachableLead & { id: string; orgId: string };

export type SentMessage = { messageId: string; outboxId: string };

function refuse(message: string): never {
  throw new ActionFailure({ code: "forbidden", message });
}

function requireOutbox(provider: { provider: string }): void {
  // Belt and braces: this build only ever records to the outbox (SPEC §2.1).
  if (provider.provider !== "outbox") refuse("Messages only go to the outbox in this build.");
}

async function insertMessage(
  db: Db,
  row: Database["public"]["Tables"]["messages"]["Insert"],
): Promise<string> {
  const { data, error } = await db.from("messages").insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

/** Records a text in the outbox ("Simulated – not sent") and logs it on the lead. */
export async function sendLeadSms(
  db: Db,
  provider: SmsProvider,
  lead: MessagingLead,
  body: string,
): Promise<SentMessage> {
  const blocked = contactBlockReason(lead, "sms");
  if (blocked) refuse(blocked);
  requireOutbox(provider);
  const to = smsRecipient(lead) as string;
  const result = await provider.send({
    to,
    body,
    related: { type: "lead", id: lead.id },
    messageType: "transactional",
  });
  if (!result.outboxId) throw new Error("The SMS outbox did not return an entry id.");
  const messageId = await insertMessage(db, {
    org_id: lead.orgId,
    channel: "sms",
    direction: "outbound",
    subject_type: "lead",
    subject_id: lead.id,
    to_address: to,
    body,
    status: result.status === "simulated" ? "simulated" : "queued",
    simulated: true,
    outbox_id: result.outboxId,
  });
  return { messageId, outboxId: result.outboxId };
}

/** Records an email in the outbox ("Simulated – not sent") and logs it on the lead. */
export async function sendLeadEmail(
  db: Db,
  provider: EmailProvider,
  lead: MessagingLead,
  input: { subject: string; body: string },
): Promise<SentMessage> {
  const blocked = contactBlockReason(lead, "email");
  if (blocked) refuse(blocked);
  requireOutbox(provider);
  const to = lead.email as string;
  const result = await provider.send({
    to,
    subject: input.subject,
    html: plainTextToHtml(input.body),
    text: input.body,
    related: { type: "lead", id: lead.id },
    messageType: "transactional",
  });
  if (!result.outboxId) throw new Error("The email outbox did not return an entry id.");
  const messageId = await insertMessage(db, {
    org_id: lead.orgId,
    channel: "email",
    direction: "outbound",
    subject_type: "lead",
    subject_id: lead.id,
    to_address: to,
    email_subject: input.subject,
    body: input.body,
    status: result.status === "simulated" ? "simulated" : "queued",
    simulated: true,
    outbox_id: result.outboxId,
  });
  return { messageId, outboxId: result.outboxId };
}

/** Logs a phone call someone made (no call is placed). */
export async function logLeadCall(
  db: Db,
  lead: MessagingLead,
  input: { outcome: string; durationSeconds: number | null; notes: string | null },
): Promise<{ messageId: string }> {
  const messageId = await insertMessage(db, {
    org_id: lead.orgId,
    channel: "call",
    direction: "outbound",
    subject_type: "lead",
    subject_id: lead.id,
    to_address: callRecipient(lead),
    body: input.notes,
    call_outcome: input.outcome,
    call_duration_seconds: input.durationSeconds,
    status: "logged",
    simulated: false,
  });
  return { messageId };
}
