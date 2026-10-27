import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { QuietHours, Recipient } from "./types";

/**
 * Messaging compliance (SPEC §11.1, §13.2), pure:
 * - Quiet hours: automated texts sent overnight wait until the end of quiet
 *   hours (default 8:00 am Pacific) unless the customer texted us recently
 *   (a customer-initiated thread). Email isn't held.
 * - Consent: Do Not Contact blocks everything; a STOP reply blocks texts; an
 *   unsubscribe blocks marketing email. Marketing texts need an explicit SMS
 *   opt-in on the contact; marketing email needs the contact's email opt-in
 *   (leads, who have no opt-in record, can get marketing email until they
 *   unsubscribe). Transactional and marketing messages are tracked separately.
 */

export const PACIFIC = "America/Los_Angeles";

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h >= 0 && h < 24 && mm >= 0 && mm < 60 ? h * 60 + mm : null;
}

/** True when `now` falls inside quiet hours (Pacific). */
export function inQuietHours(now: Date, q: QuietHours): boolean {
  if (!q.enabled) return false;
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  if (start === null || end === null || start === end) return false;
  const z = toZonedTime(now, PACIFIC);
  const t = z.getHours() * 60 + z.getMinutes();
  return start > end ? t >= start || t < end : t >= start && t < end;
}

/**
 * When an automated text may go out: null = now, else the end of quiet hours
 * (Pacific, DST-safe). Customer-initiated threads aren't held.
 */
export function quietHoursUntil(
  now: Date,
  q: QuietHours,
  opts: { customerInitiated?: boolean } = {},
): Date | null {
  if (opts.customerInitiated || !inQuietHours(now, q)) return null;
  const end = minutesOf(q.end) as number;
  const z = toZonedTime(now, PACIFIC);
  const t = z.getHours() * 60 + z.getMinutes();
  const day = new Date(z.getFullYear(), z.getMonth(), z.getDate());
  if (t >= end) day.setDate(day.getDate() + 1);
  const y = day.getFullYear();
  const mo = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  const hh = String(Math.floor(end / 60)).padStart(2, "0");
  const mm = String(end % 60).padStart(2, "0");
  return fromZonedTime(`${y}-${mo}-${d}T${hh}:${mm}:00`, PACIFIC);
}

export type Channel = "sms" | "email";
export type MessageType = "transactional" | "marketing";

/** Why a message can't go to this recipient on this channel, or null when it can. */
export function sendBlockReason(
  r: Recipient | null,
  channel: Channel,
  messageType: MessageType,
): string | null {
  if (!r) return "There's no one to send it to on this record.";
  if (r.doNotContact) return `${r.name || "This person"} asked not to be contacted.`;
  if (channel === "sms") {
    if (r.smsOptedOut) return `${r.name || "They"} replied STOP to texts.`;
    if (!r.mobile) return "No mobile number on file.";
    if (messageType === "marketing" && r.smsOptIn !== true) {
      return "No opt-in to marketing texts on file.";
    }
    return null;
  }
  if (!r.email) return "No email address on file.";
  if (messageType === "marketing") {
    if (r.emailOptedOut) return `${r.name || "They"} unsubscribed from marketing email.`;
    if (r.emailOptIn === false) return "No opt-in to marketing email on file.";
  }
  return null;
}

/** The text appended to marketing texts (SPEC §8.11 "Reply STOP to opt out"). */
export function withSmsOptOut(body: string, optOutText: string): string {
  const t = body.trim();
  return /reply\s+stop/i.test(t) ? t : `${t} ${optOutText.trim()}`;
}

/** The footer appended to marketing email: company line + unsubscribe link. */
export function withEmailFooter(body: string, footer: string, unsubscribeUrl: string): string {
  return `${body.trim()}\n\n—\n${footer.trim()}\nUnsubscribe: ${unsubscribeUrl}`;
}
