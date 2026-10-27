import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { completeAcceptance, completeChangeOrder } from "@/lib/estimating/proposal";
import { logError } from "@/lib/log";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

type Db = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["events"]["Row"];

/**
 * Domain event handlers (SPEC §11.1). Idempotent: an event may be retried
 * after a crash, so handlers only add notifications keyed to the event.
 * Every event then goes to the workflow engine (Phase 8), which runs each
 * matching workflow once per event (customer messages, staff notices, tasks,
 * drips). Events nothing listens to are marked "skipped".
 */

const MAX_ATTEMPTS = 5;

function payloadOf(e: EventRow): Record<string, Json | undefined> {
  return e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
    ? (e.payload as Record<string, Json | undefined>)
    : {};
}

async function notify(
  service: Db,
  rows: {
    org_id: string;
    user_id: string;
    type: string;
    title: string;
    body?: string | null;
    link: string;
  }[],
) {
  if (!rows.length) return;
  const { error } = await service.from("notifications").insert(rows);
  if (error) throw error;
}

type Handler = (service: Db, e: EventRow) => Promise<"processed" | "skipped">;

/** Tells the job's owner and point of contact what the customer did. */
async function notifyJobPeople(
  service: Db,
  e: EventRow,
  jobId: string | undefined,
  title: (jobName: string) => string,
  body: string | null,
): Promise<"processed" | "skipped"> {
  if (!e.org_id || !jobId) return "skipped";
  const { data: job } = await service
    .from("jobs")
    .select("id, name, owner_id, point_of_contact_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return "skipped";
  const users = new Set(
    [job.owner_id, job.point_of_contact_id].filter((u): u is string => !!u && u !== e.actor_id),
  );
  await notify(
    service,
    [...users].map((user_id) => ({
      org_id: e.org_id as string,
      user_id,
      type: "estimate",
      title: title(job.name).slice(0, 200),
      body,
      link: `/jobs/${job.id}?section=estimate`,
    })),
  );
  return "processed";
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : undefined);

const handlers: Record<string, Handler> = {
  // Signed proposal PDF and the stage moves (idempotent: also run right after signing).
  "estimate.accepted": async (service, e) => {
    if (!e.aggregate_id) return "skipped";
    await completeAcceptance(service, e.aggregate_id);
    return notifyJobPeople(
      service,
      e,
      str(payloadOf(e).job_id),
      (name) => `Estimate accepted and signed: ${name}`,
      "The deposit invoice and onboarding checklist are ready.",
    );
  },
  "estimate.viewed": async (service, e) =>
    notifyJobPeople(
      service,
      e,
      str(payloadOf(e).job_id),
      (n) => `Customer opened the estimate: ${n}`,
      null,
    ),
  "estimate.declined": async (service, e) =>
    notifyJobPeople(
      service,
      e,
      str(payloadOf(e).job_id),
      (n) => `Customer declined the estimate: ${n}`,
      str(payloadOf(e).reason) ?? null,
    ),
  "change_order.signed": async (service, e) => {
    if (!e.aggregate_id) return "skipped";
    await completeChangeOrder(service, e.aggregate_id);
    return notifyJobPeople(
      service,
      e,
      str(payloadOf(e).job_id),
      (n) => `Change order signed: ${n}`,
      null,
    );
  },
  "change_order.declined": async (service, e) =>
    notifyJobPeople(
      service,
      e,
      str(payloadOf(e).job_id),
      (n) => `Change order declined: ${n}`,
      null,
    ),

  // Overdue invoices (7 and 30 days): workflow "invoice_overdue" sends the reminder and the notes.
  // A bounced payment puts money back on the balance: the job's people hear about it.
  "payment.bounced": async (service, e) => {
    if (!e.org_id) return "skipped";
    const jobId = str(payloadOf(e).job_id);
    if (!jobId) return "skipped";
    const { data: job } = await service
      .from("jobs")
      .select("id, name, owner_id, point_of_contact_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return "skipped";
    const users = new Set(
      [job.owner_id, job.point_of_contact_id].filter((u): u is string => !!u && u !== e.actor_id),
    );
    await notify(
      service,
      [...users].map((user_id) => ({
        org_id: e.org_id as string,
        user_id,
        type: "finance",
        title: `A payment bounced: ${job.name}`.slice(0, 200),
        body: "The amount is back on the balance.",
        link: `/jobs/${job.id}?section=financial&tab=payments`,
      })),
    );
    return "processed";
  },

  // The job's team hears about stage changes they didn't make.
  "job.stage_changed": async (service, e) => {
    if (!e.org_id || !e.aggregate_id) return "skipped";
    const p = payloadOf(e);
    const to =
      typeof p.to === "string" && isJobStageId(p.to) ? getStage(p.to).label : "a new stage";
    const { data: job } = await service
      .from("jobs")
      .select("id, name, owner_id, point_of_contact_id, project_manager_id")
      .eq("id", e.aggregate_id)
      .maybeSingle();
    if (!job) return "skipped";
    const users = new Set(
      [job.owner_id, job.point_of_contact_id, job.project_manager_id].filter(
        (u): u is string => !!u && u !== e.actor_id,
      ),
    );
    await notify(
      service,
      [...users].map((user_id) => ({
        org_id: e.org_id as string,
        user_id,
        type: "job_stage",
        title: `${job.name} moved to ${to}`.slice(0, 200),
        body: p.override === true ? "Moved by an owner override." : null,
        link: `/jobs/${job.id}`,
      })),
    );
    return "processed";
  },

  // Owners hear about new approval requests; requesters hear the decision.
  "approval.created": async (service, e) => {
    if (!e.org_id || !e.aggregate_id) return "skipped";
    const { data: req } = await service
      .from("approval_requests")
      .select("id, type, job:jobs(name)")
      .eq("id", e.aggregate_id)
      .maybeSingle();
    if (!req) return "skipped";
    const { data: owners } = await service
      .from("profiles")
      .select("id, role_templates!inner(grants_all)")
      .eq("org_id", e.org_id)
      .eq("is_active", true)
      .eq("role_templates.grants_all", true);
    await notify(
      service,
      (owners ?? [])
        .filter((o) => o.id !== e.actor_id)
        .map((o) => ({
          org_id: e.org_id as string,
          user_id: o.id,
          type: "approval",
          title: `Approval needed: ${req.job?.name ?? "a job"}`.slice(0, 200),
          body:
            req.type === "estimate_discount"
              ? "An estimate discount over the limit is waiting for your decision."
              : "A stage override is waiting for your decision.",
          link: "/jobs/approvals",
        })),
    );
    return "processed";
  },
  "approval.updated": async (service, e) => {
    if (!e.org_id || !e.aggregate_id) return "skipped";
    const { data: req } = await service
      .from("approval_requests")
      .select("id, status, requested_by, decided_by, job_id, job:jobs(name)")
      .eq("id", e.aggregate_id)
      .maybeSingle();
    if (
      !req ||
      req.status === "pending" ||
      req.status === "canceled" ||
      req.requested_by === req.decided_by
    ) {
      return "skipped";
    }
    await notify(service, [
      {
        org_id: e.org_id,
        user_id: req.requested_by,
        type: "approval",
        title: `Your request was ${req.status}: ${req.job?.name ?? "a job"}`.slice(0, 200),
        link: `/jobs/${req.job_id}`,
      },
    ]);
    return "processed";
  },
};

export type EventRunResult = {
  claimed: number;
  processed: number;
  skipped: number;
  failed: number;
};

export async function processEvents(service: Db, limit = 200): Promise<EventRunResult> {
  const result: EventRunResult = { claimed: 0, processed: 0, skipped: 0, failed: 0 };
  const { data: events, error } = await service.rpc("claim_events", { p_limit: limit });
  if (error) throw error;
  result.claimed = events?.length ?? 0;
  for (const e of events ?? []) {
    const handler = handlers[e.type];
    try {
      let outcome = handler ? await handler(service, e) : "skipped";
      // Workflows (idempotent per workflow and event; failures are logged on the run).
      const runs = await runWorkflowsForEvent(service, e);
      if (runs.some((r) => r.status !== "not_matched")) outcome = "processed";
      await service
        .from("events")
        .update({
          status: outcome,
          processed_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
        })
        .eq("id", e.id);
      result[outcome]++;
    } catch (err) {
      result.failed++;
      logError(`worker.event.${e.type}`, err);
      const retry = e.attempts < MAX_ATTEMPTS;
      await service
        .from("events")
        .update({
          status: retry ? "pending" : "failed",
          locked_at: null,
          // Back off: 1, 4, 9, 16 minutes.
          available_at: new Date(Date.now() + e.attempts * e.attempts * 60_000).toISOString(),
          last_error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
        })
        .eq("id", e.id);
    }
  }
  return result;
}
