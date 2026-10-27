import { FileDown, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptySection } from "@/components/jobs/empty-section";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDate } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";

const TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  progress: "Progress",
  final: "Final",
  change_order: "Change order",
  credit_memo: "Credit memo",
};

/**
 * Job → Financial (SPEC §8.5 #5). Phase 4 drafts the deposit invoice (and
 * change-order invoices) on acceptance; sending, payments and A/R arrive with
 * Money in Phase 7.
 */
export async function FinancialSection({
  jobId,
  canReadInvoices,
  canReadFinancials,
}: {
  jobId: string;
  canReadInvoices: boolean;
  canReadFinancials: boolean;
}) {
  if (!canReadInvoices) {
    return (
      <EmptySection icon={Wallet} title="Financial" phase={7}>
        <p>Your role doesn&apos;t include job money.</p>
      </EmptySection>
    );
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, invoice_type, status, total_cents, issue_date, due_date, created_at",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(50);
  const invoices = data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="inv-h" className="flex flex-col gap-3">
        <h2 id="inv-h" className="text-lg font-semibold">
          Invoices
        </h2>
        {invoices.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            No invoices yet. The deposit invoice is drafted when the customer accepts the estimate.
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {invoices.map((i) => (
              <li
                key={i.id}
                className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {i.invoice_number} · {TYPE_LABELS[i.invoice_type] ?? i.invoice_type}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {i.issue_date
                      ? `Issued ${formatDate(i.issue_date)}`
                      : `Drafted ${formatDate(i.created_at)}`}
                    {i.due_date ? ` · due ${formatDate(i.due_date)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatCents(i.total_cents)}
                  </span>
                  <Badge
                    variant={
                      i.status === "paid" ? "success" : i.status === "draft" ? "neutral" : "info"
                    }
                  >
                    {i.status === "draft" ? "Draft" : i.status}
                  </Badge>
                  <a
                    href={`/jobs/${jobId}/invoices/${i.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-bb-forest hover:underline sm:min-h-9"
                  >
                    <FileDown className="size-4" aria-hidden />
                    PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <EmptySection icon={Wallet} title="Payments and job costing" phase={7}>
        <p>
          {canReadFinancials
            ? "Sending invoices, recording payments, the money summary and job costing arrive with Money."
            : "Payments arrive with Money."}
        </p>
      </EmptySection>
    </div>
  );
}
