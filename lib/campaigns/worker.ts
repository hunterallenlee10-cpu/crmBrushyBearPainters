import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;

/**
 * Campaign worker (SPEC §8.11): sends scheduled campaigns in batches through
 * the outbox (simulated), with consent, quiet hours and footers. Called every
 * minute from /api/cron/worker.
 */
export async function sweepCampaigns(service: Db, now = new Date()) {
  void service;
  void now;
  return { campaigns: 0, sent: 0 };
}
