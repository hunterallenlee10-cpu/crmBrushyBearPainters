import { type IntegrationContext, recordSimulated } from "@/lib/integrations/core";
import {
  type PlaceCallInput,
  type SmsProvider,
  type SmsSendInput,
  type VoiceProvider,
} from "@/lib/integrations/sms_voice/types";

/** Default SMS provider: records the text to `integration_outbox` ("Simulated – not sent"). */
export function createOutboxSmsProvider(ctx: IntegrationContext): SmsProvider {
  return {
    provider: "outbox",
    async send(input: SmsSendInput) {
      return recordSimulated(ctx, {
        domain: "sms_voice",
        provider: "outbox",
        operation: "sms.send",
        recipient: input.to,
        renderedBody: input.body,
        payload: { ...input },
        related: input.related ?? null,
      });
    },
  };
}

/** Default voice provider: records the call request; no call is placed. */
export function createOutboxVoiceProvider(ctx: IntegrationContext): VoiceProvider {
  return {
    provider: "outbox",
    async placeCall(input: PlaceCallInput) {
      return recordSimulated(ctx, {
        domain: "sms_voice",
        provider: "outbox",
        operation: "voice.place_call",
        recipient: input.to,
        renderedBody: `Call to ${input.to}`,
        payload: { ...input },
        related: input.related ?? null,
      });
    },
  };
}
