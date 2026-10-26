import { formatInTimeZone } from "date-fns-tz";

const TZ = "America/Los_Angeles";

/** UTC timestamp → Pacific date like "Oct 26, 2026" ("—" when missing). */
export function pacificDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : formatInTimeZone(d, TZ, "MMM d, yyyy");
}

/** UTC timestamp → Pacific date and time like "Oct 26, 2026, 9:05 AM". */
export function pacificDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : formatInTimeZone(d, TZ, "MMM d, yyyy, h:mm a");
}
