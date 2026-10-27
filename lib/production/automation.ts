import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { pacificToday } from "@/lib/domain/scheduling/dates";
import { evaluateOnTime, type OnTimeStatus } from "@/lib/domain/scheduling/on-time";
import { isJobStageId, type JobStageId } from "@/lib/domain/stages";
import { advanceIfGatePasses, loadGateContext } from "@/lib/jobs/stage";
import { exitGate } from "@/lib/domain/jobs/gates";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Production stage automation (SPEC §6.2, PLAN Phase 6), always through
 * advanceIfGatePasses() (never an override):
 * - Ready to Schedule → Scheduled when dates are published;
 * - Scheduled → In Progress on "Start job" or the first daily log (which also
 *   records the actual start date for the on-time guarantee);
 * - In Progress → Final Walkthrough when every work order is complete;
 * - Final Walkthrough → Completed when the punch list is resolved after the
 *   final walkthrough, or the customer signs off.
 * At Completed the final invoice is drafted (lib/money/automation.ts, from
 * advanceJobStage); the money gates move it on from there. Service client only.
 */

const ON_TIME: readonly OnTimeStatus[] = [
  "n/a",
  "met",
  "missed_weather",
  "missed_credit_pending",
  "credit_applied",
  "waived_by_owner",
];

function asOnTime(v: string): OnTimeStatus {
  return (ON_TIME as readonly string[]).includes(v) ? (v as OnTimeStatus) : "n/a";
}

async function stageOf(service: Db, jobId: string): Promise<JobStageId | null> {
  const { data } = await service.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  return data && isJobStageId(data.stage) ? data.stage : null;
}

/** Moves the job one step at a time while each gate passes (stops at Completed). */
export async function advanceProduction(service: Db, jobId: string): Promise<JobStageId[]> {
  const moved: JobStageId[] = [];
  const steps: [JobStageId, JobStageId][] = [
    ["ready_to_schedule", "scheduled"],
    ["in_progress", "final_walkthrough"],
    ["final_walkthrough", "completed"],
  ];
  for (let i = 0; i < 4; i++) {
    const stage = await stageOf(service, jobId);
    const step = steps.find(([from]) => from === stage);
    if (!stage || !step) break;
    const ok = await advanceIfGatePasses(service, jobId, step[0], step[1]);
    if (!ok) break;
    moved.push(step[1]);
  }
  return moved;
}

export type StartResult = {
  started: boolean;
  /** The stage moved to In Progress. */
  advanced: boolean;
  /** Why the stage didn't move (materials, start day), in plain words. */
  reasons: string[];
  actualStartDate: string | null;
};

/**
 * "Start job" / first daily log: records the actual start (Pacific today) the
 * first time, re-evaluates the on-time guarantee, and moves Scheduled → In
 * Progress when its gate passes.
 */
export async function startJob(
  service: Db,
  jobId: string,
  opts: { actorId: string | null; now?: Date; source: "start_button" | "daily_log" },
): Promise<StartResult> {
  const now = opts.now ?? new Date();
  const { data: job } = await service
    .from("jobs")
    .select("id, org_id, stage, actual_start_date")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || !isJobStageId(job.stage)) {
    return {
      started: false,
      advanced: false,
      reasons: ["That job isn't available."],
      actualStartDate: null,
    };
  }
  if (job.stage !== "scheduled" && job.stage !== "ready_to_schedule") {
    return {
      started: job.actual_start_date !== null,
      advanced: false,
      reasons: [],
      actualStartDate: job.actual_start_date,
    };
  }
  let actual = job.actual_start_date;
  if (!actual) {
    actual = pacificToday(now);
    // Milestone dates are protected; the stage engine's system flag isn't
    // available here, so write it as the trusted service (audited).
    const { error } = await service
      .from("jobs")
      .update({ actual_start_date: actual })
      .eq("id", jobId);
    if (error) throw error;
    await service.rpc("emit_production_event", {
      p_type: "job.started",
      p_aggregate_type: "job",
      p_aggregate_id: jobId,
      p_payload: { source: opts.source, actual_start_date: actual } as unknown as Json,
    });
    await service.from("activity").insert({
      org_id: job.org_id,
      subject_type: "job",
      subject_id: jobId,
      type: "job_started",
      summary: opts.source === "daily_log" ? "Job started (first daily log)" : "Job started",
      payload: { actual_start_date: actual },
      actor_id: opts.actorId,
    });
  }
  await evaluateJobOnTime(service, jobId, now).catch((e: unknown) =>
    logError("production.on_time", e),
  );
  let advanced = false;
  let reasons: string[] = [];
  if (job.stage === "scheduled") {
    advanced = await advanceIfGatePasses(service, jobId, "scheduled", "in_progress");
    if (!advanced) {
      const ctx = await loadGateContext(service, jobId);
      reasons = exitGate("scheduled", ctx).reasons;
    }
  } else {
    reasons = ["Publish the job's dates first; it's still Ready to Schedule."];
  }
  return { started: true, advanced, reasons, actualStartDate: actual };
}

/**
 * Re-evaluates the on-time guarantee for one job: sets the status and drafts
 * the credit (amount from Company Settings) for owner approval when a start
 * slipped for a reason other than weather. Idempotent.
 */
export async function evaluateJobOnTime(service: Db, jobId: string, now = new Date()) {
  const { data: job } = await service
    .from("jobs")
    .select("id, org_id, guarantee_start_date, actual_start_date, on_time_guarantee_status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return null;
  const [rain, settings, credit] = await Promise.all([
    service.from("rain_delays").select("delay_date").eq("job_id", jobId),
    service
      .from("company_settings")
      .select("on_time_guarantee_cents")
      .eq("org_id", job.org_id)
      .maybeSingle(),
    service.from("on_time_credits").select("id, status").eq("job_id", jobId).maybeSingle(),
  ]);
  const result = evaluateOnTime({
    guaranteeDate: job.guarantee_start_date,
    actualStartDate: job.actual_start_date,
    today: pacificToday(now),
    rainDelayDates: (rain.data ?? []).map((r) => r.delay_date),
    currentStatus: asOnTime(job.on_time_guarantee_status),
    amountCents: Number(settings.data?.on_time_guarantee_cents ?? 0),
  });
  if (result.status !== job.on_time_guarantee_status) {
    const { error } = await service
      .from("jobs")
      .update({ on_time_guarantee_status: result.status })
      .eq("id", jobId);
    if (error) throw error;
  }
  if (result.draftCredit && !credit.data && job.guarantee_start_date) {
    const { error } = await service.from("on_time_credits").insert({
      org_id: job.org_id,
      job_id: jobId,
      amount_cents: result.draftCredit.amountCents,
      promised_date: job.guarantee_start_date,
      actual_start_date: job.actual_start_date,
      reason: result.draftCredit.reason,
    });
    // The owners hear about it from the "start_missed" workflow (SPEC §11.2 #10).
    if (error && error.code !== "23505") throw error;
  }
  return result;
}

/**
 * Worker sweep: on-time evaluation for jobs with a guarantee date that haven't
 * been decided, and the production stage moves (work orders done, punch list
 * resolved, dates published). Bounded per run.
 */
export async function sweepProduction(service: Db, now = new Date(), limit = 500) {
  const { data: jobs, error } = await service
    .from("jobs")
    .select("id, stage, guarantee_start_date, on_time_guarantee_status")
    .is("deleted_at", null)
    .in("stage", ["ready_to_schedule", "scheduled", "in_progress", "final_walkthrough"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  let evaluated = 0;
  let advanced = 0;
  const touched: string[] = [];
  for (const j of jobs ?? []) {
    try {
      if (
        j.guarantee_start_date &&
        !["credit_applied", "waived_by_owner", "met"].includes(j.on_time_guarantee_status)
      ) {
        await evaluateJobOnTime(service, j.id, now);
        evaluated++;
      }
      if (j.stage !== "scheduled") {
        const moved = await advanceProduction(service, j.id);
        if (moved.length) {
          advanced++;
          touched.push(j.id);
        }
      }
    } catch (e) {
      logError("worker.production.job", e);
    }
  }
  if (touched.length) await recomputeJobHealth(service, touched, now).catch(() => undefined);
  return { jobs: (jobs ?? []).length, evaluated, advanced };
}
