import Link from "next/link";
import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarClock,
  ChartColumnBig,
  CircleDollarSign,
  Clock,
  Gauge,
  Hammer,
  Megaphone,
  PaintRoller,
  Percent,
  Star,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { BarChart } from "@/components/kpi/bar-chart";
import { CHART_COLORS } from "@/components/kpi/chart-colors";
import { ViewDataDialog, type DataRow } from "@/components/kpi/view-data-dialog";
import { DonutChart, ForecastChart } from "@/components/analytics/charts";
import {
  leadsCreatedHref,
  metricHref,
  stageHref,
  type TemplateIds,
} from "@/components/analytics/links";
import { sourceHref, cityHref } from "@/app/(app)/leads/_dashboard/links";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/design/tokens";
import type { Option } from "@/lib/leads/service";
import { filtersToRpc, type AnalyticsFilters } from "@/lib/domain/analytics/filters";
import { periodQuery, type DateRange } from "@/lib/domain/analytics/periods";
import {
  ANALYTICS_BREAKDOWNS,
  ANALYTICS_METRICS,
  analyticsAging,
  analyticsFunnel,
  analyticsMetricValue,
  backlogByWorkType,
  breakdownCaption,
  cityPerformance,
  estimatorLeaderboard,
  executiveAlerts,
  formatMetricValue,
  formatMoney,
  formatPercent,
  hasRevenueGoal,
  leadSourcePerformance,
  pipelineByStage,
  revenueForecast,
  seasonBacklogRows,
  seasonTotals,
  type AnalyticsBreakdownId,
  type AnalyticsMetricId,
  type AnalyticsMonthly,
  type AnalyticsStats,
  type SeasonBacklog,
} from "@/lib/metrics/registry";

/**
 * Analytics widgets: KPI tiles and charts for the Executive Overview and the
 * dashboards. Every number comes from the registry; every chart has "View
 * data" with "Download CSV" (permission-gated and logged).
 */

export type AnalyticsView = {
  stats: AnalyticsStats;
  monthly: AnalyticsMonthly | null;
  season: SeasonBacklog | null;
  range: DateRange;
  filters: AnalyticsFilters;
  labels: {
    workTypes: Record<string, string>;
    sources: Record<string, string>;
    territories: Record<string, string>;
    owners: Record<string, string>;
  };
  territories: readonly Option[];
  templates: TemplateIds;
  today: { day: string; dayOfMonth: number; daysInMonth: number };
  canSetGoals: boolean;
  canSetSpend: boolean;
};

const ICONS: Partial<Record<AnalyticsMetricId, [LucideIcon, StatusTone | "brand"]>> = {
  "kpi.pipeline_value": [CircleDollarSign, "brand"],
  "kpi.projected_revenue": [TrendingUp, "success"],
  "kpi.estimates_sent": [ChartColumnBig, "info"],
  "kpi.close_rate": [Target, "success"],
  "kpi.avg_job_value": [BadgeDollarSign, "brand"],
  "kpi.sales_velocity": [Gauge, "info"],
  "kpi.speed_to_lead_median": [Clock, "warning"],
  "kpi.sla_24h": [CalendarClock, "info"],
  "kpi.daily_update_compliance": [PaintRoller, "success"],
  "kpi.on_time_start": [CalendarClock, "success"],
  "kpi.gross_margin_completed": [Percent, "brand"],
  "kpi.ar_outstanding": [CircleDollarSign, "warning"],
  "kpi.leads_created": [Users, "info"],
  "kpi.marketing_spend": [Megaphone, "neutral"],
  "kpi.review_rate": [Star, "warning"],
  "kpi.backlog_crew_days": [Hammer, "brand"],
};

export function exportFilters(
  view: Pick<AnalyticsView, "range" | "filters">,
): Record<string, string> {
  return { ...periodQuery(view.range), ...filtersToRpc(view.filters) };
}

/** A row of KPI cards. */
export function KpiTiles({
  ids,
  view,
  className,
  label,
}: {
  ids: readonly AnalyticsMetricId[];
  view: AnalyticsView;
  className?: string;
  label: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6",
        className,
      )}
    >
      {ids.map((id) => {
        const v = analyticsMetricValue(id, view.stats, view.range.words);
        const [icon, tone] = ICONS[id] ?? [ChartColumnBig, "brand" as const];
        return (
          <div key={id} data-metric={id}>
            <KpiCard
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={icon}
              tone={tone}
              href={v.hidden ? undefined : metricHref(id, view.range, view.filters, view.templates)}
            />
          </div>
        );
      })}
    </section>
  );
}

/** "View data" for a list of KPI tiles (the KPI table behind a row). */
export function KpiTableData({
  ids,
  view,
  title,
}: {
  ids: readonly AnalyticsMetricId[];
  view: AnalyticsView;
  title: string;
}) {
  return (
    <ViewDataDialog
      title={title}
      description={`${view.range.label} · each figure's formula and the registry id it comes from.`}
      dataset={`kpis:${ids.join(",")}`.slice(0, 120)}
      kind="kpi_table"
      filters={exportFilters(view)}
      columns={[
        { key: "label", label: "Metric" },
        { key: "value", label: "Value", align: "right" },
        { key: "formula", label: "Formula" },
        { key: "id", label: "Registry id" },
      ]}
      rows={ids.map((id) => {
        const v = analyticsMetricValue(id, view.stats, view.range.words);
        return { label: v.label, value: v.display, formula: v.caption, id };
      })}
    />
  );
}

function card(
  id: AnalyticsBreakdownId,
  view: AnalyticsView,
  data: { columns: { key: string; label: string; align?: "left" | "right" }[]; rows: DataRow[] },
  children: React.ReactNode,
  extra?: { caption?: string; className?: string },
) {
  const def = ANALYTICS_BREAKDOWNS[id];
  const caption = extra?.caption ?? breakdownCaption(id, view.range.words);
  return (
    <ChartCard
      id={id.replace(".", "-")}
      title={def.label}
      caption={caption}
      className={extra?.className}
      action={
        <ViewDataDialog
          title={def.label}
          description={`${def.description} (${id})`}
          dataset={id}
          filters={exportFilters(view)}
          columns={data.columns}
          rows={data.rows}
        />
      }
    >
      <div data-chart={id}>{children}</div>
    </ChartCard>
  );
}

const money = (stats: AnalyticsStats) => stats.can_see_money;

export function ChartWidget({ id, view }: { id: AnalyticsBreakdownId; view: AnalyticsView }) {
  const s = view.stats;
  switch (id) {
    case "kpi.pipeline_by_stage": {
      const rows = pipelineByStage(s);
      const total = rows.reduce((t, r) => t + r.jobs, 0);
      return card(
        id,
        view,
        {
          columns: [
            { key: "stage", label: "Stage" },
            { key: "jobs", label: "Jobs", align: "right" },
            ...(money(s) ? [{ key: "value", label: "Value", align: "right" as const }] : []),
          ],
          rows: rows.map((r) => ({
            stage: { text: r.label, href: stageHref(r.stage) },
            jobs: r.jobs,
            ...(money(s) ? { value: formatMoney(r.valueCents) } : {}),
          })),
        },
        total === 0 ? (
          <ChartEmpty>No open jobs yet. Jobs show up here as leads are converted.</ChartEmpty>
        ) : (
          <BarChart
            ariaLabel={`Open jobs by stage: ${rows
              .filter((r) => r.jobs)
              .map((r) => `${r.label} ${r.jobs}`)
              .join(", ")}`}
            series={[{ key: "jobs", label: "Jobs", color: CHART_COLORS.primary }]}
            data={rows.map((r) => ({
              label: r.label,
              jobs: r.jobs,
              total: r.jobs,
              href: stageHref(r.stage),
            }))}
          />
        ),
      );
    }
    case "kpi.revenue_forecast": {
      const rows = view.monthly
        ? revenueForecast(
            view.monthly,
            view.today.day,
            view.today.dayOfMonth,
            view.today.daysInMonth,
          )
        : [];
      const goal = hasRevenueGoal(rows);
      const anyMoney = view.monthly?.can_see_money ?? false;
      const noGoal = (
        <p className="text-xs text-muted-foreground">
          No revenue goal configured.{" "}
          {view.canSetGoals ? (
            <Link
              href="/admin/revenue-goals"
              className="font-medium text-bb-forest underline-offset-2 hover:underline"
            >
              Set monthly goals
            </Link>
          ) : (
            "An owner can set monthly goals in Admin → Revenue Goals."
          )}
        </p>
      );
      return card(
        id,
        view,
        {
          columns: [
            { key: "month", label: "Month" },
            { key: "actual", label: "Actual sold", align: "right" },
            { key: "projected", label: "Run-rate", align: "right" },
            { key: "goal", label: "Goal", align: "right" },
          ],
          rows: rows.map((r) => ({
            month: r.label,
            actual: formatMoney(r.actualCents),
            projected: formatMoney(r.projectedCents),
            goal: formatMoney(r.goalCents),
          })),
        },
        !anyMoney ? (
          <ChartEmpty>Revenue amounts are hidden for your role.</ChartEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            {!goal && noGoal}
            {rows.every((r) => !r.actualCents && !r.projectedCents) ? (
              <ChartEmpty>
                Nothing sold yet. The forecast fills in as estimates are accepted.
              </ChartEmpty>
            ) : (
              <ForecastChart
                showGoal={goal}
                ariaLabel={`Sold by month: ${rows.map((r) => `${r.label} ${formatMoney(r.actualCents ?? r.projectedCents)}`).join(", ")}`}
                data={rows.map((r) => ({
                  label: r.label.slice(0, 3),
                  actual: r.actualCents === null ? null : r.actualCents / 100,
                  projected: r.projectedCents === null ? null : r.projectedCents / 100,
                  goal: r.goalCents === null ? null : r.goalCents / 100,
                }))}
              />
            )}
          </div>
        ),
      );
    }
    case "kpi.lead_funnel": {
      const rows = analyticsFunnel(s);
      return card(
        id,
        view,
        {
          columns: [
            { key: "step", label: "Step" },
            { key: "count", label: "Leads", align: "right" },
            { key: "prev", label: "% of step before", align: "right" },
            { key: "all", label: "% of leads", align: "right" },
          ],
          rows: rows.map((r) => ({
            step: r.label,
            count: r.count,
            prev: r.fromPrevious === null ? "—" : formatPercent(r.fromPrevious),
            all: formatPercent(r.ofTotal),
          })),
        },
        s.funnel.leads === 0 ? (
          <ChartEmpty>No leads {view.range.words.period} yet.</ChartEmpty>
        ) : (
          <BarChart
            ariaLabel={`Lead funnel: ${rows.map((r) => `${r.label} ${r.count}`).join(", ")}`}
            series={[{ key: "count", label: "Leads", color: CHART_COLORS.primary }]}
            data={rows.map((r, i) => ({
              label:
                i === 0 || r.fromPrevious === null
                  ? r.label
                  : `${r.label} (${formatPercent(r.fromPrevious)})`,
              count: r.count,
              total: r.count,
              href: i === 0 ? leadsCreatedHref(view.range, view.filters) : undefined,
            }))}
          />
        ),
      );
    }
    case "kpi.season_backlog": {
      const season = view.season;
      const rows = season ? seasonBacklogRows(season) : [];
      const totals = season ? seasonTotals(season) : null;
      const year = season?.season_start.slice(0, 4) ?? "";
      return card(
        id,
        view,
        {
          columns: [
            { key: "month", label: "Month" },
            { key: "booked", label: "Booked crew-days", align: "right" },
            { key: "capacity", label: "Capacity", align: "right" },
            { key: "use", label: "Booked %", align: "right" },
          ],
          rows: [
            ...rows.map((r) => ({
              month: r.label,
              booked: r.booked,
              capacity: r.capacity,
              use: formatPercent(r.utilization),
            })),
            ...(totals
              ? [
                  {
                    month: "Not scheduled yet",
                    booked: totals.unscheduledCrewDays,
                    capacity: null,
                    use: `${totals.unscheduledJobs} job${totals.unscheduledJobs === 1 ? "" : "s"}`,
                  },
                ]
              : []),
          ],
        },
        !totals || totals.capacity === 0 ? (
          <ChartEmpty>
            No crew capacity for the {year} exterior season yet. Add crews in Production →
            Resources; capacity is active crews × production days.
          </ChartEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            <BarChart
              orientation="vertical"
              ariaLabel={`${year} season: ${rows.map((r) => `${r.label} ${r.booked} of ${r.capacity} crew-days`).join(", ")}`}
              series={[
                { key: "booked", label: "Booked", color: CHART_COLORS.primary },
                { key: "open", label: "Open capacity", color: CHART_COLORS.secondary },
              ]}
              data={rows.map((r) => ({
                label: r.label.slice(0, 3),
                booked: r.booked,
                open: Math.max(0, r.capacity - r.booked),
                total: r.booked,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              {formatMetricValue("count", totals.booked)} of{" "}
              {formatMetricValue("count", totals.capacity)} crew-days booked (
              {formatPercent(totals.utilization)}) ·{" "}
              {totals.unscheduledJobs
                ? `${totals.unscheduledJobs} sold exterior/deck job${totals.unscheduledJobs === 1 ? "" : "s"} (${formatMetricValue("number", totals.unscheduledCrewDays)} crew-days) not scheduled yet`
                : "nothing sold is waiting for dates"}
            </p>
          </div>
        ),
        { caption: `${breakdownCaption(id, view.range.words)} ${year} (Company Settings)` },
      );
    }
    case "kpi.city_performance": {
      const rows = cityPerformance(s);
      const active = rows.filter((r) => r.leads || r.soldJobs);
      return card(
        id,
        view,
        {
          columns: [
            { key: "city", label: "City" },
            { key: "leads", label: "Leads", align: "right" },
            { key: "jobs", label: "Jobs sold", align: "right" },
            ...(money(s) ? [{ key: "volume", label: "Sold $", align: "right" as const }] : []),
            { key: "rank", label: "Heat rank", align: "right" },
          ],
          rows: rows.map((r) => {
            const href = cityHref(r.city, view.territories);
            return {
              city: href ? { text: r.city, href } : r.city,
              leads: r.leads,
              jobs: r.soldJobs,
              ...(money(s) ? { volume: formatMoney(r.soldCents) } : {}),
              rank: r.rank === null ? "—" : r.rank,
            };
          }),
        },
        active.length === 0 ? (
          <ChartEmpty>No leads or sales {view.range.words.period} yet.</ChartEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...rows]
              .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
              .map((r) => (
                <li
                  key={r.city}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm"
                >
                  <span className="truncate font-medium text-bb-ink">
                    {r.rank !== null && (
                      <span className="mr-1 text-muted-foreground tabular-nums">#{r.rank}</span>
                    )}
                    {r.city}
                  </span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {r.leads} leads · {r.soldJobs} sold
                    {money(s) ? ` · ${formatMoney(r.soldCents)}` : ""}
                  </span>
                  <span
                    aria-hidden
                    className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.round(r.heat * 100)}%`,
                        background:
                          r.heat > 0.66 ? "#b45309" : r.heat > 0.33 ? "#d97706" : "#f2c66d",
                      }}
                    />
                  </span>
                </li>
              ))}
          </ul>
        ),
      );
    }
    case "kpi.estimator_leaderboard": {
      const rows = estimatorLeaderboard(s);
      return card(
        id,
        view,
        {
          columns: [
            { key: "name", label: "Estimator" },
            { key: "sold", label: "Sold $", align: "right" },
            { key: "jobs", label: "Jobs", align: "right" },
            { key: "sent", label: "Sent", align: "right" },
            { key: "close", label: "Close rate", align: "right" },
          ],
          rows: rows.map((r) => ({
            name: r.name,
            sold: formatMoney(r.soldCents),
            jobs: r.jobs,
            sent: r.sent,
            close: formatPercent(r.closeRate),
          })),
        },
        rows.length === 0 ? (
          <ChartEmpty>No estimates sent or accepted {view.range.words.period} yet.</ChartEmpty>
        ) : (
          <ol className="flex flex-col divide-y">
            {rows.map((r, i) => (
              <li
                key={r.userId ?? r.name}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-bb-forest">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium">{r.name}</span>
                </span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                  <span className="font-semibold text-bb-ink">{formatMoney(r.soldCents)}</span> ·{" "}
                  {r.jobs} jobs · {formatPercent(r.closeRate)} close
                </span>
              </li>
            ))}
          </ol>
        ),
      );
    }
    case "kpi.lead_source_performance": {
      const rows = leadSourcePerformance(s, view.labels.sources);
      return card(
        id,
        view,
        {
          columns: [
            { key: "source", label: "Source" },
            { key: "leads", label: "Leads", align: "right" },
            { key: "converted", label: "Converted", align: "right" },
            { key: "conv", label: "Conv %", align: "right" },
            { key: "sold", label: "Jobs sold", align: "right" },
            ...(money(s) ? [{ key: "revenue", label: "Revenue", align: "right" as const }] : []),
            { key: "cpl", label: "Cost per lead", align: "right" },
          ],
          rows: rows.map((r) => ({
            source: { text: r.label, href: sourceHref(r.source) },
            leads: r.leads,
            converted: r.converted,
            conv: formatPercent(r.conversion),
            sold: r.soldJobs,
            ...(money(s) ? { revenue: formatMoney(r.soldCents) } : {}),
            cpl: formatMoney(r.costPerLead),
          })),
        },
        rows.length === 0 ? (
          <ChartEmpty>No leads {view.range.words.period} yet.</ChartEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Lead source performance</caption>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-1 font-medium">
                      Source
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Leads
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      Conv %
                    </th>
                    {money(s) && (
                      <th scope="col" className="py-1 text-right font-medium">
                        Revenue
                      </th>
                    )}
                    <th scope="col" className="py-1 text-right font-medium">
                      CPL
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r) => (
                    <tr key={r.source ?? "none"} className="border-t">
                      <th scope="row" className="py-1.5 text-left font-medium">
                        <Link href={sourceHref(r.source)} className="hover:underline">
                          {r.label}
                        </Link>
                      </th>
                      <td className="py-1.5 text-right tabular-nums">{r.leads}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatPercent(r.conversion)}
                      </td>
                      {money(s) && (
                        <td className="py-1.5 text-right tabular-nums">
                          {formatMoney(r.soldCents)}
                        </td>
                      )}
                      <td className="py-1.5 text-right tabular-nums">
                        {formatMoney(r.costPerLead)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.spend_cents === 0 && (
              <p className="text-xs text-muted-foreground">
                Cost per lead shows once monthly spend is entered
                {view.canSetSpend ? (
                  <>
                    {" "}
                    in{" "}
                    <Link
                      href="/admin/marketing-spend"
                      className="font-medium text-bb-forest hover:underline"
                    >
                      Admin → Marketing Spend
                    </Link>
                  </>
                ) : (
                  " (Admin → Marketing Spend)"
                )}
                .
              </p>
            )}
          </div>
        ),
        { className: "lg:col-span-2" },
      );
    }
    case "kpi.lead_source_mix": {
      const rows = leadSourcePerformance(s, view.labels.sources).filter((r) => r.leads > 0);
      const top = rows.slice(0, 6);
      const rest = rows.slice(6).reduce((t, r) => t + r.leads, 0);
      const slices = [
        ...top.map((r) => ({
          label: r.label,
          value: r.leads,
          display: `${r.leads} leads · ${formatPercent(r.share)}`,
        })),
        ...(rest ? [{ label: "Other", value: rest, display: `${rest} leads` }] : []),
      ];
      return card(
        id,
        view,
        {
          columns: [
            { key: "source", label: "Source" },
            { key: "leads", label: "Leads", align: "right" },
            { key: "share", label: "Share", align: "right" },
          ],
          rows: rows.map((r) => ({
            source: r.label,
            leads: r.leads,
            share: formatPercent(r.share),
          })),
        },
        slices.length === 0 ? (
          <ChartEmpty>No leads {view.range.words.period} yet.</ChartEmpty>
        ) : (
          <DonutChart
            data={slices}
            ariaLabel={`Lead sources: ${slices.map((x) => `${x.label} ${x.value}`).join(", ")}`}
          />
        ),
      );
    }
    case "kpi.ar_aging": {
      const rows = analyticsAging(s);
      const any = rows.some((r) => (r.cents ?? 0) > 0);
      return card(
        id,
        view,
        {
          columns: [
            { key: "bucket", label: "Days past due" },
            { key: "owed", label: "Owed", align: "right" },
          ],
          rows: rows.map((r) => ({
            bucket: { text: r.label, href: "/invoices/aging" },
            owed: formatMoney(r.cents),
          })),
        },
        !money(s) ? (
          <ChartEmpty>Amounts are hidden for your role.</ChartEmpty>
        ) : !any ? (
          <ChartEmpty>Nothing owed on sent invoices right now.</ChartEmpty>
        ) : (
          <BarChart
            orientation="vertical"
            ariaLabel={`A/R aging: ${rows.map((r) => `${r.label} ${formatMoney(r.cents)}`).join(", ")}`}
            series={[{ key: "owed", label: "Owed ($)", color: CHART_COLORS.primary }]}
            data={rows.map((r) => ({
              label: r.label,
              owed: Math.round((r.cents ?? 0) / 100),
              total: Math.round((r.cents ?? 0) / 100),
              href: "/invoices/aging",
            }))}
          />
        ),
      );
    }
    case "kpi.backlog_by_work_type": {
      const rows = backlogByWorkType(s);
      return card(
        id,
        view,
        {
          columns: [
            { key: "type", label: "Work type" },
            { key: "hours", label: "Open hours", align: "right" },
            { key: "days", label: "Crew-days", align: "right" },
          ],
          rows: rows.map((r) => ({
            type: view.labels.workTypes[r.workType] ?? r.workType,
            hours: formatMetricValue("hours", r.hours),
            days: r.crewDays,
          })),
        },
        rows.length === 0 ? (
          <ChartEmpty>No open work orders on ready, scheduled or in-progress jobs.</ChartEmpty>
        ) : (
          <BarChart
            ariaLabel={`Backlog by work type: ${rows.map((r) => `${view.labels.workTypes[r.workType] ?? r.workType} ${r.crewDays} crew-days`).join(", ")}`}
            series={[{ key: "days", label: "Crew-days", color: CHART_COLORS.primary }]}
            data={rows.map((r) => ({
              label: view.labels.workTypes[r.workType] ?? r.workType,
              days: r.crewDays,
              total: r.crewDays,
            }))}
          />
        ),
      );
    }
    case "kpi.executive_alerts": {
      const rows = executiveAlerts(s);
      const open = rows.filter((r) => r.open > 0);
      return card(
        id,
        view,
        {
          columns: [
            { key: "alert", label: "Alert" },
            { key: "open", label: "Open", align: "right" },
          ],
          rows: rows.map((r) => ({ alert: { text: r.label, href: r.href }, open: r.open })),
        },
        open.length === 0 ? (
          <ChartEmpty>All caught up. Nothing is waiting in Attention.</ChartEmpty>
        ) : (
          <ul className="flex flex-col gap-1">
            {open.map((r) => (
              <li key={r.key}>
                <Link
                  href={r.href}
                  className="flex min-h-10 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-muted"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-warning" aria-hidden />
                    {r.label}
                  </span>
                  <span className="rounded-full bg-warning-bg px-2 text-xs font-semibold text-warning tabular-nums">
                    {r.open}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ),
      );
    }
  }
}

/** All metric ids, for completeness checks. */
export const WIDGET_METRIC_IDS = Object.keys(ANALYTICS_METRICS) as AnalyticsMetricId[];
