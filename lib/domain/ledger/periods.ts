import type { IsoDay } from "./types";

/**
 * Month close (SPEC §10): Finance locks a month; afterwards a change to an
 * invoice issued or a payment received in that month needs an owner override
 * with a reason. Months are Pacific calendar months ("YYYY-MM").
 */

export const LOCK_OVERRIDE_REASON_MIN = 10;

export type MonthKey = string;

export function monthOf(day: IsoDay): MonthKey {
  return day.slice(0, 7);
}

/** First day of a month key. */
export function monthStart(month: MonthKey): IsoDay {
  return `${month}-01`;
}

export function isMonthKey(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function monthLabel(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function previousMonth(month: MonthKey): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? 1970;
  const mon = m ?? 1;
  return mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
}

/** The record falls in a closed month. Undated records (drafts) are never locked. */
export function isLocked(day: IsoDay | null | undefined, closed: ReadonlySet<MonthKey>): boolean {
  return !!day && closed.has(monthOf(day));
}

/**
 * Whether a change may go ahead: unlocked → yes; locked → only with the
 * override permission and a reason of at least 10 characters.
 */
export function lockDecision(input: {
  locked: boolean;
  canOverride: boolean;
  reason?: string | null;
}): { ok: true; override: boolean } | { ok: false; message: string; needsReason: boolean } {
  if (!input.locked) return { ok: true, override: false };
  if (!input.canOverride) {
    return {
      ok: false,
      needsReason: false,
      message: "That month is closed. Ask an owner to make this change with an override.",
    };
  }
  if ((input.reason ?? "").trim().length < LOCK_OVERRIDE_REASON_MIN) {
    return {
      ok: false,
      needsReason: true,
      message: "That month is closed. Say why you're changing it (at least 10 characters).",
    };
  }
  return { ok: true, override: true };
}

/** A month can be closed once it's over (never the current or a future month). */
export function canCloseMonth(month: MonthKey, today: IsoDay): string | null {
  if (!isMonthKey(month)) return "Pick a month.";
  if (month >= monthOf(today)) return "Only a month that has ended can be closed.";
  return null;
}
