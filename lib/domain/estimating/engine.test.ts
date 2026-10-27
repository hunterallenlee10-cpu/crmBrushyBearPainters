import { describe, expect, it } from "vitest";
import {
  containerGallons,
  describeContainers,
  effectiveCoating,
  emptyBreakdown,
  isContainer,
  lineIsValid,
  marginPrice,
  priceLine,
  roundToContainers,
  type LineInput,
  type ProductionLineInput,
} from "@/lib/estimating/engine";
import { PRODUCTS, RATES, SETTINGS } from "./fixtures";

const walls: ProductionLineInput = {
  kind: "production_rate",
  quantity: 420,
  taxable: true,
  rate: RATES.wallsFair,
  paintSqftPerUnit: 1,
  product: PRODUCTS.eggshell,
  coats: 2,
  primer: "none",
  colorChange: "same",
  prepLevel: "standard",
  height: "one_story",
  access: "ladder",
};

describe("roundToContainers", () => {
  it("rounds up to the smallest container and fills with the largest first", () => {
    expect(roundToContainers(2.31, ["gallon", "five_gallon"])).toEqual({
      gallons: 3,
      containers: { quart: 0, gallon: 3, five_gallon: 0 },
    });
    expect(roundToContainers(11.2, ["gallon", "five_gallon"])).toEqual({
      gallons: 12,
      containers: { quart: 0, gallon: 2, five_gallon: 2 },
    });
  });

  it("upsizes 4+ loose gallons to a 5-gallon pail", () => {
    expect(roundToContainers(4.02, ["gallon", "five_gallon"]).containers).toEqual({
      quart: 0,
      gallon: 0,
      five_gallon: 1,
    });
    expect(roundToContainers(9, ["gallon", "five_gallon"]).containers).toEqual({
      quart: 0,
      gallon: 0,
      five_gallon: 2,
    });
  });

  it("uses quarts for small amounts and upsizes 3+ quarts to a gallon", () => {
    expect(roundToContainers(0.24, ["quart", "gallon"]).containers).toEqual({
      quart: 1,
      gallon: 0,
      five_gallon: 0,
    });
    expect(roundToContainers(1.6, ["quart", "gallon"])).toEqual({
      gallons: 2,
      containers: { quart: 0, gallon: 2, five_gallon: 0 },
    });
    expect(roundToContainers(1.4, ["quart", "gallon"])).toEqual({
      gallons: 1.5,
      containers: { quart: 2, gallon: 1, five_gallon: 0 },
    });
  });

  it("handles products sold only in one size or quarts beside pails", () => {
    expect(roundToContainers(7, ["five_gallon"])).toEqual({
      gallons: 10,
      containers: { quart: 0, gallon: 0, five_gallon: 2 },
    });
    expect(roundToContainers(0.6, ["quart"]).containers.quart).toBe(3);
    expect(roundToContainers(6, ["quart", "five_gallon"]).containers).toEqual({
      quart: 4,
      gallon: 0,
      five_gallon: 1,
    });
    expect(roundToContainers(9.5, ["quart", "five_gallon"]).containers).toEqual({
      quart: 0,
      gallon: 0,
      five_gallon: 2,
    });
  });

  it("treats an empty list as gallons and returns nothing for no need", () => {
    expect(roundToContainers(2.2, []).containers).toEqual({ quart: 0, gallon: 3, five_gallon: 0 });
    expect(roundToContainers(0, ["gallon"])).toEqual({ gallons: 0, containers: emptyBreakdown() });
    expect(roundToContainers(Number.NaN, ["gallon"]).gallons).toBe(0);
  });

  it("describes and totals containers", () => {
    const c = { quart: 2, gallon: 1, five_gallon: 2 };
    expect(containerGallons(c)).toBe(11.5);
    expect(describeContainers(c)).toBe("2 × 5-gallon, 1 gallon, 2 quarts");
    expect(describeContainers({ quart: 1, gallon: 2, five_gallon: 0 })).toBe("2 gallons, 1 quart");
    expect(describeContainers(emptyBreakdown())).toBe("None");
    expect(isContainer("quart")).toBe(true);
    expect(isContainer("drum")).toBe(false);
  });
});

describe("priceLine — production rate", () => {
  it("prices the living-room walls fixture by the SPEC §7.4 formulas", () => {
    const p = priceLine(walls, SETTINGS);
    // 420/150 × 1.75 coats = 4.9 h paint + 420 × 0.005 = 2.1 h prep
    expect(p.laborHours).toBe(7);
    expect(p.prepHours).toBe(2.1);
    // 420 × 2 / 400 × 1.10 = 2.31 gal → 3 gallons
    expect(p.gallonsNeeded).toBe(2.31);
    expect(p.gallons).toBe(3);
    expect(p.laborCostCents).toBe(45_500);
    expect(p.paintCostCents).toBe(9_000);
    expect(p.sundriesCents).toBe(3_640);
    expect(p.materialCostCents).toBe(12_640);
    expect(p.costCents).toBe(58_140);
    expect(p.computedPriceCents).toBe(116_280);
    expect(p.priceCents).toBe(116_280);
    expect(p.marginRatio).toBe(0.5);
    expect(p.issues).toEqual([]);
    expect(lineIsValid(p)).toBe(true);
  });

  it("applies height, access, heavy prep, color-change primer and lead-safe labor", () => {
    const p = priceLine(
      {
        ...walls,
        quantity: 640,
        rate: RATES.cedarPoor,
        product: PRODUCTS.exterior,
        primerProduct: PRODUCTS.stainBlockPrimer,
        primer: "spot",
        colorChange: "dark_to_light",
        prepLevel: "heavy",
        height: "two_story",
        access: "tall_ladder",
        leadSafe: true,
      },
      SETTINGS,
    );
    // paint 640/80 × 1.375 × 1.75 = 19.25; primer (full via dark→light) 11; prep 22.4 + 15% lead-safe
    expect(p.effectivePrimer).toBe("full");
    expect(p.prepHours).toBe(30.3);
    expect(p.laborHours).toBe(60.55);
    expect(p.gallons).toBe(5);
    expect(p.containers.five_gallon).toBe(1);
    expect(p.primerGallonsNeeded).toBe(2.35);
    expect(p.primerGallons).toBe(3);
    expect(p.paintCostCents).toBe(22_500 + 10_500);
    expect(p.costCents).toBe(458_061);
    expect(p.computedPriceCents).toBe(916_122);
  });

  it("adds an extra coat for light → dark and paints both sides of a door", () => {
    const door = priceLine(
      {
        ...walls,
        quantity: 2,
        sides: 2,
        rate: RATES.doorSide,
        paintSqftPerUnit: 21,
        product: PRODUCTS.trimEnamel,
      },
      SETTINGS,
    );
    expect(door.laborHours).toBe(5.07);
    expect(door.gallons).toBe(0.5);
    expect(door.computedPriceCents).toBe(75_182);

    const darker = priceLine({ ...walls, colorChange: "light_to_dark" }, SETTINGS);
    expect(darker.effectiveCoats).toBe(3);
    // 2.8 × 2.5 + 2.1
    expect(darker.laborHours).toBe(9.1);
  });

  it("supports a fourth coat (three coats plus a color change)", () => {
    const p = priceLine({ ...walls, coats: 3, colorChange: "light_to_dark" }, SETTINGS);
    expect(p.effectiveCoats).toBe(4);
    // coat factor 2.5 + (2.5 − 1.75) = 3.25 → 2.8 × 3.25 + 2.1 = 11.2
    expect(p.laborHours).toBe(11.2);
  });

  it("keeps primer and coats when the color-change rule says nothing", () => {
    const rule = { light_to_dark: "none", dark_to_light: "none" } as const;
    expect(
      effectiveCoating({ coats: 2, primer: "spot", colorChange: "dark_to_light" }, rule),
    ).toEqual({
      coats: 2,
      primer: "spot",
    });
    expect(
      effectiveCoating(
        { coats: 1, primer: "full", colorChange: "dark_to_light" },
        { light_to_dark: "none", dark_to_light: "primer" },
      ),
    ).toEqual({ coats: 1, primer: "full" });
  });

  it("spot-primes a share of the area and counts primer with the finish product when none is picked", () => {
    const p = priceLine({ ...walls, primer: "spot" }, SETTINGS);
    // 25% of 420 = 105 sq ft / 400 × 1.1 = 0.29 gal → 1 gallon of the finish product
    expect(p.primerGallonsNeeded).toBe(0.29);
    expect(p.primerGallons).toBe(1);
    expect(p.issues.map((i) => i.code)).toEqual(["no_primer_product"]);
    expect(lineIsValid(p)).toBe(true);
  });

  it("warns without a product, errors without a rate", () => {
    const noProduct = priceLine({ ...walls, product: null, primer: "full" }, SETTINGS);
    expect(noProduct.gallons).toBe(0);
    expect(noProduct.issues.map((i) => i.code)).toEqual(["no_product", "no_primer_product"]);
    expect(noProduct.issues[1]?.message).toMatch(/Pick a primer product/);

    const noRate = priceLine({ ...walls, rate: null }, SETTINGS);
    expect(noRate.laborHours).toBe(0);
    expect(noRate.issues[0]?.code).toBe("no_rate");
    expect(lineIsValid(noRate)).toBe(false);

    const zeroRate = priceLine(
      { ...walls, rate: { unitsPerLaborHour: 0, prepHoursPerUnit: 0 } },
      SETTINGS,
    );
    expect(zeroRate.issues[0]?.code).toBe("no_rate");

    // Nothing to do (quantity 0) is not an error.
    expect(priceLine({ ...walls, rate: null, quantity: 0 }, SETTINGS).issues).toEqual([]);
  });

  it("counts labor-only surfaces (no paintable area) without paint", () => {
    const p = priceLine({ ...walls, paintSqftPerUnit: 0, product: null }, SETTINGS);
    expect(p.gallons).toBe(0);
    expect(p.paintCostCents).toBe(0);
    expect(p.issues).toEqual([]);
  });

  it("rejects a bad quantity", () => {
    const p = priceLine({ ...walls, quantity: -1 }, SETTINGS);
    expect(p.priceCents).toBe(0);
    expect(p.issues[0]?.code).toBe("quantity");
    expect(priceLine({ ...walls, quantity: Number.NaN }, SETTINGS).issues[0]?.code).toBe(
      "quantity",
    );
  });
});

describe("priceLine — overrides, flat catalog prices and credits", () => {
  it("keeps the computed price next to an override with a reason", () => {
    const p = priceLine(
      { ...walls, overridePriceCents: 100_000, overrideReason: "Matched last year's quote" },
      SETTINGS,
    );
    expect(p.overridden).toBe(true);
    expect(p.priceCents).toBe(100_000);
    expect(p.computedPriceCents).toBe(116_280);
    expect(p.marginRatio).toBe(0.4186);
    expect(lineIsValid(p)).toBe(true);
  });

  it("requires a reason for an override and refuses negative overrides", () => {
    const p = priceLine({ ...walls, overridePriceCents: 90_000, overrideReason: " " }, SETTINGS);
    expect(p.issues.map((i) => i.code)).toEqual(["override_reason"]);
    expect(lineIsValid(p)).toBe(false);
    const neg = priceLine(
      { ...walls, overridePriceCents: -5, overrideReason: "Customer credit" },
      SETTINGS,
    );
    expect(neg.issues.map((i) => i.code)).toEqual(["override_negative"]);
  });

  it("prices flat catalog items per unit", () => {
    const flat: LineInput = {
      kind: "flat",
      quantity: 3,
      taxable: false,
      unitPriceCents: 12_500,
      unitCostCents: 5_000,
      laborHoursPerUnit: 1.5,
    };
    const p = priceLine(flat, SETTINGS);
    expect(p.priceCents).toBe(37_500);
    expect(p.costCents).toBe(15_000);
    expect(p.laborHours).toBe(4.5);
    expect(p.marginRatio).toBe(0.6);
    const free = priceLine({ ...flat, unitPriceCents: 0, unitCostCents: 0 }, SETTINGS);
    expect(free.marginRatio).toBeNull();
    expect(priceLine({ ...flat, laborHoursPerUnit: undefined }, SETTINGS).laborHours).toBe(0);
  });

  it("makes change-order credits negative", () => {
    const p = priceLine(
      {
        kind: "flat",
        quantity: 10,
        taxable: true,
        unitPriceCents: 1_000,
        unitCostCents: 400,
        isCredit: true,
      },
      SETTINGS,
    );
    expect(p.priceCents).toBe(-10_000);
    expect(p.computedPriceCents).toBe(-10_000);
    expect(p.costCents).toBe(-4_000);
    expect(p.marginRatio).toBe(0.6);
    const overridden = priceLine(
      {
        kind: "flat",
        quantity: 10,
        taxable: true,
        unitPriceCents: 1_000,
        unitCostCents: 400,
        isCredit: true,
        overridePriceCents: 8_000,
        overrideReason: "Agreed on site",
      },
      SETTINGS,
    );
    expect(overridden.priceCents).toBe(-8_000);
    const credit = priceLine({ ...walls, isCredit: true }, SETTINGS);
    expect(credit.priceCents).toBe(-116_280);
    expect(credit.costCents).toBe(-58_140);
  });

  it("caps the margin used for pricing", () => {
    expect(marginPrice(1000, 50)).toBe(2000);
    expect(marginPrice(1000, 0)).toBe(1000);
    expect(marginPrice(1000, 99)).toBe(10_000);
    expect(marginPrice(1000, -5)).toBe(1000);
  });
});
