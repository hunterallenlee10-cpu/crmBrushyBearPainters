import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import { createOutboxPaymentsProvider } from "@/lib/integrations/payments/outbox";
import { type StripeConfig, StripePaymentsProvider } from "@/lib/integrations/payments/stripe";
import { type PaymentsProvider } from "@/lib/integrations/payments/types";

export * from "@/lib/integrations/payments/types";
export { createOutboxPaymentsProvider } from "@/lib/integrations/payments/outbox";
export {
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  StripePaymentsProvider,
  verifyStripeSignature,
  type StripeConfig,
} from "@/lib/integrations/payments/stripe";

export type PaymentsCredentials = { stripe?: StripeConfig };
export type PaymentsProviderOptions = ProviderFactoryOptions<PaymentsCredentials>;

/** Payments provider for the org. Outbox unless the three-condition gate allows Stripe. */
export function getPaymentsProvider(
  ctx: IntegrationContext,
  options: PaymentsProviderOptions = {},
): PaymentsProvider {
  const choice = resolveDomainProvider("payments", options);
  if (!choice.real) return createOutboxPaymentsProvider(ctx);
  if (choice.provider !== "stripe")
    throw new Error(`No payments adapter for "${choice.provider}".`);
  return new StripePaymentsProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.stripe),
  );
}
