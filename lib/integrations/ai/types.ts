import { type NotConnected } from "@/lib/integrations/core";

/**
 * Optional AI assistant (SPEC §2.1, §12). Used ONLY for the "Ask Brushy Bear"
 * box and summaries, and always grounded in computed metrics: callers put
 * figures from `lib/metrics/registry.ts` into the prompt and the model only
 * phrases them — it never computes or invents numbers. While disabled, the
 * Ask box matches questions to predefined metric queries with keyword rules.
 */

export type AiCompleteInput = {
  system: string;
  prompt: string;
  maxTokens: number;
};

export type AiCompleteResult =
  NotConnected | { connected: true; text: string; stopReason?: string; error?: string };

export interface AiProvider {
  readonly provider: string;
  complete(input: AiCompleteInput): Promise<AiCompleteResult>;
}
