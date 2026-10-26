import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Request signing for the public lead intake (SPEC §14).
 *
 * Header: `X-BB-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
 * The timestamp stops replays: signatures older than 5 minutes are refused.
 * The website signs on its server (never in the browser); see docs/WEBSITE_INTEGRATION.md.
 */

export const SIGNATURE_HEADER = "x-bb-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Builds the header value (used by tests and the website snippet). */
export function signatureHeader(secret: string, rawBody: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${computeSignature(secret, t, rawBody)}`;
}

export type SignatureCheck =
  { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

export function verifySignature(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing" };
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const [k, v] = piece.trim().split("=", 2);
    if (k && v) parts.set(k, v);
  }
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1))
    return { ok: false, reason: "malformed" };
  const age = Math.abs(Math.floor(now.getTime() / 1000) - t);
  if (age > toleranceSeconds) return { ok: false, reason: "expired" };
  const expected = Buffer.from(computeSignature(secret, t, rawBody), "hex");
  const given = Buffer.from(v1, "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** SHA-256 of the raw body, stored with the Idempotency-Key to detect key reuse. */
export function bodyHash(rawBody: string): string {
  return createHmac("sha256", "bb-intake-body").update(rawBody).digest("hex");
}
