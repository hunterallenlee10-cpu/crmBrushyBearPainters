/**
 * Commissions engine (SPEC §10), off by default. Config-driven and pure:
 *
 *   plan      = the rep's own plan, else their role template's plan
 *   source    = "self" when the rep set the lead themselves or the lead source
 *               is one the owners marked self-generated; else "company"
 *   basis     = contract (sold price after credits) or collected, per settings
 *   overhead  = basis × overhead % (plan's own %, else the company's)
 *   amount    = round((basis − overhead) × rate %)
 *   eligible  = paid in full (something billed, nothing left to bill, $0
 *               balance) and, when required, every applied payment cleared
 *   review    = amount ≥ the high-dollar threshold → needs an owner's review
 *
 * No rate, overhead or threshold is assumed: everything starts at 0 / off
 * until the owners set it (CLAUDE.md "don't invent business facts").
 */

export type CommissionSettings = {
  enabled: boolean;
  basis: "contract" | "collected";
  overheadDeductionPercent: number;
  reviewThresholdCents: number | null;
  selfGeneratedSources: readonly string[];
  requireClearedFunds: boolean;
};

export const DEFAULT_COMMISSION_SETTINGS: CommissionSettings = {
  enabled: false,
  basis: "contract",
  overheadDeductionPercent: 0,
  reviewThresholdCents: null,
  selfGeneratedSources: [],
  requireClearedFunds: true,
};

export type CommissionPlan = {
  id: string;
  name: string;
  roleTemplateId: string | null;
  userId: string | null;
  companyRatePercent: number;
  selfRatePercent: number;
  overheadDeductionPercent: number | null;
  active: boolean;
};

export type CommissionJobFacts = {
  jobId: string;
  /** The rep paid on the job (the job's owner / estimator). */
  repId: string | null;
  repRoleTemplateId: string | null;
  leadSource: string | null;
  /** Who set the lead (leads.lead_set_by), if the job came from a lead. */
  leadSetBy: string | null;
  contractCents: number;
  billedCents: number;
  leftToBillCents: number;
  collectedCents: number;
  balanceCents: number;
  /** Applied payments not yet cleared (job_ledger.uncleared_cents). */
  unclearedCents: number;
  stage: string;
};

export type CommissionStatus =
  "pending" | "eligible" | "needs_review" | "approved" | "paid" | "void";

export type CommissionResult = {
  jobId: string;
  userId: string;
  planId: string;
  sourceKind: "company" | "self";
  basisCents: number;
  overheadCents: number;
  ratePercent: number;
  amountCents: number;
  status: Extract<CommissionStatus, "pending" | "eligible" | "needs_review">;
  /** Plain-English reasons it isn't payable yet (or why it needs review). */
  reasons: string[];
};

function clampPercent(p: number): number {
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}

/** The plan that applies to a rep: their own active plan first, then their role's. */
export function planFor(
  plans: readonly CommissionPlan[],
  userId: string,
  roleTemplateId: string | null,
): CommissionPlan | null {
  const active = plans.filter((p) => p.active);
  return (
    active.find((p) => p.userId === userId) ??
    (roleTemplateId
      ? active.find((p) => !p.userId && p.roleTemplateId === roleTemplateId)
      : null) ??
    null
  );
}

/** "self" when the rep generated the lead (set it, or a self-generated source). */
export function sourceKind(
  facts: Pick<CommissionJobFacts, "repId" | "leadSetBy" | "leadSource">,
  settings: Pick<CommissionSettings, "selfGeneratedSources">,
): "company" | "self" {
  if (facts.repId && facts.leadSetBy && facts.leadSetBy === facts.repId) return "self";
  if (facts.leadSource && settings.selfGeneratedSources.includes(facts.leadSource)) return "self";
  return "company";
}

/** Paid in full with cleared funds (when required); reasons when not. */
export function eligibility(
  facts: Pick<
    CommissionJobFacts,
    "billedCents" | "leftToBillCents" | "balanceCents" | "unclearedCents" | "stage"
  >,
  settings: Pick<CommissionSettings, "requireClearedFunds">,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (facts.stage === "closed_lost") reasons.push("The job was closed as lost.");
  if (facts.billedCents <= 0) reasons.push("Nothing has been invoiced yet.");
  if (facts.leftToBillCents > 0) reasons.push("Part of the contract isn't invoiced yet.");
  if (facts.balanceCents > 0) reasons.push("The customer still owes money.");
  if (settings.requireClearedFunds && facts.unclearedCents > 0)
    reasons.push("A payment hasn't cleared the bank yet.");
  return { eligible: reasons.length === 0, reasons };
}

/**
 * Computes one job's commission for its rep, or null when there's no rep or
 * no plan applies (the job isn't commissionable).
 */
export function computeCommission(
  facts: CommissionJobFacts,
  plans: readonly CommissionPlan[],
  settings: CommissionSettings,
): CommissionResult | null {
  if (!facts.repId) return null;
  const plan = planFor(plans, facts.repId, facts.repRoleTemplateId);
  if (!plan) return null;
  const kind = sourceKind(facts, settings);
  const rate = clampPercent(kind === "self" ? plan.selfRatePercent : plan.companyRatePercent);
  const basis = Math.max(
    0,
    Math.round(settings.basis === "collected" ? facts.collectedCents : facts.contractCents),
  );
  const overheadPct = clampPercent(
    plan.overheadDeductionPercent ?? settings.overheadDeductionPercent,
  );
  const overhead = Math.round((basis * overheadPct) / 100);
  const amount = Math.max(0, Math.round(((basis - overhead) * rate) / 100));
  const { eligible, reasons } = eligibility(facts, settings);
  const review =
    settings.reviewThresholdCents !== null && amount >= settings.reviewThresholdCents && amount > 0;
  const status: CommissionResult["status"] = !eligible
    ? "pending"
    : review
      ? "needs_review"
      : "eligible";
  if (eligible && review) {
    reasons.push(
      `At or above the high-dollar review threshold (${formatCents(settings.reviewThresholdCents ?? 0)}).`,
    );
  }
  return {
    jobId: facts.jobId,
    userId: facts.repId,
    planId: plan.id,
    sourceKind: kind,
    basisCents: basis,
    overheadCents: overhead,
    ratePercent: rate,
    amountCents: amount,
    status,
    reasons,
  };
}

export type StoredEntry = {
  id: string;
  jobId: string;
  userId: string;
  status: CommissionStatus;
  amountCents: number;
};

export type EntryChange =
  | { kind: "insert"; result: CommissionResult }
  | { kind: "update"; id: string; result: CommissionResult }
  | { kind: "void"; id: string; reason: string }
  | { kind: "keep"; id: string; reason: string };

/**
 * What a "Recalculate" does to the stored entries: new results are inserted,
 * open ones (pending / eligible / needs review) are updated, approved and paid
 * entries are never changed (an adjustment fixes those), and open entries
 * whose job no longer earns a commission are voided.
 */
export function reconcileEntries(
  stored: readonly StoredEntry[],
  results: readonly CommissionResult[],
): EntryChange[] {
  const changes: EntryChange[] = [];
  const key = (j: string, u: string) => `${j}:${u}`;
  const byKey = new Map(stored.map((s) => [key(s.jobId, s.userId), s]));
  const seen = new Set<string>();
  for (const r of results) {
    const k = key(r.jobId, r.userId);
    seen.add(k);
    const s = byKey.get(k);
    if (!s) changes.push({ kind: "insert", result: r });
    else if (s.status === "approved" || s.status === "paid")
      changes.push({
        kind: "keep",
        id: s.id,
        reason: `Already ${s.status}; use an adjustment to change it.`,
      });
    else changes.push({ kind: "update", id: s.id, result: r });
  }
  for (const s of stored) {
    if (seen.has(key(s.jobId, s.userId))) continue;
    if (s.status === "pending" || s.status === "eligible" || s.status === "needs_review") {
      changes.push({ kind: "void", id: s.id, reason: "The job no longer earns this commission." });
    }
  }
  return changes;
}

export type PayableLine = {
  userId: string;
  commissionsCents: number;
  adjustmentsCents: number;
  totalCents: number;
  entries: number;
  adjustments: number;
};

/**
 * Payroll preview: what each person is owed now — approved commissions plus
 * approved adjustments, not yet paid. Payables by type are the two columns.
 */
export function payrollPreview(
  entries: readonly { userId: string; status: CommissionStatus; amountCents: number }[],
  adjustments: readonly { userId: string; status: string; amountCents: number }[],
): PayableLine[] {
  const by = new Map<string, PayableLine>();
  const line = (u: string) => {
    let l = by.get(u);
    if (!l) {
      l = {
        userId: u,
        commissionsCents: 0,
        adjustmentsCents: 0,
        totalCents: 0,
        entries: 0,
        adjustments: 0,
      };
      by.set(u, l);
    }
    return l;
  };
  for (const e of entries) {
    if (e.status !== "approved") continue;
    const l = line(e.userId);
    l.commissionsCents += e.amountCents;
    l.entries += 1;
  }
  for (const a of adjustments) {
    if (a.status !== "approved") continue;
    const l = line(a.userId);
    l.adjustmentsCents += a.amountCents;
    l.adjustments += 1;
  }
  for (const l of by.values()) l.totalCents = l.commissionsCents + l.adjustmentsCents;
  return [...by.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export type SimulatorInput = {
  contractCents: number;
  collectedCents: number;
  source: "company" | "self";
  companyRatePercent: number;
  selfRatePercent: number;
  overheadDeductionPercent: number;
  basis: "contract" | "collected";
  reviewThresholdCents: number | null;
};

/** Simulator tab: the same math on typed-in numbers, with each step shown. */
export function simulate(input: SimulatorInput): {
  basisCents: number;
  overheadCents: number;
  netCents: number;
  ratePercent: number;
  amountCents: number;
  needsReview: boolean;
} {
  const basis = Math.max(
    0,
    Math.round(input.basis === "collected" ? input.collectedCents : input.contractCents),
  );
  const overhead = Math.round((basis * clampPercent(input.overheadDeductionPercent)) / 100);
  const rate = clampPercent(
    input.source === "self" ? input.selfRatePercent : input.companyRatePercent,
  );
  const amount = Math.max(0, Math.round(((basis - overhead) * rate) / 100));
  return {
    basisCents: basis,
    overheadCents: overhead,
    netCents: basis - overhead,
    ratePercent: rate,
    amountCents: amount,
    needsReview:
      input.reviewThresholdCents !== null && amount > 0 && amount >= input.reviewThresholdCents,
  };
}

function formatCents(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "Not payable yet",
  eligible: "Eligible",
  needs_review: "Needs review",
  approved: "Approved",
  paid: "Paid",
  void: "Void",
};
