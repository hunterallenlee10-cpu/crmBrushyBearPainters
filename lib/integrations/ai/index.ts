import { type AnthropicConfig, AnthropicAiProvider } from "@/lib/integrations/ai/anthropic";
import { createDisabledAiProvider } from "@/lib/integrations/ai/outbox";
import { type AiProvider } from "@/lib/integrations/ai/types";
import {
  type IntegrationContext,
  type ProviderFactoryOptions,
  requireRealDeps,
  resolveDomainProvider,
} from "@/lib/integrations/core";

export * from "@/lib/integrations/ai/types";
export { createDisabledAiProvider } from "@/lib/integrations/ai/outbox";
export {
  AnthropicAiProvider,
  DEFAULT_ANTHROPIC_MODEL,
  type AnthropicConfig,
} from "@/lib/integrations/ai/anthropic";

export type AiCredentials = { anthropic?: AnthropicConfig };
export type AiProviderOptions = ProviderFactoryOptions<AiCredentials>;

/** AI provider. "disabled" unless the three-condition gate allows Anthropic. */
export function getAiProvider(
  _ctx: IntegrationContext | null,
  options: AiProviderOptions = {},
): AiProvider {
  const choice = resolveDomainProvider("ai", options);
  if (!choice.real) return createDisabledAiProvider();
  if (choice.provider !== "anthropic") throw new Error(`No AI adapter for "${choice.provider}".`);
  return new AnthropicAiProvider(
    requireRealDeps(choice.provider, options.fetch, options.credentials?.anthropic),
  );
}
