"use server";

import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { serverEnv } from "@/lib/env";
import { linkSecret, verifyUnsubscribeToken } from "@/lib/messaging/links";
import { applyUnsubscribe } from "@/lib/messaging/public-links";
import { logError } from "@/lib/log";

/**
 * Unsubscribe from marketing email (SPEC §8.11, §13.2). No login: the signed
 * token is the credential. The contact or lead update is audit-logged and
 * becomes a change event through the database triggers.
 */

const schema = z.object({ token: z.string().min(10).max(400) });

export async function confirmUnsubscribe(
  raw: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "This link isn't valid." };
  const env = serverEnv();
  const secret = linkSecret(env);
  const target = secret ? verifyUnsubscribeToken(parsed.data.token, secret) : null;
  if (!target) return { ok: false, message: "This link isn't valid." };
  try {
    const service = await createSupabaseServiceClient();
    await applyUnsubscribe(service, target);
    return { ok: true };
  } catch (e) {
    logError("unsubscribe", e);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
