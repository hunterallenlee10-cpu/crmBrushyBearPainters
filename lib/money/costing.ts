import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { computeJobCosting, type JobCosting } from "@/lib/domain/ledger/costing";
import type { ExpenseCategory } from "@/lib/domain/ledger/types";

type Db = SupabaseClient<Database>;

/**
 * Job costing (SPEC §5.6): labor = hours × each person's hourly cost
 * (time entries from daily logs and clocking), materials = paint orders,
 * subcontractor POs = work orders, plus expenses with receipts. Read with the
 * person's own client: only owners and the bookkeeper (job_costing:read) can
 * see expenses and hourly costs, so the caller checks that permission first.
 */

export type ExpenseRow = {
  id: string;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amountCents: number;
  spentOn: string;
  hasReceipt: boolean;
  receiptMime: string | null;
  createdAt: string;
};

export type JobCostingView = JobCosting & {
  expenses: ExpenseRow[];
  materials: { label: string; cents: number; status: string }[];
  subcontractors: { label: string; cents: number }[];
};

export async function loadJobCosting(
  db: Db,
  jobId: string,
  revenueCents: number,
): Promise<JobCostingView> {
  const [hours, paint, workOrders, expenses] = await Promise.all([
    db
      .from("time_entries")
      .select("user_id, member_name, hours, person:profiles!time_entries_user_id_fkey(full_name)")
      .eq("job_id", jobId)
      .is("deleted_at", null),
    db
      .from("paint_orders")
      .select("po_number, status, total_cost_cents")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .neq("status", "canceled"),
    db
      .from("work_orders")
      .select(
        "work_order_number, title, status, budgeted_hours, costs:work_order_costs(sub_po_cents)",
      )
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .neq("status", "canceled"),
    db
      .from("job_expenses")
      .select(
        "id, category, description, vendor, amount_cents, spent_on, receipt_path, receipt_mime, created_at",
      )
      .eq("job_id", jobId)
      .order("spent_on", { ascending: false }),
  ]);
  const userIds = [
    ...new Set((hours.data ?? []).map((h) => h.user_id).filter((u): u is string => !!u)),
  ];
  const { data: rates } = userIds.length
    ? await db
        .from("profile_compensation")
        .select("profile_id, hourly_cost_cents")
        .in("profile_id", userIds)
    : { data: [] as { profile_id: string; hourly_cost_cents: number | null }[] };
  const rate = new Map((rates ?? []).map((r) => [r.profile_id, r.hourly_cost_cents]));

  const materials = (paint.data ?? []).map((p) => ({
    label: p.po_number,
    cents: Number(p.total_cost_cents ?? 0),
    status: p.status,
  }));
  const subcontractors = (workOrders.data ?? []).flatMap((w) => {
    const c = Array.isArray(w.costs) ? w.costs[0] : w.costs;
    const cents = c?.sub_po_cents ?? 0;
    return cents > 0 ? [{ label: `${w.work_order_number} · ${w.title}`, cents }] : [];
  });
  const expenseRows: ExpenseRow[] = (expenses.data ?? []).map((e) => ({
    id: e.id,
    category: e.category as ExpenseCategory,
    description: e.description,
    vendor: e.vendor,
    amountCents: e.amount_cents,
    spentOn: e.spent_on,
    hasReceipt: !!e.receipt_path,
    receiptMime: e.receipt_mime,
    createdAt: e.created_at,
  }));
  const costing = computeJobCosting({
    revenueCents,
    labor: (hours.data ?? []).map((h) => ({
      userId: h.user_id,
      name: h.person?.full_name ?? h.member_name ?? "Crew member",
      hours: Number(h.hours),
      rateCents: h.user_id ? (rate.get(h.user_id) ?? null) : null,
    })),
    materials,
    subcontractors,
    expenses: expenseRows.map((e) => ({ label: e.description, cents: e.amountCents })),
    budgetedHours: (workOrders.data ?? []).reduce((s, w) => s + Number(w.budgeted_hours ?? 0), 0),
  });
  return { ...costing, expenses: expenseRows, materials, subcontractors };
}
