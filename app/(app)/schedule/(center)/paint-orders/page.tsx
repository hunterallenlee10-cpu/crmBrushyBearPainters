import type { Metadata } from "next";
import Link from "next/link";
import { PaintBucket } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { daysBetween, formatDay, pacificToday } from "@/lib/domain/scheduling/dates";
import { formatMoney } from "@/lib/metrics/registry";
import { GeneratePaintOrderButton, PaintOrderControls } from "./paint-order-row";

export const metadata: Metadata = { title: "Paint Orders" };

const TABS = [
  { id: "waiting", label: "Waiting to Order", statuses: ["draft", "waiting_to_order"] },
  { id: "ordered", label: "Ordered", statuses: ["ordered"] },
  { id: "partial", label: "Partially Received", statuses: ["partially_received"] },
  { id: "done", label: "Picked Up / Delivered", statuses: ["picked_up", "delivered"] },
] as const;

/** Paint Orders (SPEC §8.6 Order Manager): the order queue by status. */
export default async function PaintOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requirePermission("paint_orders:manage");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab) ?? TABS[0];
  const supabase = await createSupabaseServerClient();
  const today = pacificToday(new Date());
  const [orders, counts, missing] = await Promise.all([
    supabase
      .from("paint_orders")
      .select(
        "id, po_number, status, supplier, fulfillment, expected_on, total_cost_cents, created_at, ordered_at, external_ref, job:jobs(id, name, job_number, stage, account:accounts(display_name), property:properties!jobs_property_id_fkey(city), pm:profiles!jobs_project_manager_id_fkey(full_name)), lines:paint_order_lines(label, color_name, sheen, gallons, is_sundries)",
      )
      .in("status", [...tab.statuses])
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("paint_orders").select("status").neq("status", "canceled").limit(5000),
    supabase
      .from("jobs")
      .select("id, name, job_number, accepted_estimate_id, paint_orders(status, deleted_at)")
      .in("stage", ["onboarding", "ready_to_schedule", "scheduled"])
      .not("accepted_estimate_id", "is", null)
      .limit(300),
  ]);
  const count = (statuses: readonly string[]) =>
    (counts.data ?? []).filter((o) => statuses.includes(o.status)).length;
  const withoutOrder = (missing.data ?? []).filter(
    (j) => !(j.paint_orders ?? []).some((o) => o.status !== "canceled" && !o.deleted_at),
  );
  const money = viewer.can("financials:read") || viewer.can("job_costing:read");
  const ro = viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Paint Orders"
        description="Every paint and materials order from Waiting to Order to picked up or delivered."
      />
      <nav aria-label="Paint order status" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/schedule/paint-orders?tab=${t.id}`}
            aria-current={t.id === tab.id ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${t.id === tab.id ? "bg-bb-forest text-white" : "bg-card"}`}
          >
            {t.label} ({count(t.statuses)})
          </Link>
        ))}
      </nav>
      {withoutOrder.length > 0 && (
        <section
          aria-labelledby="po-missing"
          className="rounded-2xl border border-warning/40 bg-warning-bg/30 p-3"
        >
          <h2 id="po-missing" className="text-sm font-semibold">
            Jobs with no paint order ({withoutOrder.length})
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {withoutOrder.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link
                  href={`/jobs/${j.id}?section=work-orders`}
                  className="text-bb-forest hover:underline"
                >
                  {j.job_number} · {j.name}
                </Link>
                {!ro && <GeneratePaintOrderButton jobId={j.id} label={j.job_number} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {(orders.data ?? []).length === 0 ? (
        <EmptyState icon={PaintBucket} title={`Nothing in ${tab.label}`}>
          <p>
            Paint orders are drafted from the accepted estimate. Move them along here as you order,
            receive and pick them up.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">PO</th>
                <th className="p-3 font-medium">Job / customer</th>
                <th className="p-3 font-medium">PM</th>
                <th className="p-3 font-medium">City</th>
                <th className="p-3 font-medium">Age</th>
                {money && <th className="p-3 font-medium">Cost</th>}
                <th className="p-3 font-medium">Products / colors</th>
                <th className="p-3 font-medium">Status · supplier · pickup/delivery</th>
              </tr>
            </thead>
            <tbody>
              {(orders.data ?? []).map((o) => (
                <tr key={o.id} className="border-b align-top last:border-0">
                  <td className="p-3 font-medium">{o.po_number}</td>
                  <td className="p-3">
                    {o.job ? (
                      <Link
                        href={`/jobs/${o.job.id}?section=work-orders`}
                        className="text-bb-forest hover:underline"
                      >
                        {o.job.job_number} · {o.job.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {o.job?.account?.display_name ?? ""}
                    </span>
                  </td>
                  <td className="p-3">{o.job?.pm?.full_name ?? "—"}</td>
                  <td className="p-3">{o.job?.property?.city ?? "—"}</td>
                  <td className="p-3 tabular-nums">
                    {daysBetween(o.created_at.slice(0, 10), today)} d
                  </td>
                  {money && (
                    <td className="p-3 tabular-nums">{formatMoney(Number(o.total_cost_cents))}</td>
                  )}
                  <td className="p-3 text-xs">
                    {(o.lines ?? [])
                      .filter((l) => !l.is_sundries)
                      .map(
                        (l) =>
                          `${l.label}${l.color_name ? ` – ${l.color_name}` : ""}${l.sheen ? ` (${l.sheen})` : ""}: ${Number(l.gallons)} gal`,
                      )
                      .join("; ") || "—"}
                    {o.expected_on && (
                      <span className="block text-muted-foreground">
                        Due {formatDay(o.expected_on)}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <PaintOrderControls
                      id={o.id}
                      po={o.po_number}
                      status={o.status}
                      supplier={o.supplier}
                      expectedOn={o.expected_on}
                      fulfillment={o.fulfillment}
                      disabled={ro}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
