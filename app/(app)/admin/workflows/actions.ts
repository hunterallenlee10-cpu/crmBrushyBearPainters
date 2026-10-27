"use server";

import { revalidatePath } from "next/cache";
import { defineAction } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check } from "@/lib/actions/errors";
import { getWorkflow } from "@/lib/domain/workflows/catalog";
import {
  retryRunSchema,
  testWorkflowSchema,
  toggleWorkflowSchema,
} from "@/lib/validation/communication";
import { dryRunWorkflow, retryRun } from "@/lib/workflows/engine";

/**
 * Admin → Workflows (SPEC §11.1): turn a system workflow on or off (with a
 * reason when off), Test it against a record (a dry run that sends nothing
 * and is logged as a dry-run row), and retry a failed run from the step that
 * failed. Switches are written with the person's own session (row security:
 * workflows:manage); audit rows and `workflow.updated` events come from
 * the table's triggers.
 */

export const toggleWorkflow = defineAction({
  name: "workflows.toggle",
  schema: toggleWorkflowSchema,
  permissions: ["workflows:manage"],
  handler: async (v, { supabase }) => {
    if (!getWorkflow(v.key)) {
      throw new ActionFailure(actionError("not_found", "That workflow doesn't exist."));
    }
    const rows = check(
      await supabase
        .from("workflows")
        .update({ enabled: v.enabled, disabled_reason: v.enabled ? null : v.reason })
        .eq("key", v.key)
        .select("key"),
    );
    if (!rows?.length) {
      throw new ActionFailure(actionError("forbidden", "You can't change workflows."));
    }
    revalidatePath("/admin/workflows");
    revalidatePath(`/admin/workflows/${v.key}`);
    return { enabled: v.enabled };
  },
});

export const testWorkflow = defineAction({
  name: "workflows.test",
  schema: testWorkflowSchema,
  permissions: ["workflows:manage"],
  handler: async (v, ctx) => {
    if (!getWorkflow(v.key)) {
      throw new ActionFailure(actionError("not_found", "That workflow doesn't exist."));
    }
    const result = await dryRunWorkflow(await ctx.service(), {
      orgId: ctx.viewer.orgId,
      key: v.key,
      subjectId: v.subjectId,
      at: v.at ? new Date(v.at) : undefined,
      actorId: ctx.viewer.id,
    });
    revalidatePath(`/admin/workflows/${v.key}`);
    return result;
  },
});

export const retryWorkflowRun = defineAction({
  name: "workflows.run.retry",
  schema: retryRunSchema,
  permissions: ["workflows:manage"],
  handler: async (v, ctx) => {
    // Row security: the person must be able to see the run.
    const run = check(
      await ctx.supabase.from("workflow_runs").select("id, status").eq("id", v.runId).maybeSingle(),
    );
    if (!run) throw new ActionFailure(actionError("not_found", "That run isn't available."));
    if (run.status !== "failed") {
      throw new ActionFailure(actionError("conflict", "Only a failed run can be retried."));
    }
    const ok = await retryRun(await ctx.service(), v.runId);
    if (!ok) throw new ActionFailure(actionError("conflict", "Only a failed run can be retried."));
    revalidatePath(`/admin/workflows/runs/${v.runId}`);
    return { retried: true };
  },
});
