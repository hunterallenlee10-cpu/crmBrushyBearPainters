import { describe, expect, it } from "vitest";
import {
  SAMPLE_PRICING,
  buildPaintOrder,
  buildWorkOrders,
  colorSelectionSeeds,
  describeLine,
  discountLimitFor,
  exteriorWallSqft,
  fenceSqft,
  formatQuantity,
  onboardingProgress,
  onboardingRequirements,
  parseDiscountLimits,
  parsePricing,
  parseTaxConfig,
  roomBaseboardLf,
  roomCeilingSqft,
  roomWallSqft,
  round2,
  sumSqft,
  toPricingSettings,
  type PaintLineInput,
} from "@/lib/estimating/engine";

describe("measurement helpers", () => {
  const ded = { doorDeductionSqft: 21, windowDeductionSqft: 15 };

  it("measures room walls minus doors and windows", () => {
    // 2 × (14 + 12) × 8 = 416 − 2 × 21 − 3 × 15 = 329
    expect(
      roomWallSqft({ lengthFt: 14, widthFt: 12, heightFt: 8, doors: 2, windows: 3 }, ded),
    ).toBe(329);
    expect(roomWallSqft({ lengthFt: 14, widthFt: 12, heightFt: 8 }, ded)).toBe(416);
    expect(roomWallSqft({ lengthFt: 2, widthFt: 2, heightFt: 2, doors: 5 }, ded)).toBe(0);
  });

  it("measures ceilings, baseboard, exterior walls and fences", () => {
    expect(roomCeilingSqft({ lengthFt: 14.5, widthFt: 12 })).toBe(174);
    expect(roomBaseboardLf({ lengthFt: 14, widthFt: 12, doors: 2 })).toBe(46);
    expect(roomBaseboardLf({ lengthFt: 14, widthFt: 12 }, 2.5)).toBe(52);
    expect(roomBaseboardLf({ lengthFt: 1, widthFt: 1, doors: 4 })).toBe(0);
    expect(exteriorWallSqft({ widthFt: 40, heightFt: 18, gableFactor: 1.15 })).toBe(828);
    expect(fenceSqft({ lengthFt: 120, heightFt: 6, sides: 2 })).toBe(1440);
    expect(sumSqft([828, 640.5, 312.25])).toBe(1780.75);
    expect(round2(1.005)).toBe(1.01);
  });

  it("rejects negative or missing numbers and gable factors under 1", () => {
    expect(() => roomCeilingSqft({ lengthFt: -1, widthFt: 2 })).toThrow(/Length/);
    expect(() => roomWallSqft({ lengthFt: 1, widthFt: Number.NaN, heightFt: 8 }, ded)).toThrow(
      /Width/,
    );
    expect(() => exteriorWallSqft({ widthFt: 10, heightFt: 10, gableFactor: 0.9 })).toThrow(
      /Gable/,
    );
  });
});

describe("describeLine", () => {
  it("writes scope in plain English", () => {
    expect(
      describeLine({
        name: "Walls",
        quantity: 420,
        unit: "sqft",
        kind: "production_rate",
        coats: 2,
        primer: "spot",
        sheenLabel: "Eggshell",
      }),
    ).toBe("Walls — 420 sq ft · 2 coats · spot prime · Eggshell");
    expect(
      describeLine({ name: "Hardware removal/reinstall", quantity: 1, unit: "lump", kind: "flat" }),
    ).toBe("Hardware removal/reinstall");
    expect(
      describeLine({
        name: "Drywall repair",
        quantity: 3,
        unit: "each",
        kind: "flat",
        note: "Hallway dings.",
      }),
    ).toBe("Drywall repair — 3 each. Hallway dings.");
    expect(formatQuantity(1234.567)).toBe("1,234.57");
    expect(
      describeLine({ name: "Closet", quantity: 1, unit: "each", kind: "production_rate" }),
    ).toBe("Closet — 1 each");
  });
});

describe("buildPaintOrder", () => {
  const base: PaintLineInput = {
    productId: "p1",
    productLabel: "Interior Eggshell",
    containers: ["gallon", "five_gallon"],
    costPerGalCents: 3000,
    sheen: "eggshell",
    gallonsNeeded: 2.31,
    primerProductId: null,
    primerProductLabel: null,
    primerContainers: [],
    primerCostPerGalCents: 0,
    primerGallonsNeeded: 0,
    sundriesCents: 3640,
  };

  it("groups by product and sheen, rounds each group once, and adds sundries", () => {
    const order = buildPaintOrder([
      base,
      { ...base, gallonsNeeded: 2.2, sundriesCents: 1000 },
      { ...base, sheen: "satin", gallonsNeeded: 0.5, sundriesCents: 0 },
      {
        ...base,
        gallonsNeeded: 0,
        primerProductId: "pr",
        primerProductLabel: "Bonding Primer",
        primerContainers: ["gallon"],
        primerCostPerGalCents: 2800,
        primerGallonsNeeded: 1.2,
        sundriesCents: 0,
      },
      { ...base, gallonsNeeded: 0, primerGallonsNeeded: 0.4, sundriesCents: 0 },
      { ...base, productId: null, gallonsNeeded: 3, sundriesCents: 0 },
    ]);
    expect(order).toEqual([
      {
        paintProductId: "p1",
        label: "Interior Eggshell",
        sheen: "eggshell",
        isPrimer: false,
        isSundries: false,
        gallonsNeeded: 4.51,
        gallons: 5,
        containers: { quart: 0, gallon: 0, five_gallon: 1 },
        unitCostCents: 3000,
        costCents: 15_000,
      },
      expect.objectContaining({ sheen: "satin", gallons: 1, costCents: 3000 }),
      expect.objectContaining({
        label: "Bonding Primer",
        isPrimer: true,
        gallons: 2,
        costCents: 5600,
      }),
      expect.objectContaining({
        paintProductId: "p1",
        label: "Interior Eggshell",
        isPrimer: true,
        gallons: 1,
      }),
      expect.objectContaining({ isSundries: true, costCents: 4640, containers: null }),
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(buildPaintOrder([])).toEqual([]);
    expect(
      buildPaintOrder([{ ...base, productLabel: null, primerGallonsNeeded: 1, sundriesCents: -5 }]),
    ).toEqual([
      expect.objectContaining({ label: "Paint", isPrimer: false }),
      expect.objectContaining({ label: "Primer", isPrimer: true }),
    ]);
  });
});

describe("buildWorkOrders", () => {
  it("splits prep from paint and sends cabinets, decks and repairs to their phases", () => {
    const wos = buildWorkOrders([
      { description: "Walls", workType: "interior", phase: null, laborHours: 7, prepHours: 2.1 },
      {
        description: "Ceiling",
        workType: "interior",
        phase: null,
        laborHours: 2.48,
        prepHours: 0.48,
      },
      {
        description: "Cabinet doors",
        workType: "cabinets",
        phase: null,
        laborHours: 20,
        prepHours: 6,
      },
      {
        description: "Deck boards",
        workType: "deck_fence",
        phase: null,
        laborHours: 9,
        prepHours: 3,
      },
      {
        description: "Rot repair",
        workType: "exterior",
        phase: "repair",
        laborHours: 5,
        prepHours: 0,
      },
      { description: "Walls", workType: "interior", phase: null, laborHours: 1, prepHours: 5 },
      { description: "Color consult", workType: null, phase: null, laborHours: 0, prepHours: 0 },
      { description: "", workType: null, phase: null, laborHours: 0, prepHours: 0 },
    ]);
    expect(wos).toEqual([
      { phase: "prep", budgetedHours: 3.58, scopeSummary: "Walls\nCeiling" },
      { phase: "repair", budgetedHours: 5, scopeSummary: "Rot repair" },
      { phase: "paint", budgetedHours: 6.9, scopeSummary: "Walls\nCeiling\nColor consult" },
      { phase: "cabinet_shop", budgetedHours: 20, scopeSummary: "Cabinet doors" },
      { phase: "stain", budgetedHours: 9, scopeSummary: "Deck boards" },
    ]);
  });

  it("caps long scope summaries", () => {
    const wos = buildWorkOrders(
      Array.from({ length: 300 }, (_, i) => ({
        description: `Surface number ${i} with a long description`,
        workType: "interior",
        phase: null,
        laborHours: 1,
        prepHours: 0,
      })),
    );
    expect(wos[0]?.scopeSummary.length).toBe(1998);
    expect(wos[0]?.scopeSummary.endsWith("…")).toBe(true);
  });
});

describe("colorSelectionSeeds", () => {
  it("adds a row for every painted line", () => {
    expect(
      colorSelectionSeeds([
        {
          lineId: "l1",
          areaName: "Living Room",
          surface: "Walls",
          productId: "p1",
          brand: "behr",
          sheen: "eggshell",
          paints: true,
        },
        {
          lineId: "l2",
          areaName: " ",
          surface: "Trim",
          productId: null,
          brand: null,
          sheen: null,
          paints: true,
        },
        {
          lineId: "l3",
          areaName: null,
          surface: "Rot repair",
          productId: null,
          brand: null,
          sheen: null,
          paints: false,
        },
      ]),
    ).toEqual([
      {
        lineId: "l1",
        area: "Living Room",
        surface: "Walls",
        productId: "p1",
        brand: "behr",
        sheen: "eggshell",
      },
      { lineId: "l2", area: "General", surface: "Trim", productId: null, brand: null, sheen: null },
    ]);
  });
});

describe("onboardingRequirements (SPEC §6.4)", () => {
  const plain = {
    workTypes: ["interior"],
    hasHoa: false,
    leadSafeWork: false,
    hasRepairAllowance: false,
    hasColorConsult: false,
    depositCents: 50_000,
  };
  const required = (rows: ReturnType<typeof onboardingRequirements>) =>
    rows.filter((r) => r.required).map((r) => r.key);

  it("always asks for the basics", () => {
    const rows = onboardingRequirements(plain);
    expect(rows).toHaveLength(14);
    expect(required(rows)).toEqual([
      "signed_contract",
      "deposit_received",
      "contact_reachable",
      "access_confirmed",
      "colors_selected",
      "paint_ordered",
      "crew_assigned",
      "prep_instructions_sent",
    ]);
    expect(rows.find((r) => r.key === "hoa_approval")?.status).toBe("not_required");
    expect(rows.find((r) => r.key === "signed_contract")).toMatchObject({
      status: "pending",
      autoVerifyRule: "signed_document_exists",
      group: "contract",
      sortOrder: 10,
    });
  });

  it("adds HOA, lead-safe, repair, consult and season items when they apply", () => {
    const rows = onboardingRequirements({
      ...plain,
      workTypes: ["exterior"],
      hasHoa: true,
      leadSafeWork: true,
      hasRepairAllowance: true,
      hasColorConsult: true,
      depositCents: 0,
    });
    const keys = required(rows);
    expect(keys).toEqual(
      expect.arrayContaining([
        "hoa_approval",
        "lead_safe_plan",
        "repair_scope_approved",
        "color_consult_done",
        "start_in_season",
      ]),
    );
    expect(keys).not.toContain("deposit_received");
    // HOA only matters for exterior work.
    expect(required(onboardingRequirements({ ...plain, hasHoa: true }))).not.toContain(
      "hoa_approval",
    );
    expect(required(onboardingRequirements({ ...plain, workTypes: ["deck_fence"] }))).toContain(
      "start_in_season",
    );
  });

  it("reports progress over required items", () => {
    expect(
      onboardingProgress([
        { required: true, status: "verified" },
        { required: true, status: "pending" },
        { required: false, status: "verified" },
      ]),
    ).toEqual({ required: 2, cleared: 1 });
  });
});

describe("settings", () => {
  it("falls back to sample values for anything missing or malformed", () => {
    expect(parsePricing(null)).toEqual(SAMPLE_PRICING);
    expect(parsePricing({ sundries_percent: 12 }).sundries_percent).toBe(12);
    expect(parsePricing({ sundries_percent: "lots" })).toEqual(SAMPLE_PRICING);
    expect(parseTaxConfig(undefined)).toEqual({
      ratePercent: 0,
      defaultTaxable: true,
      confirmedWithAccountant: false,
    });
    expect(
      parseTaxConfig({
        rate_percent: 10.1,
        default_taxable: false,
        confirmed_with_accountant: true,
      }),
    ).toEqual({
      ratePercent: 10.1,
      defaultTaxable: false,
      confirmedWithAccountant: true,
    });
    expect(parseDiscountLimits({ roles: { estimator: 5 }, users: "x" })).toEqual({
      roles: { estimator: 5 },
      users: {},
    });
    expect(parseDiscountLimits(null)).toEqual({ roles: {}, users: {} });
    expect(parseDiscountLimits({ roles: { estimator: 500 } })).toEqual({ roles: {}, users: {} });
  });

  it("builds engine settings from the stored rows", () => {
    const s = toPricingSettings({ pricing: {}, depositPercent: 25, expiryDays: 14, taxConfig: {} });
    expect(s.depositPercent).toBe(25);
    expect(s.expiryDays).toBe(14);
    expect(s.loadedLaborRateCents).toBe(SAMPLE_PRICING.loaded_labor_rate_cents);
    expect(s.heightMultipliers.two_story).toBe(1.25);
  });

  it("resolves discount limits: approvers unlimited, user beats role, else 0", () => {
    const limits = { roles: { estimator: 5 }, users: { u2: 12 } };
    expect(discountLimitFor(limits, { userId: "u1", roleKey: "owner", canApprove: true })).toBe(
      Infinity,
    );
    expect(
      discountLimitFor(limits, { userId: "u1", roleKey: "estimator", canApprove: false }),
    ).toBe(5);
    expect(
      discountLimitFor(limits, { userId: "u2", roleKey: "estimator", canApprove: false }),
    ).toBe(12);
    expect(discountLimitFor(limits, { userId: "u3", roleKey: "painter", canApprove: false })).toBe(
      0,
    );
    expect(discountLimitFor(limits, { userId: "u3", roleKey: null, canApprove: false })).toBe(0);
  });
});
