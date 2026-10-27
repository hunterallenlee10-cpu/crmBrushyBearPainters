"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import {
  checkApplications,
  checkFullyApplied,
  openInvoices,
  type Allocation,
} from "@/lib/domain/ledger/applications";
import { checkNewInvoice } from "@/lib/domain/ledger/operations";
import { isLocked, lockDecision } from "@/lib/domain/ledger/periods";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { logError } from "@/lib/log";
import { previewPaymentSync } from "@/lib/money/accounting";
import { afterMoneyChange, ensureFinalInvoice } from "@/lib/money/automation";
import { loadJobMoney, type JobMoney } from "@/lib/money/load";
import { sendInvoice as sendInvoiceFlow } from "@/lib/money/send";
import {
  createCreditSchema,
  createInvoiceSchema,
  decideCreditSchema,
  jobIdSchema,
  paymentStatusSchema,
  recordPaymentSchema,
  refundSchema,
  removeExpenseSchema,
  sendInvoiceSchema,
  setApplicationsSchema,
  updateInvoiceSchema,
  voidInvoiceSchema,
} from "@/lib/validation/money";

/**
 * Job → Financial mutations (SPEC §8.5 #5, §10). Zod-validated, permission-
 * checked here, then the service-role money functions re-check the person's
 * permission, the company, the closed-month lock and every ledger limit in
 * one transaction; audit rows and events come from database triggers.
 * After each change the deposit check, the money gates and job health run.
 */

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/invoices", "layout");
  revalidatePath("/schedule/onboarding");
}

/** The job's money as the person sees it (row security), or not found. */
async function moneyFor(ctx: ActionContext, jobId: string): Promise<JobMoney> {
  const money = await loadJobMoney(ctx.supabase, jobId);
  if (!money) throw new ActionFailure(actionError("not_found", "That job isn't available."));
  return money;
}

async function jobOfInvoice(ctx: ActionContext, invoiceId: string): Promise<string> {
  const row = check(
    await ctx.supabase.from("invoices").select("job_id").eq("id", invoiceId).maybeSingle(),
  );
  if (!row) throw new ActionFailure(actionError("not_found", "That invoice isn't available."));
  return row.job_id;
}

async function jobOfPayment(ctx: ActionContext, paymentId: string): Promise<string> {
  const row = check(
    await ctx.supabase.from("payments").select("job_id").eq("id", paymentId).maybeSingle(),
  );
  if (!row) throw new ActionFailure(actionError("not_found", "That payment isn't available."));
  return row.job_id;
}

/** Closed-month check in plain words before the database's own check. */
function checkLock(
  ctx: ActionContext,
  money: JobMoney,
  days: readonly (string | null | undefined)[],
  reason: string | null,
) {
  const locked = days.some((d) => isLocked(d, money.closedMonths));
  const decision = lockDecision({
    locked,
    canOverride: ctx.viewer.can("finance:override_lock"),
    reason,
  });
  if (!decision.ok) {
    throw new ActionFailure(
      actionError(
        decision.needsReason ? "validation" : "forbidden",
        decision.message,
        decision.needsReason ? { overrideReason: [decision.message] } : undefined,
      ),
    );
  }
}

async function after(ctx: ActionContext, jobId: string) {
  const service = await ctx.service();
  await afterMoneyChange(service, jobId).catch((e: unknown) => logError("money.after", e));
  refresh(jobId);
}

function toJsonLines(lines: readonly { description: string; amount: number }[]) {
  return lines.map((l) => ({
    description: l.description,
    unit_price_cents: l.amount,
    quantity: 1,
  }));
}

function toJsonApps(allocations: readonly Allocation[]) {
  return allocations.map((a) => ({ invoice_id: a.invoiceId, amount_cents: a.amountCents }));
}

// --- Invoices -----------------------------------------------------------------------

export const createInvoice = defineAction({
  name: "money.invoice.create",
  schema: createInvoiceSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    const money = await moneyFor(ctx, v.jobId);
    const total = v.lines.reduce((s, l) => s + l.amount, 0);
    const problem = checkNewInvoice(money.invoices, v.type, total);
    if (problem) throw new ActionFailure(actionError("validation", problem));
    const service = await ctx.service();
    const { data, error } = await service.rpc("create_invoice", {
      p_job: v.jobId,
      p_type: v.type,
      p_lines: toJsonLines(v.lines),
      p_due_date: v.dueDate ?? undefined,
      p_terms: v.terms ?? undefined,
      p_notes: v.notes ?? undefined,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await after(ctx, v.jobId);
    return { id: data };
  },
});

export const updateInvoiceDraft = defineAction({
  name: "money.invoice.update",
  schema: updateInvoiceSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    const jobId = await jobOfInvoice(ctx, v.invoiceId);
    const service = await ctx.service();
    const { error } = await service.rpc("update_invoice_draft", {
      p_invoice: v.invoiceId,
      p_lines: toJsonLines(v.lines),
      p_due_date: v.dueDate ?? undefined,
      p_terms: v.terms ?? undefined,
      p_notes: v.notes ?? undefined,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, jobId);
    return { id: v.invoiceId };
  },
});

export const sendInvoice = defineAction({
  name: "money.invoice.send",
  schema: sendInvoiceSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    const jobId = await jobOfInvoice(ctx, v.invoiceId);
    const money = await moneyFor(ctx, jobId);
    const inv = money.invoices.find((i) => i.id === v.invoiceId);
    checkLock(ctx, money, [v.issueDate, inv?.issueDate], v.overrideReason);
    const result = await sendInvoiceFlow(ctx, {
      invoiceId: v.invoiceId,
      issueDate: v.issueDate,
      dueDate: v.dueDate,
      channels: v.channels,
      smsBody: v.smsBody,
      emailSubject: v.emailSubject,
      emailBody: v.emailBody,
      overrideReason: v.overrideReason,
    });
    refresh(jobId);
    return result;
  },
});

export const voidInvoice = defineAction({
  name: "money.invoice.void",
  schema: voidInvoiceSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    const jobId = await jobOfInvoice(ctx, v.invoiceId);
    const money = await moneyFor(ctx, jobId);
    const inv = money.ledger.invoices.find((i) => i.id === v.invoiceId);
    if (inv && inv.collectedCents > 0) {
      throw new ActionFailure(
        actionError(
          "validation",
          `Payments are applied to ${inv.number}. Move or remove them first.`,
        ),
      );
    }
    checkLock(ctx, money, [inv?.issueDate], v.overrideReason);
    const service = await ctx.service();
    const { error } = await service.rpc("void_invoice", {
      p_invoice: v.invoiceId,
      p_reason: v.reason,
      p_override_reason: v.overrideReason ?? undefined,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, jobId);
    return { id: v.invoiceId };
  },
});

export const draftFinalInvoice = defineAction({
  name: "money.invoice.draft_final",
  schema: jobIdSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    await moneyFor(ctx, v.jobId);
    const service = await ctx.service();
    const { data, error } = await service.rpc("draft_final_invoice", { p_job: v.jobId });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await after(ctx, v.jobId);
    return { id: data };
  },
});

export const placeCredits = defineAction({
  name: "money.credits.place",
  schema: jobIdSchema,
  permissions: ["invoices:edit"],
  handler: async (v, ctx) => {
    await moneyFor(ctx, v.jobId);
    const service = await ctx.service();
    // At Completed the final invoice may not exist yet: draft it (it carries the credits).
    await ensureFinalInvoice(service, v.jobId);
    const { data, error } = await service.rpc("place_job_credits", { p_job: v.jobId });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, v.jobId);
    return { placed: data ?? 0 };
  },
});

// --- Payments -------------------------------------------------------------------------

export const recordPayment = defineAction({
  name: "money.payment.record",
  schema: recordPaymentSchema,
  permissions: ["payments:record"],
  handler: async (v, ctx) => {
    const money = await moneyFor(ctx, v.jobId);
    if (v.receivedOn > pacificToday(new Date())) {
      throw new ActionFailure(
        actionError("validation", "The received date can't be in the future.", {
          receivedOn: ["The received date can't be in the future."],
        }),
      );
    }
    checkLock(ctx, money, [v.receivedOn], v.overrideReason);
    const allocations: Allocation[] = v.allocations
      .filter((a) => a.amount > 0)
      .map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amount }));
    const live = money.applications.filter((a) =>
      money.payments.some(
        (p) => p.id === a.paymentId && (p.status === "received" || p.status === "cleared"),
      ),
    );
    const problems = checkApplications({
      payment: { id: "new", number: "This payment", availableCents: v.amount, status: "received" },
      invoices: money.ledger.invoices,
      applications: live,
      next: allocations,
    });
    if (problems.length) {
      throw new ActionFailure(actionError("validation", problems.map((p) => p.message).join(" ")));
    }
    const applied = allocations.reduce((s, a) => s + a.amountCents, 0);
    const open = openInvoices(money.ledger.invoices).reduce((s, i) => s + i.balanceCents, 0);
    const forced = checkFullyApplied(v.amount, applied, open);
    if (forced) throw new ActionFailure(actionError("validation", forced));

    const service = await ctx.service();
    const { data, error } = await service.rpc("record_payment", {
      p_job: v.jobId,
      p_method: v.method,
      p_amount_cents: v.amount,
      p_received_on: v.receivedOn,
      p_applications: toJsonApps(allocations),
      p_reference: v.reference ?? undefined,
      p_notes: v.notes ?? undefined,
      p_override_reason: v.overrideReason ?? undefined,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await previewPaymentSync(service, data, ctx.viewer.id);
    await after(ctx, v.jobId);
    return { id: data };
  },
});

export const setPaymentApplications = defineAction({
  name: "money.payment.apply",
  schema: setApplicationsSchema,
  permissions: ["payments:record"],
  handler: async (v, ctx) => {
    const jobId = await jobOfPayment(ctx, v.paymentId);
    const money = await moneyFor(ctx, jobId);
    const payment = money.ledger.payments.find((p) => p.id === v.paymentId);
    if (!payment)
      throw new ActionFailure(actionError("not_found", "That payment isn't available."));
    checkLock(ctx, money, [payment.receivedOn], v.overrideReason);
    const allocations: Allocation[] = v.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amountCents: a.amount,
    }));
    const live = money.applications.filter((a) =>
      money.payments.some(
        (p) => p.id === a.paymentId && (p.status === "received" || p.status === "cleared"),
      ),
    );
    const problems = checkApplications({
      payment,
      invoices: money.ledger.invoices,
      applications: live,
      next: allocations,
    });
    if (problems.length) {
      throw new ActionFailure(actionError("validation", problems.map((p) => p.message).join(" ")));
    }
    const service = await ctx.service();
    const { error } = await service.rpc("set_payment_applications", {
      p_payment: v.paymentId,
      p_applications: toJsonApps(allocations.filter((a) => a.amountCents > 0)),
      p_override_reason: v.overrideReason ?? undefined,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, jobId);
    return { id: v.paymentId };
  },
});

export const updatePaymentStatus = defineAction({
  name: "money.payment.status",
  schema: paymentStatusSchema,
  permissions: ["payments:record"],
  handler: async (v, ctx) => {
    const jobId = await jobOfPayment(ctx, v.paymentId);
    const money = await moneyFor(ctx, jobId);
    const payment = money.payments.find((p) => p.id === v.paymentId);
    checkLock(ctx, money, [payment?.receivedOn], v.overrideReason);
    const service = await ctx.service();
    const { error } = await service.rpc("update_payment_status", {
      p_payment: v.paymentId,
      p_action: v.action,
      p_reason: v.reason ?? undefined,
      p_on: v.on ?? undefined,
      p_override_reason: v.overrideReason ?? undefined,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, jobId);
    return { id: v.paymentId };
  },
});

export const refundPayment = defineAction({
  name: "money.payment.refund",
  schema: refundSchema,
  permissions: ["payments:record"],
  handler: async (v, ctx) => {
    const jobId = await jobOfPayment(ctx, v.paymentId);
    const money = await moneyFor(ctx, jobId);
    const payment = money.ledger.payments.find((p) => p.id === v.paymentId);
    if (!payment)
      throw new ActionFailure(actionError("not_found", "That payment isn't available."));
    if (v.amount > payment.availableCents) {
      throw new ActionFailure(
        actionError("validation", "A refund can't be more than what's left of the payment.", {
          amount: ["A refund can't be more than what's left of the payment."],
        }),
      );
    }
    checkLock(ctx, money, [payment.receivedOn, v.refundedOn], v.overrideReason);
    const service = await ctx.service();
    const { data, error } = await service.rpc("refund_payment", {
      p_payment: v.paymentId,
      p_amount_cents: v.amount,
      p_refunded_on: v.refundedOn,
      p_method: v.method,
      p_reason: v.reason,
      p_reference: v.reference ?? undefined,
      p_invoice: v.invoiceId ?? undefined,
      p_override_reason: v.overrideReason ?? undefined,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await after(ctx, jobId);
    return { id: data };
  },
});

// --- Credits --------------------------------------------------------------------------

export const createCredit = defineAction({
  name: "money.credit.create",
  schema: createCreditSchema,
  permissions: ["financials:read"],
  handler: async (v, ctx) => {
    if (!ctx.viewer.can("invoices:edit") && !ctx.viewer.can("credits:approve")) {
      throw new ActionFailure(
        actionError("forbidden", "You don't have permission to add credits."),
      );
    }
    if (v.approve && !ctx.viewer.can("credits:approve")) {
      throw new ActionFailure(
        actionError("forbidden", "Only people who approve credits can approve one."),
      );
    }
    await moneyFor(ctx, v.jobId);
    const service = await ctx.service();
    const { data, error } = await service.rpc("create_credit", {
      p_job: v.jobId,
      p_type: v.type,
      p_amount_cents: v.amount,
      p_reason: v.reason,
      p_approve: v.approve,
    });
    if (error || !data) throw new ActionFailure(mapDbError(error));
    await after(ctx, v.jobId);
    return { id: data };
  },
});

export const decideCredit = defineAction({
  name: "money.credit.decide",
  schema: decideCreditSchema,
  permissions: ["credits:approve"],
  handler: async (v, ctx) => {
    const row = check(
      await ctx.supabase.from("credits").select("job_id").eq("id", v.creditId).maybeSingle(),
    );
    if (!row) throw new ActionFailure(actionError("not_found", "That credit isn't available."));
    const service = await ctx.service();
    const { error } = await service.rpc("decide_credit", {
      p_credit: v.creditId,
      p_decision: v.decision,
      p_note: v.note ?? undefined,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await after(ctx, row.job_id);
    return { id: v.creditId };
  },
});

// --- Expenses (job costing) -------------------------------------------------------------

export const removeExpense = defineAction({
  name: "money.expense.remove",
  schema: removeExpenseSchema,
  permissions: ["job_costing:read"],
  handler: async (v, ctx) => {
    const row = check(
      await ctx.supabase
        .from("job_expenses")
        .select("id, job_id")
        .eq("id", v.expenseId)
        .maybeSingle(),
    );
    if (!row) throw new ActionFailure(actionError("not_found", "That expense isn't available."));
    // Soft delete through the service client (the row leaves the person's view).
    const service = await ctx.service();
    const { error } = await service
      .from("job_expenses")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: ctx.viewer.id,
        delete_reason: v.reason,
      })
      .eq("id", v.expenseId);
    if (error) throw new ActionFailure(mapDbError(error));
    refresh(row.job_id);
    return { id: v.expenseId };
  },
});
