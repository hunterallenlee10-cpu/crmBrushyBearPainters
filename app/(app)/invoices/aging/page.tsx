import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AGING_BUCKETS, AGING_LABELS, agingBucket } from "@/lib/domain/ledger/aging";
import { formatDay, pacificToday } from "@/lib/domain/scheduling/dates";
import { formatCents } from "@/lib/format/money";
import { loadFinanceStats } from "@/lib/money/stats";
import { AGING_METRIC_IDS, agingCount, financeMetricValue } from "@/lib/metrics/registry";

export const metadata: Metadata = { title: "A/R Aging" };

const LIMIT = 500;

/** A/R aging (SPEC §10, §8.14): Current, 1–30, 31–60, 61–90, 90+ days past due. */
export default async function AgingPage() {
  await requirePermission("invoices:read");
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const [stats, open] = await Promise.all([
    loadFinanceStats(supabase, today, today),
    supabase
      .from("invoice_ledger")
      .select(
        "id, job_id, invoice_number, job_name, account_name, due_date, balance_cents, days_past_due",
      )
      .eq("issued", true)
      .neq("balance_cents", 0)
      .order("days_past_due", { ascending: false })
      .order("due_date", { ascending: true })
      .limit(LIMIT),
  ]);
  if (open.error) throw open.error;
  const rows = open.data ?? [];
  const total = financeMetricValue("finance.ar_outstanding", stats);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="A/R Aging"
        description={`${total.display} owed on sent invoices right now, by days past due. Credit memos net against what's owed.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/invoices">
              <ArrowLeft aria-hidden /> Invoices
            </Link>
          </Button>
        }
      />
      <section aria-label="Aging buckets" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {AGING_METRIC_IDS.map((id, i) => {
          const m = financeMetricValue(id, stats);
          return (
            <KpiCard
              key={id}
              label={m.label}
              value={m.display}
              caption={`${agingCount(stats, id)} invoice${agingCount(stats, id) === 1 ? "" : "s"} · ${m.caption}`}
              icon={CalendarClock}
              tone={i === 0 ? "success" : i === 1 ? "warning" : "danger"}
            />
          );
        })}
      </section>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing owed">
          No sent invoice has money owed. When an invoice is sent and not paid, it shows here by how
          late it is.
        </EmptyState>
      ) : (
        AGING_BUCKETS.map((b) => {
          const list = rows.filter((r) => agingBucket(r.days_past_due ?? 0) === b);
          if (!list.length) return null;
          return (
            <section key={b} aria-labelledby={`aging-${b}`} className="rounded-2xl border bg-card">
              <h2 id={`aging-${b}`} className="border-b px-4 py-2 text-base font-semibold">
                {AGING_LABELS[b]} ·{" "}
                {formatCents(list.reduce((s, r) => s + (r.balance_cents ?? 0), 0))}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Invoice</th>
                      <th className="px-4 py-2 font-medium">Job</th>
                      <th className="px-4 py-2 font-medium">Customer</th>
                      <th className="px-4 py-2 font-medium">Due</th>
                      <th className="px-4 py-2 text-right font-medium">Days late</th>
                      <th className="px-4 py-2 text-right font-medium">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">
                          <Link
                            href={`/jobs/${r.job_id}?section=financial&tab=invoices&invoice=${r.id}`}
                            className="font-medium text-bb-forest hover:underline"
                          >
                            {r.invoice_number}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{r.job_name}</td>
                        <td className="px-4 py-2">{r.account_name ?? "—"}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {r.due_date ? formatDay(r.due_date) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {r.days_past_due ?? 0}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatCents(r.balance_cents ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
      {rows.length >= LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing the {LIMIT} most overdue invoices; bucket totals above count every invoice.
        </p>
      )}
    </div>
  );
}
