import Link from "next/link";
import { CalendarCheck, Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { AnalyticsFilterBar } from "@/components/analytics/filter-bar";
import { ChartWidget, KpiTableData, KpiTiles } from "@/components/analytics/widgets";
import type { Viewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { buildAnalyticsView } from "@/lib/analytics/view";
import { loadAnalyticsOptions } from "@/lib/analytics/server";
import { parseFilters } from "@/lib/domain/analytics/filters";
import { OVERVIEW_PRESETS, parsePeriodParams } from "@/lib/domain/analytics/periods";
import type {
  AnalyticsBreakdownId,
  AnalyticsMetricId,
  AnalyticsStats,
} from "@/lib/metrics/registry";

/**
 * Home: Executive Overview (SPEC §8.2). Work type + date range filters; two
 * KPI rows (sales, then the Brushy Bear promises); the widgets. Every figure
 * comes from analytics_stats() through the registry.
 */

export const ROW_1: readonly AnalyticsMetricId[] = [
  "kpi.pipeline_value",
  "kpi.projected_revenue",
  "kpi.estimates_sent",
  "kpi.close_rate",
  "kpi.avg_job_value",
  "kpi.sales_velocity",
];
export const ROW_2: readonly AnalyticsMetricId[] = [
  "kpi.speed_to_lead_median",
  "kpi.sla_24h",
  "kpi.daily_update_compliance",
  "kpi.on_time_start",
  "kpi.gross_margin_completed",
  "kpi.ar_outstanding",
];
export const OVERVIEW_CHARTS: readonly AnalyticsBreakdownId[] = [
  "kpi.pipeline_by_stage",
  "kpi.revenue_forecast",
  "kpi.lead_funnel",
  "kpi.season_backlog",
  "kpi.city_performance",
  "kpi.estimator_leaderboard",
  "kpi.lead_source_performance",
  "kpi.lead_source_mix",
  "kpi.executive_alerts",
];

/** True when the company has nothing to report yet (production starts empty). */
export function isEmptyCompany(s: AnalyticsStats): boolean {
  return (
    s.leads_created === 0 &&
    s.by_stage.length === 0 &&
    s.estimates_sent === 0 &&
    s.sold_jobs === 0 &&
    (s.ar_outstanding_cents ?? 0) === 0
  );
}

export async function ExecutiveOverview({
  viewer,
  params,
  now = new Date(),
}: {
  viewer: Viewer;
  params: Record<string, string | string[] | undefined>;
  now?: Date;
}) {
  const db = await createSupabaseServerClient();
  const options = await loadAnalyticsOptions(db);
  const range = parsePeriodParams(params, OVERVIEW_PRESETS, "this_month", now);
  const filters = parseFilters(params, { workTypes: options.workTypes.map((o) => o.value) }, [
    "work_type",
  ]);
  const { view } = await buildAnalyticsView(
    db,
    viewer,
    range,
    filters,
    OVERVIEW_CHARTS,
    now,
    options,
  );
  const empty = isEmptyCompany(view.stats);
  const canCreateLead = viewer.can("leads:create") && !viewer.impersonating;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Executive Overview"
        description="Company-wide performance. Every metric is aggregated server-side across all records."
        actions={
          <>
            <KpiTableData ids={[...ROW_1, ...ROW_2]} view={view} title="Executive KPIs" />
            <Button asChild variant="outline" size="sm">
              <Link href="/workspace">
                <CalendarCheck aria-hidden />
                My Day
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/analytics">
                <Sparkles aria-hidden />
                Analytics
              </Link>
            </Button>
          </>
        }
      />
      <AnalyticsFilterBar
        presets={OVERVIEW_PRESETS}
        preset={range.preset}
        custom={range.custom}
        workTypes={options.workTypes.filter((o) => o.active !== false)}
        idPrefix="exec"
      />
      {empty && (
        <div className="brand-surface flex flex-col items-start gap-3 rounded-2xl border border-bb-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl text-bb-forest">Nothing to report yet</h2>
            <p className="mt-1 max-w-2xl text-sm text-bb-ink/80">
              These numbers fill in as leads come in from the website, walkthroughs get booked and
              estimates go out. Until then every figure shows 0 or “—”, never a guess.
            </p>
          </div>
          {canCreateLead && (
            <Button asChild variant="cta">
              <Link href="/leads/new">
                <Plus aria-hidden />
                New Lead
              </Link>
            </Button>
          )}
        </div>
      )}
      <KpiTiles ids={ROW_1} view={view} label="Sales" />
      <KpiTiles ids={ROW_2} view={view} label="Brushy Bear promises and money" />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {OVERVIEW_CHARTS.map((id) => (
          <ChartWidget key={id} id={id} view={view} />
        ))}
      </div>
    </div>
  );
}
