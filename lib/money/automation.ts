import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { isJobStageId, type JobStageId } from "@/lib/domain/stages";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { advanceIfGatePasses } from "@/lib/jobs/stage";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

/**
 * Money stage automation (SPEC §6.2 gates 10–12, §10, §11.2 #13), always
 * through advanceIfGatePasses() (never an override):
 * - Completed: the final invoice is drafted (with approved credits);
 * - Completed → Invoiced once the final invoice is sent;
 * - Invoiced → Paid in Full once the balance is $0 and nothing is left to bill.
 * Paid in Full → Closed Won stays with the worker's 3-day auto-close.
 * Service client only.
 */

const MONEY_STEPS: readonly [JobStageId, JobStageId][] = [
  ["completed", "invoiced"],
  ["invoiced", "paid_in_full"],
];

async function stageOf(service: Db, jobId: string): Promise<JobStageId | null> {
  const { data } = await service.from("jobs").select("stage").eq("id", jobId).maybeSingle();
  return data && isJobStageId(data.stage) ? data.stage : null;
}

/** Moves the job through the money gates while they pass. */
export async function advanceMoneyStages(service: Db, jobId: string): Promise<JobStageId[]> {
  const moved: JobStageId[] = [];
  for (let i = 0; i < MONEY_STEPS.length; i++) {
    const stage = await stageOf(service, jobId);
    const step = MONEY_STEPS.find(([from]) => from === stage);
    if (!stage || !step) break;
    if (!(await advanceIfGatePasses(service, jobId, step[0], step[1]))) break;
    moved.push(step[1]);
  }
  return moved;
}

/** Drafts the final invoice for a job at Completed (or later) that has none. Idempotent. */
export async function ensureFinalInvoice(service: Db, jobId: string): Promise<string | null> {
  const stage = await stageOf(service, jobId);
  if (!stage || !["completed", "invoiced"].includes(stage)) return null;
  const { data, error } = await service.rpc("draft_final_invoice", { p_job: jobId });
  if (error) {
    logError("money.final_invoice", error);
    return null;
  }
  return data;
}

/**
 * After any payment, invoice or credit change: re-run the onboarding checks
 * (the deposit item clears and the Deposit Hold releases when the deposit is
 * paid), move the money stages, refresh health. Best effort; logged.
 */
export async function afterMoneyChange(service: Db, jobId: string): Promise<void> {
  const stage = await stageOf(service, jobId);
  if (stage === "sold" || stage === "onboarding") {
    const { reverifyJob } = await import("@/lib/onboarding/checks");
    await reverifyJob(service, jobId).catch((e: unknown) => logError("money.reverify", e));
  }
  await advanceMoneyStages(service, jobId).catch((e: unknown) => logError("money.advance", e));
  await recomputeJobHealth(service, [jobId]).catch((e: unknown) => logError("money.health", e));
}

/**
 * Worker sweep: keep invoice statuses current and raise overdue events
 * (sweep_invoices), draft missing final invoices, and move jobs whose money
 * gate passes (e.g. a payment recorded before the final invoice was sent).
 */
export async function sweepMoney(service: Db): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const { data: swept, error } = await service.rpc("sweep_invoices", { p_limit: 2000 });
  if (error) logError("money.sweep_invoices", error);
  out.invoices = swept ?? null;
  const { data: jobs } = await service
    .from("jobs")
    .select("id, stage")
    .in("stage", ["completed", "invoiced"])
    .is("deleted_at", null)
    .limit(500);
  let drafted = 0;
  let moved = 0;
  for (const j of jobs ?? []) {
    if (j.stage === "completed") {
      const { data: final } = await service
        .from("invoices")
        .select("id")
        .eq("job_id", j.id)
        .eq("invoice_type", "final")
        .neq("status", "void")
        .limit(1);
      if (!final?.length && (await ensureFinalInvoice(service, j.id))) drafted++;
    }
    moved += (await advanceMoneyStages(service, j.id)).length;
  }
  out.finalDrafted = drafted;
  out.moved = moved;
  return out;
}
