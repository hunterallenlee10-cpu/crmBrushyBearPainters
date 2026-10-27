import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { ActionFailure, actionError, mapDbError } from "@/lib/actions/errors";
import { endAfterWorkingDays, formatRange, nextProductionDay } from "@/lib/domain/scheduling/dates";
import { firstOpenStart, rankCrews } from "@/lib/domain/scheduling/recommend";
import { logError } from "@/lib/log";
import {
  defaultEntryWorkType,
  jobWorkingDays,
  loadCrews,
  loadEntries,
  loadJobFacts,
  loadSchedulingConfig,
  toBars,
} from "./context";

type Db = SupabaseClient<Database>;

/**
 * Rule-based scheduling recommendations (SPEC §8.6) with the guardrails the
 * SPEC asks for: Require approval ON, Auto-execute OFF, 15-minute undo
 * (Admin → Schedule Admin → Policies). Approving creates a DRAFT on the Master
 * Schedule (it still has to be published) and assigns the crew when the job
 * has none; Undo puts both back while the window is open and the draft hasn't
 * been published.
 */

export async function generateRecommendations(service: Db, orgId: string, now = new Date()) {
  const config = await loadSchedulingConfig(service, orgId, now);
  const { data: ready } = await service
    .from("jobs")
    .select("id")
    .eq("org_id", orgId)
    .eq("stage", "ready_to_schedule")
    .is("deleted_at", null)
    .limit(200);
  const readyIds = (ready ?? []).map((j) => j.id);
  const orgEntries = await loadEntries(service, { orgId });
  const scheduledJobs = new Set(orgEntries.map((e) => e.job_id));
  const candidates = readyIds.filter((id) => !scheduledJobs.has(id));
  const orgCrews = await loadCrews(service, { from: config.context.today, orgId });
  const mine = new Set(orgCrews.map((c) => c.id));
  const facts = await loadJobFacts(service, [
    ...new Set([...candidates, ...orgEntries.map((e) => e.job_id)]),
  ]);
  const bars = toBars(orgEntries, facts).filter((b) => mine.has(b.crewId));
  let created = 0;
  const wanted = new Set<string>();
  for (const jobId of candidates) {
    const job = facts.get(jobId);
    if (!job || !orgCrews.length) continue;
    const days = jobWorkingDays(job, config.settings.crewDayHours);
    const workType = defaultEntryWorkType(job.workTypes);
    const start = nextProductionDay(
      job.promisedStartDate && job.promisedStartDate > config.context.today
        ? job.promisedStartDate
        : config.context.today,
      config.context.productionDays,
    );
    // Rank at the job's preferred start, then find the best crew's first open window.
    const ranked = rankCrews(
      {
        job,
        workType,
        startsOn: start,
        endsOn: endAfterWorkingDays(start, days, config.context.productionDays),
      },
      orgCrews,
      bars,
      config.context,
    );
    let best: {
      crewId: string;
      crewName: string;
      startsOn: string;
      endsOn: string;
      score: number;
      reasons: unknown;
    } | null = null;
    for (const r of ranked) {
      const crew = orgCrews.find((c) => c.id === r.crewId);
      if (!crew) continue;
      if (r.reasons[0]?.points === 0) continue; // skill gap: waiting won't fix it
      const open = firstOpenStart(job, crew, workType, days, bars, config.context, start, 60);
      if (!open) continue;
      best = {
        crewId: r.crewId,
        crewName: r.crewName,
        ...open,
        score: r.score,
        reasons: r.reasons,
      };
      break;
    }
    if (!best) continue;
    const key = `schedule_job:${jobId}`;
    wanted.add(key);
    const { error } = await service.from("schedule_recommendations").insert({
      org_id: orgId,
      kind: "schedule_job",
      job_id: jobId,
      crew_id: best.crewId,
      proposed_starts_on: best.startsOn,
      proposed_ends_on: best.endsOn,
      score: best.score,
      title: `Schedule ${job.label} with ${best.crewName}, ${formatRange(best.startsOn, best.endsOn)}`,
      detail: `${days} production day${days === 1 ? "" : "s"}. Score ${best.score}/100.`,
      reasons: best.reasons as Json[],
      dedupe_key: key,
    });
    if (!error) created++;
    else if (error.code !== "23505") logError("recommendations.insert", error);
  }
  // Recommendations whose job got scheduled (or left Ready to Schedule) expire.
  const { data: open } = await service
    .from("schedule_recommendations")
    .select("id, dedupe_key, job_id")
    .eq("org_id", orgId)
    .eq("status", "pending");
  const stale = (open ?? []).filter((r) => !candidates.includes(r.job_id)).map((r) => r.id);
  if (stale.length) {
    await service.from("schedule_recommendations").update({ status: "expired" }).in("id", stale);
  }
  return { created, expired: stale.length };
}

export async function approveRecommendation(
  db: { supabase: Db; service: Db },
  input: { id: string; actorId: string; orgId: string; now?: Date },
): Promise<{ entryId: string; undoUntil: string }> {
  const now = input.now ?? new Date();
  const { supabase, service } = db;
  const { data: rec } = await supabase
    .from("schedule_recommendations")
    .select("id, kind, job_id, crew_id, proposed_starts_on, proposed_ends_on, status")
    .eq("id", input.id)
    .maybeSingle();
  if (!rec)
    throw new ActionFailure(actionError("not_found", "That recommendation isn't available."));
  if (rec.status !== "pending") {
    throw new ActionFailure(actionError("conflict", "That recommendation was already decided."));
  }
  if (!rec.crew_id || !rec.proposed_starts_on || !rec.proposed_ends_on) {
    throw new ActionFailure(actionError("validation", "This recommendation has no crew or dates."));
  }
  const config = await loadSchedulingConfig(service, input.orgId, now);
  const { data: job } = await supabase
    .from("jobs")
    .select("id, crew_id, work_types")
    .eq("id", rec.job_id)
    .maybeSingle();
  if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
  const { data: entry, error } = await supabase
    .from("schedule_entries")
    .insert({
      org_id: input.orgId,
      job_id: rec.job_id,
      work_type: defaultEntryWorkType(
        job.work_types,
      ) as Database["public"]["Tables"]["schedule_entries"]["Insert"]["work_type"],
      draft_action: "create",
      draft_crew_id: rec.crew_id,
      draft_starts_on: rec.proposed_starts_on,
      draft_ends_on: rec.proposed_ends_on,
      draft_reason: "company",
      draft_note: "From a recommendation",
    })
    .select("id")
    .single();
  if (error) throw new ActionFailure(mapDbError(error));
  const previous = { job_crew_id: job.crew_id };
  if (!job.crew_id) {
    const { error: crewError } = await supabase
      .from("jobs")
      .update({ crew_id: rec.crew_id })
      .eq("id", rec.job_id);
    if (crewError) logError("recommendations.assign_crew", crewError);
  }
  const undoUntil = new Date(
    now.getTime() + config.settings.undoWindowMinutes * 60_000,
  ).toISOString();
  const { error: recError } = await service
    .from("schedule_recommendations")
    .update({
      status: "approved",
      decided_by: input.actorId,
      decided_at: now.toISOString(),
      executed_entry_id: entry.id,
      previous,
      undo_until: undoUntil,
    })
    .eq("id", rec.id);
  if (recError) throw recError;
  await service.rpc("emit_production_event", {
    p_type: "recommendation.executed",
    p_aggregate_type: "schedule_recommendation",
    p_aggregate_id: rec.id,
    p_payload: { org_id: input.orgId, job_id: rec.job_id, entry_id: entry.id } as unknown as Json,
  });
  return { entryId: entry.id, undoUntil };
}

export async function undoRecommendation(
  db: { supabase: Db; service: Db },
  input: { id: string; actorId: string; orgId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const { supabase, service } = db;
  const { data: rec } = await supabase
    .from("schedule_recommendations")
    .select("id, job_id, status, undo_until, executed_entry_id, previous")
    .eq("id", input.id)
    .maybeSingle();
  if (!rec)
    throw new ActionFailure(actionError("not_found", "That recommendation isn't available."));
  if (rec.status !== "approved" || !rec.undo_until) {
    throw new ActionFailure(
      actionError("conflict", "Only an approved recommendation can be undone."),
    );
  }
  if (new Date(rec.undo_until).getTime() < now.getTime()) {
    throw new ActionFailure(
      actionError(
        "validation",
        "The undo window has closed. Change it on the Master Schedule instead.",
      ),
    );
  }
  if (rec.executed_entry_id) {
    const { data: entry } = await service
      .from("schedule_entries")
      .select("id, status")
      .eq("id", rec.executed_entry_id)
      .maybeSingle();
    if (entry && entry.status === "published") {
      throw new ActionFailure(
        actionError(
          "validation",
          "Those dates are already published. Change them on the Master Schedule.",
        ),
      );
    }
    if (entry) {
      const { error } = await service
        .from("schedule_entries")
        .update({ status: "canceled", draft_action: null })
        .eq("id", entry.id);
      if (error) throw error;
    }
  }
  const prev =
    rec.previous && typeof rec.previous === "object" && !Array.isArray(rec.previous)
      ? rec.previous
      : {};
  if (
    "job_crew_id" in prev &&
    (prev.job_crew_id === null || typeof prev.job_crew_id === "string")
  ) {
    await supabase.from("jobs").update({ crew_id: prev.job_crew_id }).eq("id", rec.job_id);
  }
  const { error } = await service
    .from("schedule_recommendations")
    .update({ status: "undone", undo_until: null })
    .eq("id", rec.id);
  if (error) throw error;
  await service.rpc("emit_production_event", {
    p_type: "recommendation.undone",
    p_aggregate_type: "schedule_recommendation",
    p_aggregate_id: rec.id,
    p_payload: { org_id: input.orgId, job_id: rec.job_id } as unknown as Json,
  });
}
