import "server-only";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logError } from "@/lib/log";

/**
 * Rate limits for the public, no-login pages (SPEC §13.1): website intake,
 * proposal pages, unsubscribe, review links, inbound messages. Counted in
 * Postgres (`consume_rate_limit`) per bucket and window, so they hold across
 * serverless instances. Fails open if the limiter itself errors (a broken
 * limiter must not take the customer pages down); errors are logged.
 */
export const PUBLIC_LIMITS = {
  unsubscribeViewPerIp: { limit: 60, windowSeconds: 600 },
  unsubscribeConfirmPerIp: { limit: 10, windowSeconds: 600 },
  reviewClickPerIp: { limit: 60, windowSeconds: 600 },
} as const;

export async function consumePublicLimit(
  service: SupabaseClient<Database>,
  bucket: string,
  rule: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_bucket: bucket.slice(0, 200),
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    logError("public.rate_limit", error);
    return true;
  }
  return data !== false;
}

/** The caller's address as Vercel forwards it ("unknown" when absent). */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
