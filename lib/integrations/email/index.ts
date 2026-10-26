import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import { createOutboxEmailProvider } from "@/lib/integrations/email/outbox";
import { type ResendConfig, ResendEmailProvider } from "@/lib/integrations/email/resend";
import { type SendGridConfig, SendGridEmailProvider } from "@/lib/integrations/email/sendgrid";
import { type EmailProvider } from "@/lib/integrations/email/types";

export * from "@/lib/integrations/email/types";
export { createOutboxEmailProvider } from "@/lib/integrations/email/outbox";
export { ResendEmailProvider, type ResendConfig } from "@/lib/integrations/email/resend";
export { SendGridEmailProvider, type SendGridConfig } from "@/lib/integrations/email/sendgrid";

export type EmailCredentials = { resend?: ResendConfig; sendgrid?: SendGridConfig };
export type EmailProviderOptions = ProviderFactoryOptions<EmailCredentials>;

/** Email provider for the org. Outbox unless the three-condition gate allows Resend/SendGrid. */
export function getEmailProvider(
  ctx: IntegrationContext,
  options: EmailProviderOptions = {},
): EmailProvider {
  const choice = resolveDomainProvider("email", options);
  if (!choice.real) return createOutboxEmailProvider(ctx);
  switch (choice.provider) {
    case "resend":
      return new ResendEmailProvider(
        requireRealDeps("resend", options.fetch, options.credentials?.resend),
      );
    case "sendgrid":
      return new SendGridEmailProvider(
        requireRealDeps("sendgrid", options.fetch, options.credentials?.sendgrid),
      );
    default:
      throw new Error(`No email adapter for "${choice.provider}".`);
  }
}
