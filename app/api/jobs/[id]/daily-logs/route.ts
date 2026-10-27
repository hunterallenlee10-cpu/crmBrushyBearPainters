import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { logError } from "@/lib/log";
import { checkPhotoFile, savePhoto } from "@/lib/photos/save";
import { createDailyLog } from "@/lib/production/daily-log";
import { dailyLogSchema } from "@/lib/validation/production";

/**
 * New daily log (SPEC §8.5 #9, §1.3): multipart form with the log fields, the
 * hours as JSON and the required cleanup photo. Used online and by the offline
 * queue ("daily_log" uploader), so it's idempotent: the client id is the log's
 * id. Permission: daily_logs:create on a job the person can open (row security).
 */

export const dynamic = "force-dynamic";

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
  if (state.status !== "ok") return json(401, { error: "Sign in again to post the daily log." });
  const viewer = state.viewer;
  if (viewer.impersonating) {
    return json(403, { error: "You're viewing as another user. Exit View as user to post." });
  }
  if (!viewer.can("daily_logs:create") || !viewer.can("photos:upload")) {
    return json(403, { error: "Your role can't post daily logs." });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "The upload was incomplete. Try again." });
  }
  let hours: unknown = [];
  try {
    hours = JSON.parse(field(form, "hours") ?? "[]");
  } catch {
    return json(400, { error: "The hours aren't readable." });
  }
  const parsed = dailyLogSchema.safeParse({
    clientId: field(form, "clientId"),
    logDate: field(form, "logDate"),
    workOrderId: field(form, "workOrderId"),
    finishedToday: field(form, "finishedToday"),
    nextUp: field(form, "nextUp"),
    issues: field(form, "issues"),
    weatherObserved: field(form, "weatherObserved"),
    cleanupDone: field(form, "cleanupDone") === "true",
    hours,
    source: field(form, "source"),
  });
  if (!parsed.success) {
    return json(400, { error: parsed.error.issues[0]?.message ?? "Some details aren't valid." });
  }
  const v = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id, org_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return json(404, { error: "That job isn't available." });
  const service = await createSupabaseServiceClient({ actorId: viewer.id });

  // A retry after a lost response: the log is already there.
  const { data: existing } = await service
    .from("daily_logs")
    .select("id, job_id")
    .eq("id", v.clientId)
    .maybeSingle();
  if (existing) {
    if (existing.job_id !== jobId)
      return json(409, { error: "That daily log belongs to another job." });
    return json(200, { ok: true, id: existing.id, duplicate: true });
  }

  const file = checkPhotoFile(form.get("cleanupPhoto"));
  if (!file.ok) {
    return json(file.status === 400 ? 400 : file.status, {
      error: file.status === 400 ? "Add the cleanup photo." : file.error,
    });
  }
  const photo = await savePhoto(
    { supabase, service },
    {
      orgId: job.org_id,
      jobId,
      actorId: viewer.real.id,
      file: file.file,
      fields: {
        clientId: v.clientId,
        category: "cleanup",
        caption: "Cleanup (daily log)",
        source: v.source === "offline" ? "offline" : "camera",
      },
    },
  );
  if (!photo.ok) return json(photo.status, { error: photo.error });

  try {
    const result = await createDailyLog(
      { supabase, service },
      { orgId: job.org_id, jobId, actorId: viewer.real.id, cleanupPhotoId: photo.id, log: v },
    );
    return json(result.duplicate ? 200 : 201, { ok: true, ...result });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return json(403, { error: "You can't post daily logs on this job." });
    if (code === "23514") {
      return json(400, {
        error: (e as { message?: string }).message ?? "Some details aren't valid.",
      });
    }
    logError("daily_log.create", e);
    return json(500, { error: "We couldn't save the daily log. It will try again." });
  }
}
