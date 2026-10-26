import { type RelatedRecord, type SendStatus } from "@/lib/integrations/core";

export type PaymentLinkInput = {
  /** Integer cents. */
  amountCents: number;
  description: string;
  invoiceId: string;
  customerEmail?: string;
  /** Stable key so retries never create two links for the same invoice amount. */
  idempotencyKey?: string;
  related?: RelatedRecord | null;
};

export type PaymentLinkResult = {
  status: SendStatus;
  url?: string;
  externalId?: string;
  outboxId?: string;
  error?: string;
};

export interface PaymentsProvider {
  readonly provider: string;
  createPaymentLink(input: PaymentLinkInput): Promise<PaymentLinkResult>;
  /** True only for an authentic, fresh webhook. */
  verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
    nowSeconds?: number,
  ): boolean;
}
