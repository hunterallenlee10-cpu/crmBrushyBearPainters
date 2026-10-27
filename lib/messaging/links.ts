import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed public links for messaging (SPEC §8.11 "footer with unsubscribe"):
 * `/u/<token>` unsubscribes a contact or lead from marketing email. The token
 * carries who and which company, signed with HMAC-SHA256; nothing is stored.
 */

export type UnsubscribeTarget = { kind: "contact" | "lead"; id: string; orgId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`unsubscribe:v1:${body}`)
    .digest("base64url")
    .slice(0, 32);
}

export function unsubscribeToken(t: UnsubscribeTarget, secret: string): string {
  const body = Buffer.from(`${t.kind === "contact" ? "c" : "l"}.${t.id}.${t.orgId}`).toString(
    "base64url",
  );
  return `${body}.${sign(body, secret)}`;
}

export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeTarget | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [k, id, orgId] = Buffer.from(body, "base64url").toString("utf8").split(".");
  if ((k !== "c" && k !== "l") || !id || !orgId || !UUID.test(id) || !UUID.test(orgId)) return null;
  return { kind: k === "c" ? "contact" : "lead", id, orgId };
}

/** The signing secret: MESSAGING_LINK_SECRET, else one derived from the service role key. */
export function linkSecret(env: {
  MESSAGING_LINK_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}): string | null {
  if (env.MESSAGING_LINK_SECRET) return env.MESSAGING_LINK_SECRET;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY)
    .update("bb-messaging-links")
    .digest("hex");
}
