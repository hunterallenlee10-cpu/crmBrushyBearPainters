import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv, serverEnv } from "@/lib/env";
import { auditHeaders } from "@/lib/db/request-context";
import type { Database } from "@/lib/db/types";

/**
 * Service-role client. BYPASSES RLS — use only in trusted server code that has
 * already checked permissions (invites, worker, public intake after HMAC checks).
 * Pass the acting user so the audit log records who did it (x-bb-actor-id is
 * only trusted for the service role). `server-only` blocks client imports.
 */
export async function createSupabaseServiceClient(options: { actorId?: string | null } = {}) {
  const { url } = requireSupabaseEnv();
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (server-only secret).");
  }
  const extra: Record<string, string> = options.actorId ? { "x-bb-actor-id": options.actorId } : {};
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: await auditHeaders(extra) },
  });
}
