// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { type SendResult } from "@/lib/integrations/core";
import {
  type EmailProvider,
  type EmailSendInput,
  recipients,
} from "@/lib/integrations/email/types";
import { getString, requestJson } from "@/lib/integrations/http";

export type ResendConfig = {
  apiKey: string;
  /** Verified sender, e.g. "Brushy Bear Painters <hello@<your-domain>>". */
  defaultFrom: string;
};

export class ResendEmailProvider implements EmailProvider {
  readonly provider = "resend";
  private readonly fetch: typeof fetch;
  private readonly config: ResendConfig;

  constructor(options: { fetch: typeof fetch; config: ResendConfig }) {
    if (!options.config.apiKey) throw new Error("Resend needs an apiKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async send(input: EmailSendInput): Promise<SendResult> {
    const body: Record<string, unknown> = {
      from: input.from ?? this.config.defaultFrom,
      to: recipients(input.to),
      subject: input.subject,
      html: input.html,
    };
    if (input.text) body.text = input.text;
    if (input.replyTo) body.reply_to = input.replyTo;

    const res = await requestJson(this.fetch, "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    return { status: "sent", providerMessageId: getString(res.data, "id") };
  }
}
