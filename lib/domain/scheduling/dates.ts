import { toZonedTime } from "date-fns-tz";

/**
 * Calendar dates for scheduling (SPEC §5.4). Production days are plain
 * calendar dates ("2026-07-13") in the company's time zone, never instants, so
 * they don't shift a day when shown. Pure.
 */

export const BUSINESS_TZ = "America/Los_Angeles";

export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function toUtc(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Today's date in Pacific time. */
export function pacificToday(now: Date): IsoDate {
  const z = toZonedTime(now, BUSINESS_TZ);
  const mm = String(z.getMonth() + 1).padStart(2, "0");
  const dd = String(z.getDate()).padStart(2, "0");
  return `${z.getFullYear()}-${mm}-${dd}`;
}

/** Hour of the day (0–23) in Pacific time. */
export function pacificHour(now: Date): number {
  return toZonedTime(now, BUSINESS_TZ).getHours();
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export function isoDow(d: IsoDate): number {
  const day = toUtc(d).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Every date from start to end, inclusive (max 400 days). */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const n = Math.min(daysBetween(start, end), 400);
  for (let i = 0; i <= n; i++) out.push(addDays(start, i));
  return out;
}

/** Inclusive date ranges overlap. */
export function overlaps(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Dates in both ranges (inclusive). */
export function overlapDays(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate,
): IsoDate[] {
  if (!overlaps(aStart, aEnd, bStart, bEnd)) return [];
  return eachDay(aStart > bStart ? aStart : bStart, aEnd < bEnd ? aEnd : bEnd);
}

/** Production days (by ISO weekday) between two dates, inclusive. */
export function productionDays(
  start: IsoDate,
  end: IsoDate,
  workdays: readonly number[],
): IsoDate[] {
  return eachDay(start, end).filter((d) => workdays.includes(isoDow(d)));
}

/**
 * The end date for `workingDays` production days starting on `start` (skips
 * non-production days). A start on a day off counts from the next workday.
 */
export function endAfterWorkingDays(
  start: IsoDate,
  workingDays: number,
  workdays: readonly number[],
): IsoDate {
  const days = workdays.length ? workdays : [1, 2, 3, 4, 5];
  let d = start;
  let counted = 0;
  for (let i = 0; i < 400; i++) {
    if (days.includes(isoDow(d))) {
      counted++;
      if (counted >= Math.max(1, workingDays)) return d;
    }
    d = addDays(d, 1);
  }
  return d;
}

/** The first production day on or after `d`. */
export function nextProductionDay(d: IsoDate, workdays: readonly number[]): IsoDate {
  return endAfterWorkingDays(d, 1, workdays);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon, Jul 13". */
export function formatDay(d: IsoDate): string {
  const [, m, day] = d.split("-").map(Number);
  return `${DOW[isoDow(d) - 1]}, ${MONTHS[(m ?? 1) - 1]} ${day}`;
}

/** "Jul 13" or "Jul 13–15" or "Jul 30 – Aug 2". */
export function formatRange(start: IsoDate, end: IsoDate): string {
  const [, m1, d1] = start.split("-").map(Number);
  const [, m2, d2] = end.split("-").map(Number);
  const a = `${MONTHS[(m1 ?? 1) - 1]} ${d1}`;
  if (start === end) return a;
  if (m1 === m2 && start.slice(0, 4) === end.slice(0, 4)) return `${a}–${d2}`;
  return `${a} – ${MONTHS[(m2 ?? 1) - 1]} ${d2}`;
}

/** Monday of the week that holds `d`. */
export function weekStart(d: IsoDate): IsoDate {
  return addDays(d, 1 - isoDow(d));
}
