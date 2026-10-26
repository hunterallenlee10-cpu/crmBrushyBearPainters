import { createOutboxAccountingProvider } from "@/lib/integrations/accounting/outbox";
import {
  type QuickBooksOnlineConfig,
  QuickBooksOnlineProvider,
} from "@/lib/integrations/accounting/quickbooks-online";
import { type AccountingProvider } from "@/lib/integrations/accounting/types";
import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";

export * from "@/lib/integrations/accounting/types";
export { createOutboxAccountingProvider } from "@/lib/integrations/accounting/outbox";
export {
  QuickBooksOnlineProvider,
  type QuickBooksOnlineConfig,
} from "@/lib/integrations/accounting/quickbooks-online";

export type AccountingCredentials = { quickbooks_online?: QuickBooksOnlineConfig };
export type AccountingProviderOptions = ProviderFactoryOptions<AccountingCredentials>;

/** Accounting provider for the org. Outbox unless the three-condition gate allows QuickBooks Online. */
export function getAccountingProvider(
  ctx: IntegrationContext,
  options: AccountingProviderOptions = {},
): AccountingProvider {
  const choice = resolveDomainProvider("accounting", options);
  if (!choice.real) return createOutboxAccountingProvider(ctx);
  if (choice.provider !== "quickbooks_online") {
    throw new Error(`No accounting adapter for "${choice.provider}".`);
  }
  return new QuickBooksOnlineProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.quickbooks_online),
  );
}
