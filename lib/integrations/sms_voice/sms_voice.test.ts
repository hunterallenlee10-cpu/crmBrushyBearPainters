import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  TwilioProvider,
  classifyInboundKeyword,
  createOutboxSmsProvider,
  createOutboxVoiceProvider,
  getSmsProvider,
  getVoiceProvider,
  isOptInKeyword,
  isOptOutKeyword,
} from "@/lib/integrations/sms_voice";
import { createFakeFetch, createForbiddenFetch, formBody } from "@/lib/integrations/testing";

const twilioConfig = {
  accountSid: "ACtest000",
  authToken: "test-token",
  fromNumber: "+15555550100",
  voiceTwimlUrl: "https://example.test/twiml/connect",
};

describe("outbox SMS & voice providers", () => {
  it("records one simulated sms.send entry", async () => {
    const sink = createMemoryOutboxSink();
    const sms = createOutboxSmsProvider({ orgId: "org-1", actorId: "u-1", sink });
    const result = await sms.send({
      to: "+15555550123",
      body: "Your walkthrough is confirmed.",
      related: { type: "lead", id: "lead-1" },
    });
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      orgId: "org-1",
      createdBy: "u-1",
      domain: "sms_voice",
      provider: "outbox",
      operation: "sms.send",
      recipient: "+15555550123",
      renderedBody: "Your walkthrough is confirmed.",
      related: { type: "lead", id: "lead-1" },
      payload: { to: "+15555550123", body: "Your walkthrough is confirmed." },
    });
  });

  it("records one simulated voice.place_call entry", async () => {
    const sink = createMemoryOutboxSink();
    const voice = createOutboxVoiceProvider({ orgId: "org-1", sink });
    const result = await voice.placeCall({ to: "+15555550123" });
    expect(result.status).toBe("simulated");
    expect(sink.entries[0]).toMatchObject({
      operation: "voice.place_call",
      recipient: "+15555550123",
      createdBy: null,
    });
  });
});

describe("TwilioProvider (disabled stub)", () => {
  it("sends a well-formed Messages API request", async () => {
    const fetch = createFakeFetch({ status: 201, json: { sid: "SM123", status: "queued" } });
    const twilio = new TwilioProvider({ fetch, config: twilioConfig });
    const result = await twilio.send({
      to: "+15555550123",
      body: "Hello",
      mediaUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"],
    });
    expect(result).toEqual({ status: "queued", providerMessageId: "SM123" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest000/Messages.json");
    expect(req?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("ACtest000:test-token").toString("base64")}`,
    );
    expect(req?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    const form = formBody(req);
    expect(form.get("To")).toBe("+15555550123");
    expect(form.get("From")).toBe("+15555550100");
    expect(form.get("Body")).toBe("Hello");
    expect(form.getAll("MediaUrl")).toEqual([
      "https://example.test/a.jpg",
      "https://example.test/b.jpg",
    ]);
  });

  it("places a call through the Calls API", async () => {
    const fetch = createFakeFetch({ status: 201, json: { sid: "CA9", status: "queued" } });
    const twilio = new TwilioProvider({ fetch, config: twilioConfig });
    const result = await twilio.placeCall({ to: "+15555550123", from: "+15555550199" });
    expect(result).toEqual({ status: "queued", providerMessageId: "CA9" });
    expect(fetch.requests[0]?.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACtest000/Calls.json",
    );
    const form = formBody(fetch.requests[0]);
    expect(form.get("From")).toBe("+15555550199");
    expect(form.get("Url")).toBe("https://example.test/twiml/connect");
  });

  it("maps Twilio statuses", async () => {
    const delivered = new TwilioProvider({
      fetch: createFakeFetch({ json: { sid: "SM1", status: "delivered" } }),
      config: twilioConfig,
    });
    expect((await delivered.send({ to: "+1", body: "x" })).status).toBe("sent");
    const failed = new TwilioProvider({
      fetch: createFakeFetch({ json: { sid: "SM2", status: "undelivered" } }),
      config: twilioConfig,
    });
    expect((await failed.send({ to: "+1", body: "x" })).status).toBe("failed");
  });

  it("maps HTTP errors to failed without throwing", async () => {
    const fetch = createFakeFetch({
      status: 400,
      json: { code: 21211, message: "The 'To' number is not a valid phone number.", status: 400 },
    });
    const twilio = new TwilioProvider({ fetch, config: twilioConfig });
    expect(await twilio.send({ to: "bad", body: "x" })).toEqual({
      status: "failed",
      error: "HTTP 400: The 'To' number is not a valid phone number.",
    });
  });

  it("maps network errors and missing config to failed", async () => {
    const offline = new TwilioProvider({ fetch: createForbiddenFetch(), config: twilioConfig });
    expect((await offline.send({ to: "+1", body: "x" })).error).toMatch(/Network error/);
    const noFrom = new TwilioProvider({
      fetch: createFakeFetch({}),
      config: { accountSid: "AC1", authToken: "t" },
    });
    expect((await noFrom.send({ to: "+1", body: "x" })).status).toBe("failed");
    expect((await noFrom.placeCall({ to: "+1", from: "+2" })).error).toMatch(/TwiML/);
  });

  it("throws for missing credentials (programmer error)", () => {
    expect(
      () =>
        new TwilioProvider({
          fetch: createFakeFetch({}),
          config: { accountSid: "", authToken: "" },
        }),
    ).toThrow();
  });
});

describe("inbound keywords (SPEC §13.2)", () => {
  it("recognises opt-out keywords", () => {
    for (const word of [
      "STOP",
      "stop",
      " Stop. ",
      "STOPALL",
      "unsubscribe",
      "Cancel",
      "END",
      "quit!",
    ]) {
      expect(isOptOutKeyword(word)).toBe(true);
    }
  });

  it("recognises opt-in and help keywords", () => {
    expect(isOptInKeyword("START")).toBe(true);
    expect(isOptInKeyword("unstop")).toBe(true);
    expect(classifyInboundKeyword("help")).toBe("help");
  });

  it("ignores keywords inside a longer message", () => {
    expect(isOptOutKeyword("please don't stop by today")).toBe(false);
    expect(isOptOutKeyword("Stop the crew at 3")).toBe(false);
    expect(classifyInboundKeyword("Sounds good")).toBeNull();
    expect(isOptOutKeyword("START")).toBe(false);
  });
});

describe("getSmsProvider / getVoiceProvider", () => {
  const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
  const credentials = { twilio: twilioConfig };

  it("returns the outbox provider by default and while locked", () => {
    expect(getSmsProvider(ctx).provider).toBe("outbox");
    expect(getVoiceProvider(ctx).provider).toBe("outbox");
    expect(
      getSmsProvider(ctx, {
        envProvider: "twilio",
        connectionStatus: "connected",
        fetch: createFakeFetch({}),
        credentials,
      }).provider,
    ).toBe("outbox");
  });

  it("returns outbox when not connected even if unlocked", () => {
    expect(
      getSmsProvider(ctx, {
        envProvider: "twilio",
        connectionStatus: "not_connected",
        locked: false,
      }).provider,
    ).toBe("outbox");
  });

  it("returns Twilio only when every condition holds", () => {
    const provider = getSmsProvider(ctx, {
      envProvider: "twilio",
      connectionStatus: "connected",
      locked: false,
      fetch: createFakeFetch({}),
      credentials,
    });
    expect(provider).toBeInstanceOf(TwilioProvider);
  });

  it("throws when allowed but credentials are missing", () => {
    expect(() =>
      getVoiceProvider(ctx, {
        envProvider: "twilio",
        connectionStatus: "connected",
        locked: false,
        fetch: createFakeFetch({}),
      }),
    ).toThrow(/credentials/);
  });
});
