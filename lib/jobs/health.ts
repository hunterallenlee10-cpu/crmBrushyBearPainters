import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { computeJobHealth } from "@/lib/domain/jobs/health";
import { checklistSummary, shortLabel } from "@/lib/domain/onboarding/checklist";
import { isJobStageId } from "@/lib/domain/stages";
import { logError } from "@/lib/log";
import { dueDays, jobProductionDays } from "@/lib/domain/scheduling/daily-updates";

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
    const [jobs, appts, tasks, reqs, photos, entries, logs, rain, schedSettings, ledger] =
      await Promise.all([
        service
          .from("jobs")
          .select(
            "id, org_id, stage, stage_entered_at, point_of_contact_id, contract_signed_at, deposit_paid_at, promised_start_date, actual_start_date, health_score, health_factors, crew_id",
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
        service
          .from("onboarding_requirements")
          .select("job_id, key, label, group_key, required, status, verified_auto")
          .in("job_id", ids),
        service
          .from("job_photos")
          .select("job_id, category")
          .in("job_id", ids)
          .in("category", ["before", "progress", "after"])
          .is("deleted_at", null),
        service
          .from("schedule_entries")
          .select("job_id, status, crew_id, starts_on, ends_on, draft_action, draft_crew_id")
          .in("job_id", ids)
          .neq("status", "canceled"),
        service
          .from("daily_logs")
          .select("job_id, log_date")
          .in("job_id", ids)
          .is("deleted_at", null),
        service.from("rain_delays").select("job_id, delay_date").in("job_id", ids),
        service.from("schedule_settings").select("org_id, production_days"),
        service.from("job_ledger").select("job_id, due_cents, overdue_invoices").in("job_id", ids),
      ]);
    const failed =
      jobs.error ??
      appts.error ??
      tasks.error ??
      reqs.error ??
      photos.error ??
      entries.error ??
      logs.error;
    if (failed) {
      logError("jobs.health.load", failed);
      continue;
    }
    const photoCounts = new Map<string, { before: number; progress: number; after: number }>();
    for (const p of photos.data ?? []) {
      const c = photoCounts.get(p.job_id) ?? { before: 0, progress: 0, after: 0 };
      if (p.category === "before" || p.category === "progress" || p.category === "after")
        c[p.category] += 1;
      photoCounts.set(p.job_id, c);
    }
    const overdue = new Map<string, number>();
    for (const t of tasks.data ?? []) {
      if (t.subject_id) overdue.set(t.subject_id, (overdue.get(t.subject_id) ?? 0) + 1);
    }
    for (const j of jobs.data ?? []) {
      if (!isJobStageId(j.stage)) continue;
      const mine = (appts.data ?? []).filter((a) => a.job_id === j.id);
      const rows = (reqs.data ?? [])
        .filter((r) => r.job_id === j.id)
        .map((r) => ({
          key: r.key,
          label: r.label,
          group: r.group_key,
          required: r.required,
          status: r.status,
          verifiedAuto: r.verified_auto,
        }));
      const summary = rows.length ? checklistSummary(rows) : null;
      const myEntries = (entries.data ?? []).filter(
        (e) => e.job_id === j.id && (e.status !== "draft" || e.draft_action),
      );
      const workdays = (
        (schedSettings.data ?? []).find((x) => x.org_id === j.org_id)?.production_days ?? [
          1, 2, 3, 4, 5,
        ]
      ).map(Number);
      const published = myEntries.filter(
        (e) => e.status === "published" && e.starts_on && e.ends_on,
      );
      const days = jobProductionDays(
        published.map((e) => ({ startsOn: e.starts_on as string, endsOn: e.ends_on as string })),
        workdays,
        (rain.data ?? []).filter((r) => r.job_id === j.id).map((r) => r.delay_date),
      );
      const due = dueDays(days, now, { cutoffHour: 19, lookbackDays: 3650 });
      const logged = new Set(
        (logs.data ?? []).filter((l) => l.job_id === j.id).map((l) => l.log_date),
      );
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
          onboarding: summary
            ? {
                required: summary.required,
                cleared: summary.cleared,
                open: summary.open.map((o) => shortLabel(o.key, o.label)),
              }
            : null,
          depositCleared: rows.some((r) => r.key === "deposit_received" && r.status === "verified"),
          photos: photoCounts.get(j.id) ?? { before: 0, progress: 0, after: 0 },
          crewAssigned: Boolean(j.crew_id) || myEntries.some((e) => e.crew_id || e.draft_crew_id),
          scheduled: myEntries.length > 0,
          dailyLogs: { due: due.length, missed: due.filter((d) => !logged.has(d)).length },
          money: (() => {
            const row = (ledger.data ?? []).find((x) => x.job_id === j.id);
            return row
              ? { dueCents: row.due_cents ?? 0, overdueInvoices: row.overdue_invoices ?? 0 }
              : null;
          })(),
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
