import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import type { PeriodWords } from "@/lib/metrics/registry";

/**
 * Jobs Dashboard periods (SPEC §8.5 "period select"). Pure: given "now", each
 * period is a half-open range [from, to) of Pacific calendar days, stored as
 * UTC instants for `job_stats(p_from, p_to, p_prev_from)`. The prior period is
 * the one just before it, [prevFrom, from): last month, last quarter, last
 * year, or the 90 days before.
 */

export const JOB_PERIODS = [
  { id: "this_month", label: "This Month" },
  { id: "last_month", label: "Last Month" },
  { id: "qtd", label: "Quarter to Date" },
  { id: "ytd", label: "Year to Date" },
  { id: "rolling_90d", label: "Rolling 90 Days" },
] as const;

export type JobPeriodId = (typeof JOB_PERIODS)[number]["id"];
export const DEFAULT_JOB_PERIOD: JobPeriodId = "this_month";

export function parseJobPeriod(raw: string | string[] | undefined | null): JobPeriodId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return JOB_PERIODS.some((p) => p.id === v) ? (v as JobPeriodId) : DEFAULT_JOB_PERIOD;
}

export type PeriodRange = {
  id: JobPeriodId;
  label: string;
  /** UTC instants for the RPC. */
  from: string;
  to: string;
  prevFrom: string;
  /** First and last Pacific day shown on the daily chart (last = today for open periods). */
  firstDay: string;
  lastDay: string;
  words: PeriodWords;
};

type Ymd = { y: number; m: number; d: number };

const pad = (n: number) => String(n).padStart(2, "0");
const ymdString = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;

/** Normalizes month overflow (month 0 → December of the year before, 13 → January after). */
function ymd(y: number, m: number, d: number): Ymd {
  const t = new Date(Date.UTC(y, m - 1, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function addDays(day: Ymd, n: number): Ymd {
  return ymd(day.y, day.m, day.d + n);
}

/** Start of a Pacific day as a UTC ISO string. */
function startOf(day: Ymd): string {
  return fromZonedTime(`${ymdString(day)}T00:00:00.000`, DISPLAY_TZ).toISOString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 1" */
function shortDay(day: Ymd): string {
  return `${MONTHS[day.m - 1]} ${day.d}`;
}

function minDay(a: Ymd, b: Ymd): Ymd {
  return ymdString(a) <= ymdString(b) ? a : b;
}

export function periodRange(id: JobPeriodId, now: Date = new Date()): PeriodRange {
  const [y, m, d] = formatInTimeZone(now, DISPLAY_TZ, "yyyy-MM-dd").split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const today = { y, m, d };
  const label = JOB_PERIODS.find((p) => p.id === id)!.label;

  let from: Ymd;
  let to: Ymd;
  let prevFrom: Ymd;
  let words: Omit<PeriodWords, "start">;
  switch (id) {
    case "this_month":
      from = ymd(y, m, 1);
      to = ymd(y, m + 1, 1);
      prevFrom = ymd(y, m - 1, 1);
      words = { period: "this month", prior: "last month" };
      break;
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
  }

  return {
    id,
    label,
    from: startOf(from),
    to: startOf(to),
    prevFrom: startOf(prevFrom),
    firstDay: ymdString(from),
    lastDay: ymdString(minDay(addDays(to, -1), today)),
    words: { ...words, start: shortDay(from) },
  };
}
