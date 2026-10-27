import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

type Db = SupabaseClient<Database>;

/**
 * Job photos live in the private "photos" bucket (SPEC §13.1). People only
 * ever get short-lived signed links, made after their row-security check on
 * job_photos. Paths start with org/jobs/job so the database can check that a
 * row points at its own job's files.
 */

export const PHOTOS_BUCKET = "photos";
/** Long enough to browse a gallery; short enough that a copied link soon dies. */
export const PHOTO_URL_SECONDS = 600;

export function photoPaths(orgId: string, jobId: string): { display: string; thumb: string } {
  const id = randomUUID();
  const base = `${orgId}/jobs/${jobId}/${id}`;
  return { display: `${base}.jpg`, thumb: `${base}-thumb.jpg` };
}

/** Signed links for many paths at once (missing files map to null). */
export async function signPhotoPaths(
  service: Db,
  paths: readonly string[],
  seconds = PHOTO_URL_SECONDS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await service.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(chunk, seconds);
    if (error || !data) continue;
    for (const d of data) if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  }
  return out;
}

export async function downloadPhoto(service: Db, path: string): Promise<Buffer | null> {
  const { data, error } = await service.storage.from(PHOTOS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
