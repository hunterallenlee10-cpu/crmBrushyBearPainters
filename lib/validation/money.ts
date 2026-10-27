import { z } from "zod";
import {
  CREDIT_TYPES,
  EXPENSE_CATEGORIES,
  INVOICE_TYPES,
  PAYMENT_METHODS,
} from "@/lib/domain/ledger/types";
import { isMonthKey, LOCK_OVERRIDE_REASON_MIN } from "@/lib/domain/ledger/periods";
import { isIsoDate } from "@/lib/domain/scheduling/dates";
import { moneyCents, optionalText } from "./common";

/**
 * Money inputs (SPEC §10). Shared by the Financial section's forms and its
 * server actions; kept out of "use server" files (Next treats inline
 * callbacks there as server actions).
 */

const id = z.uuid();
const day = z.string().refine((v) => isIsoDate(v), "Use a date like 2026-11-05.");
const optionalDay = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null)
  .refine((v) => v === null || isIsoDate(v), "Use a date like 2026-11-05.");

/** Owner override for a closed month (blank when the month isn't closed). */
const overrideReason = z
  .string()
  .trim()
  .max(500, "Keep it under 500 characters.")
  .optional()
  .transform((v) => (v ? v : null))
  .refine(
    (v) => v === null || v.length >= LOCK_OVERRIDE_REASON_MIN,
    `Say why you're changing a closed month (at least ${LOCK_OVERRIDE_REASON_MIN} characters).`,
  );

const reason = (min = 3) =>
  z
    .string()
    .trim()
    .min(min, `Say why (at least ${min} characters).`)
    .max(500, "Keep it under 500 characters.");

/** A signed dollar amount ("-25.00" allowed) for invoice lines. */
export const signedMoneyCents = (label: string) =>
  z.string().transform((v, ctx) => {
    const t = v.trim();
    const negative = t.startsWith("-") || t.startsWith("−");
    const clean = t.replace(/^[-−]/, "").replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
      ctx.addIssue({ code: "custom", message: `${label} must be a dollar amount like 250.00.` });
      return z.NEVER;
    }
    const [whole, frac = ""] = clean.split(".");
    const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
    return negative ? -cents : cents;
  });

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, "Describe the line.").max(500),
  amount: signedMoneyCents("Amount"),
});

export const createInvoiceSchema = z.object({
  jobId: id,
  type: z.enum(INVOICE_TYPES),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one line.").max(50),
  dueDate: optionalDay,
  terms: optionalText(500),
  notes: optionalText(2000),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

export const updateInvoiceSchema = createInvoiceSchema
  .omit({ jobId: true, type: true })
  .extend({ invoiceId: id });

export const sendInvoiceSchema = z
  .object({
    invoiceId: id,
    issueDate: day,
    dueDate: day,
    channels: z.array(z.enum(["sms", "email"])).max(2),
    smsBody: optionalText(1000),
    emailSubject: optionalText(200),
    emailBody: optionalText(5000),
    overrideReason,
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: "The due date can't be before the issue date.",
    path: ["dueDate"],
  });
export type SendInvoiceInput = z.input<typeof sendInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  invoiceId: id,
  reason: reason(),
  overrideReason,
});

export const allocationSchema = z.object({
  invoiceId: id,
  amount: moneyCents("Amount"),
});

export const recordPaymentSchema = z.object({
  jobId: id,
  method: z.enum(PAYMENT_METHODS),
  amount: moneyCents("Amount").refine((v) => v > 0, "Enter an amount above $0."),
  receivedOn: day,
  reference: optionalText(120),
  notes: optionalText(2000),
  allocations: z.array(allocationSchema).max(50),
  overrideReason,
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const setApplicationsSchema = z.object({
  paymentId: id,
  allocations: z.array(allocationSchema).max(50),
  overrideReason,
});

export const paymentStatusSchema = z
  .object({
    paymentId: id,
    action: z.enum(["clear", "bounce", "void"]),
    reason: optionalText(500),
    on: optionalDay,
    overrideReason,
  })
  .refine((v) => v.action === "clear" || (v.reason ?? "").length >= 3, {
    message: "Say what happened (at least 3 characters).",
    path: ["reason"],
  });

export const refundSchema = z.object({
  paymentId: id,
  amount: moneyCents("Amount").refine((v) => v > 0, "Enter an amount above $0."),
  refundedOn: day,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
  reason: reason(),
  invoiceId: id.nullable().optional(),
  overrideReason,
});

export const createCreditSchema = z.object({
  jobId: id,
  type: z.enum(CREDIT_TYPES).exclude(["on_time_guarantee"]),
  amount: moneyCents("Amount").refine((v) => v > 0, "Enter an amount above $0."),
  reason: reason(),
  approve: z.boolean().default(false),
});

export const decideCreditSchema = z
  .object({
    creditId: id,
    decision: z.enum(["approve", "reject", "void"]),
    note: optionalText(1000),
  })
  .refine((v) => v.decision === "approve" || (v.note ?? "").length >= 3, {
    message: "Say why (at least 3 characters).",
    path: ["note"],
  });

export const jobIdSchema = z.object({ jobId: id });

export const expenseSchema = z.object({
  jobId: id,
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().min(1, "Describe the expense.").max(300),
  vendor: optionalText(160),
  amount: moneyCents("Amount").refine((v) => v > 0, "Enter an amount above $0."),
  spentOn: day,
});

export const removeExpenseSchema = z.object({ expenseId: id, reason: reason() });

export const closeMonthSchema = z.object({
  month: z.string().refine((v) => isMonthKey(v), "Pick a month."),
  note: optionalText(1000),
});

export const reopenMonthSchema = z.object({
  month: z.string().refine((v) => isMonthKey(v), "Pick a month."),
  reason: reason(LOCK_OVERRIDE_REASON_MIN),
});
