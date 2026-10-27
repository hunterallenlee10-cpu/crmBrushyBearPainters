import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DISPLAY_TZ, formatDate, formatRelative } from "@/lib/format/dates";

/**
 * Time helpers for the Attention Center (pure, unit-tested). Stored in UTC,
 * shown and picked in Pacific time (CLAUDE.md).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "under a minute", "12 min", "3 h", "1 day", "4 days". */
export function formatSpan(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < MINUTE) return "under a minute";
  if (abs < HOUR) return `${Math.floor(abs / MINUTE)} min`;
  if (abs < DAY) return `${Math.floor(abs / HOUR)} h`;
  const days = Math.floor(abs / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

export type DueTone = "overdue" | "soon" | "later";

/** Due within this long counts as "soon" (amber). */
export const DUE_SOON_MS = 2 * HOUR;

/** SLA countdown from `due_at`: "due in 2 h" / "overdue by 1 day". Null when there's no due time. */
export function dueCountdown(
  dueAt: string | null | undefined,
  now: Date,
): { label: string; tone: DueTone } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;
  const diff = due - now.getTime();
  if (diff < 0) return { label: `overdue by ${formatSpan(diff)}`, tone: "overdue" };
  return { label: `due in ${formatSpan(diff)}`, tone: diff <= DUE_SOON_MS ? "soon" : "later" };
}

/** "opened 3 h ago", "opened yesterday", "opened on Sep 2, 2026". */
export function openedLabel(openedAt: string, now: Date): string {
  const rel = formatRelative(openedAt, now);
  if (rel === "—") return "opened —";
  if (rel === "just now" || rel === "yesterday" || rel.endsWith("ago")) return `opened ${rel}`;
  return `opened on ${formatDate(openedAt)}`;
}

/** Adds whole days to a YYYY-MM-DD calendar date (no time zone involved). */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y = NaN, m = NaN, d = NaN] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A Pacific wall-clock time ("2026-10-28T08:00") as a UTC instant. */
export function pacificWallTime(isoDate: string, time: string): Date {
  return fromZonedTime(`${isoDate}T${time}:00`, DISPLAY_TZ);
}

export type SnoozePresetId = "hour" | "tomorrow" | "monday";
export type SnoozePreset = { id: SnoozePresetId; label: string; detail: string; until: Date };

/** The morning hour presets snooze until (Pacific). */
export const SNOOZE_MORNING = "08:00";

/**
 * Snooze choices: 1 hour from now, tomorrow 8 AM Pacific, next Monday 8 AM
 * Pacific (a week out when today is Monday).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const today = formatInTimeZone(now, DISPLAY_TZ, "yyyy-MM-dd");
  const isoWeekday = Number(formatInTimeZone(now, DISPLAY_TZ, "i")); // 1 = Monday … 7 = Sunday
  const toMonday = isoWeekday === 1 ? 7 : 8 - isoWeekday;
  const hour = new Date(now.getTime() + HOUR);
  const tomorrow = pacificWallTime(addDaysToIsoDate(today, 1), SNOOZE_MORNING);
  const monday = pacificWallTime(addDaysToIsoDate(today, toMonday), SNOOZE_MORNING);
  const time = (d: Date) => formatInTimeZone(d, DISPLAY_TZ, "h:mm a");
  const day = (d: Date) => formatInTimeZone(d, DISPLAY_TZ, "EEE, MMM d");
  return [
    { id: "hour", label: "1 hour", detail: `until ${time(hour)}`, until: hour },
    { id: "tomorrow", label: "Tomorrow, 8 AM", detail: day(tomorrow), until: tomorrow },
    { id: "monday", label: "Next Monday, 8 AM", detail: day(monday), until: monday },
  ];
}

/**
 * A `datetime-local` value ("2026-10-28T08:00"), read as Pacific time, to an
 * ISO instant. Null when it isn't a valid date and time.
 */
export function pacificInputToIso(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value.trim());
  const date = m?.[1];
  const time = m?.[2];
  if (!date || !time) return null;
  const d = pacificWallTime(date, time);
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible dates that JavaScript would roll over (Feb 30 → Mar 2).
  if (formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd'T'HH:mm") !== `${date}T${time}`) return null;
  return d.toISOString();
}

/** Default for the custom snooze picker: tomorrow 8 AM Pacific, as a datetime-local value. */
export function defaultCustomSnooze(now: Date): string {
  const today = formatInTimeZone(now, DISPLAY_TZ, "yyyy-MM-dd");
  return `${addDaysToIsoDate(today, 1)}T${SNOOZE_MORNING}`;
}

/** Earliest value for the custom picker (now, Pacific). */
export function minCustomSnooze(now: Date): string {
  return formatInTimeZone(now, DISPLAY_TZ, "yyyy-MM-dd'T'HH:mm");
}
