import type { CommentCategory, NotePriority } from "@/app/(app)/leads/[id]/schemas";

/**
 * Pure helpers for the job feed (SPEC §8.5 #14 Notes, #15 Activity Log) and
 * the Customer section's account numbers. No I/O, so they're unit-tested and
 * shared by the server loaders and the client feed.
 */

type FeedBase = {
  id: string;
  /** ISO timestamp the entry happened (UTC). */
  at: string;
  /** True for history carried over from the lead this job was converted from. */
  fromLead: boolean;
  authorName: string | null;
};

export type FeedNote = FeedBase & {
  kind: "note";
  body: string;
  pinned: boolean;
  priority: NotePriority;
  updatedAt: string;
  mine: boolean;
};

export type FeedComment = FeedBase & {
  kind: "comment";
  body: string;
  category: CommentCategory;
  mentions: { id: string; name: string }[];
  editedAt: string | null;
  mine: boolean;
};

export type FeedEvent = FeedBase & { kind: "event"; type: string; summary: string };

export type FeedMessage = FeedBase & {
  kind: "message";
  channel: "sms" | "email" | "call" | "voicemail" | "portal";
  direction: "outbound" | "inbound";
  status: string;
  to: string | null;
  subject: string | null;
  body: string | null;
  callOutcome: string | null;
  callDurationSeconds: number | null;
  /** Sent by a workflow or campaign rather than typed by a person. */
  automatic?: boolean;
};

export type FeedItem = FeedNote | FeedComment | FeedEvent | FeedMessage;

export const FEED_FILTERS = [
  { id: "all", label: "All" },
  { id: "comments", label: "Comments" },
  { id: "notes", label: "Notes" },
  { id: "activity", label: "Activity" },
  { id: "documents", label: "Documents" },
  { id: "photos", label: "Photos" },
  { id: "appointments", label: "Appointments" },
  { id: "messages", label: "Messages" },
] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number]["id"];
export type FeedCategory = Exclude<FeedFilter, "all">;

/** Which chip an entry belongs to. Every entry has exactly one. */
export function feedCategory(item: FeedItem): FeedCategory {
  switch (item.kind) {
    case "note":
      return "notes";
    case "comment":
      return "comments";
    case "message":
      return "messages";
    case "event":
      if (item.type.startsWith("appointment_") || item.type.startsWith("walkthrough_"))
        return "appointments";
      if (item.type.startsWith("document_")) return "documents";
      if (item.type.startsWith("photo_")) return "photos";
      return "activity";
  }
}

/** Count per chip ("All" counts everything). */
export function countFeed(items: readonly FeedItem[]): Record<FeedFilter, number> {
  const counts: Record<FeedFilter, number> = {
    all: items.length,
    comments: 0,
    notes: 0,
    activity: 0,
    documents: 0,
    photos: 0,
    appointments: 0,
    messages: 0,
  };
  for (const item of items) counts[feedCategory(item)] += 1;
  return counts;
}

/** All the words someone might search for on an entry. */
function searchText(item: FeedItem): string {
  const parts: (string | null)[] = [item.authorName, item.fromLead ? "from the lead" : null];
  switch (item.kind) {
    case "note":
      parts.push(item.body, item.priority);
      break;
    case "comment":
      parts.push(item.body, item.category, ...item.mentions.map((m) => `@${m.name}`));
      break;
    case "event":
      parts.push(item.summary);
      break;
    case "message":
      parts.push(item.subject, item.body, item.to, item.channel, item.callOutcome);
      break;
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/** Entries matching a chip and a search (every word must appear, any order). */
export function filterFeed(
  items: readonly FeedItem[],
  filter: FeedFilter,
  query: string,
): FeedItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (filter !== "all" && feedCategory(item) !== filter) return false;
    if (!words.length) return true;
    const text = searchText(item);
    return words.every((w) => text.includes(w));
  });
}

/** Pinned notes first, then newest first (ties keep a stable order by id). */
export function sortFeed(items: readonly FeedItem[]): FeedItem[] {
  const pinned = (i: FeedItem) => (i.kind === "note" && i.pinned ? 1 : 0);
  return [...items].sort((a, b) => {
    const p = pinned(b) - pinned(a);
    if (p !== 0) return p;
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Default task title when turning a note or comment into a task. */
export function taskTitleFromPost(body: string, max = 120): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  const title = `Follow up: ${oneLine}`;
  return title.length <= max ? title : `${title.slice(0, max - 1).trimEnd()}…`;
}

// --- Customer section ----------------------------------------------------------

export type CustomerJobStatus = "open" | "on_hold" | "won" | "lost";

/** Won / open / lost counts across the customer's jobs (on hold counts as open). */
export function customerJobCounts(jobs: readonly { status: string }[]): {
  total: number;
  open: number;
  won: number;
  lost: number;
} {
  let open = 0;
  let won = 0;
  let lost = 0;
  for (const j of jobs) {
    if (j.status === "won") won += 1;
    else if (j.status === "lost") lost += 1;
    else open += 1;
  }
  return { total: jobs.length, open, won, lost };
}

/**
 * Lifetime contract value in cents: the sum of contract baselines on the
 * customer's jobs (Closed Lost excluded; jobs with no amount yet count as 0).
 */
export function lifetimeContractCents(
  rows: readonly { contractCents: number | null; status: string }[],
): number {
  let total = 0;
  for (const r of rows) {
    if (r.status === "lost" || r.contractCents === null) continue;
    total += Math.round(r.contractCents);
  }
  return total;
}
