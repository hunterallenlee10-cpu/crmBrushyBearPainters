import { z } from "zod";
import {
  AGING_BUCKETS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  STALE_AFTER_DAYS,
  type LeadStatus,
} from "@/lib/domain/leads/constants";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";
import { JOB_STAGES, type JobStageId } from "@/lib/domain/stages";

/**
 * Metrics registry (SPEC §12.1, CLAUDE.md): every KPI is defined here once and
 * every card, chart and report reads it from here. Components never do metric
 * math of their own.
 *
 * A metric names the server-side aggregate it reads (`source`, an RPC that
 * counts in Postgres across every record the viewer can see), its unit, a
 * formula caption, and a pure `compute` over that RPC's parsed payload.
 * Later phases add sources (estimates, jobs, money…) next to `lead_stats`.
 *
 * Rules: a ratio with a zero denominator is `null` (shown as "—"), never NaN or
 * Infinity, and percentages are clamped to 0–100%.
 */

// ---------------------------------------------------------------------------
// Sources: parsers for the RPC payloads metrics are computed from
// ---------------------------------------------------------------------------

const count = z.number().int().nonnegative().catch(0);

/** `public.lead_stats()` jsonb (supabase/migrations/20261026000600_leads_customers.sql). */
export const leadStatsSchema = z.object({
  total: count,
  open: count,
  by_status: z.record(z.string(), count).catch({}),
  reached_contacted: count,
  reached_walkthrough: count,
  converted: count,
  unassigned: count,
  hot: count,
  stale: count,
  new_last_7_days: count,
  aging: z
    .object({
      "0_3": count,
      "4_7": count,
      "8_14": count,
      "15_30": count,
      "30_plus": count,
    })
    .catch({ "0_3": 0, "4_7": 0, "8_14": 0, "15_30": 0, "30_plus": 0 }),
  by_source: z
    .array(z.object({ source: z.string().nullable().catch(null), leads: count, converted: count }))
    .catch([]),
  by_city: z.array(z.object({ city: z.string().catch("Unknown"), leads: count })).catch([]),
  speed_to_lead_median_seconds: z.number().nonnegative().nullable().catch(null),
});
export type LeadStats = z.infer<typeof leadStatsSchema>;

/** An all-zero payload (no leads, or the RPC failed to parse). */
export const EMPTY_LEAD_STATS: LeadStats = leadStatsSchema.parse({});

/** Parses the RPC result; anything malformed becomes zero / empty, never a crash. */
export function parseLeadStats(raw: unknown): LeadStats {
  const parsed = leadStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_LEAD_STATS;
}

/** Job sources (JobStats, JobStatusCounts) are defined in the JOB section below. */
export type MetricSources = {
  lead_stats: LeadStats;
  job_stats: JobStats;
  job_status_counts: JobStatusCounts;
};
export type MetricSource = keyof MetricSources;

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

export type MetricUnit = "count" | "percent" | "duration" | "money";

export type MetricDefinition<S extends MetricSource = MetricSource> = {
  id: string;
  label: string;
  description: string;
  /** Server-side aggregate (RPC) the metric reads. */
  source: S;
  /** "count": whole number; "percent": ratio 0–1; "duration": seconds; "money": cents. */
  unit: MetricUnit;
  /** Formula caption shown under the number (SPEC §8 KPI cards). */
  caption: string;
  /** Only owners may see it (SPEC §12.1). */
  ownerOnly: boolean;
  compute: (data: MetricSources[S]) => number | null;
};

/** Safe ratio: null when there is nothing to divide by; clamped to 0–1. */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const r = numerator / denominator;
  if (!Number.isFinite(r)) return null;
  return Math.min(1, Math.max(0, r));
}

const statusCount = (s: LeadStats, status: LeadStatus) => s.by_status[status] ?? 0;

function leadMetric(
  def: Omit<MetricDefinition<"lead_stats">, "source" | "ownerOnly"> & { ownerOnly?: boolean },
): MetricDefinition<"lead_stats"> {
  return { ownerOnly: false, ...def, source: "lead_stats" };
}

export const LEAD_METRICS = {
  "leads.total": leadMetric({
    id: "leads.total",
    label: "Total Leads",
    description: "Every lead you can see, in any status.",
    unit: "count",
    caption: "All leads you can see · all time",
    compute: (s) => s.total,
  }),
  "leads.new": leadMetric({
    id: "leads.new",
    label: "New",
    description: "Leads nobody has reached yet.",
    unit: "count",
    caption: "Status is New · not reached yet",
    compute: (s) => statusCount(s, "new"),
  }),
  "leads.contacted": leadMetric({
    id: "leads.contacted",
    label: "Contacted",
    description: "Leads a person has called, texted or emailed, with no walkthrough yet.",
    unit: "count",
    caption: "Status is Contacted",
    compute: (s) => statusCount(s, "contacted"),
  }),
  "leads.walkthrough_scheduled": leadMetric({
    id: "leads.walkthrough_scheduled",
    label: "Walkthrough Scheduled",
    description: "Leads with a walkthrough on the calendar.",
    unit: "count",
    caption: "Status is Walkthrough Scheduled",
    compute: (s) => statusCount(s, "walkthrough_scheduled"),
  }),
  "leads.contact_rate": leadMetric({
    id: "leads.contact_rate",
    label: "Lead → Contact",
    description: "Share of leads a person has reached at least once.",
    unit: "percent",
    caption: "Leads ever contacted ÷ all leads",
    compute: (s) => ratio(s.reached_contacted, s.total),
  }),
  "leads.walkthrough_rate": leadMetric({
    id: "leads.walkthrough_rate",
    label: "Walkthrough Rate",
    description: "Share of leads that got a walkthrough booked.",
    unit: "percent",
    caption: "Leads with a walkthrough ÷ all leads",
    compute: (s) => ratio(s.reached_walkthrough, s.total),
  }),
  "leads.conversion_rate": leadMetric({
    id: "leads.conversion_rate",
    label: "Conversion to Job",
    description: "Share of leads converted to a job.",
    unit: "percent",
    caption: "Converted ÷ all leads",
    compute: (s) => ratio(s.converted, s.total),
  }),
  "leads.unassigned": leadMetric({
    id: "leads.unassigned",
    label: "Unassigned",
    description: "Open leads with no owner.",
    unit: "count",
    caption: "Open leads with no owner",
    compute: (s) => s.unassigned,
  }),
  "leads.hot": leadMetric({
    id: "leads.hot",
    label: "Hot Leads",
    description: "Open leads scoring an A (85 or more).",
    unit: "count",
    caption: "Open leads graded A (score 85+)",
    compute: (s) => s.hot,
  }),
  "leads.stale": leadMetric({
    id: "leads.stale",
    label: `Stale ${STALE_AFTER_DAYS}+ Days`,
    description: `Open leads with no activity for ${STALE_AFTER_DAYS} days or more.`,
    unit: "count",
    caption: `Open leads with no activity in ${STALE_AFTER_DAYS}+ days`,
    compute: (s) => s.stale,
  }),
  "leads.new_last_7_days": leadMetric({
    id: "leads.new_last_7_days",
    label: "New in Last 7 Days",
    description: "Leads created in the last 7 days, in any status.",
    unit: "count",
    caption: "Created in the last 7 days",
    compute: (s) => s.new_last_7_days,
  }),
  "leads.speed_to_lead_median": leadMetric({
    id: "leads.speed_to_lead_median",
    label: "Speed to Lead",
    description: "Median time from a lead arriving to a person first reaching them.",
    unit: "duration",
    caption: "Median, business hours, last 90 days",
    compute: (s) => s.speed_to_lead_median_seconds,
  }),
} as const satisfies Record<string, MetricDefinition<"lead_stats">>;

export type LeadMetricId = keyof typeof LEAD_METRICS;

export type MetricValue = {
  id: MetricId;
  label: string;
  caption: string;
  unit: MetricUnit;
  value: number | null;
  display: string;
};

/** Computes one lead metric and formats it for display. */
export function leadMetricValue(id: LeadMetricId, stats: LeadStats): MetricValue {
  const m = LEAD_METRICS[id];
  const raw = m.compute(stats);
  const value = raw === null || !Number.isFinite(raw) ? null : raw;
  return {
    id,
    label: m.label,
    caption: m.caption,
    unit: m.unit,
    value,
    display: formatMetricValue(m.unit, value),
  };
}

/** "1,204", "42%", "6 min"; "—" when there is no value. */
export function formatMetricValue(unit: MetricUnit, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "count":
      return Math.round(value).toLocaleString("en-US");
    case "percent":
      return formatPercent(value);
    case "duration":
      return formatDuration(value);
    case "money":
      return formatMoney(value);
  }
}

/** Ratio (0–1) as a whole percentage, one decimal under 10%: "42%", "3.5%". */
export function formatPercent(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return "—";
  const pct = Math.min(100, Math.max(0, r * 100));
  if (pct > 0 && pct < 10) return `${(Math.round(pct * 10) / 10).toString()}%`;
  return `${Math.round(pct)}%`;
}

// ---------------------------------------------------------------------------
// Breakdowns: the rows behind each lead chart (and its "View data" table)
// ---------------------------------------------------------------------------

export const LEAD_BREAKDOWN_CAPTIONS = {
  status: "Every lead you can see, by current status",
  funnel: "Each step counts leads that ever reached it · % of all leads",
  sources: "Top 8 sources by leads · converted ÷ leads",
  cities: "Service-area city from the lead's ZIP · top 10",
  aging: "Open leads by days since they came in",
} as const;

export type StatusRow = { status: LeadStatus; label: string; leads: number };

/** Lead Status Distribution: every status, in pipeline order, zeros included. */
export function leadStatusDistribution(stats: LeadStats): StatusRow[] {
  return LEAD_STATUSES.map((status) => ({
    status,
    label: LEAD_STATUS_LABELS[status],
    leads: statusCount(stats, status),
  }));
}

export type FunnelStep = {
  key: "leads" | "contacted" | "walkthrough" | "converted";
  label: string;
  leads: number;
  /** Share of all leads (0–1, null when there are none). */
  ofTotal: number | null;
  /** Share of the previous step (null for the first step or an empty previous step). */
  fromPrevious: number | null;
  /** Registry metric for this step's rate. */
  metricId: LeadMetricId | null;
};

/** Conversion Funnel: Lead → Contacted → Walkthrough → Converted. */
export function leadFunnel(stats: LeadStats): FunnelStep[] {
  const steps: Omit<FunnelStep, "ofTotal" | "fromPrevious">[] = [
    { key: "leads", label: "Leads", leads: stats.total, metricId: null },
    {
      key: "contacted",
      label: "Contacted",
      leads: stats.reached_contacted,
      metricId: "leads.contact_rate",
    },
    {
      key: "walkthrough",
      label: "Walkthrough",
      leads: stats.reached_walkthrough,
      metricId: "leads.walkthrough_rate",
    },
    {
      key: "converted",
      label: "Converted",
      leads: stats.converted,
      metricId: "leads.conversion_rate",
    },
  ];
  return steps.map((s, i) => ({
    ...s,
    ofTotal: i === 0 ? ratio(s.leads, s.leads) : ratio(s.leads, stats.total),
    fromPrevious: i === 0 ? null : ratio(s.leads, steps[i - 1]!.leads),
  }));
}

export type SourceRow = {
  source: string | null;
  leads: number;
  converted: number;
  /** Leads from this source that haven't converted (yet). */
  notConverted: number;
  conversion: number | null;
};

/** Top Lead Sources (top 8 by volume, from the RPC) with conversion rate. */
export function leadSources(stats: LeadStats): SourceRow[] {
  return stats.by_source.map((r) => {
    const converted = Math.min(r.converted, r.leads);
    return {
      source: r.source,
      leads: r.leads,
      converted,
      notConverted: r.leads - converted,
      conversion: ratio(converted, r.leads),
    };
  });
}

export type CityRow = { city: string; leads: number; share: number | null };

/** Leads by City (top 10) with share of all leads. */
export function leadCities(stats: LeadStats): CityRow[] {
  return stats.by_city.map((r) => ({
    city: r.city,
    leads: r.leads,
    share: ratio(r.leads, stats.total),
  }));
}

export type AgingRow = {
  key: (typeof AGING_BUCKETS)[number]["key"];
  label: string;
  leads: number;
};

/** Lead Aging: open leads by days since created (0–3, 4–7, 8–14, 15–30, 30+). */
export function leadAging(stats: LeadStats): AgingRow[] {
  return AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, leads: stats.aging[b.key] }));
}

// ===========================================================================
// JOBS (Phase 3): Jobs Dashboard and Job List (SPEC §8.5)
// ===========================================================================
//
// Sources: `public.job_stats(p_from, p_to, p_prev_from)` and
// `public.job_status_counts()` (supabase/migrations/20261026001100_jobs_core.sql).
// Both run with the viewer's row security. Money is the contract baseline in
// cents (job_financials), visible only with financials:read: for anyone else
// every money value is null and shows as "—". Until estimates exist (Phase 4)
// the baseline is the job's contract amount.

/** Money in cents: null when the viewer may not see it. */
const cents = z.number().nonnegative().nullable().catch(null);

export const jobStatsSchema = z.object({
  can_see_money: z.boolean().catch(false),
  open_jobs: count,
  /** Jobs open at the start of the period. */
  open_jobs_prev: count,
  pipeline_value_cents: cents,
  in_progress: count,
  on_hold: count,
  closed_won: count,
  closed_won_prev: count,
  closed_lost: count,
  sold_count: count,
  sold_value_cents: cents,
  sold_value_prev_cents: cents,
  closing_this_period: count,
  by_stage: z.array(z.object({ stage: z.string(), jobs: count, value_cents: cents })).catch([]),
  sold_by_day: z.array(z.object({ day: z.string(), jobs: count, value_cents: cents })).catch([]),
});
export type JobStats = z.infer<typeof jobStatsSchema>;

export const EMPTY_JOB_STATS: JobStats = jobStatsSchema.parse({});

/**
 * Parses `job_stats`. Without financials:read every money value becomes null;
 * with it, an empty sum (no amounts yet) becomes 0.
 */
export function parseJobStats(raw: unknown): JobStats {
  const parsed = jobStatsSchema.safeParse(raw ?? {});
  const s = parsed.success ? parsed.data : EMPTY_JOB_STATS;
  const m = (v: number | null) => (s.can_see_money ? (v ?? 0) : null);
  return {
    ...s,
    pipeline_value_cents: m(s.pipeline_value_cents),
    sold_value_cents: m(s.sold_value_cents),
    sold_value_prev_cents: m(s.sold_value_prev_cents),
    by_stage: s.by_stage.map((r) => ({ ...r, value_cents: m(r.value_cents) })),
    sold_by_day: s.sold_by_day.map((r) => ({ ...r, value_cents: m(r.value_cents) })),
  };
}

export const jobStatusCountsSchema = z.object({
  active: count,
  mine: count,
  total: count,
  on_hold: count,
  by_stage: z.record(z.string(), count).catch({}),
});
export type JobStatusCounts = z.infer<typeof jobStatusCountsSchema>;

export const EMPTY_JOB_STATUS_COUNTS: JobStatusCounts = jobStatusCountsSchema.parse({});

export function parseJobStatusCounts(raw: unknown): JobStatusCounts {
  const parsed = jobStatusCountsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_JOB_STATUS_COUNTS;
}

/** Whole dollars from cents: "$12,345". */
export function formatMoney(centsValue: number | null): string {
  if (centsValue === null || !Number.isFinite(centsValue)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(centsValue / 100));
}

/** Words for the dashboard period, used in captions ("this month", "last month", "Oct 1"). */
export type PeriodWords = { period: string; prior: string; start: string };

export type JobMetricDefinition<S extends "job_stats" | "job_status_counts"> =
  MetricDefinition<S> & {
    /** Money metrics show "—" to people without financials:read. */
    requiresMoney: boolean;
    /** The same figure for the prior period, when the source has it (drives the delta). */
    prior?: (data: MetricSources[S]) => number | null;
    /** Caption with live numbers. Static captions may use `{period}` / `{prior}`. */
    detail?: (data: MetricSources[S], words: PeriodWords) => string;
  };

function jobMetric(
  def: Omit<JobMetricDefinition<"job_stats">, "source" | "ownerOnly" | "requiresMoney"> & {
    requiresMoney?: boolean;
  },
): JobMetricDefinition<"job_stats"> {
  return { ownerOnly: false, requiresMoney: false, ...def, source: "job_stats" };
}

function jobCountMetric(
  def: Omit<
    JobMetricDefinition<"job_status_counts">,
    "source" | "ownerOnly" | "requiresMoney" | "unit"
  >,
): JobMetricDefinition<"job_status_counts"> {
  return {
    ownerOnly: false,
    requiresMoney: false,
    unit: "count",
    ...def,
    source: "job_status_counts",
  };
}

const avgJobSize = (s: JobStats): number | null =>
  s.sold_value_cents === null || s.sold_count === 0 ? null : s.sold_value_cents / s.sold_count;

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export const JOB_METRICS = {
  "jobs.total": jobMetric({
    id: "jobs.total",
    label: "All Jobs",
    description: "Every job you can see, in any stage.",
    unit: "count",
    caption: "All jobs you can see · any stage",
    compute: (s) => s.by_stage.reduce((n, r) => n + r.jobs, 0),
  }),
  "jobs.pipeline_value": jobMetric({
    id: "jobs.pipeline_value",
    label: "Total Pipeline Value",
    description: "Contract value of every open job (not Closed Won or Closed Lost).",
    unit: "money",
    requiresMoney: true,
    caption: "Contract value of open jobs · right now",
    compute: (s) => s.pipeline_value_cents,
    detail: (s) =>
      s.pipeline_value_cents === null
        ? `${plural(s.open_jobs, "open job")} · amounts hidden for your role`
        : `${plural(s.open_jobs, "open job")} × ${formatMoney(
            s.open_jobs ? s.pipeline_value_cents / s.open_jobs : null,
          )} avg · right now`,
  }),
  "jobs.open": jobMetric({
    id: "jobs.open",
    label: "Open Jobs",
    description: "Jobs that aren't Closed Won or Closed Lost.",
    unit: "count",
    caption: "Not closed won or lost · vs open on {start}",
    compute: (s) => s.open_jobs,
    prior: (s) => s.open_jobs_prev,
  }),
  "jobs.in_progress": jobMetric({
    id: "jobs.in_progress",
    label: "In Progress",
    description: "Jobs with a crew painting now (stage In Progress).",
    unit: "count",
    caption: "Stage is In Progress · right now",
    compute: (s) => s.in_progress,
  }),
  "jobs.on_hold": jobMetric({
    id: "jobs.on_hold",
    label: "On Hold",
    description: "Jobs with at least one active hold.",
    unit: "count",
    caption: "Jobs with an active hold · right now",
    compute: (s) => s.on_hold,
  }),
  "jobs.closed_won": jobMetric({
    id: "jobs.closed_won",
    label: "Closed Won",
    description: "Jobs closed as won during the period.",
    unit: "count",
    caption: "Closed won {period} · vs {prior}",
    compute: (s) => s.closed_won,
    prior: (s) => s.closed_won_prev,
  }),
  "jobs.closed_lost": jobMetric({
    id: "jobs.closed_lost",
    label: "Closed Lost",
    description: "Jobs closed as lost during the period.",
    unit: "count",
    caption: "Closed lost {period}",
    compute: (s) => s.closed_lost,
  }),
  "jobs.sold_value": jobMetric({
    id: "jobs.sold_value",
    label: "Total Revenue",
    description: "Contract value of jobs sold (estimate accepted) during the period.",
    unit: "money",
    requiresMoney: true,
    caption: "Sold value {period} · vs {prior}",
    compute: (s) => s.sold_value_cents,
    prior: (s) => s.sold_value_prev_cents,
    detail: (s, w) =>
      s.sold_value_cents === null
        ? `${plural(s.sold_count, "job")} sold ${w.period} · amounts hidden for your role`
        : `${plural(s.sold_count, "job")} sold ${w.period} · vs ${w.prior}`,
  }),
  "jobs.sold_count": jobMetric({
    id: "jobs.sold_count",
    label: "Jobs Sold",
    description: "Jobs whose estimate was accepted during the period.",
    unit: "count",
    caption: "Estimate accepted {period}",
    compute: (s) => s.sold_count,
  }),
  "jobs.avg_job_size": jobMetric({
    id: "jobs.avg_job_size",
    label: "Avg Job Size",
    description: "Sold value divided by jobs sold during the period.",
    unit: "money",
    requiresMoney: true,
    caption: "Sold value ÷ jobs sold {period}",
    compute: avgJobSize,
  }),
  "jobs.win_rate": jobMetric({
    id: "jobs.win_rate",
    label: "Win Rate",
    description: "Share of jobs closed during the period that were won.",
    unit: "percent",
    caption: "Won ÷ (won + lost) closed {period}",
    compute: (s) => ratio(s.closed_won, s.closed_won + s.closed_lost),
    detail: (s, w) =>
      `${s.closed_won.toLocaleString("en-US")} won ÷ ${(s.closed_won + s.closed_lost).toLocaleString("en-US")} closed ${w.period}`,
  }),
  "jobs.closing_this_month": jobMetric({
    id: "jobs.closing_this_month",
    label: "Closing This Month",
    description: "Open jobs with an estimated completion date this month.",
    unit: "count",
    caption: "Open jobs due to finish this month",
    compute: (s) => s.closing_this_period,
  }),
} as const satisfies Record<string, JobMetricDefinition<"job_stats">>;

export const JOB_COUNT_METRICS = {
  "jobs.list_active": jobCountMetric({
    id: "jobs.list_active",
    label: "Active Jobs",
    description: "Jobs you can see that aren't Closed Won or Closed Lost.",
    caption: "Not closed won or lost",
    compute: (c) => c.active,
  }),
  "jobs.list_total": jobCountMetric({
    id: "jobs.list_total",
    label: "All Jobs",
    description: "Every job you can see.",
    caption: "Any stage",
    compute: (c) => c.total,
  }),
  "jobs.list_mine": jobCountMetric({
    id: "jobs.list_mine",
    label: "My Jobs",
    description:
      "Open jobs where you're the owner, point of contact, project manager or on the team.",
    caption: "Open jobs you're on",
    compute: (c) => c.mine,
  }),
  "jobs.list_on_hold": jobCountMetric({
    id: "jobs.list_on_hold",
    label: "On Hold",
    description: "Jobs with at least one active hold.",
    caption: "Active hold",
    compute: (c) => c.on_hold,
  }),
} as const satisfies Record<string, JobMetricDefinition<"job_status_counts">>;

export type JobMetricId = keyof typeof JOB_METRICS;
export type JobCountMetricId = keyof typeof JOB_COUNT_METRICS;

export type MetricDelta = {
  /** current − previous, in the metric's unit. */
  change: number;
  direction: "up" | "down" | "flat";
  /** "+3", "−$1,200", "No change". */
  display: string;
  previousDisplay: string;
};

/** Change vs the prior period; null when either side is unknown. */
export function metricDelta(
  unit: MetricUnit,
  current: number | null,
  previous: number | null,
): MetricDelta | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const change = current - previous;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const magnitude =
    unit === "percent"
      ? `${Math.round(Math.abs(change) * 100)} pts`
      : formatMetricValue(unit, Math.abs(change));
  return {
    change,
    direction,
    display: direction === "flat" ? "No change" : `${change > 0 ? "+" : "−"}${magnitude}`,
    previousDisplay: formatMetricValue(unit, previous),
  };
}

export type JobMetricValue = Omit<MetricValue, "id"> & {
  id: JobMetricId;
  /** Money hidden for this viewer (shown as "—"). */
  hidden: boolean;
  delta: MetricDelta | null;
};

const fillWords = (text: string, w: PeriodWords) =>
  text
    .replaceAll("{period}", w.period)
    .replaceAll("{prior}", w.prior)
    .replaceAll("{start}", w.start);

/** Computes one Jobs Dashboard metric (value, formula caption, prior-period delta). */
export function jobMetricValue(
  id: JobMetricId,
  stats: JobStats,
  words: PeriodWords = {
    period: "this period",
    prior: "the prior period",
    start: "the start of the period",
  },
): JobMetricValue {
  const m: JobMetricDefinition<"job_stats"> = JOB_METRICS[id];
  const hidden = m.requiresMoney && !stats.can_see_money;
  const raw = hidden ? null : m.compute(stats);
  const value = raw === null || !Number.isFinite(raw) ? null : raw;
  const previous = !hidden && m.prior ? m.prior(stats) : null;
  return {
    id,
    label: m.label,
    caption: m.detail ? m.detail(stats, words) : fillWords(m.caption, words),
    unit: m.unit,
    value,
    display: formatMetricValue(m.unit, value),
    hidden,
    delta: m.prior ? metricDelta(m.unit, value, previous) : null,
  };
}

/** A Job List count (tab totals) from `job_status_counts`. */
export function jobCountValue(id: JobCountMetricId, counts: JobStatusCounts): number {
  return JOB_COUNT_METRICS[id].compute(counts) ?? 0;
}

export const JOB_BREAKDOWN_CAPTIONS = {
  snapshot: "Every job you can see, by current stage · share of all jobs",
  health: "Open and In Progress right now · closed won and lost {period}",
  soldByDay: "Sold value per day {period} (estimate accepted)",
  soldByDayCounts: "Jobs sold per day {period} (estimate accepted)",
} as const;

export function jobCaption(key: keyof typeof JOB_BREAKDOWN_CAPTIONS, words: PeriodWords): string {
  return fillWords(JOB_BREAKDOWN_CAPTIONS[key], words);
}

export type PipelineStageRow = {
  stage: JobStageId;
  label: string;
  color: string;
  jobs: number;
  /** null when money is hidden. */
  valueCents: number | null;
  /** Share of all jobs (0–1; null when there are none). */
  share: number | null;
};

export type PipelineSnapshot = {
  rows: PipelineStageRow[];
  totalJobs: number;
  totalValueCents: number | null;
};

/** Pipeline Snapshot: every stage in order, zeros included, with totals. */
export function jobPipelineSnapshot(stats: JobStats): PipelineSnapshot {
  const byStage = new Map(stats.by_stage.map((r) => [r.stage, r]));
  const rows = JOB_STAGES.map((s) => {
    const r = byStage.get(s.id);
    return {
      stage: s.id,
      label: s.label,
      color: s.color,
      jobs: r?.jobs ?? 0,
      valueCents: stats.can_see_money ? (r?.value_cents ?? 0) : null,
      share: null,
    };
  });
  const totalJobs = rows.reduce((n, r) => n + r.jobs, 0);
  const totalValueCents = stats.can_see_money
    ? rows.reduce((n, r) => n + (r.valueCents ?? 0), 0)
    : null;
  return {
    rows: rows.map((r) => ({ ...r, share: ratio(r.jobs, totalJobs) })),
    totalJobs,
    totalValueCents,
  };
}

export type PipelineHealthRow = {
  key: "open" | "in_progress" | "closed_won" | "closed_lost";
  label: string;
  jobs: number;
};

/** Pipeline Health: Open, In Progress (right now), Closed Won, Closed Lost (in the period). */
export function jobPipelineHealth(stats: JobStats): PipelineHealthRow[] {
  return [
    { key: "open", label: "Open", jobs: stats.open_jobs },
    { key: "in_progress", label: "In Progress", jobs: stats.in_progress },
    { key: "closed_won", label: "Closed Won", jobs: stats.closed_won },
    { key: "closed_lost", label: "Closed Lost", jobs: stats.closed_lost },
  ];
}

export type SoldDay = {
  /** Pacific calendar day, YYYY-MM-DD. */
  day: string;
  /** "Oct 3" */
  label: string;
  jobs: number;
  valueCents: number | null;
};

const MONTHS = [
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
] as const;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Daily sold value for the chart: one row per Pacific day from `fromDay` to
 * `toDay` (inclusive), zeros filled in. At most 400 days.
 */
export function jobSoldByDay(stats: JobStats, fromDay: string, toDay: string): SoldDay[] {
  if (!ISO_DAY.test(fromDay) || !ISO_DAY.test(toDay) || fromDay > toDay) return [];
  const byDay = new Map(stats.sold_by_day.map((r) => [r.day.slice(0, 10), r]));
  const out: SoldDay[] = [];
  let t = Date.parse(`${fromDay}T00:00:00Z`);
  const end = Date.parse(`${toDay}T00:00:00Z`);
  while (t <= end && out.length < 400) {
    const day = new Date(t).toISOString().slice(0, 10);
    const r = byDay.get(day);
    out.push({
      day,
      label: `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`,
      jobs: r?.jobs ?? 0,
      valueCents: stats.can_see_money ? (r?.value_cents ?? 0) : null,
    });
    t += 86_400_000;
  }
  return out;
}

// ---------------------------------------------------------------------------
// All metrics
// ---------------------------------------------------------------------------

/** Every registered metric, by id. Later phases spread their groups in here. */
export const METRICS = { ...LEAD_METRICS, ...JOB_METRICS, ...JOB_COUNT_METRICS } as const;
export type MetricId = keyof typeof METRICS;

/** A metric of any source (each definition keeps its own source type). */
export type AnyMetricDefinition = { [S in MetricSource]: MetricDefinition<S> }[MetricSource];

export function getMetric(id: MetricId): AnyMetricDefinition {
  return METRICS[id];
}
