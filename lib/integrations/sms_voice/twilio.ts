// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { type SendResult, type SendStatus } from "@/lib/integrations/core";
import { basicAuth, getString, requestJson } from "@/lib/integrations/http";
import {
  type PlaceCallInput,
  type SmsProvider,
  type SmsSendInput,
  type VoiceProvider,
} from "@/lib/integrations/sms_voice/types";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  /** Default sender (TWILIO_FROM_NUMBER). */
  fromNumber?: string;
  /** Optional delivery-status webhook, e.g. https://<your-domain>/api/webhooks/twilio/status */
  statusCallbackUrl?: string;
  /** TwiML URL Twilio fetches when a placed call connects (required for placeCall). */
  voiceTwimlUrl?: string;
};

const API = "https://api.twilio.com/2010-04-01";

function mapStatus(status: string | undefined): SendStatus {
  switch (status) {
    case "sent":
    case "delivered":
    case "completed":
      return "sent";
    case "failed":
    case "undelivered":
    case "canceled":
      return "failed";
    default:
      return "queued";
  }
}

export class TwilioProvider implements SmsProvider, VoiceProvider {
  readonly provider = "twilio";
  private readonly fetch: typeof fetch;
  private readonly config: TwilioConfig;

  constructor(options: { fetch: typeof fetch; config: TwilioConfig }) {
    if (!options.config.accountSid || !options.config.authToken) {
      throw new Error("Twilio needs accountSid and authToken.");
    }
    this.fetch = options.fetch;
    this.config = options.config;
  }

  private url(resource: "Messages" | "Calls"): string {
    return `${API}/Accounts/${encodeURIComponent(this.config.accountSid)}/${resource}.json`;
  }

  private async post(resource: "Messages" | "Calls", form: URLSearchParams): Promise<SendResult> {
    const res = await requestJson(this.fetch, this.url(resource), {
      method: "POST",
      headers: {
        Authorization: basicAuth(this.config.accountSid, this.config.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    const sid = getString(res.data, "sid");
    return { status: mapStatus(getString(res.data, "status")), providerMessageId: sid };
  }

  async send(input: SmsSendInput): Promise<SendResult> {
    const from = input.from ?? this.config.fromNumber;
    if (!from) return { status: "failed", error: "No Twilio from number configured." };
    const form = new URLSearchParams({ To: input.to, From: from, Body: input.body });
    for (const media of input.mediaUrls ?? []) form.append("MediaUrl", media);
    if (this.config.statusCallbackUrl) form.set("StatusCallback", this.config.statusCallbackUrl);
    return this.post("Messages", form);
  }

  async placeCall(input: PlaceCallInput): Promise<SendResult> {
    const from = input.from ?? this.config.fromNumber;
    if (!from) return { status: "failed", error: "No Twilio from number configured." };
    if (!this.config.voiceTwimlUrl) {
      return { status: "failed", error: "No TwiML URL configured for outbound calls." };
    }
    const form = new URLSearchParams({ To: input.to, From: from, Url: this.config.voiceTwimlUrl });
    if (this.config.statusCallbackUrl) form.set("StatusCallback", this.config.statusCallbackUrl);
    return this.post("Calls", form);
  }
}
