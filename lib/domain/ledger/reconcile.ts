import { daysBetween } from "@/lib/domain/scheduling/dates";
import { formatCents } from "@/lib/format/money";
import type { JobStageId } from "@/lib/domain/stages";
import { stageOrder } from "@/lib/domain/jobs/gates";
import { unappliedCredits } from "./credits";
import type { JobLedger } from "./ledger";
import type { IsoDay, LedgerCredit } from "./types";

/**
 * Plain-English "Needs attention" for the money (SPEC §8.5 #5): anything that
 * doesn't reconcile, with what to do about it. Pure.
 */

export type ReconcileCode =
  | "unapplied_payment"
  | "overpaid"
  | "overbilled"
  | "left_to_bill_after_final"
  | "credit_waiting"
  | "credit_pending_approval"
  | "uncleared_payment"
  | "stale_draft"
  | "no_contract"
  | "paid_stage_with_balance"
  | "overdue";

export type ReconcileWarning = {
  code: ReconcileCode;
  severity: "warning" | "info";
  message: string;
  /** Record the warning points at (payment or invoice id), when there is one. */
  recordId?: string;
};

/** Days after which a received check (or card/ACH) should have cleared. */
export const UNCLEARED_WARN_DAYS = 10;
/** Days a draft invoice can sit before we mention it. */
export const STALE_DRAFT_DAYS = 7;

export function reconcile(input: {
  ledger: JobLedger;
  credits: readonly LedgerCredit[];
  stage: JobStageId;
  today: IsoDay;
}): ReconcileWarning[] {
  const { ledger, today } = input;
  const out: ReconcileWarning[] = [];
  const order = stageOrder(input.stage);

  for (const p of ledger.payments) {
    if (p.unappliedCents > 0) {
      out.push({
        code: "unapplied_payment",
        severity: "warning",
        message: `A payment was recorded but not applied to an invoice (${p.number}, ${formatCents(p.unappliedCents)} unapplied). Apply it to update the balance.`,
        recordId: p.id,
      });
    }
    if (p.status === "received" && daysBetween(p.receivedOn, today) >= UNCLEARED_WARN_DAYS) {
      out.push({
        code: "uncleared_payment",
        severity: "info",
        message: `${p.number} (${formatCents(p.amountCents)}) was received ${daysBetween(p.receivedOn, today)} days ago and isn't marked cleared. Mark it cleared once the bank shows it.`,
        recordId: p.id,
      });
    }
  }

  if (ledger.balanceCents < 0) {
    out.push({
      code: "overpaid",
      severity: "warning",
      message: `The customer has paid ${formatCents(-ledger.balanceCents)} more than was billed. Refund it or apply it to a new invoice.`,
    });
  }
  if (ledger.leftToBillCents < 0) {
    out.push({
      code: "overbilled",
      severity: "warning",
      message: `Invoices add up to ${formatCents(-ledger.leftToBillCents)} more than the contract. Void the extra invoice or issue a credit memo.`,
    });
  }
  if (ledger.billedCents > 0 && ledger.contractBaseCents === 0) {
    out.push({
      code: "no_contract",
      severity: "warning",
      message:
        "Invoices exist but there's no contract amount. Accept an estimate or set the contract baseline in the job's Admin section.",
    });
  }

  const final = ledger.invoices.find((i) => i.type === "final" && i.status !== "void");
  if (final?.issued && ledger.leftToBillCents > 0) {
    out.push({
      code: "left_to_bill_after_final",
      severity: "warning",
      message: `The final invoice is sent but ${formatCents(ledger.leftToBillCents)} is still left to bill (the contract changed). Create an invoice for the difference.`,
    });
  }

  const waiting = unappliedCredits(input.credits);
  if (waiting.length && order >= stageOrder("completed")) {
    const total = waiting.reduce((s, c) => s + c.amountCents, 0);
    out.push({
      code: "credit_waiting",
      severity: "warning",
      message: `${formatCents(total)} of approved credit isn't on an invoice yet. Choose "Put credits on the invoice".`,
    });
  }
  const pending = input.credits.filter((c) => c.status === "pending_approval");
  if (pending.length) {
    const total = pending.reduce((s, c) => s + c.amountCents, 0);
    out.push({
      code: "credit_pending_approval",
      severity: "info",
      message: `${formatCents(total)} of credit is waiting for an owner's approval.`,
    });
  }

  for (const inv of ledger.invoices) {
    if (
      !inv.issued &&
      inv.status === "draft" &&
      inv.createdAt &&
      inv.totalCents !== 0 &&
      inv.displayStatus === "draft" &&
      daysBetween(inv.createdAt.slice(0, 10), today) >= STALE_DRAFT_DAYS
    ) {
      out.push({
        code: "stale_draft",
        severity: "info",
        message: `${inv.number} has been a draft for ${daysBetween(inv.createdAt.slice(0, 10), today)} days. Send it or void it.`,
        recordId: inv.id,
      });
    }
    if (inv.daysPastDue > 0) {
      out.push({
        code: "overdue",
        severity: "warning",
        message: `${inv.number} is ${inv.daysPastDue} day${inv.daysPastDue === 1 ? "" : "s"} past due with ${formatCents(inv.balanceCents)} owed.`,
        recordId: inv.id,
      });
    }
  }

  if ((input.stage === "paid_in_full" || input.stage === "closed_won") && ledger.balanceCents > 0) {
    out.push({
      code: "paid_stage_with_balance",
      severity: "warning",
      message: `The job is marked ${input.stage === "paid_in_full" ? "Paid in Full" : "Closed Won"} but ${formatCents(ledger.balanceCents)} is owed (a payment may have bounced or been refunded).`,
    });
  }
  return out;
}
