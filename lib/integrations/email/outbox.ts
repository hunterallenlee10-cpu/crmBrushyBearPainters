import { type IntegrationContext, recordSimulated } from "@/lib/integrations/core";
import {
  type EmailProvider,
  type EmailSendInput,
  recipients,
} from "@/lib/integrations/email/types";

/** Default email provider: records the rendered email to `integration_outbox`. */
export function createOutboxEmailProvider(ctx: IntegrationContext): EmailProvider {
  return {
    provider: "outbox",
    async send(input: EmailSendInput) {
      return recordSimulated(ctx, {
        domain: "email",
        provider: "outbox",
        operation: "email.send",
        recipient: recipients(input.to).join(", "),
        subject: input.subject,
        renderedBody: input.html,
        payload: { ...input, to: recipients(input.to) },
        related: input.related ?? null,
      });
    },
  };
}
