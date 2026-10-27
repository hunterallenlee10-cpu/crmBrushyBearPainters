import type { ProductInput, RateInput } from "./line";
import { toPricingSettings, SAMPLE_PRICING, type PricingSettings } from "./settings";
import type { VersionInput, VersionLine } from "./version";

/**
 * Fixture jobs for the pricing engine tests. Every number here is made up
 * test data (not the company's rates or prices); expected results in the
 * tests are worked out by hand from these inputs.
 */

export const SETTINGS: PricingSettings = toPricingSettings({
  pricing: SAMPLE_PRICING,
  depositPercent: 30,
  expiryDays: 30,
  taxConfig: { rate_percent: 0, default_taxable: true },
});

export const RATES = {
  wallsFair: { unitsPerLaborHour: 150, prepHoursPerUnit: 0.005 },
  ceiling: { unitsPerLaborHour: 120, prepHoursPerUnit: 0.002 },
  baseboard: { unitsPerLaborHour: 40, prepHoursPerUnit: 0.01 },
  doorSide: { unitsPerLaborHour: 1.5, prepHoursPerUnit: 0.1 },
  cedarPoor: { unitsPerLaborHour: 80, prepHoursPerUnit: 0.02 },
} satisfies Record<string, RateInput>;

export const PRODUCTS = {
  eggshell: {
    id: "p-eggshell",
    coverageSqftPerGal: 400,
    costPerGalCents: 3000,
    containers: ["gallon", "five_gallon"],
  },
  ceilingFlat: {
    id: "p-ceiling",
    coverageSqftPerGal: 350,
    costPerGalCents: 2500,
    containers: ["gallon", "five_gallon"],
  },
  trimEnamel: {
    id: "p-trim",
    coverageSqftPerGal: 400,
    costPerGalCents: 4000,
    containers: ["quart", "gallon"],
  },
  exterior: {
    id: "p-exterior",
    coverageSqftPerGal: 350,
    costPerGalCents: 4500,
    containers: ["gallon", "five_gallon"],
  },
  stainBlockPrimer: {
    id: "p-primer",
    coverageSqftPerGal: 300,
    costPerGalCents: 3500,
    containers: ["gallon", "five_gallon"],
  },
} satisfies Record<string, ProductInput>;

type Base = Omit<VersionLine, "id" | "optionId" | "input" | "name" | "unit" | "sortOrder">;

const base: Base = {
  areaId: null,
  isOptional: false,
  workType: "interior",
  phase: null,
  catalogCode: null,
  isRepairAllowance: false,
  customerNote: null,
  sheen: null,
  sheenLabel: null,
  productId: null,
  productLabel: null,
  brand: null,
  primerProductId: null,
  primerProductLabel: null,
};

const production = {
  kind: "production_rate" as const,
  taxable: true,
  coats: 2 as const,
  primer: "none" as const,
  colorChange: "same" as const,
  prepLevel: "standard" as const,
  height: "one_story" as const,
  access: "ladder" as const,
};

/** Interior: Option A walls & ceilings; Option B adds baseboard and doors; one add-on. */
export function interiorJob(): VersionInput {
  const lines: VersionLine[] = [];
  for (const opt of ["A", "B"] as const) {
    lines.push(
      {
        ...base,
        id: `${opt}-walls`,
        optionId: `opt-${opt}`,
        areaId: `area-${opt}`,
        name: "Walls",
        unit: "sqft",
        sheen: "eggshell",
        sheenLabel: "Eggshell",
        productId: "p-eggshell",
        productLabel: "Interior Eggshell (sample)",
        sortOrder: 1,
        input: {
          ...production,
          quantity: 420,
          rate: RATES.wallsFair,
          paintSqftPerUnit: 1,
          product: PRODUCTS.eggshell,
          condition: "fair",
        },
      },
      {
        ...base,
        id: `${opt}-ceiling`,
        optionId: `opt-${opt}`,
        areaId: `area-${opt}`,
        name: "Ceiling",
        unit: "sqft",
        productId: "p-ceiling",
        productLabel: "Ceiling Flat (sample)",
        sortOrder: 2,
        input: {
          ...production,
          coats: 1,
          quantity: 240,
          rate: RATES.ceiling,
          paintSqftPerUnit: 1,
          product: PRODUCTS.ceilingFlat,
        },
      },
    );
  }
  lines.push(
    {
      ...base,
      id: "B-baseboard",
      optionId: "opt-B",
      areaId: "area-B",
      name: "Baseboard",
      unit: "lf",
      productId: "p-trim",
      productLabel: "Trim Enamel (sample)",
      sortOrder: 3,
      input: {
        ...production,
        quantity: 86,
        rate: RATES.baseboard,
        paintSqftPerUnit: 0.5,
        product: PRODUCTS.trimEnamel,
      },
    },
    {
      ...base,
      id: "B-doors",
      optionId: "opt-B",
      areaId: "area-B",
      name: "Doors",
      unit: "each",
      productId: "p-trim",
      productLabel: "Trim Enamel (sample)",
      sortOrder: 4,
      input: {
        ...production,
        quantity: 2,
        sides: 2,
        rate: RATES.doorSide,
        paintSqftPerUnit: 21,
        product: PRODUCTS.trimEnamel,
      },
    },
    {
      ...base,
      id: "addon-wash",
      optionId: null,
      isOptional: true,
      name: "Pressure wash driveway & walkway",
      unit: "lump",
      workType: "exterior",
      phase: "prep",
      catalogCode: "pressure_washing",
      sortOrder: 10,
      input: {
        kind: "flat",
        quantity: 1,
        taxable: true,
        unitPriceCents: 35000,
        unitCostCents: 15000,
        laborHoursPerUnit: 3,
      },
    },
  );
  return {
    options: [
      {
        id: "opt-A",
        name: "Walls & ceilings",
        description: null,
        isRecommended: false,
        sortOrder: 1,
      },
      {
        id: "opt-B",
        name: "Walls, ceilings, trim & doors",
        description: "Everything in the room.",
        isRecommended: true,
        sortOrder: 2,
      },
    ],
    areas: [
      { id: "area-A", optionId: "opt-A", name: "Living Room", workType: "interior", sortOrder: 1 },
      { id: "area-B", optionId: "opt-B", name: "Living Room", workType: "interior", sortOrder: 1 },
    ],
    lines,
    discount: null,
    settings: SETTINGS,
  };
}

/** Exterior: 2-story cedar, poor condition, dark → light (primer), pre-1978 lead-safe. */
export function exteriorJob(): VersionInput {
  return {
    options: [
      { id: "opt-X", name: "Full exterior", description: null, isRecommended: true, sortOrder: 1 },
    ],
    areas: [
      {
        id: "area-front",
        optionId: "opt-X",
        name: "Exterior – Front elevation",
        workType: "exterior",
        sortOrder: 1,
      },
    ],
    lines: [
      {
        ...base,
        id: "X-siding",
        optionId: "opt-X",
        areaId: "area-front",
        workType: "exterior",
        name: "Siding (cedar)",
        unit: "sqft",
        productId: "p-exterior",
        productLabel: "Exterior Acrylic (sample)",
        primerProductId: "p-primer",
        primerProductLabel: "Stain-blocking Primer (sample)",
        sortOrder: 1,
        input: {
          ...production,
          quantity: 640,
          rate: RATES.cedarPoor,
          paintSqftPerUnit: 1,
          product: PRODUCTS.exterior,
          primerProduct: PRODUCTS.stainBlockPrimer,
          primer: "spot",
          colorChange: "dark_to_light",
          prepLevel: "heavy",
          height: "two_story",
          access: "tall_ladder",
          condition: "poor",
          leadSafe: true,
        },
      },
      {
        ...base,
        id: "addon-rot",
        optionId: null,
        isOptional: true,
        name: "Wood rot repair allowance",
        unit: "lf",
        workType: "exterior",
        phase: "repair",
        catalogCode: "rot_repair_allowance",
        isRepairAllowance: true,
        sortOrder: 9,
        input: {
          kind: "flat",
          quantity: 10,
          taxable: true,
          unitPriceCents: 2500,
          unitCostCents: 1200,
          laborHoursPerUnit: 0.5,
        },
      },
    ],
    discount: null,
    settings: SETTINGS,
  };
}
