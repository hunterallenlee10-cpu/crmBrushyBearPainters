import type { Permission } from "@/lib/permissions";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  type AnalyticsBreakdownId,
  type AnalyticsMetricId,
} from "@/lib/metrics/registry";

/**
 * Analytics dashboards (SPEC §8.14): prebuilt ones defined here, custom ones
 * saved in `dashboards.widgets` as a list of registry ids — a KPI tile is an
 * ANALYTICS_METRICS id, a chart an ANALYTICS_BREAKDOWNS id. Pure.
 */

export type DashboardDefinition = {
  key: string;
  name: string;
  description: string;
  kpis: readonly AnalyticsMetricId[];
  charts: readonly AnalyticsBreakdownId[];
  requires: readonly Permission[];
};

export const PREBUILT_DASHBOARDS: readonly DashboardDefinition[] = [
  {
    key: "executive",
    name: "Executive",
    description:
      "The Executive Overview: pipeline, promises, revenue, cities, estimators and sources.",
    kpis: [
      "kpi.pipeline_value",
      "kpi.projected_revenue",
      "kpi.estimates_sent",
      "kpi.close_rate",
      "kpi.avg_job_value",
      "kpi.sales_velocity",
      "kpi.speed_to_lead_median",
      "kpi.sla_24h",
      "kpi.daily_update_compliance",
      "kpi.on_time_start",
      "kpi.gross_margin_completed",
      "kpi.ar_outstanding",
    ],
    charts: [
      "kpi.pipeline_by_stage",
      "kpi.revenue_forecast",
      "kpi.lead_funnel",
      "kpi.season_backlog",
      "kpi.city_performance",
      "kpi.estimator_leaderboard",
      "kpi.lead_source_performance",
      "kpi.lead_source_mix",
      "kpi.executive_alerts",
    ],
    requires: [],
  },
  {
    key: "sales",
    name: "Sales / Estimator",
    description: "Estimates, close rates, the 24-hour SLA, velocity and who sold what.",
    kpis: [
      "kpi.estimates_sent",
      "kpi.sla_24h",
      "kpi.close_rate",
      "kpi.close_rate_value",
      "kpi.avg_job_value",
      "kpi.sales_velocity",
      "kpi.revenue_sold",
      "kpi.pipeline_open_estimates",
    ],
    charts: ["kpi.estimator_leaderboard", "kpi.lead_funnel", "kpi.pipeline_by_stage"],
    requires: [],
  },
  {
    key: "production",
    name: "Production",
    description: "Backlog, daily updates, on-time starts, rain days, punch items and labor hours.",
    kpis: [
      "kpi.backlog_crew_days",
      "kpi.daily_update_compliance",
      "kpi.on_time_start",
      "kpi.rain_delay_days",
      "kpi.punch_per_job",
      "kpi.completed_jobs",
      "kpi.labor_hours_estimated",
      "kpi.labor_hours_actual",
      "kpi.labor_hours_variance",
    ],
    charts: ["kpi.backlog_by_work_type", "kpi.season_backlog", "kpi.pipeline_by_stage"],
    requires: [],
  },
  {
    key: "marketing",
    name: "Marketing & Lead Sources",
    description:
      "Lead volume, speed to lead, sources, spend, cost per lead, reviews and referrals.",
    kpis: [
      "kpi.leads_created",
      "kpi.speed_to_lead_median",
      "kpi.contact_rate",
      "kpi.walkthrough_set_rate",
      "kpi.walkthrough_show_rate",
      "kpi.marketing_spend",
      "kpi.cost_per_lead",
      "kpi.cac",
      "kpi.review_rate",
      "kpi.referrals",
      "kpi.referral_conversions",
    ],
    charts: [
      "kpi.lead_source_performance",
      "kpi.lead_source_mix",
      "kpi.city_performance",
      "kpi.lead_funnel",
    ],
    requires: [],
  },
  {
    key: "ar",
    name: "A/R Aging",
    description: "What customers owe, how late it is, and how fast it comes in.",
    kpis: [
      "kpi.ar_outstanding",
      "kpi.ar_overdue",
      "kpi.collection_rate",
      "kpi.revenue_collected",
      "kpi.days_completed_to_paid",
    ],
    charts: ["kpi.ar_aging"],
    requires: ["financials:read"],
  },
  {
    key: "seasonality",
    name: "Seasonality / Exterior Backlog",
    description:
      "The exterior season: booked crew-days against capacity, and sold revenue by month.",
    kpis: ["kpi.backlog_crew_days", "kpi.revenue_sold", "kpi.projected_revenue", "kpi.sold_jobs"],
    charts: ["kpi.season_backlog", "kpi.revenue_forecast", "kpi.backlog_by_work_type"],
    requires: [],
  },
];

export function prebuiltDashboard(key: string): DashboardDefinition | undefined {
  return PREBUILT_DASHBOARDS.find((d) => d.key === key);
}

export function isMetricWidget(id: string): id is AnalyticsMetricId {
  return id in ANALYTICS_METRICS;
}
export function isChartWidget(id: string): id is AnalyticsBreakdownId {
  return id in ANALYTICS_BREAKDOWNS;
}

/** A custom dashboard's widgets split into tiles and charts (unknown ids dropped). */
export function splitWidgets(widgets: readonly string[]): {
  kpis: AnalyticsMetricId[];
  charts: AnalyticsBreakdownId[];
} {
  const kpis: AnalyticsMetricId[] = [];
  const charts: AnalyticsBreakdownId[] = [];
  for (const w of widgets) {
    if (isMetricWidget(w) && !kpis.includes(w)) kpis.push(w);
    else if (isChartWidget(w) && !charts.includes(w)) charts.push(w);
  }
  return { kpis, charts };
}

/** Everything a custom dashboard can hold, for the picker. */
export function widgetCatalog(): { id: string; label: string; kind: "kpi" | "chart" }[] {
  return [
    ...(Object.keys(ANALYTICS_METRICS) as AnalyticsMetricId[]).map((id) => ({
      id,
      label: ANALYTICS_METRICS[id].label,
      kind: "kpi" as const,
    })),
    ...(Object.keys(ANALYTICS_BREAKDOWNS) as AnalyticsBreakdownId[]).map((id) => ({
      id,
      label: ANALYTICS_BREAKDOWNS[id].label,
      kind: "chart" as const,
    })),
  ];
}
