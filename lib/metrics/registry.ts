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
import { formatBytes } from "@/lib/domain/photos";
import { BOARD_LANES, type BoardLane } from "@/lib/domain/onboarding/board";
import { ATTENTION_RULES, type AttentionRuleKey } from "@/lib/domain/attention/rules";
import type { Permission } from "@/lib/permissions";

/**
 * Metrics registry (SPEC §12.1, CLAUDE.md): every KPI is defined here once and
 * every card, chart and report reads it from here. Components never do metric
 * math of their own.
 *
 * A metric names the server-side aggregate it reads (`source`, an RPC that
 * counts in Postgres across every record the viewer can see), its unit, a
 * formula caption, and a pure `compute` over that RPC's parsed payload.
 * Each source (leads, estimates, jobs, money…) has its own group below.
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

/**
 * Job sources (JobStats, JobStatusCounts) are defined in the JOB section below;
 * AttentionSummary and ApprovalCounts in the ATTENTION section.
 */
export type MetricSources = {
  lead_stats: LeadStats;
  job_stats: JobStats;
  job_status_counts: JobStatusCounts;
  attention_summary: AttentionSummary;
  approval_counts: ApprovalCounts;
  estimate_stats: EstimateStats;
  document_stats: DocumentStats;
  onboarding_board: BoardStats;
  production_stats: ProductionStats;
  schedule_board: ScheduleBoardStats;
  finance_stats: FinanceStats;
  communication_stats: CommunicationStats;
  analytics_stats: AnalyticsStats;
  my_numbers: MyNumbers;
  workspace_summary: WorkspaceSummary;
  daily_brief: DailyBrief;
};
export type MetricSource = keyof MetricSources;

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

export type MetricUnit =
  "count" | "percent" | "duration" | "money" | "bytes" | "days" | "hours" | "number";

export type MetricDefinition<S extends MetricSource = MetricSource> = {
  id: string;
  label: string;
  description: string;
  /** Server-side aggregate (RPC) the metric reads. */
  source: S;
  /** "count": whole number; "percent": ratio 0–1; "duration": seconds; "money": cents; "bytes"; "days". */
  unit: MetricUnit;
  /** Formula caption shown under the number (SPEC §8 KPI cards). */
  caption: string;
  /** Only owners may see it (SPEC §12.1). */
  ownerOnly: boolean;
  compute: (data: MetricSources[S]) => number | null;
  /**
   * The date column the period filters on ("leads.created_at"); null for a
   * right-now or all-time figure. Defaults to the source's (SOURCE_INFO).
   */
  dateField?: string | null;
  /** Filters this metric supports besides the date range. Defaults to the source's. */
  filters?: readonly MetricFilter[];
  /** Permissions needed to see the number (cards show "—", Ask refuses). */
  requires?: readonly Permission[];
};

/** Filters a metric can take besides the date range (SPEC §12.1). */
export const METRIC_FILTERS = ["work_type", "city", "owner", "source"] as const;
export type MetricFilter = (typeof METRIC_FILTERS)[number];
export const METRIC_FILTER_LABELS: Record<MetricFilter, string> = {
  work_type: "Work type",
  city: "City",
  owner: "Owner",
  source: "Lead source",
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
    case "bytes":
      return formatBytes(value);
    case "days": {
      const d = Math.round(value);
      return `${d} day${d === 1 ? "" : "s"}`;
    }
    case "hours": {
      const h = Math.round(value * 10) / 10;
      return `${h.toLocaleString("en-US")} h`;
    }
    case "number":
      return (Math.round(value * 10) / 10).toLocaleString("en-US");
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
// every money value is null and shows as "—". Without an accepted estimate
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
// ATTENTION & APPROVALS (Phase 3): Attention Center, nav badge, Approvals (SPEC §8.9, §9)
// ---------------------------------------------------------------------------

/** `public.attention_summary()` jsonb: open items the viewer can see, counted in Postgres. */
export const attentionSummarySchema = z.object({
  open: count,
  /** Critical and high, pending, not snoozed — the nav badge. */
  now: count,
  overdue: count,
  awaiting_response: count,
  in_progress: count,
  snoozed: count,
  mine: count,
});
export type AttentionSummary = z.infer<typeof attentionSummarySchema>;

export const EMPTY_ATTENTION_SUMMARY: AttentionSummary = attentionSummarySchema.parse({});

export function parseAttentionSummary(raw: unknown): AttentionSummary {
  const parsed = attentionSummarySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_ATTENTION_SUMMARY;
}

/**
 * Approval request counts. Each is a server-side `count: "exact", head: true`
 * query on approval_requests (row security scopes it; "My requests" adds
 * requested_by = viewer). Decided counts cover the last 30 days.
 */
export const approvalCountsSchema = z.object({
  total: count,
  pending: count,
  approved_30d: count,
  rejected_30d: count,
  overrides_pending: count,
  discounts_pending: count,
});
export type ApprovalCounts = z.infer<typeof approvalCountsSchema>;

export const APPROVAL_DECIDED_WINDOW_DAYS = 30;

export function parseApprovalCounts(raw: unknown): ApprovalCounts {
  const parsed = approvalCountsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : approvalCountsSchema.parse({});
}

function countMetric<S extends "attention_summary" | "approval_counts">(
  source: S,
  def: Omit<MetricDefinition<S>, "source" | "ownerOnly" | "unit">,
): MetricDefinition<S> {
  return { ownerOnly: false, unit: "count", ...def, source };
}

export const ATTENTION_METRICS = {
  "attention.open": countMetric("attention_summary", {
    id: "attention.open",
    label: "Open Items",
    description: "Attention items you can see that aren't resolved.",
    caption: "Pending, in progress or snoozed",
    compute: (s) => s.open,
  }),
  "attention.now": countMetric("attention_summary", {
    id: "attention.now",
    label: "Needs Attention Now",
    description: "Critical and high items that are pending and not snoozed.",
    caption: "Critical and high items still pending",
    compute: (s) => s.now,
  }),
  "attention.overdue": countMetric("attention_summary", {
    id: "attention.overdue",
    label: "Overdue / At-Risk",
    description: "Open items whose due time has passed.",
    caption: "Open items past their due time",
    compute: (s) => s.overdue,
  }),
  "attention.awaiting_response": countMetric("attention_summary", {
    id: "attention.awaiting_response",
    label: "Awaiting Response",
    description: "Open communication items: customers waiting on us.",
    caption: "Open communication items (customers waiting on us)",
    compute: (s) => s.awaiting_response,
  }),
  "attention.in_progress": countMetric("attention_summary", {
    id: "attention.in_progress",
    label: "In Progress",
    description: "Open items someone has started.",
    caption: "Someone has started",
    compute: (s) => s.in_progress,
  }),
  "attention.snoozed": countMetric("attention_summary", {
    id: "attention.snoozed",
    label: "Snoozed",
    description: "Open items snoozed until later.",
    caption: "Snoozed until later",
    compute: (s) => s.snoozed,
  }),
} as const satisfies Record<string, MetricDefinition<"attention_summary">>;

export const APPROVAL_METRICS = {
  "approvals.total": countMetric("approval_counts", {
    id: "approvals.total",
    label: "Total",
    description: "Every approval request in this view, any status.",
    caption: "All requests",
    compute: (c) => c.total,
  }),
  "approvals.pending": countMetric("approval_counts", {
    id: "approvals.pending",
    label: "Pending",
    description: "Requests waiting for an owner's decision.",
    caption: "Waiting for an owner's decision",
    compute: (c) => c.pending,
  }),
  "approvals.approved_30d": countMetric("approval_counts", {
    id: "approvals.approved_30d",
    label: "Approved",
    description: `Requests approved in the last ${APPROVAL_DECIDED_WINDOW_DAYS} days.`,
    caption: `Approved in the last ${APPROVAL_DECIDED_WINDOW_DAYS} days`,
    compute: (c) => c.approved_30d,
  }),
  "approvals.rejected_30d": countMetric("approval_counts", {
    id: "approvals.rejected_30d",
    label: "Rejected",
    description: `Requests rejected in the last ${APPROVAL_DECIDED_WINDOW_DAYS} days.`,
    caption: `Rejected in the last ${APPROVAL_DECIDED_WINDOW_DAYS} days`,
    compute: (c) => c.rejected_30d,
  }),
  "approvals.overrides_pending": countMetric("approval_counts", {
    id: "approvals.overrides_pending",
    label: "Pending Stage Overrides",
    description: "Pending requests to override a stage gate.",
    caption: "Pending requests to move a job past a gate",
    compute: (c) => c.overrides_pending,
  }),
  "approvals.discounts_pending": countMetric("approval_counts", {
    id: "approvals.discounts_pending",
    label: "Pending Discounts",
    description:
      "Estimates over the sender's discount limit, waiting for approval before they can be sent.",
    caption: "Estimate discounts over the limit · blocks sending",
    compute: (c) => c.discounts_pending,
  }),
} as const satisfies Record<string, MetricDefinition<"approval_counts">>;

export type AttentionMetricId = keyof typeof ATTENTION_METRICS;
export type ApprovalMetricId = keyof typeof APPROVAL_METRICS;

export function attentionMetricValue(id: AttentionMetricId, s: AttentionSummary): number {
  const m: MetricDefinition<"attention_summary"> = ATTENTION_METRICS[id];
  return m.compute(s) ?? 0;
}

export function approvalMetricValue(id: ApprovalMetricId, c: ApprovalCounts): number {
  const m: MetricDefinition<"approval_counts"> = APPROVAL_METRICS[id];
  return m.compute(c) ?? 0;
}

// ---------------------------------------------------------------------------
// All metrics
// ---------------------------------------------------------------------------

/** Every registered metric, by id. */
// ===========================================================================
// ESTIMATES (Phase 4): sent, 24h SLA, close rate, job value (SPEC §1.3, §12.1)
// ===========================================================================
//
// Source: `public.estimate_stats(p_from, p_to)`
// (supabase/migrations/20261027000100_estimating.sql), run with the viewer's
// row security (estimates:read). Cohorts use the first time an estimate was
// sent; an estimate's value is its accepted total once accepted, else the
// recommended option's total when last sent.

export const estimateStatsSchema = z.object({
  sent: count,
  sent_value_cents: count,
  sla_hours: z.number().int().positive().catch(24),
  sla_measured: count,
  sla_met: count,
  cohort_accepted: count,
  cohort_accepted_value_cents: count,
  accepted: count,
  accepted_value_cents: count,
  open: count,
  open_value_cents: count,
  expiring_soon: count,
  by_status: z.record(z.string(), count).catch({}),
});
export type EstimateStats = z.infer<typeof estimateStatsSchema>;
export const EMPTY_ESTIMATE_STATS: EstimateStats = estimateStatsSchema.parse({});

export function parseEstimateStats(raw: unknown): EstimateStats {
  const parsed = estimateStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_ESTIMATE_STATS;
}

function estimateMetric(
  def: Omit<MetricDefinition<"estimate_stats">, "source" | "ownerOnly"> & { ownerOnly?: boolean },
): MetricDefinition<"estimate_stats"> {
  return { ownerOnly: false, ...def, source: "estimate_stats" };
}

export const ESTIMATE_METRICS = {
  "estimates.sent": estimateMetric({
    id: "estimates.sent",
    label: "Estimates Sent",
    description: "Estimates sent to the customer for the first time in the period.",
    unit: "count",
    caption: "First sent {period}",
    compute: (s) => s.sent,
  }),
  "estimates.sla_24h": estimateMetric({
    id: "estimates.sla_24h",
    label: "24h Estimate SLA",
    description:
      "Share of estimates sent within the estimate SLA (Company Settings, default 24 h) after the walkthrough was completed.",
    unit: "percent",
    caption: "Sent within the SLA after the walkthrough ÷ estimates with a completed walkthrough",
    compute: (s) => ratio(s.sla_met, s.sla_measured),
  }),
  "estimates.close_rate": estimateMetric({
    id: "estimates.close_rate",
    label: "Close Rate",
    description: "Accepted ÷ sent, same cohort (estimates first sent in the period).",
    unit: "percent",
    caption: "Accepted ÷ sent · estimates first sent {period}",
    compute: (s) => ratio(s.cohort_accepted, s.sent),
  }),
  "estimates.close_rate_value": estimateMetric({
    id: "estimates.close_rate_value",
    label: "Close Rate ($)",
    description: "Accepted value ÷ sent value, same cohort.",
    unit: "percent",
    caption: "Accepted $ ÷ sent $ · estimates first sent {period}",
    compute: (s) => ratio(s.cohort_accepted_value_cents, s.sent_value_cents),
  }),
  "estimates.avg_job_value": estimateMetric({
    id: "estimates.avg_job_value",
    label: "Avg Job Value",
    description: "Accepted value ÷ estimates accepted in the period.",
    unit: "money",
    caption: "Accepted value ÷ estimates accepted {period}",
    compute: (s) => (s.accepted === 0 ? null : Math.round(s.accepted_value_cents / s.accepted)),
  }),
  "estimates.open_value": estimateMetric({
    id: "estimates.open_value",
    label: "Open Estimates",
    description: "Value of estimates sent and waiting on the customer, right now.",
    unit: "money",
    caption: "Sent or viewed, not yet answered · right now",
    compute: (s) => s.open_value_cents,
  }),
} as const satisfies Record<string, MetricDefinition<"estimate_stats">>;
export type EstimateMetricId = keyof typeof ESTIMATE_METRICS;

/** One estimate metric with its caption (`{period}` filled in). */
export function estimateMetricValue(
  id: EstimateMetricId,
  stats: EstimateStats,
  period = "in the period",
): { id: EstimateMetricId; label: string; caption: string; value: number | null; display: string } {
  const m: MetricDefinition<"estimate_stats"> = ESTIMATE_METRICS[id];
  const raw = m.compute(stats);
  const value = raw === null || !Number.isFinite(raw) ? null : raw;
  return {
    id,
    label: m.label,
    caption: m.caption.replaceAll("{period}", period),
    value,
    display: formatMetricValue(m.unit, value),
  };
}

// ===========================================================================
// DOCUMENTS (Phase 5): SPEC §8.13, §8.5 #7
// ===========================================================================
//
// Source: `public.document_stats(p_job)` (supabase/migrations/
// 20261027000300_onboarding_documents_photos.sql), run with the viewer's row
// security, so money documents only count for people who may see them.

export const documentStatsSchema = z.object({
  total: count,
  awaiting_signature: count,
  linked_to_jobs: count,
  storage_bytes: z.number().nonnegative().catch(0),
  recent: count,
  needs_action: count,
  by_category: z.record(z.string(), count).catch({}),
});
export type DocumentStats = z.infer<typeof documentStatsSchema>;
export const EMPTY_DOCUMENT_STATS: DocumentStats = documentStatsSchema.parse({});

export function parseDocumentStats(raw: unknown): DocumentStats {
  const parsed = documentStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_DOCUMENT_STATS;
}

function documentMetric(
  def: Omit<MetricDefinition<"document_stats">, "source" | "ownerOnly">,
): MetricDefinition<"document_stats"> {
  return { ownerOnly: false, ...def, source: "document_stats" };
}

export const DOCUMENT_METRICS = {
  "documents.total": documentMetric({
    id: "documents.total",
    label: "Total documents",
    description: "Documents you can see (deleted ones left out).",
    unit: "count",
    caption: "Uploaded and generated · all time",
    compute: (s) => s.total,
  }),
  "documents.awaiting_signature": documentMetric({
    id: "documents.awaiting_signature",
    label: "Awaiting signature",
    description: "Documents marked as waiting for someone to sign.",
    unit: "count",
    caption: "Marked “awaiting signature”",
    compute: (s) => s.awaiting_signature,
  }),
  "documents.needs_action": documentMetric({
    id: "documents.needs_action",
    label: "Needs action",
    description:
      "Open onboarding items that need a document: signed contract, HOA approval, lead-safe acknowledgment.",
    unit: "count",
    caption: "Contract, HOA or lead-safe paperwork still missing",
    compute: (s) => s.needs_action,
  }),
  "documents.linked_to_jobs": documentMetric({
    id: "documents.linked_to_jobs",
    label: "Linked to jobs",
    description: "Documents that belong to a job (the rest are on a customer only).",
    unit: "count",
    caption: "On a job · the rest are on a customer",
    compute: (s) => s.linked_to_jobs,
  }),
  "documents.recent": documentMetric({
    id: "documents.recent",
    label: "Recently added",
    description: "Documents added in the last 7 days.",
    unit: "count",
    caption: "Added in the last 7 days",
    compute: (s) => s.recent,
  }),
  "documents.storage_used": documentMetric({
    id: "documents.storage_used",
    label: "Storage used",
    description: "Total size of those documents' files.",
    unit: "bytes",
    caption: "Sum of file sizes",
    compute: (s) => s.storage_bytes,
  }),
} as const satisfies Record<string, MetricDefinition<"document_stats">>;
export type DocumentMetricId = keyof typeof DOCUMENT_METRICS;

/** One document metric, formatted. */
export function documentMetricValue(id: DocumentMetricId, stats: DocumentStats): MetricValue {
  const m: MetricDefinition<"document_stats"> = DOCUMENT_METRICS[id];
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

// ===========================================================================
// ONBOARDING BOARD (Phase 5): SPEC §8.7
// ===========================================================================
//
// Source: the board summary built on the server from every job on the board
// (stages Sold → Paid in Full, not a paginated list): lanes come from
// lib/domain/onboarding/board.ts `placeCards()` + `summarizeBoard()`, loaded by
// lib/onboarding/board.ts with the viewer's row security.

const laneSchema = z.object({
  lane: z.enum(BOARD_LANES),
  count,
  valueCents: z.number().int().nullable().catch(null),
  avgDays: z.number().nonnegative().nullable().catch(null),
  overdue: count,
});

export const boardStatsSchema = z.object({
  canSeeMoney: z.boolean().catch(false),
  lanes: z.array(laneSchema).catch([]),
  activeJobs: count,
  activeValueCents: z.number().int().nullable().catch(null),
  depositHeldCents: z.number().int().nullable().catch(null),
  outstandingCents: z.number().int().nullable().catch(null),
});
export type BoardStats = z.infer<typeof boardStatsSchema>;
export const EMPTY_BOARD_STATS: BoardStats = boardStatsSchema.parse({});

export function parseBoardStats(raw: unknown): BoardStats {
  const parsed = boardStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_BOARD_STATS;
}

function lane(s: BoardStats, id: BoardLane) {
  return (
    s.lanes.find((l) => l.lane === id) ?? {
      lane: id,
      count: 0,
      valueCents: null,
      avgDays: null,
      overdue: 0,
    }
  );
}

function boardMetric(
  def: Omit<MetricDefinition<"onboarding_board">, "source" | "ownerOnly"> & { ownerOnly?: boolean },
): MetricDefinition<"onboarding_board"> {
  return { ownerOnly: false, ...def, source: "onboarding_board" };
}

export const BOARD_METRICS = {
  "board.active_jobs": boardMetric({
    id: "board.active_jobs",
    label: "Active jobs",
    description: "Sold jobs not yet paid in full.",
    unit: "count",
    caption: "Sold → Invoicing · right now",
    compute: (s) => s.activeJobs,
  }),
  "board.active_value": boardMetric({
    id: "board.active_value",
    label: "Active pipeline",
    description: "Contract value of the active jobs.",
    unit: "money",
    caption: "Contract value of active jobs",
    compute: (s) => s.activeValueCents,
  }),
  "board.deposit_hold": boardMetric({
    id: "board.deposit_hold",
    label: "Deposit Hold",
    description: "Jobs waiting for their deposit.",
    unit: "count",
    caption: "Waiting for the deposit",
    compute: (s) => lane(s, "deposit_hold").count,
  }),
  "board.deposit_held": boardMetric({
    id: "board.deposit_held",
    label: "Deposits held",
    description: "Total of the deposit invoices for jobs on Deposit Hold.",
    unit: "money",
    caption: "Deposit invoices not yet paid",
    compute: (s) => s.depositHeldCents,
  }),
  "board.needs_onboarding": boardMetric({
    id: "board.needs_onboarding",
    label: "Needs Onboarding",
    description: "Jobs working through the onboarding checklist.",
    unit: "count",
    caption: "Checklist in progress",
    compute: (s) => lane(s, "needs_onboarding").count,
  }),
  "board.needs_onboarding_age": boardMetric({
    id: "board.needs_onboarding_age",
    label: "Avg age, Needs Onboarding",
    description: "Average days those jobs have spent in the lane.",
    unit: "days",
    caption: "Average days in the lane",
    compute: (s) => lane(s, "needs_onboarding").avgDays,
  }),
  "board.on_hold": boardMetric({
    id: "board.on_hold",
    label: "On Hold / Expediting",
    description: "Jobs held up by an HOA, lead-safe, color, customer or other hold.",
    unit: "count",
    caption: "A hold blocks scheduling",
    compute: (s) => lane(s, "on_hold").count,
  }),
  "board.on_hold_age": boardMetric({
    id: "board.on_hold_age",
    label: "Avg age, On Hold",
    description: "Average days since the hold was placed.",
    unit: "days",
    caption: "Average days on hold",
    compute: (s) => lane(s, "on_hold").avgDays,
  }),
  "board.ready": boardMetric({
    id: "board.ready",
    label: "Ready to Schedule",
    description: "Jobs with onboarding cleared, waiting for dates.",
    unit: "count",
    caption: "Onboarding cleared, no holds",
    compute: (s) => lane(s, "ready").count,
  }),
  "board.ready_value": boardMetric({
    id: "board.ready_value",
    label: "Ready to Schedule ($)",
    description: "Contract value of jobs ready to schedule.",
    unit: "money",
    caption: "Contract value ready for dates",
    compute: (s) => lane(s, "ready").valueCents,
  }),
  "board.in_production": boardMetric({
    id: "board.in_production",
    label: "Scheduled / In Progress",
    description: "Jobs scheduled, in progress or at the final walkthrough.",
    unit: "count",
    caption: "On the schedule or being painted",
    compute: (s) => lane(s, "in_production").count,
  }),
  "board.invoicing": boardMetric({
    id: "board.invoicing",
    label: "Invoicing / Collections",
    description: "Completed or invoiced jobs not yet paid in full.",
    unit: "count",
    caption: "Completed or invoiced",
    compute: (s) => lane(s, "invoicing").count,
  }),
  "board.outstanding": boardMetric({
    id: "board.outstanding",
    label: "Outstanding",
    description: "Contract minus collected on those jobs (from the job ledger).",
    unit: "money",
    caption: "Contract − collected",
    compute: (s) => s.outstandingCents,
  }),
  "board.paid_month": boardMetric({
    id: "board.paid_month",
    label: "Paid in Full",
    description: "Jobs paid in full this month (Pacific).",
    unit: "count",
    caption: "Paid in full this month",
    compute: (s) => lane(s, "paid").count,
  }),
} as const satisfies Record<string, MetricDefinition<"onboarding_board">>;
export type BoardMetricId = keyof typeof BOARD_METRICS;

export function boardMetricValue(id: BoardMetricId, stats: BoardStats): MetricValue {
  const m: MetricDefinition<"onboarding_board"> = BOARD_METRICS[id];
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

// ===========================================================================
// PRODUCTION (Phase 6): SPEC §8.6 Command Center, §1.3 promises, §12.1
// ===========================================================================
//
// Source: `public.production_stats()` (supabase/migrations/
// 20261027000400_production.sql), run with the viewer's row security; money is
// null without financials:read. `schedule_board` is the Master Schedule's
// summary built on the server by lib/production/board.ts from every bar in the
// window and the conflict checks (lib/domain/scheduling/conflicts.ts).

const num = z.number().nonnegative().catch(0);

export const productionStatsSchema = z.object({
  ready_to_schedule: count,
  scheduled: count,
  in_progress: count,
  final_walkthrough: count,
  unscheduled: count,
  priority_reschedule: count,
  at_risk: count,
  completed_this_week: count,
  starts_this_week: count,
  crews_active: count,
  scheduled_revenue_next_30_cents: z.number().int().nullable().catch(null),
  daily_update_due: count,
  daily_update_logged: count,
  on_time_met: count,
  on_time_missed: count,
  on_time_weather: count,
  rain_delay_days: count,
  completed_jobs_90: count,
  punch_items_90: count,
  labor_budgeted_hours_90: num,
  labor_actual_hours_90: num,
  backlog_hours: num,
  crew_day_hours: z.number().positive().catch(8),
  can_see_money: z.boolean().catch(false),
});
export type ProductionStats = z.infer<typeof productionStatsSchema>;
export const EMPTY_PRODUCTION_STATS: ProductionStats = productionStatsSchema.parse({});

export function parseProductionStats(raw: unknown): ProductionStats {
  const parsed = productionStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_PRODUCTION_STATS;
}

export const scheduleBoardSchema = z.object({
  bars: count,
  drafts: count,
  conflicts: count,
  blocked: count,
  crews: count,
  tray: count,
});
export type ScheduleBoardStats = z.infer<typeof scheduleBoardSchema>;
export const EMPTY_SCHEDULE_BOARD: ScheduleBoardStats = scheduleBoardSchema.parse({});

function productionMetric(
  def: Omit<MetricDefinition<"production_stats">, "source" | "ownerOnly"> & { ownerOnly?: boolean },
): MetricDefinition<"production_stats"> {
  return { ownerOnly: false, ...def, source: "production_stats" };
}

function boardKpi(
  def: Omit<MetricDefinition<"schedule_board">, "source" | "ownerOnly">,
): MetricDefinition<"schedule_board"> {
  return { ownerOnly: false, ...def, source: "schedule_board" };
}

export const PRODUCTION_METRICS = {
  "production.ready": productionMetric({
    id: "production.ready",
    label: "Ready to Schedule",
    description: "Jobs with onboarding cleared, waiting for dates.",
    unit: "count",
    caption: "Onboarding cleared · right now",
    compute: (s) => s.ready_to_schedule,
  }),
  "production.unscheduled": productionMetric({
    id: "production.unscheduled",
    label: "Unscheduled",
    description: "Ready to Schedule jobs with nothing on the schedule yet (not even a draft).",
    unit: "count",
    caption: "Ready, no dates drafted",
    compute: (s) => s.unscheduled,
  }),
  "production.scheduled": productionMetric({
    id: "production.scheduled",
    label: "Scheduled",
    description: "Jobs with published dates that haven't started.",
    unit: "count",
    caption: "Dates published, not started",
    compute: (s) => s.scheduled,
  }),
  "production.in_progress": productionMetric({
    id: "production.in_progress",
    label: "In Progress",
    description: "Jobs being painted right now.",
    unit: "count",
    caption: "Started, work orders open",
    compute: (s) => s.in_progress,
  }),
  "production.at_risk": productionMetric({
    id: "production.at_risk",
    label: "At Risk",
    description:
      "Scheduled jobs starting within 7 days with no crew, a blocking hold, paint not ready, or a start date already passed.",
    unit: "count",
    caption: "Starts ≤ 7 days with a problem",
    compute: (s) => s.at_risk,
  }),
  "production.priority_reschedule": productionMetric({
    id: "production.priority_reschedule",
    label: "Rain reschedules",
    description: "Jobs with a rain delay waiting for new dates (first in line).",
    unit: "count",
    caption: "Priority reschedule (rain)",
    compute: (s) => s.priority_reschedule,
  }),
  "production.completed_week": productionMetric({
    id: "production.completed_week",
    label: "Completed this week",
    description: "Jobs that reached Completed this week (Pacific, Monday start).",
    unit: "count",
    caption: "Completed since Monday",
    compute: (s) => s.completed_this_week,
  }),
  "production.starts_this_week": productionMetric({
    id: "production.starts_this_week",
    label: "Starts next 7 days",
    description: "Scheduled jobs whose first production day is in the next 7 days.",
    unit: "count",
    caption: "First day within 7 days",
    compute: (s) => s.starts_this_week,
  }),
  "production.scheduled_revenue_30": productionMetric({
    id: "production.scheduled_revenue_30",
    label: "Scheduled revenue (30 days)",
    description: "Contract value of jobs whose first published day is in the next 30 days.",
    unit: "money",
    caption: "Contract value starting in 30 days",
    compute: (s) => (s.can_see_money ? s.scheduled_revenue_next_30_cents : null),
  }),
  "production.daily_update_compliance": productionMetric({
    id: "production.daily_update_compliance",
    label: "Daily update compliance",
    description:
      "Production days with a daily log ÷ production days due (last 30 days; a day is due after 7:00 pm Pacific; rain days don't count).",
    unit: "percent",
    caption: "Logged ÷ due · last 30 days",
    compute: (s) => ratio(s.daily_update_logged, s.daily_update_due),
  }),
  "production.on_time_start": productionMetric({
    id: "production.on_time_start",
    label: "On-time start",
    description:
      "Jobs that started on or before their promised date ÷ jobs that started (last 90 days). Rain delays don't count against it.",
    unit: "percent",
    caption: "Started on time · last 90 days, weather excluded",
    compute: (s) => ratio(s.on_time_met, s.on_time_met + s.on_time_missed),
  }),
  "production.rain_delay_days": productionMetric({
    id: "production.rain_delay_days",
    label: "Rain-delay days",
    description: "Job days marked as rain delays in the last 90 days.",
    unit: "count",
    caption: "Marked rain days · last 90 days",
    compute: (s) => s.rain_delay_days,
  }),
  "production.punch_per_job": productionMetric({
    id: "production.punch_per_job",
    label: "Punch items per job",
    description: "Punch items ÷ jobs completed in the last 90 days.",
    unit: "number",
    caption: "Average · jobs completed in 90 days",
    compute: (s) => (s.completed_jobs_90 > 0 ? s.punch_items_90 / s.completed_jobs_90 : null),
  }),
  "production.labor_estimated": productionMetric({
    id: "production.labor_estimated",
    label: "Labor hours estimated",
    description: "Budgeted work-order hours on jobs completed in the last 90 days.",
    unit: "hours",
    caption: "Budgeted · jobs completed in 90 days",
    compute: (s) => s.labor_budgeted_hours_90,
  }),
  "production.labor_actual": productionMetric({
    id: "production.labor_actual",
    label: "Labor hours actual",
    description:
      "Hours logged (daily logs and time entries) on jobs completed in the last 90 days.",
    unit: "hours",
    caption: "Logged · jobs completed in 90 days",
    compute: (s) => s.labor_actual_hours_90,
  }),
  "production.labor_variance": productionMetric({
    id: "production.labor_variance",
    label: "Actual vs estimated hours",
    description: "Hours logged ÷ hours budgeted, as a percentage (over 100% means over budget).",
    unit: "number",
    caption: "Actual ÷ estimated × 100 · 90 days",
    compute: (s) =>
      s.labor_budgeted_hours_90 > 0
        ? Math.round((s.labor_actual_hours_90 / s.labor_budgeted_hours_90) * 100)
        : null,
  }),
  "production.backlog_crew_days": productionMetric({
    id: "production.backlog_crew_days",
    label: "Backlog",
    description:
      "Open work-order hours on Ready, Scheduled and In Progress jobs ÷ the crew-day hours in Schedule Admin.",
    unit: "days",
    caption: "Crew-days of work not yet done",
    compute: (s) => s.backlog_hours / s.crew_day_hours,
  }),
  "production.crews": productionMetric({
    id: "production.crews",
    label: "Crews",
    description: "Active crews.",
    unit: "count",
    caption: "Active crews",
    compute: (s) => s.crews_active,
  }),
} as const satisfies Record<string, MetricDefinition<"production_stats">>;
export type ProductionMetricId = keyof typeof PRODUCTION_METRICS;

export const SCHEDULE_BOARD_METRICS = {
  "schedule.conflicts": boardKpi({
    id: "schedule.conflicts",
    label: "Conflicts",
    description: "Bars in this window with a work-rule conflict (blocking or warning).",
    unit: "count",
    caption: "Work-rule conflicts in view",
    compute: (s) => s.conflicts,
  }),
  "schedule.drafts": boardKpi({
    id: "schedule.drafts",
    label: "Draft changes",
    description: "Changes not yet published to customers and crews.",
    unit: "count",
    caption: "Waiting for “Publish changes”",
    compute: (s) => s.drafts,
  }),
  "schedule.tray": boardKpi({
    id: "schedule.tray",
    label: "To be scheduled",
    description:
      "Jobs in the tray (Ready to Schedule with nothing on the schedule, rain reschedules first).",
    unit: "count",
    caption: "In the tray",
    compute: (s) => s.tray,
  }),
} as const satisfies Record<string, MetricDefinition<"schedule_board">>;
export type ScheduleBoardMetricId = keyof typeof SCHEDULE_BOARD_METRICS;

export function productionMetricValue(id: ProductionMetricId, stats: ProductionStats): MetricValue {
  const m: MetricDefinition<"production_stats"> = PRODUCTION_METRICS[id];
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

export function scheduleBoardMetricValue(
  id: ScheduleBoardMetricId,
  stats: ScheduleBoardStats,
): MetricValue {
  const m: MetricDefinition<"schedule_board"> = SCHEDULE_BOARD_METRICS[id];
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

// ===========================================================================
// MONEY (Phase 7): SPEC §10, §12.1
// ===========================================================================
//
// Source: `public.finance_stats(p_from, p_to)` (supabase/migrations/
// 20261028000100_money.sql), run with the viewer's row security over the
// ledger views (public.invoice_ledger, public.job_ledger). Period figures use
// Pacific dates; A/R and aging are "right now". Everything is null/zero
// without financials:read; margin only with job_costing:read.

const centsInt = z.number().int().catch(0);
const agingSchema = z
  .object({
    current: centsInt,
    d1_30: centsInt,
    d31_60: centsInt,
    d61_90: centsInt,
    d90_plus: centsInt,
  })
  .catch({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
const agingCountSchema = z
  .object({ current: count, d1_30: count, d31_60: count, d61_90: count, d90_plus: count })
  .catch({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });

export const financeStatsSchema = z.object({
  can_see_money: z.boolean().catch(false),
  can_see_costs: z.boolean().catch(false),
  ar_outstanding_cents: centsInt,
  ar_open_invoices: count,
  overdue_cents: centsInt,
  overdue_invoices: count,
  aging: agingSchema,
  aging_counts: agingCountSchema,
  collected_cents: centsInt,
  refunded_cents: centsInt,
  billed_cents: centsInt,
  billed_collected_cents: centsInt,
  unapplied_cents: centsInt,
  sold_cents: centsInt,
  sold_jobs: count,
  completed_cents: centsInt,
  completed_jobs: count,
  margin_revenue_cents: z.number().int().nullable().catch(null),
  margin_cost_cents: z.number().int().nullable().catch(null),
  paid_jobs: count,
  days_completed_to_paid_avg: z.number().nonnegative().nullable().catch(null),
  pending_credit_cents: centsInt,
  invoices: z
    .object({ all: count, draft: count, open: count, overdue: count, paid: count, void: count })
    .catch({ all: 0, draft: 0, open: 0, overdue: 0, paid: 0, void: 0 }),
});
export type FinanceStats = z.infer<typeof financeStatsSchema>;
export const EMPTY_FINANCE_STATS: FinanceStats = financeStatsSchema.parse({});

export function parseFinanceStats(raw: unknown): FinanceStats {
  const parsed = financeStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_FINANCE_STATS;
}

function financeMetric(
  def: Omit<MetricDefinition<"finance_stats">, "source" | "ownerOnly"> & { ownerOnly?: boolean },
): MetricDefinition<"finance_stats"> {
  return { ownerOnly: false, ...def, source: "finance_stats" };
}

const money = (s: FinanceStats, v: number) => (s.can_see_money ? v : null);

export const FINANCE_METRICS = {
  "finance.ar_outstanding": financeMetric({
    id: "finance.ar_outstanding",
    label: "A/R Outstanding",
    description: "What customers owe on sent invoices (credit memos net against it).",
    unit: "money",
    caption: "Sent invoices, balance owed · right now",
    compute: (s) => money(s, s.ar_outstanding_cents),
  }),
  "finance.overdue": financeMetric({
    id: "finance.overdue",
    label: "Overdue",
    description: "Balance owed on sent invoices past their due date.",
    unit: "money",
    caption: "Past due · right now",
    compute: (s) => money(s, s.overdue_cents),
  }),
  "finance.overdue_invoices": financeMetric({
    id: "finance.overdue_invoices",
    label: "Overdue invoices",
    description: "Sent invoices past their due date with money owed.",
    unit: "count",
    caption: "Past due · right now",
    compute: (s) => (s.can_see_money ? s.overdue_invoices : null),
  }),
  "finance.collected": financeMetric({
    id: "finance.collected",
    label: "Collected",
    description:
      "Payments received in the period and applied to invoices (bounced, void, refunded and unapplied money never counts).",
    unit: "money",
    caption: "Applied payments received · in the period",
    compute: (s) => money(s, s.collected_cents),
  }),
  "finance.billed": financeMetric({
    id: "finance.billed",
    label: "Billed",
    description: "Invoices sent in the period (by issue date).",
    unit: "money",
    caption: "Invoices issued · in the period",
    compute: (s) => money(s, s.billed_cents),
  }),
  "finance.collection_rate": financeMetric({
    id: "finance.collection_rate",
    label: "Collection %",
    description: "Of the invoices issued in the period, the share already paid.",
    unit: "percent",
    caption: "Collected ÷ billed · invoices issued in the period",
    compute: (s) => (s.can_see_money ? ratio(s.billed_collected_cents, s.billed_cents) : null),
  }),
  "finance.revenue_sold": financeMetric({
    id: "finance.revenue_sold",
    label: "Revenue sold",
    description: "Contract value (net of credits) of jobs sold in the period.",
    unit: "money",
    caption: "Contracts accepted · in the period",
    compute: (s) => money(s, s.sold_cents),
  }),
  "finance.revenue_completed": financeMetric({
    id: "finance.revenue_completed",
    label: "Revenue completed",
    description: "Contract value (net of credits) of jobs completed in the period.",
    unit: "money",
    caption: "Jobs completed · in the period",
    compute: (s) => money(s, s.completed_cents),
  }),
  "finance.gross_margin_completed": financeMetric({
    id: "finance.gross_margin_completed",
    label: "Gross Margin % (completed)",
    description:
      "Of jobs completed in the period: (contract − labor − materials − subcontractors − expenses) ÷ contract.",
    unit: "percent",
    caption: "Gross profit ÷ revenue · jobs completed in the period",
    ownerOnly: true,
    compute: (s) =>
      s.can_see_costs && s.margin_revenue_cents !== null && s.margin_revenue_cents > 0
        ? (s.margin_revenue_cents - (s.margin_cost_cents ?? 0)) / s.margin_revenue_cents
        : null,
  }),
  "finance.days_completed_to_paid": financeMetric({
    id: "finance.days_completed_to_paid",
    label: "Days completed → paid",
    description: "Average days from Completed to Paid in Full, for jobs paid in the period.",
    unit: "days",
    caption: "Average · jobs paid in full in the period",
    compute: (s) => (s.can_see_money ? s.days_completed_to_paid_avg : null),
  }),
  "finance.unapplied": financeMetric({
    id: "finance.unapplied",
    label: "Unapplied cash",
    description: "Payment money not applied to any invoice. It doesn't count as collected.",
    unit: "money",
    caption: "Recorded, not on an invoice · right now",
    compute: (s) => money(s, s.unapplied_cents),
  }),
  "finance.aging_current": financeMetric({
    id: "finance.aging_current",
    label: "Current",
    description: "Owed on sent invoices that aren't past due.",
    unit: "money",
    caption: "Not past due",
    compute: (s) => money(s, s.aging.current),
  }),
  "finance.aging_1_30": financeMetric({
    id: "finance.aging_1_30",
    label: "1–30 days",
    description: "Owed on invoices 1–30 days past due.",
    unit: "money",
    caption: "1–30 days past due",
    compute: (s) => money(s, s.aging.d1_30),
  }),
  "finance.aging_31_60": financeMetric({
    id: "finance.aging_31_60",
    label: "31–60 days",
    description: "Owed on invoices 31–60 days past due.",
    unit: "money",
    caption: "31–60 days past due",
    compute: (s) => money(s, s.aging.d31_60),
  }),
  "finance.aging_61_90": financeMetric({
    id: "finance.aging_61_90",
    label: "61–90 days",
    description: "Owed on invoices 61–90 days past due.",
    unit: "money",
    caption: "61–90 days past due",
    compute: (s) => money(s, s.aging.d61_90),
  }),
  "finance.aging_90_plus": financeMetric({
    id: "finance.aging_90_plus",
    label: "90+ days",
    description: "Owed on invoices more than 90 days past due.",
    unit: "money",
    caption: "Over 90 days past due",
    compute: (s) => money(s, s.aging.d90_plus),
  }),
  "finance.invoices_open": financeMetric({
    id: "finance.invoices_open",
    label: "Open invoices",
    description: "Sent invoices with money still owed.",
    unit: "count",
    caption: "Sent, not paid · right now",
    compute: (s) => s.invoices.open,
  }),
  "finance.invoices_draft": financeMetric({
    id: "finance.invoices_draft",
    label: "Drafts",
    description: "Invoices not sent yet.",
    unit: "count",
    caption: "Not sent yet",
    compute: (s) => s.invoices.draft,
  }),
  "finance.pending_credits": financeMetric({
    id: "finance.pending_credits",
    label: "Credits waiting",
    description: "Credits waiting for an owner's approval.",
    unit: "money",
    caption: "Waiting for approval",
    compute: (s) => money(s, s.pending_credit_cents),
  }),
} as const satisfies Record<string, MetricDefinition<"finance_stats">>;
export type FinanceMetricId = keyof typeof FINANCE_METRICS;

export function financeMetricValue(id: FinanceMetricId, stats: FinanceStats): MetricValue {
  const m: MetricDefinition<"finance_stats"> = FINANCE_METRICS[id];
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

/** Aging buckets in order, for the A/R aging report and its "View data" table. */
export const AGING_METRIC_IDS = [
  "finance.aging_current",
  "finance.aging_1_30",
  "finance.aging_31_60",
  "finance.aging_61_90",
  "finance.aging_90_plus",
] as const satisfies readonly FinanceMetricId[];

export function agingCount(stats: FinanceStats, id: (typeof AGING_METRIC_IDS)[number]): number {
  const key = {
    "finance.aging_current": "current",
    "finance.aging_1_30": "d1_30",
    "finance.aging_31_60": "d31_60",
    "finance.aging_61_90": "d61_90",
    "finance.aging_90_plus": "d90_plus",
  } as const;
  return stats.aging_counts[key[id]];
}

// ===========================================================================
// COMMUNICATION & GROWTH (Phase 8): SPEC §8.11, §8.16, §11, §12.1
// ===========================================================================
//
// Source: `public.communication_stats(p_from, p_to)` (supabase/migrations/
// 20261029000100_communication.sql), run with the viewer's row security.
// Period figures default to the last 90 days; queues and open counts are
// "right now". Everything is simulated while providers are disconnected, so
// "sent" means recorded in the outbox and delivery is assumed for every send
// that didn't fail.

export const communicationStatsSchema = z.object({
  threads_unread: count,
  threads_total: count,
  cases_open: count,
  cases_overdue: count,
  cases_warranty_open: count,
  cases_resolved_period: count,
  cases_resolved_on_time_period: count,
  campaigns_total: count,
  campaigns_active: count,
  campaign_sends: count,
  campaign_failed: count,
  campaign_replies: count,
  campaign_conversions: count,
  campaign_queue: count,
  unsubscribes: count,
  sms_opt_outs: count,
  drip_active: count,
  reviews_requested: count,
  reviews_clicked: count,
  reviews_left: count,
  reviews_rating_sum: count,
  reviews_rated: count,
  champions_active: count,
  referrals_total: count,
  referrals_all: count,
  referrals_sold: count,
  referrals_payable_cents: z.number().int().nonnegative().catch(0),
  referrals_paid_cents: z.number().int().nonnegative().catch(0),
  workflow_runs_period: count,
  workflow_failed_period: count,
  workflow_waiting: count,
});
export type CommunicationStats = z.infer<typeof communicationStatsSchema>;
export const EMPTY_COMMUNICATION_STATS: CommunicationStats = communicationStatsSchema.parse({});

export function parseCommunicationStats(raw: unknown): CommunicationStats {
  const parsed = communicationStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_COMMUNICATION_STATS;
}

function communicationMetric(
  def: Omit<MetricDefinition<"communication_stats">, "source" | "ownerOnly">,
): MetricDefinition<"communication_stats"> {
  return { ownerOnly: false, ...def, source: "communication_stats" };
}

export const COMMUNICATION_METRICS = {
  "messages.unread": communicationMetric({
    id: "messages.unread",
    label: "Unread conversations",
    description: "Customer conversations with a text or email nobody has read yet.",
    unit: "count",
    caption: "Inbound after the last read · right now",
    compute: (s) => s.threads_unread,
  }),
  "messages.threads": communicationMetric({
    id: "messages.threads",
    label: "Conversations",
    description: "Lead and job conversations you can see.",
    unit: "count",
    caption: "All conversations · right now",
    compute: (s) => s.threads_total,
  }),
  "cases.open": communicationMetric({
    id: "cases.open",
    label: "Open cases",
    description: "Warranty and service cases not resolved or closed.",
    unit: "count",
    caption: "Not resolved · right now",
    compute: (s) => s.cases_open,
  }),
  "cases.overdue": communicationMetric({
    id: "cases.overdue",
    label: "Past SLA",
    description: "Open cases past their SLA due time (2 business days by default).",
    unit: "count",
    caption: "Open and past SLA · right now",
    compute: (s) => s.cases_overdue,
  }),
  "cases.warranty_open": communicationMetric({
    id: "cases.warranty_open",
    label: "Open Warranty/Service",
    description: "Open warranty cases.",
    unit: "count",
    caption: "Warranty cases not resolved · right now",
    compute: (s) => s.cases_warranty_open,
  }),
  "cases.on_time_rate": communicationMetric({
    id: "cases.on_time_rate",
    label: "Resolved within SLA",
    description: "Of the cases resolved in the period, the share resolved by their SLA due time.",
    unit: "percent",
    caption: "Resolved by SLA ÷ resolved · in the period",
    compute: (s) => ratio(s.cases_resolved_on_time_period, s.cases_resolved_period),
  }),
  "campaigns.total": communicationMetric({
    id: "campaigns.total",
    label: "Campaigns",
    description: "Campaigns that aren't canceled.",
    unit: "count",
    caption: "All campaigns · right now",
    compute: (s) => s.campaigns_total,
  }),
  "campaigns.active": communicationMetric({
    id: "campaigns.active",
    label: "Active",
    description: "Scheduled, sending or paused campaigns.",
    unit: "count",
    caption: "Scheduled + sending + paused · right now",
    compute: (s) => s.campaigns_active,
  }),
  "campaigns.sends": communicationMetric({
    id: "campaigns.sends",
    label: "Sends (90d)",
    description: "Campaign messages recorded (simulated) in the period.",
    unit: "count",
    caption: "Recipients sent · last 90 days",
    compute: (s) => s.campaign_sends,
  }),
  "campaigns.delivery_rate": communicationMetric({
    id: "campaigns.delivery_rate",
    label: "Delivery rate",
    description:
      "Sends that didn't fail, of all attempts. Simulated until a provider reports delivery.",
    unit: "percent",
    caption: "Sent ÷ (sent + failed) · last 90 days",
    compute: (s) => ratio(s.campaign_sends, s.campaign_sends + s.campaign_failed),
  }),
  "campaigns.bounce_rate": communicationMetric({
    id: "campaigns.bounce_rate",
    label: "Bounce rate",
    description: "Failed sends, of all attempts.",
    unit: "percent",
    caption: "Failed ÷ (sent + failed) · last 90 days",
    compute: (s) => ratio(s.campaign_failed, s.campaign_sends + s.campaign_failed),
  }),
  "campaigns.replies": communicationMetric({
    id: "campaigns.replies",
    label: "Replies (90d)",
    description: "Recipients who replied within 14 days of a campaign.",
    unit: "count",
    caption: "Replied after a send · last 90 days",
    compute: (s) => s.campaign_replies,
  }),
  "campaigns.conversions": communicationMetric({
    id: "campaigns.conversions",
    label: "Conversions",
    description: "Recipients who booked or became a job after a campaign.",
    unit: "count",
    caption: "Converted after a send · last 90 days",
    compute: (s) => s.campaign_conversions,
  }),
  "campaigns.queue": communicationMetric({
    id: "campaigns.queue",
    label: "Queue",
    description: "Recipients waiting to be sent (scheduled or held for quiet hours).",
    unit: "count",
    caption: "Pending + held · right now",
    compute: (s) => s.campaign_queue,
  }),
  "messages.unsubscribes": communicationMetric({
    id: "messages.unsubscribes",
    label: "Unsubscribes",
    description: "Contacts and leads who unsubscribed from marketing email in the period.",
    unit: "count",
    caption: "Email unsubscribes · last 90 days",
    compute: (s) => s.unsubscribes,
  }),
  "messages.sms_opt_outs": communicationMetric({
    id: "messages.sms_opt_outs",
    label: "SMS opt-outs",
    description: "Contacts and leads who replied STOP in the period.",
    unit: "count",
    caption: "STOP replies · last 90 days",
    compute: (s) => s.sms_opt_outs,
  }),
  "drips.active": communicationMetric({
    id: "drips.active",
    label: "In a drip",
    description: "Active drip enrollments.",
    unit: "count",
    caption: "Active enrollments · right now",
    compute: (s) => s.drip_active,
  }),
  "reviews.requested": communicationMetric({
    id: "reviews.requested",
    label: "Review requests",
    description: "Review requests sent in the period.",
    unit: "count",
    caption: "Requests sent · in the period",
    compute: (s) => s.reviews_requested,
  }),
  "reviews.click_rate": communicationMetric({
    id: "reviews.click_rate",
    label: "Click-through",
    description: "Requests whose review link was opened.",
    unit: "percent",
    caption: "Clicked ÷ requested · in the period",
    compute: (s) => ratio(s.reviews_clicked, s.reviews_requested),
  }),
  "reviews.review_rate": communicationMetric({
    id: "reviews.review_rate",
    label: "Review rate",
    description: "Requests that led to a review (marked by the office).",
    unit: "percent",
    caption: "Reviews left ÷ requested · in the period",
    compute: (s) => ratio(s.reviews_left, s.reviews_requested),
  }),
  "reviews.left": communicationMetric({
    id: "reviews.left",
    label: "Reviews left",
    description: "Reviews customers left for requests sent in the period.",
    unit: "count",
    caption: "Marked review left · in the period",
    compute: (s) => s.reviews_left,
  }),
  "reviews.avg_rating": communicationMetric({
    id: "reviews.avg_rating",
    label: "Average rating",
    description: "Average star rating where the office recorded one.",
    unit: "number",
    caption: "Σ stars ÷ rated reviews · in the period",
    compute: (s) =>
      s.reviews_rated ? Math.round((s.reviews_rating_sum / s.reviews_rated) * 10) / 10 : null,
  }),
  "referrals.champions": communicationMetric({
    id: "referrals.champions",
    label: "Champions",
    description: "Active Bear Champions.",
    unit: "count",
    caption: "Active champions · right now",
    compute: (s) => s.champions_active,
  }),
  "referrals.referrals": communicationMetric({
    id: "referrals.referrals",
    label: "Referrals",
    description: "Referrals that came in during the period.",
    unit: "count",
    caption: "New referrals · in the period",
    compute: (s) => s.referrals_total,
  }),
  "referrals.closed": communicationMetric({
    id: "referrals.closed",
    label: "Closed deals",
    description: "Eligible referrals whose job was sold (all time).",
    unit: "count",
    caption: "Referred jobs sold · all time",
    compute: (s) => s.referrals_sold,
  }),
  "referrals.conversion": communicationMetric({
    id: "referrals.conversion",
    label: "Referral conversion",
    description: "Referred jobs sold, of all referrals (all time).",
    unit: "percent",
    caption: "Sold ÷ referrals · all time",
    compute: (s) => ratio(s.referrals_sold, s.referrals_all),
  }),
  "referrals.paid_out": communicationMetric({
    id: "referrals.paid_out",
    label: "Paid out",
    description: "Referral rewards paid to champions (all time).",
    unit: "money",
    caption: "Σ rewards paid · all time",
    compute: (s) => s.referrals_paid_cents,
  }),
  "referrals.payable": communicationMetric({
    id: "referrals.payable",
    label: "Ready to pay",
    description: "Rewards whose referred job met the program rule and aren't paid yet.",
    unit: "money",
    caption: "Σ payable rewards · right now",
    compute: (s) => s.referrals_payable_cents,
  }),
  "workflows.runs": communicationMetric({
    id: "workflows.runs",
    label: "Workflow runs",
    description: "Workflow runs started in the period (dry runs excluded).",
    unit: "count",
    caption: "Runs · in the period",
    compute: (s) => s.workflow_runs_period,
  }),
  "workflows.failed": communicationMetric({
    id: "workflows.failed",
    label: "Failed runs",
    description: "Runs that stopped on an error in the period.",
    unit: "count",
    caption: "Failed · in the period",
    compute: (s) => s.workflow_failed_period,
  }),
  "workflows.waiting": communicationMetric({
    id: "workflows.waiting",
    label: "Waiting",
    description: "Runs waiting for a delay, a reminder time or the end of quiet hours.",
    unit: "count",
    caption: "Waiting runs · right now",
    compute: (s) => s.workflow_waiting,
  }),
} as const satisfies Record<string, MetricDefinition<"communication_stats">>;
export type CommunicationMetricId = keyof typeof COMMUNICATION_METRICS;

export function communicationMetricValue(
  id: CommunicationMetricId,
  stats: CommunicationStats,
): MetricValue {
  const m: MetricDefinition<"communication_stats"> = COMMUNICATION_METRICS[id];
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

// ===========================================================================
// ANALYTICS (Phase 9): every SPEC §12.1 KPI, with filters
// ===========================================================================
//
// Source: `public.analytics_stats(p_from, p_to, p_filters)` (supabase/
// migrations/20261030000100_analytics.sql), one round trip, row security
// applied. The period is [from, to) in Pacific days; filters are work type,
// city (territory), owner and lead source. Money is null without
// financials:read, costs without job_costing:read. Each metric names the
// date column the period filters on and the filters it honours. The fixture
// values in lib/metrics/fixtures/analytics.ts are asserted in SQL by
// supabase/tests/015_analytics.test.sql and computed here by the unit tests.

const nCount = z.number().nonnegative().catch(0);
const nullableCents = z.number().nullable().catch(null);
const nullableNumber = z.number().nonnegative().nullable().catch(null);

const stageRowSchema = z.object({ stage: z.string(), jobs: nCount, value_cents: nullableCents });
const cityRowSchema = z.object({
  territory_id: z.string().nullable().catch(null),
  city: z.string().catch("Unknown"),
  service_area: z.boolean().catch(false),
  leads: nCount,
  sold_jobs: nCount,
  sold_cents: nullableCents,
});
const estimatorRowSchema = z.object({
  user_id: z.string().nullable().catch(null),
  name: z.string().catch("Unassigned"),
  sent: nCount,
  cohort_accepted: nCount,
  accepted: nCount,
  accepted_value_cents: nCount,
});
const sourceRowSchema = z.object({
  source: z.string().nullable().catch(null),
  leads: nCount,
  converted: nCount,
  sold_jobs: nCount,
  sold_cents: nullableCents,
  spend_cents: nCount,
});
const nullableAging = z
  .object({ current: nCount, d1_30: nCount, d31_60: nCount, d61_90: nCount, d90_plus: nCount })
  .nullable()
  .catch(null);

export const analyticsStatsSchema = z.object({
  can_see_money: z.boolean().catch(false),
  can_see_costs: z.boolean().catch(false),
  period_days: nCount,
  elapsed_days: nCount,
  filters_applied: z.boolean().catch(false),
  spend_applies: z.boolean().catch(true),
  leads_created: nCount,
  leads_contacted: nCount,
  leads_walkthrough: nCount,
  leads_converted: nCount,
  speed_measured: nCount,
  speed_median_seconds: nullableNumber,
  speed_p90_seconds: nullableNumber,
  walkthroughs_due: nCount,
  walkthroughs_completed: nCount,
  estimates_sent: nCount,
  estimates_sent_value_cents: nCount,
  sla_hours: z.number().positive().catch(24),
  sla_measured: nCount,
  sla_met: nCount,
  cohort_accepted: nCount,
  cohort_accepted_value_cents: nCount,
  accepted: nCount,
  accepted_value_cents: nCount,
  open_estimates: nCount,
  open_estimates_value_cents: nCount,
  sold_jobs: nCount,
  sold_cents: nullableCents,
  velocity_days_avg: nullableNumber,
  sold_not_started_jobs: nCount,
  sold_not_started_cents: nullableCents,
  completed_jobs: nCount,
  completed_cents: nullableCents,
  collected_cents: nullableCents,
  billed_cents: nullableCents,
  billed_collected_cents: nullableCents,
  margin_jobs: nullableNumber,
  margin_revenue_cents: nullableCents,
  margin_cost_cents: nullableCents,
  labor_budgeted_hours: nCount,
  labor_actual_hours: nCount,
  punch_items: nCount,
  daily_due: nCount,
  daily_logged: nCount,
  on_time_met: nCount,
  on_time_missed: nCount,
  rain_delay_days: nCount,
  paid_jobs: nCount,
  days_completed_to_paid_avg: nullableNumber,
  ar_outstanding_cents: nullableCents,
  overdue_cents: nullableCents,
  aging: nullableAging,
  reviews_requested: nCount,
  reviews_left: nCount,
  referrals: nCount,
  referrals_sold: nCount,
  backlog_hours: nCount,
  crew_day_hours: z.number().positive().catch(8),
  backlog_by_work_type: z
    .array(z.object({ work_type: z.string().catch("other"), hours: nCount }))
    .catch([]),
  spend_cents: nCount,
  cac_jobs: nCount,
  by_stage: z.array(stageRowSchema).catch([]),
  funnel: z
    .object({
      leads: nCount,
      contacted: nCount,
      walkthrough: nCount,
      estimate: nCount,
      sold: nCount,
    })
    .catch({ leads: 0, contacted: 0, walkthrough: 0, estimate: 0, sold: 0 }),
  by_city: z.array(cityRowSchema).catch([]),
  by_estimator: z.array(estimatorRowSchema).catch([]),
  by_source: z.array(sourceRowSchema).catch([]),
  alerts: z.record(z.string(), nCount).catch({}),
  expiring_estimates: nCount,
  approvals_pending: nCount,
  dq_leads_unassigned: nCount,
  dq_jobs_no_poc: nCount,
  dq_jobs_no_property: nCount,
  dq_contacts_unreachable: nCount,
});
export type AnalyticsStats = z.infer<typeof analyticsStatsSchema>;
export const EMPTY_ANALYTICS_STATS: AnalyticsStats = analyticsStatsSchema.parse({});

/** Parses `analytics_stats`; anything malformed reads as zero / empty, never a crash. */
export function parseAnalyticsStats(raw: unknown): AnalyticsStats {
  const parsed = analyticsStatsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_ANALYTICS_STATS;
}

const ALL_FILTERS: readonly MetricFilter[] = METRIC_FILTERS;
const MONEY: readonly Permission[] = ["financials:read"];
const COSTS: readonly Permission[] = ["job_costing:read"];

export type AnalyticsMetricDefinition = MetricDefinition<"analytics_stats"> & {
  dateField: string | null;
  filters: readonly MetricFilter[];
  requires: readonly Permission[];
  /** Caption with live numbers; the static `caption` may use {period}. */
  detail?: (s: AnalyticsStats, words: PeriodWords) => string;
  /** Words people use for it in "Ask Brushy Bear" (lowercase). */
  keywords: readonly string[];
};

function kpi(
  def: Omit<AnalyticsMetricDefinition, "source" | "ownerOnly" | "filters" | "requires"> & {
    ownerOnly?: boolean;
    filters?: readonly MetricFilter[];
    requires?: readonly Permission[];
  },
): AnalyticsMetricDefinition {
  return {
    ownerOnly: false,
    filters: ALL_FILTERS,
    requires: [],
    ...def,
    source: "analytics_stats",
  };
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");

/** MTD sold + run-rate for the rest of the period; the sold figure once the period is over. */
export function projectedRevenue(s: AnalyticsStats): number | null {
  if (s.sold_cents === null) return null;
  if (s.period_days <= 0) return null;
  if (s.elapsed_days >= s.period_days) return s.sold_cents;
  if (s.elapsed_days <= 0) return null;
  return Math.round((s.sold_cents / s.elapsed_days) * s.period_days);
}

export const ANALYTICS_METRICS = {
  // Leads ------------------------------------------------------------------
  "kpi.leads_created": kpi({
    id: "kpi.leads_created",
    label: "Leads created",
    description: "Leads that came in during the period, from any source.",
    unit: "count",
    dateField: "leads.created_at",
    caption: "Leads created {period}",
    keywords: ["leads", "lead count", "new leads", "how many leads"],
    compute: (s) => s.leads_created,
  }),
  "kpi.speed_to_lead_median": kpi({
    id: "kpi.speed_to_lead_median",
    label: "Speed to Lead",
    description:
      "Median time from a lead arriving to a person first reaching them, counted in business hours.",
    unit: "duration",
    dateField: "leads.created_at",
    caption: "Median, business hours · leads created {period}",
    detail: (s, w) =>
      s.speed_measured
        ? `Median of ${n(s.speed_measured)} leads reached · p90 ${formatMetricValue("duration", s.speed_p90_seconds)} · ${w.period}`
        : `No leads reached ${w.period} yet`,
    keywords: ["speed to lead", "response time", "first contact", "how fast"],
    compute: (s) => s.speed_median_seconds,
  }),
  "kpi.speed_to_lead_p90": kpi({
    id: "kpi.speed_to_lead_p90",
    label: "Speed to Lead (p90)",
    description: "9 in 10 leads were reached within this time (business hours).",
    unit: "duration",
    dateField: "leads.created_at",
    caption: "90th percentile, business hours · leads created {period}",
    keywords: ["p90", "slowest"],
    compute: (s) => s.speed_p90_seconds,
  }),
  "kpi.contact_rate": kpi({
    id: "kpi.contact_rate",
    label: "Contact rate",
    description: "Share of the period's leads a person has reached at least once.",
    unit: "percent",
    dateField: "leads.created_at",
    caption: "Leads contacted ÷ leads created {period}",
    detail: (s, w) =>
      `${n(s.leads_contacted)} of ${n(s.leads_created)} leads contacted · ${w.period}`,
    keywords: ["contact rate", "contacted"],
    compute: (s) => ratio(s.leads_contacted, s.leads_created),
  }),
  "kpi.walkthrough_set_rate": kpi({
    id: "kpi.walkthrough_set_rate",
    label: "Walkthrough set rate",
    description: "Share of the period's leads that got a walkthrough booked.",
    unit: "percent",
    dateField: "leads.created_at",
    caption: "Leads with a walkthrough booked ÷ leads created {period}",
    detail: (s, w) =>
      `${n(s.leads_walkthrough)} of ${n(s.leads_created)} leads booked a walkthrough · ${w.period}`,
    keywords: ["walkthrough rate", "walkthroughs booked", "set rate"],
    compute: (s) => ratio(s.leads_walkthrough, s.leads_created),
  }),
  "kpi.walkthrough_show_rate": kpi({
    id: "kpi.walkthrough_show_rate",
    label: "Walkthrough show rate",
    description:
      "Of walkthroughs whose time came in the period, the share completed (no-shows are the rest).",
    unit: "percent",
    dateField: "appointments.starts_at",
    caption: "Completed ÷ (completed + no-shows) · walkthroughs {period}",
    detail: (s, w) =>
      `${n(s.walkthroughs_completed)} of ${n(s.walkthroughs_due)} walkthroughs happened · ${w.period}`,
    keywords: ["show rate", "no show", "no-show"],
    compute: (s) => ratio(s.walkthroughs_completed, s.walkthroughs_due),
  }),
  // Estimates & sales -------------------------------------------------------
  "kpi.estimates_sent": kpi({
    id: "kpi.estimates_sent",
    label: "Estimates Sent",
    description: "Estimates sent to the customer for the first time in the period.",
    unit: "count",
    dateField: "estimate_versions.sent_at (first send)",
    caption: "First sent {period}",
    detail: (s, w) =>
      `${n(s.estimates_sent)} sent ${w.period} · ${formatMoney(s.estimates_sent_value_cents)} quoted`,
    keywords: ["estimates sent", "estimates", "quotes", "proposals sent"],
    compute: (s) => s.estimates_sent,
  }),
  "kpi.sla_24h": kpi({
    id: "kpi.sla_24h",
    label: "24h Estimate SLA",
    description:
      "Share of estimates sent within the estimate SLA (Company Settings, 24 hours by default) after the walkthrough was completed.",
    unit: "percent",
    dateField: "estimate_versions.sent_at (first send)",
    caption: "Sent within the SLA ÷ estimates with a completed walkthrough · first sent {period}",
    detail: (s, w) =>
      `${n(s.sla_met)} of ${n(s.sla_measured)} sent within ${n(s.sla_hours)}h · ${w.period}`,
    keywords: ["sla", "24h", "24 hour", "estimate sla", "written estimate"],
    compute: (s) => ratio(s.sla_met, s.sla_measured),
  }),
  "kpi.close_rate": kpi({
    id: "kpi.close_rate",
    label: "Close Rate",
    description: "Accepted ÷ sent, same cohort: estimates first sent in the period.",
    unit: "percent",
    dateField: "estimate_versions.sent_at (first send)",
    caption: "Accepted ÷ sent · estimates first sent {period}",
    detail: (s, w) =>
      `${n(s.cohort_accepted)} accepted ÷ ${n(s.estimates_sent)} sent · first sent ${w.period}`,
    keywords: ["close rate", "closing rate", "win rate", "conversion"],
    compute: (s) => ratio(s.cohort_accepted, s.estimates_sent),
  }),
  "kpi.close_rate_value": kpi({
    id: "kpi.close_rate_value",
    label: "Close Rate ($)",
    description: "Accepted value ÷ sent value, same cohort.",
    unit: "percent",
    dateField: "estimate_versions.sent_at (first send)",
    caption: "Accepted $ ÷ sent $ · estimates first sent {period}",
    keywords: ["close rate dollars", "dollar close rate"],
    compute: (s) => ratio(s.cohort_accepted_value_cents, s.estimates_sent_value_cents),
  }),
  "kpi.avg_job_value": kpi({
    id: "kpi.avg_job_value",
    label: "Avg Job Value",
    description: "Accepted estimate value ÷ estimates accepted in the period.",
    unit: "money",
    dateField: "estimates.accepted_at",
    caption: "Accepted $ ÷ estimates accepted {period}",
    detail: (s, w) =>
      `${formatMoney(s.accepted_value_cents)} ÷ ${n(s.accepted)} accepted · ${w.period}`,
    keywords: ["average job", "avg job", "job value", "average ticket", "job size"],
    compute: (s) => (s.accepted === 0 ? null : Math.round(s.accepted_value_cents / s.accepted)),
  }),
  "kpi.sales_velocity": kpi({
    id: "kpi.sales_velocity",
    label: "Sales Velocity",
    description: "Average days from the lead arriving to the estimate being accepted.",
    unit: "days",
    dateField: "jobs.estimate_accepted_at",
    caption: "Average days lead → sold · jobs sold {period}",
    detail: (s, w) =>
      s.sold_jobs
        ? `Average of ${n(s.sold_jobs)} jobs sold ${w.period}`
        : `No jobs sold ${w.period} yet`,
    keywords: ["velocity", "days to close", "how long to sell", "sales cycle"],
    compute: (s) => s.velocity_days_avg,
  }),
  "kpi.sold_jobs": kpi({
    id: "kpi.sold_jobs",
    label: "Jobs sold",
    description: "Jobs whose estimate was accepted in the period.",
    unit: "count",
    dateField: "jobs.estimate_accepted_at",
    caption: "Estimate accepted {period}",
    keywords: ["jobs sold", "sold jobs", "how many sold", "deals"],
    compute: (s) => s.sold_jobs,
  }),
  "kpi.pipeline_value": kpi({
    id: "kpi.pipeline_value",
    label: "Open Pipeline Value",
    description:
      "Open estimates (sent or viewed, not answered) plus the contract value of jobs sold but not started.",
    unit: "money",
    requires: MONEY,
    dateField: null,
    caption: "Open estimates + sold, not started · right now",
    detail: (s) =>
      `${n(s.open_estimates)} open estimates ${formatMoney(s.open_estimates_value_cents)} + ${n(s.sold_not_started_jobs)} sold ${formatMoney(s.sold_not_started_cents)} · right now`,
    keywords: ["pipeline", "open pipeline", "pipeline value", "backlog value"],
    compute: (s) =>
      s.sold_not_started_cents === null
        ? null
        : s.open_estimates_value_cents + s.sold_not_started_cents,
  }),
  "kpi.pipeline_open_estimates": kpi({
    id: "kpi.pipeline_open_estimates",
    label: "Open estimates",
    description: "Value of estimates sent and waiting on the customer.",
    unit: "money",
    dateField: null,
    caption: "Sent or viewed, not answered · right now",
    detail: (s) => `${n(s.open_estimates)} estimates waiting on the customer · right now`,
    keywords: ["open estimates", "waiting estimates", "outstanding estimates"],
    compute: (s) => s.open_estimates_value_cents,
  }),
  "kpi.pipeline_sold_not_started": kpi({
    id: "kpi.pipeline_sold_not_started",
    label: "Sold, not started",
    description: "Contract value of jobs sold and not yet in production.",
    unit: "money",
    requires: MONEY,
    dateField: null,
    caption: "Sold → Scheduled · right now",
    detail: (s) => `${n(s.sold_not_started_jobs)} jobs sold, not started · right now`,
    keywords: ["sold not started", "booked work"],
    compute: (s) => s.sold_not_started_cents,
  }),
  "kpi.projected_revenue": kpi({
    id: "kpi.projected_revenue",
    label: "Projected Revenue",
    description:
      "Sold so far in the period plus the same daily pace for the days left (run-rate). Once the period is over it is what sold.",
    unit: "money",
    requires: MONEY,
    dateField: "jobs.estimate_accepted_at",
    caption: "Sold {period} + run-rate for the days left",
    detail: (s, w) =>
      s.sold_cents === null
        ? "Amounts hidden for your role"
        : `${formatMoney(s.sold_cents)} sold in ${n(s.elapsed_days)} of ${n(s.period_days)} days · ${w.period}`,
    keywords: ["projected", "projection", "forecast", "run rate", "on pace"],
    compute: projectedRevenue,
  }),
  // Revenue -----------------------------------------------------------------
  "kpi.revenue_sold": kpi({
    id: "kpi.revenue_sold",
    label: "Revenue sold",
    description: "Contract value of jobs whose estimate was accepted in the period.",
    unit: "money",
    requires: MONEY,
    dateField: "jobs.estimate_accepted_at",
    caption: "Contracts accepted {period}",
    detail: (s, w) => `${n(s.sold_jobs)} jobs sold ${w.period}`,
    keywords: ["sales", "sold", "revenue", "how are sales", "bookings", "sold revenue"],
    compute: (s) => s.sold_cents,
  }),
  "kpi.revenue_completed": kpi({
    id: "kpi.revenue_completed",
    label: "Revenue completed",
    description: "Contract value of jobs that reached Completed in the period.",
    unit: "money",
    requires: MONEY,
    dateField: "jobs.completed_at",
    caption: "Jobs completed {period}",
    detail: (s, w) => `${n(s.completed_jobs)} jobs completed ${w.period}`,
    keywords: ["completed revenue", "revenue completed", "finished jobs revenue"],
    compute: (s) => s.completed_cents,
  }),
  "kpi.revenue_collected": kpi({
    id: "kpi.revenue_collected",
    label: "Collected",
    description:
      "Payments received in the period and applied to invoices (bounced, void, refunded and unapplied money never counts).",
    unit: "money",
    requires: MONEY,
    dateField: "payments.received_on",
    caption: "Applied payments received {period}",
    keywords: ["collect", "collected", "payments", "cash in", "money in"],
    compute: (s) => s.collected_cents,
  }),
  "kpi.completed_jobs": kpi({
    id: "kpi.completed_jobs",
    label: "Jobs completed",
    description: "Jobs that reached Completed in the period.",
    unit: "count",
    dateField: "jobs.completed_at",
    caption: "Reached Completed {period}",
    keywords: ["jobs completed", "finished jobs", "completed jobs"],
    compute: (s) => s.completed_jobs,
  }),
  "kpi.gross_margin_completed": kpi({
    id: "kpi.gross_margin_completed",
    label: "Gross Margin % (completed)",
    description:
      "Jobs completed in the period: (contract − labor − materials − subcontractors − expenses) ÷ contract.",
    unit: "percent",
    ownerOnly: true,
    requires: COSTS,
    dateField: "jobs.completed_at",
    caption: "Gross profit ÷ revenue · jobs completed {period}",
    detail: (s, w) =>
      s.margin_revenue_cents === null
        ? "Owners and the bookkeeper only"
        : s.margin_revenue_cents === 0
          ? `No jobs completed ${w.period} yet`
          : `${formatMoney(s.margin_revenue_cents - (s.margin_cost_cents ?? 0))} profit on ${formatMoney(s.margin_revenue_cents)} · ${w.period}`,
    keywords: ["margin", "gross margin", "profit"],
    compute: (s) =>
      s.can_see_costs && s.margin_revenue_cents !== null && s.margin_revenue_cents > 0
        ? (s.margin_revenue_cents - (s.margin_cost_cents ?? 0)) / s.margin_revenue_cents
        : null,
  }),
  // Production --------------------------------------------------------------
  "kpi.labor_hours_estimated": kpi({
    id: "kpi.labor_hours_estimated",
    label: "Labor hours estimated",
    description: "Budgeted work-order hours on jobs completed in the period.",
    unit: "hours",
    dateField: "jobs.completed_at",
    caption: "Budgeted hours · jobs completed {period}",
    keywords: ["estimated hours", "budgeted hours"],
    compute: (s) => s.labor_budgeted_hours,
  }),
  "kpi.labor_hours_actual": kpi({
    id: "kpi.labor_hours_actual",
    label: "Labor hours actual",
    description: "Hours logged on jobs completed in the period.",
    unit: "hours",
    dateField: "jobs.completed_at",
    caption: "Logged hours · jobs completed {period}",
    keywords: ["actual hours", "hours logged", "labor hours"],
    compute: (s) => s.labor_actual_hours,
  }),
  "kpi.labor_hours_variance": kpi({
    id: "kpi.labor_hours_variance",
    label: "Actual vs estimated hours",
    description: "Hours logged ÷ hours budgeted × 100 (over 100 means over budget).",
    unit: "number",
    dateField: "jobs.completed_at",
    caption: "Actual ÷ estimated × 100 · jobs completed {period}",
    keywords: ["labor variance", "over budget", "hours vs estimate"],
    compute: (s) =>
      s.labor_budgeted_hours > 0
        ? Math.round((s.labor_actual_hours / s.labor_budgeted_hours) * 100)
        : null,
  }),
  "kpi.daily_update_compliance": kpi({
    id: "kpi.daily_update_compliance",
    label: "Daily Update Compliance",
    description:
      "Production days with a daily log ÷ production days due in the period (a day is due after the cutoff, 7 pm Pacific by default; rain days don't count).",
    unit: "percent",
    dateField: "schedule_entries.starts_on – ends_on (production days)",
    caption: "Days logged ÷ production days due {period}",
    detail: (s, w) =>
      `${n(s.daily_logged)} of ${n(s.daily_due)} production days logged · ${w.period}`,
    keywords: ["daily update", "daily log", "photo update", "compliance"],
    compute: (s) => ratio(s.daily_logged, s.daily_due),
  }),
  "kpi.on_time_start": kpi({
    id: "kpi.on_time_start",
    label: "On-Time Start",
    description:
      "Jobs that started on or before their guaranteed start date ÷ jobs that started in the period. Rain delays don't count against it.",
    unit: "percent",
    dateField: "jobs.actual_start_date",
    caption: "Started on time ÷ started {period} · weather excluded",
    detail: (s, w) =>
      `${n(s.on_time_met)} of ${n(s.on_time_met + s.on_time_missed)} started on time · ${w.period}`,
    keywords: ["on time", "on-time", "start date", "late start", "guarantee"],
    compute: (s) => ratio(s.on_time_met, s.on_time_met + s.on_time_missed),
  }),
  "kpi.rain_delay_days": kpi({
    id: "kpi.rain_delay_days",
    label: "Rain-delay days",
    description: "Job days marked as rain delays in the period.",
    unit: "count",
    dateField: "rain_delays.delay_date",
    caption: "Marked rain days {period}",
    keywords: ["rain", "weather delay", "rain delay"],
    compute: (s) => s.rain_delay_days,
  }),
  "kpi.punch_per_job": kpi({
    id: "kpi.punch_per_job",
    label: "Punch items per job",
    description: "Punch items ÷ jobs completed in the period.",
    unit: "number",
    dateField: "jobs.completed_at",
    caption: "Average punch items · jobs completed {period}",
    keywords: ["punch", "punch list", "touch-ups", "touch ups"],
    compute: (s) => (s.completed_jobs > 0 ? s.punch_items / s.completed_jobs : null),
  }),
  "kpi.backlog_crew_days": kpi({
    id: "kpi.backlog_crew_days",
    label: "Backlog",
    description:
      "Open work-order hours on Ready, Scheduled and In Progress jobs ÷ the crew-day hours in Schedule Admin.",
    unit: "days",
    dateField: null,
    caption: "Crew-days of work not yet done · right now",
    detail: (s) =>
      `${formatMetricValue("hours", s.backlog_hours)} ÷ ${formatMetricValue("hours", s.crew_day_hours)} crew day · right now`,
    keywords: ["backlog", "crew days", "booked work", "how busy"],
    compute: (s) => s.backlog_hours / s.crew_day_hours,
  }),
  // Money -------------------------------------------------------------------
  "kpi.days_completed_to_paid": kpi({
    id: "kpi.days_completed_to_paid",
    label: "Days completed → paid",
    description:
      "Average days from Completed to Paid in Full, for jobs paid in full in the period.",
    unit: "days",
    requires: MONEY,
    dateField: "jobs.paid_in_full_at",
    caption: "Average · jobs paid in full {period}",
    keywords: ["days to pay", "days to paid", "how long to get paid"],
    compute: (s) => (s.can_see_money ? s.days_completed_to_paid_avg : null),
  }),
  "kpi.ar_outstanding": kpi({
    id: "kpi.ar_outstanding",
    label: "AR Outstanding",
    description: "What customers owe on sent invoices.",
    unit: "money",
    requires: MONEY,
    dateField: null,
    caption: "Sent invoices, balance owed · right now",
    detail: (s) => `${formatMoney(s.overdue_cents)} of it past due · right now`,
    keywords: ["ar", "a/r", "receivables", "owed", "outstanding", "unpaid"],
    compute: (s) => s.ar_outstanding_cents,
  }),
  "kpi.ar_overdue": kpi({
    id: "kpi.ar_overdue",
    label: "Overdue",
    description: "Balance owed on sent invoices past their due date.",
    unit: "money",
    requires: MONEY,
    dateField: null,
    caption: "Past due · right now",
    keywords: ["overdue", "past due", "late invoices"],
    compute: (s) => s.overdue_cents,
  }),
  "kpi.collection_rate": kpi({
    id: "kpi.collection_rate",
    label: "Collection %",
    description: "Of the invoices issued in the period, the share already paid.",
    unit: "percent",
    requires: MONEY,
    dateField: "invoices.issue_date",
    caption: "Collected ÷ billed · invoices issued {period}",
    detail: (s, w) =>
      `${formatMoney(s.billed_collected_cents)} of ${formatMoney(s.billed_cents)} billed ${w.period}`,
    keywords: ["collection rate", "collection percent"],
    compute: (s) =>
      s.billed_cents === null || s.billed_collected_cents === null
        ? null
        : ratio(s.billed_collected_cents, s.billed_cents),
  }),
  // Growth ------------------------------------------------------------------
  "kpi.reviews_requested": kpi({
    id: "kpi.reviews_requested",
    label: "Review requests",
    description: "Review requests sent in the period (skipped ones left out).",
    unit: "count",
    dateField: "review_requests.sent_at",
    caption: "Requests sent {period}",
    keywords: ["review requests"],
    compute: (s) => s.reviews_requested,
  }),
  "kpi.review_rate": kpi({
    id: "kpi.review_rate",
    label: "Review rate",
    description: "Review requests that led to a review (marked by the office).",
    unit: "percent",
    dateField: "review_requests.sent_at",
    caption: "Reviews left ÷ requests sent {period}",
    detail: (s, w) => `${n(s.reviews_left)} of ${n(s.reviews_requested)} requests · ${w.period}`,
    keywords: ["review", "reviews", "review rate", "google reviews"],
    compute: (s) => ratio(s.reviews_left, s.reviews_requested),
  }),
  "kpi.referrals": kpi({
    id: "kpi.referrals",
    label: "Referrals",
    description: "Bear Champion referrals that came in during the period.",
    unit: "count",
    dateField: "referrals.created_at",
    caption: "New referrals {period}",
    keywords: ["referrals", "referred", "champions"],
    compute: (s) => s.referrals,
  }),
  "kpi.referral_conversions": kpi({
    id: "kpi.referral_conversions",
    label: "Referral conversions",
    description: "Referrals from the period whose job was sold (eligible referrals only).",
    unit: "count",
    dateField: "referrals.created_at",
    caption: "Referred jobs sold · referrals from {period}",
    detail: (s, w) => `${n(s.referrals_sold)} of ${n(s.referrals)} referrals sold · ${w.period}`,
    keywords: ["referral conversions", "referrals sold"],
    compute: (s) => s.referrals_sold,
  }),
  // Marketing ---------------------------------------------------------------
  "kpi.marketing_spend": kpi({
    id: "kpi.marketing_spend",
    label: "Marketing spend",
    description:
      "Monthly spend per lead source from Admin → Marketing Spend, prorated by day for partial months.",
    unit: "money",
    filters: ["source"],
    dateField: "marketing_spend.month (prorated by day)",
    caption: "Spend entered for {period}",
    keywords: ["spend", "marketing spend", "ad spend", "advertising"],
    compute: (s) => s.spend_cents,
  }),
  "kpi.cost_per_lead": kpi({
    id: "kpi.cost_per_lead",
    label: "Cost per lead",
    description:
      "Marketing spend ÷ leads created. Spend isn't split by work type, city or owner, so those filters show “—”.",
    unit: "money",
    filters: ["source"],
    dateField: "leads.created_at",
    caption: "Spend ÷ leads created {period}",
    detail: (s, w) =>
      !s.spend_applies
        ? "Spend isn't split by work type, city or owner"
        : s.spend_cents === 0
          ? "No spend entered (Admin → Marketing Spend)"
          : `${formatMoney(s.spend_cents)} ÷ ${n(s.leads_created)} leads · ${w.period}`,
    keywords: ["cost per lead", "cpl", "lead cost"],
    compute: (s) =>
      !s.spend_applies || s.spend_cents === 0 || s.leads_created === 0
        ? null
        : Math.round(s.spend_cents / s.leads_created),
  }),
  "kpi.cac": kpi({
    id: "kpi.cac",
    label: "Customer acquisition cost",
    description: "Marketing spend ÷ jobs sold (from that source when a source is picked).",
    unit: "money",
    filters: ["source"],
    dateField: "jobs.estimate_accepted_at",
    caption: "Spend ÷ jobs sold {period}",
    detail: (s, w) =>
      !s.spend_applies
        ? "Spend isn't split by work type, city or owner"
        : s.spend_cents === 0
          ? "No spend entered (Admin → Marketing Spend)"
          : `${formatMoney(s.spend_cents)} ÷ ${n(s.cac_jobs)} jobs sold · ${w.period}`,
    keywords: ["cac", "acquisition cost", "cost per customer", "cost per job"],
    compute: (s) =>
      !s.spend_applies || s.spend_cents === 0 || s.cac_jobs === 0
        ? null
        : Math.round(s.spend_cents / s.cac_jobs),
  }),
  // Right-now counts & data quality ----------------------------------------
  "kpi.expiring_estimates": kpi({
    id: "kpi.expiring_estimates",
    label: "Expiring estimates",
    description: "Sent estimates that expire within 5 days without an answer.",
    unit: "count",
    filters: [],
    dateField: null,
    caption: "Expire within 5 days · right now",
    keywords: ["expiring", "expire"],
    compute: (s) => s.expiring_estimates,
  }),
  "kpi.dq_leads_unassigned": kpi({
    id: "kpi.dq_leads_unassigned",
    label: "Leads with no owner",
    description: "Open leads nobody owns.",
    unit: "count",
    dateField: null,
    caption: "Open leads, no owner · right now",
    keywords: ["unassigned", "no owner", "data quality", "data issues"],
    compute: (s) => s.dq_leads_unassigned,
  }),
  "kpi.dq_jobs_no_poc": kpi({
    id: "kpi.dq_jobs_no_poc",
    label: "Jobs with no point of contact",
    description: "Open jobs without the one point of contact every customer is promised.",
    unit: "count",
    dateField: null,
    caption: "Open jobs, no point of contact · right now",
    keywords: ["point of contact", "data quality", "data issues"],
    compute: (s) => s.dq_jobs_no_poc,
  }),
  "kpi.dq_jobs_no_property": kpi({
    id: "kpi.dq_jobs_no_property",
    label: "Jobs with no property",
    description: "Open jobs not linked to a property (no address for the crew).",
    unit: "count",
    dateField: null,
    caption: "Open jobs, no property · right now",
    keywords: ["no property", "no address", "data quality", "data issues"],
    compute: (s) => s.dq_jobs_no_property,
  }),
  "kpi.dq_contacts_unreachable": kpi({
    id: "kpi.dq_contacts_unreachable",
    label: "Contacts we can't reach",
    description: "Contacts with no mobile, phone or email.",
    unit: "count",
    filters: [],
    dateField: null,
    caption: "No phone or email · right now",
    keywords: ["unreachable", "no phone", "no email", "data quality", "data issues"],
    compute: (s) => s.dq_contacts_unreachable,
  }),
} as const satisfies Record<string, AnalyticsMetricDefinition>;
export type AnalyticsMetricId = keyof typeof ANALYTICS_METRICS;

/** Data-quality metrics, in the order "Ask" and the Daily Brief list them. */
export const DATA_QUALITY_METRIC_IDS = [
  "kpi.dq_leads_unassigned",
  "kpi.dq_jobs_no_poc",
  "kpi.dq_jobs_no_property",
  "kpi.dq_contacts_unreachable",
] as const satisfies readonly AnalyticsMetricId[];

export type AnalyticsMetricValue = MetricValue & {
  id: AnalyticsMetricId;
  /** The viewer may not see this number (shown as "—"). */
  hidden: boolean;
};

/** Default words for captions when the caller doesn't pass the period's. */
export const DEFAULT_PERIOD_WORDS: PeriodWords = {
  period: "in the period",
  prior: "the prior period",
  start: "the start of the period",
};

/** One §12.1 metric: value, display and caption (live numbers when it has them). */
export function analyticsMetricValue(
  id: AnalyticsMetricId,
  stats: AnalyticsStats,
  words: PeriodWords = DEFAULT_PERIOD_WORDS,
): AnalyticsMetricValue {
  const m: AnalyticsMetricDefinition = ANALYTICS_METRICS[id];
  const hidden =
    (m.requires.includes("financials:read") && !stats.can_see_money) ||
    (m.requires.includes("job_costing:read") && !stats.can_see_costs);
  const raw = hidden ? null : m.compute(stats);
  const value = raw === null || !Number.isFinite(raw) ? null : raw;
  return {
    id,
    label: m.label,
    caption: hidden
      ? m.ownerOnly
        ? "Owners and the bookkeeper only"
        : "Amounts hidden for your role"
      : m.detail
        ? m.detail(stats, words)
        : fillWords(m.caption, words),
    unit: m.unit,
    value,
    display: formatMetricValue(m.unit, value),
    hidden,
  };
}

/** The formula caption with the period filled in (no live numbers). */
export function analyticsFormula(id: AnalyticsMetricId, words: PeriodWords): string {
  return fillWords(ANALYTICS_METRICS[id].caption, words);
}

// ---------------------------------------------------------------------------
// Analytics breakdowns: the rows behind each Executive Overview / dashboard
// chart and its "View data" table. Defined once here, like the metrics.
// ---------------------------------------------------------------------------

export type BreakdownDefinition = {
  id: string;
  label: string;
  description: string;
  /** RPC the rows come from. */
  source: "analytics_stats" | "analytics_monthly" | "season_backlog";
  dateField: string | null;
  filters: readonly MetricFilter[];
  caption: string;
  requires: readonly Permission[];
  keywords: readonly string[];
};

export const ANALYTICS_BREAKDOWNS = {
  "kpi.pipeline_by_stage": {
    id: "kpi.pipeline_by_stage",
    label: "Pipeline by Stage",
    description: "Open jobs (not Closed Won or Lost) by current stage: count and contract value.",
    source: "analytics_stats",
    dateField: null,
    filters: ALL_FILTERS,
    caption: "Open jobs by stage · count and value · right now",
    requires: [],
    keywords: ["pipeline by stage", "stages", "where are jobs"],
  },
  "kpi.revenue_forecast": {
    id: "kpi.revenue_forecast",
    label: "Revenue Forecast",
    description:
      "Sold value by month: actual, run-rate projection for this month and the next ones (average of the last 3 full months), and the goal from Admin → Revenue Goals.",
    source: "analytics_monthly",
    dateField: "jobs.estimate_accepted_at",
    filters: ALL_FILTERS,
    caption: "Sold by month · actual vs run-rate vs goal",
    requires: MONEY,
    keywords: ["forecast", "revenue forecast", "goal", "projection by month"],
  },
  "kpi.lead_funnel": {
    id: "kpi.lead_funnel",
    label: "Lead Funnel",
    description:
      "Leads created in the period and how many reached each step: contacted, walkthrough, estimate sent, sold.",
    source: "analytics_stats",
    dateField: "leads.created_at",
    filters: ALL_FILTERS,
    caption: "Leads created {period} · each step as % of the step before",
    requires: [],
    keywords: ["funnel", "lead funnel", "conversion funnel"],
  },
  "kpi.season_backlog": {
    id: "kpi.season_backlog",
    label: "Exterior Season Backlog",
    description:
      "Exterior and deck crew-days on the published schedule vs crew capacity (active crews × production days) for each month of the exterior season, plus sold exterior work not scheduled yet.",
    source: "season_backlog",
    dateField: "schedule_entries.starts_on / ends_on",
    filters: [],
    caption: "Booked crew-days vs capacity · exterior season",
    requires: [],
    keywords: ["season", "exterior backlog", "summer", "capacity", "seasonality"],
  },
  "kpi.city_performance": {
    id: "kpi.city_performance",
    label: "City Performance",
    description:
      "Leads created and jobs sold in the period by service-area city, ranked by sold value (then jobs, then leads).",
    source: "analytics_stats",
    dateField: "leads.created_at / jobs.estimate_accepted_at",
    filters: ALL_FILTERS,
    caption: "Leads and jobs sold {period} by city · heat ranking",
    requires: [],
    keywords: [
      "city",
      "cities",
      "bellevue",
      "kirkland",
      "redmond",
      "sammamish",
      "issaquah",
      "by city",
    ],
  },
  "kpi.estimator_leaderboard": {
    id: "kpi.estimator_leaderboard",
    label: "Estimator Leaderboard",
    description:
      "Per estimator: value and number of estimates accepted in the period, and close rate (accepted ÷ sent, estimates first sent in the period).",
    source: "analytics_stats",
    dateField: "estimates.accepted_at / first send",
    filters: ["work_type", "city", "source"],
    caption: "Sold $, jobs and close rate {period}",
    requires: [],
    keywords: ["estimator", "leaderboard", "sales rep", "who sold", "by estimator"],
  },
  "kpi.lead_source_performance": {
    id: "kpi.lead_source_performance",
    label: "Lead Source Performance",
    description:
      "Per lead source: leads created, converted, conversion %, jobs sold and revenue in the period, and cost per lead when spend is entered.",
    source: "analytics_stats",
    dateField: "leads.created_at / jobs.estimate_accepted_at",
    filters: ALL_FILTERS,
    caption: "Leads, conversion, revenue and cost per lead by source {period}",
    requires: [],
    keywords: [
      "source",
      "sources",
      "lead source",
      "marketing",
      "where leads come from",
      "by source",
    ],
  },
  "kpi.lead_source_mix": {
    id: "kpi.lead_source_mix",
    label: "Lead Source Mix",
    description: "Share of the period's leads from each source.",
    source: "analytics_stats",
    dateField: "leads.created_at",
    filters: ALL_FILTERS,
    caption: "Share of leads created {period}",
    requires: [],
    keywords: ["source mix", "mix"],
  },
  "kpi.ar_aging": {
    id: "kpi.ar_aging",
    label: "A/R Aging",
    description: "Balance owed on sent invoices by how far past due they are.",
    source: "analytics_stats",
    dateField: null,
    filters: ALL_FILTERS,
    caption: "Owed by days past due · right now",
    requires: MONEY,
    keywords: ["aging", "a/r aging", "ar aging"],
  },
  "kpi.backlog_by_work_type": {
    id: "kpi.backlog_by_work_type",
    label: "Backlog by Work Type",
    description:
      "Open work-order hours on Ready, Scheduled and In Progress jobs, as crew-days, by the job's first work type.",
    source: "analytics_stats",
    dateField: null,
    filters: ALL_FILTERS,
    caption: "Crew-days not yet done · right now",
    requires: [],
    keywords: ["backlog by work type"],
  },
  "kpi.executive_alerts": {
    id: "kpi.executive_alerts",
    label: "Executive Alerts",
    description:
      "Open Attention items by rule (untouched and aging leads, stalled jobs, approvals, overdue invoices, missed daily updates, weather risk, expiring estimates, subcontractor paperwork). Not filtered.",
    source: "analytics_stats",
    dateField: null,
    filters: [],
    caption: "Open Attention items · right now · each opens the Attention queue",
    requires: [],
    keywords: ["alerts", "attention", "problems", "what needs attention"],
  },
} as const satisfies Record<string, BreakdownDefinition>;
export type AnalyticsBreakdownId = keyof typeof ANALYTICS_BREAKDOWNS;

export function breakdownCaption(id: AnalyticsBreakdownId, words: PeriodWords): string {
  return fillWords(ANALYTICS_BREAKDOWNS[id].caption, words);
}

export type StageValueRow = {
  stage: JobStageId;
  label: string;
  color: string;
  jobs: number;
  valueCents: number | null;
};

/** Pipeline by Stage: every open stage in order, zeros included. */
export function pipelineByStage(s: AnalyticsStats): StageValueRow[] {
  const byStage = new Map(s.by_stage.map((r) => [r.stage, r]));
  return JOB_STAGES.filter((st) => st.id !== "closed_won" && st.id !== "closed_lost").map((st) => {
    const r = byStage.get(st.id);
    return {
      stage: st.id,
      label: st.label,
      color: st.color,
      jobs: r?.jobs ?? 0,
      valueCents: s.can_see_money ? (r?.value_cents ?? 0) : null,
    };
  });
}

export type FunnelRow = {
  key: "leads" | "contacted" | "walkthrough" | "estimate" | "sold";
  label: string;
  count: number;
  ofTotal: number | null;
  fromPrevious: number | null;
};

/** Lead Funnel: leads → contacted → walkthrough → estimate → sold. */
export function analyticsFunnel(s: AnalyticsStats): FunnelRow[] {
  const steps: { key: FunnelRow["key"]; label: string; count: number }[] = [
    { key: "leads", label: "Leads", count: s.funnel.leads },
    { key: "contacted", label: "Contacted", count: s.funnel.contacted },
    { key: "walkthrough", label: "Walkthrough", count: s.funnel.walkthrough },
    { key: "estimate", label: "Estimate sent", count: s.funnel.estimate },
    { key: "sold", label: "Sold", count: s.funnel.sold },
  ];
  return steps.map((st, i) => ({
    ...st,
    ofTotal: ratio(st.count, s.funnel.leads),
    fromPrevious: i === 0 ? null : ratio(st.count, steps[i - 1]!.count),
  }));
}

export type CityPerformanceRow = {
  territoryId: string | null;
  city: string;
  serviceArea: boolean;
  leads: number;
  soldJobs: number;
  soldCents: number | null;
  /** 1 = hottest; null when the city had no activity. */
  rank: number | null;
  /** 0–1 relative to the hottest city (bar length / heat color). */
  heat: number;
};

/** City Performance with a heat ranking: sold $ (if visible), then jobs, then leads. */
export function cityPerformance(s: AnalyticsStats): CityPerformanceRow[] {
  const score = (r: z.infer<typeof cityRowSchema>) => [
    s.can_see_money ? (r.sold_cents ?? 0) : 0,
    r.sold_jobs,
    r.leads,
  ];
  const active = s.by_city.filter((r) => r.leads > 0 || r.sold_jobs > 0);
  const ranked = [...active].sort((a, b) => {
    const [a1, a2, a3] = score(a);
    const [b1, b2, b3] = score(b);
    return b1! - a1! || b2! - a2! || b3! - a3! || a.city.localeCompare(b.city);
  });
  const rankOf = new Map(ranked.map((r, i) => [r, i + 1]));
  const top = ranked[0];
  const topValue = top
    ? s.can_see_money && (top.sold_cents ?? 0) > 0
      ? (top.sold_cents ?? 0)
      : top.sold_jobs > 0
        ? top.sold_jobs
        : top.leads
    : 0;
  return s.by_city.map((r) => {
    const v =
      s.can_see_money && top && (top.sold_cents ?? 0) > 0
        ? (r.sold_cents ?? 0)
        : top && top.sold_jobs > 0
          ? r.sold_jobs
          : r.leads;
    return {
      territoryId: r.territory_id,
      city: r.city,
      serviceArea: r.service_area,
      leads: r.leads,
      soldJobs: r.sold_jobs,
      soldCents: s.can_see_money ? (r.sold_cents ?? 0) : null,
      rank: rankOf.get(r) ?? null,
      heat: topValue > 0 ? Math.min(1, Math.max(0, v / topValue)) : 0,
    };
  });
}

export type EstimatorRow = {
  userId: string | null;
  name: string;
  soldCents: number;
  jobs: number;
  sent: number;
  closeRate: number | null;
};

/** Estimator Leaderboard: sold $ (accepted estimate value), jobs, close rate. */
export function estimatorLeaderboard(s: AnalyticsStats): EstimatorRow[] {
  return s.by_estimator.map((r) => ({
    userId: r.user_id,
    name: r.name,
    soldCents: r.accepted_value_cents,
    jobs: r.accepted,
    sent: r.sent,
    closeRate: ratio(r.cohort_accepted, r.sent),
  }));
}

export type SourcePerformanceRow = {
  source: string | null;
  label: string;
  leads: number;
  converted: number;
  conversion: number | null;
  soldJobs: number;
  soldCents: number | null;
  spendCents: number;
  costPerLead: number | null;
  /** Share of all leads in the period (the donut). */
  share: number | null;
};

/** Lead Source Performance (+ the Source Mix donut's shares). */
export function leadSourcePerformance(
  s: AnalyticsStats,
  labels: Readonly<Record<string, string>> = {},
): SourcePerformanceRow[] {
  return s.by_source.map((r) => {
    const converted = Math.min(r.converted, r.leads);
    return {
      source: r.source,
      label: r.source ? (labels[r.source] ?? r.source.replaceAll("_", " ")) : "No source",
      leads: r.leads,
      converted,
      conversion: ratio(converted, r.leads),
      soldJobs: r.sold_jobs,
      soldCents: s.can_see_money ? (r.sold_cents ?? 0) : null,
      spendCents: r.spend_cents,
      costPerLead:
        s.spend_applies && r.spend_cents > 0 && r.leads > 0
          ? Math.round(r.spend_cents / r.leads)
          : null,
      share: ratio(r.leads, s.leads_created),
    };
  });
}

export type AgingBucketRow = { key: string; label: string; cents: number | null };

/** A/R aging buckets in order (null amounts without financials:read). */
export function analyticsAging(s: AnalyticsStats): AgingBucketRow[] {
  const a = s.aging;
  const rows: [string, string, number | undefined][] = [
    ["current", "Current", a?.current],
    ["d1_30", "1–30 days", a?.d1_30],
    ["d31_60", "31–60 days", a?.d31_60],
    ["d61_90", "61–90 days", a?.d61_90],
    ["d90_plus", "90+ days", a?.d90_plus],
  ];
  return rows.map(([key, label, cents]) => ({
    key,
    label,
    cents: s.can_see_money ? (cents ?? 0) : null,
  }));
}

export type WorkTypeBacklogRow = { workType: string; hours: number; crewDays: number };

export function backlogByWorkType(s: AnalyticsStats): WorkTypeBacklogRow[] {
  return s.backlog_by_work_type.map((r) => ({
    workType: r.work_type,
    hours: r.hours,
    crewDays: Math.round((r.hours / s.crew_day_hours) * 10) / 10,
  }));
}

/** Executive Alerts (SPEC §8.2): label, open count, and the Attention filter it opens. */
export const EXECUTIVE_ALERTS = [
  { key: "untouched_lead", label: "Untouched new leads" },
  { key: "aging_lead", label: "Aging leads" },
  { key: "onboarding_stalled", label: "Stalled in onboarding" },
  { key: "ready_not_scheduled", label: "Ready, not scheduled" },
  { key: "start_date_missed", label: "Start dates missed" },
  { key: "approval_pending", label: "Approvals needed" },
  { key: "overdue_invoice", label: "Overdue invoices" },
  { key: "missed_daily_update", label: "Missed daily updates" },
  { key: "weather_risk", label: "Weather-risk exteriors (next 7 days)" },
  { key: "estimate_expiring", label: "Expiring estimates" },
  { key: "sub_compliance_expiring", label: "Subcontractor paperwork expiring" },
] as const satisfies readonly { key: AttentionRuleKey; label: string }[];

export type AlertRow = { key: AttentionRuleKey; label: string; open: number; href: string };

export function executiveAlerts(s: AnalyticsStats): AlertRow[] {
  return EXECUTIVE_ALERTS.map((a) => ({
    key: a.key,
    label: a.label,
    open: s.alerts[a.key] ?? 0,
    href: `/attention?type=${a.key}`,
  }));
}

/** Rule labels for alerts outside the list (kept in step with the attention catalog). */
export function attentionRuleLabel(key: AttentionRuleKey): string {
  return ATTENTION_RULES[key].label;
}

// --- Revenue Forecast (analytics_monthly) ----------------------------------

const monthRowSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sold_jobs: nCount,
  sold_cents: nullableCents,
  completed_jobs: nCount,
  completed_cents: nullableCents,
  collected_cents: nullableCents,
  goal_cents: nullableCents,
});
export const analyticsMonthlySchema = z.object({
  can_see_money: z.boolean().catch(false),
  months: z.array(monthRowSchema).catch([]),
});
export type AnalyticsMonthly = z.infer<typeof analyticsMonthlySchema>;
export const EMPTY_ANALYTICS_MONTHLY: AnalyticsMonthly = { can_see_money: false, months: [] };

export function parseAnalyticsMonthly(raw: unknown): AnalyticsMonthly {
  const parsed = analyticsMonthlySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_ANALYTICS_MONTHLY;
}

export type ForecastRow = {
  month: string;
  label: string;
  /** Sold value that month (null in the future, or without financials:read). */
  actualCents: number | null;
  /** Run-rate projection for the current month and future months. */
  projectedCents: number | null;
  goalCents: number | null;
  kind: "past" | "current" | "future";
};

/** "Mar 2026" from "2026-03-01". */
export const monthLabel = (iso: string) =>
  `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * Revenue Forecast rows. `today` is the Pacific day (YYYY-MM-DD) and
 * `dayOfMonth` / `daysInMonth` describe it. The current month projects its
 * month-to-date pace; future months use the average of the last 3 full
 * months (null when there are none).
 */
export function revenueForecast(
  m: AnalyticsMonthly,
  today: string,
  dayOfMonth: number,
  daysInMonth: number,
): ForecastRow[] {
  const current = `${today.slice(0, 7)}-01`;
  const past = m.months.filter((r) => r.month < current);
  const lastThree = past.slice(-3).filter((r) => r.sold_cents !== null);
  const trailing =
    lastThree.length > 0
      ? Math.round(lastThree.reduce((t, r) => t + (r.sold_cents ?? 0), 0) / lastThree.length)
      : null;
  return m.months.map((r) => {
    const kind: ForecastRow["kind"] =
      r.month < current ? "past" : r.month === current ? "current" : "future";
    const money = m.can_see_money;
    let projected: number | null = null;
    if (money && kind === "current" && r.sold_cents !== null && dayOfMonth > 0) {
      projected = Math.round((r.sold_cents / dayOfMonth) * daysInMonth);
    } else if (money && kind === "future") {
      projected = trailing;
    }
    return {
      month: r.month,
      label: monthLabel(r.month),
      actualCents: money && kind !== "future" ? (r.sold_cents ?? 0) : null,
      projectedCents: projected,
      goalCents: money ? r.goal_cents : null,
      kind,
    };
  });
}

/** True when no month in the series has a goal (the "No revenue goal configured" state). */
export function hasRevenueGoal(rows: readonly ForecastRow[]): boolean {
  return rows.some((r) => r.goalCents !== null);
}

// --- Exterior Season Backlog (season_backlog) --------------------------------

export const seasonBacklogSchema = z.object({
  season_start: z.string().catch(""),
  season_end: z.string().catch(""),
  crews: nCount,
  months: z
    .array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        capacity_crew_days: nCount,
        booked_crew_days: nCount,
      }),
    )
    .catch([]),
  unscheduled_jobs: nCount,
  unscheduled_crew_days: nCount,
});
export type SeasonBacklog = z.infer<typeof seasonBacklogSchema>;
export const EMPTY_SEASON_BACKLOG: SeasonBacklog = seasonBacklogSchema.parse({});

export function parseSeasonBacklog(raw: unknown): SeasonBacklog {
  const parsed = seasonBacklogSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_SEASON_BACKLOG;
}

export type SeasonMonthRow = {
  month: string;
  label: string;
  booked: number;
  capacity: number;
  /** Booked ÷ capacity (0–1; null with no capacity). */
  utilization: number | null;
};

export function seasonBacklogRows(s: SeasonBacklog): SeasonMonthRow[] {
  return s.months.map((r) => ({
    month: r.month,
    label: monthLabel(r.month),
    booked: r.booked_crew_days,
    capacity: r.capacity_crew_days,
    utilization: ratio(r.booked_crew_days, r.capacity_crew_days),
  }));
}

export function seasonTotals(s: SeasonBacklog): {
  booked: number;
  capacity: number;
  utilization: number | null;
  unscheduledJobs: number;
  unscheduledCrewDays: number;
} {
  const booked = s.months.reduce((t, r) => t + r.booked_crew_days, 0);
  const capacity = s.months.reduce((t, r) => t + r.capacity_crew_days, 0);
  return {
    booked,
    capacity,
    utilization: ratio(booked, capacity),
    unscheduledJobs: s.unscheduled_jobs,
    unscheduledCrewDays: s.unscheduled_crew_days,
  };
}

// ===========================================================================
// MY NUMBERS (Phase 9): SPEC §8.15 — one person's scoreboard
// ===========================================================================
//
// Source: `public.my_numbers(p_user, p_from, p_to)`. Each card filters on its
// own date field (the page says so). Row security applies: a rep reads their
// own records; owners can pick any rep.

export const myNumbersSchema = z.object({
  leads_issued: nCount,
  walkthroughs_set: nCount,
  walkthroughs_ran: nCount,
  estimates_sent: nCount,
  sold_count: nCount,
  sold_cents: nCount,
  completed: nCount,
  invoiced: nCount,
  paid: nCount,
});
export type MyNumbers = z.infer<typeof myNumbersSchema>;
export const EMPTY_MY_NUMBERS: MyNumbers = myNumbersSchema.parse({});

export function parseMyNumbers(raw: unknown): MyNumbers {
  const parsed = myNumbersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_MY_NUMBERS;
}

function mine(
  def: Omit<MetricDefinition<"my_numbers">, "source" | "ownerOnly" | "filters"> & {
    dateField: string;
  },
): MetricDefinition<"my_numbers"> & { dateField: string } {
  return { ownerOnly: false, filters: ["owner"], ...def, source: "my_numbers" };
}

export const MY_NUMBERS_METRICS = {
  "mine.leads_issued": mine({
    id: "mine.leads_issued",
    label: "Leads Issued",
    description: "Leads assigned to you that came in during the period.",
    unit: "count",
    dateField: "leads.created_at",
    caption: "Your leads, by date created",
    compute: (s) => s.leads_issued,
  }),
  "mine.walkthroughs_set": mine({
    id: "mine.walkthroughs_set",
    label: "Walkthroughs Set",
    description: "Walkthroughs you booked during the period.",
    unit: "count",
    dateField: "appointments.created_at",
    caption: "Booked by you, by date booked",
    compute: (s) => s.walkthroughs_set,
  }),
  "mine.walkthroughs_ran": mine({
    id: "mine.walkthroughs_ran",
    label: "Walkthroughs Ran",
    description: "Walkthroughs you were on that were completed during the period.",
    unit: "count",
    dateField: "appointments.completed_at",
    caption: "Completed, by date completed",
    compute: (s) => s.walkthroughs_ran,
  }),
  "mine.estimates_sent": mine({
    id: "mine.estimates_sent",
    label: "Estimates Sent",
    description: "Your estimates first sent during the period.",
    unit: "count",
    dateField: "estimate_versions.sent_at (first send)",
    caption: "By date first sent",
    compute: (s) => s.estimates_sent,
  }),
  "mine.sold_count": mine({
    id: "mine.sold_count",
    label: "Sold",
    description: "Your estimates accepted during the period.",
    unit: "count",
    dateField: "estimates.accepted_at",
    caption: "By date accepted",
    compute: (s) => s.sold_count,
  }),
  "mine.sold_value": mine({
    id: "mine.sold_value",
    label: "Sold ($)",
    description: "Accepted value of your estimates accepted during the period.",
    unit: "money",
    dateField: "estimates.accepted_at",
    caption: "Accepted estimate totals, by date accepted",
    compute: (s) => s.sold_cents,
  }),
  "mine.completed": mine({
    id: "mine.completed",
    label: "Completed",
    description: "Your jobs that reached Completed during the period.",
    unit: "count",
    dateField: "jobs.completed_at",
    caption: "By date completed",
    compute: (s) => s.completed,
  }),
  "mine.invoiced": mine({
    id: "mine.invoiced",
    label: "Invoiced",
    description: "Your jobs whose final invoice was sent during the period.",
    unit: "count",
    dateField: "jobs.final_invoiced_at",
    caption: "By date the final invoice was sent",
    compute: (s) => s.invoiced,
  }),
  "mine.paid": mine({
    id: "mine.paid",
    label: "Paid in full",
    description: "Your jobs paid in full during the period.",
    unit: "count",
    dateField: "jobs.paid_in_full_at",
    caption: "By date paid in full",
    compute: (s) => s.paid,
  }),
} as const satisfies Record<string, MetricDefinition<"my_numbers"> & { dateField: string }>;
export type MyNumbersMetricId = keyof typeof MY_NUMBERS_METRICS;

export function myNumbersValue(id: MyNumbersMetricId, s: MyNumbers): MetricValue {
  const m: MetricDefinition<"my_numbers"> = MY_NUMBERS_METRICS[id];
  const raw = m.compute(s);
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

// ===========================================================================
// MY DAY (Phase 9): SPEC §8.3 Workspace counts
// ===========================================================================
//
// Source: `public.workspace_summary()` — the signed-in person's counts for
// today (Pacific), row security applied.

export const workspaceSummarySchema = z.object({
  tasks_due_today: nCount,
  tasks_overdue: nCount,
  tasks_upcoming: nCount,
  tasks_no_due: nCount,
  appointments_today: nCount,
  jobs_active: nCount,
  jobs_need_action: nCount,
  jobs_at_risk: nCount,
  leads_new: nCount,
  leads_awaiting_contact: nCount,
  leads_follow_ups_today: nCount,
  leads_converted_today: nCount,
  cases_open: nCount,
  cases_overdue: nCount,
  unread_email: nCount,
  unread_sms: nCount,
  mentions_unread: nCount,
  notifications_unread: nCount,
  attention_open: nCount,
  attention_urgent: nCount,
  attention_by_category: z.record(z.string(), nCount).catch({}),
  approvals_pending: nCount,
  estimates_awaiting_reply: nCount,
});
export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export const EMPTY_WORKSPACE_SUMMARY: WorkspaceSummary = workspaceSummarySchema.parse({});

export function parseWorkspaceSummary(raw: unknown): WorkspaceSummary {
  const parsed = workspaceSummarySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_WORKSPACE_SUMMARY;
}

function myDay(
  def: Omit<MetricDefinition<"workspace_summary">, "source" | "ownerOnly" | "unit">,
): MetricDefinition<"workspace_summary"> {
  return { ownerOnly: false, unit: "count", filters: [], ...def, source: "workspace_summary" };
}

export const WORKSPACE_METRICS = {
  "myday.tasks_due_today": myDay({
    id: "myday.tasks_due_today",
    label: "Due today",
    description: "Your open tasks due today (Pacific).",
    dateField: "tasks.due_at (today)",
    caption: "Open tasks due today",
    compute: (s) => s.tasks_due_today,
  }),
  "myday.tasks_overdue": myDay({
    id: "myday.tasks_overdue",
    label: "Overdue",
    description: "Your open tasks due before today.",
    dateField: "tasks.due_at",
    caption: "Open tasks due before today",
    compute: (s) => s.tasks_overdue,
  }),
  "myday.tasks_upcoming": myDay({
    id: "myday.tasks_upcoming",
    label: "Upcoming",
    description: "Your open tasks due after today.",
    dateField: "tasks.due_at",
    caption: "Due after today",
    compute: (s) => s.tasks_upcoming,
  }),
  "myday.tasks_no_due": myDay({
    id: "myday.tasks_no_due",
    label: "No due date",
    description: "Your open tasks with no due date.",
    dateField: null,
    caption: "No due date",
    compute: (s) => s.tasks_no_due,
  }),
  "myday.appointments_today": myDay({
    id: "myday.appointments_today",
    label: "Appointments today",
    description: "Appointments you're on today (canceled and rescheduled ones left out).",
    dateField: "appointments.starts_at (today)",
    caption: "On your calendar today",
    compute: (s) => s.appointments_today,
  }),
  "myday.jobs_active": myDay({
    id: "myday.jobs_active",
    label: "Active jobs",
    description: "Open jobs you're on (owner, point of contact, project manager, team or crew).",
    dateField: null,
    caption: "Open jobs you're on",
    compute: (s) => s.jobs_active,
  }),
  "myday.jobs_need_action": myDay({
    id: "myday.jobs_need_action",
    label: "Need action",
    description: "Your jobs with an open Attention item you own.",
    dateField: null,
    caption: "Jobs with your open Attention items",
    compute: (s) => s.jobs_need_action,
  }),
  "myday.jobs_at_risk": myDay({
    id: "myday.jobs_at_risk",
    label: "At risk",
    description: "Your open jobs with a health score under 60.",
    dateField: null,
    caption: "Health under 60",
    compute: (s) => s.jobs_at_risk,
  }),
  "myday.leads_new": myDay({
    id: "myday.leads_new",
    label: "New today",
    description: "Leads assigned to you that came in today.",
    dateField: "leads.created_at (today)",
    caption: "Your leads created today",
    compute: (s) => s.leads_new,
  }),
  "myday.leads_awaiting_contact": myDay({
    id: "myday.leads_awaiting_contact",
    label: "Awaiting contact",
    description: "Your new leads nobody has called, texted or emailed yet.",
    dateField: null,
    caption: "Not reached yet",
    compute: (s) => s.leads_awaiting_contact,
  }),
  "myday.leads_follow_ups_today": myDay({
    id: "myday.leads_follow_ups_today",
    label: "Follow-ups today",
    description: "Your lead tasks due today.",
    dateField: "tasks.due_at (today)",
    caption: "Lead tasks due today",
    compute: (s) => s.leads_follow_ups_today,
  }),
  "myday.leads_converted_today": myDay({
    id: "myday.leads_converted_today",
    label: "Converted today",
    description: "Your leads converted to a job today.",
    dateField: "leads.converted_at (today)",
    caption: "Became a job today",
    compute: (s) => s.leads_converted_today,
  }),
  "myday.cases_open": myDay({
    id: "myday.cases_open",
    label: "Open cases",
    description: "Warranty and service cases you own that aren't resolved.",
    dateField: null,
    caption: "Yours, not resolved",
    compute: (s) => s.cases_open,
  }),
  "myday.cases_overdue": myDay({
    id: "myday.cases_overdue",
    label: "Past SLA",
    description: "Your open cases past their SLA.",
    dateField: null,
    caption: "Yours, past SLA",
    compute: (s) => s.cases_overdue,
  }),
  "myday.unread_email": myDay({
    id: "myday.unread_email",
    label: "Unread email",
    description: "Customer conversations you can see whose last message is an unread email.",
    dateField: null,
    caption: "Conversations, email",
    compute: (s) => s.unread_email,
  }),
  "myday.unread_sms": myDay({
    id: "myday.unread_sms",
    label: "Unread texts",
    description: "Customer conversations you can see whose last message is an unread text.",
    dateField: null,
    caption: "Conversations, text",
    compute: (s) => s.unread_sms,
  }),
  "myday.mentions_unread": myDay({
    id: "myday.mentions_unread",
    label: "Mentions",
    description: "Unread @mentions of you.",
    dateField: null,
    caption: "Unread @mentions",
    compute: (s) => s.mentions_unread,
  }),
  "myday.notifications_unread": myDay({
    id: "myday.notifications_unread",
    label: "Notifications",
    description: "Your unread notifications.",
    dateField: null,
    caption: "Unread",
    compute: (s) => s.notifications_unread,
  }),
  "myday.attention_open": myDay({
    id: "myday.attention_open",
    label: "Needs my attention",
    description: "Open Attention items you own.",
    dateField: null,
    caption: "Yours, open",
    compute: (s) => s.attention_open,
  }),
  "myday.approvals_pending": myDay({
    id: "myday.approvals_pending",
    label: "Approvals",
    description:
      "Requests waiting for a decision: all of them if you approve, otherwise your own requests.",
    dateField: null,
    caption: "Waiting for a decision",
    compute: (s) => s.approvals_pending,
  }),
  "myday.estimates_awaiting_reply": myDay({
    id: "myday.estimates_awaiting_reply",
    label: "Awaiting reply",
    description: "Your estimates sent and not answered yet.",
    dateField: null,
    caption: "Your estimates waiting on the customer",
    compute: (s) => s.estimates_awaiting_reply,
  }),
} as const satisfies Record<string, MetricDefinition<"workspace_summary">>;
export type WorkspaceMetricId = keyof typeof WORKSPACE_METRICS;

export function workspaceMetricValue(id: WorkspaceMetricId, s: WorkspaceSummary): number {
  const m: MetricDefinition<"workspace_summary"> = WORKSPACE_METRICS[id];
  return m.compute(s) ?? 0;
}

// ===========================================================================
// DAILY BRIEF (Phase 9): SPEC §8.14 — what changed on a day
// ===========================================================================

export const dailyBriefSchema = z.object({
  day: z.string().catch(""),
  can_see_money: z.boolean().catch(false),
  leads_created: nCount,
  walkthroughs_completed: nCount,
  estimates_sent: nCount,
  estimates_accepted: nCount,
  accepted_value_cents: nCount,
  jobs_started: nCount,
  jobs_completed: nCount,
  daily_logs: nCount,
  invoices_sent: nullableNumber,
  collected_cents: nullableCents,
  reviews_left: nCount,
  attention_now: nCount,
  attention_open: nCount,
  overdue_invoices: nullableNumber,
  approvals_pending: nCount,
  unread_conversations: nCount,
  ready_to_schedule: nCount,
});
export type DailyBrief = z.infer<typeof dailyBriefSchema>;
export const EMPTY_DAILY_BRIEF: DailyBrief = dailyBriefSchema.parse({});

export function parseDailyBrief(raw: unknown): DailyBrief {
  const parsed = dailyBriefSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_DAILY_BRIEF;
}

function brief(
  def: Omit<MetricDefinition<"daily_brief">, "source" | "ownerOnly" | "filters">,
): MetricDefinition<"daily_brief"> {
  return { ownerOnly: false, filters: [], ...def, source: "daily_brief" };
}

export const DAILY_BRIEF_METRICS = {
  "brief.leads_created": brief({
    id: "brief.leads_created",
    label: "New leads",
    description: "Leads that came in that day.",
    unit: "count",
    dateField: "leads.created_at",
    caption: "Created that day",
    compute: (s) => s.leads_created,
  }),
  "brief.walkthroughs_completed": brief({
    id: "brief.walkthroughs_completed",
    label: "Walkthroughs done",
    description: "Walkthroughs completed that day.",
    unit: "count",
    dateField: "appointments.completed_at",
    caption: "Completed that day",
    compute: (s) => s.walkthroughs_completed,
  }),
  "brief.estimates_sent": brief({
    id: "brief.estimates_sent",
    label: "Estimates sent",
    description: "Estimate versions sent that day.",
    unit: "count",
    dateField: "estimate_versions.sent_at",
    caption: "Sent that day",
    compute: (s) => s.estimates_sent,
  }),
  "brief.estimates_accepted": brief({
    id: "brief.estimates_accepted",
    label: "Estimates accepted",
    description: "Estimates accepted that day.",
    unit: "count",
    dateField: "estimates.accepted_at",
    caption: "Accepted that day",
    compute: (s) => s.estimates_accepted,
  }),
  "brief.accepted_value": brief({
    id: "brief.accepted_value",
    label: "Accepted value",
    description: "Total of the estimates accepted that day.",
    unit: "money",
    dateField: "estimates.accepted_at",
    caption: "Accepted that day",
    compute: (s) => s.accepted_value_cents,
  }),
  "brief.jobs_started": brief({
    id: "brief.jobs_started",
    label: "Jobs started",
    description: "Jobs whose actual start was that day.",
    unit: "count",
    dateField: "jobs.actual_start_date",
    caption: "Started that day",
    compute: (s) => s.jobs_started,
  }),
  "brief.jobs_completed": brief({
    id: "brief.jobs_completed",
    label: "Jobs completed",
    description: "Jobs that reached Completed that day.",
    unit: "count",
    dateField: "jobs.completed_at",
    caption: "Completed that day",
    compute: (s) => s.jobs_completed,
  }),
  "brief.daily_logs": brief({
    id: "brief.daily_logs",
    label: "Daily logs",
    description: "Daily logs for that day.",
    unit: "count",
    dateField: "daily_logs.log_date",
    caption: "Logged for that day",
    compute: (s) => s.daily_logs,
  }),
  "brief.invoices_sent": brief({
    id: "brief.invoices_sent",
    label: "Invoices sent",
    description: "Invoices sent that day.",
    unit: "count",
    dateField: "invoices.sent_at",
    caption: "Sent that day",
    requires: MONEY,
    compute: (s) => s.invoices_sent,
  }),
  "brief.collected": brief({
    id: "brief.collected",
    label: "Collected",
    description: "Payments received that day and applied to invoices.",
    unit: "money",
    dateField: "payments.received_on",
    caption: "Received that day",
    requires: MONEY,
    compute: (s) => s.collected_cents,
  }),
  "brief.reviews_left": brief({
    id: "brief.reviews_left",
    label: "Reviews left",
    description: "Reviews customers left that day.",
    unit: "count",
    dateField: "review_requests.review_left_at",
    caption: "Left that day",
    compute: (s) => s.reviews_left,
  }),
  "brief.attention_now": brief({
    id: "brief.attention_now",
    label: "Needs attention now",
    description: "Critical and high Attention items still pending, right now.",
    unit: "count",
    dateField: null,
    caption: "Right now",
    compute: (s) => s.attention_now,
  }),
  "brief.overdue_invoices": brief({
    id: "brief.overdue_invoices",
    label: "Overdue invoices",
    description: "Sent invoices past due with money owed, right now.",
    unit: "count",
    dateField: null,
    caption: "Right now",
    requires: MONEY,
    compute: (s) => s.overdue_invoices,
  }),
  "brief.approvals_pending": brief({
    id: "brief.approvals_pending",
    label: "Approvals waiting",
    description: "Requests waiting for an owner, right now.",
    unit: "count",
    dateField: null,
    caption: "Right now",
    compute: (s) => s.approvals_pending,
  }),
  "brief.unread_conversations": brief({
    id: "brief.unread_conversations",
    label: "Unread conversations",
    description: "Customer conversations with an unread message, right now.",
    unit: "count",
    dateField: null,
    caption: "Right now",
    compute: (s) => s.unread_conversations,
  }),
  "brief.ready_to_schedule": brief({
    id: "brief.ready_to_schedule",
    label: "Ready to schedule",
    description: "Jobs waiting for dates, right now.",
    unit: "count",
    dateField: null,
    caption: "Right now",
    compute: (s) => s.ready_to_schedule,
  }),
} as const satisfies Record<string, MetricDefinition<"daily_brief">>;
export type DailyBriefMetricId = keyof typeof DAILY_BRIEF_METRICS;

export function dailyBriefValue(id: DailyBriefMetricId, s: DailyBrief): MetricValue {
  const m: MetricDefinition<"daily_brief"> = DAILY_BRIEF_METRICS[id];
  const raw = m.compute(s);
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

// ===========================================================================
// Where each source comes from (SPEC §12.1 "source RPC, date field, filters")
// ===========================================================================

export type SourceInfo = {
  /** Postgres function (or server builder) the payload comes from. */
  rpc: string;
  /** Default date column for the source's metrics (null: right now / all time). */
  dateField: string | null;
  /** Filters the source supports. */
  filters: readonly MetricFilter[];
};

export const SOURCE_INFO: Record<MetricSource, SourceInfo> = {
  lead_stats: { rpc: "lead_stats()", dateField: null, filters: [] },
  job_stats: {
    rpc: "job_stats(from, to, prev_from)",
    dateField: "jobs.estimate_accepted_at / closed_at",
    filters: [],
  },
  job_status_counts: { rpc: "job_status_counts()", dateField: null, filters: [] },
  attention_summary: { rpc: "attention_summary()", dateField: null, filters: [] },
  approval_counts: {
    rpc: "approval_requests (count: exact, head)",
    dateField: "approval_requests.decided_at (30 days)",
    filters: [],
  },
  estimate_stats: {
    rpc: "estimate_stats(from, to)",
    dateField: "estimate_versions.sent_at (first send)",
    filters: [],
  },
  document_stats: { rpc: "document_stats(job)", dateField: null, filters: [] },
  onboarding_board: {
    rpc: "lib/onboarding/board.ts (all board jobs)",
    dateField: null,
    filters: [],
  },
  production_stats: {
    rpc: "production_stats()",
    dateField: "rolling 7 / 30 / 90 days",
    filters: [],
  },
  schedule_board: { rpc: "lib/production/board.ts (bars in view)", dateField: null, filters: [] },
  finance_stats: { rpc: "finance_stats(from, to)", dateField: "per metric", filters: [] },
  communication_stats: {
    rpc: "communication_stats(from, to)",
    dateField: "per metric (default last 90 days)",
    filters: [],
  },
  analytics_stats: {
    rpc: "analytics_stats(from, to, filters)",
    dateField: "per metric",
    filters: ALL_FILTERS,
  },
  my_numbers: { rpc: "my_numbers(user, from, to)", dateField: "per card", filters: ["owner"] },
  workspace_summary: { rpc: "workspace_summary()", dateField: "today (Pacific)", filters: [] },
  daily_brief: { rpc: "daily_brief(day)", dateField: "that Pacific day", filters: [] },
};

export type MetricSpec = {
  id: string;
  label: string;
  description: string;
  source: MetricSource;
  rpc: string;
  dateField: string | null;
  filters: readonly MetricFilter[];
  unit: MetricUnit;
  caption: string;
  ownerOnly: boolean;
  requires: readonly Permission[];
};

export const METRICS = {
  ...ANALYTICS_METRICS,
  ...MY_NUMBERS_METRICS,
  ...WORKSPACE_METRICS,
  ...DAILY_BRIEF_METRICS,
  ...COMMUNICATION_METRICS,
  ...FINANCE_METRICS,
  ...PRODUCTION_METRICS,
  ...SCHEDULE_BOARD_METRICS,
  ...LEAD_METRICS,
  ...DOCUMENT_METRICS,
  ...BOARD_METRICS,
  ...ESTIMATE_METRICS,
  ...JOB_METRICS,
  ...JOB_COUNT_METRICS,
  ...ATTENTION_METRICS,
  ...APPROVAL_METRICS,
} as const;
export type MetricId = keyof typeof METRICS;

/** A metric of any source (each definition keeps its own source type). */
export type AnyMetricDefinition = { [S in MetricSource]: MetricDefinition<S> }[MetricSource];

export function getMetric(id: MetricId): AnyMetricDefinition {
  return METRICS[id];
}

/**
 * Everything SPEC §12.1 asks the registry to say about a metric: id, label,
 * description, source RPC, the date field it filters on, supported filters,
 * unit, formula caption template and owner-only flag (+ permissions).
 */
export function metricSpec(id: MetricId): MetricSpec {
  const m = getMetric(id);
  const info = SOURCE_INFO[m.source];
  return {
    id: m.id,
    label: m.label,
    description: m.description,
    source: m.source,
    rpc: info.rpc,
    dateField: m.dateField === undefined ? info.dateField : m.dateField,
    filters: m.filters ?? info.filters,
    unit: m.unit,
    caption: m.caption,
    ownerOnly: m.ownerOnly,
    requires: m.requires ?? [],
  };
}

/** Every metric id (for the catalog and coverage tests). */
export function allMetricIds(): MetricId[] {
  return Object.keys(METRICS) as MetricId[];
}
