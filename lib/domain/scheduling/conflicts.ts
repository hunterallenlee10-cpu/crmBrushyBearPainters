import { isInSeason } from "@/lib/domain/company-settings";
import {
  daysBetween,
  formatDay,
  formatRange,
  isoDow,
  overlapDays,
  productionDays,
  type IsoDate,
} from "./dates";
import { missingSkills, requiredSkills, type CrewSkill } from "./skills";
import { numParam, type WorkRule, type WorkRuleKey } from "./rules";

/**
 * Scheduling conflict detection (SPEC §8.6 Master Schedule, §15.1 work
 * rules). Pure: a proposed bar (job, crew, dates) plus everything else on the
 * schedule goes in; every conflict comes out with a plain-English reason.
 * "block" conflicts stop Publish (unless an owner overrides a rule that allows
 * it, with a reason); "warn" conflicts are shown but don't stop anything.
 */

export type ConflictCode =
  | WorkRuleKey
  | "past_date"
  | "inactive_crew"
  | "non_production_day"
  | "blocking_hold"
  | "work_type_skill"
  | "job_closed";

export type Conflict = {
  code: ConflictCode;
  severity: "block" | "warn";
  message: string;
  /** An owner may schedule past it with a reason. */
  overridable: boolean;
  /** The entry carries an owner override for this rule. */
  overridden: boolean;
};

export type CrewFacts = {
  id: string;
  name: string;
  active: boolean;
  crewType: "employee" | "subcontractor";
  maxJobsPerDay: number;
  skills: readonly CrewSkill[];
  /** Whole-crew time off, and members' time off (memberName set). */
  timeOff: readonly {
    startsOn: IsoDate;
    endsOn: IsoDate;
    reason: string | null;
    memberName: string | null;
  }[];
  subcontractor: {
    name: string;
    status: "active" | "expiring" | "suspended";
    lniExpiresOn: IsoDate | null;
    coiExpiresOn: IsoDate | null;
    suspendedReason: string | null;
  } | null;
};

export type JobFacts = {
  id: string;
  label: string;
  stage: string;
  workTypes: readonly string[];
  stories: number | null;
  leadSafe: boolean;
  walkthroughDone: boolean;
  /** Active holds that block scheduling. */
  blockingHolds: readonly { type: string; label: string }[];
  /** Exterior on an HOA home whose HOA approval isn't cleared on the checklist. */
  hoaApprovalPending: boolean;
  workOrderPhases?: readonly string[];
};

export type Placement = {
  /** The entry being placed (left out of the double-booking check). */
  entryId: string | null;
  jobId: string;
  crewId: string;
  workType: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  allowSplit: boolean;
  /** Rules an owner overrode for this entry. */
  overrideRules: readonly string[];
};

/** Another bar on the schedule (its effective dates: the draft if there is one). */
export type ScheduledBar = {
  id: string;
  jobId: string;
  jobLabel: string;
  crewId: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  allowSplit: boolean;
};

export type ConflictContext = {
  today: IsoDate;
  productionDays: readonly number[];
  season: { start: string; end: string };
  blackouts: readonly { startsOn: IsoDate; endsOn: IsoDate; reason: string | null }[];
  rules: Record<WorkRuleKey, WorkRule>;
  skillLabels: Readonly<Record<string, string>>;
  workTypeSkills: Readonly<Record<string, string | null>>;
  workTypeLabels?: Readonly<Record<string, string>>;
  /** Weather: dormant until connected (SPEC §2.1). */
  weather: {
    connected: boolean;
    days?: readonly { date: IsoDate; precipProbability: number; minTempF: number | null }[];
    /** Lowest product application temperature on the job (°F), if known. */
    minApplicationTempF?: number | null;
  };
};

const SEASONAL = new Set(["exterior", "deck_fence"]);
const CLOSED = new Set(["closed_won", "closed_lost"]);

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function checkPlacement(
  p: Placement,
  job: JobFacts,
  crew: CrewFacts | null,
  others: readonly ScheduledBar[],
  ctx: ConflictContext,
): Conflict[] {
  const out: Conflict[] = [];
  const range = formatRange(p.startsOn, p.endsOn);
  const push = (
    code: ConflictCode,
    message: string,
    opts: { severity?: "block" | "warn"; overridable?: boolean } = {},
  ) => {
    const ruleDef = (ctx.rules as Partial<Record<string, WorkRule>>)[code];
    const severity = opts.severity ?? ruleDef?.severity ?? "block";
    const overridable = opts.overridable ?? ruleDef?.ownerOverride ?? false;
    out.push({
      code,
      severity,
      message,
      overridable,
      overridden: overridable && p.overrideRules.includes(code),
    });
  };
  const on = (key: WorkRuleKey) => {
    const r = ctx.rules[key];
    return r.enabled && (!r.requiresWeather || ctx.weather.connected);
  };

  if (p.endsOn < p.startsOn) {
    push("past_date", "The end date is before the start date.", { severity: "block" });
    return out;
  }
  if (CLOSED.has(job.stage)) {
    push("job_closed", `${job.label} is closed.`, { severity: "block" });
  }
  if (p.startsOn < ctx.today) {
    push("past_date", `${formatDay(p.startsOn)} is in the past. Pick today or a later day.`, {
      severity: "block",
    });
  }
  if (!crew) {
    push("inactive_crew", "Pick a crew.", { severity: "block" });
    return out;
  }
  if (!crew.active) {
    push("inactive_crew", `${crew.name} is inactive. Turn it back on in Resources first.`, {
      severity: "block",
    });
  }

  // Production days.
  const workdays = productionDays(p.startsOn, p.endsOn, ctx.productionDays);
  if (workdays.length === 0) {
    push(
      "non_production_day",
      `${range} has no production days (crews work ${ctx.productionDays.length === 5 && !ctx.productionDays.includes(6) ? "Monday to Friday" : "the days set in Schedule Admin"}).`,
      { severity: "block" },
    );
  } else if (!ctx.productionDays.includes(isoDow(p.startsOn))) {
    push(
      "non_production_day",
      `${formatDay(p.startsOn)} isn't a production day. Work starts on the next one.`,
      { severity: "warn" },
    );
  }

  // Walkthrough before production.
  if (on("walkthrough_before_production") && !job.walkthroughDone) {
    push(
      "walkthrough_before_production",
      `${job.label} has no completed walkthrough yet. Finish the walkthrough before scheduling production.`,
    );
  }

  // Holds: always enforced (the stage engine refuses scheduling while one is active).
  for (const h of job.blockingHolds) {
    if (h.type === "deposit") {
      push(
        "deposit_before_scheduling",
        `${job.label} is on Deposit Hold. Collect the deposit and clear it on the onboarding checklist first.`,
        { severity: "block", overridable: false },
      );
    } else {
      push(
        "blocking_hold",
        `${job.label} has a ${/hold$/i.test(h.label) ? h.label : `${h.label} hold`} that blocks scheduling. Release it first.`,
        { severity: "block", overridable: false },
      );
    }
  }

  // HOA approval before exterior color change.
  if (on("hoa_before_exterior") && job.hoaApprovalPending && job.workTypes.includes("exterior")) {
    push(
      "hoa_before_exterior",
      `${job.label} is waiting for the HOA's approval. Upload it to Documents before scheduling exterior work.`,
    );
  }

  // Exterior / deck in season.
  if (on("exterior_in_season") && job.workTypes.some((w) => SEASONAL.has(w))) {
    const out_ = workdays.filter((d) => !isInSeason(d, ctx.season.start, ctx.season.end));
    if (out_.length) {
      push(
        "exterior_in_season",
        `${out_.length === workdays.length ? range : list(out_.slice(0, 3).map(formatDay))} ${out_.length === 1 ? "is" : "are"} outside the exterior season (${seasonLabel(ctx.season)}). An owner can override with a reason.`,
      );
    }
  }

  // Skills: spray for cabinets, high access for 2-story exterior, certified
  // renovator for lead-safe homes, and the work type's own skill.
  const needs = requiredSkills(
    {
      workTypes: job.workTypes,
      stories: job.stories,
      leadSafe: job.leadSafe,
      entryWorkTypes: [p.workType],
      workOrderPhases: job.workOrderPhases,
    },
    ctx.rules,
    ctx.workTypeSkills,
    ctx.workTypeLabels,
  );
  for (const m of missingSkills(needs, crew.skills, p.endsOn)) {
    const label = ctx.skillLabels[m.need.skill] ?? m.need.skill;
    const msg = m.expired
      ? `${crew.name}'s ${label} certification expires before ${formatDay(p.endsOn)}. ${m.need.reason} needs it.`
      : `${crew.name} doesn't have the ${label} skill. ${m.need.reason} needs it.`;
    push(m.need.rule ?? "work_type_skill", msg, m.need.rule ? {} : { severity: "block" });
  }

  // Crew time off and company blackout dates.
  if (on("crew_time_off")) {
    for (const t of crew.timeOff) {
      const days = overlapDays(p.startsOn, p.endsOn, t.startsOn, t.endsOn);
      if (!days.length) continue;
      const when = formatRange(days[0] as IsoDate, days[days.length - 1] as IsoDate);
      if (t.memberName) {
        push(
          "crew_time_off",
          `${t.memberName} (${crew.name}) is off ${when}${t.reason ? ` (${t.reason})` : ""}.`,
          { severity: "warn" },
        );
      } else {
        push("crew_time_off", `${crew.name} is off ${when}${t.reason ? ` (${t.reason})` : ""}.`);
      }
    }
    for (const b of ctx.blackouts) {
      const days = overlapDays(p.startsOn, p.endsOn, b.startsOn, b.endsOn);
      if (!days.length) continue;
      push(
        "crew_time_off",
        `${formatRange(days[0] as IsoDate, days[days.length - 1] as IsoDate)} is a company blackout${b.reason ? ` (${b.reason})` : ""}.`,
      );
    }
  }

  // Subcontractor paperwork.
  if (on("sub_compliance") && crew.crewType === "subcontractor" && crew.subcontractor) {
    const s = crew.subcontractor;
    if (s.status === "suspended") {
      push(
        "sub_compliance",
        `${s.name} is suspended${s.suspendedReason ? ` (${s.suspendedReason})` : ""}.`,
      );
    }
    for (const [what, exp] of [
      ["L&I registration", s.lniExpiresOn],
      ["insurance (COI)", s.coiExpiresOn],
    ] as const) {
      if (!exp) push("sub_compliance", `${s.name} has no ${what} on file.`);
      else if (exp < p.endsOn)
        push(
          "sub_compliance",
          `${s.name}'s ${what} expires ${formatDay(exp)}, before the job ends.`,
        );
    }
  }

  // Max active jobs per crew per day unless split.
  if (on("max_jobs_per_crew_day")) {
    const max = Math.max(1, crew.maxJobsPerDay);
    const mine = others.filter(
      (o) => o.crewId === crew.id && o.id !== p.entryId && o.jobId !== p.jobId,
    );
    const busy = new Map<IsoDate, ScheduledBar[]>();
    for (const o of mine) {
      for (const d of overlapDays(p.startsOn, p.endsOn, o.startsOn, o.endsOn)) {
        if (!ctx.productionDays.includes(isoDow(d))) continue;
        busy.set(d, [...(busy.get(d) ?? []), o]);
      }
    }
    const clashes = [...busy.entries()].filter(
      ([, bars]) => bars.length >= max && !(p.allowSplit && bars.every((b) => b.allowSplit)),
    );
    if (clashes.length) {
      const jobs = [...new Set(clashes.flatMap(([, bars]) => bars.map((b) => b.jobLabel)))];
      const first = clashes[0]?.[0] as IsoDate;
      const last = clashes[clashes.length - 1]?.[0] as IsoDate;
      push(
        "max_jobs_per_crew_day",
        `${crew.name} is already booked on ${list(jobs)} ${clashes.length === 1 ? `on ${formatDay(first)}` : `${formatRange(first, last)} (${clashes.length} days)`}. Pick another crew or day, or mark both entries "split".`,
      );
    }
  }

  // Weather (only when connected).
  if (on("weather_forecast") && job.workTypes.some((w) => SEASONAL.has(w))) {
    const r = ctx.rules.weather_forecast;
    const threshold = numParam(r, "rain_percent", 60);
    const wet = (ctx.weather.days ?? []).filter(
      (d) => workdays.includes(d.date) && d.precipProbability >= threshold,
    );
    if (wet.length) {
      push(
        "weather_forecast",
        `Rain ${Math.max(...wet.map((w) => w.precipProbability))}%+ is forecast on ${list(wet.map((w) => formatDay(w.date)))}.`,
      );
    }
    const minTemp = ctx.weather.minApplicationTempF;
    if (minTemp != null) {
      const cold = (ctx.weather.days ?? []).filter(
        (d) => workdays.includes(d.date) && d.minTempF !== null && d.minTempF < minTemp,
      );
      if (cold.length) {
        push(
          "weather_forecast",
          `It's forecast below the paint's ${minTemp}°F minimum on ${list(cold.map((w) => formatDay(w.date)))}.`,
        );
      }
    }
  }

  return out;
}

function seasonLabel(season: { start: string; end: string }): string {
  const md = (v: string) => {
    const [m, d] = v.split("-").map(Number);
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${months[(m ?? 1) - 1]} ${d}`;
  };
  return `${md(season.start)}–${md(season.end)}`;
}

/** Conflicts that stop Publish (blocking and not overridden by an owner). */
export function blockingConflicts(conflicts: readonly Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.severity === "block" && !c.overridden);
}

export function isBlocked(conflicts: readonly Conflict[]): boolean {
  return blockingConflicts(conflicts).length > 0;
}

/** Number of production days in a bar. */
export function barWorkingDays(
  startsOn: IsoDate,
  endsOn: IsoDate,
  workdays: readonly number[],
): number {
  return productionDays(startsOn, endsOn, workdays).length;
}

/** Duration in calendar days (inclusive). */
export function barLength(startsOn: IsoDate, endsOn: IsoDate): number {
  return daysBetween(startsOn, endsOn) + 1;
}
