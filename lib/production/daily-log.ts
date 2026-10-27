import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { dailyUpdateText, DAILY_UPDATE_TEMPLATE_KEY } from "@/lib/domain/scheduling/messages";
import type { DailyLogInput } from "@/lib/validation/production";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import { startJob, type StartResult } from "./automation";
import { sendCustomerNotice, signerName } from "./notify";

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

/** Records the customer update for a log (idempotent: only logs still in draft). */
export async function sendDailyUpdate(
  service: Db,
  jobId: string,
  logId: string,
  actorId: string | null,
): Promise<{ status: "simulated" } | { status: "skipped"; reason: string }> {
  const { data: log } = await service
    .from("daily_logs")
    .select("id, org_id, finished_today, next_up, customer_update_status")
    .eq("id", logId)
    .maybeSingle();
  if (!log) return { status: "skipped", reason: "The daily log isn't available." };
  if (log.customer_update_status !== "draft") {
    return log.customer_update_status === "simulated"
      ? { status: "simulated" }
      : { status: "skipped", reason: "Already handled." };
  }
  const [{ count }, company, contact] = await Promise.all([
    service
      .from("job_photos")
      .select("id", { count: "exact", head: true })
      .eq("daily_log_id", logId),
    service.from("company_settings").select("company_name").eq("org_id", log.org_id).maybeSingle(),
    service
      .from("jobs")
      .select("contact:contacts!jobs_primary_contact_id_fkey(first_name)")
      .eq("id", jobId)
      .maybeSingle(),
  ]);
  const companyName = company.data?.company_name ?? "Brushy Bear Painters";
  const text = dailyUpdateText(
    { finishedToday: log.finished_today, nextUp: log.next_up, photoCount: count ?? 0 },
    {
      customerFirstName: contact.data?.contact?.first_name ?? null,
      signerName: await signerName(service, jobId, companyName),
      companyName,
    },
  );
  const r = await sendCustomerNotice(service, jobId, {
    ...text,
    templateKey: DAILY_UPDATE_TEMPLATE_KEY,
    actorId,
  });
  const patch =
    r.status === "simulated"
      ? {
          customer_update_status: "simulated",
          customer_message_id: r.messageId,
          sent_at: new Date().toISOString(),
          customer_update_note: null,
        }
      : { customer_update_status: "skipped", customer_update_note: r.reason.slice(0, 500) };
  const { error } = await service.from("daily_logs").update(patch).eq("id", logId);
  if (error) throw error;
  await service.rpc("emit_production_event", {
    p_type: "daily_log.customer_update",
    p_aggregate_type: "daily_log",
    p_aggregate_id: logId,
    p_payload: {
      org_id: log.org_id,
      job_id: jobId,
      status: patch.customer_update_status,
    } as unknown as Json,
  });
  return r.status === "simulated"
    ? { status: "simulated" }
    : { status: "skipped", reason: r.reason };
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
  let sent = 0;
  for (const l of data ?? []) {
    const r = await sendDailyUpdate(service, l.job_id, l.id, null).catch((e: unknown) => {
      logError("worker.daily_update", e);
      return null;
    });
    if (r?.status === "simulated") sent++;
  }
  return { checked: (data ?? []).length, sent };
}
