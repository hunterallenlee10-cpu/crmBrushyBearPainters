import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  CloudRain,
  ClipboardList,
  type HardHat,
  PaintBucket,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { addDays, formatDay, pacificToday, weekStart } from "@/lib/domain/scheduling/dates";
import {
  parseProductionStats,
  productionMetricValue,
  type ProductionMetricId,
} from "@/lib/metrics/registry";
import { PRIORITY_LABELS, type AttentionPriority } from "@/lib/domain/attention/rules";
import type { StatusTone } from "@/lib/design/tokens";

export const metadata: Metadata = { title: "Production Center" };

const KPIS: {
  id: ProductionMetricId;
  icon: typeof HardHat;
  tone: StatusTone | "brand";
  href?: string;
}[] = [
  { id: "production.ready", icon: ClipboardList, tone: "brand", href: "/schedule/readiness" },
  {
    id: "production.scheduled",
    icon: CalendarCheck,
    tone: "info",
    href: "/jobs/list?stage=scheduled",
  },
  { id: "production.at_risk", icon: AlertTriangle, tone: "danger", href: "/schedule/exceptions" },
  { id: "production.unscheduled", icon: CalendarPlus, tone: "warning", href: "/schedule/master" },
  { id: "production.completed_week", icon: CheckCircle2, tone: "success" },
  { id: "production.scheduled_revenue_30", icon: CircleDollarSign, tone: "brand" },
];

const PROMISES: ProductionMetricId[] = [
  "production.daily_update_compliance",
  "production.on_time_start",
  "production.rain_delay_days",
  "production.punch_per_job",
  "production.labor_variance",
  "production.backlog_crew_days",
];

const PRIORITY_TONE: Record<AttentionPriority, string> = {
  critical: "bg-danger-bg text-danger",
  high: "bg-warning-bg text-warning",
  medium: "bg-info-bg text-info",
  low: "bg-neutral-bg text-neutral",
};

/** Command Center (SPEC §8.6): KPIs from the metrics registry, attention, schedule health, upcoming starts. */
export default async function CommandCenterPage() {
  const viewer = await requirePermission("schedule:read");
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const [statsRes, attention, starts] = await Promise.all([
    supabase.rpc("production_stats"),
    viewer.can("attention:read")
      ? supabase
          .from("attention_items")
          .select("id, title, detail, priority, subject_type, subject_id, rule_key")
          .neq("status", "resolved")
          .in("category", ["scheduling", "production", "qa", "documents"])
          .order("priority")
          .order("opened_at")
          .limit(8)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("schedule_entries")
      .select("job_id, starts_on, job:jobs(id, name, job_number, stage)")
      .eq("status", "published")
      .gte("starts_on", today)
      .lte("starts_on", addDays(today, 14))
      .order("starts_on")
      .limit(60),
  ]);
  const stats = parseProductionStats(statsRes.data);
  const kpis = KPIS.filter(
    (k) => k.id !== "production.scheduled_revenue_30" || stats.can_see_money,
  );

  const firstStart = new Map<string, { date: string; name: string; number: string }>();
  for (const s of starts.data ?? []) {
    if (!s.job || s.job.stage !== "scheduled" || !s.starts_on) continue;
    const cur = firstStart.get(s.job_id);
    if (!cur || s.starts_on < cur.date) {
      firstStart.set(s.job_id, {
        date: s.starts_on as string,
        name: s.job.name,
        number: s.job.job_number,
      });
    }
  }
  const nextWeek = addDays(weekStart(today), 7);
  const buckets = [
    { label: "Today", test: (d: string) => d === today },
    { label: "Tomorrow", test: (d: string) => d === addDays(today, 1) },
    { label: "This week", test: (d: string) => d > addDays(today, 1) && d < nextWeek },
    { label: "Next week", test: (d: string) => d >= nextWeek && d < addDays(nextWeek, 7) },
  ];
  const health = [
    {
      label: "Scheduled, on track",
      value: Math.max(0, stats.scheduled - stats.at_risk),
      tone: "text-success",
    },
    { label: "In progress", value: stats.in_progress, tone: "text-info" },
    { label: "Final walkthrough", value: stats.final_walkthrough, tone: "text-bb-forest" },
    { label: "At risk", value: stats.at_risk, tone: "text-danger" },
    { label: "Rain reschedules", value: stats.priority_reschedule, tone: "text-warning" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Command Center"
        description="What's ready, what's scheduled and what's at risk. Every number is counted on the server across all jobs."
        actions={
          <>
            <Button asChild>
              <Link href="/schedule/master">Open Master Schedule</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/schedule/dispatch">Field Dispatch</Link>
            </Button>
            {viewer.can("paint_orders:manage") && (
              <Button asChild variant="outline">
                <Link href="/schedule/paint-orders">
                  <PaintBucket aria-hidden /> Paint Orders
                </Link>
              </Button>
            )}
          </>
        }
      />
      <section
        aria-label="Production KPIs"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"
      >
        {kpis.map((k) => {
          const m = productionMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={m.label}
              value={m.display}
              caption={m.caption}
              icon={k.icon}
              tone={k.tone}
              href={k.href}
            />
          );
        })}
      </section>
      <div className="grid gap-4 xl:grid-cols-3">
        <section
          aria-labelledby="cc-attention"
          className="rounded-2xl border bg-card p-4 xl:col-span-2"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="cc-attention" className="text-base font-semibold">
              What needs your attention
            </h2>
            <Link href="/schedule/exceptions" className="text-sm text-bb-forest underline">
              All exceptions
            </Link>
          </div>
          {(attention.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All caught up: no missing crews, paint delays, missed updates or late starts right
              now.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {(attention.data ?? []).map((a) => {
                const p =
                  (["critical", "high", "medium", "low"] as const).find((x) => x === a.priority) ??
                  "medium";
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2">
                    <span
                      className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[p]}`}
                    >
                      {PRIORITY_LABELS[p]}
                    </span>
                    <div className="min-w-0">
                      <Link
                        className="text-sm font-medium hover:underline"
                        href={
                          a.subject_type === "job"
                            ? `/jobs/${a.subject_id}?section=schedule`
                            : `/admin/subcontractors?id=${a.subject_id}`
                        }
                      >
                        {a.title}
                      </Link>
                      {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="cc-health" className="rounded-2xl border bg-card p-4">
          <h2 id="cc-health" className="mb-3 text-base font-semibold">
            Schedule health
          </h2>
          <dl className="grid grid-cols-2 gap-3">
            {health.map((h) => (
              <div key={h.label} className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">{h.label}</dt>
                <dd className={`text-xl font-bold tabular-nums ${h.tone}`}>{h.value}</dd>
              </div>
            ))}
            <div className="rounded-xl border p-3">
              <dt className="text-xs text-muted-foreground">Active crews</dt>
              <dd className="text-xl font-bold tabular-nums">
                <Users className="mr-1 inline size-4" aria-hidden />
                {stats.crews_active}
              </dd>
            </div>
          </dl>
        </section>
      </div>
      <section aria-labelledby="cc-promises" className="flex flex-col gap-3">
        <h2 id="cc-promises" className="text-base font-semibold">
          Our promises
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {PROMISES.map((id) => {
            const m = productionMetricValue(id, stats);
            return (
              <KpiCard
                key={id}
                label={m.label}
                value={m.display}
                caption={m.caption}
                icon={id === "production.rain_delay_days" ? CloudRain : CalendarClock}
                tone="brand"
              />
            );
          })}
        </div>
      </section>
      <section aria-labelledby="cc-upcoming" className="rounded-2xl border bg-card p-4">
        <h2 id="cc-upcoming" className="mb-3 text-base font-semibold">
          Upcoming starts
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {buckets.map((b) => {
            const jobs = [...firstStart.entries()].filter(([, s]) => b.test(s.date));
            return (
              <div key={b.label}>
                <h3 className="text-sm font-medium text-muted-foreground">
                  {b.label} ({jobs.length})
                </h3>
                {jobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No starts.</p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {jobs.map(([jobId, s]) => (
                      <li key={jobId}>
                        <Link href={`/jobs/${jobId}?section=schedule`} className="hover:underline">
                          {s.number} · {s.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {formatDay(s.date)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
