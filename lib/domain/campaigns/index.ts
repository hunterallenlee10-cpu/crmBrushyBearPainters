import { countSms } from "@/lib/leads/messaging";
import {
  fieldsUsed,
  renderTemplate,
  validateTemplate,
  type MergeContext,
} from "@/lib/domain/templates/merge";
import { inQuietHours, sendBlockReason } from "@/lib/domain/workflows/compliance";
import type { QuietHours, Recipient } from "@/lib/domain/workflows/types";

/**
 * Campaigns (SPEC §8.11, §13.2). Pure: the pre-send compliance checks, who a
 * campaign may reach (marketing consent, Do Not Contact, one message per
 * address), and the status rules the database guard also enforces.
 * Campaigns are always marketing: texts get "Reply STOP to opt out.", email
 * gets the company footer and an unsubscribe link.
 */

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "paused",
  "sent",
  "canceled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  paused: "Paused",
  sent: "Sent",
  canceled: "Canceled",
};

export const AUDIENCE_MODULES = ["contacts", "leads", "jobs"] as const;
export type AudienceModule = (typeof AUDIENCE_MODULES)[number];
export const AUDIENCE_MODULE_LABELS: Record<AudienceModule, string> = {
  contacts: "Contacts",
  leads: "Leads",
  jobs: "Customers on jobs (primary contact)",
};

/** Merge fields a campaign can fill (no job or estimate behind a campaign message). */
export const CAMPAIGN_FIELD_PREFIXES = ["contact.", "company.", "unsubscribe."] as const;

export function unavailableFields(text: string): string[] {
  return fieldsUsed(text).filter(
    (path) => !CAMPAIGN_FIELD_PREFIXES.some((p) => path.startsWith(p)),
  );
}

export type CampaignCheck = { level: "error" | "warning" | "info"; message: string };

export function campaignChecks(input: {
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  audienceCount: number;
  reachableCount: number;
  scheduledAt: Date | null;
  quietHours: QuietHours;
  templateStatus: "draft" | "approved" | null;
  sample: MergeContext;
}): CampaignCheck[] {
  const checks: CampaignCheck[] = [];
  const body = input.body.trim();
  if (!body) checks.push({ level: "error", message: "Write the message." });
  if (input.channel === "email" && !(input.subject ?? "").trim()) {
    checks.push({ level: "error", message: "Emails need a subject." });
  }
  for (const issue of [...validateTemplate(body), ...validateTemplate(input.subject ?? "")]) {
    checks.push({ level: "error", message: issue.detail });
  }
  const unavailable = unavailableFields(`${input.subject ?? ""}\n${body}`);
  if (unavailable.length) {
    checks.push({
      level: "error",
      message: `Campaigns can only use contact and company fields; remove ${unavailable.map((f) => `{{${f}}}`).join(", ")}.`,
    });
  }
  if (input.audienceCount === 0) {
    checks.push({ level: "error", message: "The audience is empty. Change the rules." });
  } else if (input.reachableCount === 0) {
    checks.push({
      level: "error",
      message:
        "Nobody in the audience can get marketing on this channel (consent or contact info).",
    });
  } else if (input.reachableCount < input.audienceCount) {
    checks.push({
      level: "info",
      message: `${input.audienceCount - input.reachableCount} of ${input.audienceCount} will be skipped (no consent, opted out, Do Not Contact, no address, or a duplicate address).`,
    });
  }
  const rendered = renderTemplate(body, input.sample, { missingAs: "blank" });
  if (rendered.placeholders.length) {
    checks.push({
      level: "warning",
      message: `Still has placeholders: ${rendered.placeholders.join(", ")}. Fill them in before sending.`,
    });
  }
  if (input.templateStatus === "draft") {
    checks.push({
      level: "warning",
      message:
        "The template is “Draft – owner to approve”. Fine while simulated; real sends need approved wording.",
    });
  }
  if (input.channel === "sms") {
    const c = countSms(`${rendered.text} Reply STOP to opt out.`);
    if (c.segments > 3) {
      checks.push({
        level: "warning",
        message: `This text is ${c.segments} segments long. Shorter texts get read.`,
      });
    }
    checks.push({ level: "info", message: "“Reply STOP to opt out.” is added to every text." });
    if (input.scheduledAt && inQuietHours(input.scheduledAt, input.quietHours)) {
      checks.push({
        level: "warning",
        message: "That time is in quiet hours; texts will wait until quiet hours end.",
      });
    }
  } else {
    checks.push({
      level: "info",
      message: "The company footer and an unsubscribe link are added to every email.",
    });
  }
  return checks;
}

export const canSend = (checks: readonly CampaignCheck[]) =>
  !checks.some((c) => c.level === "error");

export type AudienceMember = {
  subjectType: "contact" | "lead";
  subjectId: string;
  name: string;
  firstName: string;
  recipient: Recipient;
};

export type PlannedRecipient = AudienceMember & {
  address: string | null;
  excluded: string | null;
};

function addressKey(channel: "sms" | "email", address: string): string {
  return channel === "sms" ? address.replace(/\D/g, "").slice(-10) : address.trim().toLowerCase();
}

/** Who gets it: marketing consent per channel, and one message per phone or email. */
export function planRecipients(
  members: readonly AudienceMember[],
  channel: "sms" | "email",
): PlannedRecipient[] {
  const seen = new Set<string>();
  return members.map((m) => {
    const address = channel === "sms" ? m.recipient.mobile : m.recipient.email;
    let excluded = sendBlockReason(m.recipient, channel, "marketing");
    if (!excluded && address) {
      const k = addressKey(channel, address);
      if (seen.has(k)) excluded = "Same phone or email as another recipient.";
      else seen.add(k);
    }
    return { ...m, address: address ?? null, excluded };
  });
}

/** Status changes a person can make (the worker sets Sending and Sent). */
export function allowedTransitions(status: CampaignStatus): CampaignStatus[] {
  switch (status) {
    case "draft":
      return ["scheduled", "canceled"];
    case "scheduled":
      return ["draft", "paused", "canceled"];
    case "sending":
      return ["paused", "canceled"];
    case "paused":
      return ["scheduled", "canceled"];
    default:
      return [];
  }
}
