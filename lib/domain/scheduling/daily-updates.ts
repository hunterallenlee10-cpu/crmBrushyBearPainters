import { addDays, isoDow, pacificHour, pacificToday, productionDays, type IsoDate } from "./dates";

/**
 * "A photo update every day" (SPEC §1.3): a production day is a published
 * schedule day on a production weekday that isn't a marked rain day. A day is
 * due once the cutoff (default 7:00 pm Pacific) has passed. Pure.
 */

export type PublishedRange = { startsOn: IsoDate; endsOn: IsoDate };

/** Every production day the job is scheduled for. */
export function jobProductionDays(
  ranges: readonly PublishedRange[],
  workdays: readonly number[],
  rainDays: readonly IsoDate[] = [],
): IsoDate[] {
  const days = new Set<IsoDate>();
  for (const r of ranges) {
    for (const d of productionDays(r.startsOn, r.endsOn, workdays)) days.add(d);
  }
  for (const d of rainDays) days.delete(d);
  return [...days].sort();
}

/** Days whose daily update is due by now (cutoff passed), within the lookback. */
export function dueDays(
  days: readonly IsoDate[],
  now: Date,
  opts: { cutoffHour: number; lookbackDays: number },
): IsoDate[] {
  const today = pacificToday(now);
  const from = addDays(today, -Math.max(0, opts.lookbackDays));
  const pastCutoff = pacificHour(now) >= opts.cutoffHour;
  return days.filter((d) => d >= from && (d < today || (d === today && pastCutoff)));
}

/** Production days due by now with no daily log. */
export function missedDailyUpdates(
  days: readonly IsoDate[],
  logDates: readonly IsoDate[],
  now: Date,
  opts: { cutoffHour: number; lookbackDays: number },
): IsoDate[] {
  const logged = new Set(logDates);
  return dueDays(days, now, opts).filter((d) => !logged.has(d));
}

/** Logged ÷ due (null when nothing is due). */
export function dailyUpdateCompliance(due: number, logged: number): number | null {
  if (due <= 0) return null;
  return Math.min(1, Math.max(0, logged / due));
}

/** Is `date` a production day for this job (for "Today" screens)? */
export function isProductionDay(
  date: IsoDate,
  ranges: readonly PublishedRange[],
  workdays: readonly number[],
): boolean {
  return (
    workdays.includes(isoDow(date)) && ranges.some((r) => r.startsOn <= date && date <= r.endsOn)
  );
}
