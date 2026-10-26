import {
  type IntegrationContext,
  assertCents,
  formatUsd,
  recordSimulated,
} from "@/lib/integrations/core";
import { type PaymentLinkInput, type PaymentsProvider } from "@/lib/integrations/payments/types";

/** Default payments provider: records the link request; no link exists and no webhook is trusted. */
export function createOutboxPaymentsProvider(ctx: IntegrationContext): PaymentsProvider {
  return {
    provider: "outbox",
    async createPaymentLink(input: PaymentLinkInput) {
      assertCents(input.amountCents, "amountCents");
      return recordSimulated(ctx, {
        domain: "payments",
        provider: "outbox",
        operation: "payments.create_payment_link",
        recipient: input.customerEmail ?? null,
        subject: input.description,
        renderedBody: `Payment link for ${formatUsd(input.amountCents)} – ${input.description}`,
        payload: { ...input },
        related: input.related ?? { type: "invoice", id: input.invoiceId },
      });
    },
    // Nothing is connected, so no inbound payment webhook can be authentic.
    verifyWebhook() {
      return false;
    },
  };
}
