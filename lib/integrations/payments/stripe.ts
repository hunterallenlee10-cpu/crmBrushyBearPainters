// Disabled in this build — only reachable when resolveProviderChoice allows it (SPEC §2.1).
import { createHmac, timingSafeEqual } from "node:crypto";
import { assertCents } from "@/lib/integrations/core";
import { getString, requestJson } from "@/lib/integrations/http";
import {
  type PaymentLinkInput,
  type PaymentLinkResult,
  type PaymentsProvider,
} from "@/lib/integrations/payments/types";

export type StripeConfig = {
  /** Secret key (STRIPE_SECRET_KEY). Use a test-mode key until the owners go live. */
  secretKey: string;
  /** e.g. https://<your-domain>/p/<token>?paid=1 */
  successUrl: string;
  cancelUrl?: string;
  /** Pin a Stripe API version (Stripe-Version header). */
  apiVersion?: string;
};

/** Stripe's default tolerance for webhook timestamps. */
export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Verify a `Stripe-Signature` header (`t=…,v1=…[,v1=…]`): HMAC-SHA256 of
 * `${t}.${rawBody}` with the endpoint secret, compared in constant time, with
 * the timestamp within the tolerance window. `rawBody` must be the exact bytes
 * received (do not re-serialise parsed JSON).
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  toleranceSeconds: number = STRIPE_WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  if (!secret) throw new Error("Stripe webhook secret is not configured.");
  if (!signatureHeader) return false;

  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]+$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === undefined || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return signatures.some((sig) => {
    const candidate = Buffer.from(sig, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/**
 * Stripe adapter. Payment links are Checkout Sessions (mode=payment) with
 * inline price_data, so each invoice balance gets its own link without
 * creating Products/Prices.
 */
export class StripePaymentsProvider implements PaymentsProvider {
  readonly provider = "stripe";
  private readonly fetch: typeof fetch;
  private readonly config: StripeConfig;

  constructor(options: { fetch: typeof fetch; config: StripeConfig }) {
    if (!options.config.secretKey) throw new Error("Stripe needs a secretKey.");
    this.fetch = options.fetch;
    this.config = options.config;
  }

  async createPaymentLink(input: PaymentLinkInput): Promise<PaymentLinkResult> {
    assertCents(input.amountCents, "amountCents");
    if (input.amountCents <= 0) return { status: "failed", error: "Amount must be positive." };

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(input.amountCents));
    form.set("line_items[0][price_data][product_data][name]", input.description);
    form.set("success_url", this.config.successUrl);
    if (this.config.cancelUrl) form.set("cancel_url", this.config.cancelUrl);
    form.set("client_reference_id", input.invoiceId);
    form.set("metadata[invoice_id]", input.invoiceId);
    form.set("payment_intent_data[metadata][invoice_id]", input.invoiceId);
    if (input.customerEmail) form.set("customer_email", input.customerEmail);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;
    if (this.config.apiVersion) headers["Stripe-Version"] = this.config.apiVersion;

    const res = await requestJson(this.fetch, "https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers,
      body: form.toString(),
    });
    if (!res.ok) return { status: "failed", error: res.error };
    return {
      status: "sent",
      url: getString(res.data, "url"),
      externalId: getString(res.data, "id"),
    };
  }

  verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
    nowSeconds?: number,
  ): boolean {
    return verifyStripeSignature(rawBody, signatureHeader, secret, nowSeconds);
  }
}
