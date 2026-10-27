import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { PHOTO_CATEGORIES } from "@/lib/domain/photos";
import { checkPhotoFile, savePhoto } from "@/lib/photos/save";

/**
 * Photo upload (SPEC §8.5 #6). Used by the camera and upload buttons and by
 * the offline queue when it reconnects, so it is idempotent: the client id is
 * the key, and a retry returns the photo already stored. The server re-encodes
 * the file (EXIF incl. GPS dropped), stores it and a thumbnail in the private
 * bucket, and inserts the row with the person's own client (row security
 * proves they may upload to this job). A photo can belong to a daily log
 * (Phase 6): when that log is still waiting in the offline queue, the answer
 * is 503 so the queue tries again after the log has uploaded.
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
  dailyLogId: z.uuid().optional(),
  workOrderId: z.uuid().optional(),
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
  const file = checkPhotoFile(form.get("file"));
  if (!file.ok) return json(file.status, { error: file.error });
  const parsed = fieldsSchema.safeParse({
    clientId: field(form, "clientId"),
    category: field(form, "category"),
    area: field(form, "area"),
    caption: field(form, "caption"),
    checklistKey: field(form, "checklistKey"),
    takenAt: field(form, "takenAt"),
    source: field(form, "source"),
    dailyLogId: field(form, "dailyLogId"),
    workOrderId: field(form, "workOrderId"),
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

  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  if (v.dailyLogId) {
    const { data: log } = await service
      .from("daily_logs")
      .select("id, job_id")
      .eq("id", v.dailyLogId)
      .maybeSingle();
    if (!log) return json(503, { error: "Waiting for the daily log to upload first." });
    if (log.job_id !== jobId) return json(400, { error: "That daily log belongs to another job." });
  }

  const saved = await savePhoto(
    { supabase, service },
    { orgId: job.org_id, jobId, actorId: viewer.real.id, file: file.file, fields: v },
  );
  if (!saved.ok) return json(saved.status, { error: saved.error });
  return json(saved.duplicate ? 200 : 201, {
    ok: true,
    id: saved.id,
    ...(saved.duplicate ? { duplicate: true } : {}),
  });
}
