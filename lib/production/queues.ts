import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { checkPlacement, type Conflict } from "@/lib/domain/scheduling/conflicts";
import {
  addDays,
  daysBetween,
  endAfterWorkingDays,
  nextProductionDay,
  type IsoDate,
} from "@/lib/domain/scheduling/dates";
import { effectiveSlot, publishedSlot } from "@/lib/domain/scheduling/publish";
import { dispatchReadiness, type ReadinessCheck } from "@/lib/domain/scheduling/readiness";
import { rankCrews, type RankedCrew } from "@/lib/domain/scheduling/recommend";
import { missingSkills, requiredSkills } from "@/lib/domain/scheduling/skills";
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
  type SchedulingConfig,
} from "./context";

type Db = SupabaseClient<Database>;

/**
 * Production queues (SPEC §8.6 Readiness Queue, Crew Queue, Field Dispatch,
 * §8.5 #3 dispatch readiness): the jobs the person can open (their own
 * client), with their planned dates, crew, dispatch readiness and blocks,
 * computed with the scheduling domain over the whole schedule (service).
 */

const SEASONAL = new Set(["exterior", "deck_fence"]);
const AVAILABILITY = new Set([
  "max_jobs_per_crew_day",
  "crew_time_off",
  "sub_compliance",
  "inactive_crew",
]);

export type ProductionJobRow = {
  id: string;
  label: string;
  name: string;
  jobNumber: string;
  stage: string;
  workTypes: readonly string[];
  city: string | null;
  territoryId: string | null;
  projectManagerId: string | null;
  crewId: string | null;
  crewName: string | null;
  planned: { startsOn: IsoDate; endsOn: IsoDate } | null;
  published: { startsOn: IsoDate; endsOn: IsoDate } | null;
  draftPending: boolean;
  workingDays: number;
  readiness: { percent: number | null; checks: ReadinessCheck[] };
  blocks: Conflict[];
  blockingHolds: string[];
  onboardingOpen: string[];
  paintStatuses: string[];
  priorityReschedule: boolean;
  daysToStart: number | null;
  /** Ranked crews for the planned (or next open) dates; only with `rank`. */
  ranking: RankedCrew[];
  /** Live entries (published or draft) for the job's Schedule section. */
  entries: {
    id: string;
    status: string;
    crewId: string | null;
    startsOn: IsoDate | null;
    endsOn: IsoDate | null;
    draftAction: string | null;
    draftCrewId: string | null;
    draftStartsOn: IsoDate | null;
    draftEndsOn: IsoDate | null;
    workType: string;
    publishedAt: string | null;
  }[];
};

export async function loadProductionJobs(
  db: { supabase: Db; service: Db },
  input: {
    orgId: string;
    stages: readonly string[];
    jobIds?: readonly string[];
    rank?: boolean;
    now?: Date;
  },
): Promise<{ jobs: ProductionJobRow[]; crews: CrewRecord[]; config: SchedulingConfig }> {
  const now = input.now ?? new Date();
  const { supabase, service } = db;
  let vq = supabase
    .from("jobs")
    .select("id")
    .in("stage", [...input.stages])
    .is("deleted_at", null)
    .limit(1000);
  if (input.jobIds) vq = vq.in("id", [...input.jobIds]);
  const { data: visible } = await vq;
  const ids = (visible ?? []).map((j) => j.id);
  const config = await loadSchedulingConfig(service, input.orgId, now);
  const crews = await loadCrews(service, {
    includeInactive: true,
    orgId: input.orgId,
    from: config.context.today,
  });
  if (!ids.length) return { jobs: [], crews, config };
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const all = await loadEntries(service, {
    orgId: input.orgId,
    from: addDays(config.context.today, -60),
  });
  const facts = await loadJobFacts(service, [...new Set([...ids, ...all.map((e) => e.job_id)])]);
  const bars = toBars(all, facts);
  const { data: onboarding } = await service
    .from("onboarding_requirements")
    .select("job_id, key, label, required, status")
    .in("job_id", ids)
    .in("key", ["hoa_approval", "lead_safe_plan"]);
  const out: ProductionJobRow[] = [];
  for (const id of ids) {
    const job = facts.get(id);
    if (!job) continue;
    const entries = all.filter((e) => e.job_id === id);
    const slots = entries.map((e) => effectiveSlot(toEntryState(e))).filter((s) => s !== null);
    const pubs = entries.map((e) => publishedSlot(toEntryState(e))).filter((s) => s !== null);
    const span = (list: { startsOn: IsoDate; endsOn: IsoDate }[]) =>
      list.length
        ? {
            startsOn: list.map((s) => s.startsOn).sort()[0] as IsoDate,
            endsOn: list
              .map((s) => s.endsOn)
              .sort()
              .pop() as IsoDate,
          }
        : null;
    const workingDays = jobWorkingDays(job, config.settings.crewDayHours);
    const planned =
      span(slots) ??
      (job.promisedStartDate
        ? {
            startsOn: nextProductionDay(job.promisedStartDate, config.context.productionDays),
            endsOn: endAfterWorkingDays(
              job.promisedStartDate,
              workingDays,
              config.context.productionDays,
            ),
          }
        : null);
    const crewId = job.crewId ?? slots[0]?.crewId ?? null;
    const crew = crewId ? (crewById.get(crewId) ?? null) : null;
    const workType = entries[0]?.work_type ?? defaultEntryWorkType(job.workTypes);
    const conflicts =
      crew && planned
        ? checkPlacement(
            {
              entryId: entries[0]?.id ?? null,
              jobId: id,
              crewId: crew.id,
              workType,
              startsOn:
                planned.startsOn < config.context.today ? config.context.today : planned.startsOn,
              endsOn: planned.endsOn < config.context.today ? config.context.today : planned.endsOn,
              allowSplit: entries[0]?.allow_split ?? false,
              overrideRules: entries[0]?.override_rules ?? [],
            },
            job,
            crew,
            bars.filter((b) => b.jobId !== id),
            config.context,
          )
        : [];
    const needs = requiredSkills(
      {
        workTypes: job.workTypes,
        stories: job.stories,
        leadSafe: job.leadSafe,
        entryWorkTypes: [workType],
        workOrderPhases: job.workOrderPhases,
      },
      config.rules,
      config.context.workTypeSkills,
    );
    const missing = crew
      ? missingSkills(needs, crew.skills, planned?.endsOn ?? config.context.today)
      : [];
    const openItems = (onboarding ?? [])
      .filter((r) => r.job_id === id && r.required && r.status !== "verified")
      .map((r) => (r.key === "hoa_approval" ? "HOA approval" : "Lead-safe plan"));
    const holds = job.blockingHolds.map((h) => h.label);
    const readiness = dispatchReadiness({
      crewName: crew?.name ?? null,
      territoryMatch:
        crew && job.territoryId && crew.homeTerritoryId
          ? crew.homeTerritoryId === job.territoryId
          : null,
      missingSkillLabels: missing.map(
        (m) => config.context.skillLabels[m.need.skill] ?? m.need.skill,
      ),
      availabilityProblems: conflicts
        .filter((c) => AVAILABILITY.has(c.code) && c.severity === "block")
        .map((c) => c.message),
      paintOrderStatuses: job.paintOrderStatuses,
      complianceOpen: [...openItems, ...holds.map((h) => `${h} hold`)],
      seasonal: job.workTypes.some((w) => SEASONAL.has(w)),
      weather: {
        connected: config.context.weather.connected,
        problems: conflicts.filter((c) => c.code === "weather_forecast").map((c) => c.message),
      },
    });
    out.push({
      id,
      label: job.label,
      name: job.name,
      jobNumber: job.jobNumber,
      stage: job.stage,
      workTypes: job.workTypes,
      city: job.city,
      territoryId: job.territoryId,
      projectManagerId: job.projectManagerId,
      crewId,
      crewName: crew?.name ?? null,
      planned,
      published: span(pubs),
      draftPending: entries.some((e) => e.draft_action !== null),
      workingDays,
      readiness,
      blocks: conflicts.filter((c) => c.severity === "block" && !c.overridden),
      blockingHolds: holds,
      onboardingOpen: openItems,
      paintStatuses: job.paintOrderStatuses,
      priorityReschedule: job.isPriorityReschedule,
      daysToStart: planned ? daysBetween(config.context.today, planned.startsOn) : null,
      ranking: input.rank
        ? rankCrews(
            {
              job,
              workType,
              startsOn:
                planned && planned.startsOn >= config.context.today
                  ? planned.startsOn
                  : nextProductionDay(config.context.today, config.context.productionDays),
              endsOn:
                planned && planned.startsOn >= config.context.today
                  ? planned.endsOn
                  : endAfterWorkingDays(
                      nextProductionDay(config.context.today, config.context.productionDays),
                      workingDays,
                      config.context.productionDays,
                    ),
            },
            crews.filter((c) => c.active),
            bars.filter((b) => b.jobId !== id),
            config.context,
          ).slice(0, 3)
        : [],
      entries: entries
        .filter((e) => e.status !== "canceled")
        .map((e) => ({
          id: e.id,
          status: e.status,
          crewId: e.crew_id,
          startsOn: e.starts_on,
          endsOn: e.ends_on,
          draftAction: e.draft_action,
          draftCrewId: e.draft_crew_id,
          draftStartsOn: e.draft_starts_on,
          draftEndsOn: e.draft_ends_on,
          workType: e.work_type,
          publishedAt: e.published_at,
        })),
    });
  }
  out.sort(
    (a, b) =>
      (a.planned?.startsOn ?? "9999").localeCompare(b.planned?.startsOn ?? "9999") ||
      a.label.localeCompare(b.label),
  );
  return { jobs: out, crews, config };
}
