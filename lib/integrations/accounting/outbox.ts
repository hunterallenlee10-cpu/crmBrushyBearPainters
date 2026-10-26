import {
  type AccountingInvoiceInput,
  type AccountingPaymentInput,
  type AccountingProvider,
  invoiceTotalCents,
} from "@/lib/integrations/accounting/types";
import {
  type IntegrationContext,
  assertCents,
  formatUsd,
  recordSimulated,
} from "@/lib/integrations/core";

/** Default accounting provider: records what would sync to the books. */
export function createOutboxAccountingProvider(ctx: IntegrationContext): AccountingProvider {
  return {
    provider: "outbox",
    async syncInvoice(invoice: AccountingInvoiceInput) {
      for (const line of invoice.lines) assertCents(line.amountCents, "line.amountCents");
      const total = invoiceTotalCents(invoice);
      const lines = invoice.lines.map((l) => `- ${l.description}: ${formatUsd(l.amountCents)}`);
      return recordSimulated(ctx, {
        domain: "accounting",
        provider: "outbox",
        operation: "accounting.sync_invoice",
        recipient: invoice.customerEmail ?? invoice.customerName,
        subject: `Invoice ${invoice.invoiceNumber}`,
        renderedBody: [
          `Invoice ${invoice.invoiceNumber} for ${invoice.customerName}`,
          ...lines,
          `Total: ${formatUsd(total)}`,
        ].join("\n"),
        payload: { ...invoice, totalCents: total },
        related: invoice.related ?? { type: "invoice", id: invoice.invoiceId },
      });
    },
    async syncPayment(payment: AccountingPaymentInput) {
      assertCents(payment.amountCents, "amountCents");
      return recordSimulated(ctx, {
        domain: "accounting",
        provider: "outbox",
        operation: "accounting.sync_payment",
        subject: `Payment ${formatUsd(payment.amountCents)}`,
        renderedBody: `Payment of ${formatUsd(payment.amountCents)} on ${payment.receivedDate} for invoice ${payment.invoiceId}`,
        payload: { ...payment },
        related: payment.related ?? { type: "payment", id: payment.paymentId },
      });
    },
  };
}
