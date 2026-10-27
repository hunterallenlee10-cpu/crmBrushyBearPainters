import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { monthLabel, monthOf, previousMonth } from "@/lib/domain/ledger/periods";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { formatCents } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { loadFinanceStats } from "@/lib/money/stats";
import { financeMetricValue } from "@/lib/metrics/registry";
import { FinanceClient, type MonthRow } from "./finance-client";

export const metadata: Metadata = { title: "Finance" };

/**
 * Admin → Finance (SPEC §8.19, §10): reconciliation (jobs whose money doesn't
 * add up, in plain words) and month close. Closing locks invoices issued and
 * payments received in that month; changing them afterwards needs an owner
 * override with a reason, and only an owner can reopen a month.
 */
export default async function FinancePage() {
  const viewer = await requirePermission("finance:close_month");
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const current = monthOf(today);
  const months: string[] = [];
  let m = previousMonth(current);
  for (let i = 0; i < 12; i++) {
    months.push(m);
    m = previousMonth(m);
  }

  const [closes, issues, uncleared, stats] = await Promise.all([
    supabase
      .from("month_closes")
      .select(
        "month, status, closed_at, note, summary, reopened_at, reopen_reason, closer:profiles!month_closes_closed_by_fkey(full_name)",
      )
      .order("month", { ascending: false })
      .limit(24),
    supabase
      .from("job_ledger")
      .select("job_id, unapplied_cents, balance_cents, left_to_bill_cents, stage")
      .or("unapplied_cents.gt.0,balance_cents.lt.0,left_to_bill_cents.lt.0")
      .limit(200),
    supabase
      .from("payment_ledger")
      .select("id, job_id, payment_number, amount_cents, received_on")
      .eq("status", "received")
      .lt("received_on", new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10))
      .order("received_on")
      .limit(200),
    loadFinanceStats(supabase, `${current}-01`, today),
  ]);
  const jobIds = [
    ...new Set(
      [
        ...(issues.data ?? []).map((r) => r.job_id),
        ...(uncleared.data ?? []).map((r) => r.job_id),
      ].filter((x): x is string => !!x),
    ),
  ];
  const { data: jobs } = jobIds.length
    ? await supabase.from("jobs").select("id, name, job_number").in("id", jobIds)
    : { data: [] as { id: string; name: string; job_number: string }[] };
  const jobName = new Map((jobs ?? []).map((j) => [j.id, `${j.name} (${j.job_number})`]));

  const findings: { key: string; jobId: string; job: string; message: string }[] = [];
  for (const r of issues.data ?? []) {
    if (!r.job_id) continue;
    const job = jobName.get(r.job_id) ?? "A job";
    if ((r.unapplied_cents ?? 0) > 0)
      findings.push({
        key: `${r.job_id}:u`,
        jobId: r.job_id,
        job,
        message: `A payment was recorded but not applied to an invoice (${formatCents(r.unapplied_cents)} unapplied). Apply it to update the balance.`,
      });
    if ((r.balance_cents ?? 0) < 0)
      findings.push({
        key: `${r.job_id}:o`,
        jobId: r.job_id,
        job,
        message: `The customer has paid ${formatCents(-(r.balance_cents ?? 0))} more than was billed. Refund it or bill it.`,
      });
    if ((r.left_to_bill_cents ?? 0) < 0)
      findings.push({
        key: `${r.job_id}:b`,
        jobId: r.job_id,
        job,
        message: `Invoices add up to ${formatCents(-(r.left_to_bill_cents ?? 0))} more than the contract.`,
      });
  }
  for (const p of uncleared.data ?? []) {
    if (!p.job_id) continue;
    findings.push({
      key: `${p.id}:c`,
      jobId: p.job_id,
      job: jobName.get(p.job_id) ?? "A job",
      message: `${p.payment_number} (${formatCents(p.amount_cents)}) was received on ${p.received_on} and isn't marked cleared.`,
    });
  }

  const byMonth = new Map((closes.data ?? []).map((c) => [monthOf(c.month), c]));
  const rows: MonthRow[] = months.map((mo) => {
    const c = byMonth.get(mo);
    const summary =
      c?.summary && typeof c.summary === "object" && !Array.isArray(c.summary) ? c.summary : {};
    const num = (k: string) => (typeof summary[k] === "number" ? (summary[k] as number) : null);
    return {
      month: mo,
      label: monthLabel(mo),
      status: c?.status === "closed" ? "closed" : c?.status === "reopened" ? "reopened" : "open",
      closedBy: c?.closer?.full_name ?? null,
      closedAt: c?.closed_at ? formatDate(c.closed_at) : null,
      note: c?.note ?? null,
      reopenReason: c?.reopen_reason ?? null,
      billedCents: num("billed_cents"),
      collectedCents: num("collected_cents"),
    };
  });
  const k = (id: Parameters<typeof financeMetricValue>[0]) => financeMetricValue(id, stats);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Finance"
        description="Reconciliation and month close. Figures come from the ledger; nothing here is typed in."
      />
      <section aria-label="This month" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            "finance.ar_outstanding",
            "finance.collected",
            "finance.unapplied",
            "finance.pending_credits",
          ] as const
        ).map((id) => (
          <div key={id} className="rounded-2xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{k(id).label}</p>
            <p className="text-xl font-bold tabular-nums">{k(id).display}</p>
            <p className="text-xs text-muted-foreground">{k(id).caption}</p>
          </div>
        ))}
      </section>
      <section aria-labelledby="recon-h" className="rounded-2xl border bg-card p-4">
        <h2 id="recon-h" className="mb-2 text-base font-semibold">
          Reconciliation
        </h2>
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Everything adds up: no unapplied payments, overpayments, over-billing or old uncleared
            payments.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {findings.map((f) => (
              <li key={f.key} className="py-2">
                <Link
                  href={`/jobs/${f.jobId}?section=financial`}
                  className="font-medium text-bb-forest hover:underline"
                >
                  {f.job}
                </Link>
                <span className="block">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <FinanceClient
        rows={rows}
        canReopen={viewer.can("finance:override_lock") && !viewer.impersonating}
        canClose={!viewer.impersonating}
      />
    </div>
  );
}
