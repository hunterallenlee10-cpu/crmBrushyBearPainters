import { notConnected } from "@/lib/integrations/core";
import { type AiProvider } from "@/lib/integrations/ai/types";

/** Default AI provider ("disabled"): not connected, no outbox writes. */
export function createDisabledAiProvider(): AiProvider {
  return {
    provider: "disabled",
    async complete() {
      return notConnected(
        "AI assistant is off; the Ask box answers from predefined metric queries.",
      );
    },
  };
}
