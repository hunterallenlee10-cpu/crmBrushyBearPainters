import { daysBetween } from "@/lib/domain/scheduling/dates";
import {
  creditCounts,
  isLivePayment,
  type InvoiceStatus,
  type IsoDay,
  type LedgerApplication,
  type LedgerCredit,
  type LedgerInvoice,
  type LedgerPayment,
  type LedgerRefund,
} from "./types";

/**
 * The job ledger (SPEC §10), pure. Every figure is derived from the records,
 * never stored:
 *
 *   Contract     = accepted estimate + signed change orders − approved credits
 *   Billed       = Σ non-void invoices (drafts included, SPEC §10 wording)
 *   Left to bill = Contract − Billed
 *   Collected    = Σ applications of live (received or cleared) payments
 *   Balance      = Billed − Collected
 *   Due          = the overdue part of the balance (sent invoices past due)
 *
 * Unapplied cash (live payment money not applied to any invoice) is reported
 * separately and never counted as collected. The database computes the same
 * numbers in `public.job_ledger` (supabase/migrations/20261028000100_money.sql);
 * tests on both sides use the same scenario.
 */

export type InvoiceLedger = LedgerInvoice & {
  collectedCents: number;
  balanceCents: number;
  /** Days past the due date (0 when not due yet, not sent, or settled). */
  daysPastDue: number;
  /** The status the invoice should have right now. */
  displayStatus: InvoiceStatus;
  /** Sent (or paid) to the customer: counts for A/R and aging. */
  issued: boolean;
};

export type PaymentLedger = LedgerPayment & {
  refundedCents: number;
  appliedCents: number;
  /** Live payment money not on any invoice (0 for bounced/void/refunded). */
  unappliedCents: number;
  /** What the payment can still cover: amount − refunds (0 when not live). */
  availableCents: number;
};

export type JobLedger = {
  contractBaseCents: number;
  creditsCents: number;
  pendingCreditsCents: number;
  contractCents: number;
  billedCents: number;
  leftToBillCents: number;
  collectedCents: number;
  balanceCents: number;
  dueCents: number;
  unappliedCents: number;
  refundedCents: number;
  /** Live payments not yet marked cleared. */
  unclearedCents: number;
  invoices: InvoiceLedger[];
  payments: PaymentLedger[];
};

export type JobLedgerInput = {
  /** job_financials.contract_cents (accepted estimate + signed COs, or the baseline); null when not set. */
  contractBaseCents: number | null;
  invoices: readonly LedgerInvoice[];
  payments: readonly LedgerPayment[];
  applications: readonly LedgerApplication[];
  refunds: readonly LedgerRefund[];
  credits: readonly LedgerCredit[];
  /** Today in Pacific time. */
  today: IsoDay;
};

function sum(values: readonly number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** The invoice was sent to the customer (anything but a draft or void). */
export function isIssued(inv: Pick<LedgerInvoice, "status" | "sentAt">): boolean {
  return inv.status !== "void" && (inv.status !== "draft" || inv.sentAt !== null);
}

/** Days past due for a sent invoice with money still owed (0 otherwise). */
export function daysPastDue(
  inv: Pick<LedgerInvoice, "status" | "sentAt" | "dueDate">,
  balanceCents: number,
  today: IsoDay,
): number {
  if (!isIssued(inv) || balanceCents <= 0 || !inv.dueDate) return 0;
  return Math.max(0, daysBetween(inv.dueDate, today));
}

/**
 * The status an invoice should show: void and draft come from its lifecycle;
 * paid / partly paid from the money applied; overdue once a sent invoice is
 * past its due date with a balance; otherwise viewed or sent.
 * A draft deposit paid at signing reads "Paid" (the money is in).
 */
export function invoiceDisplayStatus(
  inv: Pick<LedgerInvoice, "status" | "sentAt" | "viewedAt" | "dueDate" | "totalCents">,
  collectedCents: number,
  today: IsoDay,
): InvoiceStatus {
  if (inv.status === "void") return "void";
  const balance = inv.totalCents - collectedCents;
  if (inv.totalCents > 0 && balance <= 0) return "paid";
  const issued = isIssued(inv);
  if (!issued) return "draft";
  if (inv.totalCents <= 0) return "sent";
  if (daysPastDue(inv, balance, today) > 0) return "overdue";
  if (collectedCents > 0) return "partially_paid";
  return inv.viewedAt ? "viewed" : "sent";
}

/** Money a payment can still cover: its amount less refunds, or 0 when it doesn't count. */
export function paymentAvailableCents(p: LedgerPayment, refundedCents: number): number {
  if (!isLivePayment(p.status)) return 0;
  return Math.max(0, p.amountCents - refundedCents);
}

export function computeJobLedger(input: JobLedgerInput): JobLedger {
  const paymentsById = new Map(input.payments.map((p) => [p.id, p]));
  const refundedBy = new Map<string, number>();
  for (const r of input.refunds) {
    refundedBy.set(r.paymentId, (refundedBy.get(r.paymentId) ?? 0) + r.amountCents);
  }
  const liveApplications = input.applications.filter((a) => {
    const p = paymentsById.get(a.paymentId);
    return p !== undefined && isLivePayment(p.status);
  });
  const collectedBy = new Map<string, number>();
  const appliedBy = new Map<string, number>();
  for (const a of liveApplications) {
    collectedBy.set(a.invoiceId, (collectedBy.get(a.invoiceId) ?? 0) + a.amountCents);
    appliedBy.set(a.paymentId, (appliedBy.get(a.paymentId) ?? 0) + a.amountCents);
  }

  const invoices: InvoiceLedger[] = input.invoices.map((inv) => {
    const collected = inv.status === "void" ? 0 : (collectedBy.get(inv.id) ?? 0);
    const balance = inv.status === "void" ? 0 : inv.totalCents - collected;
    return {
      ...inv,
      collectedCents: collected,
      balanceCents: balance,
      daysPastDue: daysPastDue(inv, balance, input.today),
      displayStatus: invoiceDisplayStatus(inv, collected, input.today),
      issued: isIssued(inv),
    };
  });

  const payments: PaymentLedger[] = input.payments.map((p) => {
    const refunded = refundedBy.get(p.id) ?? 0;
    const available = paymentAvailableCents(p, refunded);
    const applied = isLivePayment(p.status) ? (appliedBy.get(p.id) ?? 0) : 0;
    return {
      ...p,
      refundedCents: refunded,
      appliedCents: applied,
      availableCents: available,
      unappliedCents: Math.max(0, available - applied),
    };
  });

  const live = invoices.filter((i) => i.status !== "void");
  const base = input.contractBaseCents ?? 0;
  const creditsCents = sum(
    input.credits.filter((c) => creditCounts(c.status)).map((c) => c.amountCents),
  );
  const pendingCreditsCents = sum(
    input.credits.filter((c) => c.status === "pending_approval").map((c) => c.amountCents),
  );
  const contractCents = base - creditsCents;
  const billedCents = sum(live.map((i) => i.totalCents));
  const collectedCents = sum(live.map((i) => i.collectedCents));
  const balanceCents = billedCents - collectedCents;
  const overdue = sum(live.filter((i) => i.daysPastDue > 0).map((i) => i.balanceCents));
  return {
    contractBaseCents: base,
    creditsCents,
    pendingCreditsCents,
    contractCents,
    billedCents,
    leftToBillCents: contractCents - billedCents,
    collectedCents,
    balanceCents,
    dueCents: Math.max(0, Math.min(overdue, balanceCents)),
    unappliedCents: sum(payments.map((p) => p.unappliedCents)),
    refundedCents: sum(payments.map((p) => p.refundedCents)),
    unclearedCents: sum(
      payments.filter((p) => p.status === "received").map((p) => p.availableCents),
    ),
    invoices,
    payments,
  };
}

/** Paid in full: something was billed, nothing is left to bill, and the balance is $0. */
export function isPaidInFull(
  l: Pick<JobLedger, "billedCents" | "leftToBillCents" | "balanceCents">,
): boolean {
  return l.billedCents > 0 && l.leftToBillCents === 0 && l.balanceCents === 0;
}

/** Collected ÷ contract, 0–1 (null with no contract). Used for "% collected". */
export function collectedShare(l: Pick<JobLedger, "collectedCents" | "contractCents">) {
  if (l.contractCents <= 0) return null;
  return Math.min(1, Math.max(0, l.collectedCents / l.contractCents));
}
