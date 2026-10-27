import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import type { PeriodWords } from "@/lib/metrics/registry";

/**
 * Date-range presets for the Executive Overview, dashboards, reports and
 * Ask (SPEC §8.2: Today, This Week, This Month, Last Month, QTD, YTD, Rolling
 * 90d, Custom) and My Numbers (§8.15: MTD, Last Month, YTD, All Time, Custom).
 * Pure: given "now", a range is half-open [from, to) of Pacific calendar days
 * as UTC instants, plus the words captions use.
 */

export const PERIOD_PRESETS = [
  { id: "today", label: "Today" },
  { id: "this_week", label: "This Week" },
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "qtd", label: "Quarter to Date" },
  { id: "ytd", label: "Year to Date" },
  { id: "rolling_90d", label: "Rolling 90 Days" },
  { id: "all_time", label: "All Time" },
  { id: "custom", label: "Custom" },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["id"];

/** The presets each screen offers. */
export const OVERVIEW_PRESETS = [
  "today",
  "this_week",
  "this_month",
  "last_month",
  "qtd",
  "ytd",
  "rolling_90d",
  "custom",
] as const satisfies readonly PeriodPreset[];
export const MY_NUMBERS_PRESETS = [
  "this_month",
  "last_month",
  "ytd",
  "all_time",
  "custom",
] as const satisfies readonly PeriodPreset[];

/** My Numbers calls This Month "MTD". */
export const MY_NUMBERS_LABELS: Partial<Record<PeriodPreset, string>> = { this_month: "MTD" };

export type Ymd = { y: number; m: number; d: number };
const pad = (n: number) => String(n).padStart(2, "0");
export const ymdString = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function ymd(y: number, m: number, d: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function parseDay(s: string): Ymd | null {
  if (!ISO_DAY.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const v = ymd(y, m, d);
  return ymdString(v) === s ? v : null;
}
const addDays = (day: Ymd, n: number) => ymd(day.y, day.m, day.d + n);
const startOf = (day: Ymd) =>
  fromZonedTime(`${ymdString(day)}T00:00:00.000`, DISPLAY_TZ).toISOString();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (day: Ymd) => `${MONTHS[day.m - 1]} ${day.d}`;
const longDay = (day: Ymd) => `${MONTHS[day.m - 1]} ${day.d}, ${day.y}`;

/** Today's Pacific calendar day. */
export function pacificToday(now: Date = new Date()): Ymd {
  const [y, m, d] = formatInTimeZone(now, DISPLAY_TZ, "yyyy-MM-dd").split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { y, m, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The earliest day "All Time" reaches back to (before the company's first record). */
export const ALL_TIME_START = "2020-01-01";

export type DateRange = {
  preset: PeriodPreset;
  label: string;
  /** UTC instants for RPCs. */
  from: string;
  to: string;
  /** First and last Pacific day covered (last = today for open periods). */
  firstDay: string;
  lastDay: string;
  /** The period just before, same length (for "vs prior"). */
  prevFrom: string;
  words: PeriodWords;
  /** Custom bounds as given (for the URL). */
  custom?: { from: string; to: string };
};

/**
 * Resolves a preset (or a custom range of Pacific days, inclusive) to a range.
 * Invalid or reversed custom days fall back to This Month.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null },
): DateRange {
  const today = pacificToday(now);
  const { y, m } = today;
  let from: Ymd;
  let to: Ymd;
  let prevFrom: Ymd;
  let words: Omit<PeriodWords, "start">;
  let label: string = PERIOD_PRESETS.find((p) => p.id === preset)?.label ?? "This Month";
  switch (preset) {
    case "today":
      from = today;
      to = addDays(today, 1);
      prevFrom = addDays(today, -1);
      words = { period: "today", prior: "yesterday" };
      break;
    case "this_week": {
      // Weeks start on Monday (Pacific).
      const dow = (new Date(Date.UTC(y, m - 1, today.d)).getUTCDay() + 6) % 7;
      from = addDays(today, -dow);
      to = addDays(from, 7);
      prevFrom = addDays(from, -7);
      words = { period: "this week", prior: "last week" };
      break;
    }
    case "last_month":
      from = ymd(y, m - 1, 1);
      to = ymd(y, m, 1);
      prevFrom = ymd(y, m - 2, 1);
      words = { period: "last month", prior: "the month before" };
      break;
    case "qtd": {
      const qStart = m - ((m - 1) % 3);
      from = ymd(y, qStart, 1);
      to = ymd(y, qStart + 3, 1);
      prevFrom = ymd(y, qStart - 3, 1);
      words = { period: "this quarter", prior: "last quarter" };
      break;
    }
    case "ytd":
      from = ymd(y, 1, 1);
      to = ymd(y + 1, 1, 1);
      prevFrom = ymd(y - 1, 1, 1);
      words = { period: "this year", prior: "last year" };
      break;
    case "rolling_90d":
      from = addDays(today, -89);
      to = addDays(today, 1);
      prevFrom = addDays(from, -90);
      words = { period: "in the last 90 days", prior: "the 90 days before" };
      break;
    case "all_time":
      from = parseDay(ALL_TIME_START)!;
      to = addDays(today, 1);
      prevFrom = from;
      words = { period: "all time", prior: "before" };
      break;
    case "custom": {
      const a = custom?.from ? parseDay(custom.from) : null;
      const b = custom?.to ? parseDay(custom.to) : null;
      if (a && b && ymdString(a) <= ymdString(b) && ymdString(b) <= ymdString(addDays(a, 3660))) {
        from = a;
        to = addDays(b, 1);
        const len =
          Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
        prevFrom = addDays(a, -len);
        words = { period: `${shortDay(a)} – ${longDay(b)}`, prior: "the period before" };
        label = `${shortDay(a)} – ${longDay(b)}`;
        const range = build(preset, label, from, to, prevFrom, words, today);
        return { ...range, custom: { from: ymdString(a), to: ymdString(b) } };
      }
      return resolvePeriod("this_month", now);
    }
    case "this_month":
    default:
      from = ymd(y, m, 1);
      to = ymd(y, m + 1, 1);
      prevFrom = ymd(y, m - 1, 1);
      words = { period: "this month", prior: "last month" };
      label = "This Month";
      return build("this_month", label, from, to, prevFrom, words, today);
  }
  return build(preset, label, from, to, prevFrom, words, today);
}

function build(
  preset: PeriodPreset,
  label: string,
  from: Ymd,
  to: Ymd,
  prevFrom: Ymd,
  words: Omit<PeriodWords, "start">,
  today: Ymd,
): DateRange {
  const last = addDays(to, -1);
  return {
    preset,
    label,
    from: startOf(from),
    to: startOf(to),
    prevFrom: startOf(prevFrom),
    firstDay: ymdString(from),
    lastDay: ymdString(ymdString(last) <= ymdString(today) ? last : today),
    words: { ...words, start: shortDay(from) },
  };
}

/** Reads `?period=` (+ `from` / `to` for custom) for a screen's presets. */
export function parsePeriodParams(
  params: Record<string, string | string[] | undefined>,
  allowed: readonly PeriodPreset[],
  fallback: PeriodPreset,
  now: Date = new Date(),
): DateRange {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const raw = one("period");
  const preset = allowed.find((p) => p === raw) ?? fallback;
  return resolvePeriod(preset, now, { from: one("from"), to: one("to") });
}

/** The query string for a range (`period=…&from=…&to=…`). */
export function periodQuery(range: Pick<DateRange, "preset" | "custom">): Record<string, string> {
  return range.preset === "custom" && range.custom
    ? { period: "custom", from: range.custom.from, to: range.custom.to }
    : { period: range.preset };
}

/** The month (first day) a Pacific day is in, and N months before/after. */
export function monthStart(day: string, offset = 0): string {
  const d = parseDay(day) ?? parseDay(`${day.slice(0, 7)}-01`) ?? { y: 2026, m: 1, d: 1 };
  return ymdString(ymd(d.y, d.m + offset, 1));
}
