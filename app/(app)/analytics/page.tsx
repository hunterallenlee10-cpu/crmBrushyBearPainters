import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { KpiTableData, KpiTiles } from "@/components/analytics/widgets";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { buildAnalyticsView } from "@/lib/analytics/view";
import { loadAnalyticsMonthly } from "@/lib/analytics/server";
import { NO_FILTERS } from "@/lib/domain/analytics/filters";
import { onPace } from "@/lib/domain/analytics/brief";
import { pacificToday, resolvePeriod, ymdString } from "@/lib/domain/analytics/periods";
import { cn } from "@/lib/utils";
import { analyticsMetricValue, type AnalyticsMetricId } from "@/lib/metrics/registry";
import { AskBox } from "./_components/ask-box";
import { DailyBrief } from "./_components/daily-brief";

export const metadata: Metadata = { title: "Analytics" };

const MY_BUSINESS: readonly AnalyticsMetricId[] = [
  "kpi.revenue_sold",
  "kpi.revenue_collected",
  "kpi.leads_created",
  "kpi.estimates_sent",
  "kpi.close_rate",
  "kpi.ar_outstanding",
];

/** Analytics → Overview (SPEC §8.14): Ask, Daily Brief, My Business and On Pace. */
export default async function AnalyticsOverviewPage() {
  const viewer = await requirePermission("analytics:read");
  const db = await createSupabaseServerClient();
  const now = new Date();
  const range = resolvePeriod("this_month", now);
  const today = pacificToday(now);
  const day = ymdString(today);
  const [{ view }, monthly] = await Promise.all([
    buildAnalyticsView(db, viewer, range, NO_FILTERS, [], now),
    loadAnalyticsMonthly(db, `${day.slice(0, 7)}-01`, 1, NO_FILTERS),
  ]);
  const yesterday = new Date(Date.UTC(today.y, today.m - 1, today.d - 1))
    .toISOString()
    .slice(0, 10);
  const goal = monthly.months[0]?.goal_cents ?? null;
  const pace = onPace({
    soldCents: view.stats.can_see_money ? view.stats.sold_cents : null,
    goalCents: goal,
    dayOfMonth: view.today.dayOfMonth,
    daysInMonth: view.today.daysInMonth,
  });
  const projected = analyticsMetricValue("kpi.projected_revenue", view.stats, range.words);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Analytics"
        description="Every figure comes from the metrics registry, aggregated on the server across all records you can see."
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <AskBox />
        <DailyBrief yesterday={yesterday} />
      </div>
      <section aria-labelledby="my-business-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="my-business-title" className="text-lg font-semibold text-bb-ink">
            My Business – This Month
          </h2>
          <KpiTableData ids={MY_BUSINESS} view={view} title="My Business – This Month" />
        </div>
        <KpiTiles ids={MY_BUSINESS} view={view} label="My Business – This Month" />
      </section>
      <section
        aria-labelledby="pace-title"
        className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      >
        <h2 id="pace-title" className="flex items-center gap-2 text-lg font-semibold text-bb-ink">
          <Gauge className="size-5 text-bb-forest" aria-hidden />
          On Pace – This Month
        </h2>
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-bb-ink" data-testid="on-pace">
              {pace.text}
            </p>
            {pace.goalShare !== null && pace.monthShare !== null && (
              <div aria-hidden className="relative h-3 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    pace.status === "behind" ? "bg-warning" : "bg-bb-forest",
                  )}
                  style={{ width: `${Math.min(100, Math.round(pace.goalShare * 100))}%` }}
                />
                <span
                  className="absolute inset-y-0 w-0.5 bg-bb-ink"
                  style={{ left: `${Math.round(pace.monthShare * 100)}%` }}
                  title="Where the month is"
                />
              </div>
            )}
            {pace.status === "no_goal" && (
              <p className="text-xs text-muted-foreground">
                No revenue goal configured.{" "}
                {view.canSetGoals ? (
                  <Link
                    href="/admin/revenue-goals"
                    className="font-medium text-bb-forest hover:underline"
                  >
                    Set this month&apos;s goal
                  </Link>
                ) : (
                  "An owner can set one in Admin → Revenue Goals."
                )}
              </p>
            )}
          </div>
          <div className="rounded-xl bg-muted/50 px-4 py-3 text-right">
            <p className="text-xs text-muted-foreground">{projected.label}</p>
            <p className="text-xl font-bold tabular-nums">{projected.display}</p>
            <p className="text-xs text-muted-foreground">{projected.caption}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
