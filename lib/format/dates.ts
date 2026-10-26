import { formatInTimeZone } from "date-fns-tz";

/** Display helpers: stored in UTC, shown in Pacific time (CLAUDE.md). */

export const DISPLAY_TZ = "America/Los_Angeles";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 26, 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, DISPLAY_TZ, "MMM d, yyyy") : "—";
}

/** "Oct 26, 2026, 9:05 AM" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, DISPLAY_TZ, "MMM d, yyyy, h:mm a") : "—";
}

/** "Tue, Oct 27 · 9:00 AM" for appointments. */
export function formatAppointment(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? formatInTimeZone(d, DISPLAY_TZ, "EEE, MMM d · h:mm a") : "—";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value);
  if (!d) return "—";
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return formatDate(d);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

/** Pacific calendar date as YYYY-MM-DD (for date inputs). */
export function pacificIsoDate(value: string | Date = new Date()): string {
  const d = toDate(value) ?? new Date();
  return formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd");
}
