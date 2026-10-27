import type { Unit, WorkOrderPhase } from "./constants";
import { describeLine } from "./outputs";
import { lineIsValid, priceLine, type LineInput, type LineIssue, type PricedLine } from "./line";
import {
  maxEffectiveDiscount,
  quoteTotals,
  rrpTerms,
  summarizeOption,
  type Discount,
  type OptionSummary,
  type QuoteLine,
  type QuoteTerms,
  type QuoteTotals,
  type SummaryLine,
} from "./quote";
import type { PricingSettings } from "./settings";

/**
 * Prices a whole estimate version (options → areas → lines, plus optional
 * add-ons) and builds the customer-facing snapshot the proposal page shows.
 * Pure: the server maps database rows to these inputs and stores the results.
 */

export type VersionOption = {
  id: string;
  name: string;
  description: string | null;
  isRecommended: boolean;
  sortOrder: number;
};

export type VersionArea = {
  id: string;
  optionId: string;
  name: string;
  workType: string | null;
  sortOrder: number;
};

export type VersionLine = {
  id: string;
  /** null for an add-on (offered on every option). */
  optionId: string | null;
  areaId: string | null;
  /** Add-ons the customer can toggle on the proposal. */
  isOptional: boolean;
  name: string;
  unit: Unit;
  workType: string | null;
  phase: WorkOrderPhase | null;
  catalogCode: string | null;
  isRepairAllowance: boolean;
  customerNote: string | null;
  sheen: string | null;
  sheenLabel: string | null;
  productId: string | null;
  productLabel: string | null;
  brand: string | null;
  primerProductId: string | null;
  primerProductLabel: string | null;
  sortOrder: number;
  input: LineInput;
};

export type VersionInput = {
  options: readonly VersionOption[];
  areas: readonly VersionArea[];
  lines: readonly VersionLine[];
  discount: Discount;
  settings: PricingSettings;
};

export type LineWithPrice = { line: VersionLine; priced: PricedLine };

export type PricedOption = {
  option: VersionOption;
  /** The option alone (no add-ons). */
  summary: OptionSummary;
  /** The option with every add-on (the highest it can go). */
  withAllAddOns: OptionSummary;
};

export type VersionIssue = LineIssue & { lineId: string | null };

export type PricedVersion = {
  lines: LineWithPrice[];
  options: PricedOption[];
  addOns: LineWithPrice[];
  terms: QuoteTerms;
  maxEffectiveDiscountPercent: number;
  issues: VersionIssue[];
  /** No errors and at least one option with something in it. */
  sendable: boolean;
};

function toQuoteLine(l: LineWithPrice): QuoteLine {
  return {
    id: l.line.id,
    priceCents: l.priced.priceCents,
    computedPriceCents: l.priced.computedPriceCents,
    taxable: l.line.input.taxable,
    leadSafe: l.line.input.leadSafe === true,
  };
}

function toSummaryLine(l: LineWithPrice): SummaryLine {
  return {
    ...toQuoteLine(l),
    costCents: l.priced.costCents,
    laborHours: l.priced.laborHours,
    gallons: l.priced.gallons,
    primerGallons: l.priced.primerGallons,
    productId: l.line.productId,
    productLabel: l.line.productLabel,
    primerProductId: l.line.primerProductId,
    primerProductLabel: l.line.primerProductLabel,
  };
}

export function termsFor(settings: PricingSettings, discount: Discount): QuoteTerms {
  return {
    minimumJobCents: settings.minimumJobCents,
    discount,
    taxRatePercent: settings.tax.ratePercent,
    depositPercent: settings.depositPercent,
    rrp: rrpTerms(
      settings.rrpSuppliesCostCents,
      settings.targetMarginPercent,
      settings.tax.defaultTaxable,
    ),
  };
}

export function priceVersion(v: VersionInput): PricedVersion {
  const sorted = [...v.lines].sort((a, b) => a.sortOrder - b.sortOrder);
  const lines: LineWithPrice[] = sorted.map((line) => ({
    line,
    priced: priceLine(line.input, v.settings),
  }));
  const addOns = lines.filter((l) => l.line.optionId === null);
  const terms = termsFor(v.settings, v.discount);
  const internal = {
    rrpCostCents: v.settings.rrpSuppliesCostCents,
    marginFloorPercent: v.settings.marginFloorPercent,
    crewSize: v.settings.crewSize,
    hoursPerCrewDay: v.settings.hoursPerCrewDay,
  };
  const options = [...v.options]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((option): PricedOption => {
      const mine = lines.filter((l) => l.line.optionId === option.id).map(toSummaryLine);
      const extras = addOns.map(toSummaryLine);
      return {
        option,
        summary: summarizeOption(mine, [], terms, internal),
        withAllAddOns: summarizeOption(mine, extras, terms, internal),
      };
    });

  const issues: VersionIssue[] = lines.flatMap((l) =>
    l.priced.issues.map((i) => ({ ...i, lineId: l.line.id })),
  );
  const optionIds = new Set(v.options.map((o) => o.id));
  for (const l of v.lines) {
    if (l.optionId !== null && !optionIds.has(l.optionId)) {
      issues.push({
        severity: "error",
        code: "orphan_line",
        message: `“${l.name}” belongs to an option that no longer exists.`,
        lineId: l.id,
      });
    }
  }
  if (v.options.length === 0) {
    issues.push({
      severity: "error",
      code: "no_options",
      message: "Add at least one option.",
      lineId: null,
    });
  }
  const filled = options.some((o) => o.summary.subtotalCents > 0);
  if (v.options.length > 0 && !filled) {
    issues.push({
      severity: "error",
      code: "empty",
      message: "Add priced lines to at least one option.",
      lineId: null,
    });
  }

  return {
    lines,
    options,
    addOns,
    terms,
    maxEffectiveDiscountPercent: maxEffectiveDiscount(
      options.flatMap((o) => [o.summary, o.withAllAddOns]),
    ),
    issues,
    sendable:
      lines.every((l) => lineIsValid(l.priced)) && issues.every((i) => i.severity !== "error"),
  };
}

// ---------------------------------------------------------------------------
// Customer-facing snapshot (stored on the version when it's sent)
// ---------------------------------------------------------------------------

export type ProposalLine = QuoteLine & { description: string };

export type ProposalArea = { name: string; workType: string | null; lines: ProposalLine[] };

export type ProposalOption = {
  id: string;
  name: string;
  description: string | null;
  isRecommended: boolean;
  areas: ProposalArea[];
  lines: ProposalLine[];
  totals: QuoteTotals;
};

export type ProposalAddOn = ProposalLine & {
  name: string;
  isRepairAllowance: boolean;
  catalogCode: string | null;
};

export type ProposalSnapshot = {
  version: 1;
  options: ProposalOption[];
  addOns: ProposalAddOn[];
  terms: QuoteTerms;
  workTypes: string[];
  leadSafe: boolean;
};

function describe(l: LineWithPrice): string {
  const input = l.line.input;
  return describeLine({
    name: l.line.name,
    quantity: input.quantity,
    unit: l.line.unit,
    kind: input.kind,
    ...(input.kind === "production_rate"
      ? {
          coats: l.priced.effectiveCoats,
          primer: l.priced.effectivePrimer,
          sides: input.sides ?? 1,
        }
      : {}),
    sheenLabel: l.line.sheenLabel,
    note: l.line.customerNote,
  });
}

function proposalLine(l: LineWithPrice): ProposalLine {
  return { ...toQuoteLine(l), description: describe(l) };
}

export function buildProposalSnapshot(v: VersionInput, priced: PricedVersion): ProposalSnapshot {
  const areas = [...v.areas].sort((a, b) => a.sortOrder - b.sortOrder);
  const workTypes = new Set<string>();
  for (const a of areas) if (a.workType) workTypes.add(a.workType);
  for (const l of v.lines) if (l.workType) workTypes.add(l.workType);

  const options = priced.options.map(({ option, summary }): ProposalOption => {
    const mine = priced.lines.filter((l) => l.line.optionId === option.id);
    const byArea: ProposalArea[] = areas
      .filter((a) => a.optionId === option.id)
      .map((a) => ({
        name: a.name,
        workType: a.workType,
        lines: mine.filter((l) => l.line.areaId === a.id).map(proposalLine),
      }))
      .filter((a) => a.lines.length > 0);
    const known = new Set(areas.filter((a) => a.optionId === option.id).map((a) => a.id));
    const loose = mine.filter((l) => !l.line.areaId || !known.has(l.line.areaId));
    if (loose.length)
      byArea.push({ name: "General", workType: null, lines: loose.map(proposalLine) });
    const {
      costCents: _c,
      grossProfitCents: _g,
      grossMarginRatio: _m,
      belowMarginFloor: _b,
      laborHours: _h,
      crewDays: _d,
      gallonsByProduct: _p,
      ...totals
    } = summary;
    return {
      id: option.id,
      name: option.name,
      description: option.description,
      isRecommended: option.isRecommended,
      areas: byArea,
      lines: mine.map(proposalLine),
      totals,
    };
  });
  const addOns: ProposalAddOn[] = priced.addOns.map((l) => ({
    ...proposalLine(l),
    name: l.line.name,
    isRepairAllowance: l.line.isRepairAllowance,
    catalogCode: l.line.catalogCode,
  }));
  return {
    version: 1,
    options,
    addOns,
    terms: priced.terms,
    workTypes: [...workTypes],
    leadSafe: priced.lines.some((l) => l.line.input.leadSafe === true),
  };
}

export type QuoteSelection = { optionId: string; addOnIds: readonly string[] };

/** Totals for what the customer picked, from the snapshot (browser and server agree). */
export function quoteSelection(
  snapshot: ProposalSnapshot,
  selection: QuoteSelection,
): { option: ProposalOption; addOns: ProposalAddOn[]; totals: QuoteTotals } | null {
  const option = snapshot.options.find((o) => o.id === selection.optionId);
  if (!option) return null;
  const wanted = new Set(selection.addOnIds);
  const addOns = snapshot.addOns.filter((a) => wanted.has(a.id));
  if (addOns.length !== wanted.size) return null;
  return { option, addOns, totals: quoteTotals(option.lines, addOns, snapshot.terms) };
}

// ---------------------------------------------------------------------------
// Change orders (SPEC §7.7): same line engine, no minimum, discount or deposit;
// credits (removed scope) count negative, so the total can be below zero.
// ---------------------------------------------------------------------------

export type ChangeOrderInput = {
  id: string;
  title: string;
  reason: string | null;
  lines: readonly VersionLine[];
  settings: PricingSettings;
};

export type PricedChangeOrder = {
  lines: LineWithPrice[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  costCents: number;
  laborHours: number;
  issues: VersionIssue[];
  sendable: boolean;
};

export function priceChangeOrder(co: ChangeOrderInput): PricedChangeOrder {
  const lines = [...co.lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((line) => ({ line, priced: priceLine(line.input, co.settings) }));
  const subtotal = lines.reduce((s, l) => s + l.priced.priceCents, 0);
  const taxable = lines
    .filter((l) => l.line.input.taxable)
    .reduce((s, l) => s + l.priced.priceCents, 0);
  const tax = Math.round((taxable * Math.max(0, co.settings.tax.ratePercent)) / 100);
  const issues: VersionIssue[] = lines.flatMap((l) =>
    l.priced.issues.map((i) => ({ ...i, lineId: l.line.id })),
  );
  if (lines.length === 0) {
    issues.push({
      severity: "error",
      code: "empty",
      message: "Add at least one line.",
      lineId: null,
    });
  }
  return {
    lines,
    subtotalCents: subtotal,
    taxCents: tax,
    totalCents: subtotal + tax,
    costCents: lines.reduce((s, l) => s + l.priced.costCents, 0),
    laborHours: Math.round(lines.reduce((s, l) => s + l.priced.laborHours, 0) * 100) / 100,
    issues,
    sendable: issues.every((i) => i.severity !== "error"),
  };
}

/** Customer snapshot for a change order, in the proposal shape (one "option"). */
export function buildChangeOrderSnapshot(
  co: ChangeOrderInput,
  priced: PricedChangeOrder,
  contract: { beforeCents: number | null },
): ProposalSnapshot & { changeOrder: { beforeCents: number | null; afterCents: number | null } } {
  const lines = priced.lines.map(proposalLine);
  const totals: QuoteTotals = {
    linesCents: priced.subtotalCents,
    addOnsCents: 0,
    rrpCents: 0,
    subtotalCents: priced.subtotalCents,
    minimumAdjustmentCents: 0,
    adjustedCents: priced.subtotalCents,
    discountCents: 0,
    preTaxCents: priced.subtotalCents,
    taxableCents: priced.lines
      .filter((l) => l.line.input.taxable)
      .reduce((s, l) => s + l.priced.priceCents, 0),
    taxCents: priced.taxCents,
    totalCents: priced.totalCents,
    depositCents: 0,
    computedAdjustedCents: priced.subtotalCents,
    effectiveDiscountPercent: 0,
    hasLeadSafe: priced.lines.some((l) => l.line.input.leadSafe === true),
  };
  const workTypes = [...new Set(co.lines.map((l) => l.workType).filter((w): w is string => !!w))];
  return {
    version: 1,
    options: [
      {
        id: co.id,
        name: co.title,
        description: co.reason,
        isRecommended: true,
        areas: [{ name: "Changes", workType: null, lines }],
        lines,
        totals,
      },
    ],
    addOns: [],
    terms: {
      minimumJobCents: 0,
      discount: null,
      taxRatePercent: co.settings.tax.ratePercent,
      depositPercent: 0,
      rrp: { priceCents: 0, taxable: false },
    },
    workTypes,
    leadSafe: totals.hasLeadSafe,
    changeOrder: {
      beforeCents: contract.beforeCents,
      afterCents: contract.beforeCents === null ? null : contract.beforeCents + priced.totalCents,
    },
  };
}
