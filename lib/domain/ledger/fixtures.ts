import type { LedgerCredit, LedgerInvoice, LedgerPayment } from "./types";

/**
 * The shared scenario. supabase/tests/013_money.test.sql builds the same
 * records and checks public.job_ledger returns the same numbers.
 */
export const SCENARIO = {
  today: "2026-11-15",
  contractBaseCents: 1_000_000,
  credits: [
    {
      id: "cr1",
      type: "on_time_guarantee",
      amountCents: 25_000,
      status: "applied",
      invoiceId: "fin",
    },
  ] satisfies LedgerCredit[],
  invoices: [
    {
      id: "dep",
      number: "INV-2026-0001",
      type: "deposit",
      status: "paid",
      totalCents: 300_000,
      issueDate: "2026-10-01",
      dueDate: "2026-10-01",
      sentAt: "2026-10-01T17:00:00Z",
    },
    {
      id: "fin",
      number: "INV-2026-0002",
      type: "final",
      status: "sent",
      totalCents: 675_000,
      issueDate: "2026-10-20",
      dueDate: "2026-11-03",
      sentAt: "2026-10-20T17:00:00Z",
    },
  ] satisfies LedgerInvoice[],
  payments: [
    {
      id: "p1",
      number: "PMT-1",
      amountCents: 300_000,
      status: "cleared",
      receivedOn: "2026-10-02",
    },
    {
      id: "p2",
      number: "PMT-2",
      amountCents: 400_000,
      status: "received",
      receivedOn: "2026-11-05",
    },
    {
      id: "p3",
      number: "PMT-3",
      amountCents: 100_000,
      status: "bounced",
      receivedOn: "2026-11-06",
    },
    {
      id: "p4",
      number: "PMT-4",
      amountCents: 60_000,
      status: "received",
      receivedOn: "2026-11-10",
    },
  ] satisfies LedgerPayment[],
  applications: [
    { paymentId: "p1", invoiceId: "dep", amountCents: 300_000 },
    { paymentId: "p2", invoiceId: "fin", amountCents: 400_000 },
    { paymentId: "p3", invoiceId: "fin", amountCents: 100_000 },
    { paymentId: "p4", invoiceId: "fin", amountCents: 50_000 },
  ],
  refunds: [{ paymentId: "p4", amountCents: 5_000 }],
};
