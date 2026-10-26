import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { WEEKDAYS, type BusinessHours } from "@/lib/domain/company-settings";

/**
 * Speed-to-lead counts business hours only (SPEC §1.3: "within a few minutes
 * during business hours"). A lead that arrives at 9 pm and gets a call at
 * 8:05 am the next business day scores 5 minutes, not 11 hours.
 * "By appointment" and closed days don't count.
 */

export const BUSINESS_TZ = "America/Los_Angeles";

const JS_DAY_TO_WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Open intervals (UTC ms) for one local calendar day. */
function openIntervalForDay(
  localDay: Date,
  hours: BusinessHours,
  tz: string,
): [number, number] | null {
  const weekday = JS_DAY_TO_WEEKDAY[localDay.getDay()]!;
  const day = hours[weekday];
  if (!day || !("open" in day)) return null;
  const y = localDay.getFullYear();
  const mo = localDay.getMonth();
  const d = localDay.getDate();
  const open = minutesOf(day.open);
  const close = minutesOf(day.close);
  if (close <= open) return null;
  const start = fromZonedTime(new Date(y, mo, d, Math.floor(open / 60), open % 60), tz).getTime();
  const end = fromZonedTime(new Date(y, mo, d, Math.floor(close / 60), close % 60), tz).getTime();
  return [start, end];
}

/** Business seconds between two instants. Returns 0 if end ≤ start. */
export function businessSecondsBetween(
  start: Date,
  end: Date,
  hours: BusinessHours,
  tz: string = BUSINESS_TZ,
): number {
  const s = start.getTime();
  const e = end.getTime();
  if (!(e > s)) return 0;
  // Guard against nonsense ranges (e.g. an import with a 1990 created date).
  const maxDays = 400;
  let total = 0;
  let localDay = toZonedTime(start, tz);
  localDay = new Date(localDay.getFullYear(), localDay.getMonth(), localDay.getDate());
  for (let i = 0; i < maxDays; i++) {
    const interval = openIntervalForDay(localDay, hours, tz);
    if (interval) {
      const [a, b] = interval;
      if (a >= e) break;
      const from = Math.max(a, s);
      const to = Math.min(b, e);
      if (to > from) total += to - from;
    }
    localDay = addDays(localDay, 1);
    const nextStart = fromZonedTime(localDay, tz).getTime();
    if (nextStart >= e) break;
  }
  return Math.round(total / 1000);
}

/** True when `at` falls inside business hours. */
export function isWithinBusinessHours(
  at: Date,
  hours: BusinessHours,
  tz: string = BUSINESS_TZ,
): boolean {
  const local = toZonedTime(at, tz);
  const day = new Date(local.getFullYear(), local.getMonth(), local.getDate());
  const interval = openIntervalForDay(day, hours, tz);
  return interval !== null && at.getTime() >= interval[0] && at.getTime() < interval[1];
}

/** "4 min", "1 h 5 min", "2 business days" for KPI captions and the lead header. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export { WEEKDAYS };
