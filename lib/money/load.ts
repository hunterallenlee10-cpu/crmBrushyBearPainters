import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  computeJobLedger,
  type CreditStatus,
  type CreditType,
  type InvoiceStatus,
  type InvoiceType,
  type JobLedger,
  type LedgerApplication,
  type LedgerCredit,
  type LedgerInvoice,
  type LedgerPayment,
  type LedgerRefund,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/domain/ledger";
import { monthOf } from "@/lib/domain/ledger/periods";
import { pacificToday } from "@/lib/domain/scheduling/dates";

type Db = SupabaseClient<Database>;

/**
 * Loads a job's money records and runs the pure ledger (lib/domain/ledger)
 * over them. Pass the person's own client for screens (row security hides
 * money from roles without financials:read — the loader then returns null) or
 * the service client for trusted code.
 */

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  sourceType: string | null;
  sourceId: string | null;
};

export type InvoiceDetail = LedgerInvoice & {
  terms: string | null;
  notes: string | null;
  voidReason: string | null;
  accountingSyncStatus: string;
  pdfDocumentId: string | null;
  lines: InvoiceLine[];
};

export type PaymentDetail = LedgerPayment & {
  reference: string | null;
  notes: string | null;
  statusReason: string | null;
  accountingSyncStatus: string;
  createdAt: string;
};

export type RefundDetail = LedgerRefund & {
  id: string;
  method: string;
  reference: string | null;
  reason: string;
  refundedOn: string;
  createdAt: string;
};

export type CreditDetail = LedgerCredit & {
  reason: string;
  requestedAt: string;
  requestedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  onTimeCreditId: string | null;
};

export type JobMoney = {
  jobId: string;
  orgId: string;
  stage: string;
  today: string;
  contractBaseCents: number | null;
  contractFromEstimate: boolean;
  invoices: InvoiceDetail[];
  payments: PaymentDetail[];
  applications: LedgerApplication[];
  refunds: RefundDetail[];
  credits: CreditDetail[];
  ledger: JobLedger;
  /** Closed months ("YYYY-MM") for this company. */
  closedMonths: Set<string>;
};

const asInvoiceType = (v: string) => v as InvoiceType;
const asInvoiceStatus = (v: string) => v as InvoiceStatus;
const asPaymentStatus = (v: string) => v as PaymentStatus;
const asCreditStatus = (v: string) => v as CreditStatus;

export async function loadJobMoney(
  db: Db,
  jobId: string,
  now = new Date(),
): Promise<JobMoney | null> {
  const { data: job } = await db
    .from("jobs")
    .select("id, org_id, stage")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const [fin, invoices, lines, payments, apps, refunds, credits, closes] = await Promise.all([
    db
      .from("job_financials")
      .select("contract_cents, estimate_contract_cents")
      .eq("job_id", jobId)
      .maybeSingle(),
    db
      .from("invoices")
      .select(
        "id, invoice_number, invoice_type, status, total_cents, issue_date, due_date, sent_at, viewed_at, created_at, terms, notes, void_reason, accounting_sync_status, pdf_document_id",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
    db
      .from("invoice_lines")
      .select(
        "id, invoice_id, description, quantity, unit_price_cents, amount_cents, source_type, source_id, sort_order, invoices!inner(job_id)",
      )
      .eq("invoices.job_id", jobId)
      .order("sort_order", { ascending: true }),
    db
      .from("payments")
      .select(
        "id, payment_number, method, amount_cents, status, received_on, cleared_on, reference, notes, status_reason, accounting_sync_status, created_at",
      )
      .eq("job_id", jobId)
      .order("received_on", { ascending: true })
      .order("created_at", { ascending: true }),
    db
      .from("payment_applications")
      .select("payment_id, invoice_id, amount_cents, created_at, payments!inner(job_id)")
      .eq("payments.job_id", jobId)
      .order("created_at", { ascending: true }),
    db
      .from("refunds")
      .select("id, payment_id, amount_cents, refunded_on, method, reference, reason, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
    db
      .from("credits")
      .select(
        "id, credit_type, amount_cents, status, invoice_id, reason, requested_at, requested_by, decided_at, decision_note, on_time_credit_id",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
    db.from("month_closes").select("month").eq("org_id", job.org_id).eq("status", "closed"),
  ]);
  const failed = invoices.error ?? payments.error;
  if (failed) throw failed;

  const linesBy = new Map<string, InvoiceLine[]>();
  for (const l of lines.data ?? []) {
    const arr = linesBy.get(l.invoice_id) ?? [];
    arr.push({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unitPriceCents: l.unit_price_cents,
      amountCents: l.amount_cents,
      sourceType: l.source_type,
      sourceId: l.source_id,
    });
    linesBy.set(l.invoice_id, arr);
  }
  const inv: InvoiceDetail[] = (invoices.data ?? []).map((i) => ({
    id: i.id,
    number: i.invoice_number,
    type: asInvoiceType(i.invoice_type),
    status: asInvoiceStatus(i.status),
    totalCents: i.total_cents,
    issueDate: i.issue_date,
    dueDate: i.due_date,
    sentAt: i.sent_at,
    viewedAt: i.viewed_at,
    createdAt: i.created_at,
    terms: i.terms,
    notes: i.notes,
    voidReason: i.void_reason,
    accountingSyncStatus: i.accounting_sync_status,
    pdfDocumentId: i.pdf_document_id,
    lines: linesBy.get(i.id) ?? [],
  }));
  const pay: PaymentDetail[] = (payments.data ?? []).map((p) => ({
    id: p.id,
    number: p.payment_number,
    amountCents: p.amount_cents,
    status: asPaymentStatus(p.status),
    receivedOn: p.received_on,
    clearedOn: p.cleared_on,
    method: p.method as PaymentMethod,
    reference: p.reference,
    notes: p.notes,
    statusReason: p.status_reason,
    accountingSyncStatus: p.accounting_sync_status,
    createdAt: p.created_at,
  }));
  const applications: LedgerApplication[] = (apps.data ?? []).map((a) => ({
    paymentId: a.payment_id,
    invoiceId: a.invoice_id,
    amountCents: a.amount_cents,
  }));
  const ref: RefundDetail[] = (refunds.data ?? []).map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    amountCents: r.amount_cents,
    refundedOn: r.refunded_on,
    method: r.method,
    reference: r.reference,
    reason: r.reason,
    createdAt: r.created_at,
  }));
  const cr: CreditDetail[] = (credits.data ?? []).map((c) => ({
    id: c.id,
    type: c.credit_type as CreditType,
    amountCents: c.amount_cents,
    status: asCreditStatus(c.status),
    invoiceId: c.invoice_id,
    reason: c.reason,
    requestedAt: c.requested_at,
    requestedBy: c.requested_by,
    decidedAt: c.decided_at,
    decisionNote: c.decision_note,
    onTimeCreditId: c.on_time_credit_id,
  }));
  const today = pacificToday(now);
  const contractBaseCents = fin.data?.contract_cents ?? null;
  const ledger = computeJobLedger({
    contractBaseCents,
    invoices: inv,
    payments: pay,
    applications,
    refunds: ref,
    credits: cr,
    today,
  });
  return {
    jobId: job.id,
    orgId: job.org_id,
    stage: job.stage,
    today,
    contractBaseCents,
    contractFromEstimate: fin.data?.estimate_contract_cents != null,
    invoices: inv,
    payments: pay,
    applications,
    refunds: ref,
    credits: cr,
    ledger,
    closedMonths: new Set((closes.data ?? []).map((m) => monthOf(m.month))),
  };
}

export type LedgerRow = {
  jobId: string;
  contractCents: number;
  billedCents: number;
  leftToBillCents: number;
  collectedCents: number;
  balanceCents: number;
  dueCents: number;
  unappliedCents: number;
  overdueInvoices: number;
};

/**
 * Ledger totals for many jobs from public.job_ledger (one query; the view does
 * the math in Postgres). Empty for people without financials:read.
 */
export async function loadLedgerRows(
  db: Db,
  jobIds: readonly string[],
): Promise<Map<string, LedgerRow>> {
  const out = new Map<string, LedgerRow>();
  for (let i = 0; i < jobIds.length; i += 300) {
    const ids = jobIds.slice(i, i + 300);
    const { data, error } = await db
      .from("job_ledger")
      .select(
        "job_id, contract_cents, billed_cents, left_to_bill_cents, collected_cents, balance_cents, due_cents, unapplied_cents, overdue_invoices",
      )
      .in("job_id", ids);
    if (error) throw error;
    for (const r of data ?? []) {
      if (!r.job_id) continue;
      out.set(r.job_id, {
        jobId: r.job_id,
        contractCents: r.contract_cents ?? 0,
        billedCents: r.billed_cents ?? 0,
        leftToBillCents: r.left_to_bill_cents ?? 0,
        collectedCents: r.collected_cents ?? 0,
        balanceCents: r.balance_cents ?? 0,
        dueCents: r.due_cents ?? 0,
        unappliedCents: r.unapplied_cents ?? 0,
        overdueInvoices: r.overdue_invoices ?? 0,
      });
    }
  }
  return out;
}

/** Money applied to a job's live deposit invoice (cents), or null without one. */
export async function depositApplied(
  db: Db,
  jobId: string,
): Promise<{ invoiceId: string; collectedCents: number } | null> {
  const { data } = await db
    .from("invoice_ledger")
    .select("id, collected_cents")
    .eq("job_id", jobId)
    .eq("invoice_type", "deposit")
    .neq("status", "void")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return null;
  return { invoiceId: data.id, collectedCents: data.collected_cents ?? 0 };
}
