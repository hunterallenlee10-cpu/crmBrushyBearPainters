import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, CheckCircle2, FolderOpen, Plus, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Button } from "@/components/ui/button";
import {
  CasePriorityBadge,
  CaseSlaBadge,
  CaseStatusBadge,
  CaseTypeLabel,
} from "@/components/cases/case-badges";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { CASE_FILTERS, CASE_PAGE, loadCases, type CaseFilter } from "@/lib/cases/load";
import { formatDateTime, formatRelative } from "@/lib/format/dates";
import { loadCommunicationStats } from "@/lib/messaging/stats";
import { communicationMetricValue, type CommunicationMetricId } from "@/lib/metrics/registry";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Warranty & Service" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const KPIS: {
  id: CommunicationMetricId;
  icon: typeof FolderOpen;
  tone: "brand" | "danger" | "warning" | "success";
  filter: CaseFilter;
}[] = [
  { id: "cases.open", icon: FolderOpen, tone: "brand", filter: "open" },
  { id: "cases.overdue", icon: AlarmClock, tone: "danger", filter: "overdue" },
  { id: "cases.warranty_open", icon: ShieldCheck, tone: "warning", filter: "warranty" },
  { id: "cases.on_time_rate", icon: CheckCircle2, tone: "success", filter: "resolved" },
];

/**
 * Warranty & Service (SPEC §5.7, §8.16): every warranty, touch-up and service
 * case with its SLA (business days, Messaging settings). Opening a case
 * schedules a warranty visit, sends the customer an update and resolves it.
 */
export default async function CasesPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("cases:read");
  const sp = await searchParams;
  const filter: CaseFilter = CASE_FILTERS.some((f) => f.id === one(sp.filter))
    ? (one(sp.filter) as CaseFilter)
    : "open";
  const page = Math.max(1, Math.min(200, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const [list, stats] = await Promise.all([
    loadCases(supabase, { filter, page, now }),
    loadCommunicationStats(supabase, { days: 90 }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / CASE_PAGE));
  const href = (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ filter, ...p })) if (v) q.set(k, v);
    return `/cases?${q.toString()}`;
  };

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Warranty & Service"
        description="Warranty requests, touch-ups and service calls. Each case has an SLA in business days; past it, the case turns red on the Attention Center."
        actions={
          viewer.can("cases:manage") && !viewer.impersonating ? (
            <Button asChild>
              <Link href="/cases/new">
                <Plus className="size-4" aria-hidden /> New case
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => {
          const v = communicationMetricValue(k.id, stats);
          return (
            <KpiCard
              key={k.id}
              label={v.label}
              value={v.display}
              caption={v.caption}
              icon={k.icon}
              tone={k.tone}
              href={href({ filter: k.filter, page: null })}
            />
          );
        })}
      </div>

      <nav aria-label="Case filters" className="flex flex-wrap gap-1">
        {CASE_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={href({ filter: f.id, page: null })}
            aria-current={f.id === filter ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              f.id === filter ? "border-bb-forest bg-bb-forest text-white" : "hover:bg-muted",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {list.items.length === 0 ? (
        <EmptyState icon={FolderOpen} title={filter === "open" ? "No open cases" : "No cases here"}>
          {filter === "open"
            ? "When a customer calls about a touch-up or a warranty issue, open a case so it gets a visit and an answer on time."
            : "Try another filter."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Cases</caption>
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Case
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Job / customer
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {filter === "resolved" ? "Resolved" : "SLA due"}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Owner
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((c) => (
                <tr
                  key={c.id}
                  className={cn("border-b last:border-0", c.overdue && "bg-danger-bg/40")}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/cases/${c.id}`}
                      className="font-medium text-bb-forest hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="text-xs text-muted-foreground tabular-nums">{c.number}</div>
                  </td>
                  <td className="px-3 py-2">
                    {c.job ? (
                      <Link href={`/jobs/${c.job.id}`} className="hover:underline">
                        {c.job.name}
                      </Link>
                    ) : (
                      (c.account?.name ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <CaseTypeLabel type={c.type} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      <CaseStatusBadge status={c.status} />
                      <CasePriorityBadge priority={c.priority} />
                      <CaseSlaBadge status={c.status} slaDueAt={c.slaDueAt} now={now} />
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {filter === "resolved" && c.resolvedAt ? (
                      formatRelative(c.resolvedAt)
                    ) : (
                      <time dateTime={c.slaDueAt}>{formatDateTime(c.slaDueAt)}</time>
                    )}
                  </td>
                  <td className="px-3 py-2">{c.ownerName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>Previous</Link> : <span />}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={href({ page: String(page + 1) })}>Next</Link> : <span />}
        </nav>
      )}
    </PageContainer>
  );
}
