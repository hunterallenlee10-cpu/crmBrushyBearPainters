import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logError } from "@/lib/log";

/** Rate limits for the public proposal page (per address and per link). */
export const PROPOSAL_LIMITS = {
  viewPerIp: { limit: 120, windowSeconds: 600 },
  acceptPerIp: { limit: 10, windowSeconds: 600 },
  acceptPerLink: { limit: 8, windowSeconds: 600 },
  pdfPerIp: { limit: 30, windowSeconds: 600 },
} as const;

/** True when the request may go ahead. Fails open if the limiter itself errors. */
export async function consumeProposalLimit(
  service: SupabaseClient<Database>,
  bucket: string,
  rule: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const { data, error } = await service.rpc("consume_rate_limit", {
    p_bucket: `proposal:${bucket}`.slice(0, 200),
    p_limit: rule.limit,
    p_window_seconds: rule.windowSeconds,
  });
  if (error) {
    logError("proposal.rate_limit", error);
    return true;
  }
  return data !== false;
}
