import { describe, expect, it } from "vitest";
import { agingBucket, arAging } from "./aging";
import {
  checkApplications,
  checkFullyApplied,
  openInvoices,
  planRefund,
  suggestAllocation,
} from "./applications";
import {
  creditLine,
  finalInvoiceLines,
  linesTotal,
  placeCredit,
  unappliedCredits,
} from "./credits";
import { collectedShare, computeJobLedger, invoiceDisplayStatus, isPaidInFull } from "./ledger";
import {
  EMPTY_LEDGER,
  applyOp,
  checkNewInvoice,
  paymentTransition,
  type LedgerState,
} from "./operations";
import { reconcile } from "./reconcile";
import { SCENARIO } from "./fixtures";
import type { LedgerCredit } from "./types";

describe("computeJobLedger", () => {
  const l = computeJobLedger(SCENARIO);

  it("derives every figure from the records", () => {
    expect(l).toMatchObject({
      contractBaseCents: 1_000_000,
      creditsCents: 25_000,
      contractCents: 975_000,
      billedCents: 975_000,
      leftToBillCents: 0,
      collectedCents: 750_000,
      balanceCents: 225_000,
      dueCents: 225_000,
      unappliedCents: 5_000,
      refundedCents: 5_000,
      unclearedCents: 455_000,
    });
  });

  it("never counts bounced money and shows unapplied cash separately", () => {
    const fin = l.invoices.find((i) => i.id === "fin");
    expect(fin).toMatchObject({
      collectedCents: 450_000,
      balanceCents: 225_000,
      daysPastDue: 12,
      displayStatus: "overdue",
    });
    expect(l.payments.find((p) => p.id === "p3")).toMatchObject({
      availableCents: 0,
      appliedCents: 0,
      unappliedCents: 0,
    });
    expect(l.payments.find((p) => p.id === "p4")).toMatchObject({
      availableCents: 55_000,
      appliedCents: 50_000,
      unappliedCents: 5_000,
    });
  });

  it("treats a missing contract as $0 and void invoices as nothing", () => {
    const x = computeJobLedger({
      ...SCENARIO,
      contractBaseCents: null,
      credits: [],
      invoices: SCENARIO.invoices.map((i) => ({ ...i, status: "void" as const })),
    });
    expect(x).toMatchObject({
      contractCents: 0,
      billedCents: 0,
      collectedCents: 0,
      balanceCents: 0,
    });
    // Money applied to void invoices is no longer collected; it's still applied (to fix).
    expect(x.unappliedCents).toBe(5_000);
  });

  it("knows when a job is paid in full", () => {
    expect(isPaidInFull(l)).toBe(false);
    expect(isPaidInFull({ billedCents: 1, leftToBillCents: 0, balanceCents: 0 })).toBe(true);
    expect(isPaidInFull({ billedCents: 0, leftToBillCents: 0, balanceCents: 0 })).toBe(false);
    expect(isPaidInFull({ billedCents: 5, leftToBillCents: 3, balanceCents: 0 })).toBe(false);
    expect(collectedShare(l)).toBeCloseTo(750_000 / 975_000);
    expect(collectedShare({ collectedCents: 1, contractCents: 0 })).toBeNull();
  });
});

describe("invoiceDisplayStatus", () => {
  const base = {
    status: "sent" as const,
    sentAt: "2026-11-01T00:00:00Z",
    viewedAt: null,
    dueDate: "2026-11-10",
    totalCents: 1000,
  };
  it("follows the lifecycle and the money", () => {
    expect(invoiceDisplayStatus({ ...base, status: "void" }, 1000, "2026-11-01")).toBe("void");
    expect(invoiceDisplayStatus({ ...base, status: "draft", sentAt: null }, 0, "2026-11-01")).toBe(
      "draft",
    );
    expect(
      invoiceDisplayStatus({ ...base, status: "draft", sentAt: null }, 1000, "2026-11-01"),
    ).toBe("paid");
    // A draft paid at signing whose payment then bounced is a draft again.
    expect(invoiceDisplayStatus({ ...base, status: "paid", sentAt: null }, 0, "2026-11-01")).toBe(
      "draft",
    );
    expect(invoiceDisplayStatus(base, 0, "2026-11-10")).toBe("sent");
    expect(invoiceDisplayStatus({ ...base, viewedAt: "x" }, 0, "2026-11-10")).toBe("viewed");
    expect(invoiceDisplayStatus(base, 400, "2026-11-10")).toBe("partially_paid");
    expect(invoiceDisplayStatus(base, 400, "2026-11-11")).toBe("overdue");
    expect(invoiceDisplayStatus(base, 1000, "2026-12-30")).toBe("paid");
    expect(invoiceDisplayStatus({ ...base, totalCents: -500 }, 0, "2026-12-30")).toBe("sent");
    expect(invoiceDisplayStatus({ ...base, dueDate: null }, 0, "2027-01-01")).toBe("sent");
  });
});

describe("aging", () => {
  it("buckets days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual([
      "current",
      "d1_30",
      "d1_30",
      "d31_60",
      "d31_60",
      "d61_90",
      "d61_90",
      "d90_plus",
    ]);
  });
  it("counts only sent invoices with money owed", () => {
    const l = computeJobLedger(SCENARIO);
    const a = arAging([
      ...l.invoices,
      { issued: false, status: "draft", balanceCents: 999, daysPastDue: 0 },
      { issued: true, status: "sent", balanceCents: -100, daysPastDue: 0 },
      { issued: true, status: "overdue", balanceCents: 700, daysPastDue: 95 },
    ]);
    expect(a.totalCents).toBe(225_000 - 100 + 700);
    expect(a.rows.find((r) => r.bucket === "d1_30")).toMatchObject({ cents: 225_000, count: 1 });
    expect(a.rows.find((r) => r.bucket === "current")).toMatchObject({ cents: -100, count: 1 });
    expect(a.rows.find((r) => r.bucket === "d90_plus")).toMatchObject({ cents: 700, count: 1 });
  });
});

describe("applications", () => {
  const l = computeJobLedger({
    ...SCENARIO,
    applications: SCENARIO.applications.filter((a) => a.paymentId !== "p2"),
  });

  it("suggests the chosen invoice first, then the oldest", () => {
    expect(openInvoices(l.invoices).map((i) => i.id)).toEqual(["fin"]);
    expect(suggestAllocation(1_000_000, l.invoices)).toEqual({
      allocations: [{ invoiceId: "fin", amountCents: 625_000 }],
      leftoverCents: 375_000,
    });
    expect(suggestAllocation(-5, l.invoices).allocations).toEqual([]);
  });

  it("refuses more than the invoice or the payment has", () => {
    const p2 = l.payments.find((p) => p.id === "p2");
    if (!p2) throw new Error("p2");
    const apps = SCENARIO.applications.filter((a) => a.paymentId !== "p2" && a.paymentId !== "p3");
    expect(
      checkApplications({
        payment: p2,
        invoices: l.invoices,
        applications: apps,
        next: [{ invoiceId: "fin", amountCents: 400_000 }],
      }),
    ).toEqual([]);
    const tooMuch = checkApplications({
      payment: p2,
      invoices: l.invoices,
      applications: apps,
      next: [{ invoiceId: "fin", amountCents: 650_000 }],
    });
    expect(tooMuch.map((p) => p.message)).toEqual([
      "INV-2026-0002 only has $6,250.00 left to pay.",
      "That applies $6,500.00, but PMT-2 only has $4,000.00.",
    ]);
    expect(
      checkApplications({
        payment: { ...p2, status: "bounced" },
        invoices: l.invoices,
        applications: apps,
        next: [],
      })[0]?.message,
    ).toMatch(/bounced/);
    const odd = checkApplications({
      payment: p2,
      invoices: [
        ...l.invoices,
        { ...l.invoices[0]!, id: "memo", number: "CM", totalCents: -10 },
        { ...l.invoices[0]!, id: "v", number: "V", status: "void" },
      ],
      applications: apps,
      next: [
        { invoiceId: "nope", amountCents: 1 },
        { invoiceId: "memo", amountCents: 1 },
        { invoiceId: "v", amountCents: 1 },
        { invoiceId: "fin", amountCents: -1 },
        { invoiceId: "fin", amountCents: 1 },
        { invoiceId: "dep", amountCents: 0 },
      ],
    });
    expect(odd.map((p) => p.message)).toEqual([
      "That invoice isn't on this job.",
      "CM is a credit, so payments can't be applied to it.",
      "V is void.",
      "Enter an amount of $0 or more.",
      "Each invoice appears once.",
    ]);
  });

  it("forces the whole payment onto invoices unless it's an overpayment", () => {
    expect(checkFullyApplied(100, 100, 500)).toBeNull();
    expect(checkFullyApplied(600, 500, 500)).toBeNull();
    expect(checkFullyApplied(100, 40, 500)).toBe(
      "Apply $0.60 more. Payments must go onto invoices so the balance is right.",
    );
    expect(checkFullyApplied(100, 0, 0)).toMatch(/Nothing is owed/);
    expect(checkFullyApplied(100, 200, 500)).toMatch(/more than is owed/);
  });

  it("plans refunds from unapplied money first, then newest applications", () => {
    const p4 = computeJobLedger(SCENARIO).payments.find((p) => p.id === "p4");
    if (!p4) throw new Error("p4");
    expect(
      planRefund({ payment: p4, applications: SCENARIO.applications, amountCents: 3_000 }),
    ).toEqual({
      reductions: [],
      fromUnappliedCents: 3_000,
    });
    expect(
      planRefund({ payment: p4, applications: SCENARIO.applications, amountCents: 20_000 }),
    ).toEqual({
      reductions: [{ invoiceId: "fin", amountCents: 35_000 }],
      fromUnappliedCents: 5_000,
    });
    expect(
      planRefund({ payment: p4, applications: SCENARIO.applications, amountCents: 55_001 }),
    ).toBeNull();
    expect(planRefund({ payment: p4, applications: [], amountCents: 0 })).toBeNull();
    expect(
      planRefund({
        payment: { id: "p", availableCents: 30, unappliedCents: 0 },
        applications: [
          { paymentId: "p", invoiceId: "a", amountCents: 10 },
          { paymentId: "p", invoiceId: "b", amountCents: 20 },
        ],
        amountCents: 15,
        preferInvoiceId: "b",
      }),
    ).toEqual({ reductions: [{ invoiceId: "b", amountCents: 5 }], fromUnappliedCents: 0 });
  });
});

describe("credits and the final invoice", () => {
  const credits: LedgerCredit[] = [
    {
      id: "a",
      type: "on_time_guarantee",
      amountCents: 25_000,
      status: "approved",
      invoiceId: null,
    },
    { id: "b", type: "goodwill", amountCents: 5_000, status: "pending_approval", invoiceId: null },
    { id: "c", type: "referral", amountCents: 1_000, status: "applied", invoiceId: "x" },
  ];
  it("puts approved credits on the final invoice as negative lines", () => {
    expect(unappliedCredits(credits).map((c) => c.id)).toEqual(["a"]);
    const lines = finalInvoiceLines({ leftToBillCents: 675_000 }, credits);
    expect(lines).toEqual([
      {
        description: "Balance of contract",
        amountCents: 700_000,
        sourceType: "estimate",
        sourceId: null,
      },
      {
        description: "On-Time Guarantee credit",
        amountCents: -25_000,
        sourceType: "credit",
        sourceId: "a",
      },
    ]);
    expect(linesTotal(lines)).toBe(675_000);
    expect(creditLine({ id: "z", type: "goodwill", amountCents: -3 }).amountCents).toBe(-3);
  });
  it("places credits on the draft, a credit memo, or waits", () => {
    expect(placeCredit({ finalInvoice: { status: "draft", sentAt: null }, completed: true })).toBe(
      "final_draft",
    );
    expect(placeCredit({ finalInvoice: { status: "sent", sentAt: "x" }, completed: true })).toBe(
      "credit_memo",
    );
    expect(placeCredit({ finalInvoice: null, completed: false })).toBe("wait");
    expect(placeCredit({ finalInvoice: { status: "void", sentAt: "x" }, completed: true })).toBe(
      "final_draft",
    );
  });
});

describe("operations", () => {
  it("checks invoice types and signs", () => {
    expect(checkNewInvoice([], "progress", 1.5)).toMatch(/whole cents/);
    expect(checkNewInvoice([], "credit_memo", 10)).toMatch(/below \$0/);
    expect(checkNewInvoice([], "progress", -10)).toMatch(/credit memo/);
    expect(checkNewInvoice([{ type: "deposit", status: "sent" }], "deposit", 10)).toMatch(
      /deposit/,
    );
    expect(checkNewInvoice([{ type: "deposit", status: "void" }], "deposit", 10)).toBeNull();
    expect(checkNewInvoice([{ type: "final", status: "draft" }], "final", 0)).toMatch(/final/);
  });
  it("allows only sensible payment status changes", () => {
    expect(paymentTransition("received", "clear_payment")).toBe("cleared");
    expect(paymentTransition("cleared", "clear_payment")).toEqual({
      error: "It's already marked cleared.",
    });
    expect(paymentTransition("cleared", "bounce_payment")).toBe("bounced");
    expect(paymentTransition("received", "void_payment")).toBe("void");
    expect(paymentTransition("bounced", "void_payment")).toEqual({
      error: "This payment is already bounced.",
    });
  });
  it("walks a job from deposit to paid in full, with an on-time credit", () => {
    const today = "2026-11-15";
    let s: LedgerState = { ...EMPTY_LEDGER, contractBaseCents: 1_000_000 };
    const run = (op: Parameters<typeof applyOp>[1]) => {
      const r = applyOp(s, op, today);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    };
    run({ kind: "create_invoice", id: "dep", type: "deposit", totalCents: 300_000 });
    run({
      kind: "record_payment",
      id: "p1",
      amountCents: 300_000,
      receivedOn: today,
      allocations: [{ invoiceId: "dep", amountCents: 300_000 }],
    });
    run({ kind: "add_credit", id: "c1", type: "on_time_guarantee", amountCents: 25_000 });
    run({ kind: "decide_credit", creditId: "c1", approve: true });
    expect(applyOp(s, { kind: "apply_credits", memoId: "m" }, today)).toEqual({
      ok: false,
      error: "Credits go on the final invoice, which is drafted when the job is Completed.",
    });
    expect(applyOp(s, { kind: "draft_final", id: "fin" }, today).ok).toBe(false);
    s = { ...s, completed: true };
    run({ kind: "draft_final", id: "fin" });
    expect(s.invoices.find((i) => i.id === "fin")?.totalCents).toBe(675_000);
    expect(s.credits[0]).toMatchObject({ status: "applied", invoiceId: "fin" });
    run({ kind: "send_invoice", invoiceId: "fin", dueDate: "2026-11-30" });
    run({
      kind: "record_payment",
      id: "p2",
      amountCents: 675_000,
      receivedOn: today,
      allocations: [{ invoiceId: "fin", amountCents: 675_000 }],
    });
    const l = computeJobLedger({ ...s, today });
    expect(isPaidInFull(l)).toBe(true);
    expect(l.contractCents).toBe(975_000);
    // A goodwill credit after the final invoice is sent becomes a credit memo.
    run({ kind: "add_credit", id: "c2", type: "goodwill", amountCents: 10_000 });
    run({ kind: "decide_credit", creditId: "c2", approve: true });
    run({ kind: "apply_credits", memoId: "memo" });
    const after = computeJobLedger({ ...s, today });
    expect(after).toMatchObject({
      contractCents: 965_000,
      billedCents: 965_000,
      balanceCents: -10_000,
    });
    expect(
      reconcile({ ledger: after, credits: s.credits, stage: "paid_in_full", today }).map(
        (w) => w.code,
      ),
    ).toEqual(["overpaid"]);
  });
  it("refuses voiding an invoice with payments and reopens its credits", () => {
    const today = "2026-11-15";
    let s: LedgerState = { ...EMPTY_LEDGER, contractBaseCents: 100_000, completed: true };
    const run = (op: Parameters<typeof applyOp>[1]) => {
      const r = applyOp(s, op, today);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    };
    run({ kind: "add_credit", id: "c", type: "discount", amountCents: 1_000 });
    run({ kind: "decide_credit", creditId: "c", approve: true });
    run({ kind: "draft_final", id: "f" });
    run({
      kind: "record_payment",
      id: "p",
      amountCents: 500,
      receivedOn: today,
      allocations: [{ invoiceId: "f", amountCents: 500 }],
    });
    const blocked = applyOp(s, { kind: "void_invoice", invoiceId: "f" }, today);
    expect(blocked).toEqual({
      ok: false,
      error: "Payments are applied to f. Move or remove them first.",
    });
    run({ kind: "set_applications", paymentId: "p", next: [] });
    run({ kind: "void_invoice", invoiceId: "f" });
    expect(s.credits[0]).toMatchObject({ status: "approved", invoiceId: null });
    const l = computeJobLedger({ ...s, today });
    expect(
      reconcile({ ledger: l, credits: s.credits, stage: "completed", today }).map((w) => w.code),
    ).toEqual(["unapplied_payment", "credit_waiting"]);
  });
});
