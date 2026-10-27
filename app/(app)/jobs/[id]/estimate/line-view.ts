import type { LineRow } from "@/lib/estimating/map";
import { describeLine, type LineWithPrice, type Unit } from "@/lib/estimating/engine";
import type { BuilderIssue, BuilderLine } from "./types";

/** Issues stored with a priced line (JSON) back to display issues. */
export function issuesOf(raw: unknown): BuilderIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((i) => {
    if (!i || typeof i !== "object") return [];
    const o = i as Record<string, unknown>;
    if (typeof o.message !== "string") return [];
    return [{ severity: o.severity === "error" ? "error" : "warning", message: o.message }];
  });
}

/**
 * A stored line as the builder shows it: `f` is today's engine result for a
 * draft (live prices); without it the stored (frozen) numbers are used.
 */
export function toBuilderLine(
  r: LineRow,
  f: LineWithPrice | undefined,
  sheenLabels: ReadonlyMap<string, string>,
): BuilderLine {
  const unit = (f?.line.unit ?? r.unit) as Unit;
  const live = f;
  return {
    id: r.id,
    optionId: r.option_id,
    areaId: r.area_id,
    isOptional: r.is_optional,
    kind: r.kind === "flat" ? "flat" : "production_rate",
    name: r.name,
    unit,
    surface: r.surface,
    catalogCode: r.catalog_code,
    quantity: Number(r.quantity),
    sides: r.sides,
    condition: r.condition,
    prepLevel: r.prep_level,
    coats: r.coats,
    primer: r.primer,
    colorChange: r.color_change,
    method: r.method,
    access: r.access,
    height: r.height,
    sheen: r.sheen,
    productId: r.paint_product_id,
    primerProductId: r.primer_product_id,
    leadSafe: r.lead_safe,
    taxable: r.taxable,
    isRepairAllowance: r.is_repair_allowance,
    unitPriceCents: r.unit_price_cents,
    unitCostCents: r.unit_cost_cents,
    overridePriceCents: r.override_price_cents,
    overrideReason: r.override_reason,
    customerNote: r.customer_note,
    laborHours: live ? f.priced.laborHours : r.labor_hours === null ? null : Number(r.labor_hours),
    gallons: live ? f.priced.gallons : r.gallons === null ? null : Number(r.gallons),
    primerGallons: live
      ? f.priced.primerGallons
      : r.primer_gallons === null
        ? null
        : Number(r.primer_gallons),
    costCents: live ? f.priced.costCents : r.cost_cents,
    computedPriceCents: live ? f.priced.computedPriceCents : r.computed_price_cents,
    priceCents: live ? f.priced.priceCents : r.price_cents,
    description: describeLine({
      name: r.name,
      quantity: Number(r.quantity),
      unit,
      kind: r.kind === "flat" ? "flat" : "production_rate",
      coats: r.coats,
      primer: r.primer === "spot" || r.primer === "full" ? r.primer : "none",
      sides: r.sides,
      sheenLabel: r.sheen ? (sheenLabels.get(r.sheen) ?? r.sheen) : null,
    }),
    issues: live
      ? f.priced.issues.map((i) => ({ severity: i.severity, message: i.message }))
      : issuesOf(r.issues),
  };
}
