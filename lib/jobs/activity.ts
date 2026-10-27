import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * A timeline entry (SPEC §5.7 activity) written with the service client after
 * the caller's own checks: people can't write activity rows directly. Best
 * effort: a failed timeline write never undoes the change itself.
 */
export async function logActivity(
  service: Db,
  entry: {
    orgId: string;
    subjectType: "job" | "account" | "lead" | "contact";
    subjectId: string;
    type: string;
    summary: string;
    actorId: string;
    payload?: Record<string, Json>;
  },
): Promise<void> {
  const { error } = await service.from("activity").insert({
    org_id: entry.orgId,
    subject_type: entry.subjectType,
    subject_id: entry.subjectId,
    type: entry.type,
    summary: entry.summary.slice(0, 500),
    payload: entry.payload ?? {},
    actor_id: entry.actorId,
  });
  if (error) logError("activity.insert", error);
}
