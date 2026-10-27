import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { computeJobHealth } from "@/lib/domain/jobs/health";
import { isJobStageId } from "@/lib/domain/stages";
import { logError } from "@/lib/log";

type Db = SupabaseClient<Database>;

const CLOSED = ["canceled", "completed", "no_show", "rescheduled"];

/** JSON with sorted keys (jsonb doesn't keep key order). */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/**
 * Recomputes and stores health for the given jobs (service client: health is
 * derived data only trusted code writes). Best effort: failures are logged.
 */
export async function recomputeJobHealth(service: Db, jobIds: readonly string[], now = new Date()) {
  if (jobIds.length === 0) return { updated: 0 };
  let updated = 0;
  for (let i = 0; i < jobIds.length; i += 200) {
    const ids = jobIds.slice(i, i + 200);
    const [jobs, appts, tasks] = await Promise.all([
      service
        .from("jobs")
        .select(
          "id, stage, stage_entered_at, point_of_contact_id, contract_signed_at, deposit_paid_at, promised_start_date, actual_start_date, health_score, health_factors",
        )
        .in("id", ids)
        .is("deleted_at", null),
      service
        .from("appointments")
        .select("job_id, type, status, starts_at")
        .in("job_id", ids)
        .is("deleted_at", null),
      service
        .from("tasks")
        .select("subject_id")
        .eq("subject_type", "job")
        .in("subject_id", ids)
        .eq("status", "open")
        .is("deleted_at", null)
        .lt("due_at", now.toISOString()),
    ]);
    if (jobs.error || appts.error || tasks.error) {
      logError("jobs.health.load", jobs.error ?? appts.error ?? tasks.error);
      continue;
    }
    const overdue = new Map<string, number>();
    for (const t of tasks.data ?? []) {
      if (t.subject_id) overdue.set(t.subject_id, (overdue.get(t.subject_id) ?? 0) + 1);
    }
    for (const j of jobs.data ?? []) {
      if (!isJobStageId(j.stage)) continue;
      const mine = (appts.data ?? []).filter((a) => a.job_id === j.id);
      const next = mine
        .filter((a) => !CLOSED.includes(a.status) && new Date(a.starts_at) >= now)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      const health = computeJobHealth(
        {
          stage: j.stage,
          stageEnteredAt: j.stage_entered_at,
          pointOfContactId: j.point_of_contact_id,
          nextAppointmentAt: next?.starts_at ?? null,
          walkthroughDone: mine.some((a) => a.type === "walkthrough" && a.status === "completed"),
          overdueTaskCount: overdue.get(j.id) ?? 0,
          contractSignedAt: j.contract_signed_at,
          depositPaidAt: j.deposit_paid_at,
          promisedStartDate: j.promised_start_date,
          actualStartDate: j.actual_start_date,
        },
        now,
      );
      const score = health?.score ?? null;
      const factors = health?.factors ?? [];
      // Skip unchanged results so the job's "last updated" isn't bumped every minute.
      if (score === j.health_score && stableJson(factors) === stableJson(j.health_factors))
        continue;
      const { error } = await service
        .from("jobs")
        .update({
          health_score: score,
          health_factors: factors as unknown as Json[],
          health_checked_at: now.toISOString(),
        })
        .eq("id", j.id);
      if (error) logError("jobs.health.save", error);
      else updated++;
    }
  }
  return { updated };
}
