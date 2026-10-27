/**
 * Bear Champions referral program (SPEC §5.8, §8.16, §14). Pure: code format,
 * the referral's status from the facts, and payability. Status is derived,
 * never stored (like the ledger): a referral is Referred until its lead books a
 * walkthrough, Sold once the job's estimate is accepted, Payable when the rule
 * in Referral Program settings is met (default: the referred job is paid in
 * full), and Paid when an owner records the payout.
 */

export const CODE_RE = /^[A-Z]{2,8}-[A-Z0-9]{4,8}$/;

/** "bear-7kq2 " → "BEAR-7KQ2"; null when it isn't a code. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase().replace(/\s+/g, "");
  return CODE_RE.test(c) ? c : null;
}

export const REFERRAL_STATUSES = [
  "referred",
  "walkthrough",
  "sold",
  "payable",
  "paid",
  "lost",
  "ineligible",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  referred: "Referred",
  walkthrough: "Walkthrough booked",
  sold: "Sold",
  payable: "Reward payable",
  paid: "Paid",
  lost: "Didn't book",
  ineligible: "Not eligible",
};

export type PayableWhen = "paid_in_full" | "sold";

export type ReferralFacts = {
  ineligibleReason: string | null;
  paidAt: string | null;
  leadStatus: string | null;
  jobStage: string | null;
  estimateAcceptedAt: string | null;
  paidInFullAt: string | null;
};

const PAID_STAGES = new Set(["paid_in_full", "closed_won"]);
const SOLD_PLUS = new Set([
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
]);

/** Is the reward payable now under the program rule? */
export function isPayable(f: ReferralFacts, when: PayableWhen): boolean {
  if (f.ineligibleReason) return false;
  if (when === "sold") return !!f.estimateAcceptedAt || (!!f.jobStage && SOLD_PLUS.has(f.jobStage));
  return !!f.paidInFullAt || (!!f.jobStage && PAID_STAGES.has(f.jobStage));
}

export function referralStatus(f: ReferralFacts, when: PayableWhen): ReferralStatus {
  if (f.ineligibleReason) return "ineligible";
  if (f.paidAt) return "paid";
  if (isPayable(f, when)) return "payable";
  if (f.jobStage === "closed_lost" || f.leadStatus === "lost" || f.leadStatus === "unqualified")
    return "lost";
  if (f.estimateAcceptedAt || (f.jobStage && SOLD_PLUS.has(f.jobStage))) return "sold";
  if (f.jobStage || f.leadStatus === "walkthrough_scheduled" || f.leadStatus === "converted")
    return "walkthrough";
  return "referred";
}

/** A champion's totals from their referrals (cents; derived). */
export function championTotals(
  rows: readonly { status: ReferralStatus; rewardCents: number | null }[],
): { referrals: number; sold: number; paidCents: number; payableCents: number } {
  let sold = 0;
  let paidCents = 0;
  let payableCents = 0;
  for (const r of rows) {
    if (r.status === "sold" || r.status === "payable" || r.status === "paid") sold++;
    if (r.status === "paid") paidCents += r.rewardCents ?? 0;
    if (r.status === "payable") payableCents += r.rewardCents ?? 0;
  }
  return { referrals: rows.length, sold, paidCents, payableCents };
}

/** `?ref=CODE` link to the website estimate form. */
export function referralLink(websiteUrl: string | null, code: string): string {
  const base = (websiteUrl || "https://brushybear.vercel.app").replace(/\/+$/, "");
  const withScheme = /^https?:\/\//.test(base) ? base : `https://${base}`;
  return `${withScheme}/estimate?ref=${encodeURIComponent(code)}`;
}
