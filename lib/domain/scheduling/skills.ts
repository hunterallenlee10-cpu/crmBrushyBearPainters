import type { IsoDate } from "./dates";
import { numParam, strParam, type WorkRule, type WorkRuleKey } from "./rules";

/**
 * Which skills a job needs and whether a crew has them (SPEC §5.4, §6.4
 * "crew skills ⊇ job required skills", §13.3 certified renovator). Pure.
 */

export type SkillNeed = {
  skill: string;
  /** Why the job needs it, in plain words. */
  reason: string;
  /** The work rule behind it (null: the work type's own skill). */
  rule: WorkRuleKey | null;
};

export type JobSkillFacts = {
  workTypes: readonly string[];
  stories: number | null;
  /** Pre-1978 or "not sure" with paint disturbed (lead-safe work). */
  leadSafe: boolean;
  /** Scheduling work types this job's entries use (each may need a skill). */
  entryWorkTypes?: readonly string[];
  /** Work-order phases (a repair phase means rot repair). */
  workOrderPhases?: readonly string[];
};

/** Scheduling work type for a job's production days, from its work types. */
export function productionWorkType(workTypes: readonly string[]): string {
  if (workTypes.includes("exterior")) return "exterior_production";
  if (workTypes.includes("cabinets") && !workTypes.includes("interior")) return "cabinet_shop";
  if (workTypes.includes("deck_fence") && !workTypes.includes("interior")) return "deck_fence";
  return "interior_production";
}

export const PRODUCTION_WORK_TYPES = [
  "interior_production",
  "exterior_production",
  "cabinet_shop",
  "deck_fence",
  "pressure_washing",
  "rot_repair",
  "touch_up",
] as const;
export type ProductionWorkType = (typeof PRODUCTION_WORK_TYPES)[number];

export function isProductionWorkType(v: string): v is ProductionWorkType {
  return (PRODUCTION_WORK_TYPES as readonly string[]).includes(v);
}

export function requiredSkills(
  job: JobSkillFacts,
  rules: Record<WorkRuleKey, WorkRule>,
  /** work type key → required skill key (Admin → Schedule Admin). */
  workTypeSkills: Readonly<Record<string, string | null>>,
  workTypeLabels: Readonly<Record<string, string>> = {},
): SkillNeed[] {
  const needs: SkillNeed[] = [];
  const add = (n: SkillNeed) => {
    if (!needs.some((x) => x.skill === n.skill)) needs.push(n);
  };
  const spray = rules.spray_for_cabinets;
  if (spray.enabled && job.workTypes.includes("cabinets")) {
    add({
      skill: strParam(spray, "skill", "spray_finish"),
      reason: "Cabinet work is sprayed",
      rule: "spray_for_cabinets",
    });
  }
  const high = rules.high_access_two_story;
  const minStories = numParam(high, "min_stories", 2);
  if (high.enabled && job.workTypes.includes("exterior") && (job.stories ?? 0) >= minStories) {
    add({
      skill: strParam(high, "skill", "exterior_high_access"),
      reason: `Exterior on a ${job.stories}-story home`,
      rule: "high_access_two_story",
    });
  }
  if (rules.lead_safe_renovator.enabled && job.leadSafe) {
    add({
      skill: "rrp_certified",
      reason: "Pre-1978 home (lead-safe work)",
      rule: "lead_safe_renovator",
    });
  }
  const types = new Set(job.entryWorkTypes ?? [productionWorkType(job.workTypes)]);
  if ((job.workOrderPhases ?? []).includes("repair")) types.add("rot_repair");
  for (const t of types) {
    const skill = workTypeSkills[t];
    if (skill) add({ skill, reason: `${workTypeLabels[t] ?? t} work`, rule: null });
  }
  return needs;
}

export type CrewSkill = { key: string; expiresOn: IsoDate | null };

/** Skills the crew is missing for the job on the given last day of work. */
export function missingSkills(
  needs: readonly SkillNeed[],
  crewSkills: readonly CrewSkill[],
  lastDay: IsoDate | null,
): { need: SkillNeed; expired: boolean }[] {
  const out: { need: SkillNeed; expired: boolean }[] = [];
  for (const need of needs) {
    const has = crewSkills.find((s) => s.key === need.skill);
    if (!has) out.push({ need, expired: false });
    else if (has.expiresOn && lastDay && has.expiresOn < lastDay) out.push({ need, expired: true });
  }
  return out;
}

/** Crew skills cover the job (for the onboarding "Crew assigned with required skills" check). */
export function crewCovers(
  needs: readonly SkillNeed[],
  crewSkills: readonly CrewSkill[],
  lastDay: IsoDate | null,
): boolean {
  return missingSkills(needs, crewSkills, lastDay).length === 0;
}
