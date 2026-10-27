import { describe, expect, it } from "vitest";
import { blendedMargin, computeJobCosting, laborCost } from "./costing";

describe("job costing", () => {
  it("adds labor, materials, subs and expenses into gross profit and margin", () => {
    const c = computeJobCosting({
      revenueCents: 1_000_000,
      labor: [
        { userId: "u1", name: "Ana", hours: 8, rateCents: 3_500 },
        { userId: "u1", name: "Ana", hours: 7.5, rateCents: 3_500 },
        { userId: null, name: "Helper", hours: 4, rateCents: null },
        { userId: "u2", name: "Bo", hours: 10, rateCents: 3_000 },
      ],
      materials: [{ label: "PO-1", cents: 120_000 }],
      subcontractors: [{ label: "WO-1", cents: 200_000 }],
      expenses: [
        { label: "Dump fee", cents: 5_000 },
        { label: "Lift", cents: 25_000 },
      ],
      budgetedHours: 30,
    });
    expect(c.labor.map((l) => [l.name, l.hours, l.costCents])).toEqual([
      ["Ana", 15.5, 54_250],
      ["Bo", 10, 30_000],
      ["Helper", 4, null],
    ]);
    expect(c).toMatchObject({
      laborHours: 29.5,
      laborCents: 84_250,
      unpricedHours: 4,
      materialsCents: 120_000,
      subcontractorCents: 200_000,
      expensesCents: 30_000,
      totalCostCents: 434_250,
      grossProfitCents: 565_750,
      budgetedHours: 30,
    });
    expect(c.marginPct).toBeCloseTo(0.56575);
    expect(c.warnings[0]).toMatch(/4 hours have no hourly cost \(Helper\)/);
  });

  it("explains a missing contract and costs over the contract", () => {
    expect(
      computeJobCosting({
        revenueCents: 0,
        labor: [],
        materials: [],
        subcontractors: [],
        expenses: [],
      }),
    ).toMatchObject({
      marginPct: null,
      warnings: ["There's no contract amount yet, so margin can't be worked out."],
    });
    const over = computeJobCosting({
      revenueCents: 100,
      labor: [],
      materials: [{ label: "x", cents: 150 }],
      subcontractors: [],
      expenses: [],
    });
    expect(over.warnings).toEqual(["Costs are $0.50 more than the contract."]);
    expect(over.marginPct).toBeCloseTo(-0.5);
  });

  it("rounds labor to the cent and blends margins across jobs", () => {
    expect(laborCost(1.33, 3_333)).toBe(4_433);
    expect(
      blendedMargin([
        { revenueCents: 1000, costCents: 600 },
        { revenueCents: 1000, costCents: 800 },
      ]),
    ).toBeCloseTo(0.3);
    expect(blendedMargin([])).toBeNull();
  });
});
