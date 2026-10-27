import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCommissionPlans, loadCommissionSettings } from "@/lib/commissions/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { payrollPreview } from "@/lib/domain/commissions";
import { CommissionsAdmin } from "./commissions-admin";

export const metadata: Metadata = { title: "Commissions" };

/**
 * Admin → Commissions (SPEC §10): plans by role (or person) with rates by
 * lead source, pay only when paid in full with cleared funds, optional
 * overhead deduction, high-dollar review, payroll preview, exceptions and a
 * simulator. Off until an owner turns it on; no rates are assumed.
 */
export default async function CommissionsPage() {
  const viewer = await requirePermission("commissions:manage");
  const db = await createSupabaseServerClient();
  const [settings, plans, templates, options, entries, adjustments] = await Promise.all([
    loadCommissionSettings(db),
    loadCommissionPlans(db),
    db.from("role_templates").select("id, key, name").is("deleted_at", null).order("sort_order"),
    loadLeadOptions(db),
    db
      .from("commission_entries")
      .select(
        "id, job_id, user_id, source_kind, basis_cents, overhead_cents, rate_percent, amount_cents, status, reasons, paid_on, payroll_ref, job:jobs(job_number, name)",
      )
      .order("computed_at", { ascending: false })
      .limit(500),
    db
      .from("commission_adjustments")
      .select("id, user_id, job_id, kind, amount_cents, reason, status, paid_on, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const names = Object.fromEntries(options.users.map((u) => [u.value, u.label]));
  const entryRows = (entries.data ?? []).map((e) => ({
    id: e.id,
    jobId: e.job_id,
    job: e.job ? `${e.job.job_number} · ${e.job.name}` : "Job",
    userId: e.user_id,
    sourceKind: e.source_kind as "company" | "self",
    basisCents: Number(e.basis_cents),
    overheadCents: Number(e.overhead_cents),
    ratePercent: Number(e.rate_percent),
    amountCents: Number(e.amount_cents),
    status: e.status,
    reasons: e.reasons,
    paidOn: e.paid_on,
  }));
  const adjRows = (adjustments.data ?? []).map((a) => ({
    id: a.id,
    userId: a.user_id,
    kind: a.kind,
    amountCents: Number(a.amount_cents),
    reason: a.reason,
    status: a.status,
    paidOn: a.paid_on,
  }));
  const payroll = payrollPreview(
    entryRows.map((e) => ({
      userId: e.userId,
      status: e.status as "approved",
      amountCents: e.amountCents,
    })),
    adjRows,
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Commissions"
        description={
          settings.enabled
            ? "On. Recalculate after jobs are paid; approve what's eligible; mark it paid when payroll runs."
            : "Off. Nothing is calculated or shown to reps until you turn it on. Set up the plans first; use the simulator to check the math."
        }
      />
      <CommissionsAdmin
        settings={settings}
        plans={plans}
        roles={(templates.data ?? [])
          .filter((t) => !t.key.startsWith("e2e_"))
          .map((t) => ({ value: t.id, label: t.name }))}
        users={options.users}
        sources={options.picklists.lead_source.map((o) => ({ value: o.value, label: o.label }))}
        entries={entryRows}
        adjustments={adjRows}
        payroll={payroll}
        names={names}
        readOnly={viewer.impersonating}
      />
    </div>
  );
}
