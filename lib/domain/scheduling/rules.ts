/**
 * Work rules the scheduler enforces (SPEC §15.1). Keys match
 * public.work_rules (seeded in supabase/migrations/20261027000500); owners
 * edit the label, severity, parameters and on/off in Admin → Schedule Admin.
 * The defaults here are used when a row is missing. Pure.
 */

export const WORK_RULE_KEYS = [
  "walkthrough_before_production",
  "deposit_before_scheduling",
  "hoa_before_exterior",
  "lead_safe_renovator",
  "exterior_in_season",
  "weather_forecast",
  "max_jobs_per_crew_day",
  "spray_for_cabinets",
  "high_access_two_story",
  "crew_time_off",
  "sub_compliance",
] as const;
export type WorkRuleKey = (typeof WORK_RULE_KEYS)[number];

export function isWorkRuleKey(v: string): v is WorkRuleKey {
  return (WORK_RULE_KEYS as readonly string[]).includes(v);
}

export type WorkRule = {
  key: WorkRuleKey;
  label: string;
  enabled: boolean;
  severity: "block" | "warn";
  /** An owner may schedule past it with a reason. */
  ownerOverride: boolean;
  /** Only checked when weather is connected. */
  requiresWeather: boolean;
  params: Record<string, number | string>;
};

/**
 * Rules that can't be switched off: holds stop scheduling in the database
 * (the stage engine refuses Ready to Schedule and later stages while a
 * blocking hold is active), so turning the deposit rule off would only hide
 * the reason.
 */
export const LOCKED_RULES: ReadonlySet<WorkRuleKey> = new Set(["deposit_before_scheduling"]);

export const DEFAULT_WORK_RULES: Record<WorkRuleKey, WorkRule> = {
  walkthrough_before_production: rule(
    "walkthrough_before_production",
    "Walkthrough before production",
  ),
  deposit_before_scheduling: rule("deposit_before_scheduling", "Deposit before scheduling"),
  hoa_before_exterior: rule("hoa_before_exterior", "HOA approval before exterior color change"),
  lead_safe_renovator: rule(
    "lead_safe_renovator",
    "Lead-safe certified renovator on pre-1978 jobs",
  ),
  exterior_in_season: rule("exterior_in_season", "Exterior/deck only in season", {
    ownerOverride: true,
  }),
  weather_forecast: rule("weather_forecast", "No exterior painting in rain or cold", {
    ownerOverride: true,
    requiresWeather: true,
    params: { rain_percent: 60 },
  }),
  max_jobs_per_crew_day: rule(
    "max_jobs_per_crew_day",
    "Max 1 active job per crew per day unless split",
  ),
  spray_for_cabinets: rule("spray_for_cabinets", "Spray-finish skill required for cabinets", {
    params: { skill: "spray_finish" },
  }),
  high_access_two_story: rule(
    "high_access_two_story",
    "2-story exterior requires high-access skill",
    { params: { skill: "exterior_high_access", min_stories: 2 } },
  ),
  crew_time_off: rule("crew_time_off", "Crew time off and blackout dates"),
  sub_compliance: rule("sub_compliance", "Subcontractor paperwork current"),
};

function rule(key: WorkRuleKey, label: string, extra: Partial<WorkRule> = {}): WorkRule {
  return {
    key,
    label,
    enabled: true,
    severity: "block",
    ownerOverride: false,
    requiresWeather: false,
    params: {},
    ...extra,
  };
}

/** Stored rows (any order, possibly missing) → a full rule set. */
export function resolveWorkRules(
  rows: readonly {
    key: string;
    label?: string | null;
    enabled: boolean;
    severity: string;
    owner_override?: boolean;
    requires_weather?: boolean;
    params?: unknown;
  }[],
): Record<WorkRuleKey, WorkRule> {
  const out: Record<WorkRuleKey, WorkRule> = { ...DEFAULT_WORK_RULES };
  for (const r of rows) {
    if (!isWorkRuleKey(r.key)) continue;
    const base = DEFAULT_WORK_RULES[r.key];
    const params: Record<string, number | string> = { ...base.params };
    if (r.params && typeof r.params === "object" && !Array.isArray(r.params)) {
      for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
        if (typeof v === "number" || typeof v === "string") params[k] = v;
      }
    }
    out[r.key] = {
      key: r.key,
      label: r.label?.trim() || base.label,
      enabled: LOCKED_RULES.has(r.key) ? true : r.enabled,
      severity: r.severity === "warn" ? "warn" : "block",
      ownerOverride: r.owner_override ?? base.ownerOverride,
      requiresWeather: r.requires_weather ?? base.requiresWeather,
      params,
    };
  }
  return out;
}

export function numParam(r: WorkRule, name: string, fallback: number): number {
  const v = r.params[name];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function strParam(r: WorkRule, name: string, fallback: string): string {
  const v = r.params[name];
  return typeof v === "string" && v.trim() ? v : fallback;
}
