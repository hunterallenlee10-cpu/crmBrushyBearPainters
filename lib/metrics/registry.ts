import { z } from "zod";
import {
  AGING_BUCKETS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  STALE_AFTER_DAYS,
  type LeadStatus,
} from "@/lib/domain/leads/constants";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";

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

export type MetricSources = { lead_stats: LeadStats };
export type MetricSource = keyof MetricSources;

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

export type MetricUnit = "count" | "percent" | "duration";

export type MetricDefinition<S extends MetricSource = MetricSource> = {
  id: string;
  label: string;
  description: string;
  /** Server-side aggregate (RPC) the metric reads. */
  source: S;
  /** "count": whole number; "percent": ratio 0–1; "duration": seconds. */
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

/** Every registered metric, by id. Later phases spread their groups in here. */
export const METRICS = { ...LEAD_METRICS } as const;
export type MetricId = keyof typeof METRICS;

export function getMetric(id: MetricId): MetricDefinition {
  return METRICS[id];
}

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
