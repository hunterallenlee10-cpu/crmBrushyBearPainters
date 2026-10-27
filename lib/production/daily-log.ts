import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { DailyLogInput } from "@/lib/validation/production";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { startJob, type StartResult } from "./automation";
import { dispatchNow, findEvent, noticeOutcome } from "@/lib/workflows/engine";

type Db = SupabaseClient<Database>;

/**
 * Daily log submission (SPEC §1.3 "a photo update every day", "a clean house
 * every evening", §8.5 #9, §11.2 #11). The cleanup photo is stored first, then
 * the log (its id is the offline queue's client id, so a retry never
 * duplicates), hours per crew member as time entries, then the customer update
 * is recorded in the outbox as simulated, signed by the job's point of contact.
 * The first daily log on a Scheduled job starts it.
 */

export type DailyLogResult = {
  id: string;
  duplicate: boolean;
  customerUpdate: "simulated" | "skipped";
  customerNote: string | null;
  start: StartResult | null;
};

export async function createDailyLog(
  db: { supabase: Db; service: Db },
  input: {
    orgId: string;
    jobId: string;
    actorId: string;
    cleanupPhotoId: string;
    log: DailyLogInput;
  },
): Promise<DailyLogResult> {
  const { supabase, service } = db;
  const v = input.log;
  const { data: existing } = await service
    .from("daily_logs")
    .select("id, job_id, customer_update_status")
    .eq("id", v.clientId)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id,
      duplicate: true,
      customerUpdate: existing.customer_update_status === "simulated" ? "simulated" : "skipped",
      customerNote: null,
      start: null,
    };
  }
  const { data: entry } = await service
    .from("schedule_entries")
    .select("id")
    .eq("job_id", input.jobId)
    .eq("status", "published")
    .lte("starts_on", v.logDate)
    .gte("ends_on", v.logDate)
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("daily_logs").insert({
    id: v.clientId,
    org_id: input.orgId,
    job_id: input.jobId,
    work_order_id: v.workOrderId ?? null,
    schedule_entry_id: entry?.id ?? null,
    log_date: v.logDate,
    finished_today: v.finishedToday,
    next_up: v.nextUp || null,
    issues: v.issues || null,
    weather_observed: v.weatherObserved || null,
    cleanup_done: true,
    cleanup_photo_id: input.cleanupPhotoId,
    source: v.source,
  });
  if (error) {
    if (error.code === "23505") {
      return {
        id: v.clientId,
        duplicate: true,
        customerUpdate: "skipped",
        customerNote: null,
        start: null,
      };
    }
    throw error;
  }
  await service
    .from("job_photos")
    .update({ daily_log_id: v.clientId })
    .eq("id", input.cleanupPhotoId);

  if (v.hours.length) {
    const { error: hoursError } = await supabase.from("time_entries").insert(
      v.hours.map((h) => ({
        org_id: input.orgId,
        job_id: input.jobId,
        work_order_id: v.workOrderId ?? null,
        daily_log_id: v.clientId,
        user_id: h.userId ?? null,
        member_name: h.userId ? null : (h.name ?? null),
        entry_date: v.logDate,
        hours: h.hours,
        entry_type: "production",
      })),
    );
    if (hoursError) logError("daily_log.hours", hoursError);
  }

  const customer = await sendDailyUpdate(service, input.jobId, v.clientId, input.actorId).catch(
    (e: unknown) => {
      logError("daily_log.customer_update", e);
      return {
        status: "skipped" as const,
        reason: "The customer update couldn't be recorded; the worker will retry.",
      };
    },
  );

  let start: StartResult | null = null;
  const { data: job } = await service
    .from("jobs")
    .select("stage")
    .eq("id", input.jobId)
    .maybeSingle();
  if (job?.stage === "scheduled") {
    start = await startJob(service, input.jobId, {
      actorId: input.actorId,
      source: "daily_log",
    }).catch((e: unknown) => {
      logError("daily_log.start", e);
      return null;
    });
  }
  await recomputeJobHealth(service, [input.jobId]).catch((e: unknown) =>
    logError("daily_log.health", e),
  );
  return {
    id: v.clientId,
    duplicate: false,
    customerUpdate: customer.status === "simulated" ? "simulated" : "skipped",
    customerNote: customer.status === "simulated" ? null : customer.reason,
    start,
  };
}

/**
 * The customer update for a log is the "daily_log_update" workflow (SPEC §11.2
 * #11): run it now for the log's event (one run per event, so the worker never
 * sends it again). The workflow records the result on the log.
 */
export async function sendDailyUpdate(
  service: Db,
  jobId: string,
  logId: string,
  actorId: string | null,
): Promise<{ status: "simulated" } | { status: "skipped"; reason: string }> {
  void jobId;
  void actorId;
  const { data: log } = await service
    .from("daily_logs")
    .select("id, customer_update_status")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { status: "skipped", reason: "The daily log isn't available." };
  if (log.customer_update_status !== "draft") {
    return log.customer_update_status === "simulated"
      ? { status: "simulated" }
      : { status: "skipped", reason: "Already handled." };
  }
  const event = await findEvent(service, "daily_log.submitted", logId);
  const run = (await dispatchNow(service, event)).find((r) => r.workflowKey === "daily_log_update");
  const n = noticeOutcome(run);
  if (run?.status === "skipped") {
    await service
      .from("daily_logs")
      .update({ customer_update_status: "skipped", customer_update_note: n.note })
      .eq("id", logId)
      .eq("customer_update_status", "draft");
  }
  const { data: after } = await service
    .from("daily_logs")
    .select("customer_update_status, customer_update_note")
    .eq("id", logId)
    .maybeSingle();
  if (after?.customer_update_status === "simulated") return { status: "simulated" };
  return {
    status: "skipped",
    reason: n.note ?? after?.customer_update_note ?? "The customer update wasn't sent.",
  };
}

/** Worker: logs whose customer update is still a draft after 2 minutes. */
export async function sweepDailyUpdates(service: Db, limit = 100) {
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data, error } = await service
    .from("daily_logs")
    .select("id, job_id")
    .eq("customer_update_status", "draft")
    .is("deleted_at", null)
    .lt("created_at", cutoff)
    .limit(limit);
  if (error) throw error;
  // Logs whose workflow already ran (or is waiting for quiet hours to end) are the workflow's.
  const { data: runs } = data?.length
    ? await service
        .from("workflow_runs")
        .select("subject_id")
        .eq("workflow_key", "daily_log_update")
        .in(
          "subject_id",
          data.map((l) => l.id),
        )
    : { data: [] as { subject_id: string | null }[] };
  const handled = new Set((runs ?? []).map((r) => r.subject_id));
  let sent = 0;
  for (const l of data ?? []) {
    if (handled.has(l.id)) continue;
    const r = await sendDailyUpdate(service, l.job_id, l.id, null).catch((e: unknown) => {
      logError("worker.daily_update", e);
      return null;
    });
    if (r?.status === "simulated") sent++;
  }
  return { checked: (data ?? []).length, sent };
}
