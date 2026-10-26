import { describe, expect, it } from "vitest";
import {
  AnthropicAiProvider,
  createDisabledAiProvider,
  getAiProvider,
} from "@/lib/integrations/ai";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const input = {
  system: "Answer only from the metrics provided.",
  prompt: "Metrics: sales_this_month=$12,000 (sample). How are sales this month?",
  maxTokens: 512,
};

describe("disabled AI provider", () => {
  it("is not connected and writes nothing", async () => {
    const sink = createMemoryOutboxSink();
    const ai = getAiProvider({ orgId: "o", sink });
    expect(ai.provider).toBe("disabled");
    expect(await ai.complete(input)).toMatchObject({ connected: false });
    expect(sink.entries).toHaveLength(0);
    expect(createDisabledAiProvider().provider).toBe("disabled");
  });
});

describe("AnthropicAiProvider (disabled stub)", () => {
  it("posts a well-formed Messages API request", async () => {
    const fetch = createFakeFetch({
      json: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Sales are $12,000 this month." }],
        stop_reason: "end_turn",
      },
    });
    const ai = new AnthropicAiProvider({ fetch, config: { apiKey: "sk-ant-test" } });
    await ai.complete(input);
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url.split("?")[0]).toBe("https://api.anthropic.com/v1/messages");
    // The official SDK sets auth and the API version itself.
    expect(
      req?.headers.get("authorization") === "Bearer sk-ant-test" ||
        req?.headers.get("x-api-key") === "sk-ant-test",
    ).toBe(true);
    expect(req?.headers.get("anthropic-version")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(req?.headers.get("content-type")).toBe("application/json");
    expect(req?.headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(jsonBody(req)).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 512,
      system: input.system,
      messages: [{ role: "user", content: input.prompt }],
      fallbacks: "default",
    });
  });

  it("uses the configured model and can opt out of the refusal fallback", async () => {
    const fetch = createFakeFetch({ json: { content: [], stop_reason: "end_turn" } });
    await new AnthropicAiProvider({
      fetch,
      config: { apiKey: "k", model: "claude-sonnet-5-5", refusalFallback: false },
    }).complete(input);
    const body = jsonBody(fetch.requests[0]);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body).not.toHaveProperty("fallbacks");
    expect(fetch.requests[0]?.headers.get("anthropic-beta")).toBeNull();
  });

  it("parses text blocks and skips others", async () => {
    const fetch = createFakeFetch({
      json: {
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: "Sales are " },
          { type: "text", text: "$12,000." },
        ],
        stop_reason: "end_turn",
      },
    });
    expect(
      await new AnthropicAiProvider({ fetch, config: { apiKey: "k" } }).complete(input),
    ).toEqual({
      connected: true,
      text: "Sales are $12,000.",
      stopReason: "end_turn",
    });
  });

  it("maps refusals and HTTP errors", async () => {
    const refusal = createFakeFetch({ json: { content: [], stop_reason: "refusal" } });
    expect(
      await new AnthropicAiProvider({ fetch: refusal, config: { apiKey: "k" } }).complete(input),
    ).toMatchObject({ connected: true, text: "", stopReason: "refusal" });
    const fetch = createFakeFetch({
      status: 401,
      json: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      },
    });
    expect(
      await new AnthropicAiProvider({ fetch, config: { apiKey: "bad" } }).complete(input),
    ).toEqual({
      connected: true,
      text: "",
      error: "Anthropic API error 401",
    });
  });

  it("throws for an invalid maxTokens (programmer error)", async () => {
    const ai = new AnthropicAiProvider({ fetch: createFakeFetch({}), config: { apiKey: "k" } });
    await expect(ai.complete({ ...input, maxTokens: 0 })).rejects.toThrow(/maxTokens/);
  });
});

describe("getAiProvider", () => {
  it("only returns Anthropic when fully allowed", () => {
    const opts = {
      envProvider: "anthropic",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { anthropic: { apiKey: "k" } },
    };
    expect(getAiProvider(null).provider).toBe("disabled");
    expect(getAiProvider(null, opts).provider).toBe("disabled");
    expect(getAiProvider(null, { ...opts, locked: false })).toBeInstanceOf(AnthropicAiProvider);
  });
});
