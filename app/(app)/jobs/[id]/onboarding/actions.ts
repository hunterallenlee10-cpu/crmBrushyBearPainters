"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction, type ActionContext } from "@/lib/actions/define-action";
import { ActionFailure, actionError, check, mapDbError } from "@/lib/actions/errors";
import { REQUESTABLE } from "@/lib/domain/onboarding/checklist";
import { isOnboardingKey } from "@/lib/domain/onboarding/rules";
import { sendJobMessage } from "@/lib/jobs/send";
import { logError } from "@/lib/log";
import { reverifyJob } from "@/lib/onboarding/checks";
import { pacificToUtcIso } from "@/app/(app)/leads/[id]/utils";

/**
 * Onboarding item actions (SPEC §6.4): Mark cleared with a note, Reopen,
 * Re-verify all, Request from customer (simulated message through the
 * outbox), Create task. Clearing and reopening go through the person's own
 * client (row security + the guard: only status/note may change); the checks
 * then re-run with the service client and, when everything is cleared, the
 * job moves to Ready to Schedule through advanceJobStage's gate.
 */

const id = z.uuid();
const jobPath = (jobId: string) => `/jobs/${jobId}`;

async function requirement(ctx: ActionContext, jobId: string, requirementId: string) {
  const row = check(
    await ctx.supabase
      .from("onboarding_requirements")
      .select("id, job_id, key, label, status, verified_auto")
      .eq("id", requirementId)
      .eq("job_id", jobId)
      .maybeSingle(),
  );
  if (!row)
    throw new ActionFailure(actionError("not_found", "That onboarding item isn't available."));
  return row;
}

async function recheck(ctx: ActionContext, jobId: string) {
  try {
    return await reverifyJob(await ctx.service(), jobId);
  } catch (e) {
    logError("onboarding.recheck", e);
    return null;
  }
}

const clearSchema = z.object({
  jobId: id,
  requirementId: id,
  note: z.string().trim().min(3, "Say how it was cleared (at least 3 characters).").max(1000),
});

export const clearRequirement = defineAction({
  name: "onboarding.clear",
  permissions: ["jobs:update"],
  schema: clearSchema,
  handler: async (v, ctx) => {
    await requirement(ctx, v.jobId, v.requirementId);
    const { data, error } = await ctx.supabase
      .from("onboarding_requirements")
      .update({ status: "verified", note: v.note })
      .eq("id", v.requirementId)
      .select("id");
    if (error) throw new ActionFailure(mapDbError(error));
    if (!data?.length) {
      throw new ActionFailure(
        actionError("forbidden", "You can only change jobs you're on or own."),
      );
    }
    const r = await recheck(ctx, v.jobId);
    revalidatePath(jobPath(v.jobId));
    return { advanced: r?.advanced ?? false };
  },
});

export const reopenRequirement = defineAction({
  name: "onboarding.reopen",
  permissions: ["jobs:update"],
  schema: z.object({ jobId: id, requirementId: id }),
  handler: async (v, ctx) => {
    const row = await requirement(ctx, v.jobId, v.requirementId);
    if (row.status !== "verified" || row.verified_auto) {
      throw new ActionFailure(
        actionError("validation", "Only items cleared by hand can be reopened."),
      );
    }
    const { data, error } = await ctx.supabase
      .from("onboarding_requirements")
      .update({ status: "pending" })
      .eq("id", v.requirementId)
      .select("id");
    if (error) throw new ActionFailure(mapDbError(error));
    if (!data?.length) {
      throw new ActionFailure(
        actionError("forbidden", "You can only change jobs you're on or own."),
      );
    }
    await recheck(ctx, v.jobId);
    revalidatePath(jobPath(v.jobId));
    return { ok: true };
  },
});

export const reverifyOnboarding = defineAction({
  name: "onboarding.reverify",
  permissions: ["jobs:read"],
  schema: z.object({ jobId: id }),
  handler: async (v, ctx) => {
    const job = check(await ctx.supabase.from("jobs").select("id").eq("id", v.jobId).maybeSingle());
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const r = await reverifyJob(await ctx.service(), v.jobId);
    revalidatePath(jobPath(v.jobId));
    return { changed: r.changed, advanced: r.advanced };
  },
});

const requestSchema = z
  .object({
    jobId: id,
    requirementId: id,
    channel: z.enum(["sms", "email"]),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1, "Write the message.").max(4000),
    templateKey: z.string().regex(/^[a-z0-9][a-z0-9_]{0,59}$/),
  })
  .refine((v) => v.channel === "sms" || (v.subject ?? "").length > 0, {
    message: "Add a subject.",
    path: ["subject"],
  });

export const requestFromCustomer = defineAction({
  name: "onboarding.request",
  permissions: ["messages:send", "jobs:update"],
  schema: requestSchema,
  handler: async (v, ctx) => {
    const row = await requirement(ctx, v.jobId, v.requirementId);
    if (!isOnboardingKey(row.key) || !REQUESTABLE[row.key]) {
      throw new ActionFailure(
        actionError("validation", "There's nothing to ask the customer for this item."),
      );
    }
    const sent = await sendJobMessage(ctx, v.jobId, {
      channel: v.channel,
      subject: v.subject,
      body: v.body,
      templateKey: v.templateKey,
    });
    const { error } = await ctx.supabase
      .from("onboarding_requirements")
      .update({ requested_at: new Date().toISOString() })
      .eq("id", v.requirementId);
    if (error) logError("onboarding.request.mark", error);
    await recheck(ctx, v.jobId);
    revalidatePath(jobPath(v.jobId));
    return { messageId: sent.messageId };
  },
});

const taskSchema = z.object({
  jobId: id,
  requirementId: id,
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  dueDate: z.iso.date().optional(),
  assigneeId: z.uuid({ message: "Pick who it's for." }),
});

export const createRequirementTask = defineAction({
  name: "onboarding.task",
  permissions: ["tasks:manage", "jobs:update"],
  schema: taskSchema,
  handler: async (v, ctx) => {
    await requirement(ctx, v.jobId, v.requirementId);
    const job = check(
      await ctx.supabase.from("jobs").select("id, org_id").eq("id", v.jobId).maybeSingle(),
    );
    if (!job) throw new ActionFailure(actionError("not_found", "That job isn't available."));
    const task = check(
      await ctx.supabase
        .from("tasks")
        .insert({
          org_id: job.org_id,
          subject_type: "job",
          subject_id: v.jobId,
          title: v.title,
          due_at: v.dueDate ? pacificToUtcIso(v.dueDate, "17:00") : null,
          assignee_id: v.assigneeId,
          priority: "normal",
        })
        .select("id")
        .single(),
    );
    if (!task) throw new ActionFailure(actionError("server"));
    const { error } = await ctx.supabase
      .from("onboarding_requirements")
      .update({ task_id: task.id })
      .eq("id", v.requirementId);
    if (error) logError("onboarding.task.link", error);
    revalidatePath(jobPath(v.jobId));
    return { taskId: task.id };
  },
});
