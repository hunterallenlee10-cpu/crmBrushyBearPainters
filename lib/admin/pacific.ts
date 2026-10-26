import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** Business time zone: timestamps are stored in UTC and shown in Pacific time (CLAUDE.md). */
export const BUSINESS_TZ = "America/Los_Angeles";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar date. */
export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Formats a UTC timestamp in Pacific time, e.g. "Oct 26, 2026, 9:05 AM PDT". */
export function formatPacific(value: string | Date, pattern = "MMM d, yyyy, h:mm a zzz"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return formatInTimeZone(date, BUSINESS_TZ, pattern);
}

function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function pacificMidnightUtc(isoDate: string): string {
  return fromZonedTime(`${isoDate}T00:00:00`, BUSINESS_TZ).toISOString();
}

/**
 * Turns an inclusive Pacific date range (`from`/`to` as `YYYY-MM-DD`) into UTC
 * bounds for a query: `at >= gte` and `at < lt`. `to` covers the whole day.
 * Either end may be missing; invalid dates are ignored; a reversed range is swapped.
 */
export function pacificDateRangeToUtc(
  from?: string | null,
  to?: string | null,
): { gte?: string; lt?: string } {
  let start = from && isIsoDate(from) ? from : undefined;
  let end = to && isIsoDate(to) ? to : undefined;
  if (start && end && start > end) [start, end] = [end, start];
  const out: { gte?: string; lt?: string } = {};
  if (start) out.gte = pacificMidnightUtc(start);
  if (end) out.lt = pacificMidnightUtc(nextDay(end));
  return out;
}
