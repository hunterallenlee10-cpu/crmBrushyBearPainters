"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { advanceJobStage } from "@/lib/jobs/stage";
import { recomputeJobHealth } from "@/lib/jobs/health";
import { isJobStageId } from "@/lib/domain/stages";
import { MILESTONE_FIELDS, type MilestoneField } from "@/lib/domain/jobs/constants";
import type { Database } from "@/lib/db/types";
import { logError } from "@/lib/log";
import { recoverMilestoneSchema, recoverStageSchema } from "@/lib/validation/job-recovery";

/**
 * Admin → Job Recovery (owners): fix a stuck job. Stage moves go through
 * advanceJobStage() as an owner override with the reason (stage history keeps
 * it); milestone edits are audited and the reason goes on the job's timeline.
 */
function ownersOnly(isOwner: boolean) {
  if (!isOwner) throw new ActionFailure(actionError("forbidden", "Job Recovery is for owners."));
}

export const recoverStage = defineAction({
  name: "job_recovery.stage",
  schema: recoverStageSchema,
  permissions: ["job_admin:override", "jobs:advance_stage"],
  handler: async ({ job_id, to, reason, lost_reason }, ctx) => {
    ownersOnly(ctx.viewer.isOwner);
    if (!isJobStageId(to)) throw new ActionFailure(actionError("validation", "Unknown stage."));
    const result = await advanceJobStage(
      {
        jobId: job_id,
        toStage: to,
        override: true,
        reason: `Job Recovery: ${reason}`,
        lostReason: lost_reason ?? null,
      },
      ctx,
    );
    revalidatePath("/admin/job-recovery");
    revalidatePath(`/jobs/${job_id}`);
    return result;
  },
});

export const recoverMilestone = defineAction({
  name: "job_recovery.milestone",
  schema: recoverMilestoneSchema,
  permissions: ["job_admin:override"],
  handler: async ({ job_id, field, value, reason }, ctx) => {
    ownersOnly(ctx.viewer.isOwner);
    const patch: Database["public"]["Tables"]["jobs"]["Update"] = {};
    patch[field as MilestoneField] = value;
    const rows = check(await ctx.supabase.from("jobs").update(patch).eq("id", job_id).select("id"));
    if (!rows?.length)
      throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const label = MILESTONE_FIELDS.find(([f]) => f === field)?.[1] ?? field;
    try {
      const svc = await ctx.service();
      await svc.from("activity").insert({
        org_id: ctx.viewer.orgId,
        subject_type: "job",
        subject_id: job_id,
        type: "milestone_fixed",
        summary: `${value ? "Set" : "Cleared"} “${label}” in Job Recovery: ${reason}`,
        payload: { field, value, reason },
        actor_id: ctx.viewer.real.id,
      });
      await recomputeJobHealth(svc, [job_id]);
    } catch (e) {
      logError("job_recovery.milestone.after", e);
    }
    revalidatePath("/admin/job-recovery");
    revalidatePath(`/jobs/${job_id}`);
    return { job_id, field };
  },
});
