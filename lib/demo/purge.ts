import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { PHOTOS_BUCKET } from "@/lib/photos/storage";

type Db = SupabaseClient<Database>;

/**
 * Removes every demo record (`purge_demo_data()`), plus the photo files the
 * demo script uploaded for demo jobs, which the database can't delete itself.
 * Used by Admin → Demo Data and `pnpm seed:demo --replace / --purge`.
 * Real records are never touched: the function only follows `is_demo` rows.
 */
export async function purgeDemo(service: Db, orgId: string): Promise<Record<string, number>> {
  const { data: jobs, error: jobsError } = await service
    .from("jobs")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_demo", true);
  if (jobsError) throw jobsError;
  const jobIds = (jobs ?? []).map((j) => j.id);
  const paths: string[] = [];
  for (let i = 0; i < jobIds.length; i += 100) {
    const { data: photos, error } = await service
      .from("job_photos")
      .select("storage_path, thumb_path")
      .in("job_id", jobIds.slice(i, i + 100));
    if (error) throw error;
    for (const p of photos ?? []) paths.push(p.storage_path, p.thumb_path);
  }

  const { data, error } = await service.rpc("purge_demo_data", { p_org: orgId });
  if (error) throw error;

  let files = 0;
  for (let i = 0; i < paths.length; i += 500) {
    const chunk = paths.slice(i, i + 500);
    const { error: removeError } = await service.storage.from(PHOTOS_BUCKET).remove(chunk);
    if (!removeError) files += chunk.length;
  }
  return { ...((data ?? {}) as Record<string, number>), photo_files: files };
}
