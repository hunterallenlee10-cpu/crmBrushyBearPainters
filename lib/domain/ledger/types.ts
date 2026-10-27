/**
 * Money vocabulary (SPEC §5.6, §10). Integer cents everywhere; dates are
 * Pacific calendar days as YYYY-MM-DD. Shared by the ledger, the screens and
 * the database (the same lists are CHECK constraints in
 * supabase/migrations/20261028000100_money.sql).
 */

export const INVOICE_TYPES = [
  "deposit",
  "progress",
  "final",
  "change_order",
  "credit_memo",
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  deposit: "Deposit",
  progress: "Progress",
  final: "Final",
  change_order: "Change order",
  credit_memo: "Credit memo",
};

/** Stored invoice statuses. Payment statuses and "overdue" are kept by the database from the facts. */
export const INVOICE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "void",
  "overdue",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export const PAYMENT_METHODS = [
  "check",
  "cash",
  "card",
  "ach",
  "zelle",
  "financing",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: "Check",
  cash: "Cash",
  card: "Card",
  ach: "ACH / bank transfer",
  zelle: "Zelle",
  financing: "Financing",
  other: "Other",
};

/**
 * Payment statuses. `void` (entered by mistake) is added to SPEC §5.6's list
 * so a typo can be reversed without pretending the money came back.
 */
export const PAYMENT_STATUSES = ["received", "cleared", "bounced", "refunded", "void"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  received: "Received",
  cleared: "Cleared",
  bounced: "Bounced",
  refunded: "Refunded",
  void: "Void",
};

/** Money that counts: received or cleared. Bounced, refunded and void payments never count. */
export function isLivePayment(status: PaymentStatus): boolean {
  return status === "received" || status === "cleared";
}

export const CREDIT_TYPES = ["on_time_guarantee", "goodwill", "discount", "referral"] as const;
export type CreditType = (typeof CREDIT_TYPES)[number];

export const CREDIT_TYPE_LABELS: Record<CreditType, string> = {
  on_time_guarantee: "On-Time Guarantee",
  goodwill: "Goodwill",
  discount: "Discount",
  referral: "Referral",
};

export const CREDIT_STATUSES = [
  "pending_approval",
  "approved",
  "applied",
  "rejected",
  "voided",
] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export const CREDIT_STATUS_LABELS: Record<CreditStatus, string> = {
  pending_approval: "Waiting for approval",
  approved: "Approved",
  applied: "On an invoice",
  rejected: "Rejected",
  voided: "Voided",
};

/** Approved credits lower the contract; applied ones are also on an invoice. */
export function creditCounts(status: CreditStatus): boolean {
  return status === "approved" || status === "applied";
}

export const EXPENSE_CATEGORIES = [
  "materials",
  "subcontractor",
  "equipment",
  "permit",
  "disposal",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  subcontractor: "Subcontractor",
  equipment: "Equipment rental",
  permit: "Permit / fee",
  disposal: "Disposal",
  other: "Other",
};

export type IsoDay = string;

export type LedgerInvoice = {
  id: string;
  number: string;
  type: InvoiceType;
  /** Stored lifecycle: "draft" until sent, "void" once voided; anything else counts as sent. */
  status: InvoiceStatus;
  totalCents: number;
  issueDate: IsoDay | null;
  dueDate: IsoDay | null;
  sentAt: string | null;
  viewedAt?: string | null;
  createdAt?: string;
};

export type LedgerPayment = {
  id: string;
  number: string;
  amountCents: number;
  status: PaymentStatus;
  receivedOn: IsoDay;
  method?: PaymentMethod;
  clearedOn?: IsoDay | null;
};

export type LedgerApplication = { paymentId: string; invoiceId: string; amountCents: number };
export type LedgerRefund = { paymentId: string; amountCents: number; refundedOn?: IsoDay };

export type LedgerCredit = {
  id: string;
  type: CreditType;
  amountCents: number;
  status: CreditStatus;
  invoiceId: string | null;
  reason?: string;
};
