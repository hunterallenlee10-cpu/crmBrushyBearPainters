import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCheck, Clock, DollarSign, FileText, Percent, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  type EstimateStatus,
} from "@/lib/estimating/engine";
import { formatDate } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { logError } from "@/lib/log";
import {
  estimateMetricValue,
  parseEstimateStats,
  type EstimateMetricId,
} from "@/lib/metrics/registry";
import { cn } from "@/lib/utils";
import { PeriodSelect } from "../jobs/_dashboard/period-select";
import { parseJobPeriod, periodRange } from "../jobs/_dashboard/periods";

export const metadata: Metadata = { title: "Estimates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PAGE_SIZE = 50;

const tone = (s: string) =>
  s === "accepted"
    ? "success"
    : s === "draft"
      ? "neutral"
      : s === "declined" || s === "expired"
        ? "danger"
        : "info";

const ICONS: Record<EstimateMetricId, typeof Send> = {
  "estimates.sent": Send,
  "estimates.sla_24h": Clock,
  "estimates.close_rate": Percent,
  "estimates.close_rate_value": CheckCheck,
  "estimates.avg_job_value": DollarSign,
  "estimates.open_value": FileText,
};

/** Estimates (SPEC §8.5 #4, §9): every estimate with its status, plus the estimate KPIs. */
export default async function EstimatesPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  if (!viewer.can("estimates:read")) notFound();
  const sp = await searchParams;
  const period = parseJobPeriod(sp.period);
  const range = periodRange(period, new Date());
  const rawStatus = one(sp.status);
  const status = (ESTIMATE_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? (rawStatus as EstimateStatus)
    : null;
  const page = Math.max(1, Math.min(1000, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const supabase = await createSupabaseServerClient();

  let list = supabase
    .from("estimates")
    .select(
      "id, estimate_number, title, status, total_cents, sent_at, viewed_at, accepted_at, expires_at, current_version_id, created_at, job:jobs!estimates_job_id_fkey(id, job_number, name)",
      { count: "exact" },
    )
    .is("deleted_at", null);
  if (status) list = list.eq("status", status);
  const [stats, counts, rows] = await Promise.all([
    supabase.rpc("estimate_stats", { p_from: range.from, p_to: range.to }),
    supabase.rpc("estimate_status_counts"),
    list
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ]);
  if (stats.error) logError("estimates.stats", stats.error);
  if (rows.error) throw rows.error;
  const s = parseEstimateStats(stats.data);
  const c = (counts.data ?? {}) as { total?: number; by_status?: Record<string, number> };
  const metricIds = Object.keys(ICONS) as EstimateMetricId[];
  const total = rows.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: { status?: string | null; page?: number }) => {
    const p = new URLSearchParams();
    if (period !== "this_month") p.set("period", period);
    const st = patch.status === undefined ? status : patch.status;
    if (st) p.set("status", st);
    if (patch.page && patch.page > 1) p.set("page", String(patch.page));
    const q = p.toString();
    return `/estimates${q ? `?${q}` : ""}`;
  };

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Estimates"
        description="Every estimate and its status. Start a new one from the job's Estimate & Scope section."
        actions={<PeriodSelect value={period} />}
      />
      <section
        aria-label="Estimate KPIs"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
      >
        {metricIds.map((id) => {
          const m = estimateMetricValue(id, s, range.words.period);
          return (
            <KpiCard
              key={id}
              label={m.label}
              value={m.display}
              caption={m.caption}
              icon={ICONS[id]}
            />
          );
        })}
      </section>
      <nav aria-label="Status" className="-mx-1 overflow-x-auto px-1">
        <ul className="flex gap-1 border-b">
          {[null, ...ESTIMATE_STATUSES].map((st) => {
            const n = st ? (c.by_status?.[st] ?? 0) : (c.total ?? 0);
            return (
              <li key={st ?? "all"}>
                <Link
                  href={href({ status: st, page: 1 })}
                  aria-current={status === st ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1 border-b-2 px-3 text-sm whitespace-nowrap",
                    status === st
                      ? "border-bb-forest font-semibold text-bb-forest"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {st ? ESTIMATE_STATUS_LABELS[st] : "All"}
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {(rows.data ?? []).length === 0 ? (
        <EmptyState icon={FileText} title={status ? "Nothing here" : "No estimates yet"}>
          <p>
            {status
              ? "No estimates with this status."
              : "Estimates start from a job after the walkthrough: open the job, then Estimate & Scope."}
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Estimate</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Sent</th>
                <th className="px-4 py-2 font-medium">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rows.data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2">
                    {e.job && e.current_version_id ? (
                      <Link
                        href={`/jobs/${e.job.id}/estimate/${e.current_version_id}`}
                        className="font-medium text-bb-forest hover:underline"
                      >
                        {e.estimate_number}
                      </Link>
                    ) : (
                      e.estimate_number
                    )}
                    {e.title && (
                      <span className="block text-xs text-muted-foreground">{e.title}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {e.job ? (
                      <Link href={`/jobs/${e.job.id}?section=estimate`} className="hover:underline">
                        {e.job.job_number} · {e.job.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={tone(e.status)}>
                      {ESTIMATE_STATUS_LABELS[e.status as EstimateStatus] ?? e.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatCents(e.total_cents)}
                  </td>
                  <td className="px-4 py-2">{e.sent_at ? formatDate(e.sent_at) : "—"}</td>
                  <td className="px-4 py-2">
                    {e.expires_at && e.status !== "accepted" ? formatDate(e.expires_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {total} estimates
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link className="rounded-md border px-3 py-2" href={href({ page: page - 1 })}>
                Previous
              </Link>
            )}
            {page < pages && (
              <Link className="rounded-md border px-3 py-2" href={href({ page: page + 1 })}>
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </PageContainer>
  );
}
