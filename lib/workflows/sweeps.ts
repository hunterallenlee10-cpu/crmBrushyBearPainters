import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isPayable, type PayableWhen } from "@/lib/domain/referrals";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { complianceIssues } from "@/lib/domain/scheduling/subcontractors";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Time-based events for workflows (SPEC §11.2 #16, #17) and the referral
 * reward sweep. Each event has an idempotency key, so a sweep can run every
 * minute without repeating itself.
 */

const STALE_DAYS = 14;

/** Leads with no activity for 14 days → `lead.stale` (once per quiet spell). */
export async function sweepStaleLeads(service: Db, now = new Date(), limit = 200) {
  const { data: rule } = await service
    .from("attention_rules")
    .select("org_id, thresholds")
    .eq("rule_key", "aging_lead");
  const staleDays = new Map(
    (rule ?? []).map((r) => {
      const t = r.thresholds as Record<string, unknown> | null;
      const v = t && typeof t.stale_days === "number" ? t.stale_days : STALE_DAYS;
      return [r.org_id, v] as const;
    }),
  );
  const cutoff = new Date(
    now.getTime() - Math.min(...[STALE_DAYS, ...staleDays.values()]) * 24 * 3_600_000,
  );
  const { data, error } = await service
    .from("leads")
    .select("id, org_id, last_activity_at")
    .is("deleted_at", null)
    .in("status", ["new", "contacted"])
    .lt("last_activity_at", cutoff.toISOString())
    .order("last_activity_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let emitted = 0;
  for (const l of data ?? []) {
    const days = staleDays.get(l.org_id) ?? STALE_DAYS;
    if (now.getTime() - new Date(l.last_activity_at).getTime() < days * 24 * 3_600_000) continue;
    const { data: id, error: e } = await service.rpc("emit_domain_event", {
      p_org: l.org_id,
      p_type: "lead.stale",
      p_aggregate_type: "lead",
      p_aggregate_id: l.id,
      p_payload: { days, last_activity_at: l.last_activity_at },
      p_idempotency_key: `lead.stale:${l.id}:${l.last_activity_at.slice(0, 10)}`,
    });
    if (e) logError("sweep.stale_lead", e);
    else if (id) emitted++;
  }
  return { checked: (data ?? []).length, emitted };
}

/** Subcontractors whose paperwork is missing or expires soon → one event per set of issues. */
export async function sweepSubcontractorCompliance(service: Db, now = new Date()) {
  const { data, error } = await service
    .from("subcontractors")
    .select(
      "id, org_id, status, lni_expires_on, coi_expires_on, bond_expires_on, rrp_expires_on, w9_on_file",
    )
    .is("deleted_at", null)
    .eq("status", "expiring");
  if (error) throw error;
  const today = pacificToday(now);
  let emitted = 0;
  for (const s of data ?? []) {
    const issues = complianceIssues(
      {
        status: s.status,
        lniExpiresOn: s.lni_expires_on,
        coiExpiresOn: s.coi_expires_on,
        bondExpiresOn: s.bond_expires_on,
        rrpExpiresOn: s.rrp_expires_on,
        w9OnFile: s.w9_on_file,
      },
      today,
    );
    if (!issues.length) continue;
    const key = issues
      .map((i) => `${i.kind}:${i.level}:${i.expiresOn ?? "none"}`)
      .sort()
      .join("|");
    const { data: id, error: e } = await service.rpc("emit_domain_event", {
      p_org: s.org_id,
      p_type: "subcontractor.compliance_expiring",
      p_aggregate_type: "subcontractor",
      p_aggregate_id: s.id,
      p_payload: { issues: issues.map((i) => i.message) },
      p_idempotency_key: `sub_compliance:${s.id}:${key}`.slice(0, 300),
    });
    if (e) logError("sweep.sub_compliance", e);
    else if (id) emitted++;
  }
  return { checked: (data ?? []).length, emitted };
}

/**
 * Referral rewards become payable when the program rule is met (default: the
 * referred job is paid in full). Stamps `payable_at` once, tells whoever
 * manages referrals, and raises `referral.payable`.
 */
export async function sweepReferrals(service: Db, now = new Date()) {
  const { data, error } = await service
    .from("referrals")
    .select(
      "id, org_id, champion_id, job_id, reward_cents, job:jobs(name, stage, estimate_accepted_at, paid_in_full_at)",
    )
    .is("payable_at", null)
    .is("paid_at", null)
    .is("ineligible_reason", null)
    .not("job_id", "is", null)
    .limit(500);
  if (error) throw error;
  const settings = new Map<string, PayableWhen>();
  let payable = 0;
  for (const r of data ?? []) {
    if (!settings.has(r.org_id)) {
      const { data: s } = await service
        .from("referral_settings")
        .select("payable_when")
        .eq("org_id", r.org_id)
        .maybeSingle();
      settings.set(r.org_id, s?.payable_when === "sold" ? "sold" : "paid_in_full");
    }
    const when = settings.get(r.org_id) as PayableWhen;
    const ok = isPayable(
      {
        ineligibleReason: null,
        paidAt: null,
        leadStatus: null,
        jobStage: r.job?.stage ?? null,
        estimateAcceptedAt: r.job?.estimate_accepted_at ?? null,
        paidInFullAt: r.job?.paid_in_full_at ?? null,
      },
      when,
    );
    if (!ok) continue;
    const { error: e } = await service
      .from("referrals")
      .update({ payable_at: now.toISOString() })
      .eq("id", r.id)
      .is("payable_at", null);
    if (e) {
      logError("sweep.referral", e);
      continue;
    }
    payable++;
    await service.rpc("emit_domain_event", {
      p_org: r.org_id,
      p_type: "referral.payable",
      p_aggregate_type: "referral",
      p_aggregate_id: r.id,
      p_payload: { champion_id: r.champion_id, job_id: r.job_id, reward_cents: r.reward_cents },
      p_idempotency_key: `referral.payable:${r.id}`,
    });
    const { data: people } = await service.rpc("users_with_permission", {
      p_org: r.org_id,
      p_permission: "referrals:manage",
    });
    if (people?.length) {
      await service.from("notifications").insert(
        people.map((p) => ({
          org_id: r.org_id,
          user_id: p.id,
          type: "referral",
          title: `Referral reward ready to pay: ${r.job?.name ?? "a referred job"}`.slice(0, 200),
          body: "The referred job is paid in full. Record the payout on Referrals → Payouts.",
          link: "/referrals?tab=payouts",
        })),
      );
    }
  }
  return { checked: (data ?? []).length, payable };
}
