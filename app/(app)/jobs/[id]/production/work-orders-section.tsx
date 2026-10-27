import Link from "next/link";
import { ClipboardList, Clock, HardHat, PaintBucket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/kpi/kpi-card";
import { WorkOrderControls } from "@/components/production/work-order-controls";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { materialsStatus } from "@/lib/domain/scheduling/readiness";
import { formatCents } from "@/lib/format/money";
import { formatDate } from "@/lib/format/dates";
import { loadWorkOrdersSection } from "@/lib/production/job";
import {
  GeneratePaintOrderButton,
  PaintOrderControls,
} from "@/app/(app)/schedule/(center)/paint-orders/paint-order-row";
import type { JobDetailData } from "../types";

const WO_STATUS: Record<string, string> = {
  new: "New",
  scheduled: "Scheduled",
  in_progress: "In progress",
  pending_approval: "Pending approval",
  completed: "Completed",
  canceled: "Canceled",
};
const PO_STATUS: Record<string, string> = {
  draft: "Draft",
  waiting_to_order: "Waiting to order",
  ordered: "Ordered",
  partially_received: "Partially received",
  picked_up: "Picked up",
  delivered: "Delivered",
  canceled: "Canceled",
};
const MATERIALS: Record<string, string> = {
  none: "No paint order yet",
  not_ordered: "Not ordered",
  ordered: "Ordered",
  ready: "Ready (picked up / delivered)",
};

const hrs = (n: number) => `${Math.round(n * 10) / 10} h`;

/** Job → Work Orders (SPEC §8.5 #8): work orders, paint orders, labor vs. subcontractor hours. */
export async function WorkOrdersSection({ data }: { data: JobDetailData }) {
  const viewer = await requireViewer();
  const { job } = data;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const w = await loadWorkOrdersSection(
    { supabase, service },
    { orgId: viewer.orgId, jobId: job.id },
  );
  const writable = !data.readOnly;
  const canManage = writable && viewer.can("work_orders:manage");
  const canField = writable && viewer.can("daily_logs:create");
  const canPaint = writable && viewer.can("paint_orders:manage");
  const live = w.workOrders.filter((x) => x.status !== "canceled");
  const open = live.filter((x) => x.status !== "completed").length;
  const budget = live.reduce((a, x) => a + x.budgetedHours, 0);
  const logged = live.reduce((a, x) => a + x.loggedHours, 0);
  const materials = materialsStatus(w.paintOrders.map((p) => p.status));
  const crewName = new Map(w.crews.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Work order tiles" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Work orders"
          value={live.length}
          caption={`${open} open`}
          icon={ClipboardList}
        />
        <KpiCard
          label="Budgeted hours"
          value={hrs(budget)}
          caption="From the accepted estimate"
          icon={Clock}
          tone="info"
        />
        <KpiCard
          label="Logged hours"
          value={hrs(logged)}
          caption={
            budget
              ? `${Math.round((logged / budget) * 100)}% of budget · daily logs`
              : "From daily logs"
          }
          icon={HardHat}
          tone={budget && logged > budget ? "danger" : "neutral"}
        />
        <KpiCard
          label="Materials"
          value={MATERIALS[materials] ?? materials}
          caption={`${w.paintOrders.length} paint order${w.paintOrders.length === 1 ? "" : "s"}`}
          icon={PaintBucket}
          tone={materials === "ready" ? "success" : "warning"}
        />
      </section>

      <section aria-label="Work orders" className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">Work orders</h3>
          <Link href={`/jobs/${job.id}?section=schedule`} className="text-sm underline">
            Production schedule
          </Link>
        </div>
        {w.workOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Work orders are created from the accepted estimate&apos;s phases when the job is sold.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {w.workOrders.map((x) => (
              <li
                key={x.id}
                className="flex flex-col gap-2 py-3 text-sm lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {x.number} · {x.title}{" "}
                    <Badge variant="outline" className="ml-1">
                      {WO_STATUS[x.status] ?? x.status}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      x.phase.replace(/_/g, " "),
                      x.crewId ? (crewName.get(x.crewId) ?? "Crew") : "No crew",
                      `${hrs(x.loggedHours)} logged of ${hrs(x.budgetedHours)}`,
                      x.completedAt ? `Completed ${formatDate(x.completedAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {x.scope && (
                    <p className="mt-1 whitespace-pre-line text-muted-foreground">{x.scope}</p>
                  )}
                </div>
                {(canManage || canField) && (
                  <WorkOrderControls
                    id={x.id}
                    number={x.number}
                    status={x.status}
                    crewId={x.crewId}
                    crews={w.crews}
                    canManage={canManage}
                    canField={canField}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Finishing the last work order moves the job to Final Walkthrough.
        </p>
      </section>

      <section aria-label="Labor split" className="rounded-2xl border bg-card p-4">
        <h3 className="mb-2 text-base font-semibold">Labor vs. subcontractor (budgeted hours)</h3>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Our crews</dt>
            <dd className="font-semibold tabular-nums">{hrs(w.hoursByCrewType.employee)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Subcontractors</dt>
            <dd className="font-semibold tabular-nums">{hrs(w.hoursByCrewType.subcontractor)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">No crew yet</dt>
            <dd className="font-semibold tabular-nums">{hrs(w.hoursByCrewType.unassigned)}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Paint orders" className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Paint orders</h3>
          {canPaint && (
            <GeneratePaintOrderButton jobId={job.id} label={`${job.number} · ${job.name}`} />
          )}
        </div>
        {w.paintOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No paint order yet. Generate one from the estimate&apos;s materials.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {w.paintOrders.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-2 py-3 text-sm lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {p.number} · {PO_STATUS[p.status] ?? p.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      p.supplier ?? "No supplier yet",
                      p.expectedOn ? `Expected ${formatDate(p.expectedOn)}` : null,
                      data.can.readFinancials ? formatCents(p.totalCostCents) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canPaint && (
                  <PaintOrderControls
                    id={p.id}
                    po={p.number}
                    status={p.status}
                    supplier={p.supplier}
                    expectedOn={p.expectedOn}
                    fulfillment={p.fulfillment}
                    disabled={false}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
