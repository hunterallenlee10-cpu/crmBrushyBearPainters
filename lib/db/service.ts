import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/lib/db/types";

/**
 * Service-role client. BYPASSES RLS — use only in trusted server code that has
 * already checked permissions (worker, public intake after HMAC verification).
 * `server-only` makes any client-side import a build error.
 */
export function createSupabaseServiceClient() {
  const { url } = requireSupabaseEnv();
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only secret).");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
