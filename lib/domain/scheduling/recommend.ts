import {
  addDays,
  endAfterWorkingDays,
  isoDow,
  nextProductionDay,
  overlapDays,
  type IsoDate,
} from "./dates";
import {
  checkPlacement,
  isBlocked,
  type Conflict,
  type ConflictContext,
  type CrewFacts,
  type JobFacts,
  type ScheduledBar,
} from "./conflicts";
import { missingSkills, requiredSkills } from "./skills";

/**
 * Crew recommendations (SPEC §8.5 #3 "Recommended crews ranked by workload,
 * availability, skills, drive distance", §8.6 Recommendations). Rule-based and
 * explainable: every score is the sum of the points listed in its reasons.
 * Until maps are connected, "drive distance" is a territory/city match.
 */

export type RankedCrew = {
  crewId: string;
  crewName: string;
  score: number;
  /** No blocking conflict on these dates. */
  eligible: boolean;
  reasons: { label: string; points: number; max: number }[];
  conflicts: Conflict[];
};

export type CrewForRanking = CrewFacts & {
  homeTerritoryId: string | null;
};

export type RankInput = {
  job: JobFacts & { territoryId: string | null; city: string | null };
  workType: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
};

const POINTS = { skills: 35, availability: 30, workload: 20, territory: 15 } as const;
/** Production days ahead used to judge workload. */
const WORKLOAD_WINDOW = 10;

function bookedDays(
  crewId: string,
  others: readonly ScheduledBar[],
  from: IsoDate,
  workdays: readonly number[],
  excludeJob: string,
): number {
  const to = endAfterWorkingDays(from, WORKLOAD_WINDOW, workdays);
  const days = new Set<IsoDate>();
  for (const o of others) {
    if (o.crewId !== crewId || o.jobId === excludeJob) continue;
    for (const d of overlapDays(from, to, o.startsOn, o.endsOn)) {
      if (workdays.includes(isoDow(d))) days.add(d);
    }
  }
  return days.size;
}

export function rankCrews(
  input: RankInput,
  crews: readonly CrewForRanking[],
  others: readonly ScheduledBar[],
  ctx: ConflictContext,
  /** Cities of the jobs each crew already works in this window (clustering). */
  crewCities: Readonly<Record<string, readonly string[]>> = {},
): RankedCrew[] {
  const needs = requiredSkills(
    {
      workTypes: input.job.workTypes,
      stories: input.job.stories,
      leadSafe: input.job.leadSafe,
      entryWorkTypes: [input.workType],
      workOrderPhases: input.job.workOrderPhases,
    },
    ctx.rules,
    ctx.workTypeSkills,
  );
  const out: RankedCrew[] = [];
  for (const crew of crews) {
    if (!crew.active) continue;
    const conflicts = checkPlacement(
      {
        entryId: null,
        jobId: input.job.id,
        crewId: crew.id,
        workType: input.workType,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        allowSplit: false,
        overrideRules: [],
      },
      input.job,
      crew,
      others,
      ctx,
    );
    const reasons: RankedCrew["reasons"] = [];
    const missing = missingSkills(needs, crew.skills, input.endsOn);
    reasons.push({
      label: missing.length
        ? `Missing ${missing.map((m) => ctx.skillLabels[m.need.skill] ?? m.need.skill).join(", ")}`
        : needs.length
          ? "Has every skill the job needs"
          : "No special skills needed",
      points: missing.length ? 0 : POINTS.skills,
      max: POINTS.skills,
    });
    const busy = conflicts.some(
      (c) =>
        (c.code === "max_jobs_per_crew_day" ||
          c.code === "crew_time_off" ||
          c.code === "sub_compliance") &&
        c.severity === "block",
    );
    reasons.push({
      label: busy ? "Not free on these dates" : "Free on these dates",
      points: busy ? 0 : POINTS.availability,
      max: POINTS.availability,
    });
    const booked = bookedDays(crew.id, others, input.startsOn, ctx.productionDays, input.job.id);
    const load = Math.min(1, booked / WORKLOAD_WINDOW);
    reasons.push({
      label: `${booked} of the next ${WORKLOAD_WINDOW} production days booked`,
      points: Math.round(POINTS.workload * (1 - load)),
      max: POINTS.workload,
    });
    const territory =
      input.job.territoryId && crew.homeTerritoryId === input.job.territoryId
        ? { label: "Home territory matches", points: POINTS.territory }
        : input.job.city && (crewCities[crew.id] ?? []).includes(input.job.city)
          ? { label: `Already working in ${input.job.city}`, points: 10 }
          : crew.homeTerritoryId === null
            ? { label: "No home territory set", points: 5 }
            : { label: "Different territory", points: 0 };
    reasons.push({ ...territory, max: POINTS.territory });
    const score = reasons.reduce((s, r) => s + r.points, 0);
    out.push({
      crewId: crew.id,
      crewName: crew.name,
      score,
      eligible: !isBlocked(conflicts),
      reasons,
      conflicts,
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.score - a.score ||
      a.crewName.localeCompare(b.crewName),
  );
}

/**
 * The first start date (from `from`, within `searchDays` calendar days) where
 * the crew can take `workingDays` production days without a blocking conflict.
 */
export function firstOpenStart(
  job: JobFacts,
  crew: CrewFacts,
  workType: string,
  workingDays: number,
  others: readonly ScheduledBar[],
  ctx: ConflictContext,
  from: IsoDate,
  searchDays = 90,
): { startsOn: IsoDate; endsOn: IsoDate } | null {
  let start = nextProductionDay(from < ctx.today ? ctx.today : from, ctx.productionDays);
  const limit = addDays(from, searchDays);
  while (start <= limit) {
    const end = endAfterWorkingDays(start, workingDays, ctx.productionDays);
    const conflicts = checkPlacement(
      {
        entryId: null,
        jobId: job.id,
        crewId: crew.id,
        workType,
        startsOn: start,
        endsOn: end,
        allowSplit: false,
        overrideRules: [],
      },
      job,
      crew,
      others,
      ctx,
    );
    // Only date-dependent blocks are worth moving past; a skill gap won't change.
    const dated = conflicts.filter(
      (c) =>
        c.severity === "block" &&
        !c.overridden &&
        (c.code === "max_jobs_per_crew_day" ||
          c.code === "crew_time_off" ||
          c.code === "exterior_in_season" ||
          c.code === "weather_forecast"),
    );
    if (!dated.length) return { startsOn: start, endsOn: end };
    start = nextProductionDay(addDays(start, 1), ctx.productionDays);
  }
  return null;
}
