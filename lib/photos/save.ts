import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import {
  PHOTO_CATEGORY_LABELS,
  PHOTO_UPLOAD_LIMIT,
  PHOTO_UPLOAD_TYPES,
  type PhotoCategory,
} from "@/lib/domain/photos";
import { logActivity } from "@/lib/jobs/activity";
import { logError } from "@/lib/log";
import { processPhoto, UnreadablePhotoError } from "./process";
import { PHOTOS_BUCKET, photoPaths } from "./storage";

type Db = SupabaseClient<Database>;

/**
 * Stores one job photo (SPEC §8.5 #6, §13.1): re-encoded on the server (EXIF
 * incl. GPS dropped), display copy + thumbnail in the private bucket, row
 * inserted with the person's own client (row security proves they may upload
 * to the job). Idempotent by client id. Shared by the photo upload route and
 * the daily-log route (cleanup photo).
 */

export type PhotoFields = {
  clientId?: string;
  category: PhotoCategory;
  area?: string;
  caption?: string;
  checklistKey?: string;
  takenAt?: string;
  source: "upload" | "camera" | "offline";
  dailyLogId?: string | null;
  workOrderId?: string | null;
};

export type SavePhotoResult =
  { ok: true; id: string; duplicate: boolean } | { ok: false; status: number; error: string };

export function checkPhotoFile(
  file: unknown,
): { ok: true; file: Blob } | { ok: false; status: number; error: string } {
  if (!(file instanceof Blob) || file.size === 0)
    return { ok: false, status: 400, error: "Choose a photo." };
  if (file.size > PHOTO_UPLOAD_LIMIT)
    return { ok: false, status: 413, error: "That photo is too large (8 MB max)." };
  if (!(PHOTO_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, status: 415, error: "Upload a JPEG, PNG or WebP photo." };
  }
  return { ok: true, file };
}

export async function savePhoto(
  db: { supabase: Db; service: Db },
  input: { orgId: string; jobId: string; actorId: string; file: Blob; fields: PhotoFields },
): Promise<SavePhotoResult> {
  const { supabase, service } = db;
  const v = input.fields;
  if (v.clientId) {
    const { data: existing } = await supabase
      .from("job_photos")
      .select("id")
      .eq("job_id", input.jobId)
      .eq("client_id", v.clientId)
      .maybeSingle();
    if (existing) return { ok: true, id: existing.id, duplicate: true };
  }
  let processed;
  try {
    processed = await processPhoto(Buffer.from(await input.file.arrayBuffer()));
  } catch (e) {
    if (e instanceof UnreadablePhotoError) {
      return { ok: false, status: 422, error: "We couldn't read that photo. Try taking it again." };
    }
    logError("photos.process", e);
    return { ok: false, status: 500, error: "We couldn't save that photo. Try again." };
  }
  const paths = photoPaths(input.orgId, input.jobId);
  const bucket = service.storage.from(PHOTOS_BUCKET);
  const [a, b] = await Promise.all([
    bucket.upload(paths.display, processed.display, { contentType: processed.mime, upsert: false }),
    bucket.upload(paths.thumb, processed.thumb, { contentType: processed.mime, upsert: false }),
  ]);
  if (a.error || b.error) {
    await bucket.remove([paths.display, paths.thumb]);
    logError("photos.store", a.error ?? b.error);
    return { ok: false, status: 503, error: "Storage is busy. The photo will try again." };
  }
  const { data: row, error } = await supabase
    .from("job_photos")
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      category: v.category,
      area: v.area || null,
      caption: v.caption || null,
      checklist_key: v.checklistKey ?? null,
      storage_path: paths.display,
      thumb_path: paths.thumb,
      mime_type: processed.mime,
      size_bytes: processed.display.length,
      thumb_size_bytes: processed.thumb.length,
      width: processed.width,
      height: processed.height,
      sha256: createHash("sha256").update(processed.display).digest("hex"),
      taken_at: v.takenAt ?? null,
      client_id: v.clientId ?? null,
      source: v.source,
      daily_log_id: v.dailyLogId ?? null,
      work_order_id: v.workOrderId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    await bucket.remove([paths.display, paths.thumb]);
    if (error.code === "23505" && v.clientId) {
      const { data: again } = await supabase
        .from("job_photos")
        .select("id")
        .eq("job_id", input.jobId)
        .eq("client_id", v.clientId)
        .maybeSingle();
      if (again) return { ok: true, id: again.id, duplicate: true };
    }
    if (error.code === "42501")
      return { ok: false, status: 403, error: "You can't add photos to this job." };
    logError("photos.insert", error);
    return { ok: false, status: 500, error: "We couldn't save that photo. Try again." };
  }
  await logActivity(service, {
    orgId: input.orgId,
    subjectType: "job",
    subjectId: input.jobId,
    type: "photo_added",
    summary: `${PHOTO_CATEGORY_LABELS[v.category]} photo added${v.area ? ` · ${v.area}` : ""}${v.source === "offline" ? " (taken offline)" : ""}`,
    actorId: input.actorId,
    payload: { photo_id: row.id, category: v.category },
  });
  return { ok: true, id: row.id, duplicate: false };
}
