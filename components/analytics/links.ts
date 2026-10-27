import type { FilterSpec, Rule } from "@/lib/lists/filters";
import type { DateRange } from "@/lib/domain/analytics/periods";
import type { AnalyticsFilters } from "@/lib/domain/analytics/filters";
import type { AnalyticsMetricId } from "@/lib/metrics/registry";
import { leadListHref } from "@/app/(app)/leads/_dashboard/links";
import { jobListHref, stageHref } from "@/app/(app)/jobs/_dashboard/links";

/**
 * Drill-downs from analytics cards and charts into the filtered lists
 * (SPEC §8 "clicking a card drills into the filtered list"). Lists filter by
 * Pacific calendar day, like the Lead and Jobs dashboards.
 */

export type TemplateIds = Readonly<Record<string, string>>;

const all = (...rules: (Rule | null)[]): FilterSpec => ({
  match: "all",
  rules: rules.filter((r): r is Rule => r !== null),
});

function leadRules(f: AnalyticsFilters): Rule[] {
  const rules: (Rule | null)[] = [
    f.territory_id ? { field: "territory", op: "equals", value: f.territory_id } : null,
    f.owner_id ? { field: "owner", op: "equals", value: f.owner_id } : null,
    f.source ? { field: "source", op: "equals", value: f.source } : null,
  ];
  return rules.filter((r): r is Rule => r !== null);
}
function jobRules(f: AnalyticsFilters): Rule[] {
  const rules: (Rule | null)[] = [
    f.work_type ? { field: "work_type", op: "contains", value: f.work_type } : null,
    f.territory_id ? { field: "territory", op: "equals", value: f.territory_id } : null,
    f.owner_id ? { field: "owner", op: "equals", value: f.owner_id } : null,
    f.source ? { field: "source", op: "equals", value: f.source } : null,
  ];
  return rules.filter((r): r is Rule => r !== null);
}

const between = (field: string, r: DateRange): Rule => ({
  field,
  op: "between",
  value: r.firstDay,
  value2: r.lastDay,
});

export function leadsCreatedHref(r: DateRange, f: AnalyticsFilters): string {
  return leadListHref({ tab: "all", filter: all(between("created", r), ...leadRules(f)) });
}

export function jobsSoldHref(r: DateRange, f: AnalyticsFilters): string {
  return jobListHref({ tab: "all", filter: all(between("sold", r), ...jobRules(f)) });
}

export function openJobsHref(f: AnalyticsFilters): string {
  return jobListHref({ filter: all(...jobRules(f)) });
}

export { stageHref };

export function reportHref(templates: TemplateIds, key: string): string {
  const id = templates[key];
  return id ? `/analytics/reports/${id}` : "/analytics/reports?tab=templates";
}

/** Where a KPI card goes when clicked. */
export function metricHref(
  id: AnalyticsMetricId,
  r: DateRange,
  f: AnalyticsFilters,
  templates: TemplateIds,
): string | undefined {
  switch (id) {
    case "kpi.leads_created":
    case "kpi.contact_rate":
    case "kpi.walkthrough_set_rate":
      return leadsCreatedHref(r, f);
    case "kpi.speed_to_lead_median":
    case "kpi.speed_to_lead_p90":
      return reportHref(templates, "speed_to_lead");
    case "kpi.walkthrough_show_rate":
      return leadsCreatedHref(r, f);
    case "kpi.estimates_sent":
    case "kpi.close_rate":
    case "kpi.close_rate_value":
      return reportHref(templates, "estimates_sent_vs_accepted");
    case "kpi.sla_24h":
      return reportHref(templates, "sla_24h_misses");
    case "kpi.avg_job_value":
    case "kpi.sales_velocity":
    case "kpi.sold_jobs":
    case "kpi.revenue_sold":
    case "kpi.projected_revenue":
      return jobsSoldHref(r, f);
    case "kpi.pipeline_value":
    case "kpi.pipeline_sold_not_started":
      return openJobsHref(f);
    case "kpi.pipeline_open_estimates":
    case "kpi.expiring_estimates":
      return "/estimates";
    case "kpi.revenue_completed":
    case "kpi.completed_jobs":
    case "kpi.punch_per_job":
    case "kpi.labor_hours_estimated":
    case "kpi.labor_hours_actual":
    case "kpi.labor_hours_variance":
      return stageHref("completed");
    case "kpi.gross_margin_completed":
      return reportHref(templates, "gross_margin_by_job");
    case "kpi.revenue_collected":
    case "kpi.collection_rate":
      return "/invoices";
    case "kpi.ar_outstanding":
    case "kpi.ar_overdue":
    case "kpi.days_completed_to_paid":
      return "/invoices/aging";
    case "kpi.daily_update_compliance":
      return reportHref(templates, "jobs_missing_daily_logs");
    case "kpi.on_time_start":
      return reportHref(templates, "on_time_start_misses");
    case "kpi.rain_delay_days":
      return "/schedule/weather";
    case "kpi.backlog_crew_days":
      return "/schedule";
    case "kpi.reviews_requested":
    case "kpi.review_rate":
      return "/reviews";
    case "kpi.referrals":
    case "kpi.referral_conversions":
      return "/referrals";
    case "kpi.marketing_spend":
    case "kpi.cost_per_lead":
    case "kpi.cac":
      return "/admin/marketing-spend";
    case "kpi.dq_leads_unassigned":
      return leadListHref({ chips: ["unassigned"] });
    case "kpi.dq_jobs_no_poc":
      return jobListHref({ filter: all({ field: "point_of_contact", op: "is_empty" }) });
    case "kpi.dq_jobs_no_property":
    case "kpi.dq_contacts_unreachable":
      return "/schedule/onboarding?tab=audit";
  }
}
