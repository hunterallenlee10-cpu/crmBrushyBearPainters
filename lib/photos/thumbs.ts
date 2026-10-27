import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { signPhotoPaths } from "./storage";

type Db = SupabaseClient<Database>;

export type PhotoThumb = {
  id: string;
  thumbUrl: string | null;
  url: string | null;
  caption: string | null;
  category: string;
  dailyLogId: string | null;
  workOrderId: string | null;
  createdAt: string;
};

/**
 * Photo thumbnails for a job screen: rows are read with the person's own
 * client (row security decides what they may see), then signed with the
 * service client for a few minutes.
 */
export async function loadPhotoThumbs(
  db: { supabase: Db; service: Db },
  input: {
    jobId: string;
    ids?: readonly string[];
    dailyLogIds?: readonly string[];
    limit?: number;
  },
): Promise<PhotoThumb[]> {
  let q = db.supabase
    .from("job_photos")
    .select(
      "id, thumb_path, storage_path, caption, category, daily_log_id, work_order_id, created_at",
    )
    .eq("job_id", input.jobId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 60);
  if (input.ids) {
    if (!input.ids.length) return [];
    q = q.in("id", [...input.ids]);
  }
  if (input.dailyLogIds) {
    if (!input.dailyLogIds.length) return [];
    q = q.in("daily_log_id", [...input.dailyLogIds]);
  }
  const { data } = await q;
  const rows = data ?? [];
  if (!rows.length) return [];
  const signed = await signPhotoPaths(
    db.service,
    rows.flatMap((r) => [r.thumb_path, r.storage_path]),
  );
  return rows.map((r) => ({
    id: r.id,
    thumbUrl: signed.get(r.thumb_path) ?? null,
    url: signed.get(r.storage_path) ?? null,
    caption: r.caption,
    category: r.category,
    dailyLogId: r.daily_log_id,
    workOrderId: r.work_order_id,
    createdAt: r.created_at,
  }));
}
