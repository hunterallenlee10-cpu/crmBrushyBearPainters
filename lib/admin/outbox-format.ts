/**
 * Pure helpers for the simulated outbox list (SPEC §2.1: "Simulated – not
 * sent"). Recipients are partly masked on screen and in the payload viewer
 * (SPEC §13.1: keep phones and emails out of plain view).
 */

export const OUTBOX_LIST_LIMIT = 50;

export const SIMULATED_LABEL = "Simulated – not sent";

const EMAIL_RE = /^([^\s@<>]+)@([^\s@<>]+\.[^\s@<>]+)$/;
const EMAIL_IN_TEXT_RE = /[^\s@<>"',;:()]+@[^\s@<>"',;:()]+\.[A-Za-z]{2,}/g;
const PHONE_IN_TEXT_RE = /\+?\d[\d\s().-]{8,}\d/g;

/** "jane@example.com" → "j***@example.com". */
export function maskEmail(value: string): string {
  const match = EMAIL_RE.exec(value.trim());
  if (!match) return value;
  const [, local = "", domain = ""] = match;
  return `${local.charAt(0)}***@${domain}`;
}

/** "+15555550100" → "+1 ••• ••• 0100"; other numbers keep only the last four digits. */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return value;
  const last4 = digits.slice(-4);
  if (digits.length === 11 && digits.startsWith("1")) return `+1 ••• ••• ${last4}`;
  if (digits.length === 10) return `••• ••• ${last4}`;
  return `••• ${last4}`;
}

function looksLikePhone(value: string): boolean {
  return /^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7;
}

function maskOne(part: string): string {
  const trimmed = part.trim();
  // "Name <address>" keeps the name, masks the address.
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);
  if (angled) {
    const name = angled[1]?.trim();
    const masked = maskOne(angled[2] ?? "");
    return name ? `${name} <${masked}>` : masked;
  }
  if (EMAIL_RE.test(trimmed)) return maskEmail(trimmed);
  if (looksLikePhone(trimmed)) return maskPhone(trimmed);
  return trimmed;
}

/** Masks each address in a recipient field ("a@x.com, b@y.com" or a phone). Empty → "—". */
export function maskRecipient(value: string | null | undefined): string {
  if (!value || !value.trim()) return "—";
  return value.split(",").map(maskOne).filter(Boolean).join(", ");
}

/** Masks email addresses and phone numbers anywhere inside a string. */
export function maskContactsInText(text: string): string {
  return text
    .replace(EMAIL_IN_TEXT_RE, (m) => maskEmail(m))
    .replace(PHONE_IN_TEXT_RE, (m) => (m.replace(/\D/g, "").length >= 10 ? maskPhone(m) : m));
}

/** Deep copy of a JSON payload with emails and phone numbers masked in every string. */
export function maskPayload(value: unknown): unknown {
  if (typeof value === "string") return maskContactsInText(value);
  if (Array.isArray(value)) return value.map(maskPayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskPayload(v);
    return out;
  }
  return value;
}

/** Pretty JSON for the payload viewer (masked). */
export function payloadJson(payload: unknown): string {
  return JSON.stringify(maskPayload(payload ?? {}), null, 2);
}

/** True when a rendered body is HTML (an email) rather than plain text (an SMS). */
export function isHtmlBody(body: string | null | undefined): boolean {
  return Boolean(body && /<\/?[a-z][\s\S]*>/i.test(body));
}

export type OutboxStatus = "simulated" | "queued" | "sent" | "failed";

export function outboxStatusLabel(status: string): string {
  switch (status) {
    case "simulated":
      return SIMULATED_LABEL;
    case "queued":
      return "Queued";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}
