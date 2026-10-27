import { describe, expect, it } from "vitest";
import { computeJobLedger } from "./ledger";
import { reconcile } from "./reconcile";
import { SCENARIO } from "./fixtures";

describe("reconcile", () => {
  it("explains what doesn't add up in plain English", () => {
    const ledger = computeJobLedger({ ...SCENARIO, today: "2026-11-20" });
    const w = reconcile({
      ledger,
      credits: SCENARIO.credits,
      stage: "invoiced",
      today: "2026-11-20",
    });
    expect(w.map((x) => x.code)).toEqual([
      "uncleared_payment",
      "unapplied_payment",
      "uncleared_payment",
      "overdue",
    ]);
    expect(w[1]?.message).toBe(
      "A payment was recorded but not applied to an invoice (PMT-4, $50.00 unapplied). Apply it to update the balance.",
    );
    expect(w[0]?.message).toMatch(/PMT-2 \(\$4,000.00\) was received 15 days ago/);
    expect(w[3]?.message).toBe("INV-2026-0002 is 17 days past due with $2,250.00 owed.");
  });

  it("flags over-billing, a missing contract, credits waiting and a paid stage with a balance", () => {
    const ledger = computeJobLedger({
      today: "2026-11-20",
      contractBaseCents: 0,
      invoices: [
        {
          id: "f",
          number: "F",
          type: "final",
          status: "sent",
          totalCents: 10_000,
          issueDate: "2026-11-01",
          dueDate: "2026-12-01",
          sentAt: "2026-11-01T00:00:00Z",
        },
        {
          id: "d",
          number: "D",
          type: "progress",
          status: "draft",
          totalCents: 500,
          issueDate: null,
          dueDate: null,
          sentAt: null,
          createdAt: "2026-11-01T00:00:00Z",
        },
      ],
      payments: [],
      applications: [],
      refunds: [],
      credits: [],
    });
    const codes = reconcile({
      ledger,
      credits: [
        { id: "c", type: "goodwill", amountCents: 100, status: "approved", invoiceId: null },
        { id: "e", type: "goodwill", amountCents: 50, status: "pending_approval", invoiceId: null },
      ],
      stage: "paid_in_full",
      today: "2026-11-20",
    }).map((x) => x.code);
    expect(codes).toEqual([
      "overbilled",
      "no_contract",
      "credit_waiting",
      "credit_pending_approval",
      "stale_draft",
      "paid_stage_with_balance",
    ]);
  });

  it("asks for the rest after the final invoice when the contract grew", () => {
    const ledger = computeJobLedger({
      today: "2026-11-20",
      contractBaseCents: 20_000,
      invoices: [
        {
          id: "f",
          number: "F",
          type: "final",
          status: "sent",
          totalCents: 10_000,
          issueDate: "2026-11-01",
          dueDate: "2026-12-01",
          sentAt: "2026-11-01T00:00:00Z",
        },
      ],
      payments: [],
      applications: [],
      refunds: [],
      credits: [],
    });
    expect(
      reconcile({ ledger, credits: [], stage: "invoiced", today: "2026-11-20" }).map((x) => x.code),
    ).toEqual(["left_to_bill_after_final"]);
  });
});
