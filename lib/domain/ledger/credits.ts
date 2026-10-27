import { formatCents } from "@/lib/format/money";
import type { JobLedger } from "./ledger";
import { CREDIT_TYPE_LABELS, type LedgerCredit } from "./types";

/**
 * Credits (SPEC §10 "Contract … − approved credits") and the final invoice
 * (SPEC §10 "Final invoice auto-drafted at Completed (includes On-Time
 * Guarantee credit if approved)"). Approved credits go onto the job's draft
 * final invoice as negative lines; once the final invoice is sent they're
 * issued as a credit memo instead. Pending credits wait for an owner.
 */

export type DraftLine = {
  description: string;
  amountCents: number;
  sourceType: "estimate" | "credit" | "manual";
  sourceId: string | null;
};

/** Credits approved but not yet on an invoice. */
export function unappliedCredits(credits: readonly LedgerCredit[]): LedgerCredit[] {
  return credits.filter((c) => c.status === "approved" && c.invoiceId === null);
}

export function creditLine(c: Pick<LedgerCredit, "id" | "type" | "amountCents">): DraftLine {
  return {
    description: `${CREDIT_TYPE_LABELS[c.type]} credit`,
    amountCents: -Math.abs(c.amountCents),
    sourceType: "credit",
    sourceId: c.id,
  };
}

/**
 * Lines for the final invoice: the rest of the contract (left to bill plus the
 * credits it carries) and one negative line per approved credit not yet
 * billed, so the total is exactly what's left to bill. A job with nothing
 * left still gets a $0 final invoice (the Completed → Invoiced gate needs one).
 */
export function finalInvoiceLines(
  ledger: Pick<JobLedger, "leftToBillCents">,
  credits: readonly LedgerCredit[],
): DraftLine[] {
  const pending = unappliedCredits(credits);
  const creditTotal = pending.reduce((s, c) => s + c.amountCents, 0);
  const rest = ledger.leftToBillCents + creditTotal;
  return [
    {
      description: "Balance of contract",
      amountCents: rest,
      sourceType: "estimate",
      sourceId: null,
    },
    ...pending.map(creditLine),
  ];
}

export function linesTotal(lines: readonly Pick<DraftLine, "amountCents">[]): number {
  return lines.reduce((s, l) => s + l.amountCents, 0);
}

/** Where an approved credit goes: the draft final invoice, a credit memo, or it waits. */
export type CreditPlacement = "final_draft" | "credit_memo" | "wait";

export function placeCredit(input: {
  finalInvoice: { status: string; sentAt: string | null } | null;
  /** The job reached Completed (the final invoice is drafted there). */
  completed: boolean;
}): CreditPlacement {
  const f = input.finalInvoice;
  if (f && f.status === "draft" && f.sentAt === null) return "final_draft";
  if (f && f.status !== "void") return "credit_memo";
  return input.completed ? "final_draft" : "wait";
}

export const CREDIT_REASON_MIN = 3;

export function creditSummary(c: Pick<LedgerCredit, "type" | "amountCents">): string {
  return `${CREDIT_TYPE_LABELS[c.type]} credit of ${formatCents(c.amountCents)}`;
}
