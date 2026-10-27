import { describe, expect, it } from "vitest";
import {
  buildChangeOrderSnapshot,
  buildProposalSnapshot,
  priceChangeOrder,
  daysUntil,
  discountCents,
  expiresAt,
  isExpired,
  maxEffectiveDiscount,
  needsDiscountApproval,
  priceVersion,
  quoteSelection,
  quoteTotals,
  rrpTerms,
  summarizeOption,
  termsFor,
  type QuoteLine,
  type QuoteTerms,
  type SummaryLine,
} from "@/lib/estimating/engine";
import { SETTINGS, exteriorJob, interiorJob } from "./fixtures";

const line = (id: string, price: number, extra: Partial<QuoteLine> = {}): QuoteLine => ({
  id,
  priceCents: price,
  computedPriceCents: price,
  taxable: true,
  leadSafe: false,
  ...extra,
});

const terms = (extra: Partial<QuoteTerms> = {}): QuoteTerms => ({
  minimumJobCents: 150_000,
  discount: null,
  taxRatePercent: 0,
  depositPercent: 30,
  rrp: { priceCents: 15_000, taxable: true },
  ...extra,
});

describe("quoteTotals", () => {
  it("adds lines and selected add-ons, then the deposit", () => {
    const t = quoteTotals([line("a", 200_000)], [line("w", 35_000)], terms());
    expect(t.subtotalCents).toBe(235_000);
    expect(t.minimumAdjustmentCents).toBe(0);
    expect(t.totalCents).toBe(235_000);
    expect(t.depositCents).toBe(70_500);
    expect(t.effectiveDiscountPercent).toBe(0);
    expect(t.hasLeadSafe).toBe(false);
  });

  it("raises a small job to the minimum charge", () => {
    const t = quoteTotals([line("a", 50_000)], [], terms());
    expect(t.minimumAdjustmentCents).toBe(100_000);
    expect(t.adjustedCents).toBe(150_000);
    expect(t.totalCents).toBe(150_000);
    // An empty option isn't raised to the minimum.
    expect(quoteTotals([], [], terms()).totalCents).toBe(0);
  });

  it("applies amount and percent discounts, never below zero", () => {
    expect(
      quoteTotals([line("a", 200_000)], [], terms({ discount: { type: "amount", value: 20_000 } }))
        .totalCents,
    ).toBe(180_000);
    const pct = quoteTotals(
      [line("a", 200_000)],
      [],
      terms({ discount: { type: "percent", value: 10 } }),
    );
    expect(pct.discountCents).toBe(20_000);
    expect(pct.effectiveDiscountPercent).toBe(10);
    expect(discountCents(100, { type: "amount", value: 500 })).toBe(100);
    expect(discountCents(100, { type: "percent", value: 150 })).toBe(100);
    expect(discountCents(100, { type: "percent", value: 0 })).toBe(0);
    expect(discountCents(0, { type: "amount", value: 10 })).toBe(0);
    expect(discountCents(100, null)).toBe(0);
    expect(discountCents(100, { type: "amount", value: Number.NaN })).toBe(0);
  });

  it("taxes the taxable share of the discounted price", () => {
    const t = quoteTotals(
      [line("a", 100_000), line("b", 50_000, { taxable: false })],
      [],
      terms({ taxRatePercent: 10, discount: { type: "amount", value: 15_000 } }),
    );
    expect(t.preTaxCents).toBe(135_000);
    expect(t.taxableCents).toBe(90_000);
    expect(t.taxCents).toBe(9_000);
    expect(t.totalCents).toBe(144_000);
    expect(t.depositCents).toBe(43_200);
  });

  it("adds RRP supplies once when lead-safe work is included", () => {
    const t = quoteTotals(
      [line("a", 200_000, { leadSafe: true }), line("b", 10_000, { leadSafe: true })],
      [],
      terms({ taxRatePercent: 10, rrp: { priceCents: 15_000, taxable: false } }),
    );
    expect(t.rrpCents).toBe(15_000);
    expect(t.subtotalCents).toBe(225_000);
    expect(t.taxableCents).toBe(210_000);
  });

  it("counts overrides below the computed price as an effective discount", () => {
    const t = quoteTotals(
      [line("a", 180_000, { computedPriceCents: 200_000 })],
      [],
      terms({ discount: { type: "amount", value: 10_000 } }),
    );
    expect(t.effectiveDiscountPercent).toBe(15);
    // Computed under the minimum: the minimum is the comparison point.
    const small = quoteTotals([line("a", 90_000, { computedPriceCents: 100_000 })], [], terms());
    expect(small.computedAdjustedCents).toBe(150_000);
    expect(small.effectiveDiscountPercent).toBe(0);
  });
});

describe("summarizeOption (margin panel)", () => {
  const sl = (
    id: string,
    price: number,
    cost: number,
    extra: Partial<SummaryLine> = {},
  ): SummaryLine => ({
    ...line(id, price),
    costCents: cost,
    laborHours: 8,
    gallons: 2,
    primerGallons: 0,
    productId: "p1",
    productLabel: "Product 1",
    primerProductId: null,
    primerProductLabel: null,
    ...extra,
  });
  const internal = { rrpCostCents: 7_500, marginFloorPercent: 40, crewSize: 2, hoursPerCrewDay: 8 };

  it("reports cost, margin, hours, crew-days and gallons by product", () => {
    const s = summarizeOption(
      [
        sl("a", 200_000, 100_000),
        sl("b", 100_000, 50_000, {
          primerGallons: 1,
          primerProductId: "pp",
          primerProductLabel: "Primer",
        }),
      ],
      [sl("c", 50_000, 40_000, { productId: null, productLabel: null, gallons: 1 })],
      terms(),
      internal,
    );
    expect(s.costCents).toBe(190_000);
    expect(s.grossProfitCents).toBe(160_000);
    expect(s.grossMarginRatio).toBe(0.4571);
    expect(s.belowMarginFloor).toBe(false);
    expect(s.laborHours).toBe(24);
    expect(s.crewDays).toBe(1.5);
    expect(s.gallonsByProduct).toEqual([
      { productId: "p1", label: "Product 1", gallons: 4 },
      { productId: "pp", label: "Primer", gallons: 1 },
      { productId: null, label: "Unspecified", gallons: 1 },
    ]);
  });

  it("warns below the margin floor and handles an empty option", () => {
    const low = summarizeOption(
      [sl("a", 200_000, 150_000, { leadSafe: true })],
      [],
      terms(),
      internal,
    );
    expect(low.costCents).toBe(157_500);
    expect(low.belowMarginFloor).toBe(true);
    const empty = summarizeOption([], [], terms(), {
      ...internal,
      crewSize: 0,
      hoursPerCrewDay: 0,
    });
    expect(empty.grossMarginRatio).toBeNull();
    expect(empty.belowMarginFloor).toBe(false);
    expect(empty.crewDays).toBe(0);
  });
});

describe("approvals and expiry", () => {
  it("needs approval only above the limit and above what an owner approved", () => {
    expect(needsDiscountApproval(4, 5, null)).toBe(false);
    expect(needsDiscountApproval(5, 5, null)).toBe(false);
    expect(needsDiscountApproval(7.5, 5, null)).toBe(true);
    expect(needsDiscountApproval(7.5, 5, 8)).toBe(false);
    expect(needsDiscountApproval(9, 5, 8)).toBe(true);
    expect(needsDiscountApproval(50, Number.POSITIVE_INFINITY, null)).toBe(false);
    expect(
      maxEffectiveDiscount([{ effectiveDiscountPercent: 2 }, { effectiveDiscountPercent: 6 }]),
    ).toBe(6);
    expect(maxEffectiveDiscount([])).toBe(0);
  });

  it("computes expiry and days left", () => {
    const sent = new Date("2026-10-01T17:00:00Z");
    const exp = expiresAt(sent, 30);
    expect(exp.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(expiresAt(sent, 0).toISOString()).toBe("2026-10-02T17:00:00.000Z");
    expect(isExpired(exp, new Date("2026-10-31T16:59:00Z"))).toBe(false);
    expect(isExpired(exp.toISOString(), new Date("2026-10-31T17:00:00Z"))).toBe(true);
    expect(isExpired(null, new Date())).toBe(false);
    expect(daysUntil(exp, new Date("2026-10-26T16:00:00Z"))).toBe(5);
    expect(daysUntil(exp, new Date("2026-10-31T10:00:00Z"))).toBe(0);
    expect(daysUntil(exp, new Date("2026-11-02T18:00:00Z"))).toBe(-3);
  });

  it("prices RRP supplies with the margin target", () => {
    expect(rrpTerms(7_500, 50, true)).toEqual({ priceCents: 15_000, taxable: true });
    expect(rrpTerms(-1, 50, false).priceCents).toBe(0);
  });
});

describe("priceVersion — fixture jobs", () => {
  it("prices the interior job's two options and the add-on", () => {
    const v = interiorJob();
    const p = priceVersion(v);
    const [a, b] = p.options;
    expect(a?.summary.subtotalCents).toBe(156_100);
    expect(b?.summary.subtotalCents).toBe(298_146);
    expect(b?.withAllAddOns.subtotalCents).toBe(333_146);
    expect(b?.summary.depositCents).toBe(89_444);
    expect(p.addOns.map((l) => l.line.id)).toEqual(["addon-wash"]);
    expect(p.sendable).toBe(true);
    expect(p.maxEffectiveDiscountPercent).toBe(0);
    expect(b?.summary.laborHours).toBe(19.17);
    expect(b?.withAllAddOns.laborHours).toBe(22.17);
    expect(b?.summary.belowMarginFloor).toBe(false);
  });

  it("finds the effective discount across options", () => {
    const v = { ...interiorJob(), discount: { type: "percent" as const, value: 5 } };
    const p = priceVersion(v);
    expect(p.maxEffectiveDiscountPercent).toBe(5);
    const withAll = p.options[1]?.withAllAddOns;
    expect(withAll?.discountCents).toBe(16_657);
    expect(withAll?.totalCents).toBe(316_489);
    expect(withAll?.depositCents).toBe(94_947);
  });

  it("adds RRP supplies to the lead-safe exterior and reports issues", () => {
    const p = priceVersion(exteriorJob());
    const x = p.options[0];
    expect(x?.summary.rrpCents).toBe(15_000);
    expect(x?.summary.subtotalCents).toBe(931_122);
    expect(x?.withAllAddOns.subtotalCents).toBe(956_122);
    expect(x?.summary.costCents).toBe(458_061 + 7_500);
  });

  it("refuses to send empty or broken versions", () => {
    const none = priceVersion({ ...interiorJob(), options: [], areas: [], lines: [] });
    expect(none.sendable).toBe(false);
    expect(none.issues.map((i) => i.code)).toEqual(["no_options"]);

    const empty = priceVersion({ ...interiorJob(), lines: [] });
    expect(empty.issues.map((i) => i.code)).toEqual(["empty"]);

    const v = interiorJob();
    const orphan = priceVersion({
      ...v,
      lines: v.lines.map((l) => (l.id === "A-walls" ? { ...l, optionId: "gone" } : l)),
    });
    expect(orphan.issues.map((i) => i.code)).toContain("orphan_line");
    expect(orphan.sendable).toBe(false);

    const noRate = priceVersion({
      ...v,
      lines: v.lines.map((l) =>
        l.id === "A-walls" && l.input.kind === "production_rate"
          ? { ...l, input: { ...l.input, rate: null } }
          : l,
      ),
    });
    expect(noRate.sendable).toBe(false);
    expect(noRate.issues.find((i) => i.code === "no_rate")?.lineId).toBe("A-walls");
  });

  it("uses settings for the terms", () => {
    expect(termsFor(SETTINGS, null)).toEqual({
      minimumJobCents: 150_000,
      discount: null,
      taxRatePercent: 0,
      depositPercent: 30,
      rrp: { priceCents: 15_000, taxable: true },
    });
  });
});

describe("proposal snapshot", () => {
  it("describes scope by area in plain English with no internal numbers", () => {
    const v = interiorJob();
    const snap = buildProposalSnapshot(v, priceVersion(v));
    expect(snap.options).toHaveLength(2);
    const b = snap.options[1];
    expect(b?.isRecommended).toBe(true);
    expect(b?.areas[0]?.name).toBe("Living Room");
    expect(b?.areas[0]?.lines.map((l) => l.description)).toEqual([
      "Walls — 420 sq ft · 2 coats · Eggshell",
      "Ceiling — 240 sq ft · 1 coat",
      "Baseboard — 86 lin ft · 2 coats",
      "Doors — 2 each · both sides · 2 coats",
    ]);
    expect(snap.addOns[0]).toMatchObject({
      name: "Pressure wash driveway & walkway",
      description: "Pressure wash driveway & walkway",
      priceCents: 35_000,
      catalogCode: "pressure_washing",
    });
    expect(JSON.stringify(snap)).not.toMatch(/costCents|laborHours|grossMargin/);
    expect(snap.workTypes.sort()).toEqual(["exterior", "interior"]);
    expect(snap.leadSafe).toBe(false);
  });

  it("puts lines without an area under General and flags lead-safe work", () => {
    const v = exteriorJob();
    const lines = v.lines.map((l) =>
      l.id === "X-siding" ? { ...l, areaId: null, customerNote: "Front only." } : l,
    );
    const snap = buildProposalSnapshot({ ...v, lines }, priceVersion({ ...v, lines }));
    expect(snap.options[0]?.areas[0]?.name).toBe("General");
    expect(snap.options[0]?.areas[0]?.lines[0]?.description).toBe(
      "Siding (cedar) — 640 sq ft · 2 coats · full prime. Front only.",
    );
    expect(snap.leadSafe).toBe(true);
    const bare = {
      ...v,
      areas: v.areas.map((a) => ({ ...a, workType: null })),
      lines: v.lines.map((l) => ({ ...l, workType: null })),
    };
    expect(buildProposalSnapshot(bare, priceVersion(bare)).workTypes).toEqual([]);
  });

  it("quotes the customer's selection the same way the server does", () => {
    const v = interiorJob();
    const snap = buildProposalSnapshot(v, priceVersion(v));
    const q = quoteSelection(snap, { optionId: "opt-B", addOnIds: ["addon-wash"] });
    expect(q?.totals.totalCents).toBe(333_146);
    expect(q?.addOns).toHaveLength(1);
    expect(quoteSelection(snap, { optionId: "nope", addOnIds: [] })).toBeNull();
    expect(quoteSelection(snap, { optionId: "opt-B", addOnIds: ["forged"] })).toBeNull();
  });
});

describe("change orders", () => {
  const job = exteriorJob();
  const base = job.lines.find((l) => l.id === "addon-rot")!;
  const rot = { ...base, optionId: null, isOptional: false, id: "co-rot" };
  const credit = {
    ...base,
    id: "co-credit",
    name: "Skip the garage trim",
    sortOrder: 20,
    optionId: null,
    isOptional: false,
    input: { ...base.input, quantity: 4, isCredit: true, taxable: false },
  };

  it("prices additions and credits with tax on the taxable part", () => {
    const settings = { ...SETTINGS, tax: { ...SETTINGS.tax, ratePercent: 10 } };
    const p = priceChangeOrder({
      id: "co",
      title: "Rot",
      reason: null,
      lines: [credit, rot],
      settings,
    });
    expect(p.lines.map((l) => l.line.id)).toEqual(["co-rot", "co-credit"]);
    expect(p.subtotalCents).toBe(25_000 - 10_000);
    expect(p.taxCents).toBe(2_500);
    expect(p.totalCents).toBe(17_500);
    expect(p.costCents).toBe(12_000 - 4_800);
    expect(p.laborHours).toBe(7);
    expect(p.sendable).toBe(true);

    const snap = buildChangeOrderSnapshot(
      { id: "co", title: "Rot", reason: "Found soft wood", lines: [rot, credit], settings },
      p,
      { beforeCents: 1_000_000 },
    );
    expect(snap.options[0]).toMatchObject({
      id: "co",
      name: "Rot",
      description: "Found soft wood",
    });
    expect(snap.options[0]?.totals.totalCents).toBe(17_500);
    expect(snap.options[0]?.totals.taxableCents).toBe(25_000);
    expect(snap.changeOrder).toEqual({ beforeCents: 1_000_000, afterCents: 1_017_500 });
    expect(snap.workTypes).toEqual(["exterior"]);
    expect(snap.leadSafe).toBe(false);
  });

  it("can go negative, needs a line, and handles an unknown contract", () => {
    const p = priceChangeOrder({
      id: "co",
      title: "Credit",
      reason: null,
      lines: [credit],
      settings: SETTINGS,
    });
    expect(p.totalCents).toBe(-10_000);
    const empty = priceChangeOrder({
      id: "co",
      title: "Nothing",
      reason: null,
      lines: [],
      settings: SETTINGS,
    });
    expect(empty.sendable).toBe(false);
    expect(empty.issues[0]?.code).toBe("empty");
    const unexplained = { ...rot, input: { ...rot.input, overridePriceCents: 100 } };
    const bad = priceChangeOrder({
      id: "co",
      title: "Bad",
      reason: null,
      lines: [unexplained],
      settings: SETTINGS,
    });
    expect(bad.issues).toEqual([
      expect.objectContaining({ code: "override_reason", lineId: "co-rot" }),
    ]);
    expect(bad.sendable).toBe(false);
    const lead = { ...rot, workType: null, input: { ...rot.input, leadSafe: true } };
    const snap = buildChangeOrderSnapshot(
      { id: "co", title: "Lead", reason: null, lines: [lead], settings: SETTINGS },
      priceChangeOrder({
        id: "co",
        title: "Lead",
        reason: null,
        lines: [lead],
        settings: SETTINGS,
      }),
      { beforeCents: null },
    );
    expect(snap.changeOrder.afterCents).toBeNull();
    expect(snap.leadSafe).toBe(true);
    expect(snap.workTypes).toEqual([]);
  });
});
