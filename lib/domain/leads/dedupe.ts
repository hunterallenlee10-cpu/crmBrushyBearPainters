import { DEDUPE_WINDOW_DAYS } from "@/lib/domain/leads/constants";

/**
 * Duplicate matching (SPEC §14): a new submission with the same phone or email
 * as a lead created in the last 180 days is the same person. Pure: the caller
 * fetches candidates (indexed lookups by phone/email) and this picks the match.
 */

export type DedupeKeys = {
  phones: readonly (string | null | undefined)[];
  email: string | null | undefined;
};

export type DedupeCandidate = {
  id: string;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string;
  last_activity_at: string;
};

export type DedupeMatch<T extends DedupeCandidate> = {
  lead: T;
  matchedOn: ("phone" | "email")[];
};

export function dedupeWindowStart(now: Date, days = DEDUPE_WINDOW_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function phoneSet(values: readonly (string | null | undefined)[]): Set<string> {
  return new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0));
}

/**
 * Best existing lead for these keys, or null. Prefers open leads, then the one
 * with the most recent activity. Leads older than the window never match.
 */
export function findDuplicate<T extends DedupeCandidate>(
  keys: DedupeKeys,
  candidates: readonly T[],
  now: Date,
  windowDays = DEDUPE_WINDOW_DAYS,
): DedupeMatch<T> | null {
  const phones = phoneSet(keys.phones);
  const email = keys.email ?? null;
  if (phones.size === 0 && !email) return null;
  const since = dedupeWindowStart(now, windowDays).getTime();

  const matches: DedupeMatch<T>[] = [];
  for (const c of candidates) {
    if (new Date(c.created_at).getTime() < since) continue;
    const on: ("phone" | "email")[] = [];
    if ((c.mobile && phones.has(c.mobile)) || (c.phone && phones.has(c.phone))) on.push("phone");
    if (email && c.email === email) on.push("email");
    if (on.length > 0) matches.push({ lead: c, matchedOn: on });
  }
  if (matches.length === 0) return null;

  const isOpen = (s: string) => !["converted", "lost", "unqualified"].includes(s);
  matches.sort((a, b) => {
    const open = Number(isOpen(b.lead.status)) - Number(isOpen(a.lead.status));
    if (open !== 0) return open;
    return (
      new Date(b.lead.last_activity_at).getTime() - new Date(a.lead.last_activity_at).getTime()
    );
  });
  return matches[0] ?? null;
}

/** Plain-language reason for the duplicate banner ("Same phone and email as…"). */
export function describeMatch(matchedOn: readonly ("phone" | "email")[]): string {
  if (matchedOn.includes("phone") && matchedOn.includes("email")) return "Same phone and email";
  if (matchedOn.includes("phone")) return "Same phone number";
  return "Same email address";
}
