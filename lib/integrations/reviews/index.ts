import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import {
  type GoogleBusinessProfileConfig,
  GoogleBusinessProfileReviewsProvider,
} from "@/lib/integrations/reviews/google-business-profile";
import { createOutboxReviewsProvider } from "@/lib/integrations/reviews/outbox";
import { type ReviewsProvider } from "@/lib/integrations/reviews/types";

export * from "@/lib/integrations/reviews/types";
export { createOutboxReviewsProvider } from "@/lib/integrations/reviews/outbox";
export {
  GoogleBusinessProfileReviewsProvider,
  type GoogleBusinessProfileConfig,
} from "@/lib/integrations/reviews/google-business-profile";

export type ReviewsCredentials = { google_business_profile?: GoogleBusinessProfileConfig };
export type ReviewsProviderOptions = ProviderFactoryOptions<ReviewsCredentials>;

/** Reviews provider. Reads only; the context is unused but kept for a uniform signature. */
export function getReviewsProvider(
  _ctx: IntegrationContext | null,
  options: ReviewsProviderOptions = {},
): ReviewsProvider {
  const choice = resolveDomainProvider("reviews", options);
  if (!choice.real) return createOutboxReviewsProvider();
  if (choice.provider !== "google_business_profile") {
    throw new Error(`No reviews adapter for "${choice.provider}".`);
  }
  return new GoogleBusinessProfileReviewsProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.google_business_profile),
  );
}
