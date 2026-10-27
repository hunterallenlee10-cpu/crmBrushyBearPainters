import type {
  Access,
  ColorChange,
  Coats,
  Condition,
  Container,
  Height,
  Method,
  PrepLevel,
  Primer,
  Sides,
} from "./constants";
import { emptyBreakdown, roundToContainers, type ContainerBreakdown } from "./containers";
import { round2 } from "./measure";
import type { PricingSettings } from "./settings";

/**
 * Prices one line item (SPEC §7.4). Pure.
 *
 *   labor_hours   = (qty / rate) × height × access × coats_factor + prep_hours
 *   gallons       = ceil_to_container(paint_area × coats / coverage × (1 + waste%))
 *   labor_cost    = labor_hours × loaded_labor_rate
 *   material_cost = gallons × cost_per_gal + sundries% × labor_cost
 *   price         = (labor_cost + material_cost) / (1 − target_margin)
 *
 * or a flat catalog price per unit. An override replaces the price but needs a
 * reason; the computed price is always kept next to it.
 *
 * Extensions the spec describes in §7.3: a color change adds an extra coat or a
 * primer coat (Estimate Setup decides which); spot/full primer adds primer labor
 * and primer gallons; lead-safe lines add containment/cleanup labor; doors can
 * be painted on one or both sides; surfaces measured in lin ft or each convert
 * to paintable area with the catalog item's "sq ft per unit".
 */

export type RateInput = { unitsPerLaborHour: number; prepHoursPerUnit: number };

export type ProductInput = {
  id?: string | null;
  coverageSqftPerGal: number;
  costPerGalCents: number;
  containers: readonly Container[];
};

type Common = {
  quantity: number;
  /** Taxable when the company charges tax (rate in settings). */
  taxable: boolean;
  /** Replacement price (cents) with a required reason. */
  overridePriceCents?: number | null;
  overrideReason?: string | null;
  /** Change-order credit: the price counts as negative. */
  isCredit?: boolean;
  leadSafe?: boolean;
};

export type ProductionLineInput = Common & {
  kind: "production_rate";
  rate: RateInput | null;
  /** Paintable sq ft per unit (1 for sq ft surfaces). 0 = no paint (labor only). */
  paintSqftPerUnit: number;
  product: ProductInput | null;
  primerProduct?: ProductInput | null;
  coats: Coats;
  primer: Primer;
  colorChange: ColorChange;
  prepLevel: PrepLevel;
  height: Height;
  access: Access;
  sides?: Sides;
  /** Echoed for summaries; the rate passed in already matches them. */
  condition?: Condition;
  method?: Method;
};

export type FlatLineInput = Common & {
  kind: "flat";
  unitPriceCents: number;
  unitCostCents: number;
  /** Labor hours budgeted per unit (work orders; 0 when unknown). */
  laborHoursPerUnit?: number;
};

export type LineInput = ProductionLineInput | FlatLineInput;

export type LineIssue = { severity: "error" | "warning"; code: string; message: string };

export type PricedLine = {
  laborHours: number;
  prepHours: number;
  /** Paint (finish coats) gallons bought, after container rounding. */
  gallons: number;
  containers: ContainerBreakdown;
  primerGallons: number;
  primerContainers: ContainerBreakdown;
  /** Paint need before container rounding (finish + primer), for paint orders. */
  gallonsNeeded: number;
  primerGallonsNeeded: number;
  effectiveCoats: number;
  effectivePrimer: Primer;
  laborCostCents: number;
  paintCostCents: number;
  sundriesCents: number;
  materialCostCents: number;
  /** Labor + material; negative for credits. */
  costCents: number;
  /** Engine (or catalog) price before any override; negative for credits. */
  computedPriceCents: number;
  /** Signed like priceCents (negative for credits). */
  priceCents: number;
  overridden: boolean;
  /** (price − cost) / price, 0–1; null for a zero price. */
  marginRatio: number | null;
  issues: LineIssue[];
};

const MAX_MARGIN = 0.9;

export function marginPrice(costCents: number, targetMarginPercent: number): number {
  const m = Math.min(MAX_MARGIN, Math.max(0, targetMarginPercent / 100));
  return Math.round(costCents / (1 - m));
}

function finite(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function zeroLine(issues: LineIssue[]): PricedLine {
  return {
    laborHours: 0,
    prepHours: 0,
    gallons: 0,
    containers: emptyBreakdown(),
    primerGallons: 0,
    primerContainers: emptyBreakdown(),
    gallonsNeeded: 0,
    primerGallonsNeeded: 0,
    effectiveCoats: 0,
    effectivePrimer: "none",
    laborCostCents: 0,
    paintCostCents: 0,
    sundriesCents: 0,
    materialCostCents: 0,
    costCents: 0,
    computedPriceCents: 0,
    priceCents: 0,
    overridden: false,
    marginRatio: null,
    issues,
  };
}

const PRIMER_RANK: Record<Primer, number> = { none: 0, spot: 1, full: 2 };

/** The coats and primer a line really gets once the color-change rule applies. */
export function effectiveCoating(
  input: Pick<ProductionLineInput, "coats" | "primer" | "colorChange">,
  rule: PricingSettings["colorChangeRule"],
): { coats: number; primer: Primer } {
  let coats: number = input.coats;
  let primer: Primer = input.primer;
  if (input.colorChange !== "same") {
    const action = rule[input.colorChange];
    if (action === "extra_coat") coats += 1;
    if (action === "primer" && PRIMER_RANK[primer] < PRIMER_RANK.full) primer = "full";
  }
  return { coats, primer };
}

function coatFactor(coats: number, factors: PricingSettings["coatFactors"]): number {
  if (coats <= 1) return factors["1"];
  if (coats === 2) return factors["2"];
  if (coats === 3) return factors["3"];
  // A 4th coat (3 coats + color change) adds the same step as the 2nd → 3rd coat.
  return factors["3"] + (coats - 3) * (factors["3"] - factors["2"]);
}

function applyOverride(
  line: PricedLine,
  input: LineInput,
  issues: LineIssue[],
): Pick<PricedLine, "priceCents" | "overridden"> {
  const sign = input.isCredit ? -1 : 1;
  const override = input.overridePriceCents;
  if (finite(override)) {
    if (override < 0) {
      issues.push({
        severity: "error",
        code: "override_negative",
        message: "An override price can't be negative. Mark the line as a credit instead.",
      });
    }
    if (!input.overrideReason || input.overrideReason.trim().length < 3) {
      issues.push({
        severity: "error",
        code: "override_reason",
        message: "Say why the price is overridden.",
      });
    }
    return { priceCents: sign * Math.round(Math.abs(override)), overridden: true };
  }
  return { priceCents: line.computedPriceCents, overridden: false };
}

function finishMargin(line: PricedLine): PricedLine {
  const price = Math.abs(line.priceCents);
  return {
    ...line,
    marginRatio: price > 0 ? round4((price - Math.abs(line.costCents)) / price) : null,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function priceLine(input: LineInput, settings: PricingSettings): PricedLine {
  const issues: LineIssue[] = [];
  if (!finite(input.quantity) || input.quantity < 0) {
    return zeroLine([
      { severity: "error", code: "quantity", message: "Enter a quantity of zero or more." },
    ]);
  }
  const sign = input.isCredit ? -1 : 1;

  if (input.kind === "flat") {
    const qty = input.quantity;
    const cost = Math.round(qty * Math.max(0, input.unitCostCents));
    const base: PricedLine = {
      ...zeroLine(issues),
      laborHours: round2(qty * Math.max(0, input.laborHoursPerUnit ?? 0)),
      materialCostCents: cost,
      costCents: sign * cost,
      computedPriceCents: sign * Math.round(qty * Math.max(0, input.unitPriceCents)),
    };
    return finishMargin({ ...base, ...applyOverride(base, input, issues) });
  }

  const sides = input.sides ?? 1;
  const qty = input.quantity * sides;
  const { coats, primer } = effectiveCoating(input, settings.colorChangeRule);

  let laborHours = 0;
  let prepHours = 0;
  if (!input.rate || !finite(input.rate.unitsPerLaborHour) || input.rate.unitsPerLaborHour <= 0) {
    if (qty > 0) {
      issues.push({
        severity: "error",
        code: "no_rate",
        message:
          "No production rate for this surface, method and condition. Add one in Production Rates.",
      });
    }
  } else {
    const mult =
      settings.heightMultipliers[input.height] * settings.accessMultipliers[input.access];
    const paintHours =
      (qty / input.rate.unitsPerLaborHour) * mult * coatFactor(coats, settings.coatFactors);
    const primerShare = primer === "full" ? 1 : primer === "spot" ? settings.spotPrimerFraction : 0;
    const primerHours = ((qty * primerShare) / input.rate.unitsPerLaborHour) * mult;
    prepHours =
      qty * Math.max(0, input.rate.prepHoursPerUnit) * settings.prepLevelFactors[input.prepLevel];
    const leadSafe = input.leadSafe
      ? ((paintHours + primerHours + prepHours) * settings.leadSafeLaborPercent) / 100
      : 0;
    // Containment and cleanup is prep-type work.
    prepHours = round2(prepHours + leadSafe);
    laborHours = round2(paintHours + primerHours + prepHours);
  }

  const area = qty * Math.max(0, input.paintSqftPerUnit);
  const waste = 1 + settings.wastePercent / 100;
  let gallonsNeeded = 0;
  let paint = { gallons: 0, containers: emptyBreakdown() };
  let paintCost = 0;
  if (area > 0) {
    if (!input.product || input.product.coverageSqftPerGal <= 0) {
      issues.push({
        severity: "warning",
        code: "no_product",
        message: "Pick a paint product so gallons and paint cost are counted.",
      });
    } else {
      gallonsNeeded = round2(((area * coats) / input.product.coverageSqftPerGal) * waste);
      paint = roundToContainers(gallonsNeeded, input.product.containers);
      paintCost = Math.round(paint.gallons * input.product.costPerGalCents);
    }
  }

  let primerNeeded = 0;
  let primerPaint = { gallons: 0, containers: emptyBreakdown() };
  let primerCost = 0;
  const primerShare = primer === "full" ? 1 : primer === "spot" ? settings.spotPrimerFraction : 0;
  if (area > 0 && primerShare > 0) {
    const primerProduct = input.primerProduct ?? input.product;
    if (!input.primerProduct) {
      issues.push({
        severity: "warning",
        code: "no_primer_product",
        message: input.product
          ? "No primer product picked; primer is counted with the finish product."
          : "Pick a primer product so primer gallons are counted.",
      });
    }
    if (primerProduct && primerProduct.coverageSqftPerGal > 0) {
      primerNeeded = round2(((area * primerShare) / primerProduct.coverageSqftPerGal) * waste);
      primerPaint = roundToContainers(primerNeeded, primerProduct.containers);
      primerCost = Math.round(primerPaint.gallons * primerProduct.costPerGalCents);
    }
  }

  const laborCost = Math.round(laborHours * settings.loadedLaborRateCents);
  const sundries = Math.round((laborCost * settings.sundriesPercent) / 100);
  const material = paintCost + primerCost + sundries;
  const cost = laborCost + material;
  const computed = marginPrice(cost, settings.targetMarginPercent);

  const base: PricedLine = {
    laborHours,
    prepHours,
    gallons: paint.gallons,
    containers: paint.containers,
    primerGallons: primerPaint.gallons,
    primerContainers: primerPaint.containers,
    gallonsNeeded,
    primerGallonsNeeded: primerNeeded,
    effectiveCoats: coats,
    effectivePrimer: primer,
    laborCostCents: laborCost,
    paintCostCents: paintCost + primerCost,
    sundriesCents: sundries,
    materialCostCents: material,
    costCents: sign * cost,
    computedPriceCents: sign * computed,
    priceCents: 0,
    overridden: false,
    marginRatio: null,
    issues,
  };
  return finishMargin({ ...base, ...applyOverride(base, input, issues) });
}

/** True when nothing on the line blocks sending. */
export function lineIsValid(line: Pick<PricedLine, "issues">): boolean {
  return line.issues.every((i) => i.severity !== "error");
}
