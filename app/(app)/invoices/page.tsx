import type { Metadata } from "next";
import Link from "next/link";
import {
  AlarmClock,
  BarChart3,
  CircleDollarSign,
  FileClock,
  Percent,
  Receipt,
  Scale,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  INVOICE_TYPE_LABELS,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/domain/ledger/types";
import { formatDay, pacificToday } from "@/lib/domain/scheduling/dates";
import { formatCents } from "@/lib/format/money";
import { formatRelative } from "@/lib/format/dates";
import { filterToOps } from "@/lib/lists/filters";
import { INVOICES_LIST } from "@/lib/lists/modules/invoices";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import { applyOps, loadColumnPrefs, loadSavedViews } from "@/lib/lists/server";
import { loadFinanceStats } from "@/lib/money/stats";
import { financeMetricValue, type FinanceMetricId } from "@/lib/metrics/registry";
import { InvoiceStatusBadge } from "@/app/(app)/jobs/[id]/financial/ui";
import { InvoicesListClient } from "./invoices-list-client";

export const metadata: Metadata = { title: "Invoices" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SELECT =
  "id, job_id, invoice_number, invoice_type, display_status, issue_date, due_date, total_cents, collected_cents, balance_cents, days_past_due, accounting_sync_status, created_at, job_name, job_number, account_name, account_id";

const SYNC: Record<string, string> = {
  not_connected: "Not connected",
  pending: "Waiting",
  synced: "Synced",
  error: "Error",
};

/** Invoices (SPEC §8 lists, §10): every invoice with its live balance; KPIs from the registry. */
export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("invoices:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const today = pacificToday(now);
  const monthStart = `${today.slice(0, 8)}01`;
  const params = await searchParams;
  const mod = INVOICES_LIST;
  const state = parseListState(params, mod);

  const [stats, savedViews, columnPrefs] = await Promise.all([
    loadFinanceStats(supabase, monthStart, today),
    loadSavedViews(supabase, "invoices", viewer.real.id),
    loadColumnPrefs(supabase, viewer.real.id, "invoices"),
  ]);
  const view = savedViews.find((v) => v.id === state.view);
  const visibleColumns = resolveColumns(mod, view?.config.columns ?? columnPrefs);
  const ops = listOps(
    state,
    mod,
    { userId: viewer.id, now },
    filterToOps(state.filter, mod.fields, now),
  );
  const fromRow = (state.page - 1) * state.size;
  const { data, count, error } = await applyOps(
    supabase.from("invoice_ledger").select(SELECT, { count: "exact" }),
    ops,
  )
    .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(fromRow, fromRow + state.size - 1);
  if (error) throw error;

  const rows = (data ?? []).flatMap((i) => {
    if (!i.id || !i.job_id) return [];
    const href = `/jobs/${i.job_id}?section=financial&tab=invoices&invoice=${i.id}`;
    const status = (i.display_status ?? "draft") as InvoiceStatus;
    const amount = (c: number | null) => (
      <span className="text-xs whitespace-nowrap tabular-nums">{formatCents(c ?? 0)}</span>
    );
    return [
      {
        id: i.id,
        label: `${i.invoice_number} ${i.job_name ?? ""}`,
        cells: {
          number: (
            <Link
              href={href}
              className="font-medium whitespace-nowrap text-bb-forest hover:underline"
            >
              {i.invoice_number}
            </Link>
          ),
          job: (
            <Link href={`/jobs/${i.job_id}`} className="text-xs hover:underline">
              {i.job_name}
              <span className="block text-muted-foreground">{i.job_number}</span>
            </Link>
          ),
          account: <span className="text-xs">{i.account_name ?? "—"}</span>,
          type: (
            <span className="text-xs">
              {INVOICE_TYPE_LABELS[(i.invoice_type ?? "progress") as InvoiceType]}
            </span>
          ),
          status: <InvoiceStatusBadge status={status} type={i.invoice_type ?? undefined} />,
          issued: (
            <span className="text-xs whitespace-nowrap">
              {i.issue_date ? formatDay(i.issue_date) : "Not sent"}
            </span>
          ),
          due: (
            <span className="text-xs whitespace-nowrap">
              {i.due_date ? formatDay(i.due_date) : "—"}
            </span>
          ),
          total: amount(i.total_cents),
          paid: amount(i.collected_cents),
          balance: amount(i.balance_cents),
          late: (
            <span className="text-xs tabular-nums">
              {(i.days_past_due ?? 0) > 0 ? `${i.days_past_due} days` : "—"}
            </span>
          ),
          sync: <span className="text-xs">{SYNC[i.accounting_sync_status ?? ""] ?? "—"}</span>,
          created: (
            <span className="text-xs whitespace-nowrap">
              {i.created_at ? formatRelative(i.created_at, now) : ""}
            </span>
          ),
        },
      },
    ];
  });

  const tabCounts: Record<string, number> = {
    open: stats.invoices.open,
    overdue: stats.invoices.overdue,
    draft: stats.invoices.draft,
    paid: stats.invoices.paid,
    all: stats.invoices.all,
  };
  const tabs = mod.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: tabCounts[t.countKey] ?? null,
  }));
  const kpi = (id: FinanceMetricId) => financeMetricValue(id, stats);
  const cards: {
    id: FinanceMetricId;
    icon: typeof Receipt;
    href?: string;
    tone?: "danger" | "warning" | "success";
  }[] = [
    { id: "finance.ar_outstanding", icon: Scale, href: "/invoices?tab=open" },
    { id: "finance.overdue", icon: AlarmClock, href: "/invoices?tab=overdue", tone: "danger" },
    { id: "finance.collected", icon: CircleDollarSign, tone: "success" },
    { id: "finance.collection_rate", icon: Percent },
    { id: "finance.invoices_draft", icon: FileClock, href: "/invoices?tab=draft" },
    { id: "finance.unapplied", icon: Receipt, tone: "warning" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Invoices"
        description="Every balance is worked out from the payments applied to it. Period figures are this month (Pacific)."
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices/aging">
              <BarChart3 aria-hidden /> A/R aging
            </Link>
          </Button>
        }
      />
      <section
        aria-label="Invoice KPIs"
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      >
        {cards.map((c) => {
          const m = kpi(c.id);
          return (
            <KpiCard
              key={c.id}
              label={m.label}
              value={m.display}
              caption={m.caption}
              icon={c.icon}
              tone={c.tone}
              href={c.href}
            />
          );
        })}
      </section>
      <InvoicesListClient
        state={state}
        defaults={{ defaultTab: mod.defaultTab, defaultSort: mod.defaultSort }}
        tabs={tabs}
        chips={mod.chips}
        fields={mod.fields}
        allColumns={mod.columns}
        visibleColumns={visibleColumns}
        rows={rows}
        total={count}
        savedViews={savedViews}
        searchPlaceholder={mod.searchPlaceholder}
        emptyState={
          <EmptyState
            icon={Receipt}
            title={stats.invoices.all === 0 ? "No invoices yet" : "No invoices match"}
          >
            {stats.invoices.all === 0
              ? "The deposit invoice is drafted when a customer accepts an estimate; the final invoice when a job is Completed. Open a job's Financial section to bill it."
              : "Try another tab, remove a chip or clear the search."}
          </EmptyState>
        }
      />
    </div>
  );
}
