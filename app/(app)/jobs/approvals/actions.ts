"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { advanceJobStage } from "@/lib/jobs/stage";
import { getStage, isJobStageId } from "@/lib/domain/stages";
import { cancelApprovalSchema, decideApprovalSchema } from "@/lib/validation/jobs";
import { logError } from "@/lib/log";
import { approvedReason, parseOverridePayload } from "./payload";

/**
 * Approvals (SPEC §8.5). Owners approve or reject; requesters cancel their own.
 * Approving a stage override moves the job first (advanceJobStage, the only way
 * a stage changes) and only then marks the request approved, so a job that moved
 * meanwhile or is blocked by a hold leaves the request pending. Audit rows and
 * `approval.*` events come from the table's database triggers.
 */

const PATH = "/jobs/approvals";

const notPending = () =>
  new ActionFailure(
    actionError("conflict", "This request was already decided or canceled. Reload the page."),
  );

export const decideApproval = defineAction({
  name: "approvals.decide",
  schema: decideApprovalSchema,
  permissions: ["job_admin:override"],
  handler: async ({ id, decision, note }, ctx) => {
    const { supabase, viewer } = ctx;
    const req = check(
      await supabase
        .from("approval_requests")
        .select("id, type, job_id, status, reason, payload")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!req) throw new ActionFailure(actionError("not_found", "That request isn't available."));
    if (req.status !== "pending") throw notPending();

    let moved: { from: string; to: string } | null = null;
    if (decision === "approved") {
      if (req.type !== "stage_override") {
        throw new ActionFailure(
          actionError("validation", "This kind of request can't be approved here yet."),
        );
      }
      const payload = parseOverridePayload(req.payload);
      if (!payload.toStage) {
        throw new ActionFailure(
          actionError(
            "validation",
            "This request doesn't say which stage to move to. Reject it and ask for a new one.",
          ),
        );
      }
      const job = check(
        await supabase.from("jobs").select("id, stage").eq("id", req.job_id).maybeSingle(),
      );
      if (!job || !isJobStageId(job.stage)) {
        throw new ActionFailure(actionError("not_found", "That job isn't available."));
      }
      if (job.stage === payload.toStage) {
        throw new ActionFailure(
          actionError(
            "conflict",
            `The job is already in ${getStage(job.stage).label}. Reject or cancel this request instead.`,
          ),
        );
      }
      if (payload.fromStage && payload.fromStage !== job.stage) {
        throw new ActionFailure(
          actionError(
            "conflict",
            `This job moved from ${getStage(payload.fromStage).label} to ${getStage(job.stage).label} since the request. Reject it and ask for a new one.`,
          ),
        );
      }
      const result = await advanceJobStage(
        {
          jobId: req.job_id,
          toStage: payload.toStage,
          override: true,
          reason: approvedReason(req.reason, viewer.name),
          lostReason: payload.lostReason,
          approvalRequestId: req.id,
        },
        ctx,
      );
      moved = { from: result.from, to: result.to };
    }

    const patch = { status: decision, decision_note: note };
    const { data: rows, error } = await supabase
      .from("approval_requests")
      .update(patch)
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error || !rows?.length) {
      if (!moved) {
        if (error) throw new ActionFailure(mapDbError(error));
        throw notPending();
      }
      // The job already moved: record the decision with the service role (the
      // owner's permission was checked above; the owner is still the actor).
      logError("approvals.decide.mark", error ?? new Error("no row updated"));
      const service = await ctx.service();
      const { error: svcError } = await service
        .from("approval_requests")
        .update(patch)
        .eq("id", id)
        .eq("status", "pending");
      if (svcError) {
        logError("approvals.decide.mark_service", svcError);
        throw new ActionFailure(
          actionError(
            "server",
            "The job moved, but the request couldn't be marked approved. Tell an owner.",
          ),
        );
      }
    }
    revalidatePath(PATH);
    revalidatePath(`/jobs/${req.job_id}`);
    return { id, decision, jobId: req.job_id, moved };
  },
});

export const cancelApproval = defineAction({
  name: "approvals.cancel",
  schema: cancelApprovalSchema,
  // Only the requester may cancel (checked here and by the database guard).
  permissions: null,
  handler: async ({ id }, { supabase, viewer }) => {
    const req = check(
      await supabase
        .from("approval_requests")
        .select("id, job_id, status, requested_by")
        .eq("id", id)
        .maybeSingle(),
    );
    if (!req) throw new ActionFailure(actionError("not_found", "That request isn't available."));
    if (req.requested_by !== viewer.id) {
      throw new ActionFailure(
        actionError("forbidden", "Only the person who asked can cancel a request."),
      );
    }
    if (req.status !== "pending") throw notPending();
    const rows = check(
      await supabase
        .from("approval_requests")
        .update({ status: "canceled" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id"),
    );
    if (!rows?.length) throw notPending();
    revalidatePath(PATH);
    revalidatePath(`/jobs/${req.job_id}`);
    return { id };
  },
});
