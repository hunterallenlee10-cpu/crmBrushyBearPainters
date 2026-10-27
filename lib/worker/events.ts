import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;
type EventRow = Database["public"]["Tables"]["events"]["Row"];

/**
 * Domain event handlers (SPEC §11.1). Idempotent: an event may be retried
 * after a crash, so handlers only add notifications keyed to the event.
 * Workflows (texts, emails, tasks) arrive in Phase 8; until then most events
 * are marked "skipped".
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

const handlers: Record<string, Handler> = {
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
      .select("id, job:jobs(name)")
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
          body: "A stage override is waiting for your decision.",
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
      const outcome = handler ? await handler(service, e) : "skipped";
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
