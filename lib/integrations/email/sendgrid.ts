// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { type SendResult } from "@/lib/integrations/core";
import {
  type EmailProvider,
  type EmailSendInput,
  parseAddress,
  recipients,
} from "@/lib/integrations/email/types";
import { requestJson } from "@/lib/integrations/http";

export type SendGridConfig = {
  apiKey: string;
  /** Verified sender, e.g. "Brushy Bear Painters <hello@<your-domain>>". */
  defaultFrom: string;
};

export class SendGridEmailProvider implements EmailProvider {
  readonly provider = "sendgrid";
  private readonly fetch: typeof fetch;
  private readonly config: SendGridConfig;

  constructor(options: { fetch: typeof fetch; config: SendGridConfig }) {
    if (!options.config.apiKey) throw new Error("SendGrid needs an apiKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async send(input: EmailSendInput): Promise<SendResult> {
    // SendGrid requires text/plain (when present) before text/html.
    const content: { type: string; value: string }[] = [];
    if (input.text) content.push({ type: "text/plain", value: input.text });
    content.push({ type: "text/html", value: input.html });

    const body: Record<string, unknown> = {
      personalizations: [{ to: recipients(input.to).map((email) => parseAddress(email)) }],
      from: parseAddress(input.from ?? this.config.defaultFrom),
      subject: input.subject,
      content,
    };
    if (input.replyTo) body.reply_to = parseAddress(input.replyTo);

    const res = await requestJson(this.fetch, "https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    // 202 Accepted: queued for delivery. The id comes back in a header, not the body.
    return {
      status: "queued",
      providerMessageId: res.headers.get("x-message-id") ?? undefined,
    };
  }
}
