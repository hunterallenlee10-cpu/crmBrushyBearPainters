import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { parseCommunicationStats, type CommunicationStats } from "@/lib/metrics/registry";

/**
 * `communication_stats` for a period (server-side aggregation; SPEC §12).
 * The KPIs themselves come from lib/metrics/registry.ts.
 */
export async function loadCommunicationStats(
  db: SupabaseClient<Database>,
  opts: { days?: number; from?: string; to?: string } = {},
): Promise<CommunicationStats> {
  const from = opts.from ?? new Date(Date.now() - (opts.days ?? 90) * 24 * 3_600_000).toISOString();
  const { data, error } = await db.rpc("communication_stats", {
    p_from: from,
    ...(opts.to ? { p_to: opts.to } : {}),
  });
  if (error) throw error;
  return parseCommunicationStats(data);
}
