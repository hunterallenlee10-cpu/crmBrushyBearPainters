import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { WEEKDAYS, type BusinessHours } from "@/lib/domain/company-settings";
import { PACIFIC } from "@/lib/domain/workflows/compliance";

/**
 * Warranty and service cases (SPEC §5.7, §8.16, §9 "Warranty request, SLA 2
 * business days"). Pure: SLA due time in business days, status rules, and
 * the attention priority.
 */

export const CASE_TYPES = [
  "warranty",
  "service",
  "touch_up",
  "complaint",
  "question",
  "other",
] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  warranty: "Warranty",
  service: "Service",
  touch_up: "Touch-up",
  complaint: "Complaint",
  question: "Question",
  other: "Other",
};

export const CASE_STATUSES = [
  "new",
  "in_progress",
  "scheduled",
  "waiting_on_customer",
  "resolved",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "New",
  in_progress: "In progress",
  scheduled: "Visit scheduled",
  waiting_on_customer: "Waiting on customer",
  resolved: "Resolved",
  closed: "Closed",
};

export const CASE_PRIORITIES = ["normal", "high", "urgent"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_SOURCES = [
  "phone",
  "sms",
  "email",
  "portal",
  "in_person",
  "internal",
  "website",
] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];
export const CASE_SOURCE_LABELS: Record<CaseSource, string> = {
  phone: "Phone call",
  sms: "Text",
  email: "Email",
  portal: "Customer page",
  in_person: "In person",
  internal: "Found by our team",
  website: "Website",
};

export function isOpenCase(status: string): boolean {
  return status !== "resolved" && status !== "closed";
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * SLA due: `days` business days after it was opened, at the same time of day
 * (Pacific). A day counts when Company Settings has open hours for it. A case
 * opened outside business hours starts counting from the next business day's
 * opening. Weekends and closed days never count.
 */
export function caseSlaDue(openedAt: Date, days: number, hours: BusinessHours): Date {
  const open = (d: Date) => {
    const key = WEEKDAYS[(d.getDay() + 6) % 7];
    const h = key ? hours[key] : null;
    return h && "open" in h ? h : null;
  };
  let z = toZonedTime(openedAt, PACIFIC);
  let time = `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
  const today = open(z);
  if (!today || time >= today.close) {
    // Start at the next business day's opening.
    let guard = 0;
    do {
      z = new Date(z.getFullYear(), z.getMonth(), z.getDate() + 1);
      guard++;
    } while (!open(z) && guard < 14);
    time = open(z)?.open ?? "08:00";
  } else if (time < today.open) {
    time = today.open;
  }
  let counted = 0;
  let cur = new Date(z.getFullYear(), z.getMonth(), z.getDate());
  let guard = 0;
  while (counted < days && guard < 60) {
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    if (open(cur)) counted++;
    guard++;
  }
  // No business hours configured at all: fall back to calendar days.
  if (counted < days) {
    return new Date(openedAt.getTime() + days * 24 * 3_600_000);
  }
  return fromZonedTime(`${isoDay(cur)}T${time}:00`, PACIFIC);
}

/** Attention priority for an open warranty or service case (SPEC §9: High; past SLA → Critical). */
export function caseAttentionPriority(
  c: { priority: CasePriority; slaDueAt: string },
  now: Date,
): "critical" | "high" {
  if (c.priority === "urgent") return "critical";
  return new Date(c.slaDueAt).getTime() <= now.getTime() ? "critical" : "high";
}
