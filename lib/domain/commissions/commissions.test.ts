import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_COMMISSION_SETTINGS,
  computeCommission,
  eligibility,
  payrollPreview,
  planFor,
  reconcileEntries,
  simulate,
  sourceKind,
  type CommissionJobFacts,
  type CommissionPlan,
} from "@/lib/domain/commissions";

const rolePlan: CommissionPlan = {
  id: "p-role",
  name: "Estimators",
  roleTemplateId: "t-est",
  userId: null,
  companyRatePercent: 5,
  selfRatePercent: 8,
  overheadDeductionPercent: null,
  active: true,
};
const personalPlan: CommissionPlan = {
  ...rolePlan,
  id: "p-erik",
  userId: "erik",
  roleTemplateId: null,
  companyRatePercent: 6,
};

const paid: CommissionJobFacts = {
  jobId: "j1",
  repId: "rep",
  repRoleTemplateId: "t-est",
  leadSource: "website",
  leadSetBy: null,
  contractCents: 1_000_000,
  billedCents: 1_000_000,
  leftToBillCents: 0,
  collectedCents: 1_000_000,
  balanceCents: 0,
  unclearedCents: 0,
  stage: "paid_in_full",
};

describe("commission plans and sources", () => {
  it("a personal plan beats the role's plan; inactive plans don't count", () => {
    expect(planFor([rolePlan, personalPlan], "erik", "t-est")!.id).toBe("p-erik");
    expect(planFor([rolePlan, personalPlan], "rep", "t-est")!.id).toBe("p-role");
    expect(planFor([{ ...rolePlan, active: false }], "rep", "t-est")).toBeNull();
    expect(planFor([rolePlan], "rep", null)).toBeNull();
  });

  it("self-generated = the rep set the lead, or a self-generated source", () => {
    expect(
      sourceKind(
        { repId: "rep", leadSetBy: "rep", leadSource: "website" },
        { selfGeneratedSources: [] },
      ),
    ).toBe("self");
    expect(
      sourceKind(
        { repId: "rep", leadSetBy: "other", leadSource: "yard_sign" },
        { selfGeneratedSources: ["yard_sign"] },
      ),
    ).toBe("self");
    expect(
      sourceKind(
        { repId: "rep", leadSetBy: null, leadSource: "website" },
        { selfGeneratedSources: [] },
      ),
    ).toBe("company");
  });
});

describe("eligibility: paid in full with cleared funds", () => {
  it("lists every reason it's not payable yet", () => {
    expect(eligibility(paid, { requireClearedFunds: true })).toEqual({
      eligible: true,
      reasons: [],
    });
    const r = eligibility(
      {
        ...paid,
        billedCents: 0,
        leftToBillCents: 1,
        balanceCents: 5,
        unclearedCents: 10,
        stage: "closed_lost",
      },
      { requireClearedFunds: true },
    );
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(5);
    expect(
      eligibility({ ...paid, unclearedCents: 10 }, { requireClearedFunds: false }).eligible,
    ).toBe(true);
  });
});

describe("computeCommission", () => {
  const settings = { ...DEFAULT_COMMISSION_SETTINGS, enabled: true };

  it("company lead at the company rate on the contract", () => {
    expect(computeCommission(paid, [rolePlan], settings)).toMatchObject({
      planId: "p-role",
      sourceKind: "company",
      basisCents: 1_000_000,
      overheadCents: 0,
      ratePercent: 5,
      amountCents: 50_000,
      status: "eligible",
      reasons: [],
    });
  });

  it("self-generated rate, overhead deduction, collected basis", () => {
    const r = computeCommission(
      { ...paid, leadSetBy: "rep", collectedCents: 900_000 },
      [rolePlan],
      { ...settings, basis: "collected", overheadDeductionPercent: 10 },
    )!;
    expect(r).toMatchObject({
      sourceKind: "self",
      basisCents: 900_000,
      overheadCents: 90_000,
      ratePercent: 8,
      amountCents: 64_800,
    });
  });

  it("a plan's own overhead % beats the company's", () => {
    const r = computeCommission(paid, [{ ...rolePlan, overheadDeductionPercent: 20 }], {
      ...settings,
      overheadDeductionPercent: 10,
    })!;
    expect(r.overheadCents).toBe(200_000);
    expect(r.amountCents).toBe(40_000);
  });

  it("not paid in full → pending with reasons; big amounts → review", () => {
    expect(computeCommission({ ...paid, balanceCents: 100 }, [rolePlan], settings)!.status).toBe(
      "pending",
    );
    const big = computeCommission(paid, [rolePlan], { ...settings, reviewThresholdCents: 50_000 })!;
    expect(big.status).toBe("needs_review");
    expect(big.reasons[0]).toMatch(/\$500\.00/);
  });

  it("no rep or no plan → not commissionable", () => {
    expect(computeCommission({ ...paid, repId: null }, [rolePlan], settings)).toBeNull();
    expect(computeCommission(paid, [], settings)).toBeNull();
  });

  it("never negative and never more than the basis (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 100_000_000 }),
        fc.double({ min: -50, max: 150, noNaN: true }),
        fc.double({ min: -50, max: 150, noNaN: true }),
        (contract, rate, overhead) => {
          const r = computeCommission(
            { ...paid, contractCents: contract },
            [{ ...rolePlan, companyRatePercent: rate }],
            { ...settings, overheadDeductionPercent: overhead },
          )!;
          return (
            r.amountCents >= 0 &&
            r.amountCents <= Math.max(0, contract) &&
            Number.isInteger(r.amountCents)
          );
        },
      ),
    );
  });
});

describe("reconcile, payroll, simulator", () => {
  const result = computeCommission(paid, [rolePlan], {
    ...DEFAULT_COMMISSION_SETTINGS,
    enabled: true,
  })!;

  it("inserts new, updates open, keeps approved/paid, voids what no longer applies", () => {
    const changes = reconcileEntries(
      [
        { id: "e1", jobId: "j1", userId: "rep", status: "pending", amountCents: 1 },
        { id: "e2", jobId: "j2", userId: "rep", status: "approved", amountCents: 5 },
        { id: "e3", jobId: "j3", userId: "rep", status: "eligible", amountCents: 5 },
        { id: "e4", jobId: "j4", userId: "rep", status: "paid", amountCents: 5 },
      ],
      [result, { ...result, jobId: "j2" }, { ...result, jobId: "j5" }],
    );
    expect(changes.map((c) => c.kind)).toEqual(["update", "keep", "insert", "void"]);
  });

  it("payroll preview sums approved commissions and adjustments per person", () => {
    expect(
      payrollPreview(
        [
          { userId: "a", status: "approved", amountCents: 100 },
          { userId: "a", status: "paid", amountCents: 999 },
          { userId: "b", status: "approved", amountCents: 50 },
          { userId: "b", status: "eligible", amountCents: 999 },
        ],
        [
          { userId: "a", status: "approved", amountCents: -20 },
          { userId: "c", status: "approved", amountCents: 70 },
          { userId: "c", status: "pending", amountCents: 999 },
        ],
      ),
    ).toEqual([
      {
        userId: "a",
        commissionsCents: 100,
        adjustmentsCents: -20,
        totalCents: 80,
        entries: 1,
        adjustments: 1,
      },
      {
        userId: "c",
        commissionsCents: 0,
        adjustmentsCents: 70,
        totalCents: 70,
        entries: 0,
        adjustments: 1,
      },
      {
        userId: "b",
        commissionsCents: 50,
        adjustmentsCents: 0,
        totalCents: 50,
        entries: 1,
        adjustments: 0,
      },
    ]);
  });

  it("the simulator shows each step", () => {
    expect(
      simulate({
        contractCents: 1_000_000,
        collectedCents: 0,
        source: "self",
        companyRatePercent: 5,
        selfRatePercent: 8,
        overheadDeductionPercent: 10,
        basis: "contract",
        reviewThresholdCents: 70_000,
      }),
    ).toEqual({
      basisCents: 1_000_000,
      overheadCents: 100_000,
      netCents: 900_000,
      ratePercent: 8,
      amountCents: 72_000,
      needsReview: true,
    });
  });

  it("defaults are off with no rates assumed", () => {
    expect(DEFAULT_COMMISSION_SETTINGS).toMatchObject({
      enabled: false,
      overheadDeductionPercent: 0,
      reviewThresholdCents: null,
    });
  });
});
