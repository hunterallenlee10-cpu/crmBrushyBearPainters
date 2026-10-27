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

/** Every registered metric, by id. Later phases spread their groups in here. */
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

export const METRICS = {
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
