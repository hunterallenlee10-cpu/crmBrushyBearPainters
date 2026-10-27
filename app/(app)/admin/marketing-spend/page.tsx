import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { centsToDollars } from "@/lib/validation/common";
import { monthStart, pacificToday, ymdString } from "@/lib/domain/analytics/periods";
import { monthLabel } from "@/lib/metrics/registry";
import { SpendForm } from "./spend-form";

export const metadata: Metadata = { title: "Marketing Spend" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Admin → Marketing Spend (SPEC §12.1): monthly spend per lead source, used
 * for cost per lead and customer acquisition cost. Spend is prorated by day
 * when a period covers part of a month.
 */
export default async function MarketingSpendPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("settings:manage");
  const sp = await searchParams;
  const today = ymdString(pacificToday());
  const months = Array.from({ length: 14 }, (_, i) => monthStart(today, 1 - i));
  const month =
    typeof sp.month === "string" && months.includes(sp.month) ? sp.month : monthStart(today);
  const db = await createSupabaseServerClient();
  const [sourcesRes, spendRes] = await Promise.all([
    db
      .from("picklists")
      .select("picklist_values(value, label, active, sort_order)")
      .eq("key", "lead_source")
      .maybeSingle(),
    db
      .from("marketing_spend")
      .select("month, lead_source, amount_cents")
      .gte("month", months.at(-1)!)
      .order("month"),
  ]);
  const sources = [...(sourcesRes.data?.picklist_values ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const spend = spendRes.data ?? [];
  const thisMonth = new Map(
    spend.filter((s) => s.month === month).map((s) => [s.lead_source, s.amount_cents]),
  );
  const totals = new Map<string, number>();
  for (const s of spend) totals.set(s.month, (totals.get(s.month) ?? 0) + Number(s.amount_cents));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketing Spend"
        description="What you spend each month per lead source. Analytics uses it for cost per lead and customer acquisition cost (spend isn't split by work type, city or owner). Leave a source empty if you spent nothing."
      />
      <SpendForm
        month={month}
        months={months.map((m) => ({
          value: m,
          label: `${monthLabel(m)}${totals.get(m) ? ` · $${(totals.get(m)! / 100).toLocaleString("en-US")}` : ""}`,
        }))}
        rows={sources.map((s) => ({
          source: s.value,
          label: s.label,
          active: s.active,
          amount: thisMonth.has(s.value) ? centsToDollars(Number(thisMonth.get(s.value))) : "",
        }))}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
