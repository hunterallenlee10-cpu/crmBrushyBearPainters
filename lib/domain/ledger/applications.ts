import { formatCents } from "@/lib/format/money";
import type { InvoiceLedger, PaymentLedger } from "./ledger";
import type { LedgerApplication } from "./types";

/**
 * Applying payments to invoices (SPEC §10: "Payments must be applied to
 * invoices; unapplied cash is shown as a warning, never silently counted").
 * Pure checks shared by the Record payment form, the server actions and the
 * property tests; the database enforces the same limits in triggers.
 */

/** Invoices a payment can go to: not void, a positive total, money still owed. Oldest first. */
export function openInvoices(invoices: readonly InvoiceLedger[]): InvoiceLedger[] {
  return invoices
    .filter((i) => i.status !== "void" && i.totalCents > 0 && i.balanceCents > 0)
    .sort((a, b) => {
      const ka = a.dueDate ?? a.issueDate ?? a.createdAt ?? "";
      const kb = b.dueDate ?? b.issueDate ?? b.createdAt ?? "";
      return ka === kb ? a.number.localeCompare(b.number) : ka.localeCompare(kb);
    });
}

export type Allocation = { invoiceId: string; amountCents: number };

/**
 * Default split of a payment: the chosen invoice first (when given), then the
 * oldest open invoices. Whatever is left over stays unapplied (overpayment).
 */
export function suggestAllocation(
  amountCents: number,
  invoices: readonly InvoiceLedger[],
  preferInvoiceId?: string | null,
): { allocations: Allocation[]; leftoverCents: number } {
  const open = openInvoices(invoices);
  const ordered = preferInvoiceId
    ? [
        ...open.filter((i) => i.id === preferInvoiceId),
        ...open.filter((i) => i.id !== preferInvoiceId),
      ]
    : open;
  let left = Math.max(0, Math.trunc(amountCents));
  const allocations: Allocation[] = [];
  for (const inv of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balanceCents);
    if (take > 0) {
      allocations.push({ invoiceId: inv.id, amountCents: take });
      left -= take;
    }
  }
  return { allocations, leftoverCents: left };
}

export type ApplicationProblem = { invoiceId: string | null; message: string };

/**
 * Checks a payment's new applications. `next` is the full set this payment
 * should have (amount per invoice; missing invoices go to $0). Limits:
 * - whole cents, not negative;
 * - only live invoices with a positive total;
 * - an invoice never takes more than its total across every live payment;
 * - the payment never gives more than its amount less refunds.
 */
export function checkApplications(input: {
  payment: Pick<PaymentLedger, "id" | "number" | "availableCents" | "status">;
  invoices: readonly InvoiceLedger[];
  /** Every live application on the job (all payments). */
  applications: readonly LedgerApplication[];
  next: readonly Allocation[];
}): ApplicationProblem[] {
  const problems: ApplicationProblem[] = [];
  const { payment } = input;
  if (payment.status !== "received" && payment.status !== "cleared") {
    return [
      {
        invoiceId: null,
        message: `${payment.number} is ${payment.status}, so it can't be applied to an invoice.`,
      },
    ];
  }
  const seen = new Set<string>();
  let total = 0;
  for (const a of input.next) {
    if (seen.has(a.invoiceId)) {
      problems.push({ invoiceId: a.invoiceId, message: "Each invoice appears once." });
      continue;
    }
    seen.add(a.invoiceId);
    if (!Number.isInteger(a.amountCents) || a.amountCents < 0) {
      problems.push({ invoiceId: a.invoiceId, message: "Enter an amount of $0 or more." });
      continue;
    }
    total += a.amountCents;
    if (a.amountCents === 0) continue;
    const inv = input.invoices.find((i) => i.id === a.invoiceId);
    if (!inv) {
      problems.push({ invoiceId: a.invoiceId, message: "That invoice isn't on this job." });
      continue;
    }
    if (inv.status === "void") {
      problems.push({ invoiceId: inv.id, message: `${inv.number} is void.` });
      continue;
    }
    if (inv.totalCents <= 0) {
      problems.push({
        invoiceId: inv.id,
        message: `${inv.number} is a credit, so payments can't be applied to it.`,
      });
      continue;
    }
    const others = input.applications
      .filter((x) => x.invoiceId === inv.id && x.paymentId !== payment.id)
      .reduce((s, x) => s + x.amountCents, 0);
    const room = inv.totalCents - others;
    if (a.amountCents > room) {
      problems.push({
        invoiceId: inv.id,
        message: `${inv.number} only has ${formatCents(Math.max(0, room))} left to pay.`,
      });
    }
  }
  if (total > payment.availableCents) {
    problems.push({
      invoiceId: null,
      message: `That applies ${formatCents(total)}, but ${payment.number} only has ${formatCents(payment.availableCents)}.`,
    });
  }
  return problems;
}

/**
 * Recording a payment forces it onto invoices: the applied total must be the
 * whole payment, unless every open invoice is already covered (overpayment),
 * in which case the rest stays unapplied and shows as a warning.
 */
export function checkFullyApplied(
  amountCents: number,
  appliedCents: number,
  openBalanceCents: number,
): string | null {
  if (openBalanceCents <= 0) {
    return "Nothing is owed on this job's invoices. Create the invoice first, then record the payment against it.";
  }
  const target = Math.min(amountCents, openBalanceCents);
  if (appliedCents === target) return null;
  if (appliedCents < target) {
    return `Apply ${formatCents(target - appliedCents)} more. Payments must go onto invoices so the balance is right.`;
  }
  return `That applies ${formatCents(appliedCents - target)} more than is owed.`;
}

export type RefundPlan = {
  /** New application amounts for this payment (only invoices that change). */
  reductions: Allocation[];
  /** Part of the refund taken from unapplied money first. */
  fromUnappliedCents: number;
};

/**
 * A refund comes out of the payment's unapplied money first, then off its
 * applications, newest first (or from the chosen invoice first). Returns null
 * when the refund is more than the payment can give back.
 */
export function planRefund(input: {
  payment: Pick<PaymentLedger, "id" | "availableCents" | "unappliedCents">;
  /** This payment's applications, newest first. */
  applications: readonly LedgerApplication[];
  amountCents: number;
  preferInvoiceId?: string | null;
}): RefundPlan | null {
  const amount = Math.trunc(input.amountCents);
  if (amount <= 0 || amount > input.payment.availableCents) return null;
  const fromUnapplied = Math.min(amount, input.payment.unappliedCents);
  let left = amount - fromUnapplied;
  const mine = input.applications.filter((a) => a.paymentId === input.payment.id);
  const ordered = input.preferInvoiceId
    ? [
        ...mine.filter((a) => a.invoiceId === input.preferInvoiceId),
        ...mine.filter((a) => a.invoiceId !== input.preferInvoiceId),
      ]
    : mine;
  const reductions: Allocation[] = [];
  for (const a of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, a.amountCents);
    reductions.push({ invoiceId: a.invoiceId, amountCents: a.amountCents - take });
    left -= take;
  }
  if (left > 0) return null;
  return { reductions, fromUnappliedCents: fromUnapplied };
}
