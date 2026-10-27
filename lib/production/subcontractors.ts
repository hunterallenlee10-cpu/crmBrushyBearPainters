import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { subcontractorStatus } from "@/lib/domain/scheduling/subcontractors";

type Db = SupabaseClient<Database>;

/**
 * Keeps each subcontractor's status (active / expiring) current as dates pass;
 * the database guard computes it on every write, so touching the row is enough.
 * Suspended stays suspended. Service client (worker).
 */
export async function refreshSubcontractorStatus(service: Db, now = new Date()) {
  const today = pacificToday(now);
  const { data, error } = await service
    .from("subcontractors")
    .select(
      "id, status, lni_expires_on, coi_expires_on, bond_expires_on, rrp_expires_on, w9_on_file",
    )
    .is("deleted_at", null)
    .neq("status", "suspended");
  if (error) throw error;
  let changed = 0;
  for (const s of data ?? []) {
    const next = subcontractorStatus(
      {
        status: s.status,
        lniExpiresOn: s.lni_expires_on,
        coiExpiresOn: s.coi_expires_on,
        bondExpiresOn: s.bond_expires_on,
        rrpExpiresOn: s.rrp_expires_on,
        w9OnFile: s.w9_on_file,
      },
      today,
    );
    if (next === s.status) continue;
    const { error: e } = await service
      .from("subcontractors")
      .update({ status: next })
      .eq("id", s.id);
    if (!e) changed++;
  }
  return { checked: (data ?? []).length, changed };
}
