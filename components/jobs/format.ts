import { formatDate } from "@/lib/format/dates";

/** Display helpers for job screens. */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Oct 27, 2026" for either a timestamp (shown in Pacific) or a calendar date
 * ("2026-10-27", shown as-is: a date column has no time zone to convert).
 */
export function formatJobDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = DATE_ONLY.exec(value);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  return formatDate(value);
}

/** Integer cents → "$12,500.00". */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
