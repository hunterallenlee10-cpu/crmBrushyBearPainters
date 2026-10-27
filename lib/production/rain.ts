import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import { evaluateJobOnTime } from "./automation";
import { logError } from "@/lib/log";
import { dispatchNow, findEvent, noticeOutcome } from "@/lib/workflows/engine";

type Db = SupabaseClient<Database>;

/**
 * Rain-day promise (SPEC §1.3, §11.2 #9): a person marks a rain delay on a
 * job's day (inserted with their own client, so row security decides who may),
 * the job jumps to the top of the scheduling tray (database trigger), the
 * "rain_delay" workflow texts the customer (simulated; quiet hours and
 * consent apply; turning the workflow off stops it), and the on-time guarantee
 * treats the slip as weather. A rain delay has no money on it and can never
 * draft a credit (the database refuses one).
 */
export async function markRainDelay(
  db: { supabase: Db; service: Db },
  input: {
    orgId: string;
    jobId: string;
    date: string;
    note?: string;
    notifyCustomer: boolean;
    actorId: string;
  },
): Promise<{ id: string; customerNotified: boolean; customerNote: string | null }> {
  const { supabase, service } = db;
  const { data: entry } = await service
    .from("schedule_entries")
    .select("id")
    .eq("job_id", input.jobId)
    .eq("status", "published")
    .lte("starts_on", input.date)
    .gte("ends_on", input.date)
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("rain_delays")
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      delay_date: input.date,
      schedule_entry_id: entry?.id ?? null,
      note: input.note || null,
      notify_customer: input.notifyCustomer,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ActionFailure(
        actionError("conflict", "That day is already marked as a rain delay."),
      );
    }
    throw new ActionFailure(mapDbError(error));
  }
  // The customer text is the "rain_delay" workflow (SPEC §11.2 #9): run it now
  // for this rain delay's event (the worker would within a minute; one run per event).
  let customerNotified = false;
  let customerNote: string | null = null;
  if (input.notifyCustomer) {
    try {
      const event = await findEvent(
        service,
        "job.rain_delay",
        input.jobId,
        (p) => p.rain_delay_id === data.id,
      );
      const run = (await dispatchNow(service, event)).find((r) => r.workflowKey === "rain_delay");
      const n = noticeOutcome(run);
      customerNotified = n.sent;
      customerNote = n.note;
    } catch (e) {
      logError("production.rain.notice", e);
      customerNote = "The customer text couldn't be recorded.";
    }
  }
  await evaluateJobOnTime(service, input.jobId).catch((e: unknown) =>
    logError("production.rain.on_time", e),
  );
  return { id: data.id, customerNotified, customerNote };
}
