import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryOutboxSink } from "@/lib/integrations/core";
import {
  StripePaymentsProvider,
  createOutboxPaymentsProvider,
  getPaymentsProvider,
  verifyStripeSignature,
} from "@/lib/integrations/payments";
import { createFakeFetch, formBody } from "@/lib/integrations/testing";

const link = {
  amountCents: 250050,
  description: "Invoice 1001 – deposit",
  invoiceId: "inv-1",
  customerEmail: "customer@example.com",
  idempotencyKey: "inv-1:250050",
};

describe("outbox payments provider", () => {
  it("records payments.create_payment_link in cents", async () => {
    const sink = createMemoryOutboxSink();
    const provider = createOutboxPaymentsProvider({ orgId: "org-1", sink });
    const result = await provider.createPaymentLink(link);
    expect(result).toEqual({ status: "simulated", outboxId: "outbox-1" });
    expect(sink.entries).toHaveLength(1);
    expect(sink.entries[0]).toMatchObject({
      domain: "payments",
      operation: "payments.create_payment_link",
      recipient: "customer@example.com",
      renderedBody: "Payment link for $2,500.50 – Invoice 1001 – deposit",
      related: { type: "invoice", id: "inv-1" },
      payload: { amountCents: 250050, invoiceId: "inv-1" },
    });
  });

  it("never trusts a webhook", () => {
    const provider = createOutboxPaymentsProvider({ orgId: "o", sink: createMemoryOutboxSink() });
    expect(provider.verifyWebhook("{}", "t=1,v1=00", "whsec_x")).toBe(false);
  });
});

describe("StripePaymentsProvider (disabled stub)", () => {
  const config = {
    secretKey: "sk_test_123",
    successUrl: "https://example.test/p/tok?paid=1",
    cancelUrl: "https://example.test/p/tok",
  };

  it("creates a Checkout Session with form-encoded line items", async () => {
    const fetch = createFakeFetch({
      json: {
        id: "cs_test_1",
        url: "https://checkout.stripe.com/c/pay/cs_test_1",
        object: "checkout.session",
      },
    });
    const result = await new StripePaymentsProvider({ fetch, config }).createPaymentLink(link);
    expect(result).toEqual({
      status: "sent",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      externalId: "cs_test_1",
    });
    const req = fetch.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(req?.headers.get("authorization")).toBe("Bearer sk_test_123");
    expect(req?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(req?.headers.get("idempotency-key")).toBe("inv-1:250050");
    const form = formBody(req);
    expect(Object.fromEntries(form)).toEqual({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "250050",
      "line_items[0][price_data][product_data][name]": "Invoice 1001 – deposit",
      success_url: "https://example.test/p/tok?paid=1",
      cancel_url: "https://example.test/p/tok",
      client_reference_id: "inv-1",
      "metadata[invoice_id]": "inv-1",
      "payment_intent_data[metadata][invoice_id]": "inv-1",
      customer_email: "customer@example.com",
    });
  });

  it("maps Stripe errors to failed and rejects non-positive amounts", async () => {
    const fetch = createFakeFetch({
      status: 400,
      json: { error: { type: "invalid_request_error", message: "Invalid email address: x" } },
    });
    const stripe = new StripePaymentsProvider({ fetch, config });
    expect(await stripe.createPaymentLink(link)).toEqual({
      status: "failed",
      error: "HTTP 400: Invalid email address: x",
    });
    expect((await stripe.createPaymentLink({ ...link, amountCents: 0 })).status).toBe("failed");
    expect(fetch.requests).toHaveLength(1);
  });
});

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const t = 1_790_000_000;
  const sign = (payload: string, ts: number, key = secret) =>
    createHmac("sha256", key).update(`${ts}.${payload}`).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${sign(body, t)}`, secret, t)).toBe(true);
  });

  it("accepts when any of several v1 signatures matches (secret rotation)", () => {
    const header = `t=${t},v1=${sign(body, t, "whsec_old")},v1=${sign(body, t)},v0=deadbeef`;
    expect(verifyStripeSignature(body, header, secret, t)).toBe(true);
  });

  it("accepts within the 5-minute tolerance and rejects outside it", () => {
    const header = `t=${t},v1=${sign(body, t)}`;
    expect(verifyStripeSignature(body, header, secret, t + 300)).toBe(true);
    expect(verifyStripeSignature(body, header, secret, t + 301)).toBe(false);
    expect(verifyStripeSignature(body, header, secret, t - 301)).toBe(false);
  });

  it("rejects a tampered body, wrong secret or tampered timestamp", () => {
    const header = `t=${t},v1=${sign(body, t)}`;
    expect(verifyStripeSignature(`${body} `, header, secret, t)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t + 1},v1=${sign(body, t)}`, secret, t)).toBe(false);
  });

  it("rejects malformed headers", () => {
    for (const header of [
      null,
      "",
      "garbage",
      `t=${t}`,
      `v1=${sign(body, t)}`,
      `t=abc,v1=${sign(body, t)}`,
      `t=${t},v1=nothex`,
      `t=${t},v1=${sign(body, t).slice(0, 10)}`,
      `t=${t},v0=${sign(body, t)}`,
    ]) {
      expect(verifyStripeSignature(body, header, secret, t)).toBe(false);
    }
  });

  it("throws when the secret is missing (configuration error)", () => {
    expect(() => verifyStripeSignature(body, `t=${t},v1=00`, "", t)).toThrow(/secret/);
  });

  it("is exposed on the provider", () => {
    const stripe = new StripePaymentsProvider({
      fetch: createFakeFetch({}),
      config: { secretKey: "sk_test", successUrl: "https://example.test" },
    });
    expect(stripe.verifyWebhook(body, `t=${t},v1=${sign(body, t)}`, secret, t)).toBe(true);
  });
});

describe("getPaymentsProvider", () => {
  it("only returns Stripe when fully allowed", () => {
    const ctx = { orgId: "org-1", sink: createMemoryOutboxSink() };
    const opts = {
      envProvider: "stripe",
      connectionStatus: "connected",
      fetch: createFakeFetch({}),
      credentials: { stripe: { secretKey: "sk_test", successUrl: "https://example.test" } },
    };
    expect(getPaymentsProvider(ctx).provider).toBe("outbox");
    expect(getPaymentsProvider(ctx, opts).provider).toBe("outbox");
    expect(getPaymentsProvider(ctx, { ...opts, locked: false })).toBeInstanceOf(
      StripePaymentsProvider,
    );
  });
});
