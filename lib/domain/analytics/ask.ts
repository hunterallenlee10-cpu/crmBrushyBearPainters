import type { Permission } from "@/lib/permissions";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  DATA_QUALITY_METRIC_IDS,
  type AnalyticsBreakdownId,
  type AnalyticsMetricId,
} from "@/lib/metrics/registry";
import { NO_FILTERS, type AnalyticsFilters } from "@/lib/domain/analytics/filters";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/domain/analytics/periods";

/**
 * "Ask Brushy Bear" (SPEC §8.14, §12.2) without AI: a question is matched to
 * predefined metric queries by keyword rules. Answers come only from the
 * metrics registry, cite the metric ids and filters they used, never invent a
 * number, and respect the asker's permissions. A question that maps to
 * nothing says so and suggests the closest report.
 *
 * Pure: `planQuestion()` decides what to compute; the server runs the RPC and
 * `composeAnswer()` turns registry values into the reply.
 */

export const ASK_EXAMPLES = [
  "How are sales this month?",
  "How much did we collect this month?",
  "Which jobs are ready to schedule?",
  "What data-quality issues do we have?",
  "Compare sales vs last month",
] as const;

export type AskOption = { value: string; label: string };
export type AskReport = { key: string; name: string; description: string; href: string };

export type AskContext = {
  can: (permission: Permission) => boolean;
  isOwner: boolean;
  territories: readonly AskOption[];
  sources: readonly AskOption[];
  workTypes: readonly AskOption[];
  reports: readonly AskReport[];
};

/** Metrics Ask may cite from production_stats (list-style questions). */
export const ASK_PRODUCTION_METRICS = ["production.ready", "production.unscheduled"] as const;
export type AskProductionMetricId = (typeof ASK_PRODUCTION_METRICS)[number];
export type AskMetricId = AnalyticsMetricId | AskProductionMetricId;

export type AskPlan =
  | {
      kind: "metrics";
      metricIds: readonly AskMetricId[];
      period: PeriodPreset;
      /** Compare with this period (e.g. last month). */
      compare: PeriodPreset | null;
      filters: AnalyticsFilters;
      /** A breakdown to show under the answer. */
      breakdown: AnalyticsBreakdownId | null;
      /** Where to see the records. */
      link: { label: string; href: string } | null;
      intent: string;
    }
  | { kind: "forbidden"; metricIds: readonly AskMetricId[]; reason: string }
  | { kind: "unmapped"; suggestion: AskReport | null };

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9/&% -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
const phrase = (q: string, p: string) => q.includes(` ${p} `);
const has = (q: string, ...words: string[]) => words.some((w) => phrase(q, w));

const PERIOD_WORDS: readonly [PeriodPreset, readonly string[]][] = [
  ["today", ["today", "so far today"]],
  ["this_week", ["this week", "week to date", "wtd"]],
  ["last_month", ["last month", "previous month"]],
  ["qtd", ["this quarter", "quarter to date", "qtd"]],
  ["ytd", ["this year", "year to date", "ytd"]],
  ["rolling_90d", ["last 90 days", "90 days", "past 90 days", "last quarter"]],
  ["all_time", ["all time", "ever", "since we started"]],
  ["this_month", ["this month", "month to date", "mtd"]],
];

/** The period a question talks about (This Month when it doesn't say). */
export function periodFromQuestion(question: string): PeriodPreset {
  const q = norm(question);
  for (const [preset, words] of PERIOD_WORDS) {
    if (words.some((w) => phrase(q, w))) return preset;
  }
  return "this_month";
}

/** City / work type / source named in the question. */
export function filtersFromQuestion(question: string, ctx: AskContext): AnalyticsFilters {
  const q = norm(question);
  const match = (opts: readonly AskOption[], extra: Record<string, readonly string[]> = {}) =>
    opts.find(
      (o) =>
        phrase(q, o.label.toLowerCase()) ||
        phrase(q, o.value.replaceAll("_", " ")) ||
        (extra[o.value] ?? []).some((w) => phrase(q, w)),
    )?.value ?? null;
  return {
    ...NO_FILTERS,
    territory_id: match(ctx.territories),
    work_type: match(ctx.workTypes, {
      deck_fence: ["deck", "decks", "fence", "fences", "staining"],
      exterior: ["exteriors"],
      interior: ["interiors"],
      cabinets: ["cabinet", "kitchen cabinets"],
    }),
    source: match(ctx.sources, {
      google_ads: ["google ads", "adwords"],
      google_business_profile: ["google business", "gbp", "google maps"],
      facebook_instagram: ["facebook", "instagram", "meta"],
      customer_referral: ["referral", "referrals", "referred"],
    }),
  };
}

type Intent = {
  id: string;
  /** Phrases (any) that trigger it; checked before generic keyword scoring. */
  when: (q: string) => boolean;
  metricIds: readonly AskMetricId[];
  breakdown?: AnalyticsBreakdownId;
  compare?: PeriodPreset;
  defaultPeriod?: PeriodPreset;
  link?: { label: string; href: string };
};

const INTENTS: readonly Intent[] = [
  {
    id: "compare_sales",
    when: (q) =>
      (has(q, "compare", "vs", "versus", "compared") || phrase(q, "than last month")) &&
      has(q, "sales", "sold", "revenue", "bookings"),
    metricIds: ["kpi.revenue_sold", "kpi.sold_jobs", "kpi.close_rate"],
    compare: "last_month",
  },
  {
    id: "ready_to_schedule",
    when: (q) =>
      phrase(q, "ready to schedule") ||
      phrase(q, "need scheduling") ||
      phrase(q, "need to be scheduled"),
    metricIds: ["production.ready", "production.unscheduled"],
    link: { label: "Open Ready to Schedule jobs", href: "/jobs/list?chips=ready_to_schedule" },
  },
  {
    id: "data_quality",
    when: (q) =>
      phrase(q, "data quality") ||
      phrase(q, "data-quality") ||
      phrase(q, "data issues") ||
      phrase(q, "missing data") ||
      phrase(q, "bad data"),
    metricIds: DATA_QUALITY_METRIC_IDS,
    link: { label: "Open the Data Audit", href: "/schedule/onboarding?tab=audit" },
  },
  {
    id: "collected",
    when: (q) => has(q, "collect", "collected", "collections", "payments", "paid us"),
    metricIds: ["kpi.revenue_collected", "kpi.collection_rate", "kpi.ar_outstanding"],
  },
  {
    id: "sales",
    when: (q) => has(q, "sales", "sold", "selling", "bookings", "booked"),
    metricIds: ["kpi.revenue_sold", "kpi.sold_jobs", "kpi.close_rate", "kpi.avg_job_value"],
  },
  {
    id: "funnel",
    when: (q) => has(q, "funnel"),
    metricIds: ["kpi.leads_created", "kpi.contact_rate", "kpi.walkthrough_set_rate"],
    breakdown: "kpi.lead_funnel",
  },
  {
    id: "sources",
    when: (q) =>
      phrase(q, "lead source") ||
      phrase(q, "lead sources") ||
      phrase(q, "where do leads come from") ||
      phrase(q, "best source"),
    metricIds: ["kpi.leads_created", "kpi.cost_per_lead"],
    breakdown: "kpi.lead_source_performance",
  },
  {
    id: "cities",
    when: (q) => phrase(q, "by city") || phrase(q, "which city") || phrase(q, "cities"),
    metricIds: ["kpi.leads_created", "kpi.sold_jobs"],
    breakdown: "kpi.city_performance",
  },
  {
    id: "estimators",
    when: (q) =>
      has(q, "estimator", "estimators", "leaderboard") ||
      phrase(q, "sales rep") ||
      phrase(q, "who sold"),
    metricIds: ["kpi.sold_jobs", "kpi.close_rate"],
    breakdown: "kpi.estimator_leaderboard",
  },
  {
    id: "season",
    when: (q) => phrase(q, "exterior season") || phrase(q, "season backlog") || phrase(q, "summer"),
    metricIds: ["kpi.backlog_crew_days"],
    breakdown: "kpi.season_backlog",
  },
];

/** Generic match: the analytics metric whose keywords match the question best. */
function scoreMetrics(q: string): AnalyticsMetricId[] {
  const scored: { id: AnalyticsMetricId; score: number }[] = [];
  for (const [id, m] of Object.entries(ANALYTICS_METRICS) as [
    AnalyticsMetricId,
    (typeof ANALYTICS_METRICS)[AnalyticsMetricId],
  ][]) {
    let score = 0;
    for (const k of [...m.keywords, m.label.toLowerCase()]) {
      if (phrase(q, k)) score = Math.max(score, k.length);
    }
    if (score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return scored
    .filter((s) => s.score === best)
    .slice(0, 3)
    .map((s) => s.id);
}

function needsOf(id: AskMetricId): { requires: readonly Permission[]; ownerOnly: boolean } {
  if (id.startsWith("production.")) return { requires: ["schedule:read"], ownerOnly: false };
  const m = ANALYTICS_METRICS[id as AnalyticsMetricId];
  return { requires: m.requires, ownerOnly: m.ownerOnly };
}

/** Why the asker can't see a metric (null when they can). */
export function permissionProblem(ids: readonly AskMetricId[], ctx: AskContext): string | null {
  for (const id of ids) {
    const { requires, ownerOnly } = needsOf(id);
    if (ownerOnly && !(ctx.isOwner || ctx.can("job_costing:read"))) {
      return "That figure is for owners and the bookkeeper only.";
    }
    if (requires.includes("financials:read") && !ctx.can("financials:read")) {
      return "Your role doesn't see revenue or money figures, so I can't answer that one.";
    }
    if (requires.some((p) => !ctx.can(p))) return "Your role doesn't have access to that figure.";
  }
  return null;
}

/** Closest report to an unmapped question (shared words with its name and description). */
export function closestReport(question: string, reports: readonly AskReport[]): AskReport | null {
  const words = new Set(
    norm(question)
      .split(" ")
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
  let best: { r: AskReport; score: number } | null = null;
  for (const r of reports) {
    const text = norm(`${r.name} ${r.description}`);
    let score = 0;
    for (const w of words) if (text.includes(` ${w}`)) score++;
    if (score > 0 && (!best || score > best.score)) best = { r, score };
  }
  return best?.r ?? null;
}
const STOP = new Set([
  "what",
  "which",
  "where",
  "when",
  "there",
  "have",
  "many",
  "much",
  "does",
  "this",
  "that",
  "with",
  "from",
  "were",
  "will",
  "your",
  "show",
]);

/** Decides what a question asks for (pure; no data). */
export function planQuestion(question: string, ctx: AskContext): AskPlan {
  const q = norm(question);
  if (q.trim().length < 3) return { kind: "unmapped", suggestion: null };
  const filters = filtersFromQuestion(question, ctx);
  const intent = INTENTS.find((i) => i.when(q));
  const metricIds = intent ? intent.metricIds : scoreMetrics(q);
  if (metricIds.length === 0) {
    return { kind: "unmapped", suggestion: closestReport(question, ctx.reports) };
  }
  const problem = permissionProblem(metricIds, ctx);
  if (problem) {
    // Drop what they can't see; if nothing is left, refuse.
    const visible = metricIds.filter((id) => permissionProblem([id], ctx) === null);
    if (visible.length === 0) return { kind: "forbidden", metricIds, reason: problem };
    return {
      kind: "metrics",
      metricIds: visible,
      period: periodFromQuestion(question),
      compare: intent?.compare ?? null,
      filters,
      breakdown: intent?.breakdown ?? null,
      link: intent?.link ?? null,
      intent: intent?.id ?? "keywords",
    };
  }
  const breakdown = intent?.breakdown ?? null;
  const breakdownOk =
    breakdown === null || ANALYTICS_BREAKDOWNS[breakdown].requires.every((p) => ctx.can(p));
  return {
    kind: "metrics",
    metricIds,
    period: intent?.compare ? "this_month" : periodFromQuestion(question),
    compare: intent?.compare ?? null,
    filters,
    breakdown: breakdownOk ? breakdown : null,
    link: intent?.link ?? null,
    intent: intent?.id ?? "keywords",
  };
}

export type AnsweredMetric = {
  id: AskMetricId;
  label: string;
  display: string;
  caption: string;
  /** The same metric in the comparison period. */
  compareDisplay?: string;
  change?: string | null;
};

export type AskAnswer = {
  question: string;
  /** One or two plain sentences built from the registry values. */
  text: string;
  metrics: readonly AnsweredMetric[];
  periodLabel: string;
  compareLabel: string | null;
  filtersLabel: string;
  /** Metric ids and filters cited under the answer. */
  citations: readonly string[];
  link: { label: string; href: string } | null;
  note: "computed";
};

/** Builds the reply from computed values. Numbers only ever come from `metrics`. */
export function composeAnswer(input: {
  question: string;
  plan: Extract<AskPlan, { kind: "metrics" }>;
  metrics: readonly AnsweredMetric[];
  periodLabel: string;
  compareLabel: string | null;
  filtersLabel: string;
}): AskAnswer {
  const { plan, metrics } = input;
  const lower = input.periodLabel.toLowerCase();
  const parts = metrics.map((m) =>
    m.compareDisplay !== undefined
      ? `${m.label}: ${m.display} (${input.compareLabel?.toLowerCase() ?? "before"}: ${m.compareDisplay}${m.change ? `, ${m.change}` : ""})`
      : `${m.label}: ${m.display}`,
  );
  const scope = input.filtersLabel.startsWith("All ") ? "" : ` for ${input.filtersLabel}`;
  const rightNow = metrics.every((m) => m.caption.includes("right now"));
  const text = `${rightNow ? "Right now" : capitalize(lower)}${scope}: ${parts.join(". ")}.`;
  return {
    question: input.question,
    text,
    metrics,
    periodLabel: input.periodLabel,
    compareLabel: input.compareLabel,
    filtersLabel: input.filtersLabel,
    citations: [
      ...metrics.map((m) => m.id),
      ...(plan.breakdown ? [plan.breakdown] : []),
      `period=${plan.period}`,
      ...(plan.compare ? [`compare=${plan.compare}`] : []),
      ...Object.entries(plan.filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`),
    ],
    link: plan.link,
    note: "computed",
  };
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Label of a preset (for answers). */
export function presetLabel(p: PeriodPreset): string {
  return PERIOD_PRESETS.find((x) => x.id === p)?.label ?? p;
}
