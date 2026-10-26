import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";
import {
  createOutboxSmsProvider,
  createOutboxVoiceProvider,
} from "@/lib/integrations/sms_voice/outbox";
import { type TwilioConfig, TwilioProvider } from "@/lib/integrations/sms_voice/twilio";
import { type SmsProvider, type VoiceProvider } from "@/lib/integrations/sms_voice/types";

export * from "@/lib/integrations/sms_voice/types";
export * from "@/lib/integrations/sms_voice/keywords";
export {
  createOutboxSmsProvider,
  createOutboxVoiceProvider,
} from "@/lib/integrations/sms_voice/outbox";
export { TwilioProvider, type TwilioConfig } from "@/lib/integrations/sms_voice/twilio";

export type SmsVoiceCredentials = { twilio?: TwilioConfig };
export type SmsVoiceProviderOptions = ProviderFactoryOptions<SmsVoiceCredentials>;

/** SMS provider for the org. Outbox unless env flag + connected row + unlocked build all allow Twilio. */
export function getSmsProvider(
  ctx: IntegrationContext,
  options: SmsVoiceProviderOptions = {},
): SmsProvider {
  const choice = resolveDomainProvider("sms_voice", options);
  if (!choice.real) return createOutboxSmsProvider(ctx);
  return createTwilio(choice.provider, options);
}

/** Voice provider for the org (INTEGRATION_VOICE_PROVIDER). Same gate as SMS. */
export function getVoiceProvider(
  ctx: IntegrationContext,
  options: SmsVoiceProviderOptions = {},
): VoiceProvider {
  const choice = resolveDomainProvider("sms_voice", options);
  if (!choice.real) return createOutboxVoiceProvider(ctx);
  return createTwilio(choice.provider, options);
}

function createTwilio(provider: string, options: SmsVoiceProviderOptions): TwilioProvider {
  if (provider !== "twilio") throw new Error(`No SMS/voice adapter for "${provider}".`);
  return new TwilioProvider(requireRealDeps(provider, options.fetch, options.credentials?.twilio));
}
