import { Wallet } from "lucide-react";
import { EmptySection } from "@/components/jobs/empty-section";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { reconcile } from "@/lib/domain/ledger/reconcile";
import { EXPENSE_CATEGORIES } from "@/lib/domain/ledger/types";
import { isJobStageId } from "@/lib/domain/stages";
import { jobContactBlockReason } from "@/lib/jobs/messaging";
import { logError } from "@/lib/log";
import { loadJobCosting } from "@/lib/money/costing";
import { loadJobMoney } from "@/lib/money/load";
import { FinancialClient } from "./financial/financial-client";
import type { FinancialView } from "./financial/types";

/**
 * Job → Financial (SPEC §8.5 #5, §10): Worksheet (Money Summary, Needs
 * attention, contract & changes, billing, payments, credits), Invoices,
 * Payments, Job Costing (owners and bookkeeper) and Accounting. Every figure
 * comes from the pure ledger (lib/domain/ledger) over the person's own rows.
 */
export async function FinancialSection({
  jobId,
  canReadInvoices,
  canReadFinancials,
  readOnly,
  initialTab,
}: {
  jobId: string;
  canReadInvoices: boolean;
  canReadFinancials: boolean;
  readOnly: boolean;
  initialTab?: string;
}) {
  if (!canReadInvoices || !canReadFinancials) {
    return (
      <EmptySection icon={Wallet} title="Financial">
        <p>Your role doesn&apos;t include job money. An owner or the office can help.</p>
      </EmptySection>
    );
  }
  const state = await getViewerState();
  if (state.status !== "ok") return null;
  const viewer = state.viewer;
  const supabase = await createSupabaseServerClient();
  const money = await loadJobMoney(supabase, jobId);
  if (!money) {
    return (
      <EmptySection icon={Wallet} title="Financial">
        <p>That job isn&apos;t available.</p>
      </EmptySection>
    );
  }
  const can = {
    editInvoices: viewer.can("invoices:edit") && !readOnly,
    recordPayments: viewer.can("payments:record") && !readOnly,
    approveCredits: viewer.can("credits:approve") && !readOnly,
    jobCosting: viewer.can("job_costing:read"),
    overrideLock: viewer.can("finance:override_lock") && !readOnly,
    readOnly,
  };

  const [job, company, costing, outbox] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "job_number, lead_id, contact:contacts!jobs_primary_contact_id_fkey(id, first_name, last_name, mobile, phone, email, do_not_contact, opted_out_at), poc:profiles!jobs_point_of_contact_id_fkey(full_name)",
      )
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("company_settings").select("company_name").maybeSingle(),
    can.jobCosting
      ? loadJobCosting(supabase, jobId, money.ledger.contractCents).catch((e: unknown) => {
          logError("financial.costing", e);
          return null;
        })
      : Promise.resolve(null),
    (async () => {
      // "Would sync" previews for this job's invoices and payments (read after the money check).
      const ids = [...money.invoices.map((i) => i.id), ...money.payments.map((p) => p.id)];
      if (!ids.length) return [];
      const service = await createSupabaseServiceClient({ actorId: viewer.id });
      const { data } = await service
        .from("integration_outbox")
        .select("id, operation, subject, status, created_at, related_type")
        .eq("domain", "accounting")
        .in("related_id", ids)
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []).map((o) => ({
        id: o.id,
        operation: o.operation,
        subject: o.subject,
        status: o.status,
        createdAt: o.created_at,
        relatedType: o.related_type,
      }));
    })().catch((e: unknown) => {
      logError("financial.outbox", e);
      return null;
    }),
  ]);
  const contact = job.data?.contact ?? null;
  const recipient = contact
    ? {
        id: contact.id,
        name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
        mobile: contact.mobile,
        phone: contact.phone,
        email: contact.email,
        doNotContact: contact.do_not_contact,
        optedOutAt: contact.opted_out_at,
      }
    : null;
  const companyName = company.data?.company_name ?? "Brushy Bear Painters";
  const numbers = new Map(money.invoices.map((i) => [i.id, i.number]));
  const l = money.ledger;
  const stage = isJobStageId(money.stage) ? money.stage : "walkthrough_scheduled";

  const view: FinancialView = {
    jobId,
    jobNumber: job.data?.job_number ?? "",
    stage: money.stage,
    today: money.today,
    can,
    summary: {
      contractBaseCents: l.contractBaseCents,
      creditsCents: l.creditsCents,
      pendingCreditsCents: l.pendingCreditsCents,
      contractCents: l.contractCents,
      billedCents: l.billedCents,
      leftToBillCents: l.leftToBillCents,
      collectedCents: l.collectedCents,
      balanceCents: l.balanceCents,
      dueCents: l.dueCents,
      unappliedCents: l.unappliedCents,
      unclearedCents: l.unclearedCents,
      contractFromEstimate: money.contractFromEstimate,
    },
    warnings: reconcile({ ledger: l, credits: money.credits, stage, today: money.today }),
    invoices: money.invoices.map((i) => {
      const li = l.invoices.find((x) => x.id === i.id);
      return {
        id: i.id,
        number: i.number,
        type: i.type,
        status: i.status,
        displayStatus: li?.displayStatus ?? i.status,
        totalCents: i.totalCents,
        collectedCents: li?.collectedCents ?? 0,
        balanceCents: li?.balanceCents ?? 0,
        daysPastDue: li?.daysPastDue ?? 0,
        issued: li?.issued ?? false,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        sentAt: i.sentAt,
        createdAt: i.createdAt ?? null,
        terms: i.terms,
        notes: i.notes,
        voidReason: i.voidReason,
        accountingSyncStatus: i.accountingSyncStatus,
        hasPdfDocument: !!i.pdfDocumentId,
        lines: i.lines.map((x) => ({
          id: x.id,
          description: x.description,
          amountCents: x.amountCents,
          sourceType: x.sourceType,
        })),
      };
    }),
    payments: money.payments.map((p) => {
      const lp = l.payments.find((x) => x.id === p.id);
      return {
        id: p.id,
        number: p.number,
        method: p.method,
        amountCents: p.amountCents,
        status: p.status,
        receivedOn: p.receivedOn,
        clearedOn: p.clearedOn ?? null,
        reference: p.reference,
        notes: p.notes,
        statusReason: p.statusReason,
        accountingSyncStatus: p.accountingSyncStatus,
        appliedCents: lp?.appliedCents ?? 0,
        unappliedCents: lp?.unappliedCents ?? 0,
        availableCents: lp?.availableCents ?? 0,
        refundedCents: lp?.refundedCents ?? 0,
        applications: money.applications
          .filter((a) => a.paymentId === p.id)
          .map((a) => ({
            invoiceId: a.invoiceId,
            number: numbers.get(a.invoiceId) ?? "Invoice",
            amountCents: a.amountCents,
          })),
      };
    }),
    refunds: money.refunds.map((r) => ({
      id: r.id,
      paymentNumber: money.payments.find((p) => p.id === r.paymentId)?.number ?? "Payment",
      amountCents: r.amountCents,
      refundedOn: r.refundedOn,
      method: r.method,
      reason: r.reason,
    })),
    credits: money.credits.map((c) => ({
      id: c.id,
      type: c.type,
      amountCents: c.amountCents,
      status: c.status,
      reason: c.reason,
      invoiceNumber: c.invoiceId ? (numbers.get(c.invoiceId) ?? null) : null,
      requestedAt: c.requestedAt,
      decisionNote: c.decisionNote,
      fromSchedule: !!c.onTimeCreditId,
    })),
    closedMonths: [...money.closedMonths],
    costing,
    outbox,
    messaging: {
      customerFirstName: contact?.first_name ?? null,
      senderName: (job.data?.poc?.full_name ?? viewer.name) || companyName,
      companyName,
      smsBlock: jobContactBlockReason(recipient, "sms"),
      emailBlock: jobContactBlockReason(recipient, "email"),
    },
    expenseCategories: EXPENSE_CATEGORIES,
  };
  return <FinancialClient view={view} initialTab={initialTab} />;
}
