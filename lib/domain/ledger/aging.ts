import type { InvoiceLedger } from "./ledger";

/**
 * A/R aging (SPEC §10): Current, 1–30, 31–60, 61–90, 90+ days past due.
 * Only sent invoices are receivables; drafts and void invoices never age.
 * Credit memos (negative balances) sit in Current and net against what's owed.
 */

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "d1_30";
  if (daysPastDue <= 60) return "d31_60";
  if (daysPastDue <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingRow = { bucket: AgingBucket; label: string; cents: number; count: number };

export function arAging(
  invoices: readonly Pick<InvoiceLedger, "issued" | "status" | "balanceCents" | "daysPastDue">[],
): { rows: AgingRow[]; totalCents: number } {
  const acc = new Map<AgingBucket, { cents: number; count: number }>(
    AGING_BUCKETS.map((b) => [b, { cents: 0, count: 0 }]),
  );
  let total = 0;
  for (const inv of invoices) {
    if (!inv.issued || inv.status === "void" || inv.balanceCents === 0) continue;
    const b = agingBucket(inv.daysPastDue);
    const row = acc.get(b);
    if (!row) continue;
    row.cents += inv.balanceCents;
    row.count += 1;
    total += inv.balanceCents;
  }
  return {
    rows: AGING_BUCKETS.map((b) => ({
      bucket: b,
      label: AGING_LABELS[b],
      cents: acc.get(b)?.cents ?? 0,
      count: acc.get(b)?.count ?? 0,
    })),
    totalCents: total,
  };
}
