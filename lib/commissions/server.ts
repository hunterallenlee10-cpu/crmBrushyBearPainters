import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  DEFAULT_COMMISSION_SETTINGS,
  computeCommission,
  reconcileEntries,
  type CommissionJobFacts,
  type CommissionPlan,
  type CommissionResult,
  type CommissionSettings,
  type StoredEntry,
} from "@/lib/domain/commissions";

type Db = SupabaseClient<Database>;

const COMMISSIONABLE_STAGES = [
  "sold",
  "onboarding",
  "ready_to_schedule",
  "scheduled",
  "in_progress",
  "final_walkthrough",
  "completed",
  "invoiced",
  "paid_in_full",
  "closed_won",
];

export async function loadCommissionSettings(db: Db): Promise<CommissionSettings> {
  const { data } = await db
    .from("commission_settings")
    .select(
      "enabled, basis, overhead_deduction_percent, review_threshold_cents, self_generated_sources, require_cleared_funds",
    )
    .maybeSingle();
  if (!data) return DEFAULT_COMMISSION_SETTINGS;
  return {
    enabled: data.enabled,
    basis: data.basis === "collected" ? "collected" : "contract",
    overheadDeductionPercent: Number(data.overhead_deduction_percent),
    reviewThresholdCents: data.review_threshold_cents,
    selfGeneratedSources: data.self_generated_sources,
    requireClearedFunds: data.require_cleared_funds,
  };
}

export async function loadCommissionPlans(db: Db): Promise<CommissionPlan[]> {
  const { data } = await db
    .from("commission_plans")
    .select(
      "id, name, role_template_id, user_id, company_rate_percent, self_rate_percent, overhead_deduction_percent, active",
    )
    .is("deleted_at", null)
    .order("name");
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    roleTemplateId: p.role_template_id,
    userId: p.user_id,
    companyRatePercent: Number(p.company_rate_percent),
    selfRatePercent: Number(p.self_rate_percent),
    overheadDeductionPercent:
      p.overhead_deduction_percent === null ? null : Number(p.overhead_deduction_percent),
    active: p.active,
  }));
}

/** Facts for every sold job with a rep (row security applies to the reader). */
export async function loadCommissionFacts(db: Db): Promise<CommissionJobFacts[]> {
  const jobs: {
    id: string;
    owner_id: string | null;
    lead_id: string | null;
    lead_source: string | null;
    stage: string;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("jobs")
      .select("id, owner_id, lead_id, lead_source, stage")
      .in("stage", COMMISSIONABLE_STAGES)
      .not("owner_id", "is", null)
      .is("deleted_at", null)
      .order("id")
      .range(from, from + 999);
    jobs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (jobs.length === 0) return [];
  const ids = jobs.map((j) => j.id);
  const leadIds = [...new Set(jobs.flatMap((j) => (j.lead_id ? [j.lead_id] : [])))];
  const ownerIds = [...new Set(jobs.flatMap((j) => (j.owner_id ? [j.owner_id] : [])))];
  const ledger = new Map<string, Database["public"]["Views"]["job_ledger"]["Row"]>();
  const setBy = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await db
      .from("job_ledger")
      .select("*")
      .in("job_id", ids.slice(i, i + 500));
    for (const l of data ?? []) if (l.job_id) ledger.set(l.job_id, l);
  }
  for (let i = 0; i < leadIds.length; i += 500) {
    const { data } = await db
      .from("leads")
      .select("id, lead_set_by")
      .in("id", leadIds.slice(i, i + 500));
    for (const l of data ?? []) setBy.set(l.id, l.lead_set_by);
  }
  const { data: people } = await db
    .from("profiles")
    .select("id, role_template_id")
    .in("id", ownerIds);
  const role = new Map((people ?? []).map((p) => [p.id, p.role_template_id]));
  return jobs.map((j) => {
    const l = ledger.get(j.id);
    return {
      jobId: j.id,
      repId: j.owner_id,
      repRoleTemplateId: j.owner_id ? (role.get(j.owner_id) ?? null) : null,
      leadSource: j.lead_source,
      leadSetBy: j.lead_id ? (setBy.get(j.lead_id) ?? null) : null,
      contractCents: Number(l?.contract_cents ?? 0),
      billedCents: Number(l?.billed_cents ?? 0),
      leftToBillCents: Number(l?.left_to_bill_cents ?? 0),
      collectedCents: Number(l?.collected_cents ?? 0),
      balanceCents: Number(l?.balance_cents ?? 0),
      unclearedCents: Number(l?.uncleared_cents ?? 0),
      stage: j.stage,
    };
  });
}

/** Recalculate: compute every job's commission and store the changes. */
export async function recalculateCommissions(
  db: Db,
  orgId: string,
): Promise<{ inserted: number; updated: number; voided: number; kept: number }> {
  const [settings, plans, facts, stored] = await Promise.all([
    loadCommissionSettings(db),
    loadCommissionPlans(db),
    loadCommissionFacts(db),
    db
      .from("commission_entries")
      .select("id, job_id, user_id, status, amount_cents")
      .neq("status", "void"),
  ]);
  const results = facts.flatMap((f) => computeCommission(f, plans, settings) ?? []);
  const storedEntries: StoredEntry[] = (stored.data ?? []).map((e) => ({
    id: e.id,
    jobId: e.job_id,
    userId: e.user_id,
    status: e.status as StoredEntry["status"],
    amountCents: Number(e.amount_cents),
  }));
  const changes = reconcileEntries(storedEntries, results);
  const counts = { inserted: 0, updated: 0, voided: 0, kept: 0 };
  const row = (r: CommissionResult) => ({
    plan_id: r.planId,
    source_kind: r.sourceKind,
    basis_cents: r.basisCents,
    overhead_cents: r.overheadCents,
    rate_percent: r.ratePercent,
    amount_cents: r.amountCents,
    status: r.status,
    reasons: r.reasons,
    computed_at: new Date().toISOString(),
  });
  const inserts = changes.flatMap((c) =>
    c.kind === "insert"
      ? [{ ...row(c.result), org_id: orgId, job_id: c.result.jobId, user_id: c.result.userId }]
      : [],
  );
  // A voided entry for the same job/person is reused (unique job + person).
  for (const ins of inserts) {
    const { error } = await db
      .from("commission_entries")
      .upsert(ins, { onConflict: "job_id,user_id" });
    if (error) throw error;
    counts.inserted += 1;
  }
  for (const c of changes) {
    if (c.kind === "update") {
      const { error } = await db.from("commission_entries").update(row(c.result)).eq("id", c.id);
      if (error) throw error;
      counts.updated += 1;
    } else if (c.kind === "void") {
      const { error } = await db
        .from("commission_entries")
        .update({ status: "void", note: c.reason })
        .eq("id", c.id);
      if (error) throw error;
      counts.voided += 1;
    } else if (c.kind === "keep") counts.kept += 1;
  }
  return counts;
}
