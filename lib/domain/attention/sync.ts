import type { AttentionPriority, DesiredItem } from "./rules";

/**
 * Turns "what should be open" into database changes (pure, tested).
 *
 * - New problem → insert an item.
 * - Still there → refresh title/priority/due (escalation) and last_seen.
 * - Gone → auto-resolve (resolution "auto").
 * - Snoozed past its time → back to pending.
 * - Resolved by a person while the problem is still there → stays resolved
 *   (no nagging) until the problem clears; it can open again after that.
 */

export type ExistingItem = {
  id: string;
  dedupeKey: string;
  status: "pending" | "in_progress" | "snoozed" | "resolved";
  priority: AttentionPriority;
  title: string;
  detail: string | null;
  dueAt: string | null;
  ownerId: string | null;
  snoozedUntil: string | null;
  resolution: "auto" | "manual" | null;
  conditionClearedAt: string | null;
};

export type SyncPlan = {
  inserts: DesiredItem[];
  updates: {
    id: string;
    priority: AttentionPriority;
    title: string;
    detail: string | null;
    dueAt: string | null;
    /** Snooze ended: back to pending. */
    unsnooze: boolean;
  }[];
  /** Still-present problems: bump last_seen only. */
  seen: string[];
  autoResolve: string[];
  /** Manually resolved items whose problem has now cleared. */
  markCleared: string[];
};

/** Postgres returns "…+00:00", JavaScript writes "….000Z": compare instants. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * @param desired items the rules produced
 * @param existing every open item, plus the latest manually-resolved item per
 *        key whose problem hasn't cleared yet
 */
export function planAttentionSync(
  desired: readonly DesiredItem[],
  existing: readonly ExistingItem[],
  now: Date,
): SyncPlan {
  const plan: SyncPlan = { inserts: [], updates: [], seen: [], autoResolve: [], markCleared: [] };
  const open = new Map<string, ExistingItem>();
  const manual = new Map<string, ExistingItem>();
  for (const e of existing) {
    if (e.status !== "resolved") open.set(e.dedupeKey, e);
    else if (e.resolution === "manual" && !e.conditionClearedAt) manual.set(e.dedupeKey, e);
  }

  const wanted = new Set<string>();
  for (const d of desired) {
    if (wanted.has(d.dedupeKey)) continue;
    wanted.add(d.dedupeKey);
    const current = open.get(d.dedupeKey);
    if (current) {
      const unsnooze =
        current.status === "snoozed" &&
        current.snoozedUntil !== null &&
        new Date(current.snoozedUntil).getTime() <= now.getTime();
      const changed =
        current.priority !== d.priority ||
        current.title !== d.title ||
        current.detail !== d.detail ||
        !sameInstant(current.dueAt, d.dueAt);
      if (changed || unsnooze) {
        plan.updates.push({
          id: current.id,
          priority: d.priority,
          title: d.title,
          detail: d.detail,
          dueAt: d.dueAt,
          unsnooze,
        });
      } else {
        plan.seen.push(current.id);
      }
      continue;
    }
    if (manual.has(d.dedupeKey)) continue; // a person resolved it; don't reopen yet
    plan.inserts.push(d);
  }

  for (const [key, item] of open) {
    if (!wanted.has(key)) plan.autoResolve.push(item.id);
  }
  for (const [key, item] of manual) {
    if (!wanted.has(key)) plan.markCleared.push(item.id);
  }
  return plan;
}
