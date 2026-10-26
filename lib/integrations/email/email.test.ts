import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  ResendEmailProvider,
  SendGridEmailProvider,
  createOutboxEmailProvider,
  getEmailProvider,
  parseAddress,
} from "@/lib/integrations/email";
import { createFakeFetch, jsonBody } from "@/lib/integrations/testing";

const email = {
  to: "customer@example.com",
  subject: "Your proposal",
  html: "<p>Here is your proposal.</p>",
  text: "Here is your proposal.",
  replyTo: "office@example.test",
};

describe("outbox email provider", () => {
  it("records one simulated email.send entry", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxEmailProvider({ orgId: "org-1", sink });
    const result = await provider.send({
      ...email,
      to: ["a@example.com", "b@example.com"],
      related: { type: "estimate", id: "est-1" },
    });
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      domain: "email",
      operation: "email.send",
      recipient: "a@example.com, b@example.com",
      subject: "Your proposal",
      renderedBody: "<p>Here is your proposal.</p>",
      related: { type: "estimate", id: "est-1" },
      payload: { to: ["a@example.com", "b@example.com"], subject: "Your proposal" },
    });
  });
});

describe("parseAddress", () => {
  it("splits display names", () => {
    expect(parseAddress("Brushy Bear <hi@example.test>")).toEqual({
      email: "hi@example.test",
      name: "Brushy Bear",
    });
    expect(parseAddress("hi@example.test")).toEqual({ email: "hi@example.test" });
  });
});

describe("ResendEmailProvider (disabled stub)", () => {
  const config = { apiKey: "re_test", defaultFrom: "Office <office@example.test>" };

  it("posts a well-formed request and parses the id", async () => {
    const fetch = createFakeFetch({ json: { id: "email-123" } });
    const result = await new ResendEmailProvider({ fetch, config }).send(email);
    expect(result).toEqual({ status: "sent", providerMessageId: "email-123" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.resend.com/emails");
    expect(req?.headers.get("authorization")).toBe("Bearer re_test");
    expect(req?.headers.get("content-type")).toBe("application/json");
    expect(jsonBody(req)).toEqual({
      from: "Office <office@example.test>",
      to: ["customer@example.com"],
      subject: "Your proposal",
      html: "<p>Here is your proposal.</p>",
      text: "Here is your proposal.",
      reply_to: "office@example.test",
    });
  });

  it("maps errors to failed", async () => {
    const fetch = createFakeFetch({
      status: 422,
      json: { statusCode: 422, name: "validation_error", message: "Invalid `to` field." },
    });
    expect(await new ResendEmailProvider({ fetch, config }).send(email)).toEqual({
      status: "failed",
      error: "HTTP 422: Invalid `to` field.",
    });
  });
});

describe("SendGridEmailProvider (disabled stub)", () => {
  const config = { apiKey: "SG.test", defaultFrom: "Office <office@example.test>" };

  it("posts a well-formed v3 mail/send request", async () => {
    const fetch = createFakeFetch({ status: 202, text: "", headers: { "X-Message-Id": "sg-1" } });
    const result = await new SendGridEmailProvider({ fetch, config }).send(email);
    expect(result).toEqual({ status: "queued", providerMessageId: "sg-1" });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(req?.headers.get("authorization")).toBe("Bearer SG.test");
    expect(jsonBody(req)).toEqual({
      personalizations: [{ to: [{ email: "customer@example.com" }] }],
      from: { email: "office@example.test", name: "Office" },
      reply_to: { email: "office@example.test" },
      subject: "Your proposal",
      content: [
        { type: "text/plain", value: "Here is your proposal." },
        { type: "text/html", value: "<p>Here is your proposal.</p>" },
      ],
    });
  });

  it("maps errors to failed", async () => {
    const fetch = createFakeFetch({
      status: 401,
      json: { errors: [{ message: "The provided authorization grant is invalid.", field: null }] },
    });
    const result = await new SendGridEmailProvider({ fetch, config }).send(email);
    expect(result).toEqual({
      status: "failed",
      error: "HTTP 401: The provided authorization grant is invalid.",
    });
  });
});

describe("getEmailProvider", () => {
  const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
  const credentials = {
    resend: { apiKey: "re", defaultFrom: "a@example.test" },
    sendgrid: { apiKey: "sg", defaultFrom: "a@example.test" },
  };
  const fetch = createFakeFetch({});

  it("is outbox by default and while locked", () => {
    expect(getEmailProvider(ctx).provider).toBe("outbox");
    expect(
      getEmailProvider(ctx, {
        envProvider: "resend",
        connectionStatus: "connected",
        fetch,
        credentials,
      }).provider,
    ).toBe("outbox");
  });

  it("selects each real provider only when fully allowed", () => {
    const open = { connectionStatus: "connected", locked: false, fetch, credentials } as const;
    expect(getEmailProvider(ctx, { ...open, envProvider: "resend" })).toBeInstanceOf(
      ResendEmailProvider,
    );
    expect(getEmailProvider(ctx, { ...open, envProvider: "sendgrid" })).toBeInstanceOf(
      SendGridEmailProvider,
    );
    expect(
      getEmailProvider(ctx, { ...open, envProvider: "sendgrid", connectionStatus: "error" })
        .provider,
    ).toBe("outbox");
  });
});
