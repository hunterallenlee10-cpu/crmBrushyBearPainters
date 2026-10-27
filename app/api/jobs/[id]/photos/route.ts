import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { PHOTO_CATEGORIES, PHOTO_UPLOAD_LIMIT, PHOTO_UPLOAD_TYPES } from "@/lib/domain/photos";
import { logError } from "@/lib/log";
import { processPhoto, UnreadablePhotoError } from "@/lib/photos/process";
import { PHOTOS_BUCKET, photoPaths } from "@/lib/photos/storage";

/**
 * Photo upload (SPEC §8.5 #6). Used by the camera and upload buttons and by
 * the offline queue when it reconnects, so it is idempotent: the client id is
 * the key, and a retry returns the photo already stored. The server re-encodes
 * the file (EXIF incl. GPS dropped), stores it and a thumbnail in the private
 * bucket, and inserts the row with the person's own client (row security
 * proves they may upload to this job).
 */

export const dynamic = "force-dynamic";

const fieldsSchema = z.object({
  clientId: z.uuid().optional(),
  category: z.enum(PHOTO_CATEGORIES).default("other"),
  area: z.string().trim().max(120).optional(),
  caption: z.string().trim().max(500).optional(),
  checklistKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_]{0,59}$/)
    .optional(),
  takenAt: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["upload", "camera", "offline"]).default("upload"),
});

const json = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function field(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!z.uuid().safeParse(jobId).success) return json(404, { error: "That job isn't available." });
  const state = await getViewerState();
  if (state.status !== "ok") return json(401, { error: "Sign in again to upload photos." });
  const viewer = state.viewer;
  if (viewer.impersonating) {
    return json(403, { error: "You're viewing as another user. Exit View as user to upload." });
  }
  if (!viewer.can("photos:upload")) {
    return json(403, { error: "You don't have permission to upload photos." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "The upload was incomplete. Try again." });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return json(400, { error: "Choose a photo." });
  if (file.size > PHOTO_UPLOAD_LIMIT)
    return json(413, { error: "That photo is too large (8 MB max)." });
  if (!(PHOTO_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return json(415, { error: "Upload a JPEG, PNG or WebP photo." });
  }
  const parsed = fieldsSchema.safeParse({
    clientId: field(form, "clientId"),
    category: field(form, "category"),
    area: field(form, "area"),
    caption: field(form, "caption"),
    checklistKey: field(form, "checklistKey"),
    takenAt: field(form, "takenAt"),
    source: field(form, "source"),
  });
  if (!parsed.success) return json(400, { error: "Some photo details aren't valid." });
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return json(404, { error: "That job isn't available." });

  if (v.clientId) {
    const { data: existing } = await supabase
      .from("job_photos")
      .select("id")
      .eq("job_id", jobId)
      .eq("client_id", v.clientId)
      .maybeSingle();
    if (existing) return json(200, { ok: true, id: existing.id, duplicate: true });
  }

  let processed;
  try {
    processed = await processPhoto(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof UnreadablePhotoError) {
      return json(422, { error: "We couldn't read that photo. Try taking it again." });
    }
    logError("photos.process", e);
    return json(500, { error: "We couldn't save that photo. Try again." });
  }

  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const paths = photoPaths(job.org_id, jobId);
  const bucket = service.storage.from(PHOTOS_BUCKET);
  const [a, b] = await Promise.all([
    bucket.upload(paths.display, processed.display, { contentType: processed.mime, upsert: false }),
    bucket.upload(paths.thumb, processed.thumb, { contentType: processed.mime, upsert: false }),
  ]);
  if (a.error || b.error) {
    await bucket.remove([paths.display, paths.thumb]);
    logError("photos.store", a.error ?? b.error);
    return json(503, { error: "Storage is busy. The photo will try again." });
  }

  const { data: row, error } = await supabase
    .from("job_photos")
    .insert({
      org_id: job.org_id,
      job_id: jobId,
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
    })
    .select("id")
    .single();
  if (error) {
    await bucket.remove([paths.display, paths.thumb]);
    if (error.code === "23505" && v.clientId) {
      const { data: again } = await supabase
        .from("job_photos")
        .select("id")
        .eq("job_id", jobId)
        .eq("client_id", v.clientId)
        .maybeSingle();
      if (again) return json(200, { ok: true, id: again.id, duplicate: true });
    }
    if (error.code === "42501") return json(403, { error: "You can't add photos to this job." });
    logError("photos.insert", error);
    return json(500, { error: "We couldn't save that photo. Try again." });
  }
  return json(201, { ok: true, id: row.id });
}
