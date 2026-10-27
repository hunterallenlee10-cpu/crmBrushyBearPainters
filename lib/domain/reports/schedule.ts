import { fromZonedTime } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import { pacificToday, ymdString, type Ymd } from "@/lib/domain/analytics/periods";

/**
 * Report delivery schedules (SPEC §8.14 "Schedules"): daily, weekly (on a
 * weekday) or monthly (on a day 1–28), at a Pacific hour. Pure.
 */

export const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
};
export const WEEKDAY_LABELS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export type ScheduleRule = {
  frequency: Frequency;
  /** ISO weekday, 1 = Monday (weekly). */
  weekday: number | null;
  /** 1–28 (monthly). */
  monthDay: number | null;
  /** Pacific hour, 0–23. */
  hour: number;
};

const add = (d: Ymd, n: number): Ymd => {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const isoWeekday = (d: Ymd) => ((new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() + 6) % 7) + 1;

function matches(rule: ScheduleRule, d: Ymd): boolean {
  switch (rule.frequency) {
    case "daily":
      return true;
    case "weekly":
      return isoWeekday(d) === (rule.weekday ?? 1);
    case "monthly":
      return d.d === (rule.monthDay ?? 1);
  }
}

/** The first delivery time strictly after `after` (UTC instant). */
export function nextRunAt(rule: ScheduleRule, after: Date): Date {
  const hour = Math.min(23, Math.max(0, Math.round(rule.hour)));
  let day = pacificToday(after);
  for (let i = 0; i < 70; i++) {
    if (matches(rule, day)) {
      const at = fromZonedTime(
        `${ymdString(day)}T${String(hour).padStart(2, "0")}:00:00.000`,
        DISPLAY_TZ,
      );
      if (at.getTime() > after.getTime()) return at;
    }
    day = add(day, 1);
  }
  // Unreachable for valid rules (a month day 1–28 occurs within 31 days).
  return new Date(after.getTime() + 86_400_000);
}

/** "Every Monday at 7:00 AM" */
export function describeSchedule(rule: ScheduleRule): string {
  const h = rule.hour % 12 === 0 ? 12 : rule.hour % 12;
  const time = `${h}:00 ${rule.hour < 12 ? "AM" : "PM"}`;
  switch (rule.frequency) {
    case "daily":
      return `Every day at ${time}`;
    case "weekly":
      return `Every ${WEEKDAY_LABELS[(rule.weekday ?? 1) - 1]} at ${time}`;
    case "monthly":
      return `Monthly on day ${rule.monthDay ?? 1} at ${time}`;
  }
}
