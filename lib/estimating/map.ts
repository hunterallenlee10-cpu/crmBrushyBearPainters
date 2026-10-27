import type { Database, Json } from "@/lib/db/types";
import {
  isContainer,
  type Access,
  type Coats,
  type ColorChange,
  type Condition,
  type Container,
  type Discount,
  type Height,
  type LineInput,
  type Method,
  type PrepLevel,
  type Primer,
  type PricedLine,
  type PricingSettings,
  type ProductInput,
  type RateInput,
  type Sides,
  type Unit,
  type VersionInput,
  type VersionLine,
  type WorkOrderPhase,
  ACCESS_TYPES,
  COLOR_CHANGES,
  CONDITIONS,
  HEIGHTS,
  METHODS,
  PREP_LEVELS,
  PRIMERS,
  UNITS,
  WORK_ORDER_PHASES,
} from "@/lib/estimating/engine";

/**
 * Maps database rows to the pricing engine's inputs and its results back to
 * the columns `store_version_pricing()` writes. Pure (unit-tested): the loaders
 * in ./load.ts fetch the rows.
 */

type Tables = Database["public"]["Tables"];
export type LineRow = Tables["estimate_line_items"]["Row"];
export type OptionRow = Tables["estimate_options"]["Row"];
export type AreaRow = Tables["estimate_areas"]["Row"];
export type ProductRow = Pick<
  Tables["paint_products"]["Row"],
  | "id"
  | "brand"
  | "line"
  | "product"
  | "use"
  | "sheens"
  | "coverage_sqft_per_gal"
  | "cost_per_gal_cents"
  | "containers"
  | "is_primer"
  | "active"
  | "is_sample"
>;
export type RateRow = Pick<
  Tables["production_rates"]["Row"],
  "surface" | "method" | "condition" | "units_per_labor_hour" | "prep_hours_per_unit" | "active"
>;

export type CatalogLookups = {
  products: ReadonlyMap<string, ProductRow>;
  rates: ReadonlyMap<string, RateRow>;
  /** picklist value → label (paint_brand, sheen). */
  brandLabels: ReadonlyMap<string, string>;
  sheenLabels: ReadonlyMap<string, string>;
};

export const rateKey = (surface: string, method: string, condition: string) =>
  `${surface}|${method}|${condition}`;

function pick<T extends string>(list: readonly T[], v: string | null | undefined, fallback: T): T {
  return (list as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
}

export function productLabel(
  p: ProductRow | undefined,
  brands: ReadonlyMap<string, string>,
): string | null {
  if (!p) return null;
  return [brands.get(p.brand) ?? p.brand, p.product].filter(Boolean).join(" ");
}

function toProduct(p: ProductRow | undefined): ProductInput | null {
  if (!p) return null;
  const containers = p.containers.filter(isContainer) as Container[];
  return {
    id: p.id,
    coverageSqftPerGal: Number(p.coverage_sqft_per_gal),
    costPerGalCents: Number(p.cost_per_gal_cents),
    containers,
  };
}

function toRate(r: RateRow | undefined): RateInput | null {
  if (!r || !r.active) return null;
  return {
    unitsPerLaborHour: Number(r.units_per_labor_hour),
    prepHoursPerUnit: Number(r.prep_hours_per_unit),
  };
}

/** One line row → the engine's line (rates and products resolved from the catalog). */
export function toVersionLine(row: LineRow, lookups: CatalogLookups): VersionLine {
  const product = row.paint_product_id ? lookups.products.get(row.paint_product_id) : undefined;
  const primer = row.primer_product_id ? lookups.products.get(row.primer_product_id) : undefined;
  const method = pick<Method>(METHODS, row.method, "brush_roll");
  const condition = pick<Condition>(CONDITIONS, row.condition, "good");
  const common = {
    quantity: Number(row.quantity),
    taxable: row.taxable,
    overridePriceCents: row.override_price_cents,
    overrideReason: row.override_reason,
    isCredit: row.is_credit,
    leadSafe: row.lead_safe,
  };
  const input: LineInput =
    row.kind === "production_rate"
      ? {
          ...common,
          kind: "production_rate",
          rate: row.surface
            ? toRate(lookups.rates.get(rateKey(row.surface, method, condition)))
            : null,
          paintSqftPerUnit: Number(row.paint_sqft_per_unit ?? 0),
          product: toProduct(product),
          primerProduct: toProduct(primer),
          coats: (row.coats >= 1 && row.coats <= 3 ? row.coats : 2) as Coats,
          primer: pick<Primer>(PRIMERS, row.primer, "none"),
          colorChange: pick<ColorChange>(COLOR_CHANGES, row.color_change, "same"),
          prepLevel: pick<PrepLevel>(PREP_LEVELS, row.prep_level, "standard"),
          height: pick<Height>(HEIGHTS, row.height, "one_story"),
          access: pick<Access>(ACCESS_TYPES, row.access, "ladder"),
          sides: (row.sides === 2 ? 2 : 1) as Sides,
          condition,
          method,
        }
      : {
          ...common,
          kind: "flat",
          unitPriceCents: Number(row.unit_price_cents ?? 0),
          unitCostCents: Number(row.unit_cost_cents ?? 0),
          laborHoursPerUnit: Number(row.labor_hours_per_unit ?? 0),
        };
  return {
    id: row.id,
    optionId: row.option_id,
    areaId: row.area_id,
    isOptional: row.is_optional,
    name: row.name,
    unit: pick<Unit>(UNITS, row.unit, "each"),
    workType: row.work_type,
    phase: row.work_order_phase
      ? pick<WorkOrderPhase>(WORK_ORDER_PHASES, row.work_order_phase, "paint")
      : null,
    catalogCode: row.catalog_code,
    isRepairAllowance: row.is_repair_allowance,
    customerNote: row.customer_note,
    sheen: row.sheen,
    sheenLabel: row.sheen ? (lookups.sheenLabels.get(row.sheen) ?? row.sheen) : null,
    productId: product?.id ?? null,
    productLabel: productLabel(product, lookups.brandLabels),
    brand: product?.brand ?? null,
    primerProductId: primer?.id ?? null,
    primerProductLabel: productLabel(primer, lookups.brandLabels),
    sortOrder: row.sort_order,
    input,
  };
}

export function toDiscount(type: string | null, value: number | string | null): Discount {
  if ((type !== "amount" && type !== "percent") || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Money is cents everywhere: an amount discount is stored in cents, a percent as a percent.
  return { type, value: type === "amount" ? Math.round(n) : n };
}

export function toVersionInput(input: {
  options: readonly OptionRow[];
  areas: readonly AreaRow[];
  lines: readonly LineRow[];
  discountType: string | null;
  discountValue: number | string | null;
  settings: PricingSettings;
  lookups: CatalogLookups;
}): VersionInput {
  return {
    options: input.options.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      isRecommended: o.is_recommended,
      sortOrder: o.sort_order,
    })),
    areas: input.areas.map((a) => ({
      id: a.id,
      optionId: a.option_id,
      name: a.name,
      workType: a.work_type,
      sortOrder: a.sort_order,
    })),
    lines: input.lines.map((l) => toVersionLine(l, input.lookups)),
    discount: toDiscount(input.discountType, input.discountValue),
    settings: input.settings,
  };
}

/** Engine result → the jsonb `store_version_pricing()` expects for one line. */
export function lineResultJson(id: string, line: VersionLine, p: PricedLine): Record<string, Json> {
  const snapshot: Record<string, Json> =
    line.input.kind === "production_rate"
      ? {
          rate: line.input.rate
            ? {
                unitsPerLaborHour: line.input.rate.unitsPerLaborHour,
                prepHoursPerUnit: line.input.rate.prepHoursPerUnit,
              }
            : null,
          product: line.input.product
            ? {
                id: line.input.product.id ?? null,
                coverageSqftPerGal: line.input.product.coverageSqftPerGal,
                costPerGalCents: line.input.product.costPerGalCents,
              }
            : null,
          effectiveCoats: p.effectiveCoats,
          effectivePrimer: p.effectivePrimer,
        }
      : {
          unitPriceCents: line.input.unitPriceCents,
          unitCostCents: line.input.unitCostCents,
        };
  return {
    id,
    laborHours: p.laborHours,
    prepHours: p.prepHours,
    gallons: p.gallons,
    primerGallons: p.primerGallons,
    gallonsNeeded: p.gallonsNeeded,
    primerGallonsNeeded: p.primerGallonsNeeded,
    containers: { ...p.containers, primer: { ...p.primerContainers } },
    laborCostCents: p.laborCostCents,
    materialCostCents: p.materialCostCents,
    sundriesCents: p.sundriesCents,
    costCents: p.costCents,
    computedPriceCents: p.computedPriceCents,
    priceCents: p.priceCents,
    snapshot,
    issues: p.issues.map((i) => ({ severity: i.severity, code: i.code, message: i.message })),
  };
}

/** Settings snapshot stored on the version (what the prices were based on). */
export function settingsJson(s: PricingSettings): Record<string, Json> {
  return JSON.parse(JSON.stringify(s)) as Record<string, Json>;
}
