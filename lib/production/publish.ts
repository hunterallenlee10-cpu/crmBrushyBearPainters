import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { ActionFailure, actionError } from "@/lib/actions/errors";
import { formatRange, type IsoDate } from "@/lib/domain/scheduling/dates";
import {
  blockingConflicts,
  checkPlacement,
  type Conflict,
} from "@/lib/domain/scheduling/conflicts";
import { planPublish, type JobPublishPlan } from "@/lib/domain/scheduling/publish";
import {
  arrivalWindowLabel,
  crewNotice,
  scheduleNotice,
  SCHEDULE_TEMPLATE_KEY,
} from "@/lib/domain/scheduling/messages";
import { logError } from "@/lib/log";
import { recomputeJobHealth } from "@/lib/jobs/health";
import {
  loadCrews,
  loadEntries,
  loadJobFacts,
  loadSchedulingConfig,
  toBars,
  toEntryState,
  type EntryRow,
} from "./context";
import { advanceProduction, evaluateJobOnTime } from "./automation";
import { sendCrewNotice, sendCustomerNotice, signerName } from "./notify";

type Db = SupabaseClient<Database>;

/**
 * "Publish changes" on the Master Schedule (SPEC §8.6, §11.2 #8). Every
 * pending change is checked against the work rules first; if any is blocked
 * nothing is published and the reasons come back. Otherwise drafts become the
 * published schedule, each job gets its promised start date and on-time
 * guarantee date, customers whose dates changed and the crews whose days
 * changed get simulated notices through the outbox, and Ready to Schedule jobs
 * move to Scheduled through the stage engine.
 */

export type BlockedEntry = { entryId: string; jobId: string; jobLabel: string; reasons: string[] };

export type PublishResult = {
  published: number;
  jobs: number;
  customerNotices: number;
  crewNotices: number;
  skippedNotices: string[];
  movedToScheduled: number;
};

export class PublishBlocked extends ActionFailure {
  constructor(readonly blocked: BlockedEntry[]) {
    super(
      actionError(
        "validation",
        `Nothing was published. ${blocked
          .map((b) => `${b.jobLabel}: ${b.reasons.join(" ")}`)
          .join(" ")}`,
      ),
    );
  }
}

/** Checks every pending change; returns the blocked ones (empty when Publish can go ahead). */
export async function checkPendingChanges(
  db: Db,
  orgId: string,
  entryIds: readonly string[] | null,
  now = new Date(),
): Promise<{ blocked: BlockedEntry[]; conflicts: Map<string, Conflict[]>; pending: EntryRow[] }> {
  const all = await loadEntries(db, { orgId });
  const pending = all.filter(
    (e) => e.draft_action !== null && (!entryIds || entryIds.includes(e.id)),
  );
  const config = await loadSchedulingConfig(db, orgId, now);
  const crews = new Map(
    (await loadCrews(db, { includeInactive: true, from: config.context.today, orgId })).map((c) => [
      c.id,
      c,
    ]),
  );
  const jobs = await loadJobFacts(db, [...new Set(all.map((e) => e.job_id))]);
  const bars = toBars(all, jobs);
  const conflicts = new Map<string, Conflict[]>();
  const blocked: BlockedEntry[] = [];
  for (const e of pending) {
    if (e.draft_action === "cancel") continue;
    const job = jobs.get(e.job_id);
    if (!job || !e.draft_crew_id || !e.draft_starts_on || !e.draft_ends_on) continue;
    const found = checkPlacement(
      {
        entryId: e.id,
        jobId: e.job_id,
        crewId: e.draft_crew_id,
        workType: e.work_type,
        startsOn: e.draft_starts_on,
        endsOn: e.draft_ends_on,
        allowSplit: e.allow_split,
        overrideRules: e.override_rules,
      },
      job,
      crews.get(e.draft_crew_id) ?? null,
      bars.filter((b) => b.id !== e.id),
      // Stretching a job that already started keeps its (past) start day.
      e.starts_on && e.draft_starts_on === e.starts_on && e.starts_on < config.context.today
        ? { ...config.context, today: e.starts_on }
        : config.context,
    );
    conflicts.set(e.id, found);
    const blocks = blockingConflicts(found);
    if (blocks.length) {
      blocked.push({
        entryId: e.id,
        jobId: e.job_id,
        jobLabel: job.label,
        reasons: blocks.map((c) => c.message),
      });
    }
  }
  return { blocked, conflicts, pending };
}

export async function publishSchedule(
  service: Db,
  input: { orgId: string; actorId: string; entryIds: readonly string[] | null; now?: Date },
): Promise<PublishResult> {
  const now = input.now ?? new Date();
  const { blocked, pending } = await checkPendingChanges(service, input.orgId, input.entryIds, now);
  if (!pending.length) {
    throw new ActionFailure(actionError("validation", "There are no draft changes to publish."));
  }
  if (blocked.length) throw new PublishBlocked(blocked);

  const jobIds = [...new Set(pending.map((e) => e.job_id))];
  const live = await loadEntries(service, { jobIds, orgId: input.orgId });
  const facts = await loadJobFacts(service, jobIds);
  const config = await loadSchedulingConfig(service, input.orgId, now);
  const plan = planPublish(
    live.map(toEntryState),
    new Map(
      [...facts.values()].map((j) => [
        j.id,
        {
          stage: j.stage,
          guaranteeDate: j.guaranteeDate,
          isPriorityReschedule: j.isPriorityReschedule,
        },
      ]),
    ),
    pending.map((e) => e.id),
  );

  // 1. Apply the drafts.
  const stamp = now.toISOString();
  for (const c of plan.changes) {
    const update =
      c.action === "cancel"
        ? { status: "canceled", draft_action: null }
        : {
            status: "published",
            crew_id: c.after?.crewId ?? null,
            starts_on: c.after?.startsOn ?? null,
            ends_on: c.after?.endsOn ?? null,
            published_at: stamp,
            published_by: input.actorId,
            draft_action: null,
          };
    const { error } = await service.from("schedule_entries").update(update).eq("id", c.entryId);
    if (error) throw error;
  }

  // 2. Jobs: promised start, guarantee date, crew, rain flag, completion date.
  const crews = new Map(
    (await loadCrews(service, { includeInactive: true, orgId: input.orgId })).map((c) => [c.id, c]),
  );
  for (const p of plan.jobs) {
    const job = facts.get(p.jobId);
    if (!job) continue;
    const firstCrew =
      plan.changes.find((c) => c.jobId === p.jobId && c.after)?.after?.crewId ?? null;
    const patch: Database["public"]["Tables"]["jobs"]["Update"] = {
      guarantee_start_date: p.guaranteeDate,
    };
    if (p.firstStartAfter) patch.promised_start_date = p.firstStartAfter;
    if (p.lastEndAfter) patch.estimated_completion_date = p.lastEndAfter;
    if (!job.crewId && firstCrew) patch.crew_id = firstCrew;
    if (p.clearPriority) patch.is_priority_reschedule = false;
    const { error } = await service.from("jobs").update(patch).eq("id", p.jobId);
    if (error) throw error;
  }

  // 3. Notices (simulated, through the outbox).
  let customerNotices = 0;
  let crewNotices = 0;
  const skippedNotices: string[] = [];
  const arrival = arrivalWindowLabel(
    config.settings.dayStart,
    config.settings.arrivalWindowMinutes,
  );
  for (const p of plan.jobs) {
    if (!p.notifyCustomer || p.customerChange === "unchanged") continue;
    const job = facts.get(p.jobId);
    if (!job) continue;
    const leadCrew = plan.changes.find((c) => c.jobId === p.jobId && c.after)?.after?.crewId;
    const contact = await firstName(service, job.primaryContactId);
    const notice = scheduleNotice(
      p.customerChange,
      { startsOn: p.firstStartAfter, endsOn: p.lastEndAfter },
      {
        customerFirstName: contact,
        signerName: await signerName(service, p.jobId, config.companyName),
        companyName: config.companyName,
        crewLeadName: leadCrew ? (crews.get(leadCrew)?.leadName ?? null) : null,
        arrivalWindow: arrival,
      },
    );
    try {
      const r = await sendCustomerNotice(service, p.jobId, {
        ...notice,
        templateKey: SCHEDULE_TEMPLATE_KEY,
        actorId: input.actorId,
      });
      if (r.status === "simulated") customerNotices++;
      else skippedNotices.push(`${job.label}: ${r.reason}`);
    } catch (e) {
      logError("production.publish.customer_notice", e);
      skippedNotices.push(`${job.label}: the customer notice couldn't be recorded.`);
    }
  }
  const byCrew = new Map<
    string,
    { jobLabel: string; city: string | null; before: string | null; after: string | null }[]
  >();
  for (const c of plan.changes) {
    const job = facts.get(c.jobId);
    const label = (s: { startsOn: IsoDate; endsOn: IsoDate } | null) =>
      s ? formatRange(s.startsOn, s.endsOn) : null;
    const crewsHit = new Set([c.before?.crewId, c.after?.crewId].filter((x): x is string => !!x));
    for (const crewId of crewsHit) {
      const rows = byCrew.get(crewId) ?? [];
      rows.push({
        jobLabel: job?.label ?? "A job",
        city: job?.city ?? null,
        before: c.before?.crewId === crewId ? label(c.before) : null,
        after: c.after?.crewId === crewId ? label(c.after) : null,
      });
      byCrew.set(crewId, rows);
    }
  }
  for (const [crewId, rows] of byCrew) {
    const changed = rows.filter((r) => r.before !== r.after);
    if (!changed.length) continue;
    const n = crewNotice(crews.get(crewId)?.name ?? "your crew", changed);
    try {
      const r = await sendCrewNotice(service, {
        orgId: input.orgId,
        crewId,
        subject: n.subject,
        body: n.body,
        link: "/schedule/my-projects",
        related: { type: "crew", id: crewId },
        actorId: input.actorId,
      });
      if (r.outboxId || r.notified) crewNotices++;
    } catch (e) {
      logError("production.publish.crew_notice", e);
    }
  }

  // 4. Timeline, event, stage moves, on-time and health.
  let movedToScheduled = 0;
  for (const p of plan.jobs) {
    const job = facts.get(p.jobId);
    await service.from("activity").insert({
      org_id: input.orgId,
      subject_type: "job",
      subject_id: p.jobId,
      type: "schedule_published",
      summary: publishSummary(p),
      payload: { first_start: p.firstStartAfter, last_end: p.lastEndAfter, reason: p.reason },
      actor_id: input.actorId,
    });
    if (p.advanceToScheduled || job?.stage === "ready_to_schedule") {
      const moved = await advanceProduction(service, p.jobId).catch((e: unknown): string[] => {
        logError("production.publish.advance", e);
        return [];
      });
      if (moved.includes("scheduled")) movedToScheduled++;
    }
    await evaluateJobOnTime(service, p.jobId, now).catch((e: unknown) =>
      logError("production.publish.on_time", e),
    );
  }
  await service.rpc("emit_production_event", {
    p_type: "schedule.published",
    p_aggregate_type: "schedule",
    p_aggregate_id: input.orgId,
    p_payload: {
      org_id: input.orgId,
      entries: plan.changes.map((c) => c.entryId),
      jobs: plan.jobs.map((j) => j.jobId),
      customer_notices: customerNotices,
      crew_notices: crewNotices,
    } as unknown as Json,
  });
  await recomputeJobHealth(service, jobIds, now).catch((e: unknown) =>
    logError("production.publish.health", e),
  );

  return {
    published: plan.changes.length,
    jobs: plan.jobs.length,
    customerNotices,
    crewNotices,
    skippedNotices,
    movedToScheduled,
  };
}

function publishSummary(p: JobPublishPlan): string {
  const when =
    p.firstStartAfter && p.lastEndAfter ? formatRange(p.firstStartAfter, p.lastEndAfter) : null;
  switch (p.customerChange) {
    case "scheduled":
      return `Schedule published: ${when}`;
    case "moved":
      return `Schedule moved to ${when}${p.reason !== "company" ? ` (${p.reason === "weather" ? "weather" : "customer request"})` : ""}`;
    case "unscheduled":
      return "Production dates taken off the schedule";
    case "crew_changed":
      return `Crew changed for ${when}`;
    default:
      return "Schedule published (no date change)";
  }
}

async function firstName(service: Db, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await service
    .from("contacts")
    .select("first_name")
    .eq("id", contactId)
    .maybeSingle();
  return data?.first_name ?? null;
}
