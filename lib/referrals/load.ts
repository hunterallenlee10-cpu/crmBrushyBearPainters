import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  championTotals,
  referralStatus,
  type PayableWhen,
  type ReferralStatus,
} from "@/lib/domain/referrals";

type Db = SupabaseClient<Database>;

/**
 * Bear Champions (SPEC §5.8, §8.16). Each referral's status is derived from
 * its lead and job (lib/domain/referrals), never stored. Read with the
 * person's own client (referrals:manage).
 */

export type ReferralSettingsView = {
  payableWhen: PayableWhen;
  codePrefix: string;
  programNote: string;
  terms: string;
  rewardCents: number | null;
  websiteUrl: string | null;
};

export async function loadReferralSettings(db: Db): Promise<ReferralSettingsView> {
  const [{ data: s }, { data: c }] = await Promise.all([
    db
      .from("referral_settings")
      .select("payable_when, code_prefix, program_note, terms")
      .maybeSingle(),
    db.from("company_settings").select("referral_reward_cents, website_url").maybeSingle(),
  ]);
  return {
    payableWhen: s?.payable_when === "sold" ? "sold" : "paid_in_full",
    codePrefix: s?.code_prefix ?? "BEAR",
    programNote: s?.program_note ?? "",
    terms: s?.terms ?? "",
    rewardCents:
      c?.referral_reward_cents === null || c?.referral_reward_cents === undefined
        ? null
        : Number(c.referral_reward_cents),
    websiteUrl: c?.website_url ?? null,
  };
}

export type ReferralView = {
  id: string;
  championId: string;
  championName: string;
  championCode: string;
  referredName: string;
  source: string;
  status: ReferralStatus;
  rewardCents: number | null;
  createdAt: string;
  payableAt: string | null;
  paidAt: string | null;
  payoutMethod: string | null;
  payoutReference: string | null;
  ineligibleReason: string | null;
  lead: { id: string; status: string } | null;
  job: { id: string; name: string; number: string; stage: string } | null;
};

export async function loadReferrals(
  db: Db,
  when: PayableWhen,
  opts: { championId?: string; limit?: number } = {},
): Promise<ReferralView[]> {
  let q = db
    .from("referrals")
    .select(
      "id, champion_id, referred_name, source, reward_cents, created_at, payable_at, paid_at, payout_method, payout_reference, ineligible_reason, lead:leads(id, status, first_name, last_name), job:jobs(id, name, job_number, stage, estimate_accepted_at, paid_in_full_at), champion:referral_champions(id, code, contact:contacts(first_name, last_name))",
    )
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 500);
  if (opts.championId) q = q.eq("champion_id", opts.championId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => {
    const status = referralStatus(
      {
        ineligibleReason: r.ineligible_reason,
        paidAt: r.paid_at,
        leadStatus: r.lead?.status ?? null,
        jobStage: r.job?.stage ?? null,
        estimateAcceptedAt: r.job?.estimate_accepted_at ?? null,
        paidInFullAt: r.job?.paid_in_full_at ?? null,
      },
      when,
    );
    const contact = r.champion?.contact;
    return {
      id: r.id,
      championId: r.champion_id,
      championName: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
        : "Champion",
      championCode: r.champion?.code ?? "",
      referredName:
        r.referred_name ||
        (r.lead
          ? [r.lead.first_name, r.lead.last_name].filter(Boolean).join(" ")
          : (r.job?.name ?? "—")),
      source: r.source,
      status,
      rewardCents: r.reward_cents === null ? null : Number(r.reward_cents),
      createdAt: r.created_at,
      payableAt: r.payable_at,
      paidAt: r.paid_at,
      payoutMethod: r.payout_method,
      payoutReference: r.payout_reference,
      ineligibleReason: r.ineligible_reason,
      lead: r.lead ? { id: r.lead.id, status: r.lead.status } : null,
      job: r.job
        ? { id: r.job.id, name: r.job.name, number: r.job.job_number, stage: r.job.stage }
        : null,
    };
  });
}

export type ChampionView = {
  id: string;
  code: string;
  status: string;
  name: string;
  contactId: string;
  accountId: string | null;
  email: string | null;
  invitedAt: string | null;
  createdAt: string;
  totals: ReturnType<typeof championTotals>;
};

export async function loadChampions(
  db: Db,
  referrals: readonly ReferralView[],
): Promise<ChampionView[]> {
  const { data, error } = await db
    .from("referral_champions")
    .select(
      "id, code, status, contact_id, account_id, invited_at, created_at, contact:contacts(first_name, last_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    status: c.status,
    name: c.contact
      ? [c.contact.first_name, c.contact.last_name].filter(Boolean).join(" ")
      : "Contact",
    contactId: c.contact_id,
    accountId: c.account_id,
    email: c.contact?.email ?? null,
    invitedAt: c.invited_at,
    createdAt: c.created_at,
    totals: championTotals(referrals.filter((r) => r.championId === c.id)),
  }));
}
