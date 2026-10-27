import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { calendarWindow, type CalendarView } from "@/lib/domain/scheduling/calendar";
import { checkPlacement, isBlocked, type Conflict } from "@/lib/domain/scheduling/conflicts";
import {
  addDays,
  endAfterWorkingDays,
  nextProductionDay,
  type IsoDate,
} from "@/lib/domain/scheduling/dates";
import { effectiveSlot, publishedSlot } from "@/lib/domain/scheduling/publish";
import { firstOpenStart, rankCrews, type RankedCrew } from "@/lib/domain/scheduling/recommend";
import { materialsStatus } from "@/lib/domain/scheduling/readiness";
import type { ScheduleBoardStats } from "@/lib/metrics/registry";
import {
  defaultEntryWorkType,
  jobWorkingDays,
  loadCrews,
  loadEntries,
  loadJobFacts,
  loadSchedulingConfig,
  toBars,
  toEntryState,
  type CrewRecord,
  type EntryRow,
  type JobRecord,
  type SchedulingConfig,
} from "./context";

type Db = SupabaseClient<Database>;

/**
 * Master Schedule data (SPEC §8.6): crews, every bar in the window with its
 * conflicts (checked against everything on the schedule, so a person sees the
 * same blocks Publish will), and the To Be Scheduled tray (rain reschedules
 * pinned on top) with a recommended crew and date for each job. The schedule
 * and crews are read with the service client after the page's schedule:read
 * check (that permission covers the whole company); job names come from the
 * person's own client, so jobs they can't open show as "Booked".
 */

export type BoardBar = {
  id: string;
  jobId: string;
  /** null when the person can't open the job. */
  jobLabel: string | null;
  city: string | null;
  crewId: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  workType: string;
  status: "draft" | "published";
  /** A change waiting for Publish (new, moved, or canceled). */
  pending: "create" | "update" | "cancel" | null;
  published: { crewId: string; startsOn: IsoDate; endsOn: IsoDate } | null;
  allowSplit: boolean;
  overrideRules: string[];
  conflicts: Conflict[];
  blocked: boolean;
  priorityReschedule: boolean;
};

export type TrayCard = {
  jobId: string;
  label: string;
  city: string | null;
  stage: string;
  workTypes: readonly string[];
  workType: string;
  priorityReschedule: boolean;
  plannedStart: IsoDate | null;
  workingDays: number;
  crewId: string | null;
  materials: ReturnType<typeof materialsStatus>;
  hoaPending: boolean;
  leadSafe: boolean;
  blockingHolds: string[];
  recommended: {
    crewId: string;
    crewName: string;
    score: number;
    startsOn: IsoDate;
    endsOn: IsoDate;
  } | null;
  ranking: RankedCrew[];
  /** Conflicts for the recommended placement (or the first crew when none fits). */
  conflicts: Conflict[];
};

export type BoardData = {
  view: CalendarView;
  anchor: IsoDate;
  days: IsoDate[];
  today: IsoDate;
  config: SchedulingConfig;
  crews: CrewRecord[];
  bars: BoardBar[];
  tray: TrayCard[];
  stats: ScheduleBoardStats;
  weatherConnected: boolean;
};

async function visibleJobIds(supabase: Db, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("jobs")
      .select("id")
      .in("id", ids.slice(i, i + 200));
    for (const j of data ?? []) out.add(j.id);
  }
  return out;
}

function toBar(
  e: EntryRow,
  facts: ReadonlyMap<string, JobRecord>,
  visible: ReadonlySet<string>,
  conflicts: Conflict[],
): BoardBar | null {
  const st = toEntryState(e);
  const slot = effectiveSlot(st) ?? publishedSlot(st);
  if (!slot) return null;
  const job = facts.get(e.job_id);
  return {
    id: e.id,
    jobId: e.job_id,
    jobLabel: visible.has(e.job_id) ? (job?.label ?? null) : null,
    city: visible.has(e.job_id) ? (job?.city ?? null) : null,
    crewId: slot.crewId,
    startsOn: slot.startsOn,
    endsOn: slot.endsOn,
    workType: e.work_type,
    status: st.status === "published" ? "published" : "draft",
    pending: st.draftAction,
    published: publishedSlot(st),
    allowSplit: e.allow_split,
    overrideRules: e.override_rules,
    conflicts,
    blocked: isBlocked(conflicts),
    priorityReschedule: job?.isPriorityReschedule ?? false,
  };
}

export async function loadBoard(
  db: { supabase: Db; service: Db },
  input: { orgId: string; view: CalendarView; anchor: IsoDate; now?: Date },
): Promise<BoardData> {
  const now = input.now ?? new Date();
  const { supabase, service } = db;
  const days = calendarWindow(input.view, input.anchor);
  const from = days[0] as IsoDate;
  const to = days[days.length - 1] as IsoDate;
  const config = await loadSchedulingConfig(service, input.orgId, now);
  // A wider window for conflict checks (bars that touch the visible days' neighbours).
  const all = await loadEntries(service, {
    orgId: input.orgId,
    from: addDays(from, -60),
    to: addDays(to, 120),
  });
  const crews = await loadCrews(service, {
    includeInactive: true,
    orgId: input.orgId,
    from: config.context.today,
  });
  const crewById = new Map(crews.map((c) => [c.id, c]));

  const { data: trayJobs } = await service
    .from("jobs")
    .select("id")
    .eq("org_id", input.orgId)
    .is("deleted_at", null)
    .or(
      "stage.eq.ready_to_schedule,and(is_priority_reschedule.eq.true,stage.in.(scheduled,in_progress))",
    )
    .limit(300);
  const trayIds = (trayJobs ?? []).map((j) => j.id);
  const facts = await loadJobFacts(service, [
    ...new Set([...all.map((e) => e.job_id), ...trayIds]),
  ]);
  const visible = await visibleJobIds(supabase, [...facts.keys()]);
  const bars = toBars(all, facts);

  const boardBars: BoardBar[] = [];
  for (const e of all) {
    const st = toEntryState(e);
    const slot = effectiveSlot(st);
    let conflicts: Conflict[] = [];
    if (slot && st.draftAction) {
      const job = facts.get(e.job_id);
      if (job) {
        const keepPast =
          e.starts_on && slot.startsOn === e.starts_on && e.starts_on < config.context.today;
        conflicts = checkPlacement(
          {
            entryId: e.id,
            jobId: e.job_id,
            crewId: slot.crewId,
            workType: e.work_type,
            startsOn: slot.startsOn,
            endsOn: slot.endsOn,
            allowSplit: e.allow_split,
            overrideRules: e.override_rules,
          },
          job,
          crewById.get(slot.crewId) ?? null,
          bars.filter((b) => b.id !== e.id),
          keepPast ? { ...config.context, today: e.starts_on as string } : config.context,
        );
      }
    }
    const bar = toBar(e, facts, visible, conflicts);
    if (bar && bar.startsOn <= to && bar.endsOn >= from) boardBars.push(bar);
    else if (
      bar &&
      bar.pending &&
      bar.published &&
      bar.published.startsOn <= to &&
      bar.published.endsOn >= from
    ) {
      boardBars.push(bar);
    }
  }

  // The tray: Ready to Schedule jobs with nothing on the schedule, and rain reschedules.
  const live = new Set(all.filter((e) => effectiveSlot(toEntryState(e))).map((e) => e.job_id));
  const tray: TrayCard[] = [];
  const activeCrews = crews.filter((c) => c.active);
  for (const jobId of trayIds) {
    const job = facts.get(jobId);
    if (!job || !visible.has(jobId)) continue;
    const isRain = job.isPriorityReschedule;
    if (!isRain && live.has(jobId)) continue;
    const workingDays = jobWorkingDays(job, config.settings.crewDayHours);
    const workType = defaultEntryWorkType(job.workTypes);
    const start = nextProductionDay(
      job.promisedStartDate && job.promisedStartDate > config.context.today
        ? job.promisedStartDate
        : config.context.today,
      config.context.productionDays,
    );
    const end = endAfterWorkingDays(start, workingDays, config.context.productionDays);
    const others = bars.filter((b) => b.jobId !== jobId);
    const ranking = rankCrews(
      { job, workType, startsOn: start, endsOn: end },
      activeCrews,
      others,
      config.context,
    );
    let recommended: TrayCard["recommended"] = null;
    let conflicts: Conflict[] = ranking[0]?.conflicts ?? [];
    for (const r of ranking) {
      const crew = crewById.get(r.crewId);
      if (!crew || r.reasons[0]?.points === 0) continue;
      const open = firstOpenStart(
        job,
        crew,
        workType,
        workingDays,
        others,
        config.context,
        start,
        60,
      );
      if (!open) continue;
      recommended = { crewId: r.crewId, crewName: r.crewName, score: r.score, ...open };
      conflicts = checkPlacement(
        {
          entryId: null,
          jobId,
          crewId: r.crewId,
          workType,
          startsOn: open.startsOn,
          endsOn: open.endsOn,
          allowSplit: false,
          overrideRules: [],
        },
        job,
        crew,
        others,
        config.context,
      );
      break;
    }
    tray.push({
      jobId,
      label: job.label,
      city: job.city,
      stage: job.stage,
      workTypes: job.workTypes,
      workType,
      priorityReschedule: isRain,
      plannedStart: job.promisedStartDate,
      workingDays,
      crewId: job.crewId,
      materials: materialsStatus(job.paintOrderStatuses),
      hoaPending: job.hoaApprovalPending,
      leadSafe: job.leadSafe,
      blockingHolds: job.blockingHolds.map((h) => h.label),
      recommended,
      ranking,
      conflicts,
    });
  }
  tray.sort(
    (a, b) =>
      Number(b.priorityReschedule) - Number(a.priorityReschedule) ||
      (a.plannedStart ?? "9999").localeCompare(b.plannedStart ?? "9999") ||
      a.label.localeCompare(b.label),
  );

  const pending = all.filter((e) => e.draft_action !== null);
  return {
    view: input.view,
    anchor: input.anchor,
    days,
    today: config.context.today,
    config,
    crews,
    bars: boardBars,
    tray,
    weatherConnected: config.context.weather.connected,
    stats: {
      bars: boardBars.length,
      drafts: pending.length,
      conflicts: boardBars.filter((b) => b.conflicts.length > 0).length,
      blocked: boardBars.filter((b) => b.blocked).length,
      crews: crews.filter((c) => c.active).length,
      tray: tray.length,
    },
  };
}

/** Conflicts for one proposed placement (the draft action's answer). */
export async function conflictsFor(
  service: Db,
  input: {
    orgId: string;
    entryId: string | null;
    jobId: string;
    crewId: string;
    workType: string;
    startsOn: IsoDate;
    endsOn: IsoDate;
    allowSplit: boolean;
    overrideRules: string[];
    publishedStart?: IsoDate | null;
    now?: Date;
  },
): Promise<Conflict[]> {
  const config = await loadSchedulingConfig(service, input.orgId, input.now);
  const all = await loadEntries(service, {
    orgId: input.orgId,
    from: addDays(input.startsOn, -30),
    to: addDays(input.endsOn, 30),
  });
  const crews = await loadCrews(service, {
    includeInactive: true,
    orgId: input.orgId,
    from: config.context.today,
  });
  const facts = await loadJobFacts(service, [
    ...new Set([...all.map((e) => e.job_id), input.jobId]),
  ]);
  const job = facts.get(input.jobId);
  if (!job) return [];
  const keepPast =
    input.publishedStart &&
    input.startsOn === input.publishedStart &&
    input.publishedStart < config.context.today;
  return checkPlacement(
    {
      entryId: input.entryId,
      jobId: input.jobId,
      crewId: input.crewId,
      workType: input.workType,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      allowSplit: input.allowSplit,
      overrideRules: input.overrideRules,
    },
    job,
    crews.find((c) => c.id === input.crewId) ?? null,
    toBars(all, facts).filter((b) => b.id !== input.entryId),
    keepPast ? { ...config.context, today: input.publishedStart as string } : config.context,
  );
}
