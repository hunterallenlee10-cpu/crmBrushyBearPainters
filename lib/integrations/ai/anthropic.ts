// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
// AI is only for the Ask box and summaries, always grounded in computed metrics (see ./types.ts).
import Anthropic from "@anthropic-ai/sdk";
import {
  type AiCompleteInput,
  type AiCompleteResult,
  type AiProvider,
} from "@/lib/integrations/ai/types";

export type AnthropicConfig = {
  /** ANTHROPIC_API_KEY. */
  apiKey: string;
  /** Defaults to DEFAULT_ANTHROPIC_MODEL. The owners may pick a cheaper model when they enable AI. */
  model?: string;
  /**
   * Server-side refusal fallback (`fallbacks: "default"` + beta header): if the
   * model declines on a safety classifier, the API re-runs the request on a
   * fallback model inside the same call. On by default; set false to opt out.
   */
  refusalFallback?: boolean;
};

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Anthropic Messages API through the official SDK. `fetch` is injected so tests
 * never touch the network. Thinking is always on for this model (adaptive), so
 * callers should leave headroom in `maxTokens`; only text blocks are returned.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly provider = "anthropic";
  private readonly client: Anthropic;
  private readonly config: AnthropicConfig;

  constructor(options: { fetch: typeof fetch; config: AnthropicConfig }) {
    if (!options.config.apiKey) throw new Error("Anthropic needs an apiKey.");
    this.config = options.config;
    this.client = new Anthropic({
      apiKey: options.config.apiKey,
      fetch: options.fetch,
      maxRetries: 0,
    });
  }

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    if (!Number.isInteger(input.maxTokens) || input.maxTokens <= 0) {
      throw new Error("maxTokens must be a positive integer.");
    }
    const fallback = this.config.refusalFallback !== false;

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.config.model ?? DEFAULT_ANTHROPIC_MODEL,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
        ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        return {
          connected: true,
          text: "",
          error: `Anthropic API error ${error.status ?? ""}`.trim(),
        };
      }
      return { connected: true, text: "", error: "Could not reach the Anthropic API." };
    }

    const stopReason = response.stop_reason ?? undefined;
    if (stopReason === "refusal") {
      return { connected: true, text: "", stopReason, error: "The model declined this request." };
    }
    // Only text blocks are the answer (thinking blocks etc. are skipped).
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { connected: true, text, ...(stopReason ? { stopReason } : {}) };
  }
}
