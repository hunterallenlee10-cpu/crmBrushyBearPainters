import type { DiscountType } from "./constants";
import { marginPrice } from "./line";
import { round2 } from "./measure";

/**
 * Estimate-level math (SPEC §7.4, §10). Pure. Order of operations:
 *
 *   subtotal   = option lines + selected add-ons + RRP supplies (if lead-safe work)
 *   adjusted   = max(subtotal, minimum job charge)       (nothing to adjust when empty)
 *   discount   = amount, or % of adjusted                 (never more than adjusted)
 *   pre-tax    = adjusted − discount
 *   tax        = taxable share of pre-tax × tax rate      (rate 0 until confirmed)
 *   total      = pre-tax + tax
 *   deposit    = total × deposit %
 *
 * `quoteTotals` is the customer math (the proposal page runs it in the browser
 * from the sent snapshot); `summarizeOption` adds the internal numbers (cost,
 * hours, gallons, gross margin) for the builder's margin panel.
 */

export type QuoteLine = {
  id: string;
  priceCents: number;
  /** Price before overrides (used for the effective-discount check). */
  computedPriceCents: number;
  taxable: boolean;
  leadSafe: boolean;
};

export type Discount = { type: DiscountType; value: number } | null;

export type QuoteTerms = {
  minimumJobCents: number;
  discount: Discount;
  taxRatePercent: number;
  depositPercent: number;
  /** RRP supplies line, added once when any included line is lead-safe. */
  rrp: { priceCents: number; taxable: boolean };
};

export type QuoteTotals = {
  linesCents: number;
  addOnsCents: number;
  rrpCents: number;
  subtotalCents: number;
  minimumAdjustmentCents: number;
  adjustedCents: number;
  discountCents: number;
  preTaxCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  /** Same math on prices before overrides and discount. */
  computedAdjustedCents: number;
  /** How far below the computed price the customer pays, % (0 when not discounted). */
  effectiveDiscountPercent: number;
  hasLeadSafe: boolean;
};

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

export function discountCents(adjusted: number, discount: Discount): number {
  if (!discount || adjusted <= 0 || !Number.isFinite(discount.value) || discount.value <= 0)
    return 0;
  const raw =
    discount.type === "percent"
      ? Math.round((adjusted * Math.min(100, discount.value)) / 100)
      : Math.round(discount.value);
  return Math.min(adjusted, Math.max(0, raw));
}

export function quoteTotals(
  optionLines: readonly QuoteLine[],
  addOns: readonly QuoteLine[],
  terms: QuoteTerms,
): QuoteTotals {
  const included = [...optionLines, ...addOns];
  const hasLeadSafe = included.some((l) => l.leadSafe);
  const linesCents = sum(optionLines.map((l) => l.priceCents));
  const addOnsCents = sum(addOns.map((l) => l.priceCents));
  const rrpCents = hasLeadSafe ? Math.max(0, terms.rrp.priceCents) : 0;
  const subtotal = linesCents + addOnsCents + rrpCents;
  const minimumAdjustment =
    subtotal > 0 && subtotal < terms.minimumJobCents ? terms.minimumJobCents - subtotal : 0;
  const adjusted = Math.max(0, subtotal + minimumAdjustment);
  const discount = discountCents(adjusted, terms.discount);
  const preTax = adjusted - discount;

  const taxableLines =
    sum(included.filter((l) => l.taxable).map((l) => l.priceCents)) +
    (hasLeadSafe && terms.rrp.taxable ? rrpCents : 0);
  const taxableShare = subtotal > 0 ? Math.min(1, Math.max(0, taxableLines / subtotal)) : 0;
  const taxable = Math.round(preTax * taxableShare);
  const tax = Math.round((taxable * Math.max(0, terms.taxRatePercent)) / 100);
  const total = preTax + tax;
  const deposit = Math.round((Math.max(0, total) * Math.max(0, terms.depositPercent)) / 100);

  const computedSubtotal =
    sum(included.map((l) => l.computedPriceCents)) + (hasLeadSafe ? rrpCents : 0);
  const computedAdjusted =
    computedSubtotal > 0 && computedSubtotal < terms.minimumJobCents
      ? terms.minimumJobCents
      : Math.max(0, computedSubtotal);
  const effectiveDiscountPercent =
    computedAdjusted > 0 && preTax < computedAdjusted
      ? round2(((computedAdjusted - preTax) / computedAdjusted) * 100)
      : 0;

  return {
    linesCents,
    addOnsCents,
    rrpCents,
    subtotalCents: subtotal,
    minimumAdjustmentCents: minimumAdjustment,
    adjustedCents: adjusted,
    discountCents: discount,
    preTaxCents: preTax,
    taxableCents: taxable,
    taxCents: tax,
    totalCents: total,
    depositCents: deposit,
    computedAdjustedCents: computedAdjusted,
    effectiveDiscountPercent,
    hasLeadSafe,
  };
}

/** Builds the RRP supplies price from its cost and the margin target. */
export function rrpTerms(
  rrpCostCents: number,
  targetMarginPercent: number,
  taxable: boolean,
): QuoteTerms["rrp"] {
  return { priceCents: marginPrice(Math.max(0, rrpCostCents), targetMarginPercent), taxable };
}

// ---------------------------------------------------------------------------
// Internal summary (margin panel)
// ---------------------------------------------------------------------------

export type SummaryLine = QuoteLine & {
  costCents: number;
  laborHours: number;
  gallons: number;
  primerGallons: number;
  productId: string | null;
  productLabel: string | null;
  primerProductId: string | null;
  primerProductLabel: string | null;
};

export type OptionSummary = QuoteTotals & {
  costCents: number;
  grossProfitCents: number;
  /** (pre-tax − cost) / pre-tax, 0–1; null when nothing is priced. */
  grossMarginRatio: number | null;
  belowMarginFloor: boolean;
  laborHours: number;
  crewDays: number;
  gallonsByProduct: { productId: string | null; label: string; gallons: number }[];
};

export function summarizeOption(
  optionLines: readonly SummaryLine[],
  addOns: readonly SummaryLine[],
  terms: QuoteTerms,
  internal: {
    rrpCostCents: number;
    marginFloorPercent: number;
    crewSize: number;
    hoursPerCrewDay: number;
  },
): OptionSummary {
  const totals = quoteTotals(optionLines, addOns, terms);
  const included = [...optionLines, ...addOns];
  const cost =
    sum(included.map((l) => l.costCents)) + (totals.hasLeadSafe ? internal.rrpCostCents : 0);
  const profit = totals.preTaxCents - cost;
  const marginRatio =
    totals.preTaxCents > 0 ? Math.round((profit / totals.preTaxCents) * 10000) / 10000 : null;
  const laborHours = round2(sum(included.map((l) => l.laborHours)));
  const perDay = Math.max(1, internal.crewSize) * Math.max(1, internal.hoursPerCrewDay);

  const byProduct = new Map<string, { productId: string | null; label: string; gallons: number }>();
  const add = (id: string | null, label: string | null, gallons: number) => {
    if (gallons <= 0) return;
    const key = id ?? `label:${label ?? "Unspecified"}`;
    const row = byProduct.get(key) ?? { productId: id, label: label ?? "Unspecified", gallons: 0 };
    row.gallons = round2(row.gallons + gallons);
    byProduct.set(key, row);
  };
  for (const l of included) {
    add(l.productId, l.productLabel, l.gallons);
    add(l.primerProductId ?? l.productId, l.primerProductLabel ?? l.productLabel, l.primerGallons);
  }

  return {
    ...totals,
    costCents: cost,
    grossProfitCents: profit,
    grossMarginRatio: marginRatio,
    belowMarginFloor: marginRatio !== null && marginRatio * 100 < internal.marginFloorPercent,
    laborHours,
    crewDays: round2(laborHours / perDay),
    gallonsByProduct: [...byProduct.values()].sort((a, b) => b.gallons - a.gallons),
  };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/**
 * Whether sending needs an owner's approval: the effective discount (overrides
 * plus the discount, as % of the computed price) is over the person's limit and
 * over whatever an owner already approved for this version.
 */
export function needsDiscountApproval(
  effectiveDiscountPercent: number,
  limitPercent: number,
  approvedPercent: number | null,
): boolean {
  const allowed = Math.max(limitPercent, approvedPercent ?? Number.NEGATIVE_INFINITY);
  return effectiveDiscountPercent > allowed + 0.005;
}

/** The largest effective discount across the options (approval covers every option). */
export function maxEffectiveDiscount(
  options: readonly Pick<QuoteTotals, "effectiveDiscountPercent">[],
): number {
  return options.reduce((m, o) => Math.max(m, o.effectiveDiscountPercent), 0);
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

/** Expiry instant: sent time + N days. */
export function expiresAt(sentAt: Date, expiryDays: number): Date {
  return new Date(sentAt.getTime() + Math.max(1, expiryDays) * 24 * 3_600_000);
}

export function isExpired(expires: string | Date | null, now: Date): boolean {
  if (!expires) return false;
  return new Date(expires).getTime() <= now.getTime();
}

/** Whole days left before expiry (0 within the last day; negative once expired). */
export function daysUntil(expires: string | Date, now: Date): number {
  return Math.floor((new Date(expires).getTime() - now.getTime()) / (24 * 3_600_000));
}
