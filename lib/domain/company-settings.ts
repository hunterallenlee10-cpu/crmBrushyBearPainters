/**
 * Company settings rules (SPEC §1.1, §8.19). Phone, email, hours and license
 * numbers stay placeholders until the owners provide real values; the app shows
 * a warning wherever a placeholder would reach a customer.
 */

export const PLACEHOLDERS = {
  phone: "[PHONE]",
  email: "[EMAIL]",
  hours_text: "[HOURS]",
  lni_number: "[LNI_NUMBER]",
  ubi_number: "[UBI_NUMBER]",
} as const;

export type PlaceholderField = keyof typeof PLACEHOLDERS;

export function isPlaceholder(value: string | null | undefined): boolean {
  return !value || /^\[[A-Z_]+\]$/.test(value.trim());
}

export function placeholderFields(
  settings: Partial<Record<PlaceholderField, string | null>>,
): PlaceholderField[] {
  return (Object.keys(PLACEHOLDERS) as PlaceholderField[]).filter((f) =>
    isPlaceholder(settings[f]),
  );
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export type DayHours = { open: string; close: string } | { by_appointment: true } | null;
export type BusinessHours = Record<Weekday, DayHours>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

/** Validates business hours; returns per-day error messages (empty when valid). */
export function validateBusinessHours(hours: BusinessHours): Partial<Record<Weekday, string>> {
  const errors: Partial<Record<Weekday, string>> = {};
  for (const day of WEEKDAYS) {
    const h = hours[day];
    if (h === null || "by_appointment" in h) continue;
    if (!isValidTime(h.open) || !isValidTime(h.close)) {
      errors[day] = "Use 24-hour times like 08:00.";
    } else if (h.open >= h.close) {
      errors[day] = "Closing time must be after opening time.";
    }
  }
  return errors;
}

/** Normalizes whatever is stored (possibly partial) into a full week. */
export function toBusinessHours(raw: unknown): BusinessHours {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as BusinessHours;
  for (const day of WEEKDAYS) {
    const v = src[day];
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.by_appointment === true) {
        out[day] = { by_appointment: true };
        continue;
      }
      if (typeof o.open === "string" && typeof o.close === "string") {
        out[day] = { open: o.open, close: o.close };
        continue;
      }
    }
    out[day] = null;
  }
  return out;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "MM-DD" season boundary (Feb 29 allowed). */
export function isValidMonthDay(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const max = DAYS_IN_MONTH[month - 1];
  return max !== undefined && day >= 1 && day <= max;
}

/** True when `date` (a Pacific calendar date "YYYY-MM-DD") falls inside the season. Handles seasons that wrap the new year. */
export function isInSeason(date: string, start: string, end: string): boolean {
  const md = date.slice(5, 10);
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
