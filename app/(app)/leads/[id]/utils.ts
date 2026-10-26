import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DISPLAY_TZ } from "@/lib/format/dates";
import type { Scope } from "@/lib/permissions";

/** Pure helpers for Lead Detail (time zones and record-level scope). */

/** A Pacific wall-clock date ("2026-11-03") + time ("09:30") → UTC ISO instant. */
export function pacificToUtcIso(date: string, time: string): string {
  return fromZonedTime(`${date}T${time}:00`, DISPLAY_TZ).toISOString();
}

/** UTC instant → Pacific { date: "YYYY-MM-DD", time: "HH:MM" } for form inputs. */
export function utcToPacificParts(value: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!value) return { date: "", time: "" };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: formatInTimeZone(d, DISPLAY_TZ, "yyyy-MM-dd"),
    time: formatInTimeZone(d, DISPLAY_TZ, "HH:mm"),
  };
}

export type ScopedRecord = {
  ownerId: string | null;
  createdBy: string | null;
  territoryId: string | null;
};

/**
 * Mirrors `app.scope_match` so the page only offers what RLS will allow.
 * The database still decides; this just avoids buttons that would fail.
 */
export function scopeAllows(
  scope: Scope | undefined,
  record: ScopedRecord,
  me: { id: string; territoryId: string | null },
): boolean {
  if (!scope) return false;
  if (scope === "all") return true;
  const own = record.ownerId === me.id || record.createdBy === me.id;
  if (scope === "own") return own;
  return own || (record.territoryId !== null && record.territoryId === me.territoryId);
}

/** Two-letter initials for the header avatar. */
export function nameInitials(first: string, last: string | null): string {
  const a = first.trim()[0] ?? "";
  const b = last?.trim()[0] ?? first.trim()[1] ?? "";
  return (a + b).toUpperCase();
}

/** Google Maps search link for an address (a plain link; no API call). */
export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export const LEAD_TABS = ["details", "activity", "notes", "comments", "tasks"] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

export function parseTab(value: string | string[] | undefined): LeadTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (LEAD_TABS as readonly string[]).includes(v ?? "") ? (v as LeadTab) : "details";
}
