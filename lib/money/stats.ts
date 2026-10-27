import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { parseFinanceStats, type FinanceStats } from "@/lib/metrics/registry";

type Db = SupabaseClient<Database>;

/**
 * The money numbers for the registry's FINANCE_METRICS (public.finance_stats,
 * aggregated in Postgres with the person's row security). Dates are Pacific
 * YYYY-MM-DD, inclusive.
 */
export async function loadFinanceStats(db: Db, from: string, to: string): Promise<FinanceStats> {
  const { data, error } = await db.rpc("finance_stats", { p_from: from, p_to: to });
  if (error) logError("money.finance_stats", error);
  return parseFinanceStats(data);
}
