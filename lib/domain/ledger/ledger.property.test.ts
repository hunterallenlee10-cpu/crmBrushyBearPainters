import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arAging } from "./aging";
import { suggestAllocation } from "./applications";
import { computeJobLedger } from "./ledger";
import { EMPTY_LEDGER, applyOp, type LedgerOp, type LedgerState } from "./operations";
import { CREDIT_TYPES, INVOICE_TYPES, creditCounts, isLivePayment } from "./types";

/**
 * Property-based tests (PLAN Phase 7 "ledger invariants hold under
 * property-based tests"): random sequences of invoices, payments,
 * applications, clears, bounces, voids, refunds and credits, and after every
 * step the ledger must still add up.
 */

const TODAY = "2026-11-15";
const DAYS = ["2026-09-01", "2026-10-01", "2026-10-20", "2026-11-01", "2026-11-15"];

type Seed = { kind: number; a: number; b: number; c: number };

const seedArb: fc.Arbitrary<Seed> = fc.record({
  kind: fc.integer({ min: 0, max: 13 }),
  a: fc.nat({ max: 1000 }),
  b: fc.nat({ max: 1000 }),
  c: fc.integer({ min: 1, max: 2_000_000 }),
});

const pick = <T>(xs: readonly T[], n: number): T | undefined =>
  xs.length ? xs[n % xs.length] : undefined;

/** Turns a random seed into an operation on the current state (ids from what exists). */
function toOp(state: LedgerState, s: Seed, step: number): LedgerOp | null {
  const today = TODAY;
  const ledger = computeJobLedger({ ...state, today });
  switch (s.kind) {
    case 0:
    case 1: {
      const type = INVOICE_TYPES[s.a % INVOICE_TYPES.length] ?? "progress";
      const total = type === "credit_memo" ? -Math.max(1, s.c % 200_000) : s.c;
      return { kind: "create_invoice", id: `INV-${step}`, type, totalCents: total };
    }
    case 2: {
      const inv = pick(state.invoices, s.a);
      return inv
        ? { kind: "send_invoice", invoiceId: inv.id, dueDate: DAYS[s.b % DAYS.length] ?? today }
        : null;
    }
    case 3: {
      const inv = pick(state.invoices, s.a);
      return inv ? { kind: "void_invoice", invoiceId: inv.id } : null;
    }
    case 4:
    case 5: {
      // Usually the suggested split (the form's default), sometimes a random one.
      const amount = s.c;
      const allocations =
        s.b % 3 === 0
          ? ledger.invoices
              .filter((i) => i.status !== "void")
              .slice(0, 2)
              .map((i, n) => ({ invoiceId: i.id, amountCents: n === 0 ? amount : s.a }))
          : suggestAllocation(amount, ledger.invoices, pick(state.invoices, s.a)?.id).allocations;
      return {
        kind: "record_payment",
        id: `PMT-${step}`,
        amountCents: amount,
        receivedOn: DAYS[s.b % DAYS.length] ?? today,
        allocations,
      };
    }
    case 6: {
      const p = pick(state.payments, s.a);
      const inv = pick(state.invoices, s.b);
      if (!p || !inv) return null;
      const mine = state.applications.filter((x) => x.paymentId === p.id);
      const next = [
        ...mine.filter((x) => x.invoiceId !== inv.id),
        { paymentId: p.id, invoiceId: inv.id, amountCents: s.c % 500_000 },
      ].map((x) => ({ invoiceId: x.invoiceId, amountCents: x.amountCents }));
      return { kind: "set_applications", paymentId: p.id, next };
    }
    case 7: {
      const p = pick(state.payments, s.a);
      return p ? { kind: "clear_payment", paymentId: p.id } : null;
    }
    case 8: {
      const p = pick(state.payments, s.a);
      return p ? { kind: s.b % 2 ? "bounce_payment" : "void_payment", paymentId: p.id } : null;
    }
    case 9: {
      const p = pick(ledger.payments, s.a);
      if (!p) return null;
      const amount = s.b % 2 ? p.availableCents : Math.max(1, s.c % Math.max(1, p.availableCents));
      return { kind: "refund", paymentId: p.id, amountCents: amount };
    }
    case 10:
      return {
        kind: "add_credit",
        id: `CR-${step}`,
        type: CREDIT_TYPES[s.a % CREDIT_TYPES.length] ?? "goodwill",
        amountCents: Math.max(1, s.c % 100_000),
      };
    case 11: {
      const c = pick(state.credits, s.a);
      return c ? { kind: "decide_credit", creditId: c.id, approve: s.b % 4 !== 0 } : null;
    }
    case 12:
      return { kind: "apply_credits", memoId: `CM-${step}` };
    default:
      return { kind: "draft_final", id: `FIN-${step}` };
  }
}

function checkInvariants(state: LedgerState) {
  const l = computeJobLedger({ ...state, today: TODAY });
  const live = new Map(state.payments.map((p) => [p.id, isLivePayment(p.status)]));
  const voided = new Set(state.invoices.filter((i) => i.status === "void").map((i) => i.id));
  const liveApps = state.applications.filter((a) => live.get(a.paymentId));

  // The headline identities.
  expect(l.balanceCents).toBe(l.billedCents - l.collectedCents);
  expect(l.leftToBillCents).toBe(l.contractCents - l.billedCents);
  const credits = state.credits
    .filter((c) => creditCounts(c.status))
    .reduce((s, c) => s + c.amountCents, 0);
  expect(l.contractCents).toBe((state.contractBaseCents ?? 0) - credits);
  expect(l.billedCents).toBe(
    state.invoices.filter((i) => i.status !== "void").reduce((s, i) => s + i.totalCents, 0),
  );

  // Collected counts only applied money from live payments (never bounced, void,
  // refunded or unapplied money) on live invoices.
  expect(l.collectedCents).toBe(
    liveApps.filter((a) => !voided.has(a.invoiceId)).reduce((s, a) => s + a.amountCents, 0),
  );
  expect(liveApps.some((a) => voided.has(a.invoiceId))).toBe(false);

  // Every live dollar is either applied or shown as unapplied.
  const available = l.payments.reduce((s, p) => s + p.availableCents, 0);
  expect(l.collectedCents + l.unappliedCents).toBe(available);
  expect(l.unappliedCents).toBeGreaterThanOrEqual(0);

  for (const p of l.payments) {
    const refunded = state.refunds
      .filter((r) => r.paymentId === p.id)
      .reduce((s, r) => s + r.amountCents, 0);
    expect(refunded).toBeLessThanOrEqual(p.amountCents);
    const applied = state.applications
      .filter((a) => a.paymentId === p.id)
      .reduce((s, a) => s + a.amountCents, 0);
    // Applications never exceed what the payment can give.
    if (isLivePayment(p.status)) expect(applied).toBeLessThanOrEqual(p.amountCents - refunded);
    if (!isLivePayment(p.status)) expect(p.availableCents).toBe(0);
  }
  for (const inv of l.invoices) {
    const applied = liveApps
      .filter((a) => a.invoiceId === inv.id)
      .reduce((s, a) => s + a.amountCents, 0);
    if (inv.status !== "void") {
      expect(inv.collectedCents).toBe(applied);
      // An invoice never takes more than its total.
      if (inv.totalCents >= 0) expect(applied).toBeLessThanOrEqual(inv.totalCents);
      else expect(applied).toBe(0);
      expect(inv.balanceCents).toBe(inv.totalCents - applied);
    }
  }
  for (const a of state.applications) expect(a.amountCents).toBeGreaterThan(0);

  // Credits on an invoice point at a live one.
  for (const c of state.credits) {
    if (c.status === "applied") {
      expect(state.invoices.some((i) => i.id === c.invoiceId && i.status !== "void")).toBe(true);
    }
  }
  // One live deposit and one live final.
  for (const t of ["deposit", "final"] as const) {
    expect(
      state.invoices.filter((i) => i.type === t && i.status !== "void").length,
    ).toBeLessThanOrEqual(1);
  }
  // Due is part of the balance; aging adds up to issued balances.
  expect(l.dueCents).toBeGreaterThanOrEqual(0);
  expect(l.dueCents).toBeLessThanOrEqual(Math.max(0, l.balanceCents));
  const aging = arAging(l.invoices);
  expect(aging.totalCents).toBe(
    l.invoices.filter((i) => i.issued).reduce((s, i) => s + i.balanceCents, 0),
  );
  expect(aging.rows.reduce((s, r) => s + r.cents, 0)).toBe(aging.totalCents);
}

describe("ledger invariants (property-based)", () => {
  it("hold after every operation in any sequence", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.boolean(),
        fc.array(seedArb, { minLength: 1, maxLength: 60 }),
        (base, completed, seeds) => {
          let state: LedgerState = { ...EMPTY_LEDGER, contractBaseCents: base, completed };
          checkInvariants(state);
          seeds.forEach((s, step) => {
            const op = toOp(state, s, step);
            if (!op) return;
            const res = applyOp(state, op, TODAY);
            if (res.ok) state = res.state;
            checkInvariants(state);
          });
        },
      ),
      { numRuns: Number(process.env.LEDGER_PROPERTY_RUNS ?? 1000) },
    );
  }, 60_000);

  it("paying exactly what's billed after a full billing brings the balance to $0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        (contract, depositPct) => {
          const deposit = Math.round((contract * depositPct) / 100);
          let state: LedgerState = {
            ...EMPTY_LEDGER,
            contractBaseCents: contract,
            completed: true,
          };
          const step = (op: LedgerOp) => {
            const r = applyOp(state, op, TODAY);
            if (!r.ok) throw new Error(r.error);
            state = r.state;
          };
          if (deposit > 0) {
            step({ kind: "create_invoice", id: "DEP", type: "deposit", totalCents: deposit });
            step({
              kind: "record_payment",
              id: "P1",
              amountCents: deposit,
              receivedOn: TODAY,
              allocations: [{ invoiceId: "DEP", amountCents: deposit }],
            });
          }
          step({ kind: "draft_final", id: "FIN" });
          const before = computeJobLedger({ ...state, today: TODAY });
          expect(before.leftToBillCents).toBe(0);
          if (before.balanceCents > 0) {
            step({
              kind: "record_payment",
              id: "P2",
              amountCents: before.balanceCents,
              receivedOn: TODAY,
              allocations: [{ invoiceId: "FIN", amountCents: before.balanceCents }],
            });
          }
          const after = computeJobLedger({ ...state, today: TODAY });
          expect(after.balanceCents).toBe(0);
          expect(after.collectedCents).toBe(contract);
          checkInvariants(state);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a bounce or refund puts exactly that money back on the balance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 1_000_000 }),
        fc.integer({ min: 1, max: 999 }),
        fc.boolean(),
        (total, refundPermille, bounce) => {
          let state: LedgerState = { ...EMPTY_LEDGER, contractBaseCents: total };
          const step = (op: LedgerOp) => {
            const r = applyOp(state, op, TODAY);
            if (!r.ok) throw new Error(r.error);
            state = r.state;
          };
          step({ kind: "create_invoice", id: "I", type: "progress", totalCents: total });
          step({
            kind: "record_payment",
            id: "P",
            amountCents: total,
            receivedOn: TODAY,
            allocations: [{ invoiceId: "I", amountCents: total }],
          });
          expect(computeJobLedger({ ...state, today: TODAY }).balanceCents).toBe(0);
          const back = bounce ? total : Math.max(1, Math.floor((total * refundPermille) / 1000));
          step(
            bounce
              ? { kind: "bounce_payment", paymentId: "P" }
              : { kind: "refund", paymentId: "P", amountCents: back },
          );
          const l = computeJobLedger({ ...state, today: TODAY });
          expect(l.balanceCents).toBe(back);
          expect(l.unappliedCents).toBe(0);
          checkInvariants(state);
        },
      ),
      { numRuns: 200 },
    );
  });
});
