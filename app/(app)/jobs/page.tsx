import type { Metadata } from "next";
import Link from "next/link";
import {
  BriefcaseBusiness,
  CircleDollarSign,
  FolderOpen,
  List,
  PaintRoller,
  Plus,
  Trophy,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ChartCard, ChartEmpty } from "@/components/kpi/chart-card";
import { BarChart } from "@/components/kpi/bar-chart";
import { CHART_COLORS } from "@/components/kpi/chart-colors";
import { ViewDataDialog } from "@/components/kpi/view-data-dialog";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { isJobStageId } from "@/lib/domain/stages";
import {
  formatMetricValue,
  formatMoney,
  formatPercent,
  jobCaption,
  jobMetricValue,
  jobPipelineHealth,
  jobPipelineSnapshot,
  jobSoldByDay,
  parseJobStats,
  type JobMetricValue,
} from "@/lib/metrics/registry";
import { DeltaBadge } from "./_dashboard/delta";
import { PeriodSelect } from "./_dashboard/period-select";
import { PipelineSnapshotTable } from "./_dashboard/pipeline-snapshot";
import { RecentJobs, type RecentJob } from "./_dashboard/recent-jobs";
import { SoldChart } from "./_dashboard/sold-chart";
import {
  closedHref,
  jobListHref,
  pipelineHealthHref,
  soldHref,
  stageHref,
} from "./_dashboard/links";
import { parseJobPeriod, periodRange, type PeriodRange } from "./_dashboard/periods";

export const metadata: Metadata = { title: "Jobs Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function statsArgs(r: PeriodRange) {
  return { p_from: r.from, p_to: r.to, p_prev_from: r.prevFrom };
}

/** A small number tile inside the Revenue & Performance card. */
function StatTile({
  metric,
  href,
  prior,
}: {
  metric: JobMetricValue;
  href?: string;
  prior?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
      <p className="mt-1 text-xl font-bold text-bb-ink tabular-nums">
        {metric.display}
        {prior && <DeltaBadge delta={metric.delta} prior={prior} />}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{metric.caption}</p>
    </>
  );
  const cls = "block rounded-xl border bg-muted/30 p-3";
  return href ? (
    <Link
      href={href}
      className={`${cls} outline-none hover:border-bb-forest/40 focus-visible:ring-[3px] focus-visible:ring-ring/50`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function JobsDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("jobs:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const period = parseJobPeriod((await searchParams).period);
  const range = periodRange(period, now);
  const month = period === "this_month" ? null : periodRange("this_month", now);

  const [statsRes, monthRes, recentRes] = await Promise.all([
    supabase.rpc("job_stats", statsArgs(range)),
    month ? supabase.rpc("job_stats", statsArgs(month)) : Promise.resolve(null),
    supabase
      .from("jobs")
      .select(
        "id, job_number, name, stage, created_at, account:accounts!jobs_account_id_fkey(display_name)",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(5),
  ]);
  if (statsRes.error) logError("jobs.dashboard.stats", statsRes.error);
  if (monthRes?.error) logError("jobs.dashboard.month_stats", monthRes.error);
  if (recentRes.error) logError("jobs.dashboard.recent", recentRes.error);
  const stats = parseJobStats(statsRes.data);
  const monthStats = monthRes ? parseJobStats(monthRes.data) : stats;
  const money = stats.can_see_money;
  const words = range.words;

  const m = {
    total: jobMetricValue("jobs.total", stats, words),
    pipeline: jobMetricValue("jobs.pipeline_value", stats, words),
    open: jobMetricValue("jobs.open", stats, words),
    inProgress: jobMetricValue("jobs.in_progress", stats, words),
    won: jobMetricValue("jobs.closed_won", stats, words),
    revenue: jobMetricValue("jobs.sold_value", stats, words),
    soldCount: jobMetricValue("jobs.sold_count", stats, words),
    avg: jobMetricValue("jobs.avg_job_size", stats, words),
    winRate: jobMetricValue("jobs.win_rate", stats, words),
    closing: jobMetricValue("jobs.closing_this_month", monthStats, words),
  };

  // Amounts for the recent jobs (row security hides job_financials without financials:read).
  const recentRows = (recentRes.data ?? []).filter((j) => isJobStageId(j.stage));
  const amounts = new Map<string, number | null>();
  if (money && recentRows.length) {
    const { data: fin } = await supabase
      .from("job_financials")
      .select("job_id, contract_cents")
      .in(
        "job_id",
        recentRows.map((j) => j.id),
      );
    for (const f of fin ?? []) amounts.set(f.job_id, f.contract_cents);
  }
  const recent: RecentJob[] = recentRows.flatMap((j) =>
    isJobStageId(j.stage)
      ? [
          {
            id: j.id,
            jobNumber: j.job_number,
            name: j.name,
            accountName: j.account?.display_name ?? null,
            stage: j.stage,
            ...(money ? { amountCents: amounts.get(j.id) ?? null } : {}),
            createdAt: j.created_at,
          },
        ]
      : [],
  );

  const canCreate = viewer.can("jobs:create") && !viewer.impersonating;

  const header = (
    <PageHeader
      title="Jobs Dashboard"
      description="Every number is aggregated on the server across all jobs you can see, not just one page of the list."
      actions={
        <>
          <PeriodSelect value={period} />
          <Button asChild variant="outline">
            <Link href={jobListHref()}>
              <List aria-hidden />
              Job List
            </Link>
          </Button>
          {canCreate && (
            <Button asChild variant="cta">
              <Link href="/jobs/new">
                <Plus aria-hidden />
                New Job
              </Link>
            </Button>
          )}
        </>
      }
    />
  );

  const kpis = (
    <section
      aria-label="Job totals"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <KpiCard
        label={m.pipeline.label}
        value={m.pipeline.display}
        caption={m.pipeline.caption}
        icon={CircleDollarSign}
        href={jobListHref()}
      />
      <KpiCard
        label={m.open.label}
        value={
          <>
            {m.open.display}
            <DeltaBadge delta={m.open.delta} prior={words.start} />
          </>
        }
        caption={m.open.caption}
        icon={FolderOpen}
        tone="info"
        href={jobListHref()}
      />
      <KpiCard
        label={m.inProgress.label}
        value={m.inProgress.display}
        caption={m.inProgress.caption}
        icon={PaintRoller}
        tone="warning"
        href={stageHref("in_progress")}
      />
      <KpiCard
        label={m.won.label}
        value={
          <>
            {m.won.display}
            <DeltaBadge delta={m.won.delta} prior={words.prior} />
          </>
        }
        caption={m.won.caption}
        icon={Trophy}
        tone="success"
        href={closedHref("closed_won", range)}
      />
    </section>
  );

  if (m.total.value === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        {kpis}
        <EmptyState
          icon={BriefcaseBusiness}
          title="No jobs yet"
          action={
            canCreate ? (
              <Button asChild variant="cta">
                <Link href="/jobs/new">
                  <Plus aria-hidden />
                  New Job
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/leads/list">Go to leads</Link>
              </Button>
            )
          }
        >
          A job appears here when a lead is converted. Once a few are moving you&apos;ll see the
          pipeline, what sold and what&apos;s closing this month.
        </EmptyState>
      </div>
    );
  }

  const snapshot = jobPipelineSnapshot(stats);
  const health = jobPipelineHealth(stats);
  const days = jobSoldByDay(stats, range.firstDay, range.lastDay);
  const soldCaption = jobCaption(money ? "soldByDay" : "soldByDayCounts", words);
  const healthCaption = jobCaption("health", words);
  const soldPoints = days.map((d) => ({
    label: d.label,
    // Chart axis in dollars; the tooltip shows the registry's formatted value.
    value: money ? (d.valueCents ?? 0) / 100 : d.jobs,
    display: money ? formatMoney(d.valueCents) : formatMetricValue("count", d.jobs),
  }));
  const soldDaysWithSales = days.filter((d) => d.jobs > 0);

  return (
    <div className="flex flex-col gap-5">
      {header}
      {kpis}

      <ChartCard
        id="revenue-performance"
        title="Revenue & Performance"
        caption={`${range.label} · sold means the estimate was accepted`}
        action={
          <ViewDataDialog
            title="Revenue & Performance"
            description={`${soldCaption}. Days with no sales are left out.`}
            columns={[
              { key: "day", label: "Day" },
              { key: "jobs", label: "Jobs sold", align: "right" },
              ...(money ? [{ key: "value", label: "Sold value", align: "right" as const }] : []),
            ]}
            rows={soldDaysWithSales.map((d) => ({
              day: d.label,
              jobs: d.jobs,
              ...(money ? { value: formatMoney(d.valueCents) } : {}),
            }))}
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {money ? (
              <StatTile metric={m.revenue} href={soldHref(range)} prior={words.prior} />
            ) : (
              <StatTile metric={m.soldCount} href={soldHref(range)} />
            )}
            {money && <StatTile metric={m.avg} href={soldHref(range)} />}
            <StatTile metric={m.winRate} />
            <StatTile metric={m.closing} />
          </div>
          {stats.sold_count === 0 ? (
            <ChartEmpty>No jobs sold {words.period} yet.</ChartEmpty>
          ) : (
            <SoldChart
              data={soldPoints}
              money={money}
              seriesLabel={money ? "Sold value" : "Jobs sold"}
              ariaLabel={`${soldCaption}: ${soldDaysWithSales
                .map(
                  (d) =>
                    `${d.label} ${money ? formatMoney(d.valueCents) : `${d.jobs} job${d.jobs === 1 ? "" : "s"}`}`,
                )
                .join(", ")}`}
            />
          )}
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ChartCard
          id="pipeline-snapshot"
          title="Pipeline Snapshot"
          caption={`Every stage · ${snapshot.totalJobs.toLocaleString("en-US")} jobs${money ? ` · ${formatMoney(snapshot.totalValueCents)}` : ""}`}
          action={
            <ViewDataDialog
              title="Pipeline Snapshot"
              description={jobCaption("snapshot", words)}
              columns={[
                { key: "stage", label: "Stage" },
                { key: "jobs", label: "Jobs", align: "right" },
                ...(money ? [{ key: "value", label: "Value", align: "right" as const }] : []),
                { key: "share", label: "Share of jobs", align: "right" },
              ]}
              rows={[
                ...snapshot.rows.map((r) => ({
                  stage: { text: r.label, href: stageHref(r.stage) },
                  jobs: r.jobs,
                  ...(money ? { value: formatMoney(r.valueCents) } : {}),
                  share: formatPercent(r.share),
                })),
                {
                  stage: "Total",
                  jobs: snapshot.totalJobs,
                  ...(money ? { value: formatMoney(snapshot.totalValueCents) } : {}),
                  share: snapshot.totalJobs ? "100%" : "—",
                },
              ]}
            />
          }
        >
          <PipelineSnapshotTable snapshot={snapshot} />
        </ChartCard>

        <div className="flex min-w-0 flex-col gap-4">
          <RecentJobs jobs={recent} viewAllHref={jobListHref({ tab: "all" })} now={now} />

          <ChartCard
            id="pipeline-health"
            title="Pipeline Health"
            caption={healthCaption}
            action={
              <ViewDataDialog
                title="Pipeline Health"
                description={healthCaption}
                columns={[
                  { key: "status", label: "Status" },
                  { key: "jobs", label: "Jobs", align: "right" },
                ]}
                rows={health.map((r) => ({
                  status: { text: r.label, href: pipelineHealthHref(r.key, range) },
                  jobs: r.jobs,
                }))}
              />
            }
          >
            <BarChart
              ariaLabel={`Pipeline health: ${health.map((r) => `${r.label} ${r.jobs}`).join(", ")}`}
              series={[{ key: "jobs", label: "Jobs", color: CHART_COLORS.primary }]}
              data={health.map((r) => ({
                label: r.label,
                jobs: r.jobs,
                total: r.jobs,
                href: pipelineHealthHref(r.key, range),
              }))}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
