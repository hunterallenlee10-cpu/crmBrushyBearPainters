import type {
  CreditStatus,
  CreditType,
  ExpenseCategory,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/domain/ledger/types";
import type { ReconcileWarning } from "@/lib/domain/ledger/reconcile";
import type { JobCostingView } from "@/lib/money/costing";

/** Serializable props for the Financial section (server → client). */

export type FinInvoice = {
  id: string;
  number: string;
  type: InvoiceType;
  status: InvoiceStatus;
  displayStatus: InvoiceStatus;
  totalCents: number;
  collectedCents: number;
  balanceCents: number;
  daysPastDue: number;
  issued: boolean;
  issueDate: string | null;
  dueDate: string | null;
  sentAt: string | null;
  createdAt: string | null;
  terms: string | null;
  notes: string | null;
  voidReason: string | null;
  accountingSyncStatus: string;
  hasPdfDocument: boolean;
  lines: {
    id: string;
    description: string;
    amountCents: number;
    sourceType: string | null;
  }[];
};

export type FinPayment = {
  id: string;
  number: string;
  method: PaymentMethod | undefined;
  amountCents: number;
  status: PaymentStatus;
  receivedOn: string;
  clearedOn: string | null;
  reference: string | null;
  notes: string | null;
  statusReason: string | null;
  accountingSyncStatus: string;
  appliedCents: number;
  unappliedCents: number;
  availableCents: number;
  refundedCents: number;
  applications: { invoiceId: string; number: string; amountCents: number }[];
};

export type FinRefund = {
  id: string;
  paymentNumber: string;
  amountCents: number;
  refundedOn: string;
  method: string;
  reason: string;
};

export type FinCredit = {
  id: string;
  type: CreditType;
  amountCents: number;
  status: CreditStatus;
  reason: string;
  invoiceNumber: string | null;
  requestedAt: string;
  decisionNote: string | null;
  fromSchedule: boolean;
};

export type FinOutbox = {
  id: string;
  operation: string;
  subject: string | null;
  status: string;
  createdAt: string;
  relatedType: string | null;
};

export type FinancialView = {
  jobId: string;
  jobNumber: string;
  stage: string;
  today: string;
  can: {
    editInvoices: boolean;
    recordPayments: boolean;
    approveCredits: boolean;
    jobCosting: boolean;
    overrideLock: boolean;
    readOnly: boolean;
  };
  summary: {
    contractBaseCents: number;
    creditsCents: number;
    pendingCreditsCents: number;
    contractCents: number;
    billedCents: number;
    leftToBillCents: number;
    collectedCents: number;
    balanceCents: number;
    dueCents: number;
    unappliedCents: number;
    unclearedCents: number;
    contractFromEstimate: boolean;
  };
  warnings: ReconcileWarning[];
  invoices: FinInvoice[];
  payments: FinPayment[];
  refunds: FinRefund[];
  credits: FinCredit[];
  closedMonths: string[];
  costing: JobCostingView | null;
  outbox: FinOutbox[] | null;
  messaging: {
    customerFirstName: string | null;
    senderName: string;
    companyName: string;
    smsBlock: string | null;
    emailBlock: string | null;
  };
  expenseCategories: readonly ExpenseCategory[];
};
