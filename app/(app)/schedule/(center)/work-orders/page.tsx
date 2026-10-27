import type { Metadata } from "next";
import Link from "next/link";
import { HardHat } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { WorkOrderControls } from "@/components/production/work-order-controls";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatRange, pacificToday } from "@/lib/domain/scheduling/dates";

export const metadata: Metadata = { title: "Work Orders" };

const TABS = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "pending_approval", label: "Pending Approval" },
  { id: "past_due", label: "Past Due" },
] as const;

const PHASES: Record<string, string> = {
  prep: "Prep",
  repair: "Repair",
  paint: "Paint",
  cabinet_shop: "Cabinet shop",
  stain: "Stain",
  touch_up: "Touch-up",
  warranty: "Warranty",
};

/** Work Orders (SPEC §8.6): every work order across jobs. */
export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const viewer = await requirePermission("work_orders:read");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.id === sp.tab) ?? TABS[0];
  const today = pacificToday(new Date());
  const supabase = await createSupabaseServerClient();
  const [rows, crews] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        "id, work_order_number, job_id, phase, title, status, crew_id, scheduled_start, scheduled_end, budgeted_hours, actual_hours, job:jobs(name, job_number, stage)",
      )
      .neq("status", "canceled")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("crews").select("id, name").eq("active", true).order("name"),
  ]);
  const all = rows.data ?? [];
  const pastDue = (w: (typeof all)[number]) =>
    w.status !== "completed" && !!w.scheduled_end && w.scheduled_end < today;
  const pick = (id: string) =>
    id === "all"
      ? all
      : id === "past_due"
        ? all.filter(pastDue)
        : all.filter((w) => w.status === id);
  const shown = pick(tab.id);
  const crewName = new Map((crews.data ?? []).map((c) => [c.id, c.name]));
  const canManage = viewer.can("work_orders:manage") && !viewer.impersonating;
  const canField = viewer.can("daily_logs:create") && !viewer.impersonating;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Work Orders"
        description="Prep, repair, paint and touch-up work orders on every job."
      />
      <nav
        aria-label="Work order status"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
      >
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/schedule/work-orders?tab=${t.id}`}
            aria-current={t.id === tab.id ? "page" : undefined}
            className={`rounded-2xl border p-3 ${t.id === tab.id ? "border-bb-forest bg-accent" : "bg-card"}`}
          >
            <span className="block text-xs text-muted-foreground">{t.label}</span>
            <span className="text-xl font-bold tabular-nums">{pick(t.id).length}</span>
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <EmptyState icon={HardHat} title="No work orders here">
          <p>Work orders are drafted from the accepted estimate, one per phase.</p>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Work order</th>
                <th className="p-3 font-medium">Job</th>
                <th className="p-3 font-medium">Phase</th>
                <th className="p-3 font-medium">Dates</th>
                <th className="p-3 font-medium">Hours (budget / actual)</th>
                <th className="p-3 font-medium">Crew</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => (
                <tr key={w.id} className="border-b align-top last:border-0">
                  <td className="p-3">
                    <span className="font-medium">{w.work_order_number}</span>
                    <span className="block text-xs text-muted-foreground">{w.title}</span>
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/jobs/${w.job_id}?section=work-orders`}
                      className="text-bb-forest hover:underline"
                    >
                      {w.job ? `${w.job.job_number} · ${w.job.name}` : "Job"}
                    </Link>
                  </td>
                  <td className="p-3">{PHASES[w.phase] ?? w.phase}</td>
                  <td className="p-3">
                    {w.scheduled_start && w.scheduled_end
                      ? formatRange(w.scheduled_start, w.scheduled_end)
                      : "—"}
                    {pastDue(w) && <span className="block text-xs text-danger">Past due</span>}
                  </td>
                  <td className="p-3 tabular-nums">
                    {Number(w.budgeted_hours)} /{" "}
                    {w.actual_hours === null ? "—" : Number(w.actual_hours)}
                  </td>
                  <td className="p-3">{w.crew_id ? (crewName.get(w.crew_id) ?? "Crew") : "—"}</td>
                  <td className="p-3">
                    <WorkOrderControls
                      id={w.id}
                      number={w.work_order_number}
                      status={w.status}
                      crewId={w.crew_id}
                      crews={crews.data ?? []}
                      canManage={canManage}
                      canField={canField}
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
