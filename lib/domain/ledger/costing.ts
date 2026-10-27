import { formatCents } from "@/lib/format/money";

/**
 * Job costing and gross margin (SPEC §5.6 job_costs): labor (hours × each
 * person's hourly cost), materials (paint orders), subcontractor POs (work
 * orders) and other expenses (receipts) → gross profit and margin %. Owners
 * and the bookkeeper only. Pure.
 */

export type LaborRow = {
  userId: string | null;
  name: string;
  hours: number;
  /** Hourly cost in cents; null when none is set for the person (or a named helper). */
  rateCents: number | null;
};

export type CostRow = { label: string; cents: number };

export type JobCostingInput = {
  /** Revenue: the contract net of credits. */
  revenueCents: number;
  labor: readonly LaborRow[];
  materials: readonly CostRow[];
  subcontractors: readonly CostRow[];
  expenses: readonly CostRow[];
  /** Budgeted hours from work orders (for estimated vs actual). */
  budgetedHours?: number;
};

export type LaborLine = LaborRow & { costCents: number | null };

export type JobCosting = {
  revenueCents: number;
  labor: LaborLine[];
  laborHours: number;
  laborCents: number;
  /** Hours with no hourly cost (not in the labor cost; flagged). */
  unpricedHours: number;
  materialsCents: number;
  subcontractorCents: number;
  expensesCents: number;
  totalCostCents: number;
  grossProfitCents: number;
  /** Gross profit ÷ revenue (0–1 or negative); null without revenue. */
  marginPct: number | null;
  budgetedHours: number | null;
  warnings: string[];
};

const roundHours = (h: number) => Math.round(h * 100) / 100;

export function laborCost(hours: number, rateCents: number): number {
  return Math.round(hours * rateCents);
}

export function computeJobCosting(input: JobCostingInput): JobCosting {
  // One line per person (hours from several daily logs add up).
  const byPerson = new Map<string, LaborRow>();
  for (const row of input.labor) {
    const key = row.userId ?? `name:${row.name.trim().toLowerCase()}`;
    const prev = byPerson.get(key);
    byPerson.set(key, prev ? { ...prev, hours: prev.hours + row.hours } : { ...row });
  }
  const labor: LaborLine[] = [...byPerson.values()]
    .map((r) => ({
      ...r,
      hours: roundHours(r.hours),
      costCents: r.rateCents === null ? null : laborCost(r.hours, r.rateCents),
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
  const laborCents = labor.reduce((s, l) => s + (l.costCents ?? 0), 0);
  const laborHours = roundHours(labor.reduce((s, l) => s + l.hours, 0));
  const unpricedHours = roundHours(
    labor.filter((l) => l.costCents === null).reduce((s, l) => s + l.hours, 0),
  );
  const add = (rows: readonly CostRow[]) => rows.reduce((s, r) => s + r.cents, 0);
  const materialsCents = add(input.materials);
  const subcontractorCents = add(input.subcontractors);
  const expensesCents = add(input.expenses);
  const totalCostCents = laborCents + materialsCents + subcontractorCents + expensesCents;
  const grossProfitCents = input.revenueCents - totalCostCents;
  const warnings: string[] = [];
  if (unpricedHours > 0) {
    const who = labor
      .filter((l) => l.costCents === null)
      .map((l) => l.name)
      .join(", ");
    warnings.push(
      `${unpricedHours} hours have no hourly cost (${who}), so labor is understated. Set labor cost in Admin → Users.`,
    );
  }
  if (input.revenueCents <= 0) {
    warnings.push("There's no contract amount yet, so margin can't be worked out.");
  }
  if (grossProfitCents < 0 && input.revenueCents > 0) {
    warnings.push(`Costs are ${formatCents(-grossProfitCents)} more than the contract.`);
  }
  return {
    revenueCents: input.revenueCents,
    labor,
    laborHours,
    laborCents,
    unpricedHours,
    materialsCents,
    subcontractorCents,
    expensesCents,
    totalCostCents,
    grossProfitCents,
    marginPct: input.revenueCents > 0 ? grossProfitCents / input.revenueCents : null,
    budgetedHours: input.budgetedHours ?? null,
    warnings,
  };
}

/** Margin across many jobs (Σ profit ÷ Σ revenue), null without revenue. */
export function blendedMargin(rows: readonly { revenueCents: number; costCents: number }[]) {
  const revenue = rows.reduce((s, r) => s + r.revenueCents, 0);
  const cost = rows.reduce((s, r) => s + r.costCents, 0);
  return revenue > 0 ? (revenue - cost) / revenue : null;
}
