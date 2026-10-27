import type { IsoDate } from "./dates";
import { nextGuaranteeDate, type RescheduleReason } from "./on-time";

/**
 * Draft → Publish (SPEC §8.6): changes on the Master Schedule are drafts until
 * "Publish changes", which applies them, sets each job's promised start date
 * (and the on-time guarantee date), notifies customers whose dates changed and
 * the crews whose days changed, and moves Ready to Schedule jobs to Scheduled.
 * This module plans all of that from the entries; the server applies it. Pure.
 */

export type EntryState = {
  id: string;
  jobId: string;
  status: "draft" | "published" | "canceled";
  crewId: string | null;
  startsOn: IsoDate | null;
  endsOn: IsoDate | null;
  draftAction: "create" | "update" | "cancel" | null;
  draftCrewId: string | null;
  draftStartsOn: IsoDate | null;
  draftEndsOn: IsoDate | null;
  draftReason: RescheduleReason | null;
};

export type Slot = { crewId: string; startsOn: IsoDate; endsOn: IsoDate };

/** What the schedule shows for an entry right now (the draft if one is pending). */
export function effectiveSlot(e: EntryState): Slot | null {
  if (e.status === "canceled" || e.draftAction === "cancel") return null;
  if (
    (e.draftAction === "create" || e.draftAction === "update") &&
    e.draftCrewId &&
    e.draftStartsOn &&
    e.draftEndsOn
  ) {
    return { crewId: e.draftCrewId, startsOn: e.draftStartsOn, endsOn: e.draftEndsOn };
  }
  if (e.status === "published" && e.crewId && e.startsOn && e.endsOn) {
    return { crewId: e.crewId, startsOn: e.startsOn, endsOn: e.endsOn };
  }
  return null;
}

/** What customers and crews were last told. */
export function publishedSlot(e: EntryState): Slot | null {
  if (e.status !== "published" || !e.crewId || !e.startsOn || !e.endsOn) return null;
  return { crewId: e.crewId, startsOn: e.startsOn, endsOn: e.endsOn };
}

export function hasPendingChange(e: EntryState): boolean {
  return e.draftAction !== null && e.status !== "canceled";
}

export type EntryChange = {
  entryId: string;
  jobId: string;
  action: "create" | "update" | "cancel";
  before: Slot | null;
  after: Slot | null;
  reason: RescheduleReason;
};

export type JobFactsForPublish = {
  stage: string;
  guaranteeDate: IsoDate | null;
  isPriorityReschedule: boolean;
};

export type JobPublishPlan = {
  jobId: string;
  firstStartBefore: IsoDate | null;
  firstStartAfter: IsoDate | null;
  lastEndAfter: IsoDate | null;
  guaranteeDate: IsoDate | null;
  customerChange: "scheduled" | "moved" | "unscheduled" | "crew_changed" | "unchanged";
  notifyCustomer: boolean;
  /** Crews whose days changed (old and new). */
  crewIds: string[];
  /** Ready to Schedule with published dates after this: move to Scheduled. */
  advanceToScheduled: boolean;
  /** The rain-day priority flag comes off once the job has new dates. */
  clearPriority: boolean;
  reason: RescheduleReason;
};

const REASON_RANK: Record<RescheduleReason, number> = { company: 0, customer: 1, weather: 2 };

function minStart(slots: readonly (Slot | null)[]): IsoDate | null {
  const s = slots
    .filter((x): x is Slot => x !== null)
    .map((x) => x.startsOn)
    .sort();
  return s[0] ?? null;
}

function maxEnd(slots: readonly (Slot | null)[]): IsoDate | null {
  const s = slots
    .filter((x): x is Slot => x !== null)
    .map((x) => x.endsOn)
    .sort();
  return s[s.length - 1] ?? null;
}

function sameSlot(a: Slot | null, b: Slot | null): boolean {
  if (a === null || b === null) return a === b;
  return a.crewId === b.crewId && a.startsOn === b.startsOn && a.endsOn === b.endsOn;
}

/**
 * @param entries every live entry of the jobs involved (so first starts are right)
 * @param selected entry ids to publish (null: every pending change)
 */
export function planPublish(
  entries: readonly EntryState[],
  jobs: ReadonlyMap<string, JobFactsForPublish>,
  selected: readonly string[] | null = null,
): { changes: EntryChange[]; jobs: JobPublishPlan[] } {
  const pick = selected ? new Set(selected) : null;
  const changes: EntryChange[] = [];
  for (const e of entries) {
    if (!hasPendingChange(e) || (pick && !pick.has(e.id))) continue;
    const action = e.draftAction as "create" | "update" | "cancel";
    const before = publishedSlot(e);
    const after = action === "cancel" ? null : effectiveSlot(e);
    if (action !== "cancel" && !after) continue;
    changes.push({
      entryId: e.id,
      jobId: e.jobId,
      action,
      before,
      after,
      reason: e.draftReason ?? "company",
    });
  }

  const byJob = new Map<string, EntryChange[]>();
  for (const c of changes) byJob.set(c.jobId, [...(byJob.get(c.jobId) ?? []), c]);

  const plans: JobPublishPlan[] = [];
  for (const [jobId, jobChanges] of byJob) {
    const job = jobs.get(jobId);
    if (!job) continue;
    const mine = entries.filter((e) => e.jobId === jobId);
    const changed = new Map(jobChanges.map((c) => [c.entryId, c]));
    const beforeSlots = mine.map(publishedSlot);
    const afterSlots = mine.map((e) => {
      const c = changed.get(e.id);
      return c ? c.after : publishedSlot(e);
    });
    const firstBefore = minStart(beforeSlots);
    const firstAfter = minStart(afterSlots);
    const lastAfter = maxEnd(afterSlots);
    const reason = jobChanges
      .map((c) => c.reason)
      .sort((a, b) => REASON_RANK[b] - REASON_RANK[a])[0] as RescheduleReason;
    const crewsBefore = new Set(beforeSlots.filter((s): s is Slot => !!s).map((s) => s.crewId));
    const crewsAfter = new Set(afterSlots.filter((s): s is Slot => !!s).map((s) => s.crewId));
    const crewChanged =
      crewsBefore.size !== crewsAfter.size || [...crewsAfter].some((c) => !crewsBefore.has(c));
    const customerChange: JobPublishPlan["customerChange"] =
      firstBefore === null && firstAfter !== null
        ? "scheduled"
        : firstBefore !== null && firstAfter === null
          ? "unscheduled"
          : firstBefore !== firstAfter || maxEnd(beforeSlots) !== lastAfter
            ? "moved"
            : crewChanged
              ? "crew_changed"
              : "unchanged";
    const crewIds = new Set<string>();
    for (const c of jobChanges) {
      if (sameSlot(c.before, c.after)) continue;
      if (c.before) crewIds.add(c.before.crewId);
      if (c.after) crewIds.add(c.after.crewId);
    }
    plans.push({
      jobId,
      firstStartBefore: firstBefore,
      firstStartAfter: firstAfter,
      lastEndAfter: lastAfter,
      guaranteeDate:
        firstAfter === null
          ? job.guaranteeDate
          : nextGuaranteeDate(job.guaranteeDate, firstAfter, reason),
      customerChange,
      notifyCustomer: customerChange !== "unchanged",
      crewIds: [...crewIds].sort(),
      advanceToScheduled: job.stage === "ready_to_schedule" && firstAfter !== null,
      clearPriority:
        job.isPriorityReschedule &&
        firstAfter !== null &&
        (customerChange === "scheduled" || customerChange === "moved"),
      reason,
    });
  }
  return { changes, jobs: plans.sort((a, b) => a.jobId.localeCompare(b.jobId)) };
}
