import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import { rainDelayText, RAIN_DELAY_TEMPLATE_KEY } from "@/lib/domain/scheduling/messages";
import { evaluateJobOnTime } from "./automation";
import { sendCustomerNotice, signerName } from "./notify";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Rain-day promise (SPEC §1.3, §11.2 #9): a person marks a rain delay on a
 * job's day (inserted with their own client, so row security decides who may),
 * the job jumps to the top of the scheduling tray (database trigger), the
 * customer gets the rain-delay text (simulated), and the on-time guarantee
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
  let customerNotified = false;
  let customerNote: string | null = null;
  if (input.notifyCustomer) {
    const [{ data: company }, { data: job }] = await Promise.all([
      service
        .from("company_settings")
        .select("company_name")
        .eq("org_id", input.orgId)
        .maybeSingle(),
      service
        .from("jobs")
        .select("contact:contacts!jobs_primary_contact_id_fkey(first_name)")
        .eq("id", input.jobId)
        .maybeSingle(),
    ]);
    const companyName = company?.company_name ?? "Brushy Bear Painters";
    const sms = rainDelayText(input.date, {
      customerFirstName: job?.contact?.first_name ?? null,
      signerName: await signerName(service, input.jobId, companyName),
      companyName,
    });
    try {
      const r = await sendCustomerNotice(service, input.jobId, {
        sms,
        emailSubject: "Rain delay: we'll move your start to the next dry day",
        emailBody: sms,
        templateKey: RAIN_DELAY_TEMPLATE_KEY,
        actorId: input.actorId,
      });
      if (r.status === "simulated") {
        customerNotified = true;
        await service
          .from("rain_delays")
          .update({ customer_message_id: r.messageId })
          .eq("id", data.id);
      } else customerNote = r.reason;
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
