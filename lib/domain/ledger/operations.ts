import { checkApplications, checkFullyApplied, openInvoices, planRefund } from "./applications";
import type { Allocation } from "./applications";
import { finalInvoiceLines, linesTotal, placeCredit, unappliedCredits } from "./credits";
import { computeJobLedger, type JobLedger } from "./ledger";
import type {
  CreditType,
  InvoiceType,
  IsoDay,
  LedgerApplication,
  LedgerCredit,
  LedgerInvoice,
  LedgerPayment,
  LedgerRefund,
  PaymentMethod,
} from "./types";

/**
 * The ledger's rules as a pure state machine: each operation either returns
 * the next state or a plain-English refusal. The server actions run the same
 * checks before calling the database (which enforces them again), and the
 * property-based tests drive random sequences through it to prove the
 * invariants hold (lib/domain/ledger/ledger.property.test.ts).
 */

export type LedgerState = {
  contractBaseCents: number | null;
  invoices: LedgerInvoice[];
  payments: LedgerPayment[];
  applications: LedgerApplication[];
  refunds: LedgerRefund[];
  credits: LedgerCredit[];
  /** The job reached Completed (final invoices and credits on them). */
  completed: boolean;
};

export type LedgerOp =
  | { kind: "create_invoice"; id: string; type: InvoiceType; totalCents: number }
  | { kind: "send_invoice"; invoiceId: string; dueDate: IsoDay }
  | { kind: "void_invoice"; invoiceId: string }
  | { kind: "draft_final"; id: string }
  | {
      kind: "record_payment";
      id: string;
      amountCents: number;
      receivedOn: IsoDay;
      method?: PaymentMethod;
      allocations: readonly Allocation[];
    }
  | { kind: "set_applications"; paymentId: string; next: readonly Allocation[] }
  | { kind: "clear_payment"; paymentId: string }
  | { kind: "bounce_payment"; paymentId: string }
  | { kind: "void_payment"; paymentId: string }
  | { kind: "refund"; paymentId: string; amountCents: number }
  | { kind: "add_credit"; id: string; type: CreditType; amountCents: number }
  | { kind: "decide_credit"; creditId: string; approve: boolean }
  | { kind: "apply_credits"; memoId: string };

export type OpResult = { ok: true; state: LedgerState } | { ok: false; error: string };

export const EMPTY_LEDGER: LedgerState = {
  contractBaseCents: null,
  invoices: [],
  payments: [],
  applications: [],
  refunds: [],
  credits: [],
  completed: false,
};

const fail = (error: string): OpResult => ({ ok: false, error });

export function ledgerOf(state: LedgerState, today: IsoDay): JobLedger {
  return computeJobLedger({ ...state, today });
}

/** Replaces one payment's applications (zero amounts drop the row). */
function withApplications(
  apps: readonly LedgerApplication[],
  paymentId: string,
  next: readonly Allocation[],
): LedgerApplication[] {
  return [
    ...apps.filter((a) => a.paymentId !== paymentId),
    ...next
      .filter((n) => n.amountCents > 0)
      .map((n) => ({ paymentId, invoiceId: n.invoiceId, amountCents: n.amountCents })),
  ];
}

function liveApplications(state: LedgerState): LedgerApplication[] {
  const live = new Set(
    state.payments
      .filter((p) => p.status === "received" || p.status === "cleared")
      .map((p) => p.id),
  );
  return state.applications.filter((a) => live.has(a.paymentId));
}

/** Checks a new invoice's type and sign (one live deposit and one live final per job). */
export function checkNewInvoice(
  invoices: readonly Pick<LedgerInvoice, "type" | "status">[],
  type: InvoiceType,
  totalCents: number,
): string | null {
  if (!Number.isInteger(totalCents)) return "Amounts are whole cents.";
  if (type === "credit_memo" ? totalCents >= 0 : totalCents < 0) {
    return type === "credit_memo"
      ? "A credit memo takes money off, so its total is below $0."
      : "An invoice total can't be below $0. Use a credit memo to take money off.";
  }
  if (
    (type === "deposit" || type === "final") &&
    invoices.some((i) => i.type === type && i.status !== "void")
  ) {
    return type === "deposit"
      ? "This job already has a deposit invoice."
      : "This job already has a final invoice.";
  }
  return null;
}

export function applyOp(state: LedgerState, op: LedgerOp, today: IsoDay): OpResult {
  switch (op.kind) {
    case "create_invoice": {
      const problem = checkNewInvoice(state.invoices, op.type, op.totalCents);
      if (problem) return fail(problem);
      const inv: LedgerInvoice = {
        id: op.id,
        number: op.id,
        type: op.type,
        status: "draft",
        totalCents: op.totalCents,
        issueDate: null,
        dueDate: null,
        sentAt: null,
        createdAt: `${today}T12:00:00Z`,
      };
      return { ok: true, state: { ...state, invoices: [...state.invoices, inv] } };
    }
    case "send_invoice": {
      const inv = state.invoices.find((i) => i.id === op.invoiceId);
      if (!inv) return fail("That invoice isn't on this job.");
      if (inv.status === "void") return fail("A void invoice can't be sent.");
      if (op.dueDate < today) return fail("The due date can't be before today.");
      const sent: LedgerInvoice = {
        ...inv,
        status: inv.status === "draft" ? "sent" : inv.status,
        sentAt: inv.sentAt ?? `${today}T12:00:00Z`,
        issueDate: inv.issueDate ?? today,
        dueDate: op.dueDate,
      };
      return {
        ok: true,
        state: { ...state, invoices: state.invoices.map((i) => (i.id === inv.id ? sent : i)) },
      };
    }
    case "void_invoice": {
      const inv = state.invoices.find((i) => i.id === op.invoiceId);
      if (!inv) return fail("That invoice isn't on this job.");
      if (inv.status === "void") return fail("It's already void.");
      if (liveApplications(state).some((a) => a.invoiceId === inv.id)) {
        return fail(`Payments are applied to ${inv.number}. Move or remove them first.`);
      }
      return {
        ok: true,
        state: {
          ...state,
          invoices: state.invoices.map((i) => (i.id === inv.id ? { ...i, status: "void" } : i)),
          // Credits billed on it go back to waiting for an invoice.
          credits: state.credits.map((c) =>
            c.invoiceId === inv.id ? { ...c, status: "approved", invoiceId: null } : c,
          ),
        },
      };
    }
    case "draft_final": {
      if (!state.completed) return fail("The final invoice is drafted when the job is Completed.");
      const ledger = ledgerOf(state, today);
      const lines = finalInvoiceLines(ledger, state.credits);
      const total = linesTotal(lines);
      const problem = checkNewInvoice(state.invoices, "final", Math.max(0, total));
      if (problem) return fail(problem);
      if (total < 0)
        return fail("Credits are more than what's left to bill. Issue a credit memo instead.");
      const credited = new Set(
        lines.filter((l) => l.sourceType === "credit").map((l) => l.sourceId),
      );
      const inv: LedgerInvoice = {
        id: op.id,
        number: op.id,
        type: "final",
        status: "draft",
        totalCents: total,
        issueDate: null,
        dueDate: null,
        sentAt: null,
        createdAt: `${today}T12:00:00Z`,
      };
      return {
        ok: true,
        state: {
          ...state,
          invoices: [...state.invoices, inv],
          credits: state.credits.map((c) =>
            credited.has(c.id) ? { ...c, status: "applied", invoiceId: op.id } : c,
          ),
        },
      };
    }
    case "record_payment": {
      if (!Number.isInteger(op.amountCents) || op.amountCents <= 0) {
        return fail("Enter an amount above $0.");
      }
      if (op.receivedOn > today) return fail("The received date can't be in the future.");
      if (state.payments.some((p) => p.id === op.id)) return fail("Duplicate payment.");
      const ledger = ledgerOf(state, today);
      const payment: LedgerPayment = {
        id: op.id,
        number: op.id,
        amountCents: op.amountCents,
        status: "received",
        receivedOn: op.receivedOn,
        method: op.method,
      };
      const problems = checkApplications({
        payment: { ...payment, availableCents: op.amountCents },
        invoices: ledger.invoices,
        applications: liveApplications(state),
        next: op.allocations,
      });
      if (problems.length) return fail(problems.map((p) => p.message).join(" "));
      const applied = op.allocations.reduce((s, a) => s + a.amountCents, 0);
      const open = openInvoices(ledger.invoices).reduce((s, i) => s + i.balanceCents, 0);
      const forced = checkFullyApplied(op.amountCents, applied, open);
      if (forced) return fail(forced);
      return {
        ok: true,
        state: {
          ...state,
          payments: [...state.payments, payment],
          applications: withApplications(state.applications, op.id, op.allocations),
        },
      };
    }
    case "set_applications": {
      const ledger = ledgerOf(state, today);
      const p = ledger.payments.find((x) => x.id === op.paymentId);
      if (!p) return fail("That payment isn't on this job.");
      const problems = checkApplications({
        payment: p,
        invoices: ledger.invoices,
        applications: liveApplications(state),
        next: op.next,
      });
      if (problems.length) return fail(problems.map((x) => x.message).join(" "));
      return {
        ok: true,
        state: { ...state, applications: withApplications(state.applications, p.id, op.next) },
      };
    }
    case "clear_payment":
    case "bounce_payment":
    case "void_payment": {
      const p = state.payments.find((x) => x.id === op.paymentId);
      if (!p) return fail("That payment isn't on this job.");
      const next = paymentTransition(p.status, op.kind);
      if (typeof next !== "string" || next === p.status) {
        return fail(typeof next === "object" ? next.error : "Nothing to change.");
      }
      return {
        ok: true,
        state: {
          ...state,
          payments: state.payments.map((x) =>
            x.id === p.id
              ? { ...x, status: next, clearedOn: next === "cleared" ? today : x.clearedOn }
              : x,
          ),
        },
      };
    }
    case "refund": {
      const ledger = ledgerOf(state, today);
      const p = ledger.payments.find((x) => x.id === op.paymentId);
      if (!p) return fail("That payment isn't on this job.");
      if (p.status !== "received" && p.status !== "cleared") {
        return fail(`${p.number} is ${p.status}; there's nothing to refund.`);
      }
      const plan = planRefund({
        payment: p,
        applications: [...state.applications.filter((a) => a.paymentId === p.id)].reverse(),
        amountCents: op.amountCents,
      });
      if (!plan) return fail("A refund can't be more than what's left of the payment.");
      const changed = new Map(plan.reductions.map((r) => [r.invoiceId, r.amountCents]));
      const apps = state.applications
        .map((a) =>
          a.paymentId === p.id && changed.has(a.invoiceId)
            ? { ...a, amountCents: changed.get(a.invoiceId) ?? 0 }
            : a,
        )
        .filter((a) => a.amountCents > 0);
      const fullyRefunded = op.amountCents === p.availableCents;
      return {
        ok: true,
        state: {
          ...state,
          applications: apps,
          refunds: [...state.refunds, { paymentId: p.id, amountCents: op.amountCents }],
          payments: state.payments.map((x) =>
            x.id === p.id && fullyRefunded ? { ...x, status: "refunded" } : x,
          ),
        },
      };
    }
    case "add_credit": {
      if (!Number.isInteger(op.amountCents) || op.amountCents <= 0) {
        return fail("A credit is more than $0.");
      }
      return {
        ok: true,
        state: {
          ...state,
          credits: [
            ...state.credits,
            {
              id: op.id,
              type: op.type,
              amountCents: op.amountCents,
              status: "pending_approval",
              invoiceId: null,
            },
          ],
        },
      };
    }
    case "decide_credit": {
      const c = state.credits.find((x) => x.id === op.creditId);
      if (!c) return fail("That credit isn't on this job.");
      if (c.status !== "pending_approval") return fail("That credit was already decided.");
      return {
        ok: true,
        state: {
          ...state,
          credits: state.credits.map((x) =>
            x.id === c.id ? { ...x, status: op.approve ? "approved" : "rejected" } : x,
          ),
        },
      };
    }
    case "apply_credits": {
      const waiting = unappliedCredits(state.credits);
      if (!waiting.length) return fail("No approved credits are waiting.");
      const final = state.invoices.find((i) => i.type === "final" && i.status !== "void") ?? null;
      const where = placeCredit({ finalInvoice: final, completed: state.completed });
      if (where === "wait" || (where === "final_draft" && !final)) {
        return fail("Credits go on the final invoice, which is drafted when the job is Completed.");
      }
      const amount = waiting.reduce((s, c) => s + c.amountCents, 0);
      // On the draft final invoice when it can take them (never below what's
      // already paid on it); otherwise as a credit memo.
      const paidOnFinal = final
        ? liveApplications(state)
            .filter((a) => a.invoiceId === final.id)
            .reduce((s, a) => s + a.amountCents, 0)
        : 0;
      if (where === "final_draft" && final && final.totalCents - amount >= paidOnFinal) {
        const ids = new Set(waiting.map((c) => c.id));
        return {
          ok: true,
          state: {
            ...state,
            invoices: state.invoices.map((i) =>
              i.id === final.id ? { ...i, totalCents: i.totalCents - amount } : i,
            ),
            credits: state.credits.map((c) =>
              ids.has(c.id) ? { ...c, status: "applied", invoiceId: final.id } : c,
            ),
          },
        };
      }
      const memo: LedgerInvoice = {
        id: op.memoId,
        number: op.memoId,
        type: "credit_memo",
        status: "draft",
        totalCents: -amount,
        issueDate: null,
        dueDate: null,
        sentAt: null,
        createdAt: `${today}T12:00:00Z`,
      };
      const ids = new Set(waiting.map((c) => c.id));
      return {
        ok: true,
        state: {
          ...state,
          invoices: [...state.invoices, memo],
          credits: state.credits.map((c) =>
            ids.has(c.id) ? { ...c, status: "applied", invoiceId: memo.id } : c,
          ),
        },
      };
    }
  }
}

/** Allowed payment status changes: received → cleared; received/cleared → bounced or void. */
export function paymentTransition(
  from: LedgerPayment["status"],
  action: "clear_payment" | "bounce_payment" | "void_payment",
): LedgerPayment["status"] | { error: string } {
  if (from === "bounced" || from === "void" || from === "refunded") {
    return { error: `This payment is already ${from}.` };
  }
  if (action === "clear_payment") {
    return from === "received" ? "cleared" : { error: "It's already marked cleared." };
  }
  return action === "bounce_payment" ? "bounced" : "void";
}
