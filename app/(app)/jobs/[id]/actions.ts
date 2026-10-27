"use server";

import { revalidatePath } from "next/cache";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import type { Database, Json } from "@/lib/db/types";
import { checkTransition } from "@/lib/domain/jobs/gates";
import {
  APPOINTMENT_TYPE_LABELS,
  BOOKABLE_APPOINTMENT_TYPES,
  type MilestoneField,
} from "@/lib/domain/jobs/constants";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { advanceJobStage, loadGateContext } from "@/lib/jobs/stage";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { logError } from "@/lib/log";
import {
  advanceStageSchema,
  appointmentStatusSchema,
  bookAppointmentSchema,
  cancelApprovalSchema,
  contractBaselineSchema,
  deleteJobSchema,
  jobUpdateSchema,
  milestonesSchema,
  onTimeStatusSchema,
  placeHoldSchema,
  releaseHoldSchema,
  requestOverrideSchema,
} from "@/lib/validation/jobs";
import { promisedStartSchema, releaseAllHoldsSchema } from "./schemas";
import { pacificToUtcIso } from "./utils";

/**
 * Job Detail mutations (SPEC §8.5). Each one: zod-validated, permission-checked
 * by defineAction (which also refuses while viewing as another user), writes
 * through the user's own Supabase client so row security decides, and is
 * audit-logged and turned into a domain event by database triggers. Stage
 * changes only go through advanceJobStage().
 */

type JobPatch = Database["public"]["Tables"]["jobs"]["Update"];

const NOT_FOUND = new ActionFailure({ code: "not_found", message: "That job isn't available." });
const CANT_EDIT = new ActionFailure({
  code: "forbidden",
  message: "You can only change jobs you're on or that you own.",
});

const jobPath = (id: string) => `/jobs/${id}`;

function refresh(id: string) {
  revalidatePath(jobPath(id));
  revalidatePath("/jobs/list");
}

/** Health reads the point of contact, appointments, tasks and milestone dates. */
async function refreshHealth(ctx: ActionContext, jobId: string) {
  try {
    await recomputeJobHealth(await ctx.service(), [jobId]);
  } catch (e) {
    logError("jobs.detail.health", e);
  }
}

/** The job as the person sees it (row security); 404s when hidden. */
async function visibleJob(ctx: ActionContext, id: string) {
  const job = check(
    await ctx.supabase.from("jobs").select("id, org_id, stage").eq("id", id).maybeSingle(),
  );
  if (!job || !isJobStageId(job.stage)) throw NOT_FOUND;
  return { id: job.id, orgId: job.org_id, stage: job.stage };
}

// --- Job fields -------------------------------------------------------------------------

export const updateJob = defineAction({
  name: "jobs.update",
  permissions: ["jobs:update"],
  schema: jobUpdateSchema,
  handler: async ({ id, owner_id, ...values }, ctx) => {
    await visibleJob(ctx, id);
    // Only people who can assign jobs may change the owner (the database guard agrees).
    const patch: JobPatch = ctx.viewer.can("jobs:assign") ? { ...values, owner_id } : values;
    const rows = check(await ctx.supabase.from("jobs").update(patch).eq("id", id).select("id"));
    if (!rows?.length) throw CANT_EDIT;
    await refreshHealth(ctx, id);
    refresh(id);
    return { id };
  },
});

// --- Stage ------------------------------------------------------------------------------

export const advanceStage = defineAction({
  name: "jobs.advance_stage",
  permissions: ["jobs:advance_stage"],
  schema: advanceStageSchema,
  handler: async ({ id, to_stage, override, reason, lost_reason }, ctx) => {
    if (!isJobStageId(to_stage)) throw NOT_FOUND;
    const result = await advanceJobStage(
      { jobId: id, toStage: to_stage, override, reason, lostReason: lost_reason ?? null },
      ctx,
    );
    refresh(id);
    return result;
  },
});

/** Non-owners ask an owner to override a gate; the request lands in Approvals. */
export const requestOverride = defineAction({
  name: "jobs.request_override",
  permissions: ["jobs:advance_stage"],
  schema: requestOverrideSchema,
  handler: async ({ id, to_stage, reason }, ctx) => {
    if (!isJobStageId(to_stage)) throw NOT_FOUND;
    if (ctx.viewer.can("job_admin:override")) {
      throw new ActionFailure(
        actionError("validation", "You can override this yourself with a reason."),
      );
    }
    const job = await visibleJob(ctx, id);
    const gate = await loadGateContext(await ctx.service(), id);
    const result = checkTransition(job.stage, to_stage, gate);
    if (result.allowed) {
      throw new ActionFailure(
        actionError(
          "validation",
          `No override needed. Use Advance to ${getStage(to_stage).label}.`,
        ),
      );
    }
    if (!result.overridable) {
      throw new ActionFailure(actionError("validation", result.reasons.join(" ")));
    }
    const { data, error } = await ctx.supabase
      .from("approval_requests")
      .insert({
        org_id: job.orgId,
        type: "stage_override",
        job_id: id,
        requested_by: ctx.viewer.id,
        reason,
        payload: {
          from_stage: job.stage,
          to_stage,
          gate_reasons: result.reasons,
        } satisfies Record<string, Json>,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new ActionFailure(
          actionError("conflict", "This job already has a request waiting for an owner."),
        );
      }
      throw new ActionFailure(mapDbError(error));
    }
    refresh(id);
    revalidatePath("/jobs/approvals");
    return { id: data.id };
  },
});

export const cancelOverrideRequest = defineAction({
  name: "jobs.cancel_override_request",
  permissions: ["jobs:advance_stage"],
  schema: cancelApprovalSchema,
  handler: async ({ id }, { supabase }) => {
    const rows = check(
      await supabase
        .from("approval_requests")
        .update({ status: "canceled" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id, job_id"),
    );
    const row = rows?.[0];
    if (!row) {
      throw new ActionFailure(
        actionError("not_found", "That request was already decided or canceled."),
      );
    }
    refresh(row.job_id);
    revalidatePath("/jobs/approvals");
    return { id };
  },
});

// --- Holds ------------------------------------------------------------------------------

export const placeHold = defineAction({
  name: "jobs.place_hold",
  permissions: ["jobs:update"],
  schema: placeHoldSchema,
  handler: async ({ job_id, hold_type, reason, blocks_scheduling }, ctx) => {
    const job = await visibleJob(ctx, job_id);
    const { error } = await ctx.supabase.from("job_holds").insert({
      org_id: job.orgId,
      job_id,
      hold_type,
      reason,
      blocks_scheduling,
    });
    if (error) {
      // Row security refuses holds on jobs outside the person's edit scope.
      if (error.code === "42501") throw CANT_EDIT;
      throw new ActionFailure(mapDbError(error));
    }
    refresh(job_id);
    return { ok: true };
  },
});

export const releaseHold = defineAction({
  name: "jobs.release_hold",
  permissions: ["jobs:update"],
  schema: releaseHoldSchema,
  handler: async ({ id, note }, { supabase }) => {
    const rows = check(
      await supabase
        .from("job_holds")
        .update({ released_at: new Date().toISOString(), release_note: note })
        .eq("id", id)
        .is("released_at", null)
        .select("job_id"),
    );
    const row = rows?.[0];
    if (!row) {
      throw new ActionFailure(
        actionError("not_found", "That hold is already released, or you can't change it."),
      );
    }
    refresh(row.job_id);
    return { id };
  },
});

/** Admin → Status overrides: releases every active hold with one note. */
export const releaseAllHolds = defineAction({
  name: "jobs.release_all_holds",
  permissions: ["job_admin:override", "jobs:update"],
  schema: releaseAllHoldsSchema,
  handler: async ({ job_id, note }, ctx) => {
    await visibleJob(ctx, job_id);
    const rows = check(
      await ctx.supabase
        .from("job_holds")
        .update({ released_at: new Date().toISOString(), release_note: note })
        .eq("job_id", job_id)
        .is("released_at", null)
        .select("id"),
    );
    refresh(job_id);
    return { released: rows?.length ?? 0 };
  },
});

// --- Appointments -------------------------------------------------------------------------

export const bookAppointment = defineAction({
  name: "jobs.book_appointment",
  permissions: ["appointments:manage"],
  schema: bookAppointmentSchema,
  handler: async (
    { job_id, type, date, time, duration_minutes, assigned_user_ids, notes },
    ctx,
  ) => {
    if (!(BOOKABLE_APPOINTMENT_TYPES as readonly string[]).includes(type)) {
      throw new ActionFailure(
        actionError("validation", "Production days are booked from the schedule (Phase 6).", {
          type: ["Pick one of the listed appointment types."],
        }),
      );
    }
    const startsAt = pacificToUtcIso(date, time);
    if (new Date(startsAt).getTime() < Date.now() - 60_000) {
      throw new ActionFailure(
        actionError("validation", "Pick a time that hasn't passed yet.", {
          date: ["Pick a time that hasn't passed yet."],
        }),
      );
    }
    const job = check(
      await ctx.supabase
        .from("jobs")
        .select("id, org_id, owner_id, property:properties(street, unit, city, state, zip)")
        .eq("id", job_id)
        .maybeSingle(),
    );
    if (!job) throw NOT_FOUND;
    const p = job.property;
    const location = p
      ? [
          [p.street, p.unit].filter(Boolean).join(" "),
          p.city,
          [p.state, p.zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ") || null
      : null;
    const assignees = assigned_user_ids.length
      ? [...new Set(assigned_user_ids)]
      : [job.owner_id ?? ctx.viewer.id];
    const { error } = await ctx.supabase.from("appointments").insert({
      org_id: job.org_id,
      job_id,
      type,
      title: APPOINTMENT_TYPE_LABELS[type],
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + duration_minutes * 60_000).toISOString(),
      assigned_user_ids: assignees,
      location,
      notes,
    });
    if (error) throw new ActionFailure(mapDbError(error));
    await refreshHealth(ctx, job_id);
    refresh(job_id);
    return { startsAt };
  },
});

/**
 * Confirm / complete / no-show / cancel. Completing a walkthrough as "Measured"
 * while the job is at Walkthrough Scheduled moves it forward (never an override).
 */
export const setAppointmentStatus = defineAction({
  name: "jobs.appointment_status",
  permissions: ["appointments:manage"],
  schema: appointmentStatusSchema,
  handler: async ({ id, status, result, note }, ctx) => {
    const appt = check(
      await ctx.supabase
        .from("appointments")
        .select("id, job_id, type, status")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!appt?.job_id) {
      throw new ActionFailure(actionError("not_found", "That appointment isn't available."));
    }
    const jobId = appt.job_id;
    const walkthrough = appt.type === "walkthrough";
    if (status === "completed" && walkthrough && !result) {
      throw new ActionFailure(
        actionError("validation", "Pick the walkthrough result.", {
          result: ["Pick the walkthrough result."],
        }),
      );
    }
    const rows = check(
      await ctx.supabase
        .from("appointments")
        .update({
          status,
          result: status === "completed" && walkthrough ? (result ?? null) : null,
          ...(status === "canceled" ? { canceled_reason: note } : {}),
        })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) {
      throw new ActionFailure(actionError("forbidden", "You can't change that appointment."));
    }

    let advanced = false;
    let advanceError: string | null = null;
    if (status === "completed" && walkthrough && result === "measured") {
      const job = check(
        await ctx.supabase.from("jobs").select("stage").eq("id", jobId).maybeSingle(),
      );
      if (job?.stage === "walkthrough_scheduled" && ctx.viewer.can("jobs:advance_stage")) {
        try {
          await advanceJobStage({ jobId, toStage: "walkthrough_complete" }, ctx);
          advanced = true;
        } catch (e) {
          logError("jobs.appointment_status.advance", e);
          advanceError =
            e instanceof ActionFailure ? e.error.message : "The job couldn't move forward.";
        }
      }
    }
    if (!advanced) await refreshHealth(ctx, jobId);
    refresh(jobId);
    return { id, advanced, advanceError };
  },
});

// --- Admin (owners) -------------------------------------------------------------------

export const setMilestone = defineAction({
  name: "jobs.set_milestone",
  permissions: ["job_admin:override"],
  schema: milestonesSchema,
  handler: async ({ id, field, value }, ctx) => {
    await visibleJob(ctx, id);
    const patch: JobPatch = {};
    patch[field as MilestoneField] = value;
    const rows = check(await ctx.supabase.from("jobs").update(patch).eq("id", id).select("id"));
    if (!rows?.length) throw CANT_EDIT;
    await refreshHealth(ctx, id);
    refresh(id);
    return { id, field };
  },
});

export const setPromisedStart = defineAction({
  name: "jobs.set_promised_start",
  permissions: ["job_admin:override", "jobs:update"],
  schema: promisedStartSchema,
  handler: async ({ id, value }, ctx) => {
    await visibleJob(ctx, id);
    const rows = check(
      await ctx.supabase
        .from("jobs")
        .update({ promised_start_date: value })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) throw CANT_EDIT;
    await refreshHealth(ctx, id);
    refresh(id);
    return { id };
  },
});

export const setContractBaseline = defineAction({
  name: "jobs.set_contract_baseline",
  permissions: ["job_admin:override"],
  schema: contractBaselineSchema,
  handler: async ({ id, amount_cents }, ctx) => {
    const job = await visibleJob(ctx, id);
    check(
      await ctx.supabase
        .from("job_financials")
        .upsert(
          { job_id: id, org_id: job.orgId, contract_baseline_cents: amount_cents },
          { onConflict: "job_id" },
        ),
    );
    refresh(id);
    revalidatePath("/jobs");
    return { id, amountCents: amount_cents };
  },
});

export const setOnTimeStatus = defineAction({
  name: "jobs.set_on_time_status",
  permissions: ["job_admin:override"],
  schema: onTimeStatusSchema,
  handler: async ({ id, status }, ctx) => {
    await visibleJob(ctx, id);
    const rows = check(
      await ctx.supabase
        .from("jobs")
        .update({ on_time_guarantee_status: status })
        .eq("id", id)
        .select("id"),
    );
    if (!rows?.length) throw CANT_EDIT;
    refresh(id);
    return { id };
  },
});

// --- Delete -------------------------------------------------------------------------------

export const deleteJob = defineAction({
  name: "jobs.delete",
  permissions: ["jobs:delete"],
  schema: deleteJobSchema,
  handler: async ({ id, reason }, ctx) => {
    await visibleJob(ctx, id);
    // soft_delete_record checks the permission and edit scope, and audit-logs it.
    check(
      await ctx.supabase.rpc("soft_delete_record", { p_table: "jobs", p_id: id, p_reason: reason }),
    );
    revalidatePath("/jobs/list");
    revalidatePath("/jobs");
    return { id };
  },
});
