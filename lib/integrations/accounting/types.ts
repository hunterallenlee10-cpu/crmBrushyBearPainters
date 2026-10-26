import { type RelatedRecord, type SendStatus } from "@/lib/integrations/core";

/** Money is integer cents everywhere; adapters convert at the provider boundary. */
export type AccountingInvoiceLine = {
  description: string;
  /** Line total in cents. */
  amountCents: number;
  /** Provider item/product id (QuickBooks ItemRef). Falls back to the provider default. */
  itemExternalId?: string;
};

export type AccountingInvoiceInput = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  customerEmail?: string;
  /** Provider customer id. Required by QuickBooks. */
  customerExternalId?: string;
  /** YYYY-MM-DD in America/Los_Angeles. */
  issueDate: string;
  dueDate?: string;
  lines: readonly AccountingInvoiceLine[];
  /** Present → update the provider invoice instead of creating one. */
  externalId?: string;
  /** QuickBooks optimistic-lock token, required for updates. */
  syncToken?: string;
  related?: RelatedRecord | null;
};

export type AccountingPaymentInput = {
  paymentId: string;
  invoiceId: string;
  /** Provider invoice id the payment applies to. */
  invoiceExternalId?: string;
  customerExternalId?: string;
  amountCents: number;
  /** YYYY-MM-DD in America/Los_Angeles. */
  receivedDate: string;
  method?: string;
  reference?: string;
  related?: RelatedRecord | null;
};

export type AccountingSyncResult = {
  status: SendStatus;
  externalId?: string;
  syncToken?: string;
  outboxId?: string;
  error?: string;
};

export interface AccountingProvider {
  readonly provider: string;
  syncInvoice(invoice: AccountingInvoiceInput): Promise<AccountingSyncResult>;
  syncPayment(payment: AccountingPaymentInput): Promise<AccountingSyncResult>;
}

export function invoiceTotalCents(invoice: AccountingInvoiceInput): number {
  return invoice.lines.reduce((sum, line) => sum + line.amountCents, 0);
}
